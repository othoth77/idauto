'use strict';
/* IDA-V12 — VEHICLE IDENTIFICATION, CATALOGUE AND WORKSHOP. Owner order,
 * 2026-09-05 ("IDauto FINAL COMPLETION").
 *
 * Walks the twelve scenarios the order names, as HTTP sequences against a
 * real PostgreSQL (scratch database only — refuses anything else):
 *   01 valid TU plate · 02 RS plate · 03 VIN · 04 unknown plate · 05 wrong OCR
 *   06 provider timeout · 07 provider unavailable · 08 local hit · 09 provider
 *   hit · 10 vehicle → catalogue parts · 11 manual correction · 12 full
 *   workshop flow — plus the atelier page, the scope gate, isolation between
 *   organisations, the VIN audit, metrics, and the structural rules
 *   (no mock in the production path, no SQL in the route module, no
 *   credential in a log line).
 *
 * Providers used here are the MOCKS, injected through the documented test
 * hooks. Every assertion that depends on them says so in its label.
 */
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var ORG_A = 'orga-' + crypto.randomBytes(10).toString('hex');
var ORG_B = 'orgb-' + crypto.randomBytes(10).toString('hex');
var ADMIN_REF = 'usr_' + crypto.randomBytes(12).toString('hex');
var WORK = ['vehicle:read', 'vehicle:write', 'vehicle:resolve', 'vehicle:search', 'fact:read', 'parts:read', 'parts:write', 'stock:write', 'workshop:read', 'workshop:write', 'passport:read'];
var identities = {};
identities[ADMIN] = ADMIN_REF;
identities[ORG_A] = { actor_ref: 'svc_atelier_v12_a', org_id: 0, scopes: WORK.slice() };
identities[ORG_B] = { actor_ref: 'svc_atelier_v12_b', org_id: 0, scopes: WORK.concat(['vin:search']) };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port, api;

