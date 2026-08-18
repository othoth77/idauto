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
| IDA-3 | Community ingestion, trust, enforcement | ✅ **IMPLEMENTED** A–E; F **BLOCKED**; G–I not started (2026-08-12) |
| IDA-4 | Citizen Vehicle Passport | **SPECIFIED** — blocked on IDA-2E, IDA-3F, legal review |
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
- The media directory has no external backup. Addressed by IDA-3F — which is itself blocked.

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
| **3F** | Off-host backup tooling — provider-neutral core, SigV4 adapter using only Node built-ins, no dependency added. Offline suite reproduces AWS's published SigV4 vector exactly | ⛔ **BLOCKED** |
| **3G** | Consent and legal gate | **LEGAL-REVIEW-REQUIRED** — not started |
| **3H** | Authenticated pilot | **BLOCKED** on 3F and IDA-2E — not started |
| **3I** | Public capture gate | **BLOCKED** — not started |

### ⛔ IDA-3F — BLOCKED

The tooling is implemented, merged and verified offline (35 assertions). **No off-host copy
exists.** Discovery found no usable off-host destination configured anywhere — no sync tool
installed, no credentials, no second host, no object store.

Writing backups to another directory on the same host was deliberately **not** done: the
risk is host or disk loss, so a same-host copy would satisfy nothing while making the gate
look closed.

Retention is report-only by construction — there is no deletion path, and `--destructive` is
refused outright.

**To close:** provision a private object store with least-privilege credentials and
object-lock or versioning, store the credential outside the repository at mode 600, run
push → verify-remote → an isolated restore drill, and record checksums. Only then is the
stage complete.

**Risk accepted while blocked:** all backups live on the same host as the data they protect.
Acceptable only while the data is synthetic — which is why 3F gates any stage accepting real
evidence.

### `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO`

Three independent blockers, all open: off-host backup (3F), legal/consent review (3G), and
real authentication (IDA-2E → IDA-7).

---

## IDA-4 — Citizen Vehicle Passport

**Status: SPECIFIED.** Blocked on IDA-2E (auth), IDA-3F (off-host backup) and
LEGAL-REVIEW-REQUIRED items.

| Deliverable | Status |
|---|---|
| Formal IVID format and issuance (OVIP §2.1) | **SPECIFIED** |
| Migration of `internal_ref` to the IVID format | **SPECIFIED** |
| Citizen self-registration | **SPECIFIED** — requires real auth |
| Digital Vehicle Passport assembly, scope-filtered | **SPECIFIED** |
| QR representation (public-scope reference only, no token, no personal data) | **SPECIFIED** |
| Passport sharing | **SPECIFIED** |
| Citizen data export | **SPECIFIED** |
| Person store, separated from the vehicle store | **SPECIFIED** |
| Holder association and ownership transfer | **SPECIFIED** |
| Erasure with tombstones | **SPECIFIED** |
| 50+ automated tests | Required to close the stage |

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
restore-tested; real authentication exists; canonical serialisation specified and
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
| **Off-host backup** (IDA-3F) | IDA-3H, IDA-3I, any stage accepting real evidence | Provision an off-host store; run push, verify, restore drill |
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
