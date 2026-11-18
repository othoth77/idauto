#!/usr/bin/env node
'use strict';
// IDauto — Update 6 — carte grise WITHOUT an existing vehicle (intake). Scratch database, scratch media, a real receiver
// process (the Haddad archive) and a LENS stub with the real API shape that also returns HOLDER data (name, CIN, address)
// to prove it never reaches IDauto. Covers the owner's ten cases: no VIN, unknown VIN, LENS success, LENS failure with the
// original kept, VIN of an existing vehicle, new VIN → vehicle created after confirmation, missing VIN → review, retries
// without duplicates, no holder data anywhere, history intact. No network beyond loopback.
var path = require('path'), http = require('http'), fs = require('fs'), os = require('os'), zlib = require('zlib'), crypto = require('crypto'), cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u6-media-')), HADDAD = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u6-haddad-')), LENSHOME = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u6-lens-'));
process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_PUBLIC_CARTE_GRISE; delete process.env.IDAUTO_CG_OCR_ENABLED;
var RPORT = 21853 + crypto.randomInt(0, 900), RTOKEN = crypto.randomBytes(24).toString('hex'), LPORT = RPORT + 1000, LTOKEN = crypto.randomBytes(20).toString('hex');
fs.writeFileSync(path.join(LENSHOME, 'api.token'), LTOKEN, { mode: 0o600 });

// ---- LENS stub: per file (by SHA-256) the test decides the result; FAIL = the upload is refused ------------------------
var RESULT = {}, FAIL = {}, FILES = {}, LENS_SEEN = [];
var HOLDER = [{ field_key: 'proprietaire', normalized_value: 'FOULEN BEN FOULEN' }, { field_key: 'cin_proprietaire', normalized_value: '01234567' }, { field_key: 'adresse', normalized_value: '12 RUE X TUNIS' }];
var lens = http.createServer(function (req, res) {
  var auth = req.headers.authorization === 'Bearer ' + LTOKEN, c = [];
  req.on('data', function (d) { c.push(d); });
  req.on('end', function () {
    var body = Buffer.concat(c); LENS_SEEN.push({ url: req.url, auth: auth });
    res.setHeader('Content-Type', 'application/json');
    if (!auth) { res.statusCode = 401; return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/v1/files') {
      var h = crypto.createHash('sha256').update(body).digest('hex');
      if (FAIL[h]) { res.statusCode = 500; return res.end('{}'); }
      var id = 'file_' + crypto.randomBytes(6).toString('hex'); FILES[id] = h; res.statusCode = 201; return res.end(JSON.stringify({ file_id: id, sha256: h }));
    }
    if (req.method === 'POST' && req.url === '/v1/jobs') { var j = JSON.parse(body.toString()); FILES[j.job_id] = FILES[j.inputs[0].file_id]; res.statusCode = 201; return res.end(JSON.stringify({ job_id: j.job_id, state: 'queued' })); }
    var m = /^\/v1\/jobs\/([^/]+)(\/result)?$/.exec(req.url);
    if (req.method === 'GET' && m && !m[2]) return res.end(JSON.stringify({ state: 'succeeded' }));
    if (req.method === 'GET' && m && m[2]) {
      var r = RESULT[FILES[decodeURIComponent(m[1])]] || {};
      var fields = Object.keys(r).map(function (k) { return { field_key: k, raw_value: 'X', normalized_value: r[k], state: 'extracted', confidence: 0.91, sources: [] }; })
        .concat(HOLDER.map(function (x) { return Object.assign({ raw_value: 'X', state: 'extracted', confidence: 0.9, sources: [] }, x); }));
      return res.end(JSON.stringify({ schema_version: 'lens.extraction-result/1', status: 'completed', document_type: 'tn-vehicle-registration', fields: fields }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
var receiver = null;
function startReceiver() {
  receiver = cp.spawn(process.execPath, [path.join(BASE, 'ops', 'haddad', 'idauto-media-receiver.js')], { env: Object.assign({}, process.env, { IDAUTO_MEDIA_RECEIVER_TOKEN: RTOKEN, IDAUTO_MEDIA_RECEIVER_ROOT: HADDAD, IDAUTO_MEDIA_RECEIVER_PORT: String(RPORT),
    IDAUTO_LENS_URL: 'http://127.0.0.1:' + LPORT, IDAUTO_LENS_TOKEN_FILE: path.join(LENSHOME, 'api.token') }), stdio: 'ignore' });
}
process.on('exit', function () { try { receiver && receiver.kill('SIGKILL'); } catch (e) {} [MEDIA, HADDAD, LENSHOME].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }); });

var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'ADMIN'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {}, ip = '10.44.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
ids[T.MGR] = { actor_ref: 'svc_u6_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.ADMIN] = 'usr_u6_admin_' + run;
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;
function request(method, p, token, body, headers) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var h = Object.assign({ 'Content-Length': payload ? payload.length : 0, 'X-Real-IP': ip }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    if (payload && !h['Content-Type']) h['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: h }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var b = Buffer.concat(c), parsed = null; try { parsed = JSON.parse(b.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, body: parsed, buf: b }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function png(w, h, shade) {
  function chunk(type, data) { var len = Buffer.alloc(4); len.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); }
  var table = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  var raw = Buffer.alloc((w + 1) * h); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (shade + x * 3 + y) & 0xFF;
  crypto.randomBytes(64).copy(raw, 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
async function freePlate() { for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999); if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b) }; } }
function freeVin() { var A = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', s = 'VF1'; for (var i = 0; i < 14; i++) s += A[crypto.randomInt(0, A.length)]; return s; }
function intake(token, bytes, type, face, method) { return request('POST', '/api/carte-grise/intake', token, bytes, { 'Content-Type': type, 'X-IDauto-Face': String(face || 1), 'X-IDauto-Input': method || 'upload' }); }
function resolve(id, body, token) { return request('POST', '/api/carte-grise/intake/' + id + '/resolve', token || T.ADMIN, body); }
async function row(id) { return (await db.query('SELECT * FROM idauto_vehicle_documents WHERE id = $1', [id])).rows[0]; }
async function nVehicles() { return (await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n; }
async function nIntake() { return (await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE intake_status IS NOT NULL')).rows[0].n; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }

  say('\n0. MIGRATION');
  for (var f of ['ida-u31-scan-photos.sql', 'ida-u4-archive-vin.sql', 'ida-u4b-vin-lookup-index.sql', 'ida-u5-carte-grise-sources.sql', 'ida-u6-carte-grise-intake.sql']) {
    var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', f), 'utf8');
    for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  }
  ok((await db.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'idauto_vehicle_documents' AND column_name = 'vehicle_id'")).rows[0].is_nullable === 'YES', 'migration (twice): vehicle_id is nullable for a carte grise received without a vehicle');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE vehicle_id IS NULL AND intake_status IS NULL')).rows[0].n === 0, 'every document without a vehicle is an intake document (existing ones keep their vehicle)');
  var bad = await db.query("INSERT INTO idauto_vehicle_documents (vehicle_id, document_type, face, storage_key, mime_type, byte_size, width, height, sha256, created_by) VALUES (NULL,'carte_grise',1,'k','image/png',1,1,1,'" + 'a'.repeat(64) + "','t')").then(function () { return false; }, function () { return true; });
  ok(bad, 'the database refuses a document with no vehicle unless it is an unresolved intake (constraint)');

  ids[T.MGR].org_id = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U6 " + run + "','garage','active') RETURNING id")).rows[0].id;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  process.env.IDAUTO_HADDAD_MEDIA_URL = 'http://127.0.0.1:' + RPORT + '/idauto-media'; process.env.IDAUTO_HADDAD_MEDIA_TOKEN = RTOKEN;
  await new Promise(function (r) { lens.listen(LPORT, '127.0.0.1', r); });
  startReceiver(); await sleep(700);
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var replica = require(path.join(BASE, 'reference', 'replica', 'haddad-replica.js')), archive = require(path.join(BASE, 'reference', 'archive', 'archive-service.js'));
  async function settle(n) { for (var s = 0; s < (n || 8); s++) { await replica.pass(); await archive.pass(); await sleep(200); } }

  // an existing vehicle, with a carte grise already in its dossier (for cases A and 10)
  var P = await freePlate(), VIN_A = freeVin();
  var reg = await request('POST', '/api/vehicles/register', T.ADMIN, { plate: { type: 'TU', series: P.series, number: P.number }, vin: VIN_A, make: 'Renault', model: 'Clio' });
  var IVA = reg.body.ivid, OLD = png(1400, 900, 7);
  var old = await request('POST', '/api/vehicles/' + encodeURIComponent(IVA) + '/carte-grise', T.ADMIN, OLD, { 'Content-Type': 'image/png', 'X-IDauto-Face': '1', 'X-IDauto-Input': 'upload' });
  ok(reg.status === 201 && old.status === 201, 'setup: an existing vehicle (Renault Clio) with its carte grise version 1');

  say('\n1. UPLOAD WITH NO VIN ENTERED — no vehicle, no search');
  var D1 = png(1600, 1000, 11); RESULT[sha(D1)] = { vin: 'KPT60A1YSLP0' + crypto.randomInt(10000, 99999), marque: 'KIA', type_commercial: 'PICANTO', genre: 'VP', energie: 'Essence', places_assises: '5', date_premiere_circulation: '2019-03-14', plate_tn: '' };
  var VIN_B = RESULT[sha(D1)].vin;
  var u1 = await intake(T.MGR, D1, 'image/png', 1, 'camera');
  var r1 = u1.body && u1.body.document && await row(u1.body.document.id);
  ok(u1.status === 201 && u1.body.document.intake_status === 'pending_extraction' && /^\d+$/.test(u1.body.document.id), 'a workshop uploads a carte grise with no vehicle: 201, its own document id, pending_extraction');
  ok(r1 && r1.vehicle_id === null && r1.sha256 === sha(D1) && r1.mime_type === 'image/png' && r1.input_method === 'camera' && r1.created_at && r1.processing_status === 'PENDING_LENS', 'stored without vehicle_id, with SHA-256, MIME type, source (camera) and upload time');
  var a1 = (await db.query("SELECT vehicle_id, sha256 FROM idauto_media_archive WHERE document_id = $1", [r1.id])).rows[0];
  ok(a1 && a1.vehicle_id === null && a1.sha256 === sha(D1), 'its archive record exists (no vehicle yet) and is queued for Haddad');

  say('\n2. UPLOAD WHEN THE VIN SEARCH FINDS NOTHING');
  var miss = await request('POST', '/public/vin', null, { vin: freeVin() });
  var D2 = Buffer.from('CARTE GRISE\nN° châssis : (illisible)\nMarque : PEUGEOT\nType : 208\nالجمهورية التونسية\nréf ' + run + '\n', 'utf8');
  var u2 = await intake(T.MGR, D2, 'text/plain; charset=utf-8', 1, 'paste_text');
  ok(miss.status === 404 && u2.status === 201 && u2.body.document.intake_status === 'pending_extraction', 'VIN search → not found; the carte grise is still accepted (pasted text, UTF-8, kept as given)');
  ok((await storageGet((await row(u2.body.document.id)).storage_key)).equals(D2), 'the pasted text is stored byte for byte');

  say('\n3–4. LENS ON HADDAD: SUCCESS, AND FAILURE WITH THE ORIGINAL KEPT');
  var D4 = png(1500, 950, 21); FAIL[sha(D4)] = true;
  var u4 = await intake(T.MGR, D4, 'image/png', 1, 'upload');
  await settle(10);
  var g1 = await request('GET', '/api/carte-grise/intake/' + u1.body.document.id, T.ADMIN);
  ok(g1.status === 200 && g1.body.intake_status === 'pending_review' && g1.body.extraction.fields.vin === VIN_B && g1.body.extraction.fields.make === 'KIA' && g1.body.extraction.fields.model === 'PICANTO'
    && g1.body.extraction.fields.seats === '5' && g1.body.extraction.fields.first_registration === '2019-03-14', 'LENS success → pending_review with VIN, make, model, seats, first registration');
  ok(g1.body.extraction.confidence.vin && g1.body.extraction.confidence.vin.confidence === 0.91 && g1.body.match.case === 'B', 'confidence per field is shown; the VIN is unknown → case B (create)');
  ok(LENS_SEEN.some(function (x) { return x.url === '/v1/files'; }) && LENS_SEEN.every(function (x) { return x.auth; }), 'the receiver submitted it to LENS on Haddad (local, authenticated)');
  var r4 = await row(u4.body.document.id), g4o = await request('GET', '/api/carte-grise/intake/' + u4.body.document.id + '/original', T.ADMIN);
  ok(r4.intake_status === 'extraction_failed' && r4.processing_status === 'FAILED', 'LENS failure → extraction_failed');
  var ar4 = (await db.query('SELECT archive_status, archive_path FROM idauto_media_archive WHERE document_id = $1', [r4.id])).rows[0];
  ok(g4o.status === 200 && g4o.buf.equals(D4) && ar4.archive_status === 'stored' && fs.readFileSync(path.join(HADDAD, ar4.archive_path)).equals(D4), 'the original is still saved, identical, on the server and on Haddad');

  say('\n5. EXTRACTED VIN MATCHES AN EXISTING VEHICLE (case A) — and 10. HISTORY KEPT');
  var D5 = png(1600, 1000, 31); RESULT[sha(D5)] = { vin: VIN_A, marque: 'KIA', type_commercial: 'CLIO' };
  var u5 = await intake(T.MGR, D5, 'image/png', 1, 'upload'); await settle(8);
  var g5 = await request('GET', '/api/carte-grise/intake/' + u5.body.document.id, T.ADMIN);
  ok(g5.body.match.case === 'A' && g5.body.match.vehicle.ivid === IVA && g5.body.match.conflicts.some(function (c) { return c.field === 'make' && c.vehicle.toUpperCase() === 'RENAULT' && c.document === 'KIA'; }), 'review shows the existing vehicle and the conflicting field (make: RENAULT vs KIA)');
  var before5 = await nVehicles();
  var s5 = await resolve(u5.body.document.id, { action: 'create', fields: g5.body.extraction.fields });
  var veh = (await db.query('SELECT make, model FROM idauto_vehicles WHERE ivid = $1', [IVA])).rows[0];
  ok(s5.status === 200 && s5.body.intake_status === 'linked_existing_vehicle' && s5.body.vehicle.ivid === IVA && await nVehicles() === before5, 'even « create » attaches to the existing vehicle: no duplicate vehicle');
  ok(veh.make.toUpperCase() === 'RENAULT' && veh.model.toUpperCase() === 'CLIO' && s5.body.conflicts.length >= 1, 'the vehicle is NOT overwritten; the conflicts are returned for review');
  var hist = (await db.query("SELECT id, version, superseded_at, superseded_by, sha256 FROM idauto_vehicle_documents d WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) AND face = 1 ORDER BY version", [IVA])).rows;
  ok(hist.length === 2 && hist[0].sha256 === sha(OLD) && hist[0].superseded_at && String(hist[0].superseded_by) === String(u5.body.document.id) && hist[1].version === 2 && !hist[1].superseded_at, 'history intact: version 1 kept (superseded), the intake document is version 2 and current');
  var hv = await request('GET', '/api/vehicles/' + encodeURIComponent(IVA) + '/carte-grise', T.ADMIN);
  ok(hv.status === 200 && hv.body.documents.length === 2, 'the vehicle dossier lists both versions');
  var arch5 = (await db.query('SELECT a.vehicle_id FROM idauto_media_archive a WHERE a.document_id = $1', [u5.body.document.id])).rows[0];
  ok(arch5 && arch5.vehicle_id === (await db.query('SELECT id FROM idauto_vehicles WHERE ivid = $1', [IVA])).rows[0].id, 'its archive record now names the vehicle');

  say('\n6. EXTRACTED VIN UNKNOWN → VEHICLE CREATED AFTER CONFIRMATION (case B)');
  var before6 = await nVehicles(), fields6 = Object.assign({}, g1.body.extraction.fields, { model: 'Picanto' });   // the administrator corrects a field
  ok((await nVehicles()) === before6 && !(await row(u1.body.document.id)).vehicle_id, 'nothing was created before the confirmation');
  var s6 = await resolve(u1.body.document.id, { action: 'create', fields: fields6 });
  var v6 = s6.body && s6.body.vehicle && (await db.query("SELECT v.id, v.make, v.model, v.seats, v.year, v.identification_method, v.identification_verified_by, (SELECT fact_value FROM idauto_vehicle_facts f WHERE f.vehicle_id = v.id AND f.fact_key = 'vin' AND is_active) vin FROM idauto_vehicles v WHERE v.ivid = $1", [s6.body.vehicle.ivid])).rows[0];
  ok(s6.status === 200 && s6.body.intake_status === 'vehicle_created' && await nVehicles() === before6 + 1, 'confirmation → one new vehicle in idauto_vehicles');
  ok(v6 && v6.vin === VIN_B && v6.make === 'KIA' && v6.model === 'Picanto' && Number(v6.seats) === 5 && Number(v6.year) === 2019, 'populated from the confirmed fields (VIN, make, corrected model, seats, year)');
  var r6 = await row(u1.body.document.id);
  ok(v6.identification_verified_by === 'usr_u6_admin_' + run && r6.resolved_by === 'usr_u6_admin_' + run && r6.resolved_at && r6.validation_status === 'CORRECTED' && r6.review_status === 'accepted' && r6.vehicle_id === v6.id, 'who confirmed and when are recorded; the document is the new vehicle\'s current carte grise (CORRECTED)');
  ok((await db.query("SELECT 1 FROM idauto_audit_log WHERE event_type = 'vehicle_document.carte_grise_intake_resolve' AND target_ref = $1", [String(r6.id)])).rows.length === 1, 'the decision is audited');

  say('\n7. MISSING VIN → REVIEW, NO FABRICATED VIN (case C)');
  var D7 = png(1600, 1000, 41); RESULT[sha(D7)] = { marque: 'FIAT', type_commercial: 'PUNTO' };
  var u7 = await intake(T.MGR, D7, 'image/png', 1, 'upload'); await settle(8);
  var g7 = await request('GET', '/api/carte-grise/intake/' + u7.body.document.id, T.ADMIN);
  ok(g7.body.intake_status === 'pending_review' && !g7.body.extraction.fields.vin && g7.body.match.case === 'C', 'no VIN read → pending_review, case C');
  var before7 = await nVehicles(), c7 = await resolve(u7.body.document.id, { action: 'create', fields: g7.body.extraction.fields });
  ok(c7.status === 400 && c7.body.details && c7.body.details.reason === 'vin_required_to_create' && await nVehicles() === before7, 'creating without a VIN is refused: no vehicle from uncertain OCR');
  var bv = await resolve(u7.body.document.id, { action: 'create', fields: { vin: 'ABC123' } });
  ok(bv.status === 400 && bv.body.details.reason === 'vin_invalid', 'an invalid VIN typed by the administrator is refused');
  var un = await resolve(u7.body.document.id, { action: 'unassigned', fields: g7.body.extraction.fields });
  ok(un.status === 200 && un.body.intake_status === 'unassigned' && (await row(u7.body.document.id)).vehicle_id === null, 'saved as an unassigned pending document');
  var at7 = await resolve(u7.body.document.id, { action: 'attach', fields: g7.body.extraction.fields, vehicle_ref: s6.body.vehicle.ivid });
  ok(at7.status === 200 && at7.body.intake_status === 'linked_existing_vehicle' && at7.body.vehicle.ivid === s6.body.vehicle.ivid && at7.body.conflicts.some(function (c) { return c.field === 'make'; }), 'once identity is resolved, the administrator attaches it to a named vehicle (conflicts reported)');

  say('\n8. RETRIES DO NOT DUPLICATE');
  var n8 = await nIntake(), d8 = await intake(T.MGR, D4, 'image/png', 1, 'upload');
  ok(d8.status === 200 && d8.body.duplicate && d8.body.document.id === u4.body.document.id && await nIntake() === n8, 'the same file again → the same document id, no new row');
  var d8b = await intake(T.MGR, D1, 'image/png', 1, 'camera');
  ok(d8b.status === 200 && d8b.body.duplicate && d8b.body.already_attached && !d8b.body.document && await nIntake() === n8, 'a file already attached to a vehicle → duplicate, without naming the vehicle');
  var v8 = await nVehicles(), again = await resolve(u1.body.document.id, { action: 'create', fields: fields6 });
  ok(again.status === 409 && again.body.details.reason === 'already_resolved' && await nVehicles() === v8, 'resolving twice → 409, no second vehicle');
  var D8 = png(1600, 1000, 51), par = await Promise.all([intake(T.MGR, D8, 'image/png', 1, 'upload'), intake(T.MGR, D8, 'image/png', 1, 'upload'), intake(T.MGR, D8, 'image/png', 1, 'upload')]);
  ok(new Set(par.map(function (x) { return x.body.document && x.body.document.id; })).size === 1 && (await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE sha256 = $1', [sha(D8)])).rows[0].n === 1, 'three simultaneous uploads of one file → one document');

  say('\n9. NO HOLDER DATA, NO PUBLIC ACCESS');
  var dump = JSON.stringify((await db.query('SELECT * FROM idauto_vehicle_documents WHERE intake_status IS NOT NULL')).rows) + JSON.stringify((await db.query('SELECT * FROM idauto_media_archive')).rows) +
    JSON.stringify((await db.query('SELECT * FROM idauto_vehicles')).rows) + JSON.stringify((await db.query("SELECT * FROM idauto_audit_log WHERE event_type LIKE 'vehicle_document.%' OR event_type LIKE 'vehicle.identify%'")).rows) +
    JSON.stringify((await db.query('SELECT * FROM idauto_vehicle_facts')).rows);
  ok(!/FOULEN|01234567|RUE X|proprietaire|cin_proprietaire|adresse/.test(dump), 'the holder\'s name, CIN and address returned by LENS are nowhere in IDauto (documents, archive, vehicles, facts, audit)');
  var l9 = await request('GET', '/api/carte-grise/intake?status=all', T.ADMIN);
  ok(l9.status === 200 && !/FOULEN|01234567|RUE X/.test(l9.buf.toString()) && l9.body.documents.length >= 5, 'the review list carries technical fields only');
  var inj = await resolve(u4.body.document.id, { action: 'unassigned', fields: { vin: '', proprietaire: 'FOULEN', cin: '01234567', adresse: 'RUE X', make: 'Seat' } });
  ok(inj.status === 200 && !/FOULEN|01234567|RUE X/.test(JSON.stringify((await row(u4.body.document.id)).intake_fields)), 'holder fields sent by a client are dropped, never stored');
  ok((await request('GET', '/api/carte-grise/intake', T.MGR)).status === 403 && (await request('GET', '/api/carte-grise/intake/' + u4.body.document.id + '/original', T.MGR)).status === 403
    && (await resolve(u4.body.document.id, { action: 'unassigned' }, T.MGR)).status === 403, 'a workshop can upload but cannot read the queue, the original, or resolve (admin only)');
  ok((await request('GET', '/api/carte-grise/intake', null)).status === 401 && (await request('GET', '/api/carte-grise/intake/' + u4.body.document.id + '/original', null)).status === 401, 'anonymous: 401');
  var pub = await request('POST', '/public/carte-grise/intake', null, png(1600, 1000, 61), { 'Content-Type': 'image/png', 'X-IDauto-Face': '1', 'X-IDauto-Input': 'upload' });
  ok(pub.status === 404, 'public intake is off unless the owner opens public deposit (same switch as Update 5)');
  process.env.IDAUTO_PUBLIC_CARTE_GRISE = '1';
  var pub2 = await request('POST', '/public/carte-grise/intake', null, png(1600, 1000, 62), { 'Content-Type': 'image/png', 'X-IDauto-Face': '1', 'X-IDauto-Input': 'upload' });
  ok(pub2.status === 202 && JSON.stringify(pub2.body) === JSON.stringify({ received: true, duplicate: false, review: 'pending' }), 'when opened: the visitor only learns « received, pending review » (no id, no vehicle, no field)');
  delete process.env.IDAUTO_PUBLIC_CARTE_GRISE;

  say('\nIDA-U6 carte grise intake: ' + pass + ' passed, ' + fail + ' failed');
  server.close(); lens.close();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });

async function storageGet(key) { return require(path.join(BASE, 'reference', 'documents', 'document-storage.js')).getStorage().get(key); }
