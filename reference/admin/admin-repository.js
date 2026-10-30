'use strict';
// =====================================================
// IDauto — IDA-ADMIN-1 — operator console read model
// reference/admin/admin-repository.js
//
// The READ side of the operator console: the registry (a paged list of
// vehicle identities), the vehicle dossier (one identity and everything
// recorded against it), and the overview counts. Every function here only
// reads; tests/ida-admin-registry-test.js fails if a SQL write verb appears
// anywhere in this file, comments included. Mutations stay where they already
// are — writes.js, vehicle-repository.js, workshop-repository.js — behind
// withAudit().
//
// WHO MAY CALL THIS. Admin principals only. The routes in
// reference/admin-routes.js are absent from every scope table, so the central
// gate in api.js answers 403 to any organisation credential before a handler
// runs, and each handler checks the admin scope again. The registry walks the
// whole register, which the organisation-facing search deliberately refuses to
// do (IDA-V10: capped, never paged); that refusal still holds for every
// organisation credential, because none of them can reach these routes.
//
// WHAT IS NEVER SELECTED, even for an admin:
//   - the VIN (a scoped fact). The dossier reports vin_present only; the
//     value is disclosed by the existing GET /api/vehicles/:ref/fiche, which
//     writes the vehicle.vin.read audit row before it answers.
//   - any row whose access_scope is 'mythos_private' (facts, media): no read
//     of restricted data is audit-logged yet (PRIVACY_ARCHITECTURE.md §3),
//     the same rule every other GET in this implementation follows. The
//     dossier says how many restricted facts exist, never what they say.
//   - observation capture_time / created_at, plate_candidate, ocr_confidence,
//     ip_hash, camera, contributor, session: movement and capture identity.
//   - the workshop customer reference, only whether one exists.
//   - document storage keys and OCR fields.
// =====================================================

var db = require('../db.js');
var plateNormalizer = require('../vehicle/plate-normalizer.js');
var plateValidator = require('../plate-validator.js');

var PAGE_SIZE_DEFAULT = 25;
// createFact() stores fact_key exactly as sent (and defaults the scope to
// public), so a VIN keyed 'VIN', 'Vin' or ' vin ' must be excluded as surely
// as one keyed 'vin'. Every fact read below uses this predicate.
var NOT_VIN = "LOWER(TRIM(f.fact_key)) <> 'vin'";
var PAGE_SIZE_MAX = 100;
// An admin can page the whole register, but not by an unbounded OFFSET: past
// this many rows the filters are the way in, not the page number.
var OFFSET_MAX = 10000;

var SORTS = {
  updated: 'v.updated_at',
  created: 'v.created_at',
  make: 'v.make',
  model: 'v.model',
  year: 'v.year',
  ivid: 'v.ivid'
};
// schema.sql chk_vehicle_status — the only values a fiche can hold.
var FICHE_STATUSES = ['initial', 'pending_review', 'verified', 'conflict', 'merged', 'archived'];

function badRequest(message, details) {
  return Object.assign(new Error(message), { httpStatus: 400, details: details });
}

// A value longer than `max` is REFUSED, not cut: cutting turned year=20245
// into 2024 and page_size=1000 into 100 before validation ever saw them.
// A NUL byte is refused too — PostgreSQL rejects it in text (22021), which
// would otherwise surface as a 500.
function oneParam(q, name, max) {
  var v = q[name];
  if (Array.isArray(v)) v = v[0];                   // ?make=a&make=b — the first, never concatenated
  if (typeof v !== 'string') return null;
  v = v.trim();
  if (!v.length) return null;
  if (v.length > (max || 64)) throw badRequest(name + ' is too long', { max: max || 64 });
  if (v.indexOf('\u0000') !== -1) throw badRequest(name + ' contains a NUL character');
  return v;
}

function likePrefix(text) {
  return text.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%';
}

// Normalises the registry query string into a bounded, validated filter.
// Exported for the tests: every branch of the validation is pinned there.
function parseRegistryQuery(q) {
  q = q || {};
  var out = {
    q: oneParam(q, 'q'),
    make: oneParam(q, 'make'),
    model: oneParam(q, 'model'),
    year: oneParam(q, 'year', 8),
    fiche_status: oneParam(q, 'fiche_status', 20),
    verified: oneParam(q, 'verified', 5),
    include_merged: oneParam(q, 'include_merged', 5) === '1',
    sort: oneParam(q, 'sort', 20) || 'updated',
    dir: (oneParam(q, 'dir', 8) || 'desc').toLowerCase(),
    page: oneParam(q, 'page', 8) || '1',
    page_size: oneParam(q, 'page_size', 8) || String(PAGE_SIZE_DEFAULT)
  };
  // Whole positive integers only: parseInt('1.5') is 1 and parseInt('2abc') is 2.
  if (!/^\d+$/.test(out.page)) throw badRequest('page must be a positive integer');
  if (!/^\d+$/.test(out.page_size)) throw badRequest('page_size must be between 1 and ' + PAGE_SIZE_MAX);
  out.page = parseInt(out.page, 10);
  out.page_size = parseInt(out.page_size, 10);
  if (out.year !== null && !/^\d{4}$/.test(out.year)) throw badRequest('year must be a four-digit year');
  if (out.fiche_status !== null && FICHE_STATUSES.indexOf(out.fiche_status) === -1) throw badRequest('unknown fiche_status', { allowed: FICHE_STATUSES });
  if (out.verified !== null && out.verified !== 'true' && out.verified !== 'false') throw badRequest('verified must be true or false');
  if (!Object.prototype.hasOwnProperty.call(SORTS, out.sort)) throw badRequest('unknown sort', { allowed: Object.keys(SORTS) });
  if (out.dir !== 'asc' && out.dir !== 'desc') throw badRequest('dir must be asc or desc');
  if (!isFinite(out.page) || out.page < 1) throw badRequest('page must be a positive integer');
  if (!isFinite(out.page_size) || out.page_size < 1 || out.page_size > PAGE_SIZE_MAX) throw badRequest('page_size must be between 1 and ' + PAGE_SIZE_MAX);
  if ((out.page - 1) * out.page_size > OFFSET_MAX) throw badRequest('page is beyond the browsable range — narrow the filters', { offset_max: OFFSET_MAX });
  return out;
}

