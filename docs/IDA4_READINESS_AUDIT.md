# IDA-4 Readiness Audit

**Date:** 2026-08-19
**Repo state:** branch `ida4-readiness` @ `350792b` (`test(protocol): close the §4 vacuity
gap; fix two stale doc lines`); `main` @ `bdfec2c` (`audit: completeness pass — correct
IDA-3F status, recover four missed artefacts`). `350792b` is two commits ahead of `main`
(`42e8546` identity-vocabulary publication, `350792b` itself) and not yet merged.
**Purpose:** a read-only gate audit performed **before any IDA-4 implementation**, so the
next stage starts from the repository's actual state rather than a summary of it. This
document implements nothing.

**Classification vocabulary** (distinct from `docs/ROADMAP.md`'s status tags, purpose-built
for gating IDA-4):

| Classification | Meaning |
|---|---|
| **READY** | The prerequisite exists, is implemented, and needs no further decision to build on |
| **BLOCKED** | A named technical or process prerequisite is missing and must be built or completed first |
| **LEGAL REVIEW** | Cannot proceed until qualified legal counsel answers a specific question |
| **OWNER DECISION** | A choice exists between viable paths and only the project owner can make it |
| **TECHNICAL DEBT** | Works today but has a known gap that will need closing before or during the stage |

**Rule:** IDA-4 implementation of any citizen-facing surface requires every gate marked
**REQUIRED** in the table below (§G) to be **READY**. A gate that is BLOCKED, LEGAL REVIEW,
or OWNER DECISION is not READY, regardless of how much adjacent work is done.

## Verdict, up front

**BLOCKED.** IDA-4's citizen-facing write path (self-registration, passport creation,
holder association, erasure) cannot begin. Two REQUIRED gates are not READY: real
authentication (§A) and legal review of at least six directly-cited items (§B). A narrower
scope — schema/protocol groundwork that creates no write path a real person can reach — is
arguable and discussed in §H, but is not what "IDA-4 implementation" means in
`docs/ROADMAP.md` line 38 ("SPECIFIED — blocked on IDA-2E and legal review").

---

## A. Authentication

**IDA-2E status, verified:** `docs/ROADMAP.md` lines 99–110 record IDA-2E ("integrate real
Mythos OS auth") as **⛔ BLOCKED**: pre-implementation investigation found no such service
existed at all — "the host application's only auth was a single shared password with no
per-user identity, and the JWT contract referenced in the architecture had never actually
been specified" (`docs/ROADMAP.md` line 103). The same section states the re-scoping
verbatim: *"In the standalone repository this changes shape... The answer is now to build
authentication on W3C primitives, scheduled at **IDA-7**"* (`docs/ROADMAP.md` lines
107–109). `docs/IDENTITY_ARCHITECTURE.md` header (lines 1–2) confirms independently: *"real
authentication is **BLOCKED** and re-scoped to IDA-7."* Both documents agree; this is not a
contradiction to record, it is a confirmed cross-citation. **Classification: BLOCKED.**

**Real authentication (users, credentials, sessions, MFA).** `docs/IDENTITY_ARCHITECTURE.md`
§8 implementation-status table: "Real authentication (users, credentials, sessions, MFA) |
**BLOCKED** → IDA-7". **Classification: BLOCKED.**

**What exists instead — the admin stub.** `reference/identity.js` (stage `IDA-2E-PRE`)
resolves an operator-provisioned bearer token to an identity string from a JSON map
(`docs/IDENTITY_ARCHITECTURE.md` §2, lines 26–33). The document is explicit about what this
is not: *"**It is not authentication**, has no user table, no credential store, no session,
no organisation and no role, and it must never be described as authentication anywhere"*
(§2, lines 34–36). This is the **no-auth invariant**: it is test-enforced in
`tests/identity-conformance-test.js`, described in `docs/AI_HANDOVER.md`'s `IDA-DECOUPLE-3`
entry (lines 30–43) as "the `identity.js` no-auth invariant moved here from `mythos-prod`
behind an explicit non-emptiness precondition so it can never pass vacuously." `SECURITY.md`
lines 104–105 states the same fact for a security audience: *"**No real authentication.**
The only mechanism is an operator-provisioned map of admin bearer tokens to identity
strings. It is not an auth service and is not described as one."* **Classification: TECHNICAL
DEBT for the current admin surface (works, closed, tested); BLOCKED as a substitute for real
auth on any citizen-facing surface.**

**Authorization model.** `docs/IDENTITY_ARCHITECTURE.md` §8: "Authorisation beyond a role
comparison | **NOT STARTED**." No RBAC/ABAC model exists beyond the single admin-vs-not
distinction the token map encodes. **Classification: BLOCKED** (not started; IDA-4 requires
per-person authorization — e.g. "this citizen may edit this passport" — that a role
comparison cannot express).

**Session/token model.** None exists. The admin stub is a static token→identity map, not a
session mechanism — no expiry, no refresh, no revocation procedure is documented anywhere in
`docs/IDENTITY_ARCHITECTURE.md` or `SECURITY.md`. **Classification: BLOCKED** (does not
exist; "none exists" is stated plainly per instruction rather than implied).

