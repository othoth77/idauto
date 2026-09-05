'use strict';
/* IDA-V14 (home search) — « Rechercher par carte grise » on the homepage in a real (headless) Chrome: the atelier button, the
 * dialog, face 1 from a "gallery" file, face 2 optional, the REAL pipeline
 * (Scanic detection + perspective, JPEG optimisation, Tesseract fra+ara OCR
 * in a worker, server parser), the proposal table, confirmation, the
 * passport section, reload persistence, replacement, deletion, and a
 * 390 px viewport. The card is SYNTHETIC: drawn on a canvas in the page with
 * French labels and values, then photographed as a rotated, perspective-
 * skewed picture on a dark background — no real customer document is used
 * anywhere. Skips (exit 0) without Chrome. Node 22 global WebSocket.
 */
var http = require('http'); var cp = require('child_process'); var crypto = require('crypto'); var path = require('path'); var fs = require('fs');
var BASE = path.join(__dirname, '..');
var CHROME = ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME || typeof WebSocket === 'undefined') { console.log('IDA-V14 home search browser: SKIPPED (no Chrome) — 0 passed, 0 failed'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
var db = require(path.join(BASE, 'reference', 'db.js'));
var CDP = 9300 + Math.floor(Math.random() * 500);
function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { r(JSON.parse(Buffer.concat(c).toString())); }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier CG E2E','garage','active') RETURNING id")).rows[0].id;
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var server = api.createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); }); var PORT = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + PORT;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var EMAIL = 'cg-' + crypto.randomBytes(4).toString('hex') + '@idauto.test', PW = 'Cg-Browser-' + crypto.randomBytes(6).toString('hex') + '-1';
  var u = await auth.api.signUpEmail({ body: { email: EMAIL, password: PW, name: 'Chef Atelier' } });
  await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', ['manager', ORG, u.user.id]);
  var VIN = 'VF3CCHMZ0JT' + crypto.randomBytes(3).toString('hex').toUpperCase().replace(/[IOQ]/g, 'X');
  var S = String(100 + Math.floor(Math.random() * 899)), N = String(1000 + Math.floor(Math.random() * 8999));

  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + CDP, '--window-size=390,1600', '--user-data-dir=/tmp/idauto-cg-e2e-' + process.pid, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} });   // never leave a Chrome behind, whatever the outcome
  var targets = null;
  for (var attempt = 0; attempt < 30 && !targets; attempt++) { await sleep(1000); try { targets = await get('http://127.0.0.1:' + CDP + '/json'); } catch (e) { targets = null; } }
  if (!targets) throw new Error('Chrome did not open its DevTools port');
  var page = targets.filter(function (t) { return t.type === 'page'; })[0];
  var ws = new WebSocket(page.webSocketDebuggerUrl); var id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr, timeoutMs) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs || 30000 }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception)); return r.result && r.result.result ? r.result.result.value : undefined; }
  function run(stmts, timeoutMs) { return ev('(async () => { ' + stmts + ' })()', timeoutMs); }   // statements with await; no return value
  async function waitFor(expr, ms) { var t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(500); } return false; }
  var netLog = [];
  ws.addEventListener('message', function (m) { var d = JSON.parse(m.data); if (d.method === 'Network.responseReceived' && /\/api\/auth\//.test(d.params.response.url)) netLog.push(d.params.response.status + ' ' + d.params.response.url.replace(/^https?:\/\/[^/]+/, '')); });
  async function loginDebug(label) { console.log('     DEBUG ' + label + ': href=' + await ev('location.href') + ' error=' + JSON.stringify(await ev('(document.querySelector("#login-error-body")||{}).textContent||""')) + ' help=' + JSON.stringify(await ev('(document.querySelector("#login-help")||{}).textContent||""')) + ' auth=' + netLog.join(' | ')); }
  // Better Auth keys its sign-in limit (5/min) on the client IP it trusts from X-Real-IP
  // (nginx sets it in production). A headless browser sends none, so every browser suite
  // used to share ONE 'no-trusted-ip' bucket and the 6th sign-in of a full run got 429 —
  // the intermittent 'login did not redirect' failure. Each suite now presents its own
  // client address, exactly as distinct visitors behind nginx would.
  await send('Network.enable'); await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.77.12.' + (1 + crypto.randomBytes(1)[0] % 250) } });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  var HELPERS = `window.__makeCard = function (lines, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
    x.fillStyle = '#f4efe2'; x.fillRect(0, 0, w, h); x.strokeStyle = '#8a7f6a'; x.lineWidth = 6; x.strokeRect(12, 12, w - 24, h - 24);
    x.fillStyle = '#1b1b1b'; x.font = 'bold 40px sans-serif'; x.fillText('CERTIFICAT D IMMATRICULATION', 60, 90);
    x.font = '34px sans-serif'; lines.forEach(function (l, i) { x.fillText(l, 60, 170 + i * 58); });
    return c;
  };
  window.__photograph = function (card, W, H, angleDeg, skew) {
    var p = document.createElement('canvas'); p.width = W; p.height = H; var x = p.getContext('2d');
    x.fillStyle = '#2a2d31'; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate(angleDeg * Math.PI / 180); x.transform(1, 0, skew, 1, 0, 0);
    var s = Math.min((W * 0.78) / card.width, (H * 0.78) / card.height); x.scale(s, s); x.drawImage(card, -card.width / 2, -card.height / 2); x.restore();
    return new Promise(function (res) { p.toBlob(function (b) { res(new File([b], 'photo.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.95); });
  };
  window.__paste = function (file, text) { var dt = new DataTransfer(); if (file) dt.items.add(file); if (text) dt.setData('text/plain', text); var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.dispatchEvent(ev); return ev.defaultPrevented; };
  window.__feed = function (selector, file) { var input = document.querySelector(selector); var dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
  true;`;
  // The vehicle to find, created through the official path by the manager.
  var s0 = await auth.api.signInEmail({ body: { email: EMAIL, password: PW }, returnHeaders: true });
  var cookie = String(s0.headers.get('set-cookie')).split(';')[0];
  function req(method, p, body) { return new Promise(function (resolve, reject) { var raw = body ? Buffer.from(JSON.stringify(body)) : null; var r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method: method, headers: { Cookie: cookie, 'X-IDauto-Session': '1', Origin: 'http://127.0.0.1:' + PORT, 'Content-Type': 'application/json', 'Content-Length': raw ? raw.length : 0 } }, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { var b = Buffer.concat(c); var j = null; try { j = JSON.parse(b.toString()); } catch (_) {} resolve({ status: res.statusCode, body: j }); }); }); r.on('error', reject); if (raw) r.write(raw); r.end(); }); }
  var created = await req('POST', '/api/resolve/confirm', { plate: S + ' TU ' + N, vin: VIN, candidate: { manufacturer: 'PEUGEOT', model: '208', motorisation: '1.2 PURETECH', year: 2019 }, method: 'manual_selection' });
  ok(created.status === 200, 'precondition: the vehicle exists (plate + VIN)');
  var IVID = created.body.vehicle.id;
  var vehiclesBefore = (await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n;
  var recto = ['N D IMMATRICULATION : ' + S + ' TU ' + N, 'MARQUE : PEUGEOT', 'TYPE : 208 1.2 PURETECH', 'GENRE : VP', 'N DE SERIE DU TYPE : ' + VIN, 'ENERGIE : ES', 'D.P.M.C : 12/03/2019', 'NOM : DUPONT TEST', 'ADRESSE : RUE TEST'];
  var UNKNOWN_S = String(100 + Math.floor(Math.random() * 899)), UNKNOWN_N = String(1000 + Math.floor(Math.random() * 8999));
  var rectoUnknown = ['N D IMMATRICULATION : ' + UNKNOWN_S + ' TU ' + UNKNOWN_N, 'MARQUE : SKODA', 'TYPE : FABIA', 'NOM : DUPONT TEST'];

  /* ---------- A. anonymous visitor: plate path ---------- */
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await waitFor('document.readyState === "complete" && !!document.querySelector("[data-cg-home-open]")', 30000); await sleep(500);
  ok(await ev('!document.querySelector("[data-cg-home-open]").hidden'), '1. « Scanner la carte grise » under « Rechercher par carte grise » is visible on the homepage');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), '23. no horizontal overflow at 390px');
  await ev(HELPERS);
  await run('window.__recto = await window.__photograph(window.__makeCard(' + JSON.stringify(recto) + ', 1600, 900), 2800, 2100, 6, 0.05); window.__rectoUnknown = await window.__photograph(window.__makeCard(' + JSON.stringify(rectoUnknown) + ', 1600, 900), 2600, 1950, -4, 0.03);', 60000);
  await ev('document.querySelector("[data-cg-home-open]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-root]").hidden && !!document.querySelector("[data-cg-faces]")', 5000), '2. the scanner dialog opens (mounted from the shared template)');
  ok(await ev('document.querySelector("[data-cg-validate]").disabled === true && document.querySelector("[data-cg-validate]").textContent === "Rechercher le véhicule"'), '3. face 1 mandatory: « Rechercher le véhicule » disabled until face 1');
  ok(await ev('!!document.querySelector("input[data-cg-file=\'1\'][capture=environment]") && document.querySelectorAll("input[data-cg-file=\'1\']").length === 2 && !!document.querySelector("[data-cg-action=paste-1]")'), '5-7. camera, gallery and « Coller (Ctrl+V) » offered');
  await ev('window.__paste(null, "juste du texte")');
  ok(/Aucune image dans le presse-papiers/.test(await ev('document.querySelector("[data-cg-error-title]").textContent')), '8. text-only paste refused');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  await ev('window.__paste(new File([new Uint8Array([9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9])], "x.png", { type: "image/png" }))');
  ok(await waitFor('/Photo illisible/.test(document.querySelector("[data-cg-error-title]").textContent)', 20000), '9. invalid image refused');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  await ev('window.__feed("input[data-cg-file=\'1\']:not([capture])", window.__recto)');
  ok(await waitFor('!document.querySelector("[data-cg-preview-1]").hidden', 60000), '5. face 1 uploaded from the gallery input: preview');
  var meta1 = await ev('document.querySelector("[data-cg-meta-1]").textContent');
  ok(/Carte détectée/.test(meta1), '10-11. Scanic detected the card and corrected the perspective (' + meta1 + ')');
  var kb = parseInt((/(\d+) Ko \(photo/.exec(meta1) || [])[1], 10);
  ok(kb > 20 && kb < 1200, '12. compressed: ' + kb + ' Ko');
  ok(await ev('!document.querySelector("[data-cg-finish-1]").hidden && document.querySelector("[data-cg-finish-1]").textContent === "Rechercher avec la face 1"'), '4. face 2 optional: « Rechercher avec la face 1 » offered');
  await ev('document.querySelector("[data-cg-finish-1]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-home-result]").hidden && !document.querySelector("[data-cg-home-found]").hidden', 240000), '13/15/17. OCR fra+ara → plate → anonymous public lookup → vehicle card');
  ok(await ev('document.querySelector("[data-cg-home-ivid]").textContent') === IVID, 'the card shows the IVID of the right vehicle');
  ok(/PEUGEOT/.test(await ev('document.querySelector("[data-cg-home-make]").textContent')) && /208/.test(await ev('document.querySelector("[data-cg-home-model]").textContent')), 'make and model from the public passport');
  ok(await ev('document.querySelector("[data-cg-home-chassis-row]").hidden'), '20/22. an anonymous visitor never sees a châssis number');
  ok(await ev('document.querySelector("[data-cg-home-passport]").getAttribute("href")') === '/passport?ivid=' + encodeURIComponent(IVID), '18. « Ouvrir le passeport » points at the passport');
  ok(await ev('document.querySelector("[data-cg-root]").hidden'), 'the dialog closed after the search');
  ok(await ev('Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0'), '21. nothing in localStorage / sessionStorage');
  ok(!/DUPONT|RUE TEST/.test(await ev('document.querySelector("[data-cg-home-result]").textContent')), '20. holder lines never reach the card');

  /* ---------- B. anonymous, unknown card → not found, nothing created ---------- */
  await ev('document.querySelector("[data-cg-home-open]").click()'); await sleep(400);
  await ev('window.__feed("input[data-cg-file=\'1\']:not([capture])", window.__rectoUnknown)');
  await waitFor('!document.querySelector("[data-cg-preview-1]").hidden', 60000);
  await ev('document.querySelector("[data-cg-finish-1]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-home-notfound]").hidden', 240000), '19. unknown card → « Véhicule introuvable »');
  ok(new RegExp(UNKNOWN_S + ' TUN ' + UNKNOWN_N).test(await ev('document.querySelector("[data-cg-home-nf-plate]").textContent').then(function (t) { return t.replace(/\s+/g, ' '); }).catch(function () { return ''; })) || /TUN/.test(await ev('document.querySelector("[data-cg-home-nf-plate]").textContent')), 'the plate read is shown as useful data');
  ok(await ev('!document.querySelector("[data-cg-home-nf-plate-link]").hidden && !!document.querySelector("[data-cg-home-nf-chassis-link]") && !!document.querySelector("[data-cg-home-nf-mm-link]")'), 'options offered: validate the plate, search by VIN, search by make/model');
  await ev('document.querySelector("[data-cg-home-nf-plate-link]").click()'); await sleep(300);
  ok(await ev('document.getElementById("plate-serie").value') === UNKNOWN_S && await ev('document.getElementById("plate-numero").value') === UNKNOWN_N, '« Saisir / valider la plaque » prefills the plate form');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n === vehiclesBefore, '19. no vehicle was created by the searches');

  /* ---------- C. signed in: VIN priority through the identify route ---------- */
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/login?next=%2F' });
  await waitFor('document.readyState === "complete" && !!document.querySelector("#login-form")', 60000); await sleep(500);
  await ev('document.querySelector("#login-email").value=' + JSON.stringify(EMAIL) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
  ok(await waitFor('location.pathname === "/" && !!document.querySelector("[data-cg-home-open]")', 30000), '22. signed in, back on the homepage');
  await sleep(500); await ev(HELPERS);
  var rectoVinOnly = ['N DE SERIE DU TYPE : ' + VIN, 'MARQUE : RENAULT', 'TYPE : CLIO', 'NOM : DUPONT TEST'];
  await run('window.__rectoVin = await window.__photograph(window.__makeCard(' + JSON.stringify(rectoVinOnly) + ', 1600, 900), 2600, 1950, 3, 0.02);', 60000);
  await ev('document.querySelector("[data-cg-home-open]").click()'); await sleep(400);
  await ev('window.__feed("input[data-cg-file=\'1\']:not([capture])", window.__rectoVin)');
  await waitFor('!document.querySelector("[data-cg-preview-1]").hidden', 60000);
  await ev('document.querySelector("[data-cg-finish-1]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-home-found]").hidden', 240000), '14. signed-in manager: the VIN alone (make/model of another car) identifies the vehicle');
  ok(/châssis/.test(await ev('document.querySelector("[data-cg-home-by]").textContent')) && await ev('document.querySelector("[data-cg-home-ivid]").textContent') === IVID, 'identified by the châssis number (VIN), right IVID');
  ok(await ev('!document.querySelector("[data-cg-home-chassis-row]").hidden') && await ev('document.querySelector("[data-cg-home-chassis]").textContent') === VIN, 'the manager (vin:search) sees the châssis number on the card');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicle_documents WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1)', [IVID])).rows[0].n === 0, 'a home search stored NO document for the vehicle');
  ok((await db.query('SELECT count(*)::int n FROM idauto_vehicles')).rows[0].n === vehiclesBefore, 'and created nothing');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), '23. still no horizontal overflow at 390px with the result card');

  console.log('IDA-V14 home search browser E2E (headless Chrome, real Scanic + Tesseract, anonymous + signed in): ' + pass + ' passed, ' + fail + ' failed');
  ws.close(); chrome.kill(); server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
