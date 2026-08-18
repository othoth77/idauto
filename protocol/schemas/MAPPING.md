# Protocol ↔ implementation mapping

**Protocol version `0.1.0-draft` · Last updated 2026-08-18**

The protocol schemas in this directory are a **draft specification**. The live PostgreSQL
schema in [`../../database/schema.sql`](../../database/schema.sql) and the reference
implementation in [`../../reference/`](../../reference/) are **what actually runs**, and
they predate the protocol layer.

They implement the same concepts under different names. This table is the bridge. Where they
disagree, `database/schema.sql` describes reality and `protocol/schemas/` describes the
target. Convergence is an IDA-7 task.

---

## Entity mapping

| Protocol entity | Live table | Alignment |
|---|---|---|
| `Vehicle` | `idauto_vehicles` | **Close.** Summary attributes are columns today rather than purely derived from facts. |
| `VehicleID` (IVID) | `idauto_vehicles.internal_ref` `VARCHAR(40) UNIQUE` | **Column exists; format differs.** The formal `ivid:` format is specified, not adopted. |
| `Plate` | `idauto_plates` | **Close.** Interval semantics present. |
| `Observation` | `idauto_observations` | **Aligned.** Observation-first is implemented. |
| `Fact` | `idauto_vehicle_facts` | **Aligned.** `is_active` implements supersession. |
| `Evidence` | `idauto_fact_evidence`, `idauto_observation_media` | **Split across two tables** in the implementation; unified in the protocol. |
| `Document` | `idauto_document_scans` | **Close.** |
| `Event` | `idauto_service_events`, `idauto_vehicle_movements` | **Partial.** No general `Event` table; the protocol's vocabulary is broader than what exists. |
| `Issuer` | `idauto_organizations` (partly) | **Weak.** No DID, no verifiable identity, no authority scope. |
| `Credential` | — | **Does not exist.** |
| `Verification` | `idauto_verifications` | **Different meaning.** Today this is verification history, deliberately *not* a rate-limit counter store; the protocol's `Verification` record is richer. |
| `OwnershipTransfer` | — | **Does not exist.** |
| `TrustAssessment` | `idauto_vehicle_facts.verification_status` + `confidence_score` | **Not equivalent.** No T-level is computed or stored anywhere. |
| `BlockchainAnchor` | — | **Does not exist.** No chain code. |
| `Part`, `PartFitment` | — | **Does not exist.** See [`../../docs/PART_IDENTITY.md`](../../docs/PART_IDENTITY.md). |
| `Anomaly` | — | **Does not exist.** Conflicts are recorded; anomaly detection is not implemented. |

Supporting tables with no protocol counterpart (they are implementation concerns, not
protocol concepts): `idauto_plate_formats`, `idauto_governorates`, `idauto_capture_sources`,
`idauto_camera_sources`, `idauto_contributors`, `idauto_capture_sessions`,
`idauto_submissions`, `idauto_rate_limit_counters`, `idauto_observation_locations`,
`idauto_review_queue`, `idauto_user_roles`, `idauto_consent_records`, `idauto_audit_log`.

---

## Field-level differences worth knowing

| Protocol | Implementation | Note |
|---|---|---|
| `access_scope: "restricted"` | `access_scope = 'mythos_private'` | Same scope, different string. Renaming is a breaking migration on live data with no behavioural benefit; deferred to IDA-7. See [`../../docs/PRIVACY_ARCHITECTURE.md`](../../docs/PRIVACY_ARCHITECTURE.md) §3. |
| `provenance.issuer` (DID) | `validated_by` (`VARCHAR(64)`) | Today an opaque operator identity string, not a DID. |
| `provenance.trust_level` | — | Not stored. Nothing in the running system reports a T-level. |
| `provenance.confidence` | `confidence_score REAL` | Aligned, including the 0.0–1.0 constraint. |
| `provenance.verification_status` | `verification_status VARCHAR(20)` | Aligned; identical vocabulary. |
| `Fact.supersedes` | `is_active BOOLEAN` | Implementation marks supersession without an explicit link to the superseding row. Adding the link is additive. |
| `Vehicle.summary` (derived) | direct columns on `idauto_vehicles` | Implementation stores denormalised summary columns alongside facts. |
| `Evidence.content_hash` | `image_hash` / content-addressed storage key | Aligned in substance: SHA-256 of content, used as the storage key. |
| contributor identity | `mythos_user_id VARCHAR(64)` | An **opaque external identity reference**, not a Mythos-only dependency — any external identity provider can populate it. Renaming to a neutral `subject_ref` is an IDA-7 candidate; it is a breaking migration and is not scheduled. |

---

## What is verified about the live schema

These are test-enforced, not asserted:

- 24 tables, all `idauto_`-prefixed.
- **Zero owner-PII columns on any table.**
- `access_scope` present on `idauto_observation_media` and `idauto_vehicle_facts`.
- Every mutation writes an audit row in the same transaction, or both roll back.
- Restricted-scope facts are excluded from every read path.
- Seven server-derived fields are rejected on submission, one test per field.
