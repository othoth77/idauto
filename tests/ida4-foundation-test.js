'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4-FOUNDATION tests
// tests/ida4-foundation-test.js
//
// Deterministic, offline, no database/network dependency, no environment
// variable required (the migration dry-run's own env-guard test sets one
// deliberately, in a CHILD process only, to prove the guard fires — see
// section 4). Covers exactly the gate-free foundation subset:
//   1. reference/ivid.js — pinned test vectors, generate/validate/parse.
//   2. protocol/schemas/*.json — all parse; the specific additive fixes
//      from this stage are present.
//   3. reference/passport-assembly.js — scope filtering, trust_summary,
//      completeness_note, qr.
//   4. database/migrations/ivid-migration-dry-run.js — in-process run,
//      and a REFUSED child-process run with a fake IDAUTO_DB_HOST.
//
// Run with: node tests/ida4-foundation-test.js
// =====================================================

var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var ivid = require(path.join(BASE, 'reference', 'ivid.js'));
var passportAssembly = require(path.join(BASE, 'reference', 'passport-assembly.js'));
var dryRunLib = require(path.join(BASE, 'database', 'migrations', 'ivid-migration-dry-run.js'));

var SCHEMAS_DIR = path.join(BASE, 'protocol', 'schemas');

console.log('\n1. reference/ivid.js — pinned vectors, generate/validate/parse');
(function () {
  // Pinned test vectors, independently reproduced here (not copy-pasted
  // from ivid.js's own header comment — recomputed against a from-scratch
  // reimplementation of the documented algorithm) so a bug shared between
  // the module and this test cannot silently agree with itself.
  function referenceCheckSymbols(payload) {
    var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    var idx = {};
    for (var i = 0; i < ALPHABET.length; i++) idx[ALPHABET[i]] = i;
    var sum = 0;
    for (var j = 0; j < payload.length; j++) {
      sum = sum + idx[payload[j]] * (j + 1);
    }
    var checkValue = sum % 1024;
    var high = Math.floor(checkValue / 32);
    var low = checkValue % 32;
    return ALPHABET[high] + ALPHABET[low];
  }

  var vectors = [
    ['0000000000000000', '00'],
    ['ZZZZZZZZZZZZZZZZ', '3R'],
    ['7K2QF9WBN4TXJ0R3', '0D'],
    ['0123456789ABCDEFGHJK', 'K4'],
    ['10ABCDEFGHJKMNPQRSTVWXYZ012345', '7D']
  ];
  ok(vectors.length >= 5, 'precondition: at least 5 pinned vectors defined (found ' + vectors.length + ')');

  vectors.forEach(function (v) {
    var payload = v[0], expected = v[1];
    ok(referenceCheckSymbols(payload) === expected,
      'independent reimplementation reproduces pinned vector for payload ' + payload + ' -> ' + expected);
    ok(ivid.checkSymbols(payload) === expected,
      'ivid.checkSymbols reproduces pinned vector for payload ' + payload + ' -> ' + expected);
  });

  ok(ivid.CROCKFORD_ALPHABET === '0123456789ABCDEFGHJKMNPQRSTVWXYZ', 'alphabet is exactly the Crockford base32 set, in order');
  ok(ivid.CROCKFORD_ALPHABET.length === 32, 'alphabet has exactly 32 symbols');
  ['I', 'L', 'O', 'U'].forEach(function (ch) {
    ok(ivid.CROCKFORD_ALPHABET.indexOf(ch) === -1, 'alphabet excludes ' + ch);
  });
  // Cross-check against the schema's own character class, expanded
  // independently of reference/ivid.js's internal comment.
  var schemaClassRe = /[0-9A-HJKMNP-TV-Z]/;
  var expanded = '';
  for (var code = 48; code <= 90; code++) {
    var ch2 = String.fromCharCode(code);
    if (schemaClassRe.test(ch2)) expanded += ch2;
  }
  ok(expanded.split('').sort().join('') === ivid.CROCKFORD_ALPHABET.split('').sort().join(''),
    'vehicle.schema.json pattern character class [0-9A-HJKMNP-TV-Z] is the identical 32-symbol set as ivid.js\'s alphabet');

  var generated = [];
  for (var g = 0; g < 5; g++) generated.push(ivid.generate());
  ok(generated.every(function (id) { return typeof id === 'string' && id.length > 0; }), 'generate() produces non-empty strings');
  ok(generated.every(function (id) { return ivid.validate(id).ok; }), 'every generate() output validates ok');
  ok(generated.every(function (id) { return /^ivid:1:/.test(id); }), 'every generate() output has the ivid:1: prefix (v1 issuance)');

  ok(ivid.validate('xyz:1:' + '0'.repeat(16) + ':00').ok === false, 'validate rejects wrong prefix');
  ok(ivid.validate('ivid:1:' + 'I'.repeat(16) + ':00').ok === false, 'validate rejects payload containing excluded letter I');
  ok(ivid.validate('ivid:1:' + 'L'.repeat(16) + ':00').ok === false, 'validate rejects payload containing excluded letter L');
  ok(ivid.validate('ivid:1:' + 'O'.repeat(16) + ':00').ok === false, 'validate rejects payload containing excluded letter O');
  ok(ivid.validate('ivid:1:' + 'U'.repeat(16) + ':00').ok === false, 'validate rejects payload containing excluded letter U');

  var payload15 = '0'.repeat(15);
  ok(ivid.validate('ivid:1:' + payload15 + ':' + '00').ok === false, 'validate rejects a 15-symbol payload (below minimum 16)');
  var payload31 = '0'.repeat(31);
  ok(ivid.validate('ivid:1:' + payload31 + ':' + '00').ok === false, 'validate rejects a 31-symbol payload (above maximum 30)');

  var valid30 = '10ABCDEFGHJKMNPQRSTVWXYZ012345';
  ok(valid30.length === 30, 'precondition: 30-symbol test payload is actually 30 symbols');
  ok(ivid.validate('ivid:1:' + valid30 + ':' + ivid.checkSymbols(valid30)).ok === true, 'validate accepts a 30-symbol payload (at the maximum) with a correct check');

  var tamperTarget = ivid.generate();
  var parts = tamperTarget.split(':');
  var tamperedCheck = parts[3] === '00' ? '01' : '00';
  var tampered = parts[0] + ':' + parts[1] + ':' + parts[2] + ':' + tamperedCheck;
  ok(ivid.validate(tampered).ok === false, 'validate rejects a tampered (wrong) check segment');

  var roundTripSource = ivid.generate();
  var parsed = ivid.parse(roundTripSource);
  ok(parsed !== null, 'parse() returns non-null for a well-formed IVID');
  ok(!!parsed && parsed.version === '1' && ('ivid:' + parsed.version + ':' + parsed.payload + ':' + parsed.check) === roundTripSource,
    'parse() round-trips back to the exact original string');
  ok(ivid.parse('not-an-ivid') === null, 'parse() returns null for a malformed string');

  var uniq = Object.create(null);
  var allValid = true;
  var allUnique = true;
  var N = 1000;
  for (var k = 0; k < N; k++) {
    var v2 = ivid.generate();
    if (uniq[v2]) { allUnique = false; }
    uniq[v2] = true;
    if (!ivid.validate(v2).ok) { allValid = false; }
  }
  ok(allUnique, N + ' generate() calls are all unique');
  ok(allValid, N + ' generate() calls all validate() ok');
})();

