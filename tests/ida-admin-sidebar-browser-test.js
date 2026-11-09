'use strict';
/* IDA-ADMIN-7 — the shared console sidebar, driven in a real (headless)
 * Chrome over the DevTools protocol at desktop (1440), tablet (820) and
 * mobile (390) widths:
 *   - direct access to every console page: the six modules in order, one
 *     active module, the right current page, no horizontal overflow;
 *   - clicking each module; Back and Forward keep the active module right;
 *   - a filtered view keeps its query and filter through navigation and Back;
 *   - desktop: collapse to an icon rail and expand; tablet/mobile: a drawer
 *     that is inert while closed, takes focus when open, keeps Tab inside and
 *     closes on Escape (focus back on the menu button);
 *   - identity shows name and role, never the e-mail; logout ends the session;
 *   - a manager sees the sidebar but every module refuses the data (403).
 *
 * Needs google-chrome / chromium on PATH and a scratch database (like every
 * live suite). Without Chrome it reports SKIPPED and exits 0. Uses Node 22's
 * global WebSocket; no dependency.
 */
var http = require('http'); var cp = require('child_process'); var crypto = require('crypto'); var path = require('path');
var BASE = path.join(__dirname, '..');
var CHROME = ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME || typeof WebSocket === 'undefined') { console.log('IDA-ADMIN-7 sidebar browser: SKIPPED (no Chrome or no global WebSocket) — 0 passed, 0 failed'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var TOKEN = 'sb-' + crypto.randomBytes(12).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: 'usr_sidebar_e2e' });
var db = require(path.join(BASE, 'reference', 'db.js'));
var CDP = 9800 + Math.floor(Math.random() * 150);
// IDA-UI-1 — the application shell: the admin's menu is the shell's own list (sections filtered
// by role), and six console pages are walked through it.
var SHELL = require(path.join(BASE, 'reference', 'admin-shell.js'));
var LABELS = [].concat.apply([], SHELL.visible('admin').map(function (sec) { return sec.items.map(function (i) { return i.label; }); }));
// IDA-UI-4 — the menu is five links; the console pages are out of it but still served with the shell.
var MODULES = SHELL.NAV.map(function (i) { return [i.href, i.label]; });
var CONSOLE = ['/admin/dashboard', '/admin/vehicles', '/admin/maintenance', '/admin/sources', '/admin/quality', '/admin/security'];
function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { r(JSON.parse(Buffer.concat(c).toString())); }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier Sidebar ' + run])).rows[0].id;
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var server = api.createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var PORT = server.address().port, B = 'http://127.0.0.1:' + PORT;
  process.env.IDAUTO_AUTH_BASE_URL = B;
  var authApi = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var PW = 'Sb-Browser-' + crypto.randomBytes(6).toString('hex') + '-1';
  var users = { admin: 'sb-admin-' + run.toLowerCase() + '@idauto.test', manager: 'sb-mgr-' + run.toLowerCase() + '@idauto.test' };
  for (var role of ['admin', 'manager']) {
    var u = await authApi.api.signUpEmail({ body: { email: users[role], password: PW, name: (role === 'admin' ? 'Admin Sidebar ' : 'Gestion Sidebar ') + run } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, role === 'admin' ? null : ORG, u.user.id]);
  }
  var veh = await new Promise(function (resolve, reject) {
    var body = JSON.stringify({ plate: crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999), method: 'admin', candidate: { manufacturer: 'SB' + run, model: 'X', year: 2020 } });
    var req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/api/resolve/confirm', method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { resolve(JSON.parse(Buffer.concat(c).toString()).vehicle); });
    }); req.on('error', reject); req.end(body);
  });

  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + CDP, '--window-size=1440,900', '--user-data-dir=/tmp/idauto-sidebar-e2e-' + process.pid, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} });
  var targets = null;
  for (var attempt = 0; attempt < 30 && !targets; attempt++) { await sleep(1000); try { targets = await get('http://127.0.0.1:' + CDP + '/json'); } catch (e) { targets = null; } }
  if (!targets) throw new Error('Chrome did not open its DevTools port');
  var target = targets.filter(function (t) { return t.type === 'page'; })[0];
  var ws = new WebSocket(target.webSocketDebuggerUrl); var id = 0, pending = {}, errors = [];
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(JSON.stringify(d.params.args.map(function (a) { return a.value; }))); };
  await new Promise(function (r) { ws.onopen = r; });
  var sessionReads = 0;
  ws.addEventListener('message', function (m) { var d = JSON.parse(m.data); if (d.method === 'Network.requestWillBeSent' && /\/api\/auth\/get-session/.test(d.params.request.url)) sessionReads++; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  async function waitFor(expr, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(250); } return false; }
  async function key(k) { var code = { Escape: 27, Tab: 9 }[k]; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); }
  async function nav(url) { await send('Page.navigate', { url: B + url }); await sleep(300); return waitFor('document.readyState === "complete" && !!document.querySelector("[data-admin-sidebar] .ida-admin-nav-link")', 20000); }
  var STATE = '(function(){var q=function(s){return Array.from(document.querySelectorAll(s))};return {path:location.pathname,search:location.search,' +
    'active:q(".ida-admin-nav-link.is-active").map(function(a){return a.getAttribute("href")}),current:q("[data-admin-sidebar] [aria-current=page]").map(function(a){return a.getAttribute("href")}),' +
    'labels:q(".ida-admin-nav-link").map(function(a){return a.textContent.trim()}),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,' +
    'sidebarW:Math.round(document.querySelector("[data-admin-sidebar]").getBoundingClientRect().width),mode:document.querySelector(".ida-admin-shell").getAttribute("data-mode")}})()';
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.81.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } });

  async function signIn(email) {
    // Each sign-in is a distinct visitor (its own X-Real-IP, as nginx sets it):
    // Better Auth limits sign-in to 5 and /api/auth/* to 60 a minute per client.
    await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.81.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } });
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: B + '/login?next=%2Fadmin%2Fdashboard' });
    await waitFor('document.readyState === "complete" && !!document.querySelector("#login-form[data-ready]")', 30000); await sleep(300);
    await ev('document.querySelector("#login-email").value=' + JSON.stringify(email) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
    return waitFor('location.pathname === "/admin/dashboard" && !!document.querySelector("[data-admin-sidebar] .ida-admin-nav-link")', 25000);
  }

  for (var width of [1440, 820, 390]) {
    console.log('\n== ' + width + ' px');
    await send('Emulation.setDeviceMetricsOverride', { width: width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    ok(await signIn(users.admin), 'the admin signs in and lands on the dashboard');
    var drawer = width < 1024;
    var pages = MODULES.map(function (m) { return [m[0], m[0], m[0]]; }).concat(CONSOLE.map(function (c) { return [c, null, null]; })).concat([['/admin/review', null, null], ['/admin', null, null],
      ['/admin/vehicle?ref=' + encodeURIComponent(veh.id), null, null], ['/admin/quality/', null, null],
      ['/atelier/vehicule?ref=' + encodeURIComponent(veh.id), '/atelier/vehicules', '/atelier/vehicules'],
      ['/admin/utilisateurs', '/atelier/compte', '/atelier/compte'], ['/admin/roles', '/atelier/compte', '/atelier/compte']]);
    var bad = [];
    for (var p of pages) {
      if (!(await nav(p[0]))) { bad.push(p[0] + ' did not load (at ' + await ev('location.href') + ')'); continue; }
      var s = await ev(STATE);
      var good = (p[1] === null ? s.active.length === 0 : s.active.length === 1 && s.active[0] === p[1]) && (p[2] ? s.current.length === 1 && s.current[0] === p[2] : s.current.length === 0) && s.overflow <= 0 &&
        JSON.stringify(s.labels) === JSON.stringify(LABELS) && s.mode === (drawer ? 'drawer' : 'sidebar');
      if (!good) bad.push(p[0] + ' ' + JSON.stringify(s));
    }
    if (width === 1440) {
      // One session read per page: the shell shares it with the page script
      // (Better Auth allows 60 /api/auth requests a minute per client).
      var perPage = [];
      for (var sp of ['/admin/dashboard', '/admin/quality', '/admin/review', '/admin']) {
        sessionReads = 0; await nav(sp); await waitFor('/Admin Sidebar/.test(document.querySelector(".ida-admin-identity").textContent)'); await sleep(800);
        perPage.push(sp + '=' + sessionReads);
      }
      ok(perPage.every(function (x) { return /=1$/.test(x); }), 'each console page reads the session once, shared by the shell and the page (' + perPage.join(', ') + ')');
    }
    ok(bad.length === 0, 'direct access to ' + pages.length + ' pages: the menu (' + LABELS.length + ' links) in order, the page\'s link marked current (none on a console page), no overflow' + (bad.length ? ' — ' + bad.join(' | ').slice(0, 400) : ''));
    await waitFor('/Admin Sidebar/.test(document.querySelector(".ida-admin-identity").textContent)');
    var ident = await ev('document.querySelector(".ida-admin-identity").textContent');
    ok(/Admin Sidebar/.test(ident) && /Administrateur/.test(ident) && (await ev('document.querySelector("[data-admin-sidebar]").textContent + document.querySelector("[data-app-topbar]").textContent')).indexOf('@') === -1, 'identity: name and role, never the e-mail');

    // Click each menu link, then Back, Back, Forward.
    await nav('/atelier/tableau-de-bord');
    var trail = true;
    for (var m of MODULES.slice(1)) {
      if (drawer) { await ev('document.querySelector(".ida-admin-menu-btn").click()'); await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "open"'); await sleep(600); }
      // A real (trusted) click: Chrome skips history entries created by script-only clicks without user activation.
      var box = await ev('(function(){var r=document.querySelector("[data-admin-sidebar] .ida-admin-nav-link[href=\\"' + m[0] + '\\"]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      var arrived = await waitFor('location.pathname === ' + JSON.stringify(m[0]) + ' && document.readyState === "complete" && !!document.querySelector(".ida-admin-nav-link.is-active")', 20000);
      var st = await ev(STATE); if (!arrived || st.active[0] !== m[0] || st.current[0] !== m[0]) trail = false;
    }
    ok(trail, 'clicking each module in the sidebar opens it and marks it active');
    async function hist(fn, expect) { await ev('history.' + fn + '()'); return waitFor('location.pathname === ' + JSON.stringify(expect) + ' && document.readyState === "complete" && (document.querySelector(".ida-admin-nav-link.is-active")||{}).getAttribute && document.querySelector(".ida-admin-nav-link.is-active").getAttribute("href") === ' + JSON.stringify(expect), 20000); }
    var hb1 = await hist('back', '/atelier/pieces-remplacees'), hb1s = await ev(STATE), hb2 = hb1 && await hist('back', '/atelier/interventions'), hf = hb2 && await hist('forward', '/atelier/pieces-remplacees');
    ok(hb1 && hb2 && hf, 'Back, Back, Forward: the active link follows the page' + (hb1 && hb2 && hf ? '' : ' — after first Back: ' + JSON.stringify({ path: hb1s.path, active: hb1s.active }) + ' now ' + JSON.stringify((await ev(STATE)).path)));

    // A filtered view keeps its query through navigation and Back.
    await nav('/atelier/pieces-remplacees'); await waitFor('!!document.querySelector("#list table, #list .ida-empty")', 20000);
    await ev('(function(){var s=document.getElementById("f-source");s.value="our_shop";s.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    await waitFor('/source=our_shop/.test(location.search)');
    if (drawer) { await ev('document.querySelector(".ida-admin-menu-btn").click()'); await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "open"'); }
    await ev('document.querySelector("[data-admin-sidebar] .ida-admin-nav-link[href=\\"/atelier/interventions\\"]").click()');
    await waitFor('location.pathname === "/atelier/interventions"', 20000);
    await ev('history.back()');
    var kept = await waitFor('location.pathname === "/atelier/pieces-remplacees" && location.search === "?source=our_shop" && document.getElementById("f-source") && document.getElementById("f-source").value === "our_shop" && document.querySelector(".ida-admin-nav-link.is-active").getAttribute("href") === "/atelier/pieces-remplacees"', 20000);
    ok(kept, 'a filtered view keeps its query and filter through sidebar navigation and Back');

    if (!drawer) {
      await nav('/atelier/interventions');
      var w0 = (await ev(STATE)).sidebarW;
      await ev('document.querySelector(".ida-admin-sidebar-collapse").click()');
      await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-sidebar") === "collapsed"');
      await sleep(300);
      var c = await ev(STATE);
      var hiddenLabel = await ev('document.querySelector(".ida-admin-nav-link .ida-admin-nav-label").getBoundingClientRect().width <= 1');
      ok(w0 >= 240 && c.sidebarW < 80 && hiddenLabel && JSON.stringify(c.labels) === JSON.stringify(LABELS) && c.active[0] === '/atelier/interventions' &&
        await ev('document.querySelector(".ida-admin-sidebar-collapse").getAttribute("aria-expanded")') === 'false',
        'collapse: an icon rail (' + w0 + ' → ' + c.sidebarW + ' px), labels kept as accessible names, active module unchanged');
      await ev('document.querySelector(".ida-admin-sidebar-collapse").click()');
      await sleep(300);
      ok((await ev(STATE)).sidebarW >= 240 && await ev('document.querySelector(".ida-admin-sidebar-collapse").getAttribute("aria-expanded")') === 'true', 'expand restores the full sidebar');
      ok(await ev('getComputedStyle(document.querySelector(".ida-admin-topbar")).display !== "none" && document.querySelector(".ida-admin-shell").getAttribute("data-mode") === "sidebar" && !document.querySelector("[data-admin-sidebar]").hasAttribute("inert")'), 'desktop: the top bar (search, notifications, language, profile) above a persistent sidebar');
    } else {
      await nav('/admin/dashboard');
      ok(await ev('(function(){var a=document.querySelector("[data-admin-sidebar]");return a.hasAttribute("inert") && getComputedStyle(a).visibility === "hidden" && a.getBoundingClientRect().right <= 0})()') &&
        await ev('getComputedStyle(document.querySelector(".ida-admin-topbar")).display !== "none"'), 'drawer mode: a top bar; the closed drawer is off-screen, hidden and inert');
      await ev('document.querySelector(".ida-admin-menu-btn").click()');
      ok(await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "open" && !!document.activeElement.closest("[data-admin-sidebar]") && !document.querySelector(".ida-admin-backdrop").hidden', 5000),
        'the menu button opens the drawer, focus moves into it, the scrim shows');
      for (var t = 0; t < 25; t++) await key('Tab');
      ok(await ev('!!document.activeElement.closest("[data-admin-sidebar]")'), 'Tab stays inside the open drawer');
      await key('Escape');
      ok(await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "closed" && document.activeElement === document.querySelector(".ida-admin-menu-btn")', 5000),
        'Escape closes it and returns focus to the menu button');
      await ev('document.querySelector(".ida-admin-menu-btn").click()');
      await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "open"');
      await ev('document.querySelector(".ida-admin-backdrop").click()');
      ok(await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "closed"', 5000), 'a click on the scrim closes it');
    }
    ok(errors.length === 0, 'no console error (' + errors.join(' | ').slice(0, 200) + ')');
    errors = [];

    if (width === 390) {
      // IDA-UI-1 — sign-out lives in the profile menu of the top bar.
      await ev('document.querySelector(".ida-app-profile").click()');
      await waitFor('!document.querySelector("#app-profile").hidden && !document.querySelector("[data-admin-logout]").hidden');
      await ev('document.querySelector("[data-admin-logout]").click()');
      var out = await waitFor('location.pathname === "/login"', 20000);
      var st401 = await ev('fetch("/api/admin/dashboard",{credentials:"same-origin",headers:{"X-IDauto-Session":"1"}}).then(function(r){return r.status})');
      ok(out && st401 === 401, 'Déconnexion ends the session: /login, and the admin API answers 401');
    }
  }

  // A manager: the sidebar grants nothing.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  ok(await signIn(users.manager), 'a manager signs in');
  var refused = [];
  for (var mm of CONSOLE.map(function (c) { return [c]; })) {
    await nav(mm[0]);
    if (!(await waitFor('!!document.querySelector("main .ida-alert")', 15000))) refused.push(mm[0]);
  }
  var codes = await ev('Promise.all(["/api/admin/dashboard","/api/admin/vehicles","/api/admin/maintenance","/api/admin/organisations","/api/admin/quality","/api/admin/audit","/api/admin/accounts"].map(function(p){return fetch(p,{credentials:"same-origin",headers:{"X-IDauto-Session":"1"}}).then(function(r){return r.status})}))');
  ok(refused.length === 0 && codes.every(function (c) { return c === 403; }), 'every module shows a refusal and every admin API answers 403 (' + codes.join(',') + ')' + (refused.length ? ' — no alert on ' + refused.join(',') : ''));

  ws.close(); chrome.kill('SIGKILL'); server.close(); await db.closePool();
  console.log('\nIDA-ADMIN-7 sidebar browser (headless Chrome, 1440/820/390): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FATAL ' + (e && e.stack || e)); process.exit(1); });
