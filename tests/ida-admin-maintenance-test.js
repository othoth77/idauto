'use strict';

/* IDA-ADMIN-2 — MAINTENANCE HISTORY ACROSS EVERY ORGANISATION.
 *
 * GET /api/admin/maintenance and the /admin/maintenance page. What this suite
 * proves:
 *   - admin only: anonymous 401; every organisation credential 403 (service,
 *     manager, technician), at the central gate AND in the handler;
 *   - the admin sees every organisation's visits and service events, and the
 *     filters (organisation, status, operation type, identified, dates,
 *     vehicle by any plate spelling or by the plate read at the workshop)
 *     narrow exactly;
 *   - never returned: the workshop customer reference, the plate read for an
 *     identified visit, the read confidence, a VIN; mileage on a visit is
 *     reported as not recorded (no such column exists), never invented;
 *   - nothing is written, and the page renders nothing as markup.
 *
 * Runs against a real PostgreSQL and refuses any database not named
 * idauto_scratch_*.
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
var identities = {};
identities[ADMIN] = 'usr_admin_maint_' + crypto.randomBytes(4).toString('hex');
identities[ORG] = { actor_ref: 'svc_maint_org', org_id: 0, scopes: ['vehicle:read', 'vehicle:write', 'vehicle:search', 'vehicle:resolve', 'vin:search',
  'workshop:read', 'workshop:write', 'parts:read', 'fact:read', 'observation:read', 'document:read'] };

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
function get(q) { return asAdmin('GET', '/api/admin/maintenance' + (q ? '?' + q : '')); }
function cookieOf(res) { var sc = res.headers['set-cookie']; if (!sc) return null; var c = [].concat(sc).map(function (x) { return x.split(';')[0]; }).filter(function (x) { return /session_token=/.test(x) && !/=;?$/.test(x); }); return c.length ? c.join('; ') : null; }
var ipBlock = crypto.randomInt(1, 250), ipCounter = 10;
function login(email, password) {
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.97.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }

var usedPlates = {};
async function unusedPlate() {
  for (var tries = 0; tries < 500; tries++) {
    var p = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
    if (usedPlates[p]) continue;
    var hit = await db.query("SELECT 1 FROM idauto_plates WHERE plate_number = $1 UNION ALL SELECT 1 FROM idauto_workshop_visits WHERE REPLACE(UPPER(plate_read), ' ', '') = $2", [p, p.replace(/ /g, '')]);
    if (!hit.rows.length) { usedPlates[p] = true; return p; }
  }
  throw new Error('no free plate found — reset the scratch database');
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier Maint A ' + run])).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier Maint B <i>' + run + '</i>'])).rows[0].id;
  var orgIdle = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier Idle ' + run])).rows[0].id;
  identities[ORG].org_id = orgA;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var authModule = require(path.join(BASE, 'reference', 'auth', 'auth.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = authModule.getAuth();
  var PW = 'Maint-Horse-' + run + '-2026';
  var users = { manager: 'maint-manager-' + run.toLowerCase() + '@idauto.test', tech: 'maint-tech-' + run.toLowerCase() + '@idauto.test' };
  async function provision(email, role, orgId) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'Maint ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, orgId || null, created.user.id]);
  }
  await provision(users.manager, 'manager', orgA);
  await provision(users.tech, 'technician', orgA);

  /* ===================================================================== */
  say('\n0. STRUCTURE');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'the read model still contains no SQL write verb');
  // Bounded at the next section: the data-quality section reads fact keys by design.
  var maintSrc = ((repoSrc.split('IDA-ADMIN-2 — MAINTENANCE HISTORY')[1] || '').split('IDA-ADMIN-3')[0]);
  // The marker sits inside the section's header comment: drop the rest of that comment first.
  var maintCode = maintSrc.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(maintSrc.length > 0 && !/customer_ref\b(?!_id|_present)/.test(maintCode), 'the maintenance query never selects the customer reference');
  ok(!/plate_read_confidence|fact_key|_vin|storage_key/.test(maintCode), 'nor the read confidence, any fact (VIN), or a storage key');
  ok(/CASE WHEN w\.vehicle_id IS NULL THEN w\.plate_read END/.test(maintCode), 'plate_read is selected only for an unidentified visit');
  var ui = fs.readFileSync(path.join(BASE, 'reference', 'admin-maintenance-ui.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(ui), 'the page script renders no markup from strings');
  ok(!/localStorage|sessionStorage|Authorization|Bearer/.test(ui), 'no browser storage, no token');
  var html = fs.readFileSync(path.join(BASE, 'reference', 'admin-maintenance.html'), 'utf8');
  ok(!/<script>|<script [^>]*>[^<]|onclick=|style="/.test(html) && /lang="fr"/.test(html), 'the page has no inline script/style and is French');
  var NAV = ['/admin/vehicles', '/admin/maintenance', '/admin/sources', '/admin/quality', '/admin/review', '/admin'];
  ['admin.html', 'review.html', 'admin-vehicles.html', 'admin-vehicle.html', 'admin-maintenance.html', 'admin-sources.html', 'admin-quality.html'].forEach(function (f) {
    var page = fs.readFileSync(path.join(BASE, 'reference', f), 'utf8');
    var links = (page.match(/<ul class="ida-nav-links">[\s\S]*?<\/ul>/) || [''])[0].match(/href="[^"]+"/g) || [];
    ok(JSON.stringify(links.map(function (l) { return l.slice(6, -1); })) === JSON.stringify(NAV) && (page.match(/aria-current="page"/g) || []).length === 1,
      f + ' carries the one console navigation, with exactly one current page');
  });

  /* ===================================================================== */
  say('\n1. ACCESS');
  ok((await request('GET', '/api/admin/maintenance')).status === 401, 'anonymous -> 401');
  ok((await request('GET', '/api/admin/maintenance', { token: ORG })).status === 403, 'organisation service credential (workshop:read included) -> 403');
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!managerCookie && !!techCookie, 'manager and technician sign in');
  ok((await request('GET', '/api/admin/maintenance', withSession(managerCookie))).status === 403, 'a manager session -> 403');
  ok((await request('GET', '/api/admin/maintenance', withSession(techCookie))).status === 403, 'a technician session -> 403');
  ok((await request('POST', '/api/admin/maintenance', { token: ADMIN, body: {} })).status === 405, 'POST -> 405 (read only)');
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; }, decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  var handler = inner.routes.filter(function (r) { return r.pattern.test('/api/admin/maintenance'); })[0];
  var fakeRes = {};
  await handler.handler({ url: '/api/admin/maintenance', principal: { kind: 'organisation', org_id: orgA, scopes: identities[ORG].scopes } }, fakeRes, ['']);
  ok(fakeRes.status === 403, 'the handler refuses an organisation principal on its own (defence in depth)');

  /* ===================================================================== */
  say('\n2. FIXTURES — real workshop routes, two organisations');
  async function vehicle(year) {
    var res = await asAdmin('POST', '/api/resolve/confirm', { plate: await unusedPlate(), method: 'admin', candidate: { manufacturer: 'MAINT' + run, model: 'M', year: year } });
    return res.body.vehicle;
  }
  var v1 = await vehicle(2012), v2 = await vehicle(2018);
  var CUSTOMER = 'CUST-M-' + run;
  async function visit(v, org, extra) {
    var body = Object.assign({ plate: v ? v.plate : await unusedPlate(), plate_read_method: 'manual', org_id: org }, extra || {});
    var r = await asAdmin('POST', '/api/workshop/visits', body);
    if (r.status !== 201) console.log('visit failed', r.status, r.raw);
    return r.body.visit;
  }
  var va1 = await visit(v1, orgA, { reason: 'Vidange <b>annuelle</b>', customer_ref: CUSTOMER });
  var va2 = await visit(v2, orgA, { reason: 'Bruit' });
  var vb1 = await visit(v1, orgB, { reason: 'Contrôle' });
  var UNKNOWN_PLATE = await unusedPlate();
  var vu = await visit(null, orgB, { plate: UNKNOWN_PLATE, reason: 'Caméra' });
  ok(va1 && va2 && vb1 && vu, 'four visits opened across two organisations');
  ok(vu.vehicle === null, 'a visit whose plate matches no vehicle stays unidentified');
  async function op(v, org, type, desc) { return asAdmin('POST', '/api/workshop/visits/' + v.id + '/operations', { operation_type: type, description: desc, org_id: org }); }
  ok((await op(va1, orgA, 'service', 'Vidange moteur')).status === 201 && (await op(va1, orgA, 'replacement', 'Filtre à huile')).status === 201, 'two operations on visit A1');
  ok((await op(vb1, orgB, 'inspection', 'Contrôle freins')).status === 201, 'one operation on visit B1');
  ok((await asAdmin('POST', '/api/workshop/visits/' + va2.id + '/close', { org_id: orgA })).status === 200, 'visit A2 closed');
  // Old date on B1 so the date filters have something to separate.
  await db.query("UPDATE idauto_workshop_visits SET opened_at = '2025-03-10T09:00:00Z' WHERE id = $1", [vb1.id]);
  var v1id = (await db.query('SELECT id FROM idauto_vehicles WHERE ivid = $1', [v1.id])).rows[0].id;
  var roleId = (await db.query("INSERT INTO idauto_user_roles (mythos_user_id, org_id, role) VALUES ($1, $2, 'member') RETURNING id", ['usr_maint_' + run, orgB])).rows[0].id;
  await db.query("INSERT INTO idauto_service_events (vehicle_id, org_id, user_role_id, event_type, event_date, odometer_km, outcome, is_public) VALUES ($1,$2,$3,'vidange','2026-06-01',98765,'pass',TRUE), ($1,$2,$3,'controle','2026-07-01',NULL,NULL,FALSE)", [v1id, orgB, roleId]);
  // A re-plating of v1: its old plate must still find its history.
  var OLD_PLATE = v1.plate;
  await db.query("UPDATE idauto_plates SET status = 'cancelled' WHERE plate_number = $1", [OLD_PLATE]);
  ok((await asAdmin('POST', '/api/resolve/confirm', { vehicle_ref: v1.id, plate: await unusedPlate(), method: 'admin', candidate: {} })).status === 200, 'v1 is re-plated');

  /* ===================================================================== */
  say('\n3. VISITS — every organisation, filters, paging');
  var both = 'org_id=' + orgA;
  var a = await get('org_id=' + orgA);
  ok(a.status === 200 && a.body.kind === 'visits' && a.body.total === 2, 'organisation A: 2 visits');
  var b = await get('org_id=' + orgB);
  ok(b.body.total === 2, 'organisation B: 2 visits — the admin sees both organisations');
  var names = a.body.organisations.map(function (o) { return o.name; });
  ok(names.indexOf('Atelier Maint A ' + run) !== -1 && names.indexOf('Atelier Maint B <i>' + run + '</i>') !== -1 && names.indexOf('Atelier Idle ' + run) === -1,
    'the organisation filter lists organisations WITH records only (the idle one is absent)');
  var a1 = a.body.results.filter(function (r) { return r.id === va1.id; })[0];
  ok(a1 && a1.operations.length === 2 && a1.operations.map(function (o) { return o.operation_type; }).join(',') === 'service,replacement', 'visit A1 carries its two operations in order');
  ok(a1.vehicle && a1.vehicle.ivid === v1.id && a1.vehicle.plate !== OLD_PLATE, 'its vehicle is shown with its CURRENT plate');
  ok(a1.reason === 'Vidange <b>annuelle</b>', 'free text is returned verbatim, as data');
  ok(a1.customer_ref_present === true && a.raw.indexOf(CUSTOMER) === -1, 'customer reference: present flag only, value nowhere');
  ok(a1.plate_read === null && a1.odometer_km === null, 'an identified visit carries no plate_read; its mileage is null (not recorded)');
  ok(!/plate_read_confidence|"vin"/.test(a.raw), 'no read confidence, no vin field');
  ok((await get(both + '&status=closed')).body.results.map(function (r) { return r.id; }).join() === String(va2.id), 'status=closed -> exactly the closed visit');
  ok((await get('org_id=' + orgB + '&operation_type=inspection')).body.results.map(function (r) { return r.id; }).join() === String(vb1.id), 'operation_type=inspection -> the visit with that operation');
  var unid = await get('org_id=' + orgB + '&identified=false');
  ok(unid.body.total === 1 && unid.body.results[0].id === vu.id && unid.body.results[0].vehicle === null && unid.body.results[0].plate_read === UNKNOWN_PLATE.replace(/\s+/g, ' '),
    'identified=false -> the unidentified visit, with the plate read at the workshop');
  ok((await get('org_id=' + orgB + '&identified=true')).body.total === 1, 'identified=true -> the other one');
  ok((await get('org_id=' + orgB + '&to=2025-12-31')).body.results.map(function (r) { return r.id; }).join() === String(vb1.id), 'to=2025-12-31 -> only the 2025 visit');
  ok((await get('org_id=' + orgB + '&from=2026-01-01')).body.total === 1, 'from=2026-01-01 -> only the recent one');
  ok((await get('org_id=' + orgB + '&from=2025-03-10&to=2025-03-10')).body.total === 1, 'a one-day range includes that whole day');
  var byOld = await get('q=' + encodeURIComponent(OLD_PLATE.replace(' TUN ', 'TU')));
  ok(byOld.body.total === 2 && byOld.body.results.every(function (r) { return r.vehicle && r.vehicle.ivid === v1.id; }), 'q = v1\'s OLD plate (another spelling) -> both of v1\'s visits, in both organisations');
  ok((await get('q=' + encodeURIComponent(v1.id))).body.total === 2, 'q = IVID -> the same two');
  var byRead = await get('q=' + encodeURIComponent(UNKNOWN_PLATE.replace(' TUN ', ' تونس ')));
  ok(byRead.body.total === 1 && byRead.body.results[0].id === vu.id, 'q = the plate read at the workshop (Arabic spelling) finds the unidentified visit');
  var asc = await get('org_id=' + orgB + '&dir=asc'), desc = await get('org_id=' + orgB + '&dir=desc');
  ok(asc.body.results[0].id === vb1.id && desc.body.results[0].id === vu.id, 'dir=asc puts the oldest first, desc the newest');
  var seen = {}, pages = 0;
  for (var pg = 1; pg <= 4; pg++) { var page = await get('org_id=' + orgA + '&page_size=1&page=' + pg); pages = page.body.pages; page.body.results.forEach(function (r) { seen[r.id] = (seen[r.id] || 0) + 1; }); }
  ok(pages === 2 && Object.keys(seen).length === 2 && Object.keys(seen).every(function (k) { return seen[k] === 1; }), 'paging one by one returns each visit once');
  var dbTotals = (await db.query('SELECT (SELECT count(*)::int FROM idauto_workshop_visits) v, (SELECT count(*)::int FROM idauto_workshop_visits WHERE vehicle_id IS NULL) u, (SELECT count(*)::int FROM idauto_workshop_operations) o, (SELECT count(*)::int FROM idauto_service_events) e')).rows[0];
  var tt = a.body.totals;
  ok(tt.visits === dbTotals.v && tt.unidentified_visits === dbTotals.u && tt.operations === dbTotals.o && tt.service_events === dbTotals.e, 'totals equal the database counts');
  ok(a.body.mileage_recorded_on_visits === false, 'the response states that visits record no mileage');

  /* ===================================================================== */
  say('\n4. SERVICE EVENTS');
  var ev = await get('kind=service_events&org_id=' + orgB);
  ok(ev.status === 200 && ev.body.total === 2, 'kind=service_events -> the 2 events of organisation B');
  ok(ev.body.results[0].event_date && ev.body.results[0].event_type === 'controle' && ev.body.results[0].odometer_km === null, 'newest first; an event without mileage says null, not 0');
  ok(ev.body.results[1].odometer_km === 98765 && ev.body.results[1].outcome === 'pass' && ev.body.results[1].is_public === true, 'an event with mileage carries it, with outcome and visibility');
  ok(ev.body.results.every(function (r) { return r.vehicle && r.vehicle.ivid === v1.id; }), 'each names its vehicle');
  ok((await get('kind=service_events&q=' + encodeURIComponent(OLD_PLATE))).body.total === 2, 'service events are found by the vehicle\'s old plate too');

  /* ===================================================================== */
  say('\n5. VALIDATION');
  var bads = [['kind=parts', 'an unknown kind'], ['org_id=x', 'a non-numeric org_id'], ['status=done', 'an unknown visit status'], ['operation_type=wash', 'an unknown operation type'],
    ['identified=maybe', 'a non-boolean identified'], ['from=2026-02-30', 'an impossible date'], ['from=30/10/2026', 'a non-ISO date'], ['from=2026-10-02&to=2026-10-01', 'from after to'],
    ['kind=service_events&status=open', 'a visit-only filter on service events'], ['page_size=101', 'page_size above 100'], ['page=0', 'page 0'], ['q=a%00b', 'a NUL byte'], ['dir=up', 'an unknown direction']];
  for (var i = 0; i < bads.length; i++) {
    var bad = await get(bads[i][0]);
    ok(bad.status === 400 && bad.body && typeof bad.body.message_fr === 'string', 'refuses ' + bads[i][1] + ' with 400 and a French message');
  }
  ok((await get('org_id=999999999')).body.total === 0, 'an organisation with no record -> empty, not an error');

  /* ===================================================================== */
  say('\n6. PAGE');
  var pr = await request('GET', '/admin/maintenance');
  var csp = pr.headers['content-security-policy'] || '';
  ok(pr.status === 200 && pr.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf("frame-ancestors 'none'") !== -1, '/admin/maintenance -> 200, no-store, admin CSP');
  ok((await request('GET', '/admin/maintenance-ui.js')).status === 200, 'its script is served');
  ok((await request('GET', '/admin/vehicles')).status === 200 && (await request('GET', '/admin/review')).status === 200 && (await request('GET', '/admin')).status === 200, 'the other console pages still serve');
  ok((await request('GET', '/api/workshop/visits?org_id=' + orgB, { token: ORG })).body.visits.every(function (w) { return w.org_id === orgA; }), 'the workshop route still confines an organisation to its own visits');

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
