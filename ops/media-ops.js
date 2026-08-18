'use strict';
// =====================================================
// MYTHOS — ID Auto media operations (IDAUTO-STORAGE-OPS)
// ops/media-ops.js
//
// Operator tooling for the EXISTING local content-addressed media store.
// It does not replace, migrate, or redesign that store — see
// ops/runbooks/STORAGE_RUNBOOK.md.
//
//   audit            read-only DB <-> filesystem integrity report
//   backup           create a verified backup
//   verify-backup    re-verify a backup on disk
//   restore-dry-run  report exactly what a restore would do; writes nothing
//   restore          restore into an explicit destination
//
// SAFETY PROPERTIES
//   - No command deletes or modifies anything in the live media store.
//     There is no delete/prune command in this tool at all, by design:
//     orphan cleanup is a separately-authorised future operation.
//   - restore requires an explicit --dest and refuses unsafe destinations.
//   - restore never silently overwrites a file whose bytes differ.
//   - No credential is ever read into a report, a manifest, or stdout.
//     Database configuration comes from reference/db.js, which reads the
//     same IDAUTO_DB_* variables the runtime uses.
//
// EXIT CODES
//   0  success / clean
//   1  usage or environment error
//   2  anomalies found, or verification failed
//   3  refused: unsafe destination or would-overwrite conflict
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var db = require('../reference/db.js');

var FORMAT_VERSION = '1.0.0';
var TOOL = 'ops/media-ops.js';

var EX_OK = 0, EX_USAGE = 1, EX_ANOMALY = 2, EX_REFUSED = 3;

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function sha256Text(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function isHash(s) { return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s); }

// Walks the content-addressed tree and returns every regular file as
// { key, relPath, absPath, size, mode }. relPath keeps the aa/bb/hash shape.
function walkMedia(root) {
  var out = [];
  if (!fs.existsSync(root)) return out;
  fs.readdirSync(root).forEach(function (d1) {
    var p1 = path.join(root, d1);
    if (!fs.statSync(p1).isDirectory()) return;
    fs.readdirSync(p1).forEach(function (d2) {
      var p2 = path.join(p1, d2);
      if (!fs.statSync(p2).isDirectory()) return;
      fs.readdirSync(p2).forEach(function (f) {
        var p3 = path.join(p2, f);
        var st = fs.statSync(p3);
        if (!st.isFile()) return;
        out.push({
          key: f,
          relPath: path.join(d1, d2, f),
          absPath: p3,
          size: st.size,
          mode: (st.mode & 0o777).toString(8),
          d1: d1,
          d2: d2
        });
      });
    });
  });
  return out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
}

// A cheap fingerprint of the whole source tree, used to detect whether the
// source changed while a backup was running.
function sourceFingerprint(files) {
  var s = files.map(function (f) { return f.key + ':' + f.size; }).join('\n');
  return { count: files.length, bytes: files.reduce(function (a, f) { return a + f.size; }, 0), digest: sha256Text(s) };
}

function getStorageRoot() {
  var root = process.env.IDAUTO_MEDIA_STORAGE_PATH;
  if (!root) fail('IDAUTO_MEDIA_STORAGE_PATH is not set. See ops/runbooks/STORAGE_RUNBOOK.md.');
  return path.resolve(root);
}

function fail(msg) {
  process.stderr.write('ERROR: ' + msg + '\n');
  process.exit(EX_USAGE);
}

function arg(name) {
  var i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : null;
}
function flag(name) { return process.argv.indexOf('--' + name) !== -1; }

function emit(human, json) {
  if (flag('json')) process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  else process.stdout.write(human + '\n');
}

