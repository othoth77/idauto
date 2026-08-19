'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4 Option C tests
// tests/ida4-option-c-test.js
//
// A5 OPTION C, 2026-08-19. Live-database suite, in the style of
// tests/ida-3d-private-ingest-route-test.js: reads IDAUTO_DB_* from the
// environment, exercises the real HTTP server via real sockets, and
// asserts against the real database. Covers, at minimum:
//
//   1. migration idempotence (database/migrations/ida4-option-c-ivid.sql
//      applied twice)
//   2. issuance permanence (reference/ivid-issuance.js: second issue
//      returns the same ivid, never overwrites)
//   3. GET /public/passport/:ivid on a real, known ivid -> 200, public
//      shape, no restricted/professional fact leaks, qr.payload===ivid,
//      completeness_note present
//   4. valid-format but unknown ivid -> 404
//   5. malformed ivid -> 404, with proof no database query ran
//   6. a plate-shaped value as the path segment -> 404;
//      /public/plate/... -> 404; ?plate=... is ignored
//   7. burst -> 429 with Retry-After, then recovery after the window
//      (isolated in a child process with a small, fast-cycling
//      public_resolution config so this does not slow down or pollute
//      the main suite's own rate-limit bucket)
//   8. a pre-existing admin route still returns 401 with no auth
//   9. the public route itself works with no Authorization header at all
//      (true of every request this suite makes against it)
//   10. A5 prohibition guards (no person store, no citizen-PII surface),
//       plus structural pins for the SQL access_scope filter and the
//       reviewed public-surface-policy.js deny-list
//   11. A5-PLATE phase gate (config public_resolution.enabled): PRIVATE
//       phase (disabled) -> anonymous surface off (404, zero DB queries)
//       WHILE the authenticated private surface still serves the
//       passport with plate_number, proving the gate separates the two
//       surfaces rather than disabling passport resolution altogether
//   12. issuance wired into the authenticated POST /api/vehicles path
//   13. A5-PLATE PRIVATE MODE: authenticated GET /api/passport/:ivid ->
//       200 with plate_number present (fixture carries a real linked
//       plate record); 401 without auth; no plate-based lookup exists
//       on this route either
//
// A5-PLATE, REVISED OWNER RULING, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md
// §I): PRIVATE phase permits plate display to authorized internal users;
// PUBLIC phase hides plate_number unconditionally; IVID remains the only
// public RESOLUTION identifier in both phases. reference/public-surface-policy.js
// is the one reviewed artifact encoding the PUBLIC-phase deny-list;
// reference/api.js's new GET /api/passport/:ivid is the authenticated
// PRIVATE surface. See §11/§13 above.
//
// Test fixtures inserted here are clearly marked (internal_ref prefixed
// IDA4OPTIONC-TEST-) and deleted in a finally block. The one intentional,
// PERMANENT live-data mutation this suite performs — issuing IVIDs to
// every pre-existing vehicle lacking one, via issueMissing() — is not a
// fixture and is not rolled back: it is the feature itself operating on
// real operational data, which the task's own constraints explicitly
// permit ("adding the ivid column and issuing IVIDs").
//
// Run with: IDAUTO_DB_HOST=... IDAUTO_DB_PORT=... IDAUTO_DB_USER=...
// IDAUTO_DB_PASSWORD=... IDAUTO_DB_NAME=... node tests/ida4-option-c-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function unique(prefix) { return prefix + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'); }

var required = ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD', 'IDAUTO_DB_NAME'];
var missing = required.filter(function (name) { return !process.env[name]; });
if (missing.length) throw new Error('missing required environment variable(s): ' + missing.join(', '));

// F2 test support (§12): a real admin token/identity, set BEFORE
// reference/api.js (and therefore reference/identity.js) is required —
// matching tests/ida-2d-write-api-and-audit-test.js's and
// tests/ida-3d-private-ingest-route-test.js's own convention, even
// though identity.js's cache is actually populated lazily on first use,
// not at require time.
var ADMIN_TOKEN = 'ida4optionc-admin-' + crypto.randomBytes(18).toString('hex');
var ADMIN_IDENTITY = 'admin:ida4-option-c-test';
var _adminIdentities = {}; _adminIdentities[ADMIN_TOKEN] = ADMIN_IDENTITY;
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(_adminIdentities);

var db = require(path.join(BASE, 'reference', 'db.js'));
var ivid = require(path.join(BASE, 'reference', 'ivid.js'));
var ividIssuance = require(path.join(BASE, 'reference', 'ivid-issuance.js'));
var api = require(path.join(BASE, 'reference', 'api.js'));
var rateLimit = require(path.join(BASE, 'reference', 'rate-limit.js'));

var server, port;
// `body`, added for §12's authenticated POST /api/vehicles call, is
// optional and backward-compatible — every pre-existing call site passes
// only 3 arguments and is unaffected.
function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var finalHeaders = Object.assign({}, headers || {});
    if (body !== undefined) finalHeaders['Content-Length'] = Buffer.byteLength(body);
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: finalHeaders }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function scalar(sql, params) {
  var result = await db.query(sql, params || []);
  return result.rows[0][Object.keys(result.rows[0])[0]];
}

var FIXTURE_PREFIX = 'IDA4OPTIONC-TEST-';
var fixtureVehicleId = null;
var fixtureIvid = null;
var fixtureInternalRef = null;
var fixturePlateNumber = null;

