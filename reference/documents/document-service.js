'use strict';
// =====================================================
// IDauto — IDA-V14 — registration document service
// reference/documents/document-service.js
//
//   store(vehicleRef, face, bytes, headers, actor)   → face metadata (replaces an existing face)
//   list(vehicleRef, actor)                          → { faces: { 1, 2 }, ocr }
//   image(vehicleRef, face, variant, actor)          → { bytes, mime } (authenticated route only)
//   remove(vehicleRef, face, actor)
//   ocr(vehicleRef, { faces:[{face,text,confidence}] }, actor) → parsed technical fields, proposals, conflicts
//
// Rules: bytes are sniffed (MIME + dimensions) — the client's Content-Type
// and filename are ignored; keys are generated (sha256); the raw OCR text is
// parsed in memory and never stored or logged; only TECHNICAL fields are
// kept; nothing is written to the vehicle here — the proposals go through
// resolver.confirm(), the single write path, after the person confirms.
// =====================================================

var crypto = require('crypto');
var errors = require('../vehicle/errors.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vinModule = require('../vehicle/vin.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var repo = require('./document-repository.js');
var imageMeta = require('./image-meta.js');
var storageModule = require('./document-storage.js');
var parser = require('./registration-parser.js');
var observability = require('../observability.js');

var LIMITS = {
  max_bytes: parseInt(process.env.IDAUTO_DOCUMENT_MAX_BYTES || String(6 * 1024 * 1024), 10),   // the browser pipeline targets a few hundred KB
  max_thumb_bytes: 512 * 1024,
  min_edge: 400, max_edge: 5000,
  faces: [1, 2]
};

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }

async function vehicleFor(ref) {
  var row = await vehicleRepository.findByRef(String(ref || ''));
  if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  return row;
}

function faceNo(v) { var n = parseInt(v, 10); if (LIMITS.faces.indexOf(n) === -1) throw errors.IdautoError('VALIDATION', { field: 'face', allowed: LIMITS.faces }); return n; }

function inspectImage(bytes, maxBytes) {
  if (!bytes || !bytes.length) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'empty' });
  if (bytes.length > maxBytes) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large', max_bytes: maxBytes }), { httpStatus: 413 });
  var meta = imageMeta.inspect(bytes);
  if (!meta) throw Object.assign(errors.IdautoError('VALIDATION', { field: 'image', reason: 'not_an_image' }), { httpStatus: 415 });
  if (meta.width < LIMITS.min_edge && meta.height < LIMITS.min_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_small', min_edge: LIMITS.min_edge });
  if (meta.width > LIMITS.max_edge || meta.height > LIMITS.max_edge) throw errors.IdautoError('VALIDATION', { field: 'image', reason: 'too_large_dimensions', max_edge: LIMITS.max_edge });
  return meta;
}

function view(row) {
  if (!row) return null;
  return { face: row.face, mime_type: row.mime_type, byte_size: row.byte_size, width: row.width, height: row.height, sha256: row.sha256,
    original_byte_size: row.original_byte_size, capture: row.capture_meta || null, has_thumbnail: !!row.thumb_storage_key,
    ocr: { status: row.ocr_status, confidence: row.ocr_confidence, fields: row.ocr_fields || null, at: row.ocr_at },
    created_at: row.created_at, updated_at: row.updated_at, org_id: row.org_id };
}

// `bytes` = the optimised image; `thumbBytes` optional; `opts` = { original_byte_size, capture }
async function store(vehicleRef, face, bytes, thumbBytes, opts, actor) {
  var obs = observability.shared();
  var vehicle = await vehicleFor(vehicleRef);
  var f = faceNo(face);
  // Face 2 is optional but never alone: the verso of nothing is not a document.
  if (f === 2 && !(await repo.face(vehicle.id, 1, actor.principal))) throw errors.IdautoError('CONFLICT', { reason: 'face_1_required_first' });
  var meta = inspectImage(bytes, LIMITS.max_bytes);
  var thumbMeta = null;
  if (thumbBytes && thumbBytes.length) thumbMeta = inspectImage(thumbBytes, LIMITS.max_thumb_bytes);
  var storage = storageModule.getStorage();
  var stored = await storage.put(bytes, meta.mime);
  var thumb = thumbMeta ? await storage.put(thumbBytes, thumbMeta.mime) : null;
  var capture = opts && opts.capture && typeof opts.capture === 'object' ? {
    detection: ['auto', 'manual', 'none'].indexOf(opts.capture.detection) !== -1 ? opts.capture.detection : 'none',
    format: meta.mime, quality: typeof opts.capture.quality === 'number' ? opts.capture.quality : null, max_edge: typeof opts.capture.max_edge === 'number' ? opts.capture.max_edge : null
  } : null;
  var result;
  try {
    result = await repo.upsertFace(vehicle.id, f, {
      storage_key: stored.key, thumb_storage_key: thumb ? thumb.key : null, mime_type: meta.mime, byte_size: bytes.length, width: meta.width, height: meta.height,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), original_byte_size: opts && opts.original_byte_size > 0 ? opts.original_byte_size : null, capture_meta: capture
    }, actor);
  } catch (err) {
    // Nothing references the fresh bytes: remove them so a refused upload leaves no file behind.
    if (await repo.referencesOfKey(stored.key, 0) === 0) await storage.remove(stored.key);
    if (thumb && await repo.referencesOfKey(thumb.key, 0) === 0) await storage.remove(thumb.key);
    if (err && err.httpStatus === 404) throw errors.IdautoError('NOT_FOUND');
    throw err;
  }
  // The replaced face's bytes go once no row references them any more.
  if (result.replaced) {
    var keys = [result.replaced.storage_key, result.replaced.thumb_storage_key].filter(Boolean);
    for (var i = 0; i < keys.length; i++) if (await repo.referencesOfKey(keys[i], 0) === 0) await storage.remove(keys[i]);
  }
  obs.inc('document_uploads'); obs.observe('document_bytes', bytes.length);
  obs.event('registration_document_stored', { ivid: vehicle.ivid, face: f, bytes: bytes.length, width: meta.width, height: meta.height, replaced: !!result.replaced, detection: capture ? capture.detection : null });
  return { vehicle: vehicle.ivid, face: view(result.row), replaced: !!result.replaced };
}

