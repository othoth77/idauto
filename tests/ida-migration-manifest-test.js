'use strict';
/* IDA-G9 — THE MIGRATION MANIFEST IS THE ONE ORDERING (database-free).
 *
 * database/migrations/MANIFEST is the single source of truth for the order in
 * which a database is built; scripts/migrate.js applies it and
 * .github/workflows/database.yml builds the CI database through the runner.
 * Before 2026-11-25 the order lived only in that workflow, as a hand-kept list.
 *
 * This suite keeps the guarantee the workflow's "every migration file is
 * applied" step used to give, without a database: every file on disk is in
 * the manifest exactly once, every entry exists and can be applied atomically,
 * every entry carries a probe (needed to adopt a hand-migrated database), and
 * the workflow no longer carries a second list. The live behaviour of the
 * runner is tests/ida-migrate-runner-test.js (test:db).
 */
var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var migrate = require(path.join(BASE, 'scripts', 'migrate.js'));

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

say('1. THE MANIFEST PARSES AND AGREES WITH THE DIRECTORY');
var entries = null;
try { entries = migrate.readManifest(); ok(true, 'readManifest() accepts the manifest (no unlisted, duplicated or missing file)'); }
catch (e) { ok(false, 'readManifest() accepts the manifest: ' + e.message); }
entries = entries || [];
var onDisk = fs.readdirSync(path.join(BASE, 'database', 'migrations')).filter(function (f) { return /\.sql$/.test(f); }).sort();
var listed = entries.map(function (e) { return e.file; });
ok(onDisk.length > 0, 'precondition: database/migrations holds .sql files (' + onDisk.length + ')');
onDisk.forEach(function (f) {
  ok(listed.filter(function (x) { return x === 'migrations/' + f; }).length === 1, 'migrations/' + f + ' is listed exactly once');
});
ok(listed.length === onDisk.length + 1 && listed[0] === 'schema.sql', 'the manifest is schema.sql followed by exactly the files on disk');
ok(listed.indexOf('seed-synthetic-test-data.sql') === -1 && !listed.some(function (f) { return /seed/.test(f); }), 'the synthetic seed is not a migration');

say('2. EVERY ENTRY CAN BE APPLIED ATOMICALLY AND ADOPTED BY --baseline');
entries.forEach(function (e) {
  var problem = null;
  try { migrate.executableSql(e.file, e.sql); } catch (err) { problem = err.message; }
  ok(!problem, e.file + ' runs inside one transaction' + (problem ? ': ' + problem : ''));
  ok(e.probes.length >= 1, e.file + ' has a probe (' + e.probes.map(function (p) { return p.text; }).join(', ') + ')');
  ok(/^[0-9a-f]{64}$/.test(e.sha256), e.file + ' has a sha256');
});
var withTxn = entries.filter(function (e) { return /^\s*BEGIN\s*;/im.test(e.sql); }).map(function (e) { return e.file; });
ok(withTxn.length === 2, 'two historical files carry their own BEGIN;/COMMIT; (got ' + JSON.stringify(withTxn) + ')');
withTxn.forEach(function (f) {
  var e = entries.filter(function (x) { return x.file === f; })[0];
  var sql = migrate.executableSql(e.file, e.sql);
  ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(sql), f + ': its BEGIN;/COMMIT; lines are left out when executed (the record row stays in the same transaction)');
});
var refusals = [
  ['two BEGIN', 'BEGIN;\nSELECT 1;\nCOMMIT;\nBEGIN;\nSELECT 2;\nCOMMIT;\n'],
  ['CONCURRENTLY', 'CREATE INDEX CONCURRENTLY i ON t (c);\n'],
  ['psql meta-command', '\\i other.sql\n'],
  ['ROLLBACK', 'SELECT 1;\nROLLBACK;\n']
];
refusals.forEach(function (r) {
  var threw = false; try { migrate.executableSql('x.sql', r[1]); } catch (_) { threw = true; }
  ok(threw, 'a file with ' + r[0] + ' is refused');
});
var probeThrew = false; try { migrate.parseProbe("table x; DROP TABLE y"); } catch (_) { probeThrew = true; }
ok(probeThrew, 'a probe is a fixed catalogue check, never SQL from the manifest');

say('3. THE DEPLOY-ORDER HAZARD STAYS DOCUMENTED');
ok(listed.indexOf('migrations/ida-v13b-auth-account-issuer.sql') > listed.indexOf('migrations/ida-v13-auth-session.sql'), 'ida-v13b follows ida-v13 in the manifest');
var manifestText = fs.readFileSync(migrate.MANIFEST_PATH, 'utf8');
ok(/DEPLOY-ORDER HAZARD/.test(manifestText) && /ida-v13b-auth-account-issuer\.sql/.test(manifestText), 'the manifest names the ida-v13b hazard');
var deployment = fs.readFileSync(path.join(BASE, 'docs', 'DEPLOYMENT.md'), 'utf8');
ok(/## 9\. Rolling out Better Auth 1\.7\.7 \(IDA-V13b\) — migration FIRST/.test(deployment), 'docs/DEPLOYMENT.md §9 (migration first) is still there');

say('4. THE RUNNER WRITES NOTHING DESTRUCTIVE OF ITS OWN');
var runnerSrc = fs.readFileSync(path.join(BASE, 'scripts', 'migrate.js'), 'utf8');
var strings = (runnerSrc.match(/'[^'\n]*'/g) || []).join('\n');
ok(!/\b(DROP|TRUNCATE|DELETE)\b/i.test(strings), 'no DROP, TRUNCATE or DELETE in any SQL string of scripts/migrate.js');
ok(/--confirm-database=/.test(runnerSrc) && /idauto_scratch_/.test(runnerSrc), 'writing to a non-scratch database needs --confirm-database=<name>');
ok(/sha256/.test(runnerSrc) && /CHANGED/.test(runnerSrc), 'an applied file that changed is detected (sha256)');

say('5. ONE ORDERING: CI AND npm USE THE MANIFEST');
var pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
ok(pkg.scripts.migrate === 'node scripts/migrate.js', 'npm run migrate runs the runner');
var wf = fs.readFileSync(path.join(BASE, '.github', 'workflows', 'database.yml'), 'utf8');
var wfCode = wf.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
ok(/node scripts\/migrate\.js\s*$/m.test(wfCode), 'the database workflow builds the database with the runner');
ok(/node scripts\/migrate\.js --dry-run --check/.test(wfCode), 'the database workflow asserts every manifest entry is applied');
ok(!/migrations\/ida-[a-z0-9.-]+\.sql/.test(wfCode), 'the workflow keeps no second, hand-kept list of migrations');
ok(/seed-synthetic-test-data\.sql/.test(wfCode), 'the workflow still applies the synthetic seed');
ok(/runs-on: ubuntu-latest/.test(wfCode), 'the runner setting is unchanged');

console.log('\nIDA-MIGRATION-MANIFEST: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