**Service identity (`svc_` convention).** `docs/IDENTITY_ARCHITECTURE.md` §4 defines the
`actor_ref` convention: `usr_<uuidv7>` for users, `svc_<name>` for system services
(lines 68–71 table). This is published as data in
`protocol/vocabularies/actor-identifier.v1.json` (`forms` array, `service` entry with
pattern `^svc_[a-z0-9][a-z0-9._-]{0,40}$`), asserted against the live schema by
`tests/identity-conformance-test.js`. But `docs/IDENTITY_ARCHITECTURE.md` §8 itself says
"Canonical `usr_<uuidv7>` values | **SPECIFIED** — values are currently operator-chosen
strings" — i.e. the convention exists and is test-conformant, but no code mints or validates
a real UUIDv7 today; §6 "Migration procedure — NOT executed" confirms nothing has run.
**A published, tested value-format convention is not an implementation of the actors that
convention describes.** **Classification: SPECIFIED / TECHNICAL DEBT** — real for the shape
of the identifier, not real for the presence of actual service identities behind it.

**The structural question for IDA-4.** IDA-4 is explicitly "Citizen Vehicle Passport" —
real, individual users creating and holding records (`docs/ROADMAP.md` lines 188–206:
"Citizen self-registration | **SPECIFIED** — requires real auth"). A public write path built
on the admin-stub token map would mean every citizen shares the trust level of an operator
token, which the stub was deliberately built to make impossible to describe as
authentication. Two paths exist: (1) wait for IDA-7's W3C DID/VC-based auth, keeping IDA-4
blocked until then, or (2) build a minimal interim citizen-auth mechanism scoped
specifically to IDA-4 (e.g. session-based email/OTP auth, independent of the admin stub and
not claiming to be the IDA-7 solution). **Neither path is chosen in any document read for
this audit.** This is recorded as an **OWNER DECISION**, and building either path is itself
an architecture decision for Stage 5, not something this audit can resolve or should
pre-judge.

---

## B. Legal — LEGAL-REVIEW-REQUIRED items

**Method.** `grep -rn "LEGAL-REVIEW-REQUIRED" docs/` returns 29 raw matches across 10 files:
`RISK_REGISTER.md`, `INGESTION_ARCHITECTURE.md` (9), `CAPTURE_PIPELINE.md` (3),
`ROADMAP.md`, `PRODUCT_SPEC.md`, `AI_HANDOVER.md`, `MIGRATION_FROM_MYTHOS_PROD.md`,
`FIXPERT_INTEGRATION.md` (2), `ARCHITECTURE.md`, `PRIVACY_ARCHITECTURE.md`. The file-level
counts given in the mission brief for `INGESTION_ARCHITECTURE.md` (9), `CAPTURE_PIPELINE.md`
(3) and `FIXPERT_INTEGRATION.md` (2) are all confirmed exactly by this grep. Many of these 29
raw occurrences are the same underlying legal question restated (a retention-table cell, a
prose reference, a section header) — dedupe below.

### B.1 Distinct items enumerated

| # | Item | Cited at | Blocks (per source) |
|---|---|---|---|
| 1 | Public image contribution — legal basis | `docs/PRODUCT_SPEC.md` §12; `docs/PRIVACY_ARCHITECTURE.md` §7 line 169; `docs/ROADMAP.md` "open items" table | IDA-3G |
| 2 | Precise GPS collection — consent and notice | `docs/PRODUCT_SPEC.md` §12; `docs/PRIVACY_ARCHITECTURE.md` §7; `docs/CAPTURE_PIPELINE.md` §7.2 | IDA-3G |
| 3 | Public plate lookup — legal basis | `docs/PRODUCT_SPEC.md` §12; `docs/PRIVACY_ARCHITECTURE.md` §7; `docs/RISK_REGISTER.md` `R-L01` | IDA-3I |
| 4 | Registration-certificate (carte grise) OCR — processing basis and consent flow | `docs/PRODUCT_SPEC.md` §12; `docs/CAPTURE_PIPELINE.md` lines 209, 229; `docs/PRIVACY_ARCHITECTURE.md` §7 | IDA-6 |
| 5 | Contributor consent — formal mechanism | `docs/PRODUCT_SPEC.md` §12; `docs/CAPTURE_PIPELINE.md` line 229; `docs/INGESTION_ARCHITECTURE.md` §23 line 573 | IDA-3G |
| 6 | Data correction / deletion rights for individuals | `docs/PRODUCT_SPEC.md` §12 ("Data correction / deletion requests"); `docs/ROADMAP.md` "open items" table | **IDA-4** |
| 7 | Data retention periods, all categories | `docs/PRODUCT_SPEC.md` §12; `docs/CAPTURE_PIPELINE.md` line 304; `docs/INGESTION_ARCHITECTURE.md` §17 (6 rows: accepted media, rejected media, anonymous submissions, abuse payloads, deleted-account evidence, `mythos_private` evidence — lines 472–480) | **IDA-4** |
| 8 | Professional data-sharing legal basis | `docs/PRODUCT_SPEC.md` §12 | IDA-5 |
| 9 | Operator super-admin access governance policy | `docs/PRODUCT_SPEC.md` §12 ("Mythos Super Admin access"); `docs/RISK_REGISTER.md` `R-O03`; `docs/MIGRATION_FROM_MYTHOS_PROD.md` line 157 | **IDA-4** |
| 10 | ANPR — regulatory notification or approval | `docs/PRODUCT_SPEC.md` §12; `docs/FIXPERT_INTEGRATION.md` lines 228, 232 (§10); `docs/RISK_REGISTER.md` `R-L02` | IDA-6 |
| 11 | Camera disclosure to visitors and employees | `docs/FIXPERT_INTEGRATION.md` §10; `docs/IDENTITY_ARCHITECTURE.md`-adjacent surveillance boundary in `docs/PRIVACY_ARCHITECTURE.md` §8 | IDA-6 |
| 12 | Video retention periods | `docs/FIXPERT_INTEGRATION.md` §10 | IDA-6 |
| 13 | Confirmation that no personal data can reach an anchor | `docs/BLOCKCHAIN_ARCHITECTURE.md` §8 (gate condition 5) | IDA-8 |
| 14 | Official data-source agreement | `docs/ROADMAP.md` "open items" table | IDA-9 |
| 15 | Cross-border data transfer basis | `docs/ROADMAP.md` "open items" table; `docs/FIXPERT_INTEGRATION.md` §10 ("Cross-border data") | IDA-9 (per ROADMAP) / raised again at IDA-6 scope by FIXPERT_INTEGRATION — see discrepancy note below |
| 16 | **Owner identity processing** — "Under what conditions, if any, may owner identity (CIN, name, address) be processed internally?" | `docs/PRODUCT_SPEC.md` §12, row "Owner identity processing" | **Not tagged to any stage anywhere; not carried into `docs/ROADMAP.md`'s consolidated table** |

