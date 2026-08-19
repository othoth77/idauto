# IDauto — Roadmap

**Last updated:** 2026-08-18
**Provenance:** IDA-0 through IDA-3 were executed in `othoth77/mythos-prod`
(`projects/idauto/`) between 2026-08-05 and 2026-08-12. That history is preserved here, not
restarted. IDA-4 onward reflects the strategic evolution recorded in
[`ROADMAP_EVOLUTION_2026-08-18.md`](ROADMAP_EVOLUTION_2026-08-18.md).

---

## Status vocabulary

These tags are used literally. A planned feature is never described as implemented.

| Tag | Meaning |
|---|---|
| **IMPLEMENTED** | Code exists, tests pass, the commit is on the remote |
| **SPECIFIED** | Designed and documented; no implementation |
| **PLANNED** | Intended; not yet specified in detail |
| **BLOCKED** | Cannot proceed until a named prerequisite is resolved |
| **LEGAL-REVIEW-REQUIRED** | Cannot proceed until a legal question is answered |
| **DEPLOYED** | Running in production and publicly reachable |

**Nothing in this repository is DEPLOYED.** The PostgreSQL database and media store run
privately in the origin deployment; no IDauto API, UI or public endpoint is exposed
anywhere.

---

## Summary

| Stage | Name | Status |
|---|---|---|
| IDA-0 | Foundation | ✅ **IMPLEMENTED** (2026-08-05) |
| IDA-1 | Product specification & governance | ✅ **IMPLEMENTED** (2026-08-05) |
| IDA-2 | PostgreSQL, API, manual capture | ✅ **IMPLEMENTED** with two explicit exceptions (2026-08-11) |
| IDA-3 | Community ingestion, trust, enforcement | ✅ **IMPLEMENTED** A–F; G–I not started |
| IDA-4 | Citizen Vehicle Passport | **SPECIFIED** — blocked on IDA-2E and legal review |
| IDA-5 | Professional Issuers / Garage Network | **SPECIFIED** |
| IDA-6 | AI Trust & Anomaly Engine (incl. Smart Gate) | **SPECIFIED** |
| IDA-7 | Verifiable Credentials / DID interoperability | **SPECIFIED** |
| IDA-8 | Blockchain anchoring / Merkle proofs | **SPECIFIED** |
| IDA-9 | Open protocol, ecosystem, internationalisation | **PLANNED** |

---

## IDA-0 — Foundation ✅ IMPLEMENTED

**Completed 2026-08-05.**

Product identity, the privacy contract, the plate-format catalogue, the configurable-rules
file, and the first data-contract draft (11 tables).

Established at this stage and unchanged since: **plate formats are configuration, never
hardcoded** (AD-3). The seven Tunisian format patterns remain **UNVERIFIED DRAFTS** — they
have not been confirmed against an official traffic-authority source, and that caveat has
never been quietly dropped.

**Scope:** no real data, no UI, no deployment, no personal-data exposure.

---

## IDA-1 — Product specification & governance ✅ IMPLEMENTED

**Completed 2026-08-05.**

[`PRODUCT_SPEC.md`](PRODUCT_SPEC.md), [`CAPTURE_PIPELINE.md`](CAPTURE_PIPELINE.md),
[`FIXPERT_INTEGRATION.md`](FIXPERT_INTEGRATION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md);
the schema draft expanded to 22 tables on an observation-first model.

Key decisions, all still in force:

- **Observation-first** data model (AD-8) — every capture creates an Observation before any
  vehicle lookup.
- **Three access scopes** (AD-9): public, professional, restricted.
- Gate/ANPR events are restricted by design (AD-10).
- LEGAL-REVIEW-REQUIRED items enumerated rather than deferred silently.

---

## IDA-2 — PostgreSQL, API, manual capture ✅ IMPLEMENTED, with two explicit exceptions

**Completed 2026-08-11**, audited the same day.

