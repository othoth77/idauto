'use strict';
// =====================================================
// IDauto — IDA-CG2 stages 2–3 — registration submissions (carte grise V2)
// reference/documents/registration-submissions.js
//
// A SUBMISSION is a carte grise while it is processed, BEFORE it belongs to a
// vehicle:  create → faces (versioned originals) → extraction (OCR text parsed
// in memory, fields stored with provenance) → review (confirm / correct /
// unreadable / not present) → match → decision (link to the existing vehicle,
// create one, or reject) — the decision and the link in ONE transaction.
//
// Owner decisions (docs/CARTE_GRISE_V2.md): D1 no raw OCR text is stored (the
// text is parsed in memory and dropped); D2 both faces when the card has two;
// D3 the vehicle identifier stays the IVID (issued inside the creating
// transaction); D4 the stored bytes are the ORIGINAL upload, never a
// compressed replacement; D5 no holder data (field allow-list; the parser drops
// holder lines); D6/D7 production use waits for the off-host backup of these
// images and for real redacted cards — this module does not decide that.
//
// NEVER: guess an unreadable value (it is marked, not filled); write a value
// the card disagrees with over the vehicle's (it becomes a discrepancy);
// link or create while identifiers are ambiguous (unless an ADMIN acknowledges
// it explicitly, for linking only); return a VIN value to any client.
// =====================================================

var crypto = require('crypto');
var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vinModule = require('../vehicle/vin.js');
var repository = require('../vehicle/vehicle-repository.js');
var identity = require('../identity.js');
var imageMeta = require('./image-meta.js');
var storageModule = require('./document-storage.js');
var parser = require('./registration-parser.js');
var matcher = require('./vehicle-matcher.js');
var documentRepo = require('./document-repository.js');

var LIMITS = {
  // The ORIGINAL photo (D4): larger than V14's optimised copy. 15 MB default; readBinaryBody caps at 20 MB.
  max_bytes: parseInt(process.env.IDAUTO_CG_ORIGINAL_MAX_BYTES || String(15 * 1024 * 1024), 10),
  max_thumb_bytes: 512 * 1024,
  min_short_edge: 600,          // below this a card's text is not reliably legible
  max_edge: 10000
};
// Technical keys only (D5) — the same allow-list as the field table's CHECK.
var KEYS = ['registration', 'manufacturer', 'type', 'genre', 'category_code', 'vin', 'first_registration_date', 'year',
  'fuel', 'engine_cc', 'fiscal_power', 'seats', 'gross_weight_kg', 'engine'];
// The keys a person must settle (confirm, correct, unreadable or not present) before any decision.
var EXPECTED = ['registration', 'manufacturer', 'type', 'vin', 'first_registration_date', 'fuel', 'engine_cc', 'seats'];
var REVIEWED = ['confirmed', 'corrected', 'unreadable', 'not_present'];
var TERMINAL = ['linked', 'created', 'rejected'];
var PARSER_METHOD = 'ocr:tesseract.js+registration-parser';
// card field → vehicle column, for "fill what is missing" on link and for creation.
var COLUMN = { manufacturer: 'make', type: 'model', year: 'year', fuel: 'fuel_type', engine_cc: 'engine_cc', seats: 'seats',
  gross_weight_kg: 'gross_weight_kg', category_code: 'category_code', engine: 'engine_code' };

function bad(reason, extra) { return Object.assign(errors.IdautoError('VALIDATION', Object.assign({ reason: reason }, extra || {})), { httpStatus: 400 }); }
function conflict(reason, extra) { return errors.IdautoError('CONFLICT', Object.assign({ reason: reason }, extra || {})); }
function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function isAdmin(actor) { return identity.principalHasScope(actor.principal, identity.ADMIN_SCOPE); }
function faceNo(v) { var n = parseInt(v, 10); if (n !== 1 && n !== 2) throw bad('face_must_be_1_or_2'); return n; }

// ---- normalisation: deterministic, never a correction beyond the parser's flagged one ----
function normalize(key, value) {
  if (value === null || value === undefined) return { ok: false, reason: 'empty' };
  var v = String(value).trim();
  if (!v) return { ok: false, reason: 'empty' };
  if (key === 'registration') { var p = plateNormalizer.parsePlate(v); return p.ok ? { ok: true, value: p.canonical } : { ok: false, reason: p.reason || 'invalid_plate' }; }
  if (key === 'vin') { var x = vinModule.validate(v); return x.ok ? { ok: true, value: x.vin } : { ok: false, reason: x.reason || 'invalid_vin' }; }
  if (key === 'first_registration_date') {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return { ok: false, reason: 'date_format' };
    var d = new Date(v + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || +m[1] < 1950 || d.getTime() > Date.now()) return { ok: false, reason: 'impossible_date' };
    return { ok: true, value: v };
  }
  var ranges = { year: [1950, new Date().getUTCFullYear()], engine_cc: [49, 20000], fiscal_power: [1, 99], seats: [1, 99], gross_weight_kg: [100, 60000] };
  if (ranges[key]) { if (!/^\d{1,6}$/.test(v)) return { ok: false, reason: 'not_a_number' }; var n = +v; return n >= ranges[key][0] && n <= ranges[key][1] ? { ok: true, value: String(n) } : { ok: false, reason: 'out_of_range' }; }
  if (key === 'fuel') return ['petrol', 'diesel', 'lpg', 'electric', 'hybrid'].indexOf(v.toLowerCase()) !== -1 ? { ok: true, value: v.toLowerCase() } : { ok: false, reason: 'unknown_fuel' };
  if (key === 'category_code') return /^[A-Z][0-9A-Z]{0,3}$/.test(v.toUpperCase()) ? { ok: true, value: v.toUpperCase() } : { ok: false, reason: 'invalid_category' };
  var up = v.toUpperCase().replace(/\s+/g, ' ');
  // A VIN never travels in a free-text field (it would be shown and stored in clear).
  if (/[A-HJ-NPR-Z0-9OIQ]{17}/.test(up)) return { ok: false, reason: 'looks_like_a_vin' };
  // engine → vehicle engine_code VARCHAR(30); the other free-text columns allow 80.
  return up.length <= (key === 'engine' ? 30 : 80) ? { ok: true, value: up } : { ok: false, reason: 'too_long' };
}

