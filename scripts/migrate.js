#!/usr/bin/env node
'use strict';
/* IDauto migration runner (IDA-G9, 2026-11-25).
 *
 *   npm run migrate                       apply every pending file of database/migrations/MANIFEST
 *   npm run migrate -- --dry-run          list each file and its state; writes nothing
 *   npm run migrate -- --dry-run --check  ... and exit 1 when anything is pending or changed
 *   npm run migrate -- --baseline         adopt a database migrated by hand (see below)
 *
 * Connection: the IDAUTO_DB_* variables the application reads (reference/db.js).
 *
 * WHAT IT DOES. Reads the manifest (the one ordering, see its header), applies
 * the files not yet recorded, in manifest order, each in its own transaction
 * together with its row in `idauto_schema_migrations` (file, sha256, method,
 * applied_at, applied_by). It refuses to run when a recorded file has changed
 * since it was applied (sha256), the same convention as othoth77/contact and
 * othoth77/CMF scripts/migrate.js: a change to the schema is a NEW file.
 *
 * A DATABASE MIGRATED BY HAND (every database before this runner existed).
 * Its schema is there but nothing records it. The runner detects that — the
 * manifest's first entry (schema.sql) probes present while the record is empty
 * — and refuses to apply anything. `--baseline` then evaluates each manifest
 * entry's probe (read-only catalogue checks) and records the entries that are
 * present, with method 'baseline' and today's checksum, WITHOUT RUNNING THEM.
 * It refuses when the present entries are not a prefix of the manifest (an
 * earlier file absent while a later one is present): that database was built
 * in another order and needs a person to look at it. Entries after the prefix
 * stay pending and the next plain run applies them. `--baseline --dry-run`
 * shows what would be recorded. docs/DATABASE.md §1a is the procedure.
 *
 * WHAT IT NEVER DOES. It issues no DROP, TRUNCATE or DELETE of its own; the
 * only SQL it runs besides the migration files is the creation of, and inserts
 * into, its own table, plus read-only catalogue probes. It never restarts the
 * application (the deploy-order hazard of docs/DEPLOYMENT.md §9 is the
 * operator's: run this BEFORE starting new code). It writes to a database whose
 * name does not start with `idauto_scratch_` only when `--confirm-database=<name>`
 * names that database — the guard against the wrong-database mistake recorded in
 * docs/DEPLOYMENT.md §8. Running it against production is the owner's action.
 *
 * TRANSACTIONS. Two historical files (ida-3a, ida4-option-c) carry their own
 * `BEGIN;` / `COMMIT;` lines. Inside the runner's transaction those lines would
 * commit early and leave the record row outside the transaction, so a file's
 * single top-level `BEGIN;` and `COMMIT;` lines are left out when it is executed
 * (the checksum is always of the file as it is on disk). A file with any other
 * transaction control, a psql meta-command or CONCURRENTLY is refused: it cannot
 * be applied atomically.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var DATABASE_DIR = path.join(__dirname, '..', 'database');
var MIGRATIONS_DIR = path.join(DATABASE_DIR, 'migrations');
var MANIFEST_PATH = path.join(MIGRATIONS_DIR, 'MANIFEST');
var TABLE = 'idauto_schema_migrations';
var LOCK_KEY = 4952061377;   // pg_advisory_lock key; any constant unique to this runner
var SCRATCH = /^idauto_scratch_/;

var PROBE_RE = /^(table|index)\s+([a-z_][a-z0-9_]*)$|^(column|nullable)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$|^constraint\s+([a-z_][a-z0-9_]*)(?:\s+has\s+([A-Za-z0-9_ ]+))?$/;

function parseProbe(text) {
  var m = PROBE_RE.exec(text.trim());
  if (!m) throw new Error('unreadable probe "' + text + '"');
  if (m[1]) return { kind: m[1], name: m[2], text: text.trim() };
  if (m[3]) return { kind: m[3], table: m[4], column: m[5], text: text.trim() };
  return { kind: 'constraint', name: m[6], has: m[7] ? m[7].trim() : null, text: text.trim() };
}

/* The manifest, validated against the directory. Throws on any disagreement:
 * an unlisted .sql file would otherwise never be applied anywhere. */
