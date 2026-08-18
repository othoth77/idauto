'use strict';
// =====================================================
// IDAUTO-STORAGE-OPS — media backup / restore / integrity regression.
//
// Every fixture is synthetic and per-run unique. This suite NEVER reads
// the live media store, NEVER connects to a database, and NEVER depends
// on live file counts — it builds its own content-addressed trees and
// backup artifacts in a throwaway directory and removes them afterwards.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var TOOL = path.join(BASE, 'ops/media-ops.js');
var ops = require(TOOL);

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var RUN = crypto.randomBytes(6).toString('hex');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-storage-ops-' + RUN + '-'));
function tmp(n) { return path.join(TMP, n); }
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// Runs the CLI. Never inherits the live storage path unless asked.
function run(args, env) {
  var e = Object.assign({}, process.env, { IDAUTO_MEDIA_STORAGE_PATH: tmp('fake-live') }, env || {});
  var r = cp.spawnSync(process.execPath, [TOOL].concat(args), { encoding: 'utf8', env: e });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// Builds a synthetic content-addressed media tree.
function makeMediaTree(root, contents) {
  var keys = [];
  contents.forEach(function (c) {
    var buf = Buffer.from(c);
    var h = sha(buf);
    var p = path.join(root, h.slice(0, 2), h.slice(2, 4), h);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf, { mode: 0o640 });
    keys.push(h);
  });
  return keys;
}

// Builds a valid backup artifact by hand, so corruption cases can be
// introduced deliberately without needing a database.
function makeBackup(dir, contents, opts) {
  opts = opts || {};
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'metadata'), { recursive: true });
  var lines = [], keys = [];
  contents.forEach(function (c) {
    var buf = Buffer.from(c);
    var h = sha(buf);
    var rel = path.join('media', h.slice(0, 2), h.slice(2, 4), h);
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), buf);
    lines.push(h + '  ' + rel);
    keys.push(h);
  });
  if (opts.duplicateEntry) lines.push(lines[0]);
  if (opts.malformedPath) lines.push(sha(Buffer.from('x')) + '  media/not/a/valid/layout');

  var meta = {
    export_version: ops.FORMAT_VERSION,
    source_table: 'idauto_observation_media',
    snapshot_utc: new Date().toISOString(),
    isolation: 'REPEATABLE READ READ ONLY',
    row_count: keys.length,
    rows: keys.map(function (k, i) { return { id: i + 1, observation_id: i + 1, object_key: k, image_hash: k }; })
  };
  if (opts.metadataReferencesMissing) {
    meta.rows.push({ id: 999, observation_id: 999, object_key: sha(Buffer.from('never-stored-' + RUN)), image_hash: null });
    meta.row_count = meta.rows.length;
  }
  var metaText = JSON.stringify(meta, null, 2) + '\n';
  var checksumsText = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'metadata', 'observation-media.json'), metaText);
  fs.writeFileSync(path.join(dir, 'checksums.sha256'), checksumsText);

  var manifest = {
    format_version: opts.badVersion ? '0.0.1' : ops.FORMAT_VERSION,
    created_at_utc: new Date().toISOString(),
    tool: 'test-fixture',
    source: { storage_path: '/synthetic/' + RUN },
    backup_mode: 'offline-fixture',
    consistency: { state: 'CONSISTENT' },
    media: { file_count: opts.wrongFileCount ? lines.length + 7 : lines.length, total_bytes: 0 },
    database: { row_count: meta.row_count },
    integrity: {
      checksums_file: 'checksums.sha256',
      checksums_file_sha256: opts.tamperManifestChecksumHash ? sha(Buffer.from('wrong')) : ops.sha256Text(checksumsText),
      metadata_file: 'metadata/observation-media.json',
      metadata_file_sha256: opts.tamperManifestMetaHash ? sha(Buffer.from('wrong')) : ops.sha256Text(metaText)
    }
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { keys: keys, manifest: manifest };
}

