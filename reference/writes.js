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
/* IDA-V10, 2026-08-28 — ONE lookup for "the vehicle this reference names",
 * used by every write that takes a vehicle reference. Both identifiers are
 * permanent and neither is ever reused, so matching both is unambiguous.
 * The read side does the same (api.js getVehicle/getFactsForVehicle), and
 * findVehicleByAnyRef() below is the richer variant merge/split/resolve
 * need. Written once so a future write path cannot forget one of them. */
var VEHICLE_ID_BY_ANY_REF =
  'SELECT id FROM idauto_vehicles WHERE internal_ref = $1 OR ivid = $1';

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
/* IDA-V10, 2026-08-28 — THE ORGANISATION IS RECORDED, not just the actor.
 *
 * idauto_audit_log has carried an org_id column since before IDA-V9, and
 * docs/ID_AUTO_INTEGRATION.md §12 promises callers that "audit rows carry
 * … the organisation". No code path ever wrote it: every row in production
 * had org_id NULL, and an atelier's write was recorded actor_type='admin',
 * indistinguishable from an action by the operator. The audit of
 * 2026-08-28 found this. `principal` is optional and absent means exactly
 * what it meant before — an admin actor with no organisation — so every
 * existing caller keeps its behaviour unchanged.
 *
 * actor_type 'professional_user' is not new vocabulary: schema.sql's
 * chk_audit_actor has always allowed it. It was simply never used. */
