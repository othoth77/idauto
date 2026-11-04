'use strict';

/* IDA-CG2 stages 2–3 — CARTE GRISE SUBMISSIONS: capture → extraction → review → link or create.
 *
 * What this suite proves (synthetic images and synthetic OCR text only — no real card, no personal data):
 *   STAGE 2  a submission belongs to no vehicle; faces are versioned ORIGINALS (bytes served back identical,
 *            hash-checked); not-an-image 415, too small 400, same image on both faces 409, the same photo in
 *            another submission is reported; OCR text is parsed and NEVER stored; holder lines never reach a
 *            field; the VIN is never returned; a parser substitution is flagged; faces that disagree are a
 *            conflict, not a winner; a field the OCR missed is "missing", never filled; fields are append-only.
 *   STAGE 3  no decision before every expected field is settled; "create" only when the matcher finds
 *            nothing — the IVID issued in the same transaction; "link" fills only what the vehicle lacks,
 *            a different value is a discrepancy (never written), a re-plating is recorded not applied; an
 *            ambiguous match needs an ADMIN's explicit acknowledgement; two concurrent "create" of the same
 *            card make ONE vehicle; a closed submission cannot be decided again.
 *   ACCESS   anonymous 401, missing scope 403, another organisation 404, a card with a VIN needs vin:search.
 *   AUDIT    every step leaves an audit row; no VIN, no holder data in any summary or audit value.
 *
 * Refuses any database not named idauto_scratch_*.
 */

var http = require('http');
var crypto = require('crypto');
var zlib = require('zlib');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var T = {};
['ADMIN', 'MGR', 'TECH', 'OTHER', 'READER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
// Per-run actor names: the upload/OCR limit is counted per actor in the database, across runs.
var identities = {};
identities[T.ADMIN] = 'usr_admin_cg2s_' + crypto.randomBytes(4).toString('hex');
var ALL = ['document:read', 'document:write', 'vehicle:read', 'vehicle:resolve', 'vehicle:write', 'vin:search'];
identities[T.MGR] = { actor_ref: 'svc_cg2s_mgr_' + crypto.randomBytes(3).toString('hex'), org_id: 0, scopes: ALL };
identities[T.TECH] = { actor_ref: 'svc_cg2s_tech_' + crypto.randomBytes(3).toString('hex'), org_id: 0, scopes: ['document:read', 'document:write', 'vehicle:read', 'vehicle:resolve', 'vehicle:write'] };
identities[T.OTHER] = { actor_ref: 'svc_cg2s_other_' + crypto.randomBytes(3).toString('hex'), org_id: 0, scopes: ALL };
identities[T.READER] = { actor_ref: 'svc_cg2s_reader_' + crypto.randomBytes(3).toString('hex'), org_id: 0, scopes: ['document:read', 'vehicle:read'] };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.raw ? opts.raw : (opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body)) : null);
    var headers = Object.assign({ 'Content-Length': payload ? payload.length : 0 }, opts.headers || {});
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (payload && !opts.raw) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var buf = Buffer.concat(c), raw = buf.toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw, buf: buf }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
var R = '/api/registration-submissions';
function as(token) {
  return {
    create: function (b) { return request('POST', R, { token: token, body: b || {} }); },
    get: function (ref) { return request('GET', R + '/' + ref, { token: token }); },
    face: function (ref, f, bytes, headers) { return request('PUT', R + '/' + ref + '/faces/' + f, { token: token, raw: bytes, headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, headers || {}) }); },
    image: function (ref, f, q) { return request('GET', R + '/' + ref + '/faces/' + f + '/image' + (q || ''), { token: token }); },
    extract: function (ref, b) { return request('POST', R + '/' + ref + '/extraction', { token: token, body: b }); },
    review: function (ref, b) { return request('POST', R + '/' + ref + '/review', { token: token, body: b }); },
    reqImage: function (ref, b) { return request('POST', R + '/' + ref + '/request-image', { token: token, body: b }); },
    match: function (ref) { return request('POST', R + '/' + ref + '/match', { token: token, body: {} }); },
    decide: function (ref, b) { return request('POST', R + '/' + ref + '/decision', { token: token, body: b }); }
  };
}