console.log('\n2. protocol/schemas — additive fixes from this stage');
(function () {
  var files = fs.readdirSync(SCHEMAS_DIR).filter(function (f) { return f.endsWith('.schema.json'); });
  ok(files.length >= 12, 'precondition: at least 12 schema files present in protocol/schemas/ (found ' + files.length + ')');

  var parsed = {};
  files.forEach(function (f) {
    var full = path.join(SCHEMAS_DIR, f);
    var doc = null;
    try {
      doc = JSON.parse(fs.readFileSync(full, 'utf8'));
      ok(true, f + ': parses as JSON');
    } catch (e) {
      ok(false, f + ': parses as JSON (' + e.message + ')');
    }
    parsed[f] = doc;
  });

  var passport = parsed['passport.schema.json'];
  ok(!!passport && Array.isArray(passport.required), 'passport.schema.json has a required array (precondition)');
  ok(!!passport && passport.required.indexOf('completeness_note') !== -1, 'passport.required contains completeness_note');
  ok(!!passport && passport.required.indexOf('qr') !== -1, 'passport.required contains qr');

  var anomaly = parsed['anomaly.schema.json'];
  ok(!!anomaly && Array.isArray(anomaly.required), 'anomaly.schema.json has a required array (precondition)');
  ok(!!anomaly && anomaly.required.indexOf('statement') !== -1, 'anomaly.required contains statement');

  var transfer = parsed['ownership-transfer.schema.json'];
  ok(!!transfer && !!transfer.properties, 'ownership-transfer.schema.json has properties (precondition)');
  ok(!!transfer && !!transfer.properties.supersedes, 'ownership-transfer.schema.json has a supersedes property');
  ok(!!transfer && transfer.required.indexOf('supersedes') === -1, 'ownership-transfer.supersedes is NOT required (optional, matching fact.schema.json\'s own supersedes)');

  var vehicle = parsed['vehicle.schema.json'];
  ok(!!vehicle && !!vehicle.properties && !!vehicle.properties.ivid, 'vehicle.schema.json has an ivid property (precondition)');
  ok(!!vehicle && vehicle.properties.ivid.pattern === '^ivid:[0-9]+:[0-9A-HJKMNP-TV-Z]{16,30}:[0-9A-HJKMNP-TV-Z]{2}$',
    'vehicle.schema.json ivid pattern is bounded to {16,30}');

  var holderRef = parsed['holder-ref.schema.json'];
  ok(!!holderRef, 'holder-ref.schema.json exists and parses');
  ok(!!holderRef && holderRef.$id === 'https://idauto.org/protocol/0.1.0/holder-ref.schema.json',
    'holder-ref.schema.json $id matches house convention (https://idauto.org/protocol/0.1.0/<file>)');
  ok(!!holderRef && holderRef.$schema === 'https://json-schema.org/draft/2020-12/schema',
    'holder-ref.schema.json $schema matches house convention (draft 2020-12)');
  ok(!!holderRef && !!holderRef.not && Array.isArray(holderRef.not.anyOf) && holderRef.not.anyOf.length > 0,
    'holder-ref.schema.json carries a forbidden-person-fields "not" block');
  ok(!!holderRef && JSON.stringify(holderRef.not).indexOf('national_id') !== -1 && JSON.stringify(holderRef.not).indexOf('cin') !== -1,
    'holder-ref.schema.json\'s forbidden fields include national_id and cin');

  var tombstone = parsed['tombstone.schema.json'];
  ok(!!tombstone, 'tombstone.schema.json exists and parses');
  ok(!!tombstone && tombstone.$id === 'https://idauto.org/protocol/0.1.0/tombstone.schema.json',
    'tombstone.schema.json $id matches house convention');
  ok(!!tombstone && tombstone.$schema === 'https://json-schema.org/draft/2020-12/schema',
    'tombstone.schema.json $schema matches house convention (draft 2020-12)');
  ok(!!tombstone && !!tombstone.properties && !!tombstone.properties.provenance &&
     tombstone.properties.provenance.$ref === 'https://idauto.org/protocol/0.1.0/provenance-envelope.schema.json',
    'tombstone.schema.json requires the provenance envelope');
  ok(!!tombstone && tombstone.required.indexOf('provenance') !== -1, 'tombstone.required includes provenance');

  // House metadata convention check across every schema in the
  // directory (not just the two new ones), so a future addition that
  // drifts from the convention is caught here too.
  files.forEach(function (f) {
    var d = parsed[f];
    if (!d) return;
    ok(d.$schema === 'https://json-schema.org/draft/2020-12/schema', f + ': $schema matches house convention');
    ok(typeof d.$id === 'string' && d.$id.indexOf('https://idauto.org/protocol/0.1.0/') === 0, f + ': $id under the house namespace');
  });
})();

