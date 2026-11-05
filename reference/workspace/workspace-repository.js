'use strict';
// =====================================================
// IDauto — IDA-UI-3 — the workspace reads: dossier, lists, overview,
// notifications, global search
// reference/workspace/workspace-repository.js
//
// One rule everywhere: an ADMIN reads everything; an ORGANISATION reads the
// shared vehicle registry (identity, plates) plus only ITS OWN workshop
// history, documents and owner contacts. Every query below carries that
// filter in SQL — nothing is filtered in the browser.
//
// "No record" is never shown as "nothing happened": the pages say what IDauto
// holds and from whom; an empty history is an absence of records, not proof.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var identity = require('../identity.js');
var repository = require('../vehicle/vehicle-repository.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vinModule = require('../vehicle/vin.js');
var owners = require('./owner-contacts.js');

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function isAdmin(actor) { return !!(actor.principal && actor.principal.kind !== 'organisation'); }
function can(actor, scope) { return identity.principalHasScope(actor.principal, scope); }
function like(s) { return String(s).replace(/[\\%_]/g, '\\$&'); }

// The vehicles an organisation works with: it visited, identified, documented or recorded the owner of.
function orgVehicleClause(alias, p) {
  return '(EXISTS (SELECT 1 FROM idauto_workshop_visits w WHERE w.vehicle_id = ' + alias + '.id AND w.org_id = $' + p + ')' +
    ' OR EXISTS (SELECT 1 FROM idauto_vehicle_identification_history h WHERE h.vehicle_id = ' + alias + '.id AND h.org_id = $' + p + ')' +
    ' OR EXISTS (SELECT 1 FROM idauto_vehicle_documents d WHERE d.vehicle_id = ' + alias + '.id AND d.org_id = $' + p + ')' +
    ' OR EXISTS (SELECT 1 FROM idauto_vehicle_owner_contacts c WHERE c.vehicle_id = ' + alias + '.id AND c.org_id = $' + p + ' AND c.superseded_at IS NULL))';
}

// Display names of the people behind actor references ('user:<id>'), never their e-mail.
async function namesOf(refs) {
  var ids = refs.filter(function (r) { return typeof r === 'string' && /^user:/.test(r); }).map(function (r) { return r.slice(5); });
  var out = {};
  if (!ids.length) return out;
  (await db.query('SELECT "id", "name", "role" FROM idauto_auth_user WHERE "id" = ANY($1::text[])', [ids])).rows.forEach(function (u) { out['user:' + u.id] = { name: u.name, role: u.role }; });
  return out;
}
function who(names, ref) { if (!ref) return null; var n = names[ref]; return n ? { name: n.name, role: n.role } : { name: /^user:/.test(ref) ? '—' : ref, role: null }; }

async function vehicleOr404(ref) {
  var v = await repository.findByRef(String(ref || ''));
  if (!v) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  return v;
}

// ---- maintenance history ------------------------------------------------------
async function interventionsFor(where, params, limit) {
  var visits = (await db.query(
    'SELECT w.id, w.org_id, o.name AS org_name, w.vehicle_id, v.ivid, v.make, v.model, w.status, w.reason, w.identification_method, w.opened_by, w.opened_at, w.closed_at, ' +
    "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = w.vehicle_id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate " +
    'FROM idauto_workshop_visits w LEFT JOIN idauto_organizations o ON o.id = w.org_id LEFT JOIN idauto_vehicles v ON v.id = w.vehicle_id ' +
    'WHERE ' + where + ' ORDER BY w.opened_at DESC LIMIT ' + (limit || 50), params)).rows;
  if (!visits.length) return [];
  var ops = (await db.query(
    'SELECT op.id, op.visit_id, op.operation_type, op.description, op.quantity, op.status, op.created_by, op.created_at, op.part_source, op.part_condition, op.part_label, op.part_reference_text, op.performed_on, op.notes, ' +
    'pt.reference AS part_reference, pt.name AS part_catalogue_name, pt.brand AS part_brand ' +
    'FROM idauto_workshop_operations op LEFT JOIN idauto_parts pt ON pt.id = op.part_id WHERE op.visit_id = ANY($1::int[]) ORDER BY op.id', [visits.map(function (v) { return v.id; })])).rows;
  var names = await namesOf(visits.map(function (v) { return v.opened_by; }).concat(ops.map(function (o) { return o.created_by; })));
  return visits.map(function (v) {
    return { id: v.id, org: { id: v.org_id, name: v.org_name }, vehicle: v.ivid ? { ivid: v.ivid, plate: v.plate, make: v.make, model: v.model } : null, status: v.status, reason: v.reason,
      opened_at: v.opened_at, closed_at: v.closed_at, opened_by: who(names, v.opened_by),
      operations: ops.filter(function (o) { return o.visit_id === v.id; }).map(function (o) {
        return { id: o.id, type: o.operation_type, description: o.description, quantity: o.quantity, status: o.status, performed_on: o.performed_on, created_at: o.created_at, notes: o.notes,
          technician: who(names, o.created_by),
          part: (o.part_reference || o.part_label || o.part_reference_text) ? { label: o.part_label || o.part_catalogue_name || null, reference: o.part_reference_text || o.part_reference || null,
            brand: o.part_brand || null, from_catalogue: !!o.part_reference, source: o.part_source, condition: o.part_condition } : null };
      }) };
  });
}

async function dossier(ref, actor) {
  var v = await vehicleOr404(ref);
  var rec = await repository.record(v, { includeVin: false });
  var vinOnRecord = await repository.vinOf(v.id);
  var vin = null;
  if (vinOnRecord && can(actor, 'vin:search')) { await writes.recordVinDisclosureAudit(actor.principal, actor.identity, v.ivid); vin = vinOnRecord; }
  var plates = (await db.query('SELECT plate_number, status, created_at FROM idauto_plates WHERE vehicle_id = $1 ORDER BY id DESC', [v.id])).rows;
  var org = orgOf(actor);
  var docParams = [v.id], docWhere = "vehicle_id = $1 AND document_type = 'carte_grise'";
  if (!isAdmin(actor)) { docParams.push(org); docWhere += ' AND org_id = $2'; }
  var docs = (await db.query('SELECT face, mime_type, byte_size, width, height, created_at, updated_at, created_by FROM idauto_vehicle_documents WHERE ' + docWhere + ' ORDER BY face', docParams)).rows;
  var visitWhere = 'w.vehicle_id = $1', visitParams = [v.id];
  if (!isAdmin(actor)) { visitParams.push(org); visitWhere += ' AND w.org_id = $2'; }
  var history = await interventionsFor(visitWhere, visitParams, 200);
  var legacy = isAdmin(actor) ? (await db.query('SELECT event_type, event_date, odometer_km, description, outcome FROM idauto_service_events WHERE vehicle_id = $1 ORDER BY event_date DESC LIMIT 100', [v.id])).rows : [];
  var ident = (await db.query('SELECT changed_at, action, method, source, org_id, actor_ref FROM idauto_vehicle_identification_history WHERE vehicle_id = $1' + (isAdmin(actor) ? '' : ' AND (org_id = $2 OR org_id IS NULL)') + ' ORDER BY changed_at DESC LIMIT 20', isAdmin(actor) ? [v.id] : [v.id, org])).rows;
  var names = await namesOf(ident.map(function (i) { return i.actor_ref; }));
  return {
    vehicle: { ivid: rec.id, internal_ref: rec.internal_ref, plate: rec.plate, plate_display: rec.plate_display, make: rec.manufacturer, model: rec.model, variant: rec.version,
      year: rec.year, fuel_type: rec.fuel_type, engine_cc: rec.engine_cc, seats: rec.seats, gross_weight_kg: rec.gross_weight_kg, category_code: rec.category_code, body_type: rec.body_type,
      engine_code: rec.engine_code, colour: v.colour || null, fiche_status: rec.fiche_status, verified: rec.verified, verification_method: rec.verification_method, created_at: rec.created_at,
      vin_present: !!vinOnRecord, vin: vin },
    plates: plates,
    documents: { faces: docs.map(function (d) { return { face: d.face, mime_type: d.mime_type, byte_size: d.byte_size, width: d.width, height: d.height, at: d.updated_at || d.created_at }; }),
      can_upload: can(actor, 'document:write'), can_delete: can(actor, 'document:delete') },
    owner: { recorded: await owners.hasContact(v.id, actor), can_read: can(actor, 'owner:read'), can_write: can(actor, 'owner:write') },
    maintenance: history,
    legacy_service_events: legacy,
    identification: ident.map(function (i) { return { at: i.changed_at, action: i.action, method: i.method, source: i.source, by: who(names, i.actor_ref) }; }),
    scope: isAdmin(actor) ? 'all_workshops' : 'own_workshop'
  };
}

// ---- lists -------------------------------------------------------------------
function page(opts) { var p = Math.max(1, parseInt(opts && opts.page, 10) || 1); return { limit: 25, offset: (p - 1) * 25, page: p }; }

async function listVehicles(actor, opts) {
  opts = opts || {};
  var pg = page(opts), params = [], where = ['v.merged_into_id IS NULL'];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push(orgVehicleClause('v', params.length)); }
  var q = String(opts.q || '').trim();
  if (q) {
    var pp = plateNormalizer.parsePlate(q), cond = [];
    if (pp.ok) { params.push(pp.canonical); cond.push('EXISTS (SELECT 1 FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.plate_number = $' + params.length + ')'); }
    params.push(like(q.toUpperCase()) + '%'); var pre = params.length;
    cond.push('upper(v.make) LIKE $' + pre, 'upper(v.model) LIKE $' + pre, "replace(coalesce((SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1), ''), ' ', '') LIKE replace($" + pre + ", ' ', '')");
    params.push(q); cond.push('upper(v.ivid) = upper($' + params.length + ')');
    where.push('(' + cond.join(' OR ') + ')');
  }
  var sql = 'SELECT v.id, v.ivid, v.make, v.model, v.variant, v.year, v.fuel_type, v.created_at, ' +
    "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate, " +
    "(SELECT count(*)::int FROM idauto_vehicle_documents d WHERE d.vehicle_id = v.id" + (isAdmin(actor) ? '' : ' AND d.org_id = $1') + ') AS faces, ' +
    '(SELECT max(w.opened_at) FROM idauto_workshop_visits w WHERE w.vehicle_id = v.id' + (isAdmin(actor) ? '' : ' AND w.org_id = $1') + ') AS last_intervention_at ' +
    'FROM idauto_vehicles v WHERE ' + where.join(' AND ') + ' ORDER BY v.created_at DESC LIMIT ' + (pg.limit + 1) + ' OFFSET ' + pg.offset;
  var rows = (await db.query(sql, params)).rows;
  return { page: pg.page, has_more: rows.length > pg.limit, vehicles: rows.slice(0, pg.limit).map(function (r) { return { ivid: r.ivid, plate: r.plate, make: r.make, model: r.model, variant: r.variant, year: r.year, fuel_type: r.fuel_type, documents: r.faces, last_intervention_at: r.last_intervention_at, created_at: r.created_at }; }) };
}

