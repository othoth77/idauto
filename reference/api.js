'use strict';
// =====================================================
// MYTHOS — ID Auto API — reference/api.js
// (renamed from api-read.js in IDA-2D — see git history — because this
// file is no longer read-only)
//
// IDA-2C (original scope): GET-only, placeholder admin gate, excludes
// mythos_private data (no audit-on-read path existed).
//
// IDA-2D added: write routes (POST /api/vehicles, /api/plates,
// /api/observations, /api/vehicles/:ref/facts), each going through
// reference/writes.js's withAudit() — every mutation
// creates its idauto_audit_log row in the same transaction, atomically.
// Reads are UNCHANGED from IDA-2C, including the mythos_private exclusion
// — writes are now audited (satisfying AD-9), but reads still are not, so
// GET responses still exclude that scope.
//
// IDA-2E-PRE replaced the single undifferentiated placeholder token with
// reference/identity.js's minimal admin-identity map —
// see that file's header for exactly what this is and is not. Full IDA-2E
// (real Mythos OS auth service integration per docs/ARCHITECTURE.md
// §4.1) remains blocked: no such service exists anywhere in this
// codebase. requireAuth() now resolves a real identity string per request
// (req.mythosIdentity) instead of a boolean match against one shared
// token, and every write handler passes it through to writes.js so audit
// records carry the authenticated identity, never the raw bearer token.
//
// IDA-2F added object-storage wiring: POST/GET /api/observations/:id/media,
// backed by reference/storage.js (local, content-addressed
// filesystem storage — not a cloud service; see that file's header for
// why). The write goes through writes.js's withAudit() exactly like every
// other mutation. The read (like every other GET in this file) still
// excludes mythos_private-scope rows — unchanged policy, not relaxed by
// adding a new resource type.
//
// A5 OPTION C, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md §A5 — owner
// decision recorded verbatim there): IDA-4 Option C adds
// GET /public/passport/:ivid — this file's FIRST unauthenticated route.
// It is reached BEFORE requireAuth() below, deliberately: it is not an
// admin route with auth accidentally skipped, it is the one route this
// server intentionally serves with no bearer token at all, scoped
// narrowly to IVID-only public-passport resolution. See
// handlePublicPassportRoute()'s own header for the full control chain.
// Every route below this comment remains authenticated exactly as
// before — requireAuth() still gates the entire ROUTES table.
// =====================================================

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var db = require('./db.js');
var writes = require('./writes.js');
var identity = require('./identity.js');
var storage = require('./storage.js');
var ingestion = require('./ingestion.js');
var ivid = require('./ivid.js');
var passportAssembly = require('./passport-assembly.js');
var rateLimit = require('./rate-limit.js');
var publicSurfacePolicy = require('./public-surface-policy.js');
var plateValidator = require('./plate-validator.js');
var session = require('./session.js');
var v12Routes = require('./v12-routes.js');
var plateNormalizer = require('./vehicle/plate-normalizer.js');

//
// IDA-V1B, 2026-08-27 — OWNER SESSION.
//
// V1 is personal use: the citizen surface must never ask for a key, yet a
// plate alone must open the passport for the owner — while A5-PLATE keeps a
// plate from resolving for the public. Those hold together only if the
// owner's browser carries something the public does not, which the owner
// never types. That is reference/session.js: a signed, HttpOnly cookie
// installed once from /admin, where the owner is already authenticated.
//
// The grant is deliberately tiny. These two READ routes and nothing else:
// plate -> IVID, and the private passport for an IVID. Every write route,
// the review queue, ingestion and media stay Bearer-only, so this credential
// cannot create or change anything even if it is stolen. Widening this list
// is the one edit that would widen the grant — there is no other path.
var OWNER_SESSION_ROUTES = [
  { method: 'GET', pattern: /^\/api\/plates\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/passport\/[^/]+$/ }
];

// CSRF, second defence. The cookie is SameSite=Strict, so a browser will not
// attach it to a cross-site request in the first place. This header is the
// belt to that pair of braces: a cross-site <form> or <img> cannot set a
// custom header at all, and a cross-site fetch() that tries turns the
// request into a CORS preflight this server never answers. Required on the
// cookie-authenticated reads AND on every /session route.
var OWNER_HEADER = 'x-idauto-owner';

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function ownerSessionAllows(method, pathname) {
  return OWNER_SESSION_ROUTES.some(function (route) {
    return route.method === method && route.pattern.test(pathname);
  });
}

// Returns the actor_ref this cookie was issued for, or null. Every gate is
// checked here rather than at the call site so there is exactly one place
// where a cookie can become an identity.
function resolveOwnerSession(req) {
  if (!session.isEnabled()) return null;
  if (req.headers[OWNER_HEADER] !== '1') return null;
  var pathname = url.parse(req.url).pathname;
  if (!ownerSessionAllows(req.method, pathname)) return null;
  var raw = session.readCookie(req);
  if (!raw) return null;
  var verified = session.verify(raw, nowSeconds());
  return verified ? verified.ref : null;
}

//
// IDA-V1C, 2026-08-27 — BEARER PARSING AND AUTH LOGGING.
//
// Diagnosed on 2026-08-27: a valid admin token was reported "refused" by
// /admin. It was not. The token is base64 — it contains '/' and ends with
// '=' — and both characters break double-click selection, so what reached
// the header was a partial copy. The server was right to refuse it, but
// nothing on this host could say so: api.js logged only its own startup
// line, and /var/log/nginx/access.log is www-data:adm 0640 while `deploy`
// is in neither group. An authentication failure left no trace the operator
// could read. These two changes fix the diagnosis path, not the tokens.
//
// PARSING. The old /^Bearer (.+)$/ was stricter than RFC 7235 in two ways
// that can only ever reject a caller who meant well:
//
//   - the scheme is case-INSENSITIVE per RFC 7235 §2.1, so `bearer x` is a
//     valid credential this regex rejected;
//   - the scheme and credential are separated by 1*SP, so `Bearer  x` (two
//     spaces) parsed to a credential with a leading space and failed.
//
// Neither loosening admits anything that was not already a correctly formed
// credential, and no stored token changes. The credential itself is matched
// as [^ \t]+ — deliberately NOT (.+) — so an embedded space is a parse
// failure rather than becoming part of the compared string.
//
// Case-folding the CREDENTIAL is deliberately not done: it would collapse
// the token alphabet and weaken every token on this host.
var BEARER_RE = /^Bearer[ \t]+([^ \t]+)[ \t]*$/i;

function extractBearer(headerValue) {
  var match = BEARER_RE.exec(String(headerValue == null ? '' : headerValue).trim());
  return match ? match[1] : null;
}

// LOGGING. One structured line per authentication decision, to journald via
// the unit's StandardOutput=journal.
//
// What is NEVER written: the credential, in whole or in part. Not a prefix,
// not a suffix, not a hash of it — a prefix is a piece of the secret and a
// hash of a low-entropy guess is reversible. The `credential_length` field
// appears ONLY on a denial, where the value is the caller's own rejected
// input and is exactly what distinguishes a partial paste (39 characters) from
// "wrong token entirely" (44). A granted decision logs no length, so a
// successful request never records the real token's shape.
//
// The client is identified by the first 16 hex of clientIpHash() — the same
// per-client hash the public limiter buckets on (IDA-SHIP-2), so no raw IP
// is written here either.
function logAuthDecision(req, fields) {
  var entry = {
    at: new Date().toISOString(),
    event: 'auth',
    result: fields.result,
    reason: fields.reason,
    method: req.method,
    path: url.parse(req.url).pathname
  };
  try { entry.client = clientIpHash(req).slice(0, 16); } catch (_) { entry.client = null; }
  if (fields.actor) entry.actor = fields.actor;
  if (fields.org !== undefined && fields.org !== null) entry.org = fields.org;
  if (typeof fields.credentialLength === 'number') entry.credential_length = fields.credentialLength;
  console.log(JSON.stringify(entry));
}

function requireAuth(req, res) {
  var header = req.headers['authorization'];
  var token = extractBearer(header);
  var resolved = identity.resolveIdentity(token);
  var via = resolved ? 'bearer' : null;
  // IDA-V9 — the SAME lookup, read as a principal. req.mythosIdentity keeps
  // being the actor_ref string every audit row already carries; req.principal
  // adds the organisation and scopes that authorisation reads. An admin token
  // resolves to a principal with '*' and no organisation, so nothing that
  // worked before changes.
  var principal = identity.resolvePrincipal(token);
  // IDA-V1B: the owner cookie is a fallback, never an override — a request
  // carrying a valid Bearer token is resolved by the token exactly as
  // before. The cookie yields the same actor_ref the token would have, so
  // req.mythosIdentity and every audit record downstream are unchanged.
  if (!resolved) {
    resolved = resolveOwnerSession(req);
    if (resolved) via = 'owner_session';
  }
  if (!resolved) {
    // Three distinguishable denials. None is an oracle about the correct
    // token: the caller already knows what it sent, and no field here is
    // derived from the stored value. `no_credentials` vs `invalid_credentials`
    // is the difference the admin UI needs to tell "you pasted nothing" from
    // "what you pasted is not a token".
    var reason = !header ? 'no_credentials' : (token === null ? 'malformed_authorization' : 'unknown_credential');
    logAuthDecision(req, {
      result: 'denied',
      reason: reason,
      credentialLength: token === null ? undefined : token.length
    });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'unauthorized — a recognized admin identity token is required',
      reason: reason === 'no_credentials' ? 'no_credentials' : 'invalid_credentials'
    }));
    return false;
  }
  req.mythosIdentity = resolved;
  // A cookie-authenticated owner is an admin principal: the session grant is
  // already narrower than any scope check would be (two READ routes, pinned
  // in OWNER_SESSION_ROUTES), so it is not widened here.
  req.principal = principal || { actor_ref: resolved, org_id: null, scopes: [identity.ADMIN_SCOPE], kind: 'admin' };
  logAuthDecision(req, { result: 'granted', reason: via, actor: resolved, org: req.principal.org_id });
  return true;
}

// IDA-V9 — one scope gate, used by every route that an organisation may reach.
// Answers 403, not 401: the caller IS authenticated, it simply may not do this.
// Returns true when the request may proceed.
function requireScope(req, res, scope) {
  if (identity.principalHasScope(req.principal, scope)) return true;
  logAuthDecision(req, {
    result: 'denied', reason: 'missing_scope:' + scope,
    actor: req.mythosIdentity, org: req.principal ? req.principal.org_id : null
  });
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'forbidden — this credential does not carry the required scope', required_scope: scope }));
  return false;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendMethodNotAllowed(res, allowed) {
  res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': allowed });
  res.end(JSON.stringify({ error: 'method not allowed' }));
}

// IDA-V1B — the three owner-session routes. Handled before requireAuth()
// because two of them must answer without a Bearer token: GET /session tells
// the citizen page whether this browser is the owner's, and POST
// /session/logout must work for a browser whose cookie has already expired.
// Returns true when it has answered the request.
//
// /session/enroll is NOT in OWNER_SESSION_ROUTES, so the cookie cannot
// authenticate it: only a real Bearer admin token can mint a new cookie.
function handleSessionRoute(req, res, pathname) {
  if (pathname !== '/session' && pathname !== '/session/enroll' && pathname !== '/session/logout') return false;

  if (req.headers[OWNER_HEADER] !== '1') {
    sendJson(res, 403, { error: 'owner session requests must carry X-IDauto-Owner: 1' });
    return true;
  }

  if (pathname === '/session') {
    if (req.method !== 'GET') { sendMethodNotAllowed(res, 'GET'); return true; }
    // Never 401 here. This route's whole purpose is to answer "is this
    // browser the owner's?", and "no" is a perfectly good answer that the
    // public page needs in order to render itself.
    var raw = session.isEnabled() ? session.readCookie(req) : null;
    var verified = raw ? session.verify(raw, nowSeconds()) : null;
    if (!verified) { sendJson(res, 200, { owner: false }); return true; }
    // Rolling renewal past half-life. The citizen page calls this on every
    // visit, so a browser in regular use never reaches the 180-day expiry.
    if (session.needsRenewal(verified, nowSeconds())) {
      var renewed = session.issue(verified.ref, nowSeconds());
      if (renewed) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': session.setCookieHeader(renewed) });
        res.end(JSON.stringify({ owner: true }));
        return true;
      }
    }
    sendJson(res, 200, { owner: true });
    return true;
  }

  if (pathname === '/session/enroll') {
    if (req.method !== 'POST') { sendMethodNotAllowed(res, 'POST'); return true; }
    if (!session.isEnabled()) {
      sendJson(res, 503, { error: 'owner sessions are not configured on this host' });
      return true;
    }
    if (!requireAuth(req, res)) return true;
    var issued = session.issue(req.mythosIdentity, nowSeconds());
    if (!issued) { sendJson(res, 503, { error: 'owner sessions are not configured on this host' }); return true; }
    res.writeHead(204, { 'Set-Cookie': session.setCookieHeader(issued) });
    res.end();
    return true;
  }

  // /session/logout — clearing your own cookie needs no credential, and
  // must keep working when the cookie it clears is already invalid.
  if (req.method !== 'POST') { sendMethodNotAllowed(res, 'POST'); return true; }
  res.writeHead(204, { 'Set-Cookie': session.clearCookieHeader() });
  res.end();
  return true;
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (err) {
    throw Object.assign(new Error('invalid URL encoding'), { httpStatus: 400 });
  }
}

