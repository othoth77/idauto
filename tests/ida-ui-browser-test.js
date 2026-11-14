#!/usr/bin/env node
'use strict';
// IDA-UI — the redesigned application in a real browser (headless Chrome over CDP), on a scratch
// database: shell (sidebar + top bar), manual registration with carte grise photos, dossier,
// private owner contact, interventions with several parts and their source (IDA-UI-4), parts, global search,
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
  ok(JSON.stringify(await ev(NAVLABELS)) === JSON.stringify(['Tableau de bord', 'Véhicules', 'Interventions', 'Pièces', 'Paramètres']), 'the menu: five links, nothing else');
  ok(await ev('!!document.querySelector("[data-app-topbar] #app-search") && !!document.querySelector("[data-app-topbar] [data-lang-flag]") && !!document.querySelector(".ida-app-profile") && !document.querySelector(".ida-app-bell") && !document.querySelector("[data-theme-toggle]")'), 'top bar: search, language, profile (no notification bell, no theme switch)');
  ok(await ev('document.documentElement.getAttribute("data-theme") === "light"'), 'one light theme');
  ok(await ev('document.querySelector(".ida-admin-nav-link.is-active").getAttribute("aria-current") === "page" && /Tableau de bord/.test(document.querySelector(".ida-admin-nav-link.is-active").textContent)'), 'the current page is marked (aria-current)');
  ok(await waitFor('document.querySelectorAll("#stats a").length === 5', 20000), 'dashboard: five numbers');
  ok(await ev('JSON.stringify(Array.from(document.querySelectorAll("#stats a")).map(function(a){return a.getAttribute("href")})) === JSON.stringify(["/atelier/vehicules","/atelier/interventions","/atelier/pieces-remplacees","/atelier/pieces-remplacees?source=our_shop","/atelier/pieces-remplacees?source=customer_supplied"])'), 'each number opens its list');

  console.log('\n== VEHICLE: ADD, FILE, EDIT');
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  ok(await ev('!document.querySelector("[data-cg-root]") && !/tesseract/i.test(Array.from(document.scripts).map(function(s){return s.src}).join(" ")) && !document.getElementById("f-fuel") && !document.getElementById("f-cc")'), 'the simple form: no OCR, no technical fields beyond the request');
  ok(await ev('["f-plate-series","f-make","f-model","f-year","f-vin","f-km","f-notes","f-owner-name","f-owner-phone"].every(function(i){return !!document.getElementById(i)}) && document.querySelectorAll("[data-file]").length === 2'), 'fields: registration, make, model, year, VIN, mileage, notes, owner, face 1 / face 2');
  await ev('document.getElementById("register-submit").click()');
  ok(await waitFor('/immatriculation est obligatoire/i.test(document.getElementById("form-errors").textContent)', 5000), 'empty form: only the registration number is asked for');
  var CARD = 'window.__card = function (txt, w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.fillStyle = "#f4efe2"; x.fillRect(0, 0, w, h); x.fillStyle = "#222"; x.font = "40px sans-serif"; x.fillText(txt, 40, 80); return new Promise(function (r) { c.toBlob(function (b) { r(new File([b], "carte.png", { type: "image/png" })); }, "image/png"); }); };' +
    'window.__feed = function (sel, f) { var i = document.querySelector(sel); var dt = new DataTransfer(); dt.items.add(f); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); }; true';
  await ev(CARD);
  await ev('window.__card("CARTE GRISE FACE 1 SPECIMEN", 1600, 1000).then(function (f) { window.__feed("[data-file=\\"1\\"]", f); return true; })');
  await ev('window.__card("CARTE GRISE FACE 2 SPECIMEN", 1600, 1000).then(function (f) { window.__feed("[data-file=\\"2\\"]", f); return true; })');
  ok(await waitFor('document.querySelectorAll(".ida-face-preview img").length === 2', 10000), 'both faces previewed before sending');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(String(S)) + ';f.plate_number.value=' + JSON.stringify(String(N)) + ';f.make.value=' + JSON.stringify(MAKE) +
    ';f.model.value="208";f.year.value="2019";f.odometer_km.value="84 500";f.notes.value="Roue de secours neuve";f.owner_full_name.value=' + JSON.stringify(OWNER) + ';f.owner_phone.value=' + JSON.stringify(PHONE) + ';true');
  await ev('document.getElementById("register-submit").click()');
  ok(await waitFor('location.pathname === "/atelier/vehicule" && /created=1/.test(location.search)', 30000), 'registered → the vehicle file opens');
  var IVID = await ev('new URLSearchParams(location.search).get("ref")');
  ok(/^ivid:1:/.test(IVID || ''), 'with its IVID (' + IVID + ')');
  ok(await waitFor('document.querySelectorAll("#sec-docs-box img").length === 2', 20000), 'file: both carte grise photos shown (private store, blobs)');
  ok(await ev('/84\\s?500/.test(document.getElementById("sec-identity-box").textContent) && /Roue de secours neuve/.test(document.getElementById("sec-identity-box").textContent)'), 'file: mileage and notes');
  var bodyBefore = await ev('document.body.textContent');
  ok(bodyBefore.indexOf(OWNER) === -1 && bodyBefore.indexOf(PHONE) === -1, 'the owner contact is NOT displayed until asked for');
  var readsBefore = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.owner.read' AND target_ref = $1", [IVID])).rows[0].n;
  await ev('document.getElementById("owner-show").click()');
  ok(await waitFor('document.getElementById("owner-body").textContent.indexOf(' + JSON.stringify(OWNER) + ') !== -1', 10000), 'on request the owner\'s name and phone appear');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.owner.read' AND target_ref = $1", [IVID])).rows[0].n === readsBefore + 1, 'and that read is audited');
  await ev('document.getElementById("details-edit").click()');
  ok(await waitFor('document.getElementById("details-dialog").open && document.getElementById("d-model").value === "208"', 5000), '« Modifier » opens the file\'s form, filled');
  await ev('document.getElementById("d-model").value="208 GT";document.getElementById("d-km").value="85000";document.querySelector("#details-form button[type=submit]").click();true');
  ok(await waitFor('/208 GT/.test(document.getElementById("sec-identity-box").textContent) && /85\\s?000/.test(document.getElementById("sec-identity-box").textContent)', 10000), 'the edit is saved and shown');
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(String(S)) + ';f.plate_number.value=' + JSON.stringify(String(N)) + ';document.getElementById("register-submit").click();true');
  ok(await waitFor('/existe déjà/.test(document.getElementById("form-errors").textContent) && !!document.querySelector("#form-errors a[href*=\\"vehicule?ref=\\"]")', 15000), 'the same plate again → « existe déjà », with a link to its file (no duplicate)');
  var RS_S = String(100 + Math.floor(Math.random() * 899)), RS_N = String(1000 + Math.floor(Math.random() * 8999));
  await go('/atelier/vehicules/nouveau', '!!document.getElementById("register-form")');
  await ev('document.querySelector("input[name=plate_type][value=RS]").click();true');
  ok(await ev('document.querySelector("[data-plate-word]").textContent === "RS"'), 'RS chosen: the plate reads series RS number');
  await ev('var f=document.getElementById("register-form");f.plate_series.value=' + JSON.stringify(RS_S) + ';f.plate_number.value=' + JSON.stringify(RS_N) + ';document.getElementById("register-submit").click();true');
  ok(await waitFor('location.pathname === "/atelier/vehicule" && /created=1/.test(location.search)', 30000), 'a vehicle registers with its registration number alone (RS)');
  ok(await waitFor('!!document.getElementById("vehicle-delete")', 15000), 'the manager sees « Supprimer le véhicule »');
  await ev('document.getElementById("vehicle-delete").click();true');
  await waitFor('document.getElementById("confirm-dialog").open', 5000);
  await ev('document.getElementById("confirm-yes").click();true');
  ok(await waitFor('location.pathname === "/atelier/vehicules" && /supprimé/.test(document.getElementById("page-status").textContent)', 15000), 'deleted after confirmation → back to the list');
  ok((await db.query("SELECT fiche_status FROM idauto_vehicles v JOIN idauto_plates p ON p.vehicle_id = v.id WHERE p.plate_number = $1", [RS_S + ' RS ' + RS_N])).rows[0].fiche_status === 'archived', 'archived in the database, not erased');
  await go('/atelier/vehicules?q=' + encodeURIComponent('208 GT'), 'document.querySelectorAll("#list tbody tr").length >= 1');
  ok(await ev('document.getElementById("list").textContent.indexOf(' + JSON.stringify(MAKE) + ') !== -1 && /85\\s?000/.test(document.getElementById("list").textContent)'), 'the vehicle list finds it by model, with its mileage');

  console.log('\n== INTERVENTION WITH SEVERAL PARTS');
  await go('/atelier/interventions?new=1&vehicle=' + encodeURIComponent(IVID), '!document.getElementById("iv-form").hidden && /Véhicule choisi/.test(document.getElementById("vehicle-chosen").textContent)');
  ok(await ev('document.getElementById("f-date").value === new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)'), 'opened from the file: the vehicle is chosen, today\'s date is filled');
  await ev('document.getElementById("f-km").value="86200";document.getElementById("f-desc").value="VIDANGE ET PLAQUETTES ' + run + '";document.getElementById("add-part").click();document.getElementById("add-part").click();true');
  ok(await ev('document.querySelectorAll("#parts [data-part]").length === 2 && document.querySelectorAll("#parts [data-part]")[0].querySelectorAll("input[type=radio]").length === 2'), 'two part rows, each with two source choices');
  ok(await ev('/Achetée chez nous/.test(document.querySelector("#parts [data-source]").textContent) && /Fournie par le client/.test(document.querySelector("#parts [data-source]").textContent)'), 'the choices: « Achetée chez nous » / « Fournie par le client »');
  await ev('var r=document.querySelectorAll("#parts [data-part]");r[0].querySelector("[data-f=label]").value="FILTRE A HUILE";r[0].querySelector("[data-f=reference]").value="OC 90";r[1].querySelector("[data-f=label]").value="PLAQUETTES";document.querySelector("#iv-form button[type=submit]").click();true');
  ok(await waitFor('/provenance/i.test(document.getElementById("form-errors").textContent)', 5000), 'a part without its source → asked for');
  await ev('var r=document.querySelectorAll("#parts [data-part]");r[0].querySelector("input[value=our_shop]").click();r[1].querySelector("input[value=customer_supplied]").click();document.querySelector("#iv-form button[type=submit]").click();true');
  ok(await waitFor('/[?&]id=\\d+/.test(location.search) && /saved=1/.test(location.search) && !document.getElementById("iv-form").hidden', 20000), 'saved → the intervention opens, ready to edit');
  var VISIT = await ev('new URLSearchParams(location.search).get("id")');
  var stored = (await db.query("SELECT w.odometer_km, w.status, array_agg(op.part_source ORDER BY op.id) AS s FROM idauto_workshop_visits w JOIN idauto_workshop_operations op ON op.visit_id = w.id WHERE w.id = $1 GROUP BY w.id", [VISIT])).rows[0];
  ok(stored && stored.odometer_km === 86200 && stored.s.join() === 'our_shop,customer_supplied', 'stored: mileage and each part\'s source');
  ok(await ev('document.querySelectorAll("#parts [data-part]").length === 2 && document.querySelectorAll("#parts [data-part]")[0].querySelector("input[value=our_shop]").checked'), 'reopened: the parts and their source are filled');
  await ev('document.querySelectorAll("#parts [data-part]")[1].querySelector(".ida-part-remove").click();document.getElementById("add-part").click();var r=document.querySelectorAll("#parts [data-part]");r[1].querySelector("[data-f=label]").value="AMPOULE";r[1].querySelector("input[value=customer_supplied]").click();document.querySelector("#iv-form button[type=submit]").click();true');
  ok(await waitFor('/saved=1/.test(location.search) && document.querySelectorAll("#parts [data-part]").length === 2 && /AMPOULE/.test(Array.from(document.querySelectorAll("#parts [data-f=label]")).map(function(i){return i.value}).join(" "))', 20000), 'edit: one part removed, one added');
  await go('/atelier/interventions', 'document.querySelectorAll("#list tbody tr").length >= 1');
  ok(await ev('/VIDANGE ET PLAQUETTES/.test(document.getElementById("list").textContent) && /86\\s?200/.test(document.getElementById("list").textContent)'), 'the list shows it with its mileage and work done');

  console.log('\n== PARTS');
  await go('/atelier/pieces-remplacees', '/FILTRE A HUILE/.test(document.getElementById("list").textContent)');
  ok(await ev('JSON.stringify(Array.from(document.querySelectorAll("#list thead th")).map(function(x){return x.textContent.trim()})) === JSON.stringify(["Pièce","Référence","Véhicule","Date","Provenance"])'), 'columns: part, reference, vehicle, date, source');
  ok(await ev('/Achetée chez nous \\(déclarée\\)/.test(document.getElementById("list").textContent) && /Fournie par le client \\(déclarée\\)/.test(document.getElementById("list").textContent) && !/PLAQUETTES/.test(document.getElementById("list").textContent)'), 'each source shown as a declaration; the removed part is gone');
  await go('/atelier/pieces-remplacees?source=customer_supplied', '/AMPOULE/.test(document.getElementById("list").textContent)');
  ok(await ev('!/FILTRE A HUILE/.test(document.getElementById("list").textContent)'), 'filter by source');
  await ev('document.getElementById("f-source").value="";document.getElementById("f-q").value="OC 90";document.querySelector("#filter button[type=submit]").click();true');
  ok(await waitFor('/FILTRE A HUILE/.test(document.getElementById("list").textContent) && !/AMPOULE/.test(document.getElementById("list").textContent)', 10000), 'search by reference');

  console.log('\n== GLOBAL SEARCH');
  await go('/atelier/tableau-de-bord', '!!document.getElementById("app-search")');
  await ev('var i=document.getElementById("app-search");i.value=' + JSON.stringify(S + 'TU' + N) + ';i.dispatchEvent(new Event("input",{bubbles:true}));true');
  ok(await waitFor('document.querySelectorAll("#app-search-results [role=option]").length >= 1 && /Véhicules/.test(document.getElementById("app-search-results").textContent)', 10000), 'typing the plate without spaces → grouped results');

  console.log('\n== ROLES');
  // Password recovery: the sign-in page says the administrator resets it; the operator tool does, and the new password works.
  await send('Network.clearBrowserCookies');
  await go('/login', '!!document.querySelector("#login-form[data-ready]")');
  await ev('document.getElementById("login-forgot").click();true');
  ok(await waitFor('/administrateur/.test(document.body.textContent)', 5000), '« Mot de passe oublié » explains that the administrator resets it');
  var NEWPW = 'Reset-' + crypto.randomBytes(6).toString('hex') + '-9';
  var cli = cp.spawnSync(process.execPath, [path.join(BASE, 'ops', 'auth-users.js'), 'set-password', '--email', U.technician], { env: Object.assign({}, process.env, { IDAUTO_NEW_PASSWORD: NEWPW }), encoding: 'utf8' });
  ok(cli.status === 0, 'the administrator resets the password (ops/auth-users.js set-password)');
  var oldPW = PW; PW = NEWPW;
  ok(await signIn('technician', '/atelier/tableau-de-bord'), 'the technician signs in with the new password');
  PW = oldPW;
  cp.spawnSync(process.execPath, [path.join(BASE, 'ops', 'auth-users.js'), 'set-password', '--email', U.technician], { env: Object.assign({}, process.env, { IDAUTO_NEW_PASSWORD: PW }), encoding: 'utf8' });  // back to the test password
  ok(JSON.stringify(await ev(NAVLABELS)) === JSON.stringify(['Tableau de bord', 'Véhicules', 'Interventions', 'Pièces', 'Paramètres']), 'technician: the same five links');
  ok(await signIn('technician', '/atelier/tableau-de-bord'), 'the password is set back (the reset closes the sessions) and the technician signs in again');
  await go('/atelier/compte', '!!document.getElementById("profile") && !/Chargement/.test(document.getElementById("profile").textContent)');
  ok(await ev('document.getElementById("admin-box").hidden'), 'technician: no user or role management in Paramètres');
  await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), '!!document.getElementById("owner-show")');
  await ev('document.getElementById("owner-show").click()');
  ok(await waitFor('document.getElementById("owner-body").textContent.indexOf(' + JSON.stringify(OWNER) + ') !== -1', 10000), 'the technician of the same workshop can read the owner (owner decision)');
  ok(await ev('!document.querySelector("#sec-docs-box button.ida-btn--ghost")'), 'but cannot delete a carte grise photo (no document:delete)');
  ok(await signIn('other', '/atelier/tableau-de-bord'), 'a manager of ANOTHER workshop signs in');
  await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), '!!document.getElementById("sec-history-box")');
  var ob = await ev('document.body.textContent');
  ok(ob.indexOf(OWNER) === -1 && !(await ev('!!document.getElementById("owner-show")')) && ob.indexOf('FILTRE A HUILE') === -1 && ob.indexOf('Roue de secours') === -1 && (await ev('document.querySelectorAll("#sec-docs-box img").length')) === 0, 'another workshop sees the vehicle, but not its owner, notes, history or photos');
  ok(await signIn('admin', '/atelier/compte'), 'the administrator signs in');
  ok(await waitFor('!document.getElementById("admin-box").hidden && !!document.querySelector("#admin-box a[href=\\"/admin/utilisateurs\\"]") && !!document.querySelector("#admin-box a[href=\\"/admin/roles\\"]")', 10000), 'administrator: Paramètres links to users and roles');
  await go('/admin/utilisateurs', '!!document.querySelector(".ida-admin-nav-link.is-active")');
  ok(await ev('/Paramètres/.test(document.querySelector(".ida-admin-nav-link.is-active").textContent)'), 'the users page belongs to « Paramètres »');
  await send('Network.clearBrowserCookies');
  ok(await go('/atelier/vehicule?ref=' + encodeURIComponent(IVID), 'location.pathname === "/login"'), 'signed out, a workshop page redirects to /login');

  console.log('\n== FRENCH / ARABIC');
  ok(await signIn('manager', '/atelier/tableau-de-bord'), 'signed in again');
  await ev('document.querySelector("[data-app-topbar] [data-lang-flag]").click();true');
  ok(await waitFor('document.documentElement.lang === "ar" && document.documentElement.dir === "rtl"', 15000), 'the selector switches to Arabic: lang=ar, dir=rtl (served by the server)');
  LANG_NOW = 'ar';
  ok(await waitFor('/لوحة القيادة/.test(document.querySelector("h1").textContent)', 10000), 'the page is in Arabic');
  var LEFT = '(function(){var SKIP="script,style,code,bdi,kbd,samp,.ida-plate,.ida-ivid,[translate=no],[data-i18n-skip],option[lang]";var out=[];var tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;while((n=tw.nextNode())){var v=n.nodeValue.replace(/\\s+/g," ").trim();if(!/\\b[a-zàâçéèêëîïôûùüÿœ]{3,}\\b[^]*\\b[a-zàâçéèêëîïôûùüÿœ]{3,}\\b/.test(v))continue;var e=n.parentElement;if(!e||e.closest(SKIP)||e.closest("[hidden]"))continue;out.push(v.slice(0,80));}return out;})()';
  var pagesAr = ['/atelier/tableau-de-bord', '/atelier/vehicules', '/atelier/vehicules/nouveau', '/atelier/vehicule?ref=' + encodeURIComponent(IVID), '/atelier/interventions', '/atelier/interventions?new=1', '/atelier/interventions?id=' + VISIT, '/atelier/pieces-remplacees', '/atelier/compte'];
  var leftovers = [];
  for (var pa of pagesAr) { await go(pa); await sleep(1800); var l = await ev(LEFT); if (l.length) leftovers.push(pa + ': ' + l.slice(0, 3).join(' | ')); ok(await ev('document.documentElement.dir === "rtl"'), 'Arabic persists on ' + pa.split('?')[0]); }
  ok(leftovers.length === 0, 'no interface text left in French on ' + pagesAr.length + ' pages' + (leftovers.length ? ' — ' + leftovers.join(' ; ') : ''));
  ok(await signIn('manager', '/atelier/compte') && await ev('document.documentElement.dir === "rtl" && document.getElementById("pref-lang").value === "ar"'), 'the choice survives sign-out and sign-in');
  await ev('var s=document.getElementById("pref-lang");s.value="fr";s.dispatchEvent(new Event("change",{bubbles:true}));true');
  ok(await waitFor('document.documentElement.lang === "fr" && document.documentElement.dir !== "rtl" && /Paramètres/.test(document.querySelector("h1").textContent)', 15000), 'back to French from « Paramètres »');

  console.log('\n== RESPONSIVE (FR and AR)');
  var widths = [1920, 1440, 1366, 1024, 768, 390, 375], pagesR = ['/atelier/tableau-de-bord', '/atelier/vehicules', '/atelier/vehicules/nouveau', '/atelier/vehicule?ref=' + encodeURIComponent(IVID), '/atelier/interventions', '/atelier/interventions?id=' + VISIT, '/atelier/pieces-remplacees'];
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
  // Headless Chrome 153 does not give the page focus (document.hasFocus() is false), so :focus never matches; emulate a focused page.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await ev('document.getElementById("f-make").focus()');
  ok(await ev('(function(){var s=getComputedStyle(document.activeElement);return s.outlineStyle !== "none" || s.boxShadow !== "none";})()'), 'a focused field shows a visible focus indicator');

  ok(errors.length === 0, 'no JavaScript error on any page (' + errors.length + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : '') + ')');
  console.log('\nIDA-UI browser (headless Chrome, synthetic data): ' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); process.exit(1); });