async function listDocuments(actor, opts) {
  var pg = page(opts), params = [], where = ["d.document_type = 'carte_grise'"];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('d.org_id = $' + params.length); }
  var rows = (await db.query('SELECT v.ivid, v.make, v.model, array_agg(d.face ORDER BY d.face) AS faces, max(coalesce(d.updated_at, d.created_at)) AS at, ' +
    "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate " +
    'FROM idauto_vehicle_documents d JOIN idauto_vehicles v ON v.id = d.vehicle_id WHERE ' + where.join(' AND ') + ' GROUP BY v.id ORDER BY at DESC LIMIT ' + (pg.limit + 1) + ' OFFSET ' + pg.offset, params)).rows;
  return { page: pg.page, has_more: rows.length > pg.limit, documents: rows.slice(0, pg.limit).map(function (r) { return { ivid: r.ivid, plate: r.plate, make: r.make, model: r.model, faces: r.faces, at: r.at }; }) };
}

async function listInterventions(actor, opts) {
  opts = opts || {};
  var params = [], where = ['TRUE'];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('w.org_id = $' + params.length); }
  else if (opts.org_id) { params.push(parseInt(opts.org_id, 10) || 0); where.push('w.org_id = $' + params.length); }
  if (['open', 'in_progress', 'closed', 'cancelled'].indexOf(opts.status) !== -1) { params.push(opts.status); where.push('w.status = $' + params.length); }
  if (opts.vehicle) { var vv = await repository.findByRef(String(opts.vehicle)); params.push(vv ? vv.id : -1); where.push('w.vehicle_id = $' + params.length); }
  if (opts.id && /^\d{1,9}$/.test(String(opts.id))) { params.push(parseInt(opts.id, 10)); where.push('w.id = $' + params.length); }
  return { interventions: await interventionsFor(where.join(' AND '), params, 50) };
}

