'use strict';
/* IDA-G8 — THE RESOLUTION / PASSPORT CONTRACT IS TRUE OF THE RUNNING SERVER.
 *
 * docs/contracts/idauto-resolution.openapi.json documents the routes other
 * MYTHOS systems are told to use to find a vehicle and read its passport. This
 * suite keeps it true, against the real server started in-process (the way the
 * other database suites start it) and a scratch PostgreSQL (refuses anything
 * not named idauto_scratch_*):
 *
 *   0. the document: OpenAPI 3.1, every $ref resolves, every schema keyword is
 *      one the checker implements (tests/helpers/json-schema-lite.js);
 *   1. the checker rejects what it must (so a lax checker cannot pass §4);
 *   2. FORWARD — every documented operation exists in the dispatch table with
 *      the documented scope (authenticated routes) or answers (public routes);
 *   3. REVERSE — no undocumented route under the documented prefixes, in the
 *      dispatch table or by probing the hand-dispatched /public/ shapes;
 *   4. RESPONSES — real requests to every operation; each status must be
 *      documented and each body must validate against the documented schema;
 *      every documented status except 429 is exercised at least once.
 *
 * Fixtures: vehicles created through the documented routes themselves, with
 * random plates and VINs (the scratch database persists between runs).
 */
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var DOC_PATH = path.join(BASE, 'docs', 'contracts', 'idauto-resolution.openapi.json');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var ORG_FULL = 'oc-full-' + crypto.randomBytes(10).toString('hex');
var ORG_VIN = 'oc-vin-' + crypto.randomBytes(10).toString('hex');
var ORG_NONE = 'oc-none-' + crypto.randomBytes(10).toString('hex');
var CONTRACT_SCOPES = ['vehicle:resolve', 'vehicle:write', 'vehicle:search', 'identity:resolve', 'passport:read'];
var identities = {};
identities[ADMIN] = 'usr_' + crypto.randomBytes(12).toString('hex');
identities[ORG_FULL] = { actor_ref: 'svc_contract_full', org_id: 0, scopes: CONTRACT_SCOPES.slice() };
identities[ORG_VIN] = { actor_ref: 'svc_contract_vin', org_id: 0, scopes: CONTRACT_SCOPES.concat(['vin:search']) };
identities[ORG_NONE] = { actor_ref: 'svc_contract_none', org_id: 0, scopes: ['parts:read'] };
// The public routes bucket per client. A documentation address (RFC 5737) of
// its own keeps this suite out of the bucket the other suites share.
var CLIENT_IP = '192.0.2.' + (1 + crypto.randomBytes(1)[0] % 254);

var db = require(path.join(BASE, 'reference', 'db.js'));
var checker = require('./helpers/json-schema-lite.js').createChecker();
var doc = checker.load(DOC_PATH);
checker.addSchemaDir(path.join(BASE, 'protocol', 'schemas'));
checker.addSchemaDir(path.join(BASE, 'protocol', 'events'));
var port, api;

function request(method, p, token, body) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Content-Length': payload ? Buffer.byteLength(payload) : 0, 'X-Real-IP': CLIENT_IP };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed; try { parsed = JSON.parse(raw); } catch (_) { parsed = undefined; } resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---- the document, as a list of operations ---- */
var METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
var ops = [];
Object.keys(doc.paths).forEach(function (p) {
  METHODS.forEach(function (m) {
    var op = doc.paths[p][m];
    if (op) ops.push({ path: p, method: m.toUpperCase(), op: op, id: op.operationId, regex: new RegExp('^' + p.replace(/\{[^}]+\}/g, '[^/]+') + '$'), sample: p.replace(/\{[^}]+\}/g, 'x') });
  });
});
function opById(id) { return ops.filter(function (o) { return o.id === id; })[0]; }
function isPublic(o) { return Array.isArray(o.op.security) && o.op.security.length === 0; }

function responseSchema(o, status) {
  var r = o.op.responses[String(status)];
  if (!r) return null;
  if (r.$ref) r = checker.resolveRef(r.$ref, DOC_PATH).schema;
  return r.content && r.content['application/json'] && r.content['application/json'].schema;
}

