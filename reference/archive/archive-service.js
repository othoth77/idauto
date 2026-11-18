'use strict';
// =====================================================
// IDauto — Update 4 — the monthly archive of vehicle photographs and cartes grises.
// reference/archive/archive-service.js
//
// Every stored photograph and carte grise gets ONE archive record (idauto_media_archive): when it was taken and
// received, where (device GPS or EXIF, never an IP address), by whom and from where (public scanner, workshop,
// administrator), its original name and type, its SHA-256. A new capture is a new record; nothing is overwritten.
//
// The file itself stays in the content-addressed media store (unchanged: every existing reference keeps working) and
// is copied to Haddad by the replica worker (haddad-replica.js). Once Haddad holds it, this module sends the record's
// metadata to the receiver, which files it under <root>/<YYYY>/<MM>/<vehicle-photos|carte-grise>/ (a hard link + a
// .json) and answers with the relative path. For a carte grise the receiver also submits it to LENS on Haddad; this
// module reads back the LENS status and the TECHNICAL fields only (the receiver never returns holder data).
//
//   record(o)                 a new record (+ the Haddad copy is enqueued)
//   linkScan(mediaId, o)      a scanner photograph became a vehicle photograph: same record, now with its vehicle
//   refreshPhoto(documentId)  a person corrected a photograph's date or place: the record (and Haddad's .json) follow
//   refreshScan(mediaId)      the scanner page sent the location / date after the upload
//   removed(key)              the file was deleted (an expired anonymous photograph): its records say so
//   history(vehicleId)        { photos: [...], carte_grise: [...] }, newest first, with the vehicle's VIN when known
//   pass()                    background: metadata to Haddad, LENS status back
// =====================================================

var db = require('../db.js');
var replica = require('../replica/haddad-replica.js');

var CATEGORIES = ['vehicle-photos', 'carte-grise'];
var FINAL_LENS = ['succeeded', 'needs_review', 'failed', 'not_configured', 'submit_failed', 'cancelled'];

function sourceOf(actor) {
  var k = actor && actor.principal && actor.principal.kind;
  return k === 'public' ? 'public_scanner' : k === 'organisation' ? 'workshop' : 'admin';
}
function who(actor) { return sourceOf(actor) === 'public_scanner' ? null : String(actor && actor.identity || '').slice(0, 80) || null; }
function iso(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }

async function hasTable() { return (await db.query("SELECT to_regclass('public.idauto_media_archive') IS NOT NULL t")).rows[0].t; }

// o: { object_key, category, vehicle_id?, document_id?, scan_media_id?, actor, captured_at?, latitude?, longitude?,
//      location_source?, place_name?, mime_type, original_filename?, sha256, byte_size? }
async function record(o) {
  if (CATEGORIES.indexOf(o.category) === -1 || !/^[a-f0-9]{64}$/.test(String(o.object_key || ''))) throw new Error('archive.record: bad category or key');
  if (!(await hasTable())) return null;
  var lat = typeof o.latitude === 'number' ? o.latitude : null, lon = typeof o.longitude === 'number' ? o.longitude : null;
  if (lat === null || lon === null) lat = lon = null;
  var conflict = o.document_id ? ' ON CONFLICT (document_id) WHERE document_id IS NOT NULL DO NOTHING' : o.scan_media_id ? ' ON CONFLICT (scan_media_id) WHERE scan_media_id IS NOT NULL DO NOTHING' : '';
  var r = await db.query(
    'INSERT INTO idauto_media_archive (object_key, category, vehicle_id, document_id, scan_media_id, source, uploaded_by, captured_at, latitude, longitude, location_source, place_name, mime_type, original_filename, sha256, byte_size) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)' + conflict + ' RETURNING id',
    [o.object_key, o.category, o.vehicle_id || null, o.document_id || null, o.scan_media_id || null, sourceOf(o.actor), who(o.actor), iso(o.captured_at), lat, lon,
      lat === null && o.location_source !== 'manual' ? null : (o.location_source || null), o.place_name ? String(o.place_name).slice(0, 160) : null,
      String(o.mime_type || 'application/octet-stream').slice(0, 50), o.original_filename ? String(o.original_filename).replace(/[\u0000-\u001f\/\\]/g, '_').slice(0, 255) : null,
      o.sha256 || o.object_key, o.byte_size || null]);
  await replica.enqueue(o.object_key).catch(function () {});
  return r.rows[0] ? r.rows[0].id : null;
}