async function listPartsUsed(actor, opts) {
  opts = opts || {};
  var params = [], where = ['(op.part_id IS NOT NULL OR op.part_label IS NOT NULL OR op.part_reference_text IS NOT NULL)'];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('w.org_id = $' + params.length); }
  if (['our_shop', 'customer_supplied', 'external_supplier'].indexOf(opts.source) !== -1) { params.push(opts.source); where.push('op.part_source = $' + params.length); }
  var rows = (await db.query('SELECT op.id, op.visit_id, op.operation_type, op.quantity, op.status, op.part_source, op.part_condition, op.part_label, op.part_reference_text, op.performed_on, op.created_at, op.created_by, ' +
    'pt.reference AS part_reference, pt.name AS part_catalogue_name, pt.brand, v.ivid, v.make, v.model, o.name AS org_name, ' +
    "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = w.vehicle_id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate " +
    'FROM idauto_workshop_operations op JOIN idauto_workshop_visits w ON w.id = op.visit_id LEFT JOIN idauto_parts pt ON pt.id = op.part_id ' +
    'LEFT JOIN idauto_vehicles v ON v.id = w.vehicle_id LEFT JOIN idauto_organizations o ON o.id = w.org_id WHERE ' + where.join(' AND ') + ' ORDER BY coalesce(op.performed_on, op.created_at::date) DESC, op.id DESC LIMIT 100', params)).rows;
  var names = await namesOf(rows.map(function (r) { return r.created_by; }));
  return { parts: rows.map(function (r) { return { id: r.id, intervention: r.visit_id, type: r.operation_type, quantity: r.quantity, status: r.status, source: r.part_source, condition: r.part_condition,
    label: r.part_label || r.part_catalogue_name, reference: r.part_reference_text || r.part_reference, brand: r.brand, from_catalogue: !!r.part_reference, performed_on: r.performed_on, at: r.created_at,
    technician: who(names, r.created_by), vehicle: r.ivid ? { ivid: r.ivid, plate: r.plate, make: r.make, model: r.model } : null, org: r.org_name }; }) };
}

