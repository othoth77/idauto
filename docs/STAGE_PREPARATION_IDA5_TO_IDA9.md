# Stage Preparation — IDA-5 through IDA-9 and Part Identity

**Date:** 2026-08-19
**Repo state:** `othoth77/idauto`, branch `ida4-foundation` @ `39d6bee` ("feat(ida4): gate-free
foundation subset — IVID library, protocol artifacts, passport assembly, threat model")
**Purpose:** master-mission Stages 8–12 preparation/verification pass. IDA-5 (professional
issuers), IDA-7 (VC/DID), IDA-8 (anchoring), IDA-9 (open protocol) and Part Identity are
required by the master mission to be **prepared** — architecture and design only. This
document verifies what already exists in this repository against each stage's requirements,
classifies every element **PREPARED / PARTIAL / OPEN** with a citation, and records the gaps
honestly.

**This document authorizes nothing.** It implements no code, changes no schema, and does not
move any gate in `docs/IDA4_READINESS_AUDIT.md` or `docs/ROADMAP.md`. Where it finds a gap, the
gap stays open; where it finds preparation already done, it says so with a citation, not a
recommendation to build further right now.

Findings from **the IDA-4 architecture review (2026-08-19)** are incorporated below with
attribution wherever cited; they are binding inputs to this pass, not re-derived from
scratch. One factual correction to that review is recorded in the Stage 8 table (issuer
`credentials` gap) — see the note there and the final report.

---

## Stage 8 — Professional issuers (IDA-5 preparation)

**Status per `docs/ROADMAP.md` line 39:** IDA-5 is **SPECIFIED**, depends on IDA-4.
`docs/ROADMAP.md` lines 236–245 lists its scope: issuer registry with verifiable identity;
onboarding and accreditation; issuance rights per `authority_scope`; workflow integration for
garages, insurers, fleet operators, inspectors and dealers; suspension/revocation with
history retained; retroactive issuer-wide reassessment; professional subscription tiers;
source-quality scoring; regional coverage dashboards; an optional narrow part-fitment slice.

| Element | Classification | Citation |
|---|---|---|
| Issuer identity + verification model | **PREPARED** | `protocol/schemas/issuer.schema.json` — `did` (pattern `^did:[a-z0-9]+:.+$`), `legal_entity` (business identity only, explicitly "no natural-person data belongs here"), `status`/`status_history`, `onboarding_evidence_refs`, `onboarded_at`, `last_reassessed_at`. OVIP §7 states the normative rules this schema implements verbatim. |
| Issuer classes covered | **PREPARED** | `issuer.schema.json` `issuer_type` enum: `garage`, `insurer`, `fleet_operator`, `inspector`, `dealer`, `authorised_institution`, `manufacturer` — covers every class named in `docs/ROADMAP.md`'s IDA-5 scope line plus `manufacturer` (needed for `docs/PART_IDENTITY.md` §3's `manufacturer` field) and `authorised_institution` (T3). OVIP §7's prose ("a garage, insurer, fleet operator, inspector, dealer, or authorised institution") matches the enum exactly. |
| Trust class (T2/T3) as onboarding-evidence property | **PREPARED** | `issuer.schema.json` `trust_class` enum `["T2","T3"]`, described as "a property of the ONBOARDING EVIDENCE, recorded and re-assessable — not of the issuer_type alone" — matches OVIP §7 ("An Issuer's trust class... is a property of the onboarding evidence, MUST be recorded, and MUST be re-assessable") and `docs/TRUST_MODEL.md` §2's ladder definitions for T2/T3. |
| Authority scope + out-of-scope detection | **PREPARED** | `issuer.schema.json` `authority_scope` (array, default `[]`), description: "A claim outside scope raises an `issuer_out_of_scope` anomaly rather than being silently accepted." `protocol/schemas/anomaly.schema.json` `type` enum includes `issuer_out_of_scope`. `protocol/verification/README.md` Step 5 names the same check: "check the claim is within the issuer's `authority_scope`. An out-of-scope claim raises `issuer_out_of_scope`" (status: SPECIFIED). |
| Signing + attestation seam (provenance → issuer) | **PREPARED** | OVIP §5's provenance envelope table has an `issuer` field ("The Issuer DID, when the claim is issuer-signed"), server-derived per the same section. `protocol/schemas/trust-assessment.schema.json` `rationale.issuer_did` and `rationale.basis` enum value `professional_issuer_direct_handling` give the trust computation a direct seam into issuer identity. `protocol/schemas/MAPPING.md` confirms the live implementation's nearest field (`validated_by VARCHAR(64)`) is "an opaque operator identity string, not a DID" today — the seam is designed, not yet populated by a real DID. |
| Revocation / status lifecycle | **PREPARED** | `issuer.schema.json` `status` enum `["active","suspended","revoked","withdrawn"]` with `status_history` (array of `{status, changed_at, reason}`). OVIP §7: "An Issuer's credentials MUST remain verifiable after the Issuer's status changes. Suspension affects new issuance, not the checkability of past signatures." Credential-level revocation (as distinct from issuer-level status) is specified separately in `protocol/credentials/README.md` §5 (status-list mechanism, target IDA-7) — the two layers (issuer status vs. credential status) are both designed and cross-referenced, neither implemented. |
| IDA-4 forward-compatibility | **PREPARED**, per the IDA-4 architecture review (2026-08-19) | The review's finding — that IDA-4's surface needs no redesign for IDA-5 because the seams already exist (`provenance.issuer` as a server-derived DID pattern; `trust-assessment.rationale.issuer_did`/`basis: professional_issuer_direct_handling`; `passport.credentials[]`; `anomaly.type: issuer_out_of_scope`; a complete `issuer.schema.json`) — is independently confirmed by this pass against each cited file above. Every seam the review names is present exactly as described. |
| **Gap: `credentials` field, untyped placeholder** | **PARTIAL — location correction** | The IDA-4 architecture review attributes this gap to `issuer.schema.json`'s `credentials.items`. **This pass finds no `credentials` field anywhere in `issuer.schema.json`** (its full property list is `protocol_version, did, issuer_type, trust_class, legal_entity, authority_scope, status, status_history, onboarding_evidence_refs, onboarded_at, last_reassessed_at` — verified by direct read and by `grep -n credentials protocol/schemas/*.json`, which returns exactly one hit, in a different file). The untyped placeholder that actually exists is `protocol/schemas/passport.schema.json`'s `credentials` field: `{"type":"array","items":{"type":"object"},"default":[],"description":"W3C Verifiable Credentials issued about this vehicle. See protocol/credentials/."}` — an array of bare, unconstrained objects. The review's underlying point stands (an untyped placeholder exists and tightening it to reference a real VC/credential schema is additive), but the citation should be `passport.schema.json`, not `issuer.schema.json`. Reported here rather than silently corrected, per instruction; see the final report. |
| Issuer onboarding/verification **process** | **OPEN** — owner/legal | No document read for this pass (`ROADMAP.md`, `IDENTITY_ARCHITECTURE.md`, `issuer.schema.json`, `OPEN_VEHICLE_IDENTITY_PROTOCOL.md` §7, `PART_IDENTITY.md`) specifies **who** verifies that a garage is a garage, what evidence an onboarding check requires, or who performs it. `issuer.schema.json` has `onboarding_evidence_refs` (a place to *record* evidence) but no schema or document defines the evidence *requirements* or the reviewing party. `docs/IDA4_READINESS_AUDIT.md` §B item #8 ("Professional data-sharing legal basis") is the closest adjacent LEGAL-REVIEW-REQUIRED item, but it does not cover the operational onboarding process itself. This is an honest gap, not a thin PREPARED claim. |
| Fee/subscription model | **PREPARED as design, not process** | `docs/BUSINESS_MODEL.md` §2 "Professional — subscription" table: issuer identity (DID) and issuance rights priced on "Seats, or vehicles handled," workflow integration, own service history, professional-scope lookup, verification-request tooling. §5 states plainly: "No revenue model here has been validated. Nothing is deployed, nothing is sold, no customer has been asked to pay." Matches `docs/ROADMAP.md`'s IDA-5 line item "professional subscription tiers." Design exists; pricing, billing integration and validation do not — correctly PLANNED/SPECIFIED per `BUSINESS_MODEL.md`'s own header, not overclaimed here. |

