#!/usr/bin/env node
'use strict';
// IDauto — Update 3 — vehicle photographs, on a scratch database and a scratch media directory:
//   1. the migration (twice), existing documents untouched;
//   2. storing a photograph with its view, date, EXIF position, analysis — and what is refused;
//   3. the same photograph twice: one row, one file;
//   4. location rules as the database sees them (coordinates need a GPS source, manual has none, unknown stays unknown);
//   5. correcting the view and the place; 6. isolation between workshops; 7. deleting;
//   8. the vehicle list; 9. the off-host backup's own query sees the photographs' files.
var path = require('path');
var http = require('http');
var fs = require('fs');
var os = require('os');
var zlib = require('zlib');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u3-media-'));
process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
process.on('exit', function () { try { fs.rmSync(MEDIA, { recursive: true, force: true }); } catch (e) {} });
var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'TECH', 'OTHER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {};
ids[T.MGR] = { actor_ref: 'svc_u3_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_u3_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_u3_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;
function request(method, p, token, body, headers) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var h = Object.assign({ 'Content-Length': payload ? payload.length : 0 }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    if (payload && !h['Content-Type']) h['Content-Type'] = Buffer.isBuffer(body) ? 'image/png' : 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: h }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var buf = Buffer.concat(c), parsed = null; try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, body: parsed, bytes: buf, headers: res.headers }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function png(w, h, shade) {
  function chunk(type, data) { var len = Buffer.alloc(4); len.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); }
  var table = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  var raw = Buffer.alloc((w + 1) * h); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (shade + x + y) & 0xFF;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function meta(o) { return { 'X-IDauto-Photo-Meta': Buffer.from(JSON.stringify(o), 'utf8').toString('base64url') }; }
