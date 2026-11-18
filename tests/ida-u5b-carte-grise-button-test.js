#!/usr/bin/env node
'use strict';
// IDA-U5b — « Ajouter la carte grise » sits next to « Rechercher le véhicule » (VIN search actions), never in the identity
// card; disabled until a search succeeds; acts on the vehicle of the CURRENT successful search. Headless Chrome, desktop
// and mobile. Scratch database; skipped without Chrome.
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
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + path.join(MEDIA, 'chrome'), 'about:blank'], { stdio: 'ignore' });
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
    ok(await ev(BTN + '.disabled && !document.querySelector("[data-cgc-home-hint]").hidden'), form + ': before any search: disabled, with « Recherchez d\'abord un véhicule… »');
    await vinSearch(VIN);
    ok(await waitFor('!document.querySelector("[data-plate-result]").hidden && document.querySelector("[data-result-ivid]").textContent === ' + JSON.stringify(reg.ivid)), form + ': VIN search finds the vehicle (unchanged behaviour)');
    ok(await waitFor('!' + BTN + '.disabled && document.querySelector("[data-cgc-home-hint]").hidden'), form + ': after a successful search: enabled, hint gone');
    var geo = JSON.parse(await ev('JSON.stringify((() => { const a = document.querySelector("[data-vin-submit]").getBoundingClientRect(), b = ' + BTN + '.getBoundingClientRect(); return { sameRow: Math.abs(a.top - b.top) < 2, bRight: b.right, aRight: a.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }; })())'));
    if (form === 'desktop') ok(geo.sameRow, 'desktop: both buttons side by side on one row');
    else ok(!geo.overflow && geo.bRight <= geo.width && geo.aRight <= geo.width, 'mobile: both buttons visible, wrapped cleanly, no horizontal overflow');
    await ev(BTN + '.click(); true');
    ok(await waitFor('!document.querySelector("[data-cgc-root]").hidden && window.IdaCarteGrise._state.ivid === ' + JSON.stringify(reg.ivid)), form + ': click opens the carte grise upload dialog for THAT vehicle');
    await ev('document.querySelector("[data-cgc-close]").click(); true');
    await vinSearch('WVWZZZ1JZXW000001');
    ok(await waitFor('document.querySelector("[data-plate-result]").hidden && ' + BTN + '.disabled && !document.querySelector("[data-cgc-home-hint]").hidden'), form + ': after an unsuccessful search: the previous vehicle is cleared, the button disabled again');
    await ev('(() => { const s = document.querySelector("#plate-serie"), n = document.querySelector("#plate-numero"); s.value = ' + JSON.stringify(S) + '; s.dispatchEvent(new Event("input", { bubbles: true })); n.value = ' + JSON.stringify(N) + '; n.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-plate-form]").requestSubmit(); return true; })()');
    ok(await waitFor('!' + BTN + '.disabled && document.querySelector("[data-result-ivid]").textContent === ' + JSON.stringify(reg.ivid)), form + ': a successful plate search enables it too (current successful search)');
  }
  console.log('\nIDA-U5b carte grise button: ' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
