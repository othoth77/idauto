'use strict';
// =====================================================
// IDauto — Update 6 — carte grise INTAKE: the carte grise as an independent entry point.
// reference/documents/carte-grise-intake.js
//
// A vehicle may not exist in IDauto yet: the carte grise is the source it will be created from. So:
//
//   submit(input, actor)      the original is stored (same bytes, same SHA-256) with NO vehicle; status pending_extraction.
//                             The archive record sends it to Haddad, whose receiver submits it to LENS (local only).
//                             Same bytes again = the same document (idempotent), never a second row.
//   syncFromArchive()         background: LENS's TECHNICAL fields (read back by archive-service) → the document;
//                             pending_review (extracted) or extraction_failed (the original stays saved either way).
//   list / get / original     administrators only: the review screen.
//   resolve(id, body, actor)  administrators only, after review and correction:
//                             A  the VIN is already on a vehicle → attach to it (no duplicate), conflicts reported, the
//                                vehicle is never changed;
//                             B  the VIN is unknown → create the vehicle from the confirmed fields, then attach;
//                             C  no readable VIN → no VIN is invented: keep it 'unassigned', or attach to a vehicle the
//                                administrator names explicitly.
//
// PRIVACY: only technical fields exist here (TECHNICAL below). The holder's name, CIN and address are never read from
// LENS (the receiver filters them out), never accepted from the client, never stored, never returned.
// =====================================================