// The free-text criterion matches identifiers exactly and descriptions by
// prefix: IVID, internal_ref, any plate the vehicle has EVER carried (current
// or historical, any spelling the normaliser accepts), or make / model. It
// never matches a VIN — VIN lookup stays on the audited search route.
function freeTextClause(text, params) {
  var parsed = plateNormalizer.parsePlate(text);
  var plate = parsed.ok ? parsed.canonical : (plateValidator.normalizePlate(text) || text.toUpperCase());
  params.push(text);
  var exact = params.length;
  params.push(plate);
  var plateExact = params.length;
  params.push(plate.replace(/ /g, ''));
  var plateNospace = params.length;
  params.push(likePrefix(text));
  var prefix = params.length;
  return '(v.ivid = $' + exact + ' OR v.internal_ref = $' + exact +
    ' OR EXISTS (SELECT 1 FROM idauto_plates p WHERE p.vehicle_id = v.id AND (p.plate_number = $' + plateExact +
    " OR REPLACE(p.plate_number, ' ', '') = $" + plateNospace + '))' +
    ' OR v.make ILIKE $' + prefix + ' OR v.model ILIKE $' + prefix + ')';
}

async function listVehicles(filter) {
  var where = [];
  var params = [];
  if (!filter.include_merged) where.push('v.merged_into_id IS NULL');
  if (filter.q) where.push(freeTextClause(filter.q, params));
  if (filter.make) { params.push(filter.make); where.push('UPPER(v.make) = UPPER($' + params.length + ')'); }
  if (filter.model) { params.push(filter.model); where.push('UPPER(v.model) = UPPER($' + params.length + ')'); }
  if (filter.year) { params.push(parseInt(filter.year, 10)); where.push('v.year = $' + params.length); }
  if (filter.fiche_status) { params.push(filter.fiche_status); where.push('v.fiche_status = $' + params.length); }
  if (filter.verified !== null) { params.push(filter.verified === 'true'); where.push('COALESCE(v.identification_verified, FALSE) = $' + params.length); }
  var whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  var total = (await db.query('SELECT count(*)::int AS n FROM idauto_vehicles v' + whereSql, params)).rows[0].n;

  var orderCol = SORTS[filter.sort];
  var dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
  var pageParams = params.slice();
  pageParams.push(filter.page_size);
  var limitIdx = pageParams.length;
  pageParams.push((filter.page - 1) * filter.page_size);
  var offsetIdx = pageParams.length;
  var rows = (await db.query(
    'SELECT v.ivid, v.internal_ref, v.make, v.model, v.variant, v.year, v.fuel_type, v.colour, v.fiche_status, ' +
    'COALESCE(v.identification_verified, FALSE) AS verified, v.identification_source, v.updated_at, v.created_at, ' +
    'm.ivid AS merged_into, ' +
    "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS plate, " +
    '(SELECT count(*)::int FROM idauto_plates p WHERE p.vehicle_id = v.id) AS plate_count, ' +
    '(SELECT count(*)::int FROM idauto_workshop_visits w WHERE w.vehicle_id = v.id) AS visit_count, ' +
    "(SELECT count(*)::int FROM idauto_vehicle_facts f WHERE f.vehicle_id = v.id AND f.verification_status = 'conflict' AND f.access_scope <> 'mythos_private' AND " + NOT_VIN + ") AS conflict_count, " +
    // Keys holding more than one distinct ACTIVE value: createFact() adds a
    // value without retiring the previous one, so this is where real
    // disagreement shows up (no code path sets verification_status='conflict').
    "(SELECT count(*)::int FROM (SELECT f.fact_key FROM idauto_vehicle_facts f WHERE f.vehicle_id = v.id AND f.is_active " +
    "AND f.access_scope <> 'mythos_private' AND " + NOT_VIN + " GROUP BY f.fact_key " +
    'HAVING count(DISTINCT UPPER(TRIM(f.fact_value))) > 1) d) AS disagreement_count ' +
    'FROM idauto_vehicles v LEFT JOIN idauto_vehicles m ON m.id = v.merged_into_id' + whereSql +
    ' ORDER BY ' + orderCol + ' ' + dir + ' NULLS LAST, v.id ' + dir +
    ' LIMIT $' + limitIdx + ' OFFSET $' + offsetIdx,
    pageParams
  )).rows;

  return {
    page: filter.page,
    page_size: filter.page_size,
    total: total,
    pages: Math.max(1, Math.ceil(total / filter.page_size)),
    sort: filter.sort,
    dir: filter.dir,
    results: rows.map(function (r) {
      var parsed = r.plate ? plateNormalizer.parsePlate(r.plate) : null;
      return {
        ivid: r.ivid, internal_ref: r.internal_ref,
        make: r.make, model: r.model, variant: r.variant, year: r.year, fuel_type: r.fuel_type, colour: r.colour,
        fiche_status: r.fiche_status, verified: r.verified, identification_source: r.identification_source,
        merged_into: r.merged_into || null,
        plate: r.plate, plate_display: parsed && parsed.ok ? parsed.display : r.plate,
        plate_count: r.plate_count, visit_count: r.visit_count, conflict_count: r.conflict_count, disagreement_count: r.disagreement_count,
        created_at: r.created_at, updated_at: r.updated_at
      };
    })
  };
}

