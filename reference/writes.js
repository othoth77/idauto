'use strict';
// =====================================================
// MYTHOS — ID Auto — write endpoints + atomic audit logging
// reference/writes.js
//
// Every mutation in this module goes through withAudit(): one BEGIN, the
// caller's own data statement(s) against a shared client, one INSERT into
// idauto_audit_log, one COMMIT — or a single ROLLBACK if any part fails.
// There is exactly one place transaction atomicity is implemented; no
// endpoint handler below opens its own BEGIN/COMMIT.
//
// Actor identity (IDA-2D: hardcoded placeholder; IDA-2E-PRE: real,
// caller-supplied identity string): every create*() function below takes
// an `identity` parameter — the resolved value from
// reference/identity.js, never the raw bearer token.
// withAudit() fails closed if identity is missing/empty: it will not
// write an audit row (or its paired data row) with no attributable
// actor. See identity.js's header for what this identity mechanism is
// and is not — it is not the real Mythos OS auth service integration
// described in docs/ARCHITECTURE.md §4.1, which remains blocked.
//
// Scope restrictions carried over/extended from IDA-2C:
//   - capture_method on observations is restricted to 'manual_admin' only
//     — this endpoint is the "Admin manual entry" deliverable specifically,
//     not a general-purpose ingestion path for other capture types.
//   - Unlike IDA-2C's read endpoints (which still exclude mythos_private
//     data, since no audit-on-READ path exists), WRITES may set
//     access_scope='mythos_private' on a fact — because writing one IS
//     audited, by this module, satisfying AD-9's requirement for that
//     scope. Reads remain restricted until a future slice adds
//     audit-on-read.
// =====================================================

var db = require('./db.js');
var crypto = require('crypto');
var storage = require('./storage.js');
var ividIssuance = require('./ivid-issuance.js');

// Maps a Postgres error to a safe {status, error} pair — never echoes the
// driver's raw message (it can include table/column/value fragments).
function mapDbError(err) {
  if (err.code === '23505') return { status: 409, error: 'conflict — a record with this value already exists' };
  if (err.code === '23503') return { status: 400, error: 'invalid reference — a related record does not exist' };
  if (err.code === '23514') return { status: 400, error: 'invalid value — violates a database constraint' };
  if (err.code === '22P02') return { status: 400, error: 'invalid input format' };
  return { status: 500, error: 'internal error' };
}