var exercised = {};   // opId -> { status: true }
function expectContract(id, res, label) {
  var o = opById(id);
  var schema = responseSchema(o, res.status);
  (exercised[id] = exercised[id] || {})[res.status] = true;
  if (!schema) { ok(false, id + ' ' + label + ': status ' + res.status + ' is not documented (body ' + res.raw.slice(0, 160) + ')'); return false; }
  var json = /^application\/json\b/.test(res.headers['content-type'] || '');
  var errors = json && res.body !== undefined ? checker.validate(schema, res.body, DOC_PATH) : ['not a JSON body'];
  ok(!errors.length, id + ' ' + label + ' -> ' + res.status + ' validates' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  return !errors.length;
}

function randomVin(prefix) { var a = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', out = prefix; while (out.length < 17) out += a[crypto.randomBytes(1)[0] % a.length]; return out; }
function seriesPlate(n) { return String(100 + crypto.randomBytes(2).readUInt16BE(0) % 899) + ' TUN ' + String(1000 + n * 1000 + crypto.randomBytes(2).readUInt16BE(0) % 999); }

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '" — point IDAUTO_DB_NAME at a scratch database'); process.exit(1); }
  console.log('database: ' + dbName);
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Contract test','garage','active') RETURNING id")).rows[0].id;
  [ORG_FULL, ORG_VIN, ORG_NONE].forEach(function (k) { identities[k].org_id = org; });
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  api = require(path.join(BASE, 'reference', 'api.js'));
  var server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  try {
    /* ================================================================= */
    say('0. THE DOCUMENT');
    ok(doc.openapi === '3.1.0', 'OpenAPI 3.1.0');
    ok(doc.jsonSchemaDialect === 'https://json-schema.org/draft/2020-12/schema', 'schemas are JSON Schema 2020-12, the dialect of protocol/schemas');
    ok(ops.length === 9, 'nine operations are documented (got ' + ops.length + ')');
    var lintErrors = [];
    ops.forEach(function (o) {
      Object.keys(o.op.responses).forEach(function (st) {
        try { var s = responseSchema(o, st); if (!s) throw new Error('no application/json schema'); checker.lint(s, DOC_PATH, o.id + ' ' + st); } catch (e) { lintErrors.push(o.id + ' ' + st + ': ' + e.message); }
      });
      if (o.op.requestBody) { try { checker.lint(o.op.requestBody.content['application/json'].schema, DOC_PATH, o.id + ' body'); } catch (e) { lintErrors.push(o.id + ' body: ' + e.message); } }
    });
    ok(!lintErrors.length, 'every response and request schema resolves and uses only implemented keywords' + (lintErrors.length ? ': ' + lintErrors.join(' | ') : ''));
    ok(ops.every(function (o) { return Object.prototype.hasOwnProperty.call(o.op, 'x-idauto-scope'); }), 'every operation states its scope (null for the public routes)');
    ok(ops.every(function (o) { return isPublic(o) === (o.op['x-idauto-scope'] === null) && isPublic(o) === /^\/public\//.test(o.path); }), 'exactly the /public/ operations are credential-free');
    ok(ops.every(function (o) { return isPublic(o) || (o.op.responses['401'] && o.op.responses['403']); }), 'every authenticated operation documents 401 and 403');
    var prefixes = doc['x-idauto-contract'].prefixes;
    ok(Array.isArray(prefixes) && prefixes.length === 4, 'the contract names its prefixes');

    /* ================================================================= */
    say('1. THE CHECKER REJECTS WHAT IT MUST (non-vacuity of §4)');
    var S = function (name) { return { $ref: '#/components/schemas/' + name }; };
    var v = function (name, value) { return checker.validate(S(name), value, DOC_PATH).length === 0; };
    ok(v('NotFoundError', { error: 'not found' }) && !v('NotFoundError', { error: 'nope' }) && !v('NotFoundError', { error: 'not found', x: 1 }), 'const and additionalProperties:false are enforced');
    ok(!v('PublicPlateResolution', { plate_number: '1 TUN 1', ivid: 'plate-123' }), 'a pattern is enforced (an IVID must look like one)');
    ok(!v('SearchResult', { criterion: 'plate', count: 0 }), 'a missing required property is refused');
    ok(!v('Resolution', { status: 'resolved' }) && v('Resolution', { status: 'not_found', source: null, latency_ms: 1, cache: 'miss', provider_errors: [] }), 'oneOf picks exactly one status shape');
    var protoPlate = { protocol_version: '0.1.0-draft', id: '1', subject_ivid: 'x', plate_number: '1 TUN 1', format_code: 'TUN_STD', valid_from: '2026-01-01T00:00:00.000Z' };
    ok(v('PublicPlate', protoPlate) && !v('PublicPlate', Object.assign({ region_code: '11' }, protoPlate)) && !v('PublicPlate', Object.assign({}, protoPlate, { valid_from: 'yesterday' })), 'cross-file $ref to protocol/schemas/plate.schema.json, "not" and date-time are enforced');
    ok(!v('PublicPassport', { protocol_version: '0.1.0-draft', extra: 1 }), 'unevaluatedProperties:false refuses an undocumented passport key');
    var threw = false; try { checker.validate({ type: 'string', frobnicate: 1 }, 'x', DOC_PATH); } catch (_) { threw = true; }
    ok(threw, 'an unknown keyword throws instead of being ignored');

    /* ================================================================= */
    say('2. FORWARD — every documented operation exists, with the documented scope');
    var routes = api._allRoutes, scopes = api._routeScopes;
    ops.filter(function (o) { return !isPublic(o); }).forEach(function (o) {
      var route = routes.filter(function (r) { return r.method === o.method && r.pattern.test(o.sample); })[0];
      ok(!!route, o.method + ' ' + o.path + ' is in the dispatch table');
      var sc = scopes.filter(function (r) { return r.method === o.method && r.pattern.test(o.sample); })[0];
      ok(!!sc && sc.scope === o.op['x-idauto-scope'], o.method + ' ' + o.path + ' requires ' + o.op['x-idauto-scope'] + ' (server: ' + (sc && sc.scope) + ')');
    });
    // The public routes are dispatched by hand (reference/api.js handlePublicPassportRoute); §4 proves they answer 200.
    ok(!routes.some(function (r) { return /^\^\\\/public/.test(r.pattern.source); }), 'the authenticated dispatch table holds nothing under /public/ (the public routes are reached before authentication)');

    /* ================================================================= */
    say('3. REVERSE — nothing undocumented under the contract prefixes');
    function literal(re) { return re.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\(\[\^\/\]\+\)|\[\^\/\]\+/g, 'x').replace(/\\\//g, '/').replace(/\\/g, ''); }
    var under = routes.filter(function (r) { var l = literal(r.pattern); return prefixes.some(function (p) { return l.indexOf(p) === 0; }); });
    ok(under.length >= 5, 'precondition: the dispatch table has routes under the prefixes (got ' + under.length + ')');
    under.forEach(function (r) {
      var l = literal(r.pattern);
      ok(ops.some(function (o) { return o.method === r.method && o.regex.test(l); }), r.method + ' ' + l + ' (dispatch table) is documented');
    });
    var publicIvid = null;   // filled in §4; the probes below run after it
    var probes = function (ivid) {
      return [['GET', '/public/plates/'], ['GET', '/public/plates/230TU8646/extra'], ['GET', '/public/passport/'], ['GET', '/public/passport/' + encodeURIComponent(ivid) + '/facts'],
        ['GET', '/public/plates'], ['GET', '/public/passport'], ['GET', '/api/resolve/'], ['GET', '/api/resolve/other'], ['POST', '/api/resolve/other'], ['GET', '/api/passport/'], ['GET', '/api/passport/' + encodeURIComponent(ivid) + '/extra']];
    };

    /* ================================================================= */
    say('4. RESPONSES — real requests, documented statuses, valid bodies');
    var MAKE = 'CONTRACTMAKE' + crypto.randomBytes(3).toString('hex').toUpperCase();
    var P_A = seriesPlate(1), P_B = seriesPlate(2), P_C = seriesPlate(3), P_UNKNOWN = seriesPlate(4);
    var VIN_B = randomVin('VF1'), VIN_UNKNOWN = randomVin('JHM');

    // Fixtures through the documented write route itself.
    var cA = await request('POST', '/api/resolve/confirm', ORG_FULL, { plate: P_A, method: 'plate_manual', candidate: { manufacturer: MAKE, model: 'ALPHA', year: 2015, fuel_type: 'diesel' } });
    expectContract('confirmIdentification', cA, 'new vehicle by plate');
    var cB = await request('POST', '/api/resolve/confirm', ORG_VIN, { plate: P_B, vin: VIN_B, method: 'vin', candidate: { manufacturer: MAKE, model: 'BETA', year: 2018 } });
    expectContract('confirmIdentification', cB, 'new vehicle by plate + VIN (vin:search holder: vin in the record)');
    var cC = await request('POST', '/api/resolve/confirm', ORG_FULL, { plate: P_C, method: 'plate_manual', candidate: { manufacturer: MAKE, model: 'GAMMA' } });
    expectContract('confirmIdentification', cC, 'third vehicle (merged below)');
    var A = cA.body.vehicle.id, B = cB.body.vehicle.id, C = cC.body.vehicle.id;
    ok(!!(A && B && C) && cB.body.vehicle.vin === VIN_B, 'precondition: three vehicles with IVIDs; the VIN is disclosed to the vin:search holder');
    publicIvid = A;
    expectContract('confirmIdentification', await request('POST', '/api/resolve/confirm', ORG_FULL, { vehicle_ref: A, method: 'manual_selection', action: 'edit', candidate: { manufacturer: MAKE, model: 'ALPHA', year: 2016 } }), 'edit an existing vehicle');
    expectContract('confirmIdentification', await request('POST', '/api/resolve/confirm', ORG_FULL, { plate: 'abc', method: 'plate_manual', candidate: {} }), 'malformed plate');
    expectContract('confirmIdentification', await request('POST', '/api/resolve/confirm', ORG_FULL, { vehicle_ref: 'IDA2D-nothing-here', method: 'manual_selection', candidate: {} }), 'unknown vehicle_ref');

    var f1 = await request('POST', '/api/vehicles/' + encodeURIComponent(A) + '/facts', ADMIN, { fact_key: 'colour', fact_value: 'blanc', access_scope: 'public', evidence_type: 'document_scan_official' });
    var f2 = await request('POST', '/api/vehicles/' + encodeURIComponent(A) + '/facts', ADMIN, { fact_key: 'engine_cc', fact_value: '1461', access_scope: 'professional' });
    ok(f1.status === 201 && f2.status === 201, 'precondition: a public and a professional fact recorded on vehicle A (got ' + f1.status + ', ' + f2.status + ')');
    var merge = await request('POST', '/api/vehicles/' + encodeURIComponent(C) + '/merge', ADMIN, { canonical_ref: B });
    ok(merge.status === 200, 'precondition: vehicle C merged into B (got ' + merge.status + ' ' + merge.raw.slice(0, 120) + ')');

    // --- GET /public/plates/{plate}
    var ppA = await request('GET', '/public/plates/' + encodeURIComponent(P_A.replace(' TUN ', 'TU').replace(/ /g, '')));
    expectContract('resolvePublicPlate', ppA, 'known plate, compact spelling');
    ok(ppA.body && ppA.body.ivid === A && ppA.body.plate_number === P_A, 'the plate resolves to vehicle A in canonical form');
    var ppC = await request('GET', '/public/plates/' + encodeURIComponent(P_C));
    expectContract('resolvePublicPlate', ppC, 'plate of a merged vehicle');
    ok(ppC.body && ppC.body.ivid === B, 'a merged vehicle\'s plate resolves to the canonical IVID');
    expectContract('resolvePublicPlate', await request('GET', '/public/plates/' + encodeURIComponent(P_UNKNOWN)), 'unknown well-formed plate');
    expectContract('resolvePublicPlate', await request('GET', '/public/plates/abc'), 'malformed plate');
    expectContract('resolvePublicPlate', await request('POST', '/public/plates/' + encodeURIComponent(P_A), null, {}), 'POST');

    // --- GET /public/passport/{ivid}
    var pub = await request('GET', '/public/passport/' + encodeURIComponent(A));
    expectContract('getPublicPassport', pub, 'known IVID');
    ok(pub.body && pub.body.facts && pub.body.facts.some(function (f) { return f.fact_key === 'colour'; }) && !pub.body.facts.some(function (f) { return f.fact_key === 'engine_cc'; }),
      'non-vacuous: the public fact is served and validated, the professional one is not served');
    ok(pub.body && Array.isArray(pub.body.plates) && pub.body.plates.length >= 1, 'non-vacuous: the public plate list is served and validated');
    var unknownIvid = require(path.join(BASE, 'reference', 'ivid.js')).generate();
    expectContract('getPublicPassport', await request('GET', '/public/passport/' + encodeURIComponent(unknownIvid)), 'unknown well-formed IVID');
    expectContract('getPublicPassport', await request('GET', '/public/passport/ivid:1:ABCDEFGHJKMNPQRS:TU'), 'malformed IVID');
    expectContract('getPublicPassport', await request('DELETE', '/public/passport/' + encodeURIComponent(A)), 'DELETE');
    var pubC = await request('GET', '/public/passport/' + encodeURIComponent(C));
    expectContract('getPublicPassport', pubC, 'IVID of a merged vehicle');
    ok(pubC.body && pubC.body.ivid === B && pubC.body.qr.payload === B, 'the merged IVID opens the canonical passport');

    // --- GET /api/passport/{ivid}
    var pro = await request('GET', '/api/passport/' + encodeURIComponent(A), ORG_FULL);
    expectContract('getProfessionalPassport', pro, 'known IVID');
    ok(pro.body && pro.body.facts.some(function (f) { return f.fact_key === 'engine_cc'; }), 'non-vacuous: the professional fact is served and validated');
    expectContract('getProfessionalPassport', await request('GET', '/api/passport/' + encodeURIComponent(B), ORG_VIN), 'vin:search holder (VIN fact disclosed, audited)');
    expectContract('getProfessionalPassport', await request('GET', '/api/passport/' + encodeURIComponent(unknownIvid), ORG_FULL), 'unknown IVID');

    // --- GET /api/search/vehicles
    function q(o) { return '/api/search/vehicles?' + Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
    var sA = await request('GET', q({ plate: P_A }), ORG_FULL);
    expectContract('searchVehicles', sA, 'by plate');
    ok(sA.body && sA.body.count === 1 && sA.body.results[0].ivid === A, 'the plate search finds vehicle A');
    var sC = await request('GET', q({ plate: P_C }), ORG_FULL);
    expectContract('searchVehicles', sC, 'by the plate of a merged vehicle');
    ok(sC.body && sC.body.results[0] && sC.body.results[0].is_alias === true && sC.body.results[0].matched_ref === C, 'non-vacuous: matched_ref / is_alias are served and validated');
    expectContract('searchVehicles', await request('GET', q({ ivid: A }), ORG_FULL), 'by IVID');
    expectContract('searchVehicles', await request('GET', q({ internal_ref: cA.body.vehicle.internal_ref }), ORG_FULL), 'by internal_ref');
    var sAttr = await request('GET', q({ make: MAKE }), ORG_FULL);
    expectContract('searchVehicles', sAttr, 'by make');
    ok(sAttr.body && sAttr.body.criterion === 'attributes' && sAttr.body.count >= 2 && sAttr.body.capped === false, 'the attribute search answers with capped:false');
    expectContract('searchVehicles', await request('GET', q({ plate: P_UNKNOWN }), ORG_FULL), 'miss (200, count 0)');
    expectContract('searchVehicles', await request('GET', q({ vin: VIN_B }), ORG_VIN), 'by VIN (vin:search, audited)');
    expectContract('searchVehicles', await request('GET', q({ vin: VIN_B }), ORG_FULL), 'by VIN without vin:search');
    expectContract('searchVehicles', await request('GET', '/api/search/vehicles', ORG_FULL), 'no criterion');
    expectContract('searchVehicles', await request('GET', q({ year: '20x5' }), ORG_FULL), 'malformed year');

    // --- GET /api/vehicles/{ref}/resolve
    var rC = await request('GET', '/api/vehicles/' + encodeURIComponent(C) + '/resolve', ORG_FULL);
    expectContract('resolveVehicleRef', rC, 'merged IVID');
    ok(rC.body && rC.body.is_alias === true && rC.body.canonical.ivid === B && rC.body.merge_hops === 1, 'the merged reference resolves to B in one hop');
    expectContract('resolveVehicleRef', await request('GET', '/api/vehicles/' + encodeURIComponent(cA.body.vehicle.internal_ref) + '/resolve', ORG_FULL), 'internal_ref');
    expectContract('resolveVehicleRef', await request('GET', '/api/vehicles/IDA2D-nothing-here/resolve', ORG_FULL), 'unknown reference');

    // --- POST /api/resolve/plate
    var rp = await request('POST', '/api/resolve/plate', ORG_FULL, { plate: P_A });
    expectContract('resolvePlate', rp, 'known plate');
    ok(rp.body && rp.body.status === 'resolved' && rp.body.vehicle.id === A && rp.body.vehicle.vin === undefined, 'resolved to A; no VIN without vin:search');
    expectContract('resolvePlate', await request('POST', '/api/resolve/plate', ORG_FULL, { plate: P_A }), 'known plate again (cache)');
    expectContract('resolvePlate', await request('POST', '/api/resolve/plate', ORG_FULL, { plate: P_UNKNOWN }), 'unknown plate');
    var low = await request('POST', '/api/resolve/plate', ORG_FULL, { plate: P_A, ocr_confidence: 0.3, method: 'camera_ocr' });
    expectContract('resolvePlate', low, 'low OCR confidence');
    ok(low.body && low.body.status === 'needs_confirmation', 'a low OCR confidence needs confirmation');
    expectContract('resolvePlate', await request('POST', '/api/resolve/plate', ORG_FULL, { plate: 'abc' }), 'invalid plate');
    expectContract('resolvePlate', await request('POST', '/api/resolve/plate', ORG_FULL, { plate: '1884523' }), 'ambiguous plate');

    // --- POST /api/resolve/vin
    var rv = await request('POST', '/api/resolve/vin', ORG_VIN, { vin: VIN_B });
    expectContract('resolveVin', rv, 'known VIN');
    ok(rv.body && rv.body.status === 'resolved' && rv.body.vehicle.id === B, 'the VIN resolves to B');
    expectContract('resolveVin', await request('POST', '/api/resolve/vin', ORG_VIN, { vin: VIN_UNKNOWN }), 'unknown VIN');
    expectContract('resolveVin', await request('POST', '/api/resolve/vin', ORG_VIN, { vin: 'SHORT' }), 'malformed VIN');
    expectContract('resolveVin', await request('POST', '/api/resolve/vin', ORG_FULL, { vin: VIN_B }), 'without vin:search');

    // --- POST /api/resolve/manual
    var rm = await request('POST', '/api/resolve/manual', ORG_FULL, { manufacturer: MAKE, model: 'ALPHA' });
    expectContract('resolveManual', rm, 'one local match');
    ok(rm.body && rm.body.status === 'resolved', 'a single local match is resolved');
    var rmc = await request('POST', '/api/resolve/manual', ORG_FULL, { manufacturer: MAKE + 'X', model: 'DELTA', year: 2019 });
    expectContract('resolveManual', rmc, 'no local match');
    ok(rmc.body && rmc.body.status === 'candidate', 'no local match is a candidate');
    expectContract('resolveManual', await request('POST', '/api/resolve/manual', ORG_FULL, { manufacturer: '' }), 'missing make/model');

    // --- 401 and 403 on every authenticated operation
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (isPublic(o)) continue;
      var concrete = o.path.replace('{ivid}', encodeURIComponent(A)).replace('{ref}', encodeURIComponent(A));
      if (o.id === 'searchVehicles') concrete += '?plate=' + encodeURIComponent(P_A);
      var body = o.method === 'POST' ? {} : undefined;
      expectContract(o.id, await request(o.method, concrete, null, body), 'no credential');
      expectContract(o.id, await request(o.method, concrete, ORG_NONE, body), 'credential without the scope');
      expectContract(o.id, await request(o.method, concrete, 'not-a-known-credential', body), 'unknown credential');
    }

    // --- coverage of the documented statuses
    ops.forEach(function (o) {
      var documented = Object.keys(o.op.responses).filter(function (s) { return s !== '429'; });
      var missing = documented.filter(function (s) { return !(exercised[o.id] || {})[s]; });
      ok(!missing.length, o.id + ': every documented status except 429 was exercised (' + documented.join(', ') + ')' + (missing.length ? ' — missing ' + missing.join(', ') : ''));
    });

    /* ================================================================= */
    say('3b. REVERSE — probes: undocumented shapes and methods are not served');
    var shapes = probes(publicIvid);
    for (var j = 0; j < shapes.length; j++) {
      var pr = await request(shapes[j][0], shapes[j][1], ADMIN);
      ok(pr.status === 404, shapes[j][0] + ' ' + shapes[j][1] + ' -> 404 (got ' + pr.status + ')');
    }
    for (var k = 0; k < ops.length; k++) {
      var od = ops[k];
      var concreteOther = od.path.replace('{ivid}', encodeURIComponent(publicIvid)).replace('{ref}', encodeURIComponent(publicIvid)).replace('{plate}', encodeURIComponent(P_A));
      var others = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].filter(function (mm) { return !ops.some(function (x) { return x.path === od.path && x.method === mm; }); });
      for (var m = 0; m < others.length; m++) {
        var r405 = await request(others[m], concreteOther, ADMIN, others[m] === 'GET' || others[m] === 'DELETE' ? undefined : {});
        ok(r405.status === 405 || r405.status === 404, others[m] + ' ' + od.path + ' (undocumented method) is not served (got ' + r405.status + ')');
      }
    }
  } finally {
    await new Promise(function (r) { server.close(r); });
    await db.closePool();
  }
  console.log('\nIDA-OPENAPI-CONTRACT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) { console.error('FATAL: ' + (err && err.stack || err)); console.log('\nIDA-OPENAPI-CONTRACT: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
