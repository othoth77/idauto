'use strict';

/* IDA-ADMIN-5 — SECURITY & AUDIT.
 *
 * GET /api/admin/audit, GET /api/admin/accounts and /admin/security.
 * What this suite proves:
 *   - admin only (anonymous 401; service, manager, technician 403; the
 *     handler refuses an organisation principal on its own); read only;
 *   - the audit list never returns old/new values, ip_hash or request_id, and
 *     masks vin_digest; capture rows keep only event, actor type and day, and
 *     no actor/target filter can reach them;
 *   - every filter is exact against the database; bad filters are 400;
 *   - accounts never carry a password hash, a session token, a session's
 *     address or user agent; session counts and blocked accounts are exact;
 *   - auth decisions are counted by reason class, with no actor in the key.
 *
 * Refuses any database not named idauto_scratch_*.
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
var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var ORG = 'org-' + crypto.randomBytes(10).toString('hex');
var ADMIN_REF = 'usr_admin_sec_' + crypto.randomBytes(4).toString('hex');
var ORG_REF = 'svc_sec_' + crypto.randomBytes(4).toString('hex');
var identities = {};
identities[ADMIN] = ADMIN_REF;
identities[ORG] = { actor_ref: ORG_REF, org_id: 0, scopes: ['workshop:read', 'workshop:write', 'vehicle:read'] };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body ? JSON.stringify(opts.body) : null;
    var headers = Object.assign({ 'Content-Length': payload ? Buffer.byteLength(payload) : 0 }, opts.headers || {});
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () {
        var raw = Buffer.concat(c).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function asAdmin(method, p, body) { return request(method, p, { token: ADMIN, body: body }); }
function cookieOf(res) { var sc = res.headers['set-cookie']; if (!sc) return null; var c = [].concat(sc).map(function (x) { return x.split(';')[0]; }).filter(function (x) { return /session_token=/.test(x) && !/=;?$/.test(x); }); return c.length ? c.join('; ') : null; }
var ipBlock = crypto.randomInt(1, 250), ipCounter = 10;
var UA = 'SecTestAgent/' + crypto.randomBytes(4).toString('hex');
function login(email, password) {
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password },
    headers: { Origin: 'http://127.0.0.1:' + port, 'User-Agent': UA, 'X-Real-IP': '10.98.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }
function strip(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var TAG = 'SEC' + run;
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Garage ' + TAG])).rows[0].id;
  identities[ORG].org_id = org;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var authModule = require(path.join(BASE, 'reference', 'auth', 'auth.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = authModule.getAuth();
  var PW = 'Sec-Horse-' + run + '-2026';
  var users = { manager: 'sec-manager-' + run.toLowerCase() + '@idauto.test', tech: 'sec-tech-' + run.toLowerCase() + '@idauto.test',
    orphan: 'sec-orphan-' + run.toLowerCase() + '@idauto.test' };
  var ids = {};
  async function provision(key, role, orgId) {
    var created = await auth.api.signUpEmail({ body: { email: users[key], password: PW, name: 'Sec ' + key + ' ' + TAG } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, orgId, created.user.id]);
    ids[key] = created.user.id;
  }
  await provision('manager', 'manager', org);
  await provision('tech', 'technician', org);
  await provision('orphan', 'technician', null);
  // signUpEmail opens a session of its own; this suite counts sessions, so start from none.
  await db.query('DELETE FROM idauto_auth_session WHERE "userId" = ANY($1::text[])', [[ids.manager, ids.tech, ids.orphan]]);

  /* ===================================================================== */
  say('\n0. STRUCTURE');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'the read model contains no SQL write verb');
  var seg = strip((repoSrc.split('IDA-ADMIN-5 — SECURITY & AUDIT')[1] || '').replace(/^[\s\S]*?\*\//, ''));
  ok(seg.length > 0 && !/old_value_json|new_value_json|ip_hash|request_id/.test(seg), 'the audit read selects no old/new value, ip_hash or request_id');
  ok(!/idauto_auth_account|"password"|"token"|"ipAddress"|"userAgent"|accessToken|refreshToken|idToken/.test(seg), 'the account read touches no password, token, address or user agent');
  var ui = strip(fs.readFileSync(path.join(BASE, 'reference', 'admin-security-ui.js'), 'utf8'));
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(ui) && !/localStorage|sessionStorage|Authorization|Bearer/.test(ui), 'the page script renders no markup from strings, stores nothing, sends no token');
  ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(ui), 'the page script sends no write');
  var html = fs.readFileSync(path.join(BASE, 'reference', 'admin-security.html'), 'utf8');
  ok(!/<script>|<script [^>]*>[^<]|onclick=|style="/.test(html) && /lang="fr"/.test(html) && /href="\/admin\/security" aria-current="page"/.test(html), 'the page: no inline code, French, « Sécurité » current in the nav');
  var apiSrc = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var logFn = (apiSrc.split('function logAuthDecision(req, fields) {')[1] || '').split('\n}\n')[0];
  ok(/counters\.inc\('auth_denied:' \+ String\(fields\.reason \|\| 'unknown'\)\.split\(':'\)\[0\]\)/.test(logFn) && !/inc\([^)]*actor/.test(logFn), 'auth decisions are counted by reason class, never by actor');

  /* ===================================================================== */
  say('\n1. ACCESS');
  var ROUTES = ['/api/admin/audit', '/api/admin/accounts'];
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!managerCookie && !!techCookie, 'manager and technician sign in');
  for (var i = 0; i < ROUTES.length; i++) {
    ok((await request('GET', ROUTES[i])).status === 401, 'anonymous ' + ROUTES[i] + ' -> 401');
    ok((await request('GET', ROUTES[i], { token: ORG })).status === 403, 'organisation service credential ' + ROUTES[i] + ' -> 403');
    ok((await request('GET', ROUTES[i], withSession(managerCookie))).status === 403, 'manager session ' + ROUTES[i] + ' -> 403');
    ok((await request('GET', ROUTES[i], withSession(techCookie))).status === 403, 'technician session ' + ROUTES[i] + ' -> 403');
    ok((await request('POST', ROUTES[i], { token: ADMIN, body: {} })).status === 405, 'POST ' + ROUTES[i] + ' -> 405');
  }
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; }, decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  for (var r = 0; r < ROUTES.length; r++) {
    var h = inner.routes.filter(function (x) { return x.pattern.test(ROUTES[r]); })[0];
    var fr = {};
    await h.handler({ url: ROUTES[r], principal: { kind: 'organisation', org_id: org, scopes: identities[ORG].scopes } }, fr, ['']);
    ok(fr.status === 403, 'handler ' + ROUTES[r] + ' refuses an organisation principal on its own');
  }

  /* ===================================================================== */
  say('\n2. FIXTURES — through the real routes');
  var plate = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
  var VIN = 'VF1' + crypto.randomBytes(7).toString('hex').toUpperCase();
  var veh = (await asAdmin('POST', '/api/resolve/confirm', { plate: plate, vin: VIN, method: 'admin', candidate: { manufacturer: TAG, model: 'S', year: 2020 } })).body.vehicle;
  ok(!!veh && veh.vin_present === true, 'a vehicle with a VIN is identified');
  var SECRET = 'SECRET-' + run;
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(veh.id) + '/facts', { fact_key: 'category_code', fact_value: SECRET, access_scope: 'mythos_private' })).status === 201,
    'a restricted fact is written (its value is in the audit row\'s new_value_json)');
  ok((await asAdmin('POST', '/api/resolve/vin', { vin: VIN })).status === 200, 'a VIN search is made (audited with a vin_digest)');
  var visit = await request('POST', '/api/workshop/visits', { token: ORG, body: { plate: plate, plate_read_method: 'manual' } });
  ok(visit.status === 201, 'the organisation opens a visit (an org-scoped audit row)');
  var obs = await asAdmin('POST', '/api/observations', { vehicle_internal_ref: veh.internal_ref, status: 'pending_review' });
  ok(obs.status === 201, 'an observation is recorded (a capture row)');

  /* ===================================================================== */
  say('\n3. AUDIT');
  var all = await asAdmin('GET', '/api/admin/audit?actor=' + ADMIN_REF + '&page_size=100');
  ok(all.status === 200 && all.body.results.length > 0 && all.body.results.every(function (x) { return x.actor_ref === ADMIN_REF && !x.masked; }), 'actor=<admin> -> only that actor\'s rows, none masked');
  var allRaw = all.raw + (await asAdmin('GET', '/api/admin/audit?page_size=100')).raw;
  ok(allRaw.indexOf(SECRET) === -1 && allRaw.indexOf(VIN) === -1, 'neither the restricted value nor the VIN appears (no old/new value is returned)');
  ok(allRaw.indexOf(ADMIN) === -1 && allRaw.indexOf(ORG) === -1, 'no credential appears');
  var vinRow = (await asAdmin('GET', '/api/admin/audit?event=vehicle.search.vin&actor=' + ADMIN_REF)).body.results[0];
  ok(vinRow && /vin_digest=\[masqué\]/.test(vinRow.summary) && !/vin_digest=[0-9a-f]/.test(vinRow.summary), 'the VIN search row is listed with its digest masked');
  var raw1 = (await db.query("SELECT * FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' ORDER BY id DESC LIMIT 1")).rows[0];
  ok(!!raw1.change_summary && /vin_digest=[0-9a-f]+/.test(raw1.change_summary), '(the stored summary does carry a digest — the masking is real)');
  var keys = Object.keys(all.body.results[0]).sort().join();
  ok(keys === 'actor_name,actor_ref,actor_type,at,event_type,id,masked,org_id,org_name,summary,target_ref,target_type', 'a row carries exactly the listed fields (' + keys + ')');

  // Capture rows: masked, and unreachable through an actor or target filter.
  var cap = (await asAdmin('GET', '/api/admin/audit?event=observation.create&page_size=5')).body.results[0];
  var capDb = (await db.query("SELECT id, actor_ref, target_ref, event_time FROM idauto_audit_log WHERE event_type = 'observation.create' ORDER BY event_time DESC, id DESC LIMIT 1")).rows[0];
  ok(cap && cap.id === capDb.id && cap.masked === true && cap.actor_ref === null && cap.actor_name === null && cap.target_ref === null, 'a capture row is listed without actor and target');
  var at = new Date(cap.at);
  ok(at.getUTCHours() === 0 && at.getUTCMinutes() === 0 && at.getUTCSeconds() === 0 && at.toISOString().slice(0, 10) === new Date(capDb.event_time).toISOString().slice(0, 10), 'its time is cut to the day');
  ok(capDb.target_ref === String(obs.body.id) && (await asAdmin('GET', '/api/admin/audit?target=' + obs.body.id)).body.results.every(function (x) { return x.target_type !== 'idauto_observations'; }),
    'target=<observation id> never returns the capture row');
  ok(!(await asAdmin('GET', '/api/admin/audit?actor=' + ADMIN_REF + '&page_size=100')).body.results.some(function (x) { return x.id === capDb.id; }), 'actor=<its actor> never returns it either');
  ok((await asAdmin('GET', '/api/admin/audit?target_type=idauto_observations&page_size=100')).body.results.every(function (x) { return x.masked && x.actor_ref === null; }), 'target_type=idauto_observations lists only masked rows');

  // Filters, against the database.
  async function check(qs, sql, args, label) {
    var res = await asAdmin('GET', '/api/admin/audit?' + qs + '&page_size=1');
    var n = (await db.query('SELECT count(*)::int n FROM idauto_audit_log a WHERE ' + sql, args)).rows[0].n;
    ok(res.status === 200 && res.body.total === n, label + ' -> ' + n + ' (= database)');
  }
  await check('event=workshop.visit.create', "a.event_type = 'workshop.visit.create'", [], 'event exact');
  await check('event=workshop.', "a.event_type LIKE 'workshop.%'", [], 'event family workshop.');
  await check('actor_type=professional_user', "a.actor_type = 'professional_user'", [], 'actor_type');
  await check('org_id=' + org, 'a.org_id = $1', [org], 'org_id of this run');
  await check('target_type=idauto_vehicle_facts', "a.target_type = 'idauto_vehicle_facts'", [], 'target_type');
  var today = new Date().toISOString().slice(0, 10);
  await check('from=' + today + '&to=' + today, "a.event_time >= $1::date AND a.event_time < ($1::date + INTERVAL '1 day')", [today], 'from/to today');
  ok((await asAdmin('GET', '/api/admin/audit?org_id=' + org)).body.results.some(function (x) { return x.event_type === 'workshop.visit.create' && x.org_name === 'Garage ' + TAG && x.actor_ref === ORG_REF; }), 'the organisation\'s row names the organisation and its actor');
  ok((await asAdmin('GET', '/api/admin/audit?event=' + encodeURIComponent('workshop%'))).status === 400, 'a LIKE wildcard in event -> 400');
  var mgrLogin = await asAdmin('GET', '/api/admin/audit?actor=user:' + ids.manager);
  ok(mgrLogin.status === 200, 'actor=user:<id> is accepted');
  var p1 = await asAdmin('GET', '/api/admin/audit?page_size=2&page=1'), p2 = await asAdmin('GET', '/api/admin/audit?page_size=2&page=2');
  ok(p1.body.results.length === 2 && p2.body.results.length > 0 && p1.body.results.every(function (a) { return p2.body.results.every(function (b) { return a.id !== b.id; }); }), 'pages do not overlap');
  ok(p1.body.filters.event_types.indexOf('workshop.visit.create') !== -1 && p1.body.filters.actor_types.length === 5, 'the filter lists come from the log');
  var fam = await db.query("SELECT split_part(event_type, '.', 1) k, count(*)::int n FROM idauto_audit_log WHERE event_time > NOW() - INTERVAL '30 days' GROUP BY 1");
  ok(fam.rows.every(function (f) { return p1.body.last_30_days.by_family.some(function (x) { return x.k === f.k && x.n === f.n; }); }), '30-day counts by family equal the database');
  var bads = [['actor_type=root', 'an unknown actor_type'], ['event=Vehicle.Merge', 'an event with capitals'], ['org_id=x', 'a non-numeric org_id'], ['target_type=a;b', 'a target_type that is not a table name'],
    ['from=2026-02-30', 'an impossible date'], ['from=2026-10-02&to=2026-10-01', 'from after to'], ['page_size=101', 'page_size above 100'], ['actor=a%00', 'a NUL byte']];
  for (var b = 0; b < bads.length; b++) {
    var bad = await asAdmin('GET', '/api/admin/audit?' + bads[b][0]);
    ok(bad.status === 400 && typeof bad.body.message_fr === 'string', 'refuses ' + bads[b][1] + ' with 400');
  }

  /* ===================================================================== */
  say('\n4. ACCOUNTS');
  var before = (await asAdmin('GET', '/api/admin/accounts')).body;
  ok((await request('GET', '/api/admin/accounts')).status === 401, '(an anonymous request, to be counted)');
  var acc = await asAdmin('GET', '/api/admin/accounts?q=' + TAG);
  ok(acc.status === 200 && acc.body.results.length === 3, 'q=' + TAG + ' -> the 3 accounts of this run');
  var byKey = {};
  acc.body.results.forEach(function (u) { Object.keys(ids).forEach(function (k) { if (ids[k] === u.id) byKey[k] = u; }); });
  ok(byKey.manager.role === 'manager' && byKey.manager.org_name === 'Garage ' + TAG && byKey.manager.email === users.manager, 'manager: role, organisation, e-mail');
  ok(byKey.manager.active_sessions === 1 && !!byKey.manager.last_seen_at && byKey.tech.active_sessions === 1 && byKey.orphan.active_sessions === 0 && byKey.orphan.last_seen_at === null, 'sessions per account (1, 1, none)');
  ok(byKey.orphan.can_sign_in === false && byKey.manager.can_sign_in === true, 'a technician without an organisation is reported as unable to sign in');
  var hash = (await db.query('SELECT "password" FROM idauto_auth_account WHERE "userId" = $1', [ids.manager])).rows[0].password;
  var sess = (await db.query('SELECT "token", "userAgent" FROM idauto_auth_session WHERE "userId" = $1', [ids.manager])).rows[0];
  var accRaw = acc.raw + (await asAdmin('GET', '/api/admin/accounts')).raw;
  ok(!!hash && accRaw.indexOf(hash) === -1 && accRaw.indexOf(hash.split(':')[0]) === -1, 'no password hash (nor its salt)');
  ok(!!sess.token && accRaw.indexOf(sess.token) === -1, 'no session token');
  ok(sess.userAgent === UA && accRaw.indexOf(UA) === -1, 'no session user agent (stored, never returned)');
  ok(accRaw.indexOf(ADMIN) === -1 && accRaw.indexOf(ORG) === -1 && accRaw.indexOf(ORG_REF) === -1 && accRaw.indexOf(ADMIN_REF) === -1, 'no service credential and no actor_ref');
  var keysU = Object.keys(byKey.manager).sort().join();
  ok(keysU === 'active_sessions,can_sign_in,created_at,email,email_verified,id,last_seen_at,name,org_id,org_name,org_status,role', 'an account carries exactly the listed fields');
  var t = (await db.query('SELECT (SELECT count(*)::int FROM idauto_auth_user) a, (SELECT count(*)::int FROM idauto_auth_session WHERE "expiresAt" > NOW()) s, ' +
    '(SELECT count(*)::int FROM idauto_auth_user WHERE "role" <> \'admin\' AND "org_id" IS NULL) w')).rows[0];
  var after = (await asAdmin('GET', '/api/admin/accounts')).body;
  ok(after.totals.accounts === t.a && after.totals.active_sessions === t.s && after.totals.without_organisation === t.w, 'totals equal the database (accounts, active sessions, blocked)');
  ok((await asAdmin('GET', '/api/admin/accounts?role=technician&q=' + TAG)).body.results.length === 2, 'role=technician -> 2');
  ok((await asAdmin('GET', '/api/admin/accounts?role=root')).status === 400, 'an unknown role -> 400');
  var sc = after.service_credentials;
  ok(sc.admin_credentials === 1 && sc.organisations.length === 1 && sc.organisations[0].org_id === org && sc.organisations[0].credentials === 1, 'service credentials: counts and scopes only');
  var c0 = before.auth_decisions.counters, c1 = after.auth_decisions.counters;
  ok((c1['auth_denied:no_credentials'] || 0) - (c0['auth_denied:no_credentials'] || 0) === 1 && c1.auth_denied - c0.auth_denied === 1, 'the anonymous request is counted once, as no_credentials');
  ok(c1.auth_granted > c0.auth_granted && !!Date.parse(after.auth_decisions.since), 'granted decisions are counted, with the process start time');
  ok(Object.keys(c1).every(function (k) { return /^auth_(granted|denied)(:[a-z_]+)?$/.test(k); }), 'counter keys are decision + reason class only (' + Object.keys(c1).join(', ') + ')');

  /* ===================================================================== */
  say('\n5. PAGE');
  var pg = await request('GET', '/admin/security');
  var csp = pg.headers['content-security-policy'] || '';
  ok(pg.status === 200 && pg.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf("frame-ancestors 'none'") !== -1, '/admin/security -> 200, no-store, admin CSP');
  ok((await request('GET', '/admin/security/')).status === 200 && (await request('GET', '/admin/security-ui.js')).status === 200, 'the trailing-slash form and the script are served');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  await db.closePool();
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) {
  console.error('FATAL', err && err.stack || err);
  if (server) server.close();
  process.exit(1);
});
