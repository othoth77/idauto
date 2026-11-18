#!/usr/bin/env node
'use strict';
// IDauto — Update 5 — carte grise capture: camera, upload (image / PDF), paste (image / text) → ONE pipeline that stores
// the original unchanged and marks it PENDING_LENS. No OCR, no extraction (owner decision 2026-11-18). Scratch database,
// scratch media, a real receiver process (the Haddad archive). No network beyond loopback.
var path = require('path'), http = require('http'), fs = require('fs'), os = require('os'), zlib = require('zlib'), crypto = require('crypto'), cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u5-media-')), HADDAD = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u5-haddad-'));
process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_PUBLIC_CARTE_GRISE; delete process.env.IDAUTO_CG_OCR_ENABLED; delete process.env.IDAUTO_LENS_URL;
var RPORT = 20853 + crypto.randomInt(0, 900), RTOKEN = crypto.randomBytes(24).toString('hex'), receiver = null;
function startReceiver() { receiver = cp.spawn(process.execPath, [path.join(BASE, 'ops', 'haddad', 'idauto-media-receiver.js')], { env: Object.assign({}, process.env, { IDAUTO_MEDIA_RECEIVER_TOKEN: RTOKEN, IDAUTO_MEDIA_RECEIVER_ROOT: HADDAD, IDAUTO_MEDIA_RECEIVER_PORT: String(RPORT) }), stdio: 'ignore' }); }
process.on('exit', function () { try { receiver && receiver.kill('SIGKILL'); } catch (e) {} [MEDIA, HADDAD].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }); });