**Stage 8 summary.** The identity, classification, authority-scope, revocation and
forward-compatibility elements are genuinely PREPARED with direct schema/doc evidence. The
onboarding **process** (who verifies a garage is a garage) is OPEN and undefined anywhere in
the repository — this is the most consequential real gap for IDA-5, more so than the
credentials-placeholder question, which is cosmetic by comparison.

---

## Stage 9 — VC/DID architecture (IDA-7 preparation)

**Status per `docs/ROADMAP.md` line 41:** IDA-7 is **SPECIFIED**, depends on IDA-6. Scope
(lines 269–287): W3C VC issuance and verification; DID resolution (`did:web`, `did:key`) with
DID-document archiving at issuance; status-list revocation; credential types per
`protocol/credentials/README.md`; a published JSON-LD context; SDKs; a conformance suite. Also
where IDA-2E (real authentication) is finally resolved, and where the scheduled renames
(`mythos_user_id` → `subject_ref`, `mythos_private` → `restricted`) execute.

| Element | Classification | Citation |
|---|---|---|
| Passport-as-subject, not credential | **PREPARED** | `protocol/credentials/README.md` §1: "A Digital Vehicle Passport is **not** a VC... Each issuer-signed claim is its own VC. The passport references those VCs." OVIP §12: "The vehicle passport is modelled as a **credential subject**, not as a credential." `passport.schema.json`'s own `description` states the same rule verbatim. Confirmed as no conflict, per the IDA-4 architecture review. |
| Issuer identity as DID | **PREPARED** | `issuer.schema.json` `did` field, pattern-enforced. OVIP §2.2, §7, §12 all state issuer identity MUST be a W3C DID. `protocol/credentials/README.md` §4 defines the accepted DID methods. |
| DID method choice | **PARTIAL** | `protocol/credentials/README.md` §4: `did:web` (default for organisational issuers) and `did:key` (ephemeral/offline issuers) are named as the two the protocol documents by name; "others" are explicitly left as "deployment configuration, not protocol." No single method is mandated — this is a deliberate protocol-level openness, not an unresolved question, but it means an implementation still has to pick a default before any code is written. `did:web`'s domain-lapse weakness and its mitigation (mandatory DID-document archiving at issuance) are already specified. |
| OVIP §12 "no invented primitives" rule | **PREPARED** | OVIP §12: "New identity primitives MUST NOT be invented where a W3C primitive fits. Where one is unavoidable, the deviation and its reason MUST be documented in `protocol/credentials/README.md`." `protocol/credentials/README.md` §6 records exactly one deviation (`IVID` is not a DID, with its reasoning) and states "No other deviation is currently specified." The rule and its one exercised exception are both PREPARED and self-consistent. |
| Credential issuance flow | **OPEN** | `protocol/credentials/README.md` §8 implementation-status table: "VC issuance | **SPECIFIED** — no implementation." The example credential shape (§2) and credential-type table (§3) are specified; the actual issuance flow (who calls what, when a garage signs, how the credential enters the passport aggregate) is not. Target stage IDA-7 per the same document's header. |
| Key management | **OPEN** | No document read for this pass (`credentials/README.md`, `IDENTITY_ARCHITECTURE.md`, `THREAT_MODEL.md`) specifies how an issuer generates, stores, rotates or recovers its signing key. `THREAT_MODEL.md` §2 names "Compromised professional issuer" as an actor whose "trust model's response (retroactive reassessment...) is already specified for when it does" — but the *preventive* key-management design (how a key is protected from compromise in the first place) is absent. Genuinely OPEN, not merely unimplemented. |
| Status-list revocation | **PREPARED** | `protocol/credentials/README.md` §5: `BitstringStatusListEntry`, "MUST NOT be implemented by deleting the credential," issuer-wide reassessment on compromise "supported by design because it will happen." §8: "Status-list revocation | **SPECIFIED** — no implementation." |
| Selective disclosure | **OPEN, deliberately PLANNED** | `protocol/credentials/README.md` §7: "Status: PLANNED, not specified. The mechanism is not chosen and the privacy analysis has not been done." Recorded honestly as a future item, not conflated with the rest of the credential design. |
| JSON-LD context, SDKs, conformance suite | **OPEN** | `protocol/credentials/README.md` §8: JSON-LD context "NOT PUBLISHED — the URL does not resolve yet." `docs/OPEN_SOURCE_STRATEGY.md` §7: SDKs, JSON-LD context, conformance suite all **PLANNED**. §6 states plainly: "An 'open protocol' with none of these is a published specification... Calling it an ecosystem before the conformance suite exists would be overclaiming." |
| IDA-2E auth dependency | **OPEN — REQUIRED gate**, per `docs/IDA4_READINESS_AUDIT.md` §A | Gate A1 ("Real authentication (IDA-2E→IDA-7)") is classified **BLOCKED — REQUIRED** in the readiness audit's §G summary table, with three sub-gates: A2 (authorization model, NOT STARTED), A3 (session/token model, does not exist), A5 (owner decision: wait for IDA-7, or build an IDA-4-scoped interim mechanism — **not yet made by any document**). `docs/IDENTITY_ARCHITECTURE.md` §8 confirms: "Real authentication (users, credentials, sessions, MFA) | **BLOCKED** → IDA-7." IDA-7 is explicitly *where* this resolves, per `docs/ROADMAP.md` line 279: "This is also where IDA-2E is finally resolved." The scheduled renames (`mythos_user_id`→`subject_ref`, `mythos_private`→`restricted`) are cross-referenced consistently between `docs/ROADMAP.md` line 283–286, `docs/IDENTITY_ARCHITECTURE.md` §7, and `protocol/schemas/MAPPING.md`'s field-difference table — all three agree the renames are scheduled, not yet executed. |

