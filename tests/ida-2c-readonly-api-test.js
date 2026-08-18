'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2C tests
// tests/ida-2c-readonly-api-test.js
//
// NOT offline like the Phase A suite — this deliberately makes real HTTP
// requests against a real, live PostgreSQL connection (IDA-2B's
// idauto-postgres), because IDA-2C's whole purpose is to prove the API
// works against the live database, not a mock of it. Requires:
//   IDAUTO_DB_HOST, IDAUTO_DB_PORT, IDAUTO_DB_USER, IDAUTO_DB_PASSWORD,
//   IDAUTO_DB_NAME
// set in the environment before running (never hardcoded here). The admin
// identity token (IDA-2E-PRE, reference/identity.js) is
// generated fresh by this test itself and set into
// process.env.IDAUTO_ADMIN_IDENTITIES before api.js is required, so no
// external identity configuration is needed to run this suite. Starts
// the server on an ephemeral port for the duration of this test process
// only — no persistent listening service is left running by this suite.
//
// Run with: env IDAUTO_DB_HOST=... ... node tests/ida-2c-readonly-api-test.js
// =====================================================

var http = require('http');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var TOKEN = crypto.randomBytes(24).toString('hex');
var TEST_IDENTITY = 'admin:ida-2c-test-run';
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: TEST_IDENTITY });

var api = require(path.join(BASE, 'reference', 'api.js'));
var db = require(path.join(BASE, 'reference', 'db.js'));

var server;
var port;