async function linkScan(scanMediaId, o) {
  if (!(await hasTable())) return;
  await db.query("UPDATE idauto_media_archive SET vehicle_id = $2, document_id = coalesce($3, document_id), archive_status = CASE WHEN archive_status = 'removed' THEN 'removed' ELSE 'pending' END, updated_at = NOW() WHERE scan_media_id = $1",
    [scanMediaId, o.vehicle_id, o.document_id || null]);
}
async function refreshPhoto(documentId) {
  if (!(await hasTable())) return;
  await db.query("UPDATE idauto_media_archive a SET captured_at = p.captured_at, latitude = p.latitude, longitude = p.longitude, location_source = p.location_source, " +
    "place_name = coalesce(p.place_name, p.governorate), archive_status = CASE WHEN a.archive_status = 'removed' THEN 'removed' ELSE 'pending' END, updated_at = NOW() " +
    "FROM idauto_vehicle_photos p WHERE p.document_id = $1 AND a.document_id = $1", [documentId]);
}
async function corrected(documentId, actor) {
  await refreshPhoto(documentId);
  if (await hasTable()) await db.query('UPDATE idauto_media_archive SET meta_corrected_by = $2, meta_corrected_at = NOW() WHERE document_id = $1', [documentId, who(actor)]);
}
async function refreshScan(mediaId) {
  if (!(await hasTable())) return;
  await db.query("UPDATE idauto_media_archive a SET captured_at = coalesce(s.captured_at, a.captured_at), latitude = s.latitude, longitude = s.longitude, location_source = s.location_source, " +
    "place_name = coalesce(s.place_name, s.governorate), archive_status = CASE WHEN a.archive_status = 'removed' THEN 'removed' ELSE 'pending' END, updated_at = NOW() " +
    "FROM idauto_scan_photos s WHERE s.media_id = $1 AND a.scan_media_id = $1", [mediaId]);
}
async function removed(key) {
  if (!(await hasTable())) return;
  await db.query("UPDATE idauto_media_archive SET archive_status = 'removed', updated_at = NOW() WHERE object_key = $1", [key]);
}

async function vinOf(vehicleId) {
  if (!vehicleId) return null;
  var r = await db.query("SELECT fact_value FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND fact_key = 'vin' AND is_active = TRUE ORDER BY id DESC LIMIT 1", [vehicleId]);
  return r.rows[0] ? String(r.rows[0].fact_value).toUpperCase() : null;
}

// The vehicle's archive, newest first. Admin (or the vehicle's workshops, by the caller's own rule) only: never public.
async function history(vehicleId) {
  var out = { vin_known: !!(await vinOf(vehicleId)), photos: [], carte_grise: [] };   // the VIN itself is disclosed only through the audited fiche route
  if (!(await hasTable())) return out;
  var rows = (await db.query(
    'SELECT a.id, a.category, a.document_id, a.source, a.uploaded_by, a.uploaded_at, a.captured_at, a.latitude, a.longitude, a.location_source, a.place_name, a.mime_type, a.original_filename, ' +
    'a.sha256, a.byte_size, a.archive_path, a.archive_status, a.lens_status, a.lens_fields, a.meta_corrected_by, a.meta_corrected_at, d.face, d.version, d.superseded_at, d.document_type ' +
    'FROM idauto_media_archive a LEFT JOIN idauto_vehicle_documents d ON d.id = a.document_id WHERE a.vehicle_id = $1 ORDER BY a.uploaded_at DESC, a.id DESC LIMIT 500', [vehicleId])).rows;
  rows.forEach(function (r) {
    var item = { id: String(r.id), document_id: r.document_id ? String(r.document_id) : null, source: r.source, uploaded_by: r.uploaded_by, uploaded_at: r.uploaded_at, captured_at: r.captured_at,
      location: r.latitude !== null ? { latitude: r.latitude, longitude: r.longitude, source: r.location_source, place_name: r.place_name } : r.place_name ? { source: r.location_source, place_name: r.place_name } : null,
      mime_type: r.mime_type, original_filename: r.original_filename, sha256: r.sha256, byte_size: r.byte_size,
      archive: { status: r.archive_status, path: r.archive_path }, corrected: r.meta_corrected_at ? { by: r.meta_corrected_by, at: r.meta_corrected_at } : null };
    if (r.category === 'carte-grise') { item.face = r.face; item.version = r.version; item.current = !r.superseded_at; item.lens = { status: r.lens_status, fields: Array.isArray(r.lens_fields) ? r.lens_fields.map(function (f) { return f.key === 'vin' || f.key === 'plate_tn' ? { key: f.key, value: null, read: !!f.value, state: f.state, confidence: f.confidence } : f; }) : null }; out.carte_grise.push(item); }   // the VIN read by LENS is disclosed through the audited fiche, not here
    else { item.lens = null; out.photos.push(item); }
  });
  return out;
}

