'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2E-PRE — minimal Mythos identity stub
// reference/identity.js
//
// NOT the `mythos_auth` integration contract described in
// docs/ARCHITECTURE.md §4.1 (JWT/opaque-ref tokens issued by a real
// Mythos OS auth service) — that service does not exist anywhere in this
// codebase (confirmed by direct search before this stage began: the main
// app's only "auth" is a single shared client-side password with no
// per-user identity at all — see the IDA-2E blocker record in
// docs/AI_HANDOVER.md). Full `mythos_auth` integration remains blocked
// until a real Mythos OS identity service exists to integrate with.
//
// This is a deliberately minimal, honestly-labeled stopgap: a small,
// explicit, config-defined map of admin bearer tokens to stable identity
// strings. It replaces IDA-2C/2D's single undifferentiated placeholder
// token, so audit records can finally say WHO performed an action (not
// just "some admin, unspecified") — without pretending this is a real
// multi-user authentication system. No login flow, no session, no JWT,
// no user table. Tokens are still static, operator-provisioned secrets,
// not user-chosen credentials.
// =====================================================

// Parses IDAUTO_ADMIN_IDENTITIES once per process. Format: JSON object,
// { "<bearer token>": "<stable identity string>", ... }. Never logs the
// raw env var value — a parse failure only reports that it failed, not
// the (secret-containing) input.
var _identities = null;

function loadIdentities() {
  if (_identities !== null) return _identities;
  var raw = process.env.IDAUTO_ADMIN_IDENTITIES;
  if (!raw) {
    _identities = {};
    return _identities;
  }
  try {
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      _identities = parsed;
    } else {
      _identities = {};
    }
  } catch (e) {
    _identities = {};
  }
  return _identities;
}

// Returns the identity string for a raw bearer token, or null if the
// token is not a recognized admin identity. Callers must never store or
// log the token itself alongside the identity — only the identity string
// is safe to persist (e.g. into idauto_audit_log.actor_ref).
function resolveIdentity(token) {
  // IDA-V9 — always a STRING, for either entry form. An organisation entry is
  // an object in the map; returning it raw would put an object into
  // idauto_audit_log.actor_ref, which is VARCHAR(64). Resolving through
  // resolvePrincipal() keeps this function's contract exactly what every
  // existing caller already depends on: the stable identity string, or null.
  var principal = resolvePrincipal(token);
  return principal ? principal.actor_ref : null;
}

// Test/ops helper — forces a re-parse on the next resolveIdentity() call.
// Mirrors db.js's closePool()/writes.js's cache-free design: nothing here
// is cached in a way tests can't reset between runs.
function clearIdentityCache() {
  _identities = null;
}


/* =========================================================================
 * IDA-V9 — ORGANISATION PRINCIPALS. Owner decision, 2026-08-27: OPTION B.
 *
 * The SAME identity map, widened — not a second identity system. A value may
 * now be either form:
 *
 *   "<token>": "usr_admin"                          unchanged; full access
 *   "<token>": { "actor_ref": "svc_fixpert",
 *                "org_id": 3,
 *                "scopes": ["vehicle:read", "observation:write"] }
 *
 * The first form is every token that exists today and keeps behaving exactly
 * as it did. The second is an ORGANISATION service credential: one atelier,
 * one credential, explicit scopes.
 *
 * WHY THE PERSON IS NOT HERE. Under option B, Fixpert authenticates its own
 * users and IDauto stores no workshop account. The acting person arrives as
 * PROVENANCE on each write (author_ref), enforced by the database, and is
 * never an authorisation subject. That is what keeps the two domains
 * separate, and it is the trade the owner accepted: IDauto trusts Fixpert
 * about who acted, and records it.
 *
 * B → C WITHOUT REDOING THIS. resolvePrincipal() is the only place that turns
 * a credential into { actor_ref, org_id, scopes }. Moving to OIDC later means
 * building that object from validated claims instead of from this map;
 * everything downstream — scope checks, org isolation, provenance, audit —
 * reads the object and is untouched.
 * ========================================================================= */

// An admin identity has no organisation and every scope. Organisation
// principals are the opposite: always an org, never more scopes than listed.
var ADMIN_SCOPE = '*';

function normalizeScopes(value) {
  if (!Array.isArray(value)) return [];
  var out = [];
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] === 'string' && value[i]) out.push(value[i]);
  }
  return out;
}

/* Returns a principal, or null. Never throws on a malformed entry: a broken
 * map entry must fail CLOSED (unauthenticated), never fall back to admin. */
function resolvePrincipal(token) {
  if (!token) return null;
  var identities = loadIdentities();
  if (!Object.prototype.hasOwnProperty.call(identities, token)) return null;
  var entry = identities[token];

  if (typeof entry === 'string' && entry) {
    return { actor_ref: entry, org_id: null, scopes: [ADMIN_SCOPE], kind: 'admin' };
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    var ref = typeof entry.actor_ref === 'string' ? entry.actor_ref : '';
    var org = entry.org_id;
    if (!ref) return null;
    // An organisation principal MUST carry a numeric org id. Without one it
    // could neither be isolated nor audited to an organisation, so it is
    // refused rather than silently treated as an admin.
    if (typeof org !== 'number' || !isFinite(org) || org <= 0 || Math.floor(org) !== org) return null;
    var scopes = normalizeScopes(entry.scopes);
    if (scopes.length === 0) return null;           // no scopes = no access
    if (scopes.indexOf(ADMIN_SCOPE) !== -1) return null; // '*' is admin-only
    return { actor_ref: ref, org_id: org, scopes: scopes, kind: 'organisation' };
  }
  return null;
}

/* True when the principal may perform `scope`. Admin holds '*'. An
 * organisation holds exactly what it was granted — there is no inheritance,
 * no wildcard matching and no implicit scope, because a permission that can
 * be inferred is a permission nobody reviewed. */
function principalHasScope(principal, scope) {
  if (!principal || !Array.isArray(principal.scopes)) return false;
  if (principal.scopes.indexOf(ADMIN_SCOPE) !== -1) return true;
  return principal.scopes.indexOf(scope) !== -1;
}

module.exports = {
  resolveIdentity: resolveIdentity,
  resolvePrincipal: resolvePrincipal,
  principalHasScope: principalHasScope,
  ADMIN_SCOPE: ADMIN_SCOPE,
  clearIdentityCache: clearIdentityCache
};
