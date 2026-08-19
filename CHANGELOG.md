# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The protocol is versioned separately from the implementation; see
[`GOVERNANCE.md`](GOVERNANCE.md) §3.

---

## 2026-08-19 — ida4-option-c: IVID issuance + the IVID-only public passport surface

A5 OPTION C, owner-approved. Implements the zero-account IDA-4 public passport surface on
branch `ida4-option-c` (not merged to `main`, not deployed): IVID issuance
(`reference/ivid-issuance.js`, permanent once issued, `system`-actor audit rows), a new
migration (`database/migrations/ida4-option-c-ivid.sql`, adds `idauto_vehicles.ivid`), and
`reference/api.js`'s first and only unauthenticated route, `GET /public/passport/:ivid` —
IVID-only lookup (never plate), a format gate before any database touch, its own rate-limit
bucket (`config/idauto.example.json`'s `public_resolution` section), scope hardcoded to
`public` with SQL-level `access_scope='public'` defense-in-depth, and a
`qr.payload === ivid` assertion before every response. `tests/ida4-option-c-test.js`: 47
live-database assertions, 0 failures; `tests/ida4-foundation-test.js` remains 130/0;
`tests/identity-conformance-test.js` remains 81/0. All 86 existing vehicles in the live
database now carry a permanent IVID (`issueMissing()`), applied as part of this stage's own
test run, per the task's explicit allowance to add the column and issue IVIDs against real
operational data. Docs updated: `docs/IDA4_READINESS_AUDIT.md` (A5 row -> DECIDED, quoting
the owner decision verbatim, new §J), `docs/ROADMAP.md` (dated note), `docs/THREAT_MODEL.md`
(§5 QR-resolution row marked IMPLEMENTED with file/line references). `CITIZEN_FACING_IDA4_READY`
stays NO. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` stays NO. No deployment, no production
activation, no legal gate touched.

## 2026-08-19 — gate-closure: readiness recheck + A5 evaluation recorded

PR stack merged to main (merge commits; pin provenance verified). docs-only additions: legal gate matrix (16 OPEN), counsel review package, readiness recheck §I — CITIZEN_FACING_IDA4_READY = NO. A5: owner decision required, recommended default option C. No implementation.

## [Unreleased]

### Added — GATE-CLOSURE Phase 7-8: IDA-4 legal gate matrix + counsel review package (2026-08-19)

docs(legal): IDA-4 legal gate matrix + counsel review package — 16 items, all OPEN.
Docs-only. No legal advice; engineering facts and classifications only. No item is
`APPROVED` — approval requires legal evidence that does not exist yet.

- **[`docs/IDA4_LEGAL_GATE_MATRIX.md`](docs/IDA4_LEGAL_GATE_MATRIX.md)** — every one of the
  16 `LEGAL-REVIEW-REQUIRED` items found by `docs/IDA4_READINESS_AUDIT.md` §B (renumbered
  `L01`–`L16` in the audit's own order), each with feature, legal question, affected
  data/users, jurisdiction, current status, required decision, evidence, owner and
  dependency. Status vocabulary: `OPEN` / `UNDER_REVIEW` / `APPROVED` / `REJECTED` /
  `NOT_APPLICABLE` / `OWNER_DECISION` — engineering can never set `APPROVED`.
- **[`docs/IDA4_LEGAL_REVIEW_PACKAGE.md`](docs/IDA4_LEGAL_REVIEW_PACKAGE.md)** — the
  counsel-facing engineering-facts package: what IDauto is, the full data inventory per
  record type, data flows (ingestion, review queue, media storage, off-host backup),
  public/private visibility mechanics, consent & rights mechanics (specified vs
  implemented), per-topic fact sheets mapped to the matrix, and what engineering needs back
  from counsel.
- All 16 items are `OPEN`. **Four block the citizen-facing IDA-4 surface directly**: `L06`
  (data correction/deletion rights), `L07` (retention periods, all categories), `L09`
  (operator super-admin access governance policy), `L16` (owner identity processing) — this
  is verified against `docs/IDA4_READINESS_AUDIT.md` §B's own mapping (items `#6`, `#7`,
  `#9`, `#16`), not merely asserted.
- `docs/RISK_REGISTER.md` gains `R-S08` (the 16-item legal gate) and `R-S09` (the A5 owner
  decision, still pending).

### Added — Stage preparation verification, IDA-5 through IDA-9 + Part Identity (2026-08-19)

