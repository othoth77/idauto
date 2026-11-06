'use strict';
// =====================================================
// IDauto — IDA-UI-4 — the editable part of a vehicle file (simplification, 2026-11-06):
// make, model, year, last known mileage, and the workshop's own « informations
// complémentaires » (one note per vehicle and workshop, idauto_vehicle_notes — vehicles are
// shared between workshops, a free-text note is not). Plate and VIN are the vehicle's identity
// and are not edited here.
//
// A workshop may edit only a vehicle it works with (visited, registered, documented, owner
// contact, note); any other → 404, as for every cross-workshop read. Admin: any vehicle.
// Every change is audited; the audit row names the fields changed, never the note's text.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var repository = require('../vehicle/vehicle-repository.js');

var CURRENT_YEAR = new Date().getUTCFullYear();
function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function isAdmin(actor) { return !!(actor.principal && actor.principal.kind !== 'organisation'); }
function fail(field, reason) { return errors.IdautoError('VALIDATION', { field: field, reason: reason }); }

function cleanNotes(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!s) return null;
  if (s.length > 500) throw fail('notes', 'too_long');
  return s;
}

async function notesOf(vehicleId, actor) {
  var r = (await db.query('SELECT notes, updated_at FROM idauto_vehicle_notes WHERE vehicle_id = $1 AND COALESCE(org_id, 0) = COALESCE($2::int, 0)', [vehicleId, orgOf(actor)])).rows[0];
  return r ? { text: r.notes, updated_at: r.updated_at } : null;
}

// Inside the caller's transaction. null/empty removes this workshop's note.
async function upsertNotesWith(client, vehicleId, notes, actor) {
  var org = orgOf(actor);
  if (!notes) { await client.query('DELETE FROM idauto_vehicle_notes WHERE vehicle_id = $1 AND COALESCE(org_id, 0) = COALESCE($2::int, 0)', [vehicleId, org]); return; }
  await client.query('INSERT INTO idauto_vehicle_notes (vehicle_id, org_id, notes, updated_by) VALUES ($1, $2, $3, $4) ' +
    'ON CONFLICT (vehicle_id, COALESCE(org_id, 0)) DO UPDATE SET notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = NOW()', [vehicleId, org, notes, actor.identity]);
}

// The vehicles a workshop works with — same rule as the vehicle list (workspace-repository).
async function inScope(vehicleId, actor) {
  if (isAdmin(actor)) return true;
  var org = orgOf(actor);
  if (!org) return false;
  return (await db.query('SELECT 1 FROM idauto_vehicles v WHERE v.id = $1 AND (' +
    'EXISTS (SELECT 1 FROM idauto_workshop_visits w WHERE w.vehicle_id = v.id AND w.org_id = $2) OR ' +
    'EXISTS (SELECT 1 FROM idauto_vehicle_identification_history h WHERE h.vehicle_id = v.id AND h.org_id = $2) OR ' +
    'EXISTS (SELECT 1 FROM idauto_vehicle_documents d WHERE d.vehicle_id = v.id AND d.org_id = $2) OR ' +
    'EXISTS (SELECT 1 FROM idauto_vehicle_owner_contacts c WHERE c.vehicle_id = v.id AND c.org_id = $2 AND c.superseded_at IS NULL) OR ' +
    'EXISTS (SELECT 1 FROM idauto_vehicle_notes n WHERE n.vehicle_id = v.id AND n.org_id = $2))', [vehicleId, org])).rows.length > 0;
}

function text(v, max, field) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw fail(field, 'too_long');
  return s;
}
function num(v, min, max, field) {
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{1,7}$/.test(String(v).trim())) throw fail(field, 'not_a_number');
  var n = parseInt(v, 10);
  if (n < min || n > max) throw fail(field, 'out_of_range');
  return n;
}