async function insertFixture() {
  var internalRef = FIXTURE_PREFIX + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  fixtureInternalRef = internalRef;
  ok(typeof fixtureInternalRef === 'string' && fixtureInternalRef.length > 0, 'precondition: fixture internal_ref is a non-empty string (non-vacuous for the leakage check below)');
  // seats and engine_cc are given real, non-null values here specifically so
  // the "these columns are absent from the public response" assertions in
  // validKnownIvid() are non-vacuous — a null column would pass that check
  // even if the column were still selected and merely happened to be null.
  var vehicle = await db.query(
    "INSERT INTO idauto_vehicles (internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, engine_cc, fiche_status) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, internal_ref",
    [internalRef, 'IDA4OptionCFixture', 'TestModel', null, 2026, 'sedan', 'petrol', 'blue', 5, 1600, 'initial']
  );
  fixtureVehicleId = vehicle.rows[0].id;

  // F4 (Opus review, 2026-08-19): two of these five are deliberately
  // stored access_scope='public' despite being deny-listed fact_keys
  // (PUBLIC_FACT_KEY_DENY_LIST, reference/api.js) — reproducing exactly
  // the scenario the finding describes (writes.js:245/284 can set or
  // default a fact to 'public' regardless of its key) so validKnownIvid()
  // below can prove the deny-list, not just the access_scope filter,
  // keeps them out.
  var factRows = [
    ['colour', 'blue', 'public'],
    ['engine_cc', '1600', 'professional'],
    ['vin', 'SECRET-VIN-SHOULD-NEVER-LEAK', 'mythos_private'],
    ['vin', 'PUBLIC-SCOPED-VIN-SHOULD-STILL-NEVER-LEAK', 'public'],
    ['plate_number', 'PUBLIC-SCOPED-PLATE-SHOULD-NEVER-LEAK', 'public']
  ];
  for (var i = 0; i < factRows.length; i++) {
    await db.query(
      "INSERT INTO idauto_vehicle_facts (vehicle_id, fact_key, fact_value, confidence_score, verification_status, access_scope) " +
      "VALUES ($1,$2,$3,$4,$5,$6)",
      [fixtureVehicleId, factRows[i][0], factRows[i][1], 0.9, 'verified', factRows[i][2]]
    );
  }
  var factCount = await scalar('SELECT count(*) AS c FROM idauto_vehicle_facts WHERE vehicle_id = $1', [fixtureVehicleId]);
  ok(Number(factCount) === 5, 'precondition: fixture vehicle has exactly 5 facts (non-vacuous)');
  var publicScopedDeniedCount = await scalar(
    "SELECT count(*) AS c FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND access_scope = 'public' AND fact_key IN ('vin','plate_number')",
    [fixtureVehicleId]
  );
  ok(Number(publicScopedDeniedCount) === 2, 'precondition: exactly 2 facts are stored access_scope=public AND deny-listed by fact_key (non-vacuous for the deny-list check below)');

  // A5-PLATE revised ruling (2026-08-19): a real, linked plate record —
  // idauto_plates.vehicle_id is a direct FK, the same linkage
  // reference/api.js's new getPrivatePassport() joins on. Non-vacuous
  // for the PRIVATE-mode "plate_number is present" assertion below: an
  // active-status plate with a real, distinctive plate_number.
  fixturePlateNumber = (Date.now() % 900 + 100) + ' TUN ' + (Date.now() % 9000 + 1000) + '-' + crypto.randomBytes(2).toString('hex');
  await db.query(
    "INSERT INTO idauto_plates (plate_number, format_code, vehicle_id, status) VALUES ($1,$2,$3,$4)",
    [fixturePlateNumber, 'TUN_STD', fixtureVehicleId, 'active']
  );
  var plateCount = await scalar('SELECT count(*) AS c FROM idauto_plates WHERE vehicle_id = $1', [fixtureVehicleId]);
  ok(Number(plateCount) === 1, 'precondition: fixture vehicle has exactly 1 linked plate record (non-vacuous)');
}

// R4 (Opus review, 2026-08-19): §12's secondary fixture (the vehicle
// created through the real authenticated write path) is tracked here so
// its cleanup goes through this SAME finally-based path as the primary
// fixture, rather than being deleted inline at the end of
// issuanceWiredIntoWriteAPI() — a fixture created via §12 must still be
// removed even if a LATER assertion in that function (or a later
// section entirely) throws before reaching its own inline cleanup.
var secondaryFixtureVehicleId = null;

