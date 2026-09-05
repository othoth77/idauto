'use strict';
/* IDA-V14 — carte grise in a real (headless) Chrome: the atelier button, the
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
if (!CHROME || typeof WebSocket === 'undefined') { console.log('IDA-V14 carte grise browser: SKIPPED (no Chrome) — 0 passed, 0 failed'); process.exit(0); }
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
  await send('Network.enable'); await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.77.11.' + (1 + crypto.randomBytes(1)[0] % 250) } });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  // Sign in through the form.
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/login?next=%2Fatelier' });
  await waitFor('document.readyState === "complete" && !!document.querySelector("#login-form")', 60000); await sleep(500);
  await ev('document.querySelector("#login-email").value=' + JSON.stringify(EMAIL) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
  var signedIn = await waitFor('location.pathname === "/atelier" && !!document.querySelector("#at-serie")', 30000);
  if (!signedIn) await loginDebug('v14 first login');
  ok(signedIn, '1. signed in, /atelier open');
  // Identify a vehicle by manual selection so the fiche (and its buttons) exist.
  await ev('document.querySelector("#at-serie").value=' + JSON.stringify(S) + ';document.querySelector("#at-numero").value=' + JSON.stringify(N) + ';document.querySelector("[data-action=resolve-plate]").click()');
  await waitFor('document.querySelector("[data-panel=identify]").getAttribute("data-state") === "not_found"', 20000);
  await ev('document.querySelector("#at-make").value="PEUGEOT";document.querySelector("#at-model").value="208";document.querySelector("#at-year").value="2019";document.querySelector("[data-action=resolve-manual]").click()');
  await waitFor('!document.querySelector("[data-ident-candidate]").hidden', 20000);
  await ev('document.querySelector("[data-action=confirm-candidate]").click()');
  ok(await waitFor('!document.querySelector("[data-panel=fiche]").hidden', 20000), 'fiche shown for the identified vehicle');
  await waitFor('/carte grise/i.test(document.querySelector("[data-document-status]").textContent)', 10000);
  ok(await ev('!!document.querySelector("[data-action=scan-registration]") && !!document.querySelector("[data-action=open-passport]")'), '2. « Scanner la carte grise » sits beside « Ouvrir le passeport »');
  ok(/Aucune carte grise/.test(await ev('document.querySelector("[data-document-status]").textContent')), 'document status: none yet');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow at 390px');

  // Draw a synthetic card, then "photograph" it: rotated, skewed, on a dark background, at phone-like resolution.
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
  await ev(HELPERS);
  var recto = ['N D IMMATRICULATION : ' + S + ' TU ' + N, 'MARQUE : PEUGEOT', 'TYPE : 208 1.2 PURETECH', 'GENRE : VP', 'N DE SERIE DU TYPE : ' + VIN, 'ENERGIE : ES', 'NOMBRE DE PLACES : 05', 'CYLINDREE : 1199', 'D.P.M.C : 12/03/2019', 'NOM : DUPONT TEST', 'ADRESSE : RUE TEST'];
  var verso = ['POIDS TOTAL : 1560', 'TYPE MOTEUR : HM01'];
  await run('window.__recto = await window.__photograph(window.__makeCard(' + JSON.stringify(recto) + ', 1600, 900), 3000, 2250, 7, 0.06); window.__verso = await window.__photograph(window.__makeCard(' + JSON.stringify(verso) + ', 1600, 900), 2800, 2100, -5, -0.04);', 60000);
  var sizes = await ev('[window.__recto.size, window.__verso.size].join(",")');
  ok(sizes.split(',').every(function (s) { return Number(s) > 100000; }), 'synthetic "phone photos" are large (' + sizes + ' bytes)');

  await ev('document.querySelector("[data-action=scan-registration]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-root]").hidden', 5000), '3. the dialog opens');
  ok(await ev('document.querySelector("[data-cg-validate]").disabled === true'), 'Valider is disabled until face 1 exists');
  ok(await ev('!!document.querySelector("input[data-cg-file=\'1\'][capture=environment]") && document.querySelectorAll("input[data-cg-file=\'1\']").length === 2'), 'face 1 offers camera (capture=environment) and gallery inputs');
  // Face 2 before face 1 is refused in the UI.
  await ev('window.__feed("input[data-cg-file=\'2\']:not([capture])", window.__verso)'); await sleep(500);
  ok(/Face 1 d'abord/.test(await ev('document.querySelector("[data-cg-error-title]").textContent')), 'face 2 before face 1 is refused with a clear message');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  ok(await ev('!!document.querySelector("[data-cg-action=paste-1]") && !!document.querySelector("[data-cg-action=paste-2]")'), 'each face offers « Coller (Ctrl+V) » beside camera and gallery');
  // --- clipboard: text only → refused
  await ev('window.__paste(null, "ceci est du texte")');
  ok(/Aucune image dans le presse-papiers/.test(await ev('document.querySelector("[data-cg-error-title]").textContent')) && /texte/.test(await ev('document.querySelector("[data-cg-error-body]").textContent')), 'paste of text only is refused with a clear message');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  // --- clipboard: paste to face 2 before face 1 → refused
  await ev('document.querySelector("[data-cg-action=paste-2]").click()'); await sleep(300);
  ok(/Face 1 d'abord/.test(await ev('document.querySelector("[data-cg-error-title]").textContent')), 'paste into face 2 before face 1 is refused');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  // --- clipboard: an "image" whose bytes are not an image → refused
  await ev('window.__paste(new File([new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16])], "x.png", { type: "image/png" }))');
  ok(await waitFor('/Photo illisible/.test(document.querySelector("[data-cg-error-title]").textContent) && !document.querySelector("[data-cg-error]").hidden', 20000), 'paste of an invalid image is refused (« Photo illisible »)');
  await ev('document.querySelector("[data-cg-error-close]").click()'); await sleep(300);
  // --- clipboard: face 1 pasted (Ctrl+V with no face chosen → first empty face)
  ok(await ev('window.__paste(window.__recto)') === true, 'Ctrl+V with an image is consumed by the dialog');
  ok(await waitFor('!document.querySelector("[data-cg-preview-1]").hidden', 60000), '4-5. face 1 (pasted) processed: preview shown');
  var meta1 = await ev('document.querySelector("[data-cg-meta-1]").textContent');
  ok(/Carte détectée|Recadrage manuel/.test(meta1), 'detection result reported: ' + meta1);
  var kb1 = parseInt((/(\d+) Ko \(photo/.exec(meta1) || [])[1], 10);
  ok(kb1 > 20 && kb1 < 1200, 'optimised face 1 is compact: ' + kb1 + ' Ko');
  ok(await ev('!document.querySelector("[data-cg-finish-1]").hidden && !document.querySelector("[data-cg-validate]").disabled'), '« Terminer avec la face 1 » offered — face 2 optional');
  await ev('document.querySelector("[data-cg-action=paste-2]").click()'); await sleep(400);
  await ev('window.__paste(window.__verso)');
  ok(await waitFor('!document.querySelector("[data-cg-preview-2]").hidden', 60000), '6-7. face 2 (pasted via « Coller ») processed: both previews shown');
  ok(/Ko \(photo/.test(await ev('document.querySelector("[data-cg-meta-2]").textContent')), 'the pasted verso went through the same optimisation (sizes reported)');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'dialog fits the 390px viewport');

  await ev('document.querySelector("[data-cg-validate]").click()');
  var gotResult = await waitFor('!document.querySelector("[data-cg-result]").hidden || !document.querySelector("[data-cg-error]").hidden', 240000);
  ok(gotResult && await ev('!document.querySelector("[data-cg-result]").hidden'), '8. upload + OCR (fra+ara, in a worker) + analysis reached the proposal table');
  var rows = await ev('Array.from(document.querySelectorAll("[data-cg-result-rows] tr")).map(function (r) { return r.children[0].textContent + "=" + r.children[1].textContent + "|" + r.children[2].textContent; }).join(";")');
  console.log('     proposal: ' + rows);
  ok(/Marque=PEUGEOT\|identique/.test(rows), 'OCR read the make and found it identical');
  ok(/VIN=/.test(rows) && rows.indexOf(VIN) !== -1, 'OCR read the 17-character VIN');
  ok(/Modèle \/ type=.*\|conflit/.test(rows), 'the model differs from the fiche → shown as a conflict, unchecked');
  ok(rows.indexOf('DUPONT') === -1 && rows.indexOf('RUE TEST') === -1, 'holder lines never reach the proposal');
  ok(await ev('!document.querySelector("[data-cg-accept=model]").checked'), 'a conflicting field is NOT pre-accepted');
  await ev('document.querySelector("[data-cg-action=confirm]").click()');
  ok(await waitFor('document.querySelector("[data-cg-root]").hidden', 30000), 'confirmation closes the dialog');
  await sleep(1200);
  ok(/Carte grise enregistrée/.test(await ev('document.querySelector("[data-fiche-status]").textContent')), '« Carte grise enregistrée. »');
  var fiche = await ev('document.querySelector("[data-fiche-fields]").textContent');
  ok(fiche.indexOf('208') !== -1 && fiche.indexOf('PURETECH') === -1 && /carte_grise_ocr/.test(fiche), 'the fiche keeps the model (conflict) and shows source carte_grise_ocr');
  ok(/face 1 \+ face 2/.test(await ev('document.querySelector("[data-document-status]").textContent')), 'document status: face 1 + face 2');

  // Passport section (signed in).
  var ivid = decodeURIComponent(await ev('document.querySelector("[data-passport-link]").getAttribute("href").split("ivid=")[1]'));
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/passport?ivid=' + ivid }); await sleep(3000);
  ok(await waitFor('!!document.querySelector("[data-passport-document]")', 15000), '9. the passport shows the « Carte grise » section');
  ok(await ev('document.querySelectorAll("[data-passport-face]").length === 2'), 'both faces displayed');
  ok(await waitFor('Array.from(document.querySelectorAll("[data-passport-face] img")).every(function (i) { return i.src.indexOf("blob:") === 0 && i.naturalWidth > 0; })', 15000), 'thumbnails loaded as blob: URLs (no server path)');
  ok(/Informations extraites/.test(await ev('document.querySelector("[data-passport-document]").textContent')), 'extracted information listed');
  await send('Page.reload'); await sleep(3000);
  ok(await waitFor('document.querySelectorAll("[data-passport-face]").length === 2', 15000), '10-11. after a reload both faces are still there');
  ok(await ev('Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0'), 'nothing in localStorage / sessionStorage');
  // The anonymous passport (no cookie) shows no document.
  await send('Network.enable'); await send('Network.clearBrowserCookies');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/passport?ivid=' + ivid }); await sleep(3000);
  ok(await ev('!document.querySelector("[data-passport-document]")'), 'a visitor without a session sees no « Carte grise » section');

  // Face 1 only + replacement + deletion, via the API of this same signed-in user.
  var s2 = await auth.api.signInEmail({ body: { email: EMAIL, password: PW }, returnHeaders: true });
  var cookie = String(s2.headers.get('set-cookie')).split(';')[0];
  function req(method, p, raw, ct) { return new Promise(function (resolve, reject) { var r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method: method, headers: { Cookie: cookie, 'X-IDauto-Session': '1', Origin: 'http://127.0.0.1:' + PORT, 'Content-Type': ct || 'application/octet-stream', 'Content-Length': raw ? raw.length : 0 } }, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { var b = Buffer.concat(c); var j = null; try { j = JSON.parse(b.toString()); } catch (_) {} resolve({ status: res.statusCode, body: j }); }); }); r.on('error', reject); if (raw) r.write(raw); r.end(); }); }
  var base = '/api/vehicles/' + encodeURIComponent(ivid) + '/registration-document';
  var del2 = await req('DELETE', base + '/2'); var afterDel = await req('GET', base);
  if (del2.status !== 200 || !afterDel.body) console.log('     DEBUG delete:', del2.status, JSON.stringify(del2.body), '| get:', afterDel.status, JSON.stringify(afterDel.body));
  ok(del2.status === 200 && afterDel.body && afterDel.body.faces[2] === null, '12. face 2 removed → face 1 only remains');
  var face1 = await req('GET', base);
  if (!face1.body) { console.log('     DEBUG get:', face1.status); face1.body = { faces: { 1: null } }; }
  ok(face1.body.faces[1] && face1.body.faces[1].capture && /auto|manual/.test(face1.body.faces[1].capture.detection) && face1.body.faces[1].original_byte_size > face1.body.faces[1].byte_size, 'stored metadata: detection mode, and the original was larger than what is stored');
  var beforeSha = face1.body.faces[1].sha256;
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/login?next=%2Fatelier' });
  await waitFor('document.readyState === "complete" && !!document.querySelector("#login-form")', 60000); await sleep(500);
  await ev('document.querySelector("#login-email").value=' + JSON.stringify(EMAIL) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
  await waitFor('location.pathname === "/atelier" && !!document.querySelector("#at-serie")', 20000);
  await ev('document.querySelector("#at-serie").value=' + JSON.stringify(S) + ';document.querySelector("#at-numero").value=' + JSON.stringify(N) + ';document.querySelector("[data-action=resolve-plate]").click()');
  await waitFor('!document.querySelector("[data-panel=fiche]").hidden', 20000);
  await ev('document.querySelector("[data-action=scan-registration]").click()'); await sleep(500);
  await ev(HELPERS);   // the page was reloaded: re-install the synthetic-card helpers
  await run('window.__recto2 = await window.__photograph(window.__makeCard(' + JSON.stringify(recto) + ', 1500, 850), 2600, 1950, 3, 0.02); window.__feed("input[data-cg-file=\'1\']:not([capture])", window.__recto2);', 60000);
  ok(await waitFor('!document.querySelector("[data-cg-preview-1]").hidden', 60000), '13. a new face 1 is captured (replacement)');
  await ev('document.querySelector("[data-cg-finish-1]").click()');
  ok(await waitFor('!document.querySelector("[data-cg-result]").hidden || !document.querySelector("[data-cg-error]").hidden', 240000), 'face 1 alone is processed through OCR');
  await ev('(document.querySelector("[data-cg-action=skip]") || document.querySelector("[data-cg-error-close]")).click()'); await sleep(1500);
  var after = await req('GET', base);
  ok(after.body.faces[1] && after.body.faces[1].sha256 !== beforeSha && after.body.faces[2] === null, 'face 1 replaced (new sha256), face 2 still absent');
  ok((await req('DELETE', base + '/1')).status === 200 && (await req('GET', base)).body.has_document === false, '14. manager deletes face 1 → no document');
  var bad = await req('PUT', base + '/1', Buffer.from('%PDF-1.4 not an image'), 'image/jpeg');
  ok(bad.status === 415, 'a non-image file is refused (415)');

  console.log('IDA-V14 carte grise browser E2E (headless Chrome, real Scanic + Tesseract on a synthetic card, gallery + clipboard): ' + pass + ' passed, ' + fail + ' failed');
  ws.close(); chrome.kill(); server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