// Every record merged (directly or transitively) into `vehicleId`. Bounded
// depth: the schema forbids self-merge and mergeVehicle() refuses a cycle,
// but a read must terminate against unexpected data regardless.
async function aliasesOf(vehicleId) {
  var res = await db.query(
    'WITH RECURSIVE a(id, depth) AS (SELECT id, 1 FROM idauto_vehicles WHERE merged_into_id = $1 ' +
    'UNION ALL SELECT v.id, a.depth + 1 FROM idauto_vehicles v JOIN a ON v.merged_into_id = a.id WHERE a.depth < 16) ' +
    'SELECT v.id, v.ivid, v.internal_ref, v.fiche_status, v.created_at, v.updated_at, t.ivid AS merged_into ' +
    'FROM a JOIN idauto_vehicles v ON v.id = a.id LEFT JOIN idauto_vehicles t ON t.id = v.merged_into_id ORDER BY v.id',
    [vehicleId]);
  return res.rows;
}

function sortByDateDesc(key) {
  return function (a, b) {
    var x = a[key] ? new Date(a[key]).getTime() : 0, y = b[key] ? new Date(b[key]).getTime() : 0;
    return y - x;
  };
}

// The dossier of one canonical vehicle. `canonicalRow` comes from
// vehicleRepository.findByRef(), which already followed any merge.
async function dossier(canonicalRow, vehicleRecord) {
  var id = canonicalRow.id;
  var aliases = await aliasesOf(id);
  var ids = [id].concat(aliases.map(function (a) { return a.id; }));
  var ividById = {};
  ividById[id] = canonicalRow.ivid;
  aliases.forEach(function (a) { ividById[a.id] = a.ivid; });

  var plates = (await db.query(
    'SELECT p.id, p.vehicle_id, p.plate_number, p.format_code, p.status, p.valid_from, p.valid_until, p.created_at, g.code AS governorate_code ' +
    'FROM idauto_plates p LEFT JOIN idauto_governorates g ON g.id = p.governorate_id WHERE p.vehicle_id = ANY($1::int[]) ORDER BY p.created_at DESC, p.id DESC',
    [ids])).rows.map(function (p) {
    var parsed = plateNormalizer.parsePlate(p.plate_number);
    return {
      id: p.id, plate: p.plate_number, plate_display: parsed.ok ? parsed.display : p.plate_number,
      format_code: p.format_code, governorate_code: p.governorate_code, status: p.status,
      valid_from: p.valid_from, valid_until: p.valid_until, recorded_at: p.created_at,
      recorded_on: ividById[p.vehicle_id], via_alias: p.vehicle_id !== id
    };
  });

  var facts = (await db.query(
    'SELECT f.id, f.vehicle_id, f.fact_key, f.fact_value, f.confidence_score, f.verification_status, f.access_scope, f.is_active, ' +
    'f.first_seen_at, f.last_seen_at, f.validated_at, f.observation_id, cs.code AS source_code, cs.source_type, cs.trust_level AS source_trust_level ' +
    'FROM idauto_vehicle_facts f LEFT JOIN idauto_capture_sources cs ON cs.id = f.source_id ' +
    "WHERE f.vehicle_id = ANY($1::int[]) AND f.access_scope <> 'mythos_private' AND " + NOT_VIN + " " +
    'ORDER BY f.fact_key, f.is_active DESC, f.last_seen_at DESC, f.id DESC',
    [ids])).rows;
  var restricted = (await db.query(
    "SELECT count(*)::int AS n FROM idauto_vehicle_facts f WHERE f.vehicle_id = ANY($1::int[]) AND (f.access_scope = 'mythos_private' OR NOT " + NOT_VIN + ")",
    [ids])).rows[0].n;
  var factIds = facts.map(function (f) { return f.id; });
  var evidence = factIds.length ? (await db.query(
    'SELECT fact_id, evidence_type, weight, created_at FROM idauto_fact_evidence WHERE fact_id = ANY($1::bigint[]) ORDER BY created_at',
    [factIds])).rows : [];
  var evidenceByFact = {};
  evidence.forEach(function (e) {
    (evidenceByFact[e.fact_id] = evidenceByFact[e.fact_id] || []).push({ evidence_type: e.evidence_type, weight: e.weight, recorded_at: e.created_at });
  });

  var observations = (await db.query(
    'SELECT o.id, o.vehicle_id, o.status, o.capture_method, o.source_type, o.org_id FROM idauto_observations o ' +
    'WHERE o.vehicle_id = ANY($1::int[]) ORDER BY o.id DESC LIMIT 200',
    [ids])).rows;

  var visits = (await db.query(
    'SELECT w.id, w.vehicle_id, w.org_id, org.name AS org_name, w.status, w.identification_method, w.plate_read_method, w.reason, ' +
    'w.opened_at, w.closed_at, (w.customer_ref_id IS NOT NULL) AS customer_ref_present ' +
    'FROM idauto_workshop_visits w LEFT JOIN idauto_organizations org ON org.id = w.org_id ' +
    'WHERE w.vehicle_id = ANY($1::int[]) ORDER BY w.opened_at DESC, w.id DESC LIMIT 200',
    [ids])).rows;
  var visitIds = visits.map(function (w) { return w.id; });
  var operations = visitIds.length ? (await db.query(
    'SELECT o.id, o.visit_id, o.operation_type, o.description, o.quantity, o.status, o.created_at, p.reference AS part_reference, p.brand AS part_brand, p.name AS part_name ' +
    'FROM idauto_workshop_operations o LEFT JOIN idauto_parts p ON p.id = o.part_id WHERE o.visit_id = ANY($1::bigint[]) ORDER BY o.created_at, o.id',
    [visitIds])).rows : [];
  var opsByVisit = {};
  operations.forEach(function (o) {
    (opsByVisit[o.visit_id] = opsByVisit[o.visit_id] || []).push({
      id: o.id, operation_type: o.operation_type, description: o.description, quantity: o.quantity, status: o.status,
      recorded_at: o.created_at, part: o.part_reference ? { reference: o.part_reference, brand: o.part_brand, name: o.part_name } : null
    });
  });

  var serviceEvents = (await db.query(
    'SELECT e.id, e.vehicle_id, e.org_id, org.name AS org_name, e.event_type, e.event_date, e.odometer_km, e.description, e.outcome, e.next_service_due, e.is_public, e.created_at ' +
    'FROM idauto_service_events e LEFT JOIN idauto_organizations org ON org.id = e.org_id WHERE e.vehicle_id = ANY($1::int[]) ORDER BY e.event_date DESC, e.id DESC LIMIT 200',
    [ids])).rows;

  var documents = (await db.query(
    'SELECT d.id, d.document_type, d.face, d.org_id, org.name AS org_name, d.mime_type, d.byte_size, d.width, d.height, d.ocr_status, d.created_at, d.updated_at ' +
    'FROM idauto_vehicle_documents d LEFT JOIN idauto_organizations org ON org.id = d.org_id WHERE d.vehicle_id = ANY($1::int[]) ORDER BY d.document_type, d.face',
    [ids])).rows;

  var history = (await db.query(
    'SELECT id, vehicle_id, changed_at, actor_type, actor_ref, org_id, action, method, source, confidence, previous, next ' +
    'FROM idauto_vehicle_identification_history WHERE vehicle_id = ANY($1::int[]) ORDER BY changed_at DESC, id DESC LIMIT 200',
    [ids])).rows;

  // Audit rows about this identity and the records hanging off it, matched on
  // the exact (target_type, target_ref) each write path records.
  var types = [], refs = [];
  function target(type, ref) { if (ref !== null && ref !== undefined) { types.push(type); refs.push(String(ref)); } }
  [canonicalRow].concat(aliases).forEach(function (v) {
    target('idauto_vehicles', v.internal_ref); target('idauto_vehicles', v.ivid); target('idauto_vehicles', v.id);
  });
  plates.forEach(function (p) { target('idauto_plates', p.plate); target('plate', p.plate); });
  facts.forEach(function (f) { target('idauto_vehicle_facts', f.id); });
  // NOT idauto_observations: their audit rows (ingestion.submit,
  // observation.review.*) carry the submission time and the submitter's
  // identity — a per-contributor sighting timeline. The observation list above
  // already omits both for the same reason.
  documents.forEach(function (d) { target('idauto_vehicle_documents', d.id); });
  visits.forEach(function (w) { target('idauto_workshop_visits', w.id); });
  operations.forEach(function (o) { target('idauto_workshop_operations', o.id); });
  var audit = (await db.query(
    'SELECT a.id, a.event_time, a.event_type, a.actor_type, a.actor_ref, a.org_id, a.target_type, a.target_ref, a.change_summary ' +
    'FROM idauto_audit_log a JOIN unnest($1::text[], $2::text[]) AS t(target_type, target_ref) ' +
    'ON a.target_type = t.target_type AND a.target_ref = t.target_ref ORDER BY a.event_time DESC, a.id DESC LIMIT 200',
    [types, refs])).rows;

  // Data quality: what is recorded as disputed, and what disagrees.
  var activeValues = {};
  facts.forEach(function (f) {
    if (!f.is_active) return;
    var v = String(f.fact_value).trim().toUpperCase();
    (activeValues[f.fact_key] = activeValues[f.fact_key] || {})[v] = true;
  });
  var disagreements = Object.keys(activeValues).filter(function (k) { return Object.keys(activeValues[k]).length > 1; })
    .map(function (k) { return { fact_key: k, distinct_active_values: Object.keys(activeValues[k]).length }; });
  // Counted in SQL, not from the observation list, which stops at 200 rows.
  var pendingObservations = (await db.query(
    "SELECT count(*)::int AS n FROM idauto_observations WHERE vehicle_id = ANY($1::int[]) AND status IN ('pending_review','pending_confirmation')",
    [ids])).rows[0].n;

  var timeline = [];
  visits.forEach(function (w) {
    timeline.push({ kind: 'workshop_visit', at: w.opened_at, visit_id: w.id, org_id: w.org_id, org_name: w.org_name, status: w.status });
  });
  serviceEvents.forEach(function (e) {
    timeline.push({ kind: 'service_event', at: e.event_date, event_id: e.id, org_id: e.org_id, org_name: e.org_name, event_type: e.event_type, odometer_km: e.odometer_km });
  });
  timeline.sort(sortByDateDesc('at'));

  return {
    vehicle: vehicleRecord,
    requested_alias: null,
    aliases: aliases.map(function (a) { return { ivid: a.ivid, internal_ref: a.internal_ref, fiche_status: a.fiche_status, merged_into: a.merged_into, created_at: a.created_at, updated_at: a.updated_at }; }),
    plates: plates,
    identification_history: history.map(function (h) {
      return { id: h.id, at: h.changed_at, action: h.action, method: h.method, source: h.source, confidence: h.confidence,
        actor_type: h.actor_type, actor_ref: h.actor_ref, org_id: h.org_id, previous: h.previous, next: h.next,
        recorded_on: ividById[h.vehicle_id] };
    }),
    facts: facts.map(function (f) {
      return { id: f.id, fact_key: f.fact_key, fact_value: f.fact_value, confidence_score: f.confidence_score,
        verification_status: f.verification_status, access_scope: f.access_scope, is_active: f.is_active,
        first_seen_at: f.first_seen_at, last_seen_at: f.last_seen_at, validated_at: f.validated_at,
        observation_id: f.observation_id,
        source: f.source_code ? { code: f.source_code, source_type: f.source_type, trust_level: f.source_trust_level } : null,
        evidence: evidenceByFact[f.id] || [], recorded_on: ividById[f.vehicle_id] };
    }),
    restricted_fact_count: restricted,
    observations: observations.map(function (o) {
      return { id: o.id, status: o.status, capture_method: o.capture_method, source_type: o.source_type, org_id: o.org_id, recorded_on: ividById[o.vehicle_id] };
    }),
    maintenance: {
      visits: visits.map(function (w) {
        return { id: w.id, org_id: w.org_id, org_name: w.org_name, status: w.status, identification_method: w.identification_method,
          plate_read_method: w.plate_read_method, reason: w.reason, opened_at: w.opened_at, closed_at: w.closed_at,
          customer_ref_present: w.customer_ref_present, odometer_km: null,
          operations: opsByVisit[w.id] || [], recorded_on: ividById[w.vehicle_id] };
      }),
      service_events: serviceEvents.map(function (e) {
        return { id: e.id, org_id: e.org_id, org_name: e.org_name, event_type: e.event_type, event_date: e.event_date,
          odometer_km: e.odometer_km, description: e.description, outcome: e.outcome, next_service_due: e.next_service_due,
          is_public: e.is_public, recorded_at: e.created_at, recorded_on: ividById[e.vehicle_id] };
      }),
      timeline: timeline,
      // Workshop visits carry no odometer column; only service events do.
      mileage_recorded_on_visits: false
    },
    documents: documents.map(function (d) {
      return { id: d.id, document_type: d.document_type, face: d.face, org_id: d.org_id, org_name: d.org_name,
        mime_type: d.mime_type, byte_size: d.byte_size, width: d.width, height: d.height, ocr_status: d.ocr_status,
        recorded_at: d.created_at, updated_at: d.updated_at };
    }),
    quality: {
      conflict_facts: facts.filter(function (f) { return f.verification_status === 'conflict'; }).length,
      pending_review_facts: facts.filter(function (f) { return f.verification_status === 'pending_review'; }).length,
      disagreements: disagreements,
      pending_observations: pendingObservations,
      alias_count: aliases.length
    },
    audit: audit.map(function (a) {
      return { id: a.id, at: a.event_time, event_type: a.event_type, actor_type: a.actor_type, actor_ref: a.actor_ref,
        org_id: a.org_id, target_type: a.target_type, target_ref: a.target_ref,
        summary: a.change_summary === null ? null : String(a.change_summary).replace(/vin_digest=[0-9a-f]+/gi, 'vin_digest=[masqué]') };
    }),
    completeness_note: 'Ce dossier montre ce qui a été enregistré dans IDauto. Une intervention absente ' +
      'n\'est pas la preuve qu\'elle n\'a pas eu lieu, et un enregistrement intact ne prouve pas que son contenu est exact.'
  };
}

