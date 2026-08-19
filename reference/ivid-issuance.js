'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4 Option C — IVID issuance
// reference/ivid-issuance.js
//
// A5 OPTION C, 2026-08-19 — owner-approved zero-account public passport
// surface (docs/IDA4_READINESS_AUDIT.md §A5). This module is the ONLY
// place an IVID is ever written to idauto_vehicles.ivid. It:
//
//   - generates the value with reference/ivid.js (pure, offline, no
//     notion of "already issued" — see that file's header);
//   - persists it, and treats the result as PERMANENT: once a vehicle
//     has an ivid, this module never overwrites it, under any call
//     shape, including a caller that races itself;
//   - handles the (astronomically unlikely, per ivid.js's 80-bit-entropy
//     argument) UNIQUE-constraint collision by regenerating, bounded, so
//     a collision cannot hang or crash the caller;
//   - writes an audit row for every issuance, actor_type 'system'
//     (idauto_audit_log.chk_audit_actor allows 'system' —
//     database/schema.sql §22), the same table/shape
//     reference/writes.js's withAudit() already uses elsewhere in this
//     codebase, so audit rows from this module are indistinguishable in
//     shape from any other write's.
//
// Deliberately NOT wired to a bearer identity: issuance is triggered by
// system processes (issueMissing(), or an admin action that itself
// already went through requireAuth()), never by an unauthenticated
// caller — this module has no route of its own; reference/api.js calls
// it only from within already-gated code paths.
//
// Every write here goes through a caller-supplied `client` (already
// inside a transaction the caller owns, or a plain pool query object) —
// this module does not open or manage its own transaction, matching
// reference/writes.js's convention that transaction boundaries live in
// one place.
// =====================================================

var ivid = require('./ivid.js');

var MAX_COLLISION_RETRIES = 5; // bounded — see file header; a real
                                // collision at 80 bits of entropy is not
                                // expected to ever exercise more than one.

// Issues (or returns the existing) IVID for one vehicle, identified by
// its idauto_vehicles.id. PERMANENT: if the vehicle already has a
// non-null ivid, that value is returned unchanged — this function never
// overwrites an existing ivid, no matter what. Returns the ivid string.
//
// `client` is any object exposing query(text, params) returning a
// node-postgres-shaped { rows } — either a pool (reference/db.js) or a
// transaction client (reference/db.js's getClientForTransaction()).
async function issueForVehicle(client, vehicleId) {
  if (vehicleId === undefined || vehicleId === null) {
    throw new Error('ivid-issuance.issueForVehicle: vehicleId is required');
  }

  var existing = await client.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [vehicleId]);
  if (existing.rows.length === 0) {
    throw Object.assign(new Error('ivid-issuance.issueForVehicle: vehicle not found'), { httpStatus: 404 });
  }
  if (existing.rows[0].ivid) {
    // PERMANENT: an existing ivid is returned as-is, never touched.
    return existing.rows[0].ivid;
  }

  var attempt = 0;
  var lastError = null;
  while (attempt < MAX_COLLISION_RETRIES) {
    attempt += 1;
    var candidate = ivid.generate();
    try {
      // WHERE ivid IS NULL is the permanence guard at the SQL layer
      // itself, not only in this function's own logic above: even under
      // a race where two callers reach this UPDATE concurrently for the
      // same vehicle, only the first commits a value — the second's
      // UPDATE matches zero rows (ivid is no longer NULL) and this
      // function falls through to re-read the now-set value below,
      // rather than overwriting it.
      var updated = await client.query(
        'UPDATE idauto_vehicles SET ivid = $1 WHERE id = $2 AND ivid IS NULL RETURNING ivid',
        [candidate, vehicleId]
      );
      if (updated.rows.length === 1) {
        await client.query(
          'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref, change_summary, new_value_json) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7)',
          ['ivid.issue', 'system', 'ivid-issuance', 'idauto_vehicles', String(vehicleId),
            'IDA-4 Option C IVID issuance', JSON.stringify({ ivid: candidate })]
        );
        return candidate;
      }
      // Zero rows updated and no error thrown means a concurrent caller
      // already set ivid on this row between our SELECT and our UPDATE.
      // Re-read and return whatever is there now — never overwrite it.
      var recheck = await client.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [vehicleId]);
      if (recheck.rows.length && recheck.rows[0].ivid) {
        return recheck.rows[0].ivid;
      }
      lastError = new Error('ivid-issuance.issueForVehicle: vehicle disappeared mid-issuance');
      break;
    } catch (err) {
      if (err && err.code === '23505') {
        // UNIQUE collision on the generated value itself (not on the
        // WHERE ivid IS NULL guard) — regenerate and retry, bounded.
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw Object.assign(
    new Error('ivid-issuance.issueForVehicle: could not issue a unique ivid after ' + MAX_COLLISION_RETRIES + ' attempts'),
    { cause: lastError }
  );
}

// Issues an ivid for every vehicle currently lacking one. Returns an
// array of { vehicle_id, ivid, already_had } — already_had is always
// false here since this only selects rows with ivid IS NULL, kept as an
// explicit field (rather than omitted) so callers logging this result
// don't have to know that invariant to read it correctly.
async function issueMissing(client) {
  var missing = await client.query('SELECT id FROM idauto_vehicles WHERE ivid IS NULL ORDER BY id ASC');
  var results = [];
  for (var i = 0; i < missing.rows.length; i++) {
    var vehicleId = missing.rows[i].id;
    var issued = await issueForVehicle(client, vehicleId);
    results.push({ vehicle_id: vehicleId, ivid: issued, already_had: false });
  }
  return results;
}

module.exports = {
  issueForVehicle: issueForVehicle,
  issueMissing: issueMissing,
  MAX_COLLISION_RETRIES: MAX_COLLISION_RETRIES
};