function readManifest(manifestPath) {
  manifestPath = manifestPath || MANIFEST_PATH;
  var lines = fs.readFileSync(manifestPath, 'utf8').split('\n');
  var entries = [], seen = {};
  lines.forEach(function (raw, i) {
    var line = raw.replace(/\s+$/, '');
    if (!line || /^\s*#/.test(line)) return;
    var m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) throw new Error('MANIFEST line ' + (i + 1) + ': expected "<file>  <probe>[, <probe>]"');
    var file = m[1];
    if (!/^(schema\.sql|migrations\/[a-z0-9][a-z0-9._-]*\.sql)$/.test(file)) throw new Error('MANIFEST line ' + (i + 1) + ': "' + file + '" is not schema.sql or migrations/<name>.sql');
    if (seen[file]) throw new Error('MANIFEST line ' + (i + 1) + ': ' + file + ' is listed twice');
    seen[file] = true;
    var probes = m[2].split(',').map(function (p) { return parseProbe(p); });
    entries.push({ file: file, probes: probes, line: i + 1 });
  });
  if (!entries.length) throw new Error('MANIFEST lists no file');
  if (entries[0].file !== 'schema.sql') throw new Error('MANIFEST must start with schema.sql');
  var dir = path.dirname(manifestPath);
  var base = path.dirname(dir);
  entries.forEach(function (e) {
    if (!fs.existsSync(path.join(base, e.file))) throw new Error('MANIFEST names ' + e.file + ', which does not exist');
  });
  fs.readdirSync(dir).filter(function (f) { return /\.sql$/.test(f); }).forEach(function (f) {
    if (!seen['migrations/' + f]) throw new Error('database/migrations/' + f + ' is not in the MANIFEST — it would never be applied');
  });
  entries.forEach(function (e) {
    e.sql = fs.readFileSync(path.join(base, e.file), 'utf8');
    e.sha256 = crypto.createHash('sha256').update(e.sql).digest('hex');
  });
  return entries;
}

/* The SQL actually executed for a file: its single top-level BEGIN;/COMMIT;
 * lines removed (see the header), anything that cannot run atomically refused. */
function executableSql(file, sql) {
  var lines = sql.split('\n');
  var begins = [], commits = [];
  lines.forEach(function (l, i) {
    if (/^\s*BEGIN\s*;\s*(--.*)?$/i.test(l)) begins.push(i);
    if (/^\s*COMMIT\s*;\s*(--.*)?$/i.test(l)) commits.push(i);
  });
  var code = lines.map(function (l) { return l.replace(/--.*$/, ''); }).join('\n');
  var problems = [];
  if (begins.length > 1 || commits.length > 1 || begins.length !== commits.length || (begins.length && begins[0] > commits[0])) problems.push('more than one top-level BEGIN;/COMMIT; pair');
  if (/^\s*\\/m.test(code)) problems.push('a psql meta-command');
  if (/\bCONCURRENTLY\b/i.test(code)) problems.push('CONCURRENTLY');
  if (/^\s*(ROLLBACK|START\s+TRANSACTION|SAVEPOINT|END\s*;|VACUUM)\b/im.test(code)) problems.push('transaction control the runner cannot wrap');
  if (problems.length) throw new Error(file + ' cannot be applied atomically: ' + problems.join(', '));
  return lines.filter(function (_, i) { return begins.indexOf(i) === -1 && commits.indexOf(i) === -1; }).join('\n');
}

async function probeHolds(client, p) {
  var q;
  if (p.kind === 'table' || p.kind === 'index') {
    q = await client.query(
      'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace ' +
      'WHERE n.nspname = current_schema() AND c.relname = $1 AND c.relkind = ANY($2)) AS ok',
      [p.name, p.kind === 'table' ? ['r', 'p'] : ['i', 'I']]);
  } else if (p.kind === 'column' || p.kind === 'nullable') {
    q = await client.query(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() ' +
      'AND table_name = $1 AND column_name = $2' + (p.kind === 'nullable' ? " AND is_nullable = 'YES'" : '') + ') AS ok',
      [p.table, p.column]);
  } else {
    q = await client.query(
      'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid = k.connamespace ' +
      'WHERE n.nspname = current_schema() AND k.conname = $1 AND ($2::text IS NULL OR strpos(pg_catalog.pg_get_constraintdef(k.oid), $2::text) > 0)) AS ok',
      [p.name, p.has]);
  }
  return q.rows[0].ok === true;
}

async function entryPresent(client, entry) {
  for (var i = 0; i < entry.probes.length; i++) if (!(await probeHolds(client, entry.probes[i]))) return false;
  return true;
}

async function recorded(client) {
  var exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [TABLE])).rows[0].ok;
  if (!exists) return { exists: false, rows: {} };
  var rows = {};
  (await client.query('SELECT file, sha256, method, applied_at FROM ' + TABLE + ' ORDER BY applied_at, file')).rows
    .forEach(function (r) { rows[r.file] = r; });
  return { exists: true, rows: rows };
}

