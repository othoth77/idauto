'use strict';
// =====================================================
// IDauto — Update 3 — vehicle photographs
// reference/photos/photo-service.js
//
// A vehicle photograph = one row of idauto_vehicle_documents (type 'vehicle_photo':
// the key into the private media store, so the nightly backup copies the file like
// any other document) + one row of idauto_vehicle_photos (what a photograph has and
// a document does not: view, capture date, ORIGINAL coordinates, readable location
// and its source, what was recognised on it, whether the person confirmed it).
//
// Rules held here, not in the page:
//   · the location belongs to the photograph. Nothing here writes a location on the vehicle;
//   · coordinates are accepted only with their source (exif | browser); a place typed by
//     the person has no coordinates; an unknown location stays unknown (all NULL);
//   · the same bytes are never stored twice for one vehicle: the existing photograph is returned;
//   · an organisation sees and changes ITS photographs only (same rule as the carte grise);
//   · nothing sent by the browser is stored as it came: every value is rebuilt field by field.
// =====================================================

var crypto = require('crypto');
var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var imageMeta = require('../documents/image-meta.js');
var storageModule = require('../documents/document-storage.js');
var documentRepository = require('../documents/document-repository.js');
var geo = require('./tn-geo.js');
var clean = require('./photo-clean.js');

