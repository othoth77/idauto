#!/usr/bin/env node
'use strict';
// IDA-UI-3 — workspace API end to end on a scratch database: manual registration,
// private owner contact, dossier, maintenance part source, lists, overview,
// notifications, global search, and the VIN-fact security fix.
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
var T = {}; ['ADMIN', 'MGR', 'TECH', 'OTHER', 'READER'].forEach(function (k) { T[k] = k.toLowerCase() + '-' + crypto.randomBytes(10).toString('hex'); });
var run = crypto.randomBytes(3).toString('hex');
var ids = {};
ids[T.ADMIN] = 'usr_admin_ui3_' + run;
ids[T.MGR] = { actor_ref: 'svc_ui3_mgr_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.TECH] = { actor_ref: 'svc_ui3_tech_' + run, org_id: 0, scopes: principal.TECHNICIAN_SCOPES.slice() };
ids[T.OTHER] = { actor_ref: 'svc_ui3_other_' + run, org_id: 0, scopes: principal.MANAGER_SCOPES.slice() };
ids[T.READER] = { actor_ref: 'svc_ui3_reader_' + run, org_id: 0, scopes: ['vehicle:read', 'document:read'] };
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
var VC = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function randomVin() { var s = 'VF3'; for (var i = 0; i < 14; i++) s += VC[crypto.randomInt(VC.length)]; return s; }
async function freePlate() {
  for (;;) { var a = crypto.randomInt(100, 999), b = crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [a + ' TUN ' + b])).rows.length) return { series: String(a), number: String(b), canonical: a + ' TUN ' + b }; }
}