**Stage 9 summary.** The architectural *decision* (subject-not-credential, W3C-first,
documented-deviation discipline) is solidly PREPARED. Everything downstream of "now actually
issue and verify a VC" — issuance flow, key management, DID method default, SDKs, conformance
— is OPEN by the documents' own admission. This matches the readiness audit's framing exactly:
IDA-7 depends on real authentication (gate A), which is itself unresolved pending an owner
decision (A5).

---

## Stage 10 — Anchoring architecture (IDA-8 preparation)

**Status per `docs/BLOCKCHAIN_ARCHITECTURE.md` header:** "SPECIFIED — NOT IMPLEMENTED. No
chain integration, no wallet, no signing key, no anchoring code and no chain dependency
exists anywhere in this repository." Confirmed structurally, per the IDA-4 architecture
review: OVIP §11 (optional, chain-neutral, no chain/token/vendor in required interfaces,
Record→hash→Merkle batch→single anchor pattern, one-tx-per-event explicitly excluded);
`PRIVACY_ARCHITECTURE.md` §5's absolute prohibitions; the six-condition hard gate at
`BLOCKCHAIN_ARCHITECTURE.md` §8. No schema in `protocol/schemas/` names a chain, token or
vendor — confirmed by direct read of all 14 schema files plus `event.schema.json`; the only
chain-shaped schema is `blockchain-anchor.schema.json`, which is itself chain-neutral by
design (no chain-name enum, no token field).