| Slice | Delivered | Status |
|---|---|---|
| **2A** | Schema promoted to migration-ready (22 tables, zero owner-PII columns verified); config-driven plate validator | ✅ 44 tests |
| **2A-CORRECTION-0** | `visibility_scope` → `access_scope` (naming alignment); format-cache added | ✅ |
| **2B** | PostgreSQL deployed, memory-capped from first start, loopback-bound only; schema applied with 0 errors; backup taken **and restore-tested** before the slice was declared complete | ✅ |
| **2C** | Read-only API; restricted-scope data excluded at query level because no audit-on-read path existed yet | ✅ 26 tests |
| **2D** | Write API with **atomic audit logging** — one shared `withAudit()` helper, so transaction atomicity is implemented in exactly one place. Proven in both directions: a failed data insert leaves no phantom audit row, and a failed audit insert rolls the data insert back | ✅ 39 tests |
| **2E** | Real Mythos OS auth integration | ⛔ **BLOCKED** — see below |
| **2E-PRE** | Minimal admin-identity stub: operator-provisioned token→identity map, fails closed if identity is missing | ✅ |
| **2F** | Content-addressed local media storage. Handles the atomicity dimension a filesystem cannot join a transaction on: orphaned files are cleaned up, but only after confirming no other row references the same content-addressed key | ✅ 32 tests |
| **2G** | Admin manual-entry UI | ✅ 17 tests |
| **2H** | Review-queue UI | ✅ 37 tests |
| **2I** | Rate limiting | Deferred to IDA-3C, where it was delivered |

### ⛔ IDA-2E — BLOCKED

Scope was "integrate real Mythos OS auth". Investigation before any code was written found
**no such service existed** — the host application's only auth was a single shared password
with no per-user identity, and the JWT contract referenced in the architecture had never
actually been specified. Building a multi-user identity service was far outside the slice's
bounds, so nothing was written and the blocker was recorded.

**In the standalone repository this changes shape.** There is no Mythos service to wait for.
The answer is now to build authentication on W3C primitives, scheduled at **IDA-7**. Until
then, the only identity mechanism is the operator-provisioned admin token map from 2E-PRE,
which is explicitly not authentication.

### Carried-forward exceptions

- Live-test fixtures accumulate by design; a fixture lifecycle is undefined. Not a present
  correctness problem, and it should be defined before volume makes backups material.
- The media directory has no *verified off-host* backup. IDA-3F's verified batch covered the
  database; media backup and restore exist locally but have not been exercised off-host.

---

## IDA-3 — Community ingestion, trust, enforcement

**Design gate completed 2026-08-12**
([`INGESTION_ARCHITECTURE.md`](INGESTION_ARCHITECTURE.md), binding).
The gate's central finding: most of the IDA-3 data model already existed, because the
IDA-1/IDA-2 schema had anticipated community capture.

| Slice | Delivered | Status |
|---|---|---|
| **3A** | Ingestion schema: `idauto_submissions`, `idauto_rate_limit_counters`, one nullable column. Additive only | ✅ 47 tests |
| **3B** | Pure ingestion service — no route, no listener, no exposure. Actor and source mapping entirely **server-derived**; a payload supplying any of seven privileged fields is **rejected with 400 naming each one**, never silently ignored | ✅ 67 tests |
| **3C** | Rate-limit enforcement (resolving the deferred 2I question) | ✅ 63 tests |
| **3D** | Private **admin-only** ingestion route. No public endpoint was created | ✅ 73 tests |
| **3E** | Admin review queue | ✅ 48 tests |
| **3F** | Off-host backup — provider-neutral core, SigV4 adapter using only Node built-ins, no dependency added. Offline suite reproduces AWS's published SigV4 vector exactly. **Executed and restore-verified 2026-08-14** | ✅ 35 tests; gate CLOSED |
| **3G** | Consent and legal gate | **LEGAL-REVIEW-REQUIRED** — not started |
| **3H** | Authenticated pilot | **BLOCKED** on IDA-2E (real auth) — not started |
| **3I** | Public capture gate | **BLOCKED** — not started |

### ✅ IDA-3F — EXECUTED AND RESTORE-VERIFIED (2026-08-14)

> **Status correction, 2026-08-18.** The first pass of the standalone migration reported this
> stage as BLOCKED with no off-host copy in existence. That was wrong: it read the IDA-3F
> entries of 2026-08-12 without scanning forward to the entries that superseded them. The
> record is in [`AI_HANDOVER.md`](AI_HANDOVER.md); the gate table is in
> [`../ops/runbooks/OFF_HOST_BACKUP_GATE.md`](../ops/runbooks/OFF_HOST_BACKUP_GATE.md) §6.

What actually happened, in order:

1. **2026-08-12** — tooling merged, verified offline (30 assertions). No destination existed,
   and the stage was correctly declared incomplete rather than closed. Writing backups to
   another directory on the same host was deliberately *not* done: the risk is host or disk
   loss, so a same-host copy would have satisfied nothing while making the gate look closed.