async function listTechnicians(actor) {
  var params = [], where = ['u."role" IN (\'manager\', \'technician\')'];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('u."org_id" = $' + params.length); }
  var rows = (await db.query('SELECT u."id", u."name", u."role", u."org_id", u."createdAt", o.name AS org_name, ' +
    '(SELECT count(*)::int FROM idauto_workshop_visits w WHERE w.opened_by = \'user:\' || u."id") AS interventions, ' +
    '(SELECT count(*)::int FROM idauto_workshop_operations op WHERE op.created_by = \'user:\' || u."id") AS operations, ' +
    '(SELECT max(s."updatedAt") FROM idauto_auth_session s WHERE s."userId" = u."id") AS last_seen ' +
    'FROM idauto_auth_user u LEFT JOIN idauto_organizations o ON o.id = u."org_id" WHERE ' + where.join(' AND ') + ' ORDER BY o.name NULLS LAST, u."role", u."name"', params)).rows;
  return { people: rows.map(function (r) { return { name: r.name, role: r.role, org: r.org_name, since: r.createdAt, interventions: r.interventions, operations: r.operations, last_seen: r.last_seen }; }) };
}

// ---- overview + notifications ---------------------------------------------------
async function count(sql, params) { return (await db.query(sql, params || [])).rows[0].n; }
async function overview(actor) {
  if (isAdmin(actor)) {
    return { scope: 'all_workshops',
      vehicles: await count('SELECT count(*)::int n FROM idauto_vehicles WHERE merged_into_id IS NULL'),
      registered_30d: await count("SELECT count(*)::int n FROM idauto_vehicles WHERE merged_into_id IS NULL AND created_at > NOW() - INTERVAL '30 days'"),
      interventions_open: await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE status IN ('open','in_progress')"),
      interventions_30d: await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE opened_at > NOW() - INTERVAL '30 days'"),
      workshops_active: await count("SELECT count(*)::int n FROM idauto_organizations WHERE status = 'active'"),
      technicians: await count('SELECT count(*)::int n FROM idauto_auth_user WHERE "role" IN (\'manager\', \'technician\')'),
      recent_vehicles: (await listVehicles(actor, {})).vehicles.slice(0, 6),
      recent_interventions: (await interventionsFor('TRUE', [], 6)) };
  }
  var org = orgOf(actor);
  return { scope: 'own_workshop',
    vehicles: await count('SELECT count(*)::int n FROM idauto_vehicles v WHERE v.merged_into_id IS NULL AND ' + orgVehicleClause('v', 1), [org]),
    registered_30d: await count("SELECT count(DISTINCT h.vehicle_id)::int n FROM idauto_vehicle_identification_history h WHERE h.org_id = $1 AND h.method = 'manual_registration' AND h.changed_at > NOW() - INTERVAL '30 days'", [org]),
    interventions_open: await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE org_id = $1 AND status IN ('open','in_progress')", [org]),
    interventions_30d: await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE org_id = $1 AND opened_at > NOW() - INTERVAL '30 days'", [org]),
    technicians: await count('SELECT count(*)::int n FROM idauto_auth_user WHERE "org_id" = $1', [org]),
    recent_vehicles: (await listVehicles(actor, {})).vehicles.slice(0, 6),
    recent_interventions: await interventionsFor('w.org_id = $1', [org], 6) };
}