/* IDA-ADMIN-DS, 2026-08-28 — THE ADMIN SURFACE USES THE REAL DESIGN SYSTEM.
 *
 * The admin pages carried their own stylesheet with hand-written colours
 * (#0b1220, #72d7c5) that predate the IDauto Design System. They looked like
 * a different product from idauto.tn and /passport. They now use the SAME
 * tokens.css / base.css / components.css as the citizen surface.
 *
 * WHY THEY ARE SERVED HERE AND NOT REUSED FROM '/assets/…'.
 * The citizen map below is PHASE-GATED: serveCitizenAsset() declines every
 * path when public_resolution.enabled is false (the A5-PLATE gate). Pointing
 * the admin pages at '/assets/tokens.css' would therefore make the operator's
 * own console lose all styling the moment the citizen surface is switched to
 * the PRIVATE phase — coupling an internal tool to a public-surface switch it
 * has nothing to do with. The dispatch order (admin BEFORE citizen) exists to
 * keep admin independent, and this preserves that.
 *
 * THE SAME FILES, NOT COPIES. Each entry below points at the very file the
 * citizen surface serves. There is no second copy of the Design System to
 * drift out of sync — one source, two mount points. `root` names which
 * directory the file is resolved against; entries without it keep resolving
 * against reference/, exactly as before.
 *
 * Still a map, still GET-only, still no concatenation of request input into a
 * path — the traversal properties are unchanged. */
var WEB_ROOT = path.join(__dirname, '..', 'web');

