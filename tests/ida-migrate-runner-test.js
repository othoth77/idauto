'use strict';
/* IDA-G9 — THE MIGRATION RUNNER, AGAINST REAL POSTGRESQL.
 *
 * scripts/migrate.js applied to throwaway databases this suite creates next to
 * the scratch database (all named idauto_scratch_mig_<random>_*, plus one
 * deliberately non-scratch name for the guard), and drops again at the end:
 *
 *   A. fresh database: every MANIFEST entry applied in order, recorded with its
 *      sha256; a second run applies nothing; a changed file, an unknown record
 *      and a failing migration are refused / rolled back; a new entry appended
 *      to the manifest is applied alone;
 *   B. database migrated by hand: a plain run refuses and writes nothing;
 *      --baseline records every file WITHOUT running it; the schema equals the
 *      one the runner builds;
 *   C. partially migrated by hand: --baseline adopts the applied prefix, a plain
 *      run applies the rest, same schema again;
 *   D. a database built out of order: --baseline refuses;
 *   E. an empty database: --baseline refuses (it is a fresh one);
 *   F. a database not named idauto_scratch_*: writes need --confirm-database.
 *
 * Needs CREATEDB for the connecting role (the CI service user and the
 * disposable container of ops/runbooks/TEST_RUNBOOK.md have it).
 */
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pg = require('pg');
var migrate = require(path.join(BASE, 'scripts', 'migrate.js'));

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

var required = ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD', 'IDAUTO_DB_NAME'];
var missing = required.filter(function (n) { return !process.env[n]; });
if (missing.length) { console.error('FATAL: missing required environment variable(s): ' + missing.join(', ')); process.exit(1); }

function client(database) {
  return new pg.Client({ host: process.env.IDAUTO_DB_HOST, port: parseInt(process.env.IDAUTO_DB_PORT, 10), user: process.env.IDAUTO_DB_USER,
    password: process.env.IDAUTO_DB_PASSWORD, database: database });
}
var quiet = function () {};
var TAG = crypto.randomBytes(4).toString('hex');
var created = [];
var admin;

