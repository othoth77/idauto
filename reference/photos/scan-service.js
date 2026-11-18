'use strict';
// =====================================================
// IDauto — Update 3.1 — « Scanner la plaque »: a photograph is saved the moment it is taken.
// reference/photos/scan-service.js
//
// One service for both doors (the signed-in workshop and, when the owner enables it, an anonymous
// visitor of the homepage). It reuses what exists:
//   · the file goes to the private, content-addressed media store (documents/document-storage.js) and is
//     recorded as an OBSERVATION with its ORIGINAL IMAGE (idauto_observations / idauto_observation_media,
//     tables the nightly off-host backup already covers) — stored before anything is recognised;
//   · a second copy goes to Haddad (replica/haddad-replica.js);
//   · the analysis and the location arrive afterwards (update), rebuilt field by field (photo-clean.js);
//   · « save » registers the vehicle through the EXISTING registration service, « attach » turns the same
//     file into a vehicle photograph through the EXISTING photo service (no copy of the file).
// The page holds an unguessable token, nothing else. Nothing here returns a vehicle's data.
// =====================================================

var crypto = require('crypto');
var db = require('../db.js');
var errors = require('../vehicle/errors.js');
var imageMeta = require('../documents/image-meta.js');
var storageModule = require('../documents/document-storage.js');
var documentRepository = require('../documents/document-repository.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var clean = require('./photo-clean.js');
var photos = require('./photo-service.js');
var archive = require('../archive/archive-service.js');
var replica = require('../replica/haddad-replica.js');
var geo = require('./tn-geo.js');

var LIMITS = { max_bytes: 8 * 1024 * 1024, min_edge: 200, max_edge: 8000 };
var ANON_RETENTION_DAYS = 30;

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function isAnon(actor) { return !!(actor.principal && actor.principal.kind === 'public'); }
function newToken() { return crypto.randomBytes(24).toString('base64url'); }

function inspect(bytes) {
  if (!bytes || !bytes.length) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'empty' });
  if (bytes.length > LIMITS.max_bytes) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large', max_bytes: LIMITS.max_bytes }), { httpStatus: 413 });
  var meta = imageMeta.inspect(bytes);
  if (!meta) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'not_an_image' }), { httpStatus: 415 });
  if (meta.width < LIMITS.min_edge && meta.height < LIMITS.min_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_small' });
  if (meta.width > LIMITS.max_edge || meta.height > LIMITS.max_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large_dimensions' });
  return meta;
}

// coordinates are resolved here, offline; the person may later correct the NAME
function locationColumns(loc) { return photos.locationColumns(loc); }

async function row(token, actor) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(String(token || ''))) throw errors.IdautoError('NOT_FOUND');
  var r = (await db.query('SELECT s.*, m.object_key, m.mime_type, m.file_size_bytes, m.width_px, m.height_px, m.image_hash, m.retention_status FROM idauto_scan_photos s JOIN idauto_observation_media m ON m.id = s.media_id WHERE s.token = $1', [token])).rows[0];
  if (!r || r.retention_status !== 'active') throw errors.IdautoError('NOT_FOUND');
  // the token is the key; a workshop additionally sees only its own scans, an anonymous visitor only anonymous ones
  var org = orgOf(actor);
  if (isAnon(actor) ? r.org_id !== null : (org && r.org_id !== org)) throw errors.IdautoError('NOT_FOUND');
  return r;
}

async function view(r) {
  var st = await replica.status([r.object_key]).catch(function () { return {}; });
  var loc = r.location_source ? { source: r.location_source, latitude: r.latitude, longitude: r.longitude, place_name: r.place_name, governorate: r.governorate, country: r.country } : null;
  return { token: r.token, saved: true, stored_at: r.created_at, byte_size: r.file_size_bytes, width: r.width_px, height: r.height_px, sha256: r.image_hash,
    haddad: st[r.object_key] || 'not_configured', view: r.view, captured_at: r.captured_at, location: loc, analysis_status: r.analysis_status,
    analysis: r.analysis || null, confirmed: r.confirmed, attached: !!r.attached_document_id, expires_at: r.expires_at };
}

// purge: anonymous photographs never attached to a vehicle, past their date (a few per call, cheap)
async function purgeExpired() {
  var due = (await db.query("SELECT s.media_id, m.object_key FROM idauto_scan_photos s JOIN idauto_observation_media m ON m.id = s.media_id WHERE s.expires_at < NOW() AND s.attached_document_id IS NULL AND m.retention_status = 'active' LIMIT 20")).rows;
  for (var i = 0; i < due.length; i++) {
    var key = due[i].object_key;
    await db.query("UPDATE idauto_observation_media SET retention_status = 'deleted' WHERE id = $1", [due[i].media_id]);
    // the file goes only when nothing else still uses it (another scan, a vehicle photograph, a document)
    var refs = await documentRepository.referencesOfKey(key, 0);
    var gone = (await db.query("SELECT count(*)::int n FROM idauto_observation_media WHERE object_key = $1 AND retention_status = 'deleted'", [key])).rows[0].n;
    if (refs - gone === 0) { await storageModule.getStorage().remove(key).catch(function () {}); await replica.forget(key).catch(function () {}); }
  }
  return due.length;
}