var crypto = require('crypto');
var db = require('../db.js');
var errors = require('../vehicle/errors.js');
var cg = require('./carte-grise-service.js');
var storageModule = require('./document-storage.js');
var archive = require('../archive/archive-service.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var vinLib = require('../vehicle/vin.js');
var plates = require('../vehicle/plate-normalizer.js');
var identity = require('../identity.js');

// LENS key → the confirmed field it proposes. Nothing else is ever kept.
var LENS_MAP = { vin: 'vin', plate_tn: 'plate', marque: 'make', type_commercial: 'model', genre: 'body_type', energie: 'fuel_type',
  places_assises: 'seats', date_premiere_circulation: 'first_registration', puissance_fiscale: 'fiscal_power' };
var TECHNICAL = ['vin', 'plate', 'make', 'model', 'body_type', 'fuel_type', 'seats', 'first_registration', 'fiscal_power'];
var OPEN = ['pending_extraction', 'extraction_failed', 'pending_review', 'unassigned'];
var LENS_DONE = ['succeeded', 'needs_review'], LENS_FAILED = ['failed', 'submit_failed', 'cancelled', 'not_configured'];

function bad(reason, status) { return Object.assign(errors.IdautoError('VALIDATION', { reason: reason }), { httpStatus: status || 400 }); }
function conflict(reason, extra) { return Object.assign(errors.IdautoError('CONFLICT', Object.assign({ reason: reason }, extra || {})), { httpStatus: 409 }); }
function isAdmin(actor) { var p = actor && actor.principal; return !!(p && p.kind !== 'organisation' && p.kind !== 'public' && identity.principalHasScope(p, identity.ADMIN_SCOPE)); }
function adminOnly(actor) { if (!isAdmin(actor)) throw errors.IdautoError('FORBIDDEN'); }
function cleanName(n) { if (!n) return null; var s = String(n).replace(/[\u0000-\u001f\/\\]/g, '_').trim().slice(0, 255); return s || null; }

// only the technical keys, short strings — whatever the caller (or LENS) sent
function technical(src) {
  var out = {};
  TECHNICAL.forEach(function (k) {
    if (!src || src[k] === undefined || src[k] === null) return;
    var v = String(src[k]).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
    if (v) out[k] = v;
  });
  return out;
}
function yearOf(s) { var m = /(19|20)\d{2}/.exec(String(s || '')); return m ? parseInt(m[0], 10) : null; }

// ---- 1. upload: no vehicle ---------------------------------------------------------------------------------------------
async function submit(input, actor, opts) {
  opts = opts || {};
  var method = cg.METHODS.indexOf(input && input.method) !== -1 ? input.method : null;
  if (!method) throw bad('method');
  var face = Number(input.face) === 2 ? 2 : 1;
  var kind = cg.classify(input.bytes, input.content_type, method);
  var sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  var same = (await db.query("SELECT id, intake_status FROM idauto_vehicle_documents WHERE vehicle_id IS NULL AND document_type = 'carte_grise' AND sha256 = $1", [sha])).rows[0];
  if (same) return { document: { id: String(same.id), intake_status: same.intake_status }, duplicate: true };
  // already attached to a vehicle: said without naming the vehicle (the caller may not be allowed to see it)
  var attached = (await db.query("SELECT 1 FROM idauto_vehicle_documents WHERE vehicle_id IS NOT NULL AND document_type = 'carte_grise' AND sha256 = $1 AND review_status <> 'rejected' LIMIT 1", [sha])).rows[0];
  if (attached) return { document: null, duplicate: true, already_attached: true };
  var storage = storageModule.getStorage();
  var stored = await storage.put(input.bytes, kind.mime_type, { documents: true });
  var p = actor.principal || {}, org = p.kind === 'organisation' ? p.org_id : null, row;
  try {
    row = await require('../writes.js').withAudit({ principal: actor.principal, event_type: 'vehicle_document.carte_grise_intake', target_type: 'idauto_vehicle_documents',
      change_summary: 'carte grise received without a vehicle (' + kind.source_format + ', ' + method + ', face ' + face + ')' }, actor.identity, async function (client) {
      var ins = (await client.query(
        "INSERT INTO idauto_vehicle_documents (vehicle_id, org_id, document_type, face, storage_key, mime_type, byte_size, width, height, sha256, original_byte_size, capture_meta, ocr_status, created_by, version, original_filename, " +
        "source_format, input_method, text_chars, review_status, processing_status, intake_status) VALUES (NULL,$1,'carte_grise',$2,$3,$4,$5,$6,$7,$8,$5,$9,'none',$10,1,$11,$12,$13,$14,'pending_review','PENDING_LENS','pending_extraction') " +
        'ON CONFLICT (sha256) WHERE vehicle_id IS NULL AND document_type = \'carte_grise\' DO NOTHING RETURNING id, intake_status, created_at',
        [org, face, stored.key, kind.mime_type, input.bytes.length, kind.width || 0, kind.height || 0, sha, JSON.stringify({ method: method, intake: true, source: opts.public ? 'public' : (org ? 'workshop' : 'admin') }),
          String(actor.identity).slice(0, 64), cleanName(input.filename), kind.source_format, method, kind.text_chars || null])).rows[0];
      if (!ins) return { record: null, skipAudit: true };   // a concurrent retry of the same file won: nothing written here
      return { record: { id: ins.id, face: face, source_format: kind.source_format, input_method: method, byte_size: input.bytes.length, sha256: sha, intake_status: 'pending_extraction', created_at: ins.created_at }, auditTargetRef: ins.id };
    });
  } catch (err) {
    if (await require('./document-repository.js').referencesOfKey(stored.key, 0) === 0) await storage.remove(stored.key);
    throw err;
  }
  if (!row) {
    var first = (await db.query("SELECT id, intake_status FROM idauto_vehicle_documents WHERE vehicle_id IS NULL AND document_type = 'carte_grise' AND sha256 = $1", [sha])).rows[0];
    return { document: first ? { id: String(first.id), intake_status: first.intake_status } : null, duplicate: true };
  }
  await archive.record({ object_key: stored.key, category: 'carte-grise', vehicle_id: null, document_id: row.id, actor: actor, mime_type: kind.mime_type,
    original_filename: cleanName(input.filename), sha256: sha, byte_size: input.bytes.length }).catch(function () {});
  return { document: { id: String(row.id), face: face, source_format: kind.source_format, mime_type: kind.mime_type, sha256: sha, byte_size: input.bytes.length,
    uploaded_at: row.created_at, intake_status: 'pending_extraction' }, duplicate: false };
}

// ---- 2. LENS results → the document (background, after archive.pass) --------------------------------------------------
function proposalFrom(lensFields) {
  var fields = {}, confidence = {};
  (Array.isArray(lensFields) ? lensFields : []).forEach(function (f) {
    var k = f && LENS_MAP[f.key];
    if (!k || f.value === null || f.value === undefined || fields[k] !== undefined) return;
    fields[k] = String(f.value).slice(0, 80);
    confidence[k] = { confidence: typeof f.confidence === 'number' ? f.confidence : null, state: f.state ? String(f.state).slice(0, 20) : null };
  });
  return { fields: technical(fields), confidence: confidence };
}
async function syncFromArchive() {
  var rows = (await db.query("SELECT d.id, a.lens_status, a.lens_fields, a.lens_job_ref FROM idauto_vehicle_documents d JOIN idauto_media_archive a ON a.document_id = d.id AND a.category = 'carte-grise' " +
    "WHERE d.intake_status = 'pending_extraction' AND a.lens_status = ANY($1::text[]) ORDER BY d.id LIMIT 50", [LENS_DONE.concat(LENS_FAILED)])).rows, n = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], ok = LENS_DONE.indexOf(r.lens_status) !== -1, prop = ok ? proposalFrom(r.lens_fields) : null;
    await db.query("UPDATE idauto_vehicle_documents SET intake_status = $2, processing_status = $3, lens_job_ref = coalesce($4, lens_job_ref), lens_extraction = $5, processed_at = NOW(), updated_at = NOW() " +
      "WHERE id = $1 AND intake_status = 'pending_extraction'",
      [r.id, ok ? 'pending_review' : 'extraction_failed', ok ? 'DONE' : 'FAILED', r.lens_job_ref || null,
        JSON.stringify(ok ? { lens_status: r.lens_status, fields: prop.fields, confidence: prop.confidence } : { lens_status: r.lens_status })]);
    n++;
  }
  return n;
}

