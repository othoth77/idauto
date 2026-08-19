# Threat Model

**Version: 1** · **Written:** 2026-08-19, branch `ida4-foundation`, IDA-4 gate-free
foundation subset. **Review cadence:** re-reviewed at the start of every stage that adds a
new reachable surface (a new route, a new write path, a new actor class), and at minimum
once per quarter regardless. The next scheduled review is at whichever comes first of
IDA-5 (professional issuers — a new actor class) or 2026-11-19.

**Status.** `docs/IDA4_READINESS_AUDIT.md` §D1 found: "No standalone, system-wide threat
model document exists anywhere in this repository... the one threat-model artifact that
exists is real and well-evidenced for its narrow scope (ingestion abuse); the system-wide
gap (auth, infra, verifier, insider) is unaddressed." This document is that gap being
closed. It does not replace `docs/INGESTION_ARCHITECTURE.md` §8 (the community-ingestion
abuse table) — that table is incorporated by reference in §4 below, not duplicated, because
it is already correct and test-adjacent for its scope.

**Method and honesty constraint.** This document describes what exists today and what is
explicitly planned, grounded in the other documents in this repository. It does not invent
mitigations that are not built, and every entry below is marked **EXISTING**, **PLANNED**,
or **BLOCKED** so a reader never has to guess which. Where a control is designed but not
built, it says so in the same breath as describing the design — never implying by omission
that something exists which does not.

---

## 1. Assets

What this system protects, in descending order of how badly a compromise would hurt:

| Asset | Why it matters |
|---|---|
| Vehicle history integrity | The entire product's value proposition is "this record has not been silently rewritten." A successful tamper — even one record — is an existential trust failure, not an incident. |
| Person data (person store, holder associations, consent records) | Real individuals' PII. A breach here is a legal and human-harm event, not just a technical one. |
| Evidence/media store | Photographs, document scans, registration certificates. Content-addressed and, for document scans, restricted-scope — a leak exposes both vehicle detail and, for carte grise scans, owner PII incidentally captured on the document. |
| Audit log | The only record of who did what. If this can be forged or gapped, every other control's evidence trail is unreliable — see §6, "Audit spoofing." |
| Admin bearer tokens (`IDAUTO_ADMIN_IDENTITIES`) | The entire write surface today authenticates against a static map of these. Their compromise is total operator-level compromise (see §3, "Admin-gated API"). |
| Backups (database + eventual media) | The only recovery path after data loss or a successful tamper. `docs/IDA4_READINESS_AUDIT.md` §F: database backup is READY (one verified batch, 2026-08-14); media backup is TECHNICAL DEBT (none verified). |
| Protocol artifacts and pins (`protocol/vocabularies/*.json`, schema `$id`s) | Downstream consumers pin these by SHA-256 (`protocol/README.md` "Consumer rule"). A silent artifact drift breaks every pinned consumer at once. |
| IVID/holder-ref namespace | The identifier space itself — collision or predictability would let an attacker forge references that look legitimate. |
| Operator/deployment trust | The Tunisian pilot deployment's institutional credibility. Not a technical asset, but the one a security failure spends fastest and recovers slowest. |

---

## 2. Actors / adversaries

| Actor | Motivation | Capability today |
|---|---|---|
| Fraudulent seller | Hide adverse vehicle history (accident, odometer rollback, salvage title) from a buyer | Can submit public data once ingestion opens (BLOCKED today, §5); can attempt social engineering against an operator |
| Odometer-fraud actor | Roll back or omit mileage records to inflate resale value | Same as above; specifically targets the mileage-regression detector once it exists (IDA-6, not built) |
| Document forger | Produce a convincing fake registration certificate, invoice, or inspection report | Limited today — no public document-upload path exists yet; will gain reach once IDA-3G/IDA-6 document flows open |
| Plate cloner | Duplicate a legitimate plate onto a different (often stolen) vehicle | Constrained by plate-format validation (`reference/plate-validator.js`) and observation-first capture, but format validation alone does not detect cloning — see §6, transfer fraud |
| Malicious contributor | Flood, spam, or poison the ingestion pipeline with fabricated data | Directly covered by `docs/INGESTION_ARCHITECTURE.md` §8, incorporated by reference in §4 |
| Compromised professional issuer | An onboarded issuer's credentials are stolen, or the issuer itself turns malicious, and signs false attestations | No issuer registry exists yet (IDA-5, not built) — this actor has no current attack surface, but the trust model's response (retroactive reassessment, `docs/TRUST_MODEL.md` §3) is already specified for when it does |
| Insider / super-admin | An operator with admin bearer-token access abuses or is coerced into abusing that access | Highest-capability actor that exists TODAY. `docs/IDA4_READINESS_AUDIT.md` §B item #9: super-admin access governance policy is **LEGAL-REVIEW-REQUIRED and unresolved** |
| Scraper / enumerator | Harvest the full public dataset, or enumerate identifiers to map coverage | Constrained by opaque `internal_ref`/IVID identifiers (not sequential, not guessable) and by the write-only shape of most current endpoints; a future public read API (not yet built) would need its own rate-limiting design |

