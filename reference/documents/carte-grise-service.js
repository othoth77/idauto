'use strict';
// =====================================================
// IDauto — Update 5 — ONE pipeline for every carte grise source document, whatever the input method:
// camera scan, file upload (image or PDF), pasted image, pasted text.
// reference/documents/carte-grise-service.js
//
// CAPTURE AND STORAGE ONLY. No OCR, no parser, no extraction here (owner decision 2026-11-18): the source is
// stored exactly as given and marked PENDING_LENS; the future LENS integration (lens/lens-adapter.js) will read it.
//
//   store(vehicleRef, input, actor, opts) → { vehicle, document, replaced, duplicate_of }
//     input = { bytes: Buffer, content_type, face: 1|2, method: 'camera'|'upload'|'paste_image'|'paste_text',
//               filename?, derived?: Buffer (the corrected crop of a photographed card, JPEG) }
//     opts.public = true → a public deposit: kept for review, never the vehicle's current version
//   history(vehicleRef, actor)  every version of every face, newest first, with statuses
//   original(vehicleRef, id, actor) / derived(...)  the bytes, for authorised readers
//   review(id, decision, actor) an administrator accepts or rejects a public deposit
//
// The file TYPE is decided from the bytes (JPEG / PNG / WebP / PDF magic, or strict UTF-8 for text), never from the
// declared Content-Type alone. The original is never re-encoded: same bytes, same SHA-256.
// =====================================================

var crypto = require('crypto');
var db = require('../db.js');
var errors = require('../vehicle/errors.js');
var imageMeta = require('./image-meta.js');
var repo = require('./document-repository.js');
var storageModule = require('./document-storage.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var archive = require('../archive/archive-service.js');
var lens = require('../lens/lens-adapter.js');

var LIMITS = {
  image_bytes: parseInt(process.env.IDAUTO_CG_IMAGE_MAX_BYTES || String(12 * 1024 * 1024), 10),
  pdf_bytes: parseInt(process.env.IDAUTO_CG_PDF_MAX_BYTES || String(10 * 1024 * 1024), 10),
  text_bytes: 64 * 1024, text_chars_min: 10,
  derived_bytes: 3 * 1024 * 1024,
  min_edge: 300, max_edge: 12000
};
var METHODS = ['camera', 'upload', 'paste_image', 'paste_text'];
var TEXT_MIME = 'text/plain; charset=utf-8';

function bad(reason, status) { return Object.assign(errors.IdautoError('VALIDATION', { reason: reason }), { httpStatus: status || 400 }); }

// what the bytes ARE, independent of what the client said
function classify(bytes, contentType, method) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw bad('empty');
  var ct = String(contentType || '').toLowerCase();
  if (method === 'paste_text' || /^text\/plain/.test(ct)) {
    if (method !== 'paste_text') throw bad('text_only_by_paste');
    if (bytes.length > LIMITS.text_bytes) throw bad('too_large', 413);
    var text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw bad('not_utf8'); }
    if (text.charCodeAt(0) === 0xFEFF) throw bad('bom_not_allowed');         // stored exactly as pasted: no BOM to strip later
    if (/\u0000/.test(text)) throw bad('binary_text');
    var chars = Array.from(text).length;
    if (text.trim().length < LIMITS.text_chars_min) throw bad('too_short');
    return { source_format: 'CARTE_GRISE_TEXT', mime_type: TEXT_MIME, width: 0, height: 0, text_chars: chars };
  }
  if (bytes.length >= 5 && bytes.toString('latin1', 0, 5) === '%PDF-') {
    if (method !== 'upload') throw bad('pdf_only_by_upload');
    if (bytes.length > LIMITS.pdf_bytes) throw bad('too_large', 413);
    if (bytes.slice(-1024).toString('latin1').indexOf('%%EOF') === -1) throw bad('pdf_incomplete');
    if (/\/Encrypt\b/.test(bytes.slice(0, Math.min(bytes.length, 65536)).toString('latin1'))) throw bad('pdf_encrypted');
    return { source_format: 'CARTE_GRISE_PDF', mime_type: 'application/pdf', width: 0, height: 0 };
  }
  var mime = imageMeta.sniff(bytes);
  if (!mime) throw bad('unsupported_type', 415);
  if (method === 'paste_text') throw bad('not_text');
  if (bytes.length > LIMITS.image_bytes) throw bad('too_large', 413);
  var dims = imageMeta.inspect(bytes);
  if (!dims || !dims.width || !dims.height) throw bad('unreadable_image');
  if (Math.min(dims.width, dims.height) < LIMITS.min_edge) throw bad('too_small');
  if (Math.max(dims.width, dims.height) > LIMITS.max_edge) throw bad('too_large_dimensions');
  return { source_format: 'CARTE_GRISE_IMAGE', mime_type: mime, width: dims.width, height: dims.height };
}

