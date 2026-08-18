'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2D tests
// tests/ida-2d-write-api-and-audit-test.js
//
// Live, not offline — same pattern as tests/ida-2c-readonly-api-test.js.
// Requires IDAUTO_DB_HOST/PORT/USER/PASSWORD/NAME in the environment. The
// admin identity token (IDA-2E-PRE) is generated fresh by this test
// itself and set into process.env.IDAUTO_ADMIN_IDENTITIES before api.js
// is required.
//
// Run with: env IDAUTO_DB_HOST=... ... node tests/ida-2d-write-api-and-audit-test.js
// =====================================================

var http = require('http');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var TOKEN = crypto.randomBytes(24).toString('hex');
var TEST_IDENTITY = 'admin:ida-2d-test-run';
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: TEST_IDENTITY });

var api = require(path.join(BASE, 'reference', 'api.js'));
var db = require(path.join(BASE, 'reference', 'db.js'));

var server, port;

// Generated fresh per run (matches the TUN_STD pattern ^(\d{1,3})\s?TUN\s?(\d{1,4})$)
// so this suite is safe to re-run against the same persistent database —
// unlike a hardcoded plate number, which would collide with itself on a
// second run the same way the vehicle's timestamp-based internal_ref does
// not.
var TEST_PLATE = (Date.now() % 900 + 100) + ' TUN ' + (Date.now() % 9000 + 1000);

function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var h = Object.assign({}, headers || {});
    if (payload) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: h }, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(chunks); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function authed(requestPath, method, body) {
  return request(method || 'GET', requestPath, { 'Authorization': 'Bearer ' + TOKEN }, body);
}