console.log('IDAUTO-STORAGE-OPS — media backup/restore/integrity\n');

// ---------------------------------------------------------------------
console.log('1. Valid backup verifies');
var okDir = tmp('backup-valid');
var okContents = ['alpha-' + RUN, 'beta-' + RUN, 'gamma-' + RUN];
var built = makeBackup(okDir, okContents);
var v = ops.verifyBackup(okDir);
ok(v.ok === true, 'a well-formed backup verifies clean');
ok(v.verified_objects === 3, 'all 3 synthetic objects verified');
ok(run(['verify-backup', '--backup', okDir]).status === 0, 'CLI verify-backup exits 0 on a valid backup');

console.log('\n2. Tampered media file fails checksum');
var tamper = tmp('backup-tampered');
var t = makeBackup(tamper, okContents);
var victim = path.join(tamper, 'media', t.keys[0].slice(0, 2), t.keys[0].slice(2, 4), t.keys[0]);
fs.writeFileSync(victim, Buffer.from('TAMPERED-' + RUN));
var vt = ops.verifyBackup(tamper);
ok(vt.ok === false, 'tampered object fails verification');
ok(vt.problems.some(function (p) { return /checksum mismatch/i.test(p.issue); }), 'reports a checksum mismatch');
ok(run(['verify-backup', '--backup', tamper]).status === 2, 'CLI exits 2 (anomaly) on tampered backup');

console.log('\n3. Missing media file fails verification');
var miss = tmp('backup-missing');
var m = makeBackup(miss, okContents);
fs.unlinkSync(path.join(miss, 'media', m.keys[1].slice(0, 2), m.keys[1].slice(2, 4), m.keys[1]));
var vm = ops.verifyBackup(miss);
ok(vm.ok === false, 'missing object fails verification');
ok(vm.problems.some(function (p) { return /missing from the backup/i.test(p.issue); }), 'reports the missing object');

console.log('\n4. Manifest integrity is enforced');
var mt1 = tmp('backup-manifest-checksums');
makeBackup(mt1, okContents, { tamperManifestChecksumHash: true });
ok(ops.verifyBackup(mt1).problems.some(function (p) { return /checksums.sha256 does not match/i.test(p.issue); }),
  'manifest checksums hash mismatch is detected');
var mt2 = tmp('backup-manifest-meta');
makeBackup(mt2, okContents, { tamperManifestMetaHash: true });
ok(ops.verifyBackup(mt2).problems.some(function (p) { return /metadata export does not match/i.test(p.issue); }),
  'manifest metadata hash mismatch is detected');
var mt3 = tmp('backup-count');
makeBackup(mt3, okContents, { wrongFileCount: true });
ok(ops.verifyBackup(mt3).problems.some(function (p) { return /file_count disagrees/i.test(p.issue); }),
  'manifest file_count disagreement is detected');
var mt4 = tmp('backup-version');
makeBackup(mt4, okContents, { badVersion: true });
ok(ops.verifyBackup(mt4).problems.some(function (p) { return /format_version/i.test(p.issue); }),
  'unsupported format_version is rejected');
var mt5 = tmp('backup-nomanifest');
makeBackup(mt5, okContents);
fs.unlinkSync(path.join(mt5, 'manifest.json'));
ok(ops.verifyBackup(mt5).ok === false, 'a backup with no manifest fails');
var mt6 = tmp('backup-badjson');
makeBackup(mt6, okContents);
fs.writeFileSync(path.join(mt6, 'manifest.json'), '{not json');
ok(ops.verifyBackup(mt6).problems.some(function (p) { return /not valid JSON/i.test(p.issue); }), 'a corrupt manifest is rejected');

console.log('\n5. Malformed object path is rejected');
var badPath = tmp('backup-badpath');
makeBackup(badPath, okContents, { malformedPath: true });
ok(ops.verifyBackup(badPath).problems.some(function (p) { return /malformed object path|layout/i.test(p.issue); }),
  'an object path outside the content-addressed layout is rejected');