async function countBy(sql) {
  var out = {};
  (await db.query(sql)).rows.forEach(function (r) { out[r.k] = r.n; });
  return out;
}

async function overview() {
  var vehicles = (await db.query(
    'SELECT count(*) FILTER (WHERE merged_into_id IS NULL)::int AS canonical, count(*) FILTER (WHERE merged_into_id IS NOT NULL)::int AS merged, ' +
    'count(*) FILTER (WHERE merged_into_id IS NULL AND identification_verified)::int AS verified, ' +
    "count(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS created_30d FROM idauto_vehicles")).rows[0];
  var plates = (await db.query("SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total FROM idauto_plates")).rows[0];
  var factStatus = await countBy("SELECT verification_status AS k, count(*)::int AS n FROM idauto_vehicle_facts WHERE is_active AND access_scope <> 'mythos_private' GROUP BY 1");
  var pendingObs = (await db.query("SELECT count(*)::int AS n FROM idauto_observations WHERE status IN ('pending_review','pending_confirmation')")).rows[0].n;
  var pendingSubs = (await db.query(
    "SELECT count(*)::int AS n FROM idauto_submissions s JOIN idauto_observations o ON o.id = s.observation_id WHERE o.status IN ('pending_review','pending_confirmation')")).rows[0].n;
  var visitStatus = await countBy('SELECT status AS k, count(*)::int AS n FROM idauto_workshop_visits GROUP BY 1');
  var opType = await countBy('SELECT operation_type AS k, count(*)::int AS n FROM idauto_workshop_operations GROUP BY 1');
  var orgStatus = await countBy('SELECT status AS k, count(*)::int AS n FROM idauto_organizations GROUP BY 1');
  var documents = (await db.query('SELECT count(*)::int AS n FROM idauto_vehicle_documents')).rows[0].n;
  var serviceEvents = (await db.query('SELECT count(*)::int AS n FROM idauto_service_events')).rows[0].n;
  var recent = (await db.query(
    'SELECT event_time, event_type, actor_type, org_id, target_type FROM idauto_audit_log ORDER BY event_time DESC, id DESC LIMIT 15')).rows;
  return {
    vehicles: vehicles,
    plates: plates,
    facts_by_status: factStatus,
    review: { pending_observations: pendingObs, pending_submissions: pendingSubs },
    workshop: { visits_by_status: visitStatus, operations_by_type: opType, service_events: serviceEvents },
    organisations_by_status: orgStatus,
    documents: documents,
    recent_activity: recent.map(function (r) { return { at: r.event_time, event_type: r.event_type, actor_type: r.actor_type, org_id: r.org_id, target_type: r.target_type }; })
  };
}

