# Migration from `othoth77/mythos-prod`

**Migration date:** 2026-08-18 · **Audit revision:** 2 (completeness audit applied)

---

## 1. Source repository

| | |
|---|---|
| Repository | `othoth77/mythos-prod` |
| Branch | `main` |
| Baseline commit | `5e2011b` — *Merge pull request #12 — MOS-1 / MOS-1.1 MYTHOS OS Command Center* |
| Working branch for the migration | `claude/idauto-standalone-migration-ejyl27` |

## 2. Destination

| | |
|---|---|
| Repository | `othoth77/idauto` |
| First commit | the migrated tree, as its authoritative initial content |
| Baseline migrated | IDA-0 → IDA-3F complete; IDA-2E blocked; IDA-3G/H/I not started |

**This is a move, not a rewrite.** Every implementation artefact, every test, the live
database schema and the complete stage history — including blockers and recorded mistakes —
moved intact. Nothing was rebuilt from a README, and no stage was re-described.

**Nothing was removed from the source repository.** Cleanup is a separate, later change (§9).

---

## 3. Source paths

Everything ID Auto-specific in the origin repository, found by an exhaustive
case-insensitive search for `idauto` / `id auto` across all tracked files — not only
`projects/idauto/`.

| Source path | Files | Disposition |
|---|---|---|
| `projects/idauto/**` | 25 | Migrated |
| `tests/ida-2*.js`, `tests/ida-3*.js`, `tests/idauto-storage-ops-test.js` | 13 | Migrated |
| `docs/IDAUTO_*.md` (7) + `docs/IDA3_INGESTION_ARCHITECTURE.md` | 8 | Migrated, renamed |
| `docs/AI_HANDOVER.md` — ID Auto entries | 30 sections | Extracted verbatim |
| `docs/OFF_HOST_BACKUP_GATE.md` | 1 | Migrated, ID Auto-scoped, two stale statements corrected |
| `docs/AUTOMOTIVE_RISK_REGISTER.md` — ID Auto rows | 17 rows | Extracted into `docs/RISK_REGISTER.md` |
| `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` — ID Auto decisions | — | Extracted into `docs/IDENTITY_ARCHITECTURE.md` |
| `tests/devx-1-idauto-test-impact-test.js` | 1 | **Excluded** — tests Mythos tooling |
| `projects/meta/*.json` | 5 | **Excluded** — Mythos portfolio metadata |
| `docs/AUTOMOTIVE_*.md`, `ATELIER_NETWORK_*`, `AUTOVALEUR_*`, `AUTOCHECK_STANDARD.md` | 15 | **Excluded** — portfolio/sibling products |
| `docs/MYTHOS_*.md` (other), `docs/CHANGELOG.md`, `docs/ROADMAP.md` | — | **Excluded** — Mythos platform scope |
| `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md` | — | **Excluded** — monorepo agent configuration |
| `projects/mythos-core/**`, `projects/automotive/**`, siblings | — | **Excluded** — other products |

## 4. Migrated paths

### 4.1 Direct moves

```
projects/idauto/database/          → database/
projects/idauto/config/            → config/
projects/idauto/reference/         → reference/
projects/idauto/ops/               → ops/
projects/idauto/{package.json, package-lock.json, .env.example}  → ./
tests/ida-*.js, tests/idauto-storage-ops-test.js                 → tests/   (names unchanged)
```

**44 file pairs checked byte-for-byte against the origin. Zero missing.**
10 are byte-identical; 34 differ, every difference accounted for in §5 and §6.

### 4.2 Renames

| Origin | New |
|---|---|
| `docs/IDAUTO_PRODUCT_SPEC.md` | `docs/PRODUCT_SPEC.md` |
| `docs/IDAUTO_ARCHITECTURE.md` | `docs/ARCHITECTURE.md` |
| `docs/IDAUTO_CAPTURE_PIPELINE.md` | `docs/CAPTURE_PIPELINE.md` |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | `docs/FIXPERT_INTEGRATION.md` |
| `docs/IDA3_INGESTION_ARCHITECTURE.md` | `docs/INGESTION_ARCHITECTURE.md` |
| `docs/IDAUTO_STORAGE_RUNBOOK.md` | `ops/runbooks/STORAGE_RUNBOOK.md` |
| `docs/IDAUTO_TEST_RUNBOOK.md` | `ops/runbooks/TEST_RUNBOOK.md` |
| `docs/OFF_HOST_BACKUP_GATE.md` | `ops/runbooks/OFF_HOST_BACKUP_GATE.md` |
| `docs/IDAUTO_ROADMAP.md` | `docs/ROADMAP.md` — **rewritten**, extended to IDA-9; completed stages keep their status |
| `projects/idauto/README.md` | `README.md` — **rewritten**; the original was stale, describing IDA-1 as current when IDA-3 was done |
| `docs/AI_HANDOVER.md` (ID Auto entries) | `docs/AI_HANDOVER.md` — 30 sections, verbatim |