### B.2 Reconciliation against the roadmap's claimed 15

`docs/ROADMAP.md` "LEGAL-REVIEW-REQUIRED — open items" (lines 295–316) lists **exactly 15**
rows, and `docs/MIGRATION_FROM_MYTHOS_PROD.md` line 197 independently states "**15
LEGAL-REVIEW-REQUIRED items** | **OPEN**" — the two are self-consistent with each other.

**This audit's own enumeration finds 16 distinct legal questions, not 15** — one more than
the roadmap's consolidated table. The discrepancy is item #16 above: `docs/PRODUCT_SPEC.md`
§12's row "Owner identity processing — Under what conditions, if any, may owner identity
(CIN, name, address) be processed internally?" is a real, distinct legal question — distinct
from "public image contribution" (#1) and from "public plate lookup" (#3), both of which ask
whether facts may be *published*, not whether owner identity may be *processed internally at
all*. It does not appear, in substance or in a mapped-to-stage form, anywhere in
`docs/ROADMAP.md`'s 15-row table. It was present at IDA-1 (`docs/PRODUCT_SPEC.md` §12,
carried forward unedited since 2026-08-05 per that document's own provenance) and appears to
have been dropped, not resolved, when the roadmap's list was consolidated. **This is
recorded as a finding, not corrected by editing either document** — resolving which list is
authoritative is out of this audit's read-only scope.

A second, softer overlap is worth naming without forcing it into the count:
`docs/FIXPERT_INTEGRATION.md` §10's "Worker privacy" question ("Do workshop employees whose
vehicles pass the Smart Gate have data-subject rights that must be addressed?") asks a
different question from — but covers the same population as — roadmap item #11 ("Camera
disclosure to visitors and employees"). Disclosure and data-subject-rights are legally
distinct obligations even for the same people. This audit folds it under #11 rather than
counting it separately, because the roadmap item's language ("to visitors **and
employees**") already names the population; a legal reviewer should confirm the two
questions are actually the same scope before treating this as settled.

**Every item in B.1 is, by definition, LEGAL REVIEW.** None is resolved anywhere in the
sources read. §B.3 maps which gate a CITIZEN passport write path (IDA-4).

### B.3 What each item blocks, for IDA-4 specifically

Items tagged **IDA-4** directly in the sources (#6, #7, #9, and arguably #16 given it
concerns the same owner-identity data IDA-4's holder-association and correction/deletion
mechanics would touch) are the ones that block IDA-4's own deliverables by the roadmap's own
attribution. Items tagged IDA-3G/3I (#1, #2, #3, #5) gate the *earlier* public-capture
surface (IDA-3), not IDA-4 directly — but IDA-4's citizen self-registration and passport
assembly reads from and extends that same capture pipeline, so a public capture surface that
is itself blocked constrains what a citizen passport can responsibly display or accept as
evidence. Items tagged IDA-5/6/8/9 (#4, #8, #10, #11, #12, #13, #14, #15) gate strictly later
stages and do not directly block IDA-4's own listed deliverables, though #4 (registration-
certificate OCR) is adjacent because citizen registration is one plausible entry point for
that OCR flow if IDA-4 chooses to offer it early — no source states that IDA-4 will.

**Classification, all 16: LEGAL REVIEW.**

---

## C. Privacy

Audited against `docs/PRIVACY_ARCHITECTURE.md`.

**Owner/vehicle identity separation.** §1 (lines 12–24): "`idauto_vehicles` and
`idauto_plates` contain **no owner columns at all**, and there is no join path from a plate
number to a person anywhere in the schema... the schema test asserts zero owner-PII columns
across all tables, and it runs in the suite on every change." §2 formalises this as "Two
subjects, deliberately not joined" with a comparison table (vehicle record vs. person
record). `docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` §14 confirms independently: "No owner-PII
columns anywhere | **IMPLEMENTED** and test-enforced." **Classification: READY** — this is
schema-level, test-enforced, and does not depend on IDA-4 work.

**Public/private data separation (`access_scope`).** §3 defines three scopes — `public`,
`professional`, `mythos_private`/`restricted` — with a naming note (lines 79–85) that the
stored column value is literally `mythos_private`, "inherited from the Mythos monorepo",
while documentation and the protocol layer call it `restricted`; both name the same scope,
and a rename is deferred to IDA-7 as a breaking migration. `docs/OPEN_VEHICLE_IDENTITY_
PROTOCOL.md` §14: "Access scopes (public / professional / restricted) | **IMPLEMENTED**."
**Classification: READY**, with the naming split noted as **TECHNICAL DEBT** (cosmetic —
`access_scope` values are `mythos_private` in the live column, `restricted` in prose; both
resolve to the same enforcement path, no functional gap).

**Document privacy.** `docs/CAPTURE_PIPELINE.md` §5 (carte grise flow, lines 190–220): the
original document goes to protected object storage at `MYTHOS_PRIVATE` scope with super-
admin-only access; owner PII extracted during OCR is used only to populate a confirmation
form and is explicitly "NOT written to any `idauto_` table column" (line 217). Retention for
this document category is marked `LEGAL-REVIEW-REQUIRED` (line 209 — item #4/#7 in §B).
**Classification: READY for the storage/access mechanics; LEGAL REVIEW for retention** (same
underlying item as §B #7).

**Movement/location privacy.** `docs/PRIVACY_ARCHITECTURE.md` §8 (Surveillance boundary):
"Movement events are **restricted scope in their entirety**, permanently. There is no tier at
which movement history becomes public or professional" — and this is listed among
`docs/ROADMAP.md`'s "Permanent exclusions" (line 351: "Exposure of individual movement
history"). `docs/INGESTION_ARCHITECTURE.md` §9 states GPS/location is "**not collected in
v1**" specifically because "location plus timestamp plus plate is a movement-tracking
dataset." **Classification: READY** as a design boundary; **BLOCKED/not applicable** for
actual GPS collection since it is presently not collected at all, pending item #2 (LEGAL
REVIEW).

**Deletion/correction mechanics.** `docs/IDENTITY_ARCHITECTURE.md`'s companion privacy
document describes a tombstone-based erasure design (a person's data is removed, the vehicle
record is untouched, a tombstone records the erasure's legal basis and date) — this is a
**specified design**, not implemented: no erasure code path, no tombstone table population,
and no correction workflow exists in the reference implementation read for this audit (no
`idauto_tombstones`-equivalent write path appears in the IDA-2/3 delivered-slice list in
`docs/ROADMAP.md`). **Classification: SPECIFIED / BLOCKED** — the mechanism is designed but
not built, and its legal basis (#6 in §B) is unresolved, so even if built today it could not
be activated.

**Access controls.** `docs/PRIVACY_ARCHITECTURE.md` §3: "Restricted — operator-only... Every
access is audit-logged." This depends on an audit-on-read path that `docs/INGESTION_
ARCHITECTURE.md` §8 (threat model, "Probing private data" row) and `SECURITY.md` (lines
102–113) both state does **not** exist: "**No audit-on-read.** Which is why restricted reads
are closed rather than logged." Restricted data is currently protected by being *excluded
from all read paths entirely* (`docs/ROADMAP.md` IDA-2C: "restricted-scope data excluded at
query level because no audit-on-read path existed yet"), not by a working audit-on-read
control. **Classification: READY for the exclusion mechanism that exists today; BLOCKED for
the audited-access model the design describes** — these are two different controls and only
the coarser one (exclusion) is real.

---

## D. Security

**Threat model.** No standalone, system-wide threat model document exists anywhere in this
repository. `grep -rn "[Tt]hreat model" docs/ ops/runbooks/*.md` finds exactly one
substantive hit: `docs/INGESTION_ARCHITECTURE.md` §8, a 22-row table scoped specifically to
**community-ingestion abuse** (spam, fake plates, image flooding, path traversal, replay,
bot submissions, privilege escalation on submission, audit spoofing, EXIF/decoder risks,
denial of storage, and "legal / privacy complaint"). It does not cover authentication
bypass, infrastructure/network threats, insider risk, supply-chain risk, or verifier
security — none of those categories are named anywhere in this table or elsewhere in the
document set read. **Stated plainly, as instructed: no threat model document exists for the
system as a whole.** **Classification: BLOCKED / TECHNICAL DEBT** — the one threat-model
artifact that exists is real and well-evidenced for its narrow scope (ingestion abuse); the
system-wide gap (auth, infra, verifier, insider) is unaddressed.

**Abuse model.** `docs/INGESTION_ARCHITECTURE.md` §7 (rate limiting, lines 190–200):
implemented per-class limits (anonymous, authenticated, verified, professional, admin) keyed
on `ip_hash` and `mythos_user_id`, delivered at IDA-3C per `docs/ROADMAP.md` line 132 ("✅
63 tests"). What it covers: request-volume abuse per actor class. What it does **not**
cover, per the same §8 threat table: fabricated vehicle data beyond format checks (routed to
review, not prevented), duplicate/replay beyond image-hash dedup, CAPTCHA (explicitly "only
if evidence demands"), and — critically for IDA-4 — there is no citizen-specific abuse model
(account-takeover, multi-account fraud against a real-identity passport system) because no
real accounts exist yet to abuse. **Classification: READY for what it covers (submission-
volume abuse); BLOCKED for citizen-identity abuse, which cannot be modelled meaningfully
before real auth exists.**

**Fraud model.** No document defines a fraud model for citizen passports specifically (false
ownership claims, holder-association fraud, transfer fraud). `docs/OPEN_VEHICLE_IDENTITY_
PROTOCOL.md` §9.3 (Ownership transfer) and §9.4 (Merge) describe the *data* lifecycle rules
but not an adversarial fraud model against them. `docs/RISK_REGISTER.md` `R-D05` (merge
orphan propagation) is the closest existing risk entry and is explicitly reframed as an IDA-4
concern ("Merge semantics are now protocol-level (OVIP §9.4)", §3 stage-renumbering row).
**Classification: BLOCKED** — not specified, let alone implemented; a gap this audit
surfaces rather than fills.

**Authentication.** Cross-referenced to §A: **BLOCKED**.

**Evidence integrity.** `docs/ARCHITECTURE.md` AD-4 (immutable audit log) and AD-8
(observation-first model) plus `docs/ROADMAP.md` IDA-2D ("atomic audit logging... a failed
data insert leaves no phantom audit row, and a failed audit insert rolls the data insert
back") and IDA-2F ("content-addressed local media storage... orphaned files are cleaned up,
but only after confirming no other row references the same content-addressed key").
`SECURITY.md` "Implemented and test-enforced" list confirms both independently: "Every
mutation writes an audit row in the same transaction, or both roll back" and
"Content-addressed media; orphan cleanup never removes a file another row references."
**Classification: READY.**

**Verifier security.** `docs/BLOCKCHAIN_ARCHITECTURE.md` §9: "Independent verifier |
**PLANNED**." §8 (Implementation gate) lists "The independent proof verifier exists and is
published" as one of six hard-gate conditions for IDA-8, none of which have been met except
the off-host-backup condition (partially — see §F). No verifier code exists in this
repository (`src/blockchain/` is "Empty placeholder", §9). **Classification: BLOCKED** —
this gates IDA-8, not IDA-4 directly, but is recorded here because "verifier security" was
named explicitly in the audit's mission scope.

---

## E. Public endpoint

`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = **NO**`, recorded in
`docs/INGESTION_ARCHITECTURE.md` §22 (the flags table) and restated in §23 ("Blockers to
public ingestion (all must clear)"): (1) IDA-3A–3C not implemented — **now false, these are
implemented per `docs/ROADMAP.md`** (see note below), (2) off-host backup absent — **now
false, closed 2026-08-14**, (3) `LEGAL-REVIEW-REQUIRED` on `PUBLIC_UPLOAD` — **still true**,
(4) real Mythos auth (IDA-2E) BLOCKED — **still true**. `docs/ROADMAP.md`'s own restatement
at the end of the IDA-3 section (line 181–184) is more current and says the same thing in
substance: *"**Two** independent blockers remain open: legal/consent review (3G) and real
authentication (IDA-2E → IDA-7). The third — off-host backup (3F) — **closed on
2026-08-14**."*

**Note on the stale count in §23:** `docs/INGESTION_ARCHITECTURE.md` §23 itself pre-dates
the IDA-3A–3F completions recorded later in `docs/ROADMAP.md`; two of its four listed
blockers (IDA-3A–3C build status, off-host backup) are now resolved per `docs/ROADMAP.md`'s
newer, dated status. This is not treated as a contradiction between two live claims — §23 is
simply an earlier design-gate snapshot that was correctly true when written and has not been
updated to reflect subsequent slices closing. The current, authoritative blocker list is
`docs/ROADMAP.md`'s.

**Does anything since change this?** No. The protocol/identity-vocabulary publication work
on this branch (`IDA-DECOUPLE-3`, commits `42e8546`/`350792b`) is explicitly scoped as
"Additive... No schema change. No API change. No runtime change" (`docs/AI_HANDOVER.md` lines
53, 56). It moves no blocker. The two remaining blockers are exactly **auth (§A)** and
**legal (§B)** — unchanged in kind since the IDA-3 design gate, only reduced in count (from
four candidate blockers to two, with backup and build-status resolved).

**Exact conditions that would flip this to YES:** (1) real, per-user authentication exists
(closing §A — either IDA-7's DID/VC system ships, or an IDA-4-scoped interim mechanism is
built and owner-approved per the §A structural question) **and** (2) every LEGAL REVIEW item
in §B.1 that gates the specific surface being exposed is answered by qualified counsel and
recorded as resolved (not all 16 need resolving to expose *some* surface — e.g. exposing only
IDA-4's IVID assembly without public contribution would not need #1/#2/#5 resolved, but would
still need #6, #7, #9, and arguably #16). No document read for this audit claims either
condition is met or imminent.

**Classification: BLOCKED**, both conditions.

---

## F. Infrastructure

**Backups — database.** `docs/ROADMAP.md` IDA-3F: "✅ 35 tests; gate CLOSED" — executed and
restore-verified 2026-08-14 (`AI_HANDOVER.md` "FINAL VPS INVENTORY RECONCILIATION" and
"OFF-HOST BACKUP EXECUTION" entries; `ops/runbooks/OFF_HOST_BACKUP_GATE.md` §6, all seven
gate conditions **MET**). `idauto`: 24 tables / 2,551 rows, source-identical on isolated
restore.

**Backups — schedule.** `docs/ROADMAP.md` "Consolidated blockers": "**No backup
*schedule*.** ... One verified batch exists (2026-08-14). Add recurring backups, retention
automation, and off-host coverage of the media store." `SECURITY.md` line 106–108: "treat
the backup gate as stale once the newest verified batch ages beyond tolerance." **As of this
audit's date (2026-08-19), the verified batch is 5 days old** and no schedule exists to
refresh it — it is ageing exactly as the sources warned it would.

**Backups — media store.** `SECURITY.md` line 109–110: "**No verified off-host copy of the
*media store*.** The verified batch covered the database. Media backup and restore are
implemented locally and untested off-host." Confirmed independently by `ops/runbooks/
OFF_HOST_BACKUP_GATE.md`'s scope note (only `idauto`'s database dump is in the verified
batch's evidence table).

**External, Mythos-side operator gates (cited as external — read-only, from
`/home/user/mythos-prod/docs/OFF_HOST_BACKUP_GATE.md` §8, dated 2026-08-19).** That document
records three unmet operator gates on the Mythos side, which this audit reproduces for
context but does not treat as internal to this repository, since the tooling described there
was relocated by `IDA-DECOUPLE-2`/`IDA-DECOUPLE-4` to `projects/infrastructure/ops/` inside
`mythos-prod`, and the same document states plainly that "the canonical IDauto product
repository (`https://github.com/othoth77/idauto`) carries its own fork of both modules,
adjusted for its own layout — the two copies serve different repositories and are **not**
interchangeable." With that caveat:

| Gate | What it is | State |
|---|---|---|
| **OWNER-GATE-B1** | Live round trip after the Mythos-side tooling relocation | Rehearsed against synthetic data and a local adapter only (2026-08-19); real HTTPS/SigV4 round trip **not** re-exercised since relocation; owner action required |
| **OWNER-GATE-B2** | Recurring backup schedule | No schedule exists; explicitly unexecuted and unscheduled; owner action required |
| **OWNER-GATE-B3** | Media store off-host copy | No verified off-host copy of media exists; same conclusion as this repository's own `SECURITY.md` line 109 |

These three gates describe the Mythos-side infrastructure fork, not this repository's own
`ops/offhost-backup.js`. IDauto's own gate (`ops/runbooks/OFF_HOST_BACKUP_GATE.md`) is
independently CLOSED for the database as of 2026-08-14, per this repository's own evidence
above — the Mythos-side table is included because the task brief named it explicitly and
because both repositories share the same underlying operational reality (one owner, one set
of credentials, one ageing verified batch).

**Classification: TECHNICAL DEBT** — the one verified batch is real and evidenced; the
absence of a schedule and of media coverage are known, named gaps, not silent ones.

**Monitoring / logging.** `docs/INGESTION_ARCHITECTURE.md` §15 (lines 440–450): "**No
Prometheus or Grafana is installed, and none should be deployed for v1** — every metric
below is derivable by query or by an existing command," followed by a table of metrics
derivable from `idauto_submissions`, `media-ops.js audit`, and process logs. The same
section: "**Required before public exposure:** a scheduled `media-ops.js audit` with
alerting on non-zero `missing_objects`... Both are cron-shaped, not a monitoring platform" —
and that scheduled job does not exist yet either (no cron/systemd unit is referenced as
installed anywhere in the sources). **Classification: BLOCKED** for the pre-public-exposure
requirement stated in the document's own words; **TECHNICAL DEBT** for the deliberate
no-monitoring-stack design choice, which is a stated decision, not an oversight.

**Recovery.** Restore has been proven exactly once, for the database, in an isolated
container (`ops/runbooks/OFF_HOST_BACKUP_GATE.md` §4.I–J, §6 gate E). No recovery runbook
has been exercised against the live production path (all restores were into throwaway,
`--network none` containers by design — `SECURITY.md` line 96–97: "Restore tooling refuses...
any path inside the repository"). **Classification: TECHNICAL DEBT** — proven in isolation,
never exercised as a live-incident drill.

---

## G. Gate summary table

| Gate | Classification | Evidence | What unblocks it | Owner of unblock |
|---|---|---|---|---|
| A1. Real authentication (IDA-2E→IDA-7) | **BLOCKED** — REQUIRED | `docs/ROADMAP.md` L99–110; `docs/IDENTITY_ARCHITECTURE.md` header, §8 | Build W3C DID/VC auth at IDA-7, **or** an IDA-4-scoped interim mechanism | Engineering + owner decision |
| A2. Authorization model | **BLOCKED** — REQUIRED | `docs/IDENTITY_ARCHITECTURE.md` §8 ("NOT STARTED") | Design and implement beyond role comparison | Engineering |
| A3. Session/token model | **BLOCKED** — REQUIRED | No document describes one; admin stub is not a session model | Build alongside real auth | Engineering |
| A4. Service identity (`svc_`) | **TECHNICAL DEBT** — not REQUIRED to gate IDA-4 | `protocol/vocabularies/actor-identifier.v1.json`; `docs/IDENTITY_ARCHITECTURE.md` §4, §8 | Mint and validate real UUIDv7 identifiers (§6 migration procedure) | Engineering |
| A5. Admin-stub vs. public write path (structural question) | **OWNER DECISION** — REQUIRED | `docs/IDENTITY_ARCHITECTURE.md` §2; `docs/ROADMAP.md` L188–206 | Owner chooses: wait for IDA-7, or authorise an interim mechanism | Owner + Stage 5 architecture |
| B. All 16 LEGAL-REVIEW-REQUIRED items | **LEGAL REVIEW** — REQUIRED for the items tagged IDA-4 (#6, #7, #9, #16); informational for others | §B.1 table, full citations | Qualified legal counsel review, per item | Legal counsel |
| C1. Owner/vehicle separation | **READY** | `docs/PRIVACY_ARCHITECTURE.md` §1–2; test-enforced | — | — |
| C2. Public/private scope (`access_scope`) | **READY** (naming split = TECHNICAL DEBT) | `docs/PRIVACY_ARCHITECTURE.md` §3 | IDA-7 rename (cosmetic, not blocking) | Engineering, deferred |
| C3. Document privacy (storage/access) | **READY** | `docs/CAPTURE_PIPELINE.md` §5 | — | — |
| C4. Deletion/correction mechanics | **BLOCKED** — REQUIRED | Not implemented; legal basis unresolved (§B #6) | Build tombstone erasure path + legal basis | Engineering + legal counsel |
| C5. Access controls (audit-on-read) | **BLOCKED** for the designed model; READY for exclusion-only | `SECURITY.md` L102–113; `docs/ROADMAP.md` IDA-2C | Build audit-on-read | Engineering |
| D1. System-wide threat model | **BLOCKED / TECHNICAL DEBT** — not REQUIRED to gate IDA-4 narrowly, but a real gap | Only `docs/INGESTION_ARCHITECTURE.md` §8 exists, scoped to ingestion abuse | Write a system-wide threat model | Engineering |
| D2. Abuse model | **READY** for submission volume; **BLOCKED** for citizen-identity abuse | `docs/INGESTION_ARCHITECTURE.md` §7–8; `docs/ROADMAP.md` IDA-3C | Real accounts to model abuse against (depends on A1) | Engineering, depends on A1 |
| D3. Fraud model (ownership/transfer) | **BLOCKED** — REQUIRED | No document defines one; `docs/RISK_REGISTER.md` `R-D05` | Design and document | Engineering |
| D4. Evidence integrity | **READY** | `docs/ARCHITECTURE.md` AD-4, AD-8; `docs/ROADMAP.md` IDA-2D/2F; `SECURITY.md` | — | — |
| D5. Verifier security | **BLOCKED** — gates IDA-8, not IDA-4 | `docs/BLOCKCHAIN_ARCHITECTURE.md` §8–9 | Build and publish independent verifier | Engineering, later stage |
| E. Public endpoint readiness | **BLOCKED** — REQUIRED | `docs/INGESTION_ARCHITECTURE.md` §22–23; `docs/ROADMAP.md` L181–184 | A1 + all B items relevant to the exposed surface | Owner + legal + engineering |
| F1. Database backup | **READY** | `ops/runbooks/OFF_HOST_BACKUP_GATE.md` §6, all 7 conditions MET | — | — |
| F2. Backup schedule | **TECHNICAL DEBT** — REQUIRED before scaling, not before schema work | `docs/ROADMAP.md` "Consolidated blockers"; batch is 5 days old as of this audit | Install recurring schedule (OWNER-GATE-B2, external) | Owner |
| F3. Media off-host backup | **TECHNICAL DEBT** — REQUIRED before citizen media uploads at IDA-4 | `SECURITY.md` L109–110 | Run and verify a media backup batch | Owner + engineering |
| F4. Monitoring/alerting for public exposure | **BLOCKED** — REQUIRED per the document's own words | `docs/INGESTION_ARCHITECTURE.md` §15 | Install the scheduled `media-ops.js audit` + alerting | Engineering |
| F5. Recovery (live-path drill) | **TECHNICAL DEBT** | Only isolated-container restores proven | Exercise a drill against a realistic recovery path | Engineering |

---

## H. Verdict

**IDA-4 implementation of any citizen-facing write path is BLOCKED.** Deriving this directly
from §G: two REQUIRED gates are not READY — **A** (real authentication; also gated by the
A5 owner decision on which path to take) and **B** (legal review, specifically items #6, #7,
#9, and #16, which the roadmap itself attributes to IDA-4). §C4 (deletion/correction
mechanics) and §D3 (fraud model) are also BLOCKED and REQUIRED, but both are themselves
downstream of A and B — a correction/deletion mechanism cannot be finished without both a
real identity to correct/delete against (A) and a resolved legal basis for doing so (B #6),
and a fraud model against ownership/transfer cannot be meaningfully built before real
identities exist to defraud (A).

**Minimal unblock set, in the dependency order the sources imply:**

1. **Owner decision (A5):** commit to either "IDA-4 waits for IDA-7's real auth" or
   "IDA-4 gets a scoped interim auth mechanism, built and reviewed as its own piece of
   work." Nothing else in this list can be sequenced sensibly until this is decided.
2. **Legal review of items #6, #7, #9, and #16** (§B.1) — data correction/deletion rights,
   retention periods, super-admin governance, and owner-identity processing. These four are
   the ones the sources themselves attribute to IDA-4, independent of which auth path is
   chosen.
3. **Build real authentication** per whichever path #1 selects (A1, A2, A3).
4. **Build the deletion/correction mechanism (C4)** and **the ownership/transfer fraud
   model (D3)**, both of which depend on #1 and #2 being settled first.
5. Before any citizen media upload activates: **a media off-host backup batch (F3)**, since
   IDA-4 is the first stage where citizens — not just admins — would be writing evidence
   into the media store.

**What is arguable, and explicitly not pre-judged by this audit:** schema/protocol
groundwork that creates **no reachable write path** — e.g. drafting the formal IVID format
(`docs/ROADMAP.md` line 195, already "SPECIFIED"), designing the person-store schema
separate from the vehicle store, or writing the migration plan for `internal_ref` → IVID —
does not itself require A or B to be READY, because none of it is public-reachable and none
of it processes a real person's data yet. Whether that counts as "IDA-4 implementation" is a
scoping question for whoever authorises Stage 5, not something this audit's evidence can
settle either way. The one thing the evidence does settle is the citizen-facing surface:
**that is BLOCKED**, on A and B, until the minimal unblock set above is worked through.

---

## I. Readiness recheck — 2026-08-19, post gate-closure mission (branch gate-closure)

Recomputed after: the PR stack merge (main `24a28dd`), the A5 evaluation, the legal gate
matrix (`IDA4_LEGAL_GATE_MATRIX.md`), and the backup-gate status pass. Every change from the
original table is listed; unchanged gates are not restated.

| Gate | Was | Now | Why |
|---|---|---|---|
| A5 admin-stub vs public path | OWNER DECISION | **DECIDED — 2026-08-19** | The owner decision text, recorded verbatim: *"APPROVE OPTION C. Proceed with the zero-account IDA-4 public passport surface: IVID issuance, passport assembly, IVID-only QR resolution, never resolve by plate, no citizen PII, credential is never the vehicle/person identifier, apply the approved rate limiting and threat-model controls."* This closes the A5 decision gate itself — it does not by itself flip §E (public endpoint readiness) or `CITIZEN_FACING_IDA4_READY`, both of which remain gated on legal review (§B) independent of A5. See §J for the resulting branch. |
| B. Legal | LEGAL REVIEW (enumerated) | **LEGAL REVIEW — matrix + counsel package exist; 16/16 OPEN, 0 APPROVED** | `IDA4_LEGAL_GATE_MATRIX.md` (L01–L16, full field set) and `IDA4_LEGAL_REVIEW_PACKAGE.md` (engineering facts for counsel). The four citizen-surface blockers: **L06, L07, L09, L16** (L16 by the §B.3 argument, not by the roadmap table — stated in the matrix) |
| D1. Threat model | BLOCKED / TECH DEBT (no doc) | **Document exists** (`THREAT_MODEL.md` v1, with the transfer fraud section) — runtime controls it identifies remain PLANNED/gated | Written in the foundation subset |
| D3. Fraud model | BLOCKED | **Documented** (THREAT_MODEL §6); runtime enforcement remains gated on A2 authorization | ibid. |
| F1. DB backup | READY (ageing) | READY — **ageing further**; refresh is OWNER-GATE-B1 | No credential exists in any development environment (re-verified); B1/B2/B3 formally owner-blocked in mythos-prod `OFF_HOST_BACKUP_GATE.md` §8. B2's **cadence is itself undefined in every policy document** — an owner decision inside the owner gate |

**A5 is a decision gate and it is now fully teed up: the exact decision text, the option
analysis, and a recommended default are on file. It is not, and cannot be, closed by
engineering.**

### CITIZEN_FACING_IDA4_READY = **NO**

Mandatory gates still open: **A** (no real authentication; A5 undecided) · **B** (L06, L07,
L09, L16 all OPEN — zero legal evidence on file) · **E** follows from A+B.
`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**. Nothing in the merged stack, the
matrix, or the evaluation changes this — partial completion does not infer readiness.

**What would flip it to YES:** an owner decision on A5 that yields an implemented,
reviewed authentication + authorization path (or option-C scoping that removes the account
requirement for a defined sub-surface, which would make that sub-surface — and only it —
implementable); legal APPROVED (with evidence) on L06, L07, L09 and a counsel ruling on
L16's applicability; then a pre-public Opus review and independent audit of the actual
implementation.

---

## J. Option C implementation exists on branch `ida4-option-c` — pending review (2026-08-19)

Following the A5 decision recorded in §I's updated row, an implementation of the
owner-approved Option C surface has been built on branch `ida4-option-c`: IVID issuance
(`reference/ivid-issuance.js`), a new migration adding `idauto_vehicles.ivid`
(`database/migrations/ida4-option-c-ivid.sql`), and the first and only unauthenticated route,
`GET /public/passport/:ivid`, in `reference/api.js` — IVID-only resolution, no plate path
anywhere on the surface, a format gate before any database touch, its own rate-limit bucket
(`config/idauto.example.json`'s `public_resolution` section), scope hardcoded to `public`
with SQL-level `access_scope='public'` defense-in-depth, and a `qr.payload === ivid`
assertion before every response. Test suite: `tests/ida4-option-c-test.js` (live database,
47 assertions, 0 failures at last run).

**This closes no gate above.** It is an implementation of the sub-surface §H's "arguable"
paragraph and §H's "what would flip it to YES" note already anticipated — a defined
sub-surface with no account requirement — but it does not itself constitute the "pre-public
Opus review and independent audit" §H names as still required, nor does it touch legal
review (§B) at all, since the surface it implements was chosen specifically to avoid
collecting citizen PII or requiring L06/L07/L09/L16 to be answered.

**Explicitly unchanged by this branch:** `CITIZEN_FACING_IDA4_READY` stays **NO**.
`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` stays **NO**. No deployment occurred; no production
activation occurred; every legal gate above remains exactly as recorded in §B and §I. This
branch is engineering work product awaiting review, not a readiness change.
