'use strict';
// =====================================================
// IDauto — IDA-UI-4 — the simplified intervention (2026-11-06): one form, one transaction.
//   { vehicle_ref, performed_on, odometer_km, description, technician, parts: [{ label, reference,
//     quantity, source: 'our_shop' | 'customer_supplied' }] }
// It reuses the IDA-V12 tables: the intervention is an idauto_workshop_visits row (recorded as
// done: status 'closed'), each part an idauto_workshop_operations row ('replacement', 'done',
// part_source). No billing, no stock, no catalogue: the source is the technician's DECLARATION,
// never a proven sale (IDauto holds no invoice).
//
// Scope: the account's workshop. An admin acts for a workshop (org_id), or for the only active
// one. Another workshop's intervention → 404. Every write is audited (no part or owner text in
// the audit summary). Cancelling keeps the record (status 'cancelled'); nothing is deleted.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var repository = require('../vehicle/vehicle-repository.js');

var SOURCES = ['our_shop', 'customer_supplied'];
function fail(field, reason) { return errors.IdautoError('VALIDATION', { field: field, reason: reason }); }
function isAdmin(actor) { return !!(actor.principal && actor.principal.kind !== 'organisation'); }

async function orgOf(actor, body) {
  if (!isAdmin(actor)) return actor.principal && actor.principal.org_id;
  if (body && body.org_id) return parseInt(body.org_id, 10) || null;
  var only = (await db.query("SELECT id FROM idauto_organizations WHERE status = 'active' ORDER BY id LIMIT 2")).rows;
  if (only.length === 1) return only[0].id;
  throw fail('org_id', 'required');  // several workshops: the admin chooses one
}

function dateOf(v) {
  if (v === null || v === undefined || v === '') return new Date().toISOString().slice(0, 10);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  var d = m ? new Date(v + 'T00:00:00Z') : null;
  if (!d || isNaN(d) || d.toISOString().slice(0, 10) !== v || +m[1] < 1990 || d.getTime() > Date.now() + 86400000) throw fail('performed_on', 'invalid_date');
  return v;
}
function km(v) {
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{1,7}$/.test(String(v).trim())) throw fail('odometer_km', 'not_a_number');
  var n = parseInt(v, 10);
  if (n > 3000000) throw fail('odometer_km', 'out_of_range');
  return n;
}
function txt(v, max, field) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!s) return null;
  if (s.length > max) throw fail(field, 'too_long');
  return s;
}
function parts(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 30) throw fail('parts', 'invalid');
  return list.map(function (p, i) {
    p = p || {};
    var label = txt(p.label, 120, 'parts[' + i + '].label');
    if (!label) throw fail('parts[' + i + '].label', 'required');
    if (SOURCES.indexOf(p.source) === -1) throw fail('parts[' + i + '].source', 'choose_source');
    var q = p.quantity === undefined || p.quantity === null || p.quantity === '' ? 1 : parseInt(p.quantity, 10);
    if (!isFinite(q) || q < 1 || q > 999) throw fail('parts[' + i + '].quantity', 'out_of_range');
    var id = p.id !== undefined && p.id !== null && p.id !== '' ? parseInt(p.id, 10) : null;
    return { id: id, label: label, reference: txt(p.reference, 60, 'parts[' + i + '].reference'), quantity: q, source: p.source };
  });
}

// The technician: by default the account recording it; a manager / admin may name another account
// of the same workshop (manager or technician).
async function technicianOf(client, value, orgId, actor) {
  if (!value) return actor.identity;
  var ref = /^user:/.test(String(value)) ? String(value) : 'user:' + String(value);
  var u = (await client.query('SELECT 1 FROM idauto_auth_user WHERE "id" = $1 AND "org_id" = $2 AND "role" IN (\'manager\', \'technician\')', [ref.slice(5), orgId])).rows;
  if (!u.length) throw fail('technician', 'not_in_workshop');
  return ref;
}

function validate(body) {
  body = body || {};
  var description = txt(body.description, 1000, 'description');
  var list = parts(body.parts);
  if (!description && !list.length) throw fail('description', 'required');
  return { performed_on: dateOf(body.performed_on), odometer_km: km(body.odometer_km), description: description, parts: list };
}

async function raiseOdometer(client, vehicleId, value, on) {
  if (value === null) return;
  // An odometer only goes up: the vehicle keeps the highest reading (an older or lower one never lowers it).
  await client.query('UPDATE idauto_vehicles SET odometer_km = $1, odometer_at = $2, updated_at = NOW() WHERE id = $3 AND (odometer_km IS NULL OR odometer_km < $1)', [value, on, vehicleId]);
}

async function insertParts(client, visitId, list, on, actor) {
  for (var p of list) {
    await client.query("INSERT INTO idauto_workshop_operations (visit_id, operation_type, quantity, status, created_by, part_source, part_label, part_reference_text, performed_on) VALUES ($1,'replacement',$2,'done',$3,$4,$5,$6,$7)",
      [visitId, p.quantity, actor.identity, p.source, p.label, p.reference, on]);
  }
}