### 4.3 Created in this repository

`LICENSE` (Apache-2.0) · `CONTRIBUTING.md` · `SECURITY.md` · `GOVERNANCE.md` ·
`CHANGELOG.md` · `.gitignore` ·
`docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` · `docs/TRUST_MODEL.md` ·
`docs/PRIVACY_ARCHITECTURE.md` · `docs/BLOCKCHAIN_ARCHITECTURE.md` ·
`docs/PART_IDENTITY.md` · `docs/IDENTITY_ARCHITECTURE.md` · `docs/RISK_REGISTER.md` ·
`docs/OPEN_SOURCE_STRATEGY.md` · `docs/BUSINESS_MODEL.md` · `docs/GO_TO_MARKET.md` ·
`docs/ROADMAP_EVOLUTION_2026-08-18.md` · `docs/MIGRATION_FROM_MYTHOS_PROD.md` ·
`docs/STANDALONE_MIGRATION_AUDIT.md` · `protocol/**` (18 files) · `src/**` (6 placeholders)

## 5. Excluded paths, with reasons

| Excluded | Why |
|---|---|
| `tests/devx-1-idauto-test-impact-test.js` | Tests the **Mythos** test-impact selector. Its subject is Mythos tooling; ID Auto is only the data it selects over |
| `projects/meta/{test-impact-map,portfolio-registry,project-ledger,project-statistics,current-context}.json` | Mythos portfolio infrastructure |
| `docs/AUTOMOTIVE_*.md` (9) | Portfolio-level: govern AutoValeur, Atelier Network and AutoMarket as well. **The ID Auto risk rows were extracted** rather than lost — `docs/RISK_REGISTER.md` |
| `docs/ATELIER_NETWORK_*.md`, `docs/AUTOVALEUR_*.md`, `docs/AUTOCHECK_STANDARD.md` | Sibling products |
| `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` | Mythos platform contract governing several products. **The ID Auto decisions were extracted** — `docs/IDENTITY_ARCHITECTURE.md` |
| `docs/MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md` | Portfolio review across all products |
| `docs/AI_HANDOVER.md` non-ID-Auto entries (~10,400 lines) | Other products' history |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/PROJECT_HISTORY.md` | Mythos-wide; superseded by this repository's own |
| `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md` | Monorepo agent configuration |
| `projects/mythos-core/reference/identity-contract.js` | Mythos platform module. **Not a runtime dependency** — no IDauto file imports it; it appears only in a documented, unexecuted migration procedure. Recorded in `docs/IDENTITY_ARCHITECTURE.md` §6 |
| Production data, credentials, backups, real vehicle data | Never migrated. The only data here is the synthetic seed |

## 6. Dependency decisions

Every Mythos coupling found in the migrated files, classified. Nothing was blindly deleted.

### Class A — required external dependency

**None.** Verified mechanically: every `require()` in `reference/`, `ops/` and `tests/`
resolves to a Node built-in, to `pg`, or to a path inside this repository. There is no
external import anywhere.

### Class B — optional integration, retained and documented

| Coupling | Where | Disposition |
|---|---|---|
| `mythos_core` as a sibling logical schema | `database/schema.sql` comment, `config/idauto.example.json` | Documents a deployment topology, not a dependency. A standalone deployment simply has no such schema |
| `mythos_auth` contract | `docs/ARCHITECTURE.md` §4.1 | Never implemented — the thing IDA-2E was blocked on. Superseded by IDA-7 |
| `mythos_documents` contract | `docs/ARCHITECTURE.md` §4.3 | Never implemented; local storage used instead |
| `mythos_notifications`, `_billing`, `_search`, `_audit` | `docs/ARCHITECTURE.md` §4 | None implemented |
| Identity contract module | `docs/IDENTITY_ARCHITECTURE.md` §6 | Documentation-level only; a UUIDv7 generator and a format validator replace it |
| Fixpert ownership boundary | `docs/FIXPERT_INTEGRATION.md` | **Retained in full.** A correct data-ownership boundary: the workshop owns its business data, IDauto owns the vehicle identity layer. Generalises to any workshop |
| Atelier Network work-order references | `docs/FIXPERT_INTEGRATION.md`, `docs/ARCHITECTURE.md` | One-directional: an external system references an IDauto vehicle id. No reverse dependency |

### Class C — obsolete coupling, removed or neutralised