function request(method, p, token, body) {
  return new Promise(function (resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Length': payload ? Buffer.byteLength(payload) : 0 };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = 'application/json';
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
function uniq(n) { return String(n) + String(Math.floor(Math.random() * 9)); }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '" — point IDAUTO_DB_NAME at a scratch database'); process.exit(1); }
  say('database: ' + dbName);
  var oa = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V12 A','garage','active') RETURNING id")).rows[0].id;
  var ob = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V12 B','garage','active') RETURNING id")).rows[0].id;
  identities[ORG_A].org_id = oa; identities[ORG_B].org_id = ob;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  api = require(path.join(BASE, 'reference', 'api.js'));
  var v12 = api._v12;
  var mockModule = require(path.join(BASE, 'reference', 'vehicle', 'providers', 'mock-vehicle-resolver.js'));
  var mockTecDocModule = require(path.join(BASE, 'reference', 'parts', 'mock-tecdoc-provider.js'));
  var normalizer = require(path.join(BASE, 'reference', 'vehicle', 'plate-normalizer.js'));
  var vinModule = require(path.join(BASE, 'reference', 'vehicle', 'vin.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  // Unique plates per run: the scratch database persists between runs.
  var S = String(100 + Math.floor(Math.random() * 899));
  var P_TU = S + ' TUN ' + uniq(100), P_RS = S + ' RS ' + uniq(200), P_OCR = S + ' TUN ' + uniq(300), P_PROV = S + ' TUN ' + uniq(400), P_FLOW = S + ' TUN ' + uniq(500);
  var VIN = 'WVWZZZ1KZ' + crypto.randomBytes(4).toString('hex').toUpperCase().replace(/[IOQ]/g, 'X').slice(0, 8);
  VIN = (VIN + 'AAAAAAAA').slice(0, 17);
  function randomVin(prefix) { var alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', out = prefix; while (out.length < 17) out += alphabet[crypto.randomBytes(1)[0] % alphabet.length]; return out; }
  var VIN_UNKNOWN = randomVin('JHM'), VIN_HONDA = randomVin('1HG');
  var MOTOR_RS = '1.2 PureTech ' + (60 + Math.floor(Math.random() * 900));

  /* ===================================================================== */
  say('\n0. STRUCTURE — what must never change');
  var routesSrc = fs.readFileSync(path.join(BASE, 'reference', 'v12-routes.js'), 'utf8');
  var resolverSrc = fs.readFileSync(path.join(BASE, 'reference', 'vehicle', 'vehicle-resolver.js'), 'utf8');
  var apiSrc = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var catalogSrc = fs.readFileSync(path.join(BASE, 'reference', 'parts', 'parts-catalog.js'), 'utf8');
  ok(!/INSERT\s+INTO|UPDATE\s+idauto_|DELETE\s+FROM/i.test(routesSrc), 'v12-routes.js holds no SQL write verb — mutations live in the repositories');
  ok(!/mock-vehicle-resolver|mock-tecdoc-provider/.test(resolverSrc + apiSrc + catalogSrc), 'no mock provider is required by api.js, the resolver or the catalogue (mocks reach the production path only through a test hook)');
  ok(/NODE_ENV === 'production'/.test(fs.readFileSync(path.join(BASE, 'reference', 'vehicle', 'providers', 'mock-vehicle-resolver.js'), 'utf8')), 'the mock vehicle resolver refuses to construct in production');
  ok(/^var ROUTES = \[[\s\S]*?\n\];/m.test(apiSrc) && apiSrc.indexOf('/public') !== -1, 'the ROUTES table shape api.js tests depend on is intact');
  ok(!/idauto_rate_limit_counters|bucketKey|selectBuckets/.test(routesSrc), 'v12-routes.js hosts no rate-limit machinery');
  ok(routesSrc.indexOf("'/public") === -1, 'v12-routes.js adds nothing under /public/');
  var obsSrc = fs.readFileSync(path.join(BASE, 'reference', 'observability.js'), 'utf8');
  ok(/token\|secret\|key\|password\|captcha/.test(obsSrc), 'observability redacts credential-shaped keys');

  /* ===================================================================== */
  say('\n1. PLATE NORMALISATION — TU, RS, Arabic, spaces, OCR, partial (unit)');
  var forms = ['230 TU 8646', '230TU8646', '230 تونس 8646', '230 TUN 8646', '٢٣٠ تونس ٨٦٤٦', '8646TU230', ' 230 - tu - 8646 '];
  ok(forms.every(function (f) { var p = normalizer.parsePlate(f); return p.ok && p.canonical === '230 TUN 8646' && p.normalized === '8646TU230' && p.registrationType === 'TU'; }), 'every accepted spelling of one plate yields the same canonical form and search key');
  var rs = normalizer.parsePlate('123 RS 4567');
  ok(rs.ok && rs.registrationType === 'RS' && rs.format_code === 'TUN_RS' && rs.canonical === '123 RS 4567', 'TEST 02 (unit): an RS plate parses with registrationType RS');
  ok(normalizer.parsePlate('230 TU 8646', { confidence: 0.5 }).requires_confirmation === true, 'a low OCR confidence flags requires_confirmation');
  ok(normalizer.parsePlate('230 TU 8646', { confidence: 92 }).confidence === 0.92, 'a 0–100 OCR confidence is normalised to 0–1');
  ok(normalizer.parsePlate('1884523').reason === 'ambiguous', 'a single digit run is refused as ambiguous — never split by guesswork');
  ok(normalizer.parsePlate('230 8646').reason === 'partial', 'digits without a type are partial, not guessed');
  ok(normalizer.parsePlate('230 8646', { registrationType: 'RS' }).canonical === '230 RS 8646', 'a partial read with a type hint completes to the hinted type');
  ok(!normalizer.parsePlate('abc').ok && !normalizer.parsePlate('').ok && !normalizer.parsePlate('1234 TU 12345').ok, 'invalid plates are refused');
  ok(normalizer.parsePlate('GN 123 456').ok && normalizer.parsePlate('GN 123 456').format_code === 'TUN_GVT', 'the other catalogue formats still parse');
  ok(normalizer.samePlate('230 TU 8646', '8646TU230'), 'samePlate() equates the reversed key with the plate');

  /* ===================================================================== */
  say('\n2. VIN VALIDATION (unit)');
  ok(vinModule.validate('1HGCM82633A004352').ok && vinModule.validate('1HGCM82633A004352').check_digit_valid === true, 'a North-American VIN validates with its check digit');
  ok(vinModule.validate('WVWZZZ1JZ3W386752').ok, 'a European VIN validates (check digit reported, never enforced)');
  ok(vinModule.validate('WVWZZZ1JZ3W38675O').reason === 'forbidden_letter', 'I, O, Q are refused');
  ok(vinModule.validate('SHORT').reason === 'length', 'length is enforced');

  /* ===================================================================== */
  say('\n3. THE ATELIER PAGE AND THE GATES');
  // IDA-V13 — /atelier is a signed-in page: no session → /login; with a
  // session (a web user created here through Better Auth) → the page.
  var atelierAnon = await request('GET', '/atelier');
  ok(atelierAnon.status === 302 && /\/login/.test(atelierAnon.headers.location), 'GET /atelier without a session -> 302 /login');
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var authApi = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var webPw = 'V12-Web-' + crypto.randomBytes(6).toString('hex') + '-pw';
    var webEmail = 'web-' + crypto.randomBytes(4).toString('hex') + '@idauto.test';
  var created = await authApi.api.signUpEmail({ body: { email: webEmail, password: webPw, name: 'Web V12' } });
  await db.query('UPDATE idauto_auth_user SET "role" = $1 WHERE "id" = $2', ['admin', created.user.id]);
  var signed = await authApi.api.signInEmail({ body: { email: webEmail, password: webPw }, returnHeaders: true });
  var webCookie = String(signed.headers.get('set-cookie')).split(';')[0];
  var atelier = await new Promise(function (resolve, reject) {
    http.get({ hostname: '127.0.0.1', port: port, path: '/atelier', headers: { Cookie: webCookie } }, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(c).toString('utf8') }); }); }).on('error', reject);
  });
  ok(atelier.status === 200 && /text\/html/.test(atelier.headers['content-type']), 'GET /atelier with a session -> 200 html');
  ok(atelier.headers['content-security-policy'] === "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'the atelier CSP is the citizen one, pinned whole');
  ok((await request('HEAD', '/atelier')).status === 302, 'HEAD /atelier without a session -> 302 as well');
  ok((await request('GET', '/atelier/atelier-ui.js')).status === 200 && (await request('GET', '/atelier/assets/plate-scanner.js')).status === 200 && (await request('GET', '/atelier/assets/tesseract/worker.min.js')).status === 200, 'the atelier assets and the OCR engine are served under /atelier/');
  ok((await request('GET', '/atelier/assets/../admin.html')).status !== 200, 'no traversal through the asset map');
  var adminCsp = (await request('GET', '/admin')).headers['content-security-policy'];
  ok(adminCsp.indexOf('wasm-unsafe-eval') === -1, 'the admin CSP is untouched');
  ok((await request('POST', '/api/resolve/plate', null, { plate: P_TU })).status === 401, 'POST /api/resolve/plate without a token -> 401');
  var noScope = 'nos-' + crypto.randomBytes(8).toString('hex');
  identities[noScope] = { actor_ref: 'svc_noscope', org_id: oa, scopes: ['vehicle:read'] };
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  ok((await request('POST', '/api/resolve/plate', noScope, { plate: P_TU })).status === 403, 'an organisation without vehicle:resolve -> 403');
  ok((await request('GET', '/api/metrics', ORG_A)).status === 403, 'GET /api/metrics is admin-only');
  var atelierHtml = fs.readFileSync(path.join(BASE, 'reference', 'atelier.html'), 'utf8');
  ok(!/<script>|<style>|onclick=|style="/.test(atelierHtml), 'no inline script, style or handler in the atelier page');
  ok(['Scanner la plaque', 'Saisie manuelle', 'Lecture incertaine', 'Véhicule proposé', 'introuvable', 'Fiche véhicule', 'Pièces compatibles', 'Intervention'].every(function (t) { return atelierHtml.indexOf(t) !== -1; }), 'the page carries every UI state a mechanic needs, in French');

  /* ===================================================================== */
  say('\n4. TEST 04 + 01 + 09 + 08 — unknown plate, provider hit, confirm, local hit');
  v12.resolver.setProviders([]);
  var nf = await request('POST', '/api/resolve/plate', ADMIN, { plate: P_TU });
  ok(nf.status === 200 && nf.body.status === 'not_found', 'TEST 04: an unknown plate with no provider -> 200 not_found (a state, not an error)');
  ok(nf.body.plate && nf.body.plate.canonical === P_TU && nf.body.plate.registrationType === 'TU', 'the structured plate comes back with the answer');
  var mock = mockModule.createMockVehicleResolver({ fixtures: [{ plate: P_TU, manufacturer: 'HYUNDAI', model: 'I20', motorisation: '1.2 MPI', year: 2018, tecdoc_car_id: 123456, vin: VIN, confidence: 0.9 }] });
  v12.resolver.setProviders([mock]);
  var cand = await request('POST', '/api/resolve/plate', ADMIN, { plate: P_TU.replace(' TUN ', 'TU') });
  ok(cand.status === 200 && cand.body.status === 'candidate' && cand.body.source === 'mock', 'TEST 09 (MOCK provider): the provider answers a candidate, labelled with its source');
  ok(cand.body.candidate.manufacturer === 'HYUNDAI' && cand.body.verified === false, 'a provider candidate is NOT verified and NOT yet recorded');
  ok((await db.query("SELECT count(*)::int n FROM idauto_plates WHERE plate_number = $1", [P_TU])).rows[0].n === 0, 'nothing was written to the database by the provider answer');
  var cachedCall = await request('POST', '/api/resolve/plate', ADMIN, { plate: P_TU });
  ok(cachedCall.body.cache === 'hit' && mock.calls.length === 1, 'the second lookup is served from the cache — the provider was called once');
  var conf = await request('POST', '/api/resolve/confirm', ADMIN, { plate: P_TU, candidate: cand.body.candidate, vin: VIN, method: 'provider', source: cand.body.source, confidence: cand.body.confidence });
  ok(conf.status === 200 && conf.body.status === 'confirmed' && conf.body.vehicle.verified === true, 'TEST 01: confirming writes the vehicle as verified truth');
  var IVID = conf.body.vehicle.id;
  ok(/^ivid:1:/.test(IVID) && conf.body.vehicle.plate === P_TU && conf.body.vehicle.tecdoc_car_id === 123456 && conf.body.vehicle.vin === VIN, 'the confirmed record carries IVID, plate, tecdoc_car_id and (for an admin) the VIN');
  ok(conf.body.vehicle.source === 'mock' && conf.body.vehicle.verified_by === ADMIN_REF && conf.body.vehicle.verification_method === 'provider', 'provenance: source, verified_by and method are recorded');
  v12.resolver.setProviders([mock]);   // clears the cache
  var local = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_TU });
  ok(local.status === 200 && local.body.status === 'resolved' && local.body.source === 'local' && local.body.vehicle.id === IVID, 'TEST 08: the plate now resolves from the LOCAL database, before any provider');
  ok(mock.calls.length === 1, 'and the provider was not called again');
  ok(local.body.vehicle.vin === undefined && local.body.vehicle.vin_present === true, 'an organisation without vin:search sees vin_present but never the VIN');
  var pub = await request('GET', '/public/plates/' + encodeURIComponent(P_TU.replace(' TUN ', ' TU ')));
  ok(pub.status === 200 && pub.body.ivid === IVID, 'the public plate route accepts the TU spelling for the same vehicle');
  var pubAr = await request('GET', '/public/plates/' + encodeURIComponent(P_TU.replace('TUN', 'تونس')));
  ok(pubAr.status === 200 && pubAr.body.ivid === IVID, 'and the Arabic spelling');
  var search = await request('GET', '/api/search/vehicles?plate=' + encodeURIComponent(P_TU.split(' ')[2] + 'TU' + P_TU.split(' ')[0]), ADMIN);
  ok(search.status === 200 && search.body.count === 1 && search.body.results[0].ivid === IVID, 'search by the reversed key 8646TU230 finds the vehicle');

  /* ===================================================================== */
  say('\n5. TEST 02 — RS plate, end to end');
  var rsNf = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_RS });
  ok(rsNf.status === 200 && rsNf.body.status === 'not_found' && rsNf.body.plate.registrationType === 'RS', 'an unknown RS plate parses as RS and is not found');
  var rsManual = await request('POST', '/api/resolve/manual', ORG_A, { manufacturer: 'PEUGEOT', model: '208', motorisation: MOTOR_RS, year: 2020 });
  ok(rsManual.status === 200 && rsManual.body.status === 'candidate', 'manual selection proposes a candidate');
  var rsConf = await request('POST', '/api/resolve/confirm', ORG_A, { plate: P_RS, candidate: rsManual.body.candidate, method: 'manual_selection' });
  ok(rsConf.status === 200 && rsConf.body.vehicle.registration_type === 'RS' && rsConf.body.vehicle.plate === P_RS, 'TEST 02: the RS vehicle is recorded with its RS plate');
  var rsAgain = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_RS.replace(' RS ', 'rs') });
  ok(rsAgain.body.status === 'resolved' && rsAgain.body.vehicle.id === rsConf.body.vehicle.id, 'and resolves locally from a spaceless lowercase spelling');
  var rsAudit = (await db.query("SELECT actor_type, org_id FROM idauto_audit_log WHERE event_type = 'vehicle.identify.create' AND target_ref = $1", [rsConf.body.vehicle.internal_ref])).rows[0];
  ok(rsAudit && String(rsAudit.org_id) === String(oa) && rsAudit.actor_type === 'professional_user', 'the creation is audited with the organisation');

  /* ===================================================================== */
  say('\n6. TEST 05 — OCR incorrect / uncertain');
  var weak = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_OCR, ocr_confidence: 41, method: 'camera_ocr' });
  ok(weak.status === 200 && weak.body.status === 'needs_confirmation' && weak.body.plate.requires_confirmation === true, 'a weak OCR read is returned for confirmation — nothing looked up, nothing recorded');
  var amb = await request('POST', '/api/resolve/plate', ORG_A, { plate: '1884523', ocr_confidence: 95, method: 'camera_ocr' });
  ok(amb.status === 400 && amb.body.error === 'PLATE_AMBIGUOUS' && typeof amb.body.message_fr === 'string' && amb.body.message_fr.length > 10, 'an ambiguous digit run -> 400 PLATE_AMBIGUOUS with a French message');
  var partial = await request('POST', '/api/resolve/plate', ORG_A, { plate: '230 8646' });
  ok(partial.status === 400 && partial.body.error === 'PLATE_PARTIAL', 'digits without a type -> PLATE_PARTIAL');
  var bad = await request('POST', '/api/resolve/plate', ORG_A, { plate: 'XX YY' });
  ok(bad.status === 400 && bad.body.error === 'INVALID_PLATE' && bad.raw.indexOf('SELECT') === -1 && bad.raw.indexOf('at ') === -1, 'an invalid plate -> 400 INVALID_PLATE, no technical text');
  var confirmedWeak = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_OCR, ocr_confidence: 41, method: 'camera_ocr', confirmed: true });
  ok(confirmedWeak.status === 200 && confirmedWeak.body.status === 'not_found', 'once a human confirms the digits the lookup proceeds');

  /* ===================================================================== */
  say('\n7. TEST 06 + 07 — provider timeout / unavailable (MOCK failure modes)');
  mock.setMode('timeout'); v12.resolver.setProviders([mock]);
  var to = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_PROV });
  ok(to.status === 200 && to.body.status === 'not_found' && to.body.provider_errors[0].error === 'PROVIDER_TIMEOUT', 'TEST 06: a provider timeout is reported, the request still answers');
  var toKnown = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_TU });
  ok(toKnown.body.status === 'resolved' && toKnown.body.source === 'local', 'a known plate still resolves locally while the provider times out');
  mock.setMode('unavailable'); v12.resolver.setProviders([mock]);
  var un = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_PROV });
  ok(un.body.status === 'not_found' && un.body.provider_errors[0].error === 'PROVIDER_UNAVAILABLE', 'TEST 07: an unavailable provider is reported the same way');
  var unAgain = await request('POST', '/api/resolve/plate', ORG_A, { plate: P_PROV });
  ok(unAgain.body.cache === 'miss', 'a failure is never cached as "not found" — the next lookup retries');
  var metricsAfter = await request('GET', '/api/metrics', ADMIN);
  ok(metricsAfter.status === 200 && metricsAfter.body.provider_error_rate > 0 && metricsAfter.body.resolution_latency_ms.count > 0 && metricsAfter.body.ocr_confidence.count > 0, 'metrics: provider_error_rate, resolution latency and ocr_confidence are populated');
  ok(['resolution_success_rate', 'resolution_latency_ms', 'provider_error_rate', 'ocr_confidence', 'local_cache_hit_rate'].every(function (k) { return k in metricsAfter.body; }), 'every metric the order names exists');
  mock.setMode('ok'); v12.resolver.setProviders([]);

  /* ===================================================================== */
  say('\n8. TEST 03 — VIN: scope, audit, disclosure');
  var vinNoScope = await request('POST', '/api/resolve/vin', ORG_A, { vin: VIN });
  ok(vinNoScope.status === 403 && vinNoScope.body.required_scope === 'vin:search', 'VIN resolution without vin:search -> 403 naming the scope');
  var vinAuditBefore = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND org_id = $1", [ob])).rows[0].n;
  var vinHit = await request('POST', '/api/resolve/vin', ORG_B, { vin: VIN.toLowerCase() });
  ok(vinHit.status === 200 && vinHit.body.status === 'resolved' && vinHit.body.vehicle.id === IVID, 'TEST 03: the VIN resolves to the same vehicle (case-insensitive)');
  var vinAuditAfter = (await db.query("SELECT count(*)::int n, max(change_summary) s FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND org_id = $1", [ob])).rows[0];
  ok(vinAuditAfter.n === vinAuditBefore + 1 && vinAuditAfter.s.indexOf(VIN) === -1, 'the VIN resolution is audited and the VIN itself is not in the audit row');
  ok((await request('POST', '/api/resolve/vin', ORG_B, { vin: 'BAD' })).body.error === 'INVALID_VIN', 'an invalid VIN -> INVALID_VIN');
  var vinMiss = await request('POST', '/api/resolve/vin', ORG_B, { vin: VIN_UNKNOWN });
  ok(vinMiss.status === 200 && vinMiss.body.status === 'not_found', 'an unknown VIN -> not_found');
  var ficheA = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/fiche', ORG_A);
  var ficheB = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/fiche', ORG_B);
  ok(ficheA.status === 200 && ficheA.body.vin === undefined && ficheA.body.vin_present === true, 'the fiche hides the VIN from a credential without vin:search');
  ok(ficheB.status === 200 && ficheB.body.vin === VIN, 'and discloses it to a credential with vin:search');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read' AND org_id = $1 AND target_ref = $2", [ob, IVID])).rows[0].n === 1, 'the disclosure is audited (vehicle.vin.read)');
  ok(['plate', 'vin_present', 'manufacturer', 'model', 'version', 'motorisation', 'year', 'tecdoc_car_id', 'source', 'confidence', 'verified_at', 'history'].every(function (k) { return k in ficheB.body; }), 'the fiche carries every field the order lists');
  ok(Array.isArray(ficheB.body.history) && ficheB.body.history[0].action === 'confirmed', 'with its identification history');

  /* ===================================================================== */
  say('\n9. TEST 11 — manual correction, history, refresh');
  var edit = await request('POST', '/api/resolve/confirm', ORG_A, { vehicle_ref: IVID, action: 'edit', method: 'admin', source: 'manual', candidate: { motorisation: '1.2 MPI 84ch', engine_code: 'G4LA' } });
  ok(edit.status === 200 && edit.body.vehicle.motorisation === '1.2 MPI 84ch' && edit.body.vehicle.engine_code === 'G4LA' && edit.body.vehicle.manufacturer === 'HYUNDAI', 'TEST 11: a correction changes only the corrected fields');
  var hist = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/identification/history', ORG_A);
  ok(hist.status === 200 && hist.body.history[0].action === 'edited' && hist.body.history[0].previous.motorisation === '1.2 MPI' && hist.body.history[0].next.motorisation === '1.2 MPI 84ch', 'the history records previous and next values');
  ok(hist.body.history[0].actor_type === 'organisation' && String(hist.body.history[0].org_id) === String(oa), 'and who made the change');
  var ref = await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/identification/refresh', ORG_A, {});
  ok(ref.status === 200 && ref.body.status === 'no_change' && ref.body.providers_configured === 0, 'refresh with no provider reports no_change and providers_configured 0 — nothing is invented');
  ok((await request('POST', '/api/resolve/confirm', ORG_A, { vehicle_ref: 'ivid:1:ZZZZZZZZZZZZZZZZ:ZZ', candidate: {}, method: 'admin' })).status === 404, 'confirming an unknown reference -> 404');
  var pubPassport = await request('GET', '/public/passport/' + encodeURIComponent(IVID));
  ok(pubPassport.status === 200 && pubPassport.raw.indexOf(VIN) === -1 && pubPassport.raw.indexOf('tecdoc') === -1 && pubPassport.raw.indexOf('identification_') === -1, 'the public passport shows none of the new identification columns and never the VIN');

  /* ===================================================================== */
  say('\n10. TEST 10 — catalogue: not configured, local parts, MOCK TecDoc');
  var cs = await request('GET', '/api/catalog/status', ORG_A);
  ok(cs.status === 200 && cs.body.supplier.configured === false && cs.body.supplier.message_fr === 'Catalogue fournisseur non configuré.', 'catalogue status says "Catalogue fournisseur non configuré."');
  ok((await request('GET', '/api/catalog/manufacturers', ORG_A)).status === 501, 'a supplier call without a configured catalogue -> 501 CATALOG_NOT_CONFIGURED');
  var partsNone = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts', ORG_A);
  ok(partsNone.status === 200 && partsNone.body.parts.length === 0 && partsNone.body.supplier.error === 'CATALOG_NOT_CONFIGURED', 'vehicle → parts answers with the local (empty) list and the supplier state');
  var part = await request('POST', '/api/parts', ORG_A, { reference: 'W 712/95', brand: 'MANN', oe_reference: '26300-35505', category: 'filtration', name: 'Filtre à huile' });
  ok(part.status === 201 && part.body.id === 'local:' + part.body.local_id && part.body.org_scope === 'organisation', 'an organisation adds its own catalogue reference');
  var compat = await request('POST', '/api/parts/' + part.body.local_id + '/compatibility', ORG_A, { vehicle_ref: IVID });
  ok(compat.status === 201, 'and declares it compatible with the vehicle');
  var stock = await request('PUT', '/api/parts/' + part.body.local_id + '/stock', ORG_A, { quantity: 4, price_millimes: 28500 });
  ok(stock.status === 200 && stock.body.quantity === 4, 'and sets its stock and price');
  var partsA = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts', ORG_A);
  ok(partsA.body.parts.length === 1 && partsA.body.parts[0].reference === 'W 712/95' && partsA.body.parts[0].availability.in_stock === true && partsA.body.parts[0].availability.price_millimes === 28500 && partsA.body.parts[0].source === 'local', 'vehicle → parts now lists the local part with availability and price');
  ok(['reference', 'brand', 'oe_reference', 'category', 'source'].every(function (k) { return k in partsA.body.parts[0]; }), 'each part carries reference, brand, OE reference, category, source');
  var partsB = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts', ORG_B);
  ok(partsB.body.parts.length === 0, "organisation B does not see organisation A's catalogue entry");
  var srch = await request('GET', '/api/parts/search?q=w71295', ORG_A);
  ok(srch.body.parts.length === 1, 'reference search is tolerant to spaces and slashes');
  var det = await request('GET', '/api/parts/' + encodeURIComponent(part.body.id), ORG_A);
  ok(det.status === 200 && det.body.compatibility.length === 1, 'part details include its compatibility rows');
  ok((await request('GET', '/api/parts/tecdoc:1', ORG_A)).status === 501, 'a supplier part id without a catalogue -> 501');
  var mockTd = mockTecDocModule.createMockTecDocProvider({ fixtures: {
    manufacturers: [{ id: 1, name: 'HYUNDAI' }], models: { 1: [{ id: 10, name: 'i20 (GB)', year_from: 2014, year_to: 2020 }] },
    submodels: { 10: [{ car_id: 123456, name: '1.2', motorisation: '1.2 MPI', engine_code: 'G4LA', kw: 62 }] },
    vehicles: { 123456: { manufacturer: 'HYUNDAI', model: 'i20 (GB)', motorisation: '1.2 MPI', engine_code: 'G4LA', year_from: 2014, year_to: 2020 } },
    articles: [{ article_id: 9001, reference: '0986AF0055', brand: 'BOSCH', oe_reference: '26300-35505', category: 'filtration', name: 'Filtre à huile', car_ids: [123456] }, { article_id: 9002, reference: 'P85145', brand: 'BREMBO', category: 'freinage', name: 'Plaquettes', car_ids: [123456] }] } });
  v12.catalog.setTecDoc(mockTd);
  var partsMock = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts', ORG_A);
  ok(partsMock.body.parts.length === 3 && partsMock.body.sources.supplier === 2 && partsMock.body.parts.filter(function (p) { return p.source === 'mock'; }).length === 2, 'TEST 10 (MOCK TecDoc): vehicle → tecdoc_car_id → compatible parts, local + supplier merged, every item labelled by source');
  ok((await request('GET', '/api/catalog/manufacturers', ORG_A)).body.items[0].name === 'HYUNDAI' && (await request('GET', '/api/catalog/models/10/vehicles', ORG_A)).body.items[0].id === 123456, 'manufacturers → models → submodels walk the (MOCK) catalogue');
  ok((await request('GET', '/api/catalog/vehicles/123456', ORG_A)).body.items.engine_code === 'G4LA', 'getVehicleDetails(carId)');
  ok((await request('GET', '/api/parts/tecdoc:9001', ORG_A)).body.reference === '0986AF0055', 'getPartDetails for a supplier article');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts?category=freinage', ORG_A)).body.parts.length === 1, 'category filter applies to both sources');
  mockTd.setMode('unavailable');
  var partsDown = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/parts', ORG_A);
  ok(partsDown.status === 200 && partsDown.body.parts.length === 1 && partsDown.body.supplier.error === 'CATALOG_UNAVAILABLE', 'a supplier outage keeps the local parts and reports the outage');
  mockTd.setMode('ok');
  v12.catalog.setTecDoc(require(path.join(BASE, 'reference', 'parts', 'tecdoc-adapter.js')).createTecDocAdapter(null));

  /* ===================================================================== */
  say('\n11. TEST 12 — the full workshop flow, as organisation A');
  v12.resolver.setProviders([mockModule.createMockVehicleResolver({ fixtures: [{ plate: P_FLOW, manufacturer: 'RENAULT', model: 'CLIO IV', motorisation: '1.5 dCi 90', year: 2016, tecdoc_car_id: 123456, confidence: 0.85 }] })]);
  var arrive = await request('POST', '/api/workshop/visits', ORG_A, { plate: P_FLOW.replace(' TUN ', ' TU '), plate_read_method: 'camera_ocr', ocr_confidence: 0.93, customer_ref: 'CLI-00042', reason: 'Vidange + plaquettes' });
  ok(arrive.status === 201 && arrive.body.visit.id > 0 && arrive.body.visit.status === 'open', '1–2. the vehicle arrives, the camera reading opens a visit');
  ok(arrive.body.identification.status === 'candidate' && arrive.body.visit.vehicle === null, '3–5. the (MOCK) provider proposes a candidate; the visit has no vehicle until confirmation');
  ok(arrive.body.visit.plate_read === P_FLOW && arrive.body.visit.plate_read_method === 'camera_ocr' && arrive.body.visit.plate_read_confidence === 0.93 && arrive.body.visit.customer_ref === 'CLI-00042', 'the visit records how the plate was read and the opaque customer reference');
  var VISIT = arrive.body.visit.id;
  var confirmVisit = await request('POST', '/api/workshop/visits/' + VISIT + '/identification', ORG_A, { plate: P_FLOW, candidate: arrive.body.identification.candidate, method: 'plate_ocr', source: 'mock', confidence: 0.85 });
  ok(confirmVisit.status === 200 && confirmVisit.body.vehicle.verified === true && confirmVisit.body.visit.vehicle.id === confirmVisit.body.vehicle.id && confirmVisit.body.visit.status === 'in_progress', '4–6. confirmation records the vehicle and attaches it to the visit');
  var FLOW_IVID = confirmVisit.body.vehicle.id;
  var p2 = await request('POST', '/api/parts', ORG_A, { reference: 'DF4184', brand: 'TRW', category: 'freinage', name: 'Plaquettes avant' });
  await request('POST', '/api/parts/' + p2.body.local_id + '/compatibility', ORG_A, { manufacturer: 'RENAULT', model: 'CLIO IV', motorisation: '1.5 dCi 90' });
  var visitParts = await request('GET', '/api/workshop/visits/' + VISIT + '/parts', ORG_A);
  ok(visitParts.status === 200 && visitParts.body.catalogue.parts.some(function (p) { return p.reference === 'DF4184'; }), '7. parts for the visit — matched on make / model / motorisation');
  var op = await request('POST', '/api/workshop/visits/' + VISIT + '/operations', ORG_A, { operation_type: 'replacement', description: 'Plaquettes avant', part_id: p2.body.id, quantity: 1 });
  ok(op.status === 201 && op.body.part_id === p2.body.id, '8. the mechanic selects the part in an operation');
  var op2 = await request('POST', '/api/workshop/visits/' + VISIT + '/operations', ORG_A, { operation_type: 'service', description: 'Vidange' });
  ok(op2.status === 201, '9. and adds a service operation');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', ORG_A, { operation_type: 'weld' })).status === 400, 'an unknown operation type -> 400');
  var order = await request('POST', '/api/workshop/orders', ORG_A, { visit_id: VISIT, lines: [{ part_id: p2.body.id, quantity: 1 }] });
  ok(order.status === 201 && order.body.status === 'draft' && order.body.lines.length === 1, 'an order is created for the part');
  ok((await request('POST', '/api/workshop/orders/' + order.body.id + '/status', ORG_A, { status: 'placed' })).body.status === 'placed', 'and placed');
  var visitView = await request('GET', '/api/workshop/visits/' + VISIT, ORG_A);
  ok(visitView.body.operations.length === 2 && visitView.body.orders.length === 1, 'the visit view lists its operations and orders');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations/' + op.body.id + '/status', ORG_A, { status: 'done' })).body.status === 'done', 'an operation is marked done');
  var closed = await request('POST', '/api/workshop/visits/' + VISIT + '/close', ORG_A, {});
  ok(closed.status === 200 && closed.body.status === 'closed' && closed.body.closed_at, 'the visit is closed');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', ORG_A, { operation_type: 'repair' })).status === 409, 'a closed visit accepts no operation');
  var second = await request('POST', '/api/workshop/visits', ORG_A, { plate: P_FLOW, plate_read_method: 'manual', plate_confirmed: true, customer_ref: 'CLI-00042' });
  ok(second.status === 201 && second.body.identification.status === 'resolved' && second.body.visit.vehicle.id === FLOW_IVID, 'a second arrival of the same car resolves locally and opens a second visit');
  var byVehicle = await request('GET', '/api/workshop/visits?vehicle_ref=' + encodeURIComponent(FLOW_IVID), ORG_A);
  ok(byVehicle.status === 200 && byVehicle.body.visits.length === 2, 'several visits per vehicle are listed');
  ok((await request('GET', '/api/workshop/visits/' + VISIT, ORG_B)).status === 404, "organisation B cannot read organisation A's visit");
  ok((await request('GET', '/api/workshop/visits?vehicle_ref=' + encodeURIComponent(FLOW_IVID), ORG_B)).body.visits.length === 0, 'nor list them');
  ok((await request('POST', '/api/workshop/visits', ORG_A, { customer_ref: 'Mohamed Ben Ali 98 765 432' })).status === 400, 'a customer_ref that looks like personal data (spaces) is refused');
  var noVehicle = await request('POST', '/api/workshop/visits', ORG_A, { reason: 'plaque illisible' });
  ok(noVehicle.status === 201 && noVehicle.body.identification.status === 'not_identified' && noVehicle.body.visit.plate_read_method === 'none', 'CAMERA FAILED: a visit can open with no plate at all, to be identified later');
  var viaVin = await request('POST', '/api/workshop/visits/' + noVehicle.body.visit.id + '/identification', ORG_A, { vin: VIN_HONDA, candidate: { manufacturer: 'HONDA', model: 'ACCORD', year: 2003 }, method: 'vin' });
  ok(viaVin.status === 200 && viaVin.body.visit.identification_method === 'vin' && viaVin.body.vehicle.vin_present === true, 'VEHICLE NOT FOUND → identified by VIN on the open visit');
  var wsAudit = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type LIKE 'workshop.%' AND org_id = $1", [oa])).rows[0].n;
  ok(wsAudit >= 8, 'every workshop write is audited with the organisation (' + wsAudit + ' rows)');
  var noPii = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'idauto_workshop%' AND (column_name ILIKE '%name%' OR column_name ILIKE '%phone%' OR column_name ILIKE '%address%' OR column_name ILIKE '%email%')")).rows;
  ok(noPii.length === 0, 'no workshop table has a name / phone / address / email column');
  v12.resolver.setProviders([]);

  /* ===================================================================== */
  say('\n12. OBSERVABILITY');
  var prov = await request('GET', '/api/resolution/providers', ADMIN);
  ok(prov.status === 200 && prov.body.vehicle_providers[0].name === 'local' && prov.body.catalogue.supplier.configured === false && 'hit_rate' in prov.body.cache, 'providers endpoint lists local first, the catalogue state and the cache');
  var m = await request('GET', '/api/metrics', ADMIN);
  ok(m.body.counters.vehicle_confirmed >= 3 && m.body.local_cache_hit_rate !== null, 'confirmations and cache hits are counted');
  var lines = [];
  var obsMod = require(path.join(BASE, 'reference', 'observability.js'));
  var o = obsMod.createObservability({ sink: function (l) { lines.push(l); } });
  o.event('plate_resolution_started', { plate: '230 TUN 8646', token: 'SECRET-TOKEN', authorization: 'Bearer SECRET', captcha_token: 'CAP', vin: 'WVWZZZ1JZ3W386752', ip: '1.2.3.4' });
  ok(lines[0].indexOf('SECRET') === -1 && lines[0].indexOf('CAP') === -1 && lines[0].indexOf('1.2.3.4') === -1 && lines[0].indexOf('WVWZZZ1JZ3W386752') === -1 && lines[0].indexOf('plate_resolution_started') !== -1, 'a log line never carries a token, a captcha value, an IP or a full VIN');
  ok(['plate_resolution_started', 'plate_resolution_success', 'plate_resolution_failed', 'vehicle_resolved', 'vehicle_confirmed', 'tecdoc_lookup_started', 'tecdoc_lookup_success', 'tecdoc_lookup_failed'].every(function (e) { return (resolverSrc + fs.readFileSync(path.join(BASE, 'reference', 'parts', 'tecdoc-adapter.js'), 'utf8')).indexOf("'" + e + "'") !== -1; }), 'every event name the order lists is emitted somewhere');

  server.close();
  await db.closePool();
  console.log('\nIDA-V12 vehicle identification, catalogue and workshop: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) { console.error('FATAL: ' + (err && err.stack || err)); process.exit(1); });