// What was read, kept for the reviewer (D1: never the OCR text itself). Only the value token, at
// most 60 characters; outside the VIN field anything shaped like a VIN is masked, so a VIN glued to
// another label's line is never stored or shown in clear.
var VIN_SHAPE = /[A-HJ-NPR-Z0-9OIQ]{17}/g;
function safeRaw(key, raw) {
  if (raw === null || raw === undefined) return null;
  var r = String(raw).trim().slice(0, 60);
  if (key !== 'vin') r = r.replace(VIN_SHAPE, '[VIN]');
  return r || null;
}

// A refused write leaves no file behind: fresh bytes nobody references (V14, observations,
// any CG2 version) are removed. Content-addressed: bytes another row uses are kept.
async function dropIfUnreferenced(key) {
  try { if (key && await documentRepo.referencesOfKey(key, 0) === 0) await storageModule.getStorage().remove(key); } catch (e) { /* best effort: the write itself already failed */ }
}

// ---- reads ----
async function load(ref, actor, runner) {
  if (typeof ref !== 'string' || !/^cgs_[0-9a-f]{24}$/.test(ref)) throw errors.IdautoError('NOT_FOUND');
  var q = runner || db;
  var row = (await q.query('SELECT * FROM idauto_registration_submissions WHERE public_ref = $1' + (runner ? ' FOR UPDATE' : ''), [ref])).rows[0];
  // Another organisation's submission does not exist for this caller (404, not 403).
  if (!row || (!isAdmin(actor) && row.org_id !== orgOf(actor))) throw errors.IdautoError('NOT_FOUND');
  return row;
}
async function currentFaces(id, q) { return (await (q || db).query('SELECT * FROM idauto_registration_submission_faces WHERE submission_id = $1 AND is_current ORDER BY face', [id])).rows; }
async function currentFields(id, q) { return (await (q || db).query('SELECT * FROM idauto_registration_submission_fields WHERE submission_id = $1 AND superseded_at IS NULL ORDER BY field_key', [id])).rows; }

function fieldView(f) {
  var out = { key: f.field_key, status: f.status, confidence: f.confidence, corrected_by_parser: f.corrected_by_parser, source: f.source_face ? { face: f.source_face, version: f.source_face_version, label: f.source_label, line: f.source_line } : null,
    method: f.method, extraction_run: f.extraction_run, at: f.created_at, note: f.note };
  // The VIN value never leaves the server: presence and status only. The operator reads it on the image.
  if (f.field_key === 'vin') { out.value_present = f.value_normalized !== null; out.raw_present = f.value_raw !== null; }
  else { out.value = f.value_normalized; out.raw = f.value_raw; }
  return out;
}
function faceView(r) {
  return r ? { face: r.face, version: r.version, mime_type: r.mime_type, byte_size: r.byte_size, width: r.width, height: r.height, sha256: r.sha256, has_thumbnail: !!r.thumb_storage_key, quality: r.quality, at: r.created_at } : null;
}

// Completeness and cross-field checks, recomputed on every read (never stored, never stale).
function assess(sub, faces, fields) {
  var byFace = {}; faces.forEach(function (f) { byFace[f.face] = f; });
  var byKey = {}; fields.forEach(function (f) { byKey[f.field_key] = f; });
  var problems = [];
  if (!byFace[1]) problems.push({ code: 'face_1_missing', face: 1 });
  if (sub.two_sided && !byFace[2]) problems.push({ code: 'face_2_missing', face: 2 });
  if (byFace[1] && byFace[2] && byFace[1].sha256 === byFace[2].sha256) problems.push({ code: 'same_image_both_faces' });
  var unreviewed = EXPECTED.filter(function (k) { return !byKey[k] || REVIEWED.indexOf(byKey[k].status) === -1; });
  Object.keys(byKey).forEach(function (k) { if (EXPECTED.indexOf(k) === -1 && REVIEWED.indexOf(byKey[k].status) === -1) unreviewed.push(k); });
  var checks = [];
  var y = byKey.year, d = byKey.first_registration_date;
  if (y && d && y.value_normalized && d.value_normalized && d.value_normalized.slice(0, 4) !== y.value_normalized) checks.push({ code: 'year_differs_from_first_registration_date' });
  Object.keys(byKey).forEach(function (k) { if (byKey[k].status === 'conflict') checks.push({ code: 'faces_disagree', key: k }); });
  Object.keys(byKey).forEach(function (k) { if (byKey[k].corrected_by_parser && REVIEWED.indexOf(byKey[k].status) === -1) checks.push({ code: 'parser_substituted_characters', key: k }); });
  var identifierSettled = ['registration', 'vin'].some(function (k) { return byKey[k] && (byKey[k].status === 'confirmed' || byKey[k].status === 'corrected') && byKey[k].value_normalized; });
  return { complete: problems.length === 0, problems: problems, unreviewed: unreviewed, checks: checks,
    ready_for_decision: problems.length === 0 && unreviewed.length === 0 && identifierSettled && TERMINAL.indexOf(sub.status) === -1 && ['draft', 'needs_better_image'].indexOf(sub.status) === -1,
    identifier_settled: identifierSettled };
}

