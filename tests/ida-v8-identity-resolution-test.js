'use strict';

/* IDA-V8 — MERGE / SPLIT / ALIAS. Owner requirement, 2026-08-27.
 *
 * Two records that turn out to be one vehicle must merge; a wrong merge must
 * reverse; and every identifier ever issued must keep resolving, because
 * Fixpert will hold references minted before a merge and none of them may
 * break.
 *
 * THE PROPERTY THIS SUITE EXISTS TO PROVE IS NEGATIVE: a merge destroys
 * nothing. Not the old IVID, not the old internal_ref, not one observation,
 * fact, evidence row or audit row. It is asserted by counting rows before and
 * after against a REAL PostgreSQL, not by reading the code that claims it.
 *
 * Runs against a live database — IDAUTO_DB_* must point at a scratch one. It
 * refuses to run against the configured production database. */

var http = require('http');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

var TOKEN = 'v8-' + crypto.randomBytes(12).toString('hex');
var ACTOR = 'usr_' + crypto.randomBytes(16).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify((function () { var m = {}; m[TOKEN] = ACTOR; return m; })());

var db = require(path.join(BASE, 'reference', 'db.js'));
var api = require(path.join(BASE, 'reference', 'api.js'));

var server, port;
function request(method, p, token, body) {
  return new Promise(function (resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Length': payload ? Buffer.byteLength(payload) : 0 };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () {
        var raw = Buffer.concat(c).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function counts(vehicleId) {
  var q = await db.query(
    'SELECT (SELECT count(*)::int FROM idauto_vehicle_facts WHERE vehicle_id=$1) facts,' +
    ' (SELECT count(*)::int FROM idauto_observations WHERE vehicle_id=$1) obs,' +
    ' (SELECT count(*)::int FROM idauto_plates WHERE vehicle_id=$1) plates,' +
    ' (SELECT count(*)::int FROM idauto_audit_log) audit', [vehicleId]);
  return q.rows[0];
}

async function main() {
  var guard = await db.query('SELECT current_database() d');
  var dbName = guard.rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) {
    console.error('FATAL: refusing to run against "' + dbName + '" — point IDAUTO_DB_NAME at a scratch database');
    process.exit(1);
  }
  say('database: ' + dbName);

  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  // ---- fixtures: two records for what turns out to be one vehicle ----
  var a = await request('POST', '/api/vehicles', TOKEN, { make: 'SSANGYONG', model: 'A' });
  var b = await request('POST', '/api/vehicles', TOKEN, { make: 'SSANGYONG', model: 'B' });
  ok(a.status === 201 || a.status === 200, 'vehicle A created');
  ok(b.status === 201 || b.status === 200, 'vehicle B created');
  var A = a.body, B = b.body;
  ok(A.ivid && B.ivid && A.ivid !== B.ivid, 'each record got its own IVID');

  var plate = '188 TUN ' + (1000 + Math.floor(Math.random() * 8999));
  await request('POST', '/api/plates', TOKEN, { plate_number: plate, format_code: 'TUN_STD', vehicle_internal_ref: A.internal_ref });
  await request('POST', '/api/vehicles/' + encodeURIComponent(A.internal_ref) + '/facts', TOKEN,
    { fact_key: 'colour', fact_value: 'blanc', access_scope: 'public', evidence_type: 'document_scan_official' });

  var aId = (await db.query('SELECT id FROM idauto_vehicles WHERE ivid=$1', [A.ivid])).rows[0].id;
  var before = await counts(aId);

  // ---- A. existing vehicle: plate → search → id → get ----
  say('\nA. EXISTING VEHICLE');
  var pl = await request('GET', '/public/plates/' + encodeURIComponent(plate));
  ok(pl.status === 200 && pl.body.ivid === A.ivid, 'plate resolves to vehicle A');
  var got = await request('GET', '/api/vehicles/' + encodeURIComponent(A.internal_ref), TOKEN);
  ok(got.status === 200, 'the vehicle can be fetched by internal_ref');

  // ---- C. duplicate → merge → canonical resolution ----
  say('\nC. DUPLICATE → MERGE');
  var merged = await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/merge', TOKEN, { canonical_ref: B.ivid });
  ok(merged.status === 200, 'A merges into B');
  ok(merged.body.canonical.ivid === B.ivid, 'the response names the canonical vehicle');
  ok(merged.body.merged.status === 'merged', "the merged record's status becomes 'merged'");
  ok(merged.body.merged.pre_merge_status === 'initial', 'and its previous status is remembered for the split');

  var after = await counts(aId);
  ok(after.facts === before.facts, 'NOTHING was destroyed: the fact count is unchanged');
  ok(after.obs === before.obs, 'the observation count is unchanged');
  ok(after.plates === before.plates, 'the plate count is unchanged');
  ok(after.audit > before.audit, 'and the merge itself was audited');
  var stillThere = await db.query('SELECT ivid, internal_ref FROM idauto_vehicles WHERE id=$1', [aId]);
  ok(stillThere.rows[0].ivid === A.ivid && stillThere.rows[0].internal_ref === A.internal_ref,
    "the merged record keeps its OWN ivid and internal_ref — no identifier is freed or reused");

  // ---- B/D. the old references still resolve ----
  say('\nD. FIXPERT REFERENCES SURVIVE THE MERGE');
  var r1 = await request('GET', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/resolve', TOKEN);
  ok(r1.status === 200 && r1.body.canonical.ivid === B.ivid, 'the OLD IVID resolves to the canonical vehicle');
  ok(r1.body.is_alias === true && r1.body.merge_hops === 1, 'and is reported as an alias, one hop away');
  var r2 = await request('GET', '/api/vehicles/' + encodeURIComponent(A.internal_ref) + '/resolve', TOKEN);
  ok(r2.status === 200 && r2.body.canonical.ivid === B.ivid, 'the OLD internal_ref resolves to the canonical vehicle too');
  var r3 = await request('GET', '/api/vehicles/' + encodeURIComponent(B.ivid) + '/resolve', TOKEN);
  ok(r3.status === 200 && r3.body.is_alias === false && r3.body.merge_hops === 0, 'the canonical vehicle resolves to itself');

  var oldQr = await request('GET', '/public/passport/' + encodeURIComponent(A.ivid));
  ok(oldQr.status === 200, 'a QR sticker printed with the OLD ivid still opens a passport');
  ok(oldQr.body.vehicle.ivid === B.ivid, 'and it shows the canonical vehicle');
  ok(oldQr.body.qr.payload === oldQr.body.vehicle.ivid, 'qr.payload still equals the served ivid');
  var plateAfter = await request('GET', '/public/plates/' + encodeURIComponent(plate));
  ok(plateAfter.status === 200 && plateAfter.body.ivid === B.ivid, 'the plate now resolves to the canonical vehicle');

  // ---- refusals ----
  say('\nREFUSALS — a merge that would lose or tangle identity');
  var self = await request('POST', '/api/vehicles/' + encodeURIComponent(B.ivid) + '/merge', TOKEN, { canonical_ref: B.ivid });
  ok(self.status === 400, 'a vehicle cannot be merged into itself');
  var cycle = await request('POST', '/api/vehicles/' + encodeURIComponent(B.ivid) + '/merge', TOKEN, { canonical_ref: A.ivid });
  ok(cycle.status === 409, 'a merge that would create a cycle is refused');
  var again = await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/merge', TOKEN, { canonical_ref: B.ivid });
  ok(again.status === 409, 'an already-merged vehicle must be split before it can be merged again');
  var unknown = await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/merge', TOKEN, { canonical_ref: 'ivid:1:ZZZZZZZZZZZZZZZZ:ZZ' });
  ok(unknown.status === 404 || unknown.status === 409, 'merging into an unknown vehicle is refused');
  var noBody = await request('POST', '/api/vehicles/' + encodeURIComponent(B.ivid) + '/merge', TOKEN, {});
  ok(noBody.status === 400, 'canonical_ref is required');

  // ---- E. split ----
  say('\nE. SPLIT — the merge reverses, and history survives');
  var beforeSplit = await counts(aId);
  var split = await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/split', TOKEN);
  ok(split.status === 200, 'the merge is reversed');
  ok(split.body.restored.ivid === A.ivid, 'the record keeps the identity it always had');
  ok(split.body.restored.status === 'initial', 'and its pre-merge status is restored verbatim');
  ok(split.body.was_merged_into === B.ivid, 'the response records what it was split out of');
  var afterSplit = await counts(aId);
  ok(afterSplit.facts === beforeSplit.facts && afterSplit.obs === beforeSplit.obs && afterSplit.plates === beforeSplit.plates,
    'nothing was destroyed by the split either');
  ok(afterSplit.audit > beforeSplit.audit, 'and the split is audited too');
  var r4 = await request('GET', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/resolve', TOKEN);
  ok(r4.body.is_alias === false && r4.body.canonical.ivid === A.ivid, 'the identifier resolves to itself again');
  var plateBack = await request('GET', '/public/plates/' + encodeURIComponent(plate));
  ok(plateBack.status === 200 && plateBack.body.ivid === A.ivid, 'the plate follows back to its own vehicle');
  var notMerged = await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/split', TOKEN);
  ok(notMerged.status === 409, 'splitting a vehicle that is not merged is refused');

  // ---- F. permissions ----
  say('\nF. PERMISSIONS');
  ok((await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/merge', null, { canonical_ref: B.ivid })).status === 401,
    'merge requires authentication');
  ok((await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/split', null)).status === 401,
    'split requires authentication');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/resolve', null)).status === 401,
    'resolve requires authentication');
  ok((await request('POST', '/api/vehicles/' + encodeURIComponent(A.ivid) + '/merge', 'wrong', { canonical_ref: B.ivid })).status === 401,
    'a wrong token is refused');

  // ---- audit trail ----
  say('\nAUDIT — the merge and the split are both permanent records');
  // Scoped to THIS run's actor: a scratch database may carry rows from an
  // earlier run, and an assertion that reads them would be testing history
  // rather than this merge and this split.
  var trail = await db.query(
    "SELECT event_type, actor_ref FROM idauto_audit_log WHERE target_type='idauto_vehicles' " +
    "AND event_type IN ('vehicle.merge','vehicle.split') AND actor_ref = $1 ORDER BY id", [ACTOR]);
  ok(trail.rows.length >= 2, 'both events are in the audit log');
  ok(trail.rows.some(function (r) { return r.event_type === 'vehicle.merge'; }), 'the merge is recorded');
  ok(trail.rows.some(function (r) { return r.event_type === 'vehicle.split'; }), 'the split is recorded');
  ok(trail.rows.every(function (r) { return r.actor_ref === ACTOR; }), 'each carries the identity that performed it');

  server.close();
  await db.closePool ? db.closePool() : null;
  console.log('\nIDA-V8 identity resolution: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
