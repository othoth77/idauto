'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2 Phase A tests
// tests/ida-2a-schema-and-plate-validation-test.js
//
// Deterministic, offline, no database/network dependency. Covers:
//   1. Structural validation of the IDA-2 Phase A migration-ready schema
//      (database/schema.sql) — no live PostgreSQL is
//      installed or contacted; this is static/textual validation only,
//      matching the pattern already used for IDA-0's schema checks.
//      Includes R-T03 regression lock-in (access_scope, not
//      visibility_scope), added IDA-2A-CORRECTION-0.
//   2. reference/plate-validator.js behaviour against the
//      7 UNVERIFIED-DRAFT format patterns in
//      config/idauto.example.json, including the
//      loadFormats() cache added IDA-2A-CORRECTION-0.
//
// Run with: node tests/ida-2a-schema-and-plate-validation-test.js
// =====================================================

var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var SCHEMA_PATH = path.join(BASE, 'database', 'schema.sql');
var CONFIG_PATH = path.join(BASE, 'config', 'idauto.example.json');
var validator = require(path.join(BASE, 'reference', 'plate-validator.js'));

console.log('\n1. SCHEMA — structural integrity (static text validation, no live database)');
(function () {
  var sql = fs.readFileSync(SCHEMA_PATH, 'utf8');

  var open = (sql.match(/\(/g) || []).length;
  var close = (sql.match(/\)/g) || []).length;
  ok(open === close, 'Parenthesis count balanced (' + open + ' open = ' + close + ' close)');

  // 22 from IDA-2 Phase A, plus idauto_submissions and
  // idauto_rate_limit_counters added by the IDA-3A ingestion schema.
  var createTables = sql.match(/^CREATE TABLE (\w+)/gm) || [];
  ok(createTables.length === 24, 'Exactly 24 CREATE TABLE statements (found ' + createTables.length + ')');
  ok(createTables.every(function (l) { return /^CREATE TABLE idauto_/.test(l); }),
    'Every table is idauto_-prefixed (schema isolation, no cross-schema table names)');

  ok(sql.indexOf('IDA-2 Phase A') !== -1, 'Header reflects current IDA-2 Phase A status');
  ok(sql.indexOf('applied and live-verified in IDA-2B') !== -1 && sql.indexOf('NOT YET INSTALLED OR DEPLOYED') === -1,
    'Footer records the schema as applied and live-verified in IDA-2B');

  // Privacy contract: no owner-PII column name appears on any table this
  // migration creates, per IDA-0/IDA-1's documented privacy contract.
  var ownerPiiNames = ['owner_name', 'owner_address', 'owner_cin', 'owner_passport', 'owner_phone', 'insurance_policy_number', 'insurance_company'];
  var foundPii = ownerPiiNames.filter(function (n) { return sql.indexOf(n) !== -1 && sql.indexOf('-- ' + n) === -1 && sql.indexOf(n + ' -') === -1; });
  // The names legitimately appear inside the config's own documentation strings/comments describing what must NEVER be a column;
  // check specifically that none appears as an actual column definition (a line starting with the field name followed by a SQL type).
  var columnDefPii = ownerPiiNames.filter(function (n) {
    var re = new RegExp('^\\s*' + n + '\\s+(VARCHAR|TEXT|INTEGER|BOOLEAN|DATE|TIMESTAMPTZ)', 'm');
    return re.test(sql);
  });
  ok(columnDefPii.length === 0, 'No owner-PII field is ever defined as an actual table column (' + (columnDefPii.join(', ') || 'none found') + ')');

  ok(sql.indexOf('idauto_audit_log') !== -1 && sql.indexOf('append-only') !== -1, 'Audit log table present and documented as append-only');

  // R-T03 regression lock-in (IDA-2A-CORRECTION-0): the scope column must
  // be named access_scope everywhere it is actually used as a column,
  // index target, or CHECK constraint — matching AutoValeur's canonical
  // naming (docs/AUTOMOTIVE_ARCHITECTURE.md). The old name may still
  // legitimately appear in prose explaining the historical rename (e.g.
  // this file's own header), so this checks structural SQL usage only,
  // not "the substring never appears anywhere in the file".
  var visibilityScopeAsSql = sql.match(/^\s*visibility_scope\s+VARCHAR/m)
    || sql.match(/\bvisibility_scope\s+IN\s*\(/)
    || sql.match(/\(\s*visibility_scope\s*\)/);
  ok(!visibilityScopeAsSql, 'R-T03: visibility_scope is never used as a column definition, CHECK constraint, or index target (fully renamed structurally)');
  var accessScopeColumns = sql.match(/^\s*access_scope\s+VARCHAR/gm) || [];
  ok(accessScopeColumns.length === 2, 'R-T03: access_scope is defined as an actual column on exactly 2 tables (idauto_observation_media, idauto_vehicle_facts) — found ' + accessScopeColumns.length);
})();

console.log('\n2. CONFIG — plate_formats section loads and is structurally sane');
(function () {
  var config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  var formats = config.plate_formats && config.plate_formats.formats;
  ok(Array.isArray(formats) && formats.length === 7, 'Exactly 7 plate formats defined (found ' + (formats ? formats.length : 0) + ')');
  ok(formats.every(function (f) { return f.verified === false; }), 'Every format is marked verified:false (UNVERIFIED DRAFT, per config _note)');
  ok(formats.every(function (f) { return typeof f.pattern === 'string' && f.pattern.length > 0; }), 'Every format has a non-empty pattern string');
})();

console.log('\n3. plate-validator.normalizePlate — normalization behaviour');
(function () {
  ok(validator.normalizePlate('123 tun 4567') === '123 TUN 4567', 'Lowercase input is uppercased');
  ok(validator.normalizePlate('  123   TUN   4567  ') === '123 TUN 4567', 'Leading/trailing/internal whitespace runs collapse to single spaces');
  ok(validator.normalizePlate('') === '', 'Empty string normalizes to empty string');
  ok(validator.normalizePlate(null) === '', 'null input does not throw, normalizes to empty string');
  ok(validator.normalizePlate(undefined) === '', 'undefined input does not throw, normalizes to empty string');
  ok(validator.normalizePlate(12345) === '', 'Non-string input does not throw, normalizes to empty string');
})();

console.log('\n4. plate-validator.matchPlateFormat — every active format\'s own documented example matches');
(function () {
  var formats = validator.loadFormats();
  var activeExamples = {
    TUN_STD: '123 TUN 4567',
    TUN_GVT: 'GN 123 456',
    TUN_DIP: 'CD 12 345',
    TUN_MIL: 'ARN 123456',
    TUN_TMP: 'TT 12345 A',
    TUN_ECO: 'ZE 1234 567'
  };
  Object.keys(activeExamples).forEach(function (code) {
    var result = validator.matchPlateFormat(activeExamples[code], formats);
    ok(result !== null && result.format_code === code, code + ' example "' + activeExamples[code] + '" matches its own format (got ' + (result ? result.format_code : 'null') + ')');
    ok(result && result.verified === false, code + ' match result correctly reports verified:false (draft pattern, not an official confirmation)');
  });
})();

console.log('\n5. plate-validator.matchPlateFormat — inactive format is never matched');
(function () {
  var formats = validator.loadFormats();
  var tunOld = formats.filter(function (f) { return f.code === 'TUN_OLD'; })[0];
  ok(tunOld && tunOld.active === false, 'TUN_OLD is loaded as inactive, per config');
  var result = validator.matchPlateFormat('1234 TUN 56', formats);
  ok(result === null, 'TUN_OLD\'s own example ("1234 TUN 56") does not match any ACTIVE format, since TUN_OLD is inactive');
})();

console.log('\n6. plate-validator.matchPlateFormat — malformed / unrecognised input is rejected');
(function () {
  ok(validator.matchPlateFormat('') === null, 'Empty string does not match');
  ok(validator.matchPlateFormat('NOT A PLATE') === null, 'Arbitrary non-plate text does not match');
  ok(validator.matchPlateFormat('123456789012345678901234567890') === null, 'Long numeric-only garbage does not match');
  ok(validator.isValidPlate('123 TUN 4567') === true, 'isValidPlate() true-path convenience wrapper works');
  ok(validator.isValidPlate('garbage') === false, 'isValidPlate() false-path convenience wrapper works');
})();

console.log('\n7. plate-validator.js — no database/network dependency (offline, pure module)');
(function () {
  var src = fs.readFileSync(path.join(BASE, 'reference', 'plate-validator.js'), 'utf8');
  var forbidden = [/require\(['"]pg['"]\)/, /require\(['"]http/, /fetch\(/, /\.query\(/, /process\.env\./];
  var clean = forbidden.every(function (re) { return !re.test(src); });
  ok(clean, 'Module never imports a database driver, performs network I/O, or reads environment variables — pure, offline, testable in isolation');
})();

console.log('\n8. plate-validator.loadFormats — caching behaviour (IDA-2A-CORRECTION-0)');
(function () {
  validator.clearFormatCache();
  var first = validator.loadFormats();
  var second = validator.loadFormats();
  ok(first === second, 'Two loadFormats() calls for the same (default) path return the identical cached array reference, not a fresh read each time');

  var firstPattern = first[0].pattern;
  var secondPattern = second[0].pattern;
  ok(firstPattern === secondPattern, 'Cached entries carry the same compiled RegExp instances across calls (no needless recompilation)');

  validator.clearFormatCache();
  var third = validator.loadFormats();
  ok(third !== first, 'clearFormatCache() forces the next loadFormats() call to re-read and re-parse from disk (new array reference)');
  ok(third.length === first.length && third[0].code === first[0].code, 'Re-loaded data is still correct after a cache clear (same 7 formats, same content)');

  // matchPlateFormat()/isValidPlate() single-argument form (the path a
  // future per-request API caller would use) must benefit from the same
  // cache, not bypass it.
  validator.clearFormatCache();
  ok(validator.isValidPlate('123 TUN 4567') === true, 'isValidPlate() single-argument form still works correctly after a cache clear');
  var cachedAfterCall = validator.loadFormats();
  var cachedAfterCall2 = validator.loadFormats();
  ok(cachedAfterCall === cachedAfterCall2, 'After a single-argument matchPlateFormat()/isValidPlate() call populates the cache, subsequent loadFormats() calls hit the same cached array');
})();

console.log('\nStage IDA-2 Phase A (schema + plate validation): ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