async function view(sub, q) {
  var faces = await currentFaces(sub.id, q), fields = await currentFields(sub.id, q);
  var versions = (await (q || db).query('SELECT face, count(*)::int AS n FROM idauto_registration_submission_faces WHERE submission_id = $1 GROUP BY face', [sub.id])).rows;
  var vehicle = sub.vehicle_id ? await repository.canonicalById(sub.vehicle_id) : null;
  var f1 = faces.filter(function (f) { return f.face === 1; })[0], f2 = faces.filter(function (f) { return f.face === 2; })[0];
  return { ref: sub.public_ref, status: sub.status, two_sided: sub.two_sided, single_sided_reason: sub.single_sided_reason, version: sub.version,
    faces: { 1: faceView(f1), 2: faceView(f2) }, face_versions: versions.reduce(function (o, r) { o[r.face] = r.n; return o; }, {}),
    fields: fields.map(fieldView), assessment: assess(sub, faces, fields),
    vehicle: vehicle ? { ivid: vehicle.ivid, internal_ref: vehicle.internal_ref, make: vehicle.make, model: vehicle.model } : null,
    decision: sub.decision, decision_reason: sub.decision_reason, match: sub.match_snapshot, applied_changes: sub.applied_changes, discrepancies: sub.discrepancies,
    created_at: sub.created_at, updated_at: sub.updated_at, decided_at: sub.decided_at, org_id: sub.org_id };
}

// ---- stage 2 ----
async function create(input, actor) {
  input = input || {};
  var twoSided = input.two_sided !== false;
  var reason = typeof input.single_sided_reason === 'string' ? input.single_sided_reason.trim().slice(0, 300) : '';
  if (!twoSided && !reason) throw bad('single_sided_reason_required');
  var ref = 'cgs_' + crypto.randomBytes(12).toString('hex');
  var out = await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.create', target_type: 'idauto_registration_submissions', change_summary: 'Carte grise submission opened (' + (twoSided ? 'two-sided' : 'single-sided') + ')' },
    actor.identity, async function (client) {
      await client.query('INSERT INTO idauto_registration_submissions (public_ref, org_id, two_sided, single_sided_reason, created_by) VALUES ($1,$2,$3,$4,$5)',
        [ref, orgOf(actor), twoSided, twoSided ? null : reason, actor.identity]);
      return { record: { ref: ref, two_sided: twoSided }, auditTargetRef: ref };
    });
  return view(await load(out.ref, actor));
}

async function get(ref, actor) { return view(await load(ref, actor)); }