var LIMITS = { max_bytes: parseInt(process.env.IDAUTO_DOCUMENT_MAX_BYTES || String(6 * 1024 * 1024), 10), min_edge: 200, max_edge: 5000, max_per_vehicle: 40 };
var COLS = 'd.id, d.vehicle_id, d.org_id, d.face, d.storage_key, d.mime_type, d.byte_size, d.width, d.height, d.sha256, d.created_by, d.created_at, ' +
  'p.view, p.captured_at, p.latitude, p.longitude, p.place_name, p.governorate, p.country, p.location_source, p.analysis, p.confidence, p.confirmed, p.updated_at';

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
async function vehicleFor(ref) {
  var row = await vehicleRepository.findByRef(String(ref || ''));
  if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  return row;
}
function inspect(bytes) {
  if (!bytes || !bytes.length) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'empty' });
  if (bytes.length > LIMITS.max_bytes) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large', max_bytes: LIMITS.max_bytes }), { httpStatus: 413 });
  var meta = imageMeta.inspect(bytes);
  if (!meta) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'not_an_image' }), { httpStatus: 415 });
  if (meta.width < LIMITS.min_edge && meta.height < LIMITS.min_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_small', min_edge: LIMITS.min_edge });
  if (meta.width > LIMITS.max_edge || meta.height > LIMITS.max_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large_dimensions', max_edge: LIMITS.max_edge });
  return meta;
}

function view(row) {
  var loc = row.location_source ? { source: row.location_source, latitude: row.latitude, longitude: row.longitude, place_name: row.place_name, governorate: row.governorate, country: row.country } : null;
  return { id: String(row.id), number: row.face, view: row.view, captured_at: row.captured_at, location: loc,
    analysis: row.analysis || null, confidence: row.confidence, confirmed: row.confirmed,
    width: row.width, height: row.height, byte_size: row.byte_size, mime_type: row.mime_type, sha256: row.sha256, org_id: row.org_id, created_at: row.created_at, updated_at: row.updated_at };
}

// Coordinates are resolved HERE, offline (tn-geo.js): the place and governorate sent by the browser for a GPS
// position are kept only when the person edited them; otherwise the server's own answer is stored.
function locationColumns(loc) {
  if (!loc) return { latitude: null, longitude: null, place_name: null, governorate: null, country: null, location_source: null };
  if (loc.source === 'manual') return { latitude: null, longitude: null, place_name: loc.place_name, governorate: loc.governorate, country: loc.country || (loc.governorate ? 'Tunisie' : null), location_source: 'manual' };
  var r = geo.resolve(loc.latitude, loc.longitude) || {};
  return { latitude: loc.latitude, longitude: loc.longitude, place_name: loc.place_name || r.place_name || null, governorate: loc.governorate || r.governorate || null,
    country: loc.country || r.country || null, location_source: loc.source };
}

async function list(vehicleRef, actor) {
  var vehicle = await vehicleFor(vehicleRef), params = [vehicle.id], org = orgOf(actor);
  var vis = org ? (params.push(org), 'd.org_id = $2') : 'TRUE';
  var rows = (await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents d JOIN idauto_vehicle_photos p ON p.document_id = d.id WHERE d.vehicle_id = $1 AND d.document_type = 'vehicle_photo' AND " + vis + ' ORDER BY d.face', params)).rows;
  return { vehicle: vehicle.ivid, photos: rows.map(view) };
}

async function one(vehicle, id, actor, runner) {
  if (!/^\d{1,18}$/.test(String(id))) throw errors.IdautoError('NOT_FOUND');
  var params = [vehicle.id, String(id)], org = orgOf(actor);
  var vis = org ? (params.push(org), 'd.org_id = $3') : 'TRUE';
  var row = (await (runner || db).query('SELECT ' + COLS + " FROM idauto_vehicle_documents d JOIN idauto_vehicle_photos p ON p.document_id = d.id WHERE d.vehicle_id = $1 AND d.id = $2 AND d.document_type = 'vehicle_photo' AND " + vis, params)).rows[0];
  if (!row) throw errors.IdautoError('NOT_FOUND');
  return row;
}

// add(vehicleRef, bytes, rawMeta, actor) → { vehicle, photo, duplicate }
async function add(vehicleRef, bytes, rawMeta, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var meta = inspect(bytes), m = clean.photoMeta(rawMeta), org = orgOf(actor);
  var sha = crypto.createHash('sha256').update(bytes).digest('hex');
  // The same photograph again (same bytes, same vehicle, same workshop): the one already there is the answer.
  var dupParams = [vehicle.id, sha], dupVis = org ? (dupParams.push(org), 'd.org_id = $3') : 'd.org_id IS NULL';
  var existing = (await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents d JOIN idauto_vehicle_photos p ON p.document_id = d.id WHERE d.vehicle_id = $1 AND d.sha256 = $2 AND d.document_type = 'vehicle_photo' AND " + dupVis, dupParams)).rows[0];
  if (existing) return { vehicle: vehicle.ivid, photo: view(existing), duplicate: true };
  var storage = storageModule.getStorage(), stored = await storage.put(bytes, meta.mime), loc = locationColumns(m.location), idOut = null;
  try {
    await writes.withAudit(
      { principal: actor.principal, event_type: 'vehicle_photo.add', target_type: 'idauto_vehicle_documents', change_summary: 'vehicle photograph stored (' + m.view + ', location ' + (loc.location_source || 'unknown') + ')' },
      actor.identity,
      async function (client) {
        await client.query('SELECT id FROM idauto_vehicles WHERE id = $1 FOR UPDATE', [vehicle.id]);      // one numbering at a time per vehicle
        var n = (await client.query("SELECT coalesce(max(face), 0)::int n, count(*)::int c FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'vehicle_photo'", [vehicle.id])).rows[0];
        if (n.c >= LIMITS.max_per_vehicle) throw errors.IdautoError('CONFLICT', { reason: 'too_many_photos', max: LIMITS.max_per_vehicle });
        var doc = (await client.query(
          "INSERT INTO idauto_vehicle_documents (vehicle_id, org_id, document_type, face, storage_key, mime_type, byte_size, width, height, sha256, ocr_status, created_by) VALUES ($1,$2,'vehicle_photo',$3,$4,$5,$6,$7,$8,$9,'none',$10) RETURNING id",
          [vehicle.id, org, n.n + 1, stored.key, meta.mime, bytes.length, meta.width, meta.height, sha, actor.identity])).rows[0];
        await client.query('INSERT INTO idauto_vehicle_photos (document_id, vehicle_id, view, captured_at, latitude, longitude, place_name, governorate, country, location_source, analysis, confidence, confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [doc.id, vehicle.id, m.view, m.captured_at, loc.latitude, loc.longitude, loc.place_name, loc.governorate, loc.country, loc.location_source, m.analysis ? JSON.stringify(m.analysis) : null, m.confidence, m.confirmed]);
        idOut = doc.id;
        return { record: { id: String(doc.id), vehicle_id: vehicle.id, number: n.n + 1, view: m.view, sha256: sha, location_source: loc.location_source }, auditTargetRef: doc.id };
      });
  } catch (err) {
    if (await documentRepository.referencesOfKey(stored.key, 0) === 0) await storage.remove(stored.key);   // a refused upload leaves no file behind
    throw err;
  }
  return { vehicle: vehicle.ivid, photo: view(await one(vehicle, idOut, actor)), duplicate: false };
}

// update(vehicleRef, id, patch, actor): the view, the location, the confirmation — what a person may correct.
async function update(vehicleRef, id, rawPatch, actor) {
  var vehicle = await vehicleFor(vehicleRef), row = await one(vehicle, id, actor), p = clean.photoPatch(rawPatch), sets = [], params = [row.id];
  function set(col, val) { params.push(val); sets.push(col + ' = $' + params.length); }
  if (p.view) set('view', p.view);
  if (p.confirmed !== null) set('confirmed', p.confirmed);
  if (p.captured_at !== undefined) set('captured_at', p.captured_at);
  if (p.location !== undefined) { var loc = locationColumns(p.location); Object.keys(loc).forEach(function (k) { set(k, loc[k]); }); }
  if (!sets.length) return { vehicle: vehicle.ivid, photo: view(row) };
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_photo.update', target_type: 'idauto_vehicle_documents', change_summary: 'vehicle photograph updated: ' + Object.keys(p).filter(function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; }).join(', ') },
    actor.identity,
    async function (client) {
      await client.query('UPDATE idauto_vehicle_photos SET ' + sets.join(', ') + ', updated_at = NOW() WHERE document_id = $1', params);
      return { record: { id: String(row.id), fields: sets.length }, auditTargetRef: row.id };
    });
  return { vehicle: vehicle.ivid, photo: view(await one(vehicle, row.id, actor)) };
}

async function image(vehicleRef, id, actor) {
  var vehicle = await vehicleFor(vehicleRef), row = await one(vehicle, id, actor);
  var bytes = await storageModule.getStorage().get(row.storage_key);
  if (!bytes) throw errors.IdautoError('NOT_FOUND');
  return { bytes: bytes, mime: row.mime_type, sha256: row.sha256 };
}

async function remove(vehicleRef, id, actor) {
  var vehicle = await vehicleFor(vehicleRef), row = await one(vehicle, id, actor);
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_photo.delete', target_type: 'idauto_vehicle_documents', change_summary: 'vehicle photograph deleted' },
    actor.identity,
    async function (client) {
      await client.query("DELETE FROM idauto_vehicle_documents WHERE id = $1 AND document_type = 'vehicle_photo'", [row.id]);    // the photo row goes with it (ON DELETE CASCADE)
      return { record: { id: String(row.id), vehicle_id: vehicle.id, sha256: row.sha256 }, auditTargetRef: row.id };
    });
  if (await documentRepository.referencesOfKey(row.storage_key, 0) === 0) await storageModule.getStorage().remove(row.storage_key);
  return { vehicle: vehicle.ivid, deleted: String(row.id) };
}

module.exports = { add: add, list: list, update: update, image: image, remove: remove, LIMITS: LIMITS, locationColumns: locationColumns };