function files() { var n = 0; (function walk(d) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : n++; }); }(MEDIA)); return n; }
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { type: 'TU', series: String(a), number: String(b), canonical: a + ' TUN ' + b }; }
}

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }

  say('1. MIGRATION — widened checks, one new table, twice');
  var before = (await db.query("SELECT count(*)::int n, coalesce(md5(string_agg(id || ':' || document_type || ':' || face || ':' || storage_key, ',' ORDER BY id)), '') h FROM idauto_vehicle_documents WHERE document_type = 'carte_grise'")).rows[0];
  var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', 'ida-u3-vehicle-photos.sql'), 'utf8');
  for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  var after = (await db.query("SELECT count(*)::int n, coalesce(md5(string_agg(id || ':' || document_type || ':' || face || ':' || storage_key, ',' ORDER BY id)), '') h FROM idauto_vehicle_documents WHERE document_type = 'carte_grise'")).rows[0];
  ok(before.n === after.n && before.h === after.h, 'applied twice: the ' + after.n + ' existing carte grise faces are unchanged');
  ok((await db.query("SELECT to_regclass('public.idauto_vehicle_photos') IS NOT NULL t")).rows[0].t, 'idauto_vehicle_photos exists');
  var bad = null; try { await db.query("INSERT INTO idauto_vehicle_documents (vehicle_id, document_type, face, storage_key, mime_type, byte_size, width, height, sha256, created_by) VALUES ((SELECT min(id) FROM idauto_vehicles), 'carte_grise', 3, 'k', 'image/png', 1, 1, 1, 'x', 't')"); } catch (e) { bad = e; }
  ok(bad && /chk_vdoc_face/.test(bad.message), 'a carte grise still has faces 1 and 2 only');
  bad = null; try { await db.query("INSERT INTO idauto_vehicle_documents (vehicle_id, document_type, face, storage_key, mime_type, byte_size, width, height, sha256, created_by) VALUES ((SELECT min(id) FROM idauto_vehicles), 'selfie', 1, 'k', 'image/png', 1, 1, 1, 'x', 't')"); } catch (e) { bad = e; }
  ok(bad && /chk_vdoc_(type|face)/.test(bad.message), 'only the two document types are allowed');

  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U3 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U3 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var plate = await freePlate();
  var reg = await request('POST', '/api/vehicles/register', T.MGR, { plate: plate, make: 'Chevrolet', model: 'Aveo LS', colour: 'noir', body_type: 'berline' });
  var IV = reg.body.ivid, P = '/api/vehicles/' + encodeURIComponent(IV) + '/photos';
  var vid = (await db.query('SELECT id FROM idauto_vehicles WHERE ivid = $1', [IV])).rows[0].id;

  say('\n2. STORING A PHOTOGRAPH');
  var REAR = png(640, 480, 10), FRONT = png(640, 480, 90), f0 = files();
  var a1 = await request('POST', P, T.MGR, REAR, meta({ view: 'rear', captured_at: '2026-11-14T10:32:05Z', confirmed: true, location: { source: 'exif', latitude: 36.646, longitude: 10.196 },
    analysis: { plate: { serie: plate.series, numero: plate.number, confidence: 95, source: 'ocr', accepted: true }, fields: { colour: { value: 'noir', confidence: 0.6, source: 'camera' }, make: { value: 'Tank', confidence: 1, source: 'rumour' } } } }));
  ok(a1.status === 201 && a1.body.duplicate === false && a1.body.photo.view === 'rear' && a1.body.photo.number === 1, 'rear photograph stored (201), number 1');
  var l1 = a1.body.photo.location;
  ok(l1 && l1.source === 'exif' && l1.latitude === 36.646 && l1.longitude === 10.196, 'the ORIGINAL coordinates are kept, with their source (EXIF)');
  ok(l1.place_name === 'Khelidia' && l1.governorate === 'Ben Arous' && l1.country === 'Tunisie', 'and resolved on the server, offline: Khelidia, Ben Arous, Tunisie');
  ok(a1.body.photo.captured_at && new Date(a1.body.photo.captured_at).toISOString() === '2026-11-14T10:32:05.000Z' && a1.body.photo.confirmed === true, 'capture date and confirmation are kept');
  ok(a1.body.photo.analysis.plate.text === plate.series + ' تونس ' + plate.number && a1.body.photo.analysis.fields.colour.source === 'camera' && !a1.body.photo.analysis.fields.make && Math.abs(a1.body.photo.confidence - 0.95) < 1e-6, 'the analysis is kept per photograph, each value with its source; a value from an unknown source is dropped');
  ok(files() === f0 + 1, 'one file in the private media store');
  var row = (await db.query("SELECT d.document_type, d.org_id, d.storage_key, pg_column_size(p.*) sz FROM idauto_vehicle_documents d JOIN idauto_vehicle_photos p ON p.document_id = d.id WHERE d.id = $1", [a1.body.photo.id])).rows[0];
  ok(row.document_type === 'vehicle_photo' && row.org_id === orgA && /^[a-f0-9]{64}$/.test(row.storage_key) && row.sz < 2000, 'the database holds a key and metadata — no image bytes (row ' + row.sz + ' B for a ' + REAR.length + ' B image)');
  var a2 = await request('POST', P, T.TECH, FRONT, meta({ view: 'front', location: { source: 'manual', latitude: 36.8, longitude: 10.1, place_name: 'La Marsa', governorate: 'tunis' } }));
  ok(a2.status === 201 && a2.body.photo.number === 2 && a2.body.photo.view === 'front', 'a technician adds the front photograph, number 2');
  var l2 = a2.body.photo.location;
  ok(l2.source === 'manual' && l2.latitude === null && l2.longitude === null && l2.place_name === 'La Marsa' && l2.governorate === 'Tunis' && l2.country === 'Tunisie', 'a place typed by hand: no coordinates are stored, whatever was sent');
  ok(a2.body.photo.captured_at === null && a2.body.photo.analysis === null && a2.body.photo.confirmed === false, 'no date, no analysis, not confirmed: each stays unknown');
  var a3 = await request('POST', P, T.MGR, png(640, 480, 170), meta({ view: 'sideways', location: { source: 'ip', latitude: 36.8, longitude: 10.1 }, captured_at: '2099-01-01' }));
  ok(a3.status === 201 && a3.body.photo.view === 'unknown' && a3.body.photo.location === null && a3.body.photo.captured_at === null, 'an IP-based "location", an unknown view and a future date are all refused: stored as unknown');
  var a4 = await request('POST', P, T.MGR, png(640, 480, 200), {});
  ok(a4.status === 201 && a4.body.photo.location === null, 'no metadata at all: the photograph is stored with everything unknown');
  ok((await request('POST', P, null, REAR)).status === 401, 'without a session: 401');
  ok((await request('POST', P, T.MGR, Buffer.from('this is not an image'))).status === 415, 'not an image: 415');
  ok((await request('POST', P, T.MGR, png(64, 64, 1))).status >= 400, 'a tiny image is refused');
  ok((await request('POST', '/api/vehicles/' + encodeURIComponent('ivid:1:NOPE0000NOPE0000:00') + '/photos', T.MGR, REAR)).status === 404, 'an unknown vehicle: 404');
  var f1 = files();

  say('\n3. THE SAME PHOTOGRAPH TWICE');
  var d1 = await request('POST', P, T.MGR, REAR, meta({ view: 'front' }));
  ok(d1.status === 200 && d1.body.duplicate === true && d1.body.photo.id === a1.body.photo.id && d1.body.photo.view === 'rear', 'the same bytes again: the existing photograph is returned (200), unchanged');
  ok(files() === f1 && (await db.query("SELECT count(*)::int n FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND document_type = 'vehicle_photo'", [vid])).rows[0].n === 4, 'no second row, no second file');

  say('\n4. WHAT THE DATABASE ITSELF REFUSES');
  bad = null; try { await db.query("UPDATE idauto_vehicle_photos SET latitude = 36.8, longitude = 10.1, location_source = 'manual' WHERE document_id = $1", [a2.body.photo.id]); } catch (e) { bad = e; }
  ok(bad && /chk_vphoto_gps_src/.test(bad.message), 'coordinates with a manual source are refused by a constraint');
  bad = null; try { await db.query("UPDATE idauto_vehicle_photos SET latitude = 36.8, longitude = 10.1, location_source = NULL WHERE document_id = $1", [a2.body.photo.id]); } catch (e) { bad = e; }
  ok(bad && /chk_vphoto_gps_src/.test(bad.message), 'coordinates without any source are refused');
  bad = null; try { await db.query("UPDATE idauto_vehicle_photos SET location_source = 'ip' WHERE document_id = $1", [a2.body.photo.id]); } catch (e) { bad = e; }
  ok(bad && /chk_vphoto_source/.test(bad.message), 'an IP address is not an accepted location source');
  var veh = (await db.query("SELECT to_jsonb(v) j FROM idauto_vehicles v WHERE id = $1", [vid])).rows[0].j;
  ok(!Object.keys(veh).some(function (k) { return /lat|lon|place|governorate|location/i.test(k); }), 'the vehicle record has no location column: the location belongs to each photograph');

  say('\n5. CORRECTING A PHOTOGRAPH');
  var u1 = await request('PUT', P + '/' + a3.body.photo.id, T.TECH, { view: 'rear', location: { source: 'manual', place_name: 'Khelidia', governorate: 'Ben Arous' } });
  ok(u1.status === 200 && u1.body.photo.view === 'rear' && u1.body.photo.location.source === 'manual' && u1.body.photo.location.place_name === 'Khelidia', 'the view and a manual place are set');
  var u2 = await request('PUT', P + '/' + a1.body.photo.id, T.MGR, { location: { source: 'exif', latitude: 36.646, longitude: 10.196, place_name: 'Khelidia centre', governorate: 'Ben Arous' } });
  ok(u2.status === 200 && u2.body.photo.location.latitude === 36.646 && u2.body.photo.location.source === 'exif' && u2.body.photo.location.place_name === 'Khelidia centre', 'the NAME of a GPS position is corrected; its coordinates and source stay');
  var u3 = await request('PUT', P + '/' + a2.body.photo.id, T.MGR, { location: null });
  ok(u3.status === 200 && u3.body.photo.location === null && u3.body.photo.view === 'front', 'a location can be set back to unknown; nothing else changes');
  ok((await request('PUT', P + '/999999999', T.MGR, { view: 'rear' })).status === 404, 'an unknown photograph: 404');

  say('\n6. ISOLATION BETWEEN WORKSHOPS');
  var listA = await request('GET', P, T.MGR), listB = await request('GET', P, T.OTHER);
  ok(listA.status === 200 && listA.body.photos.length === 4 && listB.status === 200 && listB.body.photos.length === 0, 'workshop A sees its 4 photographs; workshop B sees none of them');
  ok((await request('GET', P + '/' + a1.body.photo.id + '/image', T.OTHER)).status === 404 && (await request('PUT', P + '/' + a1.body.photo.id, T.OTHER, { view: 'front' })).status === 404 && (await request('DELETE', P + '/' + a1.body.photo.id, T.OTHER)).status === 404, 'workshop B can neither view, change nor delete a photograph of workshop A');
  var img = await request('GET', P + '/' + a1.body.photo.id + '/image', T.TECH);
  ok(img.status === 200 && img.bytes.equals(REAR) && /private, no-store/.test(img.headers['cache-control']) && img.headers['x-content-type-options'] === 'nosniff', 'workshop A gets back exactly its bytes, private and uncached');
  ok((await request('GET', P + '/' + a1.body.photo.id + '/image', null)).status === 401, 'an image without a session: 401');
  var b1 = await request('POST', P, T.OTHER, REAR, meta({ view: 'rear' }));
  ok(b1.status === 201 && b1.body.duplicate === false && files() === f1, 'workshop B stores the same image for itself: its own row, the same single file (content-addressed)');

  say('\n7. DELETING');
  ok((await request('DELETE', P + '/' + a4.body.photo.id, T.TECH)).status === 403, 'a technician may not delete (document:delete is the manager\'s)');
  var del = await request('DELETE', P + '/' + a4.body.photo.id, T.MGR);
  ok(del.status === 200 && files() === f1 - 1 && (await db.query('SELECT count(*)::int n FROM idauto_vehicle_photos WHERE document_id = $1', [a4.body.photo.id])).rows[0].n === 0, 'the manager deletes: the row, its photo record and the file are gone');
  var delShared = await request('DELETE', P + '/' + a1.body.photo.id, T.MGR);
  ok(delShared.status === 200 && files() === f1 - 1 && (await request('GET', P + '/' + b1.body.photo.id + '/image', T.OTHER)).status === 200, 'deleting A\'s copy of a shared image leaves the file: workshop B still references it');

  say('\n8. THE VEHICLE LIST');
  var list = await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(plate.series + 'TU' + plate.number), T.MGR);
  var lr = list.status === 200 && list.body.vehicles.filter(function (x) { return x.ivid === IV; })[0];
  ok(lr && lr.photos === 2 && lr.documents === 0, 'the list counts photographs (2) apart from carte grise faces (0)');
  ok(lr.last_photo_location && lr.last_photo_location.place_name === 'Khelidia' && lr.last_photo_location.source === 'manual', 'and reports where the latest located photograph was taken: ' + JSON.stringify(lr.last_photo_location));
  var lb = (await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(plate.series + 'TU' + plate.number), T.OTHER)).body.vehicles.filter(function (x) { return x.ivid === IV; })[0];
  ok(!lb || lb.last_photo_location === null, 'workshop B does not learn where workshop A photographed the vehicle');
  var dossier = await request('GET', '/api/vehicles/' + encodeURIComponent(IV) + '/dossier', T.MGR);
  ok(dossier.status === 200 && dossier.body.documents.faces.length === 0, 'the dossier\'s carte grise section does not list vehicle photographs');

  say('\n9. GEO ROUTES AND THE BACKUP QUERY');
  var g = await request('GET', '/api/workspace/geo/tn', T.TECH);
  ok(g.status === 200 && g.body.governorates.length === 24 && (await request('GET', '/api/workspace/geo/tn', null)).status === 401, 'governorates are served to signed-in accounts only');
  var rs = await request('GET', '/api/workspace/geo/resolve?lat=36.646&lon=10.196', T.TECH);
  ok(rs.status === 200 && rs.body.resolved.place_name === 'Khelidia' && rs.body.resolved.approximate === true && (await request('GET', '/api/workspace/geo/resolve?lat=abc&lon=1', T.TECH)).status === 400, 'a position is resolved offline and marked approximate; bad coordinates: 400');
  var keys = (await db.query("SELECT k FROM idauto_vehicle_documents d, LATERAL (VALUES (d.storage_key), (d.thumb_storage_key)) v(k) WHERE k IS NOT NULL AND d.vehicle_id = $1", [vid])).rows.map(function (x) { return x.k; });
  ok(keys.length === 3 && keys.every(function (k) { return fs.existsSync(path.join(MEDIA, k.slice(0, 2), k.slice(2, 4), k)); }), 'the off-host backup\'s own reference query returns the photographs\' files, and each exists in the store');

  await db.query("UPDATE idauto_organizations SET status = 'cancelled' WHERE id IN ($1,$2)", [orgA, orgB]).catch(function () {});
  server.close();
  console.log('\nIDA-U3 vehicle photographs (database): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(function (e) { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
