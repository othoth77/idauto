'use strict';

/* IDauto owner session — V1 personal (IDA-V1B).
 *
 * WHAT THIS IS. A stateless, signed browser credential that lets the
 * OWNER's own browser resolve a plate, without the owner ever typing a key
 * on the citizen surface. It exists because three requirements collide on a
 * publicly reachable site:
 *
 *   - the citizen UI must never ask for a key (V1 is personal use);
 *   - a plate alone must open the passport for the owner;
 *   - A5-PLATE must stay intact — a plate must NOT resolve for the public.
 *
 * Anything the page can do with no credential at all, the whole internet can
 * do too. So the owner's browser carries a credential the public does not
 * have, and the owner never types it: it is installed once from /admin,
 * where the owner is already authenticated with the Bearer token.
 *
 * WHAT IT IS NOT. This is not an admin credential. api.js admits it for
 * exactly two READ routes (see OWNER_SESSION_ROUTES there) and nothing else.
 * Stolen, it cannot create a vehicle, write a fact, touch the review queue,
 * or read anything an anonymous visitor could not already reach by IVID.
 *
 * WHY STATELESS. The service runs under ProtectSystem=strict with exactly
 * one writable path (the media store), so a session file is not an option,
 * and a session table would be a schema migration for a single-user
 * deployment. Instead the cookie carries its own claims and an HMAC-SHA256
 * signature over them; the server re-verifies on every request and stores
 * nothing. The cost is that revocation is all-or-nothing — rotating
 * IDAUTO_SESSION_SECRET invalidates every enrolled browser at once. That is
 * the accepted trade for a personal deployment; per-device revocation would
 * need the table.
 *
 * FAILS CLOSED. With no IDAUTO_SESSION_SECRET configured (or one shorter
 * than MIN_SECRET_LENGTH) isEnabled() is false, issue() returns null and
 * verify() refuses everything. The host then behaves exactly as it did
 * before this module existed. Absence of configuration never opens a door.
 */

var crypto = require('crypto');

var COOKIE_NAME = 'ida_owner';
var VERSION = 'v1';

// The single capability this credential may ever carry. verify() rejects a
// cookie whose scope is anything else, so widening the grant later is a
// deliberate edit here and in api.js's route allowlist — never an accident.
var SCOPE = 'plate-lookup';

var MAX_AGE_SECONDS = 180 * 24 * 60 * 60;   // 180 days — owner decision
var RENEW_BELOW_SECONDS = 90 * 24 * 60 * 60; // renewed by GET /session past half-life

// 32 characters of a base64 32-byte secret. Below this the HMAC key is weak
// enough that a determined attacker could search it, so the module refuses
// to run rather than run badly.
var MIN_SECRET_LENGTH = 32;

function secret() {
  var configured = process.env.IDAUTO_SESSION_SECRET || '';
  return configured.length >= MIN_SECRET_LENGTH ? configured : null;
}

function isEnabled() { return secret() !== null; }

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  var padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payloadB64, key) {
  return b64url(crypto.createHmac('sha256', key).update(VERSION + '.' + payloadB64).digest());
}

/* Issue a cookie value for an already-authenticated admin identity.
 * `ref` is the actor_ref the Bearer token resolved to, so a request
 * authenticated by this cookie carries exactly the identity it would have
 * carried with the token — audit semantics are unchanged. */
function issue(ref, nowSeconds) {
  var key = secret();
  if (!key) return null;
  if (typeof ref !== 'string' || !ref) return null;
  var payload = { ref: ref, scope: SCOPE, exp: nowSeconds + MAX_AGE_SECONDS };
  var encoded = b64url(JSON.stringify(payload));
  return VERSION + '.' + encoded + '.' + signPayload(encoded, key);
}

/* Verify a cookie value. Returns { ref, exp } or null — never throws, and
 * never distinguishes "bad signature" from "expired" to the caller beyond
 * null, so api.js cannot accidentally leak which one failed. */
function verify(value, nowSeconds) {
  var key = secret();
  if (!key) return null;
  if (typeof value !== 'string') return null;

  var parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  var expected = signPayload(parts[1], key);
  var given = Buffer.from(parts[2], 'utf8');
  var computed = Buffer.from(expected, 'utf8');
  // Length check first: timingSafeEqual throws on a length mismatch, and an
  // attacker controls the length of what they send.
  if (given.length !== computed.length) return null;
  if (!crypto.timingSafeEqual(given, computed)) return null;

  var payload;
  try { payload = JSON.parse(fromB64url(parts[1])); } catch (_) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.scope !== SCOPE) return null;
  if (typeof payload.ref !== 'string' || !payload.ref) return null;
  if (typeof payload.exp !== 'number' || !isFinite(payload.exp)) return null;
  if (payload.exp <= nowSeconds) return null;

  return { ref: payload.ref, exp: payload.exp };
}

function needsRenewal(session, nowSeconds) {
  return !!session && (session.exp - nowSeconds) < RENEW_BELOW_SECONDS;
}

/* Parse a Cookie header. Deliberately tolerant of whitespace and of values
 * containing '=' (a base64url signature never does, but a cookie set by
 * something else on the same host might). */
function parseCookies(header) {
  var jar = {};
  if (typeof header !== 'string' || !header) return jar;
  header.split(';').forEach(function (pair) {
    var index = pair.indexOf('=');
    if (index === -1) return;
    var name = pair.slice(0, index).trim();
    if (!name) return;
    jar[name] = pair.slice(index + 1).trim();
  });
  return jar;
}

function readCookie(req) {
  return parseCookies(req && req.headers ? req.headers.cookie : '')[COOKIE_NAME] || null;
}

/* HttpOnly  — JavaScript cannot read it, so an XSS cannot exfiltrate it.
 * Secure    — never sent over plaintext HTTP.
 * SameSite=Strict — never sent on a request originating from another site,
 *             which is the first of the two CSRF defences (api.js's
 *             X-IDauto-Owner header requirement is the second). */
function setCookieHeader(value) {
  return COOKIE_NAME + '=' + value +
    '; Max-Age=' + MAX_AGE_SECONDS + '; Path=/; HttpOnly; Secure; SameSite=Strict';
}

function clearCookieHeader() {
  return COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict';
}

module.exports = {
  COOKIE_NAME: COOKIE_NAME,
  SCOPE: SCOPE,
  MAX_AGE_SECONDS: MAX_AGE_SECONDS,
  RENEW_BELOW_SECONDS: RENEW_BELOW_SECONDS,
  MIN_SECRET_LENGTH: MIN_SECRET_LENGTH,
  isEnabled: isEnabled,
  issue: issue,
  verify: verify,
  needsRenewal: needsRenewal,
  parseCookies: parseCookies,
  readCookie: readCookie,
  setCookieHeader: setCookieHeader,
  clearCookieHeader: clearCookieHeader
};