async function list(actor, opts) {
  var params = [], where = [];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('org_id = $' + params.length); }
  if (opts && opts.status) { params.push(String(opts.status)); where.push('status = $' + params.length); }
  var rows = (await db.query('SELECT * FROM idauto_registration_submissions' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC, id DESC LIMIT 50', params)).rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) { var v = await view(rows[i]); out.push({ ref: v.ref, status: v.status, two_sided: v.two_sided, faces: { 1: !!v.faces[1], 2: !!v.faces[2] }, vehicle: v.vehicle, updated_at: v.updated_at, ready_for_decision: v.assessment.ready_for_decision }); }
  return { submissions: out };
}

function editable(sub) {
  if (TERMINAL.indexOf(sub.status) !== -1) throw conflict('submission_closed', { status: sub.status });
}

function inspectOriginal(bytes) {
  if (!bytes || !bytes.length) throw bad('empty_image');
  if (bytes.length > LIMITS.max_bytes) throw Object.assign(errors.IdautoError('VALIDATION', { reason: 'too_large', max_bytes: LIMITS.max_bytes }), { httpStatus: 413 });
  var meta = imageMeta.inspect(bytes);
  if (!meta) throw Object.assign(errors.IdautoError('VALIDATION', { reason: 'not_an_image', accepted: ['image/jpeg', 'image/png', 'image/webp'] }), { httpStatus: 415 });
  var short = Math.min(meta.width, meta.height);
  if (short < LIMITS.min_short_edge) throw bad('resolution_too_low', { min_short_edge: LIMITS.min_short_edge, width: meta.width, height: meta.height });
  if (meta.width > LIMITS.max_edge || meta.height > LIMITS.max_edge) throw bad('dimensions_too_large', { max_edge: LIMITS.max_edge });
  return meta;
}
function clientQuality(q) {
  if (!q || typeof q !== 'object') return null;
  var out = {};
  if (typeof q.blur_score === 'number' && isFinite(q.blur_score)) out.blur_score = Math.round(q.blur_score * 100) / 100;
  if (['auto', 'manual', 'none'].indexOf(q.detection) !== -1) out.detection = q.detection;
  if ([0, 90, 180, 270].indexOf(q.rotation) !== -1) out.rotation = q.rotation;
  if (typeof q.card_coverage === 'number' && q.card_coverage >= 0 && q.card_coverage <= 1) out.card_coverage = Math.round(q.card_coverage * 100) / 100;
  return out;
}

// The bytes stored are exactly the bytes received (D4). A replacement adds a version; the old row and bytes stay.
async function putFace(ref, face, bytes, opts, actor) {
  var f = faceNo(face);
  var meta = inspectOriginal(bytes);
  var sha = crypto.createHash('sha256').update(bytes).digest('hex');
  var sub0 = await load(ref, actor);
  editable(sub0);
  var stored = await storageModule.getStorage().put(bytes, meta.mime);
  var warnings = [];
  var out;
  try {
  out = await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.face', target_type: 'idauto_registration_submissions', change_summary: 'Face ' + f + ' stored (original, ' + bytes.length + ' bytes)' },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client);
      editable(sub);
      var other = (await client.query('SELECT sha256 FROM idauto_registration_submission_faces WHERE submission_id = $1 AND face = $2 AND is_current', [sub.id, f === 1 ? 2 : 1])).rows[0];
      if (other && other.sha256 === sha) throw conflict('same_image_both_faces', { face: f });
      // The same photo already used elsewhere (visible to this caller): reported, not blocked — a person judges.
      var dup = (await client.query(
        'SELECT s.public_ref FROM idauto_registration_submission_faces x JOIN idauto_registration_submissions s ON s.id = x.submission_id ' +
        'WHERE x.sha256 = $1 AND s.id <> $2' + (isAdmin(actor) ? '' : ' AND s.org_id IS NOT DISTINCT FROM $3') + ' LIMIT 5',
        isAdmin(actor) ? [sha, sub.id] : [sha, sub.id, orgOf(actor)])).rows;
      if (dup.length) warnings.push({ code: 'image_already_submitted', refs: dup.map(function (d) { return d.public_ref; }) });
      var last = (await client.query('SELECT coalesce(max(version), 0) AS v FROM idauto_registration_submission_faces WHERE submission_id = $1 AND face = $2', [sub.id, f])).rows[0].v;
      await client.query('UPDATE idauto_registration_submission_faces SET is_current = FALSE, replaced_at = NOW() WHERE submission_id = $1 AND face = $2 AND is_current', [sub.id, f]);
      var quality = Object.assign({ server: { short_edge: Math.min(meta.width, meta.height), mime: meta.mime } }, clientQuality(opts && opts.quality) ? { client: clientQuality(opts.quality) } : {});
      await client.query('INSERT INTO idauto_registration_submission_faces (submission_id, face, version, storage_key, mime_type, byte_size, width, height, sha256, quality, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [sub.id, f, last + 1, stored.key, meta.mime, bytes.length, meta.width, meta.height, sha, JSON.stringify(quality), actor.identity]);
      // A new image of a face invalidates "needs a better image" and every field read or reviewed on
      // the old one: the fields are superseded (kept in history) and the faces must be read again.
      await client.query('UPDATE idauto_registration_submission_fields SET superseded_at = NOW() WHERE submission_id = $1 AND superseded_at IS NULL', [sub.id]);
      await client.query("UPDATE idauto_registration_submissions SET status = 'draft', version = version + 1, updated_at = NOW() WHERE id = $1", [sub.id]);
      return { record: { ref: ref, face: f, version: last + 1, sha256: sha }, auditTargetRef: ref };
    });
  } catch (err) { await dropIfUnreferenced(stored.key); throw err; }
  return { ref: ref, face: f, version: out.version, sha256: sha, warnings: warnings, submission: await view(await load(ref, actor)) };
}

async function putThumbnail(ref, face, bytes, actor) {
  var f = faceNo(face);
  if (!bytes || !bytes.length || bytes.length > LIMITS.max_thumb_bytes) throw bad('thumbnail_size', { max_bytes: LIMITS.max_thumb_bytes });
  var meta = imageMeta.inspect(bytes);
  if (!meta) throw Object.assign(errors.IdautoError('VALIDATION', { reason: 'not_an_image' }), { httpStatus: 415 });
  var sub0 = await load(ref, actor);
  editable(sub0);
  var stored = await storageModule.getStorage().put(bytes, meta.mime);
  var out;
  try {
  out = await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.thumbnail', target_type: 'idauto_registration_submissions', change_summary: 'Face ' + f + ' thumbnail stored' },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client);
      editable(sub);
      var row = (await currentFaces(sub.id, client)).filter(function (x) { return x.face === f; })[0];
      if (!row) throw errors.IdautoError('NOT_FOUND', { reason: 'face_not_stored' });
      // A thumbnail is a smaller picture OF THIS original: never larger, same proportions (±3 %),
      // either way round (a browser may apply the photo's EXIF orientation when it draws it).
      function close(a, b) { var r = a / b; return r >= 0.97 && r <= 1.03; }
      var tr = meta.width / meta.height, or = row.width / row.height;
      if (Math.max(meta.width, meta.height) > Math.max(row.width, row.height) || !(close(tr, or) || close(tr, 1 / or))) throw bad('thumbnail_does_not_match_original', { face: f });
      await client.query('UPDATE idauto_registration_submission_faces SET thumb_storage_key = $1 WHERE id = $2', [stored.key, row.id]);
      return { record: { ref: ref, face: f, version: row.version, thumbnail: { width: meta.width, height: meta.height, byte_size: bytes.length } }, auditTargetRef: ref };
    });
  } catch (err) { await dropIfUnreferenced(stored.key); throw err; }
  return { ref: ref, face: f, version: out.version, thumbnail: out.thumbnail };
}

