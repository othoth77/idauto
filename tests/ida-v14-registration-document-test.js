'use strict';
/* IDA-V14 — CARTE GRISE: document faces, storage, OCR proposal, confirmation.
 * Owner order, 2026-09-05. HTTP against a scratch database, signed in through
 * Better Auth as admin / manager / technician of two organisations.
 *
 * Images here are SYNTHETIC (generated PNG/JPEG bytes): the point is the
 * server contract — sniffing, limits, faces, replacement, deletion, scopes,
 * organisation isolation, OCR parsing of a synthetic card text, conflict
 * detection, the single write path, provenance, and what is never logged.
 * The real pipeline (Scanic + Tesseract on a rendered card) is exercised by
 * tests/ida-v14-registration-browser-test.js.
 */
var http = require('http');
var fs = require('fs');
var zlib = require('zlib');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port, api, logLines = [], realLog = console.log;

// A valid PNG of w×h grey pixels, built by hand (no image library).
function png(w, h, shade) {
  function chunk(type, data) { var len = Buffer.alloc(4); len.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); }
  var table = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var raw = Buffer.alloc((w + 1) * h); for (var y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (var x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (shade + x + y) & 0xFF; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A minimal JPEG header (SOI + SOF0 with dimensions) followed by junk: enough for the sniffer, and honest about what it is.
function jpegHeader(w, h) { var sof = Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, (h >> 8) & 0xFF, h & 0xFF, (w >> 8) & 0xFF, w & 0xFF, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]); return Buffer.concat([Buffer.from([0xFF, 0xD8]), sof, Buffer.from([0xFF, 0xD9])]); }

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.raw ? opts.raw : (opts.body ? Buffer.from(JSON.stringify(opts.body)) : null);
    var headers = Object.assign({ 'Content-Length': payload ? payload.length : 0 }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.cookie) { headers.Cookie = opts.cookie; headers['X-IDauto-Session'] = '1'; headers.Origin = 'http://127.0.0.1:' + port; }
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var buf = Buffer.concat(c), parsed = null; try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V14 A','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V14 B','garage','active') RETURNING id")).rows[0].id;
  api = require(path.join(BASE, 'reference', 'api.js'));
  server = api.createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); }); port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  console.log = function () { var line = Array.prototype.map.call(arguments, String).join(' '); logLines.push(line); realLog.apply(console, arguments); };
  var run = crypto.randomBytes(4).toString('hex'), PW = 'Carte-Grise-' + run + '-2026';
  var PLATE_S = String(100 + Math.floor(Math.random() * 899)), PLATE_N = String(1000 + Math.floor(Math.random() * 8999));
  async function user(role, org) { var email = role + '-' + (org || 'x') + '-' + run + '@idauto.test'; var c = await auth.api.signUpEmail({ body: { email: email, password: PW, name: role } }); await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, org || null, c.user.id]); var s = await auth.api.signInEmail({ body: { email: email, password: PW }, returnHeaders: true }); return String(s.headers.get('set-cookie')).split(';')[0]; }
  var ADMIN = await user('admin', null), MGR_A = await user('manager', orgA), TECH_A = await user('technician', orgA), TECH_B = await user('technician', orgB);

  // A vehicle owned by nobody in particular, created by technician A through the official path.
  var created = await request('POST', '/api/resolve/confirm', { cookie: TECH_A, body: { plate: PLATE_S + ' TU ' + PLATE_N, candidate: { manufacturer: 'PEUGEOT', model: '208', year: 2019 }, method: 'manual_selection' } });
  ok(created.status === 200, 'precondition: a vehicle exists (' + created.status + ')');
  var IVID = created.body.vehicle.id;
  var DOC = '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document';
  var shade = crypto.randomBytes(1)[0];   // per-run bytes: the store is content-addressed and the scratch DB persists
  var IMG = png(1200, 800, shade), IMG2 = png(1100, 760, (shade + 50) & 0xFF), THUMB = png(400, 267, (shade + 3) & 0xFF);

  say('\n1. GATES');
  ok((await request('GET', DOC)).status === 401, 'no session -> 401');
  ok((await request('PUT', DOC + '/1', { raw: IMG, headers: { 'Content-Type': 'image/png' } })).status === 401, 'upload without session -> 401');
  var none = await request('GET', DOC, { cookie: TECH_A });
  ok(none.status === 200 && none.body.has_document === false && none.body.faces[1] === null && none.body.faces[2] === null, 'document absent -> faces 1 and 2 are null');
  ok((await request('GET', '/api/vehicles/ivid:1:ZZZZZZZZZZZZZZZZ:ZZ/registration-document', { cookie: TECH_A })).status === 404, 'unknown vehicle -> 404');

  say('\n2. VALIDATION — bytes are sniffed, never trusted');
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: Buffer.from('not an image'), headers: { 'Content-Type': 'image/png' } })).status === 415, 'non-image bytes with an image Content-Type -> 415');
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: png(100, 80, 0), headers: { 'Content-Type': 'image/png' } })).status === 400, 'a 100×80 image -> 400 (too small for a document)');
  var big = Buffer.concat([png(1200, 800, 0), Buffer.alloc(7 * 1024 * 1024, 0)]);
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: big, headers: { 'Content-Type': 'image/png' } })).status === 413, 'a 7 MB image -> 413 (the browser pipeline must compress)');
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: jpegHeader(6000, 4000).length ? jpegHeader(6000, 4000) : IMG, headers: { 'Content-Type': 'image/jpeg' } })).status === 400, 'a 6000×4000 image -> 400 (dimensions)');
  ok((await request('PUT', DOC + '/3', { cookie: TECH_A, raw: IMG, headers: { 'Content-Type': 'image/png' } })).status === 400, 'face 3 -> 400');
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: Buffer.alloc(0) })).status === 400, 'an empty body -> 400');
  var corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(30, 0)]);
  ok((await request('PUT', DOC + '/1', { cookie: TECH_A, raw: corrupt, headers: { 'Content-Type': 'image/png' } })).status === 415, 'a corrupt PNG header -> 415');
  ok((await request('PUT', DOC + '/2', { cookie: TECH_A, raw: IMG2, headers: { 'Content-Type': 'image/png' } })).status === 409, 'face 2 before face 1 -> 409 (face 2 is optional but never alone)');

  say('\n3. FACE 1 ONLY');
  var f1 = await request('PUT', DOC + '/1', { cookie: TECH_A, raw: IMG, headers: { 'Content-Type': 'application/octet-stream', 'X-IDauto-Original-Bytes': '6234567', 'X-IDauto-Capture': 'auto', 'X-IDauto-Quality': '0.85', 'X-IDauto-Max-Edge': '1600' } });
  ok(f1.status === 201 && f1.body.face.face === 1 && f1.body.face.mime_type === 'image/png' && f1.body.face.width === 1200 && f1.body.face.height === 800, 'face 1 stored: MIME and dimensions come from the bytes, not the header');
  ok(f1.body.face.original_byte_size === 6234567 && f1.body.face.capture.detection === 'auto' && f1.body.face.capture.quality === 0.85, 'capture metadata recorded (original size, detection, quality)');
  ok(f1.body.face.sha256 === crypto.createHash('sha256').update(IMG).digest('hex'), 'sha256 of the stored bytes');
  ok(!('storage_key' in f1.body.face) && f1.raw.toString().indexOf(process.env.IDAUTO_MEDIA_STORAGE_PATH) === -1, 'no storage key and no filesystem path in the answer');
  var t1 = await request('PUT', DOC + '/1/thumbnail', { cookie: TECH_A, raw: THUMB });
  ok(t1.status === 200 && t1.body.thumbnail.width === 400, 'thumbnail stored');
  var one = await request('GET', DOC, { cookie: TECH_A });
  ok(one.body.has_document && one.body.faces[1] && one.body.faces[1].has_thumbnail && one.body.faces[2] === null, 'face 1 present with thumbnail, face 2 null — no fake verso');
  var img = await request('GET', DOC + '/1/image', { cookie: TECH_A });
  ok(img.status === 200 && img.headers['content-type'] === 'image/png' && img.raw.equals(IMG) && /no-store/.test(img.headers['cache-control']), 'GET image returns the exact bytes, private, no-store');
  var thumb = await request('GET', DOC + '/1/image?variant=thumb', { cookie: TECH_A });
  ok(thumb.status === 200 && thumb.raw.equals(THUMB), 'GET image?variant=thumb returns the thumbnail');
  ok((await request('GET', DOC + '/1/image')).status === 401, 'image without session -> 401');
  ok((await request('GET', DOC + '/2/image', { cookie: TECH_A })).status === 404, 'absent face image -> 404');

  say('\n4. ORGANISATION ISOLATION AND ROLES');
  var b = await request('GET', DOC, { cookie: TECH_B });
  ok(b.status === 200 && b.body.has_document === false, "technician of organisation B sees NO document of organisation A's upload");
  ok((await request('GET', DOC + '/1/image', { cookie: TECH_B })).status === 404, 'and cannot fetch the image (404, not 403 — existence is not disclosed)');
  ok((await request('PUT', DOC + '/1', { cookie: TECH_B, raw: IMG2, headers: { 'Content-Type': 'image/png' } })).status === 404, "and cannot replace organisation A's face");
  ok((await request('DELETE', DOC + '/1', { cookie: TECH_A })).status === 403, 'technician: delete -> 403 (no document:delete)');
  ok((await request('DELETE', DOC + '/1', { cookie: TECH_B })).status === 403, 'technician B: delete -> 403 as well');
  var mgrView = await request('GET', DOC, { cookie: MGR_A });
  ok(mgrView.status === 200 && mgrView.body.has_document, 'manager of organisation A sees it');
  var admView = await request('GET', DOC, { cookie: ADMIN });
  ok(admView.status === 200 && admView.body.has_document && admView.body.faces[1].org_id === orgA, 'admin sees it, with the owning organisation');

  say('\n5. FACE 2, REPLACEMENT');
  var f2 = await request('PUT', DOC + '/2', { cookie: TECH_A, raw: IMG2, headers: { 'Content-Type': 'image/png', 'X-IDauto-Capture': 'manual' } });
  ok(f2.status === 201 && f2.body.face.face === 2 && f2.body.face.capture.detection === 'manual', 'face 2 stored (manual crop recorded)');
  var both = await request('GET', DOC, { cookie: TECH_A });
  ok(both.body.faces[1] && both.body.faces[2] && both.body.faces[2].width === 1100, 'both faces listed');
  var IMG1b = png(1300, 900, (shade + 120) & 0xFF);
  var r1 = await request('PUT', DOC + '/1', { cookie: TECH_A, raw: IMG1b, headers: { 'Content-Type': 'image/png' } });
  ok(r1.status === 200 && r1.body.replaced === true && r1.body.face.width === 1300, 'rescanning face 1 replaces it (200, replaced:true)');
  ok((await request('GET', DOC + '/1/image', { cookie: TECH_A })).raw.equals(IMG1b), 'the new bytes are served');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) AND face = 1", [IVID])).rows[0].n === 1, 'exactly one face-1 row (unique per vehicle/type/face)');
  var storageMod = require(path.join(BASE, 'reference', 'documents', 'document-storage.js')).getStorage();
  ok((await storageMod.exists(crypto.createHash('sha256').update(IMG).digest('hex'))) === false, 'the replaced bytes are removed from the store (no other reference)');
  var r2 = await request('PUT', DOC + '/2', { cookie: MGR_A, raw: png(1000, 700, (shade + 200) & 0xFF), headers: { 'Content-Type': 'image/png' } });
  ok(r2.status === 200 && r2.body.replaced === true, 'the manager replaces face 2');
  var audits = (await db.query("SELECT event_type, actor_type, org_id FROM idauto_audit_log WHERE event_type LIKE 'vehicle_document.%' AND org_id = $1 ORDER BY id", [orgA])).rows;
  ok(audits.length >= 5 && audits.every(function (a) { return String(a.org_id) === String(orgA); }), 'every document write is audited with the organisation (' + audits.length + ' rows)');
  var auditJson = (await db.query("SELECT new_value_json FROM idauto_audit_log WHERE event_type = 'vehicle_document.upsert' ORDER BY id DESC LIMIT 1")).rows[0].new_value_json;
  ok(auditJson.indexOf('storage_key') === -1 && auditJson.indexOf('/home/') === -1, 'the audit row carries metadata, no key and no path');

  say('\n6. OCR — proposal, comparison, conflict, single write path, provenance');
  var recto = 'REPUBLIQUE TUNISIENNE\nCERTIFICAT D IMMATRICULATION\nN° D IMMATRICULATION : ' + PLATE_S + ' تونس ' + PLATE_N + '\nMARQUE : PEUGEOT\nTYPE : 208 1.2 PURETECH\nGENRE : VP\nN° DE SERIE DU TYPE : VF3CCHMZ0JT01' + run.slice(0, 4).toUpperCase().replace(/[IOQ]/g, 'X') + '\nENERGIE : ES\nPUISSANCE FISCALE : 5\nNOMBRE DE PLACES : 05\nCYLINDREE : 1199\nD.P.M.C : 12/03/2018\nNOM : BEN SALAH MOHAMED\nADRESSE : 12 RUE DE LA LIBERTE TUNIS\nCIN 01234567';
  var verso = 'POIDS TOTAL : 1560\nTYPE MOTEUR : HM01\nالاسم\nفلان الفلاني';
  ok((await request('POST', DOC + '/ocr', { cookie: TECH_A, body: { faces: [] } })).status === 400, 'OCR without faces -> 400');
  var ocr = await request('POST', DOC + '/ocr', { cookie: TECH_A, body: { faces: [{ face: 1, text: recto, confidence: 84 }, { face: 2, text: verso, confidence: 71 }] } });
  ok(ocr.status === 200 && ocr.body.requires_confirmation === true && ocr.body.candidate.manufacturer === 'PEUGEOT', 'OCR returns a proposal that requires confirmation');
  var items = {}; ocr.body.comparison.items.forEach(function (i) { items[i.key] = i; });
  ok(items.plate && items.plate.status === 'same' && items.plate.proposed === PLATE_S + ' TUN ' + PLATE_N, 'plate OCR « S تونس N » = current plate → same (no conflict)');
  ok(items.manufacturer.status === 'same' && items.model.status === 'conflict' && items.model.current === '208', 'manufacturer same; model « 208 1.2 PURETECH » vs « 208 » → CONFLICT, not replaced');
  ok(items.year.status === 'conflict' && items.year.current === 2019 && items.year.proposed === 2018, 'year 2018 vs 2019 → conflict');
  ok(items.vin && items.vin.status === 'new' && items.fuel_type.status === 'new' && items.engine_cc.proposed === 1199 && items.seats.proposed === 5 && items.gross_weight_kg.proposed === 1560, 'VIN, fuel, cc, seats (face 1) and weight (face 2) proposed as new');
  ok(ocr.body.comparison.conflicts === 2, 'two conflicts counted');
  var rawOut = ocr.raw.toString();
  ok(rawOut.indexOf('SALAH') === -1 && rawOut.indexOf('LIBERTE') === -1 && rawOut.indexOf('01234567') === -1 && rawOut.indexOf('فلان') === -1, 'no holder data (name, address, CIN) in the OCR answer');
  var storedOcr = (await db.query("SELECT ocr_status, ocr_confidence, ocr_fields::text f FROM idauto_vehicle_documents WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) ORDER BY face", [IVID])).rows;
  ok(storedOcr.length === 2 && storedOcr[0].ocr_status === 'extracted' && storedOcr[0].f.indexOf('SALAH') === -1 && storedOcr[0].f.indexOf('MARQUE') !== -1 && storedOcr[1].f.indexOf('POIDS') !== -1, 'each face row stores its technical fields, never the raw text or the holder');
  var vehicleBefore = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/fiche', { cookie: TECH_A });
  ok(vehicleBefore.body.model === '208' && vehicleBefore.body.year === 2019 && vehicleBefore.body.vin_present === false, 'NOTHING was written to the vehicle by the OCR step');
  var list2 = await request('GET', DOC, { cookie: TECH_A });
  ok(list2.body.ocr && list2.body.ocr.status === 'extracted' && list2.body.ocr.fields.some(function (f) { return f.key === 'vin'; }), 'the document view carries the extracted fields');
  // The person keeps model and year, accepts the rest.
  var accepted = { manufacturer: 'PEUGEOT', fuel_type: ocr.body.candidate.fuel_type, engine_cc: 1199, seats: 5, gross_weight_kg: 1560, category_code: 'M1', engine_code: 'HM01' };
  var confirm = await request('POST', DOC + '/confirm', { cookie: TECH_A, body: { candidate: accepted, vin: ocr.body.candidate.vin, confidence: ocr.body.confidence } });
  ok(confirm.status === 200 && confirm.body.vehicle.model === '208' && confirm.body.vehicle.year === 2019, 'confirmation writes only the accepted fields — the conflicting model and year stay as they were');
  ok(confirm.body.vehicle.engine_cc === 1199 && confirm.body.vehicle.seats === 5 && confirm.body.vehicle.gross_weight_kg === 1560 && confirm.body.vehicle.fuel_type === 'petrol' && confirm.body.vehicle.vin_present === true, 'accepted fields and the VIN are written');
  ok(confirm.body.vehicle.source === 'carte_grise_ocr' && confirm.body.vehicle.verification_method === 'carte_grise_ocr' && confirm.body.vehicle.verified === true, 'provenance: identification_source = carte_grise_ocr, method carte_grise_ocr');
  var hist = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/identification/history', { cookie: TECH_A });
  ok(hist.body.history[0].action === 'edited' && hist.body.history[0].source === 'carte_grise_ocr' && hist.body.history[0].method === 'carte_grise_ocr', 'the identification history records the carte grise step');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) AND ocr_status = 'confirmed'", [IVID])).rows[0].n === 2, 'both faces are marked ocr confirmed');
  var pub = await request('GET', '/public/passport/' + encodeURIComponent(IVID));
  ok(pub.status === 200 && pub.raw.toString().indexOf('registration') === -1 && pub.raw.toString().indexOf(ocr.body.candidate.vin) === -1, 'the public passport shows no document and no VIN');

  say('\n7. DELETE');
  var del = await request('DELETE', DOC + '/2', { cookie: MGR_A });
  ok(del.status === 200 && del.body.deleted === true, 'manager deletes face 2');
  var after = await request('GET', DOC, { cookie: TECH_A });
  ok(after.body.faces[1] && after.body.faces[2] === null, 'face 1 remains, face 2 is null again');
  ok((await request('GET', DOC + '/2/image', { cookie: MGR_A })).status === 404, 'the deleted image is gone (404)');
  ok((await request('DELETE', DOC + '/2', { cookie: MGR_A })).status === 404, 'deleting an absent face -> 404');
  ok((await request('DELETE', DOC + '/1', { cookie: ADMIN })).status === 200 && (await request('GET', DOC, { cookie: ADMIN })).body.has_document === false, 'admin deletes face 1: document absent');

  say('\n8. LOGS AND STRUCTURE');
  var all = logLines.join('\n');
  ok(all.indexOf('SALAH') === -1 && all.indexOf('LIBERTE') === -1 && all.indexOf(process.env.IDAUTO_MEDIA_STORAGE_PATH) === -1, 'no holder data, no OCR text and no storage path in any log line');
  ok(/registration_document_stored/.test(all) && /registration_ocr_done/.test(all), 'structured events were emitted');
  var routesSrc = fs.readFileSync(path.join(BASE, 'reference', 'v14-routes.js'), 'utf8');
  ok(!/INSERT\s+INTO|UPDATE\s+idauto_|DELETE\s+FROM|readFileSync|writeFileSync/.test(routesSrc), 'v14-routes.js holds no SQL and no filesystem access');
  ok(/resolver\.confirm\(/.test(routesSrc) && !/saveIdentification|createIdentifiedVehicle/.test(routesSrc + fs.readFileSync(path.join(BASE, 'reference', 'documents', 'document-service.js'), 'utf8')), 'the only identification write is resolver.confirm()');
  var uiSrc = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'registration-scanner.js'), 'utf8') + fs.readFileSync(path.join(BASE, 'web', 'citizen', 'passport-document.js'), 'utf8');
  ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(uiSrc), 'the browser modules never persist anything (no storage, no cookie access)');
  ok((await request('GET', '/atelier/assets/scanic.umd.js')).status === 200 && (await request('GET', '/atelier/assets/tesseract/fra.traineddata.gz')).status === 200 && (await request('GET', '/atelier/assets/tesseract/ara.traineddata.gz')).status === 200, 'Scanic and the French/Arabic OCR models are served from this origin');
  ok(fs.existsSync(path.join(BASE, 'web', 'vendor', 'scanic', 'scanic.LICENSE')) && /MIT/.test(fs.readFileSync(path.join(BASE, 'web', 'vendor', 'scanic', 'scanic.LICENSE'), 'utf8')), 'Scanic ships with its MIT licence');

  console.log = realLog;
  server.close(); await db.closePool();
  console.log('\nIDA-V14 registration document: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log = realLog; console.error('FATAL: ' + (e && e.stack || e)); process.exit(1); });
