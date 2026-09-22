'use strict';

/* Every suite in tests/ must be named by exactly one npm script, and the
 * database-free script must stay database-free.
 *
 * Both halves were broken before 2026-09-22.
 *
 *   - `test:offline` contained ida-v8, ida-v9 and ida-v10, which each open a
 *     PostgreSQL connection. `npm test` therefore died on a clean checkout with
 *     "FATAL: db.js: missing required environment variable(s)", after eight
 *     suites had passed — while README.md said it "runs the database-free
 *     suites" and docs/DEPLOYMENT.md said "(no database)".
 *   - Four suites were named by no script at all: ida4-foundation (130
 *     assertions), identity-conformance (81), idauto-storage-ops (73) and
 *     ida4-ds-ui. They pass. Nothing ran them.
 *
 * This suite checks the partition, which is cheap and exact. The database-free
 * PROPERTY is checked by CI, which runs `npm run test:offline` with no
 * PostgreSQL and no IDAUTO_DB_* in the environment — the condition that
 * actually broke. See .github/workflows/ci.yml. */

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

var pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
var scripts = pkg.scripts || {};

/* The scripts that are allowed to name a suite. `test` is excluded: it
 * delegates, and counting it would let a suite be "covered" by delegation
 * alone. */
var SUITE_SCRIPTS = ['test:offline', 'test:db', 'test:v12', 'test:v13', 'test:v14'];

function named(script) {
  var body = scripts[script] || '';
  var out = [], re = /node\s+tests\/([A-Za-z0-9._-]+\.js)/g, m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

var onDisk = fs.readdirSync(path.join(BASE, 'tests'))
  .filter(function (f) { return /-test\.js$/.test(f); })
  .sort();

say('1. EVERY SCRIPT EXISTS');
SUITE_SCRIPTS.forEach(function (s) {
  ok(typeof scripts[s] === 'string' && scripts[s].length > 0, s + ' is defined');
});
ok(scripts.test === 'npm run test:offline',
  'npm test delegates to test:offline, so a clean checkout runs the database-free suites');

say('2. EVERY SUITE ON DISK IS NAMED BY EXACTLY ONE SCRIPT');
var owner = {};
SUITE_SCRIPTS.forEach(function (s) {
  named(s).forEach(function (f) {
    (owner[f] = owner[f] || []).push(s);
  });
});
onDisk.forEach(function (f) {
  var owners = owner[f] || [];
  if (owners.length === 1) { pass++; console.log('  PASS ' + f + ' -> ' + owners[0]); }
  else if (owners.length === 0) { fail++; console.log('  FAIL ' + f + ' is named by NO script — it will never run'); }
  else { fail++; console.log('  FAIL ' + f + ' is named by ' + owners.length + ' scripts: ' + owners.join(', ')); }
});

say('3. NO SCRIPT NAMES A SUITE THAT DOES NOT EXIST');
Object.keys(owner).sort().forEach(function (f) {
  ok(onDisk.indexOf(f) !== -1, f + ' exists on disk (named by ' + owner[f].join(', ') + ')');
});

say('4. THE THREE SUITES THAT BROKE `npm test` ARE NOT IN THE DATABASE-FREE SCRIPT');
/* Named individually and deliberately. A generic rule cannot tell these apart:
 * ida-v2, ida-v3 and ida-v4 mention db.js too and run perfectly well without
 * one, so "requires db.js" is not the discriminator — connecting is. */
['ida-v8-identity-resolution-test.js', 'ida-v9-org-auth-test.js', 'ida-v10-search-and-audit-test.js']
  .forEach(function (f) {
    ok(named('test:offline').indexOf(f) === -1, f + ' is not in test:offline');
    ok(named('test:db').indexOf(f) !== -1, f + ' is in test:db');
  });

say('5. THE FOUR SUITES NOTHING RAN ARE NOW RUN');
['ida4-foundation-test.js', 'identity-conformance-test.js', 'idauto-storage-ops-test.js', 'ida4-ds-ui-test.js']
  .forEach(function (f) {
    ok(named('test:offline').indexOf(f) !== -1, f + ' is in test:offline');
  });

say('6. CI RUNS THE DATABASE-FREE SUITE WITH NO DATABASE');
var ciPath = path.join(BASE, '.github', 'workflows', 'ci.yml');
ok(fs.existsSync(ciPath), '.github/workflows/ci.yml exists');
if (fs.existsSync(ciPath)) {
  /* Strip comments first: this workflow NAMES the IDAUTO_DB_* variables, in a
   * guard step that fails if any of them is set, and it explains in prose why
   * there is no services: block. Matching raw text would flag its own
   * safeguards. What matters is an ASSIGNMENT and a real YAML key. */
  var ci = fs.readFileSync(ciPath, 'utf8')
    .split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
  ok(/npm run test:offline/.test(ci), 'CI runs npm run test:offline');
  ok(!/IDAUTO_DB_[A-Z_]+\s*[:=]\s*\S/.test(ci),
    'CI assigns no IDAUTO_DB_* — the database-free claim is proven by the run, not asserted');
  ok(!/^\s*services\s*:/m.test(ci), 'CI starts no database service');
}

console.log('\nIDA-TEST-SCRIPT-COVERAGE: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