async function image(ref, face, variant, version, actor) {
  var sub = await load(ref, actor);
  var f = faceNo(face);
  var row = version
    ? (await db.query('SELECT * FROM idauto_registration_submission_faces WHERE submission_id = $1 AND face = $2 AND version = $3', [sub.id, f, parseInt(version, 10) || 0])).rows[0]
    : (await currentFaces(sub.id)).filter(function (x) { return x.face === f; })[0];
  if (!row) throw errors.IdautoError('NOT_FOUND');
  var key = variant === 'thumb' && row.thumb_storage_key ? row.thumb_storage_key : row.storage_key;
  var bytes = await storageModule.getStorage().get(key);
  if (!bytes) throw errors.IdautoError('NOT_FOUND');
  // The archive is checked against its recorded hash before it is served.
  if (key === row.storage_key && crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw Object.assign(new Error('stored image does not match its hash'), { httpStatus: 500, code: 'INTEGRITY' });
  return { bytes: bytes, mime: key === row.storage_key ? row.mime_type : (imageMeta.inspect(bytes) || {}).mime || 'application/octet-stream', sha256: row.sha256 };
}

// input = { faces: [{ face, image_sha256, text, confidence }] } — the text is parsed here and dropped (D1).
async function extract(ref, input, actor) {
  var faces = Array.isArray(input && input.faces) ? input.faces : [];
  if (!faces.length) throw bad('faces_required');
  var sub0 = await load(ref, actor);
  editable(sub0);
  var current = await currentFaces(sub0.id);
  var byFace = {}; current.forEach(function (r) { byFace[r.face] = r; });
  var seen = {};
  var parsedFaces = faces.map(function (x) {
    var f = faceNo(x.face);
    if (seen[f]) throw bad('face_listed_twice', { face: f }); seen[f] = true;
    if (!byFace[f]) throw conflict('face_not_stored', { face: f });
    // The OCR result is bound to the exact image version it was read from.
    if (x.image_sha256 !== byFace[f].sha256) throw conflict('ocr_for_another_image_version', { face: f, current_version: byFace[f].version });
    var text = typeof x.text === 'string' ? x.text.slice(0, 20000) : '';
    var p = parser.parseFace(text, { source: 'face_' + f, confidence: typeof x.confidence === 'number' ? x.confidence : undefined });
    return { face: f, version: byFace[f].version, fields: p.fields, warnings: p.warnings, dropped_lines: p.dropped_lines };
  });
  if (!seen[1]) throw bad('face_1_text_required');
  if (sub0.two_sided && !seen[2]) throw bad('face_2_text_required');

  // One proposal per key: agreeing faces → extracted; disagreeing → conflict (both values kept in the note, no winner).
  var rows = [];
  KEYS.forEach(function (key) {
    var hits = [];
    parsedFaces.forEach(function (pf) { pf.fields.filter(function (fl) { return fl.key === key; }).forEach(function (fl) { hits.push({ pf: pf, fl: fl }); }); });
    if (!hits.length) { if (EXPECTED.indexOf(key) !== -1) rows.push({ key: key, status: 'missing' }); return; }
    var normals = hits.map(function (h) { var n = normalize(key, h.fl.value); return n.ok ? n.value : null; });
    var distinct = normals.filter(function (v, i, a) { return v !== null && a.indexOf(v) === i; });
    var best = hits.slice().sort(function (a, b) { return b.fl.confidence - a.fl.confidence; })[0];
    var bestNorm = normalize(key, best.fl.value);
    if (distinct.length > 1) {
      rows.push({ key: key, status: 'conflict', raw: null, norm: null, confidence: null, face: null, version: null, label: null, line: null, corrected: false,
        note: JSON.stringify({ reason: 'faces_disagree', proposals: key === 'vin' ? hits.map(function (h) { return { face: h.pf.face }; }) : hits.map(function (h) { return { face: h.pf.face, value: safeRaw(key, h.fl.value) }; }) }) });
      return;
    }
    rows.push({ key: key, status: 'extracted', raw: safeRaw(key, best.fl.raw !== undefined && best.fl.raw !== null ? best.fl.raw : best.fl.value),
      norm: bestNorm.ok ? bestNorm.value : null, confidence: best.fl.confidence, face: best.pf.face, version: best.pf.version, label: best.fl.label, line: best.fl.line === undefined ? null : best.fl.line,
      corrected: !!best.fl.corrected, note: bestNorm.ok ? null : JSON.stringify({ reason: 'not_normalisable', detail: bestNorm.reason }) });
  });

  var out = await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.extract', target_type: 'idauto_registration_submissions', change_summary: 'OCR fields recorded (' + rows.filter(function (r) { return r.status === 'extracted'; }).length + ' extracted, ' + rows.filter(function (r) { return r.status === 'conflict'; }).length + ' conflicts, ' + rows.filter(function (r) { return r.status === 'missing'; }).length + ' missing)' },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client);
      editable(sub);
      // Re-checked under the submission lock: a face replaced since the OCR was read refuses the run.
      var nowFaces = await currentFaces(sub.id, client);
      parsedFaces.forEach(function (pf) {
        var cur = nowFaces.filter(function (r) { return r.face === pf.face; })[0];
        if (!cur || cur.version !== pf.version) throw conflict('ocr_for_another_image_version', { face: pf.face, current_version: cur ? cur.version : null });
      });
      var run = (await client.query('SELECT coalesce(max(extraction_run), 0) + 1 AS r FROM idauto_registration_submission_fields WHERE submission_id = $1', [sub.id])).rows[0].r;
      // A new OCR run is a new proposal: every current row is superseded (kept in history).
      await client.query('UPDATE idauto_registration_submission_fields SET superseded_at = NOW() WHERE submission_id = $1 AND superseded_at IS NULL', [sub.id]);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        await client.query('INSERT INTO idauto_registration_submission_fields (submission_id, field_key, status, value_raw, value_normalized, corrected_by_parser, confidence, source_face, source_face_version, source_label, source_line, method, extraction_run, note, created_by) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [sub.id, r.key, r.status, r.raw === undefined ? null : r.raw, r.norm === undefined ? null : r.norm, !!r.corrected, r.confidence === undefined ? null : r.confidence,
            r.face || null, r.version || null, r.label ? String(r.label).slice(0, 80) : null, r.line === undefined ? null : r.line, PARSER_METHOD, run, r.note || null, actor.identity]);
      }
      await client.query("UPDATE idauto_registration_submissions SET status = 'extracted', version = version + 1, updated_at = NOW() WHERE id = $1", [sub.id]);
      return { record: { ref: ref, extraction_run: run, fields: rows.length }, auditTargetRef: ref };
    });
  return { ref: ref, extraction_run: out.extraction_run, holder_lines_dropped: parsedFaces.reduce(function (s, p) { return s + (p.dropped_lines || 0); }, 0), submission: await view(await load(ref, actor)) };
}

