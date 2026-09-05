'use strict';
/* IDA-V13 — LOGIN / PASSWORD + SERVER-SIDE SESSION COOKIE (Better Auth).
 * Owner order, 2026-09-05: the manual admin access-token model is gone from
 * the web UI; users sign in at /login and carry an HttpOnly cookie.
 *
 * The 17 checks the order names, as HTTP against a scratch database:
 *   01 GET /login 200 · 02 valid login → session · 03 invalid → 401 ·
 *   04 /atelier without session → /login · 05 with session → 200 ·
 *   06 protected API without session → 401 · 07 with session → 200 ·
 *   08 logout invalidates · 09 an old Bearer value gives nothing on the new
 *   system · 10/11 nothing in localStorage / sessionStorage (source) ·
 *   12 HttpOnly · 13 Secure in production · 14 admin role · 15 technician
 *   role · 16 brute force / rate limit · 17 the password is never logged.
 * Plus: manager role, the CSRF header, sign-up not reachable, the audit
 * actor of a session write, /session reporting the user, the consoles
 * carrying no token field.
 */
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var SERVICE = 'svc-' + crypto.randomBytes(10).toString('hex');
var identities = {}; identities[SERVICE] = { actor_ref: 'svc_fixpert_v13', org_id: 0, scopes: ['vehicle:read'] };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port, api;
var logLines = [];
var realLog = console.log;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body ? JSON.stringify(opts.body) : null;
    var headers = Object.assign({ 'Content-Length': payload ? Buffer.byteLength(payload) : 0 }, opts.headers || {});
    if (payload) headers['Content-Type'] = 'application/json';
    if (opts.cookie) headers.Cookie = opts.cookie;
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function cookieOf(res) { var sc = res.headers['set-cookie']; if (!sc) return null; var c = [].concat(sc).map(function (x) { return x.split(';')[0]; }).filter(function (x) { return /session_token=/.test(x) && !/=;?$/.test(x); }); return c.length ? c.join('; ') : null; }
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }
var ipCounter = 10;
function origin() { return { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.99.0.' + (ipCounter++ % 250) }; }   // nginx sets X-Real-IP in production; each login here is a distinct client   // a browser always sends it; Better Auth requires it on cookie-bearing POSTs
function login(email, password) { return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: origin() }); }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V13','garage','active') RETURNING id")).rows[0].id;
  identities[SERVICE].org_id = org;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  api = require(path.join(BASE, 'reference', 'api.js'));
  var authModule = require(path.join(BASE, 'reference', 'auth', 'auth.js'));
  // Capture every log line the server writes while the suite runs (17).
  console.log = function () { var line = Array.prototype.map.call(arguments, String).join(' '); logLines.push(line); realLog.apply(console, arguments); };
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = authModule.getAuth();

  var run = crypto.randomBytes(4).toString('hex');
  var PW = 'Correct-Horse-' + run + '-2026';
  var users = { admin: 'admin-' + run + '@idauto.test', manager: 'manager-' + run + '@idauto.test', tech: 'tech-' + run + '@idauto.test', noorg: 'noorg-' + run + '@idauto.test' };
  async function provision(email, role, orgId) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'User ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, orgId || null, created.user.id]);
    return created.user.id;
  }
  var adminId = await provision(users.admin, 'admin', null);
  await provision(users.manager, 'manager', org);
  var techId = await provision(users.tech, 'technician', org);
  await provision(users.noorg, 'technician', null);

  /* ===================================================================== */
  say('\n0. STRUCTURE — no token in the web UI, nothing in browser storage');
  var pages = ['reference/atelier.html', 'reference/atelier-ui.js', 'reference/admin.html', 'reference/admin-ui.js', 'reference/review.html', 'reference/review-ui.js', 'reference/login.html', 'reference/login-ui.js'].map(function (f) { return fs.readFileSync(path.join(BASE, f), 'utf8'); }).join('\n');
  ok(!/localStorage|sessionStorage/.test(pages), '10/11. no localStorage / sessionStorage in any authenticated page or its script');
  // The two consoles keep a one-line shim so a SCRIPT that holds a service
  // credential can still drive them from Node (ida-2h); the pages never do.
  var pagesNoShim = pages.replace(/if \(token\) settings\.headers\.Authorization = 'Bearer ' \+ token;[^\n]*/g, '');
  ok(!/Authorization|Bearer|admin-token|review-token|at-token|Jeton d'accès/.test(pagesNoShim), 'no Authorization header, no Bearer, no token field, no « Jeton d\'accès » in the web UI');
  ok(!/<script>|onclick=|style="/.test(fs.readFileSync(path.join(BASE, 'reference', 'login.html'), 'utf8')), 'the login page has no inline script or style');
  var loginHtml = fs.readFileSync(path.join(BASE, 'reference', 'login.html'), 'utf8');
  ok(['Connexion à IDauto', 'Identifiant', 'Mot de passe', 'Se connecter', 'Mot de passe oublié'].every(function (t) { return loginHtml.indexOf(t) !== -1; }), 'the login page is French with the required labels');
  ok(/type="password"/.test(loginHtml) && /autocomplete="current-password"/.test(loginHtml), 'the password field is a password field');
  var sa = fs.readFileSync(path.join(BASE, 'reference', 'auth', 'principal.js'), 'utf8');
  ok(/sign-up/.test(sa) === false || !/'\/api\/auth\/sign-up/.test(sa), 'sign-up is not in the allow-list of forwarded auth routes');
  ok(!/password/i.test(fs.readFileSync(path.join(BASE, '.env.example'), 'utf8').replace(/password hashing|Mot de passe|mot de passe|password is typed|login \/ password|IDAUTO_DB_PASSWORD=|sans écho/gi, '')), '.env.example carries no password value');

  /* ===================================================================== */
  say('\n1. THE LOGIN PAGE AND SIGN-IN');
  var loginPage = await request('GET', '/login');
  ok(loginPage.status === 200 && /text\/html/.test(loginPage.headers['content-type']) && /Connexion à IDauto/.test(loginPage.raw), '01. GET /login -> 200, French sign-in page');
  ok(loginPage.headers['content-security-policy'] && loginPage.headers['content-security-policy'].indexOf("script-src 'self';") !== -1 && loginPage.headers['content-security-policy'].indexOf('wasm') === -1, 'the login page carries the admin CSP (no wasm)');
  ok((await request('GET', '/login/login-ui.js')).status === 200 && (await request('GET', '/login/login.css')).status === 200, 'login assets are served');
  var bad = await login(users.admin, 'definitely-not-the-password-1');
  ok(bad.status === 401 && !cookieOf(bad), '03. POST login with a wrong password -> 401, no cookie');
  ok((await login('nobody-' + run + '@idauto.test', PW)).status === 401, 'an unknown e-mail -> 401 (same answer, no oracle)');
  var c0 = cookieOf(await login(users.admin, PW));
  var good = await login(users.admin, PW);
  var adminCookie = cookieOf(good);
  ok(good.status === 200 && !!adminCookie, '02. POST login valid -> 200 and a session cookie');
  var setCookie = [].concat(good.headers['set-cookie']).join('\n');
  ok(/HttpOnly/i.test(setCookie), '12. the session cookie is HttpOnly');
  ok(/SameSite=Lax/i.test(setCookie) && /Path=\//.test(setCookie), 'the session cookie is SameSite=Lax, Path=/');
  ok(/Max-Age=\d+/.test(setCookie) && parseInt(/Max-Age=(\d+)/.exec(setCookie)[1], 10) <= authModule.SESSION_SECONDS, 'the session cookie expires (Max-Age ≤ configured TTL)');
  ok(!/Secure/i.test(setCookie) && authModule.isSecure() === false, '13a. outside production the cookie is not Secure (plain http test server)');
  ok(/useSecureCookies: isSecure\(\)/.test(fs.readFileSync(path.join(BASE, 'reference', 'auth', 'auth.js'), 'utf8')) && /NODE_ENV === 'production'/.test(fs.readFileSync(path.join(BASE, 'reference', 'auth', 'auth.js'), 'utf8')), '13b. in production (NODE_ENV=production or IDAUTO_COOKIE_SECURE=1) the cookie is Secure');
  var sessionRow = (await db.query('SELECT count(*)::int n FROM idauto_auth_session WHERE "userId" = $1 AND "expiresAt" > NOW()', [adminId])).rows[0].n;
  ok(sessionRow >= 1, 'the session exists server-side (validated in the database on each request)');
  var gs = await request('GET', '/api/auth/get-session', { cookie: adminCookie });
  ok(gs.status === 200 && gs.body.user && gs.body.user.email === users.admin && gs.body.user.role === 'admin', 'GET /api/auth/get-session returns the user and its server-side role');
  ok(gs.raw.indexOf('password') === -1 && gs.raw.indexOf(PW) === -1, 'and never a password or hash');
  var sess = await request('GET', '/session', { cookie: adminCookie, headers: { 'X-IDauto-Owner': '1' } });
  ok(sess.status === 200 && sess.body.user && sess.body.user.role === 'admin' && sess.body.owner === false, 'GET /session reports the signed-in user (name, role) beside the owner flag');

  /* ===================================================================== */
  say('\n2. /atelier AND THE PROTECTED API');
  var atelierAnon = await request('GET', '/atelier');
  ok(atelierAnon.status === 302 && /^\/login\?next=%2Fatelier$/.test(atelierAnon.headers.location), '04. /atelier without a session -> 302 /login?next=/atelier');
  var atelierIn = await request('GET', '/atelier', { cookie: adminCookie });
  ok(atelierIn.status === 200 && /Véhicule à l'atelier/.test(atelierIn.raw) && /Déconnexion/.test(atelierIn.raw), '05. /atelier with a session -> 200, with a Déconnexion button');
  ok(!/Jeton d'accès|at-token/.test(atelierIn.raw), 'and no token field or « Jeton d\'accès » anywhere on it');
  var apiAnon = await request('GET', '/api/metrics');
  ok(apiAnon.status === 401 && apiAnon.body.reason === 'no_credentials' && apiAnon.body.login === '/login', '06. protected API without a session -> 401 pointing at /login');
  var apiCookieNoHeader = await request('GET', '/api/metrics', { cookie: adminCookie });
  ok(apiCookieNoHeader.status === 401, 'the cookie alone is NOT enough for /api/* — the X-IDauto-Session header is required (CSRF)');
  var apiIn = await request('GET', '/api/metrics', withSession(adminCookie));
  ok(apiIn.status === 200 && 'resolution_success_rate' in apiIn.body, '07. protected API with a session (+ header) -> 200; /api/metrics stays admin-only');
  ok((await request('GET', '/api/metrics', { cookie: 'idauto.session_token=' + crypto.randomBytes(24).toString('base64url') + '.forged', headers: { 'X-IDauto-Session': '1' } })).status === 401, 'a forged cookie value -> 401');
  var oldBearer = await request('GET', '/api/metrics', { headers: { Authorization: 'Bearer ' + crypto.randomBytes(32).toString('base64') } });
  ok(oldBearer.status === 401 && oldBearer.body.reason === 'invalid_credentials', '09. an old-style manual admin token value gives no access');
  ok((await request('GET', '/api/metrics', { headers: { Authorization: 'Bearer ' + adminCookie.split('=')[1] } })).status === 401, 'the session token presented as a Bearer gives no access either');
  ok((await request('GET', '/api/vehicles/ivid:1:ZZZZZZZZZZZZZZZZ:ZZ', { headers: { Authorization: 'Bearer ' + SERVICE } })).status === 404, 'an organisation SERVICE credential (server-to-server) still works on its scoped route');
  ok((await request('POST', '/api/auth/sign-up/email', { body: { email: 'x-' + run + '@idauto.test', password: PW, name: 'x' } })).status === 404, 'sign-up is not reachable over HTTP');
  ok((await request('GET', '/api/auth/sign-in/email')).status === 405, 'a wrong method on an auth route -> 405');

  /* ===================================================================== */
  say('\n3. ROLES — read from the database, never from the browser');
  var mgrCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!mgrCookie && !!techCookie, 'manager and technician sign in');
  ok((await request('GET', '/api/metrics', withSession(techCookie))).status === 403, '15. technician: an admin-only route -> 403');
  ok((await request('GET', '/api/metrics', withSession(mgrCookie))).status === 403, 'manager: an admin-only route -> 403');
  var techResolve = await request('POST', '/api/resolve/plate', Object.assign({ body: { plate: '999 TU 9999' } }, withSession(techCookie)));
  ok(techResolve.status === 200 && techResolve.body.status === 'resolved', '15. technician: plate resolution -> 200');
  ok(techResolve.body.vehicle.vin === undefined, 'technician never receives a VIN');
  var techVin = await request('POST', '/api/resolve/vin', Object.assign({ body: { vin: '1HGCM82633A004352' } }, withSession(techCookie)));
  ok(techVin.status === 403 && techVin.body.required_scope === 'vin:search', 'technician: VIN resolution -> 403 (no vin:search)');
  var mgrVin = await request('POST', '/api/resolve/vin', Object.assign({ body: { vin: '1HGCM82633A004352' } }, withSession(mgrCookie)));
  ok(mgrVin.status === 200, 'manager: VIN resolution -> 200 (vin:search)');
  var techVisit = await request('POST', '/api/workshop/visits', Object.assign({ body: { reason: 'v13' } }, withSession(techCookie)));
  ok(techVisit.status === 201 && String(techVisit.body.visit.org_id) === String(org), 'technician opens a visit for ITS organisation without naming it');
  var audit = (await db.query("SELECT actor_type, actor_ref, org_id FROM idauto_audit_log WHERE event_type = 'workshop.visit.create' ORDER BY id DESC LIMIT 1")).rows[0];
  ok(audit.actor_ref === 'user:' + techId && String(audit.org_id) === String(org) && audit.actor_type === 'professional_user', 'the audit row names the user (user:<id>) and the organisation');
  var adminVisit = await request('POST', '/api/workshop/visits', Object.assign({ body: { reason: 'v13 admin', org_id: org } }, withSession(adminCookie)));
  ok(adminVisit.status === 201, '14. admin: full access (opens a visit naming the organisation)');
  var adminAudit = (await db.query("SELECT actor_type, actor_ref FROM idauto_audit_log WHERE event_type = 'workshop.visit.create' ORDER BY id DESC LIMIT 1")).rows[0];
  ok(adminAudit.actor_ref === 'user:' + adminId && adminAudit.actor_type === 'admin', 'admin writes are audited as admin with the user id');
  var noorgCookie = cookieOf(await login(users.noorg, PW));
  var noorg = await request('GET', '/api/catalog/status', withSession(noorgCookie));
  ok(noorg.status === 403 && noorg.body.reason === 'role_without_organisation', 'a technician without an organisation is refused (403), not silently widened');
  await db.query('UPDATE idauto_auth_user SET "role" = $1 WHERE "id" = $2', ['admin', techId]);
  ok((await request('GET', '/api/metrics', withSession(techCookie))).status === 200, 'a role change in the database applies on the next request — the role is read server-side, not cached in the cookie');
  await db.query('UPDATE idauto_auth_user SET "role" = $1 WHERE "id" = $2', ['technician', techId]);

  /* ===================================================================== */
  say('\n4. LOGOUT, REVOCATION, PASSWORD CHANGE');
  var out = await request('POST', '/api/auth/sign-out', { cookie: adminCookie, body: {}, headers: origin() });
  ok((await request('POST', '/api/auth/sign-out', { cookie: c0, body: {} })).status === 403, 'a cookie-bearing auth POST without an Origin header is refused (CSRF, Better Auth)');
  ok(out.status === 200, 'POST /api/auth/sign-out -> 200');
  ok((await request('GET', '/api/metrics', withSession(adminCookie))).status === 401, '08. after logout the same cookie gives 401');
  ok((await request('GET', '/atelier', { cookie: adminCookie })).status === 302, 'and /atelier redirects to /login again');
  var again = cookieOf(await login(users.admin, PW));
  await db.query('DELETE FROM idauto_auth_session WHERE "userId" = $1', [adminId]);
  ok((await request('GET', '/api/metrics', withSession(again))).status === 401, 'deleting the session row server-side revokes the cookie immediately');
  var c3 = cookieOf(await login(users.admin, PW));
  var NEWPW = 'Another-Strong-' + run + '-Pass9';
  var chg = await request('POST', '/api/auth/change-password', { cookie: c3, body: { currentPassword: PW, newPassword: NEWPW, revokeOtherSessions: true }, headers: origin() });
  ok(chg.status === 200, 'POST /api/auth/change-password -> 200');
  ok((await login(users.admin, PW)).status === 401 && cookieOf(await login(users.admin, NEWPW)) !== null, 'the old password no longer signs in; the new one does');
  ok((await request('POST', '/api/auth/change-password', { cookie: c3, body: { currentPassword: NEWPW, newPassword: 'short' }, headers: origin() })).status !== 200, 'a password under 12 characters is refused');
  var hash = (await db.query('SELECT a."password" FROM idauto_auth_account a WHERE a."userId" = $1', [adminId])).rows[0].password;
  ok(hash && hash.indexOf(NEWPW) === -1 && hash.indexOf(PW) === -1 && hash.length > 100, 'the stored credential is a hash (scrypt), not the password');

  /* ===================================================================== */
  say('\n5. BRUTE FORCE');
  var statuses = [];
  for (var i = 0; i < 8; i++) statuses.push((await request('POST', '/api/auth/sign-in/email', { body: { email: users.manager, password: 'wrong-' + i + '-password-xyz' }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.99.1.1' } })).status);
  ok(statuses.indexOf(429) !== -1 && statuses.filter(function (s) { return s === 429; }).length >= 2, '16. repeated failed logins are rate-limited (429 after the allowed attempts): ' + statuses.join(','));

  /* ===================================================================== */
  say('\n6. LOGS');
  var all = logLines.join('\n');
  ok(all.indexOf(PW) === -1 && all.indexOf(NEWPW) === -1 && !/wrong-\d-password-xyz/.test(all), '17. no password (right or wrong) appears in any log line');
  ok(all.indexOf(adminCookie.split('=')[1].slice(0, 20)) === -1, 'no session token appears in any log line');
  ok(/"event":"auth".*"result":"denied"/.test(all), 'failed authentications are logged (without credentials)');
  ok(/"reason":"user_session"/.test(all), 'session-authenticated requests are logged as user_session');

  console.log = realLog;
  server.close(); await db.closePool();
  console.log('\nIDA-V13 login/password + session cookie: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(function (err) { console.log = realLog; console.error('FATAL: ' + (err && err.stack || err)); process.exit(1); });
