'use strict';
// =====================================================
// IDauto — IDA-V12 — VehicleRepository
// reference/vehicle/vehicle-repository.js
//
// The ONE place the identification path reads and writes idauto_vehicles,
// idauto_plates and the VIN fact. Everything above it (the resolver, the
// workshop service, the routes) speaks in the official Vehicle record
// (record() below, docs/DATABASE.md §Vehicle) and never in table rows.
//
// Reads follow merges: a plate or VIN attached to a record that was later
// merged resolves to the canonical vehicle, exactly as the public route and
// /resolve do (IDA-V8). Writes go through writes.js's withAudit(), so every
// identification change is one transaction: the row, its history entry and
// its audit row commit together or not at all.
//
// The VIN stays a scoped FACT (fact_key = 'vin', IDA-V10), never a column:
// that is what keeps it behind the access_scope machinery and out of the
// public passport. record() includes it only when the caller says so.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var ividIssuance = require('../ivid-issuance.js');
var plateNormalizer = require('./plate-normalizer.js');
var errors = require('./errors.js');

var VEHICLE_COLUMNS =
  'v.id, v.internal_ref, v.ivid, v.make, v.model, v.variant, v.year, v.body_type, v.fuel_type, v.colour, v.engine_cc, ' +
  'v.category_code, v.fiche_status, v.merged_into_id, v.created_at, v.updated_at, ' +
  'v.motorisation, v.engine_code, v.year_from, v.year_to, v.tecdoc_car_id, ' +
  'v.identification_source, v.identification_source_at, v.identification_confidence, v.identification_verified, ' +
  'v.identification_verified_by, v.identification_verified_at, v.identification_method';

var IDENT_FIELDS = ['make', 'model', 'variant', 'year', 'fuel_type', 'engine_cc', 'motorisation', 'engine_code', 'year_from', 'year_to', 'tecdoc_car_id'];

function identSnapshot(row) {
  var out = {};
  IDENT_FIELDS.forEach(function (k) { out[k] = row[k] === undefined ? null : row[k]; });
  out.source = row.identification_source || null;
  out.confidence = row.identification_confidence === undefined ? null : row.identification_confidence;
  out.verified = !!row.identification_verified;
  out.method = row.identification_method || null;
  return out;
}

async function canonicalById(id, runner) {
  var q = runner || db;
  var hops = 0;
  var res = await q.query('SELECT ' + VEHICLE_COLUMNS + ' FROM idauto_vehicles v WHERE v.id = $1', [id]);
  if (!res.rows.length) return null;
  var row = res.rows[0];
  while (row.merged_into_id) {
    if (++hops > 16) return null;
    res = await q.query('SELECT ' + VEHICLE_COLUMNS + ' FROM idauto_vehicles v WHERE v.id = $1', [row.merged_into_id]);
    if (!res.rows.length) return null;
    row = res.rows[0];
  }
  return row;
}

async function findByRef(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  var res = await db.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1 OR ivid = $1', [ref]);
  return res.rows.length ? canonicalById(res.rows[0].id) : null;
}