/* =========================================================================
 * IDA-ADMIN-2 — MAINTENANCE HISTORY across every organisation.
 *
 * The workshop routes (/api/workshop/*) are per organisation by design: an
 * atelier sees its own visits, and an admin must name one org_id. The console
 * needs the other view — every recorded intervention, whoever recorded it —
 * so it reads the same tables here, read-only, admin-only.
 *
 * Two record kinds, kept apart because they are different evidence:
 *   visits          idauto_workshop_visits + their operations (no mileage
 *                   column exists on a visit: odometer_km is always null)
 *   service_events  idauto_service_events (carries odometer_km when recorded)
 *
 * Never selected: the workshop customer reference (only whether one exists),
 * plate_read_confidence. plate_read — the plate as typed or read at the
 * workshop — is returned ONLY for a visit that was never identified, where it
 * is the one handle an operator has to resolve it; an identified visit shows
 * the vehicle's own current plate instead.
 * ========================================================================= */
var VISIT_STATUSES = ['open', 'in_progress', 'closed', 'cancelled'];
var OPERATION_TYPES = ['diagnosis', 'replacement', 'service', 'repair', 'inspection', 'other'];

function dateParam(q, name) {
  var v = oneParam(q, name, 10);
  if (v === null) return null;
  // Round trip, so 2026-02-30 is refused here instead of failing in SQL (a 500).
  var d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : null;
  if (!d || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw badRequest(name + ' must be a date YYYY-MM-DD');
  return v;
}

function parseMaintenanceQuery(q) {
  q = q || {};
  var out = {
    kind: oneParam(q, 'kind', 20) || 'visits',
    q: oneParam(q, 'q'),
    org_id: oneParam(q, 'org_id', 10),
    status: oneParam(q, 'status', 20),
    operation_type: oneParam(q, 'operation_type', 20),
    identified: oneParam(q, 'identified', 5),
    from: dateParam(q, 'from'),
    to: dateParam(q, 'to'),
    dir: (oneParam(q, 'dir', 8) || 'desc').toLowerCase(),
    page: oneParam(q, 'page', 8) || '1',
    page_size: oneParam(q, 'page_size', 8) || String(PAGE_SIZE_DEFAULT)
  };
  if (out.kind !== 'visits' && out.kind !== 'service_events') throw badRequest('kind must be visits or service_events');
  if (out.org_id !== null && !/^\d+$/.test(out.org_id)) throw badRequest('org_id must be a positive integer');
  if (out.status !== null && VISIT_STATUSES.indexOf(out.status) === -1) throw badRequest('unknown status', { allowed: VISIT_STATUSES });
  if (out.operation_type !== null && OPERATION_TYPES.indexOf(out.operation_type) === -1) throw badRequest('unknown operation_type', { allowed: OPERATION_TYPES });
  if (out.identified !== null && out.identified !== 'true' && out.identified !== 'false') throw badRequest('identified must be true or false');
  if (out.kind === 'service_events' && (out.status || out.operation_type || out.identified !== null)) throw badRequest('status, operation_type and identified apply to visits only');
  if (out.from && out.to && out.from > out.to) throw badRequest('from is after to');
  if (out.dir !== 'asc' && out.dir !== 'desc') throw badRequest('dir must be asc or desc');
  if (!/^\d+$/.test(out.page)) throw badRequest('page must be a positive integer');
  if (!/^\d+$/.test(out.page_size)) throw badRequest('page_size must be between 1 and ' + PAGE_SIZE_MAX);
  out.page = parseInt(out.page, 10);
  out.page_size = parseInt(out.page_size, 10);
  out.org_id = out.org_id === null ? null : parseInt(out.org_id, 10);
  if (out.page < 1) throw badRequest('page must be a positive integer');
  if (out.page_size < 1 || out.page_size > PAGE_SIZE_MAX) throw badRequest('page_size must be between 1 and ' + PAGE_SIZE_MAX);
  if ((out.page - 1) * out.page_size > OFFSET_MAX) throw badRequest('page is beyond the browsable range — narrow the filters', { offset_max: OFFSET_MAX });
  return out;
}

// Vehicle criterion shared by both kinds: IVID / internal_ref of the recorded
// vehicle, or any plate it has ever carried (any accepted spelling).
function vehicleMatchClause(alias, text, params) {
  var parsed = plateNormalizer.parsePlate(text);
  var plate = parsed.ok ? parsed.canonical : (plateValidator.normalizePlate(text) || text.toUpperCase());
  params.push(text); var exact = params.length;
  params.push(plate); var p1 = params.length;
  params.push(plate.replace(/ /g, '')); var p2 = params.length;
  return '(' + alias + '.ivid = $' + exact + ' OR ' + alias + '.internal_ref = $' + exact +
    ' OR EXISTS (SELECT 1 FROM idauto_plates p WHERE p.vehicle_id = ' + alias + '.id AND (p.plate_number = $' + p1 +
    " OR REPLACE(p.plate_number, ' ', '') = $" + p2 + ')))';
}

function vehicleSummary(r) {
  if (!r.v_ivid) return null;
  var parsed = r.v_plate ? plateNormalizer.parsePlate(r.v_plate) : null;
  return { ivid: r.v_ivid, internal_ref: r.v_internal_ref, make: r.v_make, model: r.v_model, year: r.v_year,
    plate: r.v_plate, plate_display: parsed && parsed.ok ? parsed.display : r.v_plate, merged_into: r.v_merged_into || null };
}

var VEHICLE_SUMMARY_SQL =
  'v.ivid AS v_ivid, v.internal_ref AS v_internal_ref, v.make AS v_make, v.model AS v_model, v.year AS v_year, mv.ivid AS v_merged_into, ' +
  "(SELECT p.plate_number FROM idauto_plates p WHERE p.vehicle_id = v.id AND p.status = 'active' ORDER BY p.id DESC LIMIT 1) AS v_plate";

async function listMaintenance(filter) {
  var where = [], params = [];
  var visits = filter.kind === 'visits';
  var t = visits ? 'w' : 'e';
  var dateCol = visits ? 'w.opened_at' : 'e.event_date';
  if (filter.org_id !== null) { params.push(filter.org_id); where.push(t + '.org_id = $' + params.length); }
  if (filter.from) { params.push(filter.from); where.push(dateCol + ' >= $' + params.length + '::date'); }
  if (filter.to) { params.push(filter.to); where.push(dateCol + " < ($" + params.length + "::date + INTERVAL '1 day')"); }
  if (visits) {
    if (filter.status) { params.push(filter.status); where.push('w.status = $' + params.length); }
    if (filter.operation_type) { params.push(filter.operation_type); where.push('EXISTS (SELECT 1 FROM idauto_workshop_operations o WHERE o.visit_id = w.id AND o.operation_type = $' + params.length + ')'); }
    if (filter.identified !== null) where.push(filter.identified === 'true' ? 'w.vehicle_id IS NOT NULL' : 'w.vehicle_id IS NULL');
  }
  if (filter.q) {
    var vm = vehicleMatchClause('v', filter.q, params);
    if (visits) {
      // An unidentified visit is found by the plate read at the workshop.
      var parsed = plateNormalizer.parsePlate(filter.q);
      var plate = parsed.ok ? parsed.canonical : filter.q.toUpperCase();
      params.push(plate.replace(/ /g, ''));
      vm = '(' + vm + " OR (w.vehicle_id IS NULL AND REPLACE(UPPER(w.plate_read), ' ', '') = $" + params.length + '))';
    }
    where.push(vm);
  }
  var whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  var from = visits
    ? ' FROM idauto_workshop_visits w LEFT JOIN idauto_vehicles v ON v.id = w.vehicle_id LEFT JOIN idauto_vehicles mv ON mv.id = v.merged_into_id LEFT JOIN idauto_organizations org ON org.id = w.org_id'
    : ' FROM idauto_service_events e LEFT JOIN idauto_vehicles v ON v.id = e.vehicle_id LEFT JOIN idauto_vehicles mv ON mv.id = v.merged_into_id LEFT JOIN idauto_organizations org ON org.id = e.org_id';

  var total = (await db.query('SELECT count(*)::int AS n' + from + whereSql, params)).rows[0].n;
  var dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
  var pageParams = params.slice();
  pageParams.push(filter.page_size); var li = pageParams.length;
  pageParams.push((filter.page - 1) * filter.page_size); var oi = pageParams.length;
  var select = visits
    ? 'SELECT w.id, w.org_id, org.name AS org_name, w.status, w.opened_at, w.closed_at, w.reason, w.identification_method, w.plate_read_method, ' +
      'CASE WHEN w.vehicle_id IS NULL THEN w.plate_read END AS plate_read, (w.customer_ref_id IS NOT NULL) AS customer_ref_present, ' + VEHICLE_SUMMARY_SQL
    : 'SELECT e.id, e.org_id, org.name AS org_name, e.event_type, e.event_date, e.odometer_km, e.description, e.outcome, e.next_service_due, e.is_public, e.created_at, ' + VEHICLE_SUMMARY_SQL;
  var rows = (await db.query(select + from + whereSql + ' ORDER BY ' + dateCol + ' ' + dir + ' NULLS LAST, ' + t + '.id ' + dir +
    ' LIMIT $' + li + ' OFFSET $' + oi, pageParams)).rows;

  var results;
  if (visits) {
    var ids = rows.map(function (r) { return r.id; });
    var ops = ids.length ? (await db.query(
      'SELECT o.id, o.visit_id, o.operation_type, o.description, o.quantity, o.status, o.created_at, p.reference AS part_reference, p.brand AS part_brand, p.name AS part_name ' +
      'FROM idauto_workshop_operations o LEFT JOIN idauto_parts p ON p.id = o.part_id WHERE o.visit_id = ANY($1::bigint[]) ORDER BY o.created_at, o.id', [ids])).rows : [];
    var byVisit = {};
    ops.forEach(function (o) {
      (byVisit[o.visit_id] = byVisit[o.visit_id] || []).push({ id: o.id, operation_type: o.operation_type, description: o.description, quantity: o.quantity,
        status: o.status, recorded_at: o.created_at, part: o.part_reference ? { reference: o.part_reference, brand: o.part_brand, name: o.part_name } : null });
    });
    results = rows.map(function (r) {
      return { id: r.id, org_id: r.org_id, org_name: r.org_name, status: r.status, opened_at: r.opened_at, closed_at: r.closed_at,
        reason: r.reason, identification_method: r.identification_method, plate_read_method: r.plate_read_method,
        plate_read: r.plate_read, customer_ref_present: r.customer_ref_present, odometer_km: null,
        vehicle: vehicleSummary(r), operations: byVisit[r.id] || [] };
    });
  } else {
    results = rows.map(function (r) {
      return { id: r.id, org_id: r.org_id, org_name: r.org_name, event_type: r.event_type, event_date: r.event_date, odometer_km: r.odometer_km,
        description: r.description, outcome: r.outcome, next_service_due: r.next_service_due, is_public: r.is_public, recorded_at: r.created_at,
        vehicle: vehicleSummary(r) };
    });
  }

  // Filter choices come from the data, never from a hard-coded list of ateliers.
  var orgs = (await db.query(
    'SELECT o.id, o.name, o.status FROM idauto_organizations o WHERE EXISTS (SELECT 1 FROM idauto_workshop_visits w WHERE w.org_id = o.id) ' +
    'OR EXISTS (SELECT 1 FROM idauto_service_events e WHERE e.org_id = o.id) ORDER BY o.name, o.id')).rows;
  var counts = (await db.query(
    "SELECT (SELECT count(*)::int FROM idauto_workshop_visits) AS visits, (SELECT count(*)::int FROM idauto_workshop_visits WHERE vehicle_id IS NULL) AS unidentified_visits, " +
    '(SELECT count(*)::int FROM idauto_workshop_operations) AS operations, (SELECT count(*)::int FROM idauto_service_events) AS service_events, ' +
    '(SELECT count(*)::int FROM idauto_service_events WHERE odometer_km IS NOT NULL) AS service_events_with_mileage')).rows[0];

  return { kind: filter.kind, page: filter.page, page_size: filter.page_size, total: total, pages: Math.max(1, Math.ceil(total / filter.page_size)),
    dir: filter.dir, organisations: orgs, totals: counts, mileage_recorded_on_visits: false, results: results };
}

module.exports = {
  parseRegistryQuery: parseRegistryQuery,
  listVehicles: listVehicles,
  dossier: dossier,
  overview: overview,
  PAGE_SIZE_MAX: PAGE_SIZE_MAX,
  OFFSET_MAX: OFFSET_MAX,
  SORTS: Object.keys(SORTS),
  FICHE_STATUSES: FICHE_STATUSES.slice(),
  parseMaintenanceQuery: parseMaintenanceQuery,
  listMaintenance: listMaintenance,
  VISIT_STATUSES: VISIT_STATUSES.slice(),
  OPERATION_TYPES: OPERATION_TYPES.slice()
};
