#!/usr/bin/env node
'use strict';
// IDauto — Update 4 — monthly photo / carte grise archive on Haddad, archive records, carte grise versions, the admin
// dossier routes, LENS (a local stub that returns holder data, to prove it never reaches IDauto), VIN lookup end to end.
// Scratch database, scratch media directory, a REAL receiver process on a local port. No network beyond loopback.
var path = require('path');
var http = require('http');
var fs = require('fs');
var os = require('os');
var zlib = require('zlib');
var crypto = require('crypto');
var cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u4-media-')), HADDAD = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u4-haddad-')), LENSHOME = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u4-lens-'));
process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_PUBLIC_SCAN_STORE; delete process.env.IDAUTO_VISION_PROVIDER; delete process.env.IDAUTO_VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;
var RPORT = 19853 + crypto.randomInt(0, 900), RTOKEN = crypto.randomBytes(24).toString('hex'), LPORT = RPORT + 1000, LTOKEN = crypto.randomBytes(20).toString('hex');
fs.writeFileSync(path.join(LENSHOME, 'api.token'), LTOKEN, { mode: 0o600 });

// ---- a LENS stub: the real API shape (docs/API.md v1), and a result that INCLUDES holder data -----------------------
var LENS_SEEN = [];
var lens = http.createServer(function (req, res) {
  var auth = req.headers.authorization === 'Bearer ' + LTOKEN, c = [];
  req.on('data', function (d) { c.push(d); });
  req.on('end', function () {
    LENS_SEEN.push({ method: req.method, url: req.url, auth: auth, bytes: Buffer.concat(c).length, body: req.method === 'POST' && /jobs$/.test(req.url) ? JSON.parse(Buffer.concat(c).toString()) : null });
    res.setHeader('Content-Type', 'application/json');
    if (!auth) { res.statusCode = 401; return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/v1/files') { res.statusCode = 201; return res.end(JSON.stringify({ file_id: 'file_' + crypto.randomBytes(6).toString('hex'), sha256: crypto.createHash('sha256').update(Buffer.concat(c)).digest('hex') })); }
    if (req.method === 'POST' && req.url === '/v1/jobs') { var j = JSON.parse(Buffer.concat(c).toString()); res.statusCode = 201; return res.end(JSON.stringify({ job_id: j.job_id, state: 'queued' })); }
    if (req.method === 'GET' && /^\/v1\/jobs\/[^/]+$/.test(req.url)) return res.end(JSON.stringify({ state: 'succeeded' }));
    if (req.method === 'GET' && /\/result$/.test(req.url)) return res.end(JSON.stringify({ schema_version: 'lens.extraction-result/1', status: 'completed', document_type: 'tn-vehicle-registration', fields: [
      { field_key: 'vin', raw_value: 'X', normalized_value: 'KPT60A1YSLP025697', state: 'extracted', confidence: 0.93, sources: [] },
      { field_key: 'marque', raw_value: 'X', normalized_value: 'KIA', state: 'extracted', confidence: 0.9, sources: [] },
      { field_key: 'proprietaire', raw_value: 'X', normalized_value: 'FOULEN BEN FOULEN', state: 'extracted', confidence: 0.9, sources: [] },
      { field_key: 'cin_proprietaire', raw_value: 'X', normalized_value: '01234567', state: 'extracted', confidence: 0.9, sources: [] },
      { field_key: 'adresse', raw_value: 'X', normalized_value: '12 RUE X TUNIS', state: 'extracted', confidence: 0.9, sources: [] }] }));
    res.statusCode = 404; res.end('{}');
  });
});

var receiver = null;
function startReceiver(extra) {
  receiver = cp.spawn(process.execPath, [path.join(BASE, 'ops', 'haddad', 'idauto-media-receiver.js')], { env: Object.assign({}, process.env, { IDAUTO_MEDIA_RECEIVER_TOKEN: RTOKEN, IDAUTO_MEDIA_RECEIVER_ROOT: HADDAD, IDAUTO_MEDIA_RECEIVER_PORT: String(RPORT),
    IDAUTO_LENS_URL: 'http://127.0.0.1:' + LPORT, IDAUTO_LENS_TOKEN_FILE: path.join(LENSHOME, 'api.token') }, extra || {}), stdio: 'ignore' });
}
process.on('exit', function () { try { receiver && receiver.kill('SIGKILL'); } catch (e) {} [MEDIA, HADDAD, LENSHOME].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }); });

