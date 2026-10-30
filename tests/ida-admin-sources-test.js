'use strict';

/* IDA-ADMIN-3 — ATELIERS & DATA SOURCES.
 *
 * GET /api/admin/organisations, GET /api/admin/sources and /admin/sources.
 * What this suite proves:
 *   - admin only (anonymous 401; service, manager, technician 403; the
 *     handler refuses an organisation principal on its own);
 *   - never returned: an organisation's contact e-mail or tax id (presence
 *     flags only), any service credential, any actor_ref;
 *   - every count equals the database; filters, sort and paging are exact;
 *   - providers and the parts catalogue are reported as configured — here,
 *     not configured — never invented.
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
var BROKEN = 'brk-' + crypto.randomBytes(10).toString('hex');
var ADMIN_REF = 'usr_admin_src_' + crypto.randomBytes(4).toString('hex');
var ORG_REF = 'svc_src_' + crypto.randomBytes(4).toString('hex');
var identities = {};
identities[ADMIN] = ADMIN_REF;
identities[ORG] = { actor_ref: ORG_REF, org_id: 0, scopes: ['workshop:read', 'vehicle:read', 'workshop:write'] };
identities[BROKEN] = { actor_ref: 'svc_broken', org_id: 0, scopes: ['*'] };   // '*' is refused for an organisation → invalid

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
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.96.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var TAG = 'SRC' + run;
  var EMAIL = 'contact-' + run.toLowerCase() + '@garage.example';
  var TAX = 'MF' + run + '9Z';
  var gov = (await db.query('SELECT id, name_fr FROM idauto_governorates ORDER BY id LIMIT 1')).rows[0];
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status, address_city, governorate_id, contact_email, tax_id, is_fixpert_pilot, verified_at) VALUES ($1,'garage','active','Sfax',$2,$3,$4,TRUE,NOW()) RETURNING id",
    ['Garage ' + TAG + ' Alpha', gov ? gov.id : null, EMAIL, TAX])).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'insurer','pending') RETURNING id", ['Assurance ' + TAG + ' Beta'])).rows[0].id;
  var orgC = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','suspended') RETURNING id", ['Garage ' + TAG + ' 100% Gamma'])).rows[0].id;
  identities[ORG].org_id = orgA;
  identities[BROKEN].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  var identity = require(path.join(BASE, 'reference', 'identity.js'));
  identity.clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var authModule = require(path.join(BASE, 'reference', 'auth', 'auth.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = authModule.getAuth();
  var PW = 'Src-Horse-' + run + '-2026';
  var users = { manager: 'src-manager-' + run.toLowerCase() + '@idauto.test', tech: 'src-tech-' + run.toLowerCase() + '@idauto.test' };
  async function provision(email, role, orgId) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'Src ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, orgId || null, created.user.id]);
  }
  await provision(users.manager, 'manager', orgA);
  await provision(users.tech, 'technician', orgA);

  /* ===================================================================== */
  say('\n0. STRUCTURE');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'the read model contains no SQL write verb');
  // The marker sits inside the section's header comment: drop the rest of that comment first.
  var seg = (repoSrc.split('IDA-ADMIN-3 — ATELIERS & DATA SOURCES')[1] || '').replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(seg.length > 0 && !/\bcontact_email\b/.test(seg.replace(/\(o\.contact_email IS NOT NULL AND o\.contact_email <> \\'\\'\)/, '')), 'contact_email is read only as a presence test');
  ok(!/\btax_id\b/.test(seg.replace(/\(o\.tax_id IS NOT NULL AND o\.tax_id <> \\'\\'\)/, '')), 'tax_id is read only as a presence test');
  ok(!/"email"|"name"|password|"id" =/.test(seg), 'no auth user column but role and org_id is read (no e-mail, name or password)');
  var summary = identity.credentialSummary();
  var sumRaw = JSON.stringify(summary);
  ok(sumRaw.indexOf(ADMIN) === -1 && sumRaw.indexOf(ORG) === -1 && sumRaw.indexOf(BROKEN) === -1 && sumRaw.indexOf(ADMIN_REF) === -1 && sumRaw.indexOf(ORG_REF) === -1,
    'identity.credentialSummary() contains no credential and no actor_ref');
  ok(summary.admin_credentials === 1 && summary.invalid_entries === 1 && summary.organisations.length === 1 && summary.organisations[0].org_id === orgA && summary.organisations[0].credentials === 1,
    'it counts 1 admin, 1 organisation credential, and the entry the gate refuses as invalid');
  ok(JSON.stringify(summary.organisations[0].scopes) === JSON.stringify(['vehicle:read', 'workshop:read', 'workshop:write']), 'scopes are listed, sorted');
  var ui = fs.readFileSync(path.join(BASE, 'reference', 'admin-sources-ui.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(ui) && !/localStorage|sessionStorage|Authorization|Bearer/.test(ui), 'the page script renders no markup from strings, stores nothing, sends no token');
  var html = fs.readFileSync(path.join(BASE, 'reference', 'admin-sources.html'), 'utf8');
  ok(!/<script>|<script [^>]*>[^<]|onclick=|style="/.test(html) && /lang="fr"/.test(html) && /href="\/admin\/sources" aria-current="page"/.test(html), 'the page: no inline code, French, « Ateliers » current in the nav');

  /* ===================================================================== */
  say('\n1. ACCESS');
  var ROUTES = ['/api/admin/organisations', '/api/admin/sources'];
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!managerCookie && !!techCookie, 'manager and technician sign in');
  for (var i = 0; i < ROUTES.length; i++) {
    ok((await request('GET', ROUTES[i])).status === 401, 'anonymous ' + ROUTES[i] + ' -> 401');
    ok((await request('GET', ROUTES[i], { token: ORG })).status === 403, 'organisation service credential ' + ROUTES[i] + ' -> 403');
    ok((await request('GET', ROUTES[i], { token: BROKEN })).status === 401, 'an invalid map entry ' + ROUTES[i] + ' -> 401 (fails closed)');
    ok((await request('GET', ROUTES[i], withSession(managerCookie))).status === 403, 'manager session ' + ROUTES[i] + ' -> 403');
    ok((await request('GET', ROUTES[i], withSession(techCookie))).status === 403, 'technician session ' + ROUTES[i] + ' -> 403');
    ok((await request('POST', ROUTES[i], { token: ADMIN, body: {} })).status === 405, 'POST ' + ROUTES[i] + ' -> 405');
  }
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; }, decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  for (var r = 0; r < ROUTES.length; r++) {
    var h = inner.routes.filter(function (x) { return x.pattern.test(ROUTES[r]); })[0];
    var fr = {};
    await h.handler({ url: ROUTES[r], principal: { kind: 'organisation', org_id: orgA, scopes: identities[ORG].scopes } }, fr, ['']);
    ok(fr.status === 403, 'handler ' + ROUTES[r] + ' refuses an organisation principal on its own');
  }

  /* ===================================================================== */
  say('\n2. FIXTURE ACTIVITY — through the real workshop routes');
  var plate = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
  await asAdmin('POST', '/api/resolve/confirm', { plate: plate, method: 'admin', candidate: { manufacturer: TAG, model: 'S', year: 2020 } });
  var v1 = await asAdmin('POST', '/api/workshop/visits', { plate: plate, plate_read_method: 'manual', org_id: orgA, reason: 'Révision' });
  ok(v1.status === 201, 'a visit is opened for Alpha');
  ok((await asAdmin('POST', '/api/workshop/visits/' + v1.body.visit.id + '/operations', { operation_type: 'service', org_id: orgA })).status === 201, 'with one operation');
  var v2 = await asAdmin('POST', '/api/workshop/visits', { plate: plate, plate_read_method: 'manual', org_id: orgA });
  ok((await asAdmin('POST', '/api/workshop/visits/' + v2.body.visit.id + '/close', { org_id: orgA })).status === 200, 'a second visit, closed');

  /* ===================================================================== */
  say('\n3. ORGANISATIONS');
  var list = await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&page_size=100');
  ok(list.status === 200 && list.body.total === 3, 'q=' + TAG + ' -> the 3 organisations of this run');
  var raw = list.raw;
  ok(raw.indexOf(EMAIL) === -1 && raw.indexOf(TAX) === -1, 'neither the contact e-mail nor the tax id appears in the response');
  ok(raw.indexOf(ADMIN) === -1 && raw.indexOf(ORG) === -1 && raw.indexOf(ORG_REF) === -1 && raw.indexOf(ADMIN_REF) === -1, 'no credential, no actor_ref');
  var A = list.body.results.filter(function (o) { return o.id === orgA; })[0];
  var B = list.body.results.filter(function (o) { return o.id === orgB; })[0];
  ok(A.contact_present === true && A.tax_id_present === true && B.contact_present === false && B.tax_id_present === false, 'presence flags are correct for both');
  ok(A.city === 'Sfax' && A.is_fixpert_pilot === true && !!A.verified_at && (!gov || A.governorate === gov.name_fr), 'identity fields: city, governorate, pilot, verified');
  ok(A.accounts.managers === 1 && A.accounts.technicians === 1 && B.accounts.managers === 0, 'accounts per role');
  ok(A.integration && A.integration.credentials === 1 && A.integration.scopes.indexOf('workshop:read') !== -1 && B.integration === null, 'integration: Alpha has 1 service credential; Beta\'s invalid entry is not presented as an integration');
  var sql = (await db.query("SELECT (SELECT count(*)::int FROM idauto_workshop_visits WHERE org_id = $1) v, (SELECT count(*)::int FROM idauto_workshop_visits WHERE org_id = $1 AND status IN ('open','in_progress')) ov, " +
    '(SELECT count(*)::int FROM idauto_workshop_operations o JOIN idauto_workshop_visits w ON w.id = o.visit_id WHERE w.org_id = $1) op, (SELECT max(opened_at) FROM idauto_workshop_visits WHERE org_id = $1) last', [orgA])).rows[0];
  ok(A.activity.visits === sql.v && A.activity.open_visits === sql.ov && A.activity.operations === sql.op && sql.v === 2 && sql.ov === 1, 'activity counts equal the database (2 visits, 1 open, ' + sql.op + ' operation)');
  ok(new Date(A.activity.last_activity_at).getTime() === new Date(sql.last).getTime() && B.activity.last_activity_at === null, 'last activity = latest visit; none for Beta (reported as null, not invented)');
  var byStatus = (await db.query('SELECT status, count(*)::int n FROM idauto_organizations GROUP BY 1')).rows;
  ok(byStatus.every(function (s) { return list.body.by_status[s.status] === s.n; }), 'counts by status equal the database');
  ok((await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&status=suspended')).body.results.map(function (o) { return o.id; }).join() === String(orgC), 'status=suspended -> Gamma');
  ok((await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&org_type=insurer')).body.results.map(function (o) { return o.id; }).join() === String(orgB), 'org_type=insurer -> Beta');
  ok((await asAdmin('GET', '/api/admin/organisations?q=sfax')).body.results.some(function (o) { return o.id === orgA; }), 'q matches the city, case-insensitively');
  ok((await asAdmin('GET', '/api/admin/organisations?q=' + encodeURIComponent('100%'))).body.results.every(function (o) { return o.name.indexOf('100%') !== -1; }), '% in q is a literal character');
  var act = await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&sort=activity&dir=desc');
  ok(act.body.results[0].id === orgA, 'sort=activity&dir=desc puts the active atelier first');
  var byName = await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&sort=name&dir=asc&page_size=1&page=2');
  // Name order (C collation on the scratch database): « Assurance … Beta », « Garage … 100% Gamma », « Garage … Alpha ».
  ok(byName.body.pages === 3 && byName.body.results.length === 1 && byName.body.results[0].id === orgC, 'paging by name, one per page: page 2 of 3 is the second name in order');
  var seenOrgs = {};
  for (var pg = 1; pg <= 3; pg++) (await asAdmin('GET', '/api/admin/organisations?q=' + TAG + '&page_size=1&page=' + pg)).body.results.forEach(function (o) { seenOrgs[o.id] = (seenOrgs[o.id] || 0) + 1; });
  ok(Object.keys(seenOrgs).length === 3 && Object.keys(seenOrgs).every(function (k) { return seenOrgs[k] === 1; }), 'walking the 3 pages returns each organisation once');
  var bads = [['status=closed', 'an unknown status'], ['org_type=bank', 'an unknown type'], ['sort=tax_id', 'an unknown sort'], ['dir=up', 'an unknown direction'],
    ['page_size=101', 'page_size above 100'], ['page=1.5', 'a fractional page'], ['q=a%00', 'a NUL byte']];
  for (var b = 0; b < bads.length; b++) {
    var bad = await asAdmin('GET', '/api/admin/organisations?' + bads[b][0]);
    ok(bad.status === 400 && typeof bad.body.message_fr === 'string', 'refuses ' + bads[b][1] + ' with 400');
  }

  /* ===================================================================== */
  say('\n4. DATA SOURCES');
  var src = await asAdmin('GET', '/api/admin/sources');
  ok(src.status === 200, 'GET /api/admin/sources -> 200');
  var dbSources = (await db.query('SELECT cs.code, (SELECT count(*)::int FROM idauto_observations o WHERE o.capture_source_id = cs.id) obs, (SELECT count(*)::int FROM idauto_vehicle_facts f WHERE f.source_id = cs.id) facts FROM idauto_capture_sources cs')).rows;
  ok(src.body.capture_sources.length === dbSources.length, 'every configured capture source is listed (' + dbSources.length + ')');
  ok(dbSources.every(function (d) { var s = src.body.capture_sources.filter(function (x) { return x.code === d.code; })[0]; return s && s.usage.observations === d.obs && s.usage.facts === d.facts; }), 'each source\'s usage equals the database');
  var manual = src.body.capture_sources.filter(function (s) { return s.code === 'MANUAL_ADMIN'; })[0];
  ok(manual && manual.trust_level === 5 && typeof manual.active === 'boolean' && 'legal_basis' in manual, 'a source carries its trust level, state and legal basis as configured');
  ok(src.body.vehicle_providers.length === 1 && src.body.vehicle_providers[0].kind === 'local', 'identification providers: local only — no external provider is invented');
  ok(src.body.parts_catalogue.local === true && src.body.parts_catalogue.supplier && src.body.parts_catalogue.supplier.configured === false, 'parts catalogue: supplier reported NOT configured');
  var sc = src.body.service_credentials;
  ok(sc.admin_credentials === 1 && sc.organisation_credentials === 1 && sc.organisations === 1 && sc.invalid_entries === 1, 'service credentials: counts only (1 admin, 1 organisation, 1 invalid)');
  ok(src.raw.indexOf(ADMIN) === -1 && src.raw.indexOf(ORG) === -1 && src.raw.indexOf(BROKEN) === -1 && src.raw.indexOf(ORG_REF) === -1 && src.raw.indexOf(ADMIN_REF) === -1, 'no credential and no actor_ref in the sources response');

  /* ===================================================================== */
  say('\n5. PAGE');
  var pr = await request('GET', '/admin/sources');
  var csp = pr.headers['content-security-policy'] || '';
  ok(pr.status === 200 && pr.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf("frame-ancestors 'none'") !== -1, '/admin/sources -> 200, no-store, admin CSP');
  ok((await request('GET', '/admin/sources-ui.js')).status === 200, 'its script is served');

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
