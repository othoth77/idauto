'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4-FOUNDATION — IVID migration DRY RUN
// database/migrations/ivid-migration-dry-run.js
//
// DRY RUN ONLY. This script takes NO database connection of any kind. It
// generates N synthetic rows entirely in memory, runs the planned
// internal_ref -> IVID transformation described in
// docs/IVID_MIGRATION_PLAN.md against them, verifies the invariants that
// plan requires, and prints a report. It never reads, writes, or connects
// to database/schema.sql's live idauto_vehicles table, and it never will
// by construction: see the refusal guard immediately below.
//
// REFUSAL GUARD (belt-and-braces, asserted here in the header and
// enforced in code): this script REFUSES to run — exits 3, writes
// "REFUSED" to stderr, and performs no work at all — if ANY of the five
// IDAUTO_DB_* environment variables the live runtime and every real
// migration read (reference/db.js: IDAUTO_DB_HOST, IDAUTO_DB_PORT,
// IDAUTO_DB_USER, IDAUTO_DB_PASSWORD, IDAUTO_DB_NAME) is set in
// process.env, even though this script never reads any of them to
// connect to anything. The point of the guard is not "this script
// currently has no DB code" — code can rot — it is "this script proves,
// every time it runs, that it is not being invoked in an environment
// wired for a live database," which is the property
// docs/IVID_MIGRATION_PLAN.md's "PLAN ONLY — NOT EXECUTED" marking
// depends on staying true.
//
// Run standalone: node database/migrations/ivid-migration-dry-run.js [N]
// (N defaults to 200.) Or require() it in-process — see
// tests/ida4-foundation-test.js, which does both: an in-process run with
// 50 rows, and a REFUSED child-process run with a fake IDAUTO_DB_HOST set.
// =====================================================

var path = require('path');
var crypto = require('crypto');
var ivid = require(path.join(__dirname, '..', '..', 'reference', 'ivid.js'));

var DB_ENV_VARS = ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD', 'IDAUTO_DB_NAME'];
var INTERNAL_REF_MAX_LEN = 40; // idauto_vehicles.internal_ref VARCHAR(40)

// Throws a refusal Error (with .refused = true, mirroring
// ops/offhost-backup.js's refusal convention) if any live-DB env var is
// set. Callers that want a non-throwing check use envGuardViolations()
// directly.
function envGuardViolations() {
  return DB_ENV_VARS.filter(function (name) {
    return Object.prototype.hasOwnProperty.call(process.env, name) && process.env[name] !== undefined;
  });
}

function assertNoLiveDbEnv() {
  var violations = envGuardViolations();
  if (violations.length > 0) {
    var err = new Error(
      'REFUSED: this is a DRY-RUN-ONLY script and must never run in an environment ' +
      'wired for a live database. Found set: ' + violations.join(', ') + '. Unset ' +
      'these variables (they belong to reference/db.js\'s live connection contract, ' +
      'not to this script) and re-run.'
    );
    err.refused = true;
    throw err;
  }
}

// ---------------------------------------------------------------------
// Synthetic data generation
// ---------------------------------------------------------------------

// Generates N synthetic legacy rows shaped like today's
// idauto_vehicles(id, internal_ref) rows. A fraction of rows (~10%,
// deterministic given a seeded id) are modelled as ALREADY migrated —
// internal_ref already holds a well-formed IVID — to exercise the
// idempotent-re-run invariant honestly, rather than only ever testing
// the all-legacy case.
function generateSyntheticRows(n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('generateSyntheticRows: n must be a positive integer');
  }
  var rows = [];
  for (var i = 0; i < n; i++) {
    var alreadyMigrated = i % 10 === 0; // every 10th row simulates a prior partial run
    var legacyRef = 'IDA-' + String(i + 1).padStart(8, '0'); // deployment-local reference format today
    rows.push({
      id: i + 1,
      internal_ref: alreadyMigrated ? ivid.generate() : legacyRef
    });
  }
  return rows;
}

// ---------------------------------------------------------------------
// The planned transformation
// ---------------------------------------------------------------------

// Applies the planned migration to one in-memory row set, returning a
// NEW array (never mutates the input, so idempotency can be tested by
// comparing two independent runs). A row whose internal_ref already
// validates as a well-formed IVID is left untouched (idempotent /
// backfill-safe); every other row is assigned a freshly generated IVID,
// with in-batch collision avoidance (retried, bounded) since this
// dry run has no database unique constraint to lean on.
function runMigration(rows, opts) {
  opts = opts || {};
  var maxRetries = opts.maxRetries || 10;
  var seen = Object.create(null);
  rows.forEach(function (r) {
    if (typeof r.internal_ref === 'string' && ivid.validate(r.internal_ref).ok) {
      seen[r.internal_ref] = true;
    }
  });

  return rows.map(function (r) {
    if (typeof r.internal_ref === 'string' && ivid.validate(r.internal_ref).ok) {
      // Already migrated in a prior (real) run — left untouched. This is
      // the idempotency property: re-running the migration must never
      // reassign an IVID a row already has.
      return { id: r.id, internal_ref: r.internal_ref, migrated_this_run: false };
    }
    var candidate;
    var attempts = 0;
    do {
      candidate = ivid.generate();
      attempts += 1;
    } while (seen[candidate] && attempts < maxRetries);
    if (seen[candidate]) {
      throw new Error('runMigration: exhausted ' + maxRetries + ' collision-avoidance retries for row id ' + r.id);
    }
    seen[candidate] = true;
    return { id: r.id, internal_ref: candidate, migrated_this_run: true, legacy_ref: r.internal_ref };
  });
}