async function ensureTable(client) {
  await client.query(
    'CREATE TABLE IF NOT EXISTS ' + TABLE + ' (' +
    ' file       TEXT        PRIMARY KEY,' +
    ' sha256     CHAR(64)    NOT NULL,' +
    " method     VARCHAR(16) NOT NULL CHECK (method IN ('applied', 'baseline'))," +
    ' applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),' +
    ' applied_by TEXT        NOT NULL DEFAULT current_user)');
  await client.query("COMMENT ON TABLE " + TABLE + " IS 'IDA-G9. One row per database/migrations/MANIFEST entry applied (or adopted by --baseline) by scripts/migrate.js; sha256 of the file as applied.'");
}

/* State of every manifest entry, read-only. */
async function status(client, entries) {
  var rec = await recorded(client);
  var out = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i], r = rec.rows[e.file];
    var state = !r ? 'pending' : (r.sha256 === e.sha256 ? r.method : 'CHANGED');
    out.push({ file: e.file, state: state, present: await entryPresent(client, e) });
  }
  var unknown = Object.keys(rec.rows).filter(function (f) { return !entries.some(function (e) { return e.file === f; }); });
  return { tracked: rec.exists, count: Object.keys(rec.rows).length, entries: out, unknown: unknown };
}

function refuse(msg) { var e = new Error(msg); e.refusal = true; throw e; }

function checkConsistent(st) {
  var changed = st.entries.filter(function (e) { return e.state === 'CHANGED'; });
  if (changed.length) refuse('applied migration(s) changed since they were applied: ' + changed.map(function (e) { return e.file; }).join(', ') + ' — restore the file and add a NEW migration instead');
  if (st.unknown.length) refuse('the database records file(s) the MANIFEST no longer lists: ' + st.unknown.join(', '));
  var lastDone = -1;
  st.entries.forEach(function (e, i) { if (e.state !== 'pending') lastDone = i; });
  var holes = st.entries.slice(0, lastDone + 1).filter(function (e) { return e.state === 'pending'; });
  if (holes.length) refuse('pending migration(s) sit before an applied one: ' + holes.map(function (e) { return e.file; }).join(', ') + ' — new migrations are appended at the END of the MANIFEST');
}

function guardWrite(dbName, opts) {
  if (SCRATCH.test(dbName)) return;
  if (opts.confirmDatabase !== dbName) {
    refuse('database "' + dbName + '" is not a scratch database (idauto_scratch_*); writing to it needs --confirm-database=' + dbName +
      ' — check SELECT current_database() first (docs/DEPLOYMENT.md §8)');
  }
}

