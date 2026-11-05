'use strict';
// =====================================================
// IDauto — IDA-UI-3 — the owner's contact, PRIVATE (owner decision 2026-11-05)
// reference/workspace/owner-contacts.js
//
// Name, phone, e-mail, address of a vehicle's owner, recorded by a workshop as
// its own client record. Rules (docs/PRIVACY_ARCHITECTURE.md §1a):
//   * stored in idauto_vehicle_owner_contacts only — never on the vehicle,
//     never selected by the passport, the public routes or the registry;
//   * an organisation sees only the contacts IT recorded; an admin sees all;
//   * every read is audited BEFORE the data leaves (fails closed), with no
//     personal data in the audit row (who read whose vehicle, never what);
//   * a change supersedes the previous row — history is kept, never edited.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function isAdmin(actor) { return !!(actor.principal && actor.principal.kind !== 'organisation'); }

// +216 98 765 432 → +21698765432 ; 98 765 432 → 98765432. Digits only otherwise.
function normalizePhone(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  var s = String(v).trim(), plus = s.charAt(0) === '+';
  var digits = s.replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 15 || /[^0-9+\s().\/-]/.test(s)) throw errors.IdautoError('VALIDATION', { field: 'owner.phone', reason: 'invalid_phone' });
  return (plus ? '+' : '') + digits;
}
function clean(v, max) { if (v === null || v === undefined) return null; var s = String(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; }

function validate(input) {
  input = input || {};
  var name = clean(input.full_name, 120);
  if (!name || name.length < 2) throw errors.IdautoError('VALIDATION', { field: 'owner.full_name', reason: 'required' });
  var email = clean(input.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.IdautoError('VALIDATION', { field: 'owner.email', reason: 'invalid_email' });
  var phone = clean(input.phone, 30);
  return { full_name: name, phone: phone, phone_normalized: normalizePhone(phone), email: email, address: clean(input.address, 240), notes: clean(input.notes, 300) };
}

function view(r) {
  return { full_name: r.full_name, phone: r.phone, email: r.email, address: r.address, notes: r.notes, recorded_at: r.created_at, recorded_by: r.created_by, org_id: r.org_id };
}

// The audit row for a read: who, which vehicle, how many contacts — never their content.
async function auditRead(actor, ivid, count, why) {
  var org = orgOf(actor);
  await db.query('INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, org_id, target_type, target_ref, change_summary) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['vehicle.owner.read', org ? 'professional_user' : 'admin', actor.identity, org, 'idauto_vehicle_owner_contacts', ivid, 'Owner contact read (' + (why || 'dossier') + ', ' + count + ' record' + (count === 1 ? '' : 's') + ')']);
}

// Current contact(s) of a vehicle visible to this actor. Audited before returning.
async function current(vehicle, actor, why) {
  var params = [vehicle.id], where = 'vehicle_id = $1 AND superseded_at IS NULL';
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where += ' AND org_id = $2'; }
  var rows = (await db.query('SELECT * FROM idauto_vehicle_owner_contacts WHERE ' + where + ' ORDER BY created_at DESC', params)).rows;
  await auditRead(actor, vehicle.ivid, rows.length, why);
  return rows.map(view);
}

// Insert (or supersede) this organisation's contact for the vehicle, inside the caller's transaction.
async function upsertWith(client, vehicleId, input, actor) {
  var c = validate(input), org = orgOf(actor);
  await client.query('UPDATE idauto_vehicle_owner_contacts SET superseded_at = NOW(), superseded_by = $3 WHERE vehicle_id = $1 AND COALESCE(org_id, 0) = COALESCE($2::int, 0) AND superseded_at IS NULL', [vehicleId, org, actor.identity]);
  await client.query('INSERT INTO idauto_vehicle_owner_contacts (vehicle_id, org_id, full_name, phone, phone_normalized, email, address, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [vehicleId, org, c.full_name, c.phone, c.phone_normalized, c.email, c.address, c.notes, actor.identity]);
  // What the audit row may say: which fields are present, never their values.
  return ['full_name', 'phone', 'email', 'address', 'notes'].filter(function (k) { return !!c[k]; });
}

async function put(vehicle, input, actor) {
  var fields;
  await writes.withAudit({ principal: actor.principal, event_type: 'vehicle.owner.set', target_type: 'idauto_vehicle_owner_contacts', change_summary: 'Owner contact recorded' },
    actor.identity, async function (client) {
      fields = await upsertWith(client, vehicle.id, input, actor);
      return { record: { vehicle: vehicle.ivid, fields_present: fields }, auditTargetRef: vehicle.ivid };
    });
  return { vehicle: vehicle.ivid, fields_present: fields };
}

async function remove(vehicle, actor) {
  var org = orgOf(actor), n = 0;
  await writes.withAudit({ principal: actor.principal, event_type: 'vehicle.owner.remove', target_type: 'idauto_vehicle_owner_contacts', change_summary: 'Owner contact removed (superseded, history kept)' },
    actor.identity, async function (client) {
      var r = await client.query('UPDATE idauto_vehicle_owner_contacts SET superseded_at = NOW(), superseded_by = $3 WHERE vehicle_id = $1 AND COALESCE(org_id, 0) = COALESCE($2::int, 0) AND superseded_at IS NULL', [vehicle.id, org, actor.identity]);
      n = r.rowCount;
      if (!n) throw errors.IdautoError('NOT_FOUND');
      return { record: { vehicle: vehicle.ivid, removed: n }, auditTargetRef: vehicle.ivid };
    });
  return { vehicle: vehicle.ivid, removed: n };
}

// Global search by owner name (prefix) or phone (digits): this actor's contacts only. Audited when
// anything matches (the query itself is not stored: only its kind and the number of hits).
async function search(q, actor, limit) {
  var s = String(q || '').trim();
  if (s.length < 3) return [];
  var digits = s.replace(/[^0-9]/g, ''), byPhone = digits.length >= 6 && /^[+0-9\s().\/-]+$/.test(s);
  var params = [], where = ['c.superseded_at IS NULL'];
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where.push('c.org_id = $' + params.length); }
  if (byPhone) { params.push('%' + digits + '%'); where.push("regexp_replace(c.phone_normalized, '[^0-9]', '', 'g') LIKE $" + params.length); }
  else { params.push(s.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%'); where.push('(lower(c.full_name) LIKE $' + params.length + " OR lower(c.full_name) LIKE '% ' || $" + params.length + ')'); }
  params.push(limit || 6);
  var rows = (await db.query('SELECT c.full_name, c.phone, v.ivid, v.make, v.model FROM idauto_vehicle_owner_contacts c JOIN idauto_vehicles v ON v.id = c.vehicle_id WHERE ' + where.join(' AND ') + ' ORDER BY c.created_at DESC LIMIT $' + params.length, params)).rows;
  if (rows.length) {
    var org = orgOf(actor);
    await db.query('INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, org_id, target_type, change_summary) VALUES ($1,$2,$3,$4,$5,$6)',
      ['vehicle.owner.search', org ? 'professional_user' : 'admin', actor.identity, org, 'idauto_vehicle_owner_contacts', 'Owner search by ' + (byPhone ? 'phone' : 'name') + ' (' + rows.length + ' result' + (rows.length === 1 ? '' : 's') + ')']);
  }
  return rows;
}

async function hasContact(vehicleId, actor) {
  var params = [vehicleId], where = 'vehicle_id = $1 AND superseded_at IS NULL';
  if (!isAdmin(actor)) { params.push(orgOf(actor)); where += ' AND org_id = $2'; }
  return (await db.query('SELECT 1 FROM idauto_vehicle_owner_contacts WHERE ' + where + ' LIMIT 1', params)).rows.length > 0;
}

module.exports = { validate: validate, normalizePhone: normalizePhone, current: current, upsertWith: upsertWith, put: put, remove: remove, search: search, hasContact: hasContact };
