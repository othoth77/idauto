'use strict';
// =====================================================
// IDauto — IDA-UI-3 — manual vehicle registration
// reference/workspace/registration-service.js
//
// The registration form: a person types what the carte grise says. No OCR,
// no automatic filling. One transaction creates the vehicle (IVID issued
// inside it), its plate, its VIN and — when given — the owner's private
// contact; the carte grise photos are then attached through the existing
// private document storage (PUT /api/vehicles/:ref/registration-document/:face).
//
// A vehicle that already exists is never created twice: the plate and the VIN
// are locked for the transaction (shared with every other creation path) and
// checked again with the lock held.
// =====================================================

var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');
var identity = require('../identity.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vinModule = require('../vehicle/vin.js');
var repository = require('../vehicle/vehicle-repository.js');
var owners = require('./owner-contacts.js');

var FUELS = ['petrol', 'diesel', 'lpg', 'electric', 'hybrid', 'other'];
var CURRENT_YEAR = new Date().getUTCFullYear();

function fail(field, reason) { return errors.IdautoError('VALIDATION', { field: field, reason: reason }); }
function str(v, max) { if (v === null || v === undefined) return null; var s = String(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; }
function int(body, k, min, max) {
  var v = body[k];
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{1,6}$/.test(String(v).trim())) throw fail(k, 'not_a_number');
  var n = parseInt(v, 10);
  if (n < min || n > max) throw fail(k, 'out_of_range');
  return n;
}

// The plate: { type: 'TU'|'RS', series, number } from the form, or a typed string.
function plateOf(body) {
  var p = body.plate;
  if (p && typeof p === 'object') {
    var type = p.type === 'RS' ? 'RS' : 'TU';
    var series = String(p.series || '').trim(), number = String(p.number || '').trim();
    if (!series && !number) return null;
    // TU and RS (régime suspensif) plates have the same shape: « 123 TU 4567 », « 123 RS 4567 ».
    if (!/^\d{1,3}$/.test(series) || !/^\d{1,4}$/.test(number)) throw fail('plate', 'invalid_plate');
    p = series + ' ' + type + ' ' + number;
  }
  if (p === null || p === undefined || String(p).trim() === '') return null;
  var parsed = plateNormalizer.parsePlate(String(p));
  if (!parsed.ok) throw fail('plate', parsed.reason || 'invalid_plate');
  return parsed;
}

function validate(body) {
  body = body || {};
  var plate = plateOf(body);
  var vin = null;
  if (body.vin !== null && body.vin !== undefined && String(body.vin).trim() !== '') {
    var v = vinModule.validate(String(body.vin));
    if (!v.ok) throw fail('vin', v.reason || 'invalid_vin');
    vin = v.vin;
  }
  if (!plate && !vin) throw fail('plate', 'plate_or_vin_required');
  var make = str(body.make, 80);
  if (!make) throw fail('make', 'required');
  var fuel = str(body.fuel_type, 20);
  if (fuel && FUELS.indexOf(fuel) === -1) throw fail('fuel_type', 'unknown_fuel');
  var out = {
    plate: plate, vin: vin, make: make.toUpperCase(), model: str(body.model, 80), variant: str(body.variant, 80), fuel_type: fuel,
    year: int(body, 'year', 1950, CURRENT_YEAR + 1), engine_cc: int(body, 'engine_cc', 49, 20000), seats: int(body, 'seats', 1, 99),
    gross_weight_kg: int(body, 'gross_weight_kg', 100, 60000), category_code: str(body.category_code, 10), body_type: str(body.body_type, 40),
    engine_code: str(body.engine_code, 30), colour: str(body.colour, 40)
  };
  if (out.category_code && !/^[A-Z][0-9A-Z]{0,3}$/i.test(out.category_code)) throw fail('category_code', 'invalid_category');
  if (out.model) out.model = out.model.toUpperCase();
  var owner = body.owner && (body.owner.full_name || body.owner.phone) ? owners.validate(body.owner) : null;
  return { vehicle: out, owner: owner, ownerInput: owner ? body.owner : null };
}

async function register(body, actor) {
  var v = validate(body);
  var canSeeVin = identity.principalHasScope(actor.principal, 'vin:search');
  var canSeePlate = identity.principalHasScope(actor.principal, 'plate:read');
  // A VIN conflict tells the caller that this VIN is already in IDauto: that is a VIN lookup, and the
  // transaction (with its audit row) is rolled back by the 409. It is audited on its own, before the
  // answer leaves, like every VIN search; if that audit cannot be written, the request fails closed.
  var vinProbe = null;
  var created;
  try {
  created = await writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle.register.manual', target_type: 'idauto_vehicles', change_summary: 'Vehicle registered manually from its carte grise' },
    actor.identity,
    async function (client) {
      var p = v.vehicle.plate;
      await repository.lockIdentifiers(client, p ? p.canonical : null, v.vehicle.vin);
      // Already in IDauto? Say so — and where, when this account may know it.
      if (p) {
        var hit = (await client.query("SELECT vehicle_id FROM idauto_plates WHERE plate_number = $1 AND status = 'active' AND vehicle_id IS NOT NULL LIMIT 1", [p.canonical])).rows[0];
        if (hit) { var known = await repository.canonicalById(hit.vehicle_id, client); throw errors.IdautoError('CONFLICT', { reason: 'vehicle_already_registered', identifier: 'plate', ivid: known && canSeePlate ? known.ivid : null }); }
      }
      if (v.vehicle.vin) {
        var holders = await repository.vehiclesWithVin(client, v.vehicle.vin);
        if (holders.length) { var kv = canSeeVin ? await repository.canonicalById(holders[0], client) : null; vinProbe = { vin: v.vehicle.vin, ivid: kv ? kv.ivid : null }; throw errors.IdautoError('CONFLICT', { reason: 'vehicle_already_registered', identifier: 'vin', ivid: kv ? kv.ivid : null }); }
      }
      var input = Object.assign({}, v.vehicle); delete input.colour;
      var row = await repository.insertIdentifiedVehicle(client, input, actor, { method: 'manual_registration', source: 'manual_registration', confidence: 1 }, true);
      if (v.vehicle.colour) await client.query('UPDATE idauto_vehicles SET colour = $1 WHERE id = $2', [v.vehicle.colour, row.id]);
      var ownerFields = v.owner ? await owners.upsertWith(client, row.id, v.ownerInput, actor) : [];
      return { record: { ivid: row.ivid, plate: p ? p.canonical : null, vin_recorded: !!v.vehicle.vin, owner_fields: ownerFields }, auditTargetRef: row.ivid };
    });
  } catch (err) {
    if (vinProbe) await writes.recordVinSearchAudit(actor.principal, actor.identity, vinProbe.vin, vinProbe.ivid);
    throw err;
  }
  return { ivid: created.ivid, plate: created.plate, vin_recorded: created.vin_recorded, owner_recorded: created.owner_fields.length > 0 };
}

module.exports = { validate: validate, register: register, FUELS: FUELS };
