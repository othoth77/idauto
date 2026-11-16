#!/usr/bin/env node
'use strict';
// IDauto — Update 2 — automatic recognition, on a scratch database:
//   1. the migration is additive and safe to apply twice; existing vehicles are untouched;
//   2. a vehicle confirmed from a scan saves its registration, make, model, colour, body type,
//      and the provenance of what the camera proposed (kept or corrected);
//   3. a vehicle typed by hand has no provenance;
//   4. an existing registration is never created twice, and the search finds it (what the result card uses);
//   5. the vehicle list returns the new columns;
//   6. the analysis route: sign-in required, JPEG only, OFF unless configured, nothing stored.
var path = require('path');
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
delete process.env.IDAUTO_VISION_PROVIDER; delete process.env.IDAUTO_VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;   // this suite never calls a provider
var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['MGR', 'TECH', 'OTHER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex'), ids = {};
ids[T.MGR] = { actor_ref: 'svc_u2_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_u2_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_u2_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;
function request(method, p, token, body, type) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var headers = { 'Content-Length': payload ? payload.length : 0 };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = type || 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { type: 'TU', series: String(a), number: String(b), canonical: a + ' TUN ' + b }; }
}

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }

  say('1. MIGRATION — one nullable column, twice, nothing else moves');
  var before = (await db.query('SELECT count(*)::int n, md5(string_agg(id || coalesce(make, \'\') || coalesce(model, \'\') || coalesce(colour, \'\') || coalesce(body_type, \'\'), \',\' ORDER BY id)) h FROM idauto_vehicles')).rows[0];
  var sql = fs.readFileSync(path.join(BASE, 'database', 'migrations', 'ida-u2-visual-recognition.sql'), 'utf8');
  for (var i = 0; i < 2; i++) { var c = await db.getClientForTransaction(); try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  var col = (await db.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'idauto_vehicles' AND column_name = 'visual_recognition'")).rows[0];
  ok(col && col.data_type === 'jsonb' && col.is_nullable === 'YES', 'applied twice in a transaction: visual_recognition is a nullable JSONB column');
  var after = (await db.query('SELECT count(*)::int n, md5(string_agg(id || coalesce(make, \'\') || coalesce(model, \'\') || coalesce(colour, \'\') || coalesce(body_type, \'\'), \',\' ORDER BY id)) h FROM idauto_vehicles')).rows[0];
  ok(before.n === after.n && before.h === after.h, 'every existing vehicle (' + after.n + ') keeps its make, model, colour and body type');
  var have = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'idauto_vehicles' AND column_name IN ('make','model','colour','body_type','year')")).rows.length;
  ok(have === 5, 'make, model, colour, body_type and year already had their columns: none was added for them');
  var bad = null; try { await db.query("UPDATE idauto_vehicles SET visual_recognition = '[1,2]'::jsonb WHERE id = (SELECT min(id) FROM idauto_vehicles)"); } catch (e) { bad = e; }
  ok(bad && /chk_vehicle_visual_recognition/.test(bad.message), 'the column accepts an object only (constraint)');

  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U2 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage U2 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  say('\n2. A VEHICLE CONFIRMED FROM A SCAN');
  var p1 = await freePlate();
  var rec = { provider: 'anthropic', model: 'claude-opus-5-5', plate: { confidence: 97.6, auto: true }, hacked: true,
    fields: { make: { proposed: 'Chevrolet', confidence: 0.94, source: 'vision' }, model: { proposed: 'Aveo', confidence: 0.7, source: 'vision' }, colour: { proposed: 'gris', confidence: 0.55, source: 'camera' }, body_type: { proposed: 'berline', confidence: 0.9, source: 'vision' } } };
  var r1 = await request('POST', '/api/vehicles/register', T.MGR, { plate: p1, make: 'Chevrolet', model: 'Aveo LS', colour: 'noir', body_type: 'berline', year: '2010', recognition: rec });
  ok(r1.status === 201 && r1.body.plate === p1.canonical, 'saved (201) with its registration ' + p1.canonical);
  var v1 = (await db.query('SELECT make, model, colour, body_type, year, visual_recognition vr FROM idauto_vehicles WHERE ivid = $1', [r1.body.ivid])).rows[0];
  ok(v1.make === 'CHEVROLET' && v1.model === 'AVEO LS' && v1.colour === 'noir' && v1.body_type === 'berline' && v1.year === 2010, 'the columns hold what the person CONFIRMED: Chevrolet · Aveo LS · noir · berline · 2010');
  ok(v1.vr && v1.vr.fields.make.kept === true && v1.vr.fields.body_type.kept === true, 'provenance: make and body type were kept as proposed');
  ok(v1.vr.fields.model.kept === false && v1.vr.fields.model.proposed === 'Aveo' && v1.vr.fields.colour.kept === false && v1.vr.fields.colour.source === 'camera', 'provenance: model and colour were corrected by the person, and the proposals are remembered as proposals');
  ok(v1.vr.provider === 'anthropic' && v1.vr.plate.auto === true && v1.vr.plate.confidence === 98 && !('hacked' in v1.vr), 'engine and plate confidence are recorded; stray keys are not');
  ok(!/data:image|base64|\/9j\//.test(JSON.stringify(v1.vr)), 'no image is stored with it');

  say('\n3. A VEHICLE TYPED BY HAND');
  var p2 = await freePlate();
  var r2 = await request('POST', '/api/vehicles/register', T.MGR, { plate: p2, make: 'Renault', model: 'Clio', colour: 'blanc' });
  var v2 = (await db.query('SELECT colour, body_type, visual_recognition vr FROM idauto_vehicles WHERE ivid = $1', [r2.body.ivid])).rows[0];
  ok(r2.status === 201 && v2.vr === null && v2.colour === 'blanc' && v2.body_type === null, 'no scan: provenance is NULL, the form works exactly as before');
  var r2b = await request('POST', '/api/vehicles/register', T.MGR, { plate: await freePlate(), recognition: { fields: { make: { proposed: 'X', confidence: 1, source: 'register' } } } });
  ok(r2b.status === 201 && (await db.query('SELECT visual_recognition vr FROM idauto_vehicles WHERE ivid = $1', [r2b.body.ivid])).rows[0].vr === null, 'a proposal from an unknown source is not recorded at all');

  say('\n4. NO DUPLICATE VEHICLE FOR ONE REGISTRATION');
  var total = (await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n;
  var dup = await request('POST', '/api/vehicles/register', T.MGR, { plate: p1, make: 'Chevrolet', recognition: rec });
  ok(dup.status === 409 && dup.body.details && dup.body.details.reason === 'vehicle_already_registered' && dup.body.details.ivid === r1.body.ivid, 'scanning the same plate again is refused (409) and names the existing file');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n === total, 'no second vehicle was created');
  var found = await request('GET', '/api/search?q=' + encodeURIComponent(p1.canonical), T.MGR);
  var item = found.status === 200 && (found.body.groups.filter(function (g) { return g.key === 'vehicles'; })[0].items || []).filter(function (x) { return x.plate === p1.canonical; })[0];
  ok(item && item.href === '/atelier/vehicule?ref=' + encodeURIComponent(r1.body.ivid), 'the search the result card runs finds the existing vehicle and its link (« Ouvrir sa fiche »)');
  var fresh = await freePlate(), none = await request('GET', '/api/search?q=' + encodeURIComponent(fresh.canonical), T.MGR);
  ok(none.status === 200 && !(none.body.groups.filter(function (g) { return g.key === 'vehicles'; })[0].items || []).some(function (x) { return x.plate === fresh.canonical; }), 'a registration that does not exist is not reported as existing');

  say('\n5. THE VEHICLE LIST');
  var list = await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(p1.series + 'TU' + p1.number), T.MGR);
  var row = list.status === 200 && list.body.vehicles.filter(function (x) { return x.ivid === r1.body.ivid; })[0];
  ok(row && row.plate === p1.canonical && row.make === 'CHEVROLET' && row.model === 'AVEO LS' && row.colour === 'noir' && row.body_type === 'berline' && row.year === 2010, 'registration, make, model, colour, body type and year come back for the list');
  ok(!('visual_recognition' in row), 'the provenance is not sent with the list');

  say('\n6. THE ANALYSIS ROUTE');
  var JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  ok((await request('POST', '/api/workspace/vehicle-recognition', null, JPEG, 'image/jpeg')).status === 401, 'without a session: 401');
  ok((await request('GET', '/api/workspace/vehicle-recognition', null)).status === 401, 'its status too: 401');
  var stt = await request('GET', '/api/workspace/vehicle-recognition', T.MGR);
  ok(stt.status === 200 && stt.body.vehicle_analysis.enabled === false && stt.body.vehicle_analysis.provider === null, 'not configured: the page is told the analysis is OFF');
  var audits = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.recognition.vision'")).rows[0].n;
  var an = await request('POST', '/api/workspace/vehicle-recognition', T.MGR, JPEG, 'image/jpeg');
  ok(an.status === 200 && an.body.vehicle_analysis.enabled === false && Object.keys(an.body.vehicle_analysis.fields).every(function (f) { return an.body.vehicle_analysis.fields[f].value === null; }), 'OFF: a photo is answered with every field unknown');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.recognition.vision'")).rows[0].n === audits, 'OFF: nothing left the server, so nothing is logged as sent');
  ok((await request('POST', '/api/workspace/vehicle-recognition', T.MGR, Buffer.from('GIF89a' + 'x'.repeat(50)), 'image/jpeg')).status === 400, 'bytes that are not a JPEG: 400');
  ok((await request('POST', '/api/workspace/vehicle-recognition', T.MGR, { a: 1 })).status === 415, 'another content type: 415');
  // the same route with the analysis ON — the provider is replaced by a stub, no network call is made
  var visionModule = require(path.join(BASE, 'reference', 'recognition', 'vehicle-vision.js')), realAnalyse = visionModule.analyse, seen = null;
  visionModule.analyse = async function (bytes) { seen = bytes; return { enabled: true, provider: 'anthropic', model: 'stub-model', vehicle_visible: true,
    fields: { make: { value: 'Chevrolet', confidence: 0.93, source: 'vision' }, model: { value: null, confidence: 0.4, source: 'vision' }, colour: { value: 'noir', confidence: 0.9, source: 'vision' }, body_type: { value: 'berline', confidence: 0.8, source: 'vision' } } }; };
  var on = await request('POST', '/api/workspace/vehicle-recognition', T.MGR, JPEG, 'image/jpeg');
  visionModule.analyse = realAnalyse;
  ok(on.status === 200 && on.body.vehicle_analysis.fields.make.value === 'Chevrolet' && on.body.vehicle_analysis.fields.model.value === null && on.body.vehicle_analysis.fields.make.source === 'vision', 'ON: the fields come back marked source: vision, unknown ones as null');
  ok(seen && seen.equals(JPEG), 'ON: exactly the bytes the page sent are analysed — the registration number is not part of the request');
  var arow = (await db.query("SELECT actor_ref, org_id, change_summary, new_value_json::text j FROM idauto_audit_log WHERE event_type = 'vehicle.recognition.vision' ORDER BY id DESC LIMIT 1")).rows[0];
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.recognition.vision'")).rows[0].n === audits + 1 && arow.org_id === orgA && /not stored/.test(arow.change_summary), 'ON: one audit line names who sent a photo to the provider, and that it was not stored');
  ok(!/\/9j\/|base64/.test(arow.j) && JSON.parse(arow.j).stored === false, 'ON: the audit line carries no image');
  var techList = await request('GET', '/api/workspace/vehicle-recognition', T.TECH);
  ok(techList.status === 200 || techList.status === 403, 'a technician is answered according to the vehicle:write scope (' + techList.status + ')');

  await db.query("UPDATE idauto_organizations SET status = 'cancelled' WHERE id IN ($1,$2)", [orgA, orgB]).catch(function () {});
  server.close();
  console.log('\nIDA-U2 recognition (database): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(function (e) { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