---

## 3. Attack surfaces — what EXISTS today

| Surface | Description | Primary risks |
|---|---|---|
| **Admin-gated API** (`reference/api.js`, `reference/writes.js`) | Every write and every restricted read requires a token resolvable by `reference/identity.js`'s static admin map. `docs/IDA4_READINESS_AUDIT.md` §A: this is explicitly **not authentication** — no session, no per-user credential, no MFA, no expiry, no revocation procedure. | Token leakage (mitigated: tokens never logged, per `SECURITY.md`); no revocation path if a token is compromised short of rotating the whole map; every admin token carries equal, total privilege — no least-privilege tiering exists |
| **Ingestion pipeline** (`reference/ingestion.js`) + **§8 abuse table** | Community-submission surface. `docs/INGESTION_ARCHITECTURE.md` §8 is incorporated by reference here in full — see §4 below for the reconciled summary. | Spam, fabricated data, image flooding, replay, path traversal (already mitigated by content-addressing), privilege escalation via spoofed fields (already mitigated, 7 server-derived fields rejected with tests) |
| **Media store** (`reference/storage.js`) | Content-addressed local object storage. | Path traversal (mitigated — paths derive from computed hash, never caller input); denial-of-storage via upload flooding (rate-limited at IDA-3C, byte quotas partial per the §8 table); no off-host backup of media yet (`docs/IDA4_READINESS_AUDIT.md` §F3) |
| **Audit log** (`idauto_audit_log`, `withAudit()` transaction wrapper) | Every mutation writes an audit row in the same transaction as the mutation, or both roll back (`docs/ARCHITECTURE.md` AD-4). | Audit spoofing is mitigated (`actor_ref` set server-side from resolved identity, never client-supplied); **no audit-on-read** exists (`SECURITY.md` L102-113) — restricted-data access is currently controlled by exclusion-from-query, not by logged-and-reviewed access, which is a materially weaker control against an insider who has legitimate query access |
| **Backups** (`ops/offhost-backup.js`, `ops/media-ops.js`) | Database backup gate CLOSED 2026-08-14 (§8 below), restore-tested in an isolated `--network none` container. | No recurring schedule (batch ages toward staleness, currently 5 days old per the readiness audit); media has no verified off-host copy; live-path recovery has never been drilled, only isolated-container restore |
| **Protocol artifacts and pins** (`protocol/vocabularies/*.json`, `protocol/schemas/*.json`) | Versioned, digest-pinned data documents consumed by downstream systems (e.g. `mythos-prod`'s identity-core contract test). | Artifact drift from the live schema is caught by `tests/identity-conformance-test.js`, which runs on every change — this is a real, test-enforced mitigation, not aspirational. A supply-chain-style attack (a malicious edit to a vocabulary file that a downstream consumer pins by digest) would be caught by the digest mismatch on the consumer side, PROVIDED the consumer actually verifies the digest before trusting the file — this repository cannot enforce that a downstream consumer does so |

---

## 4. Attack surfaces — reconciled with `docs/INGESTION_ARCHITECTURE.md` §8

The ingestion abuse table (22 rows: spam flood, fake plates, fabricated data, image
flooding, oversized payload, malicious MIME, path traversal, crafted JSON, duplicate
flooding, replay, bot submissions, endpoint scraping, probing private data, enumeration,
privilege escalation, audit spoofing, token leakage, CSRF, XSS via metadata, malformed EXIF,
image decoder exploit, denial of storage, legal/privacy complaint) is **not reproduced row
by row here** — that would create two documents that can silently drift apart. It is
incorporated by reference as this threat model's ingestion-specific section. What that
table does **not** cover, stated as plainly as `docs/IDA4_READINESS_AUDIT.md` §D1 states it:
**authentication bypass, infrastructure/network threats, insider risk, supply-chain risk, and
verifier security.** Those five gaps are covered in §5-§8 of this document.

---

## 5. Attack surfaces — PLANNED (not yet reachable)

Marked PLANNED because no route, table, or code path exists for them yet. Listed because a
threat model that only covers what exists today would go stale the moment the first of
these ships, and because designing the mitigation before the surface opens is cheaper than
retrofitting it after.

| Planned surface | What it will introduce | Threat model implication |
|---|---|---|
| **Citizen registration** | Real per-person accounts, the first actor class beyond "admin" and "anonymous contributor" | Requires real authentication (`docs/IDA4_READINESS_AUDIT.md` §A — BLOCKED). Introduces account-takeover and multi-account (Sybil) fraud as live threats for the first time — `docs/IDA4_READINESS_AUDIT.md` §D2: "no citizen-specific abuse model... because no real accounts exist yet to abuse." This document does not invent one prematurely; it names the gap as a precondition of the surface opening, not a detail to sort out after |
| **Ownership transfer** | Citizen-initiated `OwnershipTransfer` records | Full fraud model in §6 below |
| **QR resolution** | A public endpoint resolving a passport's `qr.payload` (the IVID) to a public-scope passport view | Enumeration risk if resolution is unauthenticated and IVIDs are treated as guessable — they are not (80 bits of entropy, `reference/ivid.js`), but the RESOLUTION ENDPOINT itself, once built, needs its own rate-limiting design independent of the identifier's unguessability, since rate-limit-free resolution would let an attacker distinguish "exists" from "does not exist" at volume even without ever guessing a valid one. **IMPLEMENTED — IDA-4 Option C, A5 OPTION C, 2026-08-19** (see below) |

**Implementation note (IDA-4 Option C, `ida4-option-c` branch, not yet merged/deployed —
`docs/IDA4_READINESS_AUDIT.md` §J).** The four controls this row's threat implication names
are now real code, not only planned:

- **Format gate before any database touch:** `reference/api.js`, `handlePublicPassportRoute()`
  (~line 245) calls `reference/ivid.js`'s `validate()` (~line 270) BEFORE any `db.query()` in
  the function — a malformed IVID never reaches the database, and gets the identical 404
  shape an unknown-but-valid IVID gets, so response shape alone cannot distinguish the two
  cases. `tests/ida4-option-c-test.js` §5 spies on `db.query` and asserts a call count of
  exactly zero for a malformed IVID.
- **Rate limiting, this route's own bucket:** `reference/api.js`'s `enforcePublicResolutionLimit()`
  (~line 210) reuses `reference/rate-limit.js`'s `bucketKey()`/`atomicStatement` primitives
  with dimension `public_resolution:window` — a bucket no other route's rate limiting ever
  writes to — configured via `config/idauto.example.json`'s `public_resolution` section.
  `tests/ida4-option-c-test.js` §7 proves burst -> 429 with `Retry-After`, then recovery
  after the configured window, in an isolated child process.
- **Identical 404s:** confirmed directly by `tests/ida4-option-c-test.js` §4/§5/§6 — a
  well-formed unissued IVID, a malformed IVID, and a plate-shaped path segment all return
  the same `{"error":"not found"}` shape.
- **No plate path:** `reference/api.js` looks up `WHERE ivid = $1` only (~line 291); no route
  under `/public/` accepts a plate value, and a `?plate=` query parameter is never read by
  the handler at all (the query string is never parsed). `tests/ida4-option-c-test.js` §6
  covers a plate-shaped path segment, `/public/plate/...`, and an ignored `?plate=` parameter.

This implementation note does not change this table's PLANNED marking for **Citizen
registration**, **Ownership transfer**, or **Anchoring** — none of those three exist yet, and
Option C deliberately does not touch any of them.
| **Anchoring** | Blockchain commitment of Merkle-batched record hashes | `docs/BLOCKCHAIN_ARCHITECTURE.md` §8's six-condition implementation gate is the threat-relevant control here: anchoring an incomplete or unverified record set early "produces permanent, publicly checkable evidence of a system that was not ready." Independent verifier security (§8 below) is one of the six gate conditions and is itself BLOCKED |

---

## 6. Ownership-transfer fraud model (audit items D1 + D3)

`docs/IDA4_READINESS_AUDIT.md` §D3: "No document defines a fraud model for citizen
passports specifically (false ownership claims, holder-association fraud, transfer fraud)...
**Classification: BLOCKED** — not specified, let alone implemented." This section is that
missing fraud model. It documents fraud scenarios against the `OwnershipTransfer` design
(`protocol/schemas/ownership-transfer.schema.json`, `docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md`
§9.3), and for each: what the append-only + bitemporal + `supersedes` design structurally
prevents, versus what still needs a runtime control that does not exist yet.

**AI boundary, stated once here and binding throughout this section:** per
`docs/TRUST_MODEL.md` and `docs/ROADMAP.md`'s IDA-6 bounds, any automated detection of a
scenario below routes to human review as an `Anomaly` (`protocol/schemas/anomaly.schema.json`)
worded to describe the observation, never a conclusion. **AI never declares fraud, never
asserts legal guilt, never raises or lowers a trust level unilaterally, and is never the
sole basis for an adverse decision about a person.** Every "detection" mentioned below means
"routes to review," not "blocks" or "reverses" anything automatically.

| Scenario | Structurally prevented by the design | Needs a runtime control (status) |
|---|---|---|
| **Stolen-vehicle laundering** — transferring a stolen vehicle's record to a new holder to obscure its origin | The vehicle's history (Facts, prior transfers, Observations) survives the transfer intact and is never deletable (OVIP §9.3, §4). A launderer cannot make prior history disappear by transferring. | Cross-referencing against a stolen-vehicle registry to flag a transfer at write time — **PLANNED, not built**; no such registry integration exists or is designed yet. Until it exists, a stolen vehicle's laundering is only detectable after the fact by a human reviewer noticing an inconsistency, not prevented at the transfer itself |
| **Coerced transfer** — a holder is pressured or defrauded into transferring against their real interest | Not a data-integrity problem the append-only model can address — coercion is a fact about the circumstances of consent, invisible to the record itself. The design's contribution is narrower: the transfer, once recorded, cannot be silently hidden or retroactively altered by either party, so a later dispute has an intact record to examine. | A reporting/dispute mechanism for a holder to flag a transfer as coerced — **BLOCKED**, downstream of real authentication (§A) and the unresolved legal basis for correction/deletion rights (`docs/IDA4_READINESS_AUDIT.md` §B item #6). No such mechanism can be built responsibly before a real identity exists to attach the report to and a legal basis exists for what happens next |
| **Fake seller** — someone with no actual right to the vehicle initiates a transfer as if they were the current holder | The `OwnershipTransfer` schema references holders by opaque `from_holder_ref`/`to_holder_ref` (pseudonymous, non-resolving to an ordinary caller) — this protects PRIVACY, not authorization; it does **not** by itself verify that the caller initiating a transfer IS the referenced holder. | Authorization that the initiating caller actually controls `from_holder_ref` — **BLOCKED**, this is exactly the authorization-model gap `docs/IDA4_READINESS_AUDIT.md` §A2 names ("Authorisation beyond a role comparison | NOT STARTED"). A transfer write path cannot respond meaningfully to "is this really the holder" until both real authentication and an authorization model exist |
| **Replay** — resubmitting a previously valid transfer request to create a duplicate or out-of-sequence record | Every `OwnershipTransfer` carries its own `id`, `effective_at`, and `recorded_at`; a duplicate submission with the same content would be a second, distinguishable record, not a silent double-application, because nothing here supports in-place update — replay cannot overwrite the original. | Idempotency-key handling at the write endpoint to reject an exact-duplicate submission outright rather than merely recording it twice — **PLANNED**, named as a general ingestion gap in `docs/INGESTION_ARCHITECTURE.md` §8's "Replay" row ("idempotency key" listed as missing, fixed-in IDA-3B) but not yet extended to a transfer-specific write path, since that path does not exist yet |
| **Backdated `effective_at` abuse** — setting a transfer's `effective_at` to a date before an adverse event, to make it appear the current holder wasn't responsible (or was) at the relevant time | `recorded_at` is separate from `effective_at` and (per the provenance-envelope pattern used throughout OVIP) `asserted_at`/`recorded_at`-shaped fields are the kind of field this protocol marks server-derived elsewhere — a written record always shows BOTH the claimed effective date and the actual recording time, so a backdated claim is visible as a claim, not silently absorbed as fact. Superseding a wrong `effective_at` (via `supersedes`, this stage's schema addition — §1.c) never destroys the original claim; both remain visible. | Automated plausibility checking (e.g. an `effective_at` implausibly far before `recorded_at`, or conflicting with an intervening recorded Fact/Event) is an `Anomaly`-detector class (`chronology_conflict` already exists in `anomaly.schema.json`'s enum) — **SPECIFIED, not implemented** (IDA-6, `docs/TRUST_MODEL.md` §8) |
| **Supersession abuse** — using the newly-added `supersedes` field itself to bury a legitimate transfer under a fabricated "correction" | Supersession never deletes: the superseded record "MUST remain retrievable" (OVIP §4 item 3), and this stage's `supersedes` addition to `ownership-transfer.schema.json` explicitly mirrors that discipline — a correction is a new, separately-authored record, not an edit. An attacker abusing `supersedes` still leaves BOTH records inspectable, which is a structurally weaker position than being able to edit-in-place would be. | Authorization on WHO may supersede a given transfer (presumably: the same holder-pair, an issuer, or an operator, not an arbitrary caller) is, again, downstream of the same authorization-model gap as "fake seller" above — **BLOCKED** on §A2 |

**Summary of what this fraud model settles and what it does not.** It settles the
STRUCTURAL question — what the append-only, non-deletable, supersession-only data model
already buys, for free, before any runtime authorization exists. It does not settle, and
explicitly marks BLOCKED, every scenario that requires knowing WHO is making a request and
whether they are authorized to make it — because that requires real authentication and an
authorization model, neither of which exist (§A of `docs/IDA4_READINESS_AUDIT.md`), and this
document does not pretend otherwise.

---

## 7. Honest gaps

Named directly, cross-referenced to `docs/IDA4_READINESS_AUDIT.md` rather than restated and
risking drift from it:

- **No monitoring stack.** `docs/INGESTION_ARCHITECTURE.md` §15: no Prometheus/Grafana, by
  deliberate design; a scheduled `media-ops.js audit` with alerting is REQUIRED before public
  exposure and does not exist yet (`IDA4_READINESS_AUDIT.md` §F4, BLOCKED).
- **No real authentication.** `IDA4_READINESS_AUDIT.md` §A, in full — BLOCKED, and the single
  largest reason this threat model's PLANNED surfaces (§5) and the transfer fraud model's
  BLOCKED rows (§6) stay blocked.
- **No audit-on-read.** `SECURITY.md` L102-113, `IDA4_READINESS_AUDIT.md` §C5 — restricted
  data is protected by exclusion from query paths today, not by a logged-and-reviewable
  access control. Materially weaker against an insider with legitimate query access than the
  audit-on-read model `docs/PRIVACY_ARCHITECTURE.md` §3 describes as the target — the insider
  scenario in §2 above has no mitigation beyond that exclusion. Closing this gap needs either
  (a) building real audit-on-read, or (b) an explicit owner acceptance that the residual risk
  is tolerated for the pilot's scale and duration; neither has happened yet.
- **No verifier security.** `docs/BLOCKCHAIN_ARCHITECTURE.md` §9: independent proof verifier
  is PLANNED, no code exists (`src/blockchain/` is an empty placeholder). This gates IDA-8
  directly (it is one of the six hard-gate conditions, §8 of that document) and is recorded
  here because it was named explicitly in this document's required scope.
- **No system-wide incident-response runbook.** Restore has been proven exactly once, in an
  isolated container (`IDA4_READINESS_AUDIT.md` §F5) — never against a realistic live-path
  recovery scenario. No document in this repository describes "what we do when a live
  incident is detected," as distinct from "how we back up and restore data."
- **Backup schedule staleness.** One verified database batch exists (2026-08-14); no
  recurring schedule exists to refresh it (`IDA4_READINESS_AUDIT.md` §F2), and it ages toward
  becoming stale evidence with every day that passes without a new one.
- **This document itself is new and unexercised.** A threat model's first review under real
  operating conditions (an actual incident, or the first PLANNED surface actually shipping)
  is likely to surface gaps in this one. That is expected, not a defect in writing it now —
  the alternative (not having one) was the actual defect `IDA4_READINESS_AUDIT.md` §D1
  identified.
