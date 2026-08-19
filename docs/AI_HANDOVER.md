# IDauto — Implementation Record (AI Handover)

**This is the preserved implementation history of ID Auto**, extracted verbatim from
`othoth77/mythos-prod`'s `docs/AI_HANDOVER.md` on 2026-08-18 when the project was moved into
this standalone repository.

**Nothing below has been edited.** Commit hashes, dates, test counts, blockers, mistakes,
things that were refused and things that were got wrong are all as originally recorded.
Entries are newest first, matching the source file's ordering. Every entry covers an ID Auto
stage (`IDA-*`) or ID Auto operational tooling (`IDAUTO-*`).

Two consequences of preserving it verbatim, worth stating so nothing here misleads:

- **Paths are as-they-were.** Entries refer to `projects/idauto/…`, `docs/IDAUTO_*.md` and
  deployment paths under `/home/deploy/…`. Those are the *historical* locations. The
  current locations are in
  [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md).
- **Commit hashes refer to `othoth77/mythos-prod`**, not to this repository. This
  repository begins with a fresh history; the commits named below are resolvable only in
  the origin repository.
- **Some links below do not resolve here**, for the same reason: they point at documents at
  their origin-repository paths, or at documents that were deliberately not migrated. That
  is a consequence of preserving the text unedited, not an oversight.

For the current state, read [`ROADMAP.md`](ROADMAP.md). For what changed on 2026-08-18, read
[`ROADMAP_EVOLUTION_2026-08-18.md`](ROADMAP_EVOLUTION_2026-08-18.md).

---

## IDA4-FOUNDATION-SUBSET — GATE-FREE FOUNDATION SUBSET OF IDA-4 (2026-08-19) — PASS

**Branch:** `ida4-foundation` @ `f649398` (on top of the `ida4-readiness` audit). Implements
exactly the subset the architecture review approved from
[`IDA4_READINESS_AUDIT.md`](IDA4_READINESS_AUDIT.md) §H: schema/protocol groundwork that
creates NO reachable write path, processes NO real person's data, and answers/presupposes NO
legal question. **IDA-4 itself is NOT marked implemented** — see `ROADMAP.md`'s IDA-4 section
for the item-by-item status this entry does not duplicate.

**In the boundary (7 items, all delivered):**

1. Schema-defect fixes in `protocol/schemas/` — `passport`/`anomaly` required-field
   additions, `ownership-transfer.supersedes`, the IVID pattern bound `{16,}` → `{16,30}`,
   and a dated `protocol/README.md` subsection reconciling `additionalProperties: false`
   against OVIP §13 (cross-referenced from §13 itself).
2. `reference/ivid.js` — pure IVID issuance/validation library, Crockford base32 (verified
   character-for-character identical to the schema's own class), a from-scratch weighted
   check-symbol algorithm (proven in the file header to catch every single-symbol
   substitution and every adjacent transposition of distinct symbols, for payloads up to the
   30-symbol bound), ≥5 pinned test vectors.
3. `protocol/schemas/holder-ref.schema.json` and `protocol/schemas/tombstone.schema.json` —
   additive protocol artifacts, `MAPPING.md` updated with both rows.
4. `reference/passport-assembly.js` — pure passport-assembly function (no I/O, no clock read
   beyond an injected `now`): scope filtering, `trust_summary` (T0-T3 + separate `anchored`,
   never a T4 key), always-present `completeness_note`, `qr.payload` structurally forced
   equal to `vehicle.ivid`.
5. `docs/IVID_MIGRATION_PLAN.md` (PLAN ONLY — NOT EXECUTED) and
   `database/migrations/ivid-migration-dry-run.js` (no DB connection; refuses to run if any
   `IDAUTO_DB_*` env var is set — proven by a child-process test).
6. `docs/THREAT_MODEL.md` — version 1, system-wide, including the ownership-transfer fraud
   model with an explicit structurally-prevented-vs-needs-runtime-control split per scenario,
   and the AI boundary (detection routes to review, never declares fraud).
7. `tests/ida4-foundation-test.js` — **130 assertions, 0 failures**, offline and
   environment-variable-free except for one deliberate child-process invocation that sets a
   fake `IDAUTO_DB_HOST` to prove the migration dry run's refusal guard fires.

**Explicitly NOT done (out of the approved boundary, deliberately):**

- The citizen-facing surface itself: no HTTP route, no citizen registration, no person-store
  table, no auth mechanism. `docs/IDA4_READINESS_AUDIT.md` §A (real authentication) and §B
  (16 LEGAL-REVIEW-REQUIRED items, 4 attributed to IDA-4) remain exactly as BLOCKED/LEGAL
  REVIEW as that audit found them — this stage moves neither gate.
- No live-database migration execution — `ivid-migration-dry-run.js` takes no DB connection
  by construction and the plan is explicitly marked PLAN ONLY.
- No media upload path of any kind.
- Person store schema/table — `holder-ref.schema.json` specifies the reference boundary
  only; the store it points at remains unbuilt and out of protocol scope by design.

**Validation:** `tests/ida4-foundation-test.js` 130/0 (new).
`tests/identity-conformance-test.js` 81/0 (unchanged by the schema `required`-array
additions — no conformance assertion in that suite reads the affected fields).
`tests/ida-2a-schema-and-plate-validation-test.js` 44/0 (unchanged; that suite does not read
`protocol/schemas/`). The three `protocol/vocabularies/*.json` digests are byte-identical to
before this stage (`1df70435…`, `18e64fc5…`, `923b59ab…`) — none of those three files was
touched.

**No route, table, or auth mechanism was added.** `git status` after this stage's single
commit shows only the files listed above plus the docs updated to describe them (
`docs/BLOCKCHAIN_ARCHITECTURE.md` §8 backup-status correction, `MAPPING.md`'s `subject_ref`
alignment with `ROADMAP.md` IDA-7, `ROADMAP.md`'s own IDA-4 dated note, this entry,
`CHANGELOG.md`).

---

## IDA4-READINESS-AUDIT — GATE AUDIT BEFORE IDA-4 IMPLEMENTATION (2026-08-19) — DOCS-ONLY

**Branch:** `ida4-readiness` @ `350792b` (two commits ahead of `main` @ `bdfec2c`, not
merged). **Read-only audit; no implementation.** Deliverable:
[`IDA4_READINESS_AUDIT.md`](IDA4_READINESS_AUDIT.md) — every IDA-4 prerequisite gate
(authentication, legal review, privacy, security, public-endpoint readiness,
infrastructure) classified as READY / BLOCKED / LEGAL REVIEW / OWNER DECISION / TECHNICAL
DEBT, each with a file+section citation.

**Verdict:** citizen-facing IDA-4 implementation (self-registration, passport creation,
holder association, erasure) is **BLOCKED**. Two REQUIRED gates are not READY: real
authentication (IDA-2E, re-scoped to IDA-7 — unchanged since `docs/ROADMAP.md`) and legal
review, specifically the 4 of 16 distinct LEGAL-REVIEW-REQUIRED items the roadmap itself
attributes to IDA-4 (data correction/deletion rights, retention periods, super-admin
governance, plus one item this audit's own enumeration recovers — "owner identity
processing" from `docs/PRODUCT_SPEC.md` §12 — which is not carried into `docs/ROADMAP.md`'s
consolidated 15-item table). Schema/protocol groundwork that creates no reachable write path
is arguable and explicitly not pre-judged either way.

**Discrepancy found, recorded rather than resolved:** this audit's enumeration of distinct
LEGAL-REVIEW-REQUIRED items totals **16**, one more than `docs/ROADMAP.md`'s stated 15 (also
independently claimed by `docs/MIGRATION_FROM_MYTHOS_PROD.md` line 197). The extra item is
`docs/PRODUCT_SPEC.md` §12's "Owner identity processing" row, present since IDA-1
(2026-08-05) and apparently dropped, not resolved, during the roadmap's later
consolidation. No document was edited to fix this — it is recorded as a finding.

**No implementation occurred.** No schema, API, or runtime change. `main` untouched.

---

## IDA-DECOUPLE-3 — PUBLISH IDENTITY VOCABULARIES (IDauto side) (2026-08-18) — PASS

**What was published.** Three vocabulary data documents under `protocol/vocabularies/` —
`actor-type.v1.json`, `org-role.v1.json`, `actor-identifier.v1.json` — publishing the
`actor_type`, `org_role` and actor-identifier value spaces that were previously only
expressible by reading `database/schema.sql` directly. They are data documents, not JSON
Schemas (deliberately no `$schema`, no `$id`), status `stable` at `v1`, versioned
independently of the OVIP `0.1.0-draft` protocol as a whole. A new offline, environment-free
suite, `tests/identity-conformance-test.js`, asserts schema.sql and the artifacts agree:
both named `actor_type` CHECK sites, every CHECK site identical, `chk_user_role`, all four
`VARCHAR(64)` actor-reference columns (a failed lookup fails, never skips), storage widths,
artifact byte hygiene, and the `identity.js` no-auth invariant moved here from `mythos-prod`
behind an explicit non-emptiness precondition so it can never pass vacuously. Result:
**77 passed, 0 failed**.

**Why.** Stage `IDA-DECOUPLE-3`. The `mythos-prod` `MYTHOS-IDENTITY-CORE-0` contract test
currently reads IDauto internals directly (`projects/idauto/database/schema.sql`,
`projects/idauto/reference/identity.js`) across the repository boundary — the coupling this
stage removes. With these artifacts published and pinned by version and SHA-256 of the raw
file bytes, the Mythos side stops reading IDauto internals and drift now fails loudly on
whichever side actually drifted, rather than silently on whichever side reads the other's
files.

**Classification.** Additive per `GOVERNANCE.md` §3 — new files, no existing field removed,
renamed, or given new semantics. Reasoning recorded per `GOVERNANCE.md` §7.

**No schema change. No API change. No runtime change.** `main` is untouched — this work is
entirely on branch `protocol-identity-vocabularies`, pushed to origin; `main` advances only by pull request.

---

> **These five entries were added to the extraction on 2026-08-18 after an audit found them
> missing.** They post-date the IDA-3F entries below and **supersede them**: they record that
> the off-host destination was provisioned, that the S3 adapter's default transport was found
> never to have worked over a real network, and that a verified off-host backup of the
> `idauto` database now exists. Their scope spans three production databases, of which
> `idauto` is one; they are reproduced whole rather than excerpted. See
> [`ROADMAP.md`](ROADMAP.md) IDA-3F for the resulting status.

## FINAL VPS INVENTORY RECONCILIATION (2026-08-14) — PASS · GATE CLOSED

**The OFF-HOST-BACKUP-GATE is CLOSED.** Condition G — the last open one — was met by this reconciliation; A–F were met by the R2 provisioning, the batch-`20260814T161856Z` execution, and the owner's PC-gate declaration. The gate table in `docs/OFF_HOST_BACKUP_GATE.md` §6 is updated with per-condition evidence.

### Reconciliation results (all read-only)

| Check | Result |
|---|---|
| Git | HEAD `a5e46223ebd0ef96636d946ee8667b4a3b7c0c5c` == origin/main, worktree clean, 0 staged, 0 untracked |
| R2 backups | **3/3 verified by signed HEAD metadata** — sizes and sha256 metadata match recorded C1 for all three; bucket holds exactly 3 objects, nothing was re-downloaded |
| Temp backup files | 0 (`/var/backups/mythos` empty, verify dir removed, no `/tmp` artefacts) |
| Temp restore containers / volumes | 0 / 0 |
| Docker census | containers/volumes **identical to the pre-backup baseline**, networks 9, 0 unhealthy, 26 running |
| Production DBs | all healthy, 0 restarts; idauto **24 tables / 2,551 rows** (pre-backup baseline identical), coolify 66 tables, darhijama_prod 39 tables |
| Coolify stack | coolify, coolify-db, coolify-redis, coolify-realtime, coolify-sentinel — all healthy |
| Credentials | 0 tracked, 0 in any project file (verified by direct value comparison, tracked **and** untracked); config outside repo, owner `ubuntu`, mode `0600` |
| Code changes from backup execution | the two commits contain exactly the authorised adapter completion (`254592b`) and documentation (`a5e4622`) — no application code beyond that, no schema, no data |

### What gate closure means — and does not mean

`migrate.js` may now be given `backupGateClosed: true` **truthfully**. The assertion stays per-run and operator-made: it becomes false again the moment backups stop being current or restore-verified. **One verified batch is not a schedule** — recurring backups, retention automation and Coolify integration remain separate, not-yet-authorised work.

### MPI runner gate status after this closure

`backupGateClosed` ✔ truthful · `pcGateClosed` ✔ owner-declared · `inventoryReconciled` ✔ this reconciliation. **The three external gates of `migrate.js` can all be truthfully asserted for the first time.** MPI production migration remains blocked on its own prerequisites: F8/F9 ratification, D1/D2/D3/D5, activation and observability decisions.

### Next stage

Owner's choice: **BACKUP SCHEDULING** (recurring off-host backups, retention, Coolify) or **MPI F8/F9 RATIFICATION → IMPLEMENTATION**. Neither may start without a separate instruction.

---

## OFF-HOST BACKUP EXECUTION (2026-08-14) — PASS

**Batch:** `20260814T161856Z` · **Destination:** R2 `mythos-offhost-backups` (bucket-scoped credential; config outside Git at mode 0600)

**For the first time in this project's history, verified off-host backups of all three production databases exist.** The full C1 → upload → fresh download → C2 → isolated-restore chain passed for every database.

### Evidence table

| Database | Format | Size | C1 = C2 (SHA-256) | R2 object | Restore test |
|---|---|---|---|---|---|
| `idauto` (PG 15.18) | `pg_dump -Fc` in-container | 199,620 B | `badc4f82f36fc2aa8c75150bbbb16f943d71991e669477b1dcb1ba5f51197c80` | `idauto/20260814T161856Z/idauto-20260814T161856Z.dump` | **PASS** — `--exit-on-error` exit 0; **24 tables / 2,551 rows, source-identical** |
| `coolify` (PG 15.19) | `pg_dump -Fc` in-container | 1,488,149 B | `6aab736f9cf0e19afdc7058f6e943c439b47a11792a752c1044e052ec2f78c10` | `coolify-db/20260814T161856Z/coolify-20260814T161856Z.dump` | **PASS** — exit 0; **66 tables**, 65 PKs |
| `darhijama_prod` (MySQL 8.4.11) | `mysqldump --single-transaction --routines --triggers --events` in-container | 64,224 B | `32e65059f46b2af8400f73c582cab90aea64137be2b642218b97321d6285e9f1` | `darhijama-prod/20260814T161856Z/darhijama_prod-20260814T161856Z.sql` | **PASS** — exit 0; **39 tables**, largest table row-count source-identical (56=56), routines/triggers 0/0 matching source |
| — | — | — | — | — | — |

Every dump was created by the utility **inside its own container** (client==server version), uploaded and downloaded through the production S3 adapter's default transport, and restored from the **downloaded** copy into isolated scratch containers (`--network none`, tmpfs, no volume, no port), then destroyed. Remote sha256 metadata on each object also matches C1.

### One defect found and fixed mid-stage (authorised deviation)

The first real upload failed with **HTTP 411 `MissingContentLength`**: Node uses chunked transfer-encoding without an explicit `Content-Length`, which R2 tolerated for the tiny connectivity object but rejects at dump size. This was the previous stage's transport fix being incomplete, and was completed under that stage's authority as its own commit (`254592b`): `transportOptions()` now takes the body length and sets `content-length` in the default transport only (not a signed header — signature undisturbed; mock contract unchanged). Pinned by test 35; IDA-3F **35/35**. **Consequence: the stage-start checkpoint `eba1690` advanced to `254592b` before the docs commit.**

Also learned, recorded for the future runbook: `mysql:8.4`'s entrypoint starts a **temporary** init server first — a restore begun after the first successful `mysqladmin ping` can be killed mid-flight when the entrypoint swaps to the final server. Wait for the *second* "ready for connections" (port 3306) line.

### Safety results

Production DBs modified **0** (post-run: idauto 24/2551, darhijama 39 — identical; all healthy, 0 restarts) · census 26/20/9 identical · temporary restore containers/volumes **0** · local dumps **removed** after off-host verification (0 remain) · credentials in Git **0** (verified by direct value comparison) · R2 holds exactly the **3** verified objects — **not deleted, they are the backups**.

### Gate consequence

Backup-gate conditions **B, C, D, E are now MET** (backup created; C1 recorded; C1==C2 on fresh download; restore-from-download proven). Combined with the live destination (A) and the owner-declared PC gate closure (F), **the OFF-HOST-BACKUP-GATE is effectively satisfied except G (final VPS inventory reconciliation)** — the runbook's `docs/OFF_HOST_BACKUP_GATE.md` §6 table should be updated at next touch. Not yet done: Coolify configuration, backup scheduling, retention automation — all explicitly out of this stage's scope.

### Next stage

**BACKUP SCHEDULING + GATE CLOSURE REVIEW** (separate instruction), then MPI F8/F9 ratification/implementation. MPI production migration remains blocked until the runner's three gates can be truthfully asserted.

---

## OFF-HOST S3 ADAPTER FIX (2026-08-14) — TRANSPORT + DELETE

**Status: FIXED, live-verified.** Scope strictly the two defects found during the R2 connectivity test. No database backup was run, no Coolify change, no schedule, no production database touched.

### Context: R2 destination is LIVE and connectivity-proven

Cloudflare R2 bucket `mythos-offhost-backups` (endpoint account `771b5c57…f`, region `auto`, bucket-scoped Object Read & Write credential) is provisioned. Credentials live **only** in `/home/ubuntu/.config/mythos/idauto-offhost.env`, mode `0600`, outside the repository — the operator supplied them via their own terminal; they were delivered in AWS-CLI key names and renamed in place to the loader's convention (`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `ENDPOINT`, `REGION`, `BUCKET`) without any value being read or printed. Verified by direct in-memory comparison: **neither credential value appears in any tracked file.**

The initial connectivity test (scratch harness) passed 10/10: upload → list → download → **SHA-256 round-trip identical** → delete (204) → bucket empty. It also exposed the two adapter defects fixed here.

### Defect 1 — default transport never worked

`s3-compatible.js` passed `{url}` to `https.request()`, whose options have **no `url` key** — Node ignored it and connected to `localhost:443` (proven: `ERR_TLS_CERT_ALTNAME_INVALID` from the local proxy). The IDA-3F suite passed 30/30 because every test injects a mock `requestImpl`; the real network path had never been exercised. **Fix:** new exported `transportOptions()` translates `{method, url, headers}` into `{hostname, port, path, method, headers}` plus a 60 s timeout that fails closed into the existing `provider unavailable` path. The injected-transport contract is unchanged, so all existing mocks remain valid.

### Defect 2 — no DELETE operation

`capabilities()` declared `delete: false`; only put/get/head/list existed, making verification round-trips impossible. **Fix:** `del()` added, `capabilities().delete` now true. **The append-only design stance is preserved where it actually lives:** core `retention()` remains report-only and never calls `del()` ("Deletion requires separate authorisation" — unchanged), and the header now records that true append-only enforcement belongs to the provider-side credential scope, not to the absence of a client method.

### Evidence

- **SigV4 `sign()` byte-untouched** — AWS published vector (test 29) still pins it; a new deterministic **DELETE vector is pinned** (test 34, fake creds, fixed date).
- **IDA-3F: 34 passed, 0 failed** (30 existing + 4 new: transport URL handling, DELETE signing/204, mock-contract compatibility, DELETE vector).
- **Live round-trip through the fixed adapter's own default transport** — no harness: put (200, sha metadata) → list → head (sha256 metadata verified) → get (**byte-identical**) → del (**204**) → **bucket empty**. 6/6.
- Relevant full suites: **mythos-orchestrator-0 156/156** (leak detector), **devx-1 92/92**. Production census 26/20/9, 0 restarts, all healthy.

### Consequence

**The off-host tooling can now genuinely reach R2.** The remaining gap to closing the OFF-HOST-BACKUP-GATE is execution: dump the three production databases (§ runbook `docs/OFF_HOST_BACKUP_GATE.md`), C1 → upload → fresh download → C2 → C1==C2 → isolated restore test → gate closure. **Not started — awaiting separate instruction.**

### Gates

OFF-HOST-BACKUP-GATE **still BLOCKED** (destination now ready; backups not yet taken) · PC gate **CLOSED** · MPI F8/F9 **ready for ratification** · production migration **BLOCKED**.

### Next stage

**OFF-HOST BACKUP EXECUTION** (separate instruction required), then gate closure, then MPI F8/F9 ratification/implementation.

---

## OFF-HOST BACKUP PREPARATION (2026-08-14) — DESIGN / READ-ONLY ONLY

**Status: runbook READY, execution BLOCKED.** Deliverable: **`docs/OFF_HOST_BACKUP_GATE.md`** (new; no such file previously existed).

**Production DB modified 0 · production data copied 0 · production backups 0 · no dump taken · no bucket, credential or tooling created · no destination registered.** All source inspection was read-only.

### The finding that shaped this stage: the tooling already exists

The repository **already contains a working, provider-neutral, S3-compatible off-host backup implementation** — `projects/idauto/ops/offhost-backup.js` plus `projects/idauto/ops/adapters/s3-compatible.js`, covered by `tests/ida-3f-offhost-backup-test.js`. It is **R2-ready as written**: AWS SigV4 signing, HTTPS-only endpoints enforced, config-file mode `0600` enforced, injectable transport so it tests offline.

**No new tooling is needed and none should be installed** — not `rclone`, `aws`, or `s3cmd`. A second mechanism would mean two backup paths sharing one set of guarantees.

