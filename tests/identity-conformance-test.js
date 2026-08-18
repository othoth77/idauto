'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-DECOUPLE-3 identity conformance tests
// tests/identity-conformance-test.js
//
// Deterministic, offline, no database/network dependency, no environment
// variable required. Asserts that database/schema.sql and
// reference/identity.js agree with the three published vocabulary
// artifacts under protocol/vocabularies/ (actor-type.v1.json,
// org-role.v1.json, actor-identifier.v1.json). Those artifacts are
// vocabulary DATA documents, not JSON Schemas — see protocol/README.md.
//
// This is the schema<->artifact conformance guard for IDA-DECOUPLE-3: the
// mythos-prod identity-core contract test stops reading IDauto internals
// directly and instead pins these artifacts by version + SHA-256. This
// suite is what keeps the artifacts honest against the live schema on the
// IDauto side.
//
// Run with: node tests/identity-conformance-test.js
// =====================================================

var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var SCHEMA_PATH = path.join(BASE, 'database', 'schema.sql');
var VOCAB_DIR = path.join(BASE, 'protocol', 'vocabularies');
var IDENTITY_JS_PATH = path.join(BASE, 'reference', 'identity.js');

var ACTOR_TYPE_FILE = 'actor-type.v1.json';
var ORG_ROLE_FILE = 'org-role.v1.json';
var ACTOR_ID_FILE = 'actor-identifier.v1.json';

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

// Strips SQL line comments (-- ...) so a trailing comment on a column
// definition can never be mistaken for part of the declaration.
function stripSqlComments(src) {
  return src.split('\n').map(function (line) {
    var i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  }).join('\n');
}

// Returns the raw body of `CREATE TABLE table ( ... )`, or null.
function tableBody(src, table) {
  var m = new RegExp('CREATE TABLE\\s+' + table + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i').exec(src);
  return m ? m[1] : null;
}

// Finds the declared type of `column` inside `CREATE TABLE table`.
// A failed lookup returns null — callers must treat null as a failure,
// never as "skip this assertion".
function columnType(src, table, column) {
  var raw = tableBody(src, table);
  if (raw === null) return null;
  var body = stripSqlComments(raw);
  var lines = body.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    var cm = new RegExp('^' + column + '\\s+([A-Za-z0-9_]+(?:\\s*\\(\\s*\\d+\\s*\\))?)', 'i').exec(t);
    if (cm) return cm[1].replace(/\s+/g, '').toUpperCase();
  }
  return null;
}

// True set-equality helper: two genuine subset checks, not a single
// string comparison run twice.
function isSubset(a, b) {
  return a.every(function (x) { return b.indexOf(x) !== -1; });
}

