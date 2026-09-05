'use strict';
// =====================================================
// IDauto — IDA-V14 — registration document rows (metadata only)
// reference/documents/document-repository.js
// Every write through writes.withAudit(); reads scoped by organisation.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');

var COLS = 'id, vehicle_id, org_id, document_type, face, storage_key, thumb_storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, ocr_confidence, ocr_fields, ocr_at, created_by, created_at, updated_at';

// Rows an actor may see: admins see all, an organisation sees its own.
function visibility(principal, params) {
  if (!principal || principal.kind !== 'organisation') return 'TRUE';
  params.push(principal.org_id);
  return 'org_id = $' + params.length;
}

async function facesOf(vehicleId, principal) {
  var params = [vehicleId];
  var res = await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND " + visibility(principal, params) + ' ORDER BY face', params);
  return res.rows;
}

async function face(vehicleId, faceNo, principal) {
  var params = [vehicleId, faceNo];
  var res = await db.query('SELECT ' + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND " + visibility(principal, params), params);
  return res.rows[0] || null;
}

async function referencesOfKey(key, exceptId, client) {
  var res = await (client || db).query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE (storage_key = $1 OR thumb_storage_key = $1) AND id <> $2', [key, exceptId || 0]);
  var media = await (client || db).query('SELECT count(*)::int n FROM idauto_observation_media WHERE object_key = $1', [key]);
  return res.rows[0].n + media.rows[0].n;
}

// Insert or replace one face. `meta` was produced by the service from the
// sniffed bytes (never from the client). Returns { row, replaced: oldRow|null }.
async function upsertFace(vehicleId, faceNo, meta, actor) {
  var orgId = actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null;
  // withAudit() returns the audit-safe record only; the row and the replaced
  // row (which carry storage keys) travel through these closures instead.
  var rowOut = null, replacedOut = null;
  await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle_document.upsert', target_type: 'idauto_vehicle_documents', change_summary: 'carte grise face ' + faceNo + ' stored' },
    actor.identity,
    async function (client) {
      var old = await client.query("SELECT " + COLS + " FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 FOR UPDATE", [vehicleId, faceNo]);
      var oldRow = old.rows[0] || null;
      if (oldRow) {
        // An organisation may only replace ITS face; an admin may replace any.
        if (orgId && oldRow.org_id && oldRow.org_id !== orgId) throw Object.assign(new Error('not found'), { httpStatus: 404 });
        await client.query('DELETE FROM idauto_vehicle_documents WHERE id = $1', [oldRow.id]);
      }
      var res = await client.query(
        "INSERT INTO idauto_vehicle_documents (vehicle_id, org_id, document_type, face, storage_key, thumb_storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, created_by) " +
        "VALUES ($1,$2,'carte_grise',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'none',$13) RETURNING " + COLS,
        [vehicleId, orgId, faceNo, meta.storage_key, meta.thumb_storage_key || null, meta.mime_type, meta.byte_size, meta.width, meta.height, meta.sha256, meta.original_byte_size || null, meta.capture_meta ? JSON.stringify(meta.capture_meta) : null, actor.identity]);
      var row = res.rows[0];
      // The audit row carries metadata only — never bytes, never a key path.
      rowOut = row; replacedOut = oldRow;
      return { record: { id: row.id, vehicle_id: row.vehicle_id, face: row.face, mime_type: row.mime_type, byte_size: row.byte_size, width: row.width, height: row.height, sha256: row.sha256, replaced_id: oldRow ? oldRow.id : null }, auditTargetRef: row.id };
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
      var res = await client.query("DELETE FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND " + vis + ' RETURNING ' + COLS, params);
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

module.exports = { setThumbnail: setThumbnail, facesOf: facesOf, face: face, upsertFace: upsertFace, deleteFace: deleteFace, setOcr: setOcr, referencesOfKey: referencesOfKey };