console.log('\n3. reference/passport-assembly.js — synthetic fixtures');
(function () {
  var testIvid = ivid.generate();
  var vehicle = {
    protocol_version: '0.1.0-draft',
    ivid: testIvid,
    status: 'verified',
    created_at: '2026-01-01T00:00:00.000Z'
  };
  var now = new Date('2026-08-19T12:00:00.000Z');

  var publicFact = {
    protocol_version: '0.1.0-draft', id: 'fact-public-1', subject_ivid: testIvid,
    fact_key: 'colour', fact_value: 'blue', is_active: true,
    provenance: { source: 'manual_admin', asserted_at: '2026-01-02T00:00:00.000Z', confidence: 1, verification_status: 'verified', trust_level: 'T1', access_scope: 'public' }
  };
  var professionalFact = {
    protocol_version: '0.1.0-draft', id: 'fact-pro-1', subject_ivid: testIvid,
    fact_key: 'engine_cc', fact_value: '1600', is_active: true,
    provenance: { source: 'professional_scan', asserted_at: '2026-01-02T00:00:00.000Z', confidence: 0.9, verification_status: 'verified', trust_level: 'T2', access_scope: 'professional' }
  };
  var restrictedFact = {
    protocol_version: '0.1.0-draft', id: 'fact-restricted-1', subject_ivid: testIvid,
    fact_key: 'vin', fact_value: 'SECRETVIN123', is_active: true,
    provenance: { source: 'manual_admin', asserted_at: '2026-01-02T00:00:00.000Z', confidence: 1, verification_status: 'verified', trust_level: 'T1', access_scope: 'restricted' }
  };
  var mixedFacts = [publicFact, professionalFact, restrictedFact];
  ok(mixedFacts.length === 3, 'precondition: mixed-scope fixture has 3 facts');

  var trustAssessments = [
    { protocol_version: '0.1.0-draft', subject_ref: 'fact-public-1', level: 'T1', anchoring_state: 'not_anchored', assessed_at: '2026-01-02T00:00:00.000Z', rationale: { basis: 'evidence_attached' } },
    { protocol_version: '0.1.0-draft', subject_ref: 'fact-pro-1', level: 'T2', anchoring_state: 'anchored', assessed_at: '2026-01-02T00:00:00.000Z', rationale: { basis: 'professional_issuer_direct_handling' } },
    { protocol_version: '0.1.0-draft', subject_ref: 'fact-restricted-1', level: 'T1', anchoring_state: 'not_anchored', assessed_at: '2026-01-02T00:00:00.000Z', rationale: { basis: 'evidence_attached' } }
  ];

  var publicPassport = passportAssembly.assemblePassport({
    vehicle: vehicle, facts: mixedFacts, trustAssessments: trustAssessments, scope: 'public', now: now
  });
  var publicFactIds = publicPassport.facts.map(function (f) { return f.id; });
  ok(publicFactIds.indexOf('fact-restricted-1') === -1, 'public scope: restricted fact is ABSENT from public output');
  ok(publicFactIds.indexOf('fact-pro-1') === -1, 'public scope: professional fact is ABSENT from public output');
  ok(publicFactIds.indexOf('fact-public-1') !== -1, 'public scope: public fact IS present in public output');

  var privatePassport = passportAssembly.assemblePassport({
    vehicle: vehicle, facts: mixedFacts, trustAssessments: trustAssessments, scope: 'mythos_private', now: now
  });
  var privateFactIds = privatePassport.facts.map(function (f) { return f.id; });
  ok(privateFactIds.indexOf('fact-restricted-1') !== -1, 'mythos_private scope: restricted fact IS PRESENT in mythos_private output');
  ok(privatePassport.scope === 'restricted', 'mythos_private input scope normalises to protocol-conformant "restricted" in output');
  ok(privateFactIds.length === 3, 'mythos_private scope: all 3 facts present');

  ok(publicPassport.trust_summary.T1 === 1, 'public passport trust_summary.T1 counts only the visible T1 fact');
  ok(publicPassport.trust_summary.T2 === 0, 'public passport trust_summary.T2 is 0 (the T2 fact is professional-scoped, not visible)');
  ok(!Object.prototype.hasOwnProperty.call(publicPassport.trust_summary, 'T4'), 'trust_summary carries no T4 key');
  ok(!Object.prototype.hasOwnProperty.call(privatePassport.trust_summary, 'T4'), 'trust_summary carries no T4 key (mythos_private passport either)');
  ok(privatePassport.trust_summary.anchored === 1, 'mythos_private trust_summary.anchored is separate and correct (1 anchored assessment)');
  ok(privatePassport.trust_summary.T0 + privatePassport.trust_summary.T1 + privatePassport.trust_summary.T2 + privatePassport.trust_summary.T3 === 3,
    'mythos_private trust_summary T0-T3 counts sum to the 3 assessed facts');

  ok(typeof publicPassport.completeness_note === 'string' && publicPassport.completeness_note.length > 0,
    'completeness_note is a non-empty string');

  ok(publicPassport.qr.payload === testIvid, 'qr.payload === the vehicle ivid exactly');
  ok(publicPassport.qr.resolves_to_scope === 'public', 'qr.resolves_to_scope is always public');
  ok(publicPassport.qr.payload.indexOf('Bearer') === -1, 'qr.payload contains no "Bearer" substring (not a bearer token)');
  var jwtShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  ok(!jwtShape.test(publicPassport.qr.payload), 'qr.payload does not match a dot-separated base64 JWT shape');

  var emptyPassport = passportAssembly.assemblePassport({
    vehicle: vehicle, facts: [], scope: 'public', now: now
  });
  ok(typeof emptyPassport.completeness_note === 'string' && emptyPassport.completeness_note.length > 0,
    'vacuity guard: assembling with an empty facts list still yields a non-empty completeness_note');
  ok(emptyPassport.facts.length === 0, 'vacuity guard: empty facts list produces an empty (not fabricated) facts array');
  ok(emptyPassport.qr.payload === testIvid, 'vacuity guard: qr.payload is still correct with no facts');

  var threwOnMissingNow = false;
  try { passportAssembly.assemblePassport({ vehicle: vehicle, facts: [], scope: 'public' }); }
  catch (e) { threwOnMissingNow = true; }
  ok(threwOnMissingNow, 'assemblePassport throws when now is not supplied (no internal clock fallback)');

  var threwOnBadScope = false;
  try { passportAssembly.assemblePassport({ vehicle: vehicle, facts: [], scope: 'nonsense', now: now }); }
  catch (e) { threwOnBadScope = true; }
  ok(threwOnBadScope, 'assemblePassport throws on an unrecognised scope value');
})();