**The one real gap:** that tooling backs up *file artefacts with a manifest*. Database dumps are files it **carries**, not files it produces. The dump step is an addition in front of the existing pipeline, not a replacement — recorded as §4.D of the runbook.

### Sources — verified read-only, and one detail that would have bitten

| # | Container | Database | Engine | Tables | Size |
|---|---|---|---|---|---|
| 1 | `idauto-postgres` | `idauto` | PostgreSQL **15.18** | 24 | 11 MB |
| 2 | `coolify-db` | `coolify` | PostgreSQL **15.19** | 66 | 24 MB |
| 3 | `dar-hijama-production-mysql-1` | `darhijama_prod` | MySQL **8.4.11** | 39 | — |

The two PostgreSQL servers are on **different minor versions**. A `pg_dump` client older than its server refuses to run, so no single external client can safely serve both. The runbook therefore requires `pg_dump` to run **inside each source container**, which matches client to server and removes any need for a network path to the database. Container credentials stay in container environment variables — never on a command line.

### The four artefacts the gate depends on keeping separate

**C1** source checksum · **O** uploaded object · **C2** checksum of a *freshly downloaded* copy · **R** restored database. **C1 == C2 is the round-trip proof**; **R is never byte-comparable** and is validated structurally against the table/row counts above.

Two traps written into the runbook explicitly: **do not use ETag as the checksum** (for multipart uploads it is a hash-of-hashes, not a content hash), and **do not re-hash the local original** and call it a round trip — that proves only that the disk still works.

### Validation performed

- `tests/ida-3f-offhost-backup-test.js` — **30 passed, 0 failed**, including an **AWS-published SigV4 test vector**, so the signing is correct against a known-good reference and works with R2 unchanged.
- 8 runbook claims checked **against the adapter source** rather than trusted from reading: config path, mode-0600 enforcement, non-HTTPS refusal, the five required config keys, SigV4, injectable transport, and the exported `push`/`verifyRemote`/`restoreVerify`/`retention`/`redact` surface. **All 8 verified.**

No check requiring the absent destination was executed.

### R2 contract — documented, not created

Config lives at `~/.config/mythos/idauto-offhost.env`, mode `0600`, keys `ENDPOINT` / `REGION=auto` / `BUCKET` / `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY`, with a **bucket-scoped** credential. **The owner writes this file directly.** No secret value appears in Git, this handover, logs, shell history, test output, or any report — and none was seen this session.

### Gate status

| Gate | Status |
|---|---|
| A — authorised destination exists | **BLOCKED** (0 `s3_storages`, no config file) |
| B–E — backup, C1, C1==C2, restore-from-download | NOT STARTED (blocked by A) |
| F — PC-DECOMMISSION-GATE | **CLOSED** — owner-declared 2026-08-14 |
| G — final VPS inventory reconciled | pending the PC audit report |

**Production migration remains BLOCKED**, enforced in code: `migrate.js` refuses to run without an explicit `backupGateClosed` assertion.

### Next blocker — one owner action

Create the R2 bucket and a bucket-scoped credential, then write `~/.config/mythos/idauto-offhost.env` with mode `0600`. Nothing else is missing: tooling, runbook, validation procedure and isolation requirements are all in place and tested offline.

---

## GATE CLOSURE ATTEMPT — OFF-HOST BACKUP + PC-DECOMMISSION (2026-08-14)

**Status: NEITHER GATE CLOSED.** Both blockers are external to this session and cannot be resolved from the VPS. **Production databases modified: 0** (read-only `SELECT count(*)` only). **PC files deleted: 0** — the PC was never contacted.

### Off-host backup — BLOCKED (single authorised check performed, not to be repeated)

| Evidence | Result |
|---|---|
| Coolify `s3_storages` | **0** rows (0 usable) |
| Coolify `scheduled_database_backups` | **0** (0 enabled) |
| `scheduled_database_backup_executions` | **0** |
| `scheduled_volume_backups` | **0** |
| Object-storage tooling (`rclone`, `aws`, `s3cmd`, `restic`, `borg`, `mc`, `b2`, `gsutil`, `az`) | **none installed** |
| Backup credentials (`rclone.conf`, `~/.aws/credentials`, `~/.s3cfg`, `/etc/restic`) | **none present** |
| Destination endpoints in the repository | **none** |

**No authorised off-host destination exists.** Per the standing rule, no account, bucket, API key, billing arrangement or credential was created. **§2 did not execute** — there is nowhere to upload to, so the dump → SHA-256 → upload → download → verify → restore-test cycle has no destination and was not attempted. This audit is now settled; it should not be repeated until the owner provisions a destination.

### PC-Decommission Gate — OPEN, and the reason is concrete

**The audit could not run.** Three findings:

1. **`pc-audit.ps1` never existed.** Not on the VPS, and not anywhere in Git history (`git log --all --diff-filter=A`). The premise that one was already prepared is incorrect.
2. **The VPS cannot reach the PC.** No VNC/RDP client is installed, there is no reverse tunnel, and no PC host entry exists.
3. **The noVNC listener is pointed the wrong way for this purpose.** `127.0.0.1:6080` (websockify) serves *the VPS's own desktop* — it is a route **in to** the VPS, not **out to** the PC. Direction matters, and mistaking it would produce a confident audit of the wrong machine.

**Delivered instead:** `scripts/pc-audit.ps1` — the "or equivalent read-only mechanism" the order permits. The owner runs it on the PC; it emits a JSON report to transfer back for reconciliation.

It is **strictly read-only** and verified so: the only git verbs it invokes are `status`, `rev-parse`, `rev-list`, `for-each-ref`, `branch`, `log`, `ls-files`, `remote`. It never pulls, pushes, fetches, commits, resets, checks out, stashes or cleans, deletes nothing, and its single write is the report file.

It covers what the gate actually needs:

- **All four working copies** — branch, HEAD, upstream, ahead/behind, modified and untracked files with SHA-256, and every commit **not present on any remote**, which is the evidence that decides PC-UNIQUE vs CANONICAL-IN-GITHUB.
- **A path discrepancy handled by probing, not guessing.** This handover records three of the copies at `C:\Users\Othman\…`; the audit order specifies `Desktop\…`. The script probes **both** candidates per target and reports which exists. Guessing would have silently audited the wrong directory, or declared a real working copy absent.
- **A whole-PC sweep** — every `.git` on every fixed drive, loose development files outside any repository, and all copies of `mythos_data.json`. Without this, prerequisite #9 ("no unique development material exists only on PC") can only be *assumed*, and assuming it is exactly what a decommission gate exists to prevent.
- **`ahead`/`behind` computed without fetching**, so the value reflects the clone's last known remote state. Recorded honestly in the report rather than made accurate by a mutating `fetch`.

### Reconciliation status — unchanged, and unchangeable from here

The 1,564-file manifest still stands as previously recorded: **959 + 217 TRANSFERRED · 65 NOT TRANSFERRED — INTENTIONAL (sensitive, stays on PC) · 322 assumed CANONICAL_IN_GIT · 1 UNRESOLVED (`mythos_data.json`, personal-data snapshot, must not be transferred) · MISSING: none.**

The **322 files remain the sharpest open risk**, exactly as before: they were left on the PC on the assumption Git already holds them, and that assumption is still unverified. **29 of them** sit under `mythos-prod-stage3b` and `mythos-prod-work`, for which **no remote repository and no corresponding remote branch exist at all**. Until the audit runs, those 29 must be treated as **UNRESOLVED — PC UNIQUE**. Nothing was pushed to change that, and nothing should be.

### Gate decision

**PC-DECOMMISSION-GATE = OPEN.** Of the seven closure conditions, four cannot be evaluated without the PC report: working copies verified · no unexplained unique work · whole-PC inventory complete · all material in a final state. Sensitive exclusions are documented, and no PC file was deleted.

### Next blocker — precisely two things, both owner actions

1. **Provision an authorised off-host destination** (or state that one will not exist, which would require re-planning the backup gate rather than waiting on it).
2. **Run `scripts/pc-audit.ps1` on the PC** and return `pc-audit-report.json`. Reconciliation and the gate decision can then be completed from the report alone, with no further PC access.

Until both are done, **MPI-2A production migration stays blocked** — and the migration runner enforces this in code, not merely in prose.

---

---

## OWNER DECISION — IDA-3F DEFERRED (2026-08-12)

**Status: `BLOCKED / DEFERRED`.** The owner has intentionally postponed Cloudflare R2 provisioning and the completion of IDA-3F, because R2 activation requires billing/payment setup.