// A separate, optional thumbnail for an already-stored face (≤ 512 KB).
async function setThumbnail(vehicleRef, face, bytes, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var f = faceNo(face);
  var row = await repo.face(vehicle.id, f, actor.principal);
  if (!row) throw errors.IdautoError('NOT_FOUND', { reason: 'face_not_stored' });
  var meta = inspectImage(bytes, LIMITS.max_thumb_bytes);
  var storage = storageModule.getStorage();
  var stored = await storage.put(bytes, meta.mime);
  var updated = await repo.setThumbnail(row.id, stored.key, actor);
  if (row.thumb_storage_key && row.thumb_storage_key !== stored.key && await repo.referencesOfKey(row.thumb_storage_key, 0) === 0) await storage.remove(row.thumb_storage_key);
  return { vehicle: vehicle.ivid, face: f, thumbnail: { width: meta.width, height: meta.height, byte_size: bytes.length }, id: updated.id };
}

async function list(vehicleRef, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var rows = await repo.facesOf(vehicle.id, actor.principal);
  var faces = { 1: null, 2: null };
  rows.forEach(function (r) { faces[r.face] = view(r); });
  var ocrRows = rows.filter(function (r) { return r.ocr_fields; });
  return { vehicle: vehicle.ivid, faces: faces, has_document: !!faces[1], ocr: ocrRows.length ? { status: ocrRows.map(function (r) { return r.ocr_status; }).indexOf('confirmed') !== -1 ? 'confirmed' : 'extracted', confidence: Math.max.apply(null, ocrRows.map(function (r) { return r.ocr_confidence || 0; })), fields: mergeStoredFields(ocrRows) } : null };
}
function mergeStoredFields(rows) {
  var out = {};
  rows.forEach(function (r) { (r.ocr_fields.fields || []).forEach(function (f) { if (!out[f.key] || out[f.key].confidence < f.confidence) out[f.key] = f; }); });
  return Object.keys(out).map(function (k) { return out[k]; });
}

async function image(vehicleRef, face, variant, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var row = await repo.face(vehicle.id, faceNo(face), actor.principal);
  if (!row) throw errors.IdautoError('NOT_FOUND');
  var key = variant === 'thumb' && row.thumb_storage_key ? row.thumb_storage_key : row.storage_key;
  var bytes = await storageModule.getStorage().get(key);
  if (!bytes) throw errors.IdautoError('NOT_FOUND');
  observability.shared().event('registration_document_read', { ivid: vehicle.ivid, face: row.face, variant: variant === 'thumb' ? 'thumb' : 'archive' });
  return { bytes: bytes, mime: row.mime_type, sha256: row.sha256 };
}

async function remove(vehicleRef, face, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var f = faceNo(face);
  var out;
  try { out = await repo.deleteFace(vehicle.id, f, actor); }
  catch (err) { if (err && err.httpStatus === 404) throw errors.IdautoError('NOT_FOUND'); throw err; }
  var storage = storageModule.getStorage();
  var keys = [out.deleted.storage_key, out.deleted.thumb_storage_key].filter(Boolean);
  for (var i = 0; i < keys.length; i++) if (await repo.referencesOfKey(keys[i], 0) === 0) await storage.remove(keys[i]);
  observability.shared().event('registration_document_deleted', { ivid: vehicle.ivid, face: f });
  return { vehicle: vehicle.ivid, face: f, deleted: true };
}