// actions = [{ key, action: confirm|correct|unreadable|not_present, value?, note? }]
async function review(ref, input, actor) {
  input = input || {};
  var actions = Array.isArray(input.actions) ? input.actions : [];
  if (!actions.length) throw bad('actions_required');
  // Every review states the version it was made on: two people never overwrite each other silently.
  if (typeof input.expected_version !== 'number') throw bad('expected_version_required');
  var prepared = actions.map(function (a) {
    if (KEYS.indexOf(a.key) === -1) throw bad('unknown_field', { key: a.key, allowed: KEYS });
    if (['confirm', 'correct', 'unreadable', 'not_present'].indexOf(a.action) === -1) throw bad('unknown_action', { key: a.key });
    var out = { key: a.key, action: a.action, note: typeof a.note === 'string' ? a.note.trim().slice(0, 300) : null };
    // Setting the VIN aside (unreadable / not on the card) skips the strongest identity check: it is said why.
    if (a.key === 'vin' && (a.action === 'unreadable' || a.action === 'not_present') && !(out.note && out.note.length >= 5)) throw bad('note_required_to_set_vin_aside', { key: 'vin' });
    if (a.action === 'correct') { var n = normalize(a.key, a.value); if (!n.ok) throw bad('invalid_value', { key: a.key, detail: n.reason }); out.value = n.value; out.raw = safeRaw(a.key, a.value); }
    return out;
  });
  await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.review', target_type: 'idauto_registration_submissions',
    change_summary: 'Review: ' + prepared.map(function (p) { return p.key + '=' + p.action; }).join(', ') },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client);
      editable(sub);
      if (input.expected_version !== sub.version) throw conflict('stale_version', { current_version: sub.version });
      if (sub.status === 'draft') throw conflict('no_extraction_yet');
      for (var i = 0; i < prepared.length; i++) {
        var p = prepared[i];
        var cur = (await client.query('SELECT * FROM idauto_registration_submission_fields WHERE submission_id = $1 AND field_key = $2 AND superseded_at IS NULL', [sub.id, p.key])).rows[0];
        if (p.action === 'confirm') {
          // Confirming needs a value to confirm: a conflict, a missing field or an unnormalisable reading must be corrected or marked instead.
          if (!cur || cur.value_normalized === null || ['extracted', 'confirmed', 'corrected'].indexOf(cur.status) === -1) throw conflict('nothing_to_confirm', { key: p.key, status: cur ? cur.status : 'absent' });
        }
        if (cur) await client.query('UPDATE idauto_registration_submission_fields SET superseded_at = NOW() WHERE id = $1', [cur.id]);
        var status = { confirm: 'confirmed', correct: 'corrected', unreadable: 'unreadable', not_present: 'not_present' }[p.action];
        var keep = p.action === 'confirm' && cur;
        await client.query('INSERT INTO idauto_registration_submission_fields (submission_id, field_key, status, value_raw, value_normalized, corrected_by_parser, confidence, source_face, source_face_version, source_label, source_line, method, extraction_run, note, created_by) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [sub.id, p.key, status, keep ? cur.value_raw : (p.action === 'correct' ? p.raw : null), keep ? cur.value_normalized : (p.action === 'correct' ? p.value : null),
            keep ? cur.corrected_by_parser : false, keep ? cur.confidence : null, keep ? cur.source_face : null, keep ? cur.source_face_version : null, keep ? cur.source_label : null, keep ? cur.source_line : null,
            'operator', cur ? cur.extraction_run : null, p.note, actor.identity]);
      }
      await client.query("UPDATE idauto_registration_submissions SET status = 'in_review', version = version + 1, updated_at = NOW() WHERE id = $1", [sub.id]);
      return { record: { ref: ref, actions: prepared.length }, auditTargetRef: ref };
    });
  return view(await load(ref, actor));
}

async function requestBetterImage(ref, input, actor) {
  var f = faceNo(input && input.face);
  var reason = typeof (input && input.reason) === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (!reason) throw bad('reason_required');
  await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.request_image', target_type: 'idauto_registration_submissions', change_summary: 'Better image requested for face ' + f },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client); editable(sub);
      await client.query("UPDATE idauto_registration_submissions SET status = 'needs_better_image', decision_reason = $2, version = version + 1, updated_at = NOW() WHERE id = $1", [sub.id, 'face ' + f + ': ' + reason]);
      return { record: { ref: ref, face: f }, auditTargetRef: ref };
    });
  return view(await load(ref, actor));
}

// ---- stage 3: match and decide ----
function matchInput(fields) {
  var byKey = {}; fields.forEach(function (f) { byKey[f.field_key] = f; });
  function settled(k) { var f = byKey[k]; return f && (f.status === 'confirmed' || f.status === 'corrected' || f.status === 'extracted') && f.value_normalized ? f.value_normalized : null; }
  return { plate: settled('registration'), vin: settled('vin') };
}