async function findByPlate(canonical) {
  var res = await db.query(
    "SELECT id, vehicle_id, plate_number, format_code FROM idauto_plates WHERE plate_number = $1 AND status = 'active' AND vehicle_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    [canonical]);
  if (!res.rows.length) return null;
  var vehicle = await canonicalById(res.rows[0].vehicle_id);
  return vehicle ? { vehicle: vehicle, plate: res.rows[0] } : null;
}

async function findByVin(vin) {
  var res = await db.query(
    "SELECT vehicle_id FROM idauto_vehicle_facts WHERE fact_key = 'vin' AND is_active = TRUE AND (fact_value_normalized = $1 OR UPPER(TRIM(fact_value)) = $2) ORDER BY id DESC LIMIT 1",
    [vin.toLowerCase(), vin.toUpperCase()]);
  return res.rows.length ? canonicalById(res.rows[0].vehicle_id) : null;
}

async function findByTecDocCarId(carId) {
  var res = await db.query('SELECT ' + VEHICLE_COLUMNS + ' FROM idauto_vehicles v WHERE v.tecdoc_car_id = $1 AND v.merged_into_id IS NULL ORDER BY v.id LIMIT 20', [carId]);
  return res.rows;
}

// Exact, case-insensitive match on the manual-selection axes. Used so that
// a manual selection lands on an existing record before creating a new one.
async function findByAttributes(sel) {
  var where = ['v.merged_into_id IS NULL'], params = [], i = 1;
  if (sel.manufacturer) { where.push('UPPER(v.make) = UPPER($' + i++ + ')'); params.push(sel.manufacturer); }
  if (sel.model) { where.push('UPPER(v.model) = UPPER($' + i++ + ')'); params.push(sel.model); }
  if (sel.motorisation) { where.push('UPPER(v.motorisation) = UPPER($' + i++ + ')'); params.push(sel.motorisation); }
  if (sel.year) { where.push('v.year = $' + i++); params.push(sel.year); }
  if (sel.tecdoc_car_id) { where.push('v.tecdoc_car_id = $' + i++); params.push(sel.tecdoc_car_id); }
  if (params.length < 2 && !sel.tecdoc_car_id) return [];
  var res = await db.query('SELECT ' + VEHICLE_COLUMNS + ' FROM idauto_vehicles v WHERE ' + where.join(' AND ') + ' ORDER BY v.id LIMIT 10', params);
  return res.rows;
}

async function platesOf(vehicleId, runner) {
  var res = await (runner || db).query(
    "SELECT id, plate_number, format_code, status, created_at FROM idauto_plates WHERE vehicle_id = $1 AND status = 'active' ORDER BY id", [vehicleId]);
  return res.rows;
}

async function vinOf(vehicleId, runner) {
  var res = await (runner || db).query(
    "SELECT fact_value FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND fact_key = 'vin' AND is_active = TRUE ORDER BY id DESC LIMIT 1", [vehicleId]);
  return res.rows.length ? String(res.rows[0].fact_value).toUpperCase() : null;
}

// The official Vehicle record. `opts.includeVin` must be decided by the
// caller from the principal's scope; the VIN is otherwise reported only as
// present/absent.
async function record(row, opts) {
  opts = opts || {};
  var plates = await platesOf(row.id);
  var vin = await vinOf(row.id);
  var primary = plates.length ? plateNormalizer.parsePlate(plates[0].plate_number) : null;
  var out = {
    id: row.ivid,
    internal_ref: row.internal_ref,
    plate: plates.length ? plates[0].plate_number : null,
    plate_display: primary && primary.ok ? primary.display : (plates.length ? plates[0].plate_number : null),
    registration_type: primary && primary.ok ? primary.registrationType : null,
    plates: plates.map(function (p) { return { plate: p.plate_number, format_code: p.format_code, since: p.created_at }; }),
    vin_present: !!vin,
    manufacturer: row.make, model: row.model, version: row.variant,
    motorisation: row.motorisation, engine_code: row.engine_code,
    year: row.year, year_from: row.year_from, year_to: row.year_to,
    fuel_type: row.fuel_type, engine_cc: row.engine_cc,
    tecdoc_car_id: row.tecdoc_car_id,
    source: row.identification_source, source_timestamp: row.identification_source_at,
    confidence: row.identification_confidence,
    verified: !!row.identification_verified, verified_by: row.identification_verified_by, verified_at: row.identification_verified_at,
    verification_method: row.identification_method,
    fiche_status: row.fiche_status,
    created_at: row.created_at, updated_at: row.updated_at
  };
  if (opts.includeVin) out.vin = vin;
  return out;
}

function actorType(actor) {
  if (!actor) return 'system';
  return actor.principal && actor.principal.kind === 'organisation' ? 'organisation' : 'admin';
}
function actorOrg(actor) { return actor && actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }

function cleanIdentFields(input) {
  var out = {};
  var s = function (k, max) { if (input[k] !== undefined && input[k] !== null && input[k] !== '') out[k] = String(input[k]).trim().slice(0, max); };
  var n = function (k, min, max) {
    if (input[k] === undefined || input[k] === null || input[k] === '') return;
    var v = parseInt(input[k], 10);
    if (!isFinite(v) || v < min || v > max) throw errors.IdautoError('VALIDATION', { field: k });
    out[k] = v;
  };
  s('make', 80); s('model', 80); s('variant', 80); s('motorisation', 80); s('engine_code', 30); s('fuel_type', 20);
  n('year', 1900, 2100); n('year_from', 1900, 2100); n('year_to', 1900, 2100); n('engine_cc', 1, 20000); n('tecdoc_car_id', 1, 2147483647);
  if (input.manufacturer !== undefined && out.make === undefined && input.manufacturer) out.make = String(input.manufacturer).trim().slice(0, 80);
  if (input.version !== undefined && out.variant === undefined && input.version) out.variant = String(input.version).trim().slice(0, 80);
  return out;
}

async function insertHistory(client, vehicleId, actor, action, prov, previous, next) {
  await client.query(
    'INSERT INTO idauto_vehicle_identification_history (vehicle_id, actor_type, actor_ref, org_id, action, method, source, confidence, previous, next) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [vehicleId, actorType(actor), actor ? actor.identity : null, actorOrg(actor), action,
      prov.method || null, prov.source || null, prov.confidence === undefined ? null : prov.confidence,
      previous ? JSON.stringify(previous) : null, next ? JSON.stringify(next) : null]);
}