// A real, decodable grayscale PNG of the given size; `seed` makes the bytes unique.
function png(w, h, seed) {
  function crc(buf) { var c, t = []; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } var x = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) x = t[(x ^ buf[i]) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) { var len = Buffer.alloc(4); len.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var raw = Buffer.alloc((w + 1) * h, 0xEE); for (var y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  var s = crypto.createHash('sha256').update(String(seed)).digest(); for (var i = 0; i < 32; i++) raw[1 + i * 7] = s[i];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

var VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function randomVin() { var s = 'VF3'; for (var i = 0; i < 14; i++) s += VIN_CHARS[crypto.randomInt(VIN_CHARS.length)]; return s; }
var used = {};
async function unusedPlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999), p = a + ' TUN ' + b; if (used[p]) continue;
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [p])).rows.length) { used[p] = { s: a, n: b }; return p; } }
}
// Synthetic OCR text, holder lines included, so the suite proves they never reach a field.
function face1Text(plate, make, model, extra) {
  var p = used[plate];
  return ['CERTIFICAT D IMMATRICULATION', 'N° D\'IMMATRICULATION : ' + p.s + ' TU ' + p.n, 'MARQUE : ' + make, 'TYPE : ' + model,
    'NOM : ' + HOLDER, 'ADRESSE : ' + HOLDER_ADDR, 'DATE DE PREMIERE MISE EN CIRCULATION : 12/03/2019', 'ENERGIE : ESSENCE', 'ZZNOISE ' + NOISE].concat(extra || []).join('\n');
}
function face2Text(vin, extra) { return ['N° DE SERIE : ' + vin, 'CYLINDREE : 1199', 'NOMBRE DE PLACES : 5', 'PUISSANCE FISCALE : 6', 'PROPRIETAIRE : ' + HOLDER].concat(extra || []).join('\n'); }
var HOLDER = 'TESTHOLDER' + crypto.randomBytes(3).toString('hex').toUpperCase(), HOLDER_ADDR = 'RUE ' + crypto.randomBytes(3).toString('hex').toUpperCase();
var NOISE = 'N' + crypto.randomBytes(5).toString('hex').toUpperCase();
var SETTLE = ['registration', 'manufacturer', 'type', 'vin', 'first_registration_date', 'fuel', 'engine_cc', 'seats'];

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage CG2S A','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage CG2S B','garage','active') RETURNING id")).rows[0].id;
  identities[T.MGR].org_id = orgA; identities[T.TECH].org_id = orgA; identities[T.READER].org_id = orgA; identities[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var A = as(T.ADMIN), M = as(T.MGR), TE = as(T.TECH), O = as(T.OTHER), RD = as(T.READER);
  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var MAKE = 'CGS' + run;

  async function settleAll(api, ref, version, overrides) {
    var s = (await api.get(ref)).body;
    var actions = s.fields.filter(function (f) { return ['confirmed', 'corrected', 'unreadable', 'not_present'].indexOf(f.status) === -1 || (overrides && overrides[f.key]); }).map(function (f) {
      if (overrides && overrides[f.key]) return Object.assign({ key: f.key }, overrides[f.key]);
      if (f.status === 'extracted' && (f.value !== null && f.value !== undefined || f.value_present)) return { key: f.key, action: 'confirm' };
      return { key: f.key, action: 'not_present' };
    });
    return api.review(ref, { expected_version: version === undefined ? s.version : version, actions: actions });
  }
  async function fullSubmission(api, plate, vin, make, model, opts) {
    opts = opts || {};
    var c = await api.create(opts.create || {}); var ref = c.body.ref;
    var i1 = png(1600, 1000, ref + '1'), i2 = png(1600, 1000, ref + '2');
    await api.face(ref, 1, i1); await api.face(ref, 2, i2);
    var faces = [{ face: 1, image_sha256: sha(i1), text: face1Text(plate, make, model), confidence: 88 }, { face: 2, image_sha256: sha(i2), text: face2Text(vin), confidence: 85 }];
    var ex = await api.extract(ref, { faces: faces });
    var rv = await settleAll(api, ref, undefined, opts.overrides);
    return { ref: ref, i1: i1, i2: i2, extraction: ex, review: rv };
  }

  /* ===================================================================== */
  say('\n1. ACCESS');
  ok((await request('POST', R, { body: {} })).status === 401, 'anonymous → 401');
  ok((await RD.create({})).status === 403, 'without document:write → 403');
  var c1 = await M.create({});
  ok(c1.status === 201 && /^cgs_[0-9a-f]{24}$/.test(c1.body.ref) && c1.body.status === 'draft' && c1.body.two_sided === true && c1.body.vehicle === null, 'a submission opens two-sided, in draft, linked to no vehicle');
  var REF = c1.body.ref;
  ok((await O.get(REF)).status === 404 && (await O.image(REF, 1)).status === 404, 'another organisation → 404 (not 403)');
  ok((await RD.get(REF)).status === 200, 'a reader of the same organisation can read it');
  ok((await M.create({ two_sided: false })).status === 400 && (await M.create({ two_sided: false, single_sided_reason: 'carte provisoire, une seule face' })).body.two_sided === false, 'a single-sided submission needs a reason');

  say('\n2. FACES — versioned originals');
  var IMG1 = png(1600, 1000, REF + 'a'), IMG2 = png(1600, 1000, REF + 'b');
  var f1 = await M.face(REF, 1, IMG1, { 'Content-Type': 'text/plain', 'X-IDauto-Quality': JSON.stringify({ blur_score: 142.5, detection: 'auto', rotation: 0, card_coverage: 0.86, evil: '<x>' }) });
  ok(f1.status === 201 && f1.body.version === 1 && f1.body.sha256 === sha(IMG1), 'face 1 stored as version 1, the hash of the bytes sent (Content-Type ignored, bytes sniffed)');
  var qc = f1.body.submission.faces[1].quality.client;
  ok(qc.blur_score === 142.5 && qc.detection === 'auto' && qc.rotation === 0 && qc.card_coverage === 0.86 && Object.keys(qc).length === 4, 'the browser\'s quality report is kept, unknown keys dropped');
  var back = await M.image(REF, 1);
  ok(back.status === 200 && Buffer.compare(back.buf, IMG1) === 0 && back.headers['cache-control'] === 'private, no-store', 'the image served back is byte-identical to the upload (the original, not a re-encode), private, no-store');
  ok((await M.face(REF, 2, IMG1)).status === 409, 'the same image as face 2 → 409 same_image_both_faces');
  ok((await M.face(REF, 2, Buffer.from('%PDF-1.4 not an image'))).status === 415, 'not an image → 415');
  ok((await M.face(REF, 2, png(500, 400, 'small'))).status === 400, 'a short edge under 600 px → 400 resolution_too_low');
  ok((await M.face(REF, 2, IMG2)).status === 201, 'face 2 stored');
  var IMG1b = png(1800, 1100, REF + 'a2');
  var f1b = await M.face(REF, 1, IMG1b);
  ok(f1b.body.version === 2 && f1b.body.submission.face_versions[1] === 2, 'replacing face 1 adds version 2');
  ok(Buffer.compare((await M.image(REF, 1, '?version=1')).buf, IMG1) === 0 && Buffer.compare((await M.image(REF, 1)).buf, IMG1b) === 0, 'version 1 is still there, untouched; the current one is version 2');
  var other = (await M.create({})).body.ref;
  var dupe = await M.face(other, 1, IMG2);
  ok(dupe.status === 201 && dupe.body.warnings.some(function (w) { return w.code === 'image_already_submitted' && w.refs.indexOf(REF) !== -1; }), 'the same photo in another submission is reported (image_already_submitted), not blocked');

  say('\n3. EXTRACTION — parsed in memory, never stored as text');
  var PLATE = await unusedPlate(), VIN = randomVin();
  var VIN_O = VIN.slice(0, 5) + 'O' + VIN.slice(6);   // an OCR "O" inside the VIN
  var t1 = face1Text(PLATE, MAKE, '208'), t2 = face2Text(VIN_O);
  ok((await M.extract(REF, { faces: [{ face: 1, image_sha256: sha(IMG1), text: t1 }, { face: 2, image_sha256: sha(IMG2), text: t2 }] })).status === 409, 'OCR of a superseded image version → 409 (an OCR result is bound to its image)');
  ok((await M.extract(REF, { faces: [{ face: 1, image_sha256: sha(IMG1b), text: t1 }] })).status === 400, 'a two-sided card without face 2\'s text → 400');
  var ex = await M.extract(REF, { faces: [{ face: 1, image_sha256: sha(IMG1b), text: t1, confidence: 90 }, { face: 2, image_sha256: sha(IMG2), text: t2, confidence: 86 }] });
  ok(ex.status === 200 && ex.body.submission.status === 'extracted' && ex.body.holder_lines_dropped >= 3, 'fields recorded; holder lines dropped (' + ex.body.holder_lines_dropped + ')');
  var F = {}; ex.body.submission.fields.forEach(function (f) { F[f.key] = f; });
  ok(F.registration.value === PLATE && F.registration.source.face === 1 && F.registration.source.version === 2 && F.registration.source.label && typeof F.registration.confidence === 'number',
    'registration normalised to ' + PLATE + ', with its source (face 1, version 2, label, line) and confidence');
  ok(F.registration.raw === used[PLATE].s + ' TU ' + used[PLATE].n, 'the raw reading is kept beside the normalised value');
  ok(F.vin.value_present === true && F.vin.value === undefined && F.vin.corrected_by_parser === true && ex.raw.indexOf(VIN) === -1 && ex.raw.indexOf(VIN_O) === -1,
    'the VIN: present, flagged as a parser substitution (O→0), never returned');
  ok(F.engine_cc.value === '1199' && F.engine_cc.source.face === 2 && F.seats.value === '5', 'face 2 fields carry face 2 as their source');
  var stored = JSON.stringify((await db.query('SELECT * FROM idauto_registration_submission_fields WHERE submission_id = (SELECT id FROM idauto_registration_submissions WHERE public_ref = $1)', [REF])).rows);
  var everywhere = stored + JSON.stringify((await db.query('SELECT * FROM idauto_registration_submissions WHERE public_ref = $1', [REF])).rows) +
    JSON.stringify((await db.query("SELECT change_summary, new_value_json FROM idauto_audit_log WHERE target_ref = $1", [REF])).rows);
  ok(everywhere.indexOf(HOLDER) === -1 && everywhere.indexOf(HOLDER_ADDR) === -1, 'no holder name or address in any stored field, submission or audit row');
  ok(everywhere.indexOf(NOISE) === -1 && everywhere.indexOf('CERTIFICAT D IMMATRICULATION') === -1, 'the OCR text itself is stored nowhere (D1)');
  ok(ex.raw.indexOf(HOLDER) === -1, 'and no holder data in the response');
  // Faces that disagree, and a field the OCR missed.
  var REF2 = (await M.create({})).body.ref;
  var g1 = png(1600, 1000, REF2 + '1'), g2 = png(1600, 1000, REF2 + '2');
  await M.face(REF2, 1, g1); await M.face(REF2, 2, g2);
  var PL2 = await unusedPlate();
  var ex2 = await M.extract(REF2, { faces: [{ face: 1, image_sha256: sha(g1), text: face1Text(PL2, MAKE, '208') }, { face: 2, image_sha256: sha(g2), text: face2Text(randomVin(), ['MARQUE : AUTREMARQUE']) }] });
  var F2 = {}; ex2.body.submission.fields.forEach(function (f) { F2[f.key] = f; });
  ok(F2.manufacturer.status === 'conflict' && F2.manufacturer.value === null && /AUTREMARQUE/.test(F2.manufacturer.note) && ex2.body.submission.assessment.checks.some(function (c) { return c.code === 'faces_disagree' && c.key === 'manufacturer'; }),
    'faces that disagree on the make → conflict, both proposals kept, no winner chosen');
  var ex3 = await M.extract(REF2, { faces: [{ face: 1, image_sha256: sha(g1), text: 'N° D\'IMMATRICULATION : ' + used[PL2].s + ' TU ' + used[PL2].n }, { face: 2, image_sha256: sha(g2), text: 'CYLINDREE : 1400' }] });
  var F3 = {}; ex3.body.submission.fields.forEach(function (f) { F3[f.key] = f; });
  ok(F3.manufacturer.status === 'missing' && F3.manufacturer.value === null && F3.vin.status === 'missing' && ex3.body.extraction_run === 2, 'a second OCR run: what it did not read is "missing", never filled from the first run');
  var hist = (await db.query('SELECT count(*)::int n, count(*) FILTER (WHERE superseded_at IS NOT NULL)::int s FROM idauto_registration_submission_fields WHERE submission_id = (SELECT id FROM idauto_registration_submissions WHERE public_ref = $1)', [REF2])).rows[0];
  ok(hist.s > 0 && hist.n > hist.s, 'the first run is kept in history (append-only: ' + hist.n + ' rows, ' + hist.s + ' superseded)');

  // Deterministic: a VIN containing « digit TU digit » must never be read as a registration number.
  var REFV = (await M.create({})).body.ref, h1 = png(1600, 1000, REFV + '1'), h2 = png(1600, 1000, REFV + '2');
  await M.face(REFV, 1, h1); await M.face(REFV, 2, h2);
  var PLV = await unusedPlate();
  var exv = await M.extract(REFV, { faces: [{ face: 1, image_sha256: sha(h1), text: face1Text(PLV, MAKE, '208') }, { face: 2, image_sha256: sha(h2), text: face2Text('VF3AB4TU7CDEFGHJK') }] });
  var FV = {}; exv.body.submission.fields.forEach(function (f) { FV[f.key] = f; });
  ok(FV.registration.status === 'extracted' && FV.registration.value === PLV && FV.registration.source.face === 1, 'a VIN containing « 4TU7 » is not taken for a second registration number');

  say('\n4. REVIEW');
  var s4 = (await M.get(REF)).body;
  ok((await M.decide(REF, { action: 'create', expected_version: s4.version })).status === 409, 'no decision before review → 409 not_ready_for_decision');
  ok((await M.review(REF2, { expected_version: (await M.get(REF2)).body.version, actions: [{ key: 'manufacturer', action: 'confirm' }] })).status === 409, 'a missing field cannot be "confirmed" (nothing to confirm)');
  ok((await M.review(REF, { expected_version: s4.version, actions: [{ key: 'vin', action: 'correct', value: 'NOTAVIN' }] })).status === 400, 'a correction must be valid: an invalid VIN → 400');
  ok((await M.review(REF, { expected_version: s4.version - 1, actions: [{ key: 'seats', action: 'confirm' }] })).status === 409, 'a stale version → 409');
  ok((await M.review(REF, { expected_version: s4.version, actions: [{ key: 'nom', action: 'confirm' }] })).status === 400, 'a key outside the technical allow-list (holder data) → 400');
  var rv = await M.review(REF, { expected_version: s4.version, actions: [{ key: 'vin', action: 'correct', value: VIN }, { key: 'registration', action: 'correct', value: used[PLATE].s + '-تونس-' + used[PLATE].n }] });
  var RF = {}; rv.body.fields.forEach(function (f) { RF[f.key] = f; });
  ok(rv.status === 200 && RF.vin.status === 'corrected' && RF.vin.method === 'operator' && RF.registration.value === PLATE && rv.body.status === 'in_review', 'corrections normalised (Arabic spelling → ' + PLATE + '), recorded as the operator\'s');
  var rv2 = await settleAll(M, REF);
  ok(rv2.status === 200 && rv2.body.assessment.ready_for_decision === true, 'every expected field settled → ready for decision');

  say('\n5. DECISION — create (nothing known)');
  var pre = (await db.query("SELECT count(*)::int n FROM idauto_vehicles")).rows[0].n;
  var mt = await M.match(REF);
  ok(mt.status === 200 && mt.body.result.outcome === 'none' && mt.raw.indexOf(VIN) === -1, 'match: nothing known; the VIN not returned');
  ok((await M.decide(REF, { action: 'link', vehicle_ref: 'ivid:1:NOPE', expected_version: rv2.body.version })).status === 404, 'link to an unknown vehicle → 404');
  ok((await TE.decide(REF, { action: 'create', expected_version: rv2.body.version })).status === 403, 'a technician without vin:search cannot decide on a card that carries a VIN → 403');
  var cr = await M.decide(REF, { action: 'create', expected_version: rv2.body.version });
  ok(cr.status === 200 && /^ivid:1:/.test(cr.body.ivid) && cr.body.submission.status === 'created' && cr.body.submission.vehicle.ivid === cr.body.ivid, 'create → a new vehicle with its IVID, the submission linked to it');
  var veh = (await db.query('SELECT * FROM idauto_vehicles WHERE ivid = $1', [cr.body.ivid])).rows[0];
  ok(veh.make === MAKE && veh.model === '208' && veh.engine_cc === 1199 && veh.identification_method === 'carte_grise_ocr' && veh.identification_verified === true, 'the vehicle holds the reviewed fields, provenance carte_grise_ocr');
  ok((await db.query("SELECT 1 FROM idauto_plates WHERE plate_number = $1 AND status = 'active' AND vehicle_id = $2", [PLATE, veh.id])).rows.length === 1 &&
    (await db.query("SELECT 1 FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND fact_key = 'vin' AND fact_value = $2", [veh.id, VIN])).rows.length === 1, 'its plate and its VIN are recorded');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicles")).rows[0].n === pre + 1, 'exactly one vehicle created');
  ok((await M.decide(REF, { action: 'create', expected_version: cr.body.submission.version })).status === 409, 'a decided submission cannot be decided again (409)');
  ok((await M.face(REF, 1, png(1600, 1000, 'late'))).status === 409, 'nor can its images change afterwards');

  say('\n6. DECISION — the same card again: link, fill only what is missing');
  var again = await fullSubmission(M, PLATE, VIN, MAKE, '208');
  ok(again.review.body.assessment.ready_for_decision, 'a second submission of the same card, reviewed');
  var cr2 = await M.decide(again.ref, { action: 'create', expected_version: again.review.body.version });
  ok(cr2.status === 409 && cr2.body.details.reason === 'vehicle_already_known' && cr2.body.details.match.outcome === 'existing', 'create refused: the vehicle is already known (no duplicate)');
  var ln = await M.decide(again.ref, { action: 'link', vehicle_ref: cr.body.ivid, expected_version: again.review.body.version });
  ok(ln.status === 200 && ln.body.submission.status === 'linked' && ln.body.ivid === cr.body.ivid && Object.keys(ln.body.submission.applied_changes).length === 0, 'linked to the same IVID; nothing to fill');
  // A vehicle known with less information: the card fills the gaps, never overwrites.
  var PL3 = await unusedPlate(), VIN3 = randomVin();
  var known = (await request('POST', '/api/resolve/confirm', { token: T.ADMIN, body: { plate: PL3, method: 'admin', candidate: { manufacturer: 'DEJAMARQUE', model: '308', year: 2018 } } })).body.vehicle;
  var fill = await fullSubmission(M, PL3, VIN3, MAKE, '208');
  var ln2 = await M.decide(fill.ref, { action: 'link', vehicle_ref: known.id, expected_version: fill.review.body.version });
  var k2 = (await db.query('SELECT * FROM idauto_vehicles WHERE ivid = $1', [known.id])).rows[0];
  ok(ln2.status === 200 && k2.make === 'DEJAMARQUE' && k2.model === '308' && k2.year === 2018, 'link: the vehicle\'s make, model and year are NOT overwritten');
  ok(k2.engine_cc === 1199 && ln2.body.submission.applied_changes.engine_cc === '1199' && ln2.body.submission.applied_changes.vin === '(enregistré)', 'only the missing engine size and VIN are filled');
  ok(ln2.body.submission.discrepancies.make && ln2.body.submission.discrepancies.make.card === MAKE && ln2.body.submission.discrepancies.model && ln2.body.submission.discrepancies.year, 'the differing make, model and year are recorded as discrepancies');

  say('\n7. AMBIGUOUS — a person (an admin) decides, explicitly');
  var PL4 = await unusedPlate();
  var other4 = (await request('POST', '/api/resolve/confirm', { token: T.ADMIN, body: { plate: PL4, method: 'admin', candidate: { manufacturer: 'OTHER', model: 'X', year: 2010 } } })).body.vehicle;
  var amb = await fullSubmission(M, PL4, VIN, MAKE, '208');   // plate of « other4 », VIN of the vehicle created in §5
  var am = await M.match(amb.ref);
  ok(am.body.result.outcome === 'ambiguous' && am.body.result.candidates.length === 2, 'plate of one vehicle, VIN of another → ambiguous, both shown');
  ok((await M.decide(amb.ref, { action: 'create', expected_version: amb.review.body.version })).status === 409, 'create refused');
  ok((await M.decide(amb.ref, { action: 'link', vehicle_ref: other4.id, expected_version: amb.review.body.version, acknowledge_ambiguity: true })).body.details.reason === 'ambiguous_match_requires_admin_acknowledgement', 'a manager cannot resolve the ambiguity, even acknowledging it');
  var al = await A.decide(amb.ref, { action: 'link', vehicle_ref: cr.body.ivid, expected_version: amb.review.body.version, acknowledge_ambiguity: true });
  ok(al.status === 200 && al.body.submission.discrepancies.plate && al.body.submission.discrepancies.plate.card === PL4, 'an admin links it explicitly; the other vehicle\'s plate is a discrepancy, not moved');
  ok((await db.query("SELECT vehicle_id FROM idauto_plates WHERE plate_number = $1 AND status = 'active'", [PL4])).rows[0].vehicle_id !== veh.id, 'the plate stays on its vehicle');

  say('\n8. NEEDS A BETTER IMAGE, REJECT');
  var nb = await fullSubmission(M, await unusedPlate(), randomVin(), MAKE, '208');
  var rq = await M.reqImage(nb.ref, { face: 2, reason: 'reflet sur le numéro de série' });
  ok(rq.status === 200 && rq.body.status === 'needs_better_image' && rq.body.assessment.ready_for_decision === false, 'a better image requested → not ready for any decision');
  ok((await M.decide(nb.ref, { action: 'create', expected_version: rq.body.version })).status === 409, 'and a decision is refused');
  var nb2 = await M.face(nb.ref, 2, png(1700, 1050, nb.ref + 'better'));
  ok(nb2.body.submission.status === 'draft' && nb2.body.version === 2, 'a new image of face 2 → back to draft, version 2 (the OCR must run again)');
  var rj = await M.decide(nb.ref, { action: 'reject', expected_version: nb2.body.submission.version, reason: 'document illisible' });
  ok(rj.status === 200 && rj.body.decision === 'reject' && rj.body.submission.status === 'rejected' && rj.body.submission.vehicle === null, 'reject: closed, no vehicle (same response shape as link / create)');
  ok((await M.decide(nb.ref, { action: 'reject', expected_version: rj.body.submission.version, reason: 'encore' })).status === 409, 'a rejected submission is closed');

  say('\n9. CONCURRENCY — two "create" of the same card make ONE vehicle');
  var PL5 = await unusedPlate(), VIN5 = randomVin();
  var x1 = await fullSubmission(M, PL5, VIN5, MAKE, 'RACE'), x2 = await fullSubmission(A, PL5, VIN5, MAKE, 'RACE');
  var both = await Promise.all([M.decide(x1.ref, { action: 'create', expected_version: x1.review.body.version }), A.decide(x2.ref, { action: 'create', expected_version: x2.review.body.version })]);
  var codes = both.map(function (r) { return r.status; }).sort();
  var nveh = (await db.query("SELECT count(DISTINCT vehicle_id)::int n FROM idauto_plates WHERE plate_number = $1", [PL5])).rows[0].n;
  var nvin = (await db.query("SELECT count(DISTINCT vehicle_id)::int n FROM idauto_vehicle_facts WHERE fact_key = 'vin' AND fact_value = $1", [VIN5])).rows[0].n;
  ok(JSON.stringify(codes) === '[200,409]' && nveh === 1 && nvin === 1, 'one created (200), the other refused (409); one vehicle carries the plate and the VIN');

  // No plate on the card (unreadable): only the VIN identifies it, and no database constraint makes a VIN unique —
  // the advisory lock taken on the VIN is what serialises the two decisions.
  var VIN6 = randomVin();
  var y1 = await fullSubmission(M, await unusedPlate(), VIN6, MAKE, 'RACEVIN', { overrides: { registration: { action: 'unreadable' } } });
  var y2 = await fullSubmission(A, await unusedPlate(), VIN6, MAKE, 'RACEVIN', { overrides: { registration: { action: 'unreadable' } } });
  var both2 = await Promise.all([M.decide(y1.ref, { action: 'create', expected_version: y1.review.body.version }), A.decide(y2.ref, { action: 'create', expected_version: y2.review.body.version })]);
  var nvin6 = (await db.query("SELECT count(DISTINCT vehicle_id)::int n FROM idauto_vehicle_facts WHERE fact_key = 'vin' AND fact_value = $1", [VIN6])).rows[0].n;
  ok(JSON.stringify(both2.map(function (r) { return r.status; }).sort()) === '[200,409]' && nvin6 === 1, 'a VIN-only card raced twice: one vehicle (the lock, not a constraint, prevents the duplicate)');

  say('\n10. DOSSIER AND AUDIT');
  var dos = await request('GET', '/api/admin/vehicles/' + encodeURIComponent(cr.body.ivid) + '/dossier', { token: T.ADMIN });
  var subs = dos.body.registration_submissions || [];
  ok(dos.status === 200 && subs.length >= 3 && subs.some(function (s) { return s.ref === REF && s.decision === 'create_vehicle' && s.faces.length === 2; }), 'the dossier lists the vehicle\'s cartes grises with both faces (' + subs.length + ')');
  ok(Buffer.compare((await A.image(REF, 1)).buf, IMG1b) === 0 && Buffer.compare((await A.image(REF, 2)).buf, IMG2) === 0, 'both original images open from the dossier\'s references');
  var aud = (await db.query("SELECT event_type, change_summary, new_value_json FROM idauto_audit_log WHERE target_ref = $1 ORDER BY id", [REF])).rows;
  var types = aud.map(function (r) { return r.event_type; });
  ok(['registration_submission.create', 'registration_submission.face', 'registration_submission.extract', 'registration_submission.review', 'registration_submission.create_vehicle'].every(function (t) { return types.indexOf(t) !== -1; }), 'every step is audited (' + types.length + ' rows)');
  var audRaw = JSON.stringify((await db.query("SELECT change_summary, new_value_json FROM idauto_audit_log WHERE event_type LIKE 'registration_submission.%'")).rows);
  ok(audRaw.indexOf(VIN) === -1 && audRaw.indexOf(VIN3) === -1 && audRaw.indexOf(HOLDER) === -1, 'no VIN and no holder data in any registration_submission audit row');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool();
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) { console.error('FATAL', err && err.stack || err); if (server) server.close(); process.exit(1); });