async function withAudit(auditMeta, identity, work) {
  if (!identity) {
    throw Object.assign(new Error('no authenticated identity — refusing to write without an attributable audit actor'), { httpStatus: 401 });
  }
  var principal = auditMeta.principal;
  var isOrg = !!(principal && principal.kind === 'organisation' && principal.org_id);
  var actorType = isOrg ? 'professional_user' : 'admin';
  var actorOrgId = isOrg ? principal.org_id : null;
  var client = await db.getClientForTransaction();
  try {
    await client.query('BEGIN');
    var outcome = await work(client);
    if (!outcome.skipAudit) {
      await client.query(
        'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, org_id, target_type, target_ref, change_summary, new_value_json) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          auditMeta.event_type,
          actorType,
          identity,
          actorOrgId,
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
async function createVehicle(body, identity, principal) {
  var internalRef = genInternalRef();
  return withAudit(
    { principal: principal, event_type: 'vehicle.create', target_type: 'idauto_vehicles', change_summary: 'Manual admin vehicle entry' },
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
async function createPlate(body, identity, principal) {
  return withAudit(
    { principal: principal, event_type: 'plate.create', target_type: 'idauto_plates', change_summary: 'Manual admin plate entry' },
    identity,
    async function (client) {
      var vehicleId = null;
      if (body.vehicle_internal_ref) {
      // IDA-V10 — an IVID is accepted here too. See getVehicle() in api.js.
      var v = await client.query(VEHICLE_ID_BY_ANY_REF, [body.vehicle_internal_ref]);
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
/* IDA-V9 — `principal` carries the authenticated organisation and its scopes.
 * When it is an organisation, the observation is stored WITH its organisation
 * and its full provenance; the database's chk_obs_org_provenance makes an
 * organisation row without complete provenance impossible to write, so the
 * validation below is a clear 400 rather than the last line of defence.
 * An admin principal writes exactly what it wrote before: org_id NULL. */
async function createObservation(body, identity, principal) {
  return withAudit(
    { principal: principal, event_type: 'observation.create', target_type: 'idauto_observations', change_summary: 'Manual admin observation entry' },
    identity,
    async function (client) {
        // Provenance is decided here, from the AUTHENTICATED principal — never
      // from the request body. A caller cannot claim to be another
      // organisation, because org_id is not read from what it sent.
      var prov = { org_id: null, author_ref: null, source: null, source_type: null, source_reference: null };
      if (principal && principal.kind === 'organisation') {
        var missing = ['author', 'source', 'source_type', 'source_reference'].filter(function (k) {
          return !body[k] || typeof body[k] !== 'string' || !String(body[k]).trim();
        });
        if (missing.length) {
          throw Object.assign(
            new Error('organisation-originated data requires complete provenance; missing: ' + missing.join(', ')),
            { httpStatus: 400 }
          );
        }
        prov = {
          org_id: principal.org_id,
          author_ref: String(body.author).trim().slice(0, 64),
          source: String(body.source).trim().slice(0, 60),
          source_type: String(body.source_type).trim().slice(0, 30),
          source_reference: String(body.source_reference).trim().slice(0, 200)
        };
      }
      // IDA-V10 — an IVID is accepted here too. See getVehicle() in api.js.
      var v = await client.query(VEHICLE_ID_BY_ANY_REF, [body.vehicle_internal_ref]);
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
        'INSERT INTO idauto_observations (vehicle_id, plate_id, capture_source_id, capture_method, status, ' +
        'org_id, author_ref, source, source_type, source_reference) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ' +
        'RETURNING id, vehicle_id, plate_id, capture_method, status, org_id, author_ref, source, source_type, source_reference, capture_time',
        [v.rows[0].id, plateId, source.rows[0].id, 'manual_admin', status,
         prov.org_id, prov.author_ref, prov.source, prov.source_type, prov.source_reference]
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
async function reviewObservation(observationId, decision, identity, principal) {
  var targetStatus = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : null;
  if (!targetStatus) {
    throw Object.assign(new Error('decision must be accept or reject'), { httpStatus: 400 });
  }
  return withAudit(
    { principal: principal, event_type: 'observation.review.' + decision, target_type: 'idauto_observations', change_summary: 'Admin review decision: ' + targetStatus },
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
// IDA-V4, 2026-08-27 — VERIFICATION, PUBLICATION, SOURCE AND CONFIDENCE ARE
// INDEPENDENT. Owner decision.
//
// Before this change, `accept` wrote verification_status='verified' AND
// access_scope='public' in one statement, so "checked" and "published" were
// the same act. A VIN read off an official certificate could not be recorded
// as verified without also being made public — the model had no way to say
// "certain, and private".
//
// Now: accept sets the status; access_scope and confidence_score are
// PRESERVED unless the caller names new ones; an evidence row is added when
// the caller names an evidence_type, so the provenance of the VERIFICATION
// act is recorded, not only the fact's original source.
//
// Publication therefore becomes a deliberate, audited argument rather than a
// side effect. The review queue still publishes community facts — it now
// passes access_scope:'public' explicitly, which is the compatibility the old
// behaviour actually needed. Nothing else relied on the coupling.
//
// opts: { access_scope, confidence_score, evidence_type, weight }, all
// optional and all validated before use — an unknown value is a 400, never a
// silent write.
async function reviewFact(factId, decision, identity, opts, principal) {
  var targetStatus = decision === 'accept' ? 'verified' : decision === 'reject' ? 'rejected' : null;
  if (!targetStatus) {
    throw Object.assign(new Error('decision must be accept or reject'), { httpStatus: 400 });
  }
  return withAudit(
    { principal: principal, event_type: 'fact.review.' + decision, target_type: 'idauto_vehicle_facts', change_summary: 'Admin review decision: ' + targetStatus },
    identity,
    async function (client) {
      var current = await client.query(
        'SELECT id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope FROM idauto_vehicle_facts WHERE id = $1 FOR UPDATE',
        [factId]
      );
      if (current.rows.length === 0) {
        throw Object.assign(new Error('fact not found'), { httpStatus: 404 });
      }
      var options = opts || {};
      var row = current.rows[0];

      if (options.access_scope != null && ALLOWED_ACCESS_SCOPE.indexOf(options.access_scope) === -1) {
        throw Object.assign(new Error('access_scope must be one of ' + ALLOWED_ACCESS_SCOPE.join(', ')), { httpStatus: 400 });
      }
      if (options.confidence_score != null &&
          (typeof options.confidence_score !== 'number' || !isFinite(options.confidence_score) ||
           options.confidence_score < 0 || options.confidence_score > 1)) {
        throw Object.assign(new Error('confidence_score must be a number between 0.0 and 1.0'), { httpStatus: 400 });
      }
      if (options.evidence_type != null && ALLOWED_EVIDENCE_TYPE.indexOf(options.evidence_type) === -1) {
        throw Object.assign(new Error('evidence_type must be one of ' + ALLOWED_EVIDENCE_TYPE.join(', ')), { httpStatus: 400 });
      }

      var nextScope = options.access_scope != null ? options.access_scope : row.access_scope;
      var nextConfidence = options.confidence_score != null ? options.confidence_score : row.confidence_score;

      // Already at the target status. Before IDA-V4 that was always a no-op,
      // because status was the only thing a decision could change. A decision
      // now also carries scope, confidence and evidence, so one that changes
      // any of those is real work and must be audited; only a decision that
      // changes nothing at all stays a no-op.
      if (row.verification_status === targetStatus) {
        var changesNothing = nextScope === row.access_scope &&
          Number(nextConfidence) === Number(row.confidence_score) &&
          options.evidence_type == null;
        if (changesNothing) {
          return { record: row, auditTargetRef: row.id, skipAudit: true };
        }
      } else if (['pending_review', 'unverified'].indexOf(row.verification_status) === -1) {
        throw Object.assign(new Error('fact is no longer pending review'), { httpStatus: 409 });
      }

      var updated = await client.query(
        'UPDATE idauto_vehicle_facts SET verification_status = $2, access_scope = $3, confidence_score = $4 WHERE id = $1 RETURNING id, observation_id, fact_key, fact_value, confidence_score, verification_status, access_scope',
        [factId, targetStatus, nextScope, nextConfidence]
      );

      // Provenance of the VERIFICATION act, written in the same transaction as
      // the status change and covered by the same audit row.
      if (options.evidence_type != null) {
        await client.query(
          'INSERT INTO idauto_fact_evidence (fact_id, evidence_type, weight) VALUES ($1,$2,$3)',
          [factId, options.evidence_type, typeof options.weight === 'number' ? options.weight : 0.1]
        );
      }
      return { record: updated.rows[0], auditTargetRef: updated.rows[0].id };
    }
  );
}

var ALLOWED_ACCESS_SCOPE = ['public', 'professional', 'mythos_private'];
// IDA-V4: 'document_scan_official' — read off an OFFICIAL registration
// document, legibly and without inference. Deliberately distinct from
// 'document_scan' (any scanned document): that distinction is what justifies
// a confidence of 1.0, so collapsing the two would erase the justification.
// Mirrors database/migrations/ida-v4-verification-scope-separation.sql.
var ALLOWED_EVIDENCE_TYPE = ['user_confirmation', 'cross_source_match', 'vin_decode', 'document_scan', 'document_scan_official', 'professional_assertion', 'automated_check', 'admin_validation'];

// POST /api/vehicles/:internal_ref/facts
// Optionally creates one idauto_fact_evidence row in the same transaction
// if evidence_type is supplied — one audit record covers both.
async function createFact(vehicleInternalRef, body, identity, principal) {
  return withAudit(
    { principal: principal, event_type: 'fact.create', target_type: 'idauto_vehicle_facts', change_summary: 'Manual admin fact entry for ' + vehicleInternalRef },
    identity,
    async function (client) {
      // IDA-V10 — an IVID is accepted here too. See getVehicle() in api.js.
      var v = await client.query(VEHICLE_ID_BY_ANY_REF, [vehicleInternalRef]);
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
async function createObservationMedia(observationId, buffer, mimeType, body, identity, principal) {
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
      { principal: principal, event_type: 'observation_media.create', target_type: 'idauto_observation_media', change_summary: 'Manual admin media attachment for observation ' + observationId },
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

/* IDA-V3 follow-up, 2026-08-27 — the anonymous audit-observation path.
 *
 * This module owns every SQL mutation in the codebase; api.js contains none,
 * and tests/ida-2c-readonly-api-test.js enforces that by scanning api.js for
 * write verbs. The IDA-V3 public-plate-miss event was written with an inline
 * INSERT in api.js and broke that guard. The SQL belongs here.
 *
 * It is deliberately NOT routed through withAudit(). withAudit() refuses to
 * write without an attributable identity — "there is no code path that writes
 * data without an attributable audit actor" — and that invariant is about
 * DATA. This writes no data: it records that an anonymous request happened,
 * and the audit table models an anonymous actor as a first-class case
 * (actor_type is a column, actor_ref is nullable). Routing it through
 * withAudit() would either force a fake identity or force the invariant to
 * bend; keeping it separate keeps both honest.
 *
 * It touches idauto_audit_log and nothing else — no vehicle, plate, fact or
 * observation row can be created through here.
 *
 * Callers treat failure as non-fatal: this runs on unauthenticated read
 * paths, where refusing to answer because a log row could not be written
 * would turn the audit trail into an availability weapon. It therefore
 * throws, and the caller decides — it does not swallow errors itself. */
/* IDA-V10, 2026-08-28 — THE MANDATORY VIN-SEARCH AUDIT.
 *
 * Owner ruling, 2026-08-28: VIN stays private; VIN search requires a
 * dedicated scope; "recherche VIN toujours auditée; aucune recherche VIN
 * anonyme". This function is that audit record.
 *
 * IT FAILS CLOSED, and that is the one place this codebase deliberately
 * differs from recordAnonymousAuditEvent() above. That one is best-effort
 * because it sits on an ANONYMOUS read path, where refusing to answer over a
 * log row would let anyone disable the public surface by making audit writes
 * fail. This one sits behind an authenticated credential that had to be
 * granted `vin:search` on purpose, and the ruling is that the search is
 * ALWAYS audited — so "audited" cannot degrade to "audited when convenient".
 * If the audit row cannot be written, the caller must not learn the answer.
 * The caller therefore lets this throw BEFORE it discloses anything.
 *
 * WHAT IS RECORDED, and what deliberately is not: the searching actor, its
 * organisation, whether the search matched, and — when it did — the IVID that
 * matched, which is public data. The VIN ITSELF IS NEVER STORED IN THE AUDIT
 * ROW. Writing the searched VIN into idauto_audit_log would copy the private
 * value into a table with none of idauto_vehicle_facts' access_scope
 * machinery, and would hand anyone with audit-log read access exactly the
 * value the scope exists to protect. A salted, truncated digest identifies
 * repeat searches for the same VIN without being reversible to it.
 *
 * The audit table's own [NO PII] contract is what this is respecting, not an
 * extra precaution on top of it. */
function vinSearchDigest(vin) {
  // Salted with the deployment's session secret so a digest cannot be
  // matched against a precomputed table of candidate VINs. Truncated to 16
  // hex: enough to correlate repeat searches, far too little to invert.
  var salt = process.env.IDAUTO_SESSION_SECRET || '';
  return crypto.createHmac('sha256', salt).update(String(vin).toUpperCase()).digest('hex').slice(0, 16);
}

async function recordVinSearchAudit(principal, identity, vin, matchedIvid) {
  var isOrg = !!(principal && principal.kind === 'organisation' && principal.org_id);
  await db.query(
    'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, org_id, target_type, target_ref, change_summary) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      'vehicle.search.vin',
      isOrg ? 'professional_user' : 'admin',
      identity,
      isOrg ? principal.org_id : null,
      'idauto_vehicles',
      matchedIvid || null,
      'VIN search (' + (matchedIvid ? 'match' : 'no match') + ') vin_digest=' + vinSearchDigest(vin)
    ]
  );
}

async function recordAnonymousAuditEvent(entry) {
  await db.query(
    'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref, change_summary, ip_hash) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      entry.event_type,
      entry.actor_type,
      entry.actor_ref || null,
      entry.target_type,
      entry.target_ref,
      entry.change_summary,
      entry.ip_hash
    ]
  );
}


/* =========================================================================
 * IDA-V8 — MERGE / SPLIT / ALIAS. Owner requirement, 2026-08-27.
 *
 * protocol/schemas/vehicle.schema.json already declared the contract:
 * "Set when this record was merged into another. Both records are retained;
 * a merge is itself an Event and MUST be reversible." These functions
 * implement exactly that.
 *
 * NOTHING IS EVER DESTROYED. A merge writes ONE pointer on the merged record.
 * Its ivid, its internal_ref, its observations, facts, evidence and audit
 * rows are all left exactly where they were — no row is rewritten, no
 * provenance is moved, no identifier is freed. That is what makes an external
 * reference minted before the merge keep resolving afterwards, and what makes
 * a split a matter of clearing one pointer rather than reconstructing data.
 * ========================================================================= */

// Follows the merge chain to the canonical record. Bounded, because a cycle
// must fail loudly rather than hang a request: the self-merge CHECK blocks the
// one-step cycle, and this bound blocks any longer one that a future bug could
// create. Returns the canonical row plus how far it had to walk.
var MAX_MERGE_DEPTH = 16;
async function resolveCanonical(client, startRow) {
  var row = startRow;
  var hops = 0;
  var seen = {};
  while (row.merged_into_id) {
    if (seen[row.id]) {
      throw Object.assign(new Error('vehicle identity graph contains a cycle'), { httpStatus: 409 });
    }
    seen[row.id] = true;
    if (++hops > MAX_MERGE_DEPTH) {
      throw Object.assign(new Error('vehicle merge chain is too deep to resolve'), { httpStatus: 409 });
    }
    var next = await client.query(
      'SELECT id, ivid, internal_ref, fiche_status, merged_into_id, pre_merge_status FROM idauto_vehicles WHERE id = $1',
      [row.merged_into_id]
    );
    if (next.rows.length === 0) {
      throw Object.assign(new Error('merge target no longer exists'), { httpStatus: 409 });
    }
    row = next.rows[0];
  }
  return { canonical: row, hops: hops };
}

// Looks a vehicle up by EITHER identifier the outside world may hold: its
// IVID or its internal_ref. Fixpert holds both kinds, and neither is ever
// reused, so a reference always finds its record even after a merge.
async function findVehicleByAnyRef(client, ref) {
  var r = await client.query(
    'SELECT id, ivid, internal_ref, fiche_status, merged_into_id, pre_merge_status FROM idauto_vehicles WHERE ivid = $1 OR internal_ref = $1',
    [ref]
  );
  return r.rows.length ? r.rows[0] : null;
}

/* POST /api/vehicles/:ref/merge — merge :ref INTO the canonical vehicle.
 *
 * Refuses, rather than guesses, when: either vehicle is unknown; they are the
 * same record; the source is already merged (split it first — a re-merge would
 * silently discard where it pointed before); or the target resolves back to
 * the source, which would create a cycle. */
async function mergeVehicle(sourceRef, canonicalRef, identity, principal) {
  return withAudit(
    { principal: principal, event_type: 'vehicle.merge', target_type: 'idauto_vehicles',
      change_summary: 'Merged ' + sourceRef + ' into ' + canonicalRef },
    identity,
    async function (client) {
      var source = await findVehicleByAnyRef(client, sourceRef);
      if (!source) throw Object.assign(new Error('vehicle not found'), { httpStatus: 404 });
      var target = await findVehicleByAnyRef(client, canonicalRef);
      if (!target) throw Object.assign(new Error('canonical vehicle not found'), { httpStatus: 404 });
      if (String(source.id) === String(target.id)) {
        throw Object.assign(new Error('a vehicle cannot be merged into itself'), { httpStatus: 400 });
      }
      if (source.merged_into_id) {
        throw Object.assign(new Error('vehicle is already merged — split it before merging again'), { httpStatus: 409 });
      }
      // The target may itself be merged; resolve to where it really points,
      // so a chain stays one hop deep and cannot grow without bound.
      var resolved = await resolveCanonical(client, target);
      if (String(resolved.canonical.id) === String(source.id)) {
        throw Object.assign(new Error('merge would create a cycle'), { httpStatus: 409 });
      }

      var updated = await client.query(
        'UPDATE idauto_vehicles SET merged_into_id = $2, pre_merge_status = fiche_status, ' +
        "fiche_status = 'merged', updated_at = NOW() WHERE id = $1 " +
        'RETURNING id, ivid, internal_ref, fiche_status, merged_into_id, pre_merge_status',
        [source.id, resolved.canonical.id]
      );
      var row = updated.rows[0];
      return {
        record: {
          merged: { ivid: row.ivid, internal_ref: row.internal_ref, status: row.fiche_status, pre_merge_status: row.pre_merge_status },
          canonical: { ivid: resolved.canonical.ivid, internal_ref: resolved.canonical.internal_ref }
        },
        auditTargetRef: row.id
      };
    }
  );
}

/* POST /api/vehicles/:ref/split — reverse a merge.
 *
 * Clears the pointer and restores the status the record held before. Nothing
 * has to be moved back, because nothing was moved: this is why the merge was
 * built as a pointer and not as a data migration. */
async function splitVehicle(sourceRef, identity, principal) {
  return withAudit(
    { principal: principal, event_type: 'vehicle.split', target_type: 'idauto_vehicles',
      change_summary: 'Split ' + sourceRef + ' back out of its merge' },
    identity,
    async function (client) {
      var source = await findVehicleByAnyRef(client, sourceRef);
      if (!source) throw Object.assign(new Error('vehicle not found'), { httpStatus: 404 });
      if (!source.merged_into_id) {
        throw Object.assign(new Error('vehicle is not merged'), { httpStatus: 409 });
      }
      var previous = await client.query('SELECT ivid FROM idauto_vehicles WHERE id = $1', [source.merged_into_id]);
      var updated = await client.query(
        'UPDATE idauto_vehicles SET merged_into_id = NULL, ' +
        "fiche_status = COALESCE(pre_merge_status, 'initial'), pre_merge_status = NULL, updated_at = NOW() " +
        'WHERE id = $1 RETURNING id, ivid, internal_ref, fiche_status, merged_into_id',
        [source.id]
      );
      var row = updated.rows[0];
      return {
        record: {
          restored: { ivid: row.ivid, internal_ref: row.internal_ref, status: row.fiche_status },
          was_merged_into: previous.rows.length ? previous.rows[0].ivid : null
        },
        auditTargetRef: row.id
      };
    }
  );
}

/* Read-only resolution. No audit row: reading is not a mutation, and an
 * audited read on a route Fixpert will call constantly would drown the log
 * that matters. */
async function resolveVehicleRef(ref) {
  var client = await db.getClientForTransaction();
  try {
    var found = await findVehicleByAnyRef(client, ref);
    if (!found) return null;
    var resolved = await resolveCanonical(client, found);
    return {
      requested_ref: ref,
      is_alias: resolved.hops > 0,
      requested: { ivid: found.ivid, internal_ref: found.internal_ref, status: found.fiche_status },
      canonical: { ivid: resolved.canonical.ivid, internal_ref: resolved.canonical.internal_ref, status: resolved.canonical.fiche_status },
      merge_hops: resolved.hops
    };
  } finally {
    client.release();
  }
}

module.exports = {
  createVehicle: createVehicle,
  mergeVehicle: mergeVehicle,
  splitVehicle: splitVehicle,
  resolveVehicleRef: resolveVehicleRef,
  recordAnonymousAuditEvent: recordAnonymousAuditEvent,
  recordVinSearchAudit: recordVinSearchAudit,
  createPlate: createPlate,
  createObservation: createObservation,
  reviewObservation: reviewObservation,
  reviewFact: reviewFact,
  createFact: createFact,
  createObservationMedia: createObservationMedia,
  withAudit: withAudit,
  mapDbError: mapDbError
};