docs: verify stages IDA-5..IDA-9 + part-identity preparation state. A documentation-only
preparation/verification pass for master-mission Stages 8–12 — no implementation, no schema
change. Adds [`docs/STAGE_PREPARATION_IDA5_TO_IDA9.md`](docs/STAGE_PREPARATION_IDA5_TO_IDA9.md),
which classifies every required element of IDA-5 (professional issuers), IDA-7 (VC/DID),
IDA-8 (anchoring), IDA-9 (open protocol) and Part Identity as PREPARED / PARTIAL / OPEN, each
with a file+section citation. Incorporates the IDA-4 architecture review's binding findings,
and records one correction to it: the review's untyped `credentials.items: {}` placeholder
gap is attributed to `issuer.schema.json`, which has no such field — the actual placeholder
is `passport.schema.json`'s `credentials` array. The onboarding-process gap for professional
issuers (who verifies a garage is a garage) is recorded as the top open item for Stage 8.

### Added — IDA-4 gate-free foundation subset (2026-08-19)

feat(ida4): gate-free foundation subset — IVID library, protocol artifacts, passport
assembly, threat model. Implements exactly the architecture review's approved subset of
IDA-4: no reachable write path, no person data, no legal question answered or presupposed.
The citizen-facing surface remains BLOCKED on the authentication and legal gates recorded in
`docs/IDA4_READINESS_AUDIT.md`.

- **Schema fixes** (`protocol/schemas/`, additive/clarifying only): `passport.schema.json`
  and `anomaly.schema.json` required-field additions (`completeness_note`/`qr`,
  `statement`); `ownership-transfer.schema.json` gains an optional `supersedes` field,
  mirroring `fact.schema.json`'s; the `ivid` pattern's payload bound is `{16,}` → `{16,30}`,
  so the maximum IVID string fits `internal_ref VARCHAR(40)` exactly; `protocol/README.md`
  gains a dated subsection reconciling `additionalProperties: false` against OVIP §13's
  round-trip preservation duty, cross-referenced from OVIP §13 itself.
- **`reference/ivid.js`** — IVID issuance/validation library (Crockford base32, no I/L/O/U;
  ≥5 pinned check-symbol test vectors; `generate`/`validate`/`parse`/`checkSymbols`). Pure,
  no persistence.
- **Two new protocol artifacts** — `protocol/schemas/holder-ref.schema.json` (the opaque
  holder-reference boundary; forbids person fields; person store explicitly out of protocol
  scope) and `protocol/schemas/tombstone.schema.json` (erasure record per
  `PRIVACY_ARCHITECTURE.md` §6 / OVIP §10.3, without retaining erased content). MAPPING.md
  updated.
- **`reference/passport-assembly.js`** — pure Digital Vehicle Passport assembly function:
  scope filtering (public/professional/mythos_private), `trust_summary` with a separate
  `anchored` count (never a T4 key), an always-present `completeness_note`, and a `qr`
  payload that is always exactly the vehicle's IVID.
- **`docs/IVID_MIGRATION_PLAN.md`** + **`database/migrations/ivid-migration-dry-run.js`** —
  the plan (PLAN ONLY, NOT EXECUTED) and its dry-run tool, which refuses to run if any
  `IDAUTO_DB_*` environment variable is set and takes no database connection.
- **`docs/THREAT_MODEL.md`** — version 1 system-wide threat model, including the
  ownership-transfer fraud model (stolen-vehicle laundering, coerced transfer, fake seller,
  replay, backdated `effective_at`, supersession abuse), an honest-gaps section, and the AI
  boundary (detection routes to review; never declares fraud).
- **`tests/ida4-foundation-test.js`** — 130 offline, env-free assertions.
- **Docs pass:** `BLOCKCHAIN_ARCHITECTURE.md` §8 backup-status correction; `MAPPING.md`'s
  `subject_ref` note aligned with `ROADMAP.md` IDA-7 ("scheduled deliberately"); `ROADMAP.md`
  IDA-4 section gains a dated note naming exactly what is IMPLEMENTED versus what remains
  BLOCKED — IDA-4 itself is NOT marked implemented.

Validated: `tests/ida4-foundation-test.js` 130/0; `tests/identity-conformance-test.js` 81/0
(unchanged); `tests/ida-2a-schema-and-plate-validation-test.js` 44/0 (unchanged); the three
`protocol/vocabularies/*.json` digests unchanged.

### Added — IDA-4 readiness audit (2026-08-19)

docs(audit): IDA-4 readiness audit — every gate classified with evidence in
`docs/IDA4_READINESS_AUDIT.md`; docs-only, no implementation. Verdict: citizen-facing IDA-4
write path BLOCKED on real authentication (IDA-2E→IDA-7) and 16 distinct legal-review items
(4 of them roadmap-attributed to IDA-4 directly); reconciles this audit's own enumeration
(16 distinct items) against `docs/ROADMAP.md`'s stated 15.

### Added — identity vocabularies (2026-08-18)

feat(protocol): publish identity vocabularies — actor-type.v1, org-role.v1,
actor-identifier.v1; schema conformance suite tests/identity-conformance-test.js; no schema
change, no runtime change.