var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'OTHER', 'ADMIN'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {}, ip = '10.43.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
ids[T.MGR] = { actor_ref: 'svc_u5_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_u5_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.ADMIN] = 'usr_u5_admin_' + run;
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
      res.on('end', function () { var b = Buffer.concat(c), parsed = null; try { parsed = JSON.parse(b.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, body: parsed, buf: b, headers: res.headers }); });
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
// a minimal but complete JPEG (SOI, SOF0 with dimensions, EOI) is enough for the type and size checks
function jpeg(w, h) { var sof = Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]); return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]), sof, crypto.randomBytes(200), Buffer.from([0xFF, 0xD9])]); }
function pdf(extra) { return Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' + (extra || '') + '% ' + crypto.randomBytes(8).toString('hex') + '\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'); }
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
async function freePlate() { for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999); if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b) }; } }
function freeVin() { var A = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', s = 'VF1'; for (var i = 0; i < 14; i++) s += A[crypto.randomInt(0, A.length)]; return s; }
function cg(token, ivid, bytes, type, face, method, filename, newVersion) { var h = { 'Content-Type': type, 'X-IDauto-Face': String(face || 1), 'X-IDauto-Input': method }; if (newVersion) h['X-IDauto-New-Version'] = '1'; if (filename) h['X-IDauto-Filename'] = encodeURIComponent(filename); return request('POST', '/api/vehicles/' + encodeURIComponent(ivid) + '/carte-grise', token, bytes, h); }
async function newVehicle(token) { var P = await freePlate(); var r = await request('POST', '/api/vehicles/register', token || T.ADMIN, { plate: { type: 'TU', series: P.series, number: P.number }, vin: freeVin(), make: 'Renault', model: 'Clio' }); return r.body.ivid; }
async function docs(ivid) { return (await db.query("SELECT d.* FROM idauto_vehicle_documents d JOIN idauto_vehicles v ON v.id = d.vehicle_id WHERE v.ivid = $1 AND d.document_type = 'carte_grise' ORDER BY d.id", [ivid])).rows; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }

  say('\n1. MIGRATION');
  for (var f of ['ida-u31-scan-photos.sql', 'ida-u4-archive-vin.sql', 'ida-u4b-vin-lookup-index.sql', 'ida-u5-carte-grise-sources.sql']) {
    var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', f), 'utf8');
    for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  }
  var cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'idauto_vehicle_documents'")).rows.map(function (r) { return r.column_name; });
  ok(['source_format', 'input_method', 'derived_storage_key', 'text_chars', 'review_status', 'processing_status', 'lens_job_ref', 'lens_extraction', 'extraction_version', 'processed_at', 'validation_status'].every(function (k) { return cols.indexOf(k) !== -1; }), 'migration (twice): source format, input method, crop, review, and the LENS columns for later');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE document_type = 'carte_grise' AND input_method = 'legacy' AND (source_format <> 'CARTE_GRISE_IMAGE' OR review_status <> 'accepted')")).rows[0].n === 0, 'existing cartes grises keep their meaning: images, accepted');

  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U5 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U5 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  process.env.IDAUTO_HADDAD_MEDIA_URL = 'http://127.0.0.1:' + RPORT + '/idauto-media'; process.env.IDAUTO_HADDAD_MEDIA_TOKEN = RTOKEN;
  startReceiver(); await sleep(700);
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var replica = require(path.join(BASE, 'reference', 'replica', 'haddad-replica.js')), archive = require(path.join(BASE, 'reference', 'archive', 'archive-service.js'));
  var IV = await newVehicle(T.ADMIN);
  var VIN0 = (await db.query("SELECT f.fact_value v FROM idauto_vehicle_facts f JOIN idauto_vehicles x ON x.id = f.vehicle_id WHERE x.ivid = $1 AND f.fact_key = 'vin'", [IV])).rows[0].v;

  say('\n2. CAMERA SCAN — the original photograph, and its corrected crop beside it');
  var PHOTO = png(1600, 1000, 3), CROP = jpeg(1400, 880);
  var r1 = await cg(T.MGR, IV, PHOTO, 'image/png', 1, 'camera', 'IMG_4031.png');
  ok(r1.status === 201 && r1.body.document && r1.body.document.source_format === 'CARTE_GRISE_IMAGE' && r1.body.document.input_method === 'camera', 'camera photo stored (201): image, input method « camera »');
  ok(r1.body.document.sha256 === sha(PHOTO) && r1.body.document.processing_status === 'PENDING_LENS' && r1.body.document.validation_status === 'NOT_VALIDATED', 'SHA-256 of the original; PENDING_LENS; not validated');
  var pv = await request('PUT', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/preview', T.MGR, CROP, { 'Content-Type': 'image/jpeg' });
  ok(pv.status === 200 && pv.body.has_preview, 'the corrected crop is stored as a separate preview');
  var orig = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/original', T.MGR);
  var prev = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/preview', T.MGR);
  ok(orig.status === 200 && orig.buf.equals(PHOTO) && orig.headers['content-type'] === 'image/png', 'the ORIGINAL comes back byte for byte (never re-encoded)');
  ok(prev.status === 200 && prev.buf.equals(CROP), 'and the crop separately');
  ok((await request('PUT', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/preview', T.MGR, jpeg(800, 500), { 'Content-Type': 'image/jpeg' })).status === 409, 'a preview is set once (409 after)');

  say('\n3. UPLOAD — image and PDF, original preserved');
  var UP = png(1200, 800, 7);
  var r2 = await cg(T.MGR, IV, UP, 'image/png', 2, 'upload', 'verso.png');
  ok(r2.status === 201 && r2.body.document.face === 2 && r2.body.document.input_method === 'upload' && r2.body.document.original_filename === 'verso.png', 'image file uploaded as the verso, original filename kept');
  var PDF = pdf();
  var r3 = await cg(T.ADMIN, IV, PDF, 'application/pdf', 1, 'upload', 'carte grise scannée.pdf', true);
  ok(r3.status === 201 && r3.body.document.source_format === 'CARTE_GRISE_PDF' && r3.body.document.mime_type === 'application/pdf' && r3.body.document.version === 2, 'PDF uploaded: CARTE_GRISE_PDF, version 2 of the recto');
  var po = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r3.body.document.id + '/original', T.ADMIN);
  ok(po.status === 200 && po.buf.equals(PDF) && /^attachment/.test(po.headers['content-disposition']) && /sandbox/.test(po.headers['content-security-policy']) && po.headers['x-content-type-options'] === 'nosniff', 'the PDF comes back identical, as an attachment (never rendered in the site), sandboxed, nosniff');

  say('\n4. PASTE — an image, and the TEXT exactly as pasted (UTF-8: Arabic, French, digits)');
  var PI = png(900, 600, 9);
  var r4 = await cg(T.ADMIN, IV, PI, 'image/png', 2, 'paste_image', null, true);
  if (r4.status !== 201) console.log('    paste_image answer:', r4.status, JSON.stringify(r4.body).slice(0, 300));
  ok(r4.status === 201 && r4.body.document.input_method === 'paste_image', 'pasted image stored (input « paste_image »)');
  var TEXT = 'REPUBLIQUE TUNISIENNE — الجمهورية التونسية\nCERTIFICAT D\'IMMATRICULATION  شهادة تسجيل\nN° d\'immatriculation : 173 تونس 8116\nN° de série (VIN) : ' + VIN0.slice(0, 10) + 'XXXXXXX\nMarque : CHEVROLET   Type : AVEO LS\n  espaces  conservés\ttabulation\r\nfin';
  var TB = Buffer.from(TEXT, 'utf8');
  var r5 = await cg(T.ADMIN, IV, TB, 'text/plain; charset=utf-8', 1, 'paste_text', null, true);
  ok(r5.status === 201 && r5.body.document.source_format === 'CARTE_GRISE_TEXT' && r5.body.document.mime_type === 'text/plain; charset=utf-8' && r5.body.document.processing_status === 'PENDING_LENS', 'pasted text stored as CARTE_GRISE_TEXT, PENDING_LENS');
  var to = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r5.body.document.id + '/original', T.ADMIN);
  ok(to.status === 200 && to.buf.equals(TB) && to.buf.toString('utf8') === TEXT, 'the text comes back BYTE FOR BYTE (Arabic, French, digits, spaces, tab, CRLF) — never converted');
  ok(r5.body.document.text_chars === Array.from(TEXT).length && sha(TB) === r5.body.document.sha256, 'character count and SHA-256 of the exact text');
  ok(/^attachment/.test(to.headers['content-disposition']), 'the text is downloaded, never rendered as a page');

  say('\n5. NOTHING IS READ OR EXTRACTED IN IDAUTO');
  var veh = (await db.query("SELECT make, model FROM idauto_vehicles WHERE ivid = $1", [IV])).rows[0];
  var vinNow = (await db.query("SELECT f.fact_value v FROM idauto_vehicle_facts f JOIN idauto_vehicles x ON x.id = f.vehicle_id WHERE x.ivid = $1 AND f.fact_key = 'vin' AND f.is_active", [IV])).rows[0].v;
  ok(String(veh.make).toUpperCase() === 'RENAULT' && String(veh.model).toUpperCase() === 'CLIO' && vinNow === VIN0, 'a pasted text naming another make and VIN changes NOTHING on the vehicle (no extraction)');
  var all = await docs(IV);
  ok(all.every(function (d) { return d.lens_extraction === null && d.lens_job_ref === null && d.extraction_version === null && d.processed_at === null && d.ocr_fields === null; }), 'no extraction, no OCR field, no LENS job on any document');
  ok(require(path.join(BASE, 'reference', 'lens', 'lens-adapter.js')).enabled() === false, 'the LENS interface exists and is NOT enabled');
  var lensErr = null; try { await require(path.join(BASE, 'reference', 'lens', 'lens-adapter.js')).submit({}); } catch (e) { lensErr = e; }
  ok(lensErr && lensErr.code === 'LENS_NOT_ENABLED', 'calling it refuses explicitly (LENS_NOT_ENABLED) — nothing is sent anywhere');
  var src = ['web/citizen/carte-grise-capture.js', 'web/citizen/home-carte-grise.js', 'reference/documents/carte-grise-service.js'].map(function (p) { return fs.readFileSync(path.join(BASE, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }).join('\n');
  ok(!/Tesseract|loadOcr|recognize\(|registration-parser|\/ocr['"]/i.test(src), 'the capture pipeline contains no OCR engine, no parser, no OCR call');
  var pages = ['web/citizen/index.html', 'reference/admin-vehicle.html', 'reference/app-dossier.html'].map(function (p) { return fs.readFileSync(path.join(BASE, p), 'utf8'); }).join('\n');
  ok(!/tesseract|home-registration\.js/i.test(pages), 'no page of the carte grise workflow loads Tesseract (it stays isolated in the vendor folder)');
  var scanSrc = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'registration-scanner.js'), 'utf8');
  ok(/if \(state\.mode === "capture"\) return captured\(\);/.test(scanSrc) && !/function captured\(\)[\s\S]{0,700}ocrFace|function captured\(\)[\s\S]{0,700}loadOcr/.test(scanSrc), 'the scanner\'s capture mode returns the images without any OCR step');
  var ocr = await request('POST', '/api/vehicles/' + encodeURIComponent(IV) + '/registration-document/ocr', T.MGR, { faces: [] });
  ok(ocr.status === 410, 'the legacy OCR route stays retired (410)');

  say('\n6. REFUSALS — decided from the bytes, not from the declared type');
  var bads = [
    [Buffer.from('GIF89a' + 'x'.repeat(200)), 'image/png', 'upload', 415, 'unsupported_type', 'a GIF declared as PNG → 415'],
    [Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n', 'latin1'), 'application/pdf', 'upload', 400, 'pdf_incomplete', 'a truncated PDF (no %%EOF) → refused'],
    [pdf('4 0 obj << /Encrypt 5 0 R >> endobj\n'), 'application/pdf', 'upload', 400, 'pdf_encrypted', 'an encrypted PDF → refused (cannot be kept as is)'],
    [PDF, 'application/pdf', 'camera', 400, 'pdf_only_by_upload', 'a PDF through the camera path → refused'],
    [Buffer.from([0x63, 0x61, 0xFF, 0xFE, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48]), 'text/plain; charset=utf-8', 'paste_text', 400, 'not_utf8', 'text that is not valid UTF-8 → refused'],
    [Buffer.from('court', 'utf8'), 'text/plain; charset=utf-8', 'paste_text', 400, 'too_short', 'a text too short to be a carte grise → refused'],
    [Buffer.from('un texte de carte grise assez long', 'utf8'), 'text/plain; charset=utf-8', 'upload', 400, 'text_only_by_paste', 'text only through the paste path'],
    [png(200, 150, 1), 'image/png', 'upload', 400, 'too_small', 'an image too small to read → refused'],
    [Buffer.alloc(0), 'image/png', 'upload', 400, null, 'an empty body → refused']
  ];
  for (var b of bads) { var rr = await cg(T.MGR, IV, b[0], b[1], 1, b[2]); ok(rr.status === b[3] && (b[4] === null || (rr.body && rr.body.details && rr.body.details.reason === b[4]) || JSON.stringify(rr.body).indexOf(b[4]) !== -1), b[5] + ' (' + rr.status + ')'); }
  ok((await cg(T.MGR, IV, Buffer.concat([Buffer.from('a'.repeat(10)), Buffer.alloc(70 * 1024, 0x61)]), 'text/plain; charset=utf-8', 1, 'paste_text')).status === 413, 'a text over 64 KB → 413');
  ok((await cg(T.MGR, IV, png(900, 600, 2), 'image/png', 1, 'telepathy')).status === 400, 'an unknown input method → refused');

  say('\n7. DUPLICATES AND VERSIONS');
  var before = (await docs(IV)).length;
  var dup = await cg(T.MGR, IV, PDF, 'application/pdf', 1, 'upload');
  ok(dup.status === 200 && dup.body.duplicate_of && dup.body.duplicate_of.id === r3.body.document.id && (await docs(IV)).length === before, 'the same file again → « already in the dossier » (200, duplicate_of), nothing stored twice');
  var h = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise', T.ADMIN);
  var rectos = h.body.documents.filter(function (d) { return d.face === 1; });
  ok(h.status === 200 && rectos.length === 3 && rectos.filter(function (d) { return d.current; }).length === 1 && rectos[0].current && rectos[0].source_format === 'CARTE_GRISE_TEXT', 'history: 3 recto versions (image, PDF, text), the newest is current, the others kept');
  ok(h.body.documents.every(function (d) { return d.uploaded_at && d.version && d.processing_status; }) && h.body.lens && h.body.lens.enabled === false, 'every entry has its upload date, version and processing status; LENS reported as not enabled');
  var IV2 = await newVehicle(T.ADMIN);
  ok((await cg(T.MGR, IV2, png(900, 600, 4), 'image/png', 2, 'upload')).status === 409, 'a verso alone on a vehicle without recto → 409 (as before)');

  say('\n8. ACCESS — organisations, anonymous visitors');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null)).status === 401, 'anonymous: no history (401)');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/original', null)).status === 401, 'anonymous: no original (401)');
  var other = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise', T.OTHER);
  ok(other.status === 200 && !other.body.documents.some(function (d) { return d.id === r1.body.document.id || d.id === r2.body.document.id; }) && other.body.documents.some(function (d) { return d.id === r3.body.document.id; }), 'another workshop sees the administration\'s accepted PDF, never workshop A\'s own deposits');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r1.body.document.id + '/original', T.OTHER)).status === 404, 'and cannot open them (404)');

  say('\n9. PUBLIC DEPOSIT — off by default; when on, it waits for an administrator');
  var cfg0 = await request('GET', '/public/carte-grise-config', null);
  ok(cfg0.status === 200 && cfg0.body.public_deposit === false, 'config says public deposit is off');
  var PUB = png(1000, 700, 13);
  ok((await request('POST', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null, PUB, { 'Content-Type': 'image/png', 'X-IDauto-Input': 'upload' })).status === 404, 'off → the route does not exist (404)');
  process.env.IDAUTO_PUBLIC_CARTE_GRISE = '1';
  var pd = await request('POST', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null, PUB, { 'Content-Type': 'image/png', 'X-IDauto-Input': 'upload' });
  ok(pd.status === 202 && pd.body.received === true && pd.body.review === 'pending' && !pd.body.document, 'on → 202 « received, pending review »; the visitor learns nothing else');
  var pr = (await docs(IV)).filter(function (d) { return d.sha256 === sha(PUB); })[0];
  ok(pr && pr.review_status === 'pending_review' && pr.org_id === null && /^public:/.test(pr.created_by), 'stored as pending_review, recorded as a public deposit');
  var cur1 = (await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise', T.ADMIN)).body.documents.filter(function (d) { return d.face === 1 && d.current; })[0];
  ok(cur1.id === r5.body.document.id, 'a public deposit is NEVER the current carte grise by itself');
  ok((await request('POST', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null, Buffer.from('un texte public de carte grise', 'utf8'), { 'Content-Type': 'text/plain; charset=utf-8', 'X-IDauto-Input': 'paste_text' })).status === 202, 'a visitor can paste text too (pending)');
  ok((await request('POST', '/public/vehicles/' + encodeURIComponent('ivid:1:ZZZZZZZZZZZZZZZZ:ZZ') + '/carte-grise', null, png(900, 600, 5), { 'Content-Type': 'image/png', 'X-IDauto-Input': 'upload' })).status === 404, 'an unknown vehicle → 404');
  ok((await request('POST', '/api/carte-grise/' + pr.id + '/review', T.MGR, { decision: 'accepted' })).status === 403, 'a workshop cannot accept a public deposit (403)');
  var acc = await request('POST', '/api/carte-grise/' + pr.id + '/review', T.ADMIN, { decision: 'accepted' });
  var cur2 = (await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise', T.ADMIN)).body.documents.filter(function (d) { return d.face === 1 && d.current; })[0];
  ok(acc.status === 200 && cur2.id === String(pr.id) && cur2.review.status === 'accepted' && cur2.review.by === 'usr_u5_admin_' + run, 'the administrator accepts it: it becomes the current recto, with who accepted it');
  ok((await request('POST', '/api/carte-grise/' + pr.id + '/review', T.ADMIN, { decision: 'rejected' })).status === 409, 'a decision is final (409 on a second one)');
  for (var k = 0; k < 8; k++) await request('POST', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null, png(900, 600, 20 + k), { 'Content-Type': 'image/png', 'X-IDauto-Input': 'upload' });
  ok((await request('POST', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise', null, png(900, 600, 40), { 'Content-Type': 'image/png', 'X-IDauto-Input': 'upload' })).status === 429, 'public deposits are rate-limited per visitor (429)');
  delete process.env.IDAUTO_PUBLIC_CARTE_GRISE;

  say('\n10. UPDATE 5.1 — STATUS FROM THE DATABASE; NO ACCIDENTAL DUPLICATE');
  var st1 = await request('GET', '/public/vehicles/' + encodeURIComponent(IV) + '/carte-grise-status', null);
  ok(st1.status === 200 && st1.body.exists === true && /^\d{4}-\d{2}-\d{2}$/.test(st1.body.latest_date) && Object.keys(st1.body).sort().join() === 'exists,latest_date', 'existing carte grise detected from the database: { exists: true, latest_date } — nothing else (no id, no file)');
  var IV3 = await newVehicle(T.ADMIN);
  var st0 = await request('GET', '/public/vehicles/' + encodeURIComponent(IV3) + '/carte-grise-status', null);
  ok(st0.status === 200 && st0.body.exists === false && st0.body.latest_date === null, 'missing carte grise: { exists: false }');
  ok((await request('GET', '/public/vehicles/' + encodeURIComponent('ivid:1:ZZZZZZZZZZZZZZZZ:ZZ') + '/carte-grise-status', null)).status === 404, 'unknown vehicle → 404');
  var w1 = await cg(T.MGR, IV, png(1000, 700, 61), 'image/png', 1, 'upload');
  ok(w1.status === 409 && w1.body.details.reason === 'carte_grise_exists', 'a workshop upload over an existing recto is refused (409 carte_grise_exists): nothing replaced');
  var a1 = await cg(T.ADMIN, IV, png(1000, 700, 63), 'image/png', 1, 'upload');
  ok(a1.status === 409 && a1.body.details.reason === 'carte_grise_exists_new_version_required', 'even an administrator needs the explicit « new version » (409 without it)');
  var a2 = await cg(T.ADMIN, IV, png(1000, 700, 63), 'image/png', 1, 'upload', 'v-new.png', true);
  ok(a2.status === 201 && a2.body.replaced === true && a2.body.document.current, 'administrator + explicit new version → a new current version, the previous one kept');
  ok((await cg(T.MGR, IV, png(1000, 700, 65), 'image/png', 1, 'upload', null, true)).status === 409, 'a workshop cannot force a new version with the flag (409)');
  var f1 = await cg(T.MGR, IV3, png(1000, 700, 67), 'image/png', 1, 'camera');
  var st2 = await request('GET', '/public/vehicles/' + encodeURIComponent(IV3) + '/carte-grise-status', null);
  ok(f1.status === 201 && st2.body.exists === true, 'first carte grise of a vehicle: stored, and the status flips to « exists » at once');

  say('\n11. PERSISTENCE AND THE HADDAD ARCHIVE (PDF and text included)');
  for (var s = 0; s < 8; s++) { await replica.pass(); await archive.pass(); await sleep(250); }
  var ar = (await db.query("SELECT a.archive_status, a.archive_path, a.mime_type, a.sha256 FROM idauto_media_archive a JOIN idauto_vehicles v ON v.id = a.vehicle_id WHERE v.ivid = $1 AND a.category = 'carte-grise'", [IV])).rows;
  var arTxt = ar.filter(function (a) { return a.sha256 === sha(TB); })[0], arPdf = ar.filter(function (a) { return a.sha256 === sha(PDF); })[0];
  ok(arTxt && arTxt.archive_status === 'stored' && /\.txt$/.test(arTxt.archive_path) && fs.readFileSync(path.join(HADDAD, arTxt.archive_path)).equals(TB), 'the pasted text is archived on Haddad as .txt, identical bytes');
  ok(arPdf && arPdf.archive_status === 'stored' && /\.pdf$/.test(arPdf.archive_path) && fs.readFileSync(path.join(HADDAD, arPdf.archive_path)).equals(PDF), 'the PDF is archived on Haddad as .pdf, identical bytes');
  require(path.join(BASE, 'reference', 'documents', 'document-storage.js'))._reset();
  var again = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/carte-grise/' + r3.body.document.id + '/original', T.ADMIN);
  ok(again.status === 200 && again.buf.equals(PDF), 'documents persist (re-read from storage after a reset of the storage adapter)');

  say('\nIDA-U5 carte grise capture: ' + pass + ' passed, ' + fail + ' failed');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
