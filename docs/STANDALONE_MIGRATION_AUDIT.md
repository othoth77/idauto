# Standalone Migration Audit

**Audit date:** 2026-08-18 · **Revision 2** (completeness audit)
**Subject:** extraction of ID Auto from `othoth77/mythos-prod` (`projects/idauto/` and all
ID Auto-specific files outside it) into `othoth77/idauto`
**Origin baseline:** `5e2011b` on `main`
**Verdict:** the migrated tree is **complete and validated**. It is **not yet canonical** —
see §11.

Everything below was executed and observed in this working environment. Nothing is inferred.
Where revision 1 of this audit was wrong, §10 says so.

---

## 1. Test suites

All 13 suites run in the new repository layout against **PostgreSQL 16**, with
`database/schema.sql`, `database/migrations/ida-3a-ingestion-schema.sql` and
`database/seed-synthetic-test-data.sql` applied. The database-backed suites run **live**,
not mocked.

| Suite | Assertions | Failures | Dependencies exercised |
|---|---|---|---|
| `ida-2a-schema-and-plate-validation` | 44 | 0 | offline — schema text + config-driven validator |
| `ida-2c-readonly-api` | 26 | 0 | live DB, HTTP on an ephemeral port |
| `ida-2d-write-api-and-audit` | 39 | 0 | live DB, transactions |
| `ida-2f-object-storage` | 32 | 0 | live DB + real filesystem |
| `ida-2g-admin-manual-entry-ui` | 17 | 0 | live DB |
| `ida-2h-review-queue-ui` | 37 | 0 | live DB |
| `ida-3a-ingestion-schema` | 47 | 0 | offline |
| `ida-3b-ingestion-service` | 67 | 0 | live DB + filesystem |
| `ida-3c-rate-limit` | 63 | 0 | live DB |
| `ida-3d-private-ingest-route` | 73 | 0 | live DB + HTTP |
| `ida-3e-review-queue` | 48 | 0 | live DB + HTTP |
| `ida-3f-offhost-backup` | 35 | 0 | offline; includes AWS's published SigV4 vector |
| `idauto-storage-ops` | 73 | 0 | offline; CLI subprocess |

### Assertion count

**601 passed · 0 failed · 13 / 13 suites.**

### Comparison with the origin

Every suite matches its last recorded count in the origin repository, except
`idauto-storage-ops` (72 → 73): one assertion was replaced by a stronger pair when the
restore guard was generalised (§6).

### Static-only modes re-verified

The offline paths a sandboxed environment depends on still work and still fail loudly rather
than skipping silently: `IDA3B_STATIC_ONLY=1` 37/37 · `IDA3C_STATIC_ONLY=1` 37/37 ·
`IDA3D_STATIC_ONLY=1` 45/45 · `IDA3E_STATIC_ONLY=1` 30/30.

---

## 2. Completeness — byte-level comparison against the origin

Every migrated source file was compared with its origin counterpart.

| | |
|---|---|
| File pairs checked | **44** |
| **Missing** | **0** |
| Byte-identical | 10 |
| Differing | 34 — every difference accounted for below |

### Executable code

**`reference/` contains zero executable-code changes.** Every diff across `api.js`,
`db.js`, `identity.js`, `plate-validator.js`, `storage.js`, `writes.js`, `ingestion.js`,
`rate-limit.js`, `admin-ui.js`, `review-ui.js` and the HTML/CSS is a **comment**: a
`projects/idauto/…` path prefix or a `docs/IDAUTO_*.md` filename. Verified by reading the
full diff of each file, not by counting lines.

### Where code did change

| File | Change | Why |
|---|---|---|
| `ops/media-ops.js` | +7 lines | Backup destination from `--dest`/`IDAUTO_BACKUP_ROOT`; refusal list generalised; repository-root fix; manifest `project` field |
| `ops/offhost-backup.js` | +14 lines | Live media root from environment; refusal rule generalised; repository-root fix |
| `tests/idauto-storage-ops-test.js` | +6 lines | One assertion replaced by a stronger pair |
| `package.json` / `package-lock.json` | rewritten | Renamed, unscoped, licensed |
| `.env.example`, `database/*.sql`, 4 docs | comments / provenance line | Path and repository references |