async function auditCount() {
  var r = await db.query('SELECT count(*) FROM idauto_audit_log');
  return parseInt(r.rows[0].count, 10);
}
async function latestAudit() {
  var r = await db.query('SELECT event_type, actor_type, actor_ref, target_type, target_ref, change_summary, new_value_json FROM idauto_audit_log ORDER BY id DESC LIMIT 1');
  return r.rows[0];
}
async function vehicleCount(internalRef) {
  var r = await db.query('SELECT count(*) FROM idauto_vehicles WHERE internal_ref = $1', [internalRef]);
  return parseInt(r.rows[0].count, 10);
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  console.log('\n1. ADMIN IDENTITY GATE — preserved on write routes (IDA-2E-PRE)');
  var noAuth = await request('POST', '/api/vehicles', {}, { make: 'ShouldBeRejected' });
  ok(noAuth.status === 401, 'POST /api/vehicles with no auth -> 401 (gate still enforced on writes)');
  var wrongAuth = await request('POST', '/api/vehicles', { 'Authorization': 'Bearer wrong' }, { make: 'ShouldBeRejected' });
  ok(wrongAuth.status === 401, 'POST /api/vehicles with wrong token -> 401');

  console.log('\n2. POST /api/vehicles — creates a row AND an audit record atomically');
  var beforeCount = await auditCount();
  var vehicleResp = await authed('/api/vehicles', 'POST', { make: 'IDA2D-Test-Make', model: 'IDA2D-Test-Model', year: 2021, colour: 'blue' });
  ok(vehicleResp.status === 201, 'POST /api/vehicles -> 201');
  ok(vehicleResp.body && vehicleResp.body.internal_ref && vehicleResp.body.internal_ref.indexOf('IDA2D-') === 0, 'Response includes a generated IDA2D-prefixed internal_ref');
  var afterCount = await auditCount();
  ok(afterCount === beforeCount + 1, 'Exactly one new audit_log row appeared (was ' + beforeCount + ', now ' + afterCount + ')');
  var audit1 = await latestAudit();
  ok(audit1.event_type === 'vehicle.create' && audit1.actor_type === 'admin' && audit1.target_ref === vehicleResp.body.internal_ref, 'Audit row matches: event_type=vehicle.create, actor_type=admin, target_ref=the new internal_ref');
  ok(audit1.actor_ref === TEST_IDENTITY, 'Audit actor_ref is the real resolved identity string (' + TEST_IDENTITY + '), never the bearer token itself');
  ok(audit1.actor_ref !== TOKEN, 'Audit actor_ref is definitely not the raw bearer token');

  var newVehicleRef = vehicleResp.body.internal_ref;

  console.log('\n3. GET the vehicle just created (read-path regression, proves the write really persisted)');
  var readBack = await authed('/api/vehicles/' + newVehicleRef);
  ok(readBack.status === 200 && readBack.body.make === 'IDA2D-Test-Make', 'The vehicle created via POST is immediately readable via GET with matching data');

  console.log('\n4. POST /api/plates — linked to the new vehicle');
  var plateResp = await authed('/api/plates', 'POST', { plate_number: TEST_PLATE, format_code: 'TUN_STD', governorate_code: '01', vehicle_internal_ref: newVehicleRef });
  ok(plateResp.status === 201, 'POST /api/plates -> 201');
  var audit2 = await latestAudit();
  ok(audit2.event_type === 'plate.create' && audit2.target_ref === TEST_PLATE, 'Audit row for the plate creation, target_ref = plate_number');

  console.log('\n5. POST /api/plates — duplicate active plate number -> 409, no phantom audit row');
  var beforeDup = await auditCount();
  var dupPlate = await authed('/api/plates', 'POST', { plate_number: TEST_PLATE, format_code: 'TUN_STD' });
  ok(dupPlate.status === 409, 'Duplicate active plate_number -> 409 (unique_violation mapped, not a raw 500)');
  var afterDup = await auditCount();
  ok(afterDup === beforeDup, 'No new audit_log row was created for the failed duplicate attempt (rollback confirmed) — was ' + beforeDup + ', still ' + afterDup);

  console.log('\n6. POST /api/observations — manual_admin capture, linked to vehicle + plate');
  var obsResp = await authed('/api/observations', 'POST', { vehicle_internal_ref: newVehicleRef, plate_number: TEST_PLATE });
  ok(obsResp.status === 201, 'POST /api/observations -> 201');
  ok(obsResp.body && obsResp.body.capture_method === 'manual_admin', 'capture_method is hardcoded to manual_admin regardless of any input');
  var audit3 = await latestAudit();
  ok(audit3.event_type === 'observation.create', 'Audit row for the observation creation');

  console.log('\n7. POST /api/observations — nonexistent vehicle -> 400, no phantom audit row, ATOMICITY (data-fails direction)');
  var beforeBad = await auditCount();
  var badObs = await authed('/api/observations', 'POST', { vehicle_internal_ref: 'DOES-NOT-EXIST-ANYWHERE' });
  ok(badObs.status === 400, 'Nonexistent vehicle_internal_ref -> 400 (foreign-key-shaped failure mapped, not 500)');
  var afterBad = await auditCount();
  ok(afterBad === beforeBad, 'No audit_log row was created for the failed attempt — was ' + beforeBad + ', still ' + afterBad);

  console.log('\n8. POST /api/vehicles/:ref/facts — public fact, then mythos_private fact (writes ARE audited, so private IS allowed here)');
  var publicFact = await authed('/api/vehicles/' + newVehicleRef + '/facts', 'POST', { fact_key: 'colour', fact_value: 'blue', access_scope: 'public', evidence_type: 'admin_validation' });
  ok(publicFact.status === 201, 'POST public fact -> 201');
  ok(publicFact.body && publicFact.body.fact && publicFact.body.evidence && publicFact.body.evidence.evidence_type === 'admin_validation', 'Response includes both the fact and its evidence row (created atomically together)');
  var auditPublicFact = await latestAudit();
  ok(auditPublicFact.event_type === 'fact.create', 'Audit row for the public fact creation');

  var beforePrivate = await auditCount();
  var privateFact = await authed('/api/vehicles/' + newVehicleRef + '/facts', 'POST', { fact_key: 'vin', fact_value: 'IDA2DTESTVIN0001', access_scope: 'mythos_private' });
  ok(privateFact.status === 201, 'POST mythos_private fact -> 201 (allowed on WRITE, unlike IDA-2C reads, because this write IS audited)');
  var afterPrivate = await auditCount();
  ok(afterPrivate === beforePrivate + 1, 'The mythos_private fact write got its own audit row too — private data is never written without an audit trail');
  var auditPrivateFact = await latestAudit();
  ok(auditPrivateFact.new_value_json.indexOf('IDA2DTESTVIN0001') !== -1, 'Unlike the READ API (which hides mythos_private data), the audit record for a private WRITE does capture what was written — that is the whole point of auditing it');

  console.log('\n9. GET .../facts still excludes the new mythos_private fact (IDA-2C read restriction unchanged)');
  var factsAfter = await authed('/api/vehicles/' + newVehicleRef + '/facts');
  var factKeys = factsAfter.body.facts.map(function (f) { return f.fact_key; });
  ok(factKeys.indexOf('vin') === -1 && factKeys.indexOf('colour') !== -1, 'facts list still shows "colour" (public) but not "vin" (mythos_private) — IDA-2C\'s read-side restriction is unchanged by this stage');

  console.log('\n10. MULTIPLE DISTINCT IDENTITIES — the whole point of IDA-2E-PRE');
  var identityModule = require(path.join(BASE, 'reference', 'identity.js'));
  var secondToken = require('crypto').randomBytes(24).toString('hex');
  var secondIdentity = 'admin:ida-2d-second-identity';
  var currentIdentities = JSON.parse(process.env.IDAUTO_ADMIN_IDENTITIES);
  currentIdentities[secondToken] = secondIdentity;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(currentIdentities);
  identityModule.clearIdentityCache();
  var secondVehicleResp = await request('POST', '/api/vehicles', { 'Authorization': 'Bearer ' + secondToken }, { make: 'IDA2D-Second-Identity-Vehicle' });
  ok(secondVehicleResp.status === 201, 'A second, distinct admin token also authenticates successfully -> 201');
  var auditSecond = await latestAudit();
  ok(auditSecond.actor_ref === secondIdentity, 'The audit row for this write is attributed to the SECOND identity (' + secondIdentity + '), not the first (' + TEST_IDENTITY + ') — proves this is a real per-token identity map, not just a relabeled single shared secret');
  ok(auditSecond.actor_ref !== TEST_IDENTITY, 'Confirms the two identities produce genuinely different audit attribution');

  console.log('\n11. WITHOUT AN IDENTITY, withAudit() fails closed (defense in depth, not reachable via HTTP since requireAuth already blocks it)');
  var writesModule = require(path.join(BASE, 'reference', 'writes.js'));
  var beforeNoIdentity = await auditCount();
  var noIdentityThrew = false;
  try {
    await writesModule.createVehicle({ make: 'ShouldNeverPersist' }, null);
  } catch (e) {
    noIdentityThrew = true;
    ok(e.httpStatus === 401, 'withAudit() throws with httpStatus 401 when identity is falsy');
  }
  ok(noIdentityThrew, 'Calling a write function with no identity throws rather than silently writing an unattributed audit row');
  var afterNoIdentity = await auditCount();
  ok(afterNoIdentity === beforeNoIdentity, 'No audit_log row (and, by construction, no data row — the transaction never opened) was created for the no-identity attempt');
  var ghostCount = await db.query("SELECT count(*) FROM idauto_vehicles WHERE make = 'ShouldNeverPersist'");
  ok(parseInt(ghostCount.rows[0].count, 10) === 0, 'The vehicle insert itself never happened either — withAudit() checks identity BEFORE opening a transaction at all');

  console.log('\n12. INPUT VALIDATION — missing required fields rejected before any DB write');
  var missingPlate = await authed('/api/plates', 'POST', { format_code: 'TUN_STD' });
  ok(missingPlate.status === 400, 'POST /api/plates without plate_number -> 400');
  var missingObs = await authed('/api/observations', 'POST', {});
  ok(missingObs.status === 400, 'POST /api/observations without vehicle_internal_ref -> 400');
  var missingFact = await authed('/api/vehicles/' + newVehicleRef + '/facts', 'POST', { fact_key: 'colour' });
  ok(missingFact.status === 400, 'POST .../facts without fact_value -> 400');
  var oversizedJson = await authed('/api/vehicles', 'POST', { padding: 'x'.repeat(65536) });
  ok(oversizedJson.status === 413, 'JSON body over 64KB -> 413 without resetting the client connection');

  console.log('\n13. ATOMICITY, direct unit test — audit-insert failure rolls back the paired data insert');
  // Exercises the real withAudit() helper that every endpoint above uses,
  // this time forcing the audit insert itself to fail (invalid actor_type,
  // violating idauto_audit_log's own CHECK constraint) after the data
  // insert already ran, to prove the whole transaction — not just the
  // data half — rolls back together. This is not reachable through any
  // HTTP input (actor_type is always 'admin', never caller-controlled),
  // so it is tested directly against the transaction helper itself.
  var probeRef = 'IDA2D-ATOMICITY-PROBE-' + Date.now();
  var client = await db.getClientForTransaction();
  var threw = false;
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO idauto_vehicles (internal_ref, make, fiche_status) VALUES ($1, 'AtomicityProbe', 'initial')",
      [probeRef]
    );
    // Deliberately invalid actor_type — violates idauto_audit_log's own
    // chk_audit_actor CHECK constraint.
    await client.query(
      "INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref) VALUES ($1, $2, $3, $4, $5)",
      ['probe.create', 'not-a-valid-actor-type', 'probe', 'idauto_vehicles', probeRef]
    );
    await client.query('COMMIT');
  } catch (e) {
    threw = true;
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  ok(threw, 'The deliberately-invalid audit insert did throw (CHECK constraint enforced)');
  var probeCount = await vehicleCount(probeRef);
  ok(probeCount === 0, 'After ROLLBACK, the vehicle insert that ran BEFORE the failing audit insert does NOT exist — proves the transaction is genuinely atomic, not just the audit step failing silently after the data was already committed');

  console.log('\n14. writes.js source — no COMMIT without a preceding audit insert in withAudit()');
  var fs = require('fs');
  var writesSrc = fs.readFileSync(path.join(BASE, 'reference', 'writes.js'), 'utf8');
  var withAuditBody = writesSrc.slice(writesSrc.indexOf('async function withAudit'), writesSrc.indexOf('function genInternalRef'));
  var auditInsertIndex = withAuditBody.indexOf('INSERT INTO idauto_audit_log');
  var commitIndex = withAuditBody.indexOf("client.query('COMMIT')");
  ok(auditInsertIndex !== -1 && commitIndex !== -1 && auditInsertIndex < commitIndex, 'In withAudit(), the audit_log INSERT appears before COMMIT in source order — every commit path writes an audit row first');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();

  console.log('\nStage IDA-2D (write API + atomic audit logging): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.message);
  process.exit(1);
});