async function vehicleFor(ref) {
  var row = await vehicleRepository.findByRef(String(ref || ''));
  if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  return row;
}
function cleanName(n) { if (!n) return null; var s = String(n).replace(/[\u0000-\u001f\/\\]/g, '_').trim().slice(0, 255); return s || null; }

async function store(vehicleRef, input, actor, opts) {
  opts = opts || {};
  var method = METHODS.indexOf(input && input.method) !== -1 ? input.method : null;
  if (!method) throw bad('method');
  var face = Number(input.face) === 2 ? 2 : 1;
  var vehicle = await vehicleFor(vehicleRef);
  var kind = classify(input.bytes, input.content_type, method);
  var sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  // the same document (same bytes) already on this vehicle: say so, store nothing twice
  var dup = (await db.query("SELECT id, face, version, review_status, superseded_at FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND sha256 = $2 AND review_status <> 'rejected' ORDER BY id DESC LIMIT 1", [vehicle.id, sha])).rows[0];
  if (dup) return { vehicle: vehicle.ivid, document: null, duplicate_of: { id: String(dup.id), face: dup.face, version: dup.version, current: !dup.superseded_at && dup.review_status === 'accepted' } };
  // a face 2 alone is not a document (as in IDA-V14) — except a public deposit, which is reviewed anyway
  // (any current recto counts, whoever deposited it — the verso completes the vehicle's document, not the caller's)
  if (face === 2 && !opts.public && !(await db.query("SELECT 1 FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = 1 AND superseded_at IS NULL AND review_status = 'accepted'", [vehicle.id])).rows.length) throw Object.assign(errors.IdautoError('CONFLICT', { reason: 'face_1_required_first' }), { httpStatus: 409 });
  var derivedMeta = null;
  if (input.derived && input.derived.length) {
    if (kind.source_format !== 'CARTE_GRISE_IMAGE') throw bad('derived_only_for_images');
    if (input.derived.length > LIMITS.derived_bytes) throw bad('derived_too_large', 413);
    if (imageMeta.sniff(input.derived) !== 'image/jpeg') throw bad('derived_not_jpeg');
    derivedMeta = true;
  }
  var storage = storageModule.getStorage();
  var stored = await storage.put(input.bytes, kind.mime_type, { documents: true });   // PDF / text allowed here only, after classify()
  var derived = derivedMeta ? await storage.put(input.derived, 'image/jpeg') : null;
  var result;
  try {
    result = await repo.insertSource(vehicle.id, face, {
      storage_key: stored.key, derived_storage_key: derived ? derived.key : null, mime_type: kind.mime_type, byte_size: input.bytes.length,
      width: kind.width, height: kind.height, sha256: sha, original_filename: cleanName(input.filename), text_chars: kind.text_chars || null,
      source_format: kind.source_format, input_method: method, capture_meta: { method: method, cropped: !!derived },
      review_status: opts.public ? 'pending_review' : 'accepted', processing_status: lens.initialStatus()
    }, actor);
  } catch (err) {
    if (await repo.referencesOfKey(stored.key, 0) === 0) await storage.remove(stored.key);
    if (derived && await repo.referencesOfKey(derived.key, 0) === 0) await storage.remove(derived.key);
    if (err && err.httpStatus === 404) throw errors.IdautoError('NOT_FOUND');
    throw err;
  }
  await archive.record({ object_key: stored.key, category: 'carte-grise', vehicle_id: vehicle.id, document_id: result.row.id, actor: actor,
    mime_type: kind.mime_type, original_filename: cleanName(input.filename), sha256: sha, byte_size: input.bytes.length }).catch(function () {});
  return { vehicle: vehicle.ivid, document: view(result.row), replaced: !!result.replaced, duplicate_of: null };
}