### Content beyond `projects/idauto/`

Found by an exhaustive case-insensitive search for `idauto` / `id auto` across every tracked
file in the origin, not just the project directory.

| Origin | Result |
|---|---|
| `tests/ida-*.js`, `tests/idauto-storage-ops-test.js` (13) | Migrated |
| `docs/IDAUTO_*.md` (7), `docs/IDA3_INGESTION_ARCHITECTURE.md` | Migrated, renamed |
| `docs/AI_HANDOVER.md` — 30 ID Auto sections | Extracted **verbatim** |
| `docs/OFF_HOST_BACKUP_GATE.md` | Migrated (§10 — **missed in revision 1**) |
| `docs/AUTOMOTIVE_RISK_REGISTER.md` — 17 ID Auto rows | Extracted (§10 — **missed in revision 1**) |
| `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` — ID Auto decisions | Extracted (§10 — **missed in revision 1**) |
| 30 other files with ID Auto mentions | Portfolio, sibling-product or Mythos-infrastructure. Excluded with reasons in [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md) §5 |

### Required content present

| Required | Present |
|---|---|
| Implementation | `reference/` — 13 modules, API, writes, identity, storage, ingestion, rate limiting, plate validation, two UIs |
| Tests | `tests/` — 13 suites, 601 assertions |
| Schemas | `database/schema.sql` (24 tables), the IDA-3A migration, synthetic seed |
| Operational documentation | `ops/runbooks/` — storage, test, off-host backup gate; `ops/` tooling |
| Fixpert integration contracts | `docs/FIXPERT_INTEGRATION.md`, in full, plus the ownership boundary in `docs/ARCHITECTURE.md` |
| Identity work | `reference/identity.js`, `reference/IDENTITY_ADAPTER.md`, `docs/IDENTITY_ARCHITECTURE.md` |
| Ingestion / review logic | `reference/ingestion.js`, `rate-limit.js`, `review-ui.js`; `docs/INGESTION_ARCHITECTURE.md` |
| IDA-0 → IDA-3 historical records | `docs/AI_HANDOVER.md` (30 verbatim sections), `docs/ROADMAP.md`, `docs/RISK_REGISTER.md` |

---

## 3. Database validation

Applied to a clean PostgreSQL 16 database. No errors.

| Check | Result |
|---|---|
| Base tables created | **24** — matches the origin's live count |
| Tables outside the `idauto_` prefix | **0** |
| `access_scope` present on `idauto_observation_media`, `idauto_vehicle_facts` | Both confirmed — the IDA-2A-CORRECTION-0 rename is intact |
| IDA-3A migration re-applied over the schema | **Idempotent** — every object reported "already exists, skipping". The migration and the schema file agree |
| Synthetic seed applied | Clean |
| Audit rows after the suite run | 183, across 21 distinct `actor_ref` values |
| Audit rows with NULL `actor_ref` | 54 — **all** `actor_type = 'anonymous'`. No other actor type ever has a NULL reference, so an unattributed row is always a deliberate anonymous one, never a lost attribution |

---

## 4. API validation

Exercised through the live suites against a server bound to an ephemeral port; no persistent
listener was left running.