### Published — 2026-08-18

`othoth77/idauto` created; the audited tree published to `main` verbatim as the repository's
initial commit (`bdfec2c`, tree `26b93fb8`, 91 files). Verified from a **clean clone**:
commit and tree hashes match, all 91 files byte-identical to the audited tree, `npm install`
from the published lockfile, a freshly created PostgreSQL 16 database, and **13 suites /
601 assertions / 0 failures**.

This repository is now the canonical home of IDauto. The duplicated source in
`othoth77/mythos-prod` is removed by a separate draft pull request there.


### Added — standalone repository and Open Vehicle Identity Protocol (2026-08-18)

Extracted from `othoth77/mythos-prod` (`projects/idauto/`) into `othoth77/idauto` and
repositioned as an open vehicle identity and history protocol.

**Protocol (`0.1.0-draft`, SPECIFIED — not implemented)**

- `docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` — canonical entities, identifiers, lifecycle
  rules, and the append-only invariant
- `docs/TRUST_MODEL.md` — the T0–T4 ladder, with T4 kept orthogonal to T0–T3
- `docs/PRIVACY_ARCHITECTURE.md` — public/private boundary, erasure, surveillance limits
- `docs/BLOCKCHAIN_ARCHITECTURE.md` — chain-neutral, optional, Merkle-batched anchoring
- `docs/PART_IDENTITY.md` — part identity as a future extension
- `protocol/schemas/` — 12 JSON Schemas plus the protocol↔implementation mapping
- `protocol/events/` — the event vocabulary
- `protocol/credentials/` — W3C VC and DID profile
- `protocol/verification/` — the eight-step verification specification

**Strategy and governance**

- `docs/ROADMAP_EVOLUTION_2026-08-18.md` — the seventeen strategic decisions, with reasoning
- `docs/OPEN_SOURCE_STRATEGY.md`, `docs/BUSINESS_MODEL.md`, `docs/GO_TO_MARKET.md`
- `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md`
- `docs/ROADMAP.md` extended from IDA-6 to IDA-9, with completed stages preserved
- `README.md` rewritten around the protocol identity

**Migration record**

- `docs/MIGRATION_FROM_MYTHOS_PROD.md` — inventory, path mapping, dependency classification
- `docs/STANDALONE_MIGRATION_AUDIT.md` — validation evidence
- `docs/AI_HANDOVER.md` — 25 implementation-record sections extracted verbatim

### Changed

- Deployment paths in `ops/` are now environment-driven; no `/home/deploy` default remains
- Restore guards generalised from a hardcoded `/home/deploy` to a rule refusing any user
  home root — same protection, every host
- `package.json` renamed from `@mythos/idauto` to `idauto`, unscoped and no longer private
- Documentation headers reflect the new repository, with provenance retained

### Fixed

- Repository-root computation in `ops/media-ops.js` and `ops/offhost-backup.js`, which
  assumed `ops/` sat three levels below the repository root. The "refuse to restore inside
  the repository" guard would otherwise have pointed at the wrong directory after the move

### Preserved unchanged

The IDA-0 → IDA-3 baseline: the 24-table schema, observation-first capture, three access
scopes, the API with atomic audit logging, content-addressed media, the ingestion service,
rate limiting, the review queue, off-host backup tooling, and all 13 test suites
(601 assertions, 0 failures in the new layout).

Blockers moved with the code and were not dropped: **IDA-2E** (real authentication) remains
blocked, and every LEGAL-REVIEW-REQUIRED item remains open.

### Corrected on 2026-08-18, after the completeness audit

The first pass of this migration reported **IDA-3F (off-host backup) as BLOCKED with no
off-host copy in existence.** That was wrong. It relied on the IDA-3F stage entries of
2026-08-12 without scanning forward for later entries that superseded them: on **2026-08-14**
the object-store destination was provisioned, a transport defect in the S3 adapter was found
and fixed, and a verified off-host backup of the database was created and restore-tested.
The gate closed the same day. Corrected throughout, and the five superseding handover entries
have been added to `docs/AI_HANDOVER.md`.

Also added in the same pass, after the audit found them missing: `docs/RISK_REGISTER.md`
(8 IDauto-owned open risks plus 9 cross-product), `docs/IDENTITY_ARCHITECTURE.md`, and
`ops/runbooks/OFF_HOST_BACKUP_GATE.md`.

---

## History before 2026-08-18

Stages IDA-0 through IDA-3 were executed in `othoth77/mythos-prod` between 2026-08-05 and
2026-08-12. The verbatim record, including commit hashes resolvable in that repository, is
in [`docs/AI_HANDOVER.md`](docs/AI_HANDOVER.md). The stage-level summary is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).