async function newDb(suffix, name) {
  name = name || ('idauto_scratch_mig_' + TAG + '_' + suffix);
  await admin.query('CREATE DATABASE ' + name);
  created.push(name);
  var c = client(name);
  c.on('notice', function () {});
  await c.connect();
  return c;
}
// "By hand": each file sent as-is, as psql -f would (its own BEGIN/COMMIT included).
async function byHand(c, entries) { for (var i = 0; i < entries.length; i++) await c.query(entries[i].sql); }
async function rows(c) { return (await c.query('SELECT file, sha256, method FROM ' + migrate.TABLE + ' ORDER BY file')).rows; }
async function tracked(c) { return (await c.query('SELECT to_regclass($1) IS NOT NULL AS t', [migrate.TABLE])).rows[0].t; }
async function schemaShape(c) {
  var cols = (await c.query("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> $1 AND table_name NOT LIKE 'idauto\\_mig\\_%' ORDER BY 1, 2", [migrate.TABLE])).rows;
  var idx = (await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> $1 ORDER BY 1", [migrate.TABLE])).rows;
  var con = (await c.query("SELECT conname, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public' AND conrelid <> COALESCE(to_regclass($1), 0)::oid ORDER BY 1, 2", [migrate.TABLE])).rows;
  return JSON.stringify({ cols: cols, idx: idx, con: con });
}
async function refused(promise, re) {
  try { await promise; return 'not refused'; } catch (e) { return re.test(e.message) ? true : e.message; }
}

async function main() {
  var home = client(process.env.IDAUTO_DB_NAME);
  await home.connect();
  var dbName = (await home.query('SELECT current_database() d')).rows[0].d;
  await home.end();
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '" — point IDAUTO_DB_NAME at a scratch database'); process.exit(1); }
  console.log('database: ' + dbName + ' (throwaway databases tagged ' + TAG + ')');
  admin = client(dbName);
  await admin.connect();
  var entries = migrate.readManifest();
  var N = entries.length;
  var fresh, hand, partial;

  try {
    /* ================================================================= */
    say('A. A FRESH DATABASE');
    fresh = await newDb('fresh');
    var lines = [];
    var r1 = await migrate.run(fresh, { log: function (m) { lines.push(m); } });
    ok(r1.applied === N, 'every manifest entry applied (' + r1.applied + '/' + N + ')');
    var applied = lines.filter(function (l) { return /^applied /.test(l); }).map(function (l) { return l.replace(/^applied\s+/, ''); });
    ok(JSON.stringify(applied) === JSON.stringify(entries.map(function (e) { return e.file; })), 'in manifest order');
    var rec = await rows(fresh);
    ok(rec.length === N && rec.every(function (r) { var e = entries.filter(function (x) { return x.file === r.file; })[0]; return e && r.sha256 === e.sha256 && r.method === 'applied'; }),
      'each recorded with method applied and the sha256 of the file on disk');
    var r2 = await migrate.run(fresh, { log: quiet });
    ok(r2.applied === 0, 'a second run applies nothing');
    var dry = await migrate.run(fresh, { dryRun: true, log: quiet });
    ok(dry.clean === true && dry.pending === 0, '--dry-run reports the database at the manifest head');

    await fresh.query('UPDATE ' + migrate.TABLE + " SET sha256 = repeat('0', 64) WHERE file = 'migrations/ida-v10-vehicle-search.sql'");
    ok(await refused(migrate.run(fresh, { log: quiet }), /changed since they were applied: migrations\/ida-v10-vehicle-search\.sql/) === true, 'a file changed after it was applied: the run is refused');
    var dryChanged = await migrate.run(fresh, { dryRun: true, log: quiet });
    ok(dryChanged.clean === false && dryChanged.status.entries.some(function (e) { return e.state === 'CHANGED'; }), '--dry-run shows it as CHANGED (and --check would fail)');
    await fresh.query('UPDATE ' + migrate.TABLE + ' SET sha256 = $1 WHERE file = $2', [entries.filter(function (e) { return e.file === 'migrations/ida-v10-vehicle-search.sql'; })[0].sha256, 'migrations/ida-v10-vehicle-search.sql']);

    await fresh.query('INSERT INTO ' + migrate.TABLE + " (file, sha256, method) VALUES ('migrations/ida-removed.sql', repeat('a', 64), 'applied')");
    ok(await refused(migrate.run(fresh, { log: quiet }), /no longer lists: migrations\/ida-removed\.sql/) === true, 'a recorded file the manifest no longer lists: refused');
    await fresh.query('DELETE FROM ' + migrate.TABLE + " WHERE file = 'migrations/ida-removed.sql'");   // fixture row of this suite, in its throwaway database

    function extra(file, sql, probe) {
      return { file: file, sql: sql, sha256: crypto.createHash('sha256').update(sql).digest('hex'), probes: [migrate.parseProbe(probe)] };
    }
    var bad = extra('migrations/zz-failing.sql', 'CREATE TABLE idauto_mig_should_vanish (id INT);\nSELECT 1 / 0;\n', 'table idauto_mig_should_vanish');
    var threw = await refused(migrate.run(fresh, { entries: entries.concat([bad]), log: quiet }), /zz-failing\.sql: division by zero .*rolled back/);
    ok(threw === true, 'a failing migration throws, naming the file (' + threw + ')');
    ok(!(await fresh.query("SELECT to_regclass('idauto_mig_should_vanish') IS NOT NULL AS t")).rows[0].t && (await rows(fresh)).length === N, '... and nothing of it is kept: no table, no record');
    var good = extra('migrations/zz-appended.sql', 'BEGIN;\nCREATE TABLE idauto_mig_appended (id INT);\nCOMMIT;\n', 'table idauto_mig_appended');
    var r3 = await migrate.run(fresh, { entries: entries.concat([good]), log: quiet });
    ok(r3.applied === 1 && (await fresh.query("SELECT to_regclass('idauto_mig_appended') IS NOT NULL AS t")).rows[0].t, 'an entry appended to the manifest is applied alone (its own BEGIN;/COMMIT; inside the runner\'s transaction)');
    var midInsert = entries.slice(0, 5).concat([extra('migrations/zz-inserted.sql', 'SELECT 1;', 'table idauto_vehicles')]).concat(entries.slice(5)).concat([good]);
    ok(await refused(migrate.run(fresh, { entries: midInsert, log: quiet }), /sit before an applied one: migrations\/zz-inserted\.sql/) === true, 'an entry inserted in the middle of the manifest is refused (append only)');
    ok(await refused(migrate.run(fresh, { baseline: true, log: quiet }), /already records/) === true, '--baseline on a tracked database is refused');

    /* ================================================================= */
    say('B. A DATABASE MIGRATED BY HAND');
    hand = await newDb('hand');
    await byHand(hand, entries);
    await hand.query("COMMENT ON COLUMN idauto_auth_account.\"issuer\" IS 'sentinel: set after the hand migration'");
    var plain = await refused(migrate.run(hand, { log: quiet }), /already has the IDauto schema but no migration record/);
    ok(plain === true, 'a plain run refuses: schema present, nothing recorded (' + plain + ')');
    ok(!(await tracked(hand)), '... and writes nothing, not even its table');
    var dryHand = await migrate.run(hand, { dryRun: true, baseline: true, log: quiet });
    ok(dryHand.status.entries.every(function (e) { return e.state === 'pending' && e.present; }), '--dry-run: every entry pending, every probe present');
    ok(!(await tracked(hand)), '--baseline --dry-run writes nothing');
    var b = await migrate.run(hand, { baseline: true, log: quiet });
    ok(b.baseline === N && b.pending === 0, '--baseline records all ' + N + ' entries');
    var recHand = await rows(hand);
    ok(recHand.length === N && recHand.every(function (r) { return r.method === 'baseline'; }), '... with method baseline and the current sha256');
    var comment = (await hand.query("SELECT col_description('idauto_auth_account'::regclass, a.attnum) AS c FROM pg_attribute a WHERE a.attrelid = 'idauto_auth_account'::regclass AND a.attname = 'issuer'")).rows[0].c;
    ok(/^sentinel/.test(comment || ''), 'nothing was run: ida-v13b would have reset the sentinel comment');
    ok((await migrate.run(hand, { log: quiet })).applied === 0, 'after the baseline a plain run has nothing to apply');
    ok(await schemaShape(hand) === await schemaShape(fresh), 'the hand-built schema equals the runner-built one (columns, indexes, constraints)');

    /* ================================================================= */
    say('C. PARTIALLY MIGRATED BY HAND');
    partial = await newDb('partial');
    var K = 10;
    await byHand(partial, entries.slice(0, K));
    var bp = await migrate.run(partial, { baseline: true, log: quiet });
    ok(bp.baseline === K && bp.pending === N - K, '--baseline adopts the ' + K + ' applied entries and leaves ' + (N - K) + ' pending');
    var rp = await migrate.run(partial, { log: quiet });
    ok(rp.applied === N - K, 'a plain run applies the rest');
    var recP = await rows(partial);
    ok(recP.filter(function (r) { return r.method === 'baseline'; }).length === K && recP.filter(function (r) { return r.method === 'applied'; }).length === N - K, 'the record tells adopted from applied');
    ok(await schemaShape(partial) === await schemaShape(fresh), 'same schema as the runner-built one');
    await partial.end(); partial = null;

    /* ================================================================= */
    say('D. BUILT OUT OF ORDER');
    var gap = await newDb('gap');
    var skipped = 'migrations/ida-u4b-vin-lookup-index.sql';
    await byHand(gap, entries.filter(function (e) { return e.file !== skipped; }));
    var g = await refused(migrate.run(gap, { baseline: true, log: quiet }), /ida-u4b-vin-lookup-index\.sql absent but .*present/);
    ok(g === true, '--baseline refuses when an absent entry precedes present ones (' + g + ')');
    ok(!(await tracked(gap)), '... and records nothing');
    await gap.end();

    /* ================================================================= */
    say('E. AN EMPTY DATABASE');
    var empty = await newDb('empty');
    ok(await refused(migrate.run(empty, { baseline: true, log: quiet }), /schema\.sql probes absent/) === true, '--baseline refuses on an empty database (use a plain run)');
    await empty.end();

    /* ================================================================= */
    say('F. NOT A SCRATCH DATABASE');
    var guardName = 'idauto_migguard_' + TAG;
    var guard = await newDb(null, guardName);
    ok(await refused(migrate.run(guard, { log: quiet }), /needs --confirm-database=idauto_migguard_/) === true, 'a write without --confirm-database is refused');
    ok(await refused(migrate.run(guard, { log: quiet, confirmDatabase: 'idauto_production' }), /needs --confirm-database/) === true, 'a confirmation naming another database is refused');
    ok(!(await tracked(guard)), '... and nothing was written');
    ok((await migrate.run(guard, { dryRun: true, log: quiet })).pending === N, '--dry-run needs no confirmation');
    ok((await migrate.run(guard, { log: quiet, confirmDatabase: guardName })).applied === N, 'with --confirm-database=<its name> the run proceeds');
    await guard.end();
  } finally {
    for (var c of [fresh, hand, partial]) { if (c) { try { await c.end(); } catch (_) {} } }
    for (var i = 0; i < created.length; i++) {
      // Only the databases this run created (unique tag); never anything else.
      try { await admin.query('DROP DATABASE IF EXISTS ' + created[i]); } catch (e) { console.log('  note: could not drop ' + created[i] + ': ' + e.message); }
    }
    await admin.end();
  }
  console.log('\nIDA-MIGRATE-RUNNER: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) { console.error('FATAL: ' + (err && err.stack || err)); console.log('\nIDA-MIGRATE-RUNNER: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