// ---- background: metadata to Haddad, LENS status back ---------------------------------------------------------------
async function sendOne(cfg, row) {
  var v = row.vehicle_id ? (await db.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [row.vehicle_id])).rows[0] : null;
  var meta = { category: row.category, uploaded_at: iso(row.uploaded_at), captured_at: iso(row.captured_at), latitude: row.latitude, longitude: row.longitude, location_source: row.location_source,
    place_name: row.place_name, mime_type: row.mime_type, original_filename: row.original_filename, source: row.source, uploaded_by: row.uploaded_by,
    vehicle: v ? { ivid: v.ivid, vin: await vinOf(row.vehicle_id) } : null,
    archive_id: String(row.id), record: row.document_id ? { kind: row.category === 'carte-grise' ? 'carte_grise' : 'vehicle_photo', id: String(row.document_id), version: row.version || null } : row.scan_media_id ? { kind: 'scan', id: String(row.scan_media_id) } : null };
  var r = await replica.request(cfg, 'POST', '/objects/' + row.object_key + '/archive', meta);
  if (r.status === 200 && r.json && typeof r.json.path === 'string') {
    await db.query("UPDATE idauto_media_archive SET archive_status = 'stored', archive_path = $2, archive_error = NULL, updated_at = NOW() WHERE id = $1", [row.id, r.json.path]);
    return true;
  }
  await db.query("UPDATE idauto_media_archive SET archive_status = 'failed', archive_error = $2, updated_at = NOW() WHERE id = $1", [row.id, 'HTTP ' + r.status]);
  return false;
}
async function lensOne(cfg, row) {
  var r = await replica.request(cfg, 'GET', '/objects/' + row.object_key + '/lens?record=' + row.id);
  if (r.status !== 200 || !r.json) { await db.query('UPDATE idauto_media_archive SET updated_at = NOW() WHERE id = $1', [row.id]); return false; }
  var fields = Array.isArray(r.json.fields) ? r.json.fields.slice(0, 20).map(function (f) { return { key: String(f.key).slice(0, 40), value: f.value === null ? null : String(f.value).slice(0, 80), state: f.state ? String(f.state).slice(0, 20) : null, confidence: typeof f.confidence === 'number' ? f.confidence : null }; }) : null;
  await db.query('UPDATE idauto_media_archive SET lens_status = $2, lens_job_ref = coalesce($3, lens_job_ref), lens_fields = coalesce($4, lens_fields), updated_at = NOW() WHERE id = $1',
    [row.id, String(r.json.status || 'unknown').slice(0, 20), r.json.job_id ? String(r.json.job_id).slice(0, 128) : null, fields ? JSON.stringify(fields) : null]);
  return true;
}
async function pass() {
  var cfg = replica.config();
  if (!cfg.enabled || !(await hasTable())) return 0;
  // metadata: only once Haddad holds the file; a failed send waits a minute before the next try
  var rows = (await db.query("SELECT a.*, d.version FROM idauto_media_archive a JOIN idauto_media_replicas r ON r.object_key = a.object_key AND r.target = $1 AND r.status = 'stored' " +
    "LEFT JOIN idauto_vehicle_documents d ON d.id = a.document_id WHERE a.archive_status = 'pending' OR (a.archive_status = 'failed' AND a.updated_at < NOW() - interval '1 minute') ORDER BY a.id LIMIT 20", [replica.TARGET])).rows, n = 0;
  for (var i = 0; i < rows.length; i++) { try { if (await sendOne(cfg, rows[i])) n++; } catch (e) { await db.query("UPDATE idauto_media_archive SET archive_status = 'failed', archive_error = $2, updated_at = NOW() WHERE id = $1", [rows[i].id, String(e.message || e).slice(0, 200)]); } }
  var lens = (await db.query("SELECT id, object_key FROM idauto_media_archive WHERE category = 'carte-grise' AND archive_status = 'stored' AND (lens_status IS NULL OR NOT (lens_status = ANY($1::text[]))) ORDER BY updated_at LIMIT 10", [FINAL_LENS])).rows;
  for (var j = 0; j < lens.length; j++) { try { await lensOne(cfg, lens[j]); } catch (e) { /* the next pass asks again */ } }
  // Update 6 — a carte grise received without a vehicle: its LENS result goes to the document (review screen)
  try { await require('../documents/carte-grise-intake.js').syncFromArchive(); } catch (e) { /* the next pass tries again */ }
  return n;
}

module.exports = { record: record, linkScan: linkScan, refreshPhoto: refreshPhoto, corrected: corrected, refreshScan: refreshScan, removed: removed, history: history, pass: pass, vinOf: vinOf, CATEGORIES: CATEGORIES, sourceOf: sourceOf };