console.log('\n6. Duplicate manifest entry is rejected');
var dup = tmp('backup-dup');
makeBackup(dup, okContents, { duplicateEntry: true });
ok(ops.verifyBackup(dup).problems.some(function (p) { return /duplicate manifest entry/i.test(p.issue); }),
  'a duplicated checksums entry is rejected');

console.log('\n7. Metadata referencing an absent object is detected');
var refMiss = tmp('backup-refmiss');
makeBackup(refMiss, okContents, { metadataReferencesMissing: true });
ok(ops.verifyBackup(refMiss).problems.some(function (p) { return /references objects absent/i.test(p.issue); }),
  'metadata referencing an object not in the backup is detected');

// ---------------------------------------------------------------------
console.log('\n8. Restore refuses unsafe destinations');
['/', '/home', '/etc', '/var', '/usr', '/root'].forEach(function (p) {
  ok(ops.FORBIDDEN_DESTS.indexOf(p) !== -1, 'protected path is in the refusal list: ' + p);
});
// A user's home root is refused by rule (parent === /home), not by name, so
// the guard is deployment-neutral. Proven through the CLI, not the list.
['/home/deploy', '/home/ubuntu'].forEach(function (p) {
  ok(run(['restore', '--backup', okDir, '--dest', p]).status === 3,
    'CLI refuses a home root with exit 3: ' + p);
});
ok(run(['restore', '--backup', okDir, '--dest', '/etc']).status === 3, 'CLI refuses /etc with exit 3');
var fakeLive = tmp('fake-live');
fs.mkdirSync(fakeLive, { recursive: true });
ok(run(['restore', '--backup', okDir, '--dest', fakeLive], { IDAUTO_MEDIA_STORAGE_PATH: fakeLive }).status === 3,
  'CLI refuses to restore over the configured live media store');
ok(run(['restore', '--backup', okDir, '--dest', path.join(fakeLive, 'sub')], { IDAUTO_MEDIA_STORAGE_PATH: fakeLive }).status === 3,
  'CLI refuses a destination nested inside the live media store');
ok(run(['restore', '--backup', okDir]).status === 1, 'restore without --dest is a usage error (no default destination)');

console.log('\n9. Dry run writes nothing');
var dryDest = tmp('restore-dry');
var dr = run(['restore-dry-run', '--backup', okDir, '--dest', dryDest]);
ok(dr.status === 0, 'dry run exits 0');
ok(!fs.existsSync(dryDest), 'dry run created no destination directory');
ok(/would create\s*:\s*3/.test(dr.out), 'dry run reports it would create 3 objects');

console.log('\n10. Valid restore reproduces exact bytes');
var rDest = tmp('restore-real');
var rr = run(['restore', '--backup', okDir, '--dest', rDest]);
ok(rr.status === 0, 'restore exits 0');
var restored = ops.walkMedia(rDest);
ok(restored.length === 3, 'all 3 objects restored');
ok(restored.every(function (f) { return ops.sha256File(f.absPath) === f.key; }),
  'every restored object hashes to its own filename (content-addressing preserved)');
ok(restored.every(function (f) { return f.relPath === path.join(f.key.slice(0, 2), f.key.slice(2, 4), f.key); }),
  'nested aa/bb/<hash> layout preserved');
var origHashes = built.keys.slice().sort().join(',');
ok(restored.map(function (f) { return f.key; }).sort().join(',') === origHashes, 'restored key set matches the backup exactly');
ok(restored.every(function (f) { return (fs.statSync(f.absPath).mode & 0o777) === 0o640; }), 'restored files are mode 640');

