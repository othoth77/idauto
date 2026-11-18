#!/usr/bin/env node
'use strict';
// IDA-U5.1 — the carte grise under the vehicle identity, in a real headless Chrome: status from the database (A / B),
// Scanner = live camera at once (fake camera feed showing a card) → capture → retake → confirm, file import (picker at
// once, PDF preview), clipboard (direct read, Ctrl+V fallback, text refused), camera refusal → import, explicit new
// version, visitor sees the status only. Desktop and mobile widths. Scratch database; skipped without Chrome.
var path = require('path'), http = require('http'), crypto = require('crypto'), cp = require('child_process'), fs = require('fs'), os = require('os');
var BASE = path.join(__dirname, '..');
var CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (e) { return false; } })[0];
if (!CHROME) { console.log('IDA-U5.1 carte grise browser: SKIPPED (no Chrome on this host)'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'idauto-u51-media-')); process.env.IDAUTO_MEDIA_STORAGE_PATH = MEDIA;
delete process.env.IDAUTO_HADDAD_MEDIA_URL; delete process.env.IDAUTO_PUBLIC_CARTE_GRISE;
var db = require(path.join(BASE, 'reference', 'db.js'));
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function get(u) { return new Promise(function (r, j) { http.get(u, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { try { r(JSON.parse(Buffer.concat(c))); } catch (e) { j(e); } }); }).on('error', j); }); }

