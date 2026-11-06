#!/usr/bin/env node
'use strict';
// Client restructuring (2026-11-06) — the behaviour that changed, end to end on a scratch database:
//   1. dashboard: five numbers, each equal to the database count AND to the total of the list it links to;
//   2. workshops: list and detail, own workshop only (admin: all not cancelled), contact e-mail never returned;
//   3. parts: totals per declared source (including « not recorded »), scope, workshop filter;
//   4. navigation: the five sections, and every page of the previous menu still reachable.
// Roles use the REAL scope lists of reference/auth/principal.js.

var path = require('path');
var http = require('http');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var principal = require(path.join(BASE, 'reference', 'auth', 'principal.js'));
var T = {}; ['ADMIN', 'MGR', 'TECH', 'OTHER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex');
var ids = {};
ids[T.ADMIN] = 'usr_admin_rs_' + run;
ids[T.MGR] = { actor_ref: 'svc_rs_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_rs_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_rs_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;

function request(method, p, token, body) {
  return new Promise(function (resolve, reject) {
    var payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    var headers = { 'Content-Length': payload ? payload.length : 0 };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = []; res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
async function n(sql, params) { return (await db.query(sql, params || [])).rows[0].n; }
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b) }; }
}
var PART = '(op.part_id IS NOT NULL OR op.part_label IS NOT NULL OR op.part_reference_text IS NOT NULL)';

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status, contact_email, address_city) VALUES ('Garage RS A " + run + "','garage','active','contact-a-" + run + "@example.tn','Tunis') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage RS B " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgC = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage RS C " + run + "','garage','cancelled') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  // Data: two vehicles registered by workshop A, one by B, one bare record (plate-only style: no field at all).
  var MAKE = 'RST' + run.toUpperCase();
  var v1 = (await request('POST', '/api/vehicles/register', T.MGR, { plate: await freePlate(), make: MAKE, model: 'UN', year: '2018' })).body.ivid;
  var v2 = (await request('POST', '/api/vehicles/register', T.TECH, { plate: await freePlate(), make: MAKE, model: 'DEUX' })).body.ivid;
  var v3 = (await request('POST', '/api/vehicles/register', T.OTHER, { plate: await freePlate(), make: MAKE, model: 'TROIS' })).body.ivid;
  await db.query('INSERT INTO idauto_vehicles (internal_ref, fiche_status) VALUES ($1, $2)', ['RS-BARE-' + run, 'initial']);
  var visA = (await request('POST', '/api/workshop/visits', T.TECH, { vehicle_ref: v1, reason: 'Révision ' + run })).body.visit.id;
  var visB = (await request('POST', '/api/workshop/visits', T.OTHER, { vehicle_ref: v3, reason: 'Freins ' + run })).body.visit.id;
  for (var src of ['our_shop', 'customer_supplied', 'external_supplier'])
    ok((await request('POST', '/api/workshop/visits/' + visA + '/operations', T.TECH, { operation_type: 'replacement', description: 'Pose ' + src, part_label: 'Pièce ' + src + ' ' + run, part_source: src, quantity: 1 })).status === 201, 'part recorded with source ' + src);
  // An operation recorded before the source existed (IDA-V12): no source. Inserted as the old code wrote it.
  await db.query("INSERT INTO idauto_workshop_operations (visit_id, operation_type, description, quantity, status, created_by) VALUES ($1, 'replacement', $2, 1, 'done', 'legacy')", [visA, 'Ancienne pose ' + run]);
  await db.query('UPDATE idauto_workshop_operations SET part_label = $1 WHERE description = $2', ['Pièce sans provenance ' + run, 'Ancienne pose ' + run]);
  await request('POST', '/api/workshop/visits/' + visA + '/operations', T.TECH, { operation_type: 'service', description: 'Contrôle sans pièce ' + run, quantity: 1 });
  await request('POST', '/api/workshop/visits/' + visB + '/operations', T.OTHER, { operation_type: 'replacement', part_label: 'Plaquettes B ' + run, part_source: 'our_shop' });

  say('\n1. DASHBOARD — five numbers, each = the database = the list it links to');
  var adm = (await request('GET', '/api/workspace/overview', T.ADMIN)).body;
  ok(adm.scope === 'all_workshops' && ['vehicles', 'vehicles_with_data', 'workshops', 'interventions', 'parts'].every(function (k) { return Number.isInteger(adm[k]); }), 'admin: the five numbers are present');
  ok(adm.vehicles === await n('SELECT count(*)::int n FROM idauto_vehicles WHERE merged_into_id IS NULL'), 'vehicles = every vehicle in the database (' + adm.vehicles + ')');
  ok(adm.workshops === await n("SELECT count(*)::int n FROM idauto_organizations WHERE status <> 'cancelled'"), 'workshops = organisations not cancelled (' + adm.workshops + ')');
  ok(adm.interventions === await n('SELECT count(*)::int n FROM idauto_workshop_visits'), 'interventions = every recorded intervention (' + adm.interventions + ')');
  ok(adm.parts === await n('SELECT count(*)::int n FROM idauto_workshop_operations op WHERE ' + PART), 'parts = every operation that records a part (' + adm.parts + '), not the catalogue');
  ok(adm.vehicles_with_data < adm.vehicles, 'a bare record does not count as « with data » (' + adm.vehicles_with_data + ' < ' + adm.vehicles + ')');
  var la = (await request('GET', '/api/workspace/vehicles', T.ADMIN)).body, lad = (await request('GET', '/api/workspace/vehicles?with_data=1', T.ADMIN)).body;
  ok(la.total === adm.vehicles && lad.total === adm.vehicles_with_data && lad.with_data === true, 'the vehicle list totals match both numbers (all / with data)');
  ok((await request('GET', '/api/workspace/parts-used', T.ADMIN)).body.total === adm.parts, 'the parts list total matches the parts number');
  ok((await request('GET', '/api/workspace/workshops', T.ADMIN)).body.workshops.length === adm.workshops, 'the workshop list matches the workshops number');
  var mg = (await request('GET', '/api/workspace/overview', T.MGR)).body;
  ok(mg.scope === 'own_workshop' && mg.workshops === 1, 'manager: own workshop only, one workshop');
  ok(mg.interventions === await n('SELECT count(*)::int n FROM idauto_workshop_visits WHERE org_id = $1', [orgA]) && mg.parts === 4, 'manager: interventions and parts of workshop A only (' + mg.interventions + ', ' + mg.parts + ')');
  var lm = (await request('GET', '/api/workspace/vehicles', T.MGR)).body, lmd = (await request('GET', '/api/workspace/vehicles?with_data=1', T.MGR)).body;
  ok(lm.total === mg.vehicles && lmd.total === mg.vehicles_with_data && mg.vehicles === 2, 'manager: vehicle numbers = the totals of its lists (' + mg.vehicles + ' vehicles)');
  ok(!('registered_30d' in adm) && !('interventions_open' in adm), 'no other indicator is returned');

  say('\n2. WORKSHOPS — name, vehicles, repairs and dates; own workshop only');
  var wa = (await request('GET', '/api/workspace/workshops', T.TECH)).body;
  ok(wa.scope === 'own_workshop' && wa.workshops.length === 1 && wa.workshops[0].id === orgA, 'a technician sees only its workshop');
  ok((await request('GET', '/api/workspace/workshops/' + orgB, T.TECH)).status === 404, 'another workshop → 404 (not 403: its existence is not confirmed)');
  ok((await request('GET', '/api/workspace/workshops/abc', T.TECH)).status === 404, 'a malformed id → 404');
  var wl = (await request('GET', '/api/workspace/workshops', T.ADMIN)).body.workshops.map(function (w) { return w.id; });
  ok(wl.indexOf(orgA) !== -1 && wl.indexOf(orgB) !== -1 && wl.indexOf(orgC) === -1, 'admin: every workshop except cancelled ones');
  var d = await request('GET', '/api/workspace/workshops/' + orgA, T.MGR);
  ok(d.status === 200 && d.body.workshop.name === 'Garage RS A ' + run && d.body.workshop.city === 'Tunis', 'detail: the workshop name and its recorded address');
  ok(d.body.vehicles.length === 1 && d.body.vehicles[0].ivid === v1 && d.body.vehicles[0].interventions === 1, 'detail: the vehicle it worked on, with its number of interventions');
  ok(d.body.interventions.length === 1 && d.body.interventions[0].id === visA && !!d.body.interventions[0].opened_at && d.body.interventions[0].operations.length === 5, 'detail: the repair, its date and its operations');
  ok(d.raw.indexOf('Freins ' + run) === -1 && d.raw.indexOf('Plaquettes B') === -1, 'detail: never another workshop\'s work');
  ok(d.raw.indexOf('contact-a-' + run) === -1 && d.body.workshop.contact_email_present === true, 'the contact e-mail is never returned (IDA-ADMIN-3), only that one is recorded');
  ok(Array.isArray(d.body.technicians), 'a manager sees the technicians (team:read)');
  ok((await request('GET', '/api/workspace/workshops/' + orgA, T.TECH)).body.technicians === null, 'a technician does not (no team:read): the field is null, not an empty list');
  ok((await request('GET', '/api/workspace/workshops')).status === 401, 'anonymous → 401');

  say('\n3. PARTS — declared source, totals, nothing invented');
  var pa = (await request('GET', '/api/workspace/parts-used', T.MGR)).body;
  ok(pa.totals.our_shop === 1 && pa.totals.customer_supplied === 1 && pa.totals.external_supplier === 1 && pa.totals.unknown === 1 && pa.total === 4, 'totals per source, the unrecorded one counted as « unknown »');
  ok(pa.parts.length === 4 && pa.parts.every(function (p) { return p.org_id === orgA; }) && JSON.stringify(pa).indexOf('Plaquettes B') === -1, 'workshop A sees its four parts only; the operation without a part is not a part');
  var pu = (await request('GET', '/api/workspace/parts-used?source=unknown', T.MGR)).body;
  ok(pu.parts.length === 1 && pu.parts[0].source === null && pu.parts[0].label === 'Pièce sans provenance ' + run, '« not recorded » lists the part with no source — it is not presented as any source');
  var ps = (await request('GET', '/api/workspace/parts-used?source=our_shop', T.MGR)).body;
  ok(ps.parts.length === 1 && ps.total === 4, 'a source filter narrows the list, the totals stay those of the scope');
  ok(pa.parts.every(function (p) { return !('price' in p) && !('unit_price' in p); }), 'no price is returned: none is recorded for a fitted part');
  var pb = (await request('GET', '/api/workspace/parts-used?org=' + orgB, T.ADMIN)).body;
  ok(pb.total === 1 && pb.parts.length === 1 && pb.parts[0].org_id === orgB, 'admin: ?org= gives one workshop\'s parts (the workshop page links there)');
  ok((await request('GET', '/api/workspace/parts-used?org=' + orgB, T.MGR)).body.parts.every(function (p) { return p.org_id === orgA; }), 'a manager cannot widen its scope with ?org=');
  var labels = require('fs').readFileSync(path.join(BASE, 'reference', 'admin-console.js'), 'utf8');
  ok(/our_shop: 'Pièce achetée auprès de notre établissement \(déclarée\)'/.test(labels), 'displayed as a declaration: « … notre établissement (déclarée) » (no sale is held)');

  say('\n4. NAVIGATION — five sections, nothing lost');
  var shell = require(path.join(BASE, 'reference', 'admin-shell.js'));
  var FIVE = ['Tableau de bord', 'Véhicules', 'Ateliers', 'Pièces', 'Paramètres'];
  ['admin', 'manager', 'technician'].forEach(function (r) { ok(JSON.stringify(shell.visible(r).map(function (s) { return s.label; })) === JSON.stringify(FIVE), r + ': the five sections, in order'); });
  var hrefs = shell.NAV.map(function (i) { return i.href; });
  ['/admin/dashboard', '/atelier/tableau-de-bord', '/admin/vehicles', '/atelier/vehicules', '/atelier/vehicules/nouveau', '/atelier/documents', '/atelier/interventions', '/atelier/pieces-remplacees', '/admin/maintenance',
    '/admin/sources', '/atelier/techniciens', '/atelier/catalogue', '/admin/utilisateurs', '/admin/roles', '/admin/quality', '/admin/review', '/admin', '/admin/security', '/atelier/compte']
    .forEach(function (h) { ok(hrefs.indexOf(h) !== -1, 'still in the menu: ' + h); });
  var page = await request('GET', '/atelier/ateliers', null);
  var asset = require(path.join(BASE, 'reference', 'v12-routes.js')).ATELIER_ASSETS['/atelier/ateliers'];
  ok(!!asset && asset.file === 'app-workshops.html' && page.status === 302, 'the workshop page exists and, signed out, sends to the sign-in page (' + page.status + ')');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); if (server) server.close(); process.exit(1); });
