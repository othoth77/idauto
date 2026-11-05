#!/usr/bin/env node
'use strict';
// =====================================================
// IDauto — IDA-CG2 STAGING: backup + restore drill of the carte grise images (D6 evidence)
// ops/staging-cg2-backup-drill.js <drill directory>     (run by `ops/staging-cg2.sh backup-drill`)
//
// The SAME reference set as the production capture (mythos-prod ops/backup/mythos-backup-capture.sh
// after PR #694): one REPEATABLE READ READ ONLY snapshot of observation media, IDA-V14 documents and
// every version of every IDA-CG2 submission face, originals and thumbnails. Then:
//   1. backup  — copy every referenced object out of the media root into <drill>/backup/;
//   2. verify  — each copy's sha256 equals its content-addressed key; each CG2 original also equals
//                the sha256 the database recorded at upload;
//   3. restore — rebuild an empty media root <drill>/restored/ from the backup alone, verify again,
//                and compare it byte for byte with the live staging media.
// Prints counts only (no key, no VIN, no image content). Staging database only.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function keyPath(root, k) { return path.join(root, k.slice(0, 2), k.slice(2, 4), k); }

(async function () {
  var DRILL = process.argv[2];
  if (!DRILL) throw new Error('usage: staging-cg2-backup-drill.js <drill directory>');
  if (!/^idauto_scratch_cg2_/.test(process.env.IDAUTO_DB_NAME || '')) throw new Error('refusing: not the staging database');
  var MEDIA = process.env.IDAUTO_MEDIA_STORAGE_PATH;
  var db = require(path.join(__dirname, '..', 'reference', 'db.js'));
  var client = await db.getClientForTransaction();
  var refs = [], recorded = {};
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    var has = (await client.query("SELECT to_regclass('public.idauto_vehicle_documents') IS NOT NULL AS v14, to_regclass('public.idauto_registration_submission_faces') IS NOT NULL AS cg2")).rows[0];
    (await client.query('SELECT object_key k FROM idauto_observation_media WHERE object_key IS NOT NULL')).rows.forEach(function (r) { refs.push({ src: 'observation', k: r.k }); });
    if (has.v14) (await client.query('SELECT k FROM idauto_vehicle_documents d, LATERAL (VALUES (d.storage_key), (d.thumb_storage_key)) v(k) WHERE k IS NOT NULL')).rows.forEach(function (r) { refs.push({ src: 'vehicle_document', k: r.k }); });
    if (has.cg2) {
      (await client.query('SELECT k FROM idauto_registration_submission_faces f, LATERAL (VALUES (f.storage_key), (f.thumb_storage_key)) v(k) WHERE k IS NOT NULL')).rows.forEach(function (r) { refs.push({ src: 'registration_submission', k: r.k }); });
      (await client.query('SELECT storage_key, sha256 FROM idauto_registration_submission_faces')).rows.forEach(function (r) { recorded[r.storage_key] = r.sha256; });
    }
    await client.query('COMMIT');
  } finally { client.release(); }
  await db.closePool();

  var bySrc = { observation: 0, vehicle_document: 0, registration_submission: 0 };
  refs.forEach(function (r) { bySrc[r.src]++; });
  var keys = refs.map(function (r) { return r.k; }).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
  var BACKUP = path.join(DRILL, 'backup'), RESTORED = path.join(DRILL, 'restored');
  fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 }); fs.mkdirSync(RESTORED, { recursive: true, mode: 0o700 });
  var bytes = 0, problems = [];
  // 1-2. backup + verify
  keys.forEach(function (k) {
    var src = keyPath(MEDIA, k);
    if (!fs.existsSync(src)) { problems.push('referenced object missing from the live store'); return; }
    var b = fs.readFileSync(src);
    fs.mkdirSync(path.dirname(keyPath(BACKUP, k)), { recursive: true });
    fs.writeFileSync(keyPath(BACKUP, k), b, { mode: 0o600 });
    bytes += b.length;
    var copy = fs.readFileSync(keyPath(BACKUP, k));
    if (sha(copy) !== k) problems.push('backup copy does not hash to its key');
    if (recorded[k] && recorded[k] !== sha(copy)) problems.push('backup copy differs from the sha256 recorded at upload');
  });
  var manifest = { at: new Date().toISOString(), references: refs.length, distinct_objects: keys.length, bytes: bytes, source_references: bySrc,
    keys_sha256: sha(Buffer.from(keys.join('\n'))) };
  fs.writeFileSync(path.join(DRILL, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  // 3. restore from the backup alone, verify, compare with live
  var restored = 0, identical = 0;
  keys.forEach(function (k) {
    if (!fs.existsSync(keyPath(BACKUP, k))) return;
    var b = fs.readFileSync(keyPath(BACKUP, k));
    fs.mkdirSync(path.dirname(keyPath(RESTORED, k)), { recursive: true });
    fs.writeFileSync(keyPath(RESTORED, k), b, { mode: 0o600 });
    var r = fs.readFileSync(keyPath(RESTORED, k));
    if (sha(r) !== k) { problems.push('restored object does not hash to its key'); return; }
    restored++;
    if (Buffer.compare(r, fs.readFileSync(keyPath(MEDIA, k))) === 0) identical++;
  });
  var cg2Originals = Object.keys(recorded).length, cg2Restored = Object.keys(recorded).filter(function (k) { return fs.existsSync(keyPath(RESTORED, k)) && sha(fs.readFileSync(keyPath(RESTORED, k))) === recorded[k]; }).length;
  console.log('references ' + refs.length + ' (observation ' + bySrc.observation + ', vehicle_document ' + bySrc.vehicle_document + ', registration_submission ' + bySrc.registration_submission + ')');
  console.log('backup     ' + keys.length + ' distinct objects, ' + bytes + ' bytes, each hashed to its key');
  console.log('restore    ' + restored + '/' + keys.length + ' rebuilt from the backup alone, ' + identical + ' byte-identical to the live store');
  console.log('CG2        ' + cg2Restored + '/' + cg2Originals + ' carte grise originals (every version) restored with the sha256 recorded at upload');
  console.log('manifest   ' + path.join(DRILL, 'manifest.json'));
  if (problems.length) { console.log('PROBLEMS   ' + problems.length + ': ' + problems.filter(function (p, i, a) { return a.indexOf(p) === i; }).join('; ')); process.exit(1); }
  console.log('RESULT     PASS');
})().catch(function (e) { console.error('drill failed: ' + e.message); process.exit(1); });