This is a **scheduling decision, not a technical blocker**. The tooling is merged and verified offline (30/30 including AWS's published SigV4 vector), and the local verified backups are intact. Nothing is waiting on engineering.

**Do not, without a new explicit authorisation:** create an R2 bucket · create API credentials · activate billing · configure `~/.config/mythos/idauto-offhost.env` · run a remote push · run remote restore verification · schedule backups · start IDA-3G.

**Everything from the stage is preserved:** `projects/idauto/ops/offhost-backup.js`, `projects/idauto/ops/adapters/s3-compatible.js` and `tests/ida-3f-offhost-backup-test.js` remain on `main`, and all **nine** backup sets under `/home/deploy/backups/` (2.5 MB) are untouched — including the verified `CONSISTENT` pair captured during the local drill.

### To resume IDA-3F

1. Activate Cloudflare R2
2. Create private bucket: `mythos-backups`
3. Create least-privilege R2 credentials
4. Store credentials locally in `~/.config/mythos/idauto-offhost.env`, mode 600
5. Run off-host push
6. Verify remote checksums
7. Perform isolated restore drill
8. **Close IDA-3F only after all verification succeeds**

### Risk accepted while deferred

All ID Auto backups still live on the same host as the data they protect, so **host or disk loss remains unmitigated**. That is acceptable only while the data is synthetic. §11 requires off-host backup **before the first stage that accepts real, non-admin evidence**, so IDA-3F must close before IDA-3H (authenticated pilot) or IDA-3I (public gate) — not merely before "public launch" in the abstract.

`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**. Remaining public blockers: **off-host backup (deferred)**, legal/consent review (IDA-3G), and real auth (IDA-2E).

---

## IMPLEMENTATION — IDA-3F OFF-HOST BACKUP (2026-08-12) — TOOLING MERGED, STAGE BLOCKED

**Type:** Infrastructure tooling. **No off-host copy exists yet. No deployment, no DNS, no reverse proxy, no firewall, no Docker or Coolify change, no scheduled job, Jellyfin untouched, no backup deleted.**

**Starting HEAD:** `26dd92a6d43c1ca85eb5f089f4a67552e89106d1`
**Metadata commit:** `034ea795ecbe46e723acacee34fbd04adfc1c295` (registered BLOCKED after discovery)
**Codex implementation:** `d63679df9a1163a656962d02f5805619d0285f9f` → reformatted in `7b0d27f421d022ed183183776d7ce76c35b4bbd5`
**Merge:** `7b0d27f421d022ed183183776d7ce76c35b4bbd5` — **true fast-forward**, single parent

### THE STAGE IS NOT COMPLETE — no off-host destination exists

Discovery ran before any implementation, as the authorisation required, and found **no usable off-host target already configured**:

| Checked | Result |
|---|---|
| rclone · restic · borg · aws · s3cmd · mc · gsutil · az · swift · openstack | **none installed** |
| their configs (`rclone.conf`, `.aws/credentials`, `.s3cfg`, restic/borg repos) | **none exist** |
| second host via SSH | **none** — all three configured SSH hosts resolve to `github.com`; the `notrejour` key is a GitHub deploy key |
| NFS / CIFS / sshfs mounts | **none** |
| additional disks | **none** — only `/dev/sda1` plus snap loop devices |
| Coolify | `s3_storages=0`, `scheduled_database_backups=0` |
| Cloudflare R2 | approved in `CLOUDFLARE_ARCHITECTURE.md` but **not created**; gated behind INF-CF-6 |
| `INF-CF-AUTO-0` connector | **read-only public-data inventory** (RDAP/WHOIS/DNS/TLS); its README forbids storing tokens or account ids, so **no Cloudflare credential exists on this host** |

The owner selected **Cloudflare R2** as the destination. It still has to be provisioned: **a bucket and a least-privilege API token, created by the owner.** Until then there is no transfer, no remote verification and no restore drill, so §11's gate is **not** closed and `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` stays **NO**.

Writing backups to another directory on this VPS was deliberately **not** done: it would satisfy nothing (the risk is host or disk loss) while making the gate look closed.

### What was delivered

Three new files, nothing modified:

- `projects/idauto/ops/offhost-backup.js` — provider-neutral core. Commands `stage · manifest · verify-local · push · verify-remote · list · retention · restore-verify`, every one accepting `--dry-run`, and media-ops.js's exit-code discipline (0 clean · 1 usage/env · 2 anomaly · 3 refused). No vendor name appears in its logic.
- `projects/idauto/ops/adapters/s3-compatible.js` — SigV4 over HTTPS using only node's built-in `crypto` and `https`. **No dependency was added** (only `pg` is installed and no AWS SDK exists). Config is read from a user-local `~/.config/mythos/idauto-offhost.env` at mode 600 — never the repository, never a command-line argument. Non-HTTPS endpoints are refused outright.
- `tests/ida-3f-offhost-backup-test.js` — **30/30, fully offline**: no database, no network, no credential, no environment variable, running the core against an in-memory fake adapter.

**Retention is report-only by construction.** The 7 daily / 4 weekly / 3 monthly selector reports keep/drop and has no deletion path; `--destructive` is refused outright with exit 3. Deletion was not authorised and is not implemented.

### Verified beyond the fake adapter

The offline suite proves the signing is correct without a network: **test 29 reproduces AWS's published SigV4 vector exactly** (canonical-request hash and signature both matched), and test 30 refuses a non-HTTPS endpoint.

The core was then smoke-tested against **real backup artifacts**, which the fake cannot exercise. That found two things worth recording:

1. **The tool correctly refused an incoherent pair.** Staging a 20:07 database dump with a 10:07 media backup was rejected with `capture order must be database-before-media` — the runbook's rule, enforced rather than documented.
2. **DB backups are `700 root:root`** by the IDA-2B convention, so the tool must run as **root** to read them; as `deploy` it fails closed with a clean exit 1.

With a properly ordered pair (database 20:36:34, media 20:36:42) the full local path ran clean: dry-run created **0 files**, the real stage produced 71 files with **70 verified objects**, `verify-local` exited 0, and the manifest recorded database dump SHA-256, media manifest SHA-256, 68 objects, 68 distinct object keys and 153 database media rows — with **no credential of any kind**. Its consistency claim is deliberately honest: `"separately captured; not a transactional filesystem snapshot"`.

Retention over 120 synthetic daily sets kept 11 and dropped 109 — seven consecutive dailies plus week and month boundaries back to June — and pruned nothing.

### Test results

`ida-3f-offhost-backup` **30/30 offline** · `idauto-storage-ops` 72/72 · `ida-2f` 32/32 · `ida-2h` 37/37 · `ida-3e` 48/48 · `ida-3d` 73/73 · `ida-3c` 63/63 · `ida-3b` 67/67 · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · project-intelligence 0 errors · `git diff --check` clean · media audit **CLEAN**. All re-run against the post-merge tree. The DEVX impact-selected set for `projects/idauto/ops/` is `idauto-storage-ops`, `ida-2f` and `ida-2h`; all three ran.

No credential, endpoint, bucket or account id is committed, and no `idauto-offhost` config file is tracked.

### A quality intervention worth repeating

The first delivery was functionally correct but effectively minified — 12,488 bytes across 54 lines, with a single 2,000-character line containing the SigV4 implementation. It was sent back for a mechanical reformat rather than accepted: this is the disaster-recovery path, read under pressure when the host is gone, and it signs credentialed requests, so it must stay line-reviewable. It is now 494 / 216 / 408 lines with no line beyond 120 characters, and the suite still passes 30/30 with the AWS vector exact.

### Backups on disk

Nine sets retained, 2.5 MB total. **Nothing was deleted** — deleting backups was not authorised. Two sets were added by the drill: `idauto-postgres-ida3f-smoke-20260812T203633Z` and `idauto-media-backup-2026-08-12T20-36-42-492Z` (the latter a genuine verified `CONSISTENT` media backup). Staged copies were removed from `/tmp` so no backup data lingers there.

### To finish IDA-3F

1. Owner creates an R2 bucket (`mythos-backups` per `CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`) and a least-privilege API token, ideally with object-lock/versioning so the source host cannot delete both copies — §11's non-negotiable.
2. Token placed in `~/.config/mythos/idauto-offhost.env`, mode 600, never committed.
3. Claude runs `push`, `verify-remote`, then a `restore-verify` drill into an isolated destination, and records set ids, timestamps and checksums.

**`restore-verify` restores from the remote and therefore requires the adapter** — it is the one command the local drill could not exercise.

### Next stage

`IDA-3F` must be finished before `IDA-3G` (consent and legal gate). Remaining public blockers: **off-host backup (this stage)**, legal/consent review, and real auth.

---

## REMEDIATION — IDA-3E LEGACY FACT BACKFILL (2026-08-12) — COMPLETE

**Type:** Narrowly scoped **Level-3 live-data remediation**, explicitly owner-authorised. **No schema change, no code change, no deployment, no DNS, no proxy, no firewall, no Docker or Coolify change, Jellyfin untouched, nothing deleted.**

**Starting HEAD:** `0dcac9823c36f15e04b9982f8be877c45d79d046`

### Why

IDA-3E closed the unreviewed-fact visibility risk for every row created after its gate, but eight submission-linked facts written *before* the gate remained `pending_review + public`. The mechanism was already correct; only the historical rows were not. This remediation brings them into line so the invariant holds for **all** rows, not just new ones.

### Safety gate

`/home/deploy/backups/idauto-postgres-20260812-ida3e-backfill/idauto-pre-ida3e-backfill.dump` — `pg_dump --format=custom`, 189,655 bytes, directory `700 root:root`, file `600`.
`pg_restore --list` exit 0, **281** TOC entries, all **24** tables present.
SHA-256 `692b56538423bda5ed9255db0cdb2c3149ea623746b85fb7f06a0c840fd5d8d5`.

Candidate evidence was gathered as aggregates only — count, status and scope distributions, and timestamp range — never fact values. The count was **exactly 8**, all `pending_review + public`, spanning 18:11:29–19:29:36 UTC, entirely before the 19:54:07 gate commit.

### The change

One statement, inside a transaction, guarded:

```sql
UPDATE idauto_vehicle_facts f
   SET access_scope = 'mythos_private'
 WHERE f.access_scope = 'public'
   AND f.verification_status <> 'verified'
   AND EXISTS (SELECT 1 FROM idauto_observations o
                 JOIN idauto_submissions s ON s.observation_id = o.id
                WHERE o.id = f.observation_id)
```

`verification_status` was **not** touched. The `EXISTS` join — not timestamps — is what scoped the change: it is why **55 unrelated `unverified + public` admin facts were left untouched**, which a naive `verification_status <> 'verified' AND access_scope = 'public'` predicate would have wrongly swept up. A `DO` block aborted the transaction unless exactly 8 rows changed, all landed `mythos_private`, and none were `verified`. `RETURNING` surfaced only ids, observation ids, status and scope.

### Verification

| Control | Before | After |
|---|---|---|
| facts total | 147 | **147** |
| verified facts | 3 | **3** |
| verified + public | 3 | **3** |
| observations | 275 | **275** |
| submissions | 91 | **91** |
| audit rows | 992 | **992** |
| media rows | 146 | **146** |
| idauto tables | 24 | **24** |

Fact matrix moved exactly as intended and nowhere else: `pending_review + public` **8 → 0**, `pending_review + mythos_private` **2 → 10**; `rejected + mythos_private` 2, `unverified + mythos_private` 77, `unverified + public` 55 and `verified + public` 3 all unchanged.

Candidate count is now **0**. Every submission-linked fact is `pending_review`/`rejected` → `mythos_private` or `verified` → `public`. No observation, submission, audit or media row changed; nothing was deleted. Media integrity **CLEAN** and byte-identical (66 objects, 1864 bytes, 146 rows, 26 shared). `idauto-postgres` healthy, `RestartCount=0`. Jellyfin untouched.

### Next stage

**`IDA-3F` — off-host backup (§11)**, not started and requiring its own authorisation. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**.

---

## IMPLEMENTATION — IDA-3E ADMIN REVIEW QUEUE (2026-08-12) — COMPLETE

**Type:** Runtime module. **No schema change, no public route, nothing deployed, no DNS, no reverse proxy, no firewall, no Docker or Coolify change, Jellyfin untouched, no history rewrite, no force-push.**

**Starting HEAD:** `14ece4939d13423ba0fa8edf35f1f1153a989f06`
**Metadata + decision commit:** `516b7cd1b0cc8b3e07262ad16b19016123af6dfb`
**Codex implementation commit:** `974ffa8bcc01448102e10d5508183e58467f5a46`
**Merge:** `a76cc2f48a212bc3f73e25e50fe5ebfb9888247d` — **true fast-forward**, single parent

### The forward risk carried since IDA-3B is closed

Under owner decision **§14.2**, community facts now ingest as `mythos_private`, acceptance sets `verification_status='verified'` **and** promotes `access_scope='public'`, and rejection sets `'rejected'` while leaving the scope private. **Non-admin read queries are unchanged**, exactly as §6 requires — a claim is safe because of what the row *is*, not because a query remembered to exclude it. The whole enforcement is one word in `ingestion.js`: `'public'` → `'mythos_private'`.

Proven live, not merely inspected:

| Case | Result |
|---|---|
| Ingest a community fact, read `GET /api/vehicles/:ref/facts` | **absent** while `pending_review` |
| Accept it, read again | **present** — `verified` + `public` |
| Ingest another, reject it, read again | **absent** — `rejected`, scope still private |

### What shipped

`writes.js` gains `reviewFact(factId, decision, identity)` beside `reviewObservation`, following that primitive exactly — `withAudit`, `SELECT … FOR UPDATE`, same error style. Accept → `verified` + `public`; reject → `rejected` with scope untouched; unknown decision → 400; missing → 404. Repeating the same decision is a **no-op with `skipAudit`**, so no phantom audit row. The opposite decision on a finalised fact is **409, fail closed** — reopening is undefined by the architecture and was not invented. A `conflict` fact is not a reviewable starting state here and yields 409; its `is_active` supersession remains an explicit admin decision for a later stage.

`api.js` gains exactly three private admin routes behind the existing `requireAuth` gate:

```
GET  /api/review/submissions          queue with provenance and fact/media counts
GET  /api/review/submissions/:id      detail
POST /api/review/facts/:id/decision   accept | reject
```

There is deliberately **no submission-level decision route**: the submission row's own status already means "accepted for processing", and reusing it for review state would conflate two lifecycles. Observation decisions continue to use the existing IDA-2H route and `writes.reviewObservation` — not duplicated, not re-routed.

Per §6 the detail route **includes `mythos_private` facts and media metadata**, because a reviewer cannot judge evidence they cannot see. This is why IDA-3E has its own surface: the IDA-2H detail route filters `mythos_private` out and its suite asserts that, so rather than change a tested security-relevant behaviour of a completed stage, IDA-3E added its own view and left IDA-2H untouched. IDA-2H remains 37/37.

### Verification

`ida-3e-review-queue` **48/48** live (30/30 static-only) · `ida-3d` 73/73 · `ida-3c` 63/63 · `ida-3b` 67/67 · `ida-2h` 37/37 · `ida-2a` 44/44 · `ida-2c` 26/26 · `ida-2d` 39/39 · `ida-2f` 32/32 · `ida-2g` 17/17 · `identity-core` 124/124 · orchestrator 156/156 · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · project-intelligence 0 errors · `git diff --check` clean · media audit **CLEAN** (66 objects, 146 rows, 26 shared, all eight defect classes zero). **Every suite re-run against the post-merge tree.**

Confirmed on the live database: still **24** tables, no DDL. Facts created after the gate landed are `pending_review + mythos_private`, `rejected + mythos_private`, or `verified + public` — never unreviewed-and-public. All 126 pre-IDA-3A observations present, `capture_sources` still 7, and rejected submissions, observations and facts all **retained** with their links intact. Review deletes nothing and rewrites no content-addressed key.

### Two runtime defects the sandbox could not catch

The delivered suite ingested community facts against freshly generated plate numbers that no vehicle owned. Ingestion refuses that by design (`IDA_FACT_LINK` — a fact requires an existing vehicle-linked plate), so the first live case failed and the run aborted. Fixed in `a76cc2f` by seeding a vehicle and plate per fixture, exactly as the IDA-3B suite does.

This is now a standing pattern worth planning for: **the worker sandbox returns `EPERM` for both `connect` and `listen`**, so Codex verified 30 socket-free cases and could execute no live case at all. Every route-or-database stage so far (3D and 3E) has surfaced exactly one runtime defect at integration time. Budget for it.

### RESOLVED — legacy rows backfilled (owner-authorised, 2026-08-12)

Eight submission-linked facts created **before** the gate landed were `pending_review + public`. Their timestamps (18:11–19:29 UTC) all preceded the fix commit (19:54 UTC), and every fact created after it obeyed the new rule, so the mechanism was correct and these were synthetic fixtures from earlier IDA-3B/3C/3D runs. They were left in place pending authorisation, which the owner then granted as a narrowly scoped Level-3 remediation. **See the dedicated entry below for the full record.**

### Noted, not changed

`object_key` and `image_hash` are the **same value** by construction (content-addressed storage), and the pre-existing `getObservationMedia` route already returns `image_hash`. Excluding one while exposing the other is a distinction without a difference. IDA-3E's detail route mirrors the established convention rather than diverging from it; revisiting this would change completed IDA-2C/2F behaviour and belongs to whichever stage introduces public media serving.

### Next stage

**`IDA-3F` — off-host backup (§11).** `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**: off-host backup, legal/consent review (IDA-3G) and real auth are all still outstanding. The fact-visibility blocker that gated public exposure is now resolved.

---

## IMPLEMENTATION — IDA-3D PRIVATE ADMIN-ONLY INGESTION ROUTE (2026-08-12) — COMPLETE

**Type:** Runtime module. **First HTTP surface of IDA-3, private and admin-only. Nothing deployed, no schema change, no DNS, no reverse proxy, no firewall, no Docker change, no new port, Jellyfin untouched, no history rewrite, no force-push.**

**Starting HEAD:** `beb20ef32a53e4439c2ce7f8114de5902ff03976`
**Metadata commit:** `5798efb6681e31c42f0b55a6bfe1085a71731aeb`
**Codex implementation commit:** `4ed7b05fbcb00f3a8aa73516f66994de35c089ec`
**Merge:** `5de4017a83a5adc5774a154fce7af71d0178ec60` — **true fast-forward**, single parent, no merge commit (main had not moved)

### What shipped

One route added to the existing table in `api.js`, plus `tests/ida-3d-private-ingest-route-test.js`. No other file touched — `ingestion.js`, `rate-limit.js`, `writes.js`, `storage.js`, `db.js` and `identity.js` are all unchanged.

```
POST /api/ingest/observations
```

Unversioned, exactly as §12 specifies for the internal/private-pilot slice. It is a **thin adapter**: it parses the request, calls `ingestion.submit()`, and maps the result to a status code. It reimplements no ingestion policy, no rate limiting, no actor mapping, no idempotency, no transaction, storage or audit logic.

**Access control** uses the existing `requireAuth` gate — the same one every current write route uses — which runs *globally before route matching*, so the handler cannot execute without a resolved identity. No JWT, session, cookie, OAuth or new auth store was introduced.

**Actor mapping is entirely server-derived:** `actor_type` is hardcoded `'admin'`, the idempotency key comes from the required `Idempotency-Key` **header** (never the body), and the capture source comes from ingestion's existing `MANUAL_ADMIN` mapping. Admin rate-limit exemption happens inside IDA-3C's policy; **no route-level bypass and no counter logic exist in `api.js`**.

**Response mapping** is §12's table exactly: `201` accepted · `200` idempotent replay · `202` duplicate · `400` validation · `401` credential · `413` too large · `415` MIME · `422` plate format · `429` rate limited with `Retry-After` (whole seconds, floored at 1) · `500` opaque server fault carrying no stack, SQL, driver text, path or token.

**Transport** is `multipart/form-data` with one JSON `submission` part plus 0–N `image` parts, per §12. This was **derived, not chosen**: IDA-3B's `submit()` consumes the envelope and its media in one atomic call, and §12 explicitly rejects JSON-with-base64, so a raw-body upload cannot carry both. The reader is minimal and bounded by the existing `storage.MAX_UPLOAD_BYTES`; it deliberately enforces **no** count, size, MIME or magic-byte policy, because `ingestion.js` already does and forking that would split policy.

### Codex refused the first task — correctly, again

The first envelope said to pass `req.mythosIdentity` as `actor_ref`. Codex returned `blocked / scope_violation`, wrote nothing, and explained that `requireAuth` sets `req.mythosIdentity` to the **already-resolved** identity (`usr_*`) while `ingestion.resolveActor()` calls `identity.resolveIdentity()` on `actor_ref`, which expects a **token** — so the mandated wiring would resolve twice, miss the token map, and always return `INVALID_ACTOR_REF`.

The diagnosis was exactly right and the envelope was wrong. Its *conclusion* — that scope had to expand — was not: the established IDA-3B contract is that `context.actor_ref` **is the token** (its own suite calls `context('admin', ADMIN_TOKEN, key)`), so passing the raw bearer token fixes it inside the authorised two files. The corrected task delivered on the second run.

**Because the token now flows into the ingestion context, it was verified end to end:** ingestion resolves it and persists only the `usr_*` identity. The suite asserts the token appears in **no** submission row, **no** audit row and **no** response.

### A defect only running could find

The delivered suite exercised the missing-`Idempotency-Key` path by sending the header with an `undefined` value. Node rejects that and aborted the entire run at the first live case. Fixed in `5de4017` by omitting the header instead — which is what the case meant to express.

This is the predictable cost of the sandbox boundary: **probed in the worker sandbox, TCP connect to `127.0.0.1:5432` returns `EPERM` and `http.createServer().listen(0,'127.0.0.1')` also returns `EPERM`.** Codex can verify the socket-free subset (45 cases here) but cannot execute a single HTTP or database case. Expect to find runtime defects like this one when integrating any route work, and budget for it.

### Verification

`ida-3d-private-ingest-route` **73/73** live (45/45 static-only) · `ida-3c` 63/63 · `ida-3b` 67/67 · `ida-2a` 44/44 · `ida-2c` 26/26 · `ida-2d` 39/39 · `ida-2f` 32/32 · `ida-2g` 17/17 · `ida-2h` 37/37 · `identity-core` 124/124 · orchestrator 156/156 · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · project-intelligence 0 errors · `git diff --check` clean · media audit **CLEAN**. **Every suite re-run against the post-merge tree.** The DEVX impact-selected set for `projects/idauto/reference/api.js` is `ida-2c`/`2d`/`2f`/`2g`/`2h`; all five ran, plus 3B, 3C, 2A and identity-core.

Confirmed on the live database: still **24** tables, no DDL. `bad_ip_hash=0` — every stored `ip_hash` is a 64-hex digest with no dotted or colonned value. **100** ingestion and rate-limit audit rows, **zero** carrying `ip_hash`. Counters show `negative=0`, and the suite asserts an admin submission writes **no counter rows at all**. All 126 pre-IDA-3A observations are present and `capture_sources` is still exactly 7 — nothing pre-existing modified or deleted.

Confirmed on the host: `api.js` still contains exactly **one** `.listen(` and still binds `127.0.0.1` only; the stage diff contains no nginx, Caddy, proxy, DNS, firewall, Docker, Compose, Coolify or unit-file change; and the ID Auto API remains **undeployed** — no container, no listener. The verifier's `no_secret_in_diff: assigned-secret` flag was investigated, not waived: the single match is `var TOKEN = 'ida3d-token-' + crypto.randomBytes(18)...`, a per-run generated test value, not a literal credential.

### Deployment status

**Nothing was deployed and nothing became reachable.** The route exists in an undeployed reference implementation that binds loopback only. Making it reachable would require a deployment or reverse-proxy change, which is **not authorised** and was not performed. Even if the service were running, the route fails closed without a valid admin token.

### Forward risk carried forward unchanged

`api.js` filters facts by `access_scope != 'mythos_private'` but **not** by `verification_status`. IDA-3D added no read path and did not alter public-read semantics, so the risk is unchanged in kind: once a public route exists, an unreviewed `public` community fact would be served alongside verified ones. **IDA-3E / IDA-3I must gate public reads on review state, or ingestion must write facts at a narrower scope.**

### Next stage

**`IDA-3E` — admin review queue for ingested submissions.** Requires its own explicit authorisation. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**: off-host backup (§11), legal/consent review and real auth are all still outstanding, and the fact-visibility gate above should be settled there or at 3I.

---

## IMPLEMENTATION — IDA-3C RATE-LIMIT ENFORCEMENT (2026-08-12) — COMPLETE

**Type:** Runtime module. **No route, no exposure, no schema change, no deployment, no DNS, no auth, no Docker change, Jellyfin untouched, no history rewrite, no force-push.**

**Starting HEAD:** `6aecda0c80bbe90a2afe9f52f74f16b93b02ed78`
**Metadata commit:** `f486976f772efb7421a5086c935fe6ea1945ac82` (registration, initially BLOCKED)
**Decision commit:** `e2a0ea724435317821648d3ac2b05b3af462ebb0` (owner decisions, §14.1)
**Fixture commit:** `6c0228aa9711adcf694f6a27fac3dc2054d362cd` (IDA-3B anonymous fixtures)
**Codex implementation commit:** `b872c9d569df85fbc8f4b130c93780b5c87f9146`
**Merge commit:** `3f51b64b03feb61b3ed80b826ef2bd650272145e`

### The stage stopped before implementing, and that was the right call

Two questions IDA-3C depends on were **not** settled by the binding design, so nothing was built until the owner ruled. Both rulings are now recorded as **§14.1 of `IDA3_INGESTION_ARCHITECTURE.md`**, with the original §7/§13/§14 text left intact so the record of what was ambiguous survives.

- **Decision A — a rate-limited request writes an audit event and nothing else.** §7 implied a `submissions` row, §14 said `Partial data: None`, and §13 checks the limit before the submission exists. Resolved toward §14/§13: writing a durable row per rejected request is a denial-of-service amplification vector, since an attacker would force unbounded table growth precisely by exceeding the limit. Forensics survive — the counter's `bucket_key` is a SHA-256 of the actor or IP dimension, and §15 already sources rate-limit hits from the counters.
- **Decision B — idempotency resolves *before* the limiter; a replay consumes no quota.** The order was never stated. §13 implied replays would be counted; §14 promises retries are always safe. Both cannot hold, since an anonymous submitter at 3/minute would exhaust its allowance retrying one timed-out submission.

**Enforced order:** validate → server-derived actor/source identity → idempotency resolution → rate limit → permitted submission flow.

The policy itself needed no invention and none was made: §7's thresholds and dual buckets, `sha256(dimension:identifier)` keys, 60s/24h windows, and §10's byte quotas are all binding.

### What shipped

`projects/idauto/reference/rate-limit.js` (new), `tests/ida-3c-rate-limit-test.js` (new), and **one** integration point in `ingestion.js`. No other file touched.

Limits exactly per §7/§10: anonymous 3/min·30/day on `ip_hash`; contributor 10/200; verified contributor 20/500 at `trust_score >= 60`; professional and system 60/5000 keyed on actor + org; **admin exempt with no counter read or write at all**. Media byte quota 50 MB anonymous / 250 MB authenticated on a distinct daily bucket, with an INTEGER-overflow guard. An identified non-admin request touches four buckets (actor-minute, actor-day, ip-minute, ip-day); anonymous touches two. A request is allowed only if **every** applicable bucket is within its limit.

**Atomicity.** One statement per bucket, all inside a single transaction:

```sql
INSERT INTO idauto_rate_limit_counters (bucket_key, window_start, count)
VALUES ($1,$2,$3)
ON CONFLICT (bucket_key, window_start)
DO UPDATE SET count = idauto_rate_limit_counters.count + EXCLUDED.count
RETURNING count
```

Increment first, then compare the returned value — deliberate, and matching §7's "rate-limit rejections are counted". There is no SELECT-then-UPDATE anywhere; the suite asserts its absence statically. Counters are increment-only and can never go negative. A database error returns `storage_error` with `allowed: false` — **fails closed**, never falling through to allowed. Four internal states: `allowed`, `limited`, `invalid`, `storage_error`, with `retry_at` derived from the window end. No HTTP mapping, no route, no listener.

Client input is never trusted for bucket identity: `bucket_key`, `ip_hash`, `window`, `limit`, `rate_limit`, `rate_limit_override` and `actor_type` joined the rejected-field list, preserving the IDA-3B rule that spoofing surfaces as a validation error rather than being silently ignored.

### A behaviour change worth knowing: anonymous now requires an address

Enabling the limiter broke four IDA-3B cases that submitted anonymously with **no** `raw_ip`. An anonymous submitter is accountable only through its hashed IP (§5), and the limiter buckets anonymous traffic on exactly that value — so a request carrying no address cannot be throttled and is now refused rather than silently exempted.

**Failing closed there is the correct security property**: otherwise omitting an address would bypass rate limiting entirely. The fixtures were at fault, not the limiter, so each anonymous fixture now carries its own synthetic address (`6c0228a`). That commit landed **before** the merge and was verified harmless without the limiter present (IDA-3B 60/60 on it), so `main` was never left with a failing suite.

### Verification

`ida-3c-rate-limit` **63/63** live (37/37 static-only) · `ida-3b` **67/67** · `ida-2a` 44/44 · `ida-2c` 26/26 · `ida-2d` 39/39 · `ida-2f` 32/32 · `ida-2g` 17/17 · `ida-2h` 37/37 · `identity-core` 124/124 · orchestrator 156/156 · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · project-intelligence 0 errors · media audit **CLEAN**. **Every suite re-run against the post-merge tree**, per the IDA-3B process correction.

Confirmed directly on the live database: still **24** tables and the counters table still carries exactly its three original columns and **one** index (its primary key) — no DDL, no added index. Synthetic runs produced **60 counter rows**, counts 1–20, **none negative**; **every** `bucket_key` is 64-hex with **zero** containing a dot or colon, so no raw IP reached the table; **26** `ingestion.rate_limited` audit rows, **zero** carrying `ip_hash`. All 126 pre-IDA-3A observations are still present and `capture_sources` is still exactly 7 — nothing pre-existing was modified or deleted; the rest is ordinary fixture growth sanctioned by `IDAUTO_TEST_RUNBOOK.md`.

The verifier again flagged `no_secret_in_diff: assigned-secret`. Investigated, not waived: the matches are `var ADMIN_TOKEN = unique('token')` and a sibling, where `unique()` returns `prefix + Date.now() + crypto.randomBytes(6)`. Generated per run, no literal credential in the diff — the same heuristic false positive seen in IDA-3B.

### Forward risk carried forward unchanged (NOT fixed here, by instruction)

`api.js` filters facts by `access_scope != 'mythos_private'` but **not** by `verification_status`, so once a public route exists an unreviewed `public` community fact would be served alongside verified ones. Nothing is exposed today. **IDA-3E / IDA-3I must gate public reads on review state, or ingestion must write facts at a narrower scope.**

### Production state

No schema change, nothing deployed, no container recreated, no DNS, no auth, no Docker group, no firewall rule. Jellyfin untouched. `idauto-postgres` healthy. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**.

### Next stage

**`IDA-3D` — private admin-only ingestion route**, behind the existing operator token and not publicly routed. Requires its own explicit authorisation. It is the first slice to introduce an HTTP surface, so it must map the limiter's four internal states onto responses (`limited` → `429` with `Retry-After` from `retry_at`) without re-deriving policy. Off-host backup (§11), legal/consent review and real auth all remain outstanding before anything public.

---

## IMPLEMENTATION — IDA-3B PURE INGESTION SERVICE (2026-08-12) — COMPLETE

**Type:** Runtime module. **No route, no exposure, no schema change, no deployment, no DNS, no auth, no rate limiting, no Docker change, Jellyfin untouched, no history rewrite, no force-push.**

**Baseline:** `7edab6d713539af83a391bf278b1d4544d1816f7`
**Metadata commit:** `84ee376f912572028dc717643f4ffe6868579076` (stage registration, pushed separately)
**Codex implementation commit:** `1170bb09bcd02452268b7b0e784abdcfa26d4855`
**Merge commit:** `2337109a93ad70605e325778c92bc3d467739c91`

### What shipped

Two new files, no existing file modified: `projects/idauto/reference/ingestion.js` (330 lines) and `tests/ida-3b-ingestion-service-test.js`. The service exports `submit()`, `validate()`, `actorMapping()` and its constants. It requires no `http`/`https`/`express`/`net`, registers no route, opens no listener and never reads `process.argv` — asserted statically by the suite, and re-verified independently.

It implements the §13 staged transaction exactly: validate with no writes → commit the submission envelope in its own transaction → store media on the filesystem → **one** transaction carrying observation + facts + media + **exactly one** audit row → update the submission with its final status and `observation_id`.

Actor and source mapping is entirely server-derived: anonymous → `PUBLIC_UPLOAD`/`pending_review` with `actor_ref` and `contributor_id` left NULL and no contributor row created; contributor → `CONTRIBUTOR_UPLOAD`; professional → `PROFESSIONAL_SCAN`; admin → `MANUAL_ADMIN`/`accepted`; system → `MANUAL_ADMIN`/`pending_review`. No auto-accept for any non-admin class. Only the nine existing observation statuses and the seven existing `capture_method` values are used — community submissions map to `plate_scan`/`vehicle_scan`, since a new value would have required a schema change.

### Codex refused the first task — and was right

The first envelope (`ida-3b-service-0001`) instructed the service to **silently ignore** client-supplied `actor_ref`, `capture_source_id`, `trust_level` and similar. Codex returned `blocked / scope_violation`, wrote nothing, and cited §12: those fields are server-derived and a client-supplied value is a **400, never silently ignored** (§8, audit spoofing and privilege escalation). That is correct and the task envelope was wrong — silently dropping a spoofed privilege field hides an attack instead of surfacing it.

The envelope was corrected and re-dispatched as `ida-3b-service-0002`. The delivered service now **rejects** any payload carrying `capture_source_id`, `contributor_id`, `actor_ref`, `trust_level`, `confidence`, `status` or `trust_score`, reporting every offending field and writing nothing at all. Seven separate tests cover this, one per field.

**This is the delegation boundary working as intended.** A worker that stops on a contradiction between its task and the binding design is more valuable than one that silently picks an interpretation. The instruction to stop rather than guess is what produced it, and it should stay in every envelope.

### The worker sandbox cannot reach the database — measured, not assumed

Probed before writing the task: reading `/home/deploy/deployments/idauto-postgres/.env` **OK**, listing the media directory **OK**, TCP to `127.0.0.1:5432` **FAILED: EPERM**. The Codex sandbox permits filesystem reads but blocks sockets — the same property that makes the orchestrator, not the worker, push delivered branches.

So the suite was built with two modes: the default runs everything against the live database and fails **loudly** with a `FATAL` naming every missing variable when the environment is absent (never silently skipping, per `IDAUTO_TEST_RUNBOOK.md` §5), while `IDA3B_STATIC_ONLY=1` runs the 30 database-free cases Codex could actually verify. Claude then ran the full 60-case suite. Both modes were re-run independently.

`pg` lives in the gitignored `projects/idauto/node_modules`, so a linked worktree cannot resolve it; the live suite needs `NODE_PATH=/home/deploy/projects/mythos-prod/projects/idauto/node_modules` when run from anywhere but the canonical worktree.

### Verification

`ida-3b-ingestion-service` **60/60** live (30/30 static-only) · `ida-2a` 44/44 · `ida-2c` 26/26 · `ida-2d` 39/39 · `ida-2f` 32/32 · `ida-2g` 17/17 · `ida-2h` 37/37 · `identity-core` 124/124 · orchestrator 156/156 · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · project-intelligence 0 errors. **All re-run against the post-merge tree.**

Confirmed on the live database after the run: still **24** tables (IDA-3B changed no schema); `ip_hash` set on submission rows only, with **zero** observations linked from a submission carrying one; **12** ingestion audit rows and **zero** of them carrying `ip_hash`; all 4 ingestion-created media rows `mythos_private`; every stored `ip_hash` a 64-character hex digest with no dotted or colonned value anywhere; observation statuses and media scopes still drawn only from the pre-existing vocabularies. Media integrity audited **CLEAN**, all eight defect classes at zero.

The verifier flagged `no_secret_in_diff: assigned-secret` and blocked delivery. Investigated rather than waived: the three matches are `var ADMIN_TOKEN = unique('token')` and siblings, where `unique()` returns `prefix + Date.now() + crypto.randomBytes(6)` — per-run generated values, no literal credential anywhere, and the suite's environment check tests variable *names* and never echoes a value. A heuristic false positive of the same kind as the known `hunter2@db.internal` fixtures.

### A stale test that IDA-3A left failing on main — found and fixed

`ida-2a` asserted "exactly 22 `CREATE TABLE` statements"; IDA-3A legitimately made it 24, so `main` carried a failing test. It was missed because **IDA-3A's regressions ran in the canonical worktree before the fast-forward merge**, when `schema.sql` still held 22 tables — the 44/44 recorded for that stage was true when measured and false the moment the merge landed. Corrected in `8ded0a58a0be7ac6e5069f26bc27d81b269725ba`.

**Process correction, worth keeping:** regressions for a stage that changes tracked files must be run against the **post-merge** tree. This stage's suites were re-run after merging for exactly that reason.

### Forward risk recorded for IDA-3E / IDA-3I (not a defect here)

Ingestion writes facts with `access_scope='public'` and `verification_status='pending_review'`. Both values are pre-existing (43 facts already use `public`) so no new scope was introduced, and nothing is exposed today — there is no public route and `api.js` is an undeployed reference implementation. But `api.js` filters facts by `access_scope != 'mythos_private'` **only** and does not filter on `verification_status`, so once a public route exists an unreviewed community claim would be served alongside verified ones, distinguishable only by the returned `verification_status` field. **IDA-3I must gate public reads on review state, or ingestion must write facts at a narrower scope.** Deliberately not changed here: altering `api.js` was outside this stage's scope.

### Production state

No schema change, nothing deployed, no container recreated, no DNS, no auth, no Docker group, no firewall rule. Jellyfin untouched. `idauto-postgres` healthy. The live database gained ordinary synthetic test fixtures (16 submissions, 165 observations, 92 media rows), which `IDAUTO_TEST_RUNBOOK.md` sanctions for the live suites; no pre-existing row was modified or deleted.

### Next stage

**`IDA-3C` — rate-limit enforcement**, against the `idauto_rate_limit_counters` table created in IDA-3A. It must land **before** any reachable endpoint (`RATE_LIMIT_STAGE = BEFORE_ENDPOINT`). Requires its own explicit authorisation. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**.

---

## IMPLEMENTATION — IDA-3A INGESTION SCHEMA FOUNDATION (2026-08-12) — COMPLETE

**Type:** Live PostgreSQL schema migration, additive only. **Owner-authorised.** No deployment, no DNS, no endpoint, no service, no auth, no Docker change, Jellyfin untouched, no history rewrite, no force-push.

**Starting HEAD:** `bd707f984509a3145359710458de9a35d34c6c60`
**Metadata commit:** `33229fb6f6a651a129d4def9e9a0069653eae062` (stage registration, pushed separately)
**Implementation commit:** `66d4f705913a75d710daf00f6028ab57ddb754b5` (authored by Codex, fast-forwarded to `main`)

### What shipped

Exactly the scope fixed by `IDA3_INGESTION_ARCHITECTURE.md` — two tables and one nullable column, nothing else:

| Object | Shape |
|---|---|
| `idauto_submissions` | `id` BIGSERIAL PK · `idempotency_key` VARCHAR(64) NOT NULL UNIQUE · `actor_ref` VARCHAR(64) NULL · `actor_type` NOT NULL CHECK(5 canonical values) · `capture_source_id` → `capture_sources(id)` · `ip_hash` VARCHAR(64) NULL · `received_at` TIMESTAMPTZ NOT NULL DEFAULT now() · `status` NOT NULL DEFAULT `'pending'` CHECK(`pending`/`accepted`/`rejected`/`duplicate`) · `observation_id` → `observations(id)`; three `idx_idauto_submissions_*` indexes |
| `idauto_rate_limit_counters` | `bucket_key` VARCHAR(64) · `window_start` TIMESTAMPTZ · `count` INTEGER NOT NULL DEFAULT 0 · PK `(bucket_key, window_start)` |
| `idauto_observation_media.derived_from_media_id` | BIGINT **NULL**, no default, no backfill, self-reference to `idauto_observation_media(id)` |

The four submission statuses are **derived from the binding design, not invented** — `rejected` (§6, §7), `duplicate` (§3), `accepted`/`pending` (§15 and the §13 staged transaction, which inserts the submission before any observation exists).

### The delegation boundary — why Codex did not run the SQL

**The orchestrator cannot apply a live migration, by design.** `runner.js` refuses production mutation through three independent gates (`APPROVAL_REQUIRED` from the router, `LEVEL_3_NOT_AUTOMATIC`, and `PRODUCTION_MUTATION_FORBIDDEN`), there is no override flag anywhere in the runtime, and orchestrator test 29 enforces it. `AGENTS.md` §25.3 states the rule directly: level 3 never executes automatically under any routing decision or override.

The work was therefore split so the owner's authorisation is honoured without weakening the safety architecture:

- **Codex (level 2, delegated, no database access):** authored `schema.sql`, the migration and the static tests. Task `ida-3a-schema-0001`, `MIGRATION_IMPLEMENTATION`, routed `CODEX` level 2, `allow_production_mutation: false`. It never opened a connection, and the suite it wrote is provably offline.
- **Claude (level 3, owner-authorised):** reviewed the SQL, took and verified the backup, rehearsed the migration, applied it to `idauto-postgres`, and verified the result.

This is the correct division whenever a stage touches live data. Delegating the authorship is safe and useful; delegating the apply is not available and should not be engineered around.

### Safety gate — backup taken and proven restorable

`/home/deploy/backups/idauto-postgres-20260812-ida3a/idauto-pre-ida3a.dump` — `pg_dump --format=custom`, 141,506 bytes, directory `700 root:root`, file `600`, per the IDA-2B pattern.
SHA-256 `a43ec4bf631fc887a5cc64d69933ed9dba83125be454e4040802970b92fbf62f`. `pg_restore --list` exit 0, 264 TOC entries, all 22 tables present, no credential in the archive.

It was then **proven restorable rather than assumed**: restored into a throwaway `idauto_rehearsal` database, which reproduced the live counts exactly (126/73/518/88). The migration was applied there **twice** — first run clean, second run emitting only `already exists, skipping` notices and still committing — proving idempotency before a single statement touched live data. The rehearsal database was dropped afterwards.

### Live apply — before and after

Applied with `ON_ERROR_STOP=1`; all six statements committed in one transaction.

| | observations | media | audit | facts | vehicles | plates | fact_evidence | capture_sources | tables |
|---|---|---|---|---|---|---|---|---|---|
| Before | 126 | 73 | 518 | 88 | 145 | 35 | 37 | 7 | 22 |
| After | 126 | 73 | 518 | 88 | 145 | 35 | 37 | 7 | **24** |

**The migration changed zero rows.** Audit rows unchanged at 518, observations unchanged, and all 73 existing media rows kept `derived_from_media_id IS NULL`. Both new tables are empty.

Counts later read 135/78/554 because the IDA-2D and IDA-2F suites write fixtures to the live database by design (`IDAUTO_TEST_RUNBOOK.md` — persistent-DB reruns accumulate fixtures). That delta is test activity, not migration effect; `idauto_submissions` and `idauto_rate_limit_counters` both remained at 0 rows throughout, since nothing yet writes to them.

**Invariants verified on the live database after apply:** all four foreign keys on the new objects are `NO ACTION` (`confdeltype='a'`), and the entire `public` schema still contains **zero** `ON DELETE CASCADE`/`SET NULL` constraints. The nine observation statuses and the three `access_scope` values are byte-for-byte unchanged. No pseudo-user table, no raw-IP column, no Redis dependency, no rewrite of any media object key.

**Media integrity: CLEAN before and after, identically** — 38 objects / 1088 bytes / 73 rows / 38 distinct keys / 16 shared / max 17 references, with all eight defect classes at zero.

### Tests

`ida-3a-ingestion-schema` 47/47 (re-run by Claude under `env -i`, proving no database, network or environment dependency) · DEVX impact-selected regressions for `projects/idauto/database/`: `ida-2a` 44/44 · `ida-2c` 26/26 · `ida-2d` 39/39 · `ida-2f` 32/32 · `ida-2g` 17/17 · `ida-2h` 37/37 · `mythos-identity-core-0-contract` 124/124. All executed against the live database after the migration.

### Known divergence (cosmetic, recorded deliberately)

`schema.sql` declares `derived_from_media_id` as the third column of `idauto_observation_media`, whereas `ALTER TABLE ADD COLUMN` appends it last on the live database. A fresh install and the migrated database therefore differ in **column order only** — types, nullability, defaults and constraints are identical. Verified that nothing in the repository depends on ordinal position (no `ordinal_position`, `attnum` or positional column access anywhere in `tests/` or `projects/idauto/`). Left as-is: correcting it would mean either rewriting live column order (destructive, and forbidden here) or reordering source for cosmetics.

### Production state

One additive schema migration to `idauto-postgres`, authorised by the owner. Nothing deployed, no container recreated, no DNS record, no auth setting, no Docker group, no firewall rule. Jellyfin untouched. `idauto-postgres` healthy throughout.

### Next stage

**`IDA-3B` — pure ingestion service.** Requires its own explicit authorisation. It is a pure module with no route and no exposure; `IDA-3C` (rate-limit enforcement) must land before any reachable endpoint, and `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO** pending off-host backup, legal/consent review and real auth.

---

## DESIGN GATE — IDA-3-DESIGN-GATE (2026-08-12) — COMPLETE

**Type:** Architecture decision. **Design only — no endpoint implemented, nothing exposed publicly, no SQL executed, no schema changed, nothing deployed, no scraping/OCR/AI vision added, no subagents.**

**Baseline:** `c6aef86071358d67583a60b9a63bfa2898fc15c5` — `main`, clean, HEAD == origin/main, Git as `deploy`.
**Metadata registration commit:** `59a740eff3cb00df0c4be4780d96571378c9321c`
**Design commit:** `2bb6175a56ca7e782797af48bf81ea4e4e33ae90`
**Binding document:** [`docs/IDA3_INGESTION_ARCHITECTURE.md`](IDA3_INGESTION_ARCHITECTURE.md)

### Central finding — most of IDA-3 already exists

Verified against the live schema: `idauto_observations.status` already carries **all nine** lifecycle states (`received · processing · pending_confirmation · pending_review · accepted · rejected · duplicate · conflict · blocked`); `idauto_contributors` already has `trust_score`, submission counters, and `blocked`/`blocked_reason`; `idauto_capture_sources` already **seeds** `PUBLIC_UPLOAD` (trust 1) and `CONTRIBUTOR_UPLOAD` (trust 2) with `requires_consent` and `LEGAL-REVIEW-REQUIRED`; `idauto_vehicle_facts` already carries `source_id`, `observation_id`, `confidence_score`, `verification_status`, `access_scope`, and `is_active` supersession.

**IDA-3 is therefore wiring and enforcement, not modelling.** Net new schema is **2 tables + 1 nullable column**; everything else was classified DEFERRED or REJECTED with reasons.

### Decisions

| Gate | Decision |
|---|---|
| IDENTITY_READY | **YES (contract) / NO (runtime)** — contract ratified, `mythos_core` undeployed, real auth BLOCKED |
| STORAGE_READY | **YES** — audited CLEAN, backup/restore tooling restore-tested |
| OFFHOST_REQUIRED_BEFORE_PUBLIC | **YES** — before any real evidence (IDA-3F), not before the admin-only pilot |
| RATE_LIMIT_STAGE | **BEFORE_ENDPOINT** — IDA-3C, honouring the binding roadmap decision |
| REAL_AUTH_REQUIRED_FOR_PRIVATE_PILOT | **NO** — admin-only behind the existing operator token |
| REAL_AUTH_REQUIRED_FOR_PUBLIC | **YES** — for authenticated tiers; anonymous tier needs none |
| PUBLIC_ENDPOINT_READY_TO_IMPLEMENT | **NO** |
| FIRECRAWL_STAGE | **LATER** — separate `IDA-4-WEB-INGESTION` |

**Notable architectural calls:** no new observation status and no new `access_scope` (existing nine and three suffice) · anonymous submitters get **no** canonical user ID and no contributor row (`actor_ref` stays NULL; accountability via the submission envelope's `ip_hash`, not an invented identity) · dedup may collapse **bytes, never claims** — independent reporters of the same event stay separate as corroboration · **no image decoding in v1**, EXIF stripped before hashing, HEIC not accepted publicly, originals default to `mythos_private` · audit stays inside the data transaction (staged transaction, not a saga).

**Rejected alternatives:** overloading `idauto_verifications` as a throttle store (it is a lookup log, and the roadmap already forbids it) · reusing the Dar Hijama/Coolify Redis instances (cross-product coupling, and those are the uncapped-memory risk flagged in the memory audit) · a reputation engine (the existing `trust_score` counters suffice) · a pseudo-user record for anonymous submitters · a saga for submission atomicity · per-fact `submitted_by` (redundant) · new access scopes · GPS collection in v1.

### Implementation slices (9)

`IDA-3A` schema (2 tables + 1 column, only slice touching the live DB) → `IDA-3B` pure ingestion service → `IDA-3C` rate limiting → `IDA-3D` private admin-only route → `IDA-3E` admin review → `IDA-3F` **off-host backup** → `IDA-3G` consent + legal gate → `IDA-3H` authenticated pilot (needs real auth) → `IDA-3I` public gate. Each needs its own explicit authorisation.

### Validation

Impact analysis confirmed this is docs-only (FAST lane, `usedFallback: false`, **no ID Auto suites selected**), so the live regression suites were correctly not run. project-intelligence 0 errors/0 warnings · governance 36/36 · DEVX-0 45/45 · DEVX-1 92/92 · identity-core 124/124 · storage-ops 72/72 · `git diff --check` clean · secret scan clean · all 5 internal doc links resolve · Stage Runner `validate` resolved the DOCUMENTATION template.

### Blockers to public ingestion (all must clear)

1. IDA-3A–3C not implemented.
2. Off-host backup absent — both backup sets still live on the same host as the data.
3. **`LEGAL-REVIEW-REQUIRED` on `PUBLIC_UPLOAD`** — needs qualified human legal review. The design makes **no legal determination**; it flags where one is required, consistent with the marker already in the schema.
4. Real Mythos auth (IDA-2E) BLOCKED — gates authenticated tiers only.

### Production state

25 containers unchanged. `idauto-postgres` healthy, `RestartCount=0`. Jellyfin untouched. 0 OOM. Swap remains ~1.6 GiB stale (no active paging; the uncapped MySQL containers already flagged in the memory audit). No live media, DB row, container, or configuration touched by this stage.

### Next stage

**`IDA-3A` — ingestion schema only.** Two tables (`idauto_submissions`, `idauto_rate_limit_counters`) plus a nullable `idauto_observation_media.derived_from_media_id`, applied to the live database with a fresh verified `pg_dump` taken immediately beforehand, following the IDA-2B pattern. Changes no runtime behaviour; unblocks 3B and 3C. **Do not implement any endpoint, expose anything publicly, or begin web ingestion.**

---

---

## IMPLEMENTATION — IDAUTO-STORAGE-OPS (2026-08-12) — COMPLETE

**Type:** Operational resilience for the existing media store. **No IDA-3 work, no cloud migration, no schema change, no runtime API change, no auth, no public endpoint, nothing deployed, no subagents.**

**Baseline:** `817661c886fd4791b8e52efead9648b71253fbe6` — `main`, clean, HEAD == origin/main, Git as `deploy`.
**Metadata registration commit:** `252f150afdd3f14a7da8f97d3d38e444a5f25de9`
**Implementation commit:** `a43a35a0464daf2936fbf9ca4baf9b3f001a0076`

### Live media audit (before any tooling was written)

| Measure | Value |
|---|---|
| Media objects on disk | **35** (1,004 bytes) |
| `idauto_observation_media` rows | **68** |
| Distinct `object_key` | **35** |
| Shared objects | **15** — one object referenced by **16** rows, another by 6 |
| Missing objects (row → no file) | **0** |
| Orphans (file → no row) | **0** |
| Hash mismatches / bad paths / zero-byte / size mismatches | **0** |
| Object permissions | uniformly `640 deploy:deploy` |

**All content is synthetic.** Objects are 23–30 bytes of ASCII text carrying `image/jpeg` / `image/png` MIME types — fixtures written by the IDA-2F/2H suites, not real images. They were nonetheless treated as valuable and fully backed up, per the "if you cannot prove it disposable, treat it as valuable" rule.

### Consistency strategy — derived, not assumed

`writes.js` calls `storage.store()` **before** the DB row commits, and its failure path deletes an object **only if no row references it**. Therefore a committed row's object is always already on disk and cannot vanish underneath a copy. The tool exports **DB metadata first** (`REPEATABLE READ READ ONLY`), then copies media. The reverse order would be unsafe — a row committing mid-copy could reference a file created after its directory was walked. The source is fingerprinted before *and* after the copy; if it changed, the manifest says `DEGRADED` rather than claiming consistency.

### Backup created

- **Path:** `/home/deploy/backups/idauto-media-backup-2026-08-12T10-07-59-066Z/`
- **Permissions:** `700` directory, `600` files, `deploy:deploy`
- **Contents:** 35 objects (1,004 bytes), 68 metadata rows, `manifest.json`, `checksums.sha256`, `metadata/observation-media.json`
- **Consistency:** `CONSISTENT` — `source_changed_during_backup: false`, identical before/after fingerprints
- **Verification:** `verify-backup` → **PASS**, 35/35 objects, 0 problems
- **Credential scan:** manifest, checksums and metadata export all clean (metadata carries only object-reference columns)

### Restore test (isolated — live store never touched)

Destination `/home/deploy/restore-test/idauto-media-20260812`:

- Dry-run reported 35 would-create and **created no directory at all**
- Real restore: 35 created, 35 verified back, exit 0
- **All 35 files byte-identical and path-identical to live source** (independent `sha256sum` comparison)
- Nested `aa/bb/<hash>` layout preserved; restored files `640`
- Re-run skipped all 35 as identical — idempotent, no duplication
- After corrupting one restored file, restore **refused with exit 3** and did **not** overwrite it
- Restoring from a tampered backup was refused; nothing was written
- Refused the live media store, a path nested inside it, and `/home/deploy` — all exit 3

### Integrity findings

Final audit after all regression runs: **CLEAN** (0 critical). Two benign observations recorded in the runbook §12, both deliberately **not** fixed:

1. **16 empty directories** in the live store — `removeUnconditionally()` unlinks files without pruning parents. Fixing this would introduce a race: pruning in the delete path can remove a directory between `mkdir` and `writeFileSync` in a concurrent `store()`. Content-addressed stores conventionally leave directories in place. Backups intentionally do not reproduce empty directories.
2. **Directory mode drift** — subdirectories are a mix of `755`/`775` (both `deploy:deploy`). The store root is `750` so nothing outside `deploy` can traverse; object files are consistently `640`. Cosmetic.

### No live mutation — proof

Every object present at backup time was re-checked afterwards: **0 missing, 0 altered**. The store grew 35→38 objects and 68→73 rows purely because the IDA-2F/2H regression suites append their own synthetic fixtures — expected and documented. `media-ops.js` has **no delete command at all** and issues no data-modifying SQL (both asserted by the suite).

### Tests

| Suite | Result |
|---|---|
| `idauto-storage-ops` (new) | **72/72** |
| ID Auto regression (selected by DEVX-1, no fallback) | **195/195** (2A 44 · 2C 26 · 2D 39 · 2F 32 · 2G 17 · 2H 37) |
| `devx-1-idauto-test-impact` | **92/92** (grew from 90 — it auto-validated the new `projects/idauto/ops/` rule and its ordering) |
| `devx-0` · governance · project-intelligence | 45/45 · 36/36 · 0 errors/0 warnings |
| `git diff --check`, JS syntax, JSON validity, secret scan | PASS |

DEVX-1 selected the six ID Auto suites automatically with `usedFallback: false` — the mapping added in the previous stage did its job on its first real use.

### Files changed

4: `projects/idauto/ops/media-ops.js` (new), `docs/IDAUTO_STORAGE_RUNBOOK.md` (new), `tests/idauto-storage-ops-test.js` (new), `projects/meta/test-impact-map.json` (one new `projects/idauto/ops/` rule). **No backup data was committed to git.** No runtime file, schema, or credential changed.

### Production state

25 containers unchanged. `idauto-postgres` healthy, `RestartCount=0`. **Jellyfin untouched.** No container created. No credential, DB config, deployment env, or ownership changed.

**Noted, not a blocker:** swap sat at 1.6 GiB/2 GiB during this stage, but `vmstat` showed `si/so = 0` — stale pages, no active paging, 5.5 GiB RAM available, 0 OOM events. The top swap holders are the two uncapped MySQL containers already flagged as the main residual risk in `VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`.

### Retention recommendation (for IDA-3)

Today's media is disposable synthetic fixtures. Once IDA-3 accepts community capture it becomes non-disposable, possibly legally relevant evidence. Recommended then: **daily** backups plus one before any schema/storage/deployment change; PostgreSQL dump taken immediately after each media backup and the pair recorded; retention 7 daily / 4 weekly / 3 monthly, pruned only after verifying a newer backup; `verify-backup` on every generation and a monthly restore drill.

**Largest remaining gap: both backup sets live on the same host as the data they protect.** That covers accidental deletion and corruption but **not** host or disk loss. Off-host copies should be resolved before IDA-3 stores real evidence.

### Deferred

Automated backup scheduling (deliberately not scheduled — no approved scheduling mechanism exists for it, and an unattended job touching production storage warrants its own authorised change). Orphan cleanup (no delete command exists by design). Off-host backup replication. Empty-directory pruning (rejected on race-safety grounds).

### Next stage

**`IDA-3-DESIGN-GATE`** — design-only prerequisites for public/community capture (`MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md` §8). Media durability and the identity contract are both now in place. **Do not implement a public endpoint.**

---

---

## AUDIT — IDA-2-PHASE-B-DEEP-AUDIT-0 (2026-08-11)

**Status and baseline:** COMPLETE. Deep technical/security/architecture/data-integrity/runtime/governance audit of IDA-2A through IDA-2H, starting from clean `main`/`origin/main` `30c47d5bde98a6f6bfc57bb7c4525e37d5833ffe`. No deployment, IDA-2I implementation, IDA-3 implementation, schema migration, production-data cleanup, or real-auth work occurred.

**Commits created and pushed:** `6f0cd7b04d98e5fcf34510e20e5b8a40ef78d094` (contain malformed route encoding); `e802ac7` (guard stale review responses and prove concurrent decisions); `cc4f987` (return JSON/media payload-limit 413 without socket reset); `c3b8900` (reconcile Phase B roadmap/architecture/schema status and canonical ledger); `84cde7b` (retain admin-entered fact provenance through `observation_id`).

**FIXED findings:** MEDIUM — malformed percent-encoded route segments could throw synchronously outside the promise error boundary; they now return 400 and the server remains responsive. MEDIUM — over-limit JSON/media bodies destroyed the request socket and produced `ECONNRESET` instead of 413; readers now discard excess buffered data, drain the request, and return 413. MEDIUM — review detail failures and completed decisions could overwrite a newer selection; all success/error/decision paths now check `activeId`, and resolved detail is invalidated. MEDIUM — admin-created facts omitted the observation link despite AD-8; the UI now supplies `observation_id`, and `writes.js` verifies that it belongs to the target vehicle before inserting. INFO — IDA-2A through IDA-2F/2E-PRE were absent from the canonical ledger, G/H next-stage metadata was stale, H lacked its handover commit, the audit was PLANNED, and roadmap/architecture/schema comments falsely described live PostgreSQL and completed UIs as future work; these were reconciled from Git history and committed evidence.

**ACCEPTED findings:** All API routes are currently identity-stub-admin-gated; static UI shells contain no data and API access remains gated. SQL request values are parameterized. `mythos_private` facts/media are filtered at query level from vehicle, media, and review reads; review/media responses expose no `object_key` or filesystem path. Tokens remain page-memory only; no local/session storage, cookies, URL token, unsafe `innerHTML`, or credential logging was found. CSP includes same-origin default/script/style/connect, `base-uri 'none'`, and `frame-ancestors 'none'`; static assets use `no-store` and `nosniff`. Mutation inventory is six audited operations (`vehicle.create`, `plate.create`, `observation.create`, `fact.create`, `observation_media.create`, and `observation.review.accept|reject`): each real DB mutation uses `withAudit()`, resolved identity, stable target refs, one transaction, and rollback on either data or audit failure. `skipAudit` is not exported and is reachable only after `SELECT ... FOR UPDATE` proves an identical completed review decision; live accept/accept and reject/reject create one audit mutation, while accept/reject produces one success, one 409, and one matching audit event. Live schema has the expected 22 tables/constraints/indexes; current queries have relevant indexes and no present-day missing-index defect. All 13 distinct media references matched 13 on-disk objects.

**BLOCKED findings:** Full `IDA-2E` remains BLOCKED: there is still no real Mythos OS identity/auth service or concrete `MYTHOS_SUPER_ADMIN` contract to integrate. `IDA-2E-PRE` remains a clearly labeled, operator-provisioned static token-to-identity stopgap and must not be described as real auth.

**DEFERRED findings:** MEDIUM — PostgreSQL backup exists and was restore-tested, but the separate media directory has no documented external backup/restore coverage; resolve before storing non-disposable media. MEDIUM — the manual-entry UI is a sequential multi-request workflow: earlier audited records can remain when a later plate/observation/fact/media step fails. Observation-success followed by fact/media failure is recoverable incomplete state; vehicle/plate success followed by observation failure conflicts with the ideal observation-first workflow and needs a separately designed composite API/transaction rather than an audit refactor. LOW — persistent live suites intentionally accumulate synthetic fixtures (audit start: 46 vehicles, 17 plates, 36 observations, 39 facts, 19 evidence rows, 34 media rows, 171 audits; database about 9.6 MiB); no current correctness/performance/backup-size threat, but a fixture lifecycle is needed before scale becomes material. LOW — `idauto_verifications` has duplicate source/live foreign-key constraints for `org_id` and `user_role_id`; harmless today, but removing them requires a migration. LOW — media validation trusts an allowed MIME header rather than content sniffing; no byte-serving/public upload route exists, so enforce content validation with the future public ingestion boundary. ACCEPTED/DEFERRED filesystem limitation: a process crash after file write and before DB insert can orphan an object, and manual object deletion can leave a row without bytes; current DB-failure cleanup is correct (including shared hashes), but reconciliation/backup belongs to a later storage-operations stage.

**IDA-2I decision:** `DEFER_IDA_2I_TO_IDA_3`. Today the only meaningful candidates are health, admin reads/writes/review/media routes; all are static-identity-admin-only and the server is not deployed. The current abuse case is therefore compromised/operator token use, for which real auth, secret rotation, and deployment controls matter more than a speculative limiter. IDA-3 introduces anonymous/authenticated lookup and community capture, where limiter keys must be defined from the actual endpoint: hashed IP plus authenticated identity/contributor/session and target dimensions (plate/vehicle/verification target) as appropriate. `idauto_verifications` is verification-domain history, not a transport/security counter store; using it for enforcement would mix concerns and lock premature assumptions. Trigger: design and implement rate limiting before the first IDA-3 public plate-lookup or community-capture endpoint is exposed.

**Phase B completion state:** IDA-2A through IDA-2H engineering is COMPLETE WITH EXPLICIT EXCEPTIONS: full IDA-2E blocked, IDA-2I deferred to the IDA-3 exposure gate, API/UI undeployed, and the operational risks above deferred. This is not a production-readiness or public-launch declaration.

**Validation:** Syntax passed for all eight relevant JS files. Final live suites passed IDA-2A 44/44, IDA-2C 26/26, IDA-2D 39/39, IDA-2F 32/32, IDA-2G 17/17, IDA-2H 37/37 — 195/195. IDA-2H additionally passed 37/37 twice consecutively after concurrency coverage was added. Project intelligence passed 0 errors/0 warnings; governance 36/36; DEVX 45/45; all 31/31 registered stages validated; `git diff --check` and relevant secret/privacy scans passed. Repository-wide regression was not run: changes are isolated to ID Auto reference/runtime/tests and governance metadata, with no shared Mythos runtime code.

**Runtime and VPS reality:** `idauto-postgres` is live, healthy, loopback-only, `RestartCount=0`, with 384 MiB cap/96 MiB reservation. `/home/deploy/deployments/idauto-media` is live at `deploy:deploy` mode 750. No ID Auto API/UI container, systemd service, port 3001 listener, persistent Node process, or public endpoint exists. Final safety snapshot: 25 containers, 3.6 GiB available RAM, swap fully allocated but no new kernel OOM evidence, 27 GiB disk free, and Jellyfin unchanged (same container ID/start time, running, zero restarts).

**Exact next stage:** IDA-3 public-ingestion and rate-limit design gate (planning/security design first; no public endpoint may be exposed before limiter/auth/legal prerequisites are explicit).

---

## BLOCKER RESOLUTION — IDA-2-PHASE-B-DEEP-AUDIT-0 Stage Runner Metadata (2026-08-11)

**Status:** Resolved, validated, committed, pushed, and verified on `origin/main`. Metadata commit and verified remote HEAD: `89be7fbd7f2e439df7a63ea8862ec4c4c1ce3085`. Governance-only metadata change; the deep audit was not started, IDA-2I was not implemented, ID Auto runtime code was not modified, and production was not mutated.

**Blocker cause:** Stage Runner could not resolve `IDA-2-PHASE-B-DEEP-AUDIT-0` because the canonical `projects/meta/project-ledger.json` had no record for that stage.

**Exact metadata fix:** Added one `id-auto` ledger entry for `IDA-2-PHASE-B-DEEP-AUDIT-0` titled `Phase B deep audit`, with status `PLANNED`, type `GOVERNANCE`, null implementation/merge/handover commits and completion date, empty tests and blockers, `IDA-2I (NOT STARTED)` as the non-self-referential post-audit next stage, and evidence limited to `docs/IDAUTO_ROADMAP.md`, `docs/IDAUTO_ARCHITECTURE.md`, `projects/idauto/reference/`, and `tests/ida-*.js`. No existing stage metadata changed.

**Validation:** `node scripts/project-intelligence.js validate` passed with 0 errors/0 warnings; governance passed 36/36; DEVX passed 45/45 under the required `deploy` execution context; the new stage resolved the `GOVERNANCE` template; all 23/23 registered stages validated; `git diff --check` passed; and, from the clean pushed commit, `node scripts/mythos-stage.js start IDA-2-PHASE-B-DEEP-AUDIT-0 --dry-run` returned `eligible: true`, FAST risk, and no blockers.

**Exact next stage:** Execute `IDA-2-PHASE-B-DEEP-AUDIT-0` (audit/governance only unless its evidence separately authorizes a narrow fix).

---

## IMPLEMENTATION — IDA-2H: Review Queue UI (2026-08-11)

**Status:** Implemented, validated, committed, pushed, and verified on `origin/main`. Implementation commit: `a431a01a44df57801cbf9dab3af29a1dd854b89f`.

**Metadata blockers resolved before implementation:** Starting remote HEAD was `4d4612527bc665a56f22835b67ca191be38a94c7`. Stage Runner first returned `UNKNOWN_STAGE`; the minimal IDA-2H ledger registration was validated and pushed as `242dcef04cc51b5ec3cee044a2ceae9a1afdf1a3`. The next preflight correctly found `DEPENDENCY_UNSATISFIED` because the already-pushed IDA-2G stage was still marked `PLANNED`; its ledger record was reconciled solely from verified Git/handover evidence and pushed as `a6827dcaea6beee64314fe2635bd64e7d0feaf07`. From that clean baseline, IDA-2H returned `eligible: true`, STANDARD risk, and no blockers.

**Objective:** Add the private admin review queue for `pending_review` and `pending_confirmation` observations, safe detail views, and explicit audited Accept/Reject decisions. No real auth, public ingestion, rate limiting, IDA-3 work, schema change, deployment, or unrelated production mutation was included.

**Changed implementation files:**
- `projects/idauto/reference/review.html` — private admin review page with explicit loading, empty, error, detail, Accept, and Reject states.
- `projects/idauto/reference/review-ui.js` — same-origin queue/detail/decision client; token remains in page memory only; actions disable while a decision is in flight.
- `projects/idauto/reference/admin.css` — bounded responsive styles for the review page, preserving the IDA-2G visual surface.
- `projects/idauto/reference/api.js` — protected queue/detail routes, review assets under `/admin/review`, and one minimal decision route. Detail SQL excludes `mythos_private` facts/media and never selects `object_key` or raw storage paths.
- `projects/idauto/reference/writes.js` — transaction-locked observation review mutation using the existing `withAudit()` boundary. Actual status changes and their audit rows commit or roll back together; repeated identical decisions are verified no-ops with no duplicate audit, while reversed/non-pending decisions fail with 409.
- `tests/ida-2h-review-queue-ui-test.js` — live per-run-unique review UI/API suite.

**Security and compatibility guarantees:** Every review API remains behind the existing IDA-2E-PRE identity stub. Audit `actor_ref` is the resolved identity and never the bearer token. Tokens are not written to localStorage, sessionStorage, cookies, audit data, source, or response content. The review shell preserves the existing same-origin CSP, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Private facts and media remain query-filtered; media responses contain allowed metadata only, with no object-storage key/path. Existing IDA-2C/2D/2F/2G routes and response behavior remain compatible.

**Validation:** Syntax checks passed for `api.js`, `writes.js`, `review-ui.js`, and the new test. The targeted IDA-2H suite passed **29/29 twice consecutively** against the persistent synthetic database. Its coverage proves queue filtering, safe details, unauthorized blocking, Accept and Reject with atomic audit rows, identity attribution, repeated-decision idempotency, private fact/media exclusion, no raw storage reference, and invalid/nonexistent/non-pending targets producing no phantom audit rows. Final required regressions passed: IDA-2G **16/16**, IDA-2A **44/44**, IDA-2C **24/24**, IDA-2D **38/38**, IDA-2F **31/31** — **182/182** assertions in the final combined run. Metadata validation passed 0 errors/0 warnings plus governance **36/36** and DEVX **45/45**. No repository-wide suite was required: Stage Runner close classified the six implementation files as STANDARD risk with no blockers, and no shared `js/`, root `index.html`, schema, deployment, or high-risk path changed.

**Self-caught issues/fixes:** No implementation defect was found after the first targeted run. Two pre-implementation metadata blockers were surfaced and resolved separately as described above; implementation did not begin until eligibility was clean. The new suite used timestamp-plus-random per-run fixtures from its first version and passed twice against the persistent database.

**Production safety/state:** Preflight showed the expected 25 containers, healthy `idauto-postgres` with `RestartCount=0` and unchanged 384MiB/96MiB caps, 2.9GiB available RAM, 215MiB free swap, and 31GiB disk. No application deployment or data migration occurred; live database/media writes were synthetic test fixtures only. Jellyfin and unrelated services were untouched.

**Unresolved risks:** Full IDA-2E real Mythos auth remains blocked as previously documented; the review UI uses the explicit identity stub. IDA-2I rate limiting remains unimplemented and may still be better aligned with IDA-3 public ingestion, as previously noted. The review queue currently derives from the two observation pending statuses; it does not add broader fact/document/contributor review workflows.

**Exact next stage:** IDA-2I — rate limiting (not started; requires separate authorization and scope confirmation).

---

## IMPLEMENTATION — IDA-2G: Admin Manual Entry UI (2026-08-11)

**Status:** Implemented, validated, committed, pushed, and verified on `origin/main`. Implementation commit: `b84915316d74de9c0a28f541e75028527a0bda12`.

**Objective:** Add the private admin-facing manual-entry screen that drives the existing IDA-2C/2D/2F APIs. No real Mythos auth, review queue, rate limiting, deployment, schema change, or production configuration change was included.

**Preflight:** Git operations ran as `deploy`. Clean `main` matched `origin/main` at starting commit `53bc247c91a549abf4bdc6dd3bd5dde802c29aad`. Live VPS safety remained within the recorded envelope: 25 containers, `idauto-postgres` healthy with `RestartCount=0` and unchanged 384MiB/96MiB limits, 2.9GiB available RAM, 201MiB free swap, and 31GiB free disk. `node scripts/mythos-stage.js start IDA-2G --dry-run` returned `eligible: true`, STANDARD risk, and no blockers.

**Changed files:**
- `projects/idauto/reference/admin.html` — manual-entry form for vehicle, optional plate, observation, optional fact/evidence, and optional observation image.
- `projects/idauto/reference/admin-ui.js` — sequential same-origin client for the existing audited APIs; bearer token stays in page memory and is never persisted.
- `projects/idauto/reference/admin.css` — responsive standalone admin styling.
- `projects/idauto/reference/api.js` — serves the data-free admin shell/assets at `/admin` with no-store, nosniff, and restrictive CSP headers; all `/api/*` routes remain behind the existing identity gate.
- `tests/ida-2g-admin-manual-entry-ui-test.js` — live UI/API workflow coverage.

**Compatibility and guarantees:** The identity stub is unchanged. UI writes call the existing IDA-2D/2F endpoints, so `withAudit()` remains the sole database transaction/audit boundary. The live targeted test confirms four UI-triggered mutations produce four audit rows attributed to the resolved identity, never the bearer token. A written `mythos_private` fact remains excluded from the existing read API. Existing API response shapes and behavior are unchanged; no review-queue or rate-limit path was added.

**Validation:** Syntax checks passed for `api.js`, `admin-ui.js`, and the new test. Targeted IDA-2G suite passed 16/16 twice consecutively against the live synthetic database. Required regressions passed: IDA-2A 44/44, IDA-2C 24/24, IDA-2D 38/38, IDA-2F 31/31 — 153/153 assertions in the final combined run. The repository-wide suite was not rerun because the change is isolated to `projects/idauto/reference/` and its targeted test, does not modify shared `js/`, `css/`, root `index.html`, schema, or shared core behavior, and the Stage Runner close assessment returned STANDARD risk with no blockers.

**Stage Runner closure:** Changed-file scope exactly matched the five files above; risk lane STANDARD; no blockers. Implementation commit and remote HEAD matched at `b84915316d74de9c0a28f541e75028527a0bda12` before this handover update.

**Deployment and migration:** Not deployed. No database migration or production data migration. Live writes were synthetic test records only.

**Known risks / deferred work:** Full IDA-2E real Mythos auth remains blocked exactly as previously documented. The page currently relies on the existing operator-provisioned identity token stub. IDA-2H review queue UI and IDA-2I rate limiting remain unimplemented and out of this stage.

**Next stage:** IDA-2H — Review queue UI (not started; requires separate authorization).

---

## BLOCKER RESOLUTION — IDA-2G Stage Runner Metadata (2026-08-11)

**Status:** Resolved and pushed. Metadata-only developer-tooling change; no IDA-2G UI was implemented and production was not mutated.

**Blocker cause:** `node scripts/mythos-stage.js start IDA-2G --dry-run` returned `UNKNOWN_STAGE` because `scripts/mythos-stage.js` resolves stages exclusively from `projects/meta/project-ledger.json`, where `IDA-2G` had no entry.

**Exact metadata fix:** Added one `id-auto` ledger entry for `IDA-2G` with title `Admin manual entry UI`, status `PLANNED`, type `RUNTIME`, no blockers, the existing ID Auto reference/test evidence paths, and `IDA-2H (NOT STARTED)` as its next stage. No other stage metadata changed. The initial registration commit (`e5e993b75c48070fc02330dfc19dff5dee3c93a9`) used a self-referential `next_stage` value that the dependency inference correctly rejected; follow-up commit `99725f02622eb0308d3a5baa26301350a130f578` removed that self-dependency and is the validated metadata state.

**Validation:** `node scripts/project-intelligence.js validate` passed with 0 errors/0 warnings; `tests/mpi-0-finalization-governance-test.js` passed 36/36; `tests/devx-0-development-acceleration-test.js` passed 45/45; all 21/21 registered stages passed `mythos-stage.js validate`; and the required `node scripts/mythos-stage.js start IDA-2G --dry-run` returned `eligible: true`, `risk_lane: STANDARD`, and no blockers from clean commit `99725f02622eb0308d3a5baa26301350a130f578` on `origin/main`.

**Next stage:** IDA-2G implementation.

---

## FINAL-SESSION-HANDOVER-2026-08-11

**Type:** Read-only continuation checkpoint. No feature implemented, no production mutated. Verified `origin/main` HEAD and a clean worktree before writing this entry, per standard preflight (`mythos-repo-guardian`).

**Read this entry first, then the detailed per-stage entries below it (each has its own full implementation record, exact commands, and evidence) for anything this summary doesn't cover in enough depth.**

### Exact current remote HEAD

`ec79c44576349992546e56bd35c56d68fc45e070` — confirmed matching local `HEAD` via `git fetch origin && git rev-parse HEAD && git rev-parse origin/main` immediately before this entry was written.

### IDA-2A → IDA-2F completion state

| Stage | Status | Summary |
|---|---|---|
| IDA-2 Phase A | ✓ Done (+ corrected same day) | Schema finalized (`schema.sql`, migration-ready, not yet applied at the time), `plate-validator.js`. `IDA-2A-CORRECTION-0` resolved tracked risk R-T03 (`visibility_scope`→`access_scope`), reconciled stale docs, added safe caching. |
| IDA-2B | ✓ Done | Provisioned `idauto-postgres` (PostgreSQL 15-alpine), memory-capped from first start, schema applied, backup **and tested restore** completed before declaring PASS. |
| IDA-2C | ✓ Done | Read-only API (`api.js`, GET-only at the time): vehicles, plates, observations, facts, evidence. Placeholder admin gate. `mythos_private`-scope reads excluded (no audit-on-read path). |
| IDA-2D | ✓ Done | Write API + atomic audit logging (`writes.js`'s `withAudit()`): every mutation and its audit row commit or roll back together, proven in both failure directions by test. |
| IDA-2E | **BLOCKED** | Requested "real Mythos OS auth/identity integration" — researched and confirmed no such service exists anywhere in this codebase (see below). No code written for it. |
| IDA-2E-PRE | ✓ Done | Minimal, honestly-labeled identity stub (`identity.js`) resolving the IDA-2E blocker's audit-attribution requirement without pretending to be real auth. User-selected option after the blocker was reported. |
| IDA-2F | ✓ Done | Object storage wiring (`storage.js`, local content-addressed filesystem — no cloud service exists either), `POST`/`GET /api/observations/:id/media`. Two self-caught bugs fixed pre-commit (see "Unresolved risks" below for the pattern, not the specific fixed bugs). |

### Full IDA-2E blocker + IDA-2E-PRE status (do not re-attempt full IDA-2E without new information)

Full `IDA-2E` (`docs/IDAUTO_ARCHITECTURE.md` §4.1's `mythos_auth` contract — JWT/opaque-ref tokens from a real Mythos OS auth service) is **blocked**, confirmed by direct code search, not assumption: `js/auth.js` is a single shared client-side password with zero per-user identity; `google_auth.php`/`google_callback.php` is a one-off contacts-import OAuth flow, not login; zero PHP files anywhere use `$_SESSION`/JWT; `MYTHOS_SUPER_ADMIN` is referenced across multiple architecture docs with no implementation anywhere. Building a real service would be a new platform-wide capability, not an ID Auto slice — unblocking this requires that service to exist somewhere in the ecosystem first, which is out of scope for continuing IDA-2 work. **`IDA-2E-PRE`** (a small `IDAUTO_ADMIN_IDENTITIES` token→identity map, `identity.js`) resolves the narrower "audit records need a real identity, not a raw token" requirement in the meantime and is complete/in place — do not confuse it with full `IDA-2E` in future planning.

### Live infrastructure: locations and safety constraints

- **PostgreSQL**: container `idauto-postgres` (`postgres:15-alpine`), deployed at `/home/deploy/deployments/idauto-postgres/` (`docker-compose.yml` + `600`-permission `.env`, password never committed). **`mem_limit=384m` / `mem_reservation=96m`, set from first start — never uncapped.** Bound to `127.0.0.1:5432` only. Backup at `/home/deploy/backups/idauto-postgres-20260810/` (`700 root:root`), restore-tested.
- **Media storage**: `/home/deploy/deployments/idauto-media/` (`750 deploy:deploy`), content-addressed local filesystem, ~112K of synthetic test data as of this entry.
- **VPS-wide constraint, still true**: swap runs chronically near-full (currently `1.8Gi`/`2.0Gi` used, `185Mi` free) but has not thrashed at any point this session; available RAM has stayed ≥2.9Gi throughout. Before any further mutation: re-check `free -h`/`swapon --show`/`docker ps -a` fresh — do not trust these numbers as still current.
- **Execution identity is not optional, and differs by what you're touching**: `sudo -n` (passwordless root) for system/Docker/filesystem operations; **all Git operations and any test that touches `idauto-media` must run as `sudo -u deploy -H bash -lc '...'`** — this session's shell is `ubuntu`, not in the `deploy` group, and a filesystem-touching test run as `ubuntu` will fail with `EACCES` (this happened once this session; DB-only tests don't hit it, since TCP isn't gated by Unix file permissions the way local storage is).

### Current test results (all re-run fresh immediately before this entry, not carried over from memory)

`tests/ida-2a-schema-and-plate-validation-test.js`: **44/44** (offline). `tests/ida-2c-readonly-api-test.js`: **24/24** (live). `tests/ida-2d-write-api-and-audit-test.js`: **38/38** (live). `tests/ida-2f-object-storage-test.js`: **31/31** (live). **137/137 total.** All four live/offline suites use fresh per-run identity tokens and (for IDA-2D/2F) timestamp-seeded synthetic content — safe to re-run repeatedly against the persistent database (this was NOT true of the first draft of either IDA-2D's or IDA-2F's test suite; see "Unresolved risks" below).

### Remaining Phase B slices

- `IDA-2G` — Admin manual entry UI. Not started.
- `IDA-2H` — Review queue UI. Not started. Per the original slice plan, `IDA-2G`/`IDA-2H` could run in parallel once authorized (disjoint surface area) — that would still need explicit parallel authorization, not assumed.
- `IDA-2I` — Rate limiting backed by `idauto_verifications`. Not started. Lowest urgency — no public-facing endpoint exists yet in Phase B (admin-only, gated). Open question carried since the original slice plan: might be better scoped into `IDA-3` (which is where public capture actually begins) instead of staying in Phase B.

### Exact recommended next stage

No stage is authorized by this entry. If continuing IDA-2 Phase B, `IDA-2G` or `IDA-2H` are the next logical candidates (their dependencies — read, write, and now media endpoints — are all in place); `IDA-2I` can wait. None of the three should be started without the owner's explicit authorization for that specific slice, per this project's one-major-stage-rule and stage-by-stage authorization discipline (every slice this session followed that pattern; do not skip it because a run of slices completed smoothly).

### Important unresolved risks / blockers (carry these forward, do not silently rediscover them)

1. **Full `IDA-2E` remains blocked** — see above. Do not attempt it again without confirming a real Mythos OS identity service now exists somewhere.
2. **Test-writing pattern to watch for**: two separate self-caught bugs this session (IDA-2D, then IDA-2F) were the *same* root cause — a test asserting an absolute count ("exactly N rows for this key") against content whose hash/value was a static seed, which broke on the second run against the persistent database. Both were caught by routinely re-running suites twice before committing, not by first-pass code review. **Any new test in this codebase asserting an absolute count tied to inserted data must use per-run-unique content or a relative/delta count**, or repeat this exact class of bug.
3. **`mythos_private` reads remain restricted** on both `GET .../facts` and `GET .../media` — writes to that scope are audited (safe), reads are not (no audit-on-read mechanism exists). Do not relax this without building audit-on-read first; it was deliberately preserved, not overlooked, across IDA-2D/E-PRE/F.
4. **Container count is 25, not the 23 documented in the oldest audits** — `jellyfin` (a user-confirmed, authorized, unrelated personal media server) and `idauto-postgres` account for the difference. If a future session sees a container count that doesn't match 25 exactly, treat it as worth investigating, following the same STOP-and-classify discipline used earlier this session for the original 24-container discrepancy — don't assume it's fine, and don't assume it's a problem either.
5. **VPS memory-budget work from earlier this session remains partially complete** — Stack B Redis ×3 and `coolify-sentinel` are still uncapped (see `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`); unrelated to ID Auto but still an open item on this same VPS.

### Required execution identities

- **`sudo -n`** — passwordless root, for system/Docker/filesystem read and write operations (container inspection, live safety checks, creating deployment directories).
- **`sudo -u deploy -H bash -lc '...'`** — required for **all** Git/GitHub operations without exception, and for any test or command that reads/writes under `/home/deploy/` paths owned by `deploy` with restrictive permissions (notably `idauto-media/` and the `idauto-postgres` `.env`). This session's own shell user (`ubuntu`) has neither Git credentials configured for this repo nor filesystem group membership for `deploy`-owned paths.
- **No subagents** — every stage this session, without exception, was performed directly. Continue that pattern unless explicitly told otherwise.

### Before acting on anything above

**The next model must read GitHub (`git fetch origin`, confirm HEAD) and this file (`docs/AI_HANDOVER.md`, starting from this entry) in full, and be aware of the installed Mythos Skills (`.claude/skills/`), before taking any action.** Do not act on a summary of a summary, do not assume the state described here is still current without re-verifying it live, and do not skip the per-stage detailed entries below this one if a specific implementation detail matters for the next task.

---

## IMPLEMENTATION — IDA-2F: Object Storage Wiring (2026-08-11)

**Type:** Production implementation (application code, local filesystem + live database — synthetic/pilot data only). Fifth implementation slice of IDA-2 Phase B. Preserves the identity stub, existing API behavior, write atomicity, and audit guarantees unchanged. No UI, no rate limiting, no real Mythos auth.

**No subagents used.** `sudo -n` for read-only VPS safety checks and creating the media storage directory. `sudo -u deploy -H bash -lc '...'` for all Git operations and all test execution (see the filesystem-permission note below — this stage's tests specifically required it, unlike IDA-2C/2D's DB-only tests).

**Repository baseline verified:** `origin/main` HEAD confirmed as `fafcf604bf1980e824e78469393f1e7b702cdc03` (the IDA-2E-PRE / IDA-2E-blocker commit) before this stage began.

### Research before writing code

Same discipline as IDA-2C's DB-driver decision and IDA-2E's auth research: checked whether a real object storage service exists anywhere before assuming one needed to be invented. Found none (no S3/MinIO/R2 configured anywhere on this VPS or referenced as live infrastructure — Cloudflare R2 appears only as a *planned, not-started* future integration, `INF-CF-6`). Also found `upload.php` — the main Mythos OS app's own, already-existing, host-native file-storage mechanism (saves to `/documents/{cat}/` with type/size validation). This is not a blocker like IDA-2E: local filesystem storage is the established pattern for *this specific deployment*, so IDA-2F follows it rather than inventing a fictitious cloud integration.

### What was built

- **`projects/idauto/reference/storage.js`** — new. Content-addressed local filesystem storage: `store(buffer, mimeType)` validates mime type (`image/jpeg`, `image/png`, `image/webp`, `image/heic` — matching `idauto.example.json`'s documented `allowed_mime_types`) and size (20MB cap, matching the same config's `max_upload_size_mb`), then writes to `IDAUTO_MEDIA_STORAGE_PATH/<sha256[0:2]>/<sha256[2:4]>/<sha256>` — a new directory, `/home/deploy/deployments/idauto-media/` (`750 deploy:deploy`), created this session, kept separate from both this repository and `upload.php`'s own storage. Re-storing identical bytes is a no-op (the file already exists at that path) — genuine deduplication at the file level.
- **New routes in `api.js`**: `POST /api/observations/:id/media` (raw binary body via a new `readBinaryBody()`, distinct 20MB cap from the existing JSON routes' 64KB one; `Content-Type` header is the mime type; optional `X-Idauto-Media-Type`/`X-Idauto-Access-Scope`/`X-Idauto-Blurred` headers carry the small amount of metadata that isn't the file itself), `GET /api/observations/:id/media` (metadata only — `object_key` is a storage reference, never a fetchable URL or streamed file; no image-serving path exists in this stage, consistent with "No UI").
- **`writes.js` gained `createObservationMedia()`**, going through the existing `withAudit()` unchanged — same real-identity `actor_ref`, same fail-closed-without-identity guarantee established in IDA-2E-PRE. Existing `withAudit()`, `mapDbError()`, and every other write function are untouched.
- **Read policy unchanged**: `GET .../media` excludes `mythos_private`-scope rows, the same policy IDA-2C established and IDA-2D preserved for facts — this stage extended the *pattern* to a new resource type, it did not relax it. (The schema's own default `access_scope` for `idauto_observation_media` is `mythos_private`, so most uploads are excluded from reads unless a caller explicitly widens scope on write — exactly mirroring facts.)

### A genuinely new atomicity problem, worked through explicitly

Every prior write in this module (IDA-2D, IDA-2E-PRE) has its entire mutation inside one Postgres transaction. Object storage breaks that: a filesystem write cannot participate in a database transaction. Two things were done about this, deliberately, not accidentally:
1. **Order of operations**: the observation-existence check runs *before* `storage.store()` is ever called. A request for a nonexistent observation never touches disk at all — confirmed by test (`fs.existsSync()` on the would-be path returns `false` after a 404).
2. **Cleanup, done safely**: if the atomic DB+audit insert fails *after* a successful disk write, `writes.js`'s catch block queries `idauto_observation_media` for any *other* row still referencing the same `object_key` before deciding whether to delete the file. **This check was added after catching a real bug in my own first draft**: because storage is content-addressed, two different observations uploading identical bytes get the same key — an unconditional "delete on failure" would have risked deleting a file a different, already-committed row still needs. Caught and fixed during implementation, before any test was written against it — the shipped code was never wrong in a committed state.
3. Both directions proven by test: an unreferenced orphan (created via a direct, HTTP-unreachable call to `createObservationMedia()` with no identity — same pattern as IDA-2D's atomicity unit test) gets cleaned up; a file already referenced by two earlier successful uploads survives a subsequent failed attempt with the same content.

### Self-caught test bug (second occurrence of this exact class, now a recognized pattern)

The first version of this stage's test used a static content seed for one of its fixtures, which passed on the first run but broke (`found 6` instead of `found 2`) on a routine re-run against the persistent database — identical root cause to IDA-2D's hardcoded-plate-number bug: an absolute row-count assertion tied to content whose hash never changes across runs. Fixed the same way (`Date.now()`-seeded content); confirmed idempotent across 3 consecutive runs afterward. Both self-caught bugs in this project now share one lesson, worth stating plainly for future stages: **any test assertion of the form "exactly N rows/matches for value X" is unsafe against a persistent database unless X is unique per run.**

### A real, non-code blocker hit and resolved during this stage

The first test run failed with `EACCES` — not a logic bug, a Unix permission boundary. The media storage directory is `deploy:deploy`, `750`; this session's shell runs as `ubuntu`, which is not in the `deploy` group. `IDAUTO_DB_HOST`-style Postgres tests (IDA-2C/2D) never hit this, because TCP access to `127.0.0.1:5432` isn't gated by Unix file permissions the way a local filesystem write is. Resolved by running the test (and, for consistency, the full regression suite) via `sudo -u deploy -H bash -lc '...'` — the same execution identity already used for every Git operation in this project, just not previously needed for `node` test invocations before this stage introduced real filesystem writes.

### Tests

- **`tests/ida-2f-object-storage-test.js`** — new, **31/31 passing**, live against `idauto-postgres` and the real local filesystem (`/home/deploy/deployments/idauto-media/`). Covers: the identity gate preserved on media routes; a successful upload creating a file, a DB row, and an audit row together; the file's on-disk content verified byte-for-byte against what was uploaded; the default-`mythos_private` read exclusion; content-addressed deduplication (same bytes → same key → one file, two independent DB rows); invalid mime type / empty body / oversized file rejection; the nonexistent-observation 404-before-any-disk-write guarantee; both atomicity directions described above; 405 on unsupported methods; and a source-scan confirming `storage.js` never imports a database driver, network library, or cloud SDK.
- **`tests/ida-2a/2c/2d`** — re-run fresh, unaffected: **44/44**, **24/24**, **38/38**.

### Validation

- `node -c` syntax check: all four touched/new JS files clean.
- All four test suites passed, run fresh in this session as `deploy`; the new IDA-2F suite specifically re-run 3 times consecutively to confirm idempotency after the fix.
- Post-test process check: no lingering `node` listening process.
- Post-mutation VPS safety: 25 containers unchanged, `idauto-postgres` unchanged (`RestartCount=0`, same memory cap), **Jellyfin untouched**, all protected domains 200, RAM `3.2Gi available`, swap materially unchanged, disk `31G available` (`/home/deploy/deployments/idauto-media/` uses 112K of synthetic test data — negligible), zero new OOM events.
- `git diff --check`: clean.
- Secret scan of the diff: clean.
- Scope confirmed: no UI, rate-limiting, or real-auth code anywhere in this diff; the `mythos_private` read restriction confirmed unchanged by test.

### Result: PASS

### Exact next stage

`IDA-2G`/`IDA-2H` (admin manual-entry UI, review-queue UI — could run in parallel per the original slice plan, since both now have everything they'd call: read, write, and media endpoints) and `IDA-2I` (rate limiting) remain the real not-yet-authorized Phase B candidates. Full `IDA-2E` (real Mythos OS auth service integration) stays blocked, unchanged from the prior entry.

---

## IMPLEMENTATION — IDA-2E-PRE: Minimal Mythos Identity Stub (2026-08-11)

**Type:** Production implementation (application code, live database — synthetic/pilot data only). Resolves the `IDA-2E` blocker below by scoping and implementing a much smaller, honestly-labeled stage instead. No production infrastructure mutation. No UI, object storage, or rate limiting.

**No subagents used.** `sudo -n` only for read-only VPS safety checks. `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `6a8125fbe6aedf17403710140c0e80157e49c912` (the IDA-2D commit) before this stage began. No commit landed between the blocker finding and this implementation — the blocker and its resolution are one continuous session.

### What this is not

This is **not** the `mythos_auth` integration contract in `docs/IDAUTO_ARCHITECTURE.md` §4.1 (JWT/opaque-ref tokens issued by a real Mythos OS auth service). That service does not exist anywhere in this codebase — confirmed by direct research (see the `IDA-2E` blocker entry immediately below) before any code was written for this stage. Full `IDA-2E` remains blocked. What follows is a deliberately minimal, clearly-labeled stopgap, scoped by explicit user choice after the blocker was reported (of three options offered, the user chose: *"Scope a minimal Mythos identity stub as its own stage first... just enough to give audit records a real identity"*).

### What was built

- **`projects/idauto/reference/identity.js`** — new. Parses `IDAUTO_ADMIN_IDENTITIES` (a JSON object, `{ "<bearer token>": "<stable identity string>", ... }`) once per process. `resolveIdentity(token)` returns the mapped identity string or `null`. No login flow, no session, no JWT, no user table — tokens remain static, operator-provisioned secrets, not user-chosen credentials. The module's own header comment states plainly what it is and is not, so a future session doesn't mistake this for the real integration.
- **`api.js`'s `requireAuth()`** — rewritten to resolve a real identity per request (`req.mythosIdentity = identity.resolveIdentity(token)`) instead of a boolean comparison against one shared `IDAUTO_ADMIN_PLACEHOLDER_TOKEN`. Every route (read and write) is still gated exactly as before — only the mechanism changed, not the enforcement point.
- **`writes.js`'s `withAudit()`** — now takes `identity` as a parameter (threaded through from `api.js`'s route handlers, which pass `req.mythosIdentity`) and writes it as `actor_ref`, replacing the old hardcoded `PLACEHOLDER_ACTOR_REF` constant (removed). **Fails closed**: if `identity` is falsy, `withAudit()` throws (`httpStatus: 401`) *before* calling `db.getClientForTransaction()` at all — there is no code path that opens a transaction, let alone writes data, without an attributable audit actor. (In the live HTTP path this is unreachable, since `requireAuth()` already blocks any request without a resolved identity — verified directly against the exported `writes.createVehicle()` function, bypassing the HTTP layer, to prove the guarantee holds at the module level too, not only via the route gate.)
- **`.env.example`** updated: `IDAUTO_ADMIN_PLACEHOLDER_TOKEN` replaced with `IDAUTO_ADMIN_IDENTITIES`, documented as explicitly not the real auth contract.
- **Read/write behavior and atomic audit guarantees preserved unchanged**, per explicit instruction: no route was added, removed, or had its data/response shape changed. `mythos_private` reads remain restricted (IDA-2C's `GET .../facts` filter is untouched) — this stage did not attempt to satisfy the "full authorization + audit-on-read" bar the task set for relaxing that restriction, so it correctly stays as-is.

### Tests

- **`tests/ida-2d-write-api-and-audit-test.js`** — extended from 30 to **38 passing**. Two new sections prove the actual point of this stage: (1) two distinct admin tokens produce two distinct `actor_ref` values in the audit log — proving this is a real per-token map, not a relabeled single shared secret; (2) calling `writes.createVehicle()` directly with no identity throws `401` before any transaction opens, and neither an audit row nor the underlying data row exists afterward. The existing 30 assertions were updated only to source the test token from a self-generated `IDAUTO_ADMIN_IDENTITIES` map (previously a raw env var) and to check `actor_ref` against the real test identity string instead of the removed `PLACEHOLDER_ACTOR_REF` constant — no assertion's *meaning* changed.
- **`tests/ida-2c-readonly-api-test.js`** — **24/24 still passing**, updated the same mechanical way (self-generated identity map instead of a raw placeholder token env var).
- **`tests/ida-2a-schema-and-plate-validation-test.js`** — **44/44**, unaffected (offline, no code touched).
- Both live suites re-run twice in succession to confirm idempotency against the persistent database (a discipline adopted after IDA-2D's own self-caught hardcoded-plate-number bug) — clean both times.

### Validation

- `node -c` syntax check: all four touched/new JS files clean.
- All three test suites passed, run fresh in this session, live suites run twice each.
- Post-test process check: no lingering `node` listening process.
- Post-mutation VPS safety: 25 containers unchanged, `idauto-postgres` unchanged (`RestartCount=0`, same memory cap), **Jellyfin untouched**, all protected domains 200, RAM `3.1Gi available`, swap materially unchanged, zero new OOM events.
- `git diff --check`: clean.
- Secret scan of the diff: clean.
- Scope confirmed: no UI, object-storage, or rate-limiting code anywhere in this diff; `mythos_private` read restriction confirmed unchanged by test (§9 in the IDA-2D suite).

### Result: PASS (for IDA-2E-PRE — full IDA-2E remains BLOCKED, see below)

### Exact next stage

Unchanged in substance from before: `IDA-2F` (object storage), `IDA-2G`/`IDA-2H` (UIs), `IDA-2I` (rate limiting) remain the real not-yet-authorized Phase B candidates. Full `IDA-2E` (real Mythos OS auth service integration) stays blocked until such a service exists anywhere in this ecosystem — building one is its own, much larger, separately-scoped undertaking, not an ID Auto slice.

---

## BLOCKER — IDA-2E: No Real Mythos OS Auth Service Exists (2026-08-11)

**Type:** Read-only research. No code written, no file touched, nothing committed for this entry on its own (the finding and its resolution — `IDA-2E-PRE` above — landed in the same session, one commit).

**Task as given:** *"Replace the placeholder ID Auto admin gate with real Mythos OS auth/identity integration... Audit records must use the authenticated Mythos identity, never the raw token."*

**What was researched before writing any code:**
- `js/auth.js` (429 lines) — the main "Uthina Chess" app's only authentication mechanism: a single shared password, SHA-256-hashed and hardcoded in client-side JS (`AUTH.HASH`), compared entirely in the browser against `localStorage`. No server-side validation found anywhere. No user table. No per-user identity of any kind — every person who knows the one password is the same undifferentiated actor.
- `google_auth.php` / `google_callback.php` — a one-off Google OAuth flow scoped to `contacts.readonly` only, used to import Google Contacts into the app. Not a login/identity system; no session or identity is ever derived from or tied to it.
- `api.php` and every other `.php` file in the repository — `grep`'d for `session_start`, `$_SESSION`, `JWT`: zero matches anywhere.
- `docs/IDAUTO_ARCHITECTURE.md` §4.1 (the actual `mythos_auth` integration contract): `Protocol: Token-based (JWT or opaque ref); protocol defined in IDA-1 spec, implemented IDA-2` — but IDA-1's own deliverables (`docs/IDAUTO_PRODUCT_SPEC.md`, `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md`) never actually defined a concrete protocol; this is a forward reference to something that was never specified.
- `MYTHOS_SUPER_ADMIN` — referenced as a required role across `IDAUTO_ARCHITECTURE.md`, `AUTOMOTIVE_ARCHITECTURE.md`, `AUTOVALEUR_ARCHITECTURE.md`, `idauto.example.json`, `autovaleur.example.json` — has no concrete definition or implementation anywhere in the repository.

**Conclusion:** there is no real Mythos OS auth **service** anywhere in this codebase to integrate with. The task's two requirements — real identity integration, and audit records carrying a real authenticated identity rather than a raw token — both depend on a per-user identity existing somewhere, and none does. Building an actual multi-user Mythos OS identity/auth service would be a new platform-wide capability, materially larger than everything else in Phase B combined, and explicitly outside this slice's stated bounds (*"No UI, object storage, or rate limiting"* signals a narrow integration slice, not a ground-up build).

**No code was written, no file was touched, nothing was committed for full `IDA-2E`.** Reported to the user as a real blocker per this project's standing "stop at the first real blocker" discipline, with the exact evidence above rather than a vague "auth isn't ready" claim.

**User's decision** (offered three options: keep the placeholder and document the gap; scope a minimal identity stub as its own stage first; or clarify a narrower interpretation): **scope a minimal Mythos identity stub as its own stage first** — implemented immediately after as `IDA-2E-PRE`, see the entry above.

**Full `IDA-2E` (real Mythos OS auth service integration) remains BLOCKED.** Unblocking it requires a real Mythos OS identity service to exist somewhere in this ecosystem first — that is its own, separately-scoped, much larger undertaking, not a next step ID Auto itself can take.

---

## IMPLEMENTATION — IDA-2D: Write API + Atomic Audit Logging (2026-08-11)

**Type:** Production implementation (application code + live database writes — synthetic/pilot data only, no production infrastructure mutation). Third slice of IDA-2 Phase B. Scoped exactly to IDA-2D: write endpoints + audit logging together, placeholder gate preserved, no real Mythos auth, no UI/object storage/rate limiting.

**No subagents used.** `sudo -n` only for read-only VPS safety checks. `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `211b569bb097ef19afe810128f343d6dc9b21e52` (the IDA-2C commit) before this stage began.

### Pre-mutation safety check

`free -h`: `3.2Gi available`; `Swap: 1.9Gi used / 76Mi free`, not thrashing. 25 containers present, all healthy, matching IDA-2C's known-good baseline exactly. `idauto-postgres` healthy. Zero kernel OOM matches in the last 6 hours. Cleared to proceed.

### Design decision: `api-read.js` → `api.js`

IDA-2C's file was named, documented, and tested around being read-only. Adding write routes into it would make its own name and header comment false. Rather than run two separate HTTP servers (operationally awkward, splits the one placeholder auth gate across two processes) or silently let the filename lie, renamed it via `git mv` (history preserved) to `api.js`, with an updated header explaining both what IDA-2C established and what IDA-2D added. All of IDA-2C's read routes and behavior are unchanged.

### What was built

- **`projects/idauto/reference/writes.js`** — new. The single shared `withAudit(auditMeta, work)` transaction helper every write endpoint uses: acquire a dedicated client (`db.getClientForTransaction()`), `BEGIN`, run `work(client)` (the caller's own data insert(s), e.g. a fact + its evidence row together), `INSERT INTO idauto_audit_log` on the **same client**, `COMMIT` — or `ROLLBACK` and re-throw on any failure at any step. This is the only place transaction atomicity is implemented in this module; no endpoint handler opens its own `BEGIN`.
- **`projects/idauto/reference/db.js`** — added `getClientForTransaction()` (a dedicated pooled connection for multi-statement transactions), additive to the existing pool-level `query()` from IDA-2C.
- **New routes in `api.js`**: `POST /api/vehicles`, `POST /api/plates`, `POST /api/observations`, `POST /api/vehicles/:internal_ref/facts`. A 64KB JSON body-size cap, basic required-field validation before any DB call, and safe Postgres-error-code mapping (`23505`→409 conflict, `23503`/`23514`/`22P02`→400, everything else→generic 500 — the raw driver message is never echoed to a caller).
- **`capture_method` hardcoded to `'manual_admin'`** on `POST /api/observations` — not accepted from the request body at all. This endpoint *is* the "Admin manual entry" deliverable specifically; it must not become a general ingestion path for `smart_gate`/`public_upload`/other capture types that carry different trust/legal-basis requirements per the schema's own comments.
- **Actor identity**: `IDA-2E` (real Mythos OS auth) doesn't exist yet, so there's no real user identity to attach to an audit record. Every audit row from this stage uses a fixed, non-secret placeholder (`actor_ref = writes.PLACEHOLDER_ACTOR_REF = 'ida-2d-placeholder-admin-gate'`) — never the bearer token itself, which must never appear in a database row.
- **`mythos_private` policy resolved for writes, deliberately left alone for reads**: IDA-2C excluded all `mythos_private`-scope data from GET responses specifically because no audit-writing path existed yet, and AD-9 requires that scope to be audit-logged on every access. IDA-2D provides exactly that for writes — so `POST .../facts` now accepts `access_scope: 'mythos_private'` and audits it. **Reads are intentionally unchanged**: `GET .../facts` still filters it out, because audit-on-*read* is a different, unbuilt mechanism — writing a private fact is now safe/audited; *reading* one still isn't. Verified by test (§9 below): a mythos_private fact created in this stage is confirmed written and audited, then confirmed still invisible via the unchanged GET endpoint.
- **Placeholder admin gate preserved unchanged** — `requireAuth()` in `api.js` was not touched; it still guards every route (read and write) exactly as IDA-2C left it.

### Atomicity — proven, not just implemented

Two independent test angles, both live against `idauto-postgres`:
1. **Data-fails direction** (naturally reachable via API input): a duplicate plate number (`23505`) and a nonexistent vehicle foreign key (`23503`) each correctly return an error status, and in both cases `idauto_audit_log`'s row count is confirmed unchanged before/after — no phantom audit record for a failed attempt.
2. **Audit-fails direction** (not reachable via any HTTP input, since `actor_type` is always `'admin'`, never caller-controlled): a direct unit-level test opens a real transaction on `db.getClientForTransaction()`, inserts a probe vehicle, then deliberately inserts an audit row with an invalid `actor_type` (violating `idauto_audit_log`'s own `chk_audit_actor` CHECK constraint), confirms the insert throws, `ROLLBACK`s, and then queries `idauto_vehicles` directly to confirm the probe vehicle **does not exist** — proving the whole transaction rolled back together, not just the audit step failing silently after the data half had already committed.

### Synthetic/pilot data created (all intentional, per this stage's scope)

Via each live test run (the suite ran multiple times this session — once during development, once after the plate-uniqueness fix below, twice more to confirm re-run safety): one vehicle per run (`IDA2D-...` generated internal_ref, make `IDA2D-Test-Make`), one plate per run (`TUN_STD`-pattern, freshly generated per run — see the self-caught bug below), one observation (`manual_admin`, linked to both), two facts (`colour`=`blue`, `access_scope=public`; `vin`=`IDA2DTESTVIN0001`, `access_scope=mythos_private`) with one evidence row, plus corresponding `idauto_audit_log` rows for each successful write. Each run's atomicity-probe vehicle insert (`IDA2D-ATOMICITY-PROBE-...`) was attempted and correctly rolled back — none exist in the database. All of this is exactly the kind of synthetic/pilot data this stage's scope permits; none of it was cleaned up afterward, since it's legitimate test fixture data for future slices to build on (matching how IDA-2C's own synthetic vehicle was left in place for this stage to use).

### Tests

- **`tests/ida-2d-write-api-and-audit-test.js`** — new, **30/30 passing**, live against `idauto-postgres` via a server on an ephemeral port (closed at the end of the run — no persistent listening process left on the VPS). Covers: placeholder gate preserved on write routes, every new endpoint's success path plus its audit row, the read-back-after-write regression, duplicate/foreign-key error mapping with the atomicity check, the `mythos_private` write-allowed-but-read-still-excluded distinction, input validation, the direct atomicity unit test, and a source-scan confirming `withAudit()`'s audit insert always appears before its `COMMIT` in source order.
  - **Self-caught bug, fixed before commit:** the first version hardcoded the test plate number (`'111 TUN 1111'`). It passed on first run, but a routine second run against the same persistent database (re-verifying before commit, not just trusting one green run) failed 2/30 — the plate collided with itself from the prior run, since `idauto_plates` correctly enforces one active plate number. Unlike the vehicle (which already used a timestamp-based unique `internal_ref` per run), the plate number wasn't unique per run. Fixed by generating a fresh, `TUN_STD`-pattern-valid plate number per run (`TEST_PLATE`, derived from `Date.now()`); confirmed by running the suite twice in succession afterward, both **30/30**.
- **`tests/ida-2c-readonly-api-test.js`** — re-run unchanged in substance: **24/24 still passing**. Updated only mechanically (require path following the rename) plus one assertion's wording, since it can no longer honestly claim "this API is read-only" — narrowed to the still-true claim that `api.js` itself contains no *inline* SQL write verb (all mutation SQL lives in `writes.js`).
- **`tests/ida-2a-schema-and-plate-validation-test.js`** — re-run as a broader regression check: **44/44 still passing**, unaffected.

### Validation

- `node -c` syntax check: all four touched/new JS files clean.
- All three test suites above passed, run fresh in this session.
- Post-test process check: no lingering `node` listening process.
- Post-mutation VPS safety: 25 containers unchanged, `idauto-postgres` unchanged (`RestartCount=0`, same memory cap), **Jellyfin untouched**, all protected domains 200, RAM `3.1Gi available`, swap materially unchanged, zero new OOM events.
- `git diff --check`: clean.
- Secret scan of the diff: clean — no database password, no admin token (real or test), anywhere in any committed file.
- Scope confirmed: `git status` shows exactly the rename plus `db.js`/`writes.js`/both test files — no UI, object-storage, rate-limiting, or real-auth code anywhere in this diff.

### Result: PASS

### Exact next stage

`IDA-2E` — Mythos OS auth integration, replacing the placeholder gate with real identity (which would also let a future slice reconsider the `mythos_private` read restriction, since real auth is a prerequisite for deciding who's allowed to see it). Not started, not implied by this entry, requires its own explicit authorization.

---

## IMPLEMENTATION — IDA-2C: Read-Only ID Auto API (2026-08-11)

**Type:** Production implementation (application code, live database reads only — no production infrastructure mutation, no write path). Second slice of IDA-2 Phase B. Scoped exactly to IDA-2C: no write endpoints, no audit-writing path, no real Mythos auth, no UI, object storage, or rate limiting.

**No subagents used.** `sudo -n` for read-only VPS checks and applying the synthetic seed to the live database. `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `ffc0759e767f35e171ac6b29bf83b1f10db1355d` (the IDA-2B commit) before this stage began.

### A genuine architectural first, resolved by asking rather than guessing

Every existing "reference implementation" in this repo (`projects/automation/`, `projects/personal-intelligence/`) is deliberately mocked and dependency-free — none of them ever makes a live connection to anything. IDA-2C is the first code in this repository meant to actually query a live service. There was no precedent to follow for how to connect to it (Node has no dependency-management setup anywhere in this repo; PHP lacks the `pgsql` extension). Rather than guess at a decision with real long-term consequences, this was put to the user directly: **Node.js + the `pg` npm package**, the recommended option, was chosen. This is now the repository's first real runtime dependency.

### What was built

- **`projects/idauto/package.json`** — `pg ^8.13.1`. `npm install` run inside `projects/idauto/`; `.gitignore` updated with `node_modules/` and `.env` (with `!.env.example` to still allow the template) — this repo had no such entries before, since no real dependency had ever existed to ignore.
- **`projects/idauto/reference/db.js`** — thin `pg.Pool` wrapper. All 5 connection parameters (`IDAUTO_DB_HOST/PORT/USER/PASSWORD/NAME`) come from environment variables, checked and thrown on if any is missing; no credential value is ever logged or included in an error message. `query(text, params)` is the only path in the module — every call site in `api-read.js` uses parameter placeholders (`$1`, `$2`, ...), never string concatenation.
- **`projects/idauto/reference/api-read.js`** — GET-only HTTP server, Node's built-in `http` (no Express — avoids a second new dependency for a 6-route API). Routes: `/health`, `/api/vehicles/:internal_ref`, `/api/vehicles/:internal_ref/facts`, `/api/plates/:plate_number`, `/api/observations/:id`, `/api/facts/:fact_id/evidence`. Any other HTTP method on a matched route path returns `405`; any unmatched path returns `404`.
- **Placeholder admin gate**: a static `Authorization: Bearer <IDAUTO_ADMIN_PLACEHOLDER_TOKEN>` check runs before every route, including `/health` — nothing is reachable unauthenticated. Explicitly documented in-code and here as **not** real auth; `IDA-2E` replaces it.
- **`mythos_private` enforcement, not just documentation**: the schema's own AD-9 rule requires `mythos_private`-scope access to be audit-logged on every access. `IDA-2D` (audit logging) hasn't happened yet, so this API cannot legally expose that scope without violating the policy this codebase already committed to. Enforced two ways: `idauto_vehicle_facts` queries filter `access_scope != 'mythos_private'` in SQL (not just in application code after the fact), and `idauto_observations` responses only ever select `id, vehicle_id, plate_id, capture_method, status` — omitting every field `schema.sql`'s own comments mark as always-`MYTHOS_PRIVATE` (`capture_time`, `plate_candidate`, `ocr_confidence`, `ip_hash`) or as contributor/session identity (`camera_source_id`, `contributor_id`, `capture_session_id`).
- **`projects/idauto/.env.example`** — safe-to-commit template (`IDAUTO_DB_*`, `IDAUTO_API_PORT`, `IDAUTO_ADMIN_PLACEHOLDER_TOKEN`, all blank/placeholder values). The real `.env` is not committed and does not exist in this repository — the actual database credential lives only in `/home/deploy/deployments/idauto-postgres/.env` (IDA-2B), and the placeholder admin token is operator-supplied whenever the API is actually run.
- **`projects/idauto/database/seed-synthetic-test-data.sql`** — new. IDA-2B's own record explicitly noted no vehicle/plate/observation test data existed yet and deferred it to "whichever slice first needs it" — this is that slice. One vehicle, one plate, one observation, **two** facts (one `public`, one deliberately `mythos_private` — to prove the filter actually excludes something, not just that nothing existed to exclude), one evidence row. Every value is explicitly TEST/SYNTHETIC-labeled. Applied to the live `idauto-postgres` database (0 errors, 6 inserts).
- **`tests/ida-2c-readonly-api-test.js`** — new, **24/24 passing**. Unlike the Phase A suite, this one is deliberately *not* offline — it starts the real server (ephemeral port, closed at the end of the run) and makes real HTTP requests against the real live database. Covers: auth gate (missing/wrong/correct token), every endpoint against the synthetic fixture data, the private-VIN-never-appears-in-raw-response check, 405 on every write verb (POST/PUT/DELETE) against a real route, 404 on unknown routes and malformed IDs, and a static source-scan confirming no SQL write verb (`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`TRUNCATE`) appears anywhere in `api-read.js`.

### Credential handling

The live database password (from IDA-2B's `.env`) was read once via `sudo -n grep ... | cut -d= -f2- > /tmp/.pgpass_extract` (a `600`-permission temp file, never `cat`'d or otherwise printed to any command output), exported into the test run's environment, and the temp file deleted immediately after the test run. The placeholder admin token used during testing was freshly generated per run (`openssl rand -hex 8`), never reused, never committed. Neither value appears anywhere in this repository, any log, or this document.

### Validation

- `node -c` syntax check: all three new JS files (`db.js`, `api-read.js`, the test file) clean.
- `node tests/ida-2c-readonly-api-test.js` (live, against `idauto-postgres`): **24/24 passed**.
- Regression check: `node tests/ida-2a-schema-and-plate-validation-test.js`: still **44/44 passed**, unaffected.
- Post-test process check: `ss -tlnp | grep node` — no lingering listening process; the test's server was closed and the DB pool ended before the test process exited.
- Post-mutation VPS safety: 25 containers unchanged, `idauto-postgres` unchanged (`RestartCount=0`, same memory cap), **Jellyfin untouched** (same container ID, `RestartCount=0`), all protected domains 200, RAM `3.1Gi available`, swap materially unchanged, zero new OOM events.
- `git diff --check`: clean.
- Secret scan of the diff: clean — no database password, no admin token (real or test), no connection string with embedded credentials, anywhere in any committed file.
- Scope confirmed: `git status` shows only the files listed above plus `.gitignore`; no write endpoint, audit-logging code, auth-integration code, UI code, object-storage code, or rate-limiting code exists anywhere in this diff.

### Result: PASS

### Exact next stage

`IDA-2D` — Core API write endpoints (manual-entry backend) **plus audit logging landing in the same slice** (per the Phase B slice plan: a live mutation path must never exist without its audit trail) — per the slice plan's suggested authorization order. Not started, not implied by this entry, requires its own explicit authorization. `IDA-2D` will also need to decide whether/how to relax the `mythos_private` exclusion this slice introduced, once audit logging exists to make that safe.

---

## IMPLEMENTATION — IDA-2B: PostgreSQL Provisioning (2026-08-11)

**Type:** Production implementation (infrastructure mutation — explicitly authorized by the user: "You are explicitly authorized to provision the PostgreSQL instance on the VPS"). First slice of IDA-2 Phase B. Scoped exactly to the IDA-2B slice from the prior plan entry — no API, UI, auth, object storage, or rate-limiting work; Jellyfin and all unrelated services untouched.

**No subagents used.** `sudo -n` for all system/Docker provisioning and inspection. `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `7caf7a6b54b01a3201bd00fe615e5b296e26fa45` (the Phase B slice plan commit) before this stage began.

### Pre-mutation safety check (per explicit instruction, before touching anything)

`free -h`: `7.6Gi total / 4.6Gi used / 445Mi free / 2.9Gi available`; `Swap: 2.0Gi total / 1.9Gi used / 74Mi free`. `vmstat 1 5`: si/so low and non-sustained (mostly 0 across samples) — not thrashing. Disk: `28G available / 72G total (62% used)`. 24 containers present, all healthy, matching the prior session's known-good baseline exactly. Zero kernel OOM matches in the last 6 hours. Available RAM (2.9Gi) was above this project's established 1.5GiB stop threshold — cleared to proceed.

### What was built

- **`/home/deploy/deployments/idauto-postgres/`** — new deployment directory (`750 deploy:deploy`), containing `docker-compose.yml` and a `600`-permission `.env` (generated via `openssl rand`, 32-char password, never printed to any output, log, or doc).
- **Container `idauto-postgres`** (`postgres:15-alpine` — matching `coolify-db`'s existing version on this VPS, no new Postgres major version introduced): `mem_limit=384m`, `mem_reservation=96m` **set in the compose file before the first `docker compose up`** — the container was never uncapped, even momentarily, unlike every other service capped earlier this session (which were all retrofitted after the fact). Confirmed live via `docker inspect`: `Memory=402653184` (384MB exactly), `MemoryReservation=100663296` (96MB exactly).
- **Network:** dedicated `idauto` bridge network (for future slices' containers to join) plus `127.0.0.1:5432:5432` port publish — confirmed via `docker port`, no `0.0.0.0` exposure anywhere.
- **Data volume:** named Docker volume `idauto-postgres-data` (not a bind-mount) — standard, matches `coolify-db`'s own volume pattern.
- **Schema applied:** `projects/idauto/database/schema.sql` piped into `psql` inside the container — **0 errors**, full apply log checked for the string "error" (case-insensitive), none found. Verified live via `information_schema.tables`: exactly 22 tables, all `idauto_`-prefixed. Verified `access_scope` (not `visibility_scope`) present on both `idauto_observation_media` and `idauto_vehicle_facts` — the IDA-2A-CORRECTION-0 fix confirmed to have carried through into the actual live database, not just the source file. Verified zero owner-PII columns (`owner_name`, `owner_address`, `owner_cin`, `owner_passport`, `owner_phone`, `insurance_policy_number`, `insurance_company`) exist anywhere in the live schema.
- **Seed data:** exactly what `schema.sql`'s own `INSERT` statements define — 7 plate formats, 24 governorates, 7 capture sources, 1 organization (the Fixpert pilot placeholder, `is_fixpert_pilot=TRUE`, no real data). No additional synthetic test data (vehicles/plates/observations) was loaded — none was required for this slice, and none exists in `schema.sql` beyond the reference-table seeds; a future slice that needs synthetic vehicle/observation rows for testing should add its own.

### Backup + restore (tested before declaring PASS, per `AGENTS.md` §16)

- **Backup:** `pg_dump -U idauto -d idauto --format=custom` inside the container, copied out via `docker cp`, stored at `/home/deploy/backups/idauto-postgres-20260810/idauto-backup.dump` — **outside the container**, directory `700 root:root`, file `600 deploy:deploy`. 110,930 bytes.
- **Restore test:** a throwaway, isolated `postgres:15-alpine` container (`idauto-postgres-restore-test`, own bridge network, 256MB memory cap, disposable credentials never reused) — never connected to the production `idauto-postgres` container or its network. Backup file copied in, `pg_restore --no-owner` run, exit code 0. **Verified identical to source:** 22 tables, seed row counts (7/24/7/1) exact match, `access_scope` column present on both expected tables. Temp container and its data destroyed immediately after (`docker rm -f`) — the restore test never touched or was reachable from the live instance.

### Post-mutation safety re-verification

- Container count: 25 (24 prior + `idauto-postgres`) — confirmed exactly, no other container added or removed.
- **Jellyfin: untouched** — same container ID (`04ef7f2cb78f...`), `RestartCount=0`, still `running`. Not modified, restarted, or reconfigured, per explicit instruction.
- Stack A Redis ×3 (`64MB`/`16MB`) and `coolify-redis` (`96MB`/`24MB`): unchanged, confirmed via `docker inspect`.
- Protected domains: `darhijama.tn` 200, `uthinachess.tn` 200, `notrejour.tn` 200, `n8n.ssangyong.autos` 200, Coolify panel 302 — all unchanged.
- `free -h` after: `2.9Gi available`, `Swap: 1.9Gi used / 72Mi free` — materially unchanged from the pre-mutation baseline (idauto-postgres itself is using only a small fraction of its 384MB cap at this point — seed data only, no live traffic).
- Zero new kernel OOM events.

### Rollback procedure (not executed — not needed, full PASS)

```bash
cd /home/deploy/deployments/idauto-postgres
sudo docker compose down          # stops and removes the container; the named volume idauto-postgres-data persists unless -v is also passed
# to fully remove including data:
sudo docker compose down -v
sudo docker network rm idauto     # only if no other slice has joined it yet
```
Redeploy procedure (if ever needed): `cd /home/deploy/deployments/idauto-postgres && sudo docker compose up -d`, then re-apply `schema.sql` if the volume was removed, or restore from `/home/deploy/backups/idauto-postgres-20260810/idauto-backup.dump` via `pg_restore` if recovering from data loss.

### Validation

- `git diff --check`: clean.
- Secret scan of the diff: clean — the generated Postgres password was never printed to any command output, log file, or document; the `.env` file itself is untracked by Git (not committed) and `600`-permission.
- Files changed in this repository: `docs/IDAUTO_ROADMAP.md`, `docs/AI_HANDOVER.md` only — no application/schema file changed (the schema was applied as-is from the already-committed `projects/idauto/database/schema.sql`).
- No unrelated service touched — confirmed by the container-count and Jellyfin/Stack-A/coolify-redis checks above.

### Result: PASS

### Exact next stage

`IDA-2C` — Core API, read-only endpoints only, with a minimal placeholder access gate — per the slice plan's suggested authorization order. Not started, not implied by this entry, requires its own explicit authorization.

---

## PLAN — IDA-2 Phase B Slice Plan (2026-08-10)

**Type:** Read-only planning. No implementation, no production mutation, no PostgreSQL provisioned, no code written. This entry is the deliverable — a slice plan ready for owner review and per-slice authorization, not an authorization itself.

**No subagents used.** `sudo -n` for read-only VPS memory/disk inspection only. `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `5850f6b2569f122d19e74056e8db02e5556d09f6` (the MPI-0 staleness sweep commit) before this plan began.

### Why Phase B needs slicing

`docs/IDAUTO_ROADMAP.md`'s IDA-2 Phase B scope is one paragraph covering 9 distinct deliverables (PostgreSQL cluster, core API, admin manual entry, review queue UI, audit logging, object storage wiring, Mythos OS auth integration, Mythos OS audit integration, rate limiting) plus remaining tests toward 50+. Per `AGENTS.md` §7 ("smallest coherent change") and this project's own precedent (Stage 4's 33 sub-stages, IDA-2 Phase A's own decision to defer Phase B rather than do it all at once), this cannot be one implementation stage.

### Grounding: current VPS state (read-only, checked this session)

- `free -h`: `7.6Gi total / 4.6Gi used / 529Mi free / 3.0Gi available`; **`Swap: 2.0Gi total / 2.0Gi used / 6.5Mi free`** — swap is essentially full right now, consistent with every check earlier this session. Not actively thrashing, but zero headroom left in swap.
- Disk: `72G total / 44G used / 28G available (62%)` — adequate for a new Postgres data directory plus backups, not a blocker, but backup retention should be sized against this.
- `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`'s authoritative sizing model: preferred aggregate memory ceiling ≈**5.65GB** (no swap reliance), hard danger threshold ≈**7.65GB** (swap-backed). The comparable existing relational database (Dar Hijama's MySQL, live production) is capped at **768MB** (~1.7× its ~454MB real usage). A new PostgreSQL instance holding only synthetic/pilot data (no live production traffic, per Phase B's own exclusions) should be sized well below that — a conservative **256–384MB** starting cap is proportionate, with headroom to revise once real IDA-2 usage is observed, matching the same "start conservative, monitor, revise" discipline already applied to every other capped service this session.
- **Lesson carried forward from this session's Redis/coolify-redis work:** every other capped service on this VPS had its memory cap retrofitted after the fact. IDA-2B should not repeat that — the PostgreSQL container must be created **with** its memory cap from the first `docker run`/compose `up`, never uncapped even temporarily.

### One-major-stage rule application

Only one of the slices below may be the active major implementation stage at a time, per `docs/ROADMAP.md`'s standing rule. None is authorized by this plan. `IDA-2B` (PostgreSQL provisioning) in particular should get its **own explicit deployment window**, separate from every other slice — same treatment this project already gives Stage 3G-class HIGH-risk stages — because it is the only slice in this set that is genuinely hard to reverse (a new persistent production service, not just application code).

### The slices

| Slice | Deliverable | Depends on | Risk | Reversibility |
|---|---|---|---|---|
| **IDA-2B** | PostgreSQL provisioning: install/deploy the target instance **with a memory cap from creation** (256–384MB starting point, re-verify live VPS headroom immediately before provisioning — the numbers above are this-session-current, not guaranteed current at execution time), apply `schema.sql` as the initial migration, load only the existing seed data (plate formats, governorates, capture sources, the Fixpert pilot org placeholder — all already in the schema file, no real data). Establish and **test** a backup/restore procedure before any further slice begins (per `AGENTS.md` §16 — "a backup is valid only after restoration is tested"). No API, no network exposure beyond `localhost`/internal Docker network. | IDA-2 Phase A (done) | **HIGH** — new persistent production infrastructure, the only slice here that isn't just application code | Hardest to reverse of any slice — deprovisioning a database after real data exists is a real operation, not a revert |
| **IDA-2C** | Core API, **read-only** endpoints only (vehicle/plate/observation/fact/evidence lookups against the seed data), with a minimal placeholder access gate (e.g. a static admin-only token check) — not yet the full Mythos OS auth integration, but never fully open. No mutation path exists yet. | IDA-2B | MEDIUM — first live code talking to the new database, but read-only | Straightforward — no data written, easy to redeploy/roll back |
| **IDA-2D** | Core API, **write** endpoints (manual-entry backend: create/update vehicle, plate, observation, fact, evidence records) **plus audit logging wired to `idauto_audit_log` in the same slice** — a live mutation path must never exist without its audit trail, even behind the placeholder gate from IDA-2C. | IDA-2C | HIGH — first slice that writes real (synthetic/pilot) data | Data written is synthetic/pilot only per Phase B's own exclusion; still requires care since `idauto_observations` rows are documented as immutable-after-creation by schema design |
| **IDA-2E** | Mythos OS auth integration — replaces IDA-2C's placeholder gate with the real Mythos OS auth check on every endpoint (read and write). | IDA-2D | MEDIUM — security-critical but well-scoped (swapping one gate for another, not new surface area) | Moderate — a regression here is a lockout/access-control bug, not data loss |
| **IDA-2F** | Object storage wiring — original image references (`idauto_observation_media.object_key`) for any media captured during manual entry. | IDA-2B (schema) + IDA-2D (write API) | LOW-MEDIUM — new external dependency (object storage), but no new database risk | Straightforward — object storage keys are just references; can be disabled without touching the DB |
| **IDA-2G** | Admin manual entry UI — the actual form/screen an admin uses to drive IDA-2D's write API. | IDA-2D, IDA-2E (should not ship a UI capable of writing data before real auth is in place) | LOW — UI work, no new backend risk if IDA-2D/E already validated | Easy — UI-only |
| **IDA-2H** | Review queue UI — admin screen for `idauto_review_queue` triage. | IDA-2D, IDA-2E | LOW — same class as IDA-2G, can genuinely run in parallel with it once both dependencies are met | Easy — UI-only |
| **IDA-2I** | Rate limiting backed by `idauto_verifications`. | IDA-2E | LOW — lowest urgency of all slices, since Phase B has no public-facing endpoint yet (`no public capture` is an explicit Phase B exclusion); the real forcing function for this is IDA-3's public surface, not Phase B itself. Could legitimately be deferred into IDA-3's own scoping rather than kept in Phase B, if the owner prefers a smaller Phase B. | Trivial |

**Remaining tests toward 50+ are not a separate slice.** Each slice above adds its own test file (following the `tests/ida-2a-schema-and-plate-validation-test.js` naming convention, e.g. `tests/ida-2b-...`), the same way every slice in the earlier Stage 4A–4AG sequence carried its own tests rather than deferring them to a final catch-up stage. 44 tests already exist from Phase A; the 50+ target is cumulative across IDA-2B onward.

### Suggested authorization order

`IDA-2B → IDA-2C → IDA-2D → IDA-2E → { IDA-2F, IDA-2G, IDA-2H in any order/parallel once their dependencies are met } → IDA-2I`. `IDA-2G`/`IDA-2H` (the two UIs) are the only pair that could reasonably run in parallel without violating the one-major-stage rule's intent, since they touch disjoint surface area once their shared dependency (`IDA-2E`) is done — but that itself would need explicit parallel authorization, not assumed.

### What this plan does not do

Does not authorize IDA-2B or any other slice. Does not provision PostgreSQL. Does not write API, UI, or auth code. Does not re-verify VPS memory headroom at execution time (the numbers above are this-session-current only — `IDA-2B` itself must re-check before provisioning). Does not decide whether `IDA-2I` stays in Phase B or moves to IDA-3 — flagged as an open question for the owner.

### Exact next stage

None authorized. If the owner wants to proceed, `IDA-2B` is the logical first candidate — but per the risk/reversibility table above, it's also the one slice in this plan that most warrants a deliberate, separate go/no-go decision rather than a default "next in sequence" approval.

---

## CORRECTION — IDA-2A-CORRECTION-0 (2026-08-10)

**Type:** Repository/documentation correction following a read-only audit of IDA-2 Phase A. No production/infrastructure mutation. No IDA-2 Phase B work. No Mythos implementation stage other than IDA-2 Phase A itself was advanced.

**No subagents used.** `sudo -u deploy -H bash -lc '...'` for all Git operations. No `sudo -n` system command was needed.

**Repository baseline verified:** `origin/main` HEAD confirmed as `92a8f77e8bcc72aa41c59e6eb1597ec59d7a459b` (the IDA-2 Phase A commit) before this stage began.

### Scope: exactly the 3 confirmed audit findings, nothing else

The prior read-only audit of IDA-2 Phase A reported 3 findings via structured review. This stage fixes exactly those 3 — no broader IDA-2A rework, no IDA-2 Phase B.

**1. R-T03 resolved (architecture, the most significant finding):** the schema had been marked "migration-ready" while still using `visibility_scope`, diverging from AutoValeur's canonical `access_scope` naming — a tracked, OPEN, severity-H/M risk explicitly scoped to "update ID Auto schema in IDA-2." Renamed `visibility_scope` → `access_scope` on both affected tables (`idauto_observation_media`, `idauto_vehicle_facts`) in `projects/idauto/database/schema.sql`, plus the two docs that documented the old name as current architecture (`docs/IDAUTO_ARCHITECTURE.md` AD-9, `docs/IDAUTO_PRODUCT_SPEC.md`'s fact-object field table). `docs/AUTOMOTIVE_RISK_REGISTER.md`'s R-T03 row updated from `OPEN` to `RESOLVED (IDA-2A-CORRECTION-0, 2026-08-10)`, with the caveat spelled out: resolved at the schema-source level, not yet applied to any live database (that verification remains Phase B). `docs/AUTOMOTIVE_ROADMAP.md`'s IDA-2 scope checklist item for this rename marked done with the same caveat.

**2. Stale IDA-2 status docs reconciled:** 5 files still said "IDA-2 is the next authorised implementation stage" / listed it as not-started, after Phase A had already shipped — the same class of staleness `MYTHOS-STAGE-RECONCILIATION-0` fixed for Stage 3E, reintroduced here in miniature. Corrected in `docs/AUTOMOTIVE_ROADMAP.md` (3 occurrences: the "Current state" summary, the stage table's `NEXT` cell, and the execution-order list), `docs/AUTOMOTIVE_OPERATING_MODEL.md`, `docs/AUTOMATION_GOVERNANCE.md`, `docs/AUTOMATION_ROADMAP.md`, and `docs/PROJECT_STATISTICS.md` (moved IDA-2 from the "Planned, not started" count into "In progress," 8→7 and 0→1 respectively). Deliberately **not** touched: adjacent "Stage 3E remains next" mentions sitting in the same bullet lists in `docs/AUTOMATION_GOVERNANCE.md`/`docs/AUTOMATION_ROADMAP.md` — also stale, but a pre-existing gap from `MYTHOS-STAGE-RECONCILIATION-0` that never propagated to these two files, and out of this stage's explicit scope (IDA-2 status only).

**3. Safe caching added:** `projects/idauto/reference/plate-validator.js`'s `loadFormats()` now caches the parsed-config + compiled-regex array per config path in a module-level cache, so the single-argument `matchPlateFormat(raw)`/`isValidPlate(raw)` forms (the ones a future Phase B API handler would naturally reach for) no longer re-read and re-parse the JSON config and recompile 7 regexes on every call. Added `clearFormatCache()` for tests and for the rare case the underlying config file changes during a long-running process. Cached `RegExp` objects carry no `g` flag, so they have no mutable `lastIndex` state and are safe to share across concurrent callers.

### Tests

`tests/ida-2a-schema-and-plate-validation-test.js` extended from 36 to 44 tests: 2 new R-T03 regression-lock-in assertions (§1) and 6 new caching-behavior assertions (§8, new section). **Self-caught issue during this stage:** the first version of the R-T03 lock-in test asserted the literal string `visibility_scope` never appears anywhere in `schema.sql` — but the corrected file's own header comment legitimately needs to *say* "renamed from visibility_scope" to explain the correction, so that naive assertion immediately self-failed (43/44) the moment the explanatory header was added. Caught immediately by re-running the suite before committing (not shipped broken); the test was corrected to check structural SQL usage only (column definitions, `CHECK` constraints, index targets) rather than blanket substring absence — the same pattern already used for the file's owner-PII column check. Final result: **44/44 passing**, independently re-run after every subsequent edit.

### Validation

- `node -c` syntax check: `plate-validator.js` and the test file both clean.
- `node tests/ida-2a-schema-and-plate-validation-test.js`: **44/44 passed** (re-run fresh immediately before commit).
- Repo-wide `grep` confirmed every remaining `visibility_scope` mention is explanatory prose about the historical rename (schema header, `IDAUTO_ARCHITECTURE.md`, `IDAUTO_PRODUCT_SPEC.md`, `AUTOMOTIVE_ROADMAP.md`, `AUTOMOTIVE_RISK_REGISTER.md`) — none is a live column/constraint/index reference.
- `git diff --check`: clean.
- Secret scan of the diff: clean.
- No production/infrastructure mutation of any kind — confirmed by scope (no `sudo -n` command was run, no database contacted).

### Exact next stage

Unchanged from the IDA-2 Phase A entry below: **IDA-2 Phase B** (PostgreSQL cluster provisioning, core API, admin UIs, Mythos OS auth/audit integration, rate limiting, remaining tests toward 50+) remains a separate, not-yet-authorized, production-infrastructure stage. Also newly visible from this correction, not yet actioned: the "Stage 3E remains next" staleness still present in `docs/AUTOMATION_GOVERNANCE.md`/`docs/AUTOMATION_ROADMAP.md` would need its own small follow-up reconciliation, out of scope here.

---

## IMPLEMENTATION — IDA-2 Phase A (2026-08-10)

**Type:** Production implementation (repository/code only — no production infrastructure mutation). First Mythos implementation stage advanced since MYTHOS-STAGE-RECONCILIATION-0 cleared IDA-2 as the next authorized Automotive stage.

**No subagents used.** `sudo -u deploy -H bash -lc '...'` for all Git operations. This stage touched no system/Docker/root state — no `sudo -n` system command was needed.

**Repository baseline verified:** `origin/main` HEAD confirmed as `5191476e259af7ae300b4edf4bbecf4df6f025bb` before this stage began.

### Scope decision

`docs/IDAUTO_ROADMAP.md`'s full IDA-2 scope ("PostgreSQL Core, API and Manual Capture MVP") is large: PostgreSQL cluster deployment + core API (5 endpoint groups) + 2 admin UIs + plate validation + audit logging + object storage wiring + Mythos OS auth/audit integration + rate limiting + 50+ tests. Per `AGENTS.md` §7 ("smallest coherent change") and this project's own precedent (Stage 4's 33 sub-stages rather than one commit), this was scoped down before implementation. The user confirmed the phasing explicitly: **schema + code first, no live PostgreSQL cluster provisioned in this pass** — deferring the production-infrastructure decision (a new persistent VPS service, with backup/memory-budget implications on a host already tight on RAM/swap per this session's earlier VPS work) to a separately-authorized IDA-2 Phase B.

### What was built (IDA-2 Phase A)

- **`projects/idauto/database/schema.sql`** — header/footer updated from "IDA-1 Draft Specification, not yet deployed" to "IDA-2 Phase A, migration-ready, not yet applied to any database." Content otherwise unchanged; re-verified structurally before the status change (22 `CREATE TABLE` statements, all `idauto_`-prefixed, 387 open = 387 close parentheses, no owner-PII field defined as an actual column on any table). **Still not applied to any database** — Phase B remains required to provision PostgreSQL and run this migration.
- **`projects/idauto/reference/plate-validator.js`** — new. Pure, offline module: `normalizePlate()`, `matchPlateFormat()`, `isValidPlate()`, `loadFormats()`. Loads the 7 draft plate-format patterns from `projects/idauto/config/idauto.example.json` at runtime rather than hardcoding them (per IDA-0's AD-3 architecture decision). No database driver, network call, or environment-variable read anywhere in the module (verified by the test suite itself, not just by inspection).
- **`tests/ida-2a-schema-and-plate-validation-test.js`** — new, 36/36 passing. Covers: schema structural integrity, config structural sanity, `normalizePlate()` edge cases (whitespace, case, non-string/null/undefined input), every active format's own documented example matching correctly, the one inactive format (`TUN_OLD`) never matching, malformed/garbage input rejection, and the module's offline/no-dependency property.
- **`docs/IDAUTO_ROADMAP.md`, `docs/ROADMAP.md`, `docs/PROJECT_STATUS.md`** — IDA-2's status corrected from "Planned"/"NEXT AUTHORISED IMPLEMENTATION STAGE" to "IN PROGRESS — Phase A complete, Phase B not started," with Phase A/B scope broken out explicitly. Dependency-chain statements elsewhere in `docs/ROADMAP.md` (e.g. "ATN-1 blocked... after IDA-2," "AVA-1 depends on IDA-2 providing the PostgreSQL cluster") were **not** changed — they remain accurate, since Phase B (the actual deployment those stages depend on) has not happened.

### Validation

- `node -c` syntax check: both new JS files clean.
- `node tests/ida-2a-schema-and-plate-validation-test.js`: **36/36 passed.**
- Regression check: `grep -rl "idauto" tests/` confirmed no other existing test file references `projects/idauto/` — this is a net-new, isolated addition with zero shared-code dependency, so no other suite was run (per `AGENTS.md` §8: full/adjacent suites only when shared core behavior changes).
- `git diff --check`: clean.
- Secret scan of the diff: clean — no credential/token/password values anywhere in the new code or doc changes.
- No production/infrastructure mutation of any kind in this stage — confirmed by scope (no `sudo -n` command was run).

### Exact next stage

**IDA-2 Phase B** (PostgreSQL cluster provisioning + core API + admin UIs + auth/audit integration + rate limiting + remaining tests toward 50+) — requires its own explicit, separately-scoped authorization given its production-infrastructure footprint (new persistent database service on a memory-constrained VPS) and its much larger blast radius than this Phase A. Not started, not implied by this entry.

---
