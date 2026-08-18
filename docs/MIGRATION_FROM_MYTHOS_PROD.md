# Migration from `othoth77/mythos-prod`

**Migration date:** 2026-08-18
**Origin repository:** `othoth77/mythos-prod`
**Origin location:** `projects/idauto/`, `docs/IDAUTO_*.md`, `docs/IDA3_*.md`, `tests/ida-*.js`
**Origin baseline commit:** `5e2011b` (merge of PR #12, `main`)
**New repository:** `othoth77/idauto`
**Baseline migrated:** IDA-0 → IDA-3E complete; IDA-3F blocked; IDA-2E blocked

---

## 1. What this migration is

ID Auto was developed inside the Mythos OS monorepo from 2026-08-05. On 2026-08-18 it was
extracted into a standalone repository and repositioned as an open protocol.

**This is a move, not a rewrite.** Every implementation artefact, every test, the live
database schema, the complete stage history including its blockers and its mistakes, moved
intact. Nothing was rebuilt from a README, and no completed stage was re-described as
planned or vice versa.

The origin repository is **not** modified by this migration. Removing the duplicated source
there is a separate, later change (§8), deliberately sequenced after this repository is
validated.

---

## 2. Migration inventory

### 2.1 Moved — code, data and configuration

| Origin path | New path | Type | Change |
|---|---|---|---|
| `projects/idauto/database/schema.sql` | `database/schema.sql` | PostgreSQL schema, 24 tables | Doc-reference paths only |
| `projects/idauto/database/seed-synthetic-test-data.sql` | `database/seed-synthetic-test-data.sql` | Synthetic seed | Unchanged |
| `projects/idauto/database/migrations/ida-3a-ingestion-schema.sql` | `database/migrations/ida-3a-ingestion-schema.sql` | Migration | Doc-reference path only |
| `projects/idauto/config/idauto.example.json` | `config/idauto.example.json` | Rules and feature flags | Unchanged |
| `projects/idauto/reference/api.js` | `reference/api.js` | HTTP API | Comment paths only |
| `projects/idauto/reference/db.js` | `reference/db.js` | `pg.Pool` wrapper | Comment paths only |
| `projects/idauto/reference/writes.js` | `reference/writes.js` | `withAudit()` transaction helper | Comment paths only |
| `projects/idauto/reference/identity.js` | `reference/identity.js` | Admin identity stub | Comment paths only |
| `projects/idauto/reference/storage.js` | `reference/storage.js` | Content-addressed media | Deployment path → env var in comments |
| `projects/idauto/reference/ingestion.js` | `reference/ingestion.js` | Ingestion service | Comment paths only |
| `projects/idauto/reference/rate-limit.js` | `reference/rate-limit.js` | Rate limiting | Unchanged |
| `projects/idauto/reference/plate-validator.js` | `reference/plate-validator.js` | Config-driven plate validation | Comment paths only |
| `projects/idauto/reference/admin-ui.js`, `admin.html`, `admin.css` | `reference/` | Admin manual-entry UI | Unchanged |
| `projects/idauto/reference/review-ui.js`, `review.html` | `reference/` | Review-queue UI | Unchanged |
| `projects/idauto/reference/IDENTITY_ADAPTER.md` | `reference/IDENTITY_ADAPTER.md` | Identity contract note | External link marked external |
| `projects/idauto/ops/media-ops.js` | `ops/media-ops.js` | Media integrity, backup, restore | **Deployment paths removed** (§4) |
| `projects/idauto/ops/offhost-backup.js` | `ops/offhost-backup.js` | Off-host backup core | **Deployment paths removed** (§4) |
| `projects/idauto/ops/adapters/s3-compatible.js` | `ops/adapters/s3-compatible.js` | SigV4 adapter, Node built-ins only | Unchanged |
| `projects/idauto/package.json` | `package.json` | One dependency (`pg`) | Renamed, re-described, unscoped |
| `projects/idauto/package-lock.json` | `package-lock.json` | Lockfile | Regenerated for the new package name |
| `projects/idauto/.env.example` | `.env.example` | Env contract, no secrets | Doc-reference paths only |

### 2.2 Moved and renamed — documentation

| Origin path | New path |
|---|---|
| `docs/IDAUTO_PRODUCT_SPEC.md` | `docs/PRODUCT_SPEC.md` |
| `docs/IDAUTO_ARCHITECTURE.md` | `docs/ARCHITECTURE.md` |
| `docs/IDAUTO_CAPTURE_PIPELINE.md` | `docs/CAPTURE_PIPELINE.md` |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | `docs/FIXPERT_INTEGRATION.md` |
| `docs/IDAUTO_ROADMAP.md` | `docs/ROADMAP.md` — **rewritten and extended to IDA-9**; completed stages preserved with their original status |
| `docs/IDA3_INGESTION_ARCHITECTURE.md` | `docs/INGESTION_ARCHITECTURE.md` |
| `docs/IDAUTO_STORAGE_RUNBOOK.md` | `ops/runbooks/STORAGE_RUNBOOK.md` |
| `docs/IDAUTO_TEST_RUNBOOK.md` | `ops/runbooks/TEST_RUNBOOK.md` |
| `projects/idauto/README.md` | `README.md` — **rewritten**; the original was stale (it described IDA-1 as the current stage, three stages behind reality) |
| `docs/AI_HANDOVER.md` (ID Auto entries) | `docs/AI_HANDOVER.md` — **25 sections extracted verbatim**, unedited |

### 2.3 Moved — tests

All thirteen suites moved to `tests/`, unchanged except that `path.join(BASE, 'projects',
'idauto', …)` became `path.join(BASE, …)`, since `BASE` is now the repository root.

`ida-2a` · `ida-2c` · `ida-2d` · `ida-2f` · `ida-2g` · `ida-2h` · `ida-3a` · `ida-3b` ·
`ida-3c` · `ida-3d` · `ida-3e` · `ida-3f` · `idauto-storage-ops`

One test was substantively edited: `idauto-storage-ops-test.js`'s protected-path assertion,
because the guard it tested was generalised (§4).

### 2.4 Created — new in this repository

| Path | Why |
|---|---|
| `LICENSE` | Apache-2.0. The monorepo had none |
| `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md` | Open-source governance |
| `CHANGELOG.md` | — |
| `docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` | The formal protocol specification |
| `docs/TRUST_MODEL.md` | T0–T4 |
| `docs/PRIVACY_ARCHITECTURE.md` | Consolidates privacy rules previously spread across four documents |
| `docs/BLOCKCHAIN_ARCHITECTURE.md` | Anchoring design |
| `docs/PART_IDENTITY.md` | Future extension |
| `docs/OPEN_SOURCE_STRATEGY.md`, `docs/BUSINESS_MODEL.md`, `docs/GO_TO_MARKET.md` | Strategy |
| `docs/ROADMAP_EVOLUTION_2026-08-18.md` | The decision record for this repositioning |
| `docs/MIGRATION_FROM_MYTHOS_PROD.md` | This file |
| `docs/MIGRATION_AUDIT_REPORT.md` | Validation evidence |
| `protocol/**` | Machine-readable schemas, event vocabulary, credential profile, verification spec |
| `src/**` | Reserved layout, explicitly empty, each directory marked NOT IMPLEMENTED |
| `.gitignore` | — |

### 2.5 Deliberately not migrated

| Origin path | Type | Why |
|---|---|---|
| `tests/devx-1-idauto-test-impact-test.js` | Mythos DEVX test-impact mapping | Tests Mythos tooling that selects test suites; not an ID Auto test |
| `projects/meta/test-impact-map.json` | Mythos test-impact registry | Mythos infrastructure |
| `projects/meta/portfolio-registry.json`, `project-ledger.json`, `project-statistics.json`, `current-context.json` | Mythos portfolio metadata | Mythos infrastructure |
| `docs/AUTOMOTIVE_*.md` (9 files) | Mythos automotive portfolio docs | Cross-product; ID Auto is one entry among several |
| `docs/ATELIER_NETWORK_*.md`, `docs/AUTOVALEUR_*.md` | Sibling products | Not ID Auto |
| `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` | Mythos identity contract | Referenced by `reference/IDENTITY_ADAPTER.md`; retained as an **external optional** reference |
| `docs/AUTOCHECK_STANDARD.md`, `docs/MYTHOS_*.md` | Mythos platform docs | Not ID Auto |
| `projects/mythos-core/**`, `projects/automotive/**`, etc. | Sibling projects | Not ID Auto |
| `docs/AI_HANDOVER.md` (non-ID-Auto entries) | ~10,500 lines | Other products' history |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md` (Mythos-wide) | Portfolio-level | Superseded by this repository's own |
| `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md` | Mythos agent configuration | Repository-specific tooling for the monorepo |

**No production data, no credentials, no backups and no real vehicle data were migrated.**
The only data in this repository is the synthetic seed file, explicitly marked as such.

---

## 3. Path mapping, in short

```
projects/idauto/database/   →  database/
projects/idauto/config/     →  config/
projects/idauto/reference/  →  reference/
projects/idauto/ops/        →  ops/
projects/idauto/{package.json,package-lock.json,.env.example}  →  ./
docs/IDAUTO_<X>.md          →  docs/<X>.md
docs/IDA3_INGESTION_ARCHITECTURE.md  →  docs/INGESTION_ARCHITECTURE.md
docs/IDAUTO_{STORAGE,TEST}_RUNBOOK.md →  ops/runbooks/{STORAGE,TEST}_RUNBOOK.md
tests/ida-*.js              →  tests/   (unchanged names)
```

---

## 4. Dependency classification

Every Mythos coupling found in the migrated files, classified as Phase 3 requires. Nothing
was blindly deleted.

### Class A — required external dependency

**None.** ID Auto has no hard runtime dependency on any Mythos service. This was already
true before the migration: the reference implementation requires only PostgreSQL, the local
filesystem, and `pg`.

### Class B — optional integration, retained

| Coupling | Where | Disposition |
|---|---|---|
| `mythos_core` named as a sibling logical schema | `database/schema.sql` comment, `config/idauto.example.json` `logical_schemas` | **Retained.** Documents a deployment topology, not a dependency. A standalone deployment simply has no such schema |
| `mythos_auth` integration contract | `docs/ARCHITECTURE.md` §4.1 | **Retained as optional.** Never implemented — it is the thing IDA-2E was blocked on. Now superseded by IDA-7's W3C approach |
| `mythos_documents` integration contract | `docs/ARCHITECTURE.md` §4.3 | **Retained as optional.** Never implemented; local storage is used instead |
| `mythos_notifications`, `mythos_billing`, `mythos_search`, `mythos_audit` | `docs/ARCHITECTURE.md` §4 | **Retained as optional.** None implemented |
| `MYTHOS_IDENTITY_ARCHITECTURE.md` binding contract | `reference/IDENTITY_ADAPTER.md` | **Retained**, relabelled as an external reference. The rules it states (products must not add core's format constraints to their own columns) remain sound as generic guidance |
| Fixpert ownership boundaries | `docs/FIXPERT_INTEGRATION.md` | **Retained in full.** A legitimate, correct data-ownership boundary: the workshop owns its business data, IDauto owns the vehicle identity layer. Generalises to any workshop |
| Atelier Network work-order references | `docs/FIXPERT_INTEGRATION.md`, `docs/ARCHITECTURE.md` | **Retained.** One-directional: an external system references an IDauto vehicle id. No reverse dependency |

### Class C — legacy coupling, removed or neutralised

| Coupling | Where | Action |
|---|---|---|
| `projects/idauto/…` path prefix in ~70 comments and path joins | source, tests, docs | **Removed.** Paths are now repository-relative |
| `docs/IDAUTO_*.md` doc references | source, tests, docs | **Rewritten** to the new names |
| `/home/deploy/deployments/idauto-media` hardcoded | `ops/offhost-backup.js`, `reference/storage.js` comment, runbooks | **Removed.** Now `IDAUTO_MEDIA_STORAGE_PATH`, with no hardcoded fallback |
| `/home/deploy/backups` default | `ops/media-ops.js` | **Removed.** Now `--dest` or `IDAUTO_BACKUP_ROOT`; the tool fails with a usage error rather than writing to an assumed path |
| `/home/deploy` in the restore-refusal lists | `ops/media-ops.js`, `ops/offhost-backup.js` | **Generalised, not weakened.** Replaced with a rule — any direct child of `/home` is a user home root and is refused. `/home/deploy` is still refused, on every host, and the tests prove it through the CLI |
| Repository-root computation `__dirname/../../..` | `ops/media-ops.js`, `ops/offhost-backup.js` | **Corrected to `__dirname/..`.** This was a real functional defect introduced by the move: the old path assumed `ops/` sat three levels below the repository root. Left unchanged, the "refuse to restore inside the repository" guard would have pointed at the wrong directory |
| `project: 'mythos-prod / id-auto'` in backup manifests | `ops/media-ops.js` | **Changed to `'idauto'`** |
| "Repository: othoth77/mythos-prod" doc headers | 4 documents | **Replaced** with the new repository plus a provenance line |
| "Platform: Mythos ecosystem" | doc headers | **Replaced** with standalone + optional interoperability |
| `/home/deploy/projects/mythos-prod` test instructions | `ops/runbooks/TEST_RUNBOOK.md` | **Rewritten** deployment-neutrally |

### Class D — must be redesigned

| Coupling | Why it cannot simply be kept | Plan |
|---|---|---|
| **IDA-2E's premise** — "integrate the real Mythos OS auth service" | The service never existed, which is why the stage was blocked. In a standalone repository there is not even a hypothetical service to wait for | Redesigned: authentication is built on **W3C DIDs and Verifiable Credentials** at **IDA-7**. The blocker is preserved in the roadmap and re-scoped, not quietly dropped |
| **`access_scope = 'mythos_private'`** | The scope name embeds the origin platform, but it is ID Auto's own vocabulary, persisted in a live database and used in every access-control path. Renaming is a breaking data migration with zero behavioural benefit | **Retained as-is** and documented: the protocol layer calls it `restricted`; the two are the same scope. Rename scheduled at **IDA-7**, alongside the other protocol-convergence migrations |
| **`mythos_user_id` column** | Reads as a Mythos dependency; it is in fact an *opaque external identity reference* that any identity provider can populate | **Retained as-is.** Rename to a neutral `subject_ref` is an **IDA-7** candidate. Breaking migration; not scheduled opportunistically |
| **`MYTHOS_SUPER_ADMIN` role name** | Referenced in configuration; was never concretely defined anywhere, even in the monorepo | **Retained** in configuration; the governance policy for operator super-admin access remains an open **LEGAL-REVIEW-REQUIRED** item, exactly as it was |

**Remaining `/home/deploy` occurrences: four.** All are safety-guard illustrations — two
explanatory comments naming it as the canonical example of a home root, and two test
assertions proving it is refused. None is a functional dependency.

---

## 5. Compatibility

IDauto remains compatible with the Mythos ecosystem and requires none of it.

- **Runtime dependencies:** PostgreSQL, the local filesystem, and `pg`. Nothing else.
- **Optional integrations** (auth, documents, notifications, billing, search, audit) are
  documented contracts. None is implemented; the system runs without all of them.
- **Data direction is one-way:** external systems may reference an IDauto vehicle id. IDauto
  reads nothing from them and writes nothing to them.
- **The database schema is unchanged**, so an existing deployment migrates by repointing at
  this repository. No data migration is required, and none was performed.

---

## 6. Validation performed

Full evidence in [`MIGRATION_AUDIT_REPORT.md`](MIGRATION_AUDIT_REPORT.md). In summary:

- **All 13 suites re-run in the new layout against a live PostgreSQL 16 database with the
  migrated schema applied: 601 assertions, 0 failures.**
- Schema applied cleanly; 24 tables; migration idempotent against the schema file.
- No `mythos-prod` reference outside deliberate provenance notes.
- No `projects/idauto` reference anywhere.
- No absolute production path outside safety-guard illustrations and tests.
- No secret, credential or real vehicle data.
- No owner-PII column introduced.
- Protocol documentation cross-checked against the implementation; every gap recorded in
  [`../protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md).
- Blockchain documented as SPECIFIED throughout; no chain code exists.

---

## 7. Status at migration

Unchanged by the move. Nothing was upgraded in the retelling.

| | |
|---|---|
| IDA-0, IDA-1 | Complete |
| IDA-2 | Complete, with IDA-2E blocked and IDA-2I delivered as IDA-3C |
| IDA-3A–3E | Complete |
| IDA-3F | Tooling merged and offline-verified; **no off-host copy exists — BLOCKED** |
| IDA-3G, 3H, 3I | Not started |
| IDA-4 – IDA-9 | Specified or planned; none implemented |
| Public endpoint | **Not ready.** Three open blockers |
| Deployment | Nothing deployed. No public endpoint exists |

---

## 8. Origin repository cleanup — separate and later

Per the migration plan, `othoth77/mythos-prod` is **not** modified by this migration. A
separate pull request there will:

- remove the duplicated active ID Auto source (`projects/idauto/`, `tests/ida-*.js`)
- leave a pointer document explaining that ID Auto now lives at `othoth77/idauto`
- remove stale duplicated documentation
- preserve the historical record in that repository's own `AI_HANDOVER.md` and changelog
- avoid breaking any Mythos integration

That change is deliberately sequenced **after** this repository is validated. Until then the
origin remains intact and authoritative, and nothing has been deleted anywhere.
