#!/usr/bin/env node
'use strict';
// IDA-UI-4 — simplification (2026-11-06), end to end on a scratch database:
//   1. vehicles: registration (plate only required), mileage, per-workshop note, editing the file;
//   2. interventions: one form with several parts, each with its declared source (two choices),
//      edit (update / cancel / add a part), cancel the intervention, workshop isolation;
//   3. parts: filter by source, search, cancelled ones never counted;
//   4. dashboard: five numbers = database counts = totals of the lists they open;
//   5. menu: five links; the pages that left the menu still answer.
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
ids[T.ADMIN] = 'usr_admin_s4_' + run;
ids[T.MGR] = { actor_ref: 'svc_s4_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_s4_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_s4_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
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
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { type: 'TU', series: String(a), number: String(b), canonical: a + ' TUN ' + b }; }
}
function today(dd) { var d = new Date(Date.now() - (dd || 0) * 86400000); return d.toISOString().slice(0, 10); }
var PARTS = "(op.part_id IS NOT NULL OR op.part_label IS NOT NULL OR op.part_reference_text IS NOT NULL) AND op.status <> 'cancelled' AND w.status <> 'cancelled'";

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage S4 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage S4 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  say('1. VEHICLES — registration, mileage, note, editing');
  var noPlate = await request('POST', '/api/vehicles/register', T.TECH, { make: 'X' });
  ok(noPlate.status === 400 && noPlate.body.details.reason === 'plate_required', 'the registration number is required');
  var P1 = await freePlate();
  var r1 = await request('POST', '/api/vehicles/register', T.TECH, { plate: P1 });
  ok(r1.status === 201 && /^ivid:1:/.test(r1.body.ivid), 'a plate alone is enough (no make, model, VIN, owner or photo imposed)');
  var P2 = await freePlate();
  var r2 = await request('POST', '/api/vehicles/register', T.TECH, { plate: P2, make: 'peugeot', model: '208', year: '2019', odometer_km: '84500', notes: 'Clé de secours ' + run,
    owner: { full_name: 'Client Simple ' + run, phone: '+216 20 444 555' } });
  var V2 = r2.body.ivid;
  ok(r2.status === 201 && r2.body.owner_recorded, 'the full simple form: make, model, year, mileage, note, owner');
  var dos = (await request('GET', '/api/vehicles/' + encodeURIComponent(V2) + '/dossier', T.TECH)).body;
  ok(dos.vehicle.make === 'PEUGEOT' && dos.vehicle.year === 2019 && dos.vehicle.odometer_km === 84500 && dos.vehicle.notes && dos.vehicle.notes.text === 'Clé de secours ' + run, 'the file shows them');
  ok(dos.vehicle.can_edit === true, 'the file says it can be edited');
  var dosB = (await request('GET', '/api/vehicles/' + encodeURIComponent(V2) + '/dossier', T.OTHER)).body;
  ok(dosB.vehicle.notes === null && JSON.stringify(dosB).indexOf('Clé de secours') === -1, 'another workshop never sees the note (one note per workshop)');
  ok((await request('GET', '/api/passport/' + encodeURIComponent(V2), T.ADMIN)).raw.indexOf('Clé de secours') === -1, 'nor does the passport');
  var ed = await request('PUT', '/api/vehicles/' + encodeURIComponent(V2) + '/details', T.TECH, { make: 'Peugeot', model: '208 GT', year: '2020', odometer_km: '85000', notes: 'Note corrigée ' + run });
  ok(ed.status === 200 && ed.body.fields_changed.join(',') === 'make,model,year,odometer_km,notes', 'the technician edits the file');
  var dos2 = (await request('GET', '/api/vehicles/' + encodeURIComponent(V2) + '/dossier', T.TECH)).body.vehicle;
  ok(dos2.model === '208 GT' && dos2.year === 2020 && dos2.odometer_km === 85000 && dos2.notes.text === 'Note corrigée ' + run, 'the change is saved');
  var aud = JSON.stringify((await db.query("SELECT change_summary, new_value_json FROM idauto_audit_log WHERE event_type = 'vehicle.details.update' AND target_ref = $1", [V2])).rows);
  ok(aud.indexOf('fields_changed') !== -1 && aud.indexOf('Note corrigée') === -1, 'the edit is audited, without the note\'s text');
  ok((await request('PUT', '/api/vehicles/' + encodeURIComponent(V2) + '/details', T.OTHER, { make: 'X' })).status === 404, 'another workshop cannot edit it (404)');
  ok((await request('PUT', '/api/vehicles/' + encodeURIComponent(V2) + '/details', T.TECH, { year: '1800' })).body.details.reason === 'out_of_range', 'an impossible year is refused');
  ok((await request('PUT', '/api/vehicles/' + encodeURIComponent(V2) + '/details', T.TECH, { odometer_km: 'abc' })).status === 400, 'a mileage that is not a number is refused');
  ok((await request('PUT', '/api/vehicles/' + encodeURIComponent(V2) + '/details', null, { make: 'X' })).status === 401, 'anonymous → 401');
  var list = (await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent('208 GT'), T.TECH)).body;
  ok(list.vehicles.some(function (v) { return v.ivid === V2 && v.odometer_km === 85000; }), 'search by model finds it, with its mileage');
  var byPlate = (await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(P2.series + 'TU' + P2.number), T.TECH)).body;
  ok(byPlate.vehicles.length === 1 && byPlate.vehicles[0].ivid === V2, 'search by registration number finds it');

  say('\n2. INTERVENTIONS — one form, several parts, declared source');
  var base = { vehicle_ref: V2, performed_on: today(1), odometer_km: '86200', description: 'Vidange + plaquettes ' + run };
  ok((await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { parts: [{ label: 'Filtre', source: 'external_supplier' }] }))).body.details.reason === 'choose_source', 'only two sources: « external supplier » is refused');
  ok((await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { parts: [{ label: 'Filtre' }] }))).body.details.field === 'parts[0].source', 'a part without its source is refused');
  ok((await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { parts: [{ source: 'our_shop' }] }))).body.details.field === 'parts[0].label', 'a part without its name is refused');
  ok((await request('POST', '/api/workspace/interventions', T.TECH, { vehicle_ref: V2 })).body.details.field === 'description', 'nothing done and no part → refused');
  ok((await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { performed_on: '2999-01-01' }))).body.details.field === 'performed_on', 'a date in the future is refused');
  ok((await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { technician: 'user:nobody' }))).body.details.reason === 'not_in_workshop', 'a technician outside the workshop is refused');
  var c1 = await request('POST', '/api/workspace/interventions', T.TECH, Object.assign({}, base, { parts: [
    { label: 'Filtre à huile ' + run, reference: 'OC 90', source: 'our_shop' }, { label: 'Plaquettes ' + run, reference: 'BP 12', quantity: 2, source: 'customer_supplied' }] }));
  ok(c1.status === 201 && c1.body.id, 'intervention recorded with two parts in one request');
  var IV = c1.body.id;
  var row = (await db.query('SELECT status, performed_on::text AS d, odometer_km, technician_ref, reason FROM idauto_workshop_visits WHERE id = $1', [IV])).rows[0];
  ok(row.status === 'closed' && row.d === today(1) && row.odometer_km === 86200 && row.technician_ref === ids[T.TECH].actor_ref && row.reason === base.description, 'stored: date, mileage, description, the technician who recorded it');
  var ops = (await db.query('SELECT part_label, part_source, quantity, status, operation_type FROM idauto_workshop_operations WHERE visit_id = $1 ORDER BY id', [IV])).rows;
  ok(ops.length === 2 && ops[0].part_source === 'our_shop' && ops[1].part_source === 'customer_supplied' && ops[1].quantity === 2 && ops.every(function (o) { return o.status === 'done' && o.operation_type === 'replacement'; }), 'each part stored with its source and quantity');
  ok((await db.query('SELECT odometer_km FROM idauto_vehicles v WHERE ivid = $1', [V2])).rows[0].odometer_km === 86200, 'the vehicle\'s mileage follows the intervention');
  var older = await request('POST', '/api/workspace/interventions', T.TECH, { vehicle_ref: V2, performed_on: today(30), odometer_km: '70000', description: 'Ancienne révision ' + run });
  ok(older.status === 201 && (await db.query('SELECT odometer_km FROM idauto_vehicles WHERE ivid = $1', [V2])).rows[0].odometer_km === 86200, 'an older intervention does not lower the vehicle\'s mileage');
  var got = (await request('GET', '/api/workspace/interventions?id=' + IV, T.TECH)).body.interventions[0];
  ok(got && got.odometer_km === 86200 && got.technician && got.operations.length === 2 && got.date, 'the intervention reads back: date, mileage, technician, parts');
  ok((await request('GET', '/api/workspace/interventions?id=' + IV, T.OTHER)).body.interventions.length === 0, 'another workshop does not see it');
  ok((await request('PUT', '/api/workspace/interventions/' + IV, T.OTHER, base)).status === 404, 'nor edit it (404)');
  ok((await request('DELETE', '/api/workspace/interventions/' + IV, T.OTHER)).status === 404, 'nor cancel it (404)');
  var s1 = (await request('GET', '/api/workspace/interventions?q=' + encodeURIComponent('plaquettes ' + run), T.TECH)).body;
  ok(s1.total === 1 && s1.interventions[0].id === IV, 'search by the work done finds it');
  var opIds = (await db.query("SELECT id FROM idauto_workshop_operations WHERE visit_id = $1 ORDER BY id", [IV])).rows.map(function (r) { return String(r.id); });
  var up = await request('PUT', '/api/workspace/interventions/' + IV, T.TECH, Object.assign({}, base, { odometer_km: '86300', parts: [
    { id: opIds[0], label: 'Filtre à huile ' + run, reference: 'OC 90', source: 'customer_supplied' }, { label: 'Ampoule ' + run, source: 'our_shop' }] }));
  ok(up.status === 200 && up.body.cancelled_parts === 1, 'edit: one part changed, one removed, one added');
  var ops2 = (await db.query('SELECT part_label, part_source, status FROM idauto_workshop_operations WHERE visit_id = $1 ORDER BY id', [IV])).rows;
  ok(ops2.length === 3 && ops2[0].part_source === 'customer_supplied' && ops2[1].status === 'cancelled' && ops2[2].part_label === 'Ampoule ' + run, 'the removed part is kept as cancelled, not deleted');
  ok((await request('PUT', '/api/workspace/interventions/' + IV, T.TECH, Object.assign({}, base, { parts: [{ id: '999999999', label: 'X', source: 'our_shop' }] }))).body.details.reason === 'unknown_part', 'an edit cannot touch a part of another intervention');

  say('\n3. PARTS — source filter, search, cancelled never counted');
  var pAll = (await request('GET', '/api/workspace/parts-used', T.MGR)).body;
  ok(pAll.total === 2 && pAll.totals.our_shop === 1 && pAll.totals.customer_supplied === 1 && pAll.matching === 2, 'workshop A: two parts in use (the removed one is not counted)');
  ok(pAll.parts.every(function (p) { return ['label', 'reference', 'vehicle', 'performed_on', 'source'].every(function (k) { return k in p; }); }), 'each part: name, reference, vehicle, date, source');
  var pShop = (await request('GET', '/api/workspace/parts-used?source=our_shop', T.MGR)).body;
  ok(pShop.matching === 1 && pShop.parts[0].label === 'Ampoule ' + run, 'filter « achetée chez nous »');
  var pCust = (await request('GET', '/api/workspace/parts-used?source=customer_supplied', T.MGR)).body;
  ok(pCust.matching === 1 && pCust.parts[0].label === 'Filtre à huile ' + run, 'filter « fournie par le client »');
  ok((await request('GET', '/api/workspace/parts-used?q=' + encodeURIComponent('oc 90'), T.MGR)).body.matching === 1, 'search by reference');
  ok((await request('GET', '/api/workspace/parts-used?q=' + encodeURIComponent(P2.series + ' TU ' + P2.number), T.MGR)).body.matching === 2, 'search by registration number');
  ok((await request('GET', '/api/workspace/parts-used', T.OTHER)).body.total === 0, 'workshop B sees none of them');

  say('\n4. DASHBOARD — five numbers = database = list totals');
  var o = (await request('GET', '/api/workspace/overview', T.MGR)).body;
  ok(['vehicles', 'interventions', 'parts', 'parts_our_shop', 'parts_customer'].every(function (k) { return Number.isInteger(o[k]); }) && Object.keys(o).sort().join() === 'interventions,parts,parts_customer,parts_our_shop,scope,vehicles', 'exactly the five numbers');
  ok(o.vehicles === (await request('GET', '/api/workspace/vehicles', T.MGR)).body.total, 'vehicles = the vehicle list total (' + o.vehicles + ')');
  ok(o.interventions === (await request('GET', '/api/workspace/interventions', T.MGR)).body.total && o.interventions === 2, 'interventions = the list total (' + o.interventions + ')');
  ok(o.parts === 2 && o.parts_our_shop === 1 && o.parts_customer === 1, 'parts, bought from us, supplied by the customer');
  var adm = (await request('GET', '/api/workspace/overview', T.ADMIN)).body;
  ok(adm.parts === await n('SELECT count(*)::int n FROM idauto_workshop_operations op JOIN idauto_workshop_visits w ON w.id = op.visit_id WHERE ' + PARTS) &&
    adm.interventions === await n("SELECT count(*)::int n FROM idauto_workshop_visits WHERE status <> 'cancelled'") &&
    adm.parts_our_shop === await n('SELECT count(*)::int n FROM idauto_workshop_operations op JOIN idauto_workshop_visits w ON w.id = op.visit_id WHERE ' + PARTS + " AND op.part_source = 'our_shop'"), 'admin: the numbers are the database counts');
  var cancel = await request('DELETE', '/api/workspace/interventions/' + IV, T.TECH);
  ok(cancel.status === 200 && cancel.body.status === 'cancelled', 'the intervention is cancelled');
  var o2 = (await request('GET', '/api/workspace/overview', T.MGR)).body;
  ok(o2.interventions === 1 && o2.parts === 0, 'a cancelled intervention and its parts leave the counts');
  ok((await request('GET', '/api/workspace/interventions?id=' + IV, T.TECH)).body.interventions[0].status === 'cancelled', 'but the record is kept (readable by its number)');
  ok((await db.query('SELECT count(*)::int n FROM idauto_workshop_operations WHERE visit_id = $1', [IV])).rows[0].n === 3, 'nothing was deleted');
  ok((await request('PUT', '/api/workspace/interventions/' + IV, T.TECH, base)).body.details.reason === 'intervention_cancelled', 'a cancelled intervention is no longer edited');

  say('\n5. DELETE A VEHICLE (archive: nothing erased)');
  var V1 = r1.body.ivid;
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V1), T.TECH)).status === 403, 'a technician cannot delete a vehicle (403)');
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V2), T.MGR)).body.details.reason === 'vehicle_has_interventions', 'a vehicle with interventions is never deleted (its history is kept)');
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V1), T.OTHER)).status === 404, 'another workshop cannot delete it (404)');
  var before = (await request('GET', '/api/workspace/overview', T.MGR)).body.vehicles;
  var del = await request('DELETE', '/api/vehicles/' + encodeURIComponent(V1), T.MGR);
  ok(del.status === 200 && del.body.archived === true, 'the manager deletes a record entered by mistake');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(V1) + '/dossier', T.MGR)).status === 404, 'its file no longer opens');
  ok((await request('GET', '/api/workspace/overview', T.MGR)).body.vehicles === before - 1 && !(await request('GET', '/api/workspace/vehicles', T.MGR)).body.vehicles.some(function (v) { return v.ivid === V1; }), 'it leaves the list and the count');
  var kept = (await db.query("SELECT v.fiche_status, (SELECT count(*)::int FROM idauto_plates p WHERE p.vehicle_id = v.id) AS plates FROM idauto_vehicles v WHERE v.ivid = $1", [V1])).rows[0];
  ok(kept && kept.fiche_status === 'archived' && kept.plates === 1, 'nothing is erased: the record is archived, its plate kept (cancelled)');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.archive' AND target_ref = $1", [V1])).rows[0].n === 1, 'the deletion is audited');
  var again = await request('POST', '/api/vehicles/register', T.TECH, { plate: P1 });
  ok(again.status === 201 && again.body.ivid !== V1, 'the same plate can be registered again as a new vehicle');
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V1), T.MGR)).status === 404, 'deleting twice → 404');
  var P3 = await freePlate(), V3 = (await request('POST', '/api/vehicles/register', T.MGR, { plate: P3 })).body.ivid;
  await request('PUT', '/api/vehicles/' + encodeURIComponent(V3) + '/owner', T.OTHER, { full_name: 'Client B ' + run, phone: '+216 20 111 222' });
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V3), T.MGR)).body.details.reason === 'vehicle_used_by_another_workshop', 'another workshop holds data on it → the manager cannot delete it');
  ok((await request('DELETE', '/api/vehicles/' + encodeURIComponent(V3), T.ADMIN)).status === 200, 'an administrator can');
  ok((await request('GET', '/api/search?q=' + encodeURIComponent(P3.series + 'TU' + P3.number), T.ADMIN)).raw.indexOf(V3) === -1, 'a deleted vehicle is not found by the search');

  say('\n6. ADMIN, MENU, PAGES');
  var adminNoOrg = await request('POST', '/api/workspace/interventions', T.ADMIN, { vehicle_ref: V2, description: 'Admin ' + run });
  ok(adminNoOrg.status === 400 && adminNoOrg.body.details.field === 'org_id', 'an admin with several workshops names the workshop');
  ok((await request('POST', '/api/workspace/interventions', T.ADMIN, { vehicle_ref: V2, description: 'Admin ' + run, org_id: orgA })).status === 201, 'and then records it for that workshop');
  var shell = require(path.join(BASE, 'reference', 'admin-shell.js'));
  var FIVE = ['Tableau de bord', 'Véhicules', 'Interventions', 'Pièces', 'Paramètres'];
  ['admin', 'manager', 'technician'].forEach(function (r) { var items = []; shell.visible(r).forEach(function (s) { s.items.forEach(function (i) { items.push(i.label); }); }); ok(JSON.stringify(items) === JSON.stringify(FIVE), r + ': the five menu links, nothing else'); });
  ok(shell.locate('/admin/utilisateurs').item.label === 'Paramètres' && shell.locate('/admin/roles').item.label === 'Paramètres' && shell.locate('/atelier/vehicules/nouveau').item.label === 'Véhicules', 'users, roles and « add a vehicle » belong to their menu link');
  for (var pg of ['/atelier/documents', '/atelier/catalogue', '/atelier/techniciens', '/atelier']) ok((await request('GET', pg)).status === 302, pg + ' still answers (sign-in redirect): nothing was broken, it is only out of the menu');
  ok((await request('GET', '/admin/dashboard')).status === 200, '/admin/dashboard still answers');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); if (server) server.close(); process.exit(1); });
