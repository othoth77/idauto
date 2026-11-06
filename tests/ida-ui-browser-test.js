#!/usr/bin/env node
'use strict';
// IDA-UI — the redesigned application in a real browser (headless Chrome over CDP), on a scratch
// database: shell (sidebar + top bar), manual registration with carte grise photos, dossier,
// private owner contact, intervention with the part-source radio, replaced parts, global search,
// roles, French / Arabic (RTL), and the responsive layout at 1920 → 375 px. Synthetic data only.

var path = require('path');
var http = require('http');
var crypto = require('crypto');
var cp = require('child_process');
var BASE = path.join(__dirname, '..');
var CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME) { console.log('IDA-UI browser: SKIPPED (no Chrome on this host)'); process.exit(0); }
process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
process.env.IDAUTO_ADMIN_IDENTITIES = '{}';
var db = require(path.join(BASE, 'reference', 'db.js'));
var pass = 0, fail = 0; function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function get(u) { return new Promise(function (r, j) { http.get(u, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { try { r(JSON.parse(Buffer.concat(c))); } catch (e) { j(e); } }); }).on('error', j); }); }

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var ORG = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier UI ' + run])).rows[0].id;
  var ORG2 = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Atelier UI B ' + run])).rows[0].id;
  var server = require(path.join(BASE, 'reference', 'api.js')).createServer(); await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var B = 'http://127.0.0.1:' + server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = B;
  var auth = require(path.join(BASE, 'reference', 'auth', 'auth.js')).getAuth();
  var PW = 'Ui-Browser-' + crypto.randomBytes(6).toString('hex') + '-1';
  var U = { manager: 'ui-mgr-' + run.toLowerCase() + '@idauto.test', technician: 'ui-tech-' + run.toLowerCase() + '@idauto.test', other: 'ui-oth-' + run.toLowerCase() + '@idauto.test', admin: 'ui-adm-' + run.toLowerCase() + '@idauto.test' };
  var ROLE = { manager: ['manager', ORG], technician: ['technician', ORG], other: ['manager', ORG2], admin: ['admin', null] };
  for (var k of Object.keys(U)) { var u = await auth.api.signUpEmail({ body: { email: U[k], password: PW, name: 'UI ' + k + ' ' + run } }); await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [ROLE[k][0], ROLE[k][1], u.user.id]); }
  var S = crypto.randomInt(100, 999), N = crypto.randomInt(1000, 9999);
  while ((await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [S + ' TUN ' + N])).rows.length) { S = crypto.randomInt(100, 999); N = crypto.randomInt(1000, 9999); }
  var MAKE = 'UIB' + run, OWNER = 'PROPRIETAIRE ' + run, PHONE = '+216 9' + crypto.randomInt(1000000, 9999999);

  var port = 9300 + Math.floor(Math.random() * 90);
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--window-size=1440,1000', '--user-data-dir=/tmp/idauto-ui-e2e-' + process.pid, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} });
  var targets = null; for (var a = 0; a < 40 && !targets; a++) { await sleep(750); try { targets = await get('http://127.0.0.1:' + port + '/json'); } catch (e) {} }
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl), id = 0, pending = {}, errors = [];
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(String(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 200));
    if (d.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); };
  await new Promise(function (r) { ws.onopen = r; });
  function send(m, p) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); }); }
  async function ev(e) { var r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  async function waitFor(e, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { try { if (await ev(e)) return true; } catch (x) {} await sleep(300); } return false; }
  async function go(p, ready) { await send('Page.navigate', { url: B + p }); return waitFor('document.readyState === "complete"' + (ready ? ' && (' + ready + ')' : ''), 30000); }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  async function signIn(who, next) {
    // Better Auth rate-limits sign-in per client IP; each sign-in of this test is its own client.
    await send('Network.setExtraHTTPHeaders', { headers: { 'X-Real-IP': '10.83.' + crypto.randomInt(1, 250) + '.' + crypto.randomInt(1, 250) } });
    await send('Network.clearBrowserCookies');
    // A real sign-out keeps the language cookie: put it back after clearing the session.
    if (LANG_NOW) await send('Network.setCookie', { name: 'ida_lang', value: LANG_NOW, url: B });
    await go('/login?next=' + encodeURIComponent(next), '!!document.querySelector("#login-form[data-ready]")');
    await ev('document.querySelector("#login-email").value=' + JSON.stringify(U[who]) + ';document.querySelector("#login-password").value=' + JSON.stringify(PW) + ';document.querySelector("#login-submit").click()');
    return waitFor('location.pathname === ' + JSON.stringify(next.split('?')[0]) + ' && document.readyState === "complete" && !!document.querySelector(".ida-admin-nav-link")', 45000);
  }
  var LANG_NOW = null;
  var NAVLABELS = '(function(){return Array.from(document.querySelectorAll(".ida-admin-nav-link")).map(function(a){return a.textContent.trim()})})()';

  console.log('== SHELL (manager, 1440 px)');
  ok(await signIn('manager', '/atelier/tableau-de-bord'), 'the manager signs in and lands on the dashboard');
  var nav = await ev(NAVLABELS);
  ok(nav.indexOf('Ajouter un véhicule') !== -1 && nav.indexOf('Interventions') !== -1 && nav.indexOf('Techniciens') !== -1 && nav.indexOf('Utilisateurs') === -1 && nav.indexOf('Journal d’activité et audit') === -1, 'role-filtered menu: workshop items, no administration (' + nav.length + ' items)');
  ok(await ev('!!document.querySelector("[data-app-topbar] #app-search") && !!document.querySelector("[data-app-lang]") && !!document.querySelector(".ida-app-bell") && !!document.querySelector(".ida-app-profile")'), 'top bar: search, notifications, language, profile');
  ok(await ev('document.querySelector(".ida-admin-nav-link.is-active").getAttribute("aria-current") === "page" && /Tableau de bord/.test(document.querySelector(".ida-admin-nav-link.is-active").textContent)'), 'the current page is marked (aria-current)');
  ok(await waitFor('/\\d/.test(document.getElementById("stats").textContent)', 20000), 'dashboard: real counts');
  ok(await ev('JSON.stringify(Array.from(document.querySelectorAll("#stats a")).map(function(a){return a.getAttribute("href")})) === JSON.stringify(["/atelier/vehicules","/atelier/vehicules?with_data=1","/atelier/ateliers","/atelier/interventions","/atelier/pieces-remplacees"])'), 'dashboard: exactly the five numbers, each linked to its list');
  ok(await ev('fetch("/api/workspace/overview",{credentials:"same-origin",headers:{"X-IDauto-Session":"1"}}).then(function(r){return r.json()}).then(function(o){var v=Array.from(document.querySelectorAll("#stats .ida-admin-stat-value")).map(function(x){return Number(x.textContent)});return JSON.stringify(v)===JSON.stringify([o.vehicles,o.vehicles_with_data,o.workshops,o.interventions,o.parts])})'), 'dashboard: the numbers shown are the database counts');
  ok(await ev('JSON.stringify(Array.from(document.querySelectorAll(".ida-admin-nav-heading")).map(function(x){return x.textContent.trim()})) === JSON.stringify(["Tableau de bord","Véhicules","Ateliers","Pièces","Paramètres"])'), 'menu: the five sections, in order');

  console.log('\n== MANUAL REGISTRATION');
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  ok(await ev('!document.querySelector("[data-cg-root]") && !/Scanner la carte grise/.test(document.body.textContent) && !/tesseract/i.test(Array.from(document.scripts).map(function(s){return s.src}).join(" "))'), 'no OCR scanner on the registration page (no Tesseract loaded)');
  await ev('document.getElementById("register-submit").click()');
  ok(await waitFor('/obligatoire|Indiquez l/.test(document.getElementById("form-errors").textContent)', 5000) && await ev('document.getElementById("f-make").getAttribute("aria-invalid") === "true"'), 'empty form: the missing fields are named and marked aria-invalid');
  var CARD = 'window.__card = function (txt, w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.fillStyle = "#f4efe2"; x.fillRect(0, 0, w, h); x.fillStyle = "#222"; x.font = "40px sans-serif"; x.fillText(txt, 40, 100); return new Promise(function (r) { c.toBlob(function (b) { r(new File([b], "face.png", { type: "image/png" })); }, "image/png"); }); };' +
    'window.__feed = function (sel, f) { var i = document.querySelector(sel); var dt = new DataTransfer(); dt.items.add(f); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); }; true';
  await ev(CARD);
  await ev('window.__card("TROP PETITE", 300, 200).then(function (f) { window.__feed("[data-file=\\"1\\"]", f); return true; })');
  ok(await waitFor('/trop petite/i.test(document.querySelector("[data-face-msg=\\"1\\"]").textContent)', 8000), 'a photo too small to read is refused before upload');
  await ev('window.__card("CARTE GRISE FACE 1 SPECIMEN", 1600, 1000).then(function (f) { window.__feed("[data-file=\\"1\\"]", f); return true; })');
  await ev('window.__card("CARTE GRISE FACE 2 SPECIMEN", 1600, 1000).then(function (f) { window.__feed("[data-file=\\"2\\"]", f); return true; })');
  ok(await waitFor('document.querySelectorAll(".ida-face-preview img").length === 2', 10000), 'both faces previewed before sending');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(String(S)) + ';f.plate_number.value=' + JSON.stringify(String(N)) + ';f.make.value=' + JSON.stringify(MAKE) +
    ';f.model.value="208";f.year.value="2019";f.fuel_type.value="petrol";f.engine_cc.value="1199";f.seats.value="5";f.owner_full_name.value=' + JSON.stringify(OWNER) + ';f.owner_phone.value=' + JSON.stringify(PHONE) + ';true');
  await ev('document.getElementById("register-submit").click()');
  ok(await waitFor('location.pathname === "/atelier/vehicule" && /created=1/.test(location.search)', 30000), 'registered → the new dossier opens');
  var IVID = await ev('new URLSearchParams(location.search).get("ref")');
  ok(/^ivid:1:/.test(IVID || ''), 'with its IVID (' + IVID + ')');
  ok(await waitFor('document.querySelectorAll("#sec-docs-box img").length === 2', 20000), 'dossier: both carte grise photos shown (private store, blobs)');
  var docs = (await db.query('SELECT count(*)::int n, max(org_id) o FROM idauto_vehicle_documents d JOIN idauto_vehicles v ON v.id = d.vehicle_id WHERE v.ivid = $1', [IVID])).rows[0];
  ok(docs.n === 2 && docs.o === ORG, 'both faces stored for the workshop');
  ok(await ev('/' + MAKE + '/.test(document.getElementById("sec-identity-box").textContent) && /1199/.test(document.getElementById("sec-identity-box").textContent)'), 'identity section shows the typed values');
  var bodyBefore = await ev('document.body.textContent');
  ok(bodyBefore.indexOf(OWNER) === -1 && bodyBefore.indexOf(PHONE) === -1, 'the owner contact is NOT displayed until asked for');
  var readsBefore = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.owner.read' AND target_ref = $1", [IVID])).rows[0].n;
  await ev('document.getElementById("owner-show").click()');
  ok(await waitFor('document.getElementById("owner-body").textContent.indexOf(' + JSON.stringify(OWNER) + ') !== -1', 10000), 'on request the owner\'s name and phone appear');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.owner.read' AND target_ref = $1", [IVID])).rows[0].n === readsBefore + 1, 'and that read is audited');
  // duplicate
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(String(S)) + ';f.plate_number.value=' + JSON.stringify(String(N)) + ';f.make.value="AUTRE";document.getElementById("register-submit").click();true');
  ok(await waitFor('/existe déjà/.test(document.getElementById("form-errors").textContent) && !!document.querySelector("#form-errors a[href*=\\"vehicule?ref=\\"]")', 15000), 'the same plate again → « existe déjà », with a link to its dossier (no duplicate)');
  // régime suspensif: same shape as TU (series RS number), chosen by the radio button
  var RS_S = String(100 + Math.floor(Math.random() * 899)), RS_N = String(1000 + Math.floor(Math.random() * 8999));
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  await ev('document.querySelector("input[name=plate_type][value=RS]").click();true');
  ok(await ev('document.querySelector("[data-plate-word]").textContent === "RS" && !document.getElementById("f-plate-series").closest("[hidden]")'), 'RS chosen: the plate reads series RS number');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(RS_S) + ';f.plate_number.value=' + JSON.stringify(RS_N) + ';f.make.value="RSTEST";document.getElementById("register-submit").click();true');
  ok(await waitFor('location.pathname === "/atelier/vehicule" && /created=1/.test(location.search)', 30000), 'an RS vehicle registers from the form');
  ok((await db.query("SELECT count(*)::int n FROM idauto_plates WHERE plate_number = $1", [RS_S + ' RS ' + RS_N])).rows[0].n === 1, 'with the plate ' + RS_S + ' RS ' + RS_N);

  console.log('\n== INTERVENTION AND PART SOURCE');
  await go('/atelier/interventions?new=1&vehicle=' + encodeURIComponent(IVID), '!!document.getElementById("new-dialog") && document.getElementById("new-dialog").open && /Véhicule choisi/.test(document.getElementById("n-results").textContent)');
  await ev('document.getElementById("n-reason").value="ENTRETIEN ' + run + '";document.querySelector("#new-form button[type=submit]").click();true');
  ok(await waitFor('!document.getElementById("detail-box").hidden && !document.getElementById("op-form").hidden', 15000), 'intervention opened from the dossier; the operation form shows');
  await ev('document.getElementById("op-type").value="replacement";document.getElementById("op-part").value="FILTRE A HUILE";document.getElementById("op-ref").value="OC 90";document.querySelector("#op-form button[type=submit]").click();true');
  ok(await waitFor('/provenance/i.test(document.getElementById("op-errors").textContent)', 5000), 'a part without its source → « Choisissez la provenance de la pièce »');
  ok(await ev('document.querySelectorAll("#op-source input[type=radio]").length === 3'), 'three radio buttons for the source');
  await ev('document.querySelector("#op-source input[value=customer_supplied]").click();document.querySelector("input[name=part_condition][value=new]").click();document.querySelector("#op-form button[type=submit]").click();true');
  ok(await waitFor('/FILTRE A HUILE/.test(document.getElementById("detail").textContent) && /fournie par le client/.test(document.getElementById("detail").textContent)', 15000), 'the operation is listed with its part and « Pièce fournie par le client »');
  var op = (await db.query("SELECT op.part_source, op.part_condition, op.status, op.created_by FROM idauto_workshop_operations op JOIN idauto_workshop_visits w ON w.id = op.visit_id JOIN idauto_vehicles v ON v.id = w.vehicle_id WHERE v.ivid = $1", [IVID])).rows[0];
  ok(op && op.part_source === 'customer_supplied' && op.part_condition === 'new' && op.status === 'done' && /^user:/.test(op.created_by), 'stored: source, condition, done, the technician\'s identity');
  await go('/atelier/pieces-remplacees', '/FILTRE A HUILE/.test(document.getElementById("list").textContent)');
  ok(await ev('/fournie par le client \\(déclarée\\)/i.test(document.getElementById("list").textContent)'), '« Pièces posées » lists it with its declared source');
  ok(await ev('/\\(déclarée\\)/.test(document.getElementById("list").textContent) && document.querySelectorAll("#totals a").length >= 4'), 'shown as a declaration, with the totals per source');

  console.log('\n== WORKSHOP PAGE');
  await go('/atelier/ateliers', '/[?&]id=/.test(location.search) && !document.getElementById("detail-box").hidden && document.querySelectorAll("#vehicles tbody tr").length >= 1');
  ok(await ev('/[?&]id=' + ORG + '(&|$)/.test(location.search)'), 'a manager opening « Ateliers » lands on its own workshop');
  ok(await ev('document.getElementById("vehicles").textContent.indexOf(' + JSON.stringify(MAKE) + ') !== -1 && /ENTRETIEN/.test(document.getElementById("repairs").textContent) && /FILTRE A HUILE/.test(document.getElementById("repairs").textContent)'), 'it shows the vehicle worked on and the repair, with its part');
  ok(await ev('!document.getElementById("tech-box").hidden'), 'and, for a manager, its technicians');
  await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), '/FILTRE A HUILE/.test(document.getElementById("sec-history-box").textContent)');
  ok(await ev('/Technicien/.test(document.getElementById("sec-history-box").textContent)'), 'the dossier\'s history shows the operation and its technician');

  console.log('\n== GLOBAL SEARCH');
  await ev('var i=document.getElementById("app-search");i.value=' + JSON.stringify(S + 'TU' + N) + ';i.dispatchEvent(new Event("input",{bubbles:true}));true');
  ok(await waitFor('document.querySelectorAll("#app-search-results [role=option]").length >= 1 && /Véhicules/.test(document.getElementById("app-search-results").textContent)', 10000), 'typing the plate without spaces → grouped results');
  await ev('var i=document.getElementById("app-search");i.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));true');
  ok(await waitFor('location.pathname === "/atelier/vehicule" && document.readyState === "complete" && !!document.getElementById("app-search")', 15000), 'keyboard ↓ + Enter opens the dossier');
  await ev('var i=document.getElementById("app-search");i.value=' + JSON.stringify(OWNER.toLowerCase().slice(0, 12)) + ';i.dispatchEvent(new Event("input",{bubbles:true}));true');
  ok(await waitFor('/Propriétaires/.test(document.getElementById("app-search-results").textContent)', 10000), 'the owner is found by name (own workshop)');

  console.log('\n== ROLES');
  ok(await signIn('technician', '/atelier/tableau-de-bord'), 'the technician signs in');
  var tnav = await ev(NAVLABELS);
  ok(tnav.indexOf('Techniciens') === -1 && tnav.indexOf('Interventions') !== -1, 'technician menu: no team page');
  await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), '!!document.getElementById("owner-show")');
  await ev('document.getElementById("owner-show").click()');
  ok(await waitFor('document.getElementById("owner-body").textContent.indexOf(' + JSON.stringify(OWNER) + ') !== -1', 10000), 'the technician of the same workshop can read the owner (owner decision)');
  ok(await ev('!document.querySelector("#sec-docs-box button.ida-btn--ghost")'), 'but cannot delete a carte grise photo (no document:delete)');
  ok(await signIn('other', '/atelier/tableau-de-bord'), 'a manager of ANOTHER workshop signs in');
  await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), '!!document.getElementById("sec-history-box")');
  var ob = await ev('document.body.textContent');
  ok(ob.indexOf(OWNER) === -1 && !(await ev('!!document.getElementById("owner-show")')) && ob.indexOf('FILTRE A HUILE') === -1 && (await ev('document.querySelectorAll("#sec-docs-box img").length')) === 0, 'another workshop sees the vehicle, but not its owner, history or photos');
  await send('Network.clearBrowserCookies');
  ok(await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), 'location.pathname === "/login"'), 'signed out, a workshop page redirects to /login');

  console.log('\n== FRENCH / ARABIC');
  ok(await signIn('manager', '/atelier/tableau-de-bord'), 'signed in again');
  await ev('var s=document.querySelector("[data-app-lang]");s.value="ar";s.dispatchEvent(new Event("change",{bubbles:true}));true');
  ok(await waitFor('document.documentElement.lang === "ar" && document.documentElement.dir === "rtl"', 15000), 'the selector switches to Arabic: lang=ar, dir=rtl (served by the server)');
  LANG_NOW = 'ar';
  ok(await waitFor('/لوحة القيادة/.test(document.querySelector("h1").textContent)', 10000), 'the page is in Arabic');
  var LEFT = '(function(){var SKIP="script,style,code,bdi,kbd,samp,.ida-plate,.ida-ivid,[translate=no],[data-i18n-skip],option[lang]";var out=[];var tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;while((n=tw.nextNode())){var v=n.nodeValue.replace(/\\s+/g," ").trim();if(!/\\b[a-zàâçéèêëîïôûùüÿœ]{3,}\\b[^]*\\b[a-zàâçéèêëîïôûùüÿœ]{3,}\\b/.test(v))continue;var e=n.parentElement;if(!e||e.closest(SKIP)||e.closest("[hidden]"))continue;out.push(v.slice(0,80));}return out;})()';
  var pagesAr = ['/atelier/tableau-de-bord', '/atelier/vehicules', '/atelier/vehicules/nouveau', '/atelier/vehicule?ref=' + encodeURIComponent(IVID), '/atelier/interventions', '/atelier/pieces-remplacees', '/atelier/documents', '/atelier/techniciens', '/atelier/catalogue', '/atelier/compte', '/atelier/ateliers?id=' + ORG, '/atelier'];
  var leftovers = [];
  for (var pa of pagesAr) { await go(pa); await sleep(1800); var l = await ev(LEFT); if (l.length) leftovers.push(pa + ': ' + l.slice(0, 3).join(' | ')); ok(await ev('document.documentElement.dir === "rtl"'), 'Arabic persists on ' + pa.split('?')[0]); }
  ok(leftovers.length === 0, 'no interface text left in French on ' + pagesAr.length + ' pages' + (leftovers.length ? ' — ' + leftovers.join(' ; ') : ''));
  ok(await signIn('manager', '/atelier/compte') && await ev('document.documentElement.dir === "rtl" && document.getElementById("pref-lang").value === "ar"'), 'the choice survives sign-out and sign-in');
  await ev('var s=document.getElementById("pref-lang");s.value="fr";s.dispatchEvent(new Event("change",{bubbles:true}));true');
  ok(await waitFor('document.documentElement.lang === "fr" && document.documentElement.dir !== "rtl" && /Mon compte/.test(document.querySelector("h1").textContent)', 15000), 'back to French from « Mon compte »');

  console.log('\n== RESPONSIVE (FR and AR)');
  var widths = [1920, 1440, 1366, 1024, 768, 390, 375], pagesR = ['/atelier/tableau-de-bord', '/atelier/vehicules/nouveau', '/atelier/vehicule?ref=' + encodeURIComponent(IVID), '/atelier/interventions', '/atelier/pieces-remplacees', '/atelier/ateliers?id=' + ORG];
  var over = [], wrongPage = [], measured = 0;
  for (var lang of ['fr', 'ar']) {
    await send('Network.setCookie', { name: 'ida_lang', value: lang, url: B });
    for (var w of widths) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
      for (var pr of pagesR) { await go(pr); await sleep(900); var here = await ev('location.pathname'); if (here !== pr.split('?')[0]) { wrongPage.push(lang + ' ' + w + ' ' + pr.split('?')[0] + ' → ' + here); continue; } measured++; var o = await ev('document.documentElement.scrollWidth - window.innerWidth'); if (o > 1) over.push(lang + ' ' + w + ' ' + pr.split('?')[0] + ' +' + o + 'px'); }
    }
  }
  ok(wrongPage.length === 0 && measured === pagesR.length * widths.length * 2, 'every responsive check ran on its own page, signed in (' + measured + ' measured' + (wrongPage.length ? '; ' + wrongPage.slice(0, 3).join(', ') : '') + ')');
  ok(over.length === 0, 'no horizontal scroll on ' + pagesR.length + ' pages × ' + widths.length + ' widths × 2 languages' + (over.length ? ' — ' + over.slice(0, 6).join(', ') : ''));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Network.setCookie', { name: 'ida_lang', value: 'fr', url: B });
  if (!(await go('/atelier/tableau-de-bord', '!!document.querySelector(".ida-admin-shell[data-mode]")'))) console.log('  (debug) ' + await ev('location.href + " " + document.title + " " + document.body.textContent.slice(0, 200)'));
  ok(await ev('document.querySelector(".ida-admin-shell").getAttribute("data-mode") === "drawer" && document.querySelector("[data-admin-sidebar]").hasAttribute("inert")'), 'phone: the sidebar is a closed drawer (inert)');
  await ev('document.querySelector(".ida-admin-menu-btn").click()');
  ok(await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "open" && !document.querySelector("[data-admin-sidebar]").hasAttribute("inert") && document.activeElement && document.activeElement.closest("[data-admin-sidebar]") !== null', 5000), 'the menu button opens it and moves focus inside');
  await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  ok(await waitFor('document.querySelector(".ida-admin-shell").getAttribute("data-drawer") === "closed"', 5000), 'Escape closes it');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("f-make")');
  await ev('document.getElementById("f-make").focus()');
  ok(await ev('(function(){var s=getComputedStyle(document.activeElement);return s.outlineStyle !== "none" || s.boxShadow !== "none";})()'), 'a focused field shows a visible focus indicator');

  ok(errors.length === 0, 'no JavaScript error on any page (' + errors.length + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : '') + ')');
  console.log('\nIDA-UI browser (headless Chrome, synthetic data): ' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