// ---- 3. review (administrators) ----------------------------------------------------------------------------------------
var LIST_COLS = 'id, face, source_format, input_method, mime_type, byte_size, sha256, original_filename, text_chars, intake_status, processing_status, lens_extraction, intake_fields, ' +
  'resolved_by, resolved_at, vehicle_id, created_by, created_at, capture_meta';
function view(r, vehicle) {
  var ext = r.lens_extraction || null;
  return { id: String(r.id), face: r.face, source_format: r.source_format, input_method: r.input_method, mime_type: r.mime_type, byte_size: r.byte_size, sha256: r.sha256,
    original_filename: r.original_filename || null, text_chars: r.text_chars || null, intake_status: r.intake_status, processing_status: r.processing_status,
    extraction: ext ? { lens_status: ext.lens_status || null, fields: technical(ext.fields), confidence: ext.confidence || {} } : null,
    confirmed_fields: r.intake_fields ? technical(r.intake_fields) : null, resolved: r.resolved_at ? { by: r.resolved_by, at: r.resolved_at } : null,
    vehicle: vehicle || null, uploaded_by: r.created_by, uploaded_at: r.created_at, source: r.capture_meta && r.capture_meta.source || null };
}
async function list(actor, status) {
  adminOnly(actor);
  var all = OPEN.concat(['linked_existing_vehicle', 'vehicle_created']);
  var st = status && all.indexOf(status) !== -1 ? [status] : status === 'all' ? all : OPEN;
  var rows = (await db.query('SELECT ' + LIST_COLS + " FROM idauto_vehicle_documents WHERE document_type = 'carte_grise' AND intake_status = ANY($1::text[]) ORDER BY created_at DESC, id DESC LIMIT 200", [st])).rows;
  var counts = (await db.query("SELECT intake_status s, count(*)::int n FROM idauto_vehicle_documents WHERE intake_status IS NOT NULL GROUP BY 1")).rows;
  var c = {}; counts.forEach(function (x) { c[x.s] = x.n; });
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(view(rows[i], rows[i].vehicle_id ? await vehicleSummary(rows[i].vehicle_id) : null));
  return { documents: out, counts: c };
}
async function vehicleSummary(id, runner) {
  var v = await vehicleRepository.canonicalById(id, runner);
  return v ? { ivid: v.ivid, make: v.make || null, model: v.model || null } : null;
}
async function rowOf(id, runner) {
  var r = (await (runner || db).query('SELECT ' + LIST_COLS + ", storage_key FROM idauto_vehicle_documents WHERE id = $1 AND document_type = 'carte_grise' AND intake_status IS NOT NULL" + (runner ? ' FOR UPDATE' : ''), [id])).rows[0];
  if (!r) throw errors.IdautoError('NOT_FOUND');
  return r;
}
// one document, with what the review screen needs: the proposal and, when its VIN is known, the vehicle it matches
async function get(id, actor) {
  adminOnly(actor);
  var r = await rowOf(id);
  var out = view(r, r.vehicle_id ? await vehicleSummary(r.vehicle_id) : null);
  var basis = Object.assign({}, out.extraction ? out.extraction.fields : {}, out.confirmed_fields || {});
  out.match = await matchFor(basis);
  return out;
}
async function matchFor(fields) {
  var v = vinLib.validate(fields.vin || '');
  if (!v.ok) return { vin_valid: false, case: 'C' };
  var ids = await vehicleRepository.vehiclesWithVin(db, v.vin);
  if (!ids.length) return { vin_valid: true, case: 'B' };
  var row = await vehicleRepository.canonicalById(ids[0]);
  return { vin_valid: true, case: 'A', vehicles: ids.length, vehicle: row ? { ivid: row.ivid, make: row.make || null, model: row.model || null } : null, conflicts: row ? conflictsWith(row, fields) : [] };
}
function conflictsWith(row, f) {
  var out = [], pairs = [['make', 'make'], ['model', 'model'], ['body_type', 'body_type'], ['fuel_type', 'fuel_type'], ['seats', 'seats']];
  pairs.forEach(function (p) {
    var a = row[p[1]], b = f[p[0]];
    if (a === null || a === undefined || a === '' || !b) return;
    if (String(a).trim().toLowerCase() !== String(b).trim().toLowerCase()) out.push({ field: p[0], vehicle: String(a), document: String(b) });
  });
  var y = yearOf(f.first_registration);
  if (y && row.year && Number(row.year) !== y) out.push({ field: 'year', vehicle: String(row.year), document: String(y) });
  return out;
}
async function original(id, actor) {
  adminOnly(actor);
  var r = await rowOf(id);
  var bytes = await storageModule.getStorage().get(r.storage_key);
  if (!bytes) throw errors.IdautoError('NOT_FOUND');
  return { bytes: bytes, mime_type: r.mime_type, filename: r.original_filename };
}

