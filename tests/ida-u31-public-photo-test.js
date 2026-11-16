#!/usr/bin/env node
'use strict';
/* IDauto — Update 3.1 — the PUBLIC photograph analysis (homepage scanner).
 * HTTP against a real server on a scratch database, with the vision provider replaced by an in-process stub —
 * no network, no key. Checks: anonymous access, what the routes return and never return, upload limits,
 * rate limiting, that nothing is written, that the provider is called only when enabled, and that the
 * homepage reuses the one shared analysis. */
var path = require('path');
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function read(p) { return fs.readFileSync(path.join(BASE, p), 'utf8'); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
process.env.IDAUTO_PUBLIC_ANALYSIS_PER_10MIN = '4';
delete process.env.IDAUTO_VISION_PROVIDER; delete process.env.IDAUTO_VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;
var db = require(path.join(BASE, 'reference', 'db.js'));
var vision = require(path.join(BASE, 'reference', 'recognition', 'vehicle-vision.js'));
var server, port, ip = '10.31.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
function request(method, p, body, headers) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    var h = Object.assign({ 'Content-Length': payload ? payload.length : 0, 'X-Real-IP': ip }, headers || {});
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: h }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw, headers: res.headers }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
var JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000)]);

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  function counts() { return db.query("SELECT (SELECT count(*) FROM idauto_vehicles) v, (SELECT count(*) FROM idauto_vehicle_documents) d, (SELECT count(*) FROM idauto_audit_log) a, (SELECT count(*) FROM idauto_plates) p").then(function (r) { return JSON.stringify(r.rows[0]); }); }
  var before = await counts();

  say('1. ANALYSIS OFF (nothing configured)');
  var st = await request('GET', '/public/vehicle-analysis');
  ok(st.status === 200 && st.body.enabled === false && Object.keys(st.body).join() === 'enabled', 'anonymous status: { enabled: false } and nothing else');
  var calls = 0, real = vision.analyse;
  vision.analyse = async function () { calls++; return real.apply(null, arguments); };
  var off = await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' });
  ok(off.status === 200 && off.body.vehicle_analysis.enabled === false && Object.keys(off.body.vehicle_analysis.fields).every(function (f) { return off.body.vehicle_analysis.fields[f].value === null; }), 'a photograph is answered « not enabled », every field unknown');
  ok(calls === 0, 'and the provider module is not even called');
  for (var i = 0; i < 6; i++) await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' });
  ok((await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' })).status === 200, 'while OFF, nothing is spent, so nothing is rate-limited');

  say('\n2. ANALYSIS ON (provider replaced by a stub)');
  process.env.IDAUTO_VISION_PROVIDER = 'anthropic'; process.env.IDAUTO_VISION_API_KEY = 'stub-key-' + crypto.randomBytes(6).toString('hex');
  var seen = null;
  vision.analyse = async function (bytes) { calls++; seen = bytes; return { enabled: true, provider: 'anthropic', model: 'secret-model-id', vehicle_visible: true, view: 'rear',
    plate: { serie: '173', numero: '8116', format: 'TUN_STD', text: '173 تونس 8116', confidence: 96, source: 'vision' },
    fields: { make: { value: 'Chevrolet', confidence: 0.93, source: 'vision' }, model: { value: 'Aveo', confidence: 0.8, source: 'vision' }, trim: { value: null, confidence: 0.2, source: 'vision' }, colour: { value: 'noir', confidence: 0.9, source: 'vision' }, body_type: { value: 'berline', confidence: 0.8, source: 'vision' }, year: { value: null, confidence: 0, source: 'vision' } } }; };
  st = await request('GET', '/public/vehicle-analysis');
  ok(st.body.enabled === true && st.raw.indexOf('anthropic') === -1 && st.raw.indexOf(process.env.IDAUTO_VISION_API_KEY) === -1, 'status says enabled — without naming the provider or showing the key');
  var on = await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' });
  var va = on.body && on.body.vehicle_analysis;
  ok(on.status === 200 && va.available === true && va.fields.make.value === 'Chevrolet' && va.fields.model.value === 'Aveo' && va.view === 'rear' && va.plate.text === '173 تونس 8116', 'the fields come back, as the model saw them');
  ok(seen && seen.equals(JPEG), 'exactly the bytes sent were analysed');
  ok(on.raw.indexOf('anthropic') === -1 && on.raw.indexOf('secret-model-id') === -1 && on.raw.indexOf(process.env.IDAUTO_VISION_API_KEY) === -1 && !('provider' in va) && !('model' in va), 'the answer names neither the provider nor the model, and never carries the key');
  ok(on.headers['cache-control'] === 'no-store' && on.headers['x-content-type-options'] === 'nosniff', 'answers are not cached');
  vision.analyse = async function () { return { enabled: true, provider: 'anthropic', model: 'm', error: 'provider_auth', fields: vision.normalise({}).fields }; };
  var err = await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg', 'X-Real-IP': '10.32.1.1' });
  ok(err.status === 200 && err.body.vehicle_analysis.available === false && err.body.vehicle_analysis.error === 'analysis_unavailable' && err.raw.indexOf('provider_auth') === -1, 'a provider failure is reported as « unavailable », without its internal reason');

  say('\n3. UPLOAD LIMITS');
  vision.analyse = async function () { calls++; return { enabled: true, vehicle_visible: false, view: 'unknown', plate: null, fields: vision.normalise({}).fields }; };
  ip = '10.33.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
  ok((await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/png' })).status === 415, 'not declared as JPEG: 415');
  ok((await request('POST', '/public/vehicle-analysis', Buffer.from('GIF89a' + 'x'.repeat(200)), { 'Content-Type': 'image/jpeg' })).status === 400, 'declared JPEG but not one (magic bytes): 400');
  var big = Buffer.concat([JPEG, Buffer.alloc(vision.MAX_IMAGE_BYTES)]);
  ok((await request('POST', '/public/vehicle-analysis', big, { 'Content-Type': 'image/jpeg' })).status === 413, 'over 1.5 MB: 413');
  ok((await request('PUT', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' })).status === 405 && (await request('DELETE', '/public/geo/tn')).status === 405, 'other methods: 405');

  say('\n4. RATE LIMITING (per client; budget set to 4 for this test)');
  ip = '10.34.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
  var statuses = [];
  for (var k = 0; k < 6; k++) statuses.push((await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' })).status);
  ok(statuses.slice(0, 4).every(function (s) { return s === 200; }) && statuses.slice(4).every(function (s) { return s === 429; }), 'four analyses, then 429 (' + statuses.join(',') + ')');
  var limited = await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' });
  ok(limited.status === 429 && /^\d+$/.test(String(limited.headers['retry-after'])), '429 says when to retry');
  ip = '10.35.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250);
  ok((await request('POST', '/public/vehicle-analysis', JPEG, { 'Content-Type': 'image/jpeg' })).status === 200, 'another client is not affected');

  say('\n5. LOCATION HELPERS');
  var g = await request('GET', '/public/geo/tn');
  ok(g.status === 200 && g.body.governorates.length === 24, 'the 24 governorates, anonymously');
  var rs = await request('GET', '/public/geo/resolve?lat=36.646&lon=10.196');
  ok(rs.status === 200 && rs.body.resolved.place_name === 'Khelidia' && rs.body.resolved.approximate === true && Object.keys(rs.body).join() === 'resolved', 'a position resolved offline, marked approximate, nothing else returned');
  ok((await request('GET', '/public/geo/resolve?lat=x&lon=1')).status === 400, 'bad coordinates: 400');

  say('\n6. WHAT THE PUBLIC CANNOT REACH');
  var priv = ['/api/workspace/vehicle-recognition', '/api/vehicles/x/photos', '/api/workspace/geo/tn', '/api/workspace/vehicles', '/api/search?q=173', '/api/vehicles/x/owner', '/api/vehicles/x/dossier'];
  for (var j = 0; j < priv.length; j++) { var rr = await request('GET', priv[j]); ok(rr.status === 401, 'anonymous ' + priv[j] + ' → 401'); }
  ok((await request('POST', '/api/vehicles/register', JSON.stringify({ plate: { type: 'TU', series: '173', number: '8116' } }), { 'Content-Type': 'application/json' })).status === 401, 'anonymous vehicle creation → 401');
  ok((await request('POST', '/api/vehicles/x/photos', JPEG, { 'Content-Type': 'image/jpeg' })).status === 401, 'anonymous photograph storage → 401');
  ok((await request('GET', '/public/vehicles/1')).status === 404 && (await request('GET', '/public/photos')).status === 404, 'no other public path exists');
  ok(before === await counts(), 'nothing was written: vehicles, documents, plates and audit rows are unchanged');

  say('\n7. THE PAGE REUSES THE ONE ANALYSIS');
  var routes = read('reference/public/photo-analysis-routes.js'), home = read('web/citizen/home-photo.js'), shared = read('web/citizen/photo-analysis.js'), app = read('reference/app-photos.js'), html = read('web/citizen/index.html');
  ok(/require\('\.\.\/recognition\/vehicle-vision\.js'\)/.test(routes) && /require\('\.\.\/photos\/tn-geo\.js'\)/.test(routes), 'the public routes reuse the vision module and the location module');
  ok(!/db\.query|INSERT|UPDATE|DELETE|storage|writes\.|withAudit/.test(routes.replace(/^\s*\/\/.*$/gm, '')), 'the public routes neither query nor write the database (beyond the rate counter) nor touch the media store');
  ok(/A\.prepare\(file, taken, fix\)/.test(home) && /A\.analyse\(c,/.test(home) && /A\.prepare\(file, taken, livePosition\)/.test(app) && /A\.analyse\(p,/.test(app), 'the homepage and the workshop page call the same prepare() and analyse()');
  ok(!/createImageBitmap|readExif|analyzeStill/.test(home) && !/createImageBitmap|analyzeStill/.test(app) && /analyzeStill/.test(shared), 'neither page has its own pipeline: it lives in photo-analysis.js');
  ok(/"\/public\/vehicle-analysis"/.test(home) && /mode === "workshop" \? "\/api\/workspace\/scans" : "\/public\/scans"/.test(home), 'the homepage uses the public routes, and the workshop routes only for a signed-in workshop');
  ok(/credentials: ws \? "same-origin" : "omit"/.test(home), 'public calls carry no cookie; only workshop calls carry the session');
  ok(/window\.IdaHome\.applyScannedPlate/.test(home), 'the plate goes to the existing public search, not to a new lookup');
  ok(/data-hp-video/.test(html) && /data-hp-shutter/.test(html) && /data-hp-pick-file/.test(html) && /capture="environment"/.test(html), 'the dialog shows the live camera with a shutter, a file choice and the native camera as a fallback');
  ok(!/hp-view/.test(html) && !/name="hp-view"/.test(home), 'no front/rear question anywhere');
  ok(/openBtn\.addEventListener\("click", function \(\) \{ seq\+\+; current = null; setTimeout\(openCamera, 0\); \}\)/.test(home) && /getUserMedia\(\{ video: \{ facingMode: \{ ideal: "environment" \}/.test(home), '« Scanner la plaque » opens the rear camera at once');
  ok(/save\(c\);\s+\/\/ the photograph is saved…\s+analyse\(c\);/.test(home), 'saving and analysis start together, independently');
  ok(/data-hp-retry-save/.test(home) && /data-hp-retry-analysis/.test(home), 'a failed save and a failed analysis each have their own retry');
  ok(/var fix = taken \? A\.askPosition\(\) : null;/.test(home), 'a fresh position is taken for each photograph, at the shutter');
  ok(/Scanner la plaque en vidéo/.test(html), 'the video scanner remains as an alternative');
  ok(/A\.askPosition\(\);\s+\/\/ the location permission is asked as the scanner opens/.test(home), 'the location permission is asked when the scanner opens');
  ok(!/anthropic|api[_-]?key|sk-ant|IDAUTO_VISION/i.test(home + shared + html), 'no key, key name or provider name in anything the public page loads');
  var cat = read('reference/i18n-catalog-ar.js');
  ['Prendre une photo du véhicule', 'Rechercher cette plaque', 'Prendre une autre photo', 'Non disponible', 'Lecture à vérifier'].forEach(function (s) { ok(cat.indexOf(JSON.stringify(s) + ':') !== -1, 'Tunisian Arabic exists for « ' + s + ' »'); });

  vision.analyse = real;
  server.close();
  console.log('\nIDA-U3.1 public photo analysis: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(function (e) { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