// Runs `work(client)` inside BEGIN/COMMIT, then writes one audit row
// describing it (attributed to `identity`), all on the same
// client/transaction. `work` must return { record, auditTargetRef }.
// Rolls back and re-throws on any failure — including a failure in the
// audit insert itself, which also undoes whatever `work` did. A work result
// may set skipAudit only for a transaction-locked, verified no-op (IDA-2H's
// repeated identical review decision); actual mutations never use it. Fails
// closed (throws before opening a transaction at all) if `identity` is
// falsy — there is no code path that writes data without an attributable
// audit actor.
async function withAudit(auditMeta, identity, work) {
  if (!identity) {
    throw Object.assign(new Error('no authenticated identity — refusing to write without an attributable audit actor'), { httpStatus: 401 });
  }
  var client = await db.getClientForTransaction();
  try {
    await client.query('BEGIN');
    var outcome = await work(client);
    if (!outcome.skipAudit) {
      await client.query(
        'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref, change_summary, new_value_json) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          auditMeta.event_type,
          'admin',
          identity,
          auditMeta.target_type,
          String(outcome.auditTargetRef),
          auditMeta.change_summary,
          JSON.stringify(outcome.record)
        ]
      );
    }
    await client.query('COMMIT');
    return outcome.record;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function genInternalRef() {
  return 'IDA2D-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

// POST /api/vehicles
// F2 (Opus review, 2026-08-19): every vehicle created here gets a
// permanent ivid, issued inside this SAME transaction via
// reference/ivid-issuance.js's issueForVehicle() — see that module's
// header for the permanence guarantee. Previously nothing in production
// called that module at all; issuance only ever happened out-of-band
// (issueMissing(), or directly from the test suite). skipAudit:true on
// the issuance call because this write already gets exactly ONE audit
// row below (event_type='vehicle.create'), whose new_value_json now
// includes the issued ivid — a second 'ivid.issue' row for the same
// atomic write would double the audit-row count for this one write,
// which tests/ida-2d-write-api-and-audit-test.js's §2 asserts is
// exactly one.
async function createVehicle(body, identity) {
  var internalRef = genInternalRef();
  return withAudit(
    { event_type: 'vehicle.create', target_type: 'idauto_vehicles', change_summary: 'Manual admin vehicle entry' },
    identity,
    async function (client) {
      var result = await client.query(
        'INSERT INTO idauto_vehicles (internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, gross_weight_kg, engine_cc, category_code, fiche_status) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, gross_weight_kg, engine_cc, category_code, fiche_status',
        [internalRef, body.make || null, body.model || null, body.variant || null, body.year || null,
          body.body_type || null, body.fuel_type || null, body.colour || null, body.seats || null,
          body.gross_weight_kg || null, body.engine_cc || null, body.category_code || null, 'initial']
      );
      var row = result.rows[0];
      row.ivid = await ividIssuance.issueForVehicle(client, row.id, { skipAudit: true });
      delete row.id; // internal serial PK — never part of this API's response shape, unchanged from before this wiring.
      return { record: row, auditTargetRef: internalRef };
    }
  );
}

// POST /api/plates
async function createPlate(body, identity) {
  return withAudit(
    { event_type: 'plate.create', target_type: 'idauto_plates', change_summary: 'Manual admin plate entry' },
    identity,
    async function (client) {
      var vehicleId = null;
      if (body.vehicle_internal_ref) {
        var v = await client.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1', [body.vehicle_internal_ref]);
        if (v.rows.length === 0) {
          var e = new Error('vehicle_internal_ref not found');
          e.code = '23503';
          throw e;
        }
        vehicleId = v.rows[0].id;
      }
      var governorateId = null;
      if (body.governorate_code) {
        var g = await client.query('SELECT id FROM idauto_governorates WHERE code = $1', [body.governorate_code]);
        governorateId = g.rows.length ? g.rows[0].id : null;
      }
      var result = await client.query(
        'INSERT INTO idauto_plates (plate_number, format_code, governorate_id, vehicle_id, status) ' +
        'VALUES ($1,$2,$3,$4,$5) RETURNING plate_number, format_code, governorate_id, vehicle_id, status',
        [body.plate_number, body.format_code, governorateId, vehicleId, 'active']
      );
      var row = result.rows[0];
      return { record: row, auditTargetRef: row.plate_number };
    }
  );
}

var ALLOWED_OBSERVATION_STATUS = ['received', 'processing', 'pending_confirmation', 'pending_review', 'accepted', 'rejected', 'duplicate', 'conflict', 'blocked'];

// POST /api/observations
// capture_method is hardcoded to 'manual_admin' — not caller-controlled —
// this endpoint IS the manual-admin-entry path, not a general ingestion
// route for other capture types (smart_gate, public_upload, etc.).
async function createObservation(body, identity) {
  return withAudit(
    { event_type: 'observation.create', target_type: 'idauto_observations', change_summary: 'Manual admin observation entry' },
    identity,
    async function (client) {
      var v = await client.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1', [body.vehicle_internal_ref]);
      if (v.rows.length === 0) {
        var e1 = new Error('vehicle_internal_ref not found');
        e1.code = '23503';
        throw e1;
      }
      var plateId = null;
      if (body.plate_number) {
        var p = await client.query('SELECT id FROM idauto_plates WHERE plate_number = $1', [body.plate_number]);
        plateId = p.rows.length ? p.rows[0].id : null;
      }
      var source = await client.query("SELECT id FROM idauto_capture_sources WHERE code = 'MANUAL_ADMIN'");
      var status = ALLOWED_OBSERVATION_STATUS.indexOf(body.status) !== -1 ? body.status : 'received';
      var result = await client.query(
        'INSERT INTO idauto_observations (vehicle_id, plate_id, capture_source_id, capture_method, status) ' +
        'VALUES ($1,$2,$3,$4,$5) RETURNING id, vehicle_id, plate_id, capture_method, status',
        [v.rows[0].id, plateId, source.rows[0].id, 'manual_admin', status]
      );
      var row = result.rows[0];
      return { record: row, auditTargetRef: row.id };
    }
  );
}

// POST /api/review/observations/:id/decision (IDA-2H)
// Observation status is the schema's sole documented mutability exception.
// The row lock makes concurrent decisions deterministic. Repeating the same
// decision is a no-op (and therefore creates no duplicate audit event); trying
// to reverse a completed decision fails closed with 409.
async function reviewObservation(observationId, decision, identity) {
  var targetStatus = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : null;
  if (!targetStatus) {
    throw Object.assign(new Error('decision must be accept or reject'), { httpStatus: 400 });
  }
  return withAudit(
    { event_type: 'observation.review.' + decision, target_type: 'idauto_observations', change_summary: 'Admin review decision: ' + targetStatus },
    identity,
    async function (client) {
      var current = await client.query(
        'SELECT id, vehicle_id, plate_id, capture_method, status FROM idauto_observations WHERE id = $1 FOR UPDATE',
        [observationId]
      );
      if (current.rows.length === 0) {
        throw Object.assign(new Error('observation not found'), { httpStatus: 404 });
      }
      if (current.rows[0].status === targetStatus) {
        return { record: current.rows[0], auditTargetRef: current.rows[0].id, skipAudit: true };
      }
      if (['pending_review', 'pending_confirmation'].indexOf(current.rows[0].status) === -1) {
        throw Object.assign(new Error('observation is no longer pending review'), { httpStatus: 409 });
      }
      var updated = await client.query(
        'UPDATE idauto_observations SET status = $1 WHERE id = $2 RETURNING id, vehicle_id, plate_id, capture_method, status',
        [targetStatus, observationId]
      );
      return { record: updated.rows[0], auditTargetRef: updated.rows[0].id };
    }
  );
}

// POST /api/review/facts/:id/decision (IDA-3E)
// Fact review is independent from observation review. Acceptance is the only
// transition that widens an ingested community fact to public visibility.
async function reviewFact(factId, decision, identity) {
  var targetStatus = decision === 'accept' ? 'verified' : decision === 'reject' ? 'rejected' : null;
  if (!targetStatus) {
    throw Object.assign(new Error('decision must be accept or reject'), { httpStatus: 400 });
  }
  return withAudit(
    { event_type: 'fact.review.' + decision, target_type: 'idauto_vehicle_facts', change_summary: 'Admin review decision: ' + targetStatus },
    identity,
    async function (client) {
      var current = await client.query(
        'SELECT id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope FROM idauto_vehicle_facts WHERE id = $1 FOR UPDATE',
        [factId]
      );
      if (current.rows.length === 0) {
        throw Object.assign(new Error('fact not found'), { httpStatus: 404 });
      }
      if (current.rows[0].verification_status === targetStatus) {
        return { record: current.rows[0], auditTargetRef: current.rows[0].id, skipAudit: true };
      }
      if (['pending_review', 'unverified'].indexOf(current.rows[0].verification_status) === -1) {
        throw Object.assign(new Error('fact is no longer pending review'), { httpStatus: 409 });
      }
      var updated = await client.query(
        decision === 'accept'
          ? "UPDATE idauto_vehicle_facts SET verification_status = 'verified', access_scope = 'public' WHERE id = $1 RETURNING id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope"
          : "UPDATE idauto_vehicle_facts SET verification_status = 'rejected' WHERE id = $1 RETURNING id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope",
        [factId]
      );
      return { record: updated.rows[0], auditTargetRef: updated.rows[0].id };
    }
  );
}

var ALLOWED_ACCESS_SCOPE = ['public', 'professional', 'mythos_private'];
var ALLOWED_EVIDENCE_TYPE = ['user_confirmation', 'cross_source_match', 'vin_decode', 'document_scan', 'professional_assertion', 'automated_check', 'admin_validation'];

// POST /api/vehicles/:internal_ref/facts
// Optionally creates one idauto_fact_evidence row in the same transaction
// if evidence_type is supplied — one audit record covers both.
async function createFact(vehicleInternalRef, body, identity) {
  return withAudit(
    { event_type: 'fact.create', target_type: 'idauto_vehicle_facts', change_summary: 'Manual admin fact entry for ' + vehicleInternalRef },
    identity,
    async function (client) {
      var v = await client.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1', [vehicleInternalRef]);
      if (v.rows.length === 0) {
        var e1 = new Error('vehicle not found');
        e1.code = '23503';
        throw e1;
      }
      var observationId = null;
      if (body.observation_id != null) {
        var observation = await client.query(
          'SELECT id FROM idauto_observations WHERE id = $1 AND vehicle_id = $2',
          [body.observation_id, v.rows[0].id]
        );
        if (observation.rows.length === 0) {
          var e2 = new Error('observation_id not found for vehicle');
          e2.code = '23503';
          throw e2;
        }
        observationId = observation.rows[0].id;
      }
      var accessScope = ALLOWED_ACCESS_SCOPE.indexOf(body.access_scope) !== -1 ? body.access_scope : 'public';
      var factResult = await client.query(
        'INSERT INTO idauto_vehicle_facts (vehicle_id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope) ' +
        "VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope",
        [v.rows[0].id, observationId, body.fact_key, body.fact_value,
          typeof body.confidence_score === 'number' ? body.confidence_score : 0.5,
          body.verification_status || 'unverified', accessScope]
      );
      var factRow = factResult.rows[0];
      var evidenceRow = null;
      if (body.evidence_type && ALLOWED_EVIDENCE_TYPE.indexOf(body.evidence_type) !== -1) {
        var evResult = await client.query(
          'INSERT INTO idauto_fact_evidence (fact_id, evidence_type, weight) VALUES ($1,$2,$3) RETURNING evidence_type, weight',
          [factRow.id, body.evidence_type, typeof body.weight === 'number' ? body.weight : 0.1]
        );
        evidenceRow = evResult.rows[0];
      }
      var record = { fact: factRow, evidence: evidenceRow };
      return { record: record, auditTargetRef: factRow.id };
    }
  );
}

var ALLOWED_MEDIA_TYPE = ['original_image', 'plate_crop', 'vehicle_crop', 'processed_derivative', 'carte_grise_original', 'carte_grise_derivative'];

// POST /api/observations/:id/media (IDA-2F)
// The one write in this module where the transaction boundary doesn't
// cover everything: storage.store() writes to the local filesystem
// BEFORE any database statement runs, because a filesystem write cannot
// participate in a Postgres transaction. If the observation doesn't
// exist, we find out and fail *before* touching disk. If the atomic
// DB+audit insert (withAudit) fails for any other reason after the file
// was already written, the catch block below removes the file — but
// only after confirming no OTHER idauto_observation_media row already
// references the same content-addressed object_key (storage is
// content-addressed: two different observations uploading identical
// bytes get the same key, so a naive unconditional delete could remove
// a file a different, already-committed row still needs).
async function createObservationMedia(observationId, buffer, mimeType, body, identity) {
  var checkClient = await db.getClientForTransaction();
  var observationExists;
  try {
    var check = await checkClient.query('SELECT id FROM idauto_observations WHERE id = $1', [observationId]);
    observationExists = check.rows.length > 0;
  } finally {
    checkClient.release();
  }
  if (!observationExists) {
    throw Object.assign(new Error('observation not found'), { httpStatus: 404 });
  }

  var stored = storage.store(buffer, mimeType); // throws (httpStatus set) before any disk write on invalid input

  var mediaType = ALLOWED_MEDIA_TYPE.indexOf(body.media_type) !== -1 ? body.media_type : 'original_image';
  var accessScope = ALLOWED_ACCESS_SCOPE.indexOf(body.access_scope) !== -1 ? body.access_scope : 'mythos_private';

  try {
    return await withAudit(
      { event_type: 'observation_media.create', target_type: 'idauto_observation_media', change_summary: 'Manual admin media attachment for observation ' + observationId },
      identity,
      async function (client) {
        var result = await client.query(
          'INSERT INTO idauto_observation_media (observation_id, media_type, object_key, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status) ' +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active') RETURNING id, observation_id, media_type, object_key, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status",
          [observationId, mediaType, stored.object_key, mimeType, stored.file_size_bytes, stored.image_hash, accessScope, body.blurred === true]
        );
        var row = result.rows[0];
        return { record: row, auditTargetRef: row.id };
      }
    );
  } catch (err) {
    var stillReferenced = await db.query(
      'SELECT 1 FROM idauto_observation_media WHERE object_key = $1 LIMIT 1',
      [stored.object_key]
    );
    if (stillReferenced.rows.length === 0) {
      storage.removeUnconditionally(stored.image_hash);
    }
    throw err;
  }
}

module.exports = {
  createVehicle: createVehicle,
  createPlate: createPlate,
  createObservation: createObservation,
  reviewObservation: reviewObservation,
  reviewFact: reviewFact,
  createFact: createFact,
  createObservationMedia: createObservationMedia,
  withAudit: withAudit,
  mapDbError: mapDbError
};
