'use strict';
/* IDA-V14 (home search) — « Rechercher par carte grise » on the homepage:
 * the shared identification layer registration-document → vehicle.
 *   POST /api/identify/registration-document  (vehicle:resolve)
 * VIN first (vin:search holders only), then plate, then make/model; writes
 * NOTHING (no document, no vehicle); technical fields only; auth as V13.
 * Plus the homepage structure and the anonymous plate path. Scratch DB only.
 */
var http = require('http'); var fs = require('fs'); var crypto = require('crypto'); var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port, logLines = [], realLog = console.log;
function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body ? Buffer.from(JSON.stringify(opts.body)) : null;
    var headers = Object.assign({ 'Content-Length': payload ? payload.length : 0 }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.cookie) { headers.Cookie = opts.cookie; headers['X-IDauto-Session'] = '1'; headers.Origin = 'http://127.0.0.1:' + port; }
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), j = null; try { j = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, body: j, raw: raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier home A','garage','active') RETURNING id")).rows[0].id;
  var api = require(path.join(BASE, 'reference', 'api.js'));
  server = api.createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); }); port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  console.log = function () { var line = Array.prototype.map.call(arguments, String).join(' '); logLines.push(line); realLog.apply(console, arguments); };
  var run = crypto.randomBytes(4).toString('hex'), PW = 'Home-Search-' + run + '-2026';
  async function user(role, org) { var email = role + '-home-' + run + '@idauto.test'; var c = await auth.api.signUpEmail({ body: { email: email, password: PW, name: role } }); await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, org || null, c.user.id]); var s = await auth.api.signInEmail({ body: { email: email, password: PW }, returnHeaders: true }); return String(s.headers.get('set-cookie')).split(';')[0]; }
  var MGR = await user('manager', orgA), TECH = await user('technician', orgA);
  var S = String(100 + Math.floor(Math.random() * 899)), N = String(1000 + Math.floor(Math.random() * 8999));
  var VIN = 'VF7SA5FS' + crypto.randomBytes(5).toString('hex').toUpperCase().replace(/[IOQ]/g, 'X').slice(0, 9);
  var MOTOR = '1.6 HDI ' + run.slice(0, 3).toUpperCase();
  // The vehicle to find: plate + VIN + make/model/motorisation, through the official write path.
  var created = await request('POST', '/api/resolve/confirm', { cookie: MGR, body: { plate: S + ' TU ' + N, vin: VIN, candidate: { manufacturer: 'CITROEN', model: 'C4 ' + run.slice(0, 4).toUpperCase(), motorisation: MOTOR, year: 2017 }, method: 'manual_selection' } });
  ok(created.status === 200, 'precondition: a vehicle with plate, VIN, make/model exists');
  var IVID = created.body.vehicle.id, MODEL = created.body.vehicle.model;
  var vehiclesBefore = (await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n;
  var docsBefore = (await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents')).rows[0].n;
  var ID = '/api/identify/registration-document';
  function card(lines) { return lines.join('\n'); }
  var HOLDER = ['NOM : BEN AMOR SAMI', 'ADRESSE : 4 RUE DES OLIVIERS SFAX', 'CIN 07654321', 'الاسم : فلان', 'العنوان : صفاقس'];

  say('\n1. GATES');
  ok((await request('POST', ID, { body: { faces: [{ face: 1, text: 'MARQUE : X' }] } })).status === 401, 'without a session -> 401');
  ok((await request('POST', ID, { cookie: MGR, body: { faces: [] } })).status === 400, 'no faces -> 400');
  ok((await request('POST', ID, { cookie: MGR, body: { faces: [{ face: 2, text: 'MARQUE : X' }] } })).status === 400, 'face 2 alone -> 400 (face 1 is mandatory)');
  ok((await request('POST', ID, { cookie: MGR, body: { faces: [{ face: 1, text: 'MARQUE : X' }, { face: 2, text: 'POIDS TOTAL : 1200' }] } })).status === 200, 'face 1 + face 2 accepted (face 2 optional)');

  say('\n2. PRIORITY — VIN, then plate, then make/model');
  var byVin = await request('POST', ID, { cookie: MGR, body: { faces: [{ face: 1, text: card(['N° DE SERIE DU TYPE : ' + VIN, 'N° D IMMATRICULATION : 999 تونس 9999', 'MARQUE : PEUGEOT', 'TYPE : 208'].concat(HOLDER)), confidence: 80 }] } });
  ok(byVin.status === 200 && byVin.body.status === 'found' && byVin.body.identified_by === 'vin' && byVin.body.vehicle.id === IVID, '14. a valid 17-char VIN wins over a different plate and make (manager holds vin:search)');
  ok(byVin.body.vehicle.vin === VIN, 'the manager receives the VIN on the card');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND org_id = $1", [orgA])).rows[0].n >= 1, 'the VIN lookup is audited like a VIN search');
  var techVin = await request('POST', ID, { cookie: TECH, body: { faces: [{ face: 1, text: card(['N° DE SERIE DU TYPE : ' + VIN, 'MARQUE : CITROEN']) }] } });
  ok(techVin.status === 200 && techVin.body.status === 'not_found' && techVin.body.tried.indexOf('vin:not_permitted') !== -1 && techVin.body.ocr.vin === '(présent)', '22. a technician (no vin:search) never gets a VIN lookup, and the VIN is not echoed back');
  var byPlate = await request('POST', ID, { cookie: TECH, body: { faces: [{ face: 1, text: card(['N° D IMMATRICULATION : ' + S + ' تونس ' + N, 'MARQUE : RENAULT', 'TYPE : CLIO']) }] } });
  ok(byPlate.status === 200 && byPlate.body.status === 'found' && byPlate.body.identified_by === 'plate' && byPlate.body.vehicle.id === IVID, '15. the plate (Arabic spelling) identifies the vehicle when no VIN is usable');
  ok(byPlate.body.vehicle.vin === undefined && byPlate.body.vehicle.vin_present === true, 'the technician sees vin_present only');
  var byMm = await request('POST', ID, { cookie: TECH, body: { faces: [{ face: 1, text: card(['MARQUE : CITROEN', 'TYPE : ' + MODEL]) }] } });
  ok(byMm.status === 200 && byMm.body.status === 'found' && byMm.body.identified_by === 'make_model' && byMm.body.vehicle.id === IVID, '16. make + model fallback (exact single local match)');
  var badVinCard = await request('POST', ID, { cookie: MGR, body: { faces: [{ face: 1, text: card(['N° DE SERIE : VF7SA5FS0Q12345', 'N° D IMMATRICULATION : ' + S + ' TU ' + N]) }] } });
  ok(badVinCard.body.status === 'found' && badVinCard.body.identified_by === 'plate' && badVinCard.body.tried.indexOf('vin') === -1, 'an invalid VIN (15 chars) is ignored and the plate is used');

  say('\n3. NOT FOUND — nothing created, useful data returned');
  var nf = await request('POST', ID, { cookie: MGR, body: { faces: [{ face: 1, text: card(['N° D IMMATRICULATION : 997 تونس 9997', 'MARQUE : SKODA', 'TYPE : FABIA ' + run, 'N° DE SERIE DU TYPE : TMBJJ7NE' + run.toUpperCase().replace(/[IOQ]/g, 'X').slice(0, 8) + 'A', 'D.P.M.C : 01/02/2015'].concat(HOLDER)) }] } });
  ok(nf.status === 200 && nf.body.status === 'not_found' && nf.body.created === false && nf.body.vehicle === null, '19. unknown card -> not_found, created:false');
  ok(nf.body.options.search_plate === '997 TUN 9997' && nf.body.options.search_make_model.manufacturer === 'SKODA' && nf.body.ocr.year === 2015, 'the useful OCR data and the search options come back');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n === vehiclesBefore, 'no vehicle was created by any search');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents')).rows[0].n === docsBefore, 'no document was stored by any search');
  ok(nf.raw.indexOf('BEN AMOR') === -1 && nf.raw.indexOf('OLIVIERS') === -1 && nf.raw.indexOf('07654321') === -1 && nf.raw.indexOf('فلان') === -1 && byVin.raw.indexOf('BEN AMOR') === -1, '20. holder data (nom, adresse, CIN, Arabic) never appears in any answer');
  var all = logLines.join('\n');
  ok(all.indexOf('BEN AMOR') === -1 && all.indexOf('OLIVIERS') === -1 && all.indexOf('07654321') === -1 && all.indexOf(VIN) === -1, 'and never in the logs (nor the VIN)');
  ok(/registration_identify_done/.test(all), 'identify events are emitted (counters only)');

  say('\n4. HOMEPAGE STRUCTURE AND ASSETS');
  var home = await request('GET', '/');
  ok(home.status === 200 && home.raw.indexOf('Rechercher par carte grise') !== -1 && home.raw.indexOf('data-cg-home-open') !== -1, '1. the homepage carries « Rechercher par carte grise » with its button');
  ok(home.raw.indexOf('data-cg-root') !== -1 && home.raw.indexOf('registration-scanner.js') !== -1 && home.raw.indexOf('home-registration.js') !== -1, 'the shared scanner module and the page script are loaded');
  ok(!/<script>|onclick=|style="/.test(home.raw), 'no inline script on the homepage');
  ok(/'wasm-unsafe-eval'/.test(home.headers['content-security-policy']) && /connect-src 'self'/.test(home.headers['content-security-policy']), 'the citizen CSP (wasm for the OCR engine, connect-src self) is unchanged');
  for (var i = 0, assets = ['/assets/scanic.umd.js', '/assets/registration-scanner.js', '/assets/home-registration.js', '/assets/document.css', '/assets/tesseract/fra.traineddata.gz', '/assets/tesseract/ara.traineddata.gz']; i < assets.length; i++) ok((await request('GET', assets[i])).status === 200, 'asset served: ' + assets[i]);
  var homeJs = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'home-registration.js'), 'utf8');
  var scannerJs = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'registration-scanner.js'), 'utf8');
  ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(homeJs + scannerJs), '21. nothing persisted in the browser by the home search or the scanner');
  ok(!/Authorization|Bearer/.test(homeJs), 'no manual Bearer in the browser: the V13 session cookie + X-IDauto-Session header only');
  ok(/\/public\/plates\//.test(homeJs) && !/\/api\/identify/.test(homeJs.split('identifyAnonymous')[1].split('function renderFound')[0]), 'an anonymous visitor only ever reaches the public plate route');
  ok(/mode: "identify"/.test(homeJs) && /if \(state\.mode === "identify"\) return identify\(\);/.test(scannerJs), 'the homepage uses the SAME scanner in identify mode (no second OCR pipeline)');
  ok(!/api\("PUT"/.test(scannerJs.split('async function identify()')[1].split('var KEY_FR')[0]), 'identify mode uploads nothing');
  var svc = fs.readFileSync(path.join(BASE, 'reference', 'documents', 'document-service.js'), 'utf8').split('async function identify(')[1].split('async function markConfirmed')[0];
  ok(!/upsertFace|storage\.put|createIdentifiedVehicle|saveIdentification|resolver\.confirm/.test(svc), 'the server identify layer never stores or creates');

  say('\n5. ANONYMOUS PLATE PATH (unchanged public route)');
  var pub = await request('GET', '/public/plates/' + encodeURIComponent(S + ' تونس ' + N));
  ok(pub.status === 200 && pub.body.ivid === IVID, 'the plate read from a card resolves publicly, IVID only');
  var pubPassport = await request('GET', '/public/passport/' + encodeURIComponent(IVID));
  ok(pubPassport.status === 200 && pubPassport.raw.indexOf(VIN) === -1, 'the public passport still carries no VIN');

  console.log = realLog; server.close(); await db.closePool();
  console.log('\nIDA-V14 home registration search: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log = realLog; console.error('FATAL: ' + (e && e.stack || e)); process.exit(1); });