### The six-condition gate — walked individually, `BLOCKCHAIN_ARCHITECTURE.md` §8

| # | Condition | Current truth |
|---|---|---|
| 1 | Off-host backup operational and restore-tested | **PARTIALLY MET.** Database leg: **CLOSED** 2026-08-14 (`docs/ROADMAP.md` IDA-3F: dump → SHA-256 → upload → fresh download → SHA-256 match → isolated restore, 24 tables/2,551 rows, source-identical; all seven backup-gate conditions MET, `ops/runbooks/OFF_HOST_BACKUP_GATE.md` §6). **NOT fully satisfied**: no recurring schedule exists (the verified batch ages toward staleness — `docs/IDA4_READINESS_AUDIT.md` §F2, 5 days old as of the audit date), and the media store has no verified off-host copy (§F3). `BLOCKCHAIN_ARCHITECTURE.md` §8 condition 1's own text was corrected 2026-08-19 to state this precisely rather than reading as if the whole condition were BLOCKED — this pass confirms that correction is accurate against `docs/ROADMAP.md` and the readiness audit. |
| 2 | Real authentication exists | **NOT MET — BLOCKED.** `docs/IDA4_READINESS_AUDIT.md` §G gate A1: BLOCKED, REQUIRED. Same gate as Stage 9's IDA-2E dependency above; anchoring cannot begin before it any more than IDA-7 can. |
| 3 | Canonical serialisation specified and independently implemented twice | **NOT MET.** `BLOCKCHAIN_ARCHITECTURE.md` §4.1 specifies the *requirements* (deterministic field ordering, explicit type encoding, version tag, unknown-field preservation) but §9's own status table lists "Canonical serialisation | **SPECIFIED**" with no implementation — let alone two independent ones. |
| 4 | Salt store's backup and recovery path tested | **NOT MET.** No salt store exists yet — §4.2 specifies the salting design (`H(salt ‖ canonical_bytes)`, per-record, never published) but nothing generates or stores a salt today; there is nothing to back up or test. `THREAT_MODEL.md` §1 lists "Backups (database + eventual media)" as an asset but does not yet include a salt store, since none exists. |
| 5 | Legal review confirms no personal data can reach an anchor | **NOT MET — LEGAL REVIEW.** `docs/IDA4_READINESS_AUDIT.md` §B.1 item #13: "Confirmation that no personal data can reach an anchor," cited at `BLOCKCHAIN_ARCHITECTURE.md` §8 condition 5 directly, blocking IDA-8, unresolved. |
| 6 | Independent proof verifier exists and is published | **NOT MET.** `BLOCKCHAIN_ARCHITECTURE.md` §9: "Independent verifier | **PLANNED**." `src/blockchain/` is "Empty placeholder." `docs/IDA4_READINESS_AUDIT.md` §D "Verifier security": **BLOCKED**, one of the six hard-gate conditions, none of which (except the partial condition-1 backup) have been met. |