console.log('\n11. Restore is idempotent and never silently overwrites');
var again = run(['restore', '--backup', okDir, '--dest', rDest]);
ok(again.status === 0, 're-running restore over identical content succeeds');
ok(/identical skip\s*:\s*3/.test(again.out), 'identical objects are skipped, not rewritten');
ok(ops.walkMedia(rDest).length === 3, 'no object was duplicated by the second restore');
// Corrupt one restored file, then prove restore refuses rather than overwriting.
var conflictKey = built.keys[0];
fs.writeFileSync(path.join(rDest, conflictKey.slice(0, 2), conflictKey.slice(2, 4), conflictKey), Buffer.from('DIFFERENT-' + RUN));
var conflict = run(['restore', '--backup', okDir, '--dest', rDest]);
ok(conflict.status === 3, 'restore refuses (exit 3) when a destination file has different bytes');
ok(/DIFFERENT content|conflicts/i.test(conflict.out), 'the conflict is reported');
ok(fs.readFileSync(path.join(rDest, conflictKey.slice(0, 2), conflictKey.slice(2, 4), conflictKey), 'utf8') === 'DIFFERENT-' + RUN,
  'the differing file was NOT overwritten');

console.log('\n12. Restore refuses a backup that fails verification');
ok(run(['restore', '--backup', tamper, '--dest', tmp('restore-from-tampered')]).status === 2,
  'restoring from a tampered backup is refused');
ok(!fs.existsSync(tmp('restore-from-tampered')), 'nothing was written from the tampered backup');

// ---------------------------------------------------------------------
console.log('\n13. Orphan and missing-object detection (pure analyze)');
var fsRoot = tmp('analyze-tree');
var keys = makeMediaTree(fsRoot, ['one-' + RUN, 'two-' + RUN, 'three-' + RUN]);
var files = ops.walkMedia(fsRoot);
ok(files.length === 3, 'synthetic tree walked');

// All three referenced -> clean.
var rowsAll = keys.map(function (k, i) { return { id: i + 1, object_key: k, image_hash: k, file_size_bytes: fs.statSync(path.join(fsRoot, k.slice(0, 2), k.slice(2, 4), k)).size }; });
var aClean = ops.analyze(files, rowsAll);
ok(aClean.clean === true, 'fully-referenced tree is clean');
ok(aClean.findings.orphan_objects.length === 0 && aClean.findings.missing_objects.length === 0, 'no orphans and no missing objects');

// Drop one row -> that file becomes an orphan, classified UNKNOWN.
var aOrphan = ops.analyze(files, rowsAll.slice(0, 2));
ok(aOrphan.findings.orphan_objects.length === 1, 'orphan detected when a row is absent');
ok(aOrphan.findings.orphan_objects[0].classification === 'UNKNOWN',
  'orphan is classified UNKNOWN — never auto-deletable, because the write path stores the object before its row commits');
ok(aOrphan.critical_count === 0, 'an orphan alone is not a critical integrity failure');

// Row referencing a key with no file -> missing object, critical.
var aMissing = ops.analyze(files, rowsAll.concat([{ id: 99, object_key: sha(Buffer.from('absent-' + RUN)), image_hash: null }]));
ok(aMissing.findings.missing_objects.length === 1, 'missing object detected when a row has no file');
ok(aMissing.findings.missing_objects[0].severity === 'CRITICAL', 'a missing object is CRITICAL');
ok(aMissing.clean === false, 'a missing object makes the audit not clean');

console.log('\n14. Dedup / shared-object semantics');
var sharedRows = [
  { id: 1, object_key: keys[0], image_hash: keys[0] },
  { id: 2, object_key: keys[0], image_hash: keys[0] },
  { id: 3, object_key: keys[0], image_hash: keys[0] },
  { id: 4, object_key: keys[1], image_hash: keys[1] },
  { id: 5, object_key: keys[2], image_hash: keys[2] }
];
var aShared = ops.analyze(files, sharedRows);
ok(aShared.refCount[keys[0]] === 3, 'one object correctly counted as referenced by 3 rows');
ok(aShared.shared.length === 1, 'exactly one shared object identified');
ok(aShared.findings.orphan_objects.length === 0, 'a shared object is never mistaken for an orphan');
ok(aShared.clean === true, 'shared references are not an anomaly');
// Removing ONE of several rows must not make the object look deletable.
var aStillShared = ops.analyze(files, sharedRows.slice(1));
ok(aStillShared.findings.orphan_objects.length === 0,
  'dropping one of several references does NOT mark the object as an orphan (shared-object safety)');

