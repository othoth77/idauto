'use strict';
// =====================================================
// IDauto — IDA-CG2 stage 1 — registration document → existing vehicle matcher
// reference/documents/vehicle-matcher.js
//
//   match({ plate, previous_plates, vin }, { allowVin }) →
//     { outcome: 'existing' | 'ambiguous' | 'none', candidates[], identifiers[], reasons[] }
//
// The question it answers before any vehicle is created or updated from a
// carte grise: "is this vehicle already in IDauto, and how sure are we?"
//
// DETERMINISTIC AND READ ONLY. No write, no cache, no provider, no AI. Every
// identifier is normalised by the existing plate normaliser and VIN
// validator — never corrected or completed: an identifier they refuse is
// reported as unusable, not guessed.
//
// WHAT COUNTS AS A MATCH.
//   - a plate, in any spelling the normaliser accepts (spaces, hyphens,
//     TU/TUN/تونس, Arabic-Indic digits), against EVERY plate a vehicle has
//     carried — active or not — so a re-plated vehicle is still found;
//   - a VIN (any fact-key case, active or superseded), only when the caller
//     holds vin:search; the route audits the search like every VIN search;
//   - records merged into another resolve to the canonical vehicle.
// Make, model, year or engine NEVER identify a vehicle: thousands share them.
//
// OUTCOMES.
//   existing  — exactly one canonical vehicle, reached by a STRONG identifier
//               (the card's current plate, active on it; or its active VIN),
//               and nothing on the card contradicts it.
//   ambiguous — anything else that found a vehicle: two or more vehicles; only
//               a weak link (a past plate, a superseded VIN); the card's VIN
//               differs from the VIN on record; the card's current plate is
//               active on a different vehicle. Nothing may be created or
//               linked automatically: a person decides.
//   none      — no identifier reached any vehicle.
// The VIN value is never returned — only whether one is on record and
// whether it matches the card.
// =====================================================

var db = require('../db.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var vinModule = require('../vehicle/vin.js');
var repository = require('../vehicle/vehicle-repository.js');

var MAX_PREVIOUS_PLATES = 10;

function plateInput(raw, role) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  var text = String(raw).slice(0, 40);
  var parsed = plateNormalizer.parsePlate(text);
  if (!parsed.ok) return { role: role, kind: 'plate', usable: false, reason: parsed.reason || 'invalid_plate' };
  return { role: role, kind: 'plate', usable: true, canonical: parsed.canonical, display: parsed.display, format_code: parsed.format_code };
}

async function match(input, opts) {
  input = input || {};
  opts = opts || {};
  var identifiers = [];
  var current = plateInput(input.plate, 'current');
  if (current) identifiers.push(current);
  (Array.isArray(input.previous_plates) ? input.previous_plates.slice(0, MAX_PREVIOUS_PLATES) : []).forEach(function (p) {
    var x = plateInput(p, 'previous'); if (x) identifiers.push(x);
  });
  var vin = null;
  if (input.vin !== null && input.vin !== undefined && String(input.vin).trim() !== '') {
    if (!opts.allowVin) identifiers.push({ role: 'current', kind: 'vin', usable: false, reason: 'not_permitted' });
    else {
      var v = vinModule.validate(String(input.vin).slice(0, 40));
      if (v.ok) { vin = v.vin; identifiers.push({ role: 'current', kind: 'vin', usable: true }); }
      else identifiers.push({ role: 'current', kind: 'vin', usable: false, reason: v.reason || 'invalid_vin' });
    }
  }

  // canonical vehicle id → { row, evidence[] }
  var found = {};
  async function attach(vehicleId, ev) {
    var row = await repository.canonicalById(vehicleId);
    if (!row) return;
    var slot = found[row.id] = found[row.id] || { row: row, evidence: [] };
    if (vehicleId !== row.id) ev.via_merged_record = true;
    slot.evidence.push(ev);
  }

  var plateIds = identifiers.filter(function (i) { return i.kind === 'plate' && i.usable; });
  for (var i = 0; i < plateIds.length; i++) {
    var rows = (await db.query(
      'SELECT vehicle_id, status FROM idauto_plates WHERE plate_number = $1 AND vehicle_id IS NOT NULL ORDER BY id', [plateIds[i].canonical])).rows;
    for (var j = 0; j < rows.length; j++) {
      await attach(rows[j].vehicle_id, { identifier: plateIds[i].role === 'current' ? 'plate' : 'previous_plate', plate: plateIds[i].canonical,
        plate_status: rows[j].status, strong: plateIds[i].role === 'current' && rows[j].status === 'active' });
    }
  }
  if (vin) {
    var vrows = (await db.query(
      "SELECT vehicle_id, is_active FROM idauto_vehicle_facts WHERE LOWER(TRIM(fact_key)) = 'vin' AND (UPPER(TRIM(fact_value)) = $1 OR fact_value_normalized = $2) ORDER BY id",
      [vin, vin.toLowerCase()])).rows;
    for (var k = 0; k < vrows.length; k++) await attach(vrows[k].vehicle_id, { identifier: 'vin', vin_active: vrows[k].is_active, strong: !!vrows[k].is_active });
  }

  var reasons = [];
  var ids = Object.keys(found);
  var candidates = [];
  for (var c = 0; c < ids.length; c++) {
    var slot = found[ids[c]];
    var record = await repository.record(slot.row, { includeVin: false });
    var onRecord = await repository.vinOf(slot.row.id);
    var vinCheck = vin ? (onRecord ? (onRecord.toUpperCase() === vin ? 'match' : 'differs') : 'none_on_record') : 'not_checked';
    candidates.push({
      ivid: slot.row.ivid, internal_ref: slot.row.internal_ref,
      make: slot.row.make, model: slot.row.model, year: slot.row.year, fiche_status: slot.row.fiche_status,
      active_plates: (record.plates || []).map(function (p) { return p.plate || p.plate_number || p; }),
      vin_on_record: !!onRecord, vin_check: vinCheck,
      strong: slot.evidence.some(function (e) { return e.strong; }),
      evidence: slot.evidence
    });
  }

  var outcome;
  if (!candidates.length) outcome = 'none';
  else if (candidates.length > 1) { outcome = 'ambiguous'; reasons.push('several_vehicles'); }
  else {
    var only = candidates[0];
    outcome = 'existing';
    if (!only.strong) { outcome = 'ambiguous'; reasons.push('only_weak_evidence'); }
    if (only.vin_check === 'differs') { outcome = 'ambiguous'; reasons.push('vin_differs_from_record'); }
    // The card's current plate is not active on this vehicle (cancelled, transferred…): a person checks why.
    if (current && current.usable && !only.evidence.some(function (e) { return e.identifier === 'plate' && e.plate_status === 'active'; })) {
      var elsewhere = (await db.query("SELECT 1 FROM idauto_plates WHERE plate_number = $1 AND status = 'active'", [current.canonical])).rows.length > 0;
      if (elsewhere) { outcome = 'ambiguous'; reasons.push('current_plate_active_on_another_vehicle'); }
      else if (only.strong) reasons.push('current_plate_not_on_record');
    }
  }
  if (!identifiers.some(function (x) { return x.usable; })) reasons.push('no_usable_identifier');

  return {
    outcome: outcome,
    requires_human_review: outcome !== 'none' && outcome !== 'existing' ? true : reasons.indexOf('current_plate_not_on_record') !== -1,
    candidates: candidates,
    identifiers: identifiers,
    reasons: reasons,
    creates_nothing: true
  };
}

module.exports = { match: match, MAX_PREVIOUS_PLATES: MAX_PREVIOUS_PLATES };
