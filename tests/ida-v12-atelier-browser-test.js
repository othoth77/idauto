'use strict';
/* IDA-V12 — the atelier page, driven in a real (headless) Chrome over the
 * DevTools protocol. Frontend + E2E: token → unknown plate → invalid VIN →
 * manual selection → confirm → fiche → local part → visit → operation →
 * order → close → history, with an overflow check at 390px.
 *
 * Needs google-chrome / chromium on PATH and a scratch database (like every
 * live suite). Without Chrome it reports SKIPPED and exits 0 — the API-level
 * suite (ida-v12-vehicle-identification-test.js) covers the same journey
 * without a browser. Uses Node 22's global WebSocket; no dependency.
 */
var http = require('http'); var cp = require('child_process'); var crypto = require('crypto'); var path = require('path'); var fs = require('fs');
var BASE = path.join(__dirname, '..');
var CHROME = ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME || typeof WebSocket === 'undefined') { console.log('IDA-V12 atelier browser: SKIPPED (no Chrome or no global WebSocket) — 0 passed, 0 failed'); process.exit(0); }
var TOKEN = 'ui-' + crypto.randomBytes(12).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: 'usr_ui_e2e' });
var db = require(path.join(BASE, 'reference', 'db.js'));
var CDP = 9300 + Math.floor(Math.random() * 500);
function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { r(JSON.parse(Buffer.concat(c).toString())); }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier UI E2E','garage','active') RETURNING id")).rows[0].id;
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var server = api.createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var PORT = server.address().port;
  process.env.UI_ORG = String(ORG);
  // IDA-V13 — the page is behind /login: create a web admin and sign in
  // through the real form, which is itself part of what this test covers.
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + PORT;
  var authApi = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var WEB_EMAIL = 'ui-' + crypto.randomBytes(4).toString('hex') + '@idauto.test', WEB_PW = 'Ui-Browser-' + crypto.randomBytes(6).toString('hex') + '-1';
  var webUser = await authApi.api.signUpEmail({ body: { email: WEB_EMAIL, password: WEB_PW, name: 'Chef Atelier' } });
  await db.query('UPDATE idauto_auth_user SET "role" = $1 WHERE "id" = $2', ['admin', webUser.user.id]);

  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + CDP, '--window-size=390,1400', '--user-data-dir=/tmp/idauto-ui-e2e-' + process.pid, 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  var targets = await get('http://127.0.0.1:' + CDP + '/json');
  var page = targets.filter(function (t) { return t.type === 'page'; })[0];
  var ws = new WebSocket(page.webSocketDebuggerUrl); var id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception)); return r.result.result.value; }
  var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/atelier' }); await sleep(1500);
  ok(/\/login\?next=%2Fatelier$/.test(await ev('location.pathname + location.search')), '/atelier without a session lands on /login?next=/atelier');
  ok(await ev('!!document.querySelector("#login-form") && /Connexion à IDauto/.test(document.body.textContent)'), 'the French sign-in form is shown');
  await ev('document.querySelector("#login-email").value=' + JSON.stringify(WEB_EMAIL) + ';document.querySelector("#login-password").value="wrong-password-000";document.querySelector("#login-submit").click()'); await sleep(1500);
  ok(/incorrect/.test(await ev('document.querySelector("#login-error-body").textContent')), 'a wrong password shows « Identifiant ou mot de passe incorrect »');
  await ev('document.querySelector("#login-password").value=' + JSON.stringify(WEB_PW) + ';document.querySelector("#login-submit").click()'); await sleep(2500);
  ok(await ev('location.pathname') === '/atelier', 'a correct login redirects to /atelier');
  ok(await ev('document.querySelector("[data-panel=identify]").getAttribute("data-state")') === 'idle', 'page loads in state idle');
  ok(await ev('Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0'), 'nothing was written to localStorage or sessionStorage by the login');
  ok(await ev('document.cookie') === '', 'the session cookie is HttpOnly: document.cookie is empty');
  ok(/Connecté : Chef Atelier/.test(await ev('document.querySelector("[data-user-line]").textContent')), 'the page shows who is signed in and their role');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth') === true, 'no horizontal overflow at 390px');
  await sleep(800);
  ok(/non configuré/.test(await ev('document.querySelector("[data-catalog-status]").textContent')), 'catalogue status shows « Catalogue fournisseur non configuré »');
  var S = String(100 + Math.floor(Math.random() * 899)), N = String(1000 + Math.floor(Math.random() * 8999));
  await ev('document.querySelector("#at-serie").value=' + JSON.stringify(S) + ';document.querySelector("#at-numero").value=' + JSON.stringify(N) + ';document.querySelector("[data-action=resolve-plate]").click()'); await sleep(1200);
  ok(await ev('document.querySelector("[data-panel=identify]").getAttribute("data-state")') === 'not_found', 'unknown plate → state not_found, manual entry shown');
  ok(await ev('!document.querySelector("[data-ident-manual]").hidden'), 'VIN / make-model fallback is visible');
  await ev('document.querySelector("#at-vin").value="ZZZ";document.querySelector("[data-action=resolve-vin]").click()'); await sleep(1200);
  ok(await ev('document.querySelector("[data-panel=identify]").getAttribute("data-state")') === 'error' && /17 caractères/.test(await ev('document.querySelector("[data-ident-error-body]").textContent')), 'invalid VIN → error state with the French message');
  await ev('document.querySelector("#at-make").value="DACIA";document.querySelector("#at-model").value="LOGAN";document.querySelector("#at-motor").value="1.0 SCe ' + N + '";document.querySelector("#at-year").value="2021";document.querySelector("[data-action=resolve-manual]").click()'); await sleep(1200);
  ok(await ev('document.querySelector("[data-panel=identify]").getAttribute("data-state")') === 'resolved' && await ev('!document.querySelector("[data-ident-candidate]").hidden'), 'manual selection → candidate shown for confirmation');
  await ev('document.querySelector("[data-action=confirm-candidate]").click()'); await sleep(1500);
  ok(await ev('!document.querySelector("[data-panel=fiche]").hidden') && /Vérifié/.test(await ev('document.querySelector("[data-fiche-verified]").textContent')), 'confirm → fiche shown, verified');
  ok(/DACIA/.test(await ev('document.querySelector("[data-fiche-fields]").textContent')) && new RegExp(S + ' تونس ' + N).test(await ev('document.querySelector("[data-fiche-fields]").textContent')), 'fiche shows the manufacturer and the plate in Arabic display form');
  ok(await ev('!document.querySelector("[data-panel=parts]").hidden') && await ev('!document.querySelector("[data-panel=workshop]").hidden'), 'parts and workshop panels open');
  await sleep(800);
  ok(/non configuré/.test(await ev('document.querySelector("[data-parts-supplier]").textContent')), 'parts panel states the supplier catalogue is not configured');
  await ev('document.querySelector("#np-ref").value="OC ' + N + '";document.querySelector("#np-brand").value="MAHLE";document.querySelector("#np-cat").value="filtration";document.querySelector("#np-name").value="Filtre";document.querySelector("#np-qty").value="2";document.querySelector("#np-price").value="19900";document.querySelector("[data-action=parts-add]").click()'); await sleep(2000);
  ok(await ev('document.querySelectorAll(".ida-atelier-part").length') >= 1, 'a local part added is listed for the vehicle');
  await ev('document.querySelector(".ida-atelier-part").click()');
  ok(/MAHLE/.test(await ev('document.querySelector("#op-part").value')), 'selecting the part fills the operation');
  await ev('document.querySelector("#at-org").value="' + process.env.UI_ORG + '";document.querySelector("#at-customer").value="CLI-E2E";document.querySelector("#at-reason").value="Vidange";document.querySelector("[data-action=visit-open]").click()'); await sleep(1500);
  ok(/Visite n°/.test(await ev('document.querySelector("[data-visit-badge]").textContent')), 'visit opened');
  await ev('document.querySelector("#op-desc").value="Filtre à huile";document.querySelector("[data-action=op-add]").click()'); await sleep(1500);
  ok(await ev('document.querySelectorAll("[data-visit-ops] li").length') >= 1, 'operation added with the part');
  await ev('document.querySelector("[data-action=order-create]").click()'); await sleep(1500);
  ok(/Commande n°/.test(await ev('document.querySelector("[data-visit-status]").textContent')), 'order created from the operations');
  await ev('document.querySelector("[data-action=visit-close]").click()'); await sleep(1500);
  ok(/closed/.test(await ev('document.querySelector("[data-visit-badge]").textContent')), 'visit closed');
  await ev('document.querySelector("[data-action=fiche-history]").click()'); await sleep(1000);
  ok(await ev('document.querySelectorAll("[data-fiche-history] li").length') >= 1, 'identification history renders');
  ok(await ev('document.documentElement.scrollWidth <= window.innerWidth') === true, 'still no horizontal overflow with every panel open at 390px');
  await ev('document.querySelector("[data-action=logout]").click()'); await sleep(1500);
  ok(await ev('location.pathname') === '/login', 'Déconnexion signs out and lands on /login');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/atelier' }); await sleep(1200);
  ok(await ev('location.pathname') === '/login', 'after logout /atelier redirects to /login again');
    console.log('IDA-V12 atelier browser E2E (headless Chrome): ' + pass + ' passed, ' + fail + ' failed');
  ws.close(); chrome.kill(); server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });

