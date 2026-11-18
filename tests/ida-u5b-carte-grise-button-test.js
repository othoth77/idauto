#!/usr/bin/env node
'use strict';
// IDA-U5b / Update 6 — « Ajouter la carte grise » sits next to « Rechercher le véhicule » (VIN search actions), never in
// the identity card; ALWAYS enabled (no search needed: the carte grise is an independent entry point); acts on the vehicle
// of the current successful search when there is one, otherwise the document is received without a vehicle (intake).
// Headless Chrome, desktop and mobile. Scratch database; skipped without Chrome.
var path = require('path'), http = require('http'), crypto = require('crypto'), cp = require('child_process'), fs = require('fs'), os = require('os');
var BASE = path.join(__dirname, '..');
var CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (e) { return false; } })[0];
if (!CHROME) { console.log('IDA-U5b carte grise button: SKIPPED (no Chrome on this host)'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u5b-')); process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_HADDAD_MEDIA_URL; delete process.env.IDAUTO_PUBLIC_CARTE_GRISE;
var db = require(path.join(BASE, 'reference', 'db.js'));
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function get(u) { return new Promise(function (r, j) { http.get(u, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { try { r(JSON.parse(Buffer.concat(c))); } catch (e) { j(e); } }); }).on('error', j); }); }
function freeVin() { var A = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', s = 'VF7'; for (var i = 0; i < 14; i++) s += A[crypto.randomInt(0, A.length)]; return s; }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var run = crypto.randomBytes(3).toString('hex');
  var server = require(path.join(BASE, 'reference', 'api.js')).createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var B = 'http://127.0.0.1:' + server.address().port; process.env.IDAUTO_AUTH_BASE_URL = B;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var PW = 'U5b-' + crypto.randomBytes(6).toString('hex') + '-1', EMAIL = 'u5b-adm-' + run + '@idauto.test';
  var u = await auth.api.signUpEmail({ body: { email: EMAIL, password: PW, name: 'U5b admin' } }); await db.query('UPDATE idauto_auth_user SET "role" = \'admin\' WHERE "id" = $1', [u.user.id]);
  var port = 9500 + Math.floor(Math.random() * 90);
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--user-data-dir=' + path.join(MEDIA, 'chrome'), 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(MEDIA, { recursive: true, force: true }); } catch (e) {} });
  var targets = null; for (var a = 0; a < 40 && !targets; a++) { await sleep(750); try { targets = await get('http://127.0.0.1:' + port + '/json'); } catch (e) {} }
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl), id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(m, p) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); }); }
  async function ev(e) { var r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  async function waitFor(e, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { if (await ev(e)) return true; } catch (x) {} await sleep(250); } return false; }
  async function go(p, ready) { await send('Page.navigate', { url: B + p }); return waitFor('document.readyState === "complete"' + (ready ? ' && (' + ready + ')' : ''), 30000); }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.85.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } });
  await go('/login?next=%2F', '!!document.querySelector("#login-form[data-ready]")');
  await ev('document.querySelector("#login-email").value = ' + JSON.stringify(EMAIL) + '; document.querySelector("#login-password").value = ' + JSON.stringify(PW) + '; document.querySelector("#login-submit").click(); true');
  ok(await waitFor('location.pathname !== "/login"'), 'administrator signed in');
  await go('/', '!!document.querySelector("[data-vin-form]")');
  var S = String(crypto.randomInt(100, 999)), N = String(crypto.randomInt(1000, 9999)), VIN = freeVin();
  var reg = JSON.parse(await ev("fetch('/api/vehicles/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-IDauto-Session': '1' }, body: JSON.stringify({ plate: { type: 'TU', series: '" + S + "', number: '" + N + "' }, vin: '" + VIN + "', make: 'Kia', model: 'Rio' }) }).then(r => r.text())"));
  ok(!!reg.ivid, 'test vehicle registered with a VIN');
  var BTN = 'document.querySelector("[data-cgc-home-open]")';
  async function vinSearch(v) { await ev('(() => { const i = document.querySelector("#q-vin"); i.value = ' + JSON.stringify(v) + '; document.querySelector("[data-vin-submit]").click(); return true; })()'); }

  for (var form of ['desktop', 'mobile']) {
    await send('Emulation.setDeviceMetricsOverride', form === 'mobile' ? { width: 360, height: 780, deviceScaleFactor: 2, mobile: true } : { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await go('/', '!!document.querySelector("[data-vin-form]")');
    ok(await ev('!!' + BTN + ' && ' + BTN + '.closest("[data-vin-form]") && ' + BTN + '.parentElement === document.querySelector("[data-vin-submit]").parentElement'), form + ': « Ajouter la carte grise » is next to « Rechercher le véhicule » (same actions row)');
    ok(await ev('!document.querySelector("[data-plate-result] [data-cgc-home-open]") && document.querySelectorAll("[data-cgc-home-open]").length === 1'), form + ': no carte grise button in the identity card — only one on the page');
    ok(await waitFor('!' + BTN + '.disabled && !document.querySelector("[data-cgc-home-hint]").hidden'), form + ': before any search: ENABLED, with « Le véhicule n\'a pas besoin d\'être déjà enregistré… »');
    await ev(BTN + '.click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-root]").hidden && window.IdaCarteGrise._state.ivid === null'), form + ': with no search, the click opens the upload dialog directly (no vehicle)');
    if (form === 'desktop') {
      var TXT = 'CARTE GRISE U6 ' + run + '\nMarque : PEUGEOT\nالجمهورية التونسية';
      await ev('(() => { document.querySelector("[data-cgc-tab=\'paste\']") && document.querySelector("[data-cgc-tab=\'paste\']").click(); window.IdaCarteGrise._setText(' + JSON.stringify(TXT) + '); return true; })()');
      ok(await waitFor('!document.querySelector("[data-cgc-paste-send]").disabled'), 'desktop: pasted text shows a preview and needs the explicit « Enregistrer »');
      await ev('document.querySelector("[data-cgc-paste-send]").click(); true');
      ok(await waitFor('/attente d.extraction/.test(document.querySelector("[data-cgc-done]").textContent) && !document.querySelector("[data-cgc-open-dossier]")'), 'desktop: saved without a vehicle — « en attente d\'extraction (LENS) puis de vérification »');
      var row = (await db.query("SELECT vehicle_id, intake_status, source_format FROM idauto_vehicle_documents WHERE sha256 = $1", [crypto.createHash('sha256').update(TXT).digest('hex')])).rows[0];
      ok(row && row.vehicle_id === null && row.intake_status === 'pending_extraction' && row.source_format === 'CARTE_GRISE_TEXT', 'desktop: the database holds it with no vehicle, pending_extraction, as text');
    }
    await ev('document.querySelector("[data-cgc-close]").click(); true');
    // Update 6.1 — « Scanner » opens the camera itself, inside this dialog (Chrome's fake camera)
    var CAM = 'window.IdaCarteGrise._cam', LIVE = '(' + CAM + '.stream && ' + CAM + '.stream.getVideoTracks()[0].readyState === "live")';
    await ev(BTN + '.click(); true');
    await waitFor('!document.querySelector("[data-cgc-root]").hidden');
    ok(await ev('!Array.from(document.querySelectorAll("[data-cgc-root] button")).some(b => /Ouvrir le scanner/.test(b.textContent)) && !document.querySelector("[data-cgc-scan]")'), form + ': no second « Ouvrir le scanner » button');
    ok(await ev('!' + LIVE), form + ': opening the dialog does not start the camera by itself');
    await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true');
    ok(await waitFor(LIVE + ' && document.querySelector("[data-cgc-video]").videoWidth > 0 && !document.querySelector("[data-cgc-video]").hidden && !document.querySelector("[data-cgc-cam-live]").hidden'), form + ': ONE click on « Scanner » → live camera preview in the dialog, with « Prendre la photo »');
    ok(await ev('!!document.querySelector("[data-cgc-cam-cancel]") && document.querySelector("[data-cgc-cam-live]").contains(document.querySelector("[data-cgc-switch]"))'), form + ': Annuler present; Changer de caméra shown only with several cameras');
    var since = (await db.query('SELECT NOW() t')).rows[0].t;
    await ev('window.ImageCapture = undefined; true');   // Chrome's fake camera returns the SAME still on every takePhoto(): use the video-frame path so recto and verso differ
    var stale = await ev('(window.__t1 = ' + CAM + '.stream.getVideoTracks()[0], true)');
    await ev('document.querySelector("[data-cgc-capture]").click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-shot]").hidden && window.__t1.readyState === "ended" && !' + CAM + '.stream && ' + CAM + '.blob && ' + CAM + '.blob.size > 1000'), form + ': capture → photo preview, camera stream STOPPED');
    ok(await ev('!document.querySelector("[data-cgc-cam-review]").hidden && !!document.querySelector("[data-cgc-retake]") && !!document.querySelector("[data-cgc-confirm]")'), form + ': « Reprendre » and « Confirmer » offered');
    await ev('document.querySelector("[data-cgc-retake]").click(); true');
    ok(await waitFor(LIVE + ' && document.querySelector("[data-cgc-shot]").hidden'), form + ': « Reprendre » → camera live again');
    var dims = JSON.parse(await ev('JSON.stringify({ w: document.querySelector("[data-cgc-video]").videoWidth, h: document.querySelector("[data-cgc-video]").videoHeight })'));
    await sleep(400 + crypto.randomInt(0, 2500));   // the fake camera restarts its frame counter on every start: a random moment = a different frame
    await ev('document.querySelector("[data-cgc-capture]").click(); true'); await waitFor('!document.querySelector("[data-cgc-cam-review]").hidden && !!' + CAM + '.blob');
    await ev('document.querySelector("[data-cgc-confirm]").click(); true');
    ok(await waitFor('/Recto — Reçu/.test(document.querySelector("[data-cgc-done]").textContent) && document.querySelector("[data-cgc-face]").value === "2"'), form + ': « Confirmer » saves the recto directly (no import step); Face moves to Verso');
    await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true'); await waitFor(LIVE); await sleep(3000);   // a different frame of the fake camera
    await sleep(400 + crypto.randomInt(0, 2500));   // the fake camera restarts its frame counter on every start: a random moment = a different frame
    await ev('document.querySelector("[data-cgc-capture]").click(); true'); await waitFor('!document.querySelector("[data-cgc-cam-review]").hidden && !!' + CAM + '.blob');
    await ev('document.querySelector("[data-cgc-confirm]").click(); true');
    ok(await waitFor('/Verso — Reçu/.test(document.querySelector("[data-cgc-done]").textContent)'), form + ': verso captured and saved separately (« Verso — Reçu… »)');
    var rows = (await db.query("SELECT face, width, height, mime_type, input_method FROM idauto_vehicle_documents WHERE input_method = 'camera' AND vehicle_id IS NULL AND created_at >= $1 ORDER BY id DESC LIMIT 2", [since])).rows;
    ok(rows.length === 2 && rows.some(r => r.face === 1) && rows.some(r => r.face === 2) && rows.every(r => r.mime_type === 'image/jpeg' && r.width === dims.w && r.height === dims.h), form + ': stored recto + verso, JPEG at the camera\'s full frame size (' + dims.w + '×' + dims.h + '; ' + rows.map(r => r.width + '×' + r.height + ' ' + r.mime_type).join(', ') + ')');
    await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true'); await waitFor(LIVE);
    await ev('(window.__t2 = ' + CAM + '.stream.getVideoTracks()[0], true)');
    await ev('document.querySelector("[data-cgc-tab=\'file\']").click(); true');
    ok(await waitFor('window.__t2.readyState === "ended" && !document.querySelector("[data-cgc-pane=\'file\']").hidden && !!document.querySelector("[data-cgc-file]")'), form + ': « Fichier » stops the camera and shows the file picker pane');
    await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true'); await waitFor(LIVE);
    await ev('(window.__t3 = ' + CAM + '.stream.getVideoTracks()[0], true)');
    await ev('document.querySelector("[data-cgc-cam-cancel]").click(); true');
    ok(await waitFor('window.__t3.readyState === "ended" && document.querySelector("[data-cgc-video]").hidden'), form + ': « Annuler » stops the camera');
    await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true'); await waitFor(LIVE);
    await ev('(window.__t4 = ' + CAM + '.stream.getVideoTracks()[0], true)');
    await ev('document.querySelector("[data-cgc-close]").click(); true');
    ok(await waitFor('window.__t4.readyState === "ended"'), form + ': closing the dialog stops the camera');
    if (form === 'desktop') {
      var cases = [['NotAllowedError', /refusé/], ['NotFoundError', /Aucune caméra/], ['NotReadableError', /déjà utilisée/]];
      for (var cz of cases) {
        await ev('(() => { window.__gum = window.__gum || navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("x", ' + JSON.stringify(cz[0]) + ')); return true; })()');
        await ev(BTN + '.click(); true'); await waitFor('!document.querySelector("[data-cgc-root]").hidden');
        await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true');
        ok(await waitFor(cz[1].toString() + '.test(document.querySelector("[data-cgc-cam-msg]").textContent) && /Fichier/.test(document.querySelector("[data-cgc-cam-msg]").textContent)'), 'desktop: ' + cz[0] + ' → clear message, « Fichier » offered');
        await ev('document.querySelector("[data-cgc-close]").click(); true');
      }
      await ev('(() => { window.__md = navigator.mediaDevices; Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); return true; })()');
      await ev(BTN + '.click(); true'); await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true');
      ok(await waitFor('/ne permet pas/.test(document.querySelector("[data-cgc-cam-msg]").textContent)'), 'desktop: unsupported browser → clear message');
      await ev('document.querySelector("[data-cgc-close]").click(); Object.defineProperty(window, "isSecureContext", { value: false, configurable: true }); true');
      await ev(BTN + '.click(); true'); await ev('document.querySelector("[data-cgc-tab=\'scan\']").click(); true');
      ok(await waitFor('/HTTPS/.test(document.querySelector("[data-cgc-cam-msg]").textContent)'), 'desktop: insecure context → « La caméra exige une connexion sécurisée (HTTPS) »');
      await ev('document.querySelector("[data-cgc-tab=\'file\']").click(); true');
      ok(await ev('!document.querySelector("[data-cgc-pane=\'file\']").hidden'), 'desktop: file import stays available after a camera error');
      await ev('document.querySelector("[data-cgc-close]").click(); true');
      await go('/', '!!document.querySelector("[data-vin-form]")');   // a fresh page: real camera API back
    }
    await vinSearch(VIN);
    ok(await waitFor('!document.querySelector("[data-plate-result]").hidden && document.querySelector("[data-result-ivid]").textContent === ' + JSON.stringify(reg.ivid)), form + ': VIN search finds the vehicle (unchanged behaviour)');
    ok(await ev('!' + BTN + '.disabled'), form + ': after a successful search: enabled');
    var geo = JSON.parse(await ev('JSON.stringify((() => { const a = document.querySelector("[data-vin-submit]").getBoundingClientRect(), b = ' + BTN + '.getBoundingClientRect(); return { sameRow: Math.abs(a.top - b.top) < 2, bRight: b.right, aRight: a.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }; })())'));
    if (form === 'desktop') ok(geo.sameRow, 'desktop: both buttons side by side on one row');
    else ok(!geo.overflow && geo.bRight <= geo.width && geo.aRight <= geo.width, 'mobile: both buttons visible, wrapped cleanly, no horizontal overflow');
    await ev(BTN + '.click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-root]").hidden && window.IdaCarteGrise._state.ivid === ' + JSON.stringify(reg.ivid)), form + ': click opens the carte grise upload dialog for THAT vehicle');
    await ev('document.querySelector("[data-cgc-close]").click(); true');
    await vinSearch('WVWZZZ1JZXW000001');
    ok(await waitFor('document.querySelector("[data-plate-result]").hidden && !' + BTN + '.disabled'), form + ': after an unsuccessful search: the previous vehicle is cleared, the button STAYS enabled');
    await ev(BTN + '.click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-root]").hidden && window.IdaCarteGrise._state.ivid === null'), form + ': VIN not found → the click opens the dialog with no vehicle (intake), never the previous one');
    await ev('document.querySelector("[data-cgc-close]").click(); true');
    await ev('(() => { const s = document.querySelector("#plate-serie"), n = document.querySelector("#plate-numero"); s.value = ' + JSON.stringify(S) + '; s.dispatchEvent(new Event("input", { bubbles: true })); n.value = ' + JSON.stringify(N) + '; n.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-plate-form]").requestSubmit(); return true; })()');
    ok(await waitFor('!' + BTN + '.disabled && document.querySelector("[data-result-ivid]").textContent === ' + JSON.stringify(reg.ivid)), form + ': a successful plate search: still enabled, acting on that vehicle');
  }
  // Update 6 — the administrator's review screen for a carte grise received without a vehicle
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go('/admin/cartes-grises', '!!document.querySelector("#list tbody")');
  ok(await waitFor('Array.from(document.querySelectorAll("#list tbody tr")).some(r => /Texte collé/.test(r.textContent) && /En attente d.extraction/.test(r.textContent))'), 'admin: /admin/cartes-grises lists the pasted carte grise, pending extraction');
  await ev('Array.from(document.querySelectorAll("#list tbody tr")).find(r => /Texte collé/.test(r.textContent)).querySelector("[data-open]").click(); true');
  ok(await waitFor('!document.querySelector("#review").hidden && /CARTE GRISE U6 ' + run + '/.test((document.querySelector("pre[data-intake-preview]") || {}).textContent || "") && document.querySelectorAll("#review-fields input").length === 9'), 'admin: review shows the original text and the nine editable technical fields');
  ok(await ev('/absent ou illisible/.test(document.querySelector("#review-match").textContent)'), 'admin: no VIN → « aucun véhicule ne sera créé » (case C)');
  await ev('window.confirm = () => true; document.querySelector("[data-action=create]").click(); true');
  ok(await waitFor('/Sans numéro de châssis, aucun véhicule/.test(document.querySelector("#review-status").textContent)'), 'admin: « Créer le véhicule » without a VIN is refused, with the reason');
  await ev('document.querySelector("[data-action=unassigned]").click(); true');
  ok(await waitFor('/^Document gardé non rattaché/.test(document.querySelector("#review-status").textContent)'), 'admin: « Garder non rattaché » → « Document gardé non rattaché. »');
  ok((await db.query("SELECT intake_status, vehicle_id, resolved_by FROM idauto_vehicle_documents WHERE sha256 = $1", [crypto.createHash('sha256').update(TXT).digest('hex')])).rows.every(function (r) { return r.intake_status === 'unassigned' && r.vehicle_id === null && !!r.resolved_by; }), 'admin: the database says unassigned, no vehicle, decided by the administrator');
  ok(await ev('document.documentElement.scrollWidth <= innerWidth'), 'admin: no horizontal overflow');
  await send('Page.captureScreenshot', { format: 'png' }).then(function (r) { if (process.env.IDAUTO_SHOTS) fs.writeFileSync(path.join(process.env.IDAUTO_SHOTS, 'admin-intake.png'), Buffer.from(r.result.data, 'base64')); });

  console.log('\nIDA-U5b carte grise button: ' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
