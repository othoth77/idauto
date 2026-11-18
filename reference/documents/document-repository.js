'use strict';
// =====================================================
// IDauto — IDA-V14 — registration document rows (metadata only)
// reference/documents/document-repository.js
// Every write through writes.withAudit(); reads scoped by organisation.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');

var COLS = 'id, vehicle_id, org_id, document_type, face, storage_key, thumb_storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, ocr_confidence, ocr_fields, ocr_at, created_by, created_at, updated_at, version, original_filename';

// Rows an actor may see: admins see all, an organisation sees its own.
function visibility(principal, params) {
  if (!principal || principal.kind !== 'organisation') return 'TRUE';
  params.push(principal.org_id);
  return 'org_id = $' + params.length;
}

async function facesOf(vehicleId, principal) {
  var params = [vehicleId];
  var res = await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND superseded_at IS NULL AND review_status = 'accepted' AND " + visibility(principal, params) + ' ORDER BY face', params);
  return res.rows;
}

async function face(vehicleId, faceNo, principal) {
  var params = [vehicleId, faceNo];
  var res = await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' AND " + visibility(principal, params), params);
  return res.rows[0] || null;
}

async function referencesOfKey(key, exceptId, client) {
  var q = client || db;
  // Every table that references the content-addressed media root. The document tables are
  // counted only once their migrations are applied (observation media exists from the base schema).
  var has = (await q.query("SELECT to_regclass('public.idauto_vehicle_documents') IS NOT NULL AS v14, to_regclass('public.idauto_registration_submission_faces') IS NOT NULL AS cg2")).rows[0];
  var n = (await q.query('SELECT count(*)::int n FROM idauto_observation_media WHERE object_key = $1', [key])).rows[0].n;
  // IDA-V14 faces (except the row being replaced).
  if (has.v14) n += (await q.query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE (storage_key = $1 OR thumb_storage_key = $1) AND id <> $2', [key, exceptId || 0])).rows[0].n;
  // IDA-CG2 carte grise submissions: bytes a submission face still references are never removed.
  if (has.cg2) n += (await q.query('SELECT count(*)::int n FROM idauto_registration_submission_faces WHERE storage_key = $1 OR thumb_storage_key = $1', [key])).rows[0].n;
  return n;
}

// Store a NEW VERSION of one face (Update 4). `meta` was produced by the service from the sniffed bytes (never from the
// client). The previous version is never deleted: it is marked superseded (superseded_at, superseded_by) and keeps its
// file, so the dossier shows the whole history. Returns { row, replaced: previousRow|null }.
async function upsertFace(vehicleId, faceNo, meta, actor) {
  var orgId = actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null;
  // withAudit() returns the audit-safe record only; the row and the replaced
  // row (which carry storage keys) travel through these closures instead.
  var rowOut = null, replacedOut = null;
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.upsert', target_type: 'idauto_vehicle_documents', change_summary: 'carte grise face ' + faceNo + ' stored' },
    actor.identity,
    async function (client) {
      var old = await client.query("SELECT " + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' FOR UPDATE", [vehicleId, faceNo]);
      var oldRow = old.rows[0] || null;
      if (oldRow) {
        // An organisation may only replace ITS face; an admin may replace any.
        if (orgId && oldRow.org_id && oldRow.org_id !== orgId) throw Object.assign(new Error('not found'), { httpStatus: 404 });
        await client.query('UPDATE idauto_vehicle_documents SET superseded_at = NOW(), updated_at = NOW() WHERE id = $1', [oldRow.id]);
      }
      var version = ((await client.query("SELECT coalesce(max(version), 0)::int v FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2", [vehicleId, faceNo])).rows[0].v) + 1;
      var res = await client.query(
        "INSERT INTO idauto_vehicle_documents (vehicle_id, org_id, document_type, face, storage_key, thumb_storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, created_by, version, original_filename) " +
        "VALUES ($1,$2,'carte_grise',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'none',$13,$14,$15) RETURNING " + COLS,
        [vehicleId, orgId, faceNo, meta.storage_key, meta.thumb_storage_key || null, meta.mime_type, meta.byte_size, meta.width, meta.height, meta.sha256, meta.original_byte_size || null, meta.capture_meta ? JSON.stringify(meta.capture_meta) : null, actor.identity, version, meta.original_filename || null]);
      var row = res.rows[0];
      if (oldRow) await client.query('UPDATE idauto_vehicle_documents SET superseded_by = $2 WHERE id = $1', [oldRow.id, row.id]);
      // The audit row carries metadata only — never bytes, never a key path.
      rowOut = row; replacedOut = oldRow;
      return { record: { id: row.id, vehicle_id: row.vehicle_id, face: row.face, mime_type: row.mime_type, byte_size: row.byte_size, width: row.width, height: row.height, sha256: row.sha256, replaced_id: oldRow ? oldRow.id : null, version: version }, auditTargetRef: row.id };
    }
  );
  return { row: rowOut, replaced: replacedOut };
}

async function deleteFace(vehicleId, faceNo, actor) {
  var orgId = actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null;
  var deletedOut = null;
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.delete', target_type: 'idauto_vehicle_documents', change_summary: 'carte grise face ' + faceNo + ' deleted' },
    actor.identity,
    async function (client) {
      var params = [vehicleId, faceNo];
      var vis = orgId ? (params.push(orgId), 'org_id = $3') : 'TRUE';
      var res = await client.query("DELETE FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' AND " + vis + ' RETURNING ' + COLS, params);
      if (!res.rows.length) throw Object.assign(new Error('not found'), { httpStatus: 404 });
      var row = res.rows[0];
      deletedOut = row;
      return { record: { id: row.id, vehicle_id: row.vehicle_id, face: row.face, sha256: row.sha256 }, auditTargetRef: row.id };
    });
  return { deleted: deletedOut };
}