// Compare the OCR proposal with the vehicle's current record. Never writes.
function compare(candidate, current, currentVin) {
  var items = [], conflicts = 0;
  function push(key, proposed, existing, same) {
    var status = existing === null || existing === undefined || existing === '' ? 'new' : same ? 'same' : 'conflict';
    if (status === 'conflict') conflicts++;
    items.push({ key: key, proposed: proposed, current: existing === undefined ? null : existing, status: status });
  }
  Object.keys(candidate).forEach(function (k) {
    var p = candidate[k];
    if (k === 'plate') { var pp = plateNormalizer.parsePlate(String(p)); var cur = current.plate || null; push('plate', pp.ok ? pp.canonical : p, cur, !!(pp.ok && cur && pp.canonical === cur)); return; }
    if (k === 'vin') { var pv = vinModule.validate(String(p)); push('vin', pv.ok ? pv.vin : p, currentVin ? (current.vin === undefined ? '(présent)' : currentVin) : null, !!(pv.ok && currentVin && pv.vin === currentVin)); return; }
    var map = { manufacturer: 'manufacturer', model: 'model', year: 'year', fuel_type: 'fuel_type', engine_cc: 'engine_cc', seats: 'seats', gross_weight_kg: 'gross_weight_kg', category_code: 'category_code', engine_code: 'engine_code' };
    if (!map[k]) return;
    var cv = current[map[k]];
    var same = cv !== null && cv !== undefined && String(cv).trim().toUpperCase() === String(p).trim().toUpperCase();
    push(k, p, cv === undefined ? null : cv, same);
  });
  return { items: items, conflicts: conflicts };
}

// input.faces = [{ face, text, confidence }] — text is parsed in memory only.
async function ocr(vehicleRef, input, actor) {
  var obs = observability.shared();
  var vehicle = await vehicleFor(vehicleRef);
  var faces = Array.isArray(input && input.faces) ? input.faces : [];
  if (!faces.length) throw errors.IdautoError('VALIDATION', { required: ['faces[] with face and text'] });
  faces = faces.map(function (f) { return { face: faceNo(f.face), text: typeof f.text === 'string' ? f.text.slice(0, 20000) : '', confidence: typeof f.confidence === 'number' ? f.confidence : undefined }; });
  var rows = await repo.facesOf(vehicle.id, actor.principal);
  var byFace = {}; rows.forEach(function (r) { byFace[r.face] = r; });
  if (faces.some(function (f) { return !byFace[f.face]; })) throw errors.IdautoError('NOT_FOUND', { reason: 'face_not_stored' });
  obs.event('registration_ocr_started', { ivid: vehicle.ivid, faces: faces.map(function (f) { return f.face; }) });
  var parsed = parser.parse({ faces: faces });
  var candidate = parser.toIdautoCandidate(parsed);
  var current = await vehicleRepository.record(vehicle, { includeVin: false });
  var currentVin = await vehicleRepository.vinOf(vehicle.id);
  var comparison = compare(candidate, current, currentVin);
  // Store the TECHNICAL extraction (fields + confidences) on each face row; the text is gone when this function returns.
  var stored = { fields: parsed.fields.filter(function (f) { return ['registration', 'manufacturer', 'type', 'genre', 'engine', 'vin', 'year', 'first_registration_date', 'fuel', 'engine_cc', 'seats', 'gross_weight_kg', 'fiscal_power', 'category_code'].indexOf(f.key) !== -1; }), warnings: parsed.warnings };
  for (var i = 0; i < faces.length; i++) {
    var own = { fields: stored.fields.filter(function (f) { return f.source === 'face_' + faces[i].face; }), warnings: parsed.warnings };
    await repo.setOcr(byFace[faces[i].face].id, own.fields.length ? 'extracted' : 'failed', parsed.confidence, own, actor);
  }
  obs.inc('registration_ocr_runs'); obs.observe('registration_ocr_confidence', parsed.confidence);
  obs.event('registration_ocr_done', { ivid: vehicle.ivid, fields: parsed.fields.length, confidence: parsed.confidence, conflicts: comparison.conflicts });
  return {
    vehicle: vehicle.ivid, confidence: parsed.confidence, warnings: parsed.warnings, fields: parsed.fields,
    candidate: candidate, comparison: comparison,
    requires_confirmation: true,   // always: OCR is a proposal
    confirm_with: { method: 'carte_grise_ocr', source: 'carte_grise_ocr', vehicle_ref: vehicle.ivid }
  };
}

// After confirm(): mark the faces' OCR as confirmed (called by the route that wraps resolver.confirm()).
async function markConfirmed(vehicleRef, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  var rows = await repo.facesOf(vehicle.id, actor.principal);
  for (var i = 0; i < rows.length; i++) if (rows[i].ocr_status === 'extracted') await repo.setOcr(rows[i].id, 'confirmed', rows[i].ocr_confidence, rows[i].ocr_fields, actor);
}

module.exports = { store: store, setThumbnail: setThumbnail, list: list, image: image, remove: remove, ocr: ocr, markConfirmed: markConfirmed, compare: compare, LIMITS: LIMITS, inspectImage: inspectImage };
