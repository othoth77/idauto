'use strict';

/* IDA-ADMIN-6 — DASHBOARD.
 *
 * GET /api/admin/dashboard and /admin/dashboard.
 * What this suite proves:
 *   - admin only (anonymous 401; service, manager, technician 403; the
 *     handler refuses an organisation principal on its own); read only;
 *   - every tile is the number its module reports (the module routes are the
 *     reference) and moves with the data;
 *   - every tile's link is a filter the target module accepts (200, not 400);
 *   - the recent activity keeps a capture row to its day, like the audit list;
 *   - no credential, VIN or restricted value appears.
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
var ADMIN_REF = 'usr_admin_dash_' + crypto.randomBytes(4).toString('hex');
var ORG_REF = 'svc_dash_' + crypto.randomBytes(4).toString('hex');
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
function login(email, password) {
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.99.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }
function strip(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
function sum(map) { return Object.keys(map || {}).reduce(function (s, k) { return s + map[k]; }, 0); }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var TAG = 'DSH' + run;
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
  var PW = 'Dsh-Horse-' + run + '-2026';
  var users = { manager: 'dsh-manager-' + run.toLowerCase() + '@idauto.test', tech: 'dsh-tech-' + run.toLowerCase() + '@idauto.test' };
  async function provision(email, role) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'Dsh ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, org, created.user.id]);
  }
  await provision(users.manager, 'manager');
  await provision(users.tech, 'technician');

  /* ===================================================================== */
  say('\n0. STRUCTURE');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'the read model contains no SQL write verb');
  var uiRaw = fs.readFileSync(path.join(BASE, 'reference', 'admin-dashboard-ui.js'), 'utf8');
  var ui = strip(uiRaw);
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(ui) && !/localStorage|sessionStorage|Authorization|Bearer/.test(ui), 'the page script renders no markup from strings, stores nothing, sends no token');
  ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(ui) && (ui.match(/C\.api\(/g) || []).length === 1 && ui.indexOf("C.api('/api/admin/dashboard')") !== -1, 'the page script makes one read, GET /api/admin/dashboard, and no write');
  ok(!/tile\([^)]*,\s*\d+\s*,/.test(ui), 'no tile is given a literal number');
  var html = fs.readFileSync(path.join(BASE, 'reference', 'admin-dashboard.html'), 'utf8');
  ok(!/<script>|<script [^>]*>[^<]|onclick=|style="/.test(html) && /lang="fr"/.test(html) && /data-admin-sidebar /.test(html), 'the page: no inline code, French, the shared sidebar slot');
  var shellNav = require(path.join(BASE, 'reference', 'admin-shell.js'));
  ok(shellNav.locate('/admin/dashboard').item === null, '/admin/dashboard: out of the simplified menu (IDA-UI-4), still served');
  var pages = ['admin.html', 'review.html', 'admin-vehicles.html', 'admin-vehicle.html', 'admin-maintenance.html', 'admin-sources.html', 'admin-quality.html', 'admin-security.html', 'admin-dashboard.html'];
ok(pages.every(function (f) { var h = fs.readFileSync(path.join(BASE, 'reference', f), 'utf8'); return (h.match(/<aside class="ida-admin-sidebar" data-admin-sidebar /g) || []).length === 1 && (h.match(/<script src="\/admin\/shell\.js"><\/script>/g) || []).length === 1 && !/ida-nav-links|aria-current=/.test(h); }),
    'all ' + pages.length + ' console pages carry the one shared sidebar slot and load the shell once, with no menu of their own');
  ok(shellNav.NAV[0].href === '/atelier/tableau-de-bord' && shellNav.NAV[0].label === 'Tableau de bord', 'the shared navigation opens with the dashboard (one dashboard for every role)');

  /* ===================================================================== */
  say('\n1. ACCESS');
  var R = '/api/admin/dashboard';
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!managerCookie && !!techCookie, 'manager and technician sign in');
  ok((await request('GET', R)).status === 401, 'anonymous -> 401');
  ok((await request('GET', R, { token: ORG })).status === 403, 'organisation service credential -> 403');
  ok((await request('GET', R, withSession(managerCookie))).status === 403, 'manager session -> 403');
  ok((await request('GET', R, withSession(techCookie))).status === 403, 'technician session -> 403');
  ok((await request('POST', R, { token: ADMIN, body: {} })).status === 405, 'POST -> 405');
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; }, decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  var h = inner.routes.filter(function (x) { return x.pattern.test(R); })[0];
  var fr = {};
  await h.handler({ url: R, principal: { kind: 'organisation', org_id: org, scopes: identities[ORG].scopes } }, fr, ['']);
  ok(fr.status === 403, 'the handler refuses an organisation principal on its own');
  var pg = await request('GET', '/admin/dashboard');
  var csp = pg.headers['content-security-policy'] || '';
  ok(pg.status === 200 && pg.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf("frame-ancestors 'none'") !== -1, '/admin/dashboard -> 200, no-store, admin CSP');
  ok((await request('GET', '/admin/dashboard/')).status === 200 && (await request('GET', '/admin/dashboard-ui.js')).status === 200, 'the trailing-slash form and the script are served');

  /* ===================================================================== */
  say('\n2. EVERY TILE IS ITS MODULE\'S NUMBER');
  async function same(label, a, b) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (' + JSON.stringify(a) + ')'); }
  var d = (await asAdmin('GET', R)).body;
  var ov = (await asAdmin('GET', '/api/admin/overview')).body;
  var ql = (await asAdmin('GET', '/api/admin/quality')).body;
  var mt = (await asAdmin('GET', '/api/admin/maintenance?page_size=1')).body;
  var og = (await asAdmin('GET', '/api/admin/organisations?page_size=1')).body;
  var ac = (await asAdmin('GET', '/api/admin/accounts')).body;
  var vr = (await asAdmin('GET', '/api/admin/vehicles?verified=true&page_size=1')).body;
  var vc = (await asAdmin('GET', '/api/admin/vehicles?fiche_status=conflict&page_size=1')).body;
  same('vehicles = overview', [d.vehicles.canonical, d.vehicles.verified, d.vehicles.merged, d.vehicles.plates_active], [ov.vehicles.canonical, ov.vehicles.verified, ov.vehicles.merged, ov.plates.active]);
  same('verified = the registry filtered verified=true', d.vehicles.verified, vr.total);
  same('fiches in conflict = the registry filtered fiche_status=conflict', d.vehicles.fiche_by_status.conflict || 0, vc.total);
  same('quality = /api/admin/quality totals', d.quality, ql.totals);
  same('pending observations = the quality backlog', [d.review.pending_review, d.review.pending_confirmation], [ql.review.pending_review, ql.review.pending_confirmation]);
  same('visits and unidentified visits = maintenance totals', [sum(d.maintenance.visits_by_status), d.maintenance.unidentified_visits, d.maintenance.service_events], [mt.totals.visits, mt.totals.unidentified_visits, mt.totals.service_events]);
  same('operations = maintenance totals', sum(d.maintenance.operations_by_type), mt.totals.operations);
  same('organisations by status = the ateliers page', d.workshops.organisations_by_status, og.by_status);
  same('accounts = the security page', d.security.accounts, ac.totals);
  same('service credentials = the security page', [d.security.service_credentials.admin_credentials, d.security.service_credentials.organisations], [ac.service_credentials.admin_credentials, ac.service_credentials.organisations.length]);
  var a30 = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_time > NOW() - INTERVAL '30 days'")).rows[0].n;
  ok(Math.abs(d.security.audit_30d.total - a30) <= 2, 'audited writes over 30 days = the database (' + d.security.audit_30d.total + ' / ' + a30 + ', the reads above may add rows)');
  var act = (await db.query("SELECT count(DISTINCT org_id)::int n FROM idauto_workshop_visits WHERE opened_at > NOW() - INTERVAL '30 days'")).rows[0].n;
  same('active workshops over 30 days = the database', d.workshops.active_30d, act);
  ok(d.health.database === 'ok' && typeof d.health.vehicle_providers_configured === 'number' && !!Date.parse(d.generated_at), 'health and generation time are reported');

  say('\n3. THE TILES MOVE WITH THE DATA');
  var plate = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
  var VIN = 'VF1' + crypto.randomBytes(7).toString('hex').toUpperCase();
  var veh = (await asAdmin('POST', '/api/resolve/confirm', { plate: plate, vin: VIN, method: 'admin', candidate: { manufacturer: TAG, model: 'S', year: 2020 } })).body.vehicle;
  ok(!!veh, 'a vehicle is identified');
  ok((await request('POST', '/api/workshop/visits', { token: ORG, body: { plate: plate, plate_read_method: 'manual' } })).status === 201, 'the organisation opens a visit');
  ok((await request('POST', '/api/workshop/visits', { token: ORG, body: { plate: plate, plate_read_method: 'manual' } })).status === 201, 'and a second one (one atelier, two visits)');
  var obs = await asAdmin('POST', '/api/observations', { vehicle_internal_ref: veh.internal_ref, status: 'pending_review' });
  ok(obs.status === 201, 'an observation waits for review');
  await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','pending')", ['Garage ' + TAG + ' attente']);
  var d2 = (await asAdmin('GET', R)).body;
  same('identities +1', d2.vehicles.canonical - d.vehicles.canonical, 1);
  same('open visits +2', (d2.maintenance.visits_by_status.open || 0) - (d.maintenance.visits_by_status.open || 0), 2);
  same('pending observations +1', d2.review.pending_review - d.review.pending_review, 1);
  same('pending organisations +1', (d2.workshops.organisations_by_status.pending || 0) - (d.workshops.organisations_by_status.pending || 0), 1);
  var act2 = (await db.query("SELECT count(DISTINCT org_id)::int n FROM idauto_workshop_visits WHERE opened_at > NOW() - INTERVAL '30 days'")).rows[0].n;
  ok(d2.maintenance.visits_30d - d.maintenance.visits_30d === 2 && d2.workshops.active_30d === act2, 'visits over 30 days +2; active ateliers = distinct organisations (' + act2 + '), not visits');
  var cap = d2.recent_activity.filter(function (a) { return a.event_type === 'observation.create'; })[0];
  var capAt = cap ? new Date(cap.at) : null;
  ok(cap && cap.masked === true && capAt.getUTCHours() === 0 && capAt.getUTCMinutes() === 0 && capAt.getUTCSeconds() === 0, 'recent activity: the capture row keeps its day only');
  ok(d2.recent_activity.every(function (a) { return Object.keys(a).sort().join() === 'actor_type,at,event_type,masked,org_id,target_type'; }), 'recent activity rows carry no actor reference and no target');
  var raw = JSON.stringify(d2);
  ok(raw.indexOf(VIN) === -1 && raw.indexOf(ADMIN) === -1 && raw.indexOf(ORG) === -1 && raw.indexOf(ADMIN_REF) === -1 && raw.indexOf(ORG_REF) === -1, 'no VIN, credential or actor reference in the response');

  say('\n4. EVERY TILE LINK IS A FILTER ITS MODULE ACCEPTS');
  var PAGE_API = { '/admin/vehicles': '/api/admin/vehicles', '/admin/maintenance': '/api/admin/maintenance', '/admin/sources': '/api/admin/organisations',
    '/admin/quality': '/api/admin/quality', '/admin/security': '/api/admin/audit', '/admin/review': '/api/review/observations' };
  var hrefs = [];
  (uiRaw.match(/'\/admin\/[a-z]+(\?[^']*)?'(\s*\+\s*encodeURIComponent\(VIN_READ\))?/g) || []).forEach(function (m) {
    var u = m.replace(/^'|'(\s*\+.*)?$/g, '');
    if (/encodeURIComponent\(VIN_READ\)/.test(m)) u += encodeURIComponent('vehicle.vin.read');
    if (hrefs.indexOf(u) === -1) hrefs.push(u);
  });
  ok(hrefs.length >= 15, hrefs.length + ' distinct links found in the page script');
  for (var i = 0; i < hrefs.length; i++) {
    var parts = hrefs[i].split('?'), apiPath = PAGE_API[parts[0]];
    if (!apiPath) { ok(['/admin/dashboard'].indexOf(parts[0]) !== -1, hrefs[i] + ' is a known console page'); continue; }
    var res = await asAdmin('GET', apiPath + (parts[1] ? '?' + parts[1] : ''));
    ok(res.status === 200, hrefs[i] + ' -> ' + apiPath + ' answers ' + res.status);
  }

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
