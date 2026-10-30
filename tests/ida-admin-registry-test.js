'use strict';

/* IDA-ADMIN-1 — THE OPERATOR CONSOLE: REGISTRY, VEHICLE DOSSIER, OVERVIEW.
 *
 * Three read routes under /api/admin/* and two pages under /admin/*. The
 * properties this suite exists to prove are mostly NEGATIVE:
 *
 *   - no organisation credential reaches the console (service, manager,
 *     technician), and an anonymous caller is told to sign in;
 *   - the dossier never carries the VIN, a restricted fact, a workshop
 *     customer reference, a storage key or a capture field — even to an admin;
 *     the VIN is disclosed only by the existing fiche route, which audits;
 *   - the registry pages the whole register without duplicates or gaps, and
 *     its filters are validated, bounded and injection-proof;
 *   - nothing in the console writes, and nothing in its pages renders server
 *     data as markup.
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
identities[ADMIN] = 'usr_admin_console_' + crypto.randomBytes(4).toString('hex');
// An organisation credential holding EVERY scope an organisation can hold:
// the console must still refuse it.
identities[ORG] = { actor_ref: 'svc_admin_console_org', org_id: 0, scopes: ['vehicle:read', 'vehicle:write', 'vehicle:search', 'vehicle:resolve', 'vin:search',
  'plate:read', 'fact:read', 'fact:write', 'observation:read', 'observation:write', 'identity:resolve', 'passport:read', 'workshop:read', 'workshop:write',
  'parts:read', 'parts:write', 'stock:write', 'document:read', 'document:write', 'document:delete'] };

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
var ipCounter = 10;
// Each run is its own set of clients: Better Auth allows 5 sign-ins a minute
// per X-Real-IP, so two runs in one minute must not share addresses.
var ipBlock = crypto.randomInt(1, 250);
function login(email, password) {
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.98.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }

var VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function randomVin() { var s = ''; for (var i = 0; i < 17; i++) s += VIN_CHARS[crypto.randomInt(VIN_CHARS.length)]; return s; }

var usedPlates = {};
async function unusedPlate() {
  for (var tries = 0; tries < 500; tries++) {
    var p = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
    if (usedPlates[p]) continue;
    var hit = await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [p]);
    if (!hit.rows.length) { usedPlates[p] = true; return p; }
  }
  throw new Error('no free plate found — reset the scratch database');
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var TAG = 'ADMTEST' + run;          // every vehicle this run creates carries this make
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier Console ' + run])).rows[0].id;
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
  var PW = 'Console-Horse-' + run + '-2026';
  var users = { admin: 'console-admin-' + run.toLowerCase() + '@idauto.test', manager: 'console-manager-' + run.toLowerCase() + '@idauto.test', tech: 'console-tech-' + run.toLowerCase() + '@idauto.test' };
  async function provision(email, role, orgId) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'Console ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, orgId || null, created.user.id]);
  }
  await provision(users.admin, 'admin', null);
  await provision(users.manager, 'manager', org);
  await provision(users.tech, 'technician', org);

  var ROUTES = ['/api/admin/overview', '/api/admin/vehicles', '/api/admin/vehicles/x/dossier'];

  /* ===================================================================== */
  say('\n0. STRUCTURE — read only, admin only, no markup from data');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  var routesSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin-routes.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'admin-repository.js contains no SQL write verb (comments included)');
  ok(!/withAudit|db\.query/.test(routesSrc), 'admin-routes.js holds no SQL and calls no write helper');
  ok(!/\bvin\b[^_]/i.test(repoSrc.replace(/\/\/.*$/gm, '').replace(/fact_key <> 'vin'|fact_key = 'vin'/g, '')), 'admin-repository.js selects no VIN (its only VIN references exclude it)');
  ok(!/customer_ref\b(?!_id|_present)/.test(repoSrc.replace(/\/\/.*$/gm, '')), 'admin-repository.js never selects the customer reference, only whether one exists');
  ok(!/storage_key|capture_time|plate_candidate|ocr_confidence|ip_hash|ocr_fields/.test(repoSrc.replace(/\/\/.*$/gm, '')), 'no storage key, capture time, OCR candidate, IP hash or OCR fields are selected');
  var scopeTables = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8').split('var ROUTES = [')[0];
  ok(!/\\\/api\\\/admin/.test(scopeTables) && !/\/api\/admin/.test(fs.readFileSync(path.join(BASE, 'reference', 'v12-routes.js'), 'utf8') + fs.readFileSync(path.join(BASE, 'reference', 'v14-routes.js'), 'utf8')),
    'no /api/admin route appears in any scope table — organisations are refused by the central gate');
  // The SECOND layer, tested on its own: the handlers refuse a non-admin
  // principal even if the central gate were to let one through.
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; },
    decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  for (var h = 0; h < inner.routes.length; h++) {
    var fakeRes = {};
    await inner.routes[h].handler({ url: '/api/admin/vehicles', principal: { kind: 'organisation', org_id: 1, scopes: identities[ORG].scopes } }, fakeRes, ['', 'x']);
    ok(fakeRes.status === 403, 'handler ' + inner.routes[h].pattern + ' refuses an organisation principal on its own (defence in depth)');
  }
  ok(!api._ownerSessionRoutes.some(function (r) { return ROUTES.some(function (p) { return r.pattern.test(p); }); }), 'the owner cookie (IDA-V1B) is honoured on none of the console routes');
  var uiSrc = ['admin-console.js', 'admin-vehicles-ui.js', 'admin-vehicle-ui.js'].map(function (f) { return fs.readFileSync(path.join(BASE, 'reference', f), 'utf8'); }).join('\n');
  var uiCode = uiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments may NAME the sinks they forbid
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(uiCode), 'no console script renders markup from a string (no innerHTML / insertAdjacentHTML / document.write / eval)');
  ok(!/localStorage|sessionStorage|indexedDB/.test(uiSrc), 'no console script uses browser storage');
  ok(!/Authorization|Bearer/.test(uiSrc), 'no console script sends a token');
  ok(/X-IDauto-Session/.test(uiSrc), 'console calls carry the X-IDauto-Session header');
  ['admin-vehicles.html', 'admin-vehicle.html'].forEach(function (f) {
    var html = fs.readFileSync(path.join(BASE, 'reference', f), 'utf8');
    ok(!/<script>|<script [^>]*>[^<]|onclick=|onload=|style="/.test(html), f + ' has no inline script, handler or style');
    ok(/lang="fr"/.test(html), f + ' is French');
  });
  ok(!/\/fiche'/.test(uiSrc.replace(/\/api\/vehicles\/' \+ encodeURIComponent\(ref\) \+ '\/fiche'/, '')), 'the VIN is fetched only through the existing audited fiche route');

  /* ===================================================================== */
  say('\n1. ACCESS — anonymous, organisations, sessions');
  for (var i = 0; i < ROUTES.length; i++) {
    var anon = await request('GET', ROUTES[i]);
    ok(anon.status === 401 && anon.body && anon.body.login === '/login', 'anonymous ' + ROUTES[i] + ' -> 401 with the sign-in hint');
    var orgRes = await request('GET', ROUTES[i], { token: ORG });
    ok(orgRes.status === 403, 'organisation service credential with every org scope ' + ROUTES[i] + ' -> 403');
  }
  var adminCookie = cookieOf(await login(users.admin, PW));
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!adminCookie && !!managerCookie && !!techCookie, 'admin, manager and technician sign in through Better Auth');
  ok((await request('GET', '/api/admin/overview', withSession(managerCookie))).status === 403, 'a manager session -> 403');
  ok((await request('GET', '/api/admin/vehicles', withSession(techCookie))).status === 403, 'a technician session -> 403');
  ok((await request('GET', '/api/admin/vehicles', { cookie: adminCookie })).status === 401, 'an admin cookie WITHOUT X-IDauto-Session -> 401 (CSRF belt)');
  var adminSession = await request('GET', '/api/admin/vehicles', withSession(adminCookie));
  ok(adminSession.status === 200, 'an admin session with the header -> 200');
  ok((await request('POST', '/api/admin/vehicles', { token: ADMIN, body: {} })).status === 405, 'POST on the registry -> 405: the console has no write route');
  ok((await request('DELETE', '/api/admin/vehicles/x/dossier', { token: ADMIN })).status === 405, 'DELETE on a dossier -> 405');

  /* ===================================================================== */
  say('\n2. FIXTURES — through the real identification, workshop and merge paths');
  var created = [];
  for (var n = 0; n < 30; n++) {
    var res = await asAdmin('POST', '/api/resolve/confirm', { plate: await unusedPlate(), method: 'admin',
      candidate: { manufacturer: TAG, model: 'M' + String(n % 3), year: 2000 + n } });
    if (res.status !== 200) { console.log('confirm failed', res.status, res.raw); }
    created.push(res.body.vehicle);
  }
  ok(created.length === 30 && created.every(function (v) { return v && v.id; }), '30 vehicles identified through POST /api/resolve/confirm');

  var VIN = randomVin();
  var PLATE_OLD = await unusedPlate();
  var main1 = (await asAdmin('POST', '/api/resolve/confirm', { plate: PLATE_OLD, vin: VIN, method: 'admin',
    candidate: { manufacturer: TAG, model: 'DOSSIER', year: 2015, fuel_type: 'Diesel', engine_cc: 1598 } })).body.vehicle;
  ok(!!main1 && main1.vin_present === true, 'the dossier vehicle carries a VIN');
  var IVID = main1.id, REF = main1.internal_ref;
  var vid = (await db.query('SELECT id FROM idauto_vehicles WHERE ivid = $1', [IVID])).rows[0].id;
  // A re-plating: the old plate is retired (as an operator records it), a new one attached.
  await db.query("UPDATE idauto_plates SET status = 'cancelled', valid_until = CURRENT_DATE WHERE plate_number = $1", [PLATE_OLD]);
  var PLATE_NEW = await unusedPlate();
  ok((await asAdmin('POST', '/api/resolve/confirm', { vehicle_ref: IVID, plate: PLATE_NEW, method: 'admin', candidate: {} })).status === 200, 'a second plate is attached through confirm');

  var PUBLIC_VALUE = 'Bleu nuit <img src=x onerror=alert(1)>';
  var pubFact = await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(REF) + '/facts', { fact_key: 'colour', fact_value: PUBLIC_VALUE, access_scope: 'public', evidence_type: 'document_scan', confidence_score: 0.8 });
  ok(pubFact.status === 201, 'a public fact with document evidence is written through the audited fact route');
  var SECRET_VALUE = 'restricted-' + run;
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(REF) + '/facts', { fact_key: 'category_code', fact_value: SECRET_VALUE, access_scope: 'mythos_private' })).status === 201, 'a restricted fact is written');
  var colourId = (await db.query("SELECT id FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND fact_key = 'colour' ORDER BY id DESC LIMIT 1", [vid])).rows[0].id;
  ok((await asAdmin('POST', '/api/review/facts/' + colourId + '/decision', { decision: 'accept' })).status === 200, 'the public fact is verified through the audited review route');
  // A second, different colour from another observation: the disagreement the
  // console must surface (createFact keeps both values active).
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(REF) + '/facts', { fact_key: 'colour', fact_value: 'Gris', access_scope: 'public' })).status === 201, 'a second, different colour is recorded');

  var CUSTOMER = 'CUST-' + run + '-77';
  var visit = await asAdmin('POST', '/api/workshop/visits', { plate: PLATE_NEW, plate_read_method: 'manual', customer_ref: CUSTOMER, reason: 'Bruit au freinage', org_id: org });
  ok(visit.status === 201 && visit.body.visit.vehicle && visit.body.visit.vehicle.id === IVID, 'a workshop visit is opened for the vehicle (organisation ' + org + ')');
  var visitId = visit.body.visit.id;
  ok((await asAdmin('POST', '/api/workshop/visits/' + visitId + '/operations', { operation_type: 'replacement', description: 'Plaquettes avant', org_id: org })).status === 201, 'an operation is recorded on the visit');
  var roleId = (await db.query("INSERT INTO idauto_user_roles (mythos_user_id, org_id, role) VALUES ($1, $2, 'member') RETURNING id", ['usr_console_' + run, org])).rows[0].id;
  await db.query("INSERT INTO idauto_service_events (vehicle_id, org_id, user_role_id, event_type, event_date, odometer_km, outcome) VALUES ($1, $2, $3, 'vidange', CURRENT_DATE - 30, 123456, 'pass')", [vid, org, roleId]);

  // A duplicate identity, merged into the dossier vehicle through the audited merge route.
  var dup = (await asAdmin('POST', '/api/resolve/confirm', { plate: await unusedPlate(), method: 'admin', candidate: { manufacturer: TAG, model: 'DOSSIER-DUP', year: 2015 } })).body.vehicle;
  var merged = await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(dup.id) + '/merge', { canonical_ref: IVID });
  ok(merged.status === 200, 'a duplicate identity is merged into the dossier vehicle');

  /* ===================================================================== */
  say('\n3. REGISTRY — paging, sorting, filtering, validation');
  var p1 = await asAdmin('GET', '/api/admin/vehicles?make=' + TAG + '&sort=year&dir=asc&page_size=10');
  ok(p1.status === 200 && p1.body.total === 31 && p1.body.pages === 4, 'make filter: 31 canonical vehicles of this run, 4 pages of 10 (the merged duplicate is excluded)');
  var seen = {}, all = [];
  for (var pg = 1; pg <= 4; pg++) {
    var page = await asAdmin('GET', '/api/admin/vehicles?make=' + TAG + '&sort=year&dir=asc&page_size=10&page=' + pg);
    page.body.results.forEach(function (r) { seen[r.ivid] = (seen[r.ivid] || 0) + 1; all.push(r); });
  }
  ok(Object.keys(seen).length === 31 && Object.keys(seen).every(function (k) { return seen[k] === 1; }), 'walking every page returns each vehicle exactly once — no duplicate, no gap');
  ok(all.every(function (r, i) { return i === 0 || (r.year || 0) >= (all[i - 1].year || 0); }), 'sort=year&dir=asc is ascending across pages');
  var desc = await asAdmin('GET', '/api/admin/vehicles?make=' + TAG + '&sort=year&dir=desc&page_size=5');
  ok(desc.body.results[0].year === 2029, 'dir=desc puts the newest year first');
  ok((await asAdmin('GET', '/api/admin/vehicles?make=' + TAG.toLowerCase() + '&year=2015&page_size=50')).body.total === 2, 'make is case-insensitive and combines with year');
  var withMerged = await asAdmin('GET', '/api/admin/vehicles?make=' + TAG + '&include_merged=1&page_size=100');
  var dupRow = withMerged.body.results.filter(function (r) { return r.ivid === dup.id; })[0];
  ok(withMerged.body.total === 32 && dupRow && dupRow.merged_into === IVID, 'include_merged=1 shows the alias, pointing at its canonical identity');
  var spaced = PLATE_NEW.replace(/ TUN /, 'TU');
  var byPlate = await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(spaced));
  ok(byPlate.body.total === 1 && byPlate.body.results[0].ivid === IVID, 'free text finds the current plate in another spelling (' + spaced + ')');
  var arabic = PLATE_NEW.replace(' TUN ', ' تونس ');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(arabic))).body.results.some(function (r) { return r.ivid === IVID; }), 'and in its Arabic spelling');
  var byOld = await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(PLATE_OLD));
  ok(byOld.body.total === 1 && byOld.body.results[0].ivid === IVID && byOld.body.results[0].plate === PLATE_NEW, 'a HISTORICAL plate finds the vehicle, which shows its current plate');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(IVID))).body.total === 1, 'free text finds an IVID');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(REF))).body.total === 1, 'free text finds an internal reference');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + VIN)).body.total === 0, 'free text does NOT match a VIN — VIN lookup stays on the audited search');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent("' OR 1=1 --"))).body.total === 0, 'an injection attempt is a literal string: 0 results');
  var wild = await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent('%'));
  ok(wild.status === 200 && wild.body.total === 0, 'a bare % is a literal character, not a wildcard that lists everything');
  ok((await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(TAG.toLowerCase()))).body.total === 31, 'a make prefix in free text matches case-insensitively');
  ok(!/"vin"/.test(withMerged.raw) && withMerged.raw.indexOf(VIN) === -1, 'no registry response carries a VIN');
  var bads = [['year=15', 'a two-digit year'], ['page_size=101', 'page_size above 100'], ['page_size=0', 'page_size 0'], ['sort=password', 'an unknown sort column'],
    ['dir=sideways', 'an unknown direction'], ['fiche_status=bogus', 'an unknown fiche status'], ['verified=maybe', 'a non-boolean verified'],
    ['page=-1', 'a negative page'], ['page=999&page_size=100', 'a page beyond the browsable range']];
  for (var b = 0; b < bads.length; b++) {
    var bad = await asAdmin('GET', '/api/admin/vehicles?' + bads[b][0]);
    ok(bad.status === 400 && bad.body && typeof bad.body.message_fr === 'string', 'registry refuses ' + bads[b][1] + ' with 400 and a French message');
  }
  var unknownPage = await asAdmin('GET', '/api/admin/vehicles?make=' + TAG + '&page=9&page_size=10');
  ok(unknownPage.status === 200 && unknownPage.body.results.length === 0 && unknownPage.body.total === 31, 'a page past the end is empty, not an error, and still reports the total');

  /* ===================================================================== */
  say('\n4. DOSSIER — history, provenance, and what it never discloses');
  var vinReadsBefore = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read'")).rows[0].n;
  var d = await asAdmin('GET', '/api/admin/vehicles/' + encodeURIComponent(IVID) + '/dossier');
  ok(d.status === 200 && d.body.vehicle.id === IVID, 'GET dossier by IVID -> 200');
  ok((await asAdmin('GET', '/api/admin/vehicles/' + encodeURIComponent(REF) + '/dossier')).body.vehicle.id === IVID, 'and by internal reference');
  var raw = d.raw;
  ok(d.body.vehicle.vin === undefined && d.body.vehicle.vin_present === true, 'the VIN is reported present, never disclosed');
  ok(raw.indexOf(VIN) === -1, 'the VIN value appears nowhere in the dossier body');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read'")).rows[0].n === vinReadsBefore, 'reading a dossier writes no VIN audit row (nothing was disclosed)');
  ok(raw.indexOf(SECRET_VALUE) === -1 && d.body.restricted_fact_count >= 2, 'restricted facts (incl. the VIN) are counted, never shown (' + d.body.restricted_fact_count + ')');
  ok(raw.indexOf(CUSTOMER) === -1, 'the workshop customer reference appears nowhere');
  ok(!/storage_key|capture_time|plate_candidate|ocr_confidence|ip_hash|"vin"/.test(raw), 'no storage key, capture time, OCR candidate, IP hash or vin field');
  var plates = d.body.plates.map(function (p) { return p.plate + ':' + p.status; });
  ok(plates.indexOf(PLATE_NEW + ':active') !== -1 && plates.indexOf(PLATE_OLD + ':cancelled') !== -1, 'plate history shows the current AND the retired plate with their status');
  ok(d.body.plates.some(function (p) { return p.via_alias && p.recorded_on === dup.id; }), 'the merged duplicate\'s plate is shown, attributed to the alias it was recorded on');
  ok(d.body.aliases.length === 1 && d.body.aliases[0].ivid === dup.id && d.body.aliases[0].merged_into === IVID, 'the alias is listed with its merge target');
  var colour = d.body.facts.filter(function (f) { return f.id === colourId; })[0];
  ok(colour && colour.fact_value === PUBLIC_VALUE, 'a fact value containing markup is returned verbatim as data (the page renders it as text)');
  ok(colour.verification_status === 'verified' && colour.access_scope === 'public' && colour.evidence.some(function (e) { return e.evidence_type === 'document_scan'; }), 'the fact keeps its verification status, scope and document evidence');
  var grey = d.body.facts.filter(function (f) { return f.fact_key === 'colour' && f.fact_value === 'Gris'; })[0];
  ok(grey && grey.verification_status === 'unverified' && grey.evidence.length === 0, 'the undocumented value is shown unverified, with no evidence (self-declared)');
  ok(d.body.quality.disagreements.some(function (x) { return x.fact_key === 'colour' && x.distinct_active_values === 2; }) && d.body.quality.alias_count === 1, 'data quality reports the two disagreeing colours and the alias');
  var listed = (await asAdmin('GET', '/api/admin/vehicles?q=' + encodeURIComponent(IVID))).body.results[0];
  ok(listed.disagreement_count === 1, 'the registry row flags the disagreement too');
  var v = d.body.maintenance.visits[0];
  ok(v && v.id === visitId && v.org_id === org && v.org_name === 'Atelier Console ' + run && v.customer_ref_present === true && v.odometer_km === null, 'the visit is shown with its organisation, a customer reference flag and mileage « non enregistré »');
  ok(v.operations.length === 1 && v.operations[0].operation_type === 'replacement' && v.operations[0].description === 'Plaquettes avant', 'its operation is shown');
  var se = d.body.maintenance.service_events[0];
  ok(se && se.odometer_km === 123456 && se.outcome === 'pass', 'the service event carries its recorded mileage');
  var times = d.body.maintenance.timeline.map(function (t) { return new Date(t.at).getTime(); });
  ok(times.length === 2 && times[0] >= times[1], 'the maintenance timeline is most-recent first');
  ok(d.body.maintenance.mileage_recorded_on_visits === false, 'the dossier states that visits do not record mileage');
  ok(d.body.identification_history.length >= 2 && d.body.identification_history.every(function (h) { return h.action; }), 'identification history is present (' + d.body.identification_history.length + ' entries)');
  var auditTypes = d.body.audit.map(function (a) { return a.event_type; });
  ok(auditTypes.indexOf('workshop.visit.create') !== -1 && auditTypes.indexOf('workshop.operation.create') !== -1, 'the audit section includes the visit and operation writes');
  ok(auditTypes.some(function (t) { return /^vehicle\.(identify|merge)|vehicle\.merge/.test(t) || t === 'vehicle.identify.create' || t === 'vehicle.identify.confirmed'; }), 'and the identification writes (' + auditTypes.filter(function (t) { return /^vehicle/.test(t); }).slice(0, 4).join(', ') + ')');
  ok(/n'est pas la preuve/.test(d.body.completeness_note), 'the completeness note says absence is not proof');

  var viaAlias = await asAdmin('GET', '/api/admin/vehicles/' + encodeURIComponent(dup.id) + '/dossier');
  ok(viaAlias.status === 200 && viaAlias.body.vehicle.id === IVID && viaAlias.body.requested_alias === dup.id, 'asking for the alias answers with the canonical dossier and says so');
  ok((await asAdmin('GET', '/api/admin/vehicles/ivid%3A1%3AZZZZZZZZZZZZZZZZ%3AZZ/dossier')).status === 404, 'an unknown reference -> 404');
  ok((await asAdmin('GET', '/api/admin/vehicles/' + 'x'.repeat(80) + '/dossier')).status === 404, 'an overlong reference -> 404 without a lookup');

  var fiche = await asAdmin('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/fiche');
  ok(fiche.status === 200 && fiche.body.vin === VIN, 'the console\'s « Afficher le numéro de châssis » route (existing fiche) discloses the VIN to an admin');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read' AND target_ref = $1", [IVID])).rows[0].n === 1, 'and writes exactly one vehicle.vin.read audit row for it');
  var techFiche = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/fiche', withSession(techCookie));
  ok(techFiche.status === 200 && techFiche.body.vin === undefined && techFiche.raw.indexOf(VIN) === -1, 'a technician (no vin:search) reading the same fiche gets no VIN');

  /* ===================================================================== */
  say('\n5. OVERVIEW — real counts, nothing invented');
  var o = await asAdmin('GET', '/api/admin/overview');
  ok(o.status === 200, 'GET /api/admin/overview -> 200');
  var dbCanonical = (await db.query('SELECT count(*)::int n FROM idauto_vehicles WHERE merged_into_id IS NULL')).rows[0].n;
  var dbPending = (await db.query("SELECT count(*)::int n FROM idauto_observations WHERE status IN ('pending_review','pending_confirmation')")).rows[0].n;
  var dbVisits = (await db.query('SELECT count(*)::int n FROM idauto_workshop_visits')).rows[0].n;
  ok(o.body.vehicles.canonical === dbCanonical, 'canonical vehicle count equals the database (' + dbCanonical + ')');
  ok(o.body.review.pending_observations === dbPending, 'pending observations equal the database (' + dbPending + ')');
  ok(Object.keys(o.body.workshop.visits_by_status).reduce(function (s, k) { return s + o.body.workshop.visits_by_status[k]; }, 0) === dbVisits, 'visits by status sum to the database total (' + dbVisits + ')');
  ok(o.body.health.database === 'ok' && typeof o.body.health.vehicle_providers_configured === 'number', 'health reports the database and the configured provider count');
  ok(o.body.recent_activity.length > 0 && o.body.recent_activity.every(function (a) { return a.event_type && !('change_summary' in a) && !('actor_ref' in a); }), 'recent activity lists event types without summaries or actor references');

  /* ===================================================================== */
  say('\n6. PAGES — served with the admin CSP; existing surfaces unchanged');
  var pages = ['/admin/vehicles', '/admin/vehicles/', '/admin/vehicle', '/admin/vehicles-ui.js', '/admin/vehicle-ui.js', '/admin/console.js'];
  for (var q = 0; q < pages.length; q++) {
    var pr = await request('GET', pages[q]);
    var csp = pr.headers['content-security-policy'] || '';
    ok(pr.status === 200 && pr.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf('wasm') === -1 && csp.indexOf("frame-ancestors 'none'") !== -1,
      pages[q] + ' -> 200, no-store, admin CSP');
  }
  ok((await request('GET', '/admin/vehicle?ref=' + encodeURIComponent(IVID))).status === 200, 'the dossier page is reached with its query string');
  ok((await request('POST', '/admin/vehicles')).status !== 200, 'a page path does not answer POST');
  var adminHtml = await request('GET', '/admin');
  ok(adminHtml.status === 200 && /href="\/admin\/vehicles"/.test(adminHtml.raw), '/admin still serves, and links to the registry');
  ok((await request('GET', '/admin/review')).status === 200, '/admin/review still serves');
  ok((await request('GET', '/login')).status === 200, '/login still serves');
  var atelier = await request('GET', '/atelier');
  ok(atelier.status === 302 && /\/login/.test(atelier.headers.location || ''), '/atelier still redirects to /login without a session');
  ok((await request('GET', '/api/search/vehicles?make=' + TAG, { token: ORG })).body.results.length <= 50, 'the organisation search is still capped (IDA-V10 unchanged)');

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