// ---------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------

// Returns { ok, checks: [{ name, ok, detail }] } — never throws for a
// failed invariant, so a caller (or the report printer) can see every
// check's result, not just the first failure.
function verifyInvariants(migratedRows) {
  var checks = [];

  var refs = migratedRows.map(function (r) { return r.internal_ref; });
  var uniqueCount = new Set(refs).size;
  checks.push({
    name: 'uniqueness',
    ok: uniqueCount === refs.length,
    detail: uniqueCount + ' unique of ' + refs.length + ' rows'
  });

  var allValid = migratedRows.every(function (r) { return ivid.validate(r.internal_ref).ok; });
  var invalidCount = migratedRows.filter(function (r) { return !ivid.validate(r.internal_ref).ok; }).length;
  checks.push({
    name: 'format_validity',
    ok: allValid,
    detail: invalidCount + ' invalid of ' + refs.length + ' rows'
  });

  var oversize = migratedRows.filter(function (r) { return Buffer.byteLength(r.internal_ref, 'utf8') > INTERNAL_REF_MAX_LEN; });
  checks.push({
    name: 'varchar_40_fit',
    ok: oversize.length === 0,
    detail: oversize.length + ' row(s) exceed VARCHAR(' + INTERNAL_REF_MAX_LEN + ')'
  });

  checks.push({
    name: 'no_i_l_o_u_in_output',
    ok: refs.every(function (r) { return !/[ILOU]/.test(r); }),
    detail: 'Crockford-excluded letters I/L/O/U never appear in generated IVIDs'
  });

  var ok = checks.every(function (c) { return c.ok; });
  return { ok: ok, checks: checks };
}

// Re-runs the migration on the OUTPUT of a first run and asserts the
// result is byte-identical — the concrete idempotency check, not just
// an argument that it should be. Every row already valid after run 1
// (all of them, if run 1 succeeded) must be left untouched by run 2.
function verifyIdempotent(rowsAfterFirstRun) {
  var legacyShapedAgain = rowsAfterFirstRun.map(function (r) {
    return { id: r.id, internal_ref: r.internal_ref };
  });
  var secondRun = runMigration(legacyShapedAgain);
  var anyReassigned = secondRun.some(function (r) { return r.migrated_this_run; });
  var sameRefs = secondRun.every(function (r, i) { return r.internal_ref === rowsAfterFirstRun[i].internal_ref; });
  return {
    ok: !anyReassigned && sameRefs,
    detail: anyReassigned ? 'a second run reassigned at least one IVID (NOT idempotent)' : 'second run reassigned nothing; all internal_ref values unchanged'
  };
}

// ---------------------------------------------------------------------
// Orchestration + report
// ---------------------------------------------------------------------

// Runs the full dry run in-process: env guard, synthetic generation,
// migration, invariant checks, idempotency check. Returns a report
// object; never touches process.exit or process.env writes itself, so
// it is safe to call directly from a test.
function dryRun(n, opts) {
  assertNoLiveDbEnv();
  opts = opts || {};
  var rowCount = n || 200;
  var syntheticRows = generateSyntheticRows(rowCount);
  var alreadyMigratedCount = syntheticRows.filter(function (r) { return ivid.validate(r.internal_ref).ok; }).length;

  var migrated = runMigration(syntheticRows, opts);
  var invariants = verifyInvariants(migrated);
  var idempotency = verifyIdempotent(migrated);

  var report = {
    row_count: rowCount,
    already_migrated_synthetic: alreadyMigratedCount,
    newly_migrated: migrated.filter(function (r) { return r.migrated_this_run; }).length,
    invariants: invariants,
    idempotency: idempotency,
    ok: invariants.ok && idempotency.ok,
    sample: migrated.slice(0, 3)
  };
  return report;
}

function formatReport(report) {
  var lines = [];
  lines.push('IVID migration DRY RUN report (no database touched)');
  lines.push('  rows:                 ' + report.row_count);
  lines.push('  already migrated:     ' + report.already_migrated_synthetic + ' (synthetic — modelled as pre-existing IVIDs)');
  lines.push('  newly migrated:       ' + report.newly_migrated);
  lines.push('  invariants:');
  report.invariants.checks.forEach(function (c) {
    lines.push('    [' + (c.ok ? 'OK  ' : 'FAIL') + '] ' + c.name + ' — ' + c.detail);
  });
  lines.push('  idempotency:          ' + (report.idempotency.ok ? 'OK' : 'FAIL') + ' — ' + report.idempotency.detail);
  lines.push('  overall:              ' + (report.ok ? 'OK' : 'FAIL'));
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------

function main() {
  try {
    assertNoLiveDbEnv();
  } catch (e) {
    process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
    process.exitCode = 3;
    return;
  }
  var n = parseInt(process.argv[2], 10);
  if (!Number.isInteger(n) || n <= 0) n = 200;
  var report = dryRun(n);
  process.stdout.write(formatReport(report) + '\n');
  process.exitCode = report.ok ? 0 : 2;
}

if (require.main === module) {
  main();
}

module.exports = {
  DB_ENV_VARS: DB_ENV_VARS,
  INTERNAL_REF_MAX_LEN: INTERNAL_REF_MAX_LEN,
  envGuardViolations: envGuardViolations,
  assertNoLiveDbEnv: assertNoLiveDbEnv,
  generateSyntheticRows: generateSyntheticRows,
  runMigration: runMigration,
  verifyInvariants: verifyInvariants,
  verifyIdempotent: verifyIdempotent,
  dryRun: dryRun,
  formatReport: formatReport
};