// create(bytes, rawMeta, actor) — the photograph is stored FIRST; meta may carry capture date and location already
async function create(bytes, rawMeta, actor, ctx) {
  ctx = ctx || {};
  var meta = inspect(bytes), m = clean.photoMeta(rawMeta), org = orgOf(actor), anon = isAnon(actor);
  var sha = crypto.createHash('sha256').update(bytes).digest('hex');
  var storage = storageModule.getStorage(), stored = await storage.put(bytes, meta.mime), token = newToken(), loc = locationColumns(m.location), out = null;
  try {
    var source = (await db.query('SELECT id FROM idauto_capture_sources WHERE code = $1 AND active = TRUE', [anon ? 'PUBLIC_UPLOAD' : 'PROFESSIONAL_SCAN'])).rows[0];
    if (!source) throw Object.assign(errors.IdautoError('FORBIDDEN', { reason: 'capture_source_inactive' }), { httpStatus: 403 });   // the capture source is the kill switch, as for ingestion
    var client = await db.getClientForTransaction();
    try {
      await client.query('BEGIN');
      var obs = (await client.query("INSERT INTO idauto_observations (capture_source_id, capture_method, capture_time, status, ip_hash) VALUES ($1, 'vehicle_scan', $2, 'pending_review', $3) RETURNING id",
        [source.id, m.captured_at || new Date().toISOString(), anon ? ctx.ip_hash || null : null])).rows[0];
      var media = (await client.query("INSERT INTO idauto_observation_media (observation_id, media_type, object_key, mime_type, width_px, height_px, file_size_bytes, image_hash, access_scope) VALUES ($1,'original_image',$2,$3,$4,$5,$6,$7,'mythos_private') RETURNING id",
        [obs.id, stored.key, meta.mime, meta.width, meta.height, bytes.length, sha])).rows[0];
      await client.query('INSERT INTO idauto_scan_photos (media_id, observation_id, token, org_id, actor_ref, view, captured_at, latitude, longitude, place_name, governorate, country, location_source, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [media.id, obs.id, token, org, String(actor.identity || 'public').slice(0, 80), m.view, m.captured_at, loc.latitude, loc.longitude, loc.place_name, loc.governorate, loc.country, loc.location_source,
          anon ? new Date(Date.now() + ANON_RETENTION_DAYS * 86400000).toISOString() : null]);
      await client.query('INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, org_id, target_type, target_ref, change_summary) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        ['scan_photo.store', anon ? 'anonymous' : org ? 'professional_user' : 'admin', String(actor.identity || 'public').slice(0, 64), org, 'idauto_observations', String(obs.id), 'photograph saved at capture (' + bytes.length + ' bytes, location ' + (loc.location_source || 'unknown') + ')']);
      await client.query('COMMIT');
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  } catch (err) {
    if (await documentRepository.referencesOfKey(stored.key, 0) === 0) await storage.remove(stored.key);
    throw err;
  }
  await replica.enqueue(stored.key).catch(function () {});
  // Update 4 — the monthly archive record of this photograph (vehicle unknown until it is attached)
  var mediaRow = (await db.query('SELECT media_id FROM idauto_scan_photos WHERE token = $1', [token])).rows[0];
  if (mediaRow) await archive.record({ object_key: stored.key, category: 'vehicle-photos', scan_media_id: mediaRow.media_id, actor: actor, captured_at: m.captured_at,
    latitude: loc.latitude, longitude: loc.longitude, location_source: loc.location_source, place_name: loc.place_name || loc.governorate,
    mime_type: meta.mime, original_filename: ctx && ctx.original_filename, sha256: stored.key, byte_size: bytes.length }).catch(function () {});
  if (anon) purgeExpired().catch(function () {});
  return view(await row(token, actor));
}

// update(token, patch, actor): the analysis result, the view, the location, the confirmation
async function update(token, raw, actor) {
  var r = await row(token, actor), sets = [], params = [r.media_id];
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  function set(col, val) { params.push(val); sets.push(col + ' = $' + params.length); }
  if ('analysis' in raw) { var a = clean.analysis(raw.analysis); set('analysis', a ? JSON.stringify(a) : null); set('analysis_status', a ? 'done' : 'failed'); }
  else if (raw.analysis_status === 'failed') set('analysis_status', 'failed');
  if (clean.VIEWS.indexOf(raw.view) !== -1) set('view', raw.view);
  if (raw.confirmed === true || raw.confirmed === false) set('confirmed', raw.confirmed);
  if ('location' in raw) { var loc = locationColumns(raw.location === null ? null : clean.location(raw.location)); Object.keys(loc).forEach(function (k) { set(k, loc[k]); }); }
  if ('captured_at' in raw && !r.captured_at) set('captured_at', clean.capturedAt(raw.captured_at));
  if (sets.length) await db.query('UPDATE idauto_scan_photos SET ' + sets.join(', ') + ', updated_at = NOW() WHERE media_id = $1', params);
  if (sets.length) await archive.refreshScan(r.media_id).catch(function () {});
  var after = await row(token, actor);
  if (after.analysis && after.analysis.plate && after.analysis.plate.serie) {
    var parsed = plateNormalizer.parsePlate(after.analysis.plate.serie + ' TUN ' + after.analysis.plate.numero);
    if (parsed.ok) await db.query('UPDATE idauto_observations SET plate_candidate = $2, plate_normalised = $3, ocr_confidence = $4 WHERE id = $1', [after.observation_id, after.analysis.plate.text || null, parsed.canonical, after.analysis.plate.confidence === null ? null : after.analysis.plate.confidence / 100]);
  }
  return view(after);
}

function metaForPhoto(r) {
  return { view: r.view, captured_at: r.captured_at, confirmed: true, analysis: r.analysis || null, confidence: r.analysis && r.analysis.plate && typeof r.analysis.plate.confidence === 'number' ? r.analysis.plate.confidence / 100 : null,
    location: r.location_source ? { source: r.location_source, latitude: r.latitude, longitude: r.longitude, place_name: r.place_name, governorate: r.governorate, country: r.country } : null };
}

// attach(token, vehicleRef, actor): the SAME file becomes a photograph of that vehicle (no copy, no duplicate)
async function attach(token, vehicleRef, actor) {
  var r = await row(token, actor);
  var vehicle = await photos.vehicleFor(vehicleRef);
  if (r.attached_document_id) return { vehicle: vehicle.ivid, already: true };
  var file = { key: r.object_key, sha256: r.image_hash, mime: r.mime_type, byte_size: r.file_size_bytes, width: r.width_px, height: r.height_px };
  var out = await photos.addStored(vehicle, file, metaForPhoto(r), actor, { from: 'scan', inTransaction: async function (client, docId) {
    await client.query('UPDATE idauto_scan_photos SET vehicle_id = $2, attached_document_id = $3, confirmed = TRUE, expires_at = NULL, updated_at = NOW() WHERE media_id = $1', [r.media_id, vehicle.id, docId]);
    await client.query('UPDATE idauto_observations SET vehicle_id = $2 WHERE id = $1', [r.observation_id, vehicle.id]);
  } });
  if (out.duplicate) await db.query('UPDATE idauto_scan_photos SET vehicle_id = $2, attached_document_id = $3, expires_at = NULL, updated_at = NOW() WHERE media_id = $1', [r.media_id, vehicle.id, out.photo.id]);
  await archive.linkScan(r.media_id, { vehicle_id: vehicle.id, document_id: out.duplicate ? null : out.photo.id }).catch(function () {});
  return { vehicle: vehicle.ivid, attached: true, duplicate: out.duplicate };
}

// The vehicle of a confirmed plate: { exists, ivid } — for an anonymous caller only what the public plate route already reveals.
async function plateOwner(serie, numero) {
  var parsed = plateNormalizer.parsePlate(String(serie) + ' TUN ' + String(numero));
  if (!parsed.ok) throw errors.IdautoError('VALIDATION', { field: 'plate' });
  var hit = await vehicleRepository.findByPlate(parsed.canonical);
  return { canonical: parsed.canonical, plate: { type: 'TU', series: String(serie), number: String(numero) }, vehicle: hit ? hit.vehicle : null };
}

// checks that the token names a live, unattached scan of this caller — BEFORE anything is created for it
async function assertUsable(token, actor) { var r = await row(token, actor); if (r.attached_document_id) throw errors.IdautoError('CONFLICT', { reason: 'scan_already_attached' }); return true; }

module.exports = { assertUsable: assertUsable, create: create, update: update, get: async function (t, a) { return view(await row(t, a)); }, attach: attach, plateOwner: plateOwner, purgeExpired: purgeExpired, LIMITS: LIMITS, ANON_RETENTION_DAYS: ANON_RETENTION_DAYS };