async function run(client, opts) {
  opts = opts || {};
  var log = opts.log || function (m) { process.stdout.write(m + '\n'); };
  var entries = opts.entries || readManifest(opts.manifestPath);
  entries.forEach(function (e) { e.exec = executableSql(e.file, e.sql); });
  var dbName = (await client.query('SELECT current_database() AS d')).rows[0].d;
  log('database: ' + dbName + ' · manifest: ' + entries.length + ' file(s)');

  if (opts.dryRun) {
    await client.query('BEGIN READ ONLY');
    try {
      var st = await status(client, entries);
      st.entries.forEach(function (e) {
        log('  ' + (e.state + '          ').slice(0, 10) + ' ' + e.file + (e.state === 'pending' ? '  (probe: ' + (e.present ? 'present' : 'absent') + ')' : ''));
      });
      if (st.unknown.length) log('  UNKNOWN    recorded but not in the MANIFEST: ' + st.unknown.join(', '));
      var pending = st.entries.filter(function (e) { return e.state === 'pending'; });
      if (opts.baseline) {
        var plan = baselinePlan(st);
        log(plan.error ? 'baseline would be refused: ' + plan.error : 'baseline would record ' + plan.adopt.length + ' file(s) without running them; ' + plan.rest.length + ' would stay pending');
      } else if (!st.count && st.entries[0].present) {
        log('this database has the IDauto schema but no migration record: adopt it with --baseline (docs/DATABASE.md §1a)');
      }
      log(pending.length + ' pending, ' + st.entries.filter(function (e) { return e.state === 'CHANGED'; }).length + ' changed');
      return { dryRun: true, status: st, pending: pending.length,
        clean: !pending.length && !st.unknown.length && !st.entries.some(function (e) { return e.state === 'CHANGED'; }) };
    } finally { await client.query('ROLLBACK'); }
  }

  guardWrite(dbName, opts);
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    if (opts.baseline) return await doBaseline(client, entries, log);
    return await doApply(client, entries, log);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

function baselinePlan(st) {
  if (st.count) return { error: 'the database already records ' + st.count + ' migration(s); --baseline is only for an untracked database' };
  var firstAbsent = st.entries.findIndex(function (e) { return !e.present; });
  var adopt = firstAbsent === -1 ? st.entries : st.entries.slice(0, firstAbsent);
  var rest = firstAbsent === -1 ? [] : st.entries.slice(firstAbsent);
  if (!adopt.length) return { error: 'schema.sql probes absent: this is not a hand-migrated IDauto database (a fresh one needs a plain run, without --baseline)' };
  var outOfOrder = rest.filter(function (e) { return e.present; });
  if (outOfOrder.length) {
    return { error: 'present file(s) after an absent one — ' + rest.filter(function (e) { return !e.present; }).map(function (e) { return e.file; }).join(', ') +
      ' absent but ' + outOfOrder.map(function (e) { return e.file; }).join(', ') + ' present; this database was not built in MANIFEST order and needs a person to look at it' };
  }
  return { adopt: adopt, rest: rest };
}

async function doBaseline(client, entries, log) {
  var st = await status(client, entries);
  var plan = baselinePlan(st);
  if (plan.error) refuse('--baseline refused: ' + plan.error);
  await client.query('BEGIN');
  try {
    await ensureTable(client);
    for (var i = 0; i < plan.adopt.length; i++) {
      var e = entries.find(function (x) { return x.file === plan.adopt[i].file; });
      await client.query('INSERT INTO ' + TABLE + " (file, sha256, method) VALUES ($1, $2, 'baseline')", [e.file, e.sha256]);
      log('baseline  ' + e.file + ' (recorded, not run)');
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  log('baseline recorded ' + plan.adopt.length + ' file(s); ' + plan.rest.length + ' pending' + (plan.rest.length ? ' — a plain run applies them' : ''));
  return { baseline: plan.adopt.length, pending: plan.rest.length };
}

async function doApply(client, entries, log) {
  var st = await status(client, entries);
  checkConsistent(st);
  if (!st.count && st.entries[0].present) {
    refuse('this database already has the IDauto schema but no migration record (migrated by hand). Nothing was applied. ' +
      'Run with --dry-run to see what is present, then --baseline to adopt it (docs/DATABASE.md §1a)');
  }
  await ensureTable(client);
  var applied = 0;
  for (var i = 0; i < entries.length; i++) {
    if (st.entries[i].state !== 'pending') continue;
    var e = entries[i];
    await client.query('BEGIN');
    try {
      await client.query(e.exec);
      await client.query('INSERT INTO ' + TABLE + " (file, sha256, method) VALUES ($1, $2, 'applied')", [e.file, e.sha256]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = e.file + ': ' + err.message + ' (rolled back; nothing of this file was kept)';
      throw err;
    }
    applied++;
    log('applied   ' + e.file);
  }
  log(applied ? applied + ' migration(s) applied' : 'nothing to apply: the database is up to date');
  return { applied: applied };
}

function connectFromEnv() {
  var required = ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD', 'IDAUTO_DB_NAME'];
  var missing = required.filter(function (n) { return !process.env[n]; });
  if (missing.length) refuse('missing environment variable(s): ' + missing.join(', '));
  var pg = require('pg');
  return new pg.Client({
    host: process.env.IDAUTO_DB_HOST, port: parseInt(process.env.IDAUTO_DB_PORT, 10),
    user: process.env.IDAUTO_DB_USER, password: process.env.IDAUTO_DB_PASSWORD,
    database: process.env.IDAUTO_DB_NAME, application_name: 'idauto-migrate'
  });
}

function parseArgs(argv) {
  var opts = {};
  argv.forEach(function (a) {
    if (a === '--dry-run' || a === '--status') opts.dryRun = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--baseline') opts.baseline = true;
    else if (/^--confirm-database=.+/.test(a)) opts.confirmDatabase = a.slice('--confirm-database='.length);
    else if (a === '--help' || a === '-h') opts.help = true;
    else { var e = new Error('unknown argument ' + a); e.usage = true; throw e; }
  });
  if (opts.check && !opts.dryRun) { var e2 = new Error('--check goes with --dry-run'); e2.usage = true; throw e2; }
  return opts;
}

async function main(argv) {
  var opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n'); return 0; }
  var client = connectFromEnv();
  await client.connect();
  try {
    var result = await run(client, opts);
    if (opts.check && !result.clean) { process.stderr.write('migrate --check: the database is not at the MANIFEST head\n'); return 1; }
    return 0;
  } finally { await client.end(); }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(function (code) { process.exit(code); }, function (err) {
    process.stderr.write('migrate ' + (err.refusal ? 'refused' : err.usage ? 'usage error' : 'failed') + ': ' + err.message + '\n');
    process.exit(err.usage ? 2 : 1);
  });
}

module.exports = { readManifest: readManifest, executableSql: executableSql, parseProbe: parseProbe, run: run, TABLE: TABLE, MANIFEST_PATH: MANIFEST_PATH };