async function notifications(actor) {
  var items = [];
  function push(n, label, href) { if (n > 0) items.push({ count: n, label: label, href: href }); }
  if (isAdmin(actor)) {
    push(await count("SELECT count(*)::int n FROM idauto_observations WHERE status IN ('pending_review','pending_confirmation')"), 'Observations à vérifier', '/admin/review');
    push(await count("SELECT count(*)::int n FROM idauto_vehicles WHERE fiche_status = 'conflict' AND merged_into_id IS NULL"), 'Fiches en conflit', '/admin/quality');
    push(await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE vehicle_id IS NULL AND status IN ('open','in_progress')"), 'Interventions sans véhicule identifié', '/admin/maintenance');
  } else {
    var org = orgOf(actor);
    push(await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE org_id = $1 AND status IN ('open','in_progress')", [org]), 'Interventions en cours', '/atelier/interventions?status=in_progress');
    push(await count("SELECT count(*)::int n FROM idauto_workshop_visits WHERE org_id = $1 AND vehicle_id IS NULL AND status IN ('open','in_progress')", [org]), 'Interventions sans véhicule identifié', '/atelier/interventions');
    push(await count("SELECT count(DISTINCT h.vehicle_id)::int n FROM idauto_vehicle_identification_history h WHERE h.org_id = $1 AND h.method = 'manual_registration' AND NOT EXISTS (SELECT 1 FROM idauto_vehicle_documents d WHERE d.vehicle_id = h.vehicle_id AND d.org_id = $1 AND d.face = 1)", [org]), 'Véhicules enregistrés sans photo de carte grise', '/atelier/vehicules');
  }
  return { items: items };
}

// ---- global search ----------------------------------------------------------------
async function search(q, actor) {
  var s = String(q || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  var out = { query_length: s.length, groups: [], truncated: false };
  if (s.length < 2) return out;
  var org = orgOf(actor);
  // Vehicles: plate (exact or prefix), IVID, make / model prefix; VIN exact, only with vin:search (audited).
  var vehicles = [];
  if (can(actor, 'vehicle:search') || can(actor, 'vehicle:read')) {
    var params = [], conds = [];
    var pp = plateNormalizer.parsePlate(s);
    if (pp.ok) { params.push(pp.canonical); conds.push('EXISTS (SELECT 1 FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.plate_number = $' + params.length + ')'); }
    var compact = s.toUpperCase().replace(/\s+/g, '');
    if (/^[0-9A-Z]{2,}$/.test(compact)) { params.push(like(compact) + '%'); conds.push("EXISTS (SELECT 1 FROM idauto_plates p WHERE p.vehicle_id = v.id AND replace(replace(p.plate_number, ' ', ''), 'TUN', 'TU') LIKE $" + params.length + ')'); }
    params.push(like(s.toUpperCase()) + '%'); var mk = params.length;
    conds.push('upper(v.make) LIKE $' + mk, 'upper(v.model) LIKE $' + mk, "upper(v.make || ' ' || coalesce(v.model, '')) LIKE $" + mk, 'upper(v.ivid) = upper($' + (params.push(s), params.length) + ')');
    var vin = vinModule.validate(compact);
    if (vin.ok && can(actor, 'vin:search')) {
      var holders = (await db.query("SELECT DISTINCT vehicle_id FROM idauto_vehicle_facts WHERE lower(trim(fact_key)) = 'vin' AND is_active AND (upper(trim(fact_value)) = $1 OR fact_value_normalized = $2)", [vin.vin, vin.vin.toLowerCase()])).rows.map(function (r) { return r.vehicle_id; });
      var first = holders.length ? await repository.canonicalById(holders[0]) : null;
      await writes.recordVinSearchAudit(actor.principal, actor.identity, vin.vin, first ? first.ivid : null);
      params.push(holders.length ? holders : [-1]); conds.push('v.id = ANY($' + params.length + '::int[])');
    }
    var vw = 'v.merged_into_id IS NULL AND (' + conds.join(' OR ') + ')';
    var rows = (await db.query('SELECT v.ivid, v.make, v.model, v.year, ' +
      "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate " +
      'FROM idauto_vehicles v WHERE ' + vw + ' ORDER BY v.updated_at DESC NULLS LAST LIMIT 9', params)).rows;
    if (rows.length > 8) out.truncated = true;
    vehicles = rows.slice(0, 8).map(function (r) { return { href: '/atelier/vehicule?ref=' + encodeURIComponent(r.ivid), plate: r.plate, title: [r.make, r.model, r.year].filter(Boolean).join(' ') || r.ivid, subtitle: r.ivid }; });
  }
  out.groups.push({ key: 'vehicles', items: vehicles });
  // Owners: this account's own contacts, name or phone (audited when something matches).
  var ownerItems = [];
  if (can(actor, 'owner:read')) {
    ownerItems = (await owners.search(s, actor, 6)).map(function (r) { return { href: '/atelier/vehicule?ref=' + encodeURIComponent(r.ivid) + '#owner', title: r.full_name, subtitle: [r.phone, [r.make, r.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') }; });
  }
  out.groups.push({ key: 'owners', items: ownerItems });
  // Interventions: « #123 » / « 123 » (own workshop) or the reason text.
  var intItems = [];
  if (can(actor, 'workshop:read')) {
    var ip = [], iw = [], num = /^#?(\d{1,9})$/.exec(s);
    if (num) { ip.push(parseInt(num[1], 10)); iw.push('w.id = $' + ip.length); }
    if (s.length >= 3) { ip.push('%' + like(s.toLowerCase()) + '%'); iw.push('lower(w.reason) LIKE $' + ip.length); }
    if (iw.length) {
      var scope = isAdmin(actor) ? '' : ' AND w.org_id = $' + (ip.push(org), ip.length);
      intItems = (await db.query('SELECT w.id, w.status, w.reason, w.opened_at, v.ivid, v.make, v.model FROM idauto_workshop_visits w LEFT JOIN idauto_vehicles v ON v.id = w.vehicle_id WHERE (' + iw.join(' OR ') + ')' + scope + ' ORDER BY w.opened_at DESC LIMIT 6', ip)).rows
        .map(function (r) { return { href: '/atelier/interventions?id=' + r.id, title: '#' + r.id + (r.reason ? ' · ' + r.reason : ''), subtitle: [r.make, r.model].filter(Boolean).join(' ') || null }; });
    }
  }
  out.groups.push({ key: 'interventions', items: intItems });
  // Parts: name / reference prefix, the shared catalogue plus this organisation's own.
  var partItems = [];
  if (can(actor, 'parts:read') && s.length >= 2) {
    var pq = [like(s.toLowerCase()) + '%', like(s.toUpperCase().replace(/[\s.\-\/]/g, '')) + '%'], pw = '(lower(name) LIKE $1 OR reference_normalized LIKE $2 OR lower(brand) LIKE $1)';
    if (!isAdmin(actor)) { pq.push(org); pw += ' AND (org_id IS NULL OR org_id = $3)'; }
    partItems = (await db.query('SELECT id, reference, brand, name FROM idauto_parts WHERE ' + pw + ' ORDER BY name LIMIT 6', pq)).rows
      .map(function (r) { return { href: '/atelier/catalogue?q=' + encodeURIComponent(r.reference || r.name), title: r.name || r.reference, subtitle: [r.brand, r.reference].filter(Boolean).join(' · ') }; });
  }
  out.groups.push({ key: 'parts', items: partItems });
  return out;
}

module.exports = { dossier: dossier, listVehicles: listVehicles, listDocuments: listDocuments, listInterventions: listInterventions, listPartsUsed: listPartsUsed,
  listTechnicians: listTechnicians, overview: overview, notifications: notifications, search: search, vehicleOr404: vehicleOr404 };