function request(method, requestPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: requestPath,
      method: method,
      headers: headers || {}
    }, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function authed(requestPath, method) {
  return request(method || 'GET', requestPath, { 'Authorization': 'Bearer ' + TOKEN });
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;

  console.log('\n1. AUTH GATE — minimal admin identity stub (IDA-2E-PRE)');
  var noAuth = await request('GET', '/health');
  ok(noAuth.status === 401, 'GET /health with no Authorization header -> 401');

  var wrongAuth = await request('GET', '/health', { 'Authorization': 'Bearer wrong-token-entirely' });
  ok(wrongAuth.status === 401, 'GET /health with wrong token -> 401');

  var rightAuth = await authed('/health');
  ok(rightAuth.status === 200 && rightAuth.body.status === 'ok', 'GET /health with correct token -> 200 {status: "ok"} (also proves DB connectivity)');

  console.log('\n2. GET /api/vehicles/:internal_ref — synthetic test vehicle');
  var vehicle = await authed('/api/vehicles/IDA2C-TEST-VEHICLE-001');
  ok(vehicle.status === 200, 'Known synthetic vehicle -> 200');
  ok(vehicle.body && vehicle.body.make === 'TestMake' && vehicle.body.model === 'TestModel', 'Returns expected synthetic make/model');
  ok(vehicle.body && !('owner_name' in vehicle.body) && !('owner_cin' in vehicle.body), 'Response never contains an owner_* field (none exist in schema, but check the response shape too)');

  var vehicleNotFound = await authed('/api/vehicles/DOES-NOT-EXIST');
  ok(vehicleNotFound.status === 404, 'Unknown internal_ref -> 404');

  console.log('\n3. GET /api/plates/:plate_number — synthetic test plate');
  var plate = await authed('/api/plates/' + encodeURIComponent('999 TUN 9999'));
  ok(plate.status === 200, 'Known synthetic plate -> 200');
  ok(plate.body && plate.body.format_code === 'TUN_STD' && plate.body.governorate_name === 'Tunis', 'Returns expected format_code and joined governorate name');

  console.log('\n4. GET /api/observations/:id — MYTHOS_PRIVATE fields excluded');
  var obsResp = await authed('/api/observations/1');
  ok(obsResp.status === 200, 'Known synthetic observation (id 1) -> 200');
  ok(obsResp.body && obsResp.body.capture_method === 'manual_admin' && obsResp.body.status === 'accepted', 'Returns expected capture_method/status');
  var obsFieldNames = obsResp.body ? Object.keys(obsResp.body) : [];
  var forbiddenObsFields = ['capture_time', 'plate_candidate', 'ocr_confidence', 'ip_hash', 'camera_source_id', 'contributor_id', 'capture_session_id'];
  ok(forbiddenObsFields.every(function (f) { return obsFieldNames.indexOf(f) === -1; }), 'None of the MYTHOS_PRIVATE/identity fields (capture_time, plate_candidate, ocr_confidence, ip_hash, camera_source_id, contributor_id, capture_session_id) appear in the response — found fields: ' + obsFieldNames.join(', '));
  var obsNotFound = await authed('/api/observations/999999');
  ok(obsNotFound.status === 404, 'Unknown observation id -> 404');
  var obsBadInput = await authed('/api/observations/not-a-number');
  ok(obsBadInput.status === 404, 'Non-numeric observation id -> 404 (not a 500 from a malformed query)');

  var vehicleFactsResp = await authed('/api/vehicles/IDA2C-TEST-VEHICLE-001/facts');
  ok(vehicleFactsResp.status === 200, 'GET .../facts -> 200');
  ok(Array.isArray(vehicleFactsResp.body.facts) && vehicleFactsResp.body.facts.length === 1, 'Exactly 1 fact returned (the public one) — the mythos_private VIN fact is excluded, found ' + (vehicleFactsResp.body.facts ? vehicleFactsResp.body.facts.length : 'n/a'));
  ok(vehicleFactsResp.body.facts[0].fact_key === 'colour' && vehicleFactsResp.body.facts[0].access_scope === 'public', 'The one returned fact is the public "colour" fact, not the private "vin" fact');
  var factsRaw = vehicleFactsResp.raw;
  ok(factsRaw.indexOf('TESTVINSYNTHETIC0001') === -1, 'The mythos_private VIN value never appears anywhere in the raw response body (not just filtered from the array)');

  console.log('\n5. GET /api/facts/:fact_id/evidence');
  var evidenceResp = await authed('/api/facts/1/evidence');
  ok(evidenceResp.status === 200 || evidenceResp.status === 404, 'Evidence endpoint responds (200 if fact id 1 is the public colour fact in this environment, 404 otherwise — id is DB-generated, not asserted exactly)');

  console.log('\n6. WRITE METHODS REJECTED — this API is read-only');
  var postAttempt = await authed('/api/vehicles/IDA2C-TEST-VEHICLE-001', 'POST');
  ok(postAttempt.status === 405, 'POST /api/vehicles/:ref -> 405 (not 200, not silently accepted)');
  var putAttempt = await authed('/api/vehicles/IDA2C-TEST-VEHICLE-001', 'PUT');
  ok(putAttempt.status === 405, 'PUT /api/vehicles/:ref -> 405');
  var deleteAttempt = await authed('/api/vehicles/IDA2C-TEST-VEHICLE-001', 'DELETE');
  ok(deleteAttempt.status === 405, 'DELETE /api/vehicles/:ref -> 405');

  console.log('\n7. UNKNOWN ROUTES -> 404');
  var unknownRoute = await authed('/api/something-that-does-not-exist');
  ok(unknownRoute.status === 404, 'Unknown path -> 404');
  var malformedPath = await authed('/api/vehicles/%E0%A4%A');
  ok(malformedPath.status === 400, 'Malformed percent-encoded path segment -> 400 (never escapes the route error boundary)');
  var healthAfterMalformedPath = await authed('/health');
  ok(healthAfterMalformedPath.status === 200, 'Server remains responsive after a malformed encoded path');

  console.log('\n8. api.js source — the read routes tested above still contain no inline write SQL');
  // NOTE (IDA-2D): api-read.js was renamed to api.js and gained write
  // routes in IDA-2D — this API is no longer read-only overall. This
  // check now verifies a narrower, still-true claim: api.js itself has no
  // SQL write verb written inline — all writes are delegated to
  // writes.js's parameterized, audited functions (see
  // tests/ida-2d-write-api-and-audit-test.js for write-path coverage).
  var fs = require('fs');
  var src = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var writeVerbs = [/INSERT\s+INTO/i, /UPDATE\s+idauto_/i, /DELETE\s+FROM/i, /DROP\s+/i, /ALTER\s+TABLE/i, /TRUNCATE/i];
  var clean = writeVerbs.every(function (re) { return !re.test(src); });
  ok(clean, 'No SQL write verb appears inline in api.js source — all mutation SQL lives in writes.js');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();

  console.log('\nStage IDA-2C (read-only API): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.message);
  process.exit(1);
});