(async function () {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  var orgA = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage UI3 A " + run + "','garage','active') RETURNING id")).rows[0].id;
  var orgB = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage UI3 B " + run + "','garage','active') RETURNING id")).rows[0].id;
  ids[T.MGR].org_id = orgA; ids[T.TECH].org_id = orgA; ids[T.READER].org_id = orgA; ids[T.OTHER].org_id = orgB;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(ids);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var MAKE = 'UIT' + run.toUpperCase();

  say('1. MANUAL REGISTRATION');
  var P1 = await freePlate(), VIN1 = randomVin();
  ok((await request('POST', '/api/vehicles/register', null, {})).status === 401, 'anonymous → 401');
  ok((await request('POST', '/api/vehicles/register', T.READER, { plate: P1, make: MAKE })).status === 403, 'without vehicle:write → 403');
  var noId = await request('POST', '/api/vehicles/register', T.MGR, { make: MAKE });
  ok(noId.status === 400 && noId.body.details.reason === 'plate_or_vin_required', 'a plate or a VIN is required');
  ok((await request('POST', '/api/vehicles/register', T.MGR, { plate: P1 })).body.details.field === 'make', 'the make is required');
  ok((await request('POST', '/api/vehicles/register', T.MGR, { plate: { series: '12a', number: '1' }, make: MAKE })).body.details.reason === 'invalid_plate', 'an invalid plate is refused');
  ok((await request('POST', '/api/vehicles/register', T.MGR, { plate: P1, vin: 'NOTAVIN', make: MAKE })).body.details.field === 'vin', 'an invalid VIN is refused');
  ok((await request('POST', '/api/vehicles/register', T.MGR, { plate: P1, make: MAKE, year: '1800' })).body.details.reason === 'out_of_range', 'an impossible year is refused');
  ok((await request('POST', '/api/vehicles/register', T.MGR, { plate: P1, make: MAKE, owner: { full_name: 'Test Owner', phone: 'abc' } })).body.details.reason === 'invalid_phone', 'an invalid owner phone is refused');
  var reg = await request('POST', '/api/vehicles/register', T.MGR, { plate: { type: 'TU', series: P1.series, number: P1.number }, vin: VIN1, make: MAKE.toLowerCase(), model: '208', year: '2019', fuel_type: 'petrol', engine_cc: '1199', seats: '5', colour: 'Gris',
    owner: { full_name: 'Propriétaire Fictif ' + run, phone: '+216 98 765 432', email: 'fictif@example.tn', address: '1 rue du Test' } });
  ok(reg.status === 201 && /^ivid:1:/.test(reg.body.ivid) && reg.body.plate === P1.canonical && reg.body.vin_recorded && reg.body.owner_recorded, 'registered: IVID issued, plate, VIN and owner recorded in one step');
  var IVID = reg.body.ivid;
  var vrow = (await db.query('SELECT id, make, model, year, colour, identification_method, identification_verified FROM idauto_vehicles WHERE ivid = $1', [IVID])).rows[0];
  ok(vrow.make === MAKE && vrow.model === '208' && vrow.year === 2019 && vrow.colour === 'Gris' && vrow.identification_method === 'manual_registration' && vrow.identification_verified, 'the vehicle holds the typed values, provenance manual_registration');
  var cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'idauto_vehicles' AND (column_name ILIKE '%owner%' OR column_name ILIKE '%phone%' OR column_name ILIKE '%name%')")).rows;
  ok(cols.length === 0, 'the vehicle table still has NO owner / phone / name column (owner data is a separate table)');
  var rsSeries = String(crypto.randomInt(10, 999)), rsNumber = String(crypto.randomInt(1000, 9999));
  var rsReg = await request('POST', '/api/vehicles/register', T.MGR, { plate: { type: 'RS', series: rsSeries, number: rsNumber }, make: MAKE });
  ok(rsReg.status === 201 && rsReg.body.plate === rsSeries + ' RS ' + rsNumber, 'a régime suspensif plate (series RS number, as the form sends it) registers: ' + rsReg.status + ' ' + rsReg.body.plate);
  var dupPlate = await request('POST', '/api/vehicles/register', T.MGR, { plate: P1, make: MAKE });
  ok(dupPlate.status === 409 && dupPlate.body.details.reason === 'vehicle_already_registered' && dupPlate.body.details.ivid === IVID, 'the same plate again → 409, pointing to the existing vehicle');
  var P2 = await freePlate();
  var probeQ = "SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND actor_ref = $1";
  var probe0 = (await db.query(probeQ, [ids[T.TECH].actor_ref])).rows[0].n;
  var dupVinTech = await request('POST', '/api/vehicles/register', T.TECH, { plate: P2, vin: VIN1, make: MAKE });
  ok(dupVinTech.status === 409 && dupVinTech.body.details.identifier === 'vin' && dupVinTech.body.details.ivid === null, 'the same VIN by a technician (no vin:search) → 409 without revealing which vehicle');
  var probeRows = (await db.query("SELECT target_ref, change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND actor_ref = $1", [ids[T.TECH].actor_ref])).rows;
  ok(probeRows.length === probe0 + 1 && probeRows.every(function (r) { return r.target_ref === null && r.change_summary.indexOf(VIN1) === -1; }), 'that VIN conflict is a VIN lookup: audited (digest only, no vehicle named), although the 409 rolls the registration back');
  var race = await Promise.all([request('POST', '/api/vehicles/register', T.MGR, { plate: P2, make: MAKE }), request('POST', '/api/vehicles/register', T.OTHER, { plate: P2, make: MAKE })]);
  ok(race.map(function (r) { return r.status; }).sort().join(',') === '201,409' && (await db.query('SELECT count(*)::int n FROM idauto_plates WHERE plate_number = $1', [P2.canonical])).rows[0].n === 1, 'two registrations of one plate at once → one vehicle');
  var regAudit = (await db.query("SELECT new_value_json::text j, change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.register.manual' AND target_ref = $1", [IVID])).rows;
  ok(regAudit.length === 1 && regAudit[0].j.indexOf('Fictif') === -1 && regAudit[0].j.indexOf('98765432') === -1 && regAudit[0].j.indexOf(VIN1) === -1, 'registration audited, without the owner\'s name, phone or the VIN');

  say('\n2. OWNER CONTACT — private, per workshop, audited');
  var mgrOwner = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.MGR);
  ok(mgrOwner.status === 200 && mgrOwner.body.contacts.length === 1 && mgrOwner.body.contacts[0].phone === '+216 98 765 432', 'the recording workshop\'s manager reads it');
  var techOwner = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.TECH);
  ok(techOwner.status === 200 && techOwner.body.contacts.length === 1, 'its technician reads it (owner decision: admin + manager + technician)');
  var otherOwner = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.OTHER);
  ok(otherOwner.status === 200 && otherOwner.body.contacts.length === 0, 'ANOTHER workshop sees no contact for the same vehicle');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.READER)).status === 403, 'an account without owner:read → 403');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.ADMIN)).body.contacts.length === 1, 'an admin reads it');
  var reads = (await db.query("SELECT actor_ref, org_id, change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.owner.read' AND target_ref = $1", [IVID])).rows;
  ok(reads.length >= 4 && reads.every(function (r) { return r.change_summary.indexOf('Fictif') === -1 && r.change_summary.indexOf('98') === -1; }), 'every read is audited (' + reads.length + ' rows), with no personal data in the audit row');
  var put = await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.OTHER, { full_name: 'Autre Client ' + run, phone: '22 333 444' });
  ok(put.status === 200 && put.body.fields_present.join(',') === 'full_name,phone', 'workshop B records its own client for the same vehicle');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.MGR)).body.contacts[0].full_name.indexOf('Fictif') !== -1, 'workshop A still sees only its own client');
  await request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.MGR, { full_name: 'Propriétaire Corrigé ' + run, phone: '98 765 433' });
  var hist = (await db.query('SELECT count(*)::int n FROM idauto_vehicle_owner_contacts c JOIN idauto_vehicles v ON v.id = c.vehicle_id WHERE v.ivid = $1 AND c.org_id = $2', [IVID, orgA])).rows[0].n;
  ok(hist === 2, 'a change supersedes the previous contact (history kept: ' + hist + ' rows)');
  var setAudit = JSON.stringify((await db.query("SELECT new_value_json FROM idauto_audit_log WHERE event_type = 'vehicle.owner.set' AND target_ref = $1", [IVID])).rows);
  ok(setAudit.indexOf('Corrig') === -1 && setAudit.indexOf('765') === -1, 'the change audit names the fields, never their values');
  var racePut = await Promise.all([1, 2, 3].map(function (i) { return request('PUT', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.OTHER, { full_name: 'Autre Client ' + i + ' ' + run, phone: '22 333 44' + i }); }));
  var rs = racePut.map(function (r) { return r.status; });
  var curB = (await db.query('SELECT count(*)::int n FROM idauto_vehicle_owner_contacts c JOIN idauto_vehicles v ON v.id = c.vehicle_id WHERE v.ivid = $1 AND c.org_id <> $2 AND c.superseded_at IS NULL', [IVID, orgA])).rows[0].n;
  ok(rs.every(function (x) { return x === 200 || x === 409; }) && rs.indexOf(200) !== -1 && curB === 1, 'simultaneous saves of one contact: 200 or 409, never a 500, and one current contact (' + rs.join(',') + ')');
  var pub = await request('GET', '/api/passport/' + encodeURIComponent(IVID), T.ADMIN);
  var veh = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID), T.ADMIN);
  var srch = await request('GET', '/api/search/vehicles?plate=' + encodeURIComponent(P1.canonical), T.MGR);
  ok([pub.raw, veh.raw, srch.raw].every(function (r) { return r.indexOf('Fictif') === -1 && r.indexOf('Corrig') === -1 && r.indexOf('765') === -1; }), 'the passport, the vehicle record and the registry search carry no owner data');
  var rm = await request('DELETE', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.OTHER);
  ok(rm.status === 200 && (await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/owner', T.OTHER)).body.contacts.length === 0, 'removal supersedes (history kept), and is audited');

  say('\n3. DOSSIER — identity shared, history per workshop');
  var visit = await request('POST', '/api/workshop/visits', T.TECH, { vehicle_ref: IVID, reason: 'Vidange ' + run });
  ok(visit.status === 201, 'the technician opens an intervention');
  var VISIT = visit.body.visit.id;
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'replacement', description: 'Filtre à huile', part_label: 'Filtre à huile', quantity: 1 })).body.details.field === 'part_source', 'a part without its source → refused (the radio choice is required)');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'replacement', part_label: 'Filtre', part_source: 'gift' })).status === 400, 'an unknown source → refused');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'service', part_source: 'our_shop' })).body.details.reason === 'no_part', 'a source without any part → refused');
  ok((await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'replacement', part_label: 'Filtre', part_source: 'our_shop', performed_on: '2999-01-01' })).body.details.field === 'performed_on', 'a date in the future → refused');
  var op1 = await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'replacement', description: 'Remplacement filtre', part_label: 'Filtre à huile', part_reference: 'OC 123', part_source: 'customer_supplied', part_condition: 'new', quantity: 1, performed_on: new Date().toISOString().slice(0, 10), notes: 'Pièce apportée par le client', status: 'done' });
  ok(op1.status === 201 && op1.body.part_source === 'customer_supplied' && op1.body.part_condition === 'new' && op1.body.status === 'done', 'replacement recorded: part, reference, source « fournie par le client », new, done');
  var op2 = await request('POST', '/api/workshop/visits/' + VISIT + '/operations', T.TECH, { operation_type: 'repair', description: 'Réparation durite', part_label: 'Durite', part_source: 'external_supplier', part_condition: 'used', quantity: 2 });
  ok(op2.status === 201 && op2.body.part_source === 'external_supplier' && op2.body.part_condition === 'used', 'repair with a used part from an external supplier');
  var opB = (await request('POST', '/api/workshop/visits', T.OTHER, { vehicle_ref: IVID, reason: 'Freins B ' + run })).body.visit.id;
  await request('POST', '/api/workshop/visits/' + opB + '/operations', T.OTHER, { operation_type: 'replacement', part_label: 'Plaquettes', part_source: 'our_shop' });
  var dosA = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/dossier', T.TECH);
  ok(dosA.status === 200 && dosA.body.vehicle.ivid === IVID && dosA.body.vehicle.make === MAKE && dosA.body.scope === 'own_workshop', 'the dossier opens with the vehicle identity');
  ok(dosA.body.maintenance.length === 1 && dosA.body.maintenance[0].operations.length === 2 && dosA.body.maintenance[0].operations[0].part.source === 'customer_supplied', 'workshop A sees ITS intervention and both parts with their source');
  ok(dosA.raw.indexOf('Freins B') === -1 && dosA.raw.indexOf('Plaquettes') === -1, 'workshop A never sees workshop B\'s intervention');
  ok(dosA.body.vehicle.vin_present === true && dosA.body.vehicle.vin === null && dosA.raw.indexOf(VIN1) === -1, 'a technician sees that a VIN exists, not its value');
  ok(dosA.body.owner.recorded === true && dosA.raw.indexOf('Corrig') === -1, 'the dossier says an owner contact exists; the contact itself is a separate, audited read');
  var dosM = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/dossier', T.MGR);
  ok(dosM.body.vehicle.vin === VIN1 && (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read' AND target_ref = $1", [IVID])).rows[0].n >= 1, 'a manager (vin:search) sees the VIN, and the disclosure is audited');
  var dosAdm = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/dossier', T.ADMIN);
  ok(dosAdm.body.scope === 'all_workshops' && dosAdm.body.maintenance.length === 2, 'an admin sees the history of every workshop');
  ok(dosA.body.maintenance[0].operations[0].technician && dosA.body.maintenance[0].operations[0].technician.name, 'each operation names its technician');

  say('\n4. LISTS, OVERVIEW, NOTIFICATIONS');
  var listA = await request('GET', '/api/workspace/vehicles', T.TECH);
  ok(listA.status === 200 && listA.body.vehicles.some(function (v) { return v.ivid === IVID; }), 'workshop A lists the vehicle it registered');
  var listR = await request('GET', '/api/workspace/vehicles?q=' + encodeURIComponent(MAKE.toLowerCase()), T.MGR);
  ok(listR.body.vehicles.length >= 1 && listR.body.vehicles.every(function (v) { return v.make === MAKE; }), 'the list filters by make');
  var parts = await request('GET', '/api/workspace/parts-used?source=customer_supplied', T.MGR);
  ok(parts.status === 200 && parts.body.parts.length >= 1 && parts.body.parts.every(function (p) { return p.source === 'customer_supplied'; }) && parts.raw.indexOf('Plaquettes') === -1, 'replaced parts filter by source, own workshop only');
  var ints = await request('GET', '/api/workspace/interventions?status=in_progress', T.TECH);
  ok(ints.status === 200 && ints.body.interventions.some(function (i) { return i.id === VISIT; }) && ints.raw.indexOf('Freins B') === -1, 'interventions list, own workshop only');
  var team = await request('GET', '/api/workspace/technicians', T.TECH);
  ok(team.status === 403, 'a technician cannot list the team (team:read is manager / admin)');
  ok((await request('GET', '/api/workspace/technicians', T.MGR)).status === 200, 'a manager can');
  var ov = await request('GET', '/api/workspace/overview', T.MGR);
  ok(ov.status === 200 && ov.body.scope === 'own_workshop' && ov.body.vehicles >= 1 && ov.body.interventions >= 1 && ov.body.parts >= 2 && ov.body.workshops === 1, 'overview: real counts for the workshop');
  var ovAdm = await request('GET', '/api/workspace/overview', T.ADMIN);
  ok(ovAdm.body.scope === 'all_workshops' && ovAdm.body.vehicles >= ov.body.vehicles, 'overview: platform-wide for an admin');
  var notif = await request('GET', '/api/notifications', T.MGR);
  ok(notif.status === 200 && notif.body.items.some(function (i) { return /Interventions en cours/.test(i.label) && i.count >= 1; }), 'notifications are real counts with their page');
  ok((await request('GET', '/api/admin/roles', T.MGR)).status === 403 && (await request('GET', '/api/admin/roles', T.ADMIN)).body.roles.length === 3, 'the role matrix is admin-only');

  say('\n5. GLOBAL SEARCH — server-side, per account');
  var sPlate = await request('GET', '/api/search?q=' + encodeURIComponent(P1.series + 'TU' + P1.number), T.TECH);
  var vg = sPlate.body.groups.filter(function (g) { return g.key === 'vehicles'; })[0];
  ok(sPlate.status === 200 && vg.items.some(function (i) { return i.subtitle === IVID && /\/atelier\/vehicule\?ref=/.test(i.href); }), 'a plate typed without spaces finds the vehicle, linked to its dossier');
  var sOwnerA = await request('GET', '/api/search?q=' + encodeURIComponent('propriétaire corr'), T.MGR);
  ok(sOwnerA.body.groups.filter(function (g) { return g.key === 'owners'; })[0].items.length === 1, 'workshop A finds its client by name');
  var sOwnerPhone = await request('GET', '/api/search?q=' + encodeURIComponent('98765433'), T.TECH);
  ok(sOwnerPhone.body.groups.filter(function (g) { return g.key === 'owners'; })[0].items.length === 1, 'and by phone (its technician too)');
  var sOwnerB = await request('GET', '/api/search?q=' + encodeURIComponent('propriétaire corr'), T.OTHER);
  ok(sOwnerB.body.groups.filter(function (g) { return g.key === 'owners'; })[0].items.length === 0 && sOwnerB.raw.indexOf('Corrig') === -1, 'workshop B cannot find workshop A\'s client');
  var sReader = await request('GET', '/api/search?q=' + encodeURIComponent('propriétaire corr'), T.READER);
  ok(sReader.status === 200 && sReader.body.groups.filter(function (g) { return g.key === 'owners'; })[0].items.length === 0, 'without owner:read the owners group stays empty');
  var sVinTech = await request('GET', '/api/search?q=' + VIN1, T.TECH);
  ok(sVinTech.raw.indexOf(IVID) === -1, 'a VIN typed by a technician (no vin:search) finds nothing');
  var before = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND target_ref = $1", [IVID])).rows[0].n;
  var sVinMgr = await request('GET', '/api/search?q=' + VIN1, T.MGR);
  var after = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' AND target_ref = $1", [IVID])).rows[0].n;
  ok(sVinMgr.raw.indexOf(IVID) !== -1 && after === before + 1 && sVinMgr.raw.indexOf(VIN1) === -1, 'a manager finds it by VIN; the search is audited; the VIN is not echoed');
  var sInt = await request('GET', '/api/search?q=' + encodeURIComponent('#' + VISIT), T.TECH);
  ok(sInt.body.groups.filter(function (g) { return g.key === 'interventions'; })[0].items.length === 1, 'an intervention by its number');
  ok((await request('GET', '/api/search?q=' + encodeURIComponent('#' + opB), T.TECH)).raw.indexOf('Freins B') === -1, 'never another workshop\'s intervention');
  var sSpecial = await request('GET', '/api/search?q=' + encodeURIComponent("%_'\\;--"), T.MGR);
  ok(sSpecial.status === 200 && sSpecial.body.groups.every(function (g) { return Array.isArray(g.items); }), 'special characters are searched literally (no SQL wildcard, no error)');
  ok((await request('GET', '/api/search?q=a', T.MGR)).body.groups.length === 0, 'under 2 characters → nothing');
  ok((await request('GET', '/api/search?q=abc', null)).status === 401, 'anonymous → 401');
  var ownerSearchAudit = (await db.query("SELECT change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.owner.search' AND actor_ref = $1", [ids[T.MGR].actor_ref])).rows;
  ok(ownerSearchAudit.length >= 1 && ownerSearchAudit.every(function (r) { return r.change_summary.indexOf('corr') === -1; }), 'owner searches are audited without the query text');
  ok(ownerSearchAudit.some(function (r) { return r.change_summary.indexOf('vehicles=' + IVID) !== -1; }), 'and the audit names which vehicles\' contacts were shown (IVIDs only)');

  say('\n6. SECURITY FIX — the VIN fact needs vin:search');
  var factsTech = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/facts', T.TECH);
  ok(factsTech.status === 200 && factsTech.raw.indexOf(VIN1) === -1, 'GET /api/vehicles/:ref/facts no longer returns the VIN to a technician');
  var passTech = await request('GET', '/api/passport/' + encodeURIComponent(IVID), T.TECH);
  ok(passTech.status === 200 && passTech.raw.indexOf(VIN1) === -1, 'nor does GET /api/passport/:ivid');
  var b4 = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read' AND target_ref = $1", [IVID])).rows[0].n;
  var factsMgr = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/facts', T.MGR);
  var af = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.vin.read' AND target_ref = $1", [IVID])).rows[0].n;
  ok(factsMgr.raw.indexOf(VIN1) !== -1 && af === b4 + 1, 'a manager (vin:search) still gets it, and that disclosure is now audited');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool(); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e && e.stack || e); if (server) server.close(); process.exit(1); });