async function attachPlate(client, vehicleId, parsed) {
  if (!parsed || !parsed.ok) return null;
  var existing = await client.query("SELECT id, vehicle_id FROM idauto_plates WHERE plate_number = $1 AND status = 'active'", [parsed.canonical]);
  if (existing.rows.length) {
    if (existing.rows[0].vehicle_id && existing.rows[0].vehicle_id !== vehicleId) {
      throw errors.IdautoError('CONFLICT', { plate: parsed.canonical, reason: 'plate_attached_to_another_vehicle' });
    }
    if (!existing.rows[0].vehicle_id) await client.query('UPDATE idauto_plates SET vehicle_id = $1, updated_at = NOW() WHERE id = $2', [vehicleId, existing.rows[0].id]);
    return existing.rows[0].id;
  }
  var ins = await client.query(
    "INSERT INTO idauto_plates (plate_number, plate_raw, format_code, vehicle_id, status) VALUES ($1,$2,$3,$4,'active') RETURNING id",
    [parsed.canonical, parsed.display.slice(0, 30), parsed.format_code, vehicleId]);
  return ins.rows[0].id;
}

async function attachVin(client, vehicleId, vin, verified) {
  if (!vin) return;
  var current = await vinOf(vehicleId, client);
  if (current === vin) return;
  if (current) await client.query("UPDATE idauto_vehicle_facts SET is_active = FALSE WHERE vehicle_id = $1 AND fact_key = 'vin' AND is_active = TRUE", [vehicleId]);
  await client.query(
    "INSERT INTO idauto_vehicle_facts (vehicle_id, fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, access_scope) " +
    "VALUES ($1,'vin',$2,$3,$4,$5,'professional')",
    [vehicleId, vin, vin.toLowerCase(), verified ? 1.0 : 0.6, verified ? 'verified' : 'unverified']);
}

function provenanceSql(prov, verified, actor, startIndex) {
  var sets = [], params = [], i = startIndex;
  sets.push('identification_source = $' + i++); params.push(prov.source || null);
  sets.push('identification_source_at = ' + (prov.source_timestamp ? '$' + i++ : 'NOW()')); if (prov.source_timestamp) params.push(prov.source_timestamp);
  sets.push('identification_confidence = $' + i++); params.push(prov.confidence === undefined ? null : prov.confidence);
  sets.push('identification_method = $' + i++); params.push(prov.method || null);
  sets.push('identification_verified = $' + i++); params.push(!!verified);
  sets.push('identification_verified_by = $' + i++); params.push(verified ? (actor ? actor.identity : null) : null);
  sets.push('identification_verified_at = ' + (verified ? 'NOW()' : 'NULL'));
  return { sets: sets, params: params, next: i };
}

