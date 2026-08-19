'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4-FOUNDATION — Digital Vehicle Passport assembly
// reference/passport-assembly.js
//
// Pure function, no I/O: no filesystem, no network, no database, and no
// internal clock read (`new Date()`/`Date.now()` never appear below —
// the only time value used anywhere is the caller-injected `now`). Given
// already-loaded, in-memory records, assembles one object conforming to
// protocol/schemas/passport.schema.json for one caller's access scope.
//
// Rules implemented here, and where each comes from:
//
//   - Scope filtering (docs/PRIVACY_ARCHITECTURE.md §3): a caller's scope
//     filters which facts/plates are visible by their own
//     provenance.access_scope. Scopes are layered public < professional
//     < restricted — a professional caller sees everything a public
//     caller sees, plus professional-scoped material; a public caller
//     NEVER sees restricted material, structurally (see
//     scopeRank/isVisibleAtScope below), not by a filter that could be
//     forgotten on one code path.
//   - trust_summary (protocol/schemas/passport.schema.json,
//     docs/TRUST_MODEL.md §2/§2.1): counts per T0-T3, plus a SEPARATE
//     `anchored` count. T4 is never a real level — TRUST_MODEL.md §2.1:
//     "T4 sits in the same list for practical reasons... but it answers
//     a different question" — so the output object never contains a
//     "T4" key, by construction (anchoring_state is tallied into
//     `anchored`, never merged into the T0-T3 counts).
//   - completeness_note (passport.schema.json's own description,
//     docs/TRUST_MODEL.md §7 "It does not treat absence of evidence as
//     evidence of absence"): ALWAYS present, including when the
//     scope-filtered fact set is empty — the empty case gets its own
//     wording rather than an empty or generic string, because an empty
//     passport is exactly the situation this guard exists for.
//   - qr (passport.schema.json's own description,
//     docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md §2.1): payload is the IVID
//     string and NOTHING else — never a token, never a scope-bearing
//     credential. Enforced structurally: payload is always literally
//     `vehicle.ivid`, assigned once, never composed from a template
//     string that could accidentally interpolate something else in.
//
// Does not validate its inputs against the full JSON Schemas (no schema
// validator is a dependency of this repository) — it validates the
// specific structural invariants it relies on (vehicle.ivid present,
// scope recognised, now supplied) and throws a descriptive Error
// otherwise, in the same style as reference/ivid.js.
// =====================================================

var SCOPE_RANK = { public: 0, professional: 1, restricted: 2 };

// The live implementation persists the third scope as the string
// 'mythos_private' (docs/PRIVACY_ARCHITECTURE.md §3's naming note);
// the protocol vocabulary calls the same scope 'restricted'. This
// module accepts either spelling anywhere a scope value is read
// (the caller's requested `scope`, or a record's
// `provenance.access_scope`) and always normalises to the protocol
// spelling before it appears in an emitted object, so the output is
// always schema-conformant regardless of which spelling the caller
// used going in.
function normalizeScope(value) {
  if (value === 'mythos_private') return 'restricted';
  if (value === 'public' || value === 'professional' || value === 'restricted') return value;
  return null;
}

function scopeRank(value) {
  var n = normalizeScope(value);
  return n === null ? null : SCOPE_RANK[n];
}

// True when a record whose own access_scope is `recordScope` is
// visible to a caller viewing at `viewerScope`. Missing/unrecognised
// record scope defaults to the most restrictive (never silently
// exposes a record whose scope could not be determined).
function isVisibleAtScope(recordScope, viewerRank) {
  var r = scopeRank(recordScope);
  if (r === null) return false;
  return r <= viewerRank;
}

