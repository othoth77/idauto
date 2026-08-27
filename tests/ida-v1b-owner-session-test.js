'use strict';

/* IDA-V1B — owner session.
 *
 * Two halves. The STATIC half exercises reference/session.js and api.js's
 * grant surface with no database and no network; it is the half that proves
 * the security properties. The HTTP half drives a real server over loopback
 * to prove the wiring — dispatch order, status codes, Set-Cookie.
 *
 * The HTTP half never reaches a database: every route it exercises is
 * answered by the session layer or refused by requireAuth() before any
 * handler runs. The dummy IDAUTO_DB_* values below point at a closed port
 * so that an accidental query fails instantly instead of finding anything
 * real. Production is never a test target. */

var http = require('http');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }

var SECRET = crypto.randomBytes(32).toString('base64');
var ADMIN_TOKEN = 'token-' + crypto.randomBytes(12).toString('hex');
var ADMIN_REF = 'usr_' + crypto.randomBytes(16).toString('hex');

// Set before requiring api.js — identity.js and session.js read env lazily,
// but the DB pool builder validates its variables on first use.
process.env.IDAUTO_SESSION_SECRET = SECRET;
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify((function () { var m = {}; m[ADMIN_TOKEN] = ADMIN_REF; return m; })());
process.env.IDAUTO_DB_HOST = process.env.IDAUTO_DB_HOST || '127.0.0.1';
process.env.IDAUTO_DB_PORT = process.env.IDAUTO_DB_PORT || '1';
process.env.IDAUTO_DB_USER = process.env.IDAUTO_DB_USER || 'unused';
process.env.IDAUTO_DB_PASSWORD = process.env.IDAUTO_DB_PASSWORD || 'unused';
process.env.IDAUTO_DB_NAME = process.env.IDAUTO_DB_NAME || 'unused';

var session = require(path.join(BASE, 'reference', 'session.js'));
var api = require(path.join(BASE, 'reference', 'api.js'));

var NOW = 1800000000; // fixed instant — these tests must not depend on the clock