var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'ADMIN'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {}, ip = '10.42.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
ids[T.MGR] = { actor_ref: 'svc_u4_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.ADMIN] = 'usr_u4_admin_' + run;
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;
function raw(method, host, prt, p, headers, body) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var h = Object.assign({ 'Content-Length': payload ? payload.length : 0 }, headers || {});
    if (payload && !h['Content-Type']) h['Content-Type'] = Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json';
    var req = http.request({ hostname: host, port: prt, path: p, method: method, headers: h }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var b = Buffer.concat(c), parsed = null; try { parsed = JSON.parse(b.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, body: parsed, buf: b, headers: res.headers }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function request(method, p, token, body, headers) { var h = Object.assign({ 'X-Real-IP': ip }, headers || {}); if (token) h.Authorization = 'Bearer ' + token; if (Buffer.isBuffer(body) && !h['Content-Type']) h['Content-Type'] = 'image/png'; return raw(method, '127.0.0.1', port, p, h, body); }
function recv(method, p, body, token) { return raw(method, '127.0.0.1', RPORT, p, token === null ? {} : { Authorization: 'Bearer ' + (token || RTOKEN) }, body); }
function png(w, h, shade) {
  function chunk(type, data) { var len = Buffer.alloc(4); len.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); }
  var table = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  var rawb = Buffer.alloc((w + 1) * h); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) rawb[y * (w + 1) + 1 + x] = (shade + x * 3 + y) & 0xFF;
  crypto.randomBytes(64).copy(rawb, 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rawb)), chunk('IEND', Buffer.alloc(0))]);
}
function meta(o) { return { 'X-IDauto-Photo-Meta': Buffer.from(JSON.stringify(o), 'utf8').toString('base64url') }; }
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function obj(k) { return path.join(HADDAD, k.slice(0, 2), k.slice(2, 4), k); }
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b) }; }
}
function freeVin() { var A = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', s = 'KPT'; for (var i = 0; i < 14; i++) s += A[crypto.randomInt(0, A.length)]; return s; }
async function settle(replica, archive, n) { for (var i = 0; i < (n || 6); i++) { await replica.pass(); await archive.pass(); await sleep(250); } }
async function arch(where, params) { return (await db.query('SELECT * FROM idauto_media_archive WHERE ' + where + ' ORDER BY id', params)).rows; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }

  say('\n1. MIGRATION');
  for (var f of ['ida-u31-scan-photos.sql', 'ida-u4-archive-vin.sql', 'ida-u4b-vin-lookup-index.sql']) {
    var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', f), 'utf8');
    for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  }
  ok((await db.query("SELECT to_regclass('public.idauto_media_archive') IS NOT NULL t")).rows[0].t, 'idauto_media_archive created; the migration runs twice without error (idempotent)');
  ok(!(await db.query("SELECT 1 FROM pg_constraint WHERE conname = 'uq_vdoc_vehicle_type_face'")).rows.length && (await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'uq_vdoc_current_face'")).rows.length === 1, 'carte grise: one CURRENT version per face (partial unique index) instead of one row per face');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE version IS NULL")).rows[0].n === 0, 'every existing document is version 1');

  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U4 " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  process.env.IDAUTO_HADDAD_MEDIA_URL = 'http://127.0.0.1:' + RPORT + '/idauto-media'; process.env.IDAUTO_HADDAD_MEDIA_TOKEN = RTOKEN;
  await new Promise(function (r) { lens.listen(LPORT, '127.0.0.1', r); });
  startReceiver(); await sleep(700);
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var replica = require(path.join(BASE, 'reference', 'replica', 'haddad-replica.js'));
  var archive = require(path.join(BASE, 'reference', 'archive', 'archive-service.js'));

  say('\n2. THE RECEIVER: MONTHLY FOLDERS, HARD LINKS, METADATA, AUTHENTICATION');
  var B = png(640, 480, 3), K = sha(B);
  ok((await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-11-18T08:00:00Z' }, null)).status === 401, 'no token → 401');
  ok((await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-11-18T08:00:00Z' }, 'x'.repeat(48))).status === 401, 'wrong token → 401');
  ok((await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-11-18T08:00:00Z' })).status === 404, 'archive before the file is stored → 404 (never an empty entry)');
  ok((await recv('PUT', '/idauto-media/objects/' + K, B)).status === 201, 'file stored by its SHA-256');
  ok((await recv('PUT', '/idauto-media/objects/' + K, Buffer.concat([B, Buffer.from([1])]))).status === 400, 'bytes that do not hash to the key → 400');
  var a1 = await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-11-18T08:09:10Z', captured_at: '2026-11-18T08:05:00Z', latitude: 36.8, longitude: 10.18, location_source: 'browser', place_name: 'Tunis',
    mime_type: 'image/png', original_filename: '../../etc/passwd/IMG_0001.PNG', source: 'admin', uploaded_by: 'usr_x', vehicle: { ivid: 'ivid:1:ABCDEFGHJKMNPQRS:AB', vin: 'KPT60A1YSLP025697' } });
  ok(a1.status === 200 && a1.body.path === '2026/11/vehicle-photos/20261118T080910Z_' + K.slice(0, 16) + '.png', 'filed under 2026/11/vehicle-photos/<UTC stamp>_<sha16>.png — folders created automatically');
  var p1 = path.join(HADDAD, a1.body.path), j1 = JSON.parse(fs.readFileSync(p1 + '.json', 'utf8'));
  ok(fs.statSync(p1).ino === fs.statSync(obj(K)).ino && sha(fs.readFileSync(p1)) === K, 'the archive entry is a HARD LINK to the stored file: same bytes, same SHA-256, no copy');
  ok(j1.sha256 === K && j1.captured_at === '2026-11-18T08:05:00.000Z' && j1.uploaded_at === '2026-11-18T08:09:10.000Z' && j1.latitude === 36.8 && j1.location_source === 'browser' && j1.mime_type === 'image/png', 'the .json holds dates, GPS, its source and the MIME type');
  ok(j1.original_filename === 'IMG_0001.PNG', 'an original name with a path is reduced to its last part (no traversal)');
  ok(j1.vehicle.vin === 'KPT60A1YSLP025697' && j1.vehicle.ivid === 'ivid:1:ABCDEFGHJKMNPQRS:AB' && j1.source === 'admin' && j1.uploaded_by === 'usr_x', 'vehicle (IVID + VIN), source and uploader recorded');
  ok((fs.statSync(p1).mode & 0o777) === 0o600 && (fs.statSync(p1 + '.json').mode & 0o777) === 0o600 && (fs.statSync(path.dirname(p1)).mode & 0o777) === 0o700, 'files 0600, folders 0700');
  var a1b = await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2027-01-02T00:00:00Z', place_name: 'Sfax', mime_type: 'image/png' });
  ok(a1b.body.path === a1.body.path && JSON.parse(fs.readFileSync(p1 + '.json', 'utf8')).place_name === 'Sfax', 'a second call for the same file keeps its place in the archive and rewrites the .json only (idempotent)');
  var B2 = png(640, 480, 9), K2 = sha(B2); await recv('PUT', '/idauto-media/objects/' + K2, B2);
  var dec = await recv('POST', '/idauto-media/objects/' + K2 + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-12-31T23:59:59Z', mime_type: 'image/png' });
  var B3 = png(640, 480, 11), K3 = sha(B3); await recv('PUT', '/idauto-media/objects/' + K3, B3);
  var jan = await recv('POST', '/idauto-media/objects/' + K3 + '/archive', { category: 'carte-grise', uploaded_at: '2027-01-01T00:00:00Z', mime_type: 'image/png' });
  ok(/^2026\/12\/vehicle-photos\//.test(dec.body.path) && /^2027\/01\/carte-grise\//.test(jan.body.path) && fs.existsSync(path.join(HADDAD, '2027', '01', 'carte-grise')), 'month boundaries in UTC: 2026/12 then 2027/01 — the year and month folders are created as needed');
  var bad = [{ category: '../etc', uploaded_at: '2026-11-18T08:00:00Z' }, { category: 'vehicle-photos' }, { category: 'vehicle-photos', uploaded_at: 'yesterday' }];
  var bs = []; for (var b of bad) bs.push((await recv('POST', '/idauto-media/objects/' + K + '/archive', b)).status);
  ok(bs.every(function (s) { return s === 400; }), 'an unknown category, a missing or invalid date → 400 (the category is a fixed list: no path can be injected)');
  ok((await recv('POST', '/idauto-media/objects/' + K + '/archive', '{' )).status === 400, 'malformed JSON → 400');
  ok((await recv('POST', '/idauto-media/objects/' + K + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-11-18T08:00:00Z', pad: 'x'.repeat(9000) })).status === 413, 'metadata over 8 KB → 413');
  var gps = await recv('POST', '/idauto-media/objects/' + K2 + '/archive', { category: 'vehicle-photos', uploaded_at: '2026-12-31T23:59:59Z', latitude: 95, longitude: 10, location_source: 'browser', mime_type: 'image/png' });
  ok(gps.status === 200 && JSON.parse(fs.readFileSync(path.join(HADDAD, gps.body.path + '.json'), 'utf8')).latitude === null, 'impossible coordinates are dropped, not stored');
  var h1 = await recv('GET', '/idauto-media/health');
  ok(h1.status === 200 && h1.body.objects === 3 && h1.body.archived === 3, 'health counts stored objects and archived entries separately (links are not counted twice)');
  ok((await recv('DELETE', '/idauto-media/objects/' + K2)).status === 204 && !fs.existsSync(path.join(HADDAD, dec.body.path)) && !fs.existsSync(path.join(HADDAD, dec.body.path + '.json')), 'DELETE removes the file AND its archive entry and .json (an expired anonymous photograph leaves nothing)');

  say('\n3. A VEHICLE WITH ITS VIN; THE PUBLIC VIN SEARCH');
  var P = await freePlate(), VIN = freeVin();
  var reg = await request('POST', '/api/vehicles/register', T.ADMIN, { plate: { type: 'TU', series: P.series, number: P.number }, vin: VIN, make: 'Kia', model: 'Picanto' });
  ok(reg.status === 201 && reg.body.ivid, 'test vehicle registered with a VIN');
  var IVID = reg.body.ivid, VID = (await db.query('SELECT id FROM idauto_vehicles WHERE ivid = $1', [IVID])).rows[0].id;
  var vh = await request('POST', '/public/vin', null, { vin: VIN.toLowerCase().replace(/(.{5})/, '$1 ') });
  ok(vh.status === 200 && vh.body.ivid === IVID && vh.buf.toString().indexOf(VIN) === -1, 'public VIN search (lower case, a space) → this vehicle\'s IVID, the VIN never echoed');
  ok((await request('POST', '/public/vin', null, { vin: VIN.slice(0, 16) + (VIN[16] === '1' ? '2' : '1') })).status === 404, 'one character different → 404 (exact only)');
  ok((await request('POST', '/public/vin', null, { vin: 'KPT60A1YSLO025697' })).status === 400, 'a VIN with an O → 400');
  // a VIN fact written WITHOUT its normalized value (as found in production) is still found
  var P2 = await freePlate(), VIN2 = freeVin();
  var reg2 = await request('POST', '/api/vehicles/register', T.ADMIN, { plate: { type: 'TU', series: P2.series, number: P2.number }, vin: VIN2 });
  await db.query("UPDATE idauto_vehicle_facts SET fact_value_normalized = NULL WHERE fact_key = 'vin' AND vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1)", [reg2.body.ivid]);
  var vh2 = await request('POST', '/public/vin', null, { vin: VIN2.toLowerCase() });
  ok(vh2.status === 200 && vh2.body.ivid === reg2.body.ivid, 'a VIN fact stored without its normalized value is still found (exact)');
  var pl = await request('GET', '/public/plates/' + encodeURIComponent(P.series + ' TUN ' + P.number));
  ok(pl.status === 200 && pl.body.ivid === IVID, 'the plate search still works and finds the same vehicle');
  var audit = (await db.query("SELECT target_ref FROM idauto_audit_log WHERE event_type IN ('public_vin_lookup_hit','public_vin_lookup_miss') ORDER BY id DESC LIMIT 5")).rows;
  ok(audit.length >= 2 && audit.every(function (r) { return /^vin:[a-f0-9]{16}$/.test(r.target_ref) && r.target_ref.indexOf(VIN) === -1; }), 'VIN lookups are audited with a fingerprint, never the VIN');

  say('\n4. ADMINISTRATOR PHOTOGRAPH → ARCHIVE RECORD → HADDAD MONTHLY ARCHIVE');
  var PH = png(800, 600, 21), PK = sha(PH), when = '2026-11-17T15:30:00.000Z';
  var up = await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos', T.ADMIN, PH, Object.assign(meta({ captured_at: when, location: { source: 'browser', latitude: 36.646, longitude: 10.196 } }), { 'X-IDauto-Filename': encodeURIComponent('IMG_2026 été.png') }));
  ok(up.status === 201, 'the administrator uploads a photograph through the existing route (201)');
  var r4 = (await arch('object_key = $1', [PK]))[0];
  ok(r4 && r4.category === 'vehicle-photos' && r4.vehicle_id === VID && r4.source === 'admin' && r4.uploaded_by === 'usr_u4_admin_' + run, 'archive record: vehicle, source « admin », the administrator\'s identity');
  ok(r4.captured_at.toISOString() === when && r4.uploaded_at && r4.latitude === 36.646 && r4.longitude === 10.196 && r4.location_source === 'browser', 'capture date, upload date and the device GPS of that capture');
  ok(r4.mime_type === 'image/png' && r4.original_filename === 'IMG_2026 été.png' && r4.sha256 === PK, 'MIME type, original filename (UTF-8) and SHA-256');
  await settle(replica, archive);
  r4 = (await arch('id = $1', [r4.id]))[0];
  var now = new Date(r4.uploaded_at), month = now.getUTCFullYear() + '/' + String(now.getUTCMonth() + 1).padStart(2, '0');
  ok(r4.archive_status === 'stored' && r4.archive_path.indexOf(month + '/vehicle-photos/') === 0, 'filed on Haddad under ' + month + '/vehicle-photos/');
  var hp = path.join(HADDAD, r4.archive_path), hj = JSON.parse(fs.readFileSync(hp + '.json', 'utf8'));
  ok(sha(fs.readFileSync(hp)) === PK && fs.readFileSync(hp).equals(PH), 'the ORIGINAL bytes are on Haddad, unchanged');
  ok(hj.vehicle && hj.vehicle.ivid === IVID && hj.vehicle.vin === VIN && hj.record.kind === 'vehicle_photo', 'the Haddad .json associates the file with its vehicle and VIN');

  say('\n5. GPS UNAVAILABLE — THE PHOTOGRAPH IS STILL TAKEN');
  var NG = png(800, 600, 23), NK = sha(NG);
  var up2 = await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos', T.ADMIN, NG, meta({ captured_at: new Date().toISOString(), location: null }));
  var r5 = (await arch('object_key = $1', [NK]))[0];
  ok(up2.status === 201 && r5 && r5.latitude === null && r5.location_source === null, 'no position (refused / unavailable) → the photograph is saved, without a place');
  var ipOnly = png(800, 600, 25), IK = sha(ipOnly);
  await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos', T.ADMIN, ipOnly, meta({ location: { source: 'ip', latitude: 36.8, longitude: 10.1 } }));
  var r5b = (await arch('object_key = $1', [IK]))[0];
  ok(r5b && r5b.latitude === null, 'a location whose source is an IP address is not a location');
  await settle(replica, archive);
  ok((await arch('object_key = $1', [NK]))[0].archive_status === 'stored', 'and it is archived on Haddad all the same');

  say('\n6. A WORKSHOP PHOTOGRAPH; A NEW CAPTURE NEVER OVERWRITES');
  var WP = png(800, 600, 27);
  var up3 = await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos', T.MGR, WP, meta({}));
  ok(up3.status === 201 && (await arch('object_key = $1', [sha(WP)]))[0].source === 'workshop', 'a workshop photograph is recorded with source « workshop »');
  ok((await arch('vehicle_id = $1 AND category = $2', [VID, 'vehicle-photos'])).length === 4, 'four captures → four records (history, nothing replaced)');

  say('\n7. METADATA CORRECTION — THE FILE NEVER CHANGES');
  var docId = r4.document_id;
  var fix = await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos/' + docId, T.ADMIN, { captured_at: '2026-11-16T09:00:00Z', location: { source: 'manual', place_name: 'Garage Ben Arous' } });
  var r7 = (await arch('document_id = $1', [docId]))[0];
  ok(fix.status === 200 && r7.captured_at.toISOString() === '2026-11-16T09:00:00.000Z' && r7.place_name === 'Garage Ben Arous' && r7.location_source === 'manual', 'the administrator corrects the date and place; the record follows');
  ok(r7.meta_corrected_by === 'usr_u4_admin_' + run && r7.meta_corrected_at && r7.sha256 === PK && r7.object_key === PK, 'who corrected it, when — and the file (SHA-256) is the same');
  await settle(replica, archive);
  var hj2 = JSON.parse(fs.readFileSync(path.join(HADDAD, (await arch('id = $1', [r7.id]))[0].archive_path + '.json'), 'utf8'));
  ok(hj2.place_name === 'Garage Ben Arous' && hj2.location_source === 'manual' && sha(fs.readFileSync(path.join(HADDAD, r7.archive_path))) === PK, 'Haddad\'s .json is updated; the archived file is untouched');
  ok((await db.query("SELECT 1 FROM idauto_audit_log WHERE event_type = 'vehicle_photo.update' AND target_ref = $1", [String(docId)])).rows.length >= 1, 'the correction is in the audit log');

  say('\n8. CARTE GRISE — VERSIONS, ARCHIVE, LENS (TECHNICAL FIELDS ONLY)');
  var CG1 = png(1200, 800, 31), CG2 = png(1200, 800, 33);
  var c1 = await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document/1', T.ADMIN, CG1, { 'X-IDauto-Filename': encodeURIComponent('carte-grise-recto.png'), 'X-IDauto-Original-Bytes': String(CG1.length) });
  var c2 = await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document/1', T.ADMIN, CG2, { 'X-IDauto-Filename': encodeURIComponent('carte-grise-recto-2.png') });
  ok(c1.status === 200 || c1.status === 201, 'first carte grise recto stored');
  ok((c2.status === 200 || c2.status === 201) && c2.body.replaced === true, 'a second recto → a new version');
  var vers = (await db.query("SELECT id, version, superseded_at, superseded_by, storage_key, original_filename, created_by FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'carte_grise' AND face = 1 ORDER BY version", [VID])).rows;
  ok(vers.length === 2 && vers[0].version === 1 && vers[1].version === 2 && vers[0].superseded_at && vers[0].superseded_by === vers[1].id && !vers[1].superseded_at, 'version 1 is KEPT (superseded by version 2), version 2 is current');
  ok(fs.existsSync(path.join(MEDIA, vers[0].storage_key.slice(0, 2), vers[0].storage_key.slice(2, 4), vers[0].storage_key)), 'the previous version\'s file is kept in the media store');
  ok(vers[1].original_filename === 'carte-grise-recto-2.png' && vers[1].created_by === 'usr_u4_admin_' + run, 'original filename and the uploading administrator are recorded');
  var cur = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document', T.ADMIN);
  ok(cur.status === 200 && JSON.stringify(cur.body).indexOf(sha(CG2)) !== -1 && JSON.stringify(cur.body).indexOf(sha(CG1)) === -1, 'the vehicle\'s current carte grise is version 2');
  await settle(replica, archive, 10);
  var cgr = await arch("vehicle_id = $1 AND category = 'carte-grise'", [VID]);
  ok(cgr.length === 2 && cgr.every(function (r) { return r.archive_status === 'stored' && /\/carte-grise\//.test(r.archive_path); }), 'both versions are archived on Haddad under <YYYY>/<MM>/carte-grise/');
  var SAME = png(1200, 800, 35);
  await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document/2', T.ADMIN, SAME);
  await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document/2', T.ADMIN, SAME);
  await settle(replica, archive, 6);
  var twin = await arch('object_key = $1', [sha(SAME)]);
  ok(twin.length === 2 && twin[0].archive_path !== twin[1].archive_path && twin.every(function (r) { return fs.existsSync(path.join(HADDAD, r.archive_path + '.json')) && JSON.parse(fs.readFileSync(path.join(HADDAD, r.archive_path + '.json'), 'utf8')).archive_id === String(r.id); }), 'the same bytes deposited twice → two records, two archive entries, two .json (nothing overwritten)');
  var wsDocs = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/registration-document', T.ADMIN);
  ok(JSON.stringify(wsDocs.body).split('"face":1').length - 1 === 1, 'the vehicle\'s carte grise lists ONE current recto, not every version');
  ok(LENS_SEEN.some(function (x) { return x.url === '/v1/files' && x.auth; }) && LENS_SEEN.some(function (x) { return x.url === '/v1/jobs' && x.body && x.body.workflow === 'extract_fields' && x.body.data_policy === 'local_only'; }), 'the receiver submitted the carte grise to LENS (authenticated, extract_fields, local only)');
  ok(!LENS_SEEN.some(function (x) { return !x.auth; }), 'every LENS call carried the LENS token');
  var lf = cgr.map(function (r) { return r.lens_fields; }).filter(Boolean)[0] || [], lsts = cgr.map(function (r) { return r.lens_status; });
  ok(lsts.indexOf('succeeded') !== -1 && lf.some(function (f) { return f.key === 'vin' && f.value === 'KPT60A1YSLP025697'; }) && lf.some(function (f) { return f.key === 'marque'; }), 'LENS status and technical fields (VIN, make) are stored on the record');
  ok(!JSON.stringify(cgr).match(/FOULEN|01234567|RUE X|proprietaire|cin_proprietaire|adresse/), 'the holder\'s name, CIN and address returned by LENS NEVER reach IDauto');
  var veh = (await db.query('SELECT make, model FROM idauto_vehicles WHERE id = $1', [VID])).rows[0];
  ok(String(veh.make).toUpperCase() === 'KIA' && String(veh.model).toUpperCase() === 'PICANTO', 'LENS results do not change the vehicle record (confirmation required)');

  say('\n9. ADMIN DOSSIER ROUTES — AND WHO CANNOT REACH THEM');
  var hist = await request('GET', '/api/admin/vehicles/' + encodeURIComponent(IVID) + '/archive', T.ADMIN);
  ok(hist.status === 200 && hist.body.photos.length === 4 && hist.body.carte_grise.length === 4, 'history: 4 photographs and 4 carte grise versions (2 recto, 2 verso)');
  var ts = hist.body.photos.map(function (p) { return new Date(p.uploaded_at).getTime(); });
  ok(ts.every(function (t, i) { return i === 0 || ts[i - 1] >= t; }), 'newest first (chronological history)');
  var rec = hist.body.carte_grise.filter(function (c) { return c.face === 1; });
  ok(rec.length === 2 && rec[0].current === true && rec[0].version === 2 && rec[1].current === false && rec[1].version === 1, 'carte grise versions with their number and which one is current');
  ok(hist.buf.toString().indexOf('KPT60A1YSLP025697') === -1 && hist.body.carte_grise.some(function (c) { return c.lens && (c.lens.fields || []).some(function (f) { return f.key === 'vin' && f.value === null && f.read === true; }); }), 'the VIN read by LENS is not returned by the admin history (only that it was read)');
  ok(hist.body.vin_known === true && hist.buf.toString().indexOf(VIN) === -1, 'the history says a VIN is known but does not return it (VIN disclosure stays on the audited fiche)');
  ok(hist.buf.toString().indexOf(MEDIA) === -1 && hist.buf.toString().indexOf(HADDAD) === -1 && !/"object_key"|storage_key/.test(hist.buf.toString()), 'no storage path and no storage key in the answer — only the archive-relative path');
  var one = hist.body.photos.filter(function (p) { return p.sha256 === PK; })[0];
  var file = await request('GET', '/api/admin/archive/' + one.id + '/file', T.ADMIN);
  ok(file.status === 200 && file.buf.equals(PH) && file.headers['content-type'] === 'image/png' && /no-store/.test(file.headers['cache-control']) && file.headers['x-content-type-options'] === 'nosniff', '« Ouvrir l\'original » returns the original bytes (no-store, nosniff)');
  ok((await request('GET', '/api/admin/archive/' + one.id + '/file', T.MGR)).status === 403, 'a workshop credential cannot open the admin archive (403)');
  ok((await request('GET', '/api/admin/archive/' + one.id + '/file', null)).status === 401 || (await request('GET', '/api/admin/archive/' + one.id + '/file', null)).status === 403, 'an anonymous visitor cannot open it');
  ok((await request('GET', '/api/admin/vehicles/' + encodeURIComponent(IVID) + '/archive', T.MGR)).status === 403, 'a workshop credential cannot read the admin archive history (403)');
  ok((await request('GET', '/api/admin/archive/..%2F..%2Fetc%2Fpasswd/file', T.ADMIN)).status === 404 && (await request('GET', '/api/admin/archive/999999999999/file', T.ADMIN)).status === 404, 'a path or an unknown id → 404 (only a numeric record id is accepted)');
  var pub = await request('GET', '/public/passport/' + encodeURIComponent(IVID));
  ok(!/carte|registration|archive|sha256/i.test(pub.buf.toString()) && pub.buf.toString().indexOf(VIN) === -1, 'the public passport shows no carte grise, no archive and no VIN');

  say('\n10. SCANNER PHOTOGRAPH → ATTACHED: ONE RECORD, NOW WITH ITS VEHICLE');
  var SC = png(800, 600, 41), SK = sha(SC);
  var s1 = await request('POST', '/api/workspace/scans', T.ADMIN, SC, Object.assign(meta({ captured_at: new Date().toISOString(), location: { source: 'browser', latitude: 36.646, longitude: 10.196 } }), { 'X-IDauto-Filename': 'scan.png' }));
  var sr = (await arch('object_key = $1', [SK]));
  ok(s1.status === 201 && sr.length === 1 && sr[0].vehicle_id === null && sr[0].scan_media_id && sr[0].source === 'admin' && sr[0].original_filename === 'scan.png', 'a scan is recorded at capture, vehicle unknown, with its original name');
  var att = await request('POST', '/api/workspace/scans/' + s1.body.scan.token + '/attach', T.ADMIN, { vehicle: IVID });
  sr = (await arch('object_key = $1', [SK]));
  ok(att.status === 200 && sr.length === 1 && sr[0].vehicle_id === VID && sr[0].document_id, 'attaching it to the vehicle updates the same record (no duplicate)');
  await settle(replica, archive);
  var sj = JSON.parse(fs.readFileSync(path.join(HADDAD, (await arch('object_key = $1', [SK]))[0].archive_path + '.json'), 'utf8'));
  ok(sj.vehicle && sj.vehicle.vin === VIN, 'and Haddad\'s .json now names the vehicle and its VIN');

  say('\n11. RECEIVER DOWN — NOTHING LOST, RECOVERED');
  receiver.kill('SIGKILL'); await sleep(300);
  var DP = png(800, 600, 43), DK = sha(DP);
  var up4 = await request('POST', '/api/vehicles/' + encodeURIComponent(IVID) + '/photos', T.ADMIN, DP, meta({}));
  await replica.pass().catch(function () {}); await archive.pass().catch(function () {});
  var rd = (await arch('object_key = $1', [DK]))[0];
  ok(up4.status === 201 && rd && rd.archive_status === 'pending', 'Haddad unreachable: the photograph is saved and its archive entry waits (pending), never dropped');
  startReceiver(); await sleep(800);
  await db.query("UPDATE idauto_media_replicas SET next_try_at = NOW() WHERE object_key = $1", [DK]);
  await settle(replica, archive);
  ok((await arch('object_key = $1', [DK]))[0].archive_status === 'stored', 'receiver back: the copy and the archive entry complete');

  say('\n12. REMOVAL REACHES THE ARCHIVE');
  await replica.forget(DK); await db.query("UPDATE idauto_media_replicas SET next_try_at = NOW() WHERE object_key = $1", [DK]); await replica.pass();
  var rr = (await arch('object_key = $1', [DK]))[0];
  ok(rr.archive_status === 'removed' && !fs.existsSync(path.join(HADDAD, rr.archive_path)) && !fs.existsSync(obj(DK)), 'a forgotten file: removed from Haddad (object and archive entry), and its record says « removed »');

  say('\nIDA-U4 archive, carte grise versions, VIN: ' + pass + ' passed, ' + fail + ' failed');
  server.close(); lens.close();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