async function cleanupFixture() {
  if (fixtureVehicleId != null) {
    // Plates and facts first — idauto_plates.vehicle_id and
    // idauto_vehicle_facts.vehicle_id are plain REFERENCES (no ON DELETE
    // CASCADE), so the vehicle row cannot be deleted while either still
    // points at it.
    await db.query('DELETE FROM idauto_plates WHERE vehicle_id = $1', [fixtureVehicleId]);
    await db.query('DELETE FROM idauto_vehicle_facts WHERE vehicle_id = $1', [fixtureVehicleId]);
    await db.query('DELETE FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
  }
  if (secondaryFixtureVehicleId != null) {
    await db.query('DELETE FROM idauto_plates WHERE vehicle_id = $1', [secondaryFixtureVehicleId]);
    await db.query('DELETE FROM idauto_vehicle_facts WHERE vehicle_id = $1', [secondaryFixtureVehicleId]);
    await db.query('DELETE FROM idauto_vehicles WHERE id = $1', [secondaryFixtureVehicleId]);
  }
}

async function migrationIdempotence() {
  console.log('\n1. Migration idempotence (database/migrations/ida4-option-c-ivid.sql)');
  var migrationSql = fs.readFileSync(path.join(BASE, 'database', 'migrations', 'ida4-option-c-ivid.sql'), 'utf8');
  for (var i = 0; i < 2; i++) {
    var client = await db.getClientForTransaction();
    try {
      await client.query(migrationSql);
    } finally {
      client.release();
    }
  }
  var columnCheck = await db.query(
    "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'idauto_vehicles' AND column_name = 'ivid'"
  );
  ok(columnCheck.rows.length === 1, 'idauto_vehicles.ivid column exists after applying the migration twice');
  ok(columnCheck.rows[0] && columnCheck.rows[0].is_nullable === 'YES', 'ivid column is nullable (existing vehicles are unaffected until issued)');
}

async function issuancePermanence() {
  console.log('\n2. Issuance permanence (reference/ivid-issuance.js)');
  var before = await db.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
  ok(before.rows[0].ivid === null, 'precondition: fixture vehicle has no ivid before issuance');

  var first = await ividIssuance.issueForVehicle(db, fixtureVehicleId);
  ok(ivid.validate(first).ok, 'issueForVehicle returns a well-formed ivid');
  fixtureIvid = first;

  var second = await ividIssuance.issueForVehicle(db, fixtureVehicleId);
  ok(second === first, 'a second issuance for the same vehicle returns the identical ivid — no overwrite');

  var stored = await db.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
  ok(stored.rows[0].ivid === first, 'the stored column matches the first-issued value after a second call');

  var auditCount = await scalar(
    "SELECT count(*) AS c FROM idauto_audit_log WHERE event_type = 'ivid.issue' AND actor_type = 'system' AND target_ref = $1",
    [String(fixtureVehicleId)]
  );
  ok(Number(auditCount) === 1, 'exactly one audit row was written for issuance (the no-op second call wrote none)');

  // F5 (Opus review, 2026-08-19): this suite must NEVER write to rows it
  // does not own. issueMissing() operates across the WHOLE idauto_vehicles
  // table, so before calling it, verify every currently-missing-ivid row
  // is one of THIS suite's own fixtures (internal_ref prefixed
  // FIXTURE_PREFIX) — by this point in a normal run that's exactly one
  // row (the fixture insertFixture() just created; every pre-existing
  // vehicle already got a permanent ivid the first time this suite or
  // issueMissing() ever ran against this database). If a genuinely
  // non-fixture row is ever found missing an ivid — a scenario that
  // should not occur post-F2 (new vehicles get an ivid at creation), but
  // could still arise from a row inserted outside the API — this suite
  // SKIPS the issueMissing() call entirely rather than mutate operational
  // rows it doesn't own. issueForVehicle()'s permanence/issuance logic is
  // already fully exercised above without needing issueMissing() to run
  // at all, so skipping loses no coverage of that logic.
  var missingRowsBefore = await db.query('SELECT id, internal_ref FROM idauto_vehicles WHERE ivid IS NULL');
  var nonFixtureMissing = missingRowsBefore.rows.filter(function (r) {
    return typeof r.internal_ref !== 'string' || r.internal_ref.indexOf(FIXTURE_PREFIX) !== 0;
  });
  if (nonFixtureMissing.length > 0) {
    console.log('  SKIP issueMissing() — ' + nonFixtureMissing.length + ' non-fixture vehicle(s) currently lack an ivid; refusing to mutate rows this suite does not own. issueForVehicle() permanence/issuance logic is already fully covered by the direct calls above.');
  } else {
    ok(true, 'precondition: every vehicle currently missing an ivid is this suite\'s own fixture — safe to call issueMissing()');
    var missingBefore = missingRowsBefore.rows.length;
    var missingResults = await ividIssuance.issueMissing(db);
    ok(Array.isArray(missingResults), 'issueMissing returns an array');
    ok(missingResults.length === missingBefore, 'issueMissing issued exactly the number of vehicles that were missing an ivid');
    var missingAfter = await scalar('SELECT count(*) AS c FROM idauto_vehicles WHERE ivid IS NULL');
    ok(Number(missingAfter) === 0, 'no vehicle is left without an ivid after issueMissing');

    var second2 = await ividIssuance.issueMissing(db);
    ok(Array.isArray(second2) && second2.length === 0, 'issueMissing is idempotent — a second run issues nothing');
  }

  var stillFirst = await db.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
  ok(stillFirst.rows[0].ivid === first, 'the fixture vehicle ivid is unchanged after this section runs');
}

async function validKnownIvid() {
  console.log('\n3. GET valid known ivid -> 200, public shape, no leakage');
  var res = await request('GET', '/public/passport/' + encodeURIComponent(fixtureIvid));
  ok(res.status === 200, 'known ivid resolves 200');
  ok(res.headers.authorization === undefined, 'sanity: this request carried no Authorization header');
  ok(!!res.body, 'response body parsed as JSON');
  ok(res.body && res.body.qr && res.body.qr.payload === fixtureIvid, 'qr.payload === the requested ivid exactly');
  ok(res.body && res.body.scope === 'public', 'passport scope is hardcoded public');
  ok(typeof res.body.completeness_note === 'string' && res.body.completeness_note.length > 0, 'completeness_note is present and non-empty');
  // F4: exactly one fact is visible even though the fixture stores THREE
  // access_scope='public' facts (colour, and the deny-listed vin +
  // plate_number) — proving PUBLIC_FACT_KEY_DENY_LIST, not just the
  // access_scope filter, keeps the deny-listed ones out.
  ok(Array.isArray(res.body.facts) && res.body.facts.length === 1, 'exactly one fact is visible — colour only, despite 3 public-scoped facts existing (non-vacuous: not zero, not three)');
  var factKeys = res.body.facts.map(function (f) { return f.fact_key; });
  ok(factKeys.indexOf('colour') !== -1, 'the public fact (colour) is present');
  ok(factKeys.indexOf('engine_cc') === -1, 'the professional-scope fact is absent from a public passport');
  ok(factKeys.indexOf('vin') === -1, 'vin is absent from a public passport (deny-listed by fact_key, regardless of its access_scope)');
  ok(factKeys.indexOf('plate_number') === -1, 'plate_number is absent from a public passport (deny-listed per the A5-PLATE ruling, 2026-08-19)');
  ok(res.raw.indexOf('SECRET-VIN-SHOULD-NEVER-LEAK') === -1, 'the mythos_private-scope vin VALUE does not appear anywhere in the raw response body');
  ok(res.raw.indexOf('PUBLIC-SCOPED-VIN-SHOULD-STILL-NEVER-LEAK') === -1, 'the PUBLIC-scoped vin VALUE also does not appear — the deny-list, not just access_scope, is what keeps it out');
  ok(res.raw.indexOf('PUBLIC-SCOPED-PLATE-SHOULD-NEVER-LEAK') === -1, 'the PUBLIC-scoped plate_number VALUE does not appear anywhere in the raw response body');
  ok(res.headers['content-security-policy'] !== undefined, 'CSP header is applied to the public response');
  ok(res.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options header is applied');
  ok(res.headers['cache-control'] === 'no-store', 'Cache-Control: no-store is applied');

  // Chef Phase-1 audit fix (follow-up to e220213): the vehicle object must
  // be protocol-conformant, not the raw DB row — no internal_ref, no
  // non-public columns.
  var vehicle = res.body && res.body.vehicle;
  ok(!!vehicle, 'response has a vehicle object');
  ok(vehicle.internal_ref === undefined, 'vehicle.internal_ref key is absent from the public response');
  ok(res.raw.indexOf(fixtureInternalRef) === -1, 'the fixture internal_ref STRING appears nowhere in the raw response body');
  ok(vehicle.seats === undefined, 'seats key is absent (fixture had a real, non-null seats value — non-vacuous)');
  ok(vehicle.engine_cc === undefined, 'engine_cc key is absent (fixture had a real, non-null engine_cc value — non-vacuous)');
  ok(vehicle.gross_weight_kg === undefined, 'gross_weight_kg key is absent');
  ok(vehicle.fiche_status === undefined, 'the raw fiche_status key name is absent (replaced by the protocol status field)');
  ok(vehicle.current_plate_ref === undefined, 'current_plate_ref is omitted entirely (A5: never expose plate on this route)');
  ok(vehicle.merged_into === undefined, 'merged_into is omitted (no such column exists in idauto_vehicles)');

  var expectedKeys = ['protocol_version', 'ivid', 'status', 'created_at', 'observation_count', 'summary'];
  var actualKeys = Object.keys(vehicle).sort();
  ok(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys.slice().sort()), 'vehicle object has exactly the expected protocol-conformant key set, got ' + JSON.stringify(actualKeys));
  ok(vehicle.protocol_version === '0.1.0-draft', 'vehicle.protocol_version matches the schema const');
  ok(vehicle.ivid === fixtureIvid, 'vehicle.ivid matches the resolved ivid');
  var VEHICLE_STATUS_ENUM = ['initial', 'pending_review', 'verified', 'conflict', 'merged', 'archived', 'closed'];
  ok(VEHICLE_STATUS_ENUM.indexOf(vehicle.status) !== -1, 'vehicle.status is a member of the protocol status enum, got ' + vehicle.status);
  ok(vehicle.status === 'initial', 'vehicle.status is the direct passthrough of the fixture\'s fiche_status (initial)');
  ok(typeof vehicle.created_at === 'string' && vehicle.created_at.length > 0 && !isNaN(Date.parse(vehicle.created_at)), 'vehicle.created_at is present and a parseable ISO 8601 string');
  ok(typeof vehicle.observation_count === 'number', 'vehicle.observation_count is present and numeric');
  var summaryKeys = Object.keys(vehicle.summary || {}).sort();
  var expectedSummaryKeys = ['make', 'model', 'variant', 'year', 'body_type', 'fuel_type', 'colour', 'category_code'].sort();
  ok(JSON.stringify(summaryKeys) === JSON.stringify(expectedSummaryKeys), 'summary object has exactly the schema\'s full public-safe field set, got ' + JSON.stringify(summaryKeys));
  ok(vehicle.summary.make === 'IDA4OptionCFixture' && vehicle.summary.colour === 'blue', 'summary carries the fixture\'s actual public-safe values');

  var withPlateQuery = await request('GET', '/public/passport/' + encodeURIComponent(fixtureIvid) + '?plate=123TUN4567');
  ok(withPlateQuery.status === 200 && withPlateQuery.body.qr.payload === fixtureIvid, '?plate= query parameter is ignored — same passport is returned');

  // Phase 3 prep: A5 forbids any citizen-PII surface. The vehicle/facts
  // shape checks above already prove specific fields are absent; this is
  // a broader sweep of the whole raw body for PII-shaped substrings, so a
  // future field addition anywhere in the response trips this too.
  ok(res.raw.length > 200, 'precondition: raw response body is non-trivially sized (non-vacuous substring sweep)');
  ['email', 'phone', 'address', 'national_id', 'cin', 'owner_name', 'holder'].forEach(function (needle) {
    ok(res.raw.toLowerCase().indexOf(needle) === -1, 'raw response body contains no "' + needle + '" substring (case-insensitive)');
  });
}

async function unknownValidFormatIvid() {
  console.log('\n4. valid-format, unknown ivid -> 404');
  var unknown = ivid.generate();
  var lookup = await db.query('SELECT 1 FROM idauto_vehicles WHERE ivid = $1', [unknown]);
  ok(lookup.rows.length === 0, 'precondition: the generated ivid does not exist in the database');
  var res = await request('GET', '/public/passport/' + encodeURIComponent(unknown));
  ok(res.status === 404, 'a well-formed but unissued ivid resolves 404');
  ok(res.body && typeof res.body.error === 'string', '404 body has the standard error shape');
}

async function malformedIvidNoDbCall() {
  console.log('\n5. malformed ivid -> 404, proof no DB query ran');
  var originalQuery = db.query;
  var callCount = 0;
  db.query = function () { callCount++; return originalQuery.apply(db, arguments); };
  try {
    var malformed = 'not-an-ivid-at-all';
    var res = await request('GET', '/public/passport/' + encodeURIComponent(malformed));
    ok(res.status === 404, 'malformed ivid resolves 404 — identical shape to an unknown-but-valid ivid');
    ok(callCount === 0, 'no database query occurred for a malformed ivid (spied db.query call count is exactly zero)');

    var tamperedCheck = fixtureIvid.slice(0, -2) + (fixtureIvid.slice(-2) === '00' ? '11' : '00');
    var res2 = await request('GET', '/public/passport/' + encodeURIComponent(tamperedCheck));
    ok(res2.status === 404, 'an ivid with a wrong check segment resolves 404');
    ok(callCount === 0, 'still zero DB queries after the tampered-check case');
  } finally {
    db.query = originalQuery;
  }
}

async function noPlatePath() {
  console.log('\n6. no plate path exists anywhere on the public surface');
  var plateAsIvid = await request('GET', '/public/passport/' + encodeURIComponent('123 TUN 4567'));
  ok(plateAsIvid.status === 404, 'a plate-shaped value as the path segment resolves 404 (fails the ivid format gate)');
  var pluralPlatePath = await request('GET', '/public/plate/123TUN4567');
  ok(pluralPlatePath.status === 404, '/public/plate/... does not exist as a route — 404');
  var bareePublic = await request('GET', '/public/');
  ok(bareePublic.status === 404, 'bare /public/ resolves 404');
  var wrongMethod = await request('POST', '/public/passport/' + encodeURIComponent(fixtureIvid));
  ok(wrongMethod.status === 405, 'POST to the passport route returns 405');
}

function writeTinyConfig() {
  var cfgPath = path.join(os.tmpdir(), 'ida4-option-c-public-resolution-' + crypto.randomBytes(6).toString('hex') + '.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ public_resolution: { rate_limit: { limit: 2, window_seconds: 2 } } }));
  return cfgPath;
}

async function burstAndRecovery() {
  console.log('\n7. burst -> 429 with Retry-After, then recovery after the window (isolated child process)');
  var cfgPath = writeTinyConfig();
  var childScript = path.join(os.tmpdir(), 'ida4-option-c-burst-child-' + crypto.randomBytes(6).toString('hex') + '.js');
  var childSource = [
    "'use strict';",
    "var http = require('http');",
    "var api = require(" + JSON.stringify(path.join(BASE, 'reference', 'api.js')) + ");",
    "var ivid = require(" + JSON.stringify(path.join(BASE, 'reference', 'ivid.js')) + ");",
    "(async function () {",
    "  var server = api.createServer();",
    "  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });",
    "  var port = server.address().port;",
    "  function req() {",
    "    return new Promise(function (resolve, reject) {",
    "      http.get({ hostname: '127.0.0.1', port: port, path: '/public/passport/' + encodeURIComponent(ivid.generate()) }, function (res) {",
    "        var chunks = [];",
    "        res.on('data', function (c) { chunks.push(c); });",
    "        res.on('end', function () { resolve({ status: res.statusCode, retryAfter: res.headers['retry-after'] || null }); });",
    "      }).on('error', reject);",
    "    });",
    "  }",
    "  var results = [];",
    "  for (var i = 0; i < 3; i++) results.push(await req());",
    "  await new Promise(function (r) { setTimeout(r, 2500); });",
    "  var after = await req();",
    "  await new Promise(function (r) { server.close(r); });",
    "  console.log(JSON.stringify({ results: results, after: after }));",
    "  process.exit(0);",
    "})().catch(function (e) { console.error('CHILD_FATAL: ' + e.message); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(childScript, childSource);

  // Phase 3 mutation-run finding (flaked ~3% of runs): this suite's own
  // earlier requests (§3/§9, real 60-second window) and the child's tiny
  // 2-second-window requests below both write into the SAME bucket row —
  // bucketKey('public_resolution:window', sha256('127.0.0.1')) is
  // identical either way, since only the dimension+IP are hashed, never
  // the window size. They differ only in window_start (floored to 60s vs
  // 2s), so this only collides when the child's floor-to-2s window
  // happens to fall in the same window_start bucket as the parent's
  // floor-to-60s window — i.e. any burst starting within 2s after a real
  // minute boundary — but when it does, the child inherits the parent's
  // count and its first two (should-be-allowed) requests spuriously 429.
  // Fixed here, in the TEST only: delete this exact bucket's own counter
  // rows before the child starts, scoped to precisely the
  // public_resolution:window/127.0.0.1 bucket key — never any other
  // dimension's rows, and never anything but a counter row this suite
  // itself could have written. This is cleanup of rate-limit counters
  // this suite's OWN earlier requests (§3/§9, and any prior run of this
  // suite against the same 127.0.0.1 loopback address) created — not
  // operational data, and not any other caller's traffic, since the
  // dimension is used by no other route in this codebase (F5/general
  // hygiene note, Opus review 2026-08-19).
  var publicResolutionIpHash = crypto.createHash('sha256').update('127.0.0.1').digest('hex');
  var publicResolutionBucketKey = rateLimit.bucketKey('public_resolution:window', publicResolutionIpHash);
  await db.query('DELETE FROM idauto_rate_limit_counters WHERE bucket_key = $1', [publicResolutionBucketKey]);

  try {
    var env = Object.assign({}, process.env, { IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH: cfgPath });
    var output = childProcess.execFileSync(process.execPath, [childScript], { env: env, timeout: 15000 }).toString('utf8');
    var lastLine = output.trim().split('\n').pop();
    var parsed = JSON.parse(lastLine);
    ok(parsed.results.length === 3, 'child made exactly 3 rapid requests against a limit of 2 per 2-second window');
    ok(parsed.results[0].status !== 429 && parsed.results[1].status !== 429, 'the first two requests (within the limit) are not rate-limited');
    ok(parsed.results[2].status === 429, 'the third request (over the limit) returns 429');
    ok(parsed.results[2].retryAfter !== null && Number(parsed.results[2].retryAfter) >= 1, '429 response carries a Retry-After header of at least 1 second');
    ok(parsed.after.status !== 429, 'after waiting past the window, the bucket has recovered — no longer rate-limited');
  } finally {
    try { fs.unlinkSync(childScript); } catch (_) {}
    try { fs.unlinkSync(cfgPath); } catch (_) {}
  }
}

// F3 (Opus review, 2026-08-19): config/idauto.example.json's
// public_resolution.enabled kill-switch was previously read by nothing.
// Isolated in its own child process (like burstAndRecovery() above) so
// this test's spied-zero-db-queries proof is against a fresh process —
// this suite's own db.query is already un-spyable at this point (it was
// restored in malformedIvidNoDbCall()'s finally block), and a fresh
// process is the cleanest way to prove the disabled route never
// initializes a pool connection at all, not just "never queries with
// this particular already-open client."
// F3 kill-switch, relabelled/extended as the A5-PLATE PHASE GATE test
// (Opus review R-round + owner's revised A5-PLATE ruling, 2026-08-19):
// public_resolution.enabled is the PRIVATE/PUBLIC phase gate — false
// means the ANONYMOUS surface is off entirely (PRIVATE phase), true
// means it's on WITH the policy deny-list applied (PUBLIC phase). This
// single child process, with enabled=false, now proves BOTH halves of
// that claim at once, in the identical config state: the anonymous
// route 404s a known-good ivid with zero DB queries (unchanged from the
// original kill-switch proof), AND the authenticated PRIVATE surface
// (GET /api/passport/:ivid) still serves the passport, plate_number
// included — i.e. the gate genuinely separates the two surfaces rather
// than disabling passport resolution altogether.
async function phaseGateSeparatesSurfaces() {
  console.log('\n11. A5-PLATE phase gate: public_resolution.enabled=false -> PRIVATE phase (anonymous surface off, zero DB queries; authenticated private surface still serves plate_number)');
  var cfgPath = path.join(os.tmpdir(), 'ida4-option-c-disabled-' + crypto.randomBytes(6).toString('hex') + '.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ public_resolution: { enabled: false, rate_limit: { limit: 30, window_seconds: 60 } } }));
  var childScript = path.join(os.tmpdir(), 'ida4-option-c-disabled-child-' + crypto.randomBytes(6).toString('hex') + '.js');
  var childSource = [
    "'use strict';",
    "var http = require('http');",
    "var dbPath = " + JSON.stringify(path.join(BASE, 'reference', 'db.js')) + ";",
    "var db = require(dbPath);",
    "var queryCalls = 0;",
    "var originalQuery = db.query;",
    "db.query = function () { queryCalls++; return originalQuery.apply(db, arguments); };",
    "var api = require(" + JSON.stringify(path.join(BASE, 'reference', 'api.js')) + ");",
    "var ivid = require(" + JSON.stringify(path.join(BASE, 'reference', 'ivid.js')) + ");",
    "(async function () {",
    "  var server = api.createServer();",
    "  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });",
    "  var port = server.address().port;",
    "  var knownGoodIvid = ivid.generate();",
    "  var publicResult = await new Promise(function (resolve, reject) {",
    "    http.get({ hostname: '127.0.0.1', port: port, path: '/public/passport/' + encodeURIComponent(knownGoodIvid) }, function (res) {",
    "      var chunks = [];",
    "      res.on('data', function (c) { chunks.push(c); });",
    "      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });",
    "    }).on('error', reject);",
    "  });",
    "  var publicOnlyQueryCalls = queryCalls;", // snapshot BEFORE the private request runs — the private route legitimately queries the DB, and must not be counted against the anonymous route's zero-query proof.
    "  var privateResult = await new Promise(function (resolve, reject) {",
    "    http.get({ hostname: '127.0.0.1', port: port, path: '/api/passport/' + encodeURIComponent(" + JSON.stringify(fixtureIvid) + "), headers: { 'Authorization': 'Bearer ' + " + JSON.stringify(ADMIN_TOKEN) + " } }, function (res) {",
    "      var chunks = [];",
    "      res.on('data', function (c) { chunks.push(c); });",
    "      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });",
    "    }).on('error', reject);",
    "  });",
    "  await new Promise(function (r) { server.close(r); });",
    "  console.log(JSON.stringify({ status: publicResult.status, body: publicResult.body, queryCalls: publicOnlyQueryCalls, privateStatus: privateResult.status, privateBody: privateResult.body }));",
    "  process.exit(0);",
    "})().catch(function (e) { console.error('CHILD_FATAL: ' + e.message); process.exit(1); });"
  ].join('\n');
  fs.writeFileSync(childScript, childSource);
  try {
    var env = Object.assign({}, process.env, { IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH: cfgPath });
    var output = childProcess.execFileSync(process.execPath, [childScript], { env: env, timeout: 15000 }).toString('utf8');
    var lastLine = output.trim().split('\n').pop();
    var parsed = JSON.parse(lastLine);
    ok(parsed.status === 404, 'PRIVATE phase (enabled=false): a well-formed, format-valid ivid on the ANONYMOUS route still resolves 404');
    var parsedBody = null; try { parsedBody = JSON.parse(parsed.body); } catch (_) {}
    ok(parsedBody && typeof parsedBody.error === 'string', 'the disabled anonymous-route 404 has the standard error shape (identical to every other 404 on this route)');
    ok(parsed.queryCalls === 0, 'zero database queries occurred on the anonymous route while the phase gate was PRIVATE (spied db.query call count is exactly zero), got ' + parsed.queryCalls);
    ok(parsed.privateStatus === 200, 'in the SAME PRIVATE-phase config state, the authenticated private surface (GET /api/passport/:ivid) still serves 200 — the gate separates the surfaces, it does not disable passport resolution altogether');
    var privateBodyParsed = null; try { privateBodyParsed = JSON.parse(parsed.privateBody); } catch (_) {}
    ok(privateBodyParsed && Array.isArray(privateBodyParsed.plates) && privateBodyParsed.plates.length === 1 &&
      privateBodyParsed.plates[0].plate_number === fixturePlateNumber,
      'the private surface response, in PRIVATE phase, still includes plate_number — proving PRIVATE phase permits plate display exactly as the A5-PLATE ruling requires');
  } finally {
    try { fs.unlinkSync(childScript); } catch (_) {}
    try { fs.unlinkSync(cfgPath); } catch (_) {}
  }
}

async function adminRouteStillAuthenticated() {
  console.log('\n8. pre-existing admin routes remain authenticated exactly as before');
  var noAuth = await request('GET', '/api/vehicles/' + encodeURIComponent('any-ref'));
  ok(noAuth.status === 401, '/api/vehicles/:ref without Authorization still returns 401');
  var health = await request('GET', '/health');
  ok(health.status === 401, '/health without Authorization still returns 401');
}

async function noAuthorizationHeaderAnywhere() {
  console.log('\n9. the public route works with no Authorization header (true of every request above)');
  var res = await request('GET', '/public/passport/' + encodeURIComponent(fixtureIvid));
  ok(res.status === 200, 'public route succeeds again with zero Authorization header, confirmed directly');
}

// §10. A5 PROHIBITION GUARDS — no person store, no citizen-PII surface.
//
// Phase 3 prep found no test that would fail if a person/citizen store
// were introduced (the only related check anywhere was
// holder-ref.schema.json's structural not-block, which guards the
// PROTOCOL schema only — nothing guarded the live database, the
// migrations directory, or the public response body). This section is
// that missing guard: it fails loudly the moment any of the three ever
// changes.
//
// KNOWN, VERIFIED, LEGITIMATE EXCEPTION: idauto_user_roles matches the
// naive /person|citizen|account|user|identity|holder/i pattern (via
// "user") but is NOT a citizen/person PII store — it is a professional-
// organisation role-assignment table keyed by an opaque mythos_user_id,
// explicitly commented "[NO PII] name/email resolved from Mythos OS auth
// at runtime" in database/schema.sql, predating this stage entirely (it
// is IDA-2's professional-subscription tier mechanism, not IDA-4's
// citizen surface). It is the ONLY one of the 24 live tables that
// matches; every other table name was checked by hand against this
// pattern before writing this guard. Excluding it by exact name (not by
// loosening the pattern) keeps the guard strict against anything NEW.
var KNOWN_LEGITIMATE_NON_CITIZEN_TABLES = ['idauto_user_roles'];

async function a5ProhibitionGuards() {
  console.log('\n10. A5 prohibition guards: no person store, no citizen PII surface');

  // 1. Live database: no person/citizen/account/identity/holder-shaped
  // table exists, other than the one verified, documented exception above.
  var tableResult = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  var tableNames = tableResult.rows.map(function (r) { return r.table_name; });
  ok(tableNames.length >= 24, 'precondition: the live schema has at least 24 tables (non-vacuous — got ' + tableNames.length + ')');
  var suspiciousTables = tableNames.filter(function (name) {
    return /person|citizen|account|user|identity|holder/i.test(name) && KNOWN_LEGITIMATE_NON_CITIZEN_TABLES.indexOf(name) === -1;
  });
  ok(suspiciousTables.length === 0, 'no person/citizen/account/identity/holder-shaped table exists beyond the one verified, documented exception — got ' + JSON.stringify(suspiciousTables));
  ok(tableNames.indexOf('idauto_user_roles') !== -1, 'precondition: the one documented exception table actually exists (the exclusion isn\'t vacuously excluding nothing)');

  // 2. Migrations directory: no migration ever CREATEs a person/citizen/
  // account table.
  var migrationsDir = path.join(BASE, 'database', 'migrations');
  var migrationFiles = fs.readdirSync(migrationsDir);
  ok(migrationFiles.length >= 1, 'precondition: at least one file exists in database/migrations/ (non-vacuous)');
  var ddlFiles = migrationFiles.filter(function (name) {
    var contents = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    return /CREATE\s+TABLE|ALTER\s+TABLE/i.test(contents);
  });
  ok(ddlFiles.length >= 1, 'precondition: at least one migration file contains CREATE TABLE or ALTER TABLE (non-vacuous — got ' + JSON.stringify(ddlFiles) + ')');
  var offendingMigrations = [];
  migrationFiles.forEach(function (name) {
    var contents = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    if (/CREATE\s+TABLE[^;]*(person|citizen|account)/i.test(contents)) offendingMigrations.push(name);
  });
  ok(offendingMigrations.length === 0, 'no migration file CREATEs a person/citizen/account table — got ' + JSON.stringify(offendingMigrations));

  // 3. Public response body PII sweep — covered directly in validKnownIvid()
  // (§3 above), where the real response body and its non-vacuity
  // precondition already live; not duplicated here.

  // 4. api.js source: the ROUTES table (the authenticated dispatch table)
  // carries no /public/ pattern at all — /public/ is handled by exactly
  // one dedicated, pre-auth branch, and the passport-specific regex
  // inside handlePublicPassportRoute() is the only place that actually
  // matches a /public/ path shape.
  var apiSource = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var routesMatch = /var ROUTES = \[[\s\S]*?\n\];/.exec(apiSource);
  ok(!!routesMatch, 'precondition: the ROUTES table is found in api.js source (non-vacuous — extraction itself succeeded)');
  if (routesMatch) {
    ok(routesMatch[0].toLowerCase().indexOf('/public') === -1, 'the authenticated ROUTES table contains no /public/ pattern of any kind');
  }
  var coarseDispatchOccurrences = (apiSource.match(/pathname\.indexOf\('\/public\/'\)\s*===\s*0/g) || []).length;
  ok(coarseDispatchOccurrences === 1, 'exactly one pre-auth /public/ dispatch branch exists in api.js, got ' + coarseDispatchOccurrences);
  var passportPatternOccurrences = (apiSource.match(/\/\^\\\/public\\\/passport\\\/\(\[\^\/\]\+\)\$\//g) || []).length;
  ok(passportPatternOccurrences === 1, 'exactly one /public/passport/:ivid route pattern exists in api.js, got ' + passportPatternOccurrences);

  // A5-PLATE: the new authenticated private surface resolves by ivid
  // only too — no plate-shaped path parameter exists there either.
  var privateRoutePatternOccurrences = (apiSource.match(/\/\^\\\/api\\\/passport\\\/\(\[\^\/\]\+\)\$\//g) || []).length;
  ok(privateRoutePatternOccurrences === 1, 'exactly one /api/passport/:ivid route pattern exists in api.js, got ' + privateRoutePatternOccurrences);
  ok(/getPrivatePassport[\s\S]{0,200}ivid\.validate\(rawIvid\)/.test(apiSource),
    'getPrivatePassport() validates the path segment as an ivid before doing anything else (format gate, same discipline as the anonymous route)');

  // 5. SQL defense-in-depth pin (mutation-verified 2026-08-19, Phase 3):
  // a mutation replacing `AND access_scope = $2` with `AND $2 = $2` in the
  // facts query left every behavioral assertion in this suite green,
  // because assemblePassport()'s own scope filter (reference/passport-
  // assembly.js) already removes any non-public fact before it reaches a
  // response — the SQL-level filter is real defense-in-depth, but no
  // BEHAVIORAL test can distinguish "SQL filtered it" from "the assembler
  // filtered it after SQL returned everything," precisely because the
  // assembler's primary filter masks the SQL layer. This structural
  // assertion pins the SQL layer directly so it cannot silently rot.
  ok(/access_scope = \$2/.test(apiSource), 'the facts query in api.js still filters access_scope = $2 in SQL (defense-in-depth, not just in assemblePassport())');
  ok(/\[candidate, 'public'\]/.test(apiSource), 'the facts query still binds $2 to the literal string \'public\' (not a caller-influenced or looser value)');

  // 6. F4/A5-PLATE deny-list structural pin (Opus review + the owner's
  // revised A5-PLATE ruling, 2026-08-19): a mutation shrinking or
  // removing the policy module's deny-list, dropping the SQL exclusion
  // that applies it, or reintroducing a LOCAL deny-list literal in
  // api.js (bypassing the one reviewed policy artifact the owner's
  // ruling requires) must fail this suite even though the primary
  // behavioral proof lives in §3 above.
  ok(/require\(['"]\.\/public-surface-policy\.js['"]\)/.test(apiSource), 'api.js requires ./public-surface-policy.js');
  ok(apiSource.indexOf('PUBLIC_FACT_KEY_DENY_LIST') === -1, 'api.js no longer contains a local PUBLIC_FACT_KEY_DENY_LIST literal — the deny-list lives only in the reviewed policy module');
  ok(/fact_key NOT IN \(/.test(apiSource), 'the facts query in api.js still applies a fact_key NOT IN (...) exclusion');
  var policySource = fs.readFileSync(path.join(BASE, 'reference', 'public-surface-policy.js'), 'utf8');
  ok(/var ANONYMOUS_SURFACE_DENIED_FACT_KEYS = \['vin', 'plate_number'\];/.test(policySource),
    'reference/public-surface-policy.js still declares exactly [\'vin\', \'plate_number\'] as the anonymous-surface deny-list');

  // 7. Q4 (Opus review, 2026-08-19): pin the private route's two scope
  // layers structurally, mirroring item 5's pin for the public route —
  // a mutation removing either layer must fail this suite even though
  // privateModePassport()'s own value-level assertions (§13) are the
  // primary behavioral proof. Restricted to a window starting at
  // getPrivatePassport()'s own declaration so a coincidental match
  // elsewhere in the file (several other routes also filter
  // access_scope != $2) cannot satisfy this pin by accident.
  var privateRouteSource = apiSource.slice(apiSource.indexOf('async function getPrivatePassport'));
  var privateRouteWindow = privateRouteSource.slice(0, 3000);
  ok(/access_scope != \$2/.test(privateRouteWindow), 'getPrivatePassport()\'s facts query still excludes access_scope != $2 (mythos_private) in SQL');
  ok(/scope: 'professional'/.test(privateRouteWindow), 'getPrivatePassport()\'s assemblePassport() call still passes scope: \'professional\'');
}

// F2 (Opus review, 2026-08-19): before this fix, nothing in production
// ever called reference/ivid-issuance.js — the live 86-vehicle backfill
// only ever happened via this very test suite (issueMissing()). This
// proves the fix directly: a vehicle created through the real,
// authenticated write path (POST /api/vehicles) has a permanent ivid in
// the SAME response, not only after a later, separate backfill step.
async function issuanceWiredIntoWriteAPI() {
  console.log('\n12. F2: issuance is wired into the authenticated POST /api/vehicles write path');
  var payload = JSON.stringify({ make: 'IDA4OptionCWiringTest', model: 'TestModel', year: 2026 });
  var createResp = await request('POST', '/api/vehicles',
    { 'Authorization': 'Bearer ' + ADMIN_TOKEN, 'Content-Type': 'application/json' }, payload);
  ok(createResp.status === 201, 'POST /api/vehicles (authenticated) -> 201');
  ok(createResp.body && typeof createResp.body.internal_ref === 'string' && createResp.body.internal_ref.length > 0,
    'precondition: response includes a real internal_ref (non-vacuous)');

  var newInternalRef = createResp.body && createResp.body.internal_ref;
  ok(createResp.body && typeof createResp.body.ivid === 'string' && ivid.validate(createResp.body.ivid).ok,
    'the vehicle has a well-formed ivid IMMEDIATELY in the create response — issuance is wired into production, not reachable only via the test suite or an out-of-band issueMissing() run');

  var dbRow = await db.query('SELECT id, ivid FROM idauto_vehicles WHERE internal_ref = $1', [newInternalRef]);
  ok(dbRow.rows.length === 1, 'precondition: the created vehicle is actually persisted (non-vacuous)');
  // R4: track this row for cleanupFixture() as soon as its id is known —
  // before any further assertion in this function that could throw —
  // rather than deleting it inline only at the end of this function.
  if (dbRow.rows.length === 1) secondaryFixtureVehicleId = dbRow.rows[0].id;
  ok(dbRow.rows[0].ivid === createResp.body.ivid, 'the persisted ivid column matches exactly what the create response returned');

  var auditCountForThisWrite = await scalar(
    "SELECT count(*) AS c FROM idauto_audit_log WHERE event_type = 'vehicle.create' AND target_ref = $1",
    [newInternalRef]
  );
  ok(Number(auditCountForThisWrite) === 1, 'exactly one vehicle.create audit row exists for this write — issuance did not add a second, separate audit row for the same atomic write');
  var separateIssuanceAuditCount = await scalar(
    "SELECT count(*) AS c FROM idauto_audit_log WHERE event_type = 'ivid.issue' AND target_ref = $1",
    [String(dbRow.rows[0].id)]
  );
  ok(Number(separateIssuanceAuditCount) === 0, 'no separate ivid.issue audit row was written for this write (skipAudit:true honoured; the ivid is captured in the one vehicle.create audit row instead)');
  var auditRow = await db.query("SELECT new_value_json FROM idauto_audit_log WHERE event_type = 'vehicle.create' AND target_ref = $1", [newInternalRef]);
  ok(auditRow.rows[0] && auditRow.rows[0].new_value_json.indexOf(createResp.body.ivid) !== -1,
    'the single vehicle.create audit row\'s new_value_json captures the issued ivid');

  // R4: cleanup for this fixture happens in cleanupFixture() (the
  // suite's own finally-based path, see main()), not inline here.
}

// A5-PLATE revised ruling, 2026-08-19: PRIVATE MODE. The authenticated
// private passport surface (GET /api/passport/:ivid, reference/api.js's
// getPrivatePassport()) is the "authorized internal users" surface the
// ruling's PRIVATE-phase half approves plate display on. Proves it
// directly against the fixture's own linked plate record, and proves
// the route is still gated by requireAuth() exactly like every other
// authenticated route.
async function privateModePassport() {
  console.log('\n13. A5-PLATE PRIVATE MODE: authenticated GET /api/passport/:ivid -> 200 with plate_number present; 401 without auth');
  var noAuth = await request('GET', '/api/passport/' + encodeURIComponent(fixtureIvid));
  ok(noAuth.status === 401, 'GET /api/passport/:ivid without Authorization -> 401 (same requireAuth() gate as every other route in the authenticated ROUTES table)');

  var res = await request('GET', '/api/passport/' + encodeURIComponent(fixtureIvid), { 'Authorization': 'Bearer ' + ADMIN_TOKEN });
  ok(res.status === 200, 'GET /api/passport/:ivid (authenticated) -> 200');
  ok(res.body && res.body.ivid === fixtureIvid, 'the private passport resolves to the correct vehicle (ivid matches)');
  // Q4 (Opus review, 2026-08-19), behavioral half of the scope pin —
  // mirrors validKnownIvid()'s own res.body.scope === 'public' assertion
  // for the public route: assert the ACTUAL value assemblePassport()
  // normalizes 'professional' to in the response, not merely that the
  // call site passes it in (that half is pinned structurally in §10).
  ok(res.body && res.body.scope === 'professional', 'private passport scope is \'professional\' in the actual response (not mythos_private/restricted)');

  // P2 (Opus review, 2026-08-19): the private route's vehicle object
  // must be protocol/schemas/vehicle.schema.json-conformant too, built
  // by the SAME shared helper (buildProtocolConformantVehicle()) the
  // public route uses — not a raw DB row.
  var privateVehicleKeys = Object.keys(res.body.vehicle || {}).sort();
  var expectedVehicleKeys = ['protocol_version', 'ivid', 'status', 'created_at', 'observation_count', 'summary'].sort();
  ok(JSON.stringify(privateVehicleKeys) === JSON.stringify(expectedVehicleKeys), 'the private route\'s vehicle object has exactly the same protocol-conformant key set as the public route\'s, got ' + JSON.stringify(privateVehicleKeys));
  ok(res.body.vehicle.internal_ref === undefined && res.body.vehicle.seats === undefined && res.body.vehicle.gross_weight_kg === undefined && res.body.vehicle.engine_cc === undefined,
    'no raw/internal columns (internal_ref, seats, gross_weight_kg, engine_cc) leak onto the private vehicle object either');
  // Q5 (Opus review, 2026-08-19): value-level drift guard between the
  // two buildProtocolConformantVehicle() call sites — proves the private
  // route's builder call produces the actual fixture VALUES, not merely
  // the same key SET the check above already covers.
  ok(res.body.vehicle.ivid === fixtureIvid, 'private vehicle.ivid matches the fixture\'s actual ivid exactly');
  ok(res.body.vehicle.status === 'initial', 'private vehicle.status matches the fixture\'s actual fiche_status (initial) exactly');

  ok(Array.isArray(res.body && res.body.plates) && res.body.plates.length === 1,
    'precondition: exactly one plate record is present (non-vacuous — matches the fixture\'s single linked plate)');
  ok(res.body.plates[0].plate_number === fixturePlateNumber,
    'plate_number IS present and correct in the private surface response — PRIVATE phase permits plate display, per the A5-PLATE ruling');

  // P2: each plate object must be protocol/schemas/plate.schema.json-conformant
  // (additionalProperties:false) — exactly the keys buildProtocolConformantPlate()
  // emits, no raw DB column names (governorate_name, status, valid_until).
  var plateKeys = Object.keys(res.body.plates[0]).sort();
  var expectedPlateKeys = ['protocol_version', 'id', 'subject_ivid', 'plate_number', 'plate_raw', 'format_code', 'region_code', 'valid_from', 'valid_to'].sort();
  ok(JSON.stringify(plateKeys) === JSON.stringify(expectedPlateKeys), 'the plate object has exactly the schema-allowed key set, got ' + JSON.stringify(plateKeys));
  ok(res.body.plates[0].protocol_version === '0.1.0-draft', 'plate.protocol_version matches the schema const');
  ok(res.body.plates[0].subject_ivid === fixtureIvid, 'plate.subject_ivid matches the resolved vehicle\'s ivid');
  ok(typeof res.body.plates[0].id === 'string' && res.body.plates[0].id.length > 0, 'plate.id is present and a string (schema requires string, not the raw numeric DB id)');
  ok(res.body.plates[0].governorate_name === undefined && res.body.plates[0].status === undefined && res.body.plates[0].valid_until === undefined,
    'no raw plate columns (governorate_name, status, valid_until) leak onto the plate object — mapped to region_code/dropped/valid_to respectively');
  // P1 (Opus review, 2026-08-19): this route assembles at scope
  // 'professional' with mythos_private facts excluded in SQL — the same
  // two-layer pattern the public route uses, mirrored here. The fixture
  // carries a mythos_private vin fact (the sentinel value) AND a
  // professional-scoped engine_cc fact; the private surface must show
  // the professional one and never the mythos_private one.
  var professionalFact = res.body.facts.filter(function (f) { return f.fact_key === 'engine_cc'; })[0];
  ok(!!professionalFact, 'precondition: the professional-scope engine_cc fact is present in the fixture (non-vacuous)');
  ok(professionalFact && professionalFact.fact_value === '1600', 'the professional-scope engine_cc fact DOES appear on the private surface (scope professional, not restricted-only)');
  var mythosPrivateFact = res.body.facts.filter(function (f) { return f.fact_value === 'SECRET-VIN-SHOULD-NEVER-LEAK'; });
  ok(mythosPrivateFact.length === 0, 'the mythos_private-scope vin fact does NOT appear on the private surface either — restricted facts stay excluded (no audit-on-read path exists — PRIVACY_ARCHITECTURE.md §3)');
  ok(res.raw.indexOf('SECRET-VIN-SHOULD-NEVER-LEAK') === -1, 'the mythos_private-scope vin VALUE does not appear anywhere in the raw private-surface response body');

  // No new plate-RESOLUTION path: this route takes an ivid, never a
  // plate, in its own path segment — confirmed structurally alongside
  // the source checks in a5ProhibitionGuards() §10, and behaviorally
  // here: requesting by a plate-shaped value 404s exactly like the
  // anonymous route does (still resolves by ivid only).
  var plateAsIvid = await request('GET', '/api/passport/' + encodeURIComponent(fixturePlateNumber), { 'Authorization': 'Bearer ' + ADMIN_TOKEN });
  ok(plateAsIvid.status === 404, 'a plate-shaped value as the private route\'s path segment resolves 404 — no plate-based lookup exists here either');
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  try {
    await migrationIdempotence();
    await insertFixture();
    await issuancePermanence();
    await validKnownIvid();
    await unknownValidFormatIvid();
    await malformedIvidNoDbCall();
    await noPlatePath();
    await burstAndRecovery();
    await adminRouteStillAuthenticated();
    await noAuthorizationHeaderAnywhere();
    await a5ProhibitionGuards();
    await phaseGateSeparatesSurfaces();
    await issuanceWiredIntoWriteAPI();
    await privateModePassport();
  } finally {
    await cleanupFixture();
    if (server) await new Promise(function (resolve) { server.close(resolve); });
    await db.closePool();
  }
  console.log('\nStage IDA-4 Option C: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (error) {
  try { await cleanupFixture(); } catch (_) {}
  if (server) { try { await new Promise(function (resolve) { server.close(resolve); }); } catch (_) {} }
  try { await db.closePool(); } catch (_) {}
  console.log('FATAL: ' + error.stack);
  process.exit(1);
});