// PUT /api/vehicles/:ref/details { make, model, year, odometer_km, notes } — only the keys present change.
async function update(ref, body, actor) {
  body = body || {};
  var v = await repository.findByRef(String(ref || ''));
  if (!v || !(await inScope(v.id, actor))) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  var set = {}, changed = [];
  if ('make' in body) { var mk = text(body.make, 80, 'make'); set.make = mk ? mk.toUpperCase() : null; }
  if ('model' in body) { var md = text(body.model, 80, 'model'); set.model = md ? md.toUpperCase() : null; }
  if ('year' in body) set.year = num(body.year, 1950, CURRENT_YEAR + 1, 'year');
  if ('odometer_km' in body) set.odometer_km = num(body.odometer_km, 0, 3000000, 'odometer_km');
  var notes = 'notes' in body ? cleanNotes(body.notes) : undefined;
  await writes.withAudit({ principal: actor.principal, event_type: 'vehicle.details.update', target_type: 'idauto_vehicles', change_summary: 'Vehicle file edited (make/model/year/mileage/notes)' },
    actor.identity, async function (client) {
      var cols = Object.keys(set);
      if (cols.length) {
        var params = cols.map(function (c) { return set[c]; });
        var assign = cols.map(function (c, i) { return c + ' = $' + (i + 1); });
        if ('odometer_km' in set) assign.push('odometer_at = ' + (set.odometer_km === null ? 'NULL' : 'CURRENT_DATE'));
        params.push(v.id);
        await client.query('UPDATE idauto_vehicles SET ' + assign.join(', ') + ', updated_at = NOW() WHERE id = $' + params.length, params);
        changed = changed.concat(cols);
      }
      if (notes !== undefined) { await upsertNotesWith(client, v.id, notes, actor); changed.push('notes'); }
      return { record: { ivid: v.ivid, fields_changed: changed }, auditTargetRef: v.ivid };
    });
  return { ivid: v.ivid, fields_changed: changed };
}

// DELETE /api/vehicles/:ref — « supprimer » a vehicle record entered by mistake. Nothing is erased: the
// record is ARCHIVED (fiche_status 'archived', an existing status), its plates are cancelled and its VIN
// fact deactivated, so the same plate / VIN can be registered again; lists, counts and search skip it.
// Refused when work is recorded on it (an intervention of any workshop: the maintenance history is kept),
// and, for a manager, when another workshop holds anything about it. Scope vehicle:delete (manager, admin).
async function remove(ref, actor) {
  var v = await repository.findByRef(String(ref || ''));
  if (!v || !(await inScope(v.id, actor))) throw errors.IdautoError('VEHICLE_NOT_FOUND');
  return writes.withAudit({ principal: actor.principal, event_type: 'vehicle.archive', target_type: 'idauto_vehicles', change_summary: 'Vehicle record deleted (archived, data kept)' },
    actor.identity, async function (client) {
      var row = (await client.query('SELECT id, fiche_status FROM idauto_vehicles WHERE id = $1 FOR UPDATE', [v.id])).rows[0];
      if (!row || row.fiche_status === 'archived') throw errors.IdautoError('VEHICLE_NOT_FOUND');
      var work = (await client.query("SELECT count(*)::int n FROM idauto_workshop_visits WHERE vehicle_id = $1 AND status <> 'cancelled'", [v.id])).rows[0].n;
      if (work) throw errors.IdautoError('CONFLICT', { reason: 'vehicle_has_interventions', count: work });
      if (!isAdmin(actor)) {
        var org = orgOf(actor);
        var others = (await client.query(
          'SELECT (SELECT count(*) FROM idauto_vehicle_documents WHERE vehicle_id = $1 AND org_id IS DISTINCT FROM $2) + ' +
          '(SELECT count(*) FROM idauto_vehicle_owner_contacts WHERE vehicle_id = $1 AND superseded_at IS NULL AND org_id IS DISTINCT FROM $2) + ' +
          '(SELECT count(*) FROM idauto_vehicle_notes WHERE vehicle_id = $1 AND org_id IS DISTINCT FROM $2) + ' +
          '(SELECT count(*) FROM idauto_vehicle_identification_history WHERE vehicle_id = $1 AND org_id IS NOT NULL AND org_id <> $2) AS n', [v.id, org])).rows[0].n;
        if (Number(others)) throw errors.IdautoError('CONFLICT', { reason: 'vehicle_used_by_another_workshop' });
      }
      await client.query("UPDATE idauto_vehicles SET fiche_status = 'archived', updated_at = NOW() WHERE id = $1", [v.id]);
      await client.query("UPDATE idauto_plates SET status = 'cancelled' WHERE vehicle_id = $1 AND status = 'active'", [v.id]);
      await client.query("UPDATE idauto_vehicle_facts SET is_active = FALSE WHERE vehicle_id = $1 AND lower(trim(fact_key)) = 'vin' AND is_active", [v.id]);
      return { record: { ivid: v.ivid, archived: true }, auditTargetRef: v.ivid };
    });
}

module.exports = { cleanNotes: cleanNotes, notesOf: notesOf, upsertNotesWith: upsertNotesWith, inScope: inScope, update: update, remove: remove };