var VIEW_COLS = 'id, face, version, mime_type, byte_size, width, height, sha256, original_filename, source_format, input_method, text_chars, review_status, reviewed_by, reviewed_at, ' +
  'processing_status, lens_job_ref, extraction_version, processed_at, validation_status, superseded_at, superseded_by, created_by, created_at, org_id, derived_storage_key IS NOT NULL AS has_preview';
function view(r) {
  if (!r) return null;
  return { id: String(r.id), face: r.face, version: r.version, source_format: r.source_format, input_method: r.input_method, mime_type: r.mime_type, byte_size: r.byte_size,
    width: r.width || null, height: r.height || null, sha256: r.sha256, original_filename: r.original_filename || null, text_chars: r.text_chars || null,
    review: { status: r.review_status, by: r.reviewed_by || null, at: r.reviewed_at || null }, processing_status: r.processing_status,
    lens: { job_ref: r.lens_job_ref || null, extraction_version: r.extraction_version || null, processed_at: r.processed_at || null }, validation_status: r.validation_status,
    current: !r.superseded_at && r.review_status === 'accepted', superseded_at: r.superseded_at || null, uploaded_by: r.created_by, uploaded_at: r.created_at,
    has_preview: !!(r.has_preview || r.derived_storage_key) };
}
function visible(actor) {
  var p = actor && actor.principal;
  if (p && p.kind === 'organisation') return { sql: '(org_id = $2 OR (org_id IS NULL AND review_status = \'accepted\'))', param: p.org_id };   // its own deposits + accepted administration ones
  return { sql: 'TRUE', param: null };
}
async function history(vehicleRef, actor) {
  var vehicle = await vehicleFor(vehicleRef), v = visible(actor);
  var rows = (await db.query('SELECT ' + VIEW_COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND " + (v.param === null ? 'TRUE' : v.sql) + ' ORDER BY created_at DESC, id DESC LIMIT 200',
    v.param === null ? [vehicle.id] : [vehicle.id, v.param])).rows;
  return { vehicle: vehicle.ivid, documents: rows.map(view), lens: { enabled: lens.enabled(), note: 'LENS is not integrated yet: documents stay PENDING_LENS' } };
}
async function bytesOf(vehicleRef, id, actor, which) {
  var vehicle = await vehicleFor(vehicleRef), v = visible(actor);
  var r = (await db.query('SELECT storage_key, derived_storage_key, mime_type, original_filename FROM idauto_vehicle_documents WHERE id = $1 AND vehicle_id = $2 AND document_type = \'carte_grise\' AND ' + (v.param === null ? 'TRUE' : v.sql.replace('$2', '$3')),
    v.param === null ? [id, vehicle.id] : [id, vehicle.id, v.param])).rows[0];
  if (!r) throw errors.IdautoError('NOT_FOUND');
  var key = which === 'preview' ? r.derived_storage_key : r.storage_key;
  if (!key) throw errors.IdautoError('NOT_FOUND', { reason: 'no_preview' });
  var bytes = await storageModule.getStorage().get(key);
  if (!bytes) throw errors.IdautoError('NOT_FOUND');
  return { bytes: bytes, mime_type: which === 'preview' ? 'image/jpeg' : r.mime_type, filename: r.original_filename };
}
// The corrected crop of a photographed card, sent after the original (one request per file: the original travels untouched).
async function setPreview(vehicleRef, id, bytes, actor) {
  var vehicle = await vehicleFor(vehicleRef);
  if (!bytes || !bytes.length || bytes.length > LIMITS.derived_bytes) throw bad(bytes && bytes.length ? 'derived_too_large' : 'empty', bytes && bytes.length ? 413 : 400);
  if (imageMeta.sniff(bytes) !== 'image/jpeg') throw bad('derived_not_jpeg');
  var p = actor.principal || {}, org = p.kind === 'organisation' ? p.org_id : null;
  var r = (await db.query("SELECT id, source_format, derived_storage_key, org_id FROM idauto_vehicle_documents WHERE id = $1 AND vehicle_id = $2 AND document_type = 'carte_grise'", [id, vehicle.id])).rows[0];
  if (!r || (org && r.org_id !== org)) throw errors.IdautoError('NOT_FOUND');
  if (r.source_format !== 'CARTE_GRISE_IMAGE') throw bad('derived_only_for_images');
  if (r.derived_storage_key) throw Object.assign(errors.IdautoError('CONFLICT', { reason: 'preview_already_set' }), { httpStatus: 409 });
  var stored = await storageModule.getStorage().put(bytes, 'image/jpeg');
  await require('../writes.js').withAudit({ principal: actor.principal, event_type: 'vehicle_document.carte_grise_preview', target_type: 'idauto_vehicle_documents', change_summary: 'corrected crop stored' },
    actor.identity, async function (client) {
      await client.query("UPDATE idauto_vehicle_documents SET derived_storage_key = $2, capture_meta = jsonb_set(coalesce(capture_meta, '{}'::jsonb), '{cropped}', 'true'), updated_at = NOW() WHERE id = $1", [r.id, stored.key]);
      return { record: { id: r.id }, auditTargetRef: r.id };
    });
  return { id: String(r.id), has_preview: true };
}