// ---- 4. resolve: attach / create / unassigned ---------------------------------------------------------------------------
// body = { action: 'attach' | 'create' | 'unassigned', fields: { technical, corrected by the administrator }, vehicle_ref? }
async function resolve(id, body, actor) {
  adminOnly(actor);
  body = body || {};
  var action = ['attach', 'create', 'unassigned'].indexOf(body.action) !== -1 ? body.action : null;
  if (!action) throw bad('action');
  var fields = technical(body.fields || {});
  var vin = fields.vin ? vinLib.validate(fields.vin) : { ok: false };
  if (fields.vin && !vin.ok) throw bad('vin_invalid');
  if (vin.ok) fields.vin = vin.vin;
  var plate = fields.plate ? plates.parsePlate(fields.plate) : null;
  if (fields.plate && !(plate && plate.ok)) throw bad('plate_invalid');
  if (plate) fields.plate = plate.canonical;
  var who = String(actor.identity).slice(0, 80), out = {};
  await require('../writes.js').withAudit({ principal: actor.principal, event_type: 'vehicle_document.carte_grise_intake_resolve', target_type: 'idauto_vehicle_documents',
    change_summary: 'carte grise intake resolved (' + action + ')' }, actor.identity, async function (client) {
    var r = await rowOf(id, client);
    if (r.vehicle_id || OPEN.indexOf(r.intake_status) === -1) throw conflict('already_resolved');   // a retry never resolves twice
    var ext = r.lens_extraction && r.lens_extraction.fields ? technical(r.lens_extraction.fields) : {};
    var corrected = Object.keys(fields).some(function (k) { return ext[k] !== fields[k]; }) || Object.keys(ext).some(function (k) { return fields[k] === undefined; });
    if (action === 'unassigned') {
      await client.query("UPDATE idauto_vehicle_documents SET intake_status = 'unassigned', intake_fields = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW() WHERE id = $1", [r.id, JSON.stringify(fields), who]);
      out = { id: String(r.id), intake_status: 'unassigned', vehicle: null };
      return { record: { id: r.id, action: action, intake_status: 'unassigned' }, auditTargetRef: r.id };
    }
    var target = null, status = null, conflicts = [];
    await vehicleRepository.lockIdentifiers(client, plate ? plate.canonical : null, vin.ok ? vin.vin : null);
    if (vin.ok) {
      var ids = await vehicleRepository.vehiclesWithVin(client, vin.vin);
      if (ids.length > 1) throw conflict('vin_on_several_vehicles');
      if (ids.length === 1) {                                                                     // case A, whatever was asked: never a duplicate
        target = await vehicleRepository.canonicalById(ids[0], client);
        if (body.vehicle_ref && target && (await vehicleRepository.findByRef(String(body.vehicle_ref)) || {}).id !== target.id) throw conflict('vin_is_on_another_vehicle');
        status = 'linked_existing_vehicle'; conflicts = conflictsWith(target, fields);
      } else if (action === 'create') {                                                           // case B
        var input = { vin: vin.vin, plate: plate, make: fields.make, model: fields.model, body_type: fields.body_type, fuel_type: fields.fuel_type,
          seats: /^\d{1,2}$/.test(fields.seats || '') ? fields.seats : undefined, year: yearOf(fields.first_registration) || undefined };
        target = await vehicleRepository.insertIdentifiedVehicle(client, input, actor, { method: 'admin', source: 'carte_grise_lens', confidence: 1.0 }, true);
        status = 'vehicle_created';
      }
    }
    if (!target) {
      if (action === 'create') throw bad(vin.ok ? 'vin_unknown_use_create' : 'vin_required_to_create');   // case C: no VIN, no new vehicle
      if (!body.vehicle_ref) throw bad('vehicle_ref_required');
      target = await vehicleRepository.findByRef(String(body.vehicle_ref));
      if (!target) throw errors.IdautoError('VEHICLE_NOT_FOUND');
      if (vin.ok) throw conflict('vin_unknown_on_that_vehicle');            // a VIN that this vehicle does not carry is never added silently
      status = 'linked_existing_vehicle'; conflicts = conflictsWith(target, fields);
    }
    if ((await client.query("SELECT 1 FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND sha256 = $2 AND review_status <> 'rejected'", [target.id, r.sha256])).rows.length) throw conflict('already_on_vehicle');
    // attach as the vehicle's new current version of that face; the previous version is kept (superseded)
    var prev = (await client.query("SELECT id FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2 AND superseded_at IS NULL AND review_status = 'accepted' FOR UPDATE", [target.id, r.face])).rows[0];
    if (prev) await client.query('UPDATE idauto_vehicle_documents SET superseded_at = NOW(), superseded_by = $2, updated_at = NOW() WHERE id = $1', [prev.id, r.id]);
    var version = (await client.query("SELECT coalesce(max(version), 0)::int v FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = $2", [target.id, r.face])).rows[0].v + 1;
    await client.query("UPDATE idauto_vehicle_documents SET vehicle_id = $2, version = $3, review_status = 'accepted', reviewed_by = $4, reviewed_at = NOW(), intake_status = $5, intake_fields = $6, " +
      'validation_status = $7, resolved_by = $4, resolved_at = NOW(), updated_at = NOW() WHERE id = $1', [r.id, target.id, version, who, status, JSON.stringify(fields), corrected ? 'CORRECTED' : 'VALIDATED']);
    await client.query("UPDATE idauto_media_archive SET vehicle_id = $2, archive_status = CASE WHEN archive_status = 'removed' THEN 'removed' ELSE 'pending' END, updated_at = NOW() WHERE document_id = $1 AND category = 'carte-grise'", [r.id, target.id]);
    out = { id: String(r.id), intake_status: status, vehicle: { ivid: target.ivid }, replaced_id: prev ? String(prev.id) : null, version: version, conflicts: conflicts };
    return { record: { id: r.id, action: action, intake_status: status, vehicle_id: target.id, version: version, replaced_id: prev ? prev.id : null, vin_present: vin.ok, conflicts: conflicts.length }, auditTargetRef: r.id };
  });
  return out;
}

module.exports = { submit: submit, syncFromArchive: syncFromArchive, list: list, get: get, original: original, resolve: resolve, proposalFrom: proposalFrom, technical: technical,
  TECHNICAL: TECHNICAL, LENS_MAP: LENS_MAP, OPEN: OPEN };