| Property | Evidence |
|---|---|
| Read routes correct; non-GET on a matched route → 405; unmatched → 404 | `ida-2c` 26/26 |
| Every mutation writes an audit row **in the same transaction** | `ida-2d` 39/39 — proven **both ways**: a failed data insert leaves the audit count unchanged, and a deliberately failed *audit* insert rolls the data insert back |
| No inline write SQL in `api.js`; all mutation SQL in `writes.js` | `ida-2c` source assertion |
| Writes **fail closed** without a resolved identity | `ida-2d` — throws before opening a transaction |
| Two distinct admin tokens → two distinct `actor_ref` values | `ida-2d`, confirmed by 21 distinct values on the live database |
| Restricted-scope facts excluded from every read path | `ida-2c`, `ida-2d`; 16 of 26 facts are restricted and none appears in a response |
| Seven server-derived fields rejected on submission, one test each | `ida-3b` 67/67 |
| Rate limiting enforced | `ida-3c` 63/63 |
| Ingestion route is admin-only; no public endpoint exists | `ida-3d` 73/73 |
| Media orphan cleanup never deletes a referenced file | `ida-2f` 32/32 |
| Driver errors mapped to safe status codes | `ida-2d` |

`reference/api.js` exports exactly `createServer`, `parseMultipartBuffer`,
`ingestHttpStatus`, `retryAfterSeconds` — no side effect on require, and no listener opened
by importing it.

---

## 5. Schema validation