async function review(id, decision, actor) {
  if (!actor.principal || actor.principal.kind === 'organisation' || actor.principal.kind === 'public') throw errors.IdautoError('FORBIDDEN');
  if (['accepted', 'rejected'].indexOf(decision) === -1) throw bad('decision');
  var row = (await db.query("SELECT id, vehicle_id, face, review_status FROM idauto_vehicle_documents WHERE id = $1 AND document_type = 'carte_grise'", [id])).rows[0];
  if (!row) throw errors.IdautoError('NOT_FOUND');
  if (row.review_status !== 'pending_review') throw Object.assign(errors.IdautoError('CONFLICT', { reason: 'not_pending' }), { httpStatus: 409 });
  await require('../writes.js').withAudit({ principal: actor.principal, event_type: 'vehicle_document.carte_grise_review', target_type: 'idauto_vehicle_documents', change_summary: 'public carte grise deposit ' + decision },
    actor.identity, async function (client) {
      if (decision === 'accepted') {
        var prev = (await client.query("SELECT id FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' FOR UPDATE", [row.vehicle_id, row.face])).rows[0];
        if (prev) await client.query('UPDATE idauto_vehicle_documents SET superseded_at = NOW(), superseded_by = $2, updated_at = NOW() WHERE id = $1', [prev.id, row.id]);
      }
      await client.query('UPDATE idauto_vehicle_documents SET review_status = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1', [row.id, decision, String(actor.identity).slice(0, 80)]);
      return { record: { id: row.id, decision: decision }, auditTargetRef: row.id };
    });
  return { id: String(row.id), review: decision };
}

module.exports = { setPreview: setPreview, store: store, history: history, bytesOf: bytesOf, review: review, classify: classify, LIMITS: LIMITS, METHODS: METHODS, TEXT_MIME: TEXT_MIME };