// ---------------------------------------------------------------------
// database metadata
// ---------------------------------------------------------------------
//
// Exported inside a READ ONLY REPEATABLE READ transaction so every row in
// one export comes from a single consistent snapshot, rather than from
// several independently-timed statements.
//
// Only the columns needed to re-establish object references are selected.
// No other table is touched. Nothing is written.
async function exportMediaMetadata() {
  var client = await db.getClientForTransaction();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    var rows = await client.query(
      'SELECT id, observation_id, media_type, object_key, mime_type, width_px, height_px, ' +
      'file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
      'FROM idauto_observation_media ORDER BY id'
    );
    var stamp = await client.query('SELECT now() AT TIME ZONE \'UTC\' AS snapshot_utc, txid_current_snapshot()::text AS snap');
    await client.query('COMMIT');
    return {
      export_version: FORMAT_VERSION,
      source_table: 'idauto_observation_media',
      snapshot_utc: stamp.rows[0].snapshot_utc,
      snapshot_marker: stamp.rows[0].snap,
      isolation: 'REPEATABLE READ READ ONLY',
      row_count: rows.rows.length,
      rows: rows.rows
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* already failed */ }
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------
// Pure comparison of a filesystem listing against DB rows. Kept free of
// I/O and of any database dependency so the classification rules can be
// tested directly with synthetic fixtures. `hashOf` is injected so tests
// can supply content without touching disk.
function analyze(files, rows, hashOf) {
  hashOf = hashOf || function (f) { return sha256File(f.absPath); };

  var fsKeys = {};
  files.forEach(function (f) { fsKeys[f.key] = f; });

  var refCount = {};
  rows.forEach(function (r) {
    if (!r.object_key) return;
    refCount[r.object_key] = (refCount[r.object_key] || 0) + 1;
  });

  var findings = {
    missing_objects: [],        // DB row -> no file
    orphan_objects: [],         // file -> no DB row
    hash_mismatch: [],          // filename != sha256(content)
    bad_path_layout: [],        // not aa/bb/hash
    zero_byte: [],
    size_mismatch: [],          // DB file_size_bytes != actual
    permission_anomalies: [],
    key_hash_divergence: []     // object_key != image_hash
  };

  Object.keys(refCount).forEach(function (k) {
    if (!fsKeys[k]) findings.missing_objects.push({ key: k, referenced_by_rows: refCount[k], severity: 'CRITICAL' });
  });

  files.forEach(function (f) {
    if (!isHash(f.key)) findings.bad_path_layout.push({ rel: f.relPath, reason: 'filename is not a 64-char lowercase sha256' });
    else if (f.d1 !== f.key.slice(0, 2) || f.d2 !== f.key.slice(2, 4)) {
      findings.bad_path_layout.push({ rel: f.relPath, reason: 'directory prefix does not match hash' });
    }
    if (f.size === 0) findings.zero_byte.push({ key: f.key });
    if (f.mode !== '640') findings.permission_anomalies.push({ key: f.key, mode: f.mode, expected: '640' });
    var actual = hashOf(f);
    if (actual !== f.key) findings.hash_mismatch.push({ key: f.key, actual_sha256: actual, severity: 'CRITICAL' });
    if (!refCount[f.key]) {
      // Deliberately classified UNKNOWN, never SAFE_CANDIDATE: the write
      // path stores the object BEFORE its row commits, so a file with no
      // row may simply be newer than this snapshot rather than garbage.
      // Automatic deletion is therefore never safe from this signal alone.
      findings.orphan_objects.push({ key: f.key, size: f.size, classification: 'UNKNOWN' });
    }
  });

  var sizeByKey = {};
  rows.forEach(function (r) {
    if (r.object_key && r.file_size_bytes != null) sizeByKey[r.object_key] = r.file_size_bytes;
    if (r.object_key && r.image_hash && r.object_key !== r.image_hash) {
      findings.key_hash_divergence.push({ id: r.id, object_key: r.object_key, image_hash: r.image_hash });
    }
  });
  Object.keys(sizeByKey).forEach(function (k) {
    if (fsKeys[k] && fsKeys[k].size !== sizeByKey[k]) {
      findings.size_mismatch.push({ key: k, db_bytes: sizeByKey[k], actual_bytes: fsKeys[k].size });
    }
  });

  var shared = Object.keys(refCount).filter(function (k) { return refCount[k] > 1; });
  var anomalyCount = Object.keys(findings).reduce(function (a, k) { return a + findings[k].length; }, 0);
  // Orphans and permission drift are reportable but not integrity failures.
  var criticalCount = findings.missing_objects.length + findings.hash_mismatch.length +
                      findings.bad_path_layout.length + findings.zero_byte.length +
                      findings.size_mismatch.length + findings.key_hash_divergence.length;

  return {
    findings: findings,
    refCount: refCount,
    shared: shared,
    anomaly_count: anomalyCount,
    critical_count: criticalCount,
    clean: criticalCount === 0
  };
}

async function cmdAudit() {
  var root = getStorageRoot();
  var files = walkMedia(root);
  var meta = await exportMediaMetadata();
  var a = analyze(files, meta.rows);
  var findings = a.findings, refCount = a.refCount, shared = a.shared;
  var anomalyCount = a.anomaly_count, criticalCount = a.critical_count;

  var summary = {
    command: 'audit',
    storage_root_present: true,
    filesystem: { files: files.length, bytes: files.reduce(function (a2, f) { return a2 + f.size; }, 0) },
    database: { media_rows: meta.row_count, distinct_object_keys: Object.keys(refCount).length },
    dedup: { shared_objects: shared.length, max_refs_to_one_object: shared.reduce(function (m, k) { return Math.max(m, refCount[k]); }, 0) },
    findings: findings,
    anomaly_count: anomalyCount,
    critical_count: criticalCount,
    clean: criticalCount === 0
  };

  emit(renderAudit(summary), summary);
  process.exit(criticalCount === 0 ? EX_OK : EX_ANOMALY);
}

function renderAudit(s) {
  var L = [];
  L.push('ID Auto media integrity audit');
  L.push('  filesystem : ' + s.filesystem.files + ' objects, ' + s.filesystem.bytes + ' bytes');
  L.push('  database   : ' + s.database.media_rows + ' media rows, ' + s.database.distinct_object_keys + ' distinct object keys');
  L.push('  dedup      : ' + s.dedup.shared_objects + ' shared objects, max ' + s.dedup.max_refs_to_one_object + ' rows referencing one object');
  L.push('  findings   :');
  Object.keys(s.findings).forEach(function (k) {
    L.push('    ' + (k + ' ').padEnd(24, '.') + ' ' + s.findings[k].length);
  });
  L.push(s.clean ? '  RESULT: CLEAN (no integrity defect)' : '  RESULT: ANOMALIES FOUND (' + s.critical_count + ' critical)');
  if (s.findings.orphan_objects.length) {
    L.push('  NOTE: orphans are classified UNKNOWN and are never auto-deletable by this tool.');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------
//
// CONSISTENCY STRATEGY (derived from the real write ordering in
// writes.js/storage.js, not assumed):
//   storage.store() writes the object BEFORE the DB row commits, and the
//   failure path only deletes an object when NO row references it. So a
//   committed row's object is always already on disk and will not be
//   removed underneath us. Exporting DB metadata FIRST and copying media
//   SECOND therefore guarantees every row captured in the backup has its
//   object present. The reverse order would not: a row committing during
//   the copy could reference a file created after that directory was
//   already walked.
//
// The source is fingerprinted before and after the copy. If it changed,
// the manifest records that honestly rather than claiming consistency.
async function cmdBackup() {
  var root = getStorageRoot();
  var destBase = arg('dest') || process.env.IDAUTO_BACKUP_ROOT;
  if (!destBase) fail('no backup destination: pass --dest <dir> or set IDAUTO_BACKUP_ROOT. ' +
    'See ops/runbooks/STORAGE_RUNBOOK.md.');
  var ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  var backupDir = path.join(destBase, 'idauto-media-backup-' + ts);

  if (fs.existsSync(backupDir)) fail('backup directory already exists: ' + backupDir);
  if (path.resolve(backupDir).indexOf(path.resolve(root)) === 0) {
    process.stderr.write('REFUSED: backup destination is inside the live media store\n');
    process.exit(EX_REFUSED);
  }

  var before = sourceFingerprint(walkMedia(root));

  // 1. metadata first (see strategy note above)
  var meta = await exportMediaMetadata();

  // 2. media second
  var files = walkMedia(root);

  fs.mkdirSync(path.join(backupDir, 'media'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(backupDir, 'metadata'), { recursive: true, mode: 0o700 });

  var checksumLines = [];
  var copied = 0, bytes = 0;
  var copyAnomalies = [];
  files.forEach(function (f) {
    var actual = sha256File(f.absPath);
    if (actual !== f.key) {
      copyAnomalies.push({ key: f.key, issue: 'source hash mismatch', actual_sha256: actual });
    }
    var target = path.join(backupDir, 'media', f.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(f.absPath, target);
    fs.chmodSync(target, 0o600);
    checksumLines.push(actual + '  ' + path.join('media', f.relPath));
    copied++; bytes += f.size;
  });

  var after = sourceFingerprint(walkMedia(root));
  var changed = before.digest !== after.digest;

  var metaPath = path.join(backupDir, 'metadata', 'observation-media.json');
  var metaJson = JSON.stringify(meta, null, 2) + '\n';
  fs.writeFileSync(metaPath, metaJson, { mode: 0o600 });

  var checksumsPath = path.join(backupDir, 'checksums.sha256');
  var checksumsText = checksumLines.join('\n') + '\n';
  fs.writeFileSync(checksumsPath, checksumsText, { mode: 0o600 });

  // Every object referenced by the captured metadata must be in the backup.
  var inBackup = {};
  checksumLines.forEach(function (l) { inBackup[l.split('  ')[1].split('/').pop()] = true; });
  var missingRefs = [];
  meta.rows.forEach(function (r) {
    if (r.object_key && !inBackup[r.object_key]) missingRefs.push(r.object_key);
  });
  missingRefs = missingRefs.filter(function (v, i, a) { return a.indexOf(v) === i; });

  var manifest = {
    format_version: FORMAT_VERSION,
    created_at_utc: new Date().toISOString(),
    tool: TOOL,
    tool_commit: gitCommit(),
    source: {
      // Path identifier only. No credential, no connection string, no token.
      storage_path: root,
      host_identifier: safeHostId(),
      project: 'idauto'
    },
    backup_mode: 'online-live',
    consistency: {
      strategy: 'metadata-snapshot-first-then-media',
      metadata_isolation: meta.isolation,
      metadata_snapshot_utc: meta.snapshot_utc,
      source_fingerprint_before: before,
      source_fingerprint_after: after,
      source_changed_during_backup: changed,
      state: (changed || missingRefs.length || copyAnomalies.length) ? 'DEGRADED' : 'CONSISTENT'
    },
    media: { file_count: copied, total_bytes: bytes, layout: 'content-addressed sha256 aa/bb/<hash>' },
    database: {
      metadata_export_version: meta.export_version,
      source_table: meta.source_table,
      row_count: meta.row_count,
      distinct_object_keys: Object.keys(inBackup).length
    },
    integrity: {
      checksums_file: 'checksums.sha256',
      checksums_file_sha256: sha256Text(checksumsText),
      metadata_file: 'metadata/observation-media.json',
      metadata_file_sha256: sha256Text(metaJson)
    },
    anomalies: {
      source_hash_mismatch: copyAnomalies,
      referenced_objects_missing_from_backup: missingRefs
    },
    restore_note: 'Restore media with: node ' + TOOL + ' restore --backup <dir> --dest <dir>. ' +
                  'Metadata is an export for reference and verification; this tool never writes to a database.'
  };

  var manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(backupDir, 0o700);

  var degraded = manifest.consistency.state !== 'CONSISTENT';
  var out = {
    command: 'backup', backup_dir: backupDir, files: copied, bytes: bytes,
    db_rows: meta.row_count, consistency: manifest.consistency.state,
    source_changed_during_backup: changed,
    referenced_objects_missing: missingRefs.length
  };
  emit('Backup created: ' + backupDir +
       '\n  media objects : ' + copied + ' (' + bytes + ' bytes)' +
       '\n  db media rows : ' + meta.row_count +
       '\n  consistency   : ' + manifest.consistency.state +
       (changed ? '\n  WARNING: source changed during backup' : '') +
       (missingRefs.length ? '\n  WARNING: ' + missingRefs.length + ' referenced object(s) missing' : ''), out);
  process.exit(degraded ? EX_ANOMALY : EX_OK);
}

function gitCommit() {
  try {
    return cp.execSync('git rev-parse HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { return 'unknown'; }
}
function safeHostId() {
  try { return cp.execSync('hostname', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return 'unknown'; }
}

// ---------------------------------------------------------------------
// verify-backup
// ---------------------------------------------------------------------
function verifyBackup(backupDir) {
  var problems = [];
  var manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, problems: [{ issue: 'manifest.json missing' }] };

  var manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { return { ok: false, problems: [{ issue: 'manifest.json is not valid JSON' }] }; }

  if (manifest.format_version !== FORMAT_VERSION) {
    problems.push({ issue: 'unsupported format_version', found: manifest.format_version, expected: FORMAT_VERSION });
  }

  var checksumsPath = path.join(backupDir, 'checksums.sha256');
  if (!fs.existsSync(checksumsPath)) {
    problems.push({ issue: 'checksums.sha256 missing' });
    return { ok: false, problems: problems, manifest: manifest };
  }
  var checksumsText = fs.readFileSync(checksumsPath, 'utf8');
  if (manifest.integrity && manifest.integrity.checksums_file_sha256 !== sha256Text(checksumsText)) {
    problems.push({ issue: 'checksums.sha256 does not match the hash recorded in the manifest (tampering or corruption)' });
  }

  var metaPath = path.join(backupDir, 'metadata', 'observation-media.json');
  if (!fs.existsSync(metaPath)) problems.push({ issue: 'metadata/observation-media.json missing' });
  else {
    var metaText = fs.readFileSync(metaPath, 'utf8');
    if (manifest.integrity && manifest.integrity.metadata_file_sha256 !== sha256Text(metaText)) {
      problems.push({ issue: 'metadata export does not match the hash recorded in the manifest' });
    }
    var parsed = null;
    try { parsed = JSON.parse(metaText); } catch (e) { problems.push({ issue: 'metadata export is not valid JSON' }); }
    if (parsed && manifest.database && parsed.row_count !== manifest.database.row_count) {
      problems.push({ issue: 'metadata row_count disagrees with manifest', found: parsed.row_count, expected: manifest.database.row_count });
    }
    if (parsed && Array.isArray(parsed.rows) && parsed.rows.length !== parsed.row_count) {
      problems.push({ issue: 'metadata rows array length disagrees with its own row_count' });
    }
  }

  var entries = checksumsText.split('\n').filter(Boolean);
  var seen = {}, verified = 0;
  entries.forEach(function (line) {
    var m = /^([0-9a-f]{64})\s\s(.+)$/.exec(line);
    if (!m) { problems.push({ issue: 'malformed checksums line', line: line.slice(0, 80) }); return; }
    var hash = m[1], rel = m[2];
    if (seen[rel]) { problems.push({ issue: 'duplicate manifest entry', rel: rel }); return; }
    seen[rel] = true;

    var base = path.basename(rel);
    var parts = rel.split('/');
    if (parts[0] !== 'media' || parts.length !== 4) {
      problems.push({ issue: 'malformed object path in backup', rel: rel });
      return;
    }
    if (!isHash(base) || base !== hash || parts[1] !== base.slice(0, 2) || parts[2] !== base.slice(2, 4)) {
      problems.push({ issue: 'object path violates the content-addressed layout', rel: rel });
      return;
    }
    var abs = path.join(backupDir, rel);
    if (!fs.existsSync(abs)) { problems.push({ issue: 'object listed in checksums is missing from the backup', rel: rel }); return; }
    var actual = sha256File(abs);
    if (actual !== hash) { problems.push({ issue: 'checksum mismatch (corrupt or tampered object)', rel: rel }); return; }
    verified++;
  });

  if (manifest.media && manifest.media.file_count !== entries.length) {
    problems.push({ issue: 'manifest file_count disagrees with checksums entry count', manifest: manifest.media.file_count, checksums: entries.length });
  }

  // Every object the captured metadata references must be present.
  if (fs.existsSync(metaPath)) {
    try {
      var md = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      var present = {};
      Object.keys(seen).forEach(function (r) { present[path.basename(r)] = true; });
      var missing = [];
      (md.rows || []).forEach(function (r) {
        if (r.object_key && !present[r.object_key] && missing.indexOf(r.object_key) === -1) missing.push(r.object_key);
      });
      if (missing.length) problems.push({ issue: 'metadata references objects absent from the backup', count: missing.length });
    } catch (e) { /* already reported above */ }
  }

  return { ok: problems.length === 0, problems: problems, manifest: manifest, verified_objects: verified };
}

function cmdVerifyBackup() {
  var b = arg('backup');
  if (!b) fail('verify-backup requires --backup <dir>');
  if (!fs.existsSync(b)) fail('backup directory not found: ' + b);
  var r = verifyBackup(path.resolve(b));
  var out = { command: 'verify-backup', backup: path.resolve(b), ok: r.ok, verified_objects: r.verified_objects || 0, problems: r.problems };
  emit('Backup verification: ' + (r.ok ? 'PASS' : 'FAIL') +
       '\n  objects verified : ' + (r.verified_objects || 0) +
       '\n  problems         : ' + r.problems.length +
       (r.problems.length ? '\n' + r.problems.map(function (p) { return '   - ' + p.issue + (p.rel ? ' [' + p.rel + ']' : ''); }).join('\n') : ''), out);
  process.exit(r.ok ? EX_OK : EX_ANOMALY);
}

// ---------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------

// Protected system paths, independent of any deployment. A direct child of
// /home (a user's home root, e.g. /home/deploy) is refused by the rule in
// assertSafeDest() rather than being listed by name, so the guard holds on
// every host instead of only the one this tool was first written for.
var FORBIDDEN_DESTS = ['/', '/home', '/etc', '/var', '/usr', '/bin', '/boot', '/root', '/opt', '/srv',
  '/lib', '/sbin', '/proc', '/sys', '/dev'];

function assertSafeDest(dest) {
  var d = path.resolve(dest);
  if (FORBIDDEN_DESTS.indexOf(d) !== -1 || path.dirname(d) === '/home') {
    process.stderr.write('REFUSED: "' + d + '" is a protected system path.\n');
    process.exit(EX_REFUSED);
  }
  var live = process.env.IDAUTO_MEDIA_STORAGE_PATH ? path.resolve(process.env.IDAUTO_MEDIA_STORAGE_PATH) : null;
  if (live && (d === live || d.indexOf(live + path.sep) === 0)) {
    process.stderr.write('REFUSED: destination is the LIVE media store (' + live + ').\n' +
      'Restoring over live media is never done by this tool. Restore to a separate directory and have an operator move it deliberately.\n');
    process.exit(EX_REFUSED);
  }
  if (d.indexOf(path.resolve(__dirname, '..')) === 0) {
    process.stderr.write('REFUSED: destination is inside the git repository.\n');
    process.exit(EX_REFUSED);
  }
  return d;
}

function cmdRestore(dryRun) {
  var b = arg('backup');
  var dest = arg('dest');
  if (!b) fail('restore requires --backup <dir>');
  if (!dest) fail('restore requires an explicit --dest <dir> (there is no default, deliberately)');
  if (!fs.existsSync(b)) fail('backup directory not found: ' + b);
  var backupDir = path.resolve(b);
  var d = assertSafeDest(dest);

  var v = verifyBackup(backupDir);
  if (!v.ok) {
    process.stderr.write('REFUSED: backup failed verification; refusing to restore from it.\n' +
      v.problems.map(function (p) { return '   - ' + p.issue; }).join('\n') + '\n');
    process.exit(EX_ANOMALY);
  }

  var entries = fs.readFileSync(path.join(backupDir, 'checksums.sha256'), 'utf8').split('\n').filter(Boolean);
  var plan = { would_create: [], would_skip_identical: [], conflicts: [] };

  entries.forEach(function (line) {
    var m = /^([0-9a-f]{64})\s\s(.+)$/.exec(line);
    var hash = m[1], rel = m[2];
    var target = path.join(d, rel.replace(/^media\//, ''));
    if (!fs.existsSync(target)) plan.would_create.push({ rel: rel, target: target });
    else {
      var existing = sha256File(target);
      // Content-addressed: identical bytes are a no-op, which keeps restore
      // idempotent and dedup-safe. Different bytes at the same key would mean
      // the invariant is already broken — never silently overwrite that.
      if (existing === hash) plan.would_skip_identical.push({ rel: rel });
      else plan.conflicts.push({ rel: rel, target: target, existing_sha256: existing, backup_sha256: hash });
    }
  });

  if (plan.conflicts.length) {
    var out0 = { command: dryRun ? 'restore-dry-run' : 'restore', ok: false, refused: true, conflicts: plan.conflicts.length, plan: plan };
    emit('REFUSED: ' + plan.conflicts.length + ' destination file(s) exist with DIFFERENT content.\n' +
         'This tool never silently overwrites differing bytes. Resolve manually.', out0);
    process.exit(EX_REFUSED);
  }

  if (!dryRun) {
    plan.would_create.forEach(function (p) {
      fs.mkdirSync(path.dirname(p.target), { recursive: true, mode: 0o750 });
      fs.copyFileSync(path.join(backupDir, p.rel), p.target);
      fs.chmodSync(p.target, 0o640);
    });
  }

  // Post-restore verification (real restore only).
  var verifiedBack = 0, restoreProblems = [];
  if (!dryRun) {
    entries.forEach(function (line) {
      var m = /^([0-9a-f]{64})\s\s(.+)$/.exec(line);
      var target = path.join(d, m[2].replace(/^media\//, ''));
      if (!fs.existsSync(target)) { restoreProblems.push({ issue: 'missing after restore', rel: m[2] }); return; }
      if (sha256File(target) !== m[1]) { restoreProblems.push({ issue: 'checksum mismatch after restore', rel: m[2] }); return; }
      verifiedBack++;
    });
  }

  var out = {
    command: dryRun ? 'restore-dry-run' : 'restore',
    backup: backupDir, dest: d,
    would_create: plan.would_create.length,
    would_skip_identical: plan.would_skip_identical.length,
    conflicts: plan.conflicts.length,
    restored_verified: verifiedBack,
    problems: restoreProblems,
    ok: restoreProblems.length === 0
  };
  emit((dryRun ? 'Restore DRY RUN (nothing written)' : 'Restore complete') +
       '\n  backup        : ' + backupDir +
       '\n  destination   : ' + d +
       '\n  ' + (dryRun ? 'would create  : ' : 'created       : ') + plan.would_create.length +
       '\n  identical skip: ' + plan.would_skip_identical.length +
       '\n  conflicts     : ' + plan.conflicts.length +
       (dryRun ? '' : '\n  verified back : ' + verifiedBack) +
       (restoreProblems.length ? '\n  PROBLEMS: ' + restoreProblems.length : ''), out);
  process.exit(restoreProblems.length ? EX_ANOMALY : EX_OK);
}

// ---------------------------------------------------------------------
function usage() {
  process.stdout.write([
    'ID Auto media operations — ' + TOOL,
    '',
    'Commands:',
    '  audit                                          read-only DB <-> filesystem integrity report',
    '  backup [--dest <dir>]                          create a verified backup (--dest or $IDAUTO_BACKUP_ROOT)   ',
    '  verify-backup --backup <dir>                   re-verify a backup on disk',
    '  restore-dry-run --backup <dir> --dest <dir>    show exactly what restore would do; writes nothing',
    '  restore --backup <dir> --dest <dir>            restore into an explicit destination',
    '',
    'Options:  --json     machine-readable output',
    '',
    'Exit codes: 0 clean · 1 usage/env · 2 anomaly/verification failure · 3 refused',
    '',
    'This tool never deletes live media, never writes to a database, and never',
    'restores over the live media store. See ops/runbooks/STORAGE_RUNBOOK.md.'
  ].join('\n') + '\n');
}

async function main() {
  var cmd = process.argv[2];
  try {
    switch (cmd) {
      case 'audit': await cmdAudit(); break;
      case 'backup': await cmdBackup(); break;
      case 'verify-backup': cmdVerifyBackup(); break;
      case 'restore-dry-run': cmdRestore(true); break;
      case 'restore': cmdRestore(false); break;
      default: usage(); process.exit(cmd ? EX_USAGE : EX_OK);
    }
  } catch (e) {
    // Never print the raw error object — driver errors can carry
    // connection-shaped detail. Message only.
    process.stderr.write('ERROR: ' + (e && e.message ? e.message : 'unknown failure') + '\n');
    process.exit(EX_USAGE);
  } finally {
    try { await db.closePool(); } catch (e) { /* pool may never have opened */ }
  }
}

if (require.main === module) main();

module.exports = {
  verifyBackup: verifyBackup,
  analyze: analyze,
  walkMedia: walkMedia,
  sha256File: sha256File,
  sha256Text: sha256Text,
  isHash: isHash,
  assertSafeDest: assertSafeDest,
  FORBIDDEN_DESTS: FORBIDDEN_DESTS,
  FORMAT_VERSION: FORMAT_VERSION
};