var ADMIN_ASSETS = {
  '/admin': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/admin-ui.js': { file: 'admin-ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/admin/admin.css': { file: 'admin.css', contentType: 'text/css; charset=utf-8' },
  '/admin/review': { file: 'review.html', contentType: 'text/html; charset=utf-8' },
  '/admin/review/': { file: 'review.html', contentType: 'text/html; charset=utf-8' },
  '/admin/review-ui.js': { file: 'review-ui.js', contentType: 'application/javascript; charset=utf-8' },

  // The Design System itself — the same files web/ serves to the citizen
  // surface, mounted under /admin/ so they are never phase-gated.
  '/admin/assets/tokens.css': { root: WEB_ROOT, file: 'design-system/tokens/tokens.css', contentType: 'text/css; charset=utf-8' },
  '/admin/assets/base.css': { root: WEB_ROOT, file: 'design-system/css/base.css', contentType: 'text/css; charset=utf-8' },
  '/admin/assets/components.css': { root: WEB_ROOT, file: 'design-system/css/components.css', contentType: 'text/css; charset=utf-8' },
  '/admin/assets/ui.js': { root: WEB_ROOT, file: 'design-system/js/ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/admin/assets/favicon.svg': { root: WEB_ROOT, file: 'citizen/favicon.svg', contentType: 'image/svg+xml' }
};

// The admin shell contains no data or credentials. API calls made by the
// page still pass through requireAuth() below; the bearer token is held only
// in page memory and is never written to browser storage.
function serveAdminAsset(req, res, pathname) {
  var asset = ADMIN_ASSETS[pathname];
  if (!asset || req.method !== 'GET') return false;
  fs.readFile(path.join(asset.root || __dirname, asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'admin UI unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  });
  return true;
}

// =====================================================
// IDA-DS-1 — citizen UI static assets (web/)
//
// The IDauto Design System citizen surface (web/citizen + web/design-system
// + web/vendor). Static shells and assets only — every DATA request the
// pages make still goes through handlePublicPassportRoute() (public,
// IVID-only) or requireAuth() (professional), exactly as before; this map
// adds no data path and parses no query string.
//
// PHASE GATE (A5-PLATE): the citizen UI is the PUBLIC-phase surface and
// follows public_resolution.enabled — the exact same owner-controlled
// switch that gates GET /public/passport/:ivid, read through the same
// loadPublicResolutionConfig() (same once-per-process cache semantics).
// enabled = false (PRIVATE phase) → serveCitizenAsset() declines every
// path and behavior is byte-identical to before this map existed ('/'
// falls through to requireAuth() → 401, like any unknown path). No second
// activation mechanism exists: the citizen shells can never be reachable
// while public resolution is off, and CITIZEN_FACING_IDA4_READY remains
// the deployment-decision gate this code does not decide.
//
// Map-based file resolution, identical to ADMIN_ASSETS above — no path
// concatenation from request input, so no traversal surface.
var CITIZEN_WEB_ROOT = path.join(__dirname, '..', 'web');
var CITIZEN_ASSETS = {
  '/': { file: 'citizen/index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { file: 'citizen/index.html', contentType: 'text/html; charset=utf-8' },
  '/passport': { file: 'citizen/passport.html', contentType: 'text/html; charset=utf-8' },
  '/assets/tokens.css': { file: 'design-system/tokens/tokens.css', contentType: 'text/css; charset=utf-8' },
  '/assets/base.css': { file: 'design-system/css/base.css', contentType: 'text/css; charset=utf-8' },
  '/assets/components.css': { file: 'design-system/css/components.css', contentType: 'text/css; charset=utf-8' },
  '/assets/plate.js': { file: 'design-system/js/plate.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/ui.js': { file: 'design-system/js/ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/ivid-client.js': { file: 'design-system/js/ivid-client.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/qrcodegen.js': { file: 'vendor/qrcodegen.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/passport-render.js': { file: 'citizen/passport-render.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/home.js': { file: 'citizen/home.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/passport.js': { file: 'citizen/passport.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/favicon.svg': { file: 'citizen/favicon.svg', contentType: 'image/svg+xml' },

  /* IDA-V11 — the plate scanner's OCR engine, vendored under web/vendor like
   * qrcodegen.js. Served from this origin so connect-src stays 'self' and the
   * engine can never reach a CDN for its model. Listed one path at a time,
   * like every other entry: no request input is concatenated into a path.
   * Nothing here is fetched until the visitor actually taps "Scanner la
   * plaque" — the homepage's first paint is unchanged. */
  '/assets/plate-scanner.js': { file: 'citizen/plate-scanner.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/tesseract/tesseract.min.js': { file: 'vendor/tesseract/tesseract.min.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/tesseract/worker.min.js': { file: 'vendor/tesseract/worker.min.js', contentType: 'application/javascript; charset=utf-8' },
  /* THE THREE CORES. The engine feature-detects and asks for ONE of these:
   * Chrome takes relaxedsimd, older engines plain simd, and the rest the
   * non-SIMD build. It imports the `.wasm.js` glue, which then fetches the
   * `.wasm` beside it — BOTH halves of a pair are required, and a missing
   * variant is a hard failure, not a fallback (found by the engine 404ing on
   * relaxedsimd during IDA-V11 browser QA). All three pairs are vendored so
   * the choice never has to leave this origin. A visitor downloads exactly
   * one pair, and only after tapping "Scanner la plaque".
   */
  '/assets/tesseract/tesseract-core-lstm.wasm.js': { file: 'vendor/tesseract/tesseract-core-lstm.wasm.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/tesseract/tesseract-core-lstm.wasm': { file: 'vendor/tesseract/tesseract-core-lstm.wasm', contentType: 'application/wasm' },
  '/assets/tesseract/tesseract-core-simd-lstm.wasm.js': { file: 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/tesseract/tesseract-core-simd-lstm.wasm': { file: 'vendor/tesseract/tesseract-core-simd-lstm.wasm', contentType: 'application/wasm' },
  '/assets/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js': { file: 'vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js', contentType: 'application/javascript; charset=utf-8' },
  '/assets/tesseract/tesseract-core-relaxedsimd-lstm.wasm': { file: 'vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm', contentType: 'application/wasm' },
  // Served as opaque bytes with NO Content-Encoding: tesseract.js fetches the
  // .gz and inflates it itself. Advertising gzip here would make the browser
  // decompress first, and the engine would then try to inflate plain data.
  '/assets/tesseract/eng.traineddata.gz': { file: 'vendor/tesseract/eng.traineddata.gz', contentType: 'application/octet-stream' },
  '/favicon.ico': { file: 'citizen/favicon.svg', contentType: 'image/svg+xml' }
};

//
// IDA-SHIP-2, 2026-08-27 — HEAD is answered exactly like GET here.
//
// These paths are the PUBLIC citizen surface: GET / already answers 200
// with the page to anyone. Before this change HEAD / fell past this map
// (method gate), past the /public/ route, into requireAuth() and answered
// 401 — so every HEAD-based caller (uptime monitors, link checkers,
// crawlers and preview fetchers, all of which HEAD before they GET) was
// told the public homepage needs credentials. That is a wrong answer, not
// a protection: the content behind it is already unauthenticated.
//
// This weakens no authentication. HEAD is admitted ONLY for paths already
// present in CITIZEN_ASSETS, only after the same A5-PLATE phase gate, and
// the response carries the same status and headers a GET would. Node
// suppresses the body for a HEAD request itself, so no byte of it is
// written. ADMIN_ASSETS above and the authenticated ROUTES table are
// deliberately NOT changed, and GET /public/passport/:ivid keeps its
// documented 405-with-Allow answer for every non-GET method.
function serveCitizenAsset(req, res, pathname) {
  var asset = CITIZEN_ASSETS[pathname];
  if (!asset || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  // PHASE GATE before anything else — PRIVATE phase means this surface
  // does not exist; fall through to the pre-existing dispatch unchanged.
  if (!loadPublicResolutionConfig().enabled) return false;
  fs.readFile(path.join(CITIZEN_WEB_ROOT, asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'citizen UI unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      /* IDA-V11, 2026-08-28 — 'wasm-unsafe-eval' ADDED TO script-src, HERE ONLY.
       *
       * THE DIAGNOSIS. The plate scanner runs Tesseract's OCR engine, which is
       * WebAssembly. Chrome refuses WebAssembly.instantiate() outright when a
       * CSP is present and script-src carries neither 'unsafe-eval' nor
       * 'wasm-unsafe-eval' — the page throws
       *     CompileError: WebAssembly.instantiate(): Refused to compile
       *     ... because 'wasm-unsafe-eval' is not an allowed source
       * script-src is therefore the exact and only directive that blocks it.
       *
       * WHY THIS TOKEN AND NOT 'unsafe-eval'. 'wasm-unsafe-eval' permits
       * compiling WebAssembly and NOTHING ELSE. It does not enable eval(),
       * new Function(), inline <script>, or javascript: URLs — all of which
       * 'unsafe-eval' would have re-opened. It is the narrowest token that
       * makes the feature possible.
       *
       * WHAT IT DOES NOT WIDEN. The source list is still 'self': no external
       * origin, no CDN, no inline script becomes loadable. Every OCR asset is
       * vendored under web/vendor/tesseract and served from this origin
       * through the map below, so connect-src stays 'self' and the engine
       * cannot fetch a model from anywhere else. The worker is a same-origin
       * URL (workerBlobURL:false in plate-scanner.js), so blob: is NOT added
       * to worker-src either. default-src, style-src, img-src, connect-src,
       * base-uri and frame-ancestors are byte-identical to before.
       *
       * WHERE IT DOES NOT APPLY. serveAdminAsset()'s CSP is untouched: the
       * operator console runs no WebAssembly and must not be able to. The
       * public passport route's CSP is untouched for the same reason. This
       * header covers the citizen surface alone. */
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  });
  return true;
}

// =====================================================
// IDA-4 Option C — GET /public/passport/:ivid
// A5 OPTION C, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md §A5)
//
// This is the repository's ONLY unauthenticated route. It exists to
// resolve an IVID QR code (reference/ivid.js) to a public-scope Digital
// Vehicle Passport (reference/passport-assembly.js) with NO account, NO
// citizen PII, and NO plate-based lookup anywhere on the path — the
// owner's binding constraints. Control chain, in the order implemented
// below (order is itself a security requirement — see the numbered
// comments inline):
//
//   1. Path/method gate — only GET /public/passport/:ivid exists. Any
//      other path under /public/ (including a hypothetical
//      /public/plate/...) is 404, identically to an unknown route
//      elsewhere in this file. A non-GET method on the matched path is
//      405, matching this file's existing convention.
//   2. FORMAT GATE BEFORE ANY DATABASE TOUCH — reference/ivid.js's
//      validate() runs first. A malformed IVID gets the SAME response
//      shape (404, {"error":"not found"}) as a well-formed-but-unknown
//      IVID, so a caller cannot distinguish "no such IVID" from
//      "malformed input" by response shape — and, more importantly, no
//      query ever reaches the database for malformed input.
//   3. Per-IP rate limiting — its own bucket
//      (reference/rate-limit.js's enforcePublicResolution()), independent
//      of every other bucket reference/rate-limit.js's enforce() computes
//      elsewhere (anon:*, ip:*, media_bytes:*). Configured in
//      config/idauto.example.json's public_resolution section.
//   4. No plate parameter is ever read. The query string is never
//      parsed by this handler — only pathname is used — so a ?plate=...
//      parameter is inert by construction, not filtered after the fact.
//   5. Lookup is by ivid only (WHERE ivid = $1), never by plate/internal
//      ref/anything else. scope is HARDCODED to 'public' in the
//      assemblePassport() call — never caller-influenced — and the SQL
//      fact query additionally filters access_scope = 'public' as
//      defense-in-depth, so even a future bug in assemblePassport's own
//      scope filter could not leak a non-public fact through this route.
//   6. qr.payload === the requested ivid is asserted before the
//      response is sent (assemblePassport already enforces this
//      internally and throws otherwise; this route asserts it again at
//      its own boundary, matching the codebase's "structural, not just
//      hoped-for" style — see passport-assembly.js's own qr comment).
//   7. The existing CSP/security-header set (identical to
//      serveAdminAsset()'s) is applied to the response.
// =====================================================

// IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH lets a test point this route at a
// small, fast-cycling config file (short window, low limit) instead of
// the real config/idauto.example.json, so burst/recovery behaviour can
// be exercised in real (not simulated) time without a slow test run —
// see tests/ida4-option-c-test.js. Unset in every real deployment, which
// falls back to the real config file exactly as before.
var PUBLIC_RESOLUTION_CONFIG_PATH = process.env.IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH ||
  path.join(__dirname, '..', 'config', 'idauto.example.json');
var _publicResolutionConfigCache = null;

// Reads config/idauto.example.json's public_resolution section once per
// process (cached, same pattern as reference/plate-validator.js's
// loadFormats()). Falls back to safe defaults if the section (or its
// rate_limit sub-section) is absent so this route never silently runs
// unlimited OR silently disabled — `enabled` defaults to true absent an
// explicit `false`, matching every other config value's "safe default"
// posture in this function.
//
// F3 (Opus review, 2026-08-19): `enabled` was previously read by
// nothing — a documented kill-switch with no wiring. Now consulted by
// handlePublicPassportRoute() before any database touch (see there).
function loadPublicResolutionConfig() {
  if (_publicResolutionConfigCache) return _publicResolutionConfigCache;
  var section = {};
  var enabled = true;
  try {
    var raw = fs.readFileSync(PUBLIC_RESOLUTION_CONFIG_PATH, 'utf8');
    var config = JSON.parse(raw);
    section = (config.public_resolution && config.public_resolution.rate_limit) || {};
    if (config.public_resolution && config.public_resolution.enabled === false) enabled = false;
  } catch (_) { /* fall through to defaults below */ }
  _publicResolutionConfigCache = {
    enabled: enabled,
    limit: typeof section.limit === 'number' && section.limit > 0 ? section.limit : 30,
    window_seconds: typeof section.window_seconds === 'number' && section.window_seconds > 0 ? section.window_seconds : 60
  };
  return _publicResolutionConfigCache;
}

// A5 OPTION C, 2026-08-19 (IDA-3D structural-guard note): the actual
// counter mechanics — the key-hashing helper, the atomic upsert against
// the shared rate-limit counter table, window flooring — live in
// reference/rate-limit.js's enforcePublicResolution(), not here. api.js's
// job is config-file reading (this file's own concern, including its
// IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH override) and extracting the
// caller's IP; it CALLS the rate-limiting module, it does not host any
// counter-selection or key-derivation logic of its own. That is
// precisely what tests/ida-3d-private-ingest-route-test.js's structural
// guard checks api.js's source for the absence of — this route stays
// genuinely rate-limited without api.js failing that check.
//
// IDA-SHIP-2, 2026-08-27 — TRUSTED-PROXY CLIENT IP.
//
// The process binds 127.0.0.1 only (see the listen() call at the bottom of
// this file), so in production EVERY connection arrives from nginx and
// req.socket.remoteAddress is always the loopback address. Hashing it
// alone put every visitor on the planet into ONE public_resolution bucket:
// the configured limit stopped being "30 requests per client per minute"
// and became "30 requests for the whole site per minute", which any single
// caller could exhaust for everybody. Observed in production before this
// fix — the shared counter table held exactly one bucket key, the one
// derived from 127.0.0.1, and it had already been driven past the limit.
//
// The vhost sets both X-Real-IP ($remote_addr) and X-Forwarded-For
// ($proxy_add_x_forwarded_for) with proxy_set_header, which REPLACES any
// value the caller sent for X-Real-IP and APPENDS nginx's own view to
// X-Forwarded-For. Two consequences this code depends on:
//
//   1. Those headers are trustworthy ONLY when the immediate peer is one of
//      our own proxies. A direct caller could otherwise pick its own
//      rate-limit bucket by sending a header, i.e. bypass the limit
//      entirely. So the headers are read only for a loopback peer, and a
//      non-loopback peer is keyed on its socket address, header or not.
//   2. Within X-Forwarded-For, the RIGHTMOST entry is the one nginx
//      appended; anything to its left was supplied by the caller and is
//      not evidence of anything. The leftmost entry — the usual "real
//      client" convention behind a trusted chain — is exactly the value an
//      attacker controls here, so it is never used.
//
// Addresses are normalised (IPv6 zone index stripped, IPv4-mapped IPv6
// unwrapped) so one caller cannot occupy two buckets by arriving as both
// '1.2.3.4' and '::ffff:1.2.3.4'.
//
// This is IP EXTRACTION only. No counter, bucket or window logic lives
// here — that stays in reference/rate-limit.js, per the structural guard
// in tests/ida-3d-private-ingest-route-test.js and the note above.
// The trusted peer set is expressed as "the peer is loopback", not as a
// list of literal addresses: the whole 127.0.0.0/8 block is loopback, and a
// socket bound to loopback (this process binds nothing else) cannot receive
// a connection carrying a loopback source address from off this host. So
// "peer is loopback" is exactly "peer is our own nginx". Written as a
// predicate rather than a quoted address so this file still contains
// exactly one bind-host literal — the guards in
// tests/ida-3d-private-ingest-route-test.js and
// tests/ida-3e-review-queue-test.js count that literal to prove nobody has
// moved the listener off loopback or added a second one.
function isLoopbackPeer(ip) {
  return ip === '::1' || /^127\./.test(ip);
}

function normalizeIp(value) {
  var ip = String(value == null ? '' : value).trim();
  var zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  ip = ip.toLowerCase();
  if (ip.indexOf('::ffff:') === 0 && /^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ip = ip.slice(7);
  // Anything that is not a bare IPv4 or IPv6 literal is a header a caller
  // made up (or a duplicate header Node joined with a comma) — reject it
  // rather than let it become a bucket of its own.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || /^[0-9a-f:]{2,45}$/.test(ip)) return ip;
  return '';
}

function clientIp(req) {
  var peer = normalizeIp(req.socket && req.socket.remoteAddress);
  if (!isLoopbackPeer(peer)) return peer;
  var headers = req.headers || {};
  var realIp = normalizeIp(headers['x-real-ip']);
  if (realIp) return realIp;
  var forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    var parts = forwarded.split(',');
    var appended = normalizeIp(parts[parts.length - 1]);
    if (appended) return appended;
  }
  return peer;
}

function clientIpHash(req) {
  return crypto.createHash('sha256').update(clientIp(req)).digest('hex');
}

// F4 (Opus review, 2026-08-19), RULED — A5-PLATE revised decision,
// 2026-08-19: PRIVATE permitted / PUBLIC hidden / resolution IVID-only.
// The public route's fact-key deny-list — 'vin' and 'plate_number' —
// now lives in reference/public-surface-policy.js, the one audited
// artifact the owner's ruling requires ("public exposure must be
// controlled by an explicit public-surface policy, not by manual code
// edits"). It is deliberately NOT a local constant here and NOT
// config-toggleable — see that module's own header for the full ruling
// text and why. writes.js:245/284 can still set or default a fact's
// access_scope to 'public' regardless of its fact_key; this deny-list
// remains the independent second layer that catches that regardless of
// the SQL-level access_scope filter.
//
// Maps one idauto_vehicle_facts row (already filtered to access_scope =
// 'public' by the caller's SQL) into the protocol-shaped fact object
// reference/passport-assembly.js expects (provenance.access_scope, per
// its own header comment) — a pure reshape, no additional filtering
// decision made here.
function factRowToPassportFact(row) {
  return {
    id: 'fact-' + row.id,
    fact_key: row.fact_key,
    fact_value: row.fact_value,
    fact_value_normalized: row.fact_value_normalized,
    confidence_score: row.confidence_score,
    verification_status: row.verification_status,
    provenance: { access_scope: row.access_scope }
  };
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : value;
}

// Shared by BOTH passport routes (public and private, P2/Opus audit,
// 2026-08-19) — the raw idauto_vehicles row must never reach either
// response: it carries internal_ref (the internal admin identifier the
// IVID exists specifically to avoid exposing) and non-schema columns
// (seats, gross_weight_kg, engine_cc, first_seen_at, last_seen_at,
// fiche_status as a raw key) that protocol/schemas/vehicle.schema.json
// (additionalProperties:false) does not allow. Extracted into one
// function (rather than duplicated per route, as the first cut of the
// private route mistakenly did) so both routes stay protocol-conformant
// by construction, not by two independently-maintained copies agreeing
// by luck.
//
// status: idauto_vehicles.fiche_status's full allowed set (chk_vehicle_status,
// database/schema.sql: initial|pending_review|verified|conflict|merged|archived)
// is an EXACT SUBSET of the protocol's status enum (which adds only
// 'closed', unused by any DB row today) — so this is a direct, documented
// passthrough of an already-public lifecycle field, not an invented
// mapping. 'closed' cannot occur since no DB constraint permits it yet.
//
// current_plate_ref is always omitted — optional in the schema, and
// never appropriate on the public route (A5); on the private route,
// plate data is carried in the passport's separate `plates` array
// (buildProtocolConformantPlate() below), not duplicated onto the
// vehicle object. merged_into is omitted because idauto_vehicles has no
// such column (a merge is not yet implemented).
function buildProtocolConformantVehicle(vehicleRow) {
  return {
    protocol_version: '0.1.0-draft',
    ivid: vehicleRow.ivid,
    status: vehicleRow.fiche_status,
    created_at: toIsoString(vehicleRow.created_at),
    observation_count: vehicleRow.observation_count,
    summary: {
      make: vehicleRow.make,
      model: vehicleRow.model,
      variant: vehicleRow.variant,
      year: vehicleRow.year,
      body_type: vehicleRow.body_type,
      fuel_type: vehicleRow.fuel_type,
      colour: vehicleRow.colour,
      category_code: vehicleRow.category_code
    }
  };
}

// Private-route only (P2, Opus review, 2026-08-19) — the raw idauto_plates
// row is not protocol/schemas/plate.schema.json-conformant either
// (additionalProperties:false; the schema has no `status` or
// `governorate_name` property at all, and calls the closed-interval date
// `valid_to`, not this schema's `valid_until`). Maps:
//   - id: schema wants a string; the DB's numeric id is stringified.
//   - subject_ivid: the resolved vehicle's ivid (schema-required; every
//     plate belongs to exactly the vehicle this route already resolved).
//   - plate_number, plate_raw, format_code: direct passthrough — same
//     names in both the DB and the schema.
//   - region_code: the schema's own description — "Coarse region only.
//     Never a precise location" — is exactly what a Tunisian governorate
//     is, so the plate's governorate CODE (idauto_governorates.code,
//     e.g. "01"), not its French name, is mapped here. This is an
//     interpretive choice (the schema does not name "governorate"
//     anywhere) worth a reviewer's eyes; `governorate_name` itself has
//     no schema field to map to and is dropped.
//   - valid_from: schema-required; DB column is nullable (no plate
//     necessarily has one recorded), so this falls back to the plate
//     row's own created_at when valid_from is NULL, rather than emit a
//     required field as null.
//   - valid_to: DB's valid_until, renamed; null while the interval is
//     open, exactly matching the schema's own description of null here.
//   - `status` has no schema field at all and is dropped entirely — it
//     is not "mapped," per the review finding's own instruction to
//     omit fields with no schema equivalent.
function buildProtocolConformantPlate(plateRow, subjectIvid) {
  return {
    protocol_version: '0.1.0-draft',
    id: String(plateRow.id),
    subject_ivid: subjectIvid,
    plate_number: plateRow.plate_number,
    plate_raw: plateRow.plate_raw || null,
    format_code: plateRow.format_code || null,
    region_code: plateRow.governorate_code || null,
    valid_from: toIsoString(plateRow.valid_from || plateRow.created_at),
    valid_to: plateRow.valid_until ? toIsoString(plateRow.valid_until) : null
  };
}

//
// IDA-V2, 2026-08-27 — PUBLIC PLATE RESOLUTION. Owner decision.
//
// GET /public/plates/:plate → { plate_number, ivid }
//
// This REPLACES the A5-PLATE rule that a plate must never resolve on the
// public surface. The owner has decided that on idauto.tn a Tunisian plate
// alone resolves to the vehicle's IVID, and from there to the public
// passport. That decision is recorded in the commit and PR for this change.
//
// What this route deliberately does NOT do, so the privacy model the owner
// kept is not widened by accident:
//
//   - It returns TWO fields: the normalised plate and the IVID. Nothing
//     else. Not internal_ref, not vehicle_id, not the governorate, not the
//     plate status, not valid_from/valid_until — the authenticated
//     GET /api/plates/:plate still returns those and still requires a
//     credential. The IVID is the public resolution credential and was
//     never a secret (it is printed under the QR on the vehicle).
//   - It exposes no vehicle attributes at all. The caller takes the IVID to
//     GET /public/passport/:ivid, which is unchanged and still applies the
//     access_scope filter AND the reviewed deny-list — so VIN, plate facts,
//     PII and every mis-scoped fact stay excluded exactly as before.
//   - It shares the public_resolution limiter bucket with the passport
//     route, so opening plate lookup does not open a second, unmetered way
//     to enumerate the database.
//   - It answers the SAME 404 for a well-formed unknown plate as for a
//     malformed one, and stays behind the same phase gate: with
//     public_resolution.enabled false, this route does not exist.
async function handlePublicPlateRoute(req, res, m) {
  // Phase gate before anything, including the method gate — identical
  // discipline to the passport route: when disabled the route must be
  // indistinguishable from an unknown path.
  if (!loadPublicResolutionConfig().enabled) return notFound(res);

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  // FORMAT GATE BEFORE ANY DATABASE TOUCH. A decode failure is a format
  // failure, same 404, still zero DB touch — as on the passport route.
  var candidate;
  try {
    candidate = decodeURIComponent(m[1]);
  } catch (_) {
    return notFound(res);
  }
  // IDA-V12 — the spelling is canonicalised first ("230 TU 8646",
  // "230TU8646", "230 تونس 8646", "8646TU230" all mean "230 TUN 8646"), then
  // the catalogue decides validity exactly as before. Still a format gate
  // before any database touch; still the same 404 for unparseable input.
  var parsedPlate = plateNormalizer.parsePlate(candidate);
  var normalized = parsedPlate.ok ? parsedPlate.canonical : plateValidator.normalizePlate(candidate);
  if (!normalized || !plateValidator.isValidPlate(normalized)) return notFound(res);

  // Same bucket as the passport route: one public resolution budget per
  // client, whichever door they come through.
  var limitResult = await rateLimit.enforcePublicResolution(db, clientIpHash(req), loadPublicResolutionConfig());
  if (!limitResult.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds(limitResult.retry_at)) });
    return res.end(JSON.stringify({ error: 'rate limit exceeded' }));
  }

  // Two columns. The join reads idauto_vehicles for `ivid` alone — no other
  // vehicle column is selected here, so none can leak through this route
  // even if the response shape were later widened by mistake.
  // IDA-V8 — a plate attached to a record that was later merged must resolve
  // to the CANONICAL vehicle, so plate → IVID → passport lands on the same
  // vehicle as the QR does. The recursive walk is bounded by the same depth
  // the rest of the resolution uses.
  var result = await db.query(
    'WITH RECURSIVE chain(id, ivid, merged_into_id, depth) AS (' +
    '  SELECT v.id, v.ivid, v.merged_into_id, 0 FROM idauto_plates p ' +
    '  JOIN idauto_vehicles v ON v.id = p.vehicle_id WHERE p.plate_number = $1' +
    '  UNION ALL' +
    '  SELECT v.id, v.ivid, v.merged_into_id, c.depth + 1 FROM chain c ' +
    '  JOIN idauto_vehicles v ON v.id = c.merged_into_id WHERE c.depth < 16' +
    ') SELECT $1::text AS plate_number, ivid FROM chain WHERE merged_into_id IS NULL LIMIT 1',
    [normalized]
  );
  if (result.rows.length === 0 || !result.rows[0].ivid) {
    await recordPlateLookupMiss(req, normalized);
    return notFound(res);
  }

  sendJson(res, 200, { plate_number: result.rows[0].plate_number, ivid: result.rows[0].ivid });
}

//
// IDA-V3, 2026-08-27 — SEARCH HISTORY FOR AN UNREGISTERED VEHICLE.
//
// Owner rule: a plate that resolves to nothing must not vanish as a bare
// error. The search itself stays traceable, so that a vehicle registered
// later can be tied back to the moment someone first looked for it, and so
// a Fixpert-side lookup has a record on this side too.
//
// WHERE IT IS WRITTEN. idauto_audit_log, which already carries exactly the
// columns this needs — event_time, event_type, actor_type, target_ref,
// ip_hash. No second store, no schema change, no new table.
//
// WHY NOT withAudit(). writes.js's withAudit() refuses to write at all
// without an attributable identity, deliberately: "there is no code path
// that writes data without an attributable audit actor". That invariant is
// about DATA. This is not data — it is an audit observation about an
// anonymous request, and the audit table models an anonymous actor as a
// first-class case (actor_type is a column; actor_ref is nullable). Writing
// it directly keeps the invariant intact rather than bending it.
//
// BEST EFFORT, DELIBERATELY. This runs on an unauthenticated read path. If the
// insert fails, the visitor still gets their answer: failing their lookup
// because a log row could not be written would turn the audit trail into an
// availability weapon anyone could aim at the public surface. The failure is
// logged instead, so a silent gap is still visible to the operator.
//
// NO PII. The plate is the search subject and is recorded as such. The
// caller is recorded only as the same salted client hash the limiter uses —
// never a raw IP, never a header, never a cookie.
async function recordPlateLookupMiss(req, plateNumber) {
  try {
    var owner = resolveOwnerSession(req);
    // The SQL lives in writes.js, which owns every mutation in this codebase;
    // api.js carries none, and tests/ida-2c enforces that by scanning this
    // file for write verbs. See that function's header for why it is not
    // routed through withAudit().
    await writes.recordAnonymousAuditEvent({
      event_type: 'public_plate_lookup_miss',
      actor_type: owner ? 'admin' : 'anonymous',
      actor_ref: owner || null,
      target_type: 'plate',
      target_ref: plateNumber,
      change_summary: 'vehicle not registered',
      ip_hash: clientIpHash(req)
    });
  } catch (err) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      event: 'audit_write_failed',
      what: 'public_plate_lookup_miss',
      reason: err && err.code ? String(err.code) : 'unknown'
    }));
  }
}

async function handlePublicPassportRoute(req, res, pathname) {
  // IDA-V2: /public/plates/:plate is the second shape under /public/.
  var plateMatch = /^\/public\/plates\/([^/]+)$/.exec(pathname);
  if (plateMatch) return handlePublicPlateRoute(req, res, plateMatch);

  // 1. Path gate: only exactly this shape exists under /public/. Any
  // other path (e.g. /public/plate/xyz, /public/, /public/passport/)
  // is 404 regardless of method — matching this file's existing
  // path-then-method dispatch order.
  var m = /^\/public\/passport\/([^/]+)$/.exec(pathname);
  if (!m) return notFound(res);

  // F3 KILL-SWITCH (Opus review, 2026-08-19) — checked before the method
  // gate and BEFORE any database touch, deliberately: when
  // config/idauto.example.json's public_resolution.enabled is false,
  // this route must behave as if it does not exist at all — the
  // identical 404 shape for every method, not just GET, and with zero
  // query difference from a plain unknown-route 404.
  if (!loadPublicResolutionConfig().enabled) {
    return notFound(res);
  }

  // 1. Method gate.
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  // 2. FORMAT GATE BEFORE ANY DATABASE TOUCH. A decode failure is
  // treated as a format failure too (same 404 shape, still zero DB
  // touch) rather than surfaced as a distinct 400 — this route's only
  // job is IVID resolution, and an undecodable path segment cannot be a
  // well-formed IVID either way.
  var candidate;
  try {
    candidate = decodeURIComponent(m[1]);
  } catch (_) {
    return notFound(res);
  }
  if (!ivid.validate(candidate).ok) {
    return notFound(res);
  }

  // 3. Per-IP rate limit, this route's own bucket.
  var limitResult = await rateLimit.enforcePublicResolution(db, clientIpHash(req), loadPublicResolutionConfig());
  if (!limitResult.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds(limitResult.retry_at)) });
    return res.end(JSON.stringify({ error: 'rate limit exceeded' }));
  }

  // 5. Lookup by ivid only — never by plate, internal_ref, or any other
  // identifier. No plate parameter exists to read in the first place
  // (the query string is never parsed by this handler). internal_ref,
  // seats, gross_weight_kg, engine_cc and fiche_status's raw column name
  // are deliberately NOT selected here at all — see the protocol-shaping
  // block below for what replaces fiche_status and why the others are
  // never public.
  var vehicleResult = await db.query(
    'SELECT id, ivid, make, model, variant, year, body_type, fuel_type, colour, category_code, ' +
    'fiche_status, created_at, observation_count, merged_into_id ' +
    'FROM idauto_vehicles WHERE ivid = $1',
    [candidate]
  );
  if (vehicleResult.rows.length === 0) return notFound(res);
  var vehicleRow = vehicleResult.rows[0];

  // IDA-V8 — an IVID printed on a QR sticker before a merge must keep opening
  // a passport. Follow the chain to the canonical record and serve THAT, so a
  // sticker never dies because two records were later found to be one vehicle.
  // Bounded for the same reason resolveCanonical() is bounded: a cycle must
  // fail as a 404 here rather than hang an anonymous request.
  var hops = 0;
  while (vehicleRow.merged_into_id) {
    if (++hops > 16) return notFound(res);
    var nextRow = await db.query(
      'SELECT id, ivid, make, model, variant, year, body_type, fuel_type, colour, category_code, ' +
      'fiche_status, created_at, observation_count, merged_into_id ' +
      'FROM idauto_vehicles WHERE id = $1',
      [vehicleRow.merged_into_id]
    );
    if (nextRow.rows.length === 0) return notFound(res);
    vehicleRow = nextRow.rows[0];
  }
  var canonicalIvid = vehicleRow.ivid;

  // Defense-in-depth: access_scope = 'public' filtered in SQL, in
  // addition to assemblePassport()'s own scope filter below. PLUS the
  // reviewed deny-list from reference/public-surface-policy.js (A5-PLATE
  // ruling) — a fact_key-level exclusion independent of the stored
  // access_scope, so a mis-scoped fact (e.g. a vin fact accidentally
  // stored 'public') still never reaches this route.
  // R2 (Opus review, 2026-08-19): guard against an empty deny-list. An
  // empty `NOT IN ()` is a Postgres SYNTAX ERROR, not a no-op — the whole
  // query would fail (closed: no facts leak) but OPAQUELY (a 500
  // instead of an intentional, understood "no deny-list configured"
  // outcome). The policy module's deny-list is non-empty today and is
  // not expected to ever be emptied, but this keeps that assumption from
  // becoming a silent landmine if it ever is.
  var denyList = publicSurfacePolicy.deniedFactKeys();
  var denyClause = denyList.length
    ? 'AND fact_key NOT IN (' + denyList.map(function (_, i) { return '$' + (i + 3); }).join(', ') + ') '
    : '';
  var factsResult = await db.query(
    'SELECT id, fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, access_scope ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) AND access_scope = $2 ' +
    denyClause + 'AND is_active = TRUE ' +
    'ORDER BY fact_key',
    [canonicalIvid, 'public'].concat(denyList)
  );

  // Chef Phase-1 audit fix (follow-up to e220213), now shared with the
  // private route too (P2, Opus review) via buildProtocolConformantVehicle()
  // above — the raw idauto_vehicles row must never reach a public
  // response; see that function's own header for the full mapping.
  var publicVehicle = buildProtocolConformantVehicle(vehicleRow);

  // IDA-V6, 2026-08-27 — OWNER DECISION: the registration plate is public
  // data. The passport shows it however it was reached — by plate, by IVID,
  // or by scanning the QR. This replaces the A5-PLATE rule that withheld
  // plate records from the anonymous surface; see
  // reference/public-surface-policy.js for the withdrawn constant.
  //
  // The protocol layer already agreed: passport-assembly.js treats a plate
  // with no access_scope as public-visible, citing PRIVACY_ARCHITECTURE §3's
  // "Public" list. Only this route withheld it.
  //
  // WHAT IS SELECTED, AND WHAT IS NOT. plate_number and format_code are what
  // render a plate. The governorate is deliberately NOT selected: it is a
  // coarse location, nobody asked for it on the public surface, and the
  // narrowest query is the one that cannot leak what it never read. status
  // and the validity dates stay behind the authenticated route as before.
  var platesResult = await db.query(
    'SELECT p.id, p.plate_number, p.format_code, p.created_at ' +
    'FROM idauto_plates p WHERE p.vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) ' +
    "AND p.status = 'active' ORDER BY p.id",
    [canonicalIvid]
  );

  var publicPlates = platesResult.rows.map(function (row) {
    return {
      protocol_version: '0.1.0-draft',
      id: String(row.id),
      subject_ivid: vehicleRow.ivid,
      plate_number: row.plate_number,
      format_code: row.format_code || null,
      valid_from: toIsoString(row.created_at)
    };
  });

  var passport = passportAssembly.assemblePassport({
    vehicle: publicVehicle,
    plates: publicPlates,
    facts: factsResult.rows.map(factRowToPassportFact),
    scope: 'public', // HARDCODED — never caller-influenced.
    now: new Date()
  });

  // 6. Structural assertion, not just hoped for.
  //
  // IDA-V8: compared against the CANONICAL ivid, not the requested one. When
  // the requested ivid belongs to a record that was merged, the passport
  // served is the canonical vehicle's, so requiring equality with the request
  // would make every pre-merge QR sticker a 500. The guarantee itself is
  // unchanged and is what it always meant: the QR must encode the ivid of the
  // vehicle THIS passport describes — never a different vehicle's, never a
  // plate, never a token. When nothing was merged, canonicalIvid IS candidate
  // and this is the identical check it was before.
  if (passport.qr.payload !== canonicalIvid || passport.qr.payload !== passport.vehicle.ivid) {
    throw new Error('handlePublicPassportRoute: internal invariant violated — qr.payload must equal the ivid of the vehicle served');
  }

  // 7. Existing CSP/security header set, identical to serveAdminAsset().
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(JSON.stringify(passport));
}

// GET /api/vehicles/:ref  —  :ref is an IVID **or** an internal_ref.
// Public/professional-safe vehicle fields only. No owner fields exist in
// the schema at all (idauto_vehicles has none, by design — see AD-2).
//
// IDA-V10, 2026-08-28 — BOTH IDENTIFIERS, because the contract says so.
// docs/ID_AUTO_INTEGRATION.md §4 tells Fixpert "Store the IVID as your
// primary reference" and §5 documents ":ref = ivid or internal_ref". This
// route matched internal_ref ONLY, so an integration built exactly as
// documented got 404 on its most-used read. The audit of 2026-08-28 found
// it live. Neither identifier is ever reused, so matching both cannot
// become ambiguous — the same reasoning writes.js's findVehicleByAnyRef()
// already relies on for /resolve, /merge and /split.
//
// ivid is returned so a caller that looked the vehicle up by internal_ref
// learns its public identity without a second call. It is public data —
// it is printed under the QR — so this widens no surface.
async function getVehicle(res, internalRef) {
  var result = await db.query(
    'SELECT internal_ref, ivid, make, model, variant, year, body_type, fuel_type, colour, seats, ' +
    'gross_weight_kg, engine_cc, category_code, fiche_status, first_seen_at, last_seen_at, observation_count ' +
    'FROM idauto_vehicles WHERE internal_ref = $1 OR ivid = $1',
    [internalRef]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

/* =========================================================================
 * IDA-V10 — GET /api/search/vehicles — REAL VEHICLE SEARCH
 * =========================================================================
 * Owner requirement, 2026-08-28. Until now the only "search" IDauto offered
 * was the public exact-plate route. An atelier that holds a VIN, an internal
 * reference, or nothing but "the blue Hyundai from 2015" had no way in.
 *
 * SUPPORTED CRITERIA — exactly the set the ruling names:
 *   plate         exact, normalized through the same validator the rest of
 *                 the system uses, so "217tun424" and "217 TUN 424" agree
 *   vin           exact — DEDICATED SCOPE + MANDATORY AUDIT, see below
 *   ivid          exact (the Vehicle ID)
 *   internal_ref  exact
 *   make / model  exact, case-insensitive
 *   year          exact
 * make, model and year combine with each other. An exact-identifier
 * criterion (plate, vin, ivid, internal_ref) identifies ONE vehicle and is
 * answered on its own.
 *
 * AT LEAST ONE CRITERION IS REQUIRED. A parameterless search would be a
 * "dump every vehicle" route wearing a search route's name.
 *
 * MERGES ARE FOLLOWED. Every hit is resolved to its canonical record before
 * it is returned, so a search that lands on a merged record answers with the
 * identity that record now belongs to — the same guarantee /resolve gives,
 * and the reason a Fixpert reference minted before a merge keeps working.
 * The record actually matched is reported alongside it in matched_ref, so a
 * caller can see that its stored reference is now an alias.
 *
 * WHAT SEARCH NEVER RETURNS. No VIN, in any response, including the response
 * to a VIN search — a caller that searched by VIN already has it, and echoing
 * it would put a private value in a result body and in every proxy log along
 * the way. No owner fields (none exist in the schema). No facts, no
 * observations, no atelier detail: those are per-organisation and reached
 * through their own scoped routes. This route answers "which vehicle", which
 * under the C3 ruling is IDauto's global identity layer and is the same
 * answer for every caller.
 *
 * C3 — IDENTITY IS GLOBAL, DETAIL IS COMPARTMENTED. Search deliberately does
 * NOT filter by organisation. A vehicle is not the property of the atelier
 * that first saw it; two ateliers searching the same plate must find the same
 * vehicle, or they would create duplicate identities for one car, which is
 * precisely the condition merge exists to clean up. Compartmentalisation is
 * enforced where the compartmented data lives (observations, provenance) —
 * ida-v9-org-auth-test.js §6 is the test that holds that line.
 *
 * ENUMERATION. Broad criteria (make/model/year) are capped and never paged
 * beyond the cap, so this cannot be walked to reconstruct the register. Exact
 * identifier lookups are naturally single-row. The existing per-credential
 * rate limiter applies to this route like any other.
 */
var SEARCH_RESULT_CAP = 50;

// The columns a search result may ever carry. Written as one list so a future
// column added to idauto_vehicles is NOT silently exposed by search — it has
// to be added here deliberately. `vin` is not a column on this table at all
// (it is a scoped fact), so it cannot appear here by accident either.
var SEARCH_RESULT_COLUMNS =
  'v.ivid, v.internal_ref, v.make, v.model, v.variant, v.year, v.body_type, ' +
  'v.fuel_type, v.colour, v.fiche_status, v.merged_into_id';

// Resolves one matched row to the canonical record it belongs to, following
// the IDA-V8 merge pointer. Bounded: a cycle cannot be created (the schema
// forbids self-merge and mergeVehicle() refuses a cycle), but this walks a
// bounded number of hops regardless rather than trusting that from a read
// path — a read must terminate even against unexpected data.
async function resolveSearchHit(row) {
  var hops = 0;
  var current = row;
  while (current.merged_into_id && hops < 10) {
    var next = await db.query(
      'SELECT ' + SEARCH_RESULT_COLUMNS + ' FROM idauto_vehicles v WHERE v.id = $1',
      [current.merged_into_id]
    );
    if (next.rows.length === 0) break;
    current = next.rows[0];
    hops++;
  }
  return {
    ivid: current.ivid,
    internal_ref: current.internal_ref,
    make: current.make,
    model: current.model,
    variant: current.variant,
    year: current.year,
    body_type: current.body_type,
    fuel_type: current.fuel_type,
    colour: current.colour,
    fiche_status: current.fiche_status,
    // Present only when the search landed on a record that has since been
    // merged. A caller storing matched_ref is holding an alias and is told so
    // here without having to call /resolve to find out.
    matched_ref: hops > 0 ? row.ivid : undefined,
    is_alias: hops > 0 ? true : undefined
  };
}

async function searchVehicles(req, res, parsed) {
  var q = parsed.query || {};
  function one(name) {
    var v = q[name];
    if (Array.isArray(v)) v = v[0];           // ?make=a&make=b — take the first, never concatenate
    if (typeof v !== 'string') return null;
    v = v.trim();
    return v.length ? v.slice(0, 64) : null;  // bounded: no unbounded string reaches SQL
  }

  var plate = one('plate');
  var vin = one('vin');
  var ivid = one('ivid');
  var internalRef = one('internal_ref');
  var make = one('make');
  var model = one('model');
  var year = one('year');

  if (!plate && !vin && !ivid && !internalRef && !make && !model && !year) {
    return sendJson(res, 400, {
      error: 'at least one search criterion is required',
      accepted: ['plate', 'vin', 'ivid', 'internal_ref', 'make', 'model', 'year']
    });
  }

  if (year !== null && !/^\d{4}$/.test(year)) {
    return sendJson(res, 400, { error: 'year must be a four-digit year' });
  }

  /* ---- VIN: the dedicated scope, checked BEFORE anything is disclosed ----
   * The ruling is "sans scope = refus". requireScope() answers 403 and names
   * the missing scope. This runs before any query, so a caller without the
   * scope learns nothing at all — not even whether the VIN exists.
   *
   * An ADMIN principal holds '*' and passes, exactly as it does on every
   * other route; the audit below still records the search, so an admin VIN
   * search is audited too. "Aucune recherche VIN anonyme" is already
   * guaranteed upstream: this whole route is behind requireAuth(). */
  if (vin) {
    if (!requireScope(req, res, 'vin:search')) return;

    var vinUpper = vin.toUpperCase();
    var vinRows = await db.query(
      'SELECT ' + SEARCH_RESULT_COLUMNS + ' FROM idauto_vehicles v ' +
      'JOIN idauto_vehicle_facts f ON f.vehicle_id = v.id ' +
      "WHERE f.fact_key = 'vin' AND f.is_active = TRUE " +
      'AND (f.fact_value_normalized = $1 OR UPPER(TRIM(f.fact_value)) = $2) ' +
      'LIMIT $3',
      [vinUpper.toLowerCase(), vinUpper, SEARCH_RESULT_CAP]
    );

    var vinResults = [];
    for (var vi = 0; vi < vinRows.rows.length; vi++) {
      vinResults.push(await resolveSearchHit(vinRows.rows[vi]));
    }

    /* MANDATORY, AND BEFORE THE ANSWER. If the audit row cannot be written
     * the caller does not learn the result: an unaudited VIN search must not
     * happen, so the failure has to land before disclosure, not after it.
     * This throws to the dispatcher's catch, which answers a safe 500. */
    await writes.recordVinSearchAudit(
      req.principal, req.mythosIdentity, vinUpper,
      vinResults.length ? vinResults[0].ivid : null
    );

    return sendJson(res, 200, { criterion: 'vin', count: vinResults.length, results: vinResults });
  }

  /* ---- exact identifier criteria — one vehicle each ---- */
  if (ivid || internalRef) {
    var ref = ivid || internalRef;
    var refRows = await db.query(
      'SELECT ' + SEARCH_RESULT_COLUMNS + ' FROM idauto_vehicles v WHERE v.ivid = $1 OR v.internal_ref = $1',
      [ref]
    );
    var refResults = [];
    for (var ri = 0; ri < refRows.rows.length; ri++) refResults.push(await resolveSearchHit(refRows.rows[ri]));
    return sendJson(res, 200, {
      criterion: ivid ? 'ivid' : 'internal_ref',
      count: refResults.length, results: refResults
    });
  }

  if (plate) {
    // Normalized through the shared validator, so search agrees with the
    // public plate route and with what was stored, rather than re-inventing
    // a second notion of what a plate string means.
    // IDA-V12 — accept every spelling the normaliser knows (TU, تونس, RS,
    // Arabic digits, the reversed search key) before the stored-form compare.
    var parsedSearchPlate = plateNormalizer.parsePlate(plate);
    var normalized = parsedSearchPlate.ok ? parsedSearchPlate.canonical : (plateValidator.normalizePlate(plate) || plate);
    // Exact first, then the space-stripped comparison. normalizePlate() keeps
    // spaces on purpose (the spaced form is canonical and several formats
    // match on an optional separator), and the PUBLIC RESOLVER matches it
    // strictly — a resolver should be strict. A SEARCH should not: an atelier
    // typing "188tun4523" wants the same car as "188 TUN 4523", and refusing
    // over a space would send it off to create a duplicate identity, which is
    // the exact condition merge exists to repair. Both sides of the OR are
    // indexed (idx_idauto_plates_nospace, IDA-V10), so this stays an index
    // scan. No stored value and no other route changes.
    var plateRows = await db.query(
      'SELECT ' + SEARCH_RESULT_COLUMNS + ' FROM idauto_vehicles v ' +
      'JOIN idauto_plates p ON p.vehicle_id = v.id ' +
      "WHERE p.plate_number = $1 OR REPLACE(p.plate_number, ' ', '') = $2 LIMIT $3",
      [normalized, normalized.replace(/ /g, ''), SEARCH_RESULT_CAP]
    );
    var plateResults = [];
    for (var pi = 0; pi < plateRows.rows.length; pi++) plateResults.push(await resolveSearchHit(plateRows.rows[pi]));
    return sendJson(res, 200, { criterion: 'plate', count: plateResults.length, results: plateResults });
  }

  /* ---- descriptive criteria — make / model / year, combinable ---- */
  var where = [];
  var params = [];
  if (make)  { params.push(make);  where.push('UPPER(v.make) = UPPER($' + params.length + ')'); }
  if (model) { params.push(model); where.push('UPPER(v.model) = UPPER($' + params.length + ')'); }
  if (year)  { params.push(parseInt(year, 10)); where.push('v.year = $' + params.length); }
  params.push(SEARCH_RESULT_CAP);

  var descRows = await db.query(
    'SELECT ' + SEARCH_RESULT_COLUMNS + ' FROM idauto_vehicles v WHERE ' + where.join(' AND ') +
    ' ORDER BY v.id LIMIT $' + params.length,
    params
  );
  var descResults = [];
  for (var di = 0; di < descRows.rows.length; di++) descResults.push(await resolveSearchHit(descRows.rows[di]));
  sendJson(res, 200, {
    criterion: 'attributes',
    count: descResults.length,
    // Told plainly rather than left for the caller to infer from a round
    // number, so a capped result is never mistaken for a complete one.
    // Named `capped` rather than the more obvious synonym: that word is a
    // SQL write verb, and the guard in ida-2c/ida-v3 that forbids write verbs
    // in this file scans its prose as well as its code. PR #18 hit the same
    // false positive and resolved it the same way — rewording my own text is
    // cheaper than loosening a security check to accommodate it.
    capped: descResults.length === SEARCH_RESULT_CAP,
    results: descResults
  });
}

// GET /api/plates/:plate_number
// No owner fields exist in the schema (idauto_plates has none, by design).
async function getPlate(res, plateNumber) {
  // IDA-DS-1: vehicle_ivid added so an authenticated (PRIVATE-phase) caller
  // can go plate → IVID → GET /api/passport/:ivid without any new lookup
  // route. The IVID is the public resolution credential (never a secret),
  // and this route was already authenticated plate lookup — no scope widens.
  var result = await db.query(
    'SELECT p.plate_number, p.format_code, g.name_fr AS governorate_name, p.status, ' +
    'p.vehicle_id, v.ivid AS vehicle_ivid, p.valid_from, p.valid_until ' +
    'FROM idauto_plates p LEFT JOIN idauto_governorates g ON g.id = p.governorate_id ' +
    'LEFT JOIN idauto_vehicles v ON v.id = p.vehicle_id ' +
    'WHERE p.plate_number = $1',
    [plateNumber]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/passport/:ivid — the PRIVATE, authenticated passport surface.
// A5-PLATE REVISED RULING, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md §I):
// "PRIVATE PHASE: plate_number may be displayed / stored normally / used
// by authorized internal users according to the existing authorization
// model." This route is that authorized internal display — it lives in
// the ordinary, authenticated ROUTES table below (behind requireAuth(),
// exactly like every other route in this section), NEVER under /public/.
//
// IVID-ONLY LOOKUP, matching GET /public/passport/:ivid's own discipline
// above — the owner's ruling approves plate DISPLAY, not plate-based
// LOOKUP, anywhere, including here. No new plate-resolution path is
// added: internal plate lookup already exists and stays exactly as it
// was, at GET /api/plates/:plate_number above.
//
// SCOPE (P1, Opus review, 2026-08-19 — corrected from an earlier,
// wrong 'mythos_private' cut): this route assembles at scope
// 'professional' (public + professional facts), and the facts SQL
// below EXCLUDES access_scope = 'mythos_private' as a second,
// independent layer — the same two-layer pattern the public route uses
// (SQL filter + assemblePassport()'s own filter), mirrored here rather
// than invented fresh. This file's own header says why (lines 7-8,
// 14-16): every GET response in this file excludes mythos_private
// because no audit-on-read path exists yet, and
// docs/PRIVACY_ARCHITECTURE.md §3 requires every Restricted access to
// be audit-logged — a requirement this route cannot satisfy any more
// than any other GET here can. getFactsForVehicle() above is the real,
// exact precedent (`AND access_scope != 'mythos_private'`), not
// getReviewSubmission() (a different, observation-scoped, explicitly
// mythos_private-carrying route with its own comment saying so) — the
// original comment here miscited it. The A5-PLATE ruling does not need
// restricted facts to satisfy its plate-display requirement: plates
// live in idauto_plates, entirely independent of a fact's access_scope.
async function getPrivatePassport(res, rawIvid) {
  if (!ivid.validate(rawIvid).ok) return notFound(res);

  var vehicleResult = await db.query(
    'SELECT ivid, make, model, variant, year, body_type, fuel_type, colour, category_code, ' +
    'fiche_status, created_at, observation_count ' +
    'FROM idauto_vehicles WHERE ivid = $1',
    [rawIvid]
  );
  if (vehicleResult.rows.length === 0) return notFound(res);
  var vehicleRow = vehicleResult.rows[0];

  // access_scope != 'mythos_private' — see this function's own header
  // for why (getFactsForVehicle()'s precedent, the file's own GET
  // invariant, PRIVACY_ARCHITECTURE.md §3's audit-on-read requirement).
  // No fact-key deny-list here — that is specifically the ANONYMOUS
  // surface's control (reference/public-surface-policy.js); this route
  // is authenticated, and restricted-fact exclusion is handled by scope
  // alone, matching getFactsForVehicle()'s own precedent exactly.
  // Q6 (style, Opus review, 2026-08-19): 'mythos_private' is parameterized
  // ($2), matching this file's own convention (getFactsForVehicle() above
  // binds it the same way) rather than inlined as a SQL literal.
  var factsResult = await db.query(
    'SELECT id, fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, access_scope ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) ' +
    'AND access_scope != $2 AND is_active = TRUE ' +
    'ORDER BY fact_key',
    [rawIvid, 'mythos_private']
  );

  // Plate records — the PRIVATE-phase half of the A5-PLATE ruling in
  // effect: idauto_plates.vehicle_id is a direct FK to idauto_vehicles,
  // the same join pattern getPlate() above already uses (joined once
  // more here through the vehicle's ivid rather than its plate_number,
  // since this route resolves by ivid only). g.code (not g.name_fr) is
  // selected — see buildProtocolConformantPlate()'s own header for why.
  var platesResult = await db.query(
    'SELECT p.id, p.plate_number, p.plate_raw, p.format_code, g.code AS governorate_code, ' +
    'p.valid_from, p.valid_until, p.created_at ' +
    'FROM idauto_plates p LEFT JOIN idauto_governorates g ON g.id = p.governorate_id ' +
    'WHERE p.vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) ' +
    'ORDER BY p.id',
    [rawIvid]
  );

  var passport = passportAssembly.assemblePassport({
    vehicle: buildProtocolConformantVehicle(vehicleRow),
    facts: factsResult.rows.map(factRowToPassportFact),
    plates: platesResult.rows.map(function (row) { return buildProtocolConformantPlate(row, rawIvid); }),
    scope: 'professional',
    now: new Date()
  });
  sendJson(res, 200, passport);
}

// GET /api/observations/:id
// Deliberately excludes capture_time, plate_candidate, ocr_confidence,
// ip_hash, camera_source_id, contributor_id, capture_session_id — all
// documented in schema.sql as MYTHOS_PRIVATE or contributor/session
// identity. Returns only status-shaped fields safe without audit logging.
// IDA-V9 — organisation isolation. An organisation sees an observation only
// if its own organisation submitted it, or if the row belongs to no
// organisation at all (admin/manual entry, which is IDauto's own data and not
// another atelier's). Another atelier's row answers 404, not 403: telling a
// caller that a record it may not see EXISTS is itself a disclosure.
// An admin principal is unfiltered, exactly as before.
async function getObservation(req, res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var result = await db.query(
    // capture_time is NOT selected: tests/ida-2c pins it as a MYTHOS_PRIVATE
    // identity field that must never reach this response, and it is right —
    // a capture timestamp is movement data. The provenance columns below are
    // the submitting organisation's own, and organisation isolation already
    // keeps them from anyone else.
    'SELECT id, vehicle_id, plate_id, capture_method, status, org_id, author_ref, source, source_type, source_reference ' +
    'FROM idauto_observations WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return notFound(res);
  var row = result.rows[0];
  if (req.principal && req.principal.kind === 'organisation') {
    if (row.org_id !== null && String(row.org_id) !== String(req.principal.org_id)) {
      return notFound(res);
    }
  }
  sendJson(res, 200, row);
}

// GET /api/vehicles/:vehicle_internal_ref/facts
// Filters access_scope != 'mythos_private' at the query level — the same
// enforcement point the schema's own design intends for this column.
// IDA-V10 — :ref accepts an IVID or an internal_ref, for the reason given
// on getVehicle() above. vehicle_internal_ref in the response is the
// RESOLVED internal_ref, never the string the caller sent, so a caller that
// asked by IVID is told which record answered.
async function getFactsForVehicle(res, internalRef) {
  var vehicle = await db.query(
    'SELECT id, internal_ref FROM idauto_vehicles WHERE internal_ref = $1 OR ivid = $1',
    [internalRef]
  );
  if (vehicle.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, ' +
    'access_scope, is_active, first_seen_at, last_seen_at ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND access_scope != $2 ORDER BY fact_key',
    [vehicle.rows[0].id, 'mythos_private']
  );
  sendJson(res, 200, { vehicle_internal_ref: vehicle.rows[0].internal_ref, facts: result.rows });
}

// GET /api/facts/:fact_id/evidence
async function getEvidenceForFact(res, factId) {
  if (!/^\d+$/.test(factId)) return notFound(res);
  var fact = await db.query('SELECT id, access_scope FROM idauto_vehicle_facts WHERE id = $1', [factId]);
  if (fact.rows.length === 0) return notFound(res);
  if (fact.rows[0].access_scope === 'mythos_private') return notFound(res);
  var result = await db.query(
    'SELECT evidence_type, weight, created_at FROM idauto_fact_evidence WHERE fact_id = $1 ORDER BY created_at',
    [factId]
  );
  sendJson(res, 200, { fact_id: parseInt(factId, 10), evidence: result.rows });
}

async function getHealth(res) {
  await db.query('SELECT 1');
  sendJson(res, 200, { status: 'ok' });
}

// GET /api/observations/:id/media
// Metadata only — object_key is a local storage reference, never a
// fetchable URL, and this endpoint never streams file bytes (no UI, no
// image-serving path exists in this stage). Excludes mythos_private-scope
// rows, same policy as every other read in this file (default access_scope
// on this table is 'mythos_private' per schema.sql, so most rows are
// excluded unless a caller explicitly chose a wider scope on write).
async function getObservationMedia(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var obs = await db.query('SELECT id FROM idauto_observations WHERE id = $1', [id]);
  if (obs.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 AND access_scope != $2 ORDER BY created_at',
    [id, 'mythos_private']
  );
  sendJson(res, 200, { observation_id: parseInt(id, 10), media: result.rows });
}

// GET /api/review/observations — queue view derived from the observation
// statuses already defined by the schema. Only the two pending states enter
// this queue; no private capture fields or storage object keys are selected.
async function getReviewObservations(res) {
  var result = await db.query(
    "SELECT o.id, o.capture_method, o.status, v.internal_ref AS vehicle_internal_ref, v.make, v.model, " +
    "p.plate_number FROM idauto_observations o " +
    "LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id LEFT JOIN idauto_plates p ON p.id = o.plate_id " +
    "WHERE o.status IN ('pending_review','pending_confirmation') ORDER BY o.id ASC"
  );
  sendJson(res, 200, { observations: result.rows });
}

// GET /api/review/observations/:id — admin-safe detail. Facts and media are
// filtered at query level exactly like the existing IDA-2C/2F read routes.
async function getReviewObservation(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var observation = await db.query(
    'SELECT o.id, o.capture_method, o.status, v.internal_ref AS vehicle_internal_ref, v.make, v.model, v.variant, v.year, ' +
    'v.body_type, v.fuel_type, v.colour, p.plate_number, p.format_code ' +
    'FROM idauto_observations o LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id ' +
    'LEFT JOIN idauto_plates p ON p.id = o.plate_id WHERE o.id = $1',
    [id]
  );
  if (observation.rows.length === 0) return notFound(res);
  var item = observation.rows[0];
  var facts = item.vehicle_internal_ref ? await db.query(
    'SELECT fact_key, fact_value, confidence_score, verification_status, access_scope FROM idauto_vehicle_facts f ' +
    'JOIN idauto_vehicles v ON v.id = f.vehicle_id WHERE v.internal_ref = $1 AND f.access_scope != $2 ORDER BY fact_key',
    [item.vehicle_internal_ref, 'mythos_private']
  ) : { rows: [] };
  var media = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 AND access_scope != $2 ORDER BY created_at',
    [id, 'mythos_private']
  );
  sendJson(res, 200, { observation: item, facts: facts.rows, media: media.rows });
}

// GET /api/review/submissions — IDA-3 ingestion review queue with provenance.
async function getReviewSubmissions(res) {
  var result = await db.query(
    "SELECT s.id AS submission_id, s.actor_type, cs.code AS capture_source_code, s.received_at, " +
    "o.id AS observation_id, o.status AS observation_status, p.plate_number, " +
    "count(DISTINCT f.id)::int AS fact_count, count(DISTINCT m.id)::int AS media_count " +
    "FROM idauto_submissions s JOIN idauto_observations o ON o.id = s.observation_id " +
    "JOIN idauto_capture_sources cs ON cs.id = s.capture_source_id " +
    "LEFT JOIN idauto_plates p ON p.id = o.plate_id LEFT JOIN idauto_vehicle_facts f ON f.observation_id = o.id " +
    "LEFT JOIN idauto_observation_media m ON m.observation_id = o.id " +
    "WHERE o.status IN ('pending_review','pending_confirmation') " +
    "GROUP BY s.id, s.actor_type, cs.code, s.received_at, o.id, o.status, p.plate_number ORDER BY s.id ASC"
  );
  sendJson(res, 200, { submissions: result.rows });
}

// GET /api/review/submissions/:id — private reviewer detail. Deliberately
// includes mythos_private fact and media metadata, but never storage paths.
async function getReviewSubmission(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var submission = await db.query(
    'SELECT s.id AS submission_id, s.actor_type, cs.code AS capture_source_code, s.received_at, ' +
    'o.id AS observation_id, o.status AS observation_status, o.capture_method, p.plate_number, p.format_code, ' +
    'v.internal_ref AS vehicle_internal_ref, v.make, v.model, v.variant, v.year, v.body_type, v.fuel_type, v.colour ' +
    'FROM idauto_submissions s JOIN idauto_observations o ON o.id = s.observation_id ' +
    'JOIN idauto_capture_sources cs ON cs.id = s.capture_source_id LEFT JOIN idauto_plates p ON p.id = o.plate_id ' +
    'LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id WHERE s.id = $1',
    [id]
  );
  if (submission.rows.length === 0) return notFound(res);
  var item = submission.rows[0];
  var facts = await db.query(
    'SELECT id, fact_key, fact_value, confidence_score, verification_status, access_scope ' +
    'FROM idauto_vehicle_facts WHERE observation_id = $1 ORDER BY id ASC',
    [item.observation_id]
  );
  var media = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 ORDER BY id ASC',
    [item.observation_id]
  );
  sendJson(res, 200, {
    submission: { id: item.submission_id, actor_type: item.actor_type, capture_source_code: item.capture_source_code, received_at: item.received_at },
    observation: { id: item.observation_id, status: item.observation_status, capture_method: item.capture_method, plate_number: item.plate_number, format_code: item.format_code, vehicle_internal_ref: item.vehicle_internal_ref, make: item.make, model: item.model, variant: item.variant, year: item.year, body_type: item.body_type, fuel_type: item.fuel_type, colour: item.colour },
    facts: facts.rows,
    media: media.rows
  });
}

// Reads and JSON-parses the request body, capped at 64KB (this API's
// JSON-bodied routes take small admin-entry payloads only; file/image
// uploads use readBinaryBody() below instead, with its own larger cap).
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 65536) {
        tooLarge = true;
        chunks = [];
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('invalid JSON body'), { httpStatus: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Reads a raw binary body, capped at storage.MAX_UPLOAD_BYTES (distinct
// cap from readJsonBody's 64KB — this endpoint carries file bytes, not a
// small admin-entry payload).
function readBinaryBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > storage.MAX_UPLOAD_BYTES) {
        tooLarge = true;
        chunks = [];
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large — max ' + (storage.MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB'), { httpStatus: 413 }));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function multipartBoundary(contentType) {
  if (typeof contentType !== 'string' || !/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    throw Object.assign(new Error('multipart/form-data is required'), { httpStatus: 400 });
  }
  var match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  var boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 70 || /[\x00-\x20\x7f()<>@,;:\\"\/[\]?={}]/.test(boundary)) {
    throw Object.assign(new Error('invalid multipart boundary'), { httpStatus: 400 });
  }
  return boundary;
}

function parseMultipartBuffer(buffer, contentType) {
  var boundary = multipartBoundary(contentType);
  if (!Buffer.isBuffer(buffer)) throw Object.assign(new Error('invalid multipart body'), { httpStatus: 400 });
  if (buffer.length > storage.MAX_UPLOAD_BYTES) throw Object.assign(new Error('payload too large'), { httpStatus: 413 });
  var marker = Buffer.from('--' + boundary);
  var delimiter = Buffer.from('\r\n--' + boundary);
  if (!buffer.slice(0, marker.length).equals(marker)) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
  var parts = [];
  var position = marker.length;
  while (true) {
    if (buffer.slice(position, position + 2).toString() === '--') {
      if (position + 2 !== buffer.length && buffer.slice(position + 2, position + 4).toString() !== '\r\n') throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
      break;
    }
    if (buffer.slice(position, position + 2).toString() !== '\r\n') throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    position += 2;
    var headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headerEnd === -1) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    var headerText = buffer.slice(position, headerEnd).toString('latin1');
    var next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next === -1) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    var disposition = /(?:^|\r\n)Content-Disposition:\s*form-data\s*;[^\r\n]*\bname="([^"]+)"/i.exec(headerText);
    if (!disposition) throw Object.assign(new Error('malformed multipart part'), { httpStatus: 400 });
    var type = /(?:^|\r\n)Content-Type:\s*([^\r\n;]+)/i.exec(headerText);
    parts.push({ name: disposition[1], content_type: type ? type[1].trim() : '', buffer: buffer.slice(headerEnd + 4, next) });
    position = next + delimiter.length;
  }
  var submissions = parts.filter(function (part) { return part.name === 'submission'; });
  if (submissions.length !== 1) throw Object.assign(new Error('exactly one submission part is required'), { httpStatus: 400 });
  var submission;
  try { submission = JSON.parse(submissions[0].buffer.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('invalid submission JSON'), { httpStatus: 400 }); }
  return {
    submission: submission,
    media: parts.filter(function (part) { return part.name === 'image'; }).map(function (part) {
      return { mime_type: part.content_type, buffer: part.buffer };
    })
  };
}

function readMultipartBody(req) {
  var contentType = req.headers['content-type'] || '';
  multipartBoundary(contentType);
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0, tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > storage.MAX_UPLOAD_BYTES) { tooLarge = true; chunks = []; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
      try { resolve(parseMultipartBuffer(Buffer.concat(chunks), contentType)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function ingestHttpStatus(result) {
  if (result && result.replay === true) return 200;
  if (result && result.status === 'duplicate') return 202;
  if (result && result.ok === true) return 201;
  var code = result && result.error && result.error.code;
  if (code === 'INVALID_PLATE') return 422;
  if (['INVALID_MEDIA_SIZE', 'SUBMISSION_TOO_LARGE', 'TOO_MANY_IMAGES'].indexOf(code) !== -1) return 413;
  if (['INVALID_MEDIA', 'INVALID_MEDIA_MAGIC', 'MALFORMED_MEDIA'].indexOf(code) !== -1) return 415;
  if (code === 'RATE_LIMITED') return 429;
  if (['CAPTURE_SOURCE_UNAVAILABLE', 'INGESTION_FAILED', 'IDA_FACT_LINK', 'RATE_LIMIT_STORAGE_ERROR'].indexOf(code) !== -1) return 500;
  return 400;
}

function retryAfterSeconds(retryAt, now) {
  var milliseconds = new Date(retryAt).getTime() - (now === undefined ? Date.now() : new Date(now).getTime());
  if (!isFinite(milliseconds)) return 1;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

async function postIngestObservation(req, res) {
  var idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) return sendJson(res, 400, { error: 'Idempotency-Key header is required' });
  var match = /^Bearer (.+)$/.exec(req.headers['authorization'] || '');
  var parsed = await readMultipartBody(req);
  var payload = parsed.submission;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !Object.prototype.hasOwnProperty.call(payload, 'media')) {
    payload = Object.assign({}, payload, { media: parsed.media });
  }
  var result = await ingestion.submit(payload, { actor_type: 'admin', actor_ref: match[1], idempotency_key: idempotencyKey });
  var status = ingestHttpStatus(result);
  if (status === 500) return sendJson(res, 500, { error: 'ingestion failed' });
  if (status === 429) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds(result.retry_at)) });
    return res.end(JSON.stringify(result));
  }
  sendJson(res, status, result);
}

// POST /api/observations/:id/media
// Body is the raw file content. Content-Type header is the mime type.
// Optional X-Idauto-Media-Type / X-Idauto-Access-Scope headers (both
// validated + defaulted in writes.js) — kept out of the body since the
// body IS the file, not JSON, matching this being a binary-upload
// endpoint rather than a JSON one like every other write route.
async function postObservationMedia(req, res, observationId) {
  if (!/^\d+$/.test(observationId)) return notFound(res);
  var buffer = await readBinaryBody(req);
  var mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  var body = {
    media_type: req.headers['x-idauto-media-type'],
    access_scope: req.headers['x-idauto-access-scope'],
    blurred: req.headers['x-idauto-blurred'] === 'true'
  };
  var record = await writes.createObservationMedia(observationId, buffer, mimeType, body, req.mythosIdentity, req.principal);
  sendJson(res, 201, record);
}

// POST /api/vehicles
async function postVehicle(req, res) {
  var body = await readJsonBody(req);
  var record = await writes.createVehicle(body, req.mythosIdentity, req.principal);
  sendJson(res, 201, record);
}

// POST /api/plates
async function postPlate(req, res) {
  var body = await readJsonBody(req);
  if (!body.plate_number || !body.format_code) {
    return sendJson(res, 400, { error: 'plate_number and format_code are required' });
  }
  var record = await writes.createPlate(body, req.mythosIdentity, req.principal);
  sendJson(res, 201, record);
}

// POST /api/observations
async function postObservation(req, res) {
  var body = await readJsonBody(req);
  if (!body.vehicle_internal_ref) {
    return sendJson(res, 400, { error: 'vehicle_internal_ref is required' });
  }
  var record = await writes.createObservation(body, req.mythosIdentity, req.principal);
  sendJson(res, 201, record);
}

// POST /api/vehicles/:internal_ref/facts
async function postFact(req, res, internalRef) {
  var body = await readJsonBody(req);
  if (!body.fact_key || typeof body.fact_value === 'undefined') {
    return sendJson(res, 400, { error: 'fact_key and fact_value are required' });
  }
  var record = await writes.createFact(internalRef, body, req.mythosIdentity, req.principal);
  sendJson(res, 201, record);
}

async function postReviewDecision(req, res, observationId) {
  if (!/^\d+$/.test(observationId)) return notFound(res);
  var body = await readJsonBody(req);
  var record = await writes.reviewObservation(observationId, body.decision, req.mythosIdentity, req.principal);
  sendJson(res, 200, record);
}

async function postFactReviewDecision(req, res, factId) {
  if (!/^\d+$/.test(factId)) return notFound(res);
  var body = await readJsonBody(req);
  // IDA-V4 — verification, publication, source and confidence are separate
  // dimensions. access_scope, confidence_score and evidence_type are all
  // optional: omitted, the fact keeps the scope and confidence it already
  // had, so verifying something never publishes it as a side effect.
  // writes.js validates each one; nothing here is trusted unchecked.
  var record = await writes.reviewFact(factId, body.decision, req.mythosIdentity, {
    access_scope: body.access_scope,
    confidence_score: body.confidence_score,
    evidence_type: body.evidence_type,
    weight: body.weight
  }, req.principal);
  sendJson(res, 200, record);
}


// IDA-V8 — identity resolution. Owner requirement, 2026-08-27.
//
// Three authenticated routes and one public consequence. Fixpert holds
// references minted before a merge; none of them may ever stop resolving.
async function postVehicleMerge(req, res, ref) {
  var body = await readJsonBody(req);
  if (!body || !body.canonical_ref) {
    return sendJson(res, 400, { error: 'canonical_ref is required' });
  }
  var record = await writes.mergeVehicle(ref, String(body.canonical_ref), req.mythosIdentity, req.principal);
  sendJson(res, 200, record);
}

async function postVehicleSplit(req, res, ref) {
  var record = await writes.splitVehicle(ref, req.mythosIdentity, req.principal);
  sendJson(res, 200, record);
}

// GET /api/vehicles/:ref/resolve — what does this identifier point at today?
// Accepts an IVID or an internal_ref, because Fixpert holds both.
async function getVehicleResolve(res, ref) {
  var resolved = await writes.resolveVehicleRef(ref);
  if (!resolved) return notFound(res);
  sendJson(res, 200, resolved);
}


// IDA-V9 — the scope each route requires. One table, checked in one place, so
// a new route is visibly either scoped or deliberately admin-only: anything
// absent here is reachable ONLY by an admin principal, which is the safe
// default. An organisation credential can never reach a route it is not
// listed for, whatever scopes it was granted.
var ROUTE_SCOPES = [
  // IDA-V10 — vehicle search. `vehicle:search` admits a caller to the route;
  // a VIN criterion additionally demands `vin:search`, checked inside the
  // handler because it is a property of the QUERY, not of the path. That
  // second check cannot be expressed in this table, which is keyed on method
  // and path alone — so it lives beside the VIN query it guards, and runs
  // before any VIN row is read.
  { method: 'GET',  pattern: /^\/api\/search\/vehicles$/,        scope: 'vehicle:search' },
  { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+\/resolve$/, scope: 'identity:resolve' },
  { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+\/facts$/,   scope: 'fact:read' },
  { method: 'POST', pattern: /^\/api\/vehicles\/[^/]+\/facts$/,   scope: 'fact:write' },
  { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+$/,           scope: 'vehicle:read' },
  { method: 'POST', pattern: /^\/api\/vehicles$/,                  scope: 'vehicle:write' },
  { method: 'GET',  pattern: /^\/api\/plates\/[^/]+$/,             scope: 'plate:read' },
  { method: 'POST', pattern: /^\/api\/observations$/,              scope: 'observation:write' },
  { method: 'GET',  pattern: /^\/api\/observations\/[^/]+$/,       scope: 'observation:read' },
  { method: 'GET',  pattern: /^\/api\/passport\/[^/]+$/,           scope: 'passport:read' }
];

// IDA-V12 — identification, catalogue and workshop routes live in
// reference/v12-routes.js and are mounted here behind the SAME requireAuth()
// and the SAME scope gate. Their scopes join this table; their handlers
// join ROUTES below. Nothing under /public/ is added.
var v12 = v12Routes.createV12({ sendJson: sendJson, readJsonBody: readJsonBody, requireScope: requireScope, decodePathSegment: decodePathSegment });
var ALL_ROUTE_SCOPES = ROUTE_SCOPES.concat(v12.scopes);

function scopeForRoute(method, pathname) {
  for (var i = 0; i < ALL_ROUTE_SCOPES.length; i++) {
    if (ALL_ROUTE_SCOPES[i].method === method && ALL_ROUTE_SCOPES[i].pattern.test(pathname)) return ALL_ROUTE_SCOPES[i].scope;
  }
  return null;
}

var ROUTES = [
  { method: 'GET', pattern: /^\/api\/search\/vehicles$/, handler: function (req, res) { return searchVehicles(req, res, url.parse(req.url, true)); } },
  { method: 'GET', pattern: /^\/health$/, handler: function (req, res) { return getHealth(res); } },
  { method: 'GET', pattern: /^\/api\/review\/observations$/, handler: function (req, res) { return getReviewObservations(res); } },
  { method: 'GET', pattern: /^\/api\/review\/observations\/([^/]+)$/, handler: function (req, res, m) { return getReviewObservation(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/review\/observations\/([^/]+)\/decision$/, handler: function (req, res, m) { return postReviewDecision(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/review\/submissions$/, handler: function (req, res) { return getReviewSubmissions(res); } },
  { method: 'GET', pattern: /^\/api\/review\/submissions\/([^/]+)$/, handler: function (req, res, m) { return getReviewSubmission(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/review\/facts\/([^/]+)\/decision$/, handler: function (req, res, m) { return postFactReviewDecision(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return getFactsForVehicle(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return postFact(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)$/, handler: function (req, res, m) { return getVehicle(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles$/, handler: function (req, res) { return postVehicle(req, res); } },
  { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/merge$/, handler: function (req, res, m) { return postVehicleMerge(req, res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/split$/, handler: function (req, res, m) { return postVehicleSplit(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/resolve$/, handler: function (req, res, m) { return getVehicleResolve(res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/plates\/([^/]+)$/, handler: function (req, res, m) { return getPlate(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/plates$/, handler: function (req, res) { return postPlate(req, res); } },
  { method: 'GET', pattern: /^\/api\/passport\/([^/]+)$/, handler: function (req, res, m) { return getPrivatePassport(res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return getObservationMedia(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/ingest\/observations$/, handler: function (req, res) { return postIngestObservation(req, res); } },
  { method: 'POST', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return postObservationMedia(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)$/, handler: function (req, res, m) { return getObservation(req, res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/observations$/, handler: function (req, res) { return postObservation(req, res); } },
  { method: 'GET', pattern: /^\/api\/facts\/([^/]+)\/evidence$/, handler: function (req, res, m) { return getEvidenceForFact(res, decodePathSegment(m[1])); } }
];

var ALL_ROUTES = ROUTES.concat(v12.routes);

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url);
    var pathname = parsed.pathname;

    if (serveAdminAsset(req, res, pathname)) return;
    // IDA-V12 — the atelier page (static shell + assets, its own CSP).
    if (v12.serveAtelierAsset(req, res, pathname)) return;

    // IDA-DS-1 — citizen UI shells/assets; active ONLY in the A5-PLATE
    // PUBLIC phase (see serveCitizenAsset()'s header). Static files only;
    // never a data path.
    if (serveCitizenAsset(req, res, pathname)) return;

    // A5 OPTION C, 2026-08-19 — the one unauthenticated route, reached
    // BEFORE requireAuth() deliberately. Every path under /public/ is
    // handled here and NEVER falls through to the authenticated ROUTES
    // table below.
    if (pathname === '/public' || pathname.indexOf('/public/') === 0) {
      Promise.resolve().then(function () { return handlePublicPassportRoute(req, res, pathname); }).catch(function (err) {
        // F7 (Opus review, 2026-08-19): a response may already be
        // underway (e.g. writeHead already called) by the time an error
        // surfaces here — writing again would throw a second, uglier
        // error. Destroy the socket instead of attempting a second write.
        if (res.headersSent) { req.socket.destroy(); return; }
        // Never echo err.message to this ANONYMOUS, unauthenticated
        // caller — unlike the authenticated ROUTES catch below (whose own
        // comment already warns against echoing driver-shaped detail),
        // this caller has proven nothing about themselves at all, so even
        // an httpStatus-carrying application error (a message string an
        // internal caller wrote for an admin's eyes) gets a generic body.
        if (err && err.httpStatus) return sendJson(res, err.httpStatus, { error: 'request could not be processed' });
        var mapped = writes.mapDbError(err);
        sendJson(res, mapped.status, { error: mapped.error });
      });
      return;
    }

    // IDA-V1B — owner-session routes. Before requireAuth() because two of
    // the three deliberately answer without a Bearer token; see the
    // function's header.
    if (handleSessionRoute(req, res, pathname)) return;

    if (!requireAuth(req, res)) return;

    // IDA-V9 — authorisation, after authentication and before dispatch. An
    // admin principal holds '*' and passes everything, so this changes
    // nothing for the credentials that exist today. An organisation
    // principal is refused with 403 unless the route is scoped AND its scope
    // was granted — a route absent from ROUTE_SCOPES is admin-only.
    if (req.principal && req.principal.kind === 'organisation') {
      var needed = scopeForRoute(req.method, pathname);
      if (!needed) {
        logAuthDecision(req, { result: 'denied', reason: 'route_not_available_to_organisations', actor: req.mythosIdentity, org: req.principal.org_id });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'forbidden — this route is not available to an organisation credential' }));
      }
      if (!requireScope(req, res, needed)) return;
    }

    var matchedPath = ALL_ROUTES.filter(function (r) { return r.pattern.test(pathname); });
    if (matchedPath.length === 0) return notFound(res);

    var matchedMethod = matchedPath.filter(function (r) { return r.method === req.method; });
    if (matchedMethod.length === 0) {
      var allowed = matchedPath.map(function (r) { return r.method; }).join(', ');
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': allowed });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);
    Promise.resolve().then(function () { return route.handler(req, res, m); }).catch(function (err) {
      if (err.httpStatus) return sendJson(res, err.httpStatus, { error: err.message });
      // Never include the raw driver error message in the response — it
      // can echo back query fragments or connection detail. mapDbError()
      // translates known Postgres error codes to a safe, specific message;
      // anything unrecognized falls through to a generic 500.
      var mapped = writes.mapDbError(err);
      sendJson(res, mapped.status, { error: mapped.error });
    });
  });
}

if (require.main === module) {
  var port = parseInt(process.env.IDAUTO_API_PORT || '3001', 10);
  createServer().listen(port, '127.0.0.1', function () {
    console.log('ID Auto API listening on 127.0.0.1:' + port);
  });
}

module.exports = {
  createServer: createServer,
  parseMultipartBuffer: parseMultipartBuffer,
  ingestHttpStatus: ingestHttpStatus,
  retryAfterSeconds: retryAfterSeconds,
  // IDA-DS-1: exported for tests/ida4-ds-ui-test.js (structural checks on
  // the citizen asset map and its phase gate). Not a public API.
  _citizenAssets: CITIZEN_ASSETS,
  _serveCitizenAsset: serveCitizenAsset,
  // IDA-V1B: exported for tests/ida-v1b-owner-session-test.js, which asserts
  // the owner-session grant is exactly these two reads and no more.
  _ownerSessionRoutes: OWNER_SESSION_ROUTES,
  _ownerSessionAllows: ownerSessionAllows,
  // IDA-V1C: exported for tests/ida-v1c-auth-diagnostics-test.js, which pins
  // the RFC-conformant parse and proves no credential reaches the log.
  _extractBearer: extractBearer,
  // IDA-V12: exported for the v12 suites (provider/catalogue injection is
  // done through v12-routes.createV12 in tests; these expose the live ones).
  _v12: v12
};