console.log('\n4. database/migrations/ivid-migration-dry-run.js');
(function () {
  var report = dryRunLib.dryRun(50);
  ok(report.ok === true, 'in-process dry run with 50 synthetic rows reports ok');
  ok(report.row_count === 50, 'report row_count matches the requested 50');
  ok(report.invariants.checks.length >= 4, 'precondition: invariants report includes multiple checks (found ' + report.invariants.checks.length + ')');
  ok(report.invariants.checks.every(function (c) { return c.ok; }), 'every individual invariant check passes');
  ok(report.idempotency.ok === true, 'idempotency check passes (re-run reassigns nothing)');

  var childEnv = {};
  Object.keys(process.env).forEach(function (k) { childEnv[k] = process.env[k]; });
  childEnv.IDAUTO_DB_HOST = 'fake-host-should-cause-refusal';
  var scriptPath = path.join(BASE, 'database', 'migrations', 'ivid-migration-dry-run.js');
  var result = childProcess.spawnSync(process.execPath, [scriptPath, '10'], { env: childEnv, encoding: 'utf8' });
  ok(result.status === 3, 'child invocation with a fake IDAUTO_DB_HOST set exits with code 3 (REFUSED), got ' + result.status);
  ok((result.stderr || '').indexOf('REFUSED') !== -1, 'child invocation writes REFUSED to stderr when a live-DB env var is set');
  ok((result.stdout || '').length === 0, 'child invocation performs no work (empty stdout) when refused');
})();

console.log('\nIDA4-FOUNDATION: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