| Coupling | Action |
|---|---|
| `projects/idauto/…` prefix in ~70 comments and path joins | **Removed** — paths are repository-relative |
| `docs/IDAUTO_*.md` references | **Rewritten** to the new names |
| `/home/deploy/deployments/idauto-media` hardcoded | **Removed** — `IDAUTO_MEDIA_STORAGE_PATH`, no fallback |
| `/home/deploy/backups` default | **Removed** — `--dest` or `IDAUTO_BACKUP_ROOT`; fails with a usage error rather than writing to an assumed path |
| `/home/deploy` in restore-refusal lists | **Generalised, not weakened** — any direct child of `/home` is refused by rule. Still refused, on every host, proven through the CLI |
| Repository-root computation `__dirname/../../..` | **Corrected to `__dirname/..`** — a real defect (§7) |
| `project: 'mythos-prod / id-auto'` in backup manifests | **Changed to `'idauto'`** |
| `Repository: othoth77/mythos-prod` doc headers | **Replaced**, with a provenance line |
| `Platform: Mythos ecosystem` | **Replaced** with standalone + optional interoperability |
| `/home/deploy/projects/mythos-prod` test instructions | **Rewritten** deployment-neutrally |

### Class D — must be redesigned

| Coupling | Why | Plan |
|---|---|---|
| **IDA-2E's premise** — integrate the Mythos auth service | The service never existed. Standalone, there is not even a hypothetical one | Redesigned onto **W3C DID/VC** at **IDA-7**. Blocker preserved and re-scoped, not dropped |
| **`access_scope = 'mythos_private'`** | IDauto's own vocabulary, persisted live, used in every access path | **Retained**; protocol layer calls it `restricted`. Rename at **IDA-7** |
| **`mythos_user_id` column** | An opaque external identity reference, not a Mythos dependency | **Retained**; rename to `subject_ref` at **IDA-7** |
| **`MYTHOS_SUPER_ADMIN` role name** | Referenced in configuration; never concretely defined in the origin either | **Retained**; access governance is an open LEGAL-REVIEW-REQUIRED item |

### Historical references — retained deliberately

`docs/AI_HANDOVER.md` (30 verbatim sections) and the provenance headers on migrated
documents cite origin paths, origin commit hashes and origin document names. These are
**not** coupling: they are the record of where the work came from. The handover's header
states plainly that its paths and hashes resolve only in the origin repository.

## 7. Defects found by the migration

| Defect | Impact | Fix |
|---|---|---|
| `ops/media-ops.js` and `ops/offhost-backup.js` computed the repository root as `__dirname/../../..` — correct at `projects/idauto/ops/`, wrong at a repository root | The *"refuse to restore inside the git repository"* guard resolved two levels above the repository and **silently stopped protecting it** | `path.resolve(__dirname, '..')` in both; covered by the suite |
| Four documents carried statements that were true when written and false by 2026-08-14 (off-host backup absent) | Would have published a stale blocker as current status | Corrected; the verbatim design record carries a dated banner instead of an edit |

## 8. Validation results

Summary; full evidence in [`STANDALONE_MIGRATION_AUDIT.md`](STANDALONE_MIGRATION_AUDIT.md).

| Check | Result |
|---|---|
| Test suites re-run in the new layout, live PostgreSQL 16 | **13 / 13 suites, 601 assertions, 0 failures** |
| Source files compared byte-for-byte with the origin | **44 pairs, 0 missing** |
| Executable-code changes in `reference/` | **Zero.** Every diff is a comment |
| Schema applied to a clean database | 24 tables, all `idauto_`-prefixed; IDA-3A migration idempotent |
| Owner-PII columns | **0** (3 name-matches inspected; all business or control fields) |
| External module dependencies | **0** beyond Node built-ins and `pg` |
| `projects/idauto` references in source or tests | **0** |
| `mythos-prod` references in source or tests | **0**; 26 in provenance and migration records |
| `/home/deploy` references in source or tests | 4, all safety-guard illustrations or assertions |
| Secrets / credentials / real vehicle data | **None** |
| JavaScript parses / JSON schemas valid | 26 / 26 · 14 / 14 |

## 9. Known blockers

| Blocker | Status |
|---|---|
| **`othoth77/idauto` does not exist** | **BLOCKS PUBLICATION.** `POST /user/repos` → `403 Resource not accessible by integration`. Owner must create an empty repository and grant access |
| **IDA-2E — real authentication** | **BLOCKED.** Re-scoped to IDA-7 on W3C primitives |
| **15 LEGAL-REVIEW-REQUIRED items** | **OPEN.** Block every public surface — see [`ROADMAP.md`](ROADMAP.md) |
| **Plate formats unverified** | Flagged since IDA-0; unconfirmed against an official source |
| **No backup schedule** | One verified off-host batch exists (2026-08-14); recurring backups and media-store coverage do not |
| **Test fixture lifecycle undefined** | Not a present correctness issue |

`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**.

## 10. Source-repository cleanup — separate and later

`othoth77/mythos-prod` is **not** modified by this migration beyond adding a migration
record. A separate pull request there will remove the duplicated source, leave a pointer,
and update the two integrations that reference ID Auto test paths
(`projects/meta/test-impact-map.json`, `tests/devx-1-idauto-test-impact-test.js`).

It is sequenced **after** this repository is published and independently verified from a
clean clone. Until then the origin remains authoritative and nothing has been deleted
anywhere.
