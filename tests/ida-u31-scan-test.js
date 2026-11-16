#!/usr/bin/env node
'use strict';
// IDauto — Update 3.1 (final) — « Scanner la plaque »: photographs saved at capture, the Haddad copy, attach / save,
// the public switch, privacy. Scratch database, scratch media directory, a REAL receiver process (the Haddad one,
// ops/haddad/idauto-media-receiver.js) on a local port. No network beyond loopback, no provider key.
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
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u31-media-')), HADDAD = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u31-haddad-'));
process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_PUBLIC_SCAN_STORE; delete process.env.IDAUTO_VISION_PROVIDER; delete process.env.IDAUTO_VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;
var RPORT = 18853 + crypto.randomInt(0, 900), RTOKEN = crypto.randomBytes(24).toString('hex');
var receiver = null;
function startReceiver() { receiver = cp.spawn(process.execPath, [path.join(BASE, 'ops', 'haddad', 'idauto-media-receiver.js')], { env: Object.assign({}, process.env, { IDAUTO_MEDIA_RECEIVER_TOKEN: RTOKEN, IDAUTO_MEDIA_RECEIVER_ROOT: HADDAD, IDAUTO_MEDIA_RECEIVER_PORT: String(RPORT) }), stdio: 'ignore' }); }
process.on('exit', function () { try { receiver && receiver.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(MEDIA, { recursive: true, force: true }); fs.rmSync(HADDAD, { recursive: true, force: true }); } catch (e) {} });
var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'TECH', 'OTHER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {}, ip = '10.41.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
ids[T.MGR] = { actor_ref: 'svc_u31_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_u31_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_u31_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;
function request(method, p, token, body, headers) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var h = Object.assign({ 'Content-Length': payload ? payload.length : 0, 'X-Real-IP': ip }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    if (payload && !h['Content-Type']) h['Content-Type'] = Buffer.isBuffer(body) ? 'image/png' : 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: h }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw }); });
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
  crypto.randomBytes(64).copy(raw, 1);       // every image of every run is new: content-addressed keys never collide with an earlier run
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function meta(o) { return { 'X-IDauto-Photo-Meta': Buffer.from(JSON.stringify(o), 'utf8').toString('base64url') }; }
function keyFile(root, k) { return path.join(root, k.slice(0, 2), k.slice(2, 4), k); }
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b), canonical: a + ' TUN ' + b }; }
}
async function waitHaddad(p, token, want, ms) { var t0 = Date.now(), s = null; while (Date.now() - t0 < (ms || 8000)) { s = (await request('GET', p, token)).body; if (s && s.scan && s.scan.haddad === want) return true; await sleep(300); } return false; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', 'ida-u31-scan-photos.sql'), 'utf8');
  for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  ok((await db.query("SELECT to_regclass('public.idauto_scan_photos') IS NOT NULL a, to_regclass('public.idauto_media_replicas') IS NOT NULL b")).rows.every(function (r) { return r.a && r.b; }), 'migration applied twice: scan photos and replica tracking tables exist');
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U31 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U31 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  // the Haddad copy, pointed at a real receiver process on this machine
  process.env.IDAUTO_HADDAD_MEDIA_URL = 'http://127.0.0.1:' + RPORT + '/idauto-media'; process.env.IDAUTO_HADDAD_MEDIA_TOKEN = RTOKEN;
  startReceiver(); await sleep(700);
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var replica = require(path.join(BASE, 'reference', 'replica', 'haddad-replica.js'));

  say('\n1. A SIGNED-IN WORKSHOP: SAVED AT CAPTURE, COPIED TO HADDAD');
  var IMG = png(800, 600, 7);
  var s1 = await request('POST', '/api/workspace/scans', T.TECH, IMG, meta({ captured_at: new Date().toISOString(), location: { source: 'browser', latitude: 36.646, longitude: 10.196 } }));
  var sc = s1.body && s1.body.scan;
  ok(s1.status === 201 && sc && sc.saved === true && /^[A-Za-z0-9_-]{32}$/.test(sc.token), 'a technician\'s photograph is saved before any analysis (201, token)');
  ok(sc.location && sc.location.source === 'browser' && sc.location.place_name === 'Khelidia' && sc.location.governorate === 'Ben Arous', 'with the device position of that capture, resolved: Khelidia, Ben Arous');
  var key = sc.sha256;
  ok(fs.existsSync(keyFile(MEDIA, key)) && fs.readFileSync(keyFile(MEDIA, key)).equals(IMG), 'the ORIGINAL bytes are in the private media store');
  var obs = (await db.query("SELECT o.capture_method, o.vehicle_id, m.media_type, m.access_scope, m.object_key, cs.code FROM idauto_scan_photos s JOIN idauto_observations o ON o.id = s.observation_id JOIN idauto_observation_media m ON m.id = s.media_id JOIN idauto_capture_sources cs ON cs.id = o.capture_source_id WHERE s.token = $1", [sc.token])).rows[0];
  ok(obs.capture_method === 'vehicle_scan' && obs.vehicle_id === null && obs.media_type === 'original_image' && obs.access_scope === 'mythos_private' && obs.code === 'PROFESSIONAL_SCAN', 'recorded as an observation with its original image (vehicle unknown yet), private');
  var bk = (await db.query("SELECT count(*)::int n FROM idauto_observation_media WHERE object_key = $1", [key])).rows[0].n;
  ok(bk === 1, 'the file is referenced where the nightly off-host backup looks (idauto_observation_media)');
  ok(await waitHaddad('/api/workspace/scans/' + sc.token, T.TECH, 'stored'), 'the Haddad copy is confirmed « stored »');
  ok(fs.existsSync(keyFile(HADDAD, key)) && fs.readFileSync(keyFile(HADDAD, key)).equals(IMG), 'and the receiver holds the same bytes under the same key');

  say('\n2. ANALYSIS AFTER THE FACT — AND WHEN IT FAILS');
  var u = await request('PUT', '/api/workspace/scans/' + sc.token, T.TECH, { analysis: { plate: { serie: '173', numero: '8116', confidence: 74, source: 'ocr', accepted: false }, fields: { colour: { value: 'noir', confidence: 0.6, source: 'camera' }, make: { value: 'X', source: 'rumour' } } }, view: 'rear' });
  ok(u.status === 200 && u.body.scan.analysis_status === 'done' && u.body.scan.analysis.plate.text === '173 تونس 8116' && u.body.scan.view === 'rear' && !u.body.scan.analysis.fields.make, 'the analysis arrives after the photograph and is rebuilt field by field');
  ok((await db.query('SELECT plate_normalised FROM idauto_observations o JOIN idauto_scan_photos s ON s.observation_id = o.id WHERE s.token = $1', [sc.token])).rows[0].plate_normalised === '173 TUN 8116', 'the observation learns the plate read');
  var s2 = await request('POST', '/api/workspace/scans', T.TECH, png(640, 480, 99), {});
  var f2 = await request('PUT', '/api/workspace/scans/' + s2.body.scan.token, T.TECH, { analysis_status: 'failed' });
  ok(f2.status === 200 && f2.body.scan.analysis_status === 'failed' && f2.body.scan.saved === true && fs.existsSync(keyFile(MEDIA, s2.body.scan.sha256)), 'analysis failed: the photograph stays saved, the failure is recorded');
  var f3 = await request('PUT', '/api/workspace/scans/' + s2.body.scan.token, T.TECH, { analysis: { plate: null, fields: { colour: { value: 'gris', confidence: 0.5, source: 'camera' } } } });
  ok(f3.body.scan.analysis_status === 'done', 'and the analysis can be run again later on the same saved photograph');

  say('\n3. THE HADDAD COPY FAILS — VISIBLY, AND RECOVERS');
  receiver.kill('SIGKILL'); await sleep(400);
  var s3 = await request('POST', '/api/workspace/scans', T.TECH, png(640, 480, 151), {});
  ok(s3.status === 201 && s3.body.scan.saved === true, 'Haddad unreachable: the photograph is still saved here');
  ok(await waitHaddad('/api/workspace/scans/' + s3.body.scan.token, T.TECH, 'failed'), 'its copy is reported « failed », not hidden');
  var row3 = (await db.query('SELECT last_error, attempts FROM idauto_media_replicas WHERE object_key = $1', [s3.body.scan.sha256])).rows[0];
  ok(row3 && row3.attempts >= 1 && /ECONNREFUSED|connect|socket/i.test(row3.last_error || ''), 'with its reason: ' + (row3 && row3.last_error));
  startReceiver();
  // the background pass, as the server runs it every 30 s — repeated here until the restarted receiver answers
  for (var tries = 0; tries < 15; tries++) {
    await sleep(500);
    await db.query('UPDATE idauto_media_replicas SET next_try_at = NOW() WHERE object_key = $1', [s3.body.scan.sha256]);
    if (await replica.pass()) break;
  }
  ok(await waitHaddad('/api/workspace/scans/' + s3.body.scan.token, T.TECH, 'stored') && fs.existsSync(keyFile(HADDAD, s3.body.scan.sha256)), 'Haddad back: the next background pass copies it — « stored »');

  say('\n4. ATTACH TO AN EXISTING VEHICLE, OR SAVE A NEW ONE');
  var P1 = await freePlate();
  var reg = await request('POST', '/api/vehicles/register', T.MGR, { plate: { type: 'TU', series: P1.series, number: P1.number }, make: 'Chevrolet', model: 'Aveo LS', colour: 'noir' });
  var before = (await db.query('SELECT make, model, colour FROM idauto_vehicles WHERE ivid = $1', [reg.body.ivid])).rows[0];
  var at = await request('POST', '/api/workspace/scans/' + sc.token + '/attach', T.TECH, { vehicle: reg.body.ivid });
  ok(at.status === 200 && at.body.attached === true, 'the saved photograph is attached to the existing vehicle');
  var ph = await request('GET', '/api/vehicles/' + encodeURIComponent(reg.body.ivid) + '/photos', T.TECH);
  var pv = ph.body.photos[0];
  ok(ph.body.photos.length === 1 && pv.view === 'rear' && pv.location.place_name === 'Khelidia' && pv.analysis.plate.text === '173 تونس 8116' && pv.confirmed === true && pv.haddad === 'stored', 'the dossier has the photograph with its place, date, recognition, confirmation and Haddad copy');
  ok((await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE storage_key = $1", [key])).rows[0].n === 1 && fs.readdirSync(path.join(MEDIA, key.slice(0, 2), key.slice(2, 4))).filter(function (f) { return f === key; }).length === 1, 'no copy of the file: the vehicle photograph references the same key');
  var after = (await db.query('SELECT make, model, colour FROM idauto_vehicles WHERE ivid = $1', [reg.body.ivid])).rows[0];
  ok(JSON.stringify(before) === JSON.stringify(after), 'attaching changes nothing the workshop had confirmed on the vehicle');
  ok((await request('POST', '/api/workspace/scans/' + sc.token + '/attach', T.TECH, { vehicle: reg.body.ivid })).body.already === true, 'attaching twice does nothing more');
  var P2 = await freePlate();
  var nv = await request('POST', '/api/workspace/scans/' + s2.body.scan.token + '/vehicle', T.MGR, { plate: { type: 'TU', series: P2.series, number: P2.number }, make: 'Peugeot', model: '301', colour: 'blanc', body_type: 'berline' });
  ok(nv.status === 201 && nv.body.attached === true && (await db.query('SELECT colour, body_type FROM idauto_vehicles WHERE ivid = $1', [nv.body.ivid])).rows[0].body_type === 'berline', 'a new registration is saved with make, model, colour, body type — and its photograph');
  var dup = await request('POST', '/api/workspace/scans/' + s3.body.scan.token + '/vehicle', T.MGR, { plate: { type: 'TU', series: P2.series, number: P2.number }, make: 'Other' });
  ok(dup.status === 409, 'the same registration again: 409, never a second vehicle');
  var list = await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(P2.series + 'TU' + P2.number), T.MGR);
  var lr = list.body.vehicles.filter(function (x) { return x.ivid === nv.body.ivid; })[0];
  ok(lr && lr.make === 'PEUGEOT' && lr.model === '301' && lr.colour === 'blanc' && lr.plate === P2.canonical, 'the vehicle list shows registration, make, model, colour');

  say('\n5. WHO SEES WHAT');
  ok((await request('GET', '/api/workspace/scans/' + s3.body.scan.token, T.OTHER)).status === 404, 'another workshop cannot read this workshop\'s scan, even with its token');
  ok((await request('GET', '/public/scans/' + s3.body.scan.token, null)).status === 403, 'nor can an anonymous visitor (public storage is off)');
  ok((await request('POST', '/api/workspace/scans', null, IMG)).status === 401, 'a scan without a session on the workshop route: 401');
  ok((await request('GET', '/api/workspace/scans/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', T.TECH)).status === 404, 'an unknown token: 404');

  say('\n6. ANONYMOUS VISITORS — OFF BY DEFAULT');
  var cfg = await request('GET', '/public/scans');
  ok(cfg.status === 200 && cfg.body.store === false, 'the page is told public storage is off');
  var counts = (await db.query('SELECT (SELECT count(*) FROM idauto_scan_photos) s, (SELECT count(*) FROM idauto_vehicles) v')).rows[0];
  ok((await request('POST', '/public/scans', null, IMG, { 'Content-Type': 'image/png' })).status === 403 && (await request('POST', '/public/scans/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/vehicle', null, { serie: '1', numero: '1' })).status === 403, 'off: storing, saving and attaching answer 403');
  ok(JSON.stringify(counts) === JSON.stringify((await db.query('SELECT (SELECT count(*) FROM idauto_scan_photos) s, (SELECT count(*) FROM idauto_vehicles) v')).rows[0]), 'and nothing was written');

  say('\n7. ANONYMOUS VISITORS — WHEN THE OWNER TURNS IT ON');
  process.env.IDAUTO_PUBLIC_SCAN_STORE = '1';
  ip = '10.42.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
  var a1 = await request('POST', '/public/scans', null, png(700, 500, 33), Object.assign({ 'Content-Type': 'image/png' }, meta({ location: { source: 'browser', latitude: 36.8065, longitude: 10.1815 } })));
  ok(a1.status === 201 && a1.body.scan.saved === true && a1.body.scan.location.place_name === 'Tunis' && !!a1.body.scan.expires_at, 'on: an anonymous photograph is saved, with its place, and an expiry date');
  var ar = (await db.query("SELECT s.org_id, cs.code, o.ip_hash FROM idauto_scan_photos s JOIN idauto_observations o ON o.id = s.observation_id JOIN idauto_capture_sources cs ON cs.id = o.capture_source_id WHERE s.token = $1", [a1.body.scan.token])).rows[0];
  ok(ar.org_id === null && ar.code === 'PUBLIC_UPLOAD' && /^[a-f0-9]{64}$/.test(ar.ip_hash), 'recorded as an anonymous public upload, with a hashed address only');
  ok((await request('GET', '/public/scans/' + sc.token, null)).status === 404, 'an anonymous visitor cannot open a WORKSHOP scan by its token');
  var ga = await request('GET', '/public/scans/' + a1.body.scan.token, null);
  ok(ga.status === 200 && !/org_id|actor_ref|ip_hash|object_key|storage_key/.test(ga.raw), 'its own scan comes back without any internal reference');
  var P3 = await freePlate();
  var an = await request('POST', '/public/scans/' + a1.body.scan.token + '/vehicle', null, { serie: P3.series, numero: P3.number, make: 'Kia', model: 'Rio', colour: 'blanc' });
  ok(an.status === 201 && an.body.created === true && /^ivid:/.test(an.body.ivid) && Object.keys(an.body).sort().join() === 'attached,created,ivid', 'save: the vehicle is created, the answer is its public IVID and nothing else');
  var aud = (await db.query("SELECT actor_type FROM idauto_audit_log WHERE event_type = 'vehicle.register.manual' ORDER BY id DESC LIMIT 1")).rows[0];
  ok(aud && aud.actor_type === 'anonymous', 'audited as « anonymous », not as an administrator');
  var a2 = await request('POST', '/public/scans', null, png(700, 500, 77), { 'Content-Type': 'image/png' });
  var ex = await request('POST', '/public/scans/' + a2.body.scan.token + '/attach', null, { serie: P1.series, numero: P1.number });
  ok(ex.status === 200 && ex.body.attached === true && Object.keys(ex.body).sort().join() === 'attached,ivid', 'attach to an existing vehicle: done, and only its public IVID comes back');
  ok(!/Chevrolet|AVEO|noir|Garage/i.test(ex.raw), 'no private detail of that vehicle is returned');
  var after2 = (await db.query('SELECT make, model, colour FROM idauto_vehicles WHERE ivid = $1', [reg.body.ivid])).rows[0];
  ok(JSON.stringify(before) === JSON.stringify(after2), 'an anonymous attach never changes the vehicle\'s confirmed values');
  ok((await request('POST', '/public/scans/' + a2.body.scan.token + '/vehicle', null, { serie: P1.series, numero: P1.number, make: 'Spam' })).status === 409, 'an anonymous save of an existing registration: 409, never a duplicate');
  var wsSees = await request('GET', '/api/vehicles/' + encodeURIComponent(reg.body.ivid) + '/photos', T.TECH);
  ok(wsSees.body.photos.length === 1, 'the anonymous photograph is not mixed into a workshop\'s own photographs');
  var lim = [];
  for (var k2 = 0; k2 < 5; k2++) lim.push((await request('POST', '/public/scans/' + a2.body.scan.token + '/attach', null, { serie: '1', numero: '1' })).status);
  ok(lim.indexOf(429) !== -1, 'anonymous saves and attaches are rate-limited (' + lim.join(',') + ')');
  ok((await request('POST', '/public/scans', null, Buffer.from('not an image at all'), { 'Content-Type': 'image/png' })).status === 415 && (await request('POST', '/public/scans', null, Buffer.alloc(9 * 1024 * 1024, 1), { 'Content-Type': 'image/png' })).status === 413, 'anonymous uploads: not an image → 415, over 8 MB → 413');

  say('\n8. EXPIRY OF ANONYMOUS PHOTOGRAPHS THAT WERE NEVER ATTACHED');
  var a3 = await request('POST', '/public/scans', null, png(700, 500, 201), { 'Content-Type': 'image/png' });
  await waitHaddad('/public/scans/' + a3.body.scan.token, null, 'stored');
  await db.query("UPDATE idauto_scan_photos SET expires_at = NOW() - interval '1 day' WHERE token = $1", [a3.body.scan.token]);
  var scans = require(path.join(BASE, 'reference', 'photos', 'scan-service.js'));
  await scans.purgeExpired();
  ok(!fs.existsSync(keyFile(MEDIA, a3.body.scan.sha256)) && (await request('GET', '/public/scans/' + a3.body.scan.token, null)).status === 404, 'past its date: the photograph and its file are removed here');
  await db.query('UPDATE idauto_media_replicas SET next_try_at = NOW() WHERE object_key = $1', [a3.body.scan.sha256]); await replica.pass();
  ok(!fs.existsSync(keyFile(HADDAD, a3.body.scan.sha256)), '…and on Haddad');
  ok(fs.existsSync(keyFile(MEDIA, a2.body.scan.sha256)), 'an attached anonymous photograph never expires');

  delete process.env.IDAUTO_PUBLIC_SCAN_STORE;
  await db.query("UPDATE idauto_organizations SET status = 'cancelled' WHERE id IN ($1,$2)", [orgA, orgB]).catch(function () {});
  server.close();
  console.log('\nIDA-U3.1 scanner (saved at capture, Haddad copy): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(function (e) { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