2. **2026-08-14** — the object-store destination was provisioned, and a connectivity test
   found **two real defects the offline suite could not have caught**: the default HTTPS
   transport had *never worked* (options were passed in a shape Node ignores, so every real
   request went to `localhost`), and no DELETE operation existed, making verification
   round-trips impossible. Both fixed; the suite went to 34, then 35 after a `Content-Length`
   fix that only surfaced at real dump size. The SigV4 signing itself was left byte-untouched
   and is still pinned by AWS's published vector.
3. **2026-08-14** — the backup ran: dump → SHA-256 (C1) → upload → **fresh download** →
   SHA-256 (C2) → C1 == C2 → **isolated restore** into a throwaway container with
   `--network none` → **24 tables / 2,551 rows, source-identical**. Local dumps removed
   afterwards; zero credentials in the repository, verified by direct value comparison.

All seven backup-gate conditions are **MET** and the gate is **CLOSED**.

**The lesson worth keeping:** a suite that injects a mock transport proves the logic and
nothing about the wire. Thirty passing tests coexisted with a transport that had never once
connected to the right host.

**Still outstanding, and not claimed as done:**

- **No schedule.** One verified batch is not a backup regime. Recurring backups, retention
  automation and deployment integration are separate, not-yet-authorised work, and the gate
  should be treated as stale once the newest verified batch ages beyond tolerance.
- **The media store has no verified off-host copy.** The batch covered the database.
- Retention remains **report-only by construction** — no deletion path exists, and
  `--destructive` is refused outright.

### `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO`

**Two** independent blockers remain open: legal/consent review (3G) and real authentication
(IDA-2E → IDA-7). The third — off-host backup (3F) — **closed on 2026-08-14**.

---

## IDA-4 — Citizen Vehicle Passport

**Status: SPECIFIED.** Blocked on IDA-2E (auth), IDA-3F (off-host backup — database leg
CLOSED, schedule/media leg still open) and LEGAL-REVIEW-REQUIRED items. **IDA-4 itself is NOT
IMPLEMENTED** — see the dated note below for exactly what subset is.