| Check | Result |
|---|---|
| `ida-2a` structural suite | 44/44 — 24 tables, prefix discipline, balanced parentheses, no owner-PII column defined |
| `ida-3a` migration suite | 47/47 — additive only; creates no table outside the approved pair; does not overload `idauto_verifications` as a rate-limit store |
| Live schema matches the file | Confirmed by applying the file to an empty database and re-running the migration |
| Protocol ↔ implementation divergence | Enumerated in [`../protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md); which side is authoritative is stated per row |

---

## 6. Decoupling scan

Counts are split by *where* a match lives, because a string in a verbatim historical record
is not the same thing as a string in a code path.

| Search | In source / tests | In migration + history docs | Verdict |
|---|---|---|---|
| `projects/idauto` | **0** | 64 — 41 in the verbatim handover, 17 in the two migration documents, 6 provenance lines | **Clean.** No functional reference |
| `mythos-prod` | **0** | 26 — provenance headers and migration records | **Clean.** No functional reference |
| `/home/deploy` | **4** | 31 — verbatim handover and migration records | The four are two explanatory comments naming it as the canonical home-root example, and two test assertions proving it is refused. **No functional dependency** |
| `/srv/mythos`, other absolute production paths | **0** | 0 | — |
| External `require()` targets | **0** | Every import resolves to a Node built-in, `pg`, or a path inside this repository — checked across `reference/`, `ops/`, `ops/adapters/` and `tests/` |
| `mythos_private` | 148 | IDauto's own persisted scope value. Class D, retained deliberately, rename at IDA-7 |
| `mythos_user_id` | 20 | Opaque external identity reference. Class D, rename at IDA-7 |
| `mythos_core`, `_auth`, `_documents`, `_billing`, `_search`, `_notifications`, `_audit` | 22 | Class B optional integrations, none implemented, all documented |
| Undocumented external dependencies | **1 found, now documented** | `projects/mythos-core/reference/identity-contract.js` appears in the identity **migration procedure** (not executed, not imported by any source file). Recorded in [`IDENTITY_ARCHITECTURE.md`](IDENTITY_ARCHITECTURE.md) §6 with the standalone replacement |

### Restore-guard generalisation

`/home/deploy` was a hardcoded entry in two refusal lists. Deleting it would have removed a
protection; keeping it would have kept a deployment path. The guard now refuses **any direct
child of `/home`** by rule. `/home/deploy` is still refused, on every host, and the tests
prove it **through the CLI** rather than by inspecting a constant.

### Defect found by the move

`ops/media-ops.js` and `ops/offhost-backup.js` computed the repository root as
`path.resolve(__dirname, '..', '..', '..')` — correct at `projects/idauto/ops/`, wrong once
`ops/` sits at a repository root. The *"refuse to restore inside the git repository"* guard
would have resolved two levels above the repository and **silently stopped protecting it**.
Fixed to `path.resolve(__dirname, '..')` in both files; covered by `idauto-storage-ops`.

---

## 7. Secret scan

| Check | Result |
|---|---|
| Credential-shaped literals | 2 matches, both benign (below) |
| `.env` or any real environment file committed | **None.** `.gitignore` excludes `.env` and `.env.*`, keeping `.env.example` |
| `.env.example` contents | Placeholders only (`REPLACE_WITH_GENERATED_TOKEN`) |
| Backups, dumps, uploads, runtime data | **None** |
| Origin production credentials or backups | **Not migrated** |

1. `wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY` in `tests/ida-3f-offhost-backup-test.js` —
   **AWS's own published SigV4 documentation example key**, present so the test can pin the
   published signature vector exactly. Not a credential to anything.
2. `var TOKEN = 'ida3d-token-' + crypto.randomBytes(18).toString('hex')` — a per-run
   generated value, not a literal.

Both were flagged and investigated in the origin repository too, with the same finding.

---

## 8. PII and schema safety scan

A column-name search across all 24 tables for `owner`, `first_name`, `last_name`, `surname`,
`address`, `phone`, `mobile`, `email`, `national_id`, `cin`, `passport_no`, `birth` and
`insurance_holder` returned **three** matches, each inspected:

| Column | Verdict |
|---|---|
| `idauto_document_scans.has_owner_pii` | **Control flag, not PII.** A boolean recording that OCR *found* owner PII on a document. The schema comment states "PII never stored in this table"; the adjacent `pii_handled` column tracks routing or discard |
| `idauto_organizations.address_city` | **Business address.** A city name for a garage/insurer/fleet entity |
| `idauto_organizations.contact_email` | **Organisational contact**, commented as such in the schema |

**No owner-PII column exists on any vehicle, plate, observation, fact, evidence, document or
movement table.** No owner-PII column was introduced by this migration — the schema is
byte-identical to the origin apart from two documentation-path comments.

### Data-level privacy checks, on the live database

| Check | Result |
|---|---|
| `ip_hash` values on submissions | 24 rows, **every one a 64-character hex digest**. No dotted or colonned address anywhere |
| `ip_hash` values on observations | **0 of 58** |
| `ip_hash` values on audit rows | **0 of 183** |
| Anonymous submissions | All 54 NULL-`actor_ref` audit rows are `actor_type = 'anonymous'` |
| Restricted-scope facts | 16 of 26; none appears in any API response |

> **Precision worth keeping.** An `ip_hash` *column* exists on six tables. The invariant is
> about **values**, not the schema: the ingestion path never writes to the other five. The
> documentation now says this explicitly, because "confined to submissions" could otherwise
> be read as a structural guarantee it is not.

---

## 9. Documentation ↔ implementation consistency

| Check | Result |
|---|---|
| Blockchain described as implemented anywhere | **No.** `BLOCKCHAIN_ARCHITECTURE.md` is headed "SPECIFIED — NOT IMPLEMENTED"; README, roadmap, protocol §14 and `src/blockchain/README.md` agree. **No chain code exists** |
| `src/` mistaken for implementation | Guarded — `src/README.md` and all five subdirectory READMEs state NOT IMPLEMENTED and point at `reference/` |
| Roadmap statuses truthful | Verified stage by stage; corrected for IDA-3F (§10) |
| Stale claims carried over | Three found and corrected (§10) |
| JavaScript parses | 26 / 26 |
| JSON schemas valid | 14 / 14 |
| Relative documentation links | All resolve, except links inside the verbatim historical record in `AI_HANDOVER.md`, which point at origin paths by design and are flagged in that file's header |

---

## 10. Corrections made by this audit

Revision 1 of this audit passed on evidence that was itself incomplete. Four things were
wrong or missing, and the cause was the same in each case: **the IDA-3F stage entries of
2026-08-12 were read as current without scanning forward for later entries that superseded
them.**

### 10.1 IDA-3F was reported BLOCKED. It is not.

Revision 1 stated *"no off-host copy exists"* and listed off-host backup as a blocker for
IDA-3H, IDA-3I and IDA-8. On **2026-08-14** the object-store destination was provisioned and
a verified off-host backup of the database was created and restore-tested:

- dump → SHA-256 (C1) → upload → **fresh download** → SHA-256 (C2) → **C1 == C2**
- **isolated restore** into a throwaway container with `--network none`
- **24 tables / 2,551 rows, source-identical**
- local dumps removed afterwards; zero credentials in the repository

All seven backup-gate conditions are **MET**; the gate is **CLOSED**.

The same work found two defects the offline suite could not have caught: the S3 adapter's
default HTTPS transport had **never worked** (options passed in a shape Node ignores, so
every real request went to `localhost` — all 30 tests passed because each injected a mock),
and no DELETE existed, making verification round-trips impossible. The migrated adapter
contains both fixes; that is why this repository's `ida-3f` suite has 35 assertions and not
the 30 recorded in the 2026-08-12 entry.

Corrected in `ROADMAP.md`, `README.md`, `SECURITY.md`, `PRIVACY_ARCHITECTURE.md`,
`ROADMAP_EVOLUTION_2026-08-18.md`, `CHANGELOG.md`, `ops/runbooks/STORAGE_RUNBOOK.md` and
`docs/INGESTION_ARCHITECTURE.md` (a dated banner there rather than an edit, since that
document is a verbatim design record).

**What is still not done, and is not claimed:** there is no backup *schedule*, and the media
store has no verified off-host copy.

### 10.2 Five handover entries were missing

`OFF-HOST BACKUP EXECUTION`, `OFF-HOST S3 ADAPTER FIX`, `OFF-HOST BACKUP PREPARATION`,
`GATE CLOSURE ATTEMPT` and `FINAL VPS INVENTORY RECONCILIATION` (all 2026-08-14) directly
concern ID Auto files and the `idauto` database, and supersede the IDA-3F entries. Added to
`docs/AI_HANDOVER.md`, taking it from 25 to 30 sections, with a note explaining why they sit
above the entries they supersede.

### 10.3 The ID Auto risk register was left behind

`docs/AUTOMOTIVE_RISK_REGISTER.md` is a portfolio document, correctly not migrated whole —
but it carried **8 IDauto-owned open risks** and **9 cross-product risks involving IDauto**,
which would have been silently dropped. Extracted into `docs/RISK_REGISTER.md`, with stage
renumbering, the risks closed since, and 7 new risks added by the repositioning.

### 10.4 The off-host backup runbook and identity architecture were left behind

`docs/OFF_HOST_BACKUP_GATE.md` is ID Auto operational documentation; migrated to
`ops/runbooks/`, with two stale statements in the origin corrected in place and flagged
(its own header contradicted its §6 gate table). The ID Auto-relevant decisions from
`docs/MYTHOS_IDENTITY_ARCHITECTURE.md` were extracted into `docs/IDENTITY_ARCHITECTURE.md`,
including one previously undocumented external dependency.

---

## 11. Verdict

The migrated tree is **complete and validated**. It is **not canonical**, and IDauto is
**not "fully migrated"**, because three of the four conditions for that are unmet:

| Condition | Status |
|---|---|
| `othoth77/idauto` exists | ⛔ **NO** — `POST /user/repos` → `403 Resource not accessible by integration` |
| The complete tree exists there | ⛔ **NO** — blocked by the above |
| Tests run against the standalone checkout | ⚠️ **Run against the prepared tree, not a clean clone of the published repository.** 601/601 |
| Migration audit complete | ✅ **YES** — this document |

`othoth77/mythos-prod` therefore **remains canonical**. Nothing has been removed from it.

To publish: create an **empty** `othoth77/idauto` — no README, no `.gitignore`, no licence,
so the migrated tree is authoritative — and grant the session access. The tree is committed
and ready; publishing requires no redesign and no repeat of the migration.
