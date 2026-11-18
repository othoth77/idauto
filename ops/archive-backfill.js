#!/usr/bin/env node
'use strict';
// IDauto — Update 4 — gives every photograph and carte grise stored BEFORE Update 4 its archive record, so the monthly
// archive on Haddad covers the existing files too. Idempotent (one record per document, ON CONFLICT DO NOTHING).
// Nothing is invented: dates, place and uploader come from the existing rows; the month is the original upload date.
//
//   node ops/archive-backfill.js            dry run: counts only
//   node ops/archive-backfill.js --apply    creates the records; the API's background pass then files them on Haddad
//
// Runs with the API's environment (database + IDAUTO_MEDIA_STORAGE_PATH). Prints counts only — no key, no path, no VIN.
var db = require('../reference/db.js');

(async function () {
  var apply = process.argv.indexOf('--apply') !== -1;
  if (!(await db.query("SELECT to_regclass('public.idauto_media_archive') IS NOT NULL t")).rows[0].t) { console.error('idauto_media_archive missing: apply database/migrations/ida-u4-archive-vin.sql first'); process.exit(2); }
  var missing = (await db.query(
    "SELECT d.id FROM idauto_vehicle_documents d WHERE d.document_type IN ('vehicle_photo', 'carte_grise') AND NOT EXISTS (SELECT 1 FROM idauto_media_archive a WHERE a.document_id = d.id)")).rows.length;
  console.log(JSON.stringify({ documents_without_archive_record: missing, apply: apply }));
  if (!apply || !missing) process.exit(0);
  var r = await db.query(
    "INSERT INTO idauto_media_archive (object_key, category, vehicle_id, document_id, source, uploaded_by, uploaded_at, captured_at, latitude, longitude, location_source, place_name, mime_type, original_filename, sha256, byte_size) " +
    "SELECT d.storage_key, CASE WHEN d.document_type = 'carte_grise' THEN 'carte-grise' ELSE 'vehicle-photos' END, d.vehicle_id, d.id, " +
    "  CASE WHEN d.org_id IS NULL THEN 'admin' ELSE 'workshop' END, left(d.created_by, 80), d.created_at, p.captured_at, p.latitude, p.longitude, p.location_source, " +
    "  left(coalesce(p.place_name, p.governorate), 160), d.mime_type, d.original_filename, d.storage_key, d.byte_size " +
    "FROM idauto_vehicle_documents d LEFT JOIN idauto_vehicle_photos p ON p.document_id = d.id " +
    "WHERE d.document_type IN ('vehicle_photo', 'carte_grise') AND d.storage_key ~ '^[a-f0-9]{64}$' AND NOT EXISTS (SELECT 1 FROM idauto_media_archive a WHERE a.document_id = d.id) " +
    "ON CONFLICT (document_id) WHERE document_id IS NOT NULL DO NOTHING RETURNING object_key");
  var replica = require('../reference/replica/haddad-replica.js'), keys = {};
  r.rows.forEach(function (x) { keys[x.object_key] = true; });
  for (var k of Object.keys(keys)) await replica.enqueue(k).catch(function () {});
  console.log(JSON.stringify({ records_created: r.rows.length, files_enqueued_for_haddad: Object.keys(keys).length }));
  setTimeout(function () { process.exit(0); }, 1500);
})().catch(function (e) { console.error('backfill failed:', e.message); process.exit(1); });