| Deliverable | Status |
|---|---|
| Formal IVID format and issuance (OVIP §2.1) | **IMPLEMENTED** (foundation) — `reference/ivid.js`, gate-free (no persistence, no reachable write path) |
| Migration of `internal_ref` to the IVID format | **PLANNED, dry-run tooling IMPLEMENTED** — `docs/IVID_MIGRATION_PLAN.md` + `database/migrations/ivid-migration-dry-run.js`; execution against the live database is explicitly NOT done and requires an owner order |
| Citizen self-registration | **SPECIFIED** — requires real auth (BLOCKED, `docs/IDA4_READINESS_AUDIT.md` §A) |
| Digital Vehicle Passport assembly, scope-filtered | **IMPLEMENTED** (foundation) — `reference/passport-assembly.js`, a pure function with no route wired to it |
| QR representation (public-scope reference only, no token, no personal data) | **IMPLEMENTED** (foundation) — enforced in `reference/passport-assembly.js` and `protocol/schemas/passport.schema.json`'s now-required `qr` field |
| Passport sharing | **SPECIFIED** — no surface exists to share from |
| Citizen data export | **SPECIFIED** — no citizen account exists to export from |
| Person store, separated from the vehicle store | **SPECIFIED** — `protocol/schemas/holder-ref.schema.json` (this stage) specifies the REFERENCE boundary only; the person store itself remains unbuilt and out of protocol scope by design |
| Holder association and ownership transfer | **SPECIFIED**; `ownership-transfer.schema.json`'s `supersedes` field added (this stage) for correction-by-supersession |
| Erasure with tombstones | **SPECIFIED**; `protocol/schemas/tombstone.schema.json` added (this stage) — no erasure code path exists yet |
| 50+ automated tests | **130** (`tests/ida4-foundation-test.js`, this stage's foundation subset only — not a claim that IDA-4 overall has closed its own 50-test bar) |

**Dated note, 2026-08-19, branch `ida4-foundation`.** A gate-free foundation subset of the
above is **IMPLEMENTED** as of this date, per the architecture review's approved scope
(`docs/IDA4_READINESS_AUDIT.md` §H: schema/protocol groundwork that creates no reachable
write path, processes no real person's data, and answers no legal question). Exactly seven
items:

1. Schema-defect fixes (`protocol/schemas/`: `passport`/`anomaly` required-field additions,
   `ownership-transfer.supersedes`, the IVID pattern bound, the OVIP §13 closed-schema note).
2. `reference/ivid.js` — IVID issuance/validation library (pure, no persistence).
3. Two new protocol artifacts — `holder-ref.schema.json`, `tombstone.schema.json`.
4. `reference/passport-assembly.js` — pure passport-assembly function, no I/O.
5. `docs/IVID_MIGRATION_PLAN.md` + `database/migrations/ivid-migration-dry-run.js` (dry run
   only — refuses to run against any environment with an `IDAUTO_DB_*` variable set).
6. `docs/THREAT_MODEL.md` — system-wide threat model, including the ownership-transfer fraud
   model.
7. `tests/ida4-foundation-test.js` — 130 offline, env-free assertions covering all of the
   above.

**The citizen-facing surface itself remains BLOCKED**, unchanged by this subset, on the same
two REQUIRED gates `docs/IDA4_READINESS_AUDIT.md` §G names: **gate A** (real authentication —
BLOCKED, plus the **A5** owner decision on which path IDA-4 takes: wait for IDA-7, or an
IDA-4-scoped interim mechanism) and **gate B** (legal review of the 16 enumerated
LEGAL-REVIEW-REQUIRED items, specifically #6/#7/#9/#16 which the roadmap itself attributes to
IDA-4). Nothing in this subset creates a route, a database write path, a citizen account, or
processes a real person's data — it does not move either gate, and is not claimed to.

**Dated note, 2026-08-19, branch `ida4-option-c`.** Following the A5 owner decision,
excerpted in `docs/IDA4_READINESS_AUDIT.md` §I/§J ("APPROVE OPTION C..." — that entry
explains why "excerpted," not "verbatim," is the accurate label), the zero-account
Option C sub-surface has been implemented on this branch: `reference/ivid-issuance.js`
(permanent IVID issuance, `system`-actor audit rows), `database/migrations/ida4-option-c-ivid.sql`
(adds `idauto_vehicles.ivid`), and `reference/api.js`'s first unauthenticated route,
`GET /public/passport/:ivid` — IVID-only resolution, a format gate before any database
touch, its own rate-limit bucket, hardcoded `public` scope with SQL-level defense-in-depth
plus a fact-key deny-list, and a `qr.payload === ivid` assertion. The live-database suite in
`tests/ida4-option-c-test.js` passes with 0 failures (see
`docs/IDA4_OPTION_C_IMPLEMENTATION_REPORT.md` §11 for the current exact assertion count,
not restated here as a fixed number since it will grow with future fixes). An Opus
architecture review (APPROVE-WITH-FINDINGS) subsequently found and this branch fixed eleven
defects, documented in that same report's §13–§14. **This is pending Haiku audit before
anything further happens with it** — it is not deployed, not merged to `main`, and does not
change `CITIZEN_FACING_IDA4_READY` (still NO) or `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT`
(still NO).
The citizen-facing write surface (self-registration, ownership transfer, erasure) remains
exactly as BLOCKED as the paragraph above states — Option C answers none of gate A's
authentication questions or gate B's legal questions, by design.

---

## IDA-5 — Professional Issuers / Garage Network

**Status: SPECIFIED.** Depends on IDA-4.

Issuer registry with verifiable identity; onboarding and accreditation; issuance rights per
`authority_scope`; workflow integration for garages, insurers, fleet operators, inspectors
and dealers; issuer suspension and revocation with history retained; retroactive
issuer-wide reassessment; professional subscription tiers; source-quality scoring;
regional coverage dashboards (aggregate only). Optionally a narrow part-fitment slice.

---

## IDA-6 — AI Trust & Anomaly Engine

**Status: SPECIFIED.** Depends on IDA-5.

The T0–T4 `TrustAssessment` computation; anomaly detectors (chronology, mileage regression
and rate, duplicate and cross-subject evidence re-use, document layout and arithmetic,
geographic plausibility, issuer scope); perceptual hashing; automated severity routing to
human review; carte grise / registration-certificate OCR with mandatory confirmation.

**Bounds are normative, not aspirational:** AI may OCR, extract and flag. AI **must not**
declare fraud, assert legal guilt, raise a trust level, or be the sole basis for an adverse
decision about a person. Every finding is an `Anomaly` routed to review, worded to describe
the observation rather than the conclusion.

**Absorbed from the previous roadmap's IDA-4 — Smart Gate**, scope unchanged: one designated
entrance/exit camera at the first pilot workshop, of five on the premises; the other four
remain out of scope. Movement events are permanently restricted-scope. Still
**LEGAL-REVIEW-REQUIRED** for regulatory approval, camera disclosure and video retention.

---

## IDA-7 — Verifiable Credentials / DID interoperability

**Status: SPECIFIED.** Depends on IDA-6.

W3C VC issuance and verification; DID resolution (`did:web`, `did:key`) with **DID-document
archiving at issuance**, so a lapsed domain does not break historical verification;
status-list revocation; the credential types in
[`../protocol/credentials/README.md`](../protocol/credentials/README.md); a published
JSON-LD context; SDKs; a conformance suite.

**This is also where IDA-2E is finally resolved.** Real multi-user authentication is built on
these primitives rather than waiting on an external service that does not exist.

Also here: protocol/implementation convergence per
[`../protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md), including the
`mythos_private` → `restricted` scope rename and the `mythos_user_id` → neutral
`subject_ref` rename. Both are breaking migrations and are scheduled deliberately, not
opportunistically.

---

## IDA-8 — Blockchain anchoring / Merkle proofs

**Status: SPECIFIED. No chain integration exists anywhere in this repository.**

Canonical versioned serialisation; salted record hashing; Merkle batching (daily by
default); chain-neutral anchor submission; inclusion proofs; an **independent** reference
verifier so the trustlessness claim is checkable without IDauto; multi-chain anchoring as a
hedge.

**Hard gate — anchoring must not begin until all six hold:** off-host backup operational and
restore-tested (**met 2026-08-14**, though without a recurring schedule); real authentication exists; canonical serialisation specified and
independently implemented twice; the salt store's backup and recovery tested; legal review
confirms no personal data can reach an anchor; the independent verifier exists and is
published.

Anchoring an unverified record set early produces permanent, publicly checkable evidence of
a system that was not ready.

---

## IDA-9 — Open protocol, ecosystem, internationalisation

**Status: PLANNED.**

Protocol v1.0; public RFC process; multi-jurisdiction plate and document formats;
localisation; cross-border passport continuity (import/export events);
[part identity](PART_IDENTITY.md) — `Part`, `IPID`, `PartFitment`, recall queries,
counterfeit detection; institutional data-source integration (registry, inspection
authority); a second geographic market.

---

## LEGAL-REVIEW-REQUIRED — open items

None of these is resolved. Each blocks the stage named.

| Item | Blocks |
|---|---|
| Public image contribution — legal basis | IDA-3G |
| Precise GPS collection — consent and notice | IDA-3G |
| Public plate lookup — legal basis | IDA-3I |
| Registration-certificate OCR — processing basis and consent flow | IDA-6 |
| Contributor consent — formal mechanism | IDA-3G |
| Data correction / deletion rights for individuals | IDA-4 |
| Data retention periods, all categories | IDA-4 |
| Professional data-sharing legal basis | IDA-5 |
| Operator super-admin access governance policy | IDA-4 |
| ANPR — regulatory notification or approval | IDA-6 |
| Camera disclosure to visitors and employees | IDA-6 |
| Video retention periods | IDA-6 |
| Confirmation that no personal data can reach an anchor | IDA-8 |
| Official data-source agreement | IDA-9 |
| Cross-border data transfer basis | IDA-9 |

---

## Consolidated blockers

| Blocker | Blocks | Resolution |
|---|---|---|
| **Real authentication** (IDA-2E) | IDA-3H, IDA-4, everything citizen-facing | Build on W3C primitives at IDA-7 |
| **No backup *schedule*** | Degrades the closed IDA-3F gate over time | One verified batch exists (2026-08-14). Add recurring backups, retention automation, and off-host coverage of the media store |
| **Legal review** (IDA-3G) | Every public surface | Answer the items above |
| **Plate formats unverified** | Accuracy of validation in the first market | Confirm against an official source |
| **Test fixture lifecycle undefined** | Nothing today | Define before volume makes backups material |
| **Professional adoption unproven** | The growth loop | See [`GO_TO_MARKET.md`](GO_TO_MARKET.md) §2 |

---

## Growth milestones

Strategic targets, not forecasts. Each depends on legal approvals and partner agreements
that do not yet exist.

| Milestone | Vehicles | Method |
|---|---|---|
| Pilot | 1,000 | Admin manual entry; synthetic and authorised pilot data |
| Early growth | 10,000 | Citizen registration + first professional issuers |
| Network scale | 100,000 | Professional network, community contribution |
| National scale | 500,000+ | Authorised institutional sources + partnerships |

---

## Permanent exclusions

Not phases. Not "later". Excluded by design:

- Public tracking of individual vehicles or persons
- Exposure of individual movement history
- Personal data on a public blockchain
- Monetising truth, trust level, or the suppression of an adverse record
- A mandatory token, cryptocurrency, NFT or DAO
