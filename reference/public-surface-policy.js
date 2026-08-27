'use strict';
// =====================================================
// MYTHOS — ID Auto — public-surface policy
// reference/public-surface-policy.js
//
// A5-PLATE, REVISED OWNER RULING, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md
// §I — DECIDED, superseding the prior "OWNER DECISION PENDING" interim
// state this module replaces). FINAL RULE, quoted exactly: "PRIVATE:
// plate_number = permitted. PUBLIC: plate_number = hidden. PUBLIC
// RESOLUTION: IVID only." The owner's fuller ruling, also binding: in
// PRIVATE phase plate_number may be displayed/stored/used normally by
// authorized internal users per the existing authorization model — this
// does NOT authorize plate-based public passport resolution, ever, in
// either phase; in PUBLIC phase plate_number MUST NOT appear in the
// anonymous response and MUST NOT be used as the resolution key; IVID
// remains the ONLY public resolution identifier; public exposure must be
// controlled by an explicit public-surface policy, not by manual code
// edits — this file IS that policy artifact.
//
// This is the ONE reviewed artifact that defines what
// reference/api.js's ANONYMOUS surface (GET /public/passport/:ivid) may
// never show, regardless of a fact's stored access_scope. It is
// deliberately NOT config-toggleable — a config value an operator could
// flip would let that operator violate an unconditional owner ruling.
// Changing this policy means changing this one reviewed file, not
// editing a config value or a route body.
//
// Two fact_keys are denied on the anonymous surface, permanently:
//   - 'vin'          — docs/PRIVACY_ARCHITECTURE.md §3, "Never public" ->
//                       "Restricted attributes: VIN, engine number".
//                       (engine_cc is engine DISPLACEMENT, a normal
//                       public technical spec, not "engine number" — an
//                       engine's serial/identifying number, which this
//                       codebase's fact_key vocabulary has no separate
//                       key for; no other "Never public" category in
//                       PRIVACY_ARCHITECTURE.md §3 maps onto any
//                       fact_key that exists at all.)
//   - 'plate_number' — A5-PLATE FINAL RULE, 2026-08-19. RULED, not
//                       pending: hidden on the anonymous surface,
//                       unconditionally, in PUBLIC phase.
//
// PHASE GATE (config, NOT this policy): reference/api.js reads
// config/idauto.example.json's public_resolution.enabled to decide
// which PHASE the anonymous surface is in — false = PRIVATE phase (the
// anonymous surface is off entirely; the authenticated
// GET /api/passport/:ivid route is the only passport surface reachable,
// and per the PRIVATE-phase half of the ruling it MAY show
// plate_number); true = PUBLIC phase (the anonymous surface is on, WITH
// this policy's deny-list applied — never omitted, never toggled off
// independently of the phase gate). The phase gate is an operational
// on/off switch (config); the deny-list below is an owner ruling (code,
// reviewed, not config) — conflating the two would let a config edit
// silently relax what the owner decided.
// =====================================================

var ANONYMOUS_SURFACE_DENIED_FACT_KEYS = ['vin', 'plate_number'];

// Structural invariant the owner's "PUBLIC RESOLUTION: IVID only" rule
// states beyond the fact-key deny-list above: plate RECORDS
// (idauto_plates rows) and a vehicle's current_plate_ref never appear on
// the anonymous surface at all, under any circumstance — independent of
// any fact_key. reference/api.js's public route never selects
// idauto_plates and never sets current_plate_ref on the vehicle object
// it builds. This constant documents that invariant for any reader of
// this module; it is not itself an executable check (the executable
// proof is tests/ida4-option-c-test.js's own assertions against the
// live route).
// IDA-V6, 2026-08-27 — OWNER DECISION. WITHDRAWN.
//
// This constant used to be `true` and documented the A5-PLATE rule that a
// vehicle's plate record never appeared on the anonymous surface. The owner
// has decided that the registration plate is public data in IDauto V1: the
// public passport shows it however it was reached — by plate, by IVID, or by
// scanning the QR.
//
// The protocol layer already agreed: reference/passport-assembly.js treats a
// plate with no access_scope as public-visible, citing
// docs/PRIVACY_ARCHITECTURE.md §3, which lists registration-plate assignment
// under "Public" base vehicle data. It was this API's route that withheld it.
//
// WHAT DID NOT CHANGE, and must not: 'vin' stays on the deny-list below, and
// so does 'plate_number'. The plate now served publicly is the AUTHORITATIVE
// record from idauto_plates. A community-submitted FACT keyed 'plate_number'
// is a different thing — arbitrary text somebody typed — and it stays
// excluded, so this decision cannot be used to smuggle unverified strings
// onto the public surface under a trusted-looking key.
var ANONYMOUS_SURFACE_INCLUDES_AUTHORITATIVE_PLATE_RECORD = true;

// Returns a FRESH COPY of the anonymous-surface deny-list every call —
// callers must never mutate the module's own array. reference/api.js is
// the only caller today.
function deniedFactKeys() {
  return ANONYMOUS_SURFACE_DENIED_FACT_KEYS.slice();
}

module.exports = {
  deniedFactKeys: deniedFactKeys,
  ANONYMOUS_SURFACE_INCLUDES_AUTHORITATIVE_PLATE_RECORD: ANONYMOUS_SURFACE_INCLUDES_AUTHORITATIVE_PLATE_RECORD
};