function staticCases() {
  console.log('\nSTATIC — no database, no network');

  // ---- configuration gate: absence must never open a door ----
  var saved = process.env.IDAUTO_SESSION_SECRET;
  delete process.env.IDAUTO_SESSION_SECRET;
  ok(session.isEnabled() === false, 'unconfigured secret disables the mechanism');
  ok(session.issue(ADMIN_REF, NOW) === null, 'unconfigured secret issues nothing');
  process.env.IDAUTO_SESSION_SECRET = 'short';
  ok(session.isEnabled() === false, 'a secret below the minimum length is refused');
  process.env.IDAUTO_SESSION_SECRET = saved;
  ok(session.isEnabled() === true, 'a full-length secret enables the mechanism');

  // ---- round trip ----
  var value = session.issue(ADMIN_REF, NOW);
  ok(typeof value === 'string' && value.split('.').length === 3, 'issued cookie has three dot-separated parts');
  ok(value.indexOf('v1.') === 0, 'issued cookie carries its version');
  var verified = session.verify(value, NOW);
  ok(verified && verified.ref === ADMIN_REF, 'a fresh cookie verifies to the enrolling identity');
  ok(verified.exp === NOW + session.MAX_AGE_SECONDS, 'expiry is exactly the configured maximum age');
  ok(session.MAX_AGE_SECONDS === 180 * 24 * 60 * 60, 'maximum age is 180 days');

  // ---- the secret is never in the cookie ----
  ok(value.indexOf(SECRET) === -1, 'cookie value does not contain the signing secret');
  var decoded = Buffer.from(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  ok(decoded.indexOf(SECRET) === -1, 'decoded payload does not contain the signing secret');
  ok(decoded.indexOf(ADMIN_TOKEN) === -1, 'decoded payload does not contain the bearer token');

  // ---- forgery ----
  var parts = value.split('.');
  ok(session.verify(parts[0] + '.' + parts[1] + '.' + 'x'.repeat(parts[2].length), NOW) === null, 'a wrong signature of the right length is refused');
  ok(session.verify(parts[0] + '.' + parts[1] + '.' + parts[2] + 'x', NOW) === null, 'a signature of the wrong length is refused');
  var tamperedPayload = Buffer.from(JSON.stringify({ ref: 'usr_attacker', scope: 'plate-lookup', exp: NOW + 10 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok(session.verify('v1.' + tamperedPayload + '.' + parts[2], NOW) === null, 'a re-written identity with the old signature is refused');
  ok(session.verify('v2.' + parts[1] + '.' + parts[2], NOW) === null, 'an unknown version is refused');
  ok(session.verify('', NOW) === null && session.verify(null, NOW) === null, 'empty and null cookies are refused');
  ok(session.verify('garbage', NOW) === null, 'a malformed cookie is refused');

  // A cookie signed with a different secret must not verify — this is what
  // makes rotating IDAUTO_SESSION_SECRET a working revocation.
  var otherSecret = crypto.randomBytes(32).toString('base64');
  process.env.IDAUTO_SESSION_SECRET = otherSecret;
  ok(session.verify(value, NOW) === null, 'rotating the secret invalidates every existing cookie');
  process.env.IDAUTO_SESSION_SECRET = SECRET;

  // ---- expiry ----
  ok(session.verify(value, NOW + session.MAX_AGE_SECONDS + 1) === null, 'an expired cookie is refused');
  ok(session.verify(value, NOW + session.MAX_AGE_SECONDS) === null, 'a cookie is refused exactly at its expiry');
  ok(session.needsRenewal(verified, NOW) === false, 'a fresh cookie does not need renewal');
  ok(session.needsRenewal(verified, NOW + session.RENEW_BELOW_SECONDS + 1) === true, 'a cookie past half-life needs renewal');

  // ---- scope ----
  var wrongScope = Buffer.from(JSON.stringify({ ref: ADMIN_REF, scope: 'admin', exp: NOW + 100 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  var signedWrongScope = crypto.createHmac('sha256', SECRET).update('v1.' + wrongScope).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok(session.verify('v1.' + wrongScope + '.' + signedWrongScope, NOW) === null, 'a correctly signed cookie with a widened scope is still refused');

  // ---- cookie attributes ----
  var header = session.setCookieHeader(value);
  ok(/HttpOnly/.test(header), 'cookie is HttpOnly — script cannot read it');
  ok(/Secure/.test(header), 'cookie is Secure — never sent in plaintext');
  ok(/SameSite=Strict/.test(header), 'cookie is SameSite=Strict — not sent cross-site');
  ok(/Path=\//.test(header), 'cookie is scoped to the whole origin');
  ok(/Max-Age=15552000/.test(header), 'cookie max-age is 180 days in seconds');
  ok(/Max-Age=0/.test(session.clearCookieHeader()), 'the clearing header expires the cookie immediately');

  // ---- cookie parsing ----
  ok(session.parseCookies('a=1; ida_owner=xyz; b=2').ida_owner === 'xyz', 'the cookie is found among others');
  ok(session.parseCookies('').ida_owner === undefined, 'an empty Cookie header yields nothing');
  ok(session.parseCookies('ida_owner=a=b').ida_owner === 'a=b', 'a value containing = survives parsing');
  ok(session.readCookie({ headers: {} }) === null, 'a request with no Cookie header yields null');

  // ---- THE GRANT: exactly two reads ----
  console.log('\nGRANT SURFACE');
  ok(api._ownerSessionRoutes.length === 2, 'the owner session grants exactly two routes');
  ok(api._ownerSessionAllows('GET', '/api/plates/199%20TUN%204242') === true, 'plate lookup is granted');
  ok(api._ownerSessionAllows('GET', '/api/passport/ivid:1:ABCDEFGHJKMNPQRS:AB') === true, 'private passport read is granted');
  [
    ['POST', '/api/vehicles'], ['POST', '/api/plates'], ['GET', '/api/vehicles/abc'],
    ['POST', '/api/vehicles/abc/facts'], ['GET', '/api/vehicles/abc/facts'],
    ['GET', '/api/review/observations'], ['POST', '/api/review/observations/x/decision'],
    ['POST', '/api/ingest/observations'], ['GET', '/api/observations/x/media'],
    ['POST', '/api/observations/x/media'], ['GET', '/health'],
    ['DELETE', '/api/plates/199 TUN 4242'], ['POST', '/api/passport/x']
  ].forEach(function (pair) {
    ok(api._ownerSessionAllows(pair[0], pair[1]) === false, 'NOT granted: ' + pair[0] + ' ' + pair[1]);
  });
  ok(api._ownerSessionAllows('GET', '/api/plates/a/b') === false, 'the plate pattern does not span a path separator');
  ok(api._ownerSessionAllows('GET', '/session/enroll') === false, 'the cookie cannot authenticate its own enrolment');

  // ---- source-level guards, mirroring ida-3d/ida-3e ----
  var source = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  ok((source.match(/\.listen\s*\(/g) || []).length === 1, 'no second listener was added');
  ok((source.match(/'127\.0\.0\.1'/g) || []).length === 1, 'loopback bind host remains unchanged');
  ok(/if \(!requireAuth\(req, res\)\) return;[\s\S]*route\.handler/.test(source), 'the authentication gate still precedes every route handler');
  ok(source.indexOf('rateLimit.enforce(') === -1, 'api.js still never calls the ingestion rate limiter directly');
}

// ---------------------------------------------------------------- HTTP ----

var server, port;

function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: '127.0.0.1', port: port, path: requestPath, method: method,
      headers: Object.assign({ 'Content-Length': body ? Buffer.byteLength(body) : 0 }, headers || {})
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieFrom(response) {
  var set = response.headers['set-cookie'];
  if (!set || !set.length) return null;
  return set[0].split(';')[0];
}

async function httpCases() {
  console.log('\nHTTP — real server on loopback, no database reached');

  var owner = { 'X-IDauto-Owner': '1' };

  // ---- the CSRF header is mandatory on every /session route ----
  var noHeader = await request('GET', '/session');
  ok(noHeader.status === 403, 'GET /session without X-IDauto-Owner is 403');
  var noHeaderEnroll = await request('POST', '/session/enroll', { Authorization: 'Bearer ' + ADMIN_TOKEN });
  ok(noHeaderEnroll.status === 403, 'POST /session/enroll without X-IDauto-Owner is 403, even with a valid token');

  // ---- anonymous state ----
  var anon = await request('GET', '/session', owner);
  ok(anon.status === 200 && anon.body.owner === false, 'GET /session with no cookie answers owner:false, not 401');

  // ---- enrolment requires a real Bearer token ----
  var noToken = await request('POST', '/session/enroll', owner);
  ok(noToken.status === 401, 'enrolment without a token is 401');
  var badToken = await request('POST', '/session/enroll', Object.assign({ Authorization: 'Bearer wrong' }, owner));
  ok(badToken.status === 401, 'enrolment with a wrong token is 401');
  var wrongMethod = await request('GET', '/session/enroll', owner);
  ok(wrongMethod.status === 405 && wrongMethod.headers.allow === 'POST', 'GET /session/enroll is 405 with Allow: POST');

  var enrolled = await request('POST', '/session/enroll', Object.assign({ Authorization: 'Bearer ' + ADMIN_TOKEN }, owner));
  ok(enrolled.status === 204, 'enrolment with a valid token is 204');
  var setCookie = enrolled.headers['set-cookie'];
  ok(!!setCookie && /ida_owner=/.test(setCookie[0]), 'enrolment sets the ida_owner cookie');
  ok(/HttpOnly/.test(setCookie[0]) && /Secure/.test(setCookie[0]) && /SameSite=Strict/.test(setCookie[0]), 'the cookie is set HttpOnly, Secure and SameSite=Strict');
  ok(setCookie[0].indexOf(ADMIN_TOKEN) === -1, 'the cookie does not carry the bearer token');

  var cookie = cookieFrom(enrolled);

  // ---- the cookie is recognised ----
  var known = await request('GET', '/session', Object.assign({ Cookie: cookie }, owner));
  ok(known.status === 200 && known.body.owner === true, 'GET /session with the cookie answers owner:true');

  // ---- the cookie authenticates the two granted reads ----
  // A 401 would mean the gate rejected it. Anything else means the gate
  // passed and dispatch continued — which is all this asserts, because no
  // database is reachable here.
  var plate = await request('GET', '/api/plates/199%20TUN%204242', Object.assign({ Cookie: cookie }, owner));
  ok(plate.status !== 401, 'the cookie authenticates GET /api/plates/:plate (status ' + plate.status + ')');
  var passport = await request('GET', '/api/passport/ivid:1:ABCDEFGHJKMNPQRS:AB', Object.assign({ Cookie: cookie }, owner));
  ok(passport.status !== 401, 'the cookie authenticates GET /api/passport/:ivid (status ' + passport.status + ')');

  // ---- and nothing else ----
  var write = await request('POST', '/api/vehicles', Object.assign({ Cookie: cookie, 'Content-Type': 'application/json' }, owner), '{}');
  ok(write.status === 401, 'the cookie does NOT authenticate POST /api/vehicles');
  var review = await request('GET', '/api/review/observations', Object.assign({ Cookie: cookie }, owner));
  ok(review.status === 401, 'the cookie does NOT authenticate the review queue');
  var vehicle = await request('GET', '/api/vehicles/anything', Object.assign({ Cookie: cookie }, owner));
  ok(vehicle.status === 401, 'the cookie does NOT authenticate GET /api/vehicles/:ref');
  var health = await request('GET', '/health', Object.assign({ Cookie: cookie }, owner));
  ok(health.status === 401, 'the cookie does NOT authenticate /health');

  // ---- without the CSRF header the cookie is inert on the granted reads ----
  var noCsrf = await request('GET', '/api/plates/199%20TUN%204242', { Cookie: cookie });
  ok(noCsrf.status === 401, 'the cookie alone, without X-IDauto-Owner, does not authenticate a granted read');

  // ---- a forged cookie is refused ----
  var forged = await request('GET', '/api/plates/199%20TUN%204242', Object.assign({ Cookie: 'ida_owner=v1.abc.def' }, owner));
  ok(forged.status === 401, 'a forged cookie does not authenticate a granted read');

  // ---- the Bearer path is untouched ----
  var bearer = await request('GET', '/api/review/observations', { Authorization: 'Bearer ' + ADMIN_TOKEN });
  ok(bearer.status !== 401, 'a valid Bearer token still authenticates everything it did before');
  var anonRoute = await request('GET', '/api/review/observations');
  ok(anonRoute.status === 401, 'an anonymous request is still 401');

  // ---- logout ----
  var loggedOut = await request('POST', '/session/logout', Object.assign({ Cookie: cookie }, owner));
  ok(loggedOut.status === 204, 'logout is 204');
  ok(/Max-Age=0/.test(loggedOut.headers['set-cookie'][0]), 'logout expires the cookie');
  var loggedOutNoCookie = await request('POST', '/session/logout', owner);
  ok(loggedOutNoCookie.status === 204, 'logout works even with no cookie to clear');

  // ---- the public surface is untouched ----
  var publicRoute = await request('GET', '/public/passport/ivid:1:ABCDEFGHJKMNPQRS:AB');
  ok(publicRoute.status !== 401, 'the anonymous public passport route is still reached without credentials');
}

async function disabledHostCases() {
  console.log('\nUNCONFIGURED HOST — the mechanism must be inert');
  var saved = process.env.IDAUTO_SESSION_SECRET;
  delete process.env.IDAUTO_SESSION_SECRET;
  var owner = { 'X-IDauto-Owner': '1' };

  var state = await request('GET', '/session', owner);
  ok(state.status === 200 && state.body.owner === false, 'with no secret, GET /session answers owner:false');
  var enroll = await request('POST', '/session/enroll', Object.assign({ Authorization: 'Bearer ' + ADMIN_TOKEN }, owner));
  ok(enroll.status === 503, 'with no secret, enrolment is refused with 503');
  ok(!enroll.headers['set-cookie'], 'with no secret, no cookie is ever set');

  process.env.IDAUTO_SESSION_SECRET = saved;
}

async function main() {
  staticCases();

  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  try {
    await httpCases();
    await disabledHostCases();
  } finally {
    server.close();
  }

  console.log('\nIDA-V1B owner session: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