// a fake camera feed (Y4M, 4:2:0): a light card on a dark table — what pointing a phone at a carte grise looks like
function y4m(file) {
  var W = 640, H = 360, frames = 10, head = Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F10:1 Ip A1:1 C420jpeg\n'), parts = [head];
  for (var f = 0; f < frames; f++) {
    var Y = Buffer.alloc(W * H, 40), U = Buffer.alloc(W * H / 4, 128), V = Buffer.alloc(W * H / 4, 128);
    for (var y = 60; y < 300; y++) for (var x = 120; x < 520; x++) Y[y * W + x] = (y > 90 && y < 105 && x > 150 && x < 400) || (y > 130 && y < 140 && x > 150 && x < 330) ? 60 : 235;
    parts.push(Buffer.from('FRAME\n'), Y, U, V);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  for (var mf of ['ida-u31-scan-photos.sql', 'ida-u4-archive-vin.sql', 'ida-u4b-vin-lookup-index.sql', 'ida-u5-carte-grise-sources.sql']) {
    var c0 = await db.getClientForTransaction(); try { await c0.query('BEGIN'); await c0.query(fs.readFileSync(path.join(BASE, 'database', 'migrations', mf), 'utf8')); await c0.query('COMMIT'); } catch (e) { await c0.query('ROLLBACK'); throw e; } finally { c0.release(); }
  }
  var run = crypto.randomBytes(3).toString('hex');
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier U51 ' + run])).rows[0].id;
  var server = require(path.join(BASE, 'reference', 'api.js')).createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var B = 'http://127.0.0.1:' + server.address().port; process.env.IDAUTO_AUTH_BASE_URL = B;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var PW = 'U51-Browser-' + crypto.randomBytes(6).toString('hex') + '-1', U = { admin: 'u51-adm-' + run + '@idauto.test', manager: 'u51-mgr-' + run + '@idauto.test' };
  for (var k of Object.keys(U)) { var u = await auth.api.signUpEmail({ body: { email: U[k], password: PW, name: 'U51 ' + k } }); await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [k === 'admin' ? 'admin' : 'manager', k === 'admin' ? null : ORG, u.user.id]); }
  var FEED = path.join(MEDIA, 'card.y4m'); y4m(FEED);
  var port = 9400 + Math.floor(Math.random() * 90);
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--window-size=1366,1000', '--user-data-dir=' + path.join(MEDIA, 'chrome'),
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + FEED, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(MEDIA, { recursive: true, force: true }); } catch (e) {} });
  var targets = null; for (var a = 0; a < 40 && !targets; a++) { await sleep(750); try { targets = await get('http://127.0.0.1:' + port + '/json'); } catch (e) {} }
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl), id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(m, p) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); }); }
  async function ev(e) { var r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  async function waitFor(e, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { try { if (await ev(e)) return true; } catch (x) {} await sleep(250); } return false; }
  async function go(p, ready) { await send('Page.navigate', { url: B + p }); return waitFor('document.readyState === "complete"' + (ready ? ' && (' + ready + ')' : ''), 30000); }
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function signIn(who) {
    await send('Network.enable'); await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.84.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } }); await send('Network.clearBrowserCookies');
    await go('/login?next=%2F', '!!document.querySelector("#login-form[data-ready]")');
    await ev('document.querySelector("#login-email").value = ' + JSON.stringify(U[who]) + '; document.querySelector("#login-password").value = ' + JSON.stringify(PW) + '; document.querySelector("#login-submit").click(); true');
    return waitFor('location.pathname !== "/login"', 15000);
  }
  async function newVehicle() {
    var S = String(crypto.randomInt(100, 999)), N = String(crypto.randomInt(1000, 9999));
    var r = JSON.parse(await ev("fetch('/api/vehicles/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-IDauto-Session': '1' }, body: JSON.stringify({ plate: { type: 'TU', series: '" + S + "', number: '" + N + "' }, make: 'Peugeot', model: '301' }) }).then(r => r.text())"));
    return { ivid: r.ivid, S: S, N: N };
  }
  async function search(v) {
    await go('/', '!!document.querySelector("[data-plate-form]")');
    await ev("(() => { const s = document.querySelector('#plate-serie'), n = document.querySelector('#plate-numero'); s.value = '" + v.S + "'; s.dispatchEvent(new Event('input', { bubbles: true })); n.value = '" + v.N + "'; n.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-plate-form]').requestSubmit(); return true; })()");
    return waitFor('!document.querySelector("[data-cgc-card]").hidden');
  }
  function docs(v) { return ev("fetch('/api/vehicles/" + encodeURIComponent(v.ivid) + "/carte-grise', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } }).then(r => r.json())"); }

  for (var form of ['desktop', 'mobile']) {
    console.log('\n== ' + form);
    await send('Emulation.setDeviceMetricsOverride', form === 'mobile' ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    ok(await signIn('admin'), form + ': administrator signed in');
    await go('/', '!!document.querySelector("[data-plate-form]")');
    var v = await newVehicle();
    ok(!!v.ivid && await search(v), form + ': plate search → the identity card has a carte grise block');
    ok(await ev('document.querySelector("[data-cgc-card]").getAttribute("data-cgc-exists") === "no" && /Aucune carte grise enregistrée/.test(document.querySelector("[data-cgc-state]").textContent)'), form + ': State B from the database: « Aucune carte grise enregistrée »');
    ok(await ev('["camera","file","paste"].every(m => !!document.querySelector("[data-cgc-card] [data-cgc-method=" + m + "]")) && !document.querySelector("[data-cg-root]")'), form + ': Scanner · Importer un fichier · Coller, under the identity only');
    // Scanner
    await ev('document.querySelector("[data-cgc-card] [data-cgc-method=camera]").click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-view=camera]").hidden && document.querySelector("[data-cgc-video]").videoWidth > 0', 15000), form + ': Scanner opens the live camera at once');
    ok(await ev('document.querySelectorAll("[data-cgc-view=camera] input[type=file]").length === 0 && /environment/.test(JSON.stringify(document.querySelector("[data-cgc-video]").srcObject.getVideoTracks()[0].getConstraints()))'), form + ': no file picker; the rear camera is requested');
    ok(await ev('(() => { const s = document.querySelector("[data-cgc-shutter]").getBoundingClientRect(); return s.bottom <= innerHeight && s.top >= 0; })()'), form + ': « Capturer » is on screen');
    await ev('document.querySelector("[data-cgc-shutter]").click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-view=preview]").hidden && document.querySelector("[data-cgc-preview-image]").naturalWidth > 0'), form + ': capture → the captured image is shown');
    ok(await ev('!document.querySelector("[data-cgc-video]").srcObject && /Image (PNG|JPEG)/.test(document.querySelector("[data-cgc-meta]").textContent)'), form + ': camera released; type and size shown');
    await ev('document.querySelector("[data-cgc-again]").click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-view=camera]").hidden && document.querySelector("[data-cgc-video]").videoWidth > 0'), form + ': Reprendre → the camera again');
    await ev('document.querySelector("[data-cgc-shutter]").click(); true'); await waitFor('!document.querySelector("[data-cgc-view=preview]").hidden');
    ok((await docs(v)).documents.length === 0, form + ': nothing stored before « Confirmer »');
    await ev('document.querySelector("[data-cgc-confirm]").click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-view=done]").hidden'), form + ': Confirmer → saved');
    var d1 = (await docs(v)).documents;
    ok(d1.length === 1 && d1[0].input_method === 'camera' && /^image\/(png|jpeg)$/.test(d1[0].mime_type) && d1[0].processing_status === 'PENDING_LENS', form + ': one document: camera, original image, PENDING_LENS');
    await ev('document.querySelector("[data-cgc-view=done] [data-cgc-close]").click(); true');
    ok(await waitFor('document.querySelector("[data-cgc-card]").getAttribute("data-cgc-exists") === "yes"'), form + ': the card switches to State A without another search');
    ok(await ev('/Carte grise enregistrée/.test(document.querySelector("[data-cgc-state]").textContent) && !!document.querySelector("[data-cgc-view-doc]") && !!document.querySelector("[data-cgc-history]") && !document.querySelector("[data-cgc-card] [data-cgc-method]") && !!document.querySelector("[data-cgc-new-version]")'), form + ': State A: date, Consulter, Historique; no ordinary add; explicit new version (administrator)');
    // explicit new version by file import: the picker opens at once, PDF preview
    await ev('document.querySelector("[data-cgc-new-version]").click(); true');
    await ev("(() => { window.__picker = 0; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__picker++; const pdf = '%PDF-1.4\\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\\n% " + run + form + "\\n%%EOF\\n'; const dt = new DataTransfer(); dt.items.add(new File([new TextEncoder().encode(pdf)], 'cg.pdf', { type: 'application/pdf' })); this.files = dt.files; this.dispatchEvent(new Event('change', { bubbles: true })); return; } return orig.call(this); }; document.querySelector('[data-cgc-card] [data-cgc-method=file]').click(); return true; })()");
    ok(await waitFor('!!document.querySelector("[data-cgc-preview-pdf]")') && await ev('window.__picker === 1'), form + ': Importer un fichier → the picker at once → PDF preview');
    await ev('document.querySelector("[data-cgc-confirm]").click(); true'); await waitFor('!document.querySelector("[data-cgc-view=done]").hidden');
    await ev('document.querySelector("[data-cgc-view=done] [data-cgc-close]").click(); true');
    var d2 = (await docs(v)).documents;
    ok(d2.length === 2 && d2.filter(function (d) { return d.current; }).length === 1 && d2[0].source_format === 'CARTE_GRISE_PDF' && d2[0].version === 2, form + ': new version (PDF) — the previous one kept');
    // Coller: direct read (a real browser returns the copied image as a ClipboardItem; headless Chrome has no system clipboard)
    await waitFor('!!document.querySelector("[data-cgc-new-version]")'); await ev('document.querySelector("[data-cgc-new-version]").click(); true');
    await ev("(async () => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#f3efe2'; x.fillRect(0, 0, 900, 600); x.fillStyle = '#222'; x.fillText('" + run + form + "', 40, 60); const b = await new Promise(r => c.toBlob(r, 'image/png')); const it = new ClipboardItem({ 'image/png': b }); Object.defineProperty(navigator.clipboard, 'read', { value: () => Promise.resolve([it]), configurable: true }); document.querySelector('[data-cgc-card] [data-cgc-method=paste]').click(); return true; })()");
    ok(await waitFor('!document.querySelector("[data-cgc-view=preview]").hidden && !!document.querySelector("[data-cgc-preview-image]")') && await ev('!document.querySelector("[data-cgc-root] textarea")'), form + ': Coller reads the clipboard image directly into the preview — no textarea');
    await ev('document.querySelector("[data-cgc-view=preview] [data-cgc-cancel]").click(); true');
    // Ctrl+V fallback, text refused
    await ev("(() => { Object.defineProperty(navigator.clipboard, 'read', { value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')), configurable: true }); document.querySelector('[data-cgc-card] [data-cgc-method=paste]').click(); return true; })()");
    ok(await waitFor('!document.querySelector("[data-cgc-view=paste]").hidden && document.activeElement === document.querySelector("[data-cgc-paste-target]")'), form + ': reading refused → a focused Ctrl+V target');
    await ev("(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Nom : X — texte copié'); document.querySelector('[data-cgc-paste-target]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()");
    ok(await waitFor('/texte, pas une image/.test(document.querySelector("[data-cgc-status]").textContent)') && await ev('document.querySelector("[data-cgc-view=preview]").hidden'), form + ': text in the clipboard → clear message, never treated as an image');
    await ev("(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 520; c.getContext('2d').fillRect(10, 10, 100, 100); const b = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'v.png', { type: 'image/png' })); document.querySelector('[data-cgc-paste-target]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()");
    ok(await waitFor('!document.querySelector("[data-cgc-view=preview]").hidden && !!document.querySelector("[data-cgc-preview-image]")'), form + ': Ctrl+V with an image → the same preview');
    await ev('document.querySelector("[data-cgc-view=preview] [data-cgc-cancel]").click(); true');
    // camera refused
    await ev("(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); document.querySelector('[data-cgc-card] [data-cgc-method=camera]').click(); return true; })()");
    ok(await waitFor('/refusé/.test(document.querySelector("[data-cgc-status]").textContent) && !!document.querySelector("[data-cgc-fallback-file]")'), form + ': camera refused → a useful message and « Importer un fichier »');
    await ev('document.querySelector("[data-cgc-view=camera] [data-cgc-cancel]").click(); true');
    // a workshop sees State A without any add
    ok(await signIn('manager') && await search(v) && await ev('document.querySelector("[data-cgc-card]").getAttribute("data-cgc-exists") === "yes" && !document.querySelector("[data-cgc-new-version]") && !document.querySelector("[data-cgc-card] [data-cgc-method]")'), form + ': a workshop sees « Carte grise enregistrée » with no add and no new version');
    // a visitor: the status only
    await send('Network.clearBrowserCookies');
    ok(await search(v) && await ev('document.querySelector("[data-cgc-card]").getAttribute("data-cgc-exists") === "yes" && !document.querySelector("[data-cgc-view-doc]") && !document.querySelector("[data-cgc-card] [data-cgc-method]") && !document.querySelector("[data-cgc-home-note]").hidden'), form + ': a visitor sees the status only (and is asked to sign in)');
    var anon = await ev("fetch('/api/vehicles/" + encodeURIComponent(v.ivid) + "/carte-grise/" + d2[0].id + "/original', { credentials: 'omit' }).then(r => r.status)");
    ok(anon === 401, form + ': a visitor cannot open the original (401)');
  }
  console.log('\nIDA-U5.1 carte grise browser: ' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