// Creates a vehicle from a (confirmed or provider-supplied) identification.
// plate: a parsePlate() result or null; vin: validated VIN string or null.
async function createIdentifiedVehicle(input, actor, prov, verified) {
  var fields = cleanIdentFields(input);
  if (!fields.make && !input.vin && !(input.plate && input.plate.ok)) throw errors.IdautoError('VALIDATION', { reason: 'nothing_to_identify' });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle.identify.create', target_type: 'idauto_vehicles', change_summary: 'Vehicle created from identification (' + (prov.method || 'unknown') + ', ' + (prov.source || 'unknown') + ')' },
    actor.identity,
    async function (client) {
      var internalRef = 'IDA2D-' + Date.now().toString(36) + '-' + require('crypto').randomBytes(4).toString('hex');
      var cols = ['internal_ref', 'fiche_status'], vals = [internalRef, verified ? 'verified' : 'pending_review'];
      Object.keys(fields).forEach(function (k) { cols.push(k); vals.push(fields[k]); });
      var p = provenanceSql(prov, verified, actor, vals.length + 1);
      var placeholders = vals.map(function (_, idx) { return '$' + (idx + 1); });
      var sql = 'INSERT INTO idauto_vehicles (' + cols.join(', ') + ', ' +
        p.sets.map(function (s) { return s.split(' = ')[0]; }).join(', ') + ') VALUES (' + placeholders.join(', ') + ', ' +
        p.sets.map(function (s) { return s.split(' = ')[1]; }).join(', ') + ') RETURNING id';
      var ins = await client.query(sql, vals.concat(p.params));
      var id = ins.rows[0].id;
      await ividIssuance.issueForVehicle(client, id, { skipAudit: true });
      if (input.plate && input.plate.ok) await attachPlate(client, id, input.plate);
      if (input.vin) await attachVin(client, id, input.vin, verified);
      var row = await canonicalById(id, client);
      await insertHistory(client, id, actor, verified ? 'confirmed' : 'resolved', prov, null, identSnapshot(row));
      return { record: { internal_ref: row.internal_ref, ivid: row.ivid, id: id }, auditTargetRef: row.internal_ref };
    }
  ).then(function (r) { return canonicalById(r.id); });
}

// Updates the identification of an existing vehicle (confirm / edit /
// refresh). Returns the canonical row after the change.
async function saveIdentification(row, input, actor, prov, action, verified) {
  var fields = cleanIdentFields(input || {});
  var previous = identSnapshot(row);
  return writes.withAudit(
    { principal: actor.principal, event_type: 'vehicle.identify.' + action, target_type: 'idauto_vehicles', change_summary: 'Identification ' + action + ' (' + (prov.method || 'unknown') + ')' },
    actor.identity,
    async function (client) {
      var sets = [], params = [], i = 1;
      Object.keys(fields).forEach(function (k) { sets.push(k + ' = $' + i++); params.push(fields[k]); });
      var p = provenanceSql(prov, verified, actor, i);
      sets = sets.concat(p.sets); params = params.concat(p.params); i = p.next;
      sets.push('updated_at = NOW()');
      if (verified && row.fiche_status === 'initial' || verified && row.fiche_status === 'pending_review') sets.push("fiche_status = 'verified'");
      params.push(row.id);
      await client.query('UPDATE idauto_vehicles SET ' + sets.join(', ') + ' WHERE id = $' + i, params);
      if (input && input.plate && input.plate.ok) await attachPlate(client, row.id, input.plate);
      if (input && input.vin) await attachVin(client, row.id, input.vin, verified);
      var after = await canonicalById(row.id, client);
      await insertHistory(client, row.id, actor, action, prov, previous, identSnapshot(after));
      return { record: { internal_ref: after.internal_ref, ivid: after.ivid }, auditTargetRef: after.internal_ref };
    }
  ).then(function () { return canonicalById(row.id); });
}

async function history(vehicleId) {
  var res = await db.query(
    'SELECT id, changed_at, actor_type, actor_ref, org_id, action, method, source, confidence, previous, next ' +
    'FROM idauto_vehicle_identification_history WHERE vehicle_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 100', [vehicleId]);
  return res.rows;
}

module.exports = {
  findByRef: findByRef, findByPlate: findByPlate, findByVin: findByVin, findByTecDocCarId: findByTecDocCarId,
  findByAttributes: findByAttributes, platesOf: platesOf, vinOf: vinOf, record: record,
  createIdentifiedVehicle: createIdentifiedVehicle, saveIdentification: saveIdentification, history: history,
  cleanIdentFields: cleanIdentFields, identSnapshot: identSnapshot
};