**Gate verdict:** of six conditions, **zero are fully met**; condition 1 is the only one with
material progress (database leg closed), and conditions 2, 3, 4, 5, 6 are each entirely
unmet — not merely incomplete. This is a stricter reading than "gate mostly closed" and is
the accurate one: `BLOCKCHAIN_ARCHITECTURE.md` §8's own final sentence ("Anchoring an
incomplete or unverified record set early is worse than not anchoring") is a live warning,
not a historical note.

**Chain selection.** `BLOCKCHAIN_ARCHITECTURE.md` §6 states criteria (durability, cost, no
speculative-asset requirement, finality, public verifiability, neutrality, energy,
jurisdiction) and explicitly: "No chain is selected... Chain selection | **NOT STARTED**"
(§9). This is deliberate — the document frames chain selection as something to happen "When
IDA-8 is authorised," not before. **OPEN, deliberately**, exactly as the mission brief
anticipates.

**What is anchored / not anchored (§5)** and the **failure-behaviour table (§7)** are both
fully specified design, consistent with `PRIVACY_ARCHITECTURE.md` §5 and OVIP §10.4/§11 —
PREPARED as architecture, unimplemented as code, which is the correct and expected state for
a stage this far ahead of its own gate.

---

## Stage 11 — Open protocol (IDA-9 preparation)

**Status per `docs/ROADMAP.md` line 43:** IDA-9 is **PLANNED** (the least-mature status tag
in the vocabulary — below SPECIFIED). Scope (lines 310–318): protocol v1.0; public RFC
process; multi-jurisdiction plate/document formats; localisation; cross-border passport
continuity; part identity; institutional data-source integration; a second geographic
market.

