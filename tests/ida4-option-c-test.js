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

var db = require(path.join(BASE, 'reference', 'db.js'));
var ivid = require(path.join(BASE, 'reference', 'ivid.js'));
var ividIssuance = require(path.join(BASE, 'reference', 'ivid-issuance.js'));
var api = require(path.join(BASE, 'reference', 'api.js'));

var server, port;
function request(method, requestPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: headers || {} }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
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

  var factRows = [
    ['colour', 'blue', 'public'],
    ['engine_cc', '1600', 'professional'],
    ['vin', 'SECRET-VIN-SHOULD-NEVER-LEAK', 'mythos_private']
  ];
  for (var i = 0; i < factRows.length; i++) {
    await db.query(
      "INSERT INTO idauto_vehicle_facts (vehicle_id, fact_key, fact_value, confidence_score, verification_status, access_scope) " +
      "VALUES ($1,$2,$3,$4,$5,$6)",
      [fixtureVehicleId, factRows[i][0], factRows[i][1], 0.9, 'verified', factRows[i][2]]
    );
  }
  var factCount = await scalar('SELECT count(*) AS c FROM idauto_vehicle_facts WHERE vehicle_id = $1', [fixtureVehicleId]);
  ok(Number(factCount) === 3, 'precondition: fixture vehicle has exactly 3 facts across 3 scopes (non-vacuous)');
}

async function cleanupFixture() {
  if (fixtureVehicleId == null) return;
  await db.query('DELETE FROM idauto_vehicle_facts WHERE vehicle_id = $1', [fixtureVehicleId]);
  await db.query('DELETE FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
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

  var missingBefore = await scalar('SELECT count(*) AS c FROM idauto_vehicles WHERE ivid IS NULL');
  var missingResults = await ividIssuance.issueMissing(db);
  ok(Array.isArray(missingResults), 'issueMissing returns an array');
  ok(missingResults.length === Number(missingBefore), 'issueMissing issued exactly the number of vehicles that were missing an ivid');
  var missingAfter = await scalar('SELECT count(*) AS c FROM idauto_vehicles WHERE ivid IS NULL');
  ok(Number(missingAfter) === 0, 'no vehicle is left without an ivid after issueMissing');

  var second2 = await ividIssuance.issueMissing(db);
  ok(Array.isArray(second2) && second2.length === 0, 'issueMissing is idempotent — a second run issues nothing');

  var stillFirst = await db.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [fixtureVehicleId]);
  ok(stillFirst.rows[0].ivid === first, 'the fixture vehicle ivid is unchanged after issueMissing runs across the whole table');
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
  ok(Array.isArray(res.body.facts) && res.body.facts.length === 1, 'exactly one fact is visible — the public-scope one (non-vacuous: not zero, not three)');
  var factKeys = res.body.facts.map(function (f) { return f.fact_key; });
  ok(factKeys.indexOf('colour') !== -1, 'the public fact (colour) is present');
  ok(factKeys.indexOf('engine_cc') === -1, 'the professional-scope fact is absent from a public passport');
  ok(factKeys.indexOf('vin') === -1, 'the mythos_private-scope fact (vin) is absent from a public passport');
  ok(res.raw.indexOf('SECRET-VIN-SHOULD-NEVER-LEAK') === -1, 'the restricted fact VALUE does not appear anywhere in the raw response body');
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