// Small comment-stripper for JS source, string-literal aware, so a
// forbidden keyword sitting inside a string is never falsely stripped
// away and a forbidden keyword sitting inside a comment is never falsely
// treated as real code.
function stripJsComments(src) {
  var out = '';
  var i = 0, n = src.length;
  var state = null; // null | "'" | '"' | '`'
  while (i < n) {
    var c = src[i], c2 = src[i + 1];
    if (state) {
      out += c;
      if (c === '\\') { out += c2 || ''; i += 2; continue; }
      if (c === state) state = null;
      i++;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { state = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

var schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');

console.log('\n1. ARTIFACT HYGIENE — protocol/vocabularies/*.json');
(function () {
  var files = [
    { name: ACTOR_TYPE_FILE, hasValues: true },
    { name: ORG_ROLE_FILE, hasValues: true },
    { name: ACTOR_ID_FILE, hasValues: false }
  ];

  files.forEach(function (f) {
    var full = path.join(VOCAB_DIR, f.name);
    var bytes = fs.readFileSync(full);

    // Byte-level hygiene — checked regardless of whether JSON.parse succeeds.
    ok(bytes.indexOf(0x0d) === -1, f.name + ': contains no CR byte');
    var isBOM = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    ok(!isBOM, f.name + ': no UTF-8 BOM');
    var endsSingleNewline = bytes.length > 0 &&
      bytes[bytes.length - 1] === 0x0a &&
      (bytes.length === 1 || bytes[bytes.length - 2] !== 0x0a);
    ok(endsSingleNewline, f.name + ': ends with exactly one trailing newline');

    var doc = null;
    try {
      doc = JSON.parse(bytes.toString('utf8'));
      ok(true, f.name + ': JSON parses');
    } catch (e) {
      ok(false, f.name + ': JSON parses (' + e.message + ')');
    }

    ok(!!doc && Number.isInteger(doc.version), f.name + ': version field is an integer');

    var fnameVersion = /\.v(\d+)\.json$/.exec(f.name);
    ok(!!fnameVersion && !!doc && Number(fnameVersion[1]) === doc.version,
      f.name + ': filename version equals document version');

    ok(!!doc && typeof doc.canonical_id === 'string' && doc.canonical_id.indexOf(f.name) === doc.canonical_id.length - f.name.length,
      f.name + ': canonical_id ends with the exact filename');

    ok(!!doc && Number.isInteger(doc.revision) && doc.revision > 0,
      f.name + ': revision is a positive integer');

    if (f.hasValues) {
      var values = doc && doc.values;
      var isNonEmptyArray = Array.isArray(values) && values.length > 0;
      ok(isNonEmptyArray, f.name + ': values is a non-empty array');
      if (isNonEmptyArray) {
        ok(values.every(function (v) { return typeof v.value === 'string' && v.value.length > 0; }),
          f.name + ': every value is a non-empty string');
        ok(values.every(function (v) { return typeof v.value === 'string' && v.value === v.value.toLowerCase(); }),
          f.name + ': every value is lowercase');
        var raw = values.map(function (v) { return v.value; });
        ok(new Set(raw).size === raw.length, f.name + ': values are unique');
        ok(values.every(function (v) { return v.status === 'active' || v.status === 'deprecated'; }),
          f.name + ': every value has status in {active, deprecated}');
      }
    }
  });
})();

console.log('\n2. ACTOR_TYPE — schema.sql <-> actor-type.v1.json conformance');
(function () {
  ok(/CONSTRAINT\s+chk_submission_actor\b/.test(schemaSrc), 'chk_submission_actor constraint present by name');
  ok(/CONSTRAINT\s+chk_audit_actor\b/.test(schemaSrc), 'chk_audit_actor constraint present by name');

  var actorSites = schemaSrc.match(/actor_type\s+IN\s*\(([^)]*)\)/gi) || [];
  ok(actorSites.length >= 2, 'at least 2 actor_type IN(...) sites found in schema.sql (found ' + actorSites.length + ')');

  if (actorSites.length >= 2) {
    var parsedSets = actorSites.map(function (s) {
      var m = /IN\s*\(([^)]*)\)/i.exec(s);
      return m[1].split(',').map(function (x) { return x.trim().replace(/'/g, ''); }).sort();
    });
    var allSame = parsedSets.every(function (set) {
      return JSON.stringify(set) === JSON.stringify(parsedSets[0]);
    });
    ok(allSame, 'every actor_type IN(...) site declares the identical set (' + actorSites.length + ' sites)');

    var schemaActorSet = parsedSets[0].slice().sort();
    var actorTypeDoc = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, ACTOR_TYPE_FILE), 'utf8'));
    var artifactActive = actorTypeDoc.values.filter(function (v) { return v.status === 'active'; })
      .map(function (v) { return v.value; }).sort();

    ok(isSubset(schemaActorSet, artifactActive), 'schema actor_type set is a subset of artifact active values');
    ok(isSubset(artifactActive, schemaActorSet), 'artifact active values is a subset of schema actor_type set');

    var maxLen = artifactActive.reduce(function (m, v) { return Math.max(m, v.length); }, 0);
    ok(maxLen <= 20, 'longest active actor_type value fits VARCHAR(20) (longest is ' + maxLen + ' chars)');
  }

  ok(columnType(schemaSrc, 'idauto_submissions', 'actor_type') === 'VARCHAR(20)',
    'idauto_submissions.actor_type storage is VARCHAR(20)');
  ok(columnType(schemaSrc, 'idauto_audit_log', 'actor_type') === 'VARCHAR(20)',
    'idauto_audit_log.actor_type storage is VARCHAR(20)');
})();

console.log('\n3. ORG_ROLE — schema.sql <-> org-role.v1.json conformance');
(function () {
  ok(/CONSTRAINT\s+chk_user_role\b/.test(schemaSrc), 'chk_user_role constraint present by name');

  var roleMatch = /chk_user_role\s+CHECK\s*\(role\s+IN\s*\(([^)]*)\)/i.exec(schemaSrc);
  ok(!!roleMatch, 'chk_user_role CHECK clause parses');

  var orgRoleDoc = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, ORG_ROLE_FILE), 'utf8'));
  var artifactRoleActive = orgRoleDoc.values.filter(function (v) { return v.status === 'active'; })
    .map(function (v) { return v.value; }).sort();

  if (roleMatch) {
    var schemaRoleSet = roleMatch[1].split(',').map(function (x) { return x.trim().replace(/'/g, ''); }).sort();
    ok(isSubset(schemaRoleSet, artifactRoleActive), 'schema chk_user_role set is a subset of artifact active values');
    ok(isSubset(artifactRoleActive, schemaRoleSet), 'artifact active values is a subset of schema chk_user_role set');
  }

  ok(columnType(schemaSrc, 'idauto_user_roles', 'role') === orgRoleDoc.source_of_truth.storage,
    'idauto_user_roles.role storage matches artifact declared storage (' + orgRoleDoc.source_of_truth.storage + ')');
})();

console.log('\n4. ACTOR IDENTIFIER COLUMNS — driven from actor-identifier.v1.json');
(function () {
  var actorIdDoc = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, ACTOR_ID_FILE), 'utf8'));

  actorIdDoc.columns.forEach(function (col) {
    var t = columnType(schemaSrc, col.table, col.column);
    ok(t !== null, col.table + '.' + col.column + ' column found in schema.sql (a null lookup is a failure)');
    ok(t === 'VARCHAR(64)', col.table + '.' + col.column + ' is VARCHAR(64) (found ' + (t === null ? 'nothing' : t) + ')');
  });

  ok(actorIdDoc.max_length === 64, 'artifact max_length == 64');
  ok(actorIdDoc.storage === 'VARCHAR(64)', 'artifact storage == VARCHAR(64)');

  var formRegexes = actorIdDoc.forms.map(function (f) {
    return { name: f.name, re: new RegExp(f.pattern) };
  });

  actorIdDoc.examples.valid.forEach(function (ex) {
    var matchesAny = formRegexes.some(function (f) { return f.re.test(ex); });
    ok(matchesAny, 'valid example matches at least one form pattern: ' + JSON.stringify(ex));
    ok(ex.length <= actorIdDoc.max_length, 'valid example is within max_length: ' + JSON.stringify(ex));
  });

  actorIdDoc.examples.invalid.forEach(function (ex) {
    var matchesAny = formRegexes.some(function (f) { return f.re.test(ex); });
    var withinWidth = ex.length <= actorIdDoc.max_length;
    ok(!(matchesAny && withinWidth), 'invalid example is rejected (no form match, or exceeds width): ' + JSON.stringify(ex));
  });
})();

console.log('\n5. reference/identity.js — no-auth invariant');
(function () {
  var identitySrc = fs.readFileSync(IDENTITY_JS_PATH, 'utf8');

  // Non-emptiness preconditions first, so the negative assertions below
  // can never pass vacuously against an empty or unrelated file.
  ok(Buffer.byteLength(identitySrc, 'utf8') > 500, 'identity.js is longer than 500 bytes (precondition)');
  ok(identitySrc.indexOf('resolveIdentity') !== -1, 'identity.js contains resolveIdentity (precondition)');
  ok(identitySrc.indexOf('IDAUTO_ADMIN_IDENTITIES') !== -1, 'identity.js contains IDAUTO_ADMIN_IDENTITIES (precondition)');

  var stripped = stripJsComments(identitySrc).toLowerCase();
  var forbidden = ['createSession', 'jwt.sign', 'bcrypt', 'passport', 'oauth', 'hashPassword'];
  forbidden.forEach(function (kw) {
    ok(stripped.indexOf(kw.toLowerCase()) === -1, 'identity.js (comments stripped) contains no ' + kw);
  });
})();

console.log('\nIDENTITY-CONFORMANCE: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