async function match(ref, actor) {
  var sub = await load(ref, actor);
  var fields = await currentFields(sub.id);
  var mi = matchInput(fields);
  var allowVin = identity.principalHasScope(actor.principal, 'vin:search');
  var out = await matcher.match({ plate: mi.plate, vin: mi.vin }, { allowVin: allowVin });
  return { ref: ref, used: { plate: !!mi.plate, vin: !!(mi.vin && allowVin) }, vin_searched: !!(mi.vin && allowVin), result: out, vin_for_audit: mi.vin && allowVin ? mi.vin : null };
}


// input = { action: 'link'|'create'|'reject', vehicle_ref?, expected_version, acknowledge_ambiguity?, reason? }
async function decide(ref, input, actor) {
  input = input || {};
  var action = input.action;
  if (['link', 'create', 'reject'].indexOf(action) === -1) throw bad('unknown_action', { allowed: ['link', 'create', 'reject'] });
  if (action === 'reject') {
    var why = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
    if (!why) throw bad('reason_required');
    await writes.withAudit({ principal: actor.principal, event_type: 'registration_submission.reject', target_type: 'idauto_registration_submissions', change_summary: 'Submission rejected' },
      actor.identity, async function (client) {
        var sub = await load(ref, actor, client); editable(sub);
        if (input.expected_version !== sub.version) throw conflict('stale_version', { current_version: sub.version });
        await client.query("UPDATE idauto_registration_submissions SET status = 'rejected', decision = 'reject', decision_reason = $2, decided_by = $3, decided_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = $1", [sub.id, why, actor.identity]);
        return { record: { ref: ref, decision: 'reject' }, auditTargetRef: ref };
      });
    // Same shape as link / create, so a client handles every decision alike.
    return { decision: 'reject', ivid: null, submission: await view(await load(ref, actor)) };
  }
  var allowVin = identity.principalHasScope(actor.principal, 'vin:search');
  var result = await writes.withAudit({ principal: actor.principal, event_type: action === 'create' ? 'registration_submission.create_vehicle' : 'registration_submission.link', target_type: 'idauto_registration_submissions',
    change_summary: action === 'create' ? 'Vehicle created from a reviewed carte grise' : 'Carte grise linked to an existing vehicle' },
    actor.identity, async function (client) {
      var sub = await load(ref, actor, client);
      editable(sub);
      if (input.expected_version !== sub.version) throw conflict('stale_version', { current_version: sub.version });
      var faces = await currentFaces(sub.id, client), fields = await currentFields(sub.id, client);
      var a = assess(sub, faces, fields);
      if (!a.ready_for_decision) throw conflict('not_ready_for_decision', { problems: a.problems, unreviewed: a.unreviewed, identifier_settled: a.identifier_settled, status: sub.status });
      var byKey = {}; fields.forEach(function (f) { byKey[f.field_key] = f; });
      function val(k) { var f = byKey[k]; return f && (f.status === 'confirmed' || f.status === 'corrected') ? f.value_normalized : null; }
      var plate = val('registration'), vin = val('vin');
      if (vin && !allowVin) throw Object.assign(errors.IdautoError('FORBIDDEN', { reason: 'vin_search_required_to_decide_on_a_card_with_a_vin' }), { httpStatus: 403 });
      // Serialise every decision on the same plate / VIN (sorted: no deadlock), then look again with the lock held.
      await repository.lockIdentifiers(client, plate, vin);
      var m = await matcher.match({ plate: plate, vin: vin }, { allowVin: allowVin, runner: client });
      var snapshot = { outcome: m.outcome, reasons: m.reasons, candidates: m.candidates.map(function (c) { return { ivid: c.ivid, strong: c.strong, vin_check: c.vin_check, evidence: c.evidence.map(function (e) { return { identifier: e.identifier, plate: e.plate || null, plate_status: e.plate_status || null, strong: e.strong }; }) }; }), at: new Date().toISOString() };
      var prov = { method: 'carte_grise_ocr', source: 'carte_grise_ocr', confidence: 1 };
      var applied = {}, discrepancies = {}, vehicleRow;

      if (action === 'create') {
        if (m.outcome !== 'none') throw conflict('vehicle_already_known', { match: snapshot });
        // Without a verified VIN nothing proves the vehicle is not already in IDauto under another plate:
        // only an administrator creates it.
        if (!vin && !isAdmin(actor)) throw conflict('create_without_vin_requires_admin');
        var input2 = { plate: plate ? plateNormalizer.parsePlate(plate) : null, vin: vin || null };
        Object.keys(COLUMN).forEach(function (k) { var v = val(k); if (v !== null) input2[COLUMN[k]] = /^(year|engine_cc|seats|gross_weight_kg)$/.test(COLUMN[k]) ? Number(v) : v; });
        if (!input2.plate && !input2.vin && !input2.make) throw conflict('nothing_to_identify');
        vehicleRow = await repository.insertIdentifiedVehicle(client, input2, actor, prov, true);
        Object.keys(input2).forEach(function (k) { if (input2[k] !== null && input2[k] !== undefined) applied[k === 'plate' ? 'plate' : k] = k === 'vin' ? '(enregistré)' : k === 'plate' ? plate : input2[k]; });
      } else {
        var target = typeof input.vehicle_ref === 'string' ? await repository.findByRef(input.vehicle_ref, client) : null;
        if (!target) throw errors.IdautoError('VEHICLE_NOT_FOUND');
        var cand = m.candidates.filter(function (c) { return c.ivid === target.ivid; })[0];
        if (!cand) throw conflict('vehicle_not_among_matches', { match: snapshot });
        if (m.outcome === 'ambiguous') {
          // Only an administrator may resolve an ambiguity, and only explicitly.
          if (!(input.acknowledge_ambiguity === true && isAdmin(actor))) throw conflict('ambiguous_match_requires_admin_acknowledgement', { match: snapshot });
        }
        vehicleRow = (await client.query('SELECT * FROM idauto_vehicles WHERE id = $1 FOR UPDATE', [target.id])).rows[0];
        // Fill ONLY what the vehicle is missing; a different value is a discrepancy, never written.
        var sets = [], params = [];
        Object.keys(COLUMN).forEach(function (k) {
          var v = val(k); if (v === null) return;
          var col = COLUMN[k], cur = vehicleRow[col];
          if (cur === null || cur === undefined || String(cur).trim() === '') { params.push(/^(year|engine_cc|seats|gross_weight_kg)$/.test(col) ? Number(v) : v); sets.push(col + ' = $' + params.length); applied[col] = v; }
          else if (String(cur).trim().toUpperCase() !== String(v).trim().toUpperCase()) discrepancies[col] = { vehicle: cur, card: v };
        });
        if (sets.length) { params.push(vehicleRow.id); await client.query('UPDATE idauto_vehicles SET ' + sets.join(', ') + ', updated_at = NOW() WHERE id = $' + params.length, params); }
        var onRecord = await repository.vinOfWith(vehicleRow.id, client);
        if (vin) {
          // One VIN, one vehicle: a VIN active on ANOTHER record is a discrepancy, never copied here.
          var holders = (await repository.vehiclesWithVin(client, vin)).filter(function (id) { return id !== vehicleRow.id; });
          if (holders.length) discrepancies.vin = { vehicle: onRecord ? '(différent)' : '(absent)', card: '(sur un autre véhicule)' };
          else if (!onRecord) {
            await client.query("INSERT INTO idauto_vehicle_facts (vehicle_id, fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, access_scope) VALUES ($1,'vin',$2,$3,1.0,'verified','professional')", [vehicleRow.id, vin, vin.toLowerCase()]);
            applied.vin = '(enregistré)';
          } else if (onRecord.toUpperCase() !== vin) discrepancies.vin = { vehicle: '(différent)', card: '(différent)' };
        }
        var active = (await client.query("SELECT plate_number FROM idauto_plates WHERE vehicle_id = $1 AND status = 'active'", [vehicleRow.id])).rows.map(function (r) { return r.plate_number; });
        if (plate && active.indexOf(plate) === -1) {
          if (!active.length) { await repository.attachPlate(client, vehicleRow.id, plateNormalizer.parsePlate(plate)); applied.plate = plate; }
          else discrepancies.plate = { vehicle: active.join(', '), card: plate };   // a re-plating is a legal event: recorded, not applied
        }
        await repository.insertHistory(client, vehicleRow.id, actor, 'edited', prov, null, { applied: Object.keys(applied), discrepancies: Object.keys(discrepancies), submission: ref });
        vehicleRow = await repository.canonicalById(vehicleRow.id, client);
      }
      await client.query('UPDATE idauto_registration_submissions SET status = $2, decision = $3, vehicle_id = $4, match_snapshot = $5, applied_changes = $6, discrepancies = $7, decided_by = $8, decided_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = $1',
        [sub.id, action === 'create' ? 'created' : 'linked', action === 'create' ? 'create_vehicle' : 'link_existing', vehicleRow.id, JSON.stringify(snapshot), JSON.stringify(applied), JSON.stringify(discrepancies), actor.identity]);
      return { record: { ref: ref, decision: action, ivid: vehicleRow.ivid, applied: Object.keys(applied), discrepancies: Object.keys(discrepancies) }, auditTargetRef: ref };
    });
  return { decision: action, ivid: result.ivid, submission: await view(await load(ref, actor)) };
}