// Builds the REQUIRED completeness_note. Always returns a non-empty
// string, including for an empty fact set (the vacuity guard this
// stage's test suite specifically exercises) — an empty passport is
// exactly the case this note exists to explain, not a case where it
// can be skipped.
function buildCompletenessNote(includedCount, totalCount, scopeLabel) {
  if (includedCount === 0) {
    return 'No facts are recorded for this vehicle at the \'' + scopeLabel + '\' access scope. ' +
      'This is NOT evidence the vehicle is free of any issue — it means nothing has been ' +
      'recorded, verified, or disclosed at this scope yet. Absence of evidence is not evidence ' +
      'of absence (docs/TRUST_MODEL.md §7).';
  }
  var omitted = totalCount - includedCount;
  var omittedNote = omitted > 0
    ? (' ' + omitted + ' additional fact(s) exist at a higher access scope and are not shown here.')
    : '';
  return 'This passport reflects ' + includedCount + ' recorded fact(s), filtered to the \'' +
    scopeLabel + '\' access scope, as generated.' + omittedNote + ' It summarizes exactly what ' +
    'has been recorded and its corroboration level — it is not a certificate of condition. ' +
    'A vehicle with no recorded damage has no recorded damage, which is not the same as an ' +
    'undamaged vehicle (docs/TRUST_MODEL.md §7).';
}

// Computes trust_summary from a set of already scope-filtered fact ids
// and the full trustAssessments list. Only the LATEST assessment per
// subject_ref is counted (an assessment can supersede an earlier one,
// per trust-assessment.schema.json's `supersedes` — counting every
// historical assessment would double-count a single fact that was
// reassessed). "Latest" means the one no other assessment's
// `supersedes` points to; when several tie (no supersession chain
// distinguishes them) the one with the greatest assessed_at wins,
// falling back to array order for a further tie so the result is
// still deterministic.
function latestAssessmentsBySubject(trustAssessments, includedFactIds) {
  var superseded = Object.create(null);
  trustAssessments.forEach(function (a) {
    if (a && a.supersedes) superseded[a.supersedes] = true;
  });

  var bySubject = Object.create(null);
  trustAssessments.forEach(function (a, idx) {
    if (!a || !a.subject_ref) return;
    if (includedFactIds.indexOf(a.subject_ref) === -1) return;
    if (a.id && superseded[a.id]) return; // a later assessment replaced this one
    var current = bySubject[a.subject_ref];
    if (!current) {
      bySubject[a.subject_ref] = { assessment: a, idx: idx };
      return;
    }
    var currentAt = current.assessment.assessed_at || '';
    var candidateAt = a.assessed_at || '';
    if (candidateAt > currentAt || (candidateAt === currentAt && idx > current.idx)) {
      bySubject[a.subject_ref] = { assessment: a, idx: idx };
    }
  });

  return Object.keys(bySubject).map(function (k) { return bySubject[k].assessment; });
}

function buildTrustSummary(trustAssessments, includedFacts) {
  var includedFactIds = includedFacts.map(function (f) { return f.id; }).filter(function (id) { return !!id; });
  var latest = latestAssessmentsBySubject(trustAssessments || [], includedFactIds);

  var summary = { T0: 0, T1: 0, T2: 0, T3: 0, anchored: 0, conflicts: 0 };
  latest.forEach(function (a) {
    if (a.level === 'T0' || a.level === 'T1' || a.level === 'T2' || a.level === 'T3') {
      summary[a.level] += 1;
    }
    // Deliberately no "T4" branch: anchoring is orthogonal (TRUST_MODEL.md
    // §2.1) and is tallied below, never merged into a T-level count.
    if (a.anchoring_state === 'anchored') {
      summary.anchored += 1;
    }
  });

  summary.conflicts = includedFacts.filter(function (f) {
    return Array.isArray(f.conflicts_with) && f.conflicts_with.length > 0;
  }).length;

  return summary;
}

// Attaches any Anomaly objects (protocol/schemas/anomaly.schema.json)
// whose examined_refs names this fact's id, without mutating the input
// fact object.
function attachAnomalies(fact, anomalies) {
  if (!fact.id || !Array.isArray(anomalies) || anomalies.length === 0) return fact;
  var matched = anomalies.filter(function (a) {
    return a && Array.isArray(a.examined_refs) && a.examined_refs.indexOf(fact.id) !== -1;
  });
  if (matched.length === 0) return fact;
  var copy = {};
  Object.keys(fact).forEach(function (k) { copy[k] = fact[k]; });
  copy.anomalies = (Array.isArray(fact.anomalies) ? fact.anomalies : []).concat(matched);
  return copy;
}