console.log('\n15. Other integrity classifications');
var badTree = tmp('bad-tree');
var bk = makeMediaTree(badTree, ['zzz-' + RUN]);
// Zero-byte file placed at a correct-looking path.
var zeroKey = sha(Buffer.from(''));
var zp = path.join(badTree, zeroKey.slice(0, 2), zeroKey.slice(2, 4), zeroKey);
fs.mkdirSync(path.dirname(zp), { recursive: true });
fs.writeFileSync(zp, Buffer.alloc(0), { mode: 0o640 });
var bf = ops.walkMedia(badTree);
var aZero = ops.analyze(bf, [{ id: 1, object_key: bk[0], image_hash: bk[0] }, { id: 2, object_key: zeroKey, image_hash: zeroKey }]);
ok(aZero.findings.zero_byte.length === 1, 'zero-byte object detected');
// Content that does not match its filename.
var liar = path.join(badTree, 'ff', 'ff', 'f'.repeat(64));
fs.mkdirSync(path.dirname(liar), { recursive: true });
fs.writeFileSync(liar, Buffer.from('not-the-right-content-' + RUN), { mode: 0o640 });
var aLiar = ops.analyze(ops.walkMedia(badTree), []);
ok(aLiar.findings.hash_mismatch.length === 1, 'content not matching its own hash is detected');
ok(aLiar.critical_count > 0, 'a hash mismatch is a critical finding');
// Wrong directory prefix.
var wrongDir = tmp('wrong-dir');
var wk = sha(Buffer.from('wd-' + RUN));
var wp = path.join(wrongDir, 'aa', 'bb', wk);
fs.mkdirSync(path.dirname(wp), { recursive: true });
fs.writeFileSync(wp, Buffer.from('wd-' + RUN), { mode: 0o640 });
ok(ops.analyze(ops.walkMedia(wrongDir), []).findings.bad_path_layout.length === 1, 'wrong directory prefix detected');
// Permission drift is reported but is not critical.
var permTree = tmp('perm-tree');
var pk = makeMediaTree(permTree, ['perm-' + RUN]);
fs.chmodSync(path.join(permTree, pk[0].slice(0, 2), pk[0].slice(2, 4), pk[0]), 0o644);
var aPerm = ops.analyze(ops.walkMedia(permTree), [{ id: 1, object_key: pk[0], image_hash: pk[0] }]);
ok(aPerm.findings.permission_anomalies.length === 1, 'permission drift detected');
ok(aPerm.critical_count === 0, 'permission drift is reported but not critical');

console.log('\n16. The tool cannot mutate the live store');
var src = fs.readFileSync(TOOL, 'utf8');
ok(!/fs\.unlinkSync|fs\.rmSync|fs\.rmdirSync|removeUnconditionally/.test(src),
  'media-ops.js contains no delete call of any kind');
ok(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b/.test(src),
  'media-ops.js issues no data-modifying SQL');
ok(/READ ONLY/.test(src), 'metadata export uses a READ ONLY transaction');
ok(/REPEATABLE READ/.test(src), 'metadata export uses a REPEATABLE READ snapshot');

console.log('\n17. No credential is ever emitted');
ok(!/IDAUTO_DB_PASSWORD|POSTGRES_PASSWORD/.test(src.replace(/db\.js/g, '')),
  'media-ops.js never references a password variable directly');
var manifestText = fs.readFileSync(path.join(okDir, 'manifest.json'), 'utf8');
ok(!/password|secret|token|bearer/i.test(manifestText), 'a generated manifest contains no credential-shaped field');

// ---------------------------------------------------------------------
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
ok(!fs.existsSync(TMP), 'per-run temporary fixtures cleaned up');

console.log('\nIDAUTO-STORAGE-OPS: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