// The dossier's view: every decided submission of a vehicle (and of records merged into it).
async function forVehicle(canonicalId, actor) {
  var vehicleIds = (await db.query(
    'WITH RECURSIVE t(id, depth) AS (SELECT $1::int, 0 UNION ALL SELECT v.id, t.depth + 1 FROM idauto_vehicles v JOIN t ON v.merged_into_id = t.id WHERE t.depth < 16) SELECT id FROM t', [canonicalId])).rows.map(function (r) { return r.id; });
  var params = [vehicleIds], where = 'vehicle_id = ANY($1::int[])';
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where += ' AND org_id = $2'; }
  var rows = (await db.query('SELECT * FROM idauto_registration_submissions WHERE ' + where + ' ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 20', params)).rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var faces = await currentFaces(rows[i].id);
    out.push({ ref: rows[i].public_ref, status: rows[i].status, decision: rows[i].decision, decided_at: rows[i].decided_at, two_sided: rows[i].two_sided,
      faces: faces.map(faceView), applied_changes: rows[i].applied_changes, discrepancies: rows[i].discrepancies });
  }
  return out;
}

module.exports = { safeRaw: safeRaw, create: create, get: get, list: list, putFace: putFace, putThumbnail: putThumbnail, image: image, extract: extract, review: review,
  requestBetterImage: requestBetterImage, match: match, decide: decide, forVehicle: forVehicle, normalize: normalize, assess: assess,
  LIMITS: LIMITS, KEYS: KEYS.slice(), EXPECTED: EXPECTED.slice() };