// assemblePassport({ vehicle, plates, facts, observations,
//                     trustAssessments, anomalies, scope, now })
//
// Required: vehicle (object with a non-empty .ivid), facts (array,
// possibly empty), scope (one of 'public'/'professional'/'restricted'/
// 'mythos_private'), now (a Date instance or an ISO-8601 date-time
// string — the sole time input this module ever reads).
//
// Optional, default to []: plates, observations, trustAssessments,
// anomalies. `observations` is not itself emitted (passport.schema.json
// has no observations property — raw observations are restricted-scope
// implementation detail, per docs/PRIVACY_ARCHITECTURE.md §3/§4); it is
// read only for its length, to make the completeness_note able to say
// how many observations back the shown facts, when that count is
// informative.
function assemblePassport(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('assemblePassport: input object is required');
  }
  var vehicle = input.vehicle;
  if (!vehicle || typeof vehicle !== 'object' || typeof vehicle.ivid !== 'string' || vehicle.ivid.length === 0) {
    throw new Error('assemblePassport: input.vehicle with a non-empty string .ivid is required');
  }
  if (!input.now) {
    throw new Error('assemblePassport: input.now is required (no internal clock is read)');
  }
  var generatedAt = input.now instanceof Date ? input.now.toISOString() : String(input.now);

  var requestedScope = normalizeScope(input.scope);
  if (requestedScope === null) {
    throw new Error('assemblePassport: input.scope must be one of public, professional, restricted (or mythos_private)');
  }
  var viewerRank = SCOPE_RANK[requestedScope];

  var allFacts = Array.isArray(input.facts) ? input.facts : [];
  var allPlates = Array.isArray(input.plates) ? input.plates : [];
  var observations = Array.isArray(input.observations) ? input.observations : [];
  var trustAssessments = Array.isArray(input.trustAssessments) ? input.trustAssessments : [];
  var anomalies = Array.isArray(input.anomalies) ? input.anomalies : [];

  var includedFacts = allFacts.filter(function (f) {
    var s = f && f.provenance && f.provenance.access_scope;
    return isVisibleAtScope(s, viewerRank);
  });

  // Defensive, structural re-check (belt-and-braces): a public caller
  // must never end up with a restricted-scope fact in the output, no
  // matter what upstream filtering logic changes in the future.
  if (requestedScope === 'public') {
    var leaked = includedFacts.some(function (f) {
      return normalizeScope(f.provenance && f.provenance.access_scope) !== 'public';
    });
    if (leaked) {
      throw new Error('assemblePassport: internal invariant violated — non-public fact reached a public-scope passport');
    }
  }

  var includedPlates = allPlates.filter(function (p) {
    var s = p && p.provenance && p.provenance.access_scope;
    // A plate with no provenance/access_scope at all is treated as
    // public-visible (registration-plate assignment is base vehicle
    // data per docs/PRIVACY_ARCHITECTURE.md §3's "Public" list), unlike
    // facts, which default closed. Named explicitly rather than left
    // as an accidental fallthrough.
    if (s === undefined || s === null) return true;
    return isVisibleAtScope(s, viewerRank);
  });

  var outputFacts = includedFacts.map(function (f) { return attachAnomalies(f, anomalies); });

  var trustSummary = buildTrustSummary(trustAssessments, includedFacts);

  var passport = {
    protocol_version: '0.1.0-draft',
    ivid: vehicle.ivid,
    generated_at: generatedAt,
    scope: requestedScope,
    vehicle: vehicle,
    plates: includedPlates,
    facts: outputFacts,
    trust_summary: trustSummary,
    completeness_note: buildCompletenessNote(includedFacts.length, allFacts.length, requestedScope) +
      (observations.length > 0 ? (' Backed by ' + observations.length + ' recorded observation(s) in total across all scopes.') : ''),
    qr: {
      payload: vehicle.ivid,
      resolves_to_scope: 'public'
    }
  };

  if (passport.qr.payload !== vehicle.ivid) {
    // Unreachable given the assignment above; kept as an explicit,
    // checkable invariant per this stage's "enforce: payload === vehicle
    // ivid" instruction rather than relying on the assignment alone.
    throw new Error('assemblePassport: internal invariant violated — qr.payload must equal vehicle.ivid');
  }

  return passport;
}

module.exports = {
  assemblePassport: assemblePassport,
  normalizeScope: normalizeScope,
  scopeRank: scopeRank,
  isVisibleAtScope: isVisibleAtScope,
  buildCompletenessNote: buildCompletenessNote,
  buildTrustSummary: buildTrustSummary
};