async function create(body, actor) {
  var v = validate(body);
  var vehicle = await repository.findByRef(String((body && body.vehicle_ref) || ''));
  if (!vehicle) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  var orgId = await orgOf(actor, body);
  if (!orgId) throw errors.IdautoError('FORBIDDEN');
  var out = await writes.withAudit({ principal: actor.principal, event_type: 'workshop.intervention.record', target_type: 'idauto_workshop_visits', change_summary: 'Intervention recorded (' + v.parts.length + ' part(s))' },
    actor.identity, async function (client) {
      var tech = await technicianOf(client, body.technician, orgId, actor);
      var r = await client.query("INSERT INTO idauto_workshop_visits (org_id, vehicle_id, status, identification_method, reason, opened_by, closed_at, performed_on, odometer_km, technician_ref) " +
        "VALUES ($1,$2,'closed','manual_selection',$3,$4,NOW(),$5,$6,$7) RETURNING id", [orgId, vehicle.id, v.description, actor.identity, v.performed_on, v.odometer_km, tech]);
      await insertParts(client, r.rows[0].id, v.parts, v.performed_on, actor);
      await raiseOdometer(client, vehicle.id, v.odometer_km, v.performed_on);
      return { record: { id: r.rows[0].id, vehicle: vehicle.ivid, parts: v.parts.length }, auditTargetRef: r.rows[0].id };
    });
  return { id: out.id, vehicle: out.vehicle };
}

async function visitInScope(client, id, actor) {
  var n = /^\d{1,9}$/.test(String(id)) ? parseInt(id, 10) : -1;
  var r = (await client.query('SELECT id, org_id, vehicle_id, status FROM idauto_workshop_visits WHERE id = $1' + (isAdmin(actor) ? '' : ' AND org_id = $2'), isAdmin(actor) ? [n] : [n, actor.principal.org_id])).rows[0];
  if (!r) throw errors.IdautoError('NOT_FOUND');
  return r;
}

// Edit: the header fields, and the parts — a listed id is updated, an unlisted part of this
// intervention is cancelled (kept, never deleted), a part without id is added.
async function update(id, body, actor) {
  var v = validate(body);
  return writes.withAudit({ principal: actor.principal, event_type: 'workshop.intervention.update', target_type: 'idauto_workshop_visits', change_summary: 'Intervention edited (' + v.parts.length + ' part(s))' },
    actor.identity, async function (client) {
      var w = await visitInScope(client, id, actor);
      if (w.status === 'cancelled') throw errors.IdautoError('CONFLICT', { reason: 'intervention_cancelled' });
      var tech = await technicianOf(client, body.technician, w.org_id, actor);
      await client.query('UPDATE idauto_workshop_visits SET reason = $1, performed_on = $2, odometer_km = $3, technician_ref = $4, updated_at = NOW() WHERE id = $5', [v.description, v.performed_on, v.odometer_km, tech, w.id]);
      var existing = (await client.query("SELECT id FROM idauto_workshop_operations WHERE visit_id = $1 AND status <> 'cancelled' AND (part_id IS NOT NULL OR part_label IS NOT NULL OR part_reference_text IS NOT NULL)", [w.id])).rows.map(function (r) { return Number(r.id); });
      var kept = [];
      for (var p of v.parts.filter(function (x) { return x.id !== null; })) {
        if (existing.indexOf(p.id) === -1) throw fail('parts', 'unknown_part');
        await client.query('UPDATE idauto_workshop_operations SET part_label = $1, part_reference_text = $2, quantity = $3, part_source = $4, performed_on = $5 WHERE id = $6 AND visit_id = $7', [p.label, p.reference, p.quantity, p.source, v.performed_on, p.id, w.id]);
        kept.push(p.id);
      }
      var dropped = existing.filter(function (x) { return kept.indexOf(x) === -1; });
      if (dropped.length) await client.query("UPDATE idauto_workshop_operations SET status = 'cancelled' WHERE visit_id = $1 AND id = ANY($2::bigint[])", [w.id, dropped]);
      await insertParts(client, w.id, v.parts.filter(function (x) { return x.id === null; }), v.performed_on, actor);
      if (w.vehicle_id) await raiseOdometer(client, w.vehicle_id, v.odometer_km, v.performed_on);
      return { record: { id: w.id, parts: v.parts.length, cancelled_parts: dropped.length }, auditTargetRef: w.id };
    });
}

async function cancel(id, actor) {
  return writes.withAudit({ principal: actor.principal, event_type: 'workshop.intervention.cancel', target_type: 'idauto_workshop_visits', change_summary: 'Intervention cancelled' },
    actor.identity, async function (client) {
      var w = await visitInScope(client, id, actor);
      await client.query("UPDATE idauto_workshop_visits SET status = 'cancelled', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW() WHERE id = $1", [w.id]);
      return { record: { id: w.id, status: 'cancelled' }, auditTargetRef: w.id };
    });
}

module.exports = { SOURCES: SOURCES, validate: validate, create: create, update: update, cancel: cancel };
