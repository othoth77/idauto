# IDA-4 Legal Review Package

**Date:** 2026-08-19
**Repo state:** branch `gate-closure` @ `24a28dd`.
**Purpose:** an engineering-facts package for qualified legal counsel, covering the system
**as specified** at this commit. It does not offer a legal opinion, does not recommend an
outcome, and does not predict how counsel should rule on any item. Every fact below is cited
to a source document, a schema file, or a protocol schema in this repository. Where a fact is
unspecified in the sources, that is stated plainly — an unspecified fact is itself one of the
16 items tracked in [`docs/IDA4_LEGAL_GATE_MATRIX.md`](IDA4_LEGAL_GATE_MATRIX.md), not
something this package fills in by inference.

**What is and is not implemented today.** Nothing citizen-facing is implemented. The
citizen-facing write path (self-registration, passport creation, holder association,
erasure) does not exist in this repository — it is BLOCKED per
`docs/IDA4_READINESS_AUDIT.md` §H on real authentication and on the legal items this package
supports counsel in reviewing. Community/public capture (`IDA-3G`–`IDA-3I`) is likewise not
publicly exposed.

**On production data.** This does **not** mean no production data exists. The live VPS
deployment's `idauto` database holds **24 tables and 2,551 rows** of operational data
(`docs/AI_HANDOVER.md`, "FINAL VPS INVENTORY RECONCILIATION" and off-host-backup entries,
verified 2026-08-14) — real operational vehicle-identity data, not merely test fixtures sitting
inert. What that operational data is **not**, per the schema's own structural guarantee and
its automated test (`docs/PRIVACY_ARCHITECTURE.md` §1): it contains **zero owner-PII
columns** across every table — "the schema test asserts zero owner-PII columns across all
tables, and it runs in the suite on every change." Contributor identifiers do exist, in
`mythos_user_id` columns (`idauto_contributors.mythos_user_id`, `idauto_user_roles.mythos_user_id`,
`idauto_verifications`/`idauto_audit_log`/`idauto_fact_evidence` references to the same) — an
opaque reference to a Mythos platform user, not a name, email, phone number or national ID.
Whether an opaque user-identifier column is itself "personal data" under applicable law is a
legal question this package does not answer; it states the technical fact (what the column
holds and does not hold) so counsel can apply the legal standard to it.

---

## 1. What IDauto is

IDauto is an open protocol and reference implementation for stating and verifying facts about
a vehicle over its lifetime, letting any citizen create a durable digital passport for a
vehicle they hold without needing a garage, dealer, insurer or authority to sponsor them
(`README.md`). It is evidence-first: every claim carries its source, its evidence, its
observation, a confidence value, a verification status and a timestamp, rather than being
asserted as simply true (`README.md`; `docs/PRODUCT_SPEC.md` §1). It is privacy-separated by
design — the vehicle record and the owner record are different things, and personal data is
architected to never enter the public record or touch a public ledger
(`docs/PRIVACY_ARCHITECTURE.md` §1–§2).

---

## 2. Data inventory

Per-table fields, personal-data status, access scope, and retention as currently specified.
Column lists are drawn from `database/schema.sql`; access scopes and retention citations are
drawn from `docs/PRIVACY_ARCHITECTURE.md`, `docs/CAPTURE_PIPELINE.md` §7 and
`docs/INGESTION_ARCHITECTURE.md` §17.

### Vehicle — `idauto_vehicles`

- **Fields:** `internal_ref`, `make`, `model`, `variant`, `year`, `body_type`, `fuel_type`,
  `colour`, `seats`, `gross_weight_kg`, `engine_cc`, `category_code`, `fiche_status`,
  `first_seen_at`/`last_seen_at`, `observation_count`.
- **Personal data:** None. The table's own comment states "NO owner PII. Enriched from
  observations and facts," and owner fields are deliberately absent.
- **Access scope:** Public vehicle-level attributes (no per-row scope column on this table
  itself — scope is applied at the fact and media level, per `docs/PRIVACY_ARCHITECTURE.md` §3).