async function setOcr(rowId, status, confidence, fields, actor) {
  return writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.ocr', target_type: 'idauto_vehicle_documents', change_summary: 'carte grise OCR ' + status },
    actor.identity,
    async function (client) {
      var res = await client.query('UPDATE idauto_vehicle_documents SET ocr_status = $1, ocr_confidence = $2, ocr_fields = $3, ocr_at = NOW(), updated_at = NOW() WHERE id = $4 RETURNING id, face, ocr_status, ocr_confidence', [status, confidence, fields ? JSON.stringify(fields) : null, rowId]);
      if (!res.rows.length) throw Object.assign(new Error('not found'), { httpStatus: 404 });
      return { record: res.rows[0], auditTargetRef: rowId };
    });
}

async function setThumbnail(rowId, key, actor) {
  return writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.thumbnail', target_type: 'idauto_vehicle_documents', change_summary: 'carte grise thumbnail stored' },
    actor.identity,
    async function (client) {
      var res = await client.query('UPDATE idauto_vehicle_documents SET thumb_storage_key = $1, updated_at = NOW() WHERE id = $2 RETURNING id, face', [key, rowId]);
      if (!res.rows.length) throw Object.assign(new Error('not found'), { httpStatus: 404 });
      return { record: res.rows[0], auditTargetRef: rowId };
    });
}

// Update 5 — a carte grise SOURCE document of any format (image, PDF, text), as given. An accepted one becomes the new
// current version of its face (the previous one is kept, superseded); a public deposit waits for review and is not current.
// `m` is built by carte-grise-service.js from the sniffed / decoded bytes, never from the client's declarations.
async function insertSource(vehicleId, faceNo, m, actor) {
  var orgId = actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null;
  var rowOut = null, prevOut = null;
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.carte_grise_source', target_type: 'idauto_vehicle_documents',
      change_summary: 'carte grise source stored (' + m.source_format + ', ' + m.input_method + ', face ' + faceNo + (m.review_status === 'pending_review' ? ', pending review' : '') + ')' },
    actor.identity,
    async function (client) {
      var prev = null;
      if (m.review_status === 'accepted') {
        prev = (await client.query("SELECT " + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' FOR UPDATE", [vehicleId, faceNo])).rows[0] || null;
        if (prev && orgId && prev.org_id && prev.org_id !== orgId) throw Object.assign(new Error('not found'), { httpStatus: 404 });
        if (prev) await client.query('UPDATE idauto_vehicle_documents SET superseded_at = NOW(), updated_at = NOW() WHERE id = $1', [prev.id]);
      }
      var version = ((await client.query("SELECT coalesce(max(version), 0)::int v FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2", [vehicleId, faceNo])).rows[0].v) + 1;
      var row = (await client.query(
        "INSERT INTO idauto_vehicle_documents (vehicle_id, org_id, document_type, face, storage_key, derived_storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, created_by, version, original_filename, " +
        "source_format, input_method, text_chars, review_status, processing_status) VALUES ($1,$2,'carte_grise',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'none',$13,$14,$15,$16,$17,$18,$19,$20) RETURNING " + COLS + ', source_format, input_method, text_chars, review_status, reviewed_by, reviewed_at, processing_status, lens_job_ref, extraction_version, processed_at, validation_status, superseded_at, superseded_by, derived_storage_key',
        [vehicleId, orgId, faceNo, m.storage_key, m.derived_storage_key || null, m.mime_type, m.byte_size, m.width || 0, m.height || 0, m.sha256, m.byte_size, m.capture_meta ? JSON.stringify(m.capture_meta) : null,
          String(actor.identity).slice(0, 64), version, m.original_filename || null, m.source_format, m.input_method, m.text_chars || null, m.review_status, m.processing_status])).rows[0];
      if (prev) await client.query('UPDATE idauto_vehicle_documents SET superseded_by = $2 WHERE id = $1', [prev.id, row.id]);
      rowOut = row; prevOut = prev;
      return { record: { id: row.id, vehicle_id: vehicleId, face: faceNo, source_format: m.source_format, input_method: m.input_method, byte_size: m.byte_size, sha256: m.sha256, version: version, review_status: m.review_status, replaced_id: prev ? prev.id : null }, auditTargetRef: row.id };
    });
  return { row: rowOut, replaced: prevOut };
}

module.exports = { insertSource: insertSource, setThumbnail: setThumbnail, facesOf: facesOf, face: face, upsertFace: upsertFace, deleteFace: deleteFace, setOcr: setOcr, referencesOfKey: referencesOfKey };
