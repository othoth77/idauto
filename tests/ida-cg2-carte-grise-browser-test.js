'use strict';
/* IDA-CG2 stage 5 — carte grise V2 end to end in a real (headless) Chrome over the DevTools protocol.
 *
 *   manager signs in → /atelier/carte-grise → new card → face 1 + face 2 (SYNTHETIC cards drawn on a
 *   canvas, holder lines included) → real OCR (Tesseract fra+ara, vendored) → every field reviewed in the
 *   page (confirm / correct / absent) → match → "none" → create → IVID → the same card again → "existing"
 *   → link (nothing overwritten) → an admin opens the vehicle file and sees both ORIGINAL faces →
 *   a third card whose faces disagree on the make → a conflict, resolved by a correction → rejected.
 *   Mobile width (390 px): no horizontal overflow.
 *
 * Synthetic cards only — no real document, no personal data. Needs google-chrome/chromium on PATH and a
 * scratch database; without Chrome it reports SKIPPED. Node 22 global WebSocket, no dependency.
 */
var http = require('http'); var cp = require('child_process'); var crypto = require('crypto'); var path = require('path');
var BASE = path.join(__dirname, '..');
var CHROME = ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME || typeof WebSocket === 'undefined') { console.log('IDA-CG2 carte grise browser: SKIPPED (no Chrome or no global WebSocket) — 0 passed, 0 failed'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
var db = require(path.join(BASE, 'reference', 'db.js'));
var CDP = 9650 + Math.floor(Math.random() * 120);
function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { r(JSON.parse(Buffer.concat(c).toString())); }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
var VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function vin() { var s = 'VF3'; for (var i = 0; i < 14; i++) s += VIN_CHARS[crypto.randomInt(VIN_CHARS.length)]; return s; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier CG2 ' + run])).rows[0].id;
  var server = require(path.join(BASE, 'reference', 'api.js')).createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var PORT = server.address().port, B = 'http://127.0.0.1:' + PORT;
  process.env.IDAUTO_AUTH_BASE_URL = B;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var PW = 'Cg2-Browser-' + crypto.randomBytes(6).toString('hex') + '-1';
  var users = { manager: 'cg2-mgr-' + run.toLowerCase() + '@idauto.test', admin: 'cg2-adm-' + run.toLowerCase() + '@idauto.test' };
  for (var role of ['manager', 'admin']) { var u = await auth.api.signUpEmail({ body: { email: users[role], password: PW, name: role + ' ' + run } }); await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, role === 'admin' ? null : ORG, u.user.id]); }
  var S = crypto.randomInt(100, 999), N = crypto.randomInt(1000, 9999);
  while ((await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [S + ' TUN ' + N])).rows.length) { S = crypto.randomInt(100, 999); N = crypto.randomInt(1000, 9999); }
  // The make is printed on the synthetic card and read back by OCR: letters only, none that OCR
  // confuses with a digit (hex « 16 » was read « IG » once, 2026-11-05).
  var MAKE = 'CGB' + Array.from(crypto.randomBytes(6)).map(function (b) { return 'ACEHKMNPRTUVWXY'[b % 15]; }).join('');
  var PLATE = S + ' TUN ' + N, VIN = vin();
  var HOLDER = 'TESTHOLDER' + run;

  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + CDP, '--window-size=1280,1000', '--user-data-dir=/tmp/idauto-cg2-e2e-' + process.pid, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} });
  var targets = null;
  for (var attempt = 0; attempt < 30 && !targets; attempt++) { await sleep(1000); try { targets = await get('http://127.0.0.1:' + CDP + '/json'); } catch (e) { targets = null; } }
  if (!targets) throw new Error('Chrome did not open its DevTools port');
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl); var id = 0, pending = {}, errors = [], dialogs = [];
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text);
    // Setting the VIN aside asks for a reason (window.prompt): the test answers it like an operator.
    if (d.method === 'Page.javascriptDialogOpening') { dialogs.push(d.params.message); ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText: 'carte de test sans VIN lisible' } })); } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  async function waitFor(expr, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(300); } return false; }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  async function signIn(email, next) {
    await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.82.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } });
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: B + '/login?next=' + encodeURIComponent(next) });
    await waitFor('document.readyState === "complete" && !!document.querySelector("#login-form")', 30000); await sleep(300);
    await ev('document.querySelector("#login-email").value=' + JSON.stringify(email) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
    // Landed AND ready: the page's script has bound its handlers and finished its session check
    // (under heavy host I/O a click sent before that is lost — found 2026-11-05).
    return waitFor('location.pathname === ' + JSON.stringify(next) + ' && document.readyState === "complete" && !/Vérification de la session/.test((document.getElementById("session-line") || {}).textContent || "")', 45000);
  }
  var HELPERS = 'window.__card = function (lines) { var c = document.createElement("canvas"); c.width = 1700; c.height = 1100; var x = c.getContext("2d");' +
    ' x.fillStyle = "#f4efe2"; x.fillRect(0, 0, 1700, 1100); x.fillStyle = "#151515"; x.font = "bold 46px sans-serif"; x.fillText("CERTIFICAT D IMMATRICULATION", 70, 100);' +
    ' x.font = "40px sans-serif"; lines.forEach(function (l, i) { x.fillText(l, 70, 190 + i * 70); });' +
    ' return new Promise(function (res) { c.toBlob(function (b) { res(new File([b], "face.png", { type: "image/png" })); }, "image/png"); }); };' +
    ' window.__hash = function (file) { return file.arrayBuffer().then(function (b) { return crypto.subtle.digest("SHA-256", b); }).then(function (h) { return Array.from(new Uint8Array(h)).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }); };' +
    ' window.__feed = function (face, file) { window.__sent = window.__sent || {}; window.__hash(file).then(function (h) { window.__sent[face] = h; }); var input = document.querySelector("[data-file=\\"" + face + "\\"]"); var dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); }; true';
  function recto(make) { return ['N D IMMATRICULATION : ' + S + ' TU ' + N, 'MARQUE : ' + make, 'TYPE : 208', 'NOM : ' + HOLDER, 'ADRESSE : 12 RUE DU TEST', 'D.P.M.C : 12/03/2019', 'ENERGIE : ESSENCE']; }
  function verso(extra) { return ['N DE SERIE : ' + VIN, 'CYLINDREE : 1199', 'NOMBRE DE PLACES : 5'].concat(extra || []); }
  var STATE = '(function(){var r=Array.from(document.querySelectorAll("#fields tbody tr")).map(function(tr){return {key:tr.getAttribute("data-key"),status:tr.children[4].textContent,value:tr.children[1].textContent}});return {rows:r,status:document.getElementById("sub-line").textContent}})()';

  // One full card through the page. `review` decides per row what an operator would do.
  async function oneCard(make, versoExtra) {
    await ev('document.getElementById("new-submission").click()');
    ok(await waitFor('/ref=cgs_[0-9a-f]{24}/.test(location.search) && !document.getElementById("work").hidden', 15000), 'a new card opens its own submission (' + make + ')');
    await ev(HELPERS);
    await ev('window.__card(' + JSON.stringify(recto(make)) + ').then(function (f) { window.__feed(1, f); return true; })');
    await waitFor('/Version 1/.test(document.querySelector("[data-face-status=\\"1\\"]").textContent)', 20000);
    await ev('window.__card(' + JSON.stringify(verso(versoExtra)) + ').then(function (f) { window.__feed(2, f); return true; })');
    var both = await waitFor('/Version 1/.test(document.querySelector("[data-face-status=\\"2\\"]").textContent) && !!document.querySelector("[data-preview=\\"1\\"] img") && !!document.querySelector("[data-preview=\\"2\\"] img")', 20000);
    ok(both, 'both faces uploaded, previews shown, each "Version 1 … (originale)"');
    var same = await ev('(function(){var ref=/ref=(cgs_[0-9a-f]{24})/.exec(location.search)[1];return fetch("/api/registration-submissions/"+ref,{credentials:"same-origin",headers:{"X-IDauto-Session":"1"}}).then(function(r){return r.json()}).then(function(d){return d.faces[1].sha256===window.__sent[1] && d.faces[2].sha256===window.__sent[2]})})()');
    ok(same, 'the server stored exactly the bytes of the photo chosen (same SHA-256): the original, not a compressed copy');
    await ev('document.getElementById("run-ocr").click()');
    var read = await waitFor('/Lecture terminée : \\d+ information/.test(document.getElementById("ocr-result").textContent)', 240000);
    ok(read, 'real OCR on both faces (Tesseract fra+ara, two passes) — the page states how many fields were read (' + (await ev('document.getElementById("ocr-result").textContent')).slice(0, 70) + ')');
    return read;
  }
  async function reviewAll(opts) {
    opts = opts || {};
    for (var guard = 0; guard < 30; guard++) {
      var s = await ev(STATE);
      var todo = s.rows.filter(function (r) { return !/Confirmé|Corrigé|Illisible|Absent de la carte/.test(r.status); })[0];
      if (!todo) return true;
      var act;
      if (todo.key === 'vin') act = { a: 'correct', v: VIN };
      else if (todo.key === 'registration' && !/Lu/.test(todo.status)) act = { a: 'correct', v: S + ' TU ' + N };
      else if (opts.correct && opts.correct[todo.key] && !/Lu — à vérifier/.test(todo.status)) act = { a: 'correct', v: opts.correct[todo.key] };
      else if (/Lu — à vérifier/.test(todo.status)) act = { a: 'confirm' };
      else act = { a: 'not_present' };
      var sel = '#fields tr[data-key="' + todo.key + '"]';
      if (act.a === 'correct') await ev('(function(){var i=document.querySelector(' + JSON.stringify(sel + ' input') + ');i.value=' + JSON.stringify(act.v) + ';document.querySelector(' + JSON.stringify(sel + ' [data-action=correct]') + ').click();return true})()');
      else await ev('document.querySelector(' + JSON.stringify(sel + ' [data-action=' + act.a + ']') + ').click()');
      await waitFor('(function(){var tr=document.querySelector(' + JSON.stringify(sel) + ');return tr && /Confirmé|Corrigé|Illisible|Absent de la carte/.test(tr.children[4].textContent)})()', 10000);
    }
    return false;
  }

  console.log('\n== 1280 px — manager');
  ok(await signIn(users.manager, '/atelier/carte-grise'), 'the manager signs in and lands on /atelier/carte-grise');
  await oneCard(MAKE);
  var s1 = await ev(STATE);
  var reg = s1.rows.filter(function (r) { return r.key === 'registration'; })[0];
  ok(reg && reg.value.indexOf(PLATE) !== -1, 'the registration number is read and normalised: ' + (reg && reg.value));
  ok((await ev('document.body.textContent')).indexOf(HOLDER) === -1 && (await ev('document.body.textContent')).indexOf(VIN) === -1, 'no holder name and no VIN value on the page');
  ok(await ev('document.getElementById("run-match").disabled === false') && !(await ev('!!Array.from(document.querySelectorAll("#match button")).find(function(b){return /Créer/.test(b.textContent)})')), 'no create button before a search');
  ok(await reviewAll(), 'every field reviewed in the page (confirmed, corrected or marked absent)');
  ok(await waitFor('/Toutes les informations sont vérifiées/.test(document.getElementById("checks").textContent)', 10000), 'the page states that every field is verified');
  await ev('document.getElementById("run-match").click()');
  ok(await waitFor('/Aucun véhicule/.test(document.getElementById("match").textContent)', 15000), 'search: no vehicle known');
  await ev('Array.from(document.querySelectorAll("#match button")).find(function(b){return /Créer le véhicule/.test(b.textContent)}).click()');
  ok(await waitFor('/Véhicule créé : ivid:1:/.test(document.getElementById("status").textContent)', 20000), 'create → « Véhicule créé : ivid:1:… »');
  var created = (await db.query("SELECT v.ivid, v.make, v.engine_cc FROM idauto_plates p JOIN idauto_vehicles v ON v.id = p.vehicle_id WHERE p.plate_number = $1 AND p.status = 'active'", [PLATE])).rows;
  ok(created.length === 1 && created[0].make === MAKE && created[0].engine_cc === 1199, 'one vehicle in the database with the reviewed data, IVID ' + (created[0] && created[0].ivid));
  var IVID = created[0] && created[0].ivid;

  // The same card again: existing → link, nothing to fill, no duplicate.
  await send('Page.navigate', { url: B + '/atelier/carte-grise' }); await waitFor('document.readyState === "complete" && !!document.getElementById("new-submission")', 15000); await sleep(500);
  await oneCard(MAKE);
  await reviewAll();
  await ev('document.getElementById("run-match").click()');
  ok(await waitFor('/Véhicule trouvé/.test(document.getElementById("match").textContent) && document.getElementById("match").textContent.indexOf(' + JSON.stringify(IVID) + ') !== -1', 15000), 'the same card again: « Véhicule trouvé », the IVID shown');
  ok(!(await ev('!!Array.from(document.querySelectorAll("#match button")).find(function(b){return /Créer le véhicule/.test(b.textContent)})')), 'no create button when the vehicle exists');
  await ev('Array.from(document.querySelectorAll("#match button")).find(function(b){return /Rattacher/.test(b.textContent)}).click()');
  ok(await waitFor('/Carte rattachée à ivid:1:/.test(document.getElementById("status").textContent)', 20000), 'linked to the existing vehicle');
  ok((await db.query("SELECT count(DISTINCT vehicle_id)::int n FROM idauto_plates WHERE plate_number = $1", [PLATE])).rows[0].n === 1, 'still one vehicle for this plate');

  // A third card whose faces disagree on the make.
  await send('Page.navigate', { url: B + '/atelier/carte-grise' }); await waitFor('document.readyState === "complete" && !!document.getElementById("new-submission")', 15000); await sleep(500);
  await oneCard(MAKE, ['MARQUE : AUTREMARQUE']);
  var s3 = await ev(STATE);
  var mk = s3.rows.filter(function (r) { return r.key === 'manufacturer'; })[0];
  ok(mk && /ne concordent pas/.test(mk.status) && /AUTREMARQUE/.test(mk.value), 'faces that disagree on the make → « Les faces ne concordent pas », both readings shown');
  ok(await reviewAll({ correct: { manufacturer: MAKE } }), 'the conflict is resolved by a correction');
  ok(await ev('document.querySelector("#fields tr[data-key=manufacturer]").children[4].textContent') === 'Corrigé', 'the make is « Corrigé »');
  await ev('document.getElementById("reject-reason").value = "doublon de test"; document.getElementById("reject").click()');
  ok(await waitFor('/Rejeté/.test(document.getElementById("decision").textContent)', 15000), 'rejected: closed, no vehicle');
  ok(errors.length === 0, 'no page error (' + errors.join(' | ').slice(0, 200) + ')');

  console.log('\n== 390 px');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: B + '/atelier/carte-grise' }); await waitFor('document.readyState === "complete" && !!document.getElementById("list")', 15000); await sleep(800);
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow at 390 px (list)');
  await ev('document.querySelector("#list a").click()'); await waitFor('!document.getElementById("work").hidden', 10000); await sleep(800);
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow at 390 px (a card, its faces and fields)');

  console.log('\n== admin — the vehicle file');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  ok(await signIn(users.admin, '/admin/dashboard'), 'an admin signs in');
  await send('Page.navigate', { url: B + '/admin/vehicle?ref=' + encodeURIComponent(IVID) });
  ok(await waitFor('document.querySelectorAll("#documents img.ida-admin-cg-image").length >= 4', 25000), 'the vehicle file shows both faces of its two cartes grises');
  ok(/Cartes grises vérifiées \(2\)/.test(await ev('document.getElementById("documents").textContent')) && /\(originale\)/.test(await ev('document.getElementById("documents").textContent')), '« Cartes grises vérifiées (2) », sizes of the originals');
  var other = await ev('fetch("/api/registration-submissions", {credentials:"same-origin",headers:{"X-IDauto-Session":"1"}}).then(function(r){return r.json()}).then(function(d){return d.submissions.length})');
  ok(other >= 3, 'the admin sees every organisation\'s submissions (' + other + ')');

  ws.close(); chrome.kill('SIGKILL'); server.close(); await db.closePool();
  console.log('\nIDA-CG2 carte grise browser (headless Chrome, real OCR, synthetic cards): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FATAL ' + (e && e.stack || e)); process.exit(1); });