| Required element | Classification | Citation |
|---|---|---|
| Schemas | **PREPARED** | 14 canonical schemas in `protocol/schemas/` (`anomaly`, `blockchain-anchor`, `evidence`, `fact`, `holder-ref`, `issuer`, `observation`, `ownership-transfer`, `passport`, `plate`, `provenance-envelope`, `tombstone`, `trust-assessment`, `vehicle` — counted by direct `ls`), of which 2 (`holder-ref.schema.json`, `tombstone.schema.json`) were newly introduced at the IDA-4 foundation stage per `docs/ROADMAP.md`'s dated note and `protocol/schemas/MAPPING.md`'s entity table. Matches "14+2 new" exactly. |
| Events | **PARTIAL** | `protocol/events/event.schema.json` exists with an 18-value `event_type` enum and a full provenance/supersession shape — real depth, not a stub. But `protocol/events/README.md` header states plainly: "SPECIFIED, not implemented" — no route or table implements a general `Event` record; `protocol/schemas/MAPPING.md`'s entity table: "`Event` | `idauto_service_events`, `idauto_vehicle_movements` | **Partial.** No general `Event` table; the protocol's vocabulary is broader than what exists." The schema/vocabulary design is genuinely deep; the implementation gap is real and named by the repository's own mapping document. |
| Credentials | **PARTIAL, not README-only** | `protocol/credentials/README.md` is substantially more than a stub: a full example VC, a 7-row credential-type table, DID-method guidance, revocation rules, a deviations table, and an implementation-status table. But it is prose-only — no machine-readable credential JSON Schema exists in `protocol/schemas/` or `protocol/credentials/` the way `event.schema.json` exists for events, and §8's own table marks every substantive row (issuance, verification, DID resolution, archiving, status-list revocation) **SPECIFIED — no implementation**. Calling this OPEN would understate real design depth; calling it PREPARED would overstate machine-readability. PARTIAL is the accurate classification. |
| Verification rules | **PREPARED as design, PARTIAL as implementation** | `protocol/verification/README.md` specifies an 8-step pipeline with real depth (each step independently defined, with its own implementation-status marker). §6's own table: steps 1–4 are IMPLEMENTED for their base case with named SPECIFIED extensions (e.g. step 2's automatic T0 downgrade), steps 5–8 are fully SPECIFIED. This is the strongest-specified document in the open-protocol set — its own header states the status precisely rather than leaving it to be inferred. |
| SDK contracts | **OPEN** | `docs/OPEN_SOURCE_STRATEGY.md` §7: "SDKs | **PLANNED**." §6: "SDKs (JS, Python, PHP) | Every integrator writes their own client." No SDK code, interface contract, or even a language-choice decision exists anywhere in the repository. |
| API contracts (protocol-level) | **OPEN** | The reference implementation's own API (`reference/api.js`) exists and is real, but it is an *implementation* surface, not a *protocol-level* API contract — no OpenAPI/JSON-RPC/GraphQL schema or protocol-level API specification exists in `protocol/`. `docs/OPEN_SOURCE_STRATEGY.md`'s "What is open" table lists "SDKs and API contracts | **PLANNED**" as one combined row, confirming this is recognized as unbuilt, not merely unlisted. |
| Interoperability rules | **PREPARED** | `protocol/README.md` "Design rules these schemas follow" (6 rules: provenance mandatory, server-derived fields marked, confidence≠trust, no personal data, supersession not mutation, W3C-first) plus the "Closed canonical schemas vs. OVIP §13 round-trip preservation" section reconciling `additionalProperties:false` against the round-trip duty. `GOVERNANCE.md` §3's protocol change-class table (editorial/additive/breaking/invariant-touching) is the interoperability-preserving process layer. Both exist with real content, not placeholders. |
| Versioning | **PARTIAL** | `GOVERNANCE.md` §3 and `protocol/README.md` "Versioning" section both specify semantic versioning, deprecation rules, and unknown-field preservation as *policy* — PREPARED as a rule. In practice every schema in `protocol/schemas/` (verified: `vehicle`, `passport`, `issuer`, `event`, etc.) carries `protocol_version: {"const": "0.1.0-draft"}` — a single, pinned, pre-1.0 draft version, not yet exercised through even one minor bump. The vocabularies (`protocol/vocabularies/*.v1.json`) are the one place versioning has actually been exercised (`status: "stable"` at v1, independent of OVIP's own draft status, per `protocol/README.md` "Vocabularies" section) — so versioning is PREPARED as a mechanism and PARTIAL as a demonstrated practice. |
| Governance | **PREPARED** | `GOVERNANCE.md` is a complete document: three-layer separation (protocol/brand/hosted), an honestly-stated "benevolent maintainer" model with a named trigger for change, a full protocol change-process table, 10 numbered invariants, trademark rules, and a conformance statement that explicitly declines to overclaim ("No conformance suite exists yet... any claim of conformance is self-assessed"). This is the most mature document in the entire preparation set for any of these five stages. |
| OVIP §13 extension mechanism | **OPEN, deferred to IDA-9 by design** | `protocol/README.md` "Closed canonical schemas vs. OVIP §13 round-trip preservation (2026-08-19)" section, final paragraph: "A versioned extension mechanism... is an **open protocol question**, deliberately not resolved here... It is deferred to **IDA-9**." This is the exact subsection the mission brief names; confirmed present and confirmed deferred, not silently resolved by flipping `additionalProperties` on. |
| Open-vs-controlled split | **PREPARED** | `docs/OPEN_SOURCE_STRATEGY.md` §3 "What is controlled, and why" names exactly four categories: **private citizen data** (non-negotiable), **security-sensitive fraud detection rules** (categories published, tuned thresholds withheld — with an explicit acknowledgment that "a reader who thinks that is a rationalisation for opacity has a fair point to press"), **commercial analytics**, **hosted service operations**, plus a fifth ("enterprise integrations," bilateral/NDA) named in the same table. This matches the mission brief's expected list (personal data, fraud logic, analytics, hosted services) with one addition (enterprise integrations) beyond what was named to verify — a superset, not a gap. |

**Stage 11 summary.** The specification layer (schemas, verification rules, governance,
interoperability rules, the controlled/open split) is genuinely mature. The ecosystem layer
(SDKs, protocol-level API contracts, a conformance suite, a published JSON-LD context) is
uniformly OPEN, and `docs/OPEN_SOURCE_STRATEGY.md` §6 says so in its own words: "An 'open
protocol' with none of these is a published specification, which is a real but smaller
thing." This pass finds that self-assessment accurate rather than optimistic.

---

## Stage 12 — Part identity

**Status per `docs/PART_IDENTITY.md` header:** "SPECIFIED — future extension. Not
implemented, and not in the MVP. No part table, part identifier or part API exists in this
repository." Target stage IDA-9, with an optional narrow slice at IDA-5.

| Element | Classification | Citation |
|---|---|---|
| Component model (engine/gearbox/battery/etc.) | **PREPARED** | `docs/PART_IDENTITY.md` §1 diagram (Engine, Gearbox, Battery, Turbo, Brakes, Other parts) and §3 `Part` entity table's `category` enum: `engine · gearbox · battery · turbo · brakes · ecu · catalyst · body_panel · other` — a superset of the diagram, real enum depth. |
| Manufacturer/OEM/batch tracking | **PREPARED** | §3 table: `manufacturer` (issuer ref), `oem_reference` (manufacturer part number), `batch_ref` (production batch/lot), `serial_ref` (component serial — explicitly a *Fact* about the part, not its identity, per §4, mirroring the VIN-is-not-identity rule at the vehicle layer). |
| Installation/removal | **PREPARED** | §5 `PartFitment` record: `installed_at`/`installed_by`/`install_evidence`, `removed_at`/`removed_by`/`removal_evidence`, `position`, mileage at both events. Explicit rules: append-only, no two open fitment intervals (contradiction surfaced, never silently resolved), "current parts" is a query over open intervals rather than stored state. |
| Maintenance | **PREPARED** | §6 lifecycle diagram includes a `[ maintained ]*` loop between installed and removed; each transition is its own `Event` with evidence and issuer, reusing vehicle-layer primitives — no parallel machinery, per §3's own statement. |
| Warranty | **PREPARED** | §3 table: `warranty` field ("Terms, start, end, issuer"). |
| Verification | **PREPARED** | §7 capability table ties counterfeit/cloned-part/recall/mileage-cross-check capabilities to the same trust/evidence machinery as the vehicle layer; §8 states fitment records inherit the vehicle's access scopes and privacy governance rather than defining a separate model. |
| Extension-not-blocker principle | **PREPARED** | §2 "Scoping honesty" states three explicit reasons part identity is deliberately excluded from the MVP (data availability, effort, sequencing) and closes: "The specification exists now so that the vehicle-layer data model does not foreclose it. That is its entire present purpose." §10 (final line): "Nothing here is scheduled before IDA-9. The vehicle-layer schema has been checked to ensure that adding parts later is additive, and that check is the deliverable of this document." This is the extension-not-blocker principle stated in the document's own words. |
| Part schema in `protocol/schemas/` | **Confirmed absent, deliberately** | Verified: no `part.schema.json`, `ipid.schema.json`, or `part-fitment.schema.json` exists among the 14 files in `protocol/schemas/` (direct `ls`, cross-checked against `protocol/schemas/MAPPING.md`'s entity table: "`Part`, `PartFitment` | — | **Does not exist.** See `../../docs/PART_IDENTITY.md`."). This matches `docs/PART_IDENTITY.md` §10's own implementation-status table exactly ("`Part` entity | SPECIFIED — no table exists"; "`IPID` | SPECIFIED — no issuance exists"; "`PartFitment` | SPECIFIED — no table exists") and is **OPEN by design**, per the don't-overbuild rule §2 states explicitly — not an oversight. |

**Stage 12 summary.** `docs/PART_IDENTITY.md` is a complete, self-aware specification that
covers every element the mission brief asks to verify, states its own scoping honestly
(§2), and explicitly frames the absence of a schema as the deliverable rather than a gap
(§10's closing line). Classified PREPARED as a specification; correctly and deliberately
OPEN as an implementation.

---

## Summary table

| Stage | Overall | Blocking gates inherited | Top gap |
|---|---|---|---|
| **Stage 8 — IDA-5 issuers** | **PREPARED**, one process gap | None structural — IDA-4's surface is forward-compatible (confirmed). Professional data-sharing legal basis (`IDA4_READINESS_AUDIT.md` §B item #8) gates full deployment, not the design itself. | Issuer onboarding/verification **process** (who verifies a garage is a garage) is undefined anywhere — OPEN, owner/legal. |
| **Stage 9 — IDA-7 VC/DID** | **PARTIAL** | Real authentication — gate A (`IDA4_READINESS_AUDIT.md` §G, BLOCKED, REQUIRED), specifically the A5 owner decision on which auth path IDA-4/IDA-7 takes. | Key management for issuer signing keys is unaddressed by any document (preventive design, not just response-to-compromise). |
| **Stage 10 — IDA-8 anchoring** | **PREPARED** as architecture, **structurally not begun** | All six BLOCKCHAIN_ARCHITECTURE.md §8 gate conditions — auth (gate A again), legal (item #13), off-host backup schedule/media leg. | Five of six gate conditions are entirely unmet, not partially — only condition 1 (backup) has real progress. |
| **Stage 11 — IDA-9 open protocol** | **PARTIAL** | Depends on IDA-5 through IDA-8 substantively existing before "protocol v1.0" is meaningful; no independent blocking gate of its own beyond that sequencing. | SDKs, protocol-level API contracts, JSON-LD context, and conformance suite are uniformly OPEN — "a published specification," per `OPEN_SOURCE_STRATEGY.md`'s own words, "not yet an ecosystem." |
| **Stage 12 — Part identity** | **PREPARED** as specification, **deliberately OPEN** as implementation | None — explicitly designed to have none; sequenced after IDA-5 issuer/garage adoption for the data-availability and effort reasons `PART_IDENTITY.md` §2 states. | Manufacturer/distributor participation (needed for meaningful batch-level recall queries) depends on network effects this repository cannot produce alone. |

---

## What this pass did not do

No code was written or modified. No schema field was added, removed or retyped. No gate in
`docs/IDA4_READINESS_AUDIT.md` or `docs/BLOCKCHAIN_ARCHITECTURE.md` §8 was closed, advanced,
or reinterpreted more favorably than its own evidence supports. No owner decision (A5, chain
selection, issuer-onboarding-process design) was made or implied on the owner's behalf.