- **Retention:** Not addressed as a category of its own in the retention items — vehicle
  history is explicitly meant to be indefinite/non-erasable (`docs/PRIVACY_ARCHITECTURE.md`
  §6: "Vehicle history is not personal data about the vehicle's holder, and erasing it is
  neither required nor desirable").

### Plate — `idauto_plates`

- **Fields:** `plate_number`, `plate_raw`, `format_code`, `governorate_id`, `vehicle_id`,
  `status`, `valid_from`/`valid_until`.
- **Personal data:** None. "NO owner PII. One plate per row" (table comment); no join path
  from a plate to a person exists anywhere in the schema (`docs/PRIVACY_ARCHITECTURE.md` §1).
- **Access scope:** Public (plate number is "the product's core public identifier",
  `docs/INGESTION_ARCHITECTURE.md` §9).
- **Retention:** Unspecified — this is item L07 in the gate matrix.

### Observation — `idauto_observations`

- **Fields:** `vehicle_id`, `plate_id`, `capture_source_id`, `capture_session_id`,
  `camera_source_id`, `contributor_id`, `capture_method`, `capture_time`, `plate_candidate`,
  `plate_normalised`, `ocr_confidence`, `direction`, `status`, `rejected_reason`, `ip_hash`.
- **Personal data:** `ip_hash` is a SHA-256 hash, never a raw IP; `contributor_id` is an
  internal foreign key, never exposed publicly (`docs/PRIVACY_ARCHITECTURE.md` §3, "never
  exposed" row). `capture_time` is exact and always `mythos_private`.
- **Access scope:** Row is `mythos_private`/restricted in its exact-timestamp and location
  aspects by design; the observation record itself is internal provenance, not directly
  public.
- **Retention:** Unspecified for the observation row itself; media and facts derived from it
  have their own retention items (L07).

### Fact — `idauto_vehicle_facts`

- **Fields:** `vehicle_id`, `fact_key`, `fact_value`, `fact_value_normalized`, `source_id`,
  `observation_id`, `confidence_score`, `verification_status`, `access_scope`, `is_active`,
  `first_seen_at`/`last_seen_at`, `validated_by`/`validated_at`.
- **Personal data:** None — table comment: "VIN is `mythos_private` scope. No owner PII." VIN
  is stored here but scoped restricted, never accepted from anonymous sources
  (`docs/INGESTION_ARCHITECTURE.md` §9).
- **Access scope:** `access_scope` column, one of `public` / `professional` / `mythos_private`
  — default `public`, but community-submitted facts are written `mythos_private` while
  `pending_review` and only flip to `public` on reviewer acceptance (binding rule,
  `docs/INGESTION_ARCHITECTURE.md` §14.2).
- **Retention:** Old fact values are never overwritten — "old values retained on update"
  (table comment) — this is a permanent historical record by design, not a category with an
  expiry.

### Evidence/media — `idauto_observation_media`, `idauto_fact_evidence`, `idauto_document_scans`

- **Fields (`idauto_observation_media`):** `observation_id`, `derived_from_media_id`,
  `media_type`, `object_key`, `mime_type`, `width_px`/`height_px`, `file_size_bytes`,
  `image_hash`, `access_scope`, `blurred`, `retention_status`, `accessed_count`,
  `last_accessed_at`.
- **Fields (`idauto_document_scans`):** `observation_id`, `vehicle_id`, `document_type`,
  `media_id`, `ocr_raw_ref`, `extraction_status`, `submitter_confirmed`, `consent_declared`,
  `has_owner_pii` (boolean flag only), `pii_handled`, `technical_fields_extracted`.
- **Personal data:** Original images may contain faces, bystanders, locations and addresses
  incidentally (`docs/INGESTION_ARCHITECTURE.md` §9). Carte grise scans may incidentally
  contain owner PII within the document image itself, but no owner-PII **field** is ever
  written to a database column — `idauto_document_scans` has `has_owner_pii` as a boolean
  detector flag and `pii_handled` as a routing-status flag, never the PII itself
  (`docs/CAPTURE_PIPELINE.md` §5 step 8; table comment: "owner name, CIN, address never
  stored in any column here").
- **Access scope:** Media defaults to `mythos_private` (`docs/INGESTION_ARCHITECTURE.md` §9);
  carte grise originals specifically: super-admin-only access (`docs/CAPTURE_PIPELINE.md` §5
  step 6).
- **Retention:** Unspecified — this is item L07 (general) and part of L04 (carte grise
  specifically); `docs/CAPTURE_PIPELINE.md` §7.1 states outright: "All media retention
  periods are LEGAL-REVIEW-REQUIRED. No retention periods are specified in this document."

### Submission — `idauto_submissions`

- **Fields:** `idempotency_key`, `actor_ref`, `actor_type`, `capture_source_id`, `ip_hash`,
  `received_at`, `status`, `observation_id`.
- **Personal data:** `actor_ref` is `NULL` for anonymous submitters by design — "Anonymous
  submitters get NO canonical user ID and NO contributor row" (`docs/INGESTION_ARCHITECTURE.md`
  §5). `ip_hash` is a hash only.
- **Access scope:** Internal envelope, not exposed in API responses.
- **Retention:** Anonymous submissions: "Same as rejected [media]" per
  `docs/INGESTION_ARCHITECTURE.md` §17 — itself `LEGAL-REVIEW-REQUIRED` (L07).

### Audit log — `idauto_audit_log`

- **Fields:** `event_time`, `event_type`, `actor_type`, `actor_ref`, `org_id`, `target_type`,
  `target_ref`, `change_summary`, `old_value_json`/`new_value_json`, `ip_hash`, `request_id`.
- **Personal data:** None by column design — "raw IP, name, address, owner fields absent"
  (table comment). `actor_ref` is an opaque reference.
- **Access scope:** Operator-only/restricted in practice; written atomically with every
  mutation (`docs/ARCHITECTURE.md` AD-4).
- **Retention:** "**Never deleted** — append-only by design" (`docs/INGESTION_ARCHITECTURE.md`
  §17) — the one category with an explicit, non-legal-review-gated retention answer: indefinite.

### Contributor — `idauto_contributors`

- **Fields:** `mythos_user_id`, `trust_score`, `total_submissions`, `accepted_submissions`,
  `rejected_submissions`, `blocked`, `blocked_at`, `blocked_reason`.
- **Personal data:** `mythos_user_id` is an opaque Mythos platform user reference — table
  comment: "Public contributor accounts. NO raw PII... name/email not stored; resolved via
  Mythos OS auth at runtime."
- **Access scope:** Contributor identity is never exposed in a public response
  (`docs/PRIVACY_ARCHITECTURE.md` §3); trust/submission counters are internal signals.
- **Retention:** "Deleted user account | Contributor row anonymised (`mythos_user_id`
  tombstoned); submitted evidence **retained** as it is about a vehicle, not the person" —
  itself `LEGAL-REVIEW-REQUIRED` (`docs/INGESTION_ARCHITECTURE.md` §17; part of L06/L07).

### User roles — `idauto_user_roles`

- **Fields:** `mythos_user_id`, `org_id`, `role`, `status`, `granted_at`/`granted_by`,
  `revoked_at`/`revoked_by`.
- **Personal data:** `mythos_user_id` only, same opaque-reference status as above — "No raw
  PII" (table comment); name/email resolved from Mythos OS auth at runtime, never stored here.
- **Access scope:** Internal role-assignment record.
- **Retention:** Unspecified.

---

## 3. Data flows

**Ingestion** (`docs/INGESTION_ARCHITECTURE.md` §1, §5, §7, §9). Who may submit in v1: admin
(operator token), authenticated Mythos user (gated on real auth, not built), verified
contributor, and anonymous (last, strictest limits). Professional and automated-service
submission are deferred. What may be submitted: plate string, observation metadata, 0–N
images (bounded), restricted-key attribute assertions. GPS/location and free-text notes are
explicitly out of v1. **Consent posture as specified:** the submission JSON contract includes
a client-supplied `consent: true` boolean field (`docs/INGESTION_ARCHITECTURE.md` §12), and
`idauto_capture_sources.requires_consent`/`legal_basis` columns exist and are seeded for
`PUBLIC_UPLOAD`, but the formal consent **mechanism** (what the consent text says, how
withdrawal works, what "consent" legally requires here) is specified, not legally reviewed,
and no public ingestion route exists to exercise it yet — this is item L05.

**Review queue** (`docs/INGESTION_ARCHITECTURE.md` §6; `docs/CAPTURE_PIPELINE.md` §8). Nine
`observations.status` values route submissions through `pending_review` /
`pending_confirmation` queues; admin submissions auto-accept, everything else requires human
review — "no auto-accept for any non-admin source in v1" is a stated decision. Reviewers see
full evidence including `mythos_private` fields; non-admin API responses exclude
`mythos_private` fields identically to existing behaviour.

**Media storage** (`docs/INGESTION_ARCHITECTURE.md` §10; `docs/CAPTURE_PIPELINE.md` §7.1).
Content-addressed: object-storage keys are derived from a computed SHA-256 hash, never from
caller input, which is also the stated path-traversal mitigation. **EXIF handling, as
specified:** EXIF is stripped before hashing and storage — "the one image operation v1
performs... a container-level strip (parse and drop metadata segments without decoding
pixels), not a re-encode." GPS EXIF, device serials and timestamps are the explicit reason
given for stripping. No image decoding happens in v1 at all (deliberately, to avoid decoder
exploit surface); dimension limits are not enforced because enforcing them would require
decoding.

**Off-host backup** (`ops/runbooks/OFF_HOST_BACKUP_GATE.md` §6; `docs/AI_HANDOVER.md`). What
leaves the host: a `pg_dump -Fc` of the PostgreSQL database (for `idauto`: 24 tables / 2,551
rows). Where: a Cloudflare R2 bucket (`mythos-offhost-backups`), reached over an
SigV4-signed, HTTPS-only transport (`ops/adapters/s3-compatible.js`;
`ops/runbooks/OFF_HOST_BACKUP_GATE.md` §1). This supersedes an earlier rsync/scp-to-a-second-host
design recorded in `docs/INGESTION_ARCHITECTURE.md` §11 (dated 2026-08-12) — the R2 destination
is what was actually executed and gate-closed on 2026-08-14. **Encrypted?** In transit: yes —
HTTPS-only endpoints are enforced by the adapter. At rest: the runbook does not itself state an
at-rest encryption guarantee beyond what the R2 destination provides by default; this package
does not assert an at-rest encryption claim beyond what is written in the runbook. The
database backup gate is CLOSED (all 7 conditions met, 2026-08-14); the **media store** has no
verified off-host copy — `SECURITY.md` and the readiness audit both record this as open
(`docs/IDA4_READINESS_AUDIT.md` §F3).

---

## 4. Public/private visibility

The `access_scope` mechanism (`docs/PRIVACY_ARCHITECTURE.md` §3) has three values, enforced
at query level and test-enforced: **public** (any caller within rate limits — permitted
vehicle-level attributes only), **professional** (verified professional subscribers — approved
technical data plus their own service events; one organisation never sees another's private
data), and **restricted** (operator-only; raw captures, exact timestamps, GPS, OCR, source
identity, correction history — every access is meant to be audit-logged, though audit-on-read
itself is not yet built, per §9 of the same document). The stored column value is literally
`mythos_private` (inherited naming from the Mythos monorepo); documentation and the protocol
layer call the same scope `restricted`.

**What the public passport/QR exposes.** Per `protocol/schemas/passport.schema.json`: "Every
passport has an IDauto QR representation. The QR encodes a resolvable **IVID reference
ONLY** — never personal data, and never a bearer token that would grant access to a restricted
view." The schema constrains this structurally: `qr.resolves_to_scope` is a JSON Schema
`const`/`enum` fixed to `"public"` — a QR cannot be authored, even accidentally, to resolve to
a professional or restricted view. This is verified by `tests/ida4-foundation-test.js`,
whose passing suite (see §9 below) includes assertions that `qr.payload` never contains a
`Bearer` substring and never matches a dot-separated base64 JWT shape.

---

## 5. Consent & rights mechanics

| Mechanism | Specified? | Implemented? |
|---|---|---|
| Consent capture | Yes — `idauto_consent_records` table (`subject_type`, `processing_purpose`, `legal_basis`, `consent_given`, `consent_version`, `withdrawn_at`, `expires_at`) | Schema only; the consent *flow* (UI, text, versioning process) is SPECIFIED, not built (`docs/PRIVACY_ARCHITECTURE.md` §9) |
| Correction | Design principle stated (facts are never overwritten, only superseded — `idauto_vehicle_facts.is_active`) | Not built as a citizen-initiated *request* mechanism |
| Deletion / erasure | Yes — tombstone design: erasing a person removes the person record and holder association, leaves the vehicle record untouched, and creates a `Tombstone` recording legal basis and date (`docs/PRIVACY_ARCHITECTURE.md` §6; `protocol/schemas/tombstone.schema.json`) | **Specified, not implemented** — no erasure code path, no tombstone-table population exists in the reference implementation (`docs/IDA4_READINESS_AUDIT.md` §C) |
| Data subject access | Not addressed in any document read for this package | Not specified, not implemented |

---

## 6. Per-topic fact sheets

Each block maps to the corresponding matrix ID in
[`docs/IDA4_LEGAL_GATE_MATRIX.md`](IDA4_LEGAL_GATE_MATRIX.md).

**GPS collection (L02).** Not collected in v1. `idauto_observation_locations` exists as a
schema (`latitude`, `longitude`, `accuracy_m`, `location_method`, `governorate_id`,
`location_label`) but is unpopulated by any current code path. Reason given:
"location plus timestamp plus plate is a movement-tracking dataset" (`docs/INGESTION_ARCHITECTURE.md`
§9). Individual movement history is a stated permanent exclusion regardless of scope tier
(`docs/PRIVACY_ARCHITECTURE.md` §8).

**Plate data & public lookup (L03).** Plate is the product's core public identifier. No owner
join exists from a plate anywhere in the schema. `idauto_verifications` logs every lookup
event (hashed IP, no raw PII) and is the rate-limiting data source for lookups.

**Registration-certificate OCR (L04).** Dual-language (Arabic/French) OCR extracts both
technical fields (stored) and owner PII fields (never stored — used only to populate an
on-screen confirmation form, then discarded or routed to `fixpert.clients` if a Fixpert
workflow applies). Public carte grise contribution requires an explicit ownership-or-consent
declaration in the specified flow (`docs/CAPTURE_PIPELINE.md` §5 step 9).

**ANPR (L10).** Fixpert Smart Gate: one designated entrance/exit camera of five on the
premises is in scope; the other four are entirely outside the integration. Event-based
capture only, no continuous recording. No live camera connection exists in this repository
today.

**Cameras/video (L11, L12).** Smart Gate data stored (all `mythos_private`): camera source
reference, direction, exact timestamp, plate candidate/normalised, OCR confidence, colour and
category with confidence scores, image references, validation status
(`docs/FIXPERT_INTEGRATION.md` §4). Never published: exact timestamp, exact location,
individual movement patterns, camera identity, image frames, OCR confidence details (§5 of
the same document).

**Professional issuer data sharing (L08).** `idauto_service_events.is_public` controls
cross-organisation visibility of professional service annotations; default is not public. No
customer PII crosses from `fixpert` into `idauto` schema at any point
(`docs/FIXPERT_INTEGRATION.md` §6–§7).

**Cross-border transfer (L15).** No cross-border processing is implemented today. The
question is raised both generally (`docs/ROADMAP.md`, gating `IDA-9`) and specifically for
Smart Gate/Fixpert data (`docs/FIXPERT_INTEGRATION.md` §10, gating `IDA-6`) — the readiness
audit records this as an unresolved discrepancy in stage attribution, not a resolved question.

**Anchoring — what would/would not go on-chain (L13).** Absolute rule, stated without
exception: "personal data never goes on a public blockchain. No exception, no configuration
flag, no enterprise tier" (`docs/PRIVACY_ARCHITECTURE.md` §5). An anchor MUST NOT contain any
payload (plaintext or encrypted), any identifier that resolves to a person, any hash of a
low-entropy personal value (a hash of a plate, phone number or national ID is explicitly
named as "a lookup table with extra steps, not a pseudonym"), or any per-person/per-vehicle
pattern that reveals activity through timing. What an anchor **does** contain: a Merkle root
over a batch of record hashes, each salted with a per-record secret that is never published.
No anchoring code exists in this repository (`src/blockchain/` is an empty placeholder,
`docs/ROADMAP.md` IDA-8 section).

**Official data sources (L14).** No official-source integration exists. `official_import` is
a defined `capture_method` value in `idauto_observations` with no current code path writing
it.

**Owner-identity processing (L16).** The narrowest and most general of the 16 items: whether
owner identity may be processed **internally at all**, independent of publication. Currently
the only place owner identity is even momentarily processed is the carte grise OCR flow
(L04), where it exists in memory only, never in a database column.

---

## 7. What engineering needs back

For each of the 16 items in `docs/IDA4_LEGAL_GATE_MATRIX.md`, counsel's answer takes one of
three forms, and gets recorded in the matrix's own **Evidence** column against that item's
row — never inferred, never bulk-applied across items, and never entered by engineering
without an actual citable answer behind it:

1. **Approve** — the described processing is permitted as specified. Record: counsel name/firm,
   date, and a reference to the memo or written opinion. Matrix status moves `OPEN` →
   `APPROVED`.
2. **Approve with conditions** — permitted, but only if specific conditions are met (e.g. a
   named retention period, a specific consent-text requirement, a notification threshold).
   Record: the same evidence plus the condition(s) verbatim, since engineering must build
   against the condition, not just the headline approval. Matrix status moves `OPEN` →
   `APPROVED`, with the condition(s) stated in the Evidence column so the constraint travels
   with the approval.
3. **Reject** — the described processing is not permitted as specified. Record: counsel
   name/firm, date, reference, and — where counsel is able to say — what would need to change
   for a future review to succeed. Matrix status moves `OPEN` → `REJECTED`, and the matrix's
   own "Engineering consequence" field for that item states what happens next (feature
   removed or redesigned).

Two items (`L06` and `L09`) additionally carry an **OWNER_DECISION** flag in the matrix —
these require the project owner to make a choice or author a policy *before* counsel has a
concrete artefact to review at all. That precondition is the owner's to clear, not counsel's;
it is recorded separately from the legal review itself so the two responsibilities are never
conflated.
