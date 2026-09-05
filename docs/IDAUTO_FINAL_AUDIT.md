# IDauto — Final completion audit (Phase 0)

**Date:** 2026-09-05 · **Audited tree:** `main` @ `65548ed` (= `origin/main`, = the production checkout at `/home/deploy/projects/idauto`)
**Working branch for the completion:** `ida-v12-final-completion` (worktree `/home/deploy/projects/idauto-final`)
**Baseline test run before any change:** 28 suites · **2049 assertions · 0 failures** against a purpose-built scratch database (`idauto_scratch_final` = `schema.sql` + all six migrations + synthetic seed). `ida4-foundation` run env-free as it requires.

This audit states what exists in the code, not what the documents promise. Every row was checked in the source, in the migrations, or by running the suite.

---

## DONE (verified working)

| Area | Evidence |
|---|---|
| PostgreSQL schema, 24 tables, zero owner-PII columns | `database/schema.sql`; `tests/ida-2a` asserts no PII column; 6 migrations applied idempotently |
| Authenticated read/write API with atomic audit | `reference/api.js` + `reference/writes.js` `withAudit()`; every mutation and its audit row in one transaction |
| Admin identities + organisation credentials with exact scopes | `reference/identity.js`, `ROUTE_SCOPES` in `api.js`; `tests/ida-v9` 32/0 |
| IVID issuance and the IVID-only public passport | `reference/ivid.js`, `ivid-issuance.js`, `GET /public/passport/:ivid`; `ida4-option-c` 129/0 |
| Public plate → IVID resolution (owner decision 2026-08-27) | `GET /public/plates/:plate`, strict canonical form `SSS TUN NNNN`; `ida-v2` 75/0 |
| Unregistered plate handoff (search miss is audited, registration pre-filled) | `ida-v3` 60/0, `ida-v11` 116/0 |
| Plate scanner: camera → Tesseract OCR (vendored, same-origin, digits-only) → confirm/correct → same search | `web/citizen/plate-scanner.js`; weakest-digit confidence, 75 threshold, never searches an unseen plate |
| Vehicle search (plate spacing-tolerant, VIN under `vin:search` and always audited, IVID, internal_ref, make, model, year) | `GET /api/search/vehicles`; `ida-v10` 62/0 |
| Identity resolution: merge / split / alias, old references keep resolving | `ida-v8` 44/0 |
| Verification / publication / source / confidence as independent axes on facts | `ida-v4` 41/0 |
| Owner session (HttpOnly cookie, 2 read routes only, CSRF header) | `ida-v1b` 84/0 |
| Rate limiting: per-client bucket behind nginx, own bucket for the public surface | `reference/rate-limit.js`; `ida-3c` 63/0; shared-bucket bug fixed 2026-08-27 |
| Content-addressed media storage, review queue, community ingestion | `ida-2f`, `ida-3b/3d/3e` |
| Off-host backup, restore-verified; nightly captures `idauto_production` | `ops/offhost-backup.js`; `ida-3f` 35/0 |
| CSP pinned directive-by-directive on both surfaces (`wasm-unsafe-eval` only on the citizen page) | `ida-v11` §1 |
| Design system + citizen pages, responsive 320–1280, light/dark | `ida4-ds-ui` 398/0, `ida-admin-ds` 78/0 |
| Deployment: idauto.tn live, systemd user unit, loopback bind, TLS, env outside the worktree | `/home/deploy/deployments/idauto-api/DEPLOYMENT_RECORD.md` |
| Integration contract for the workshop side | `docs/ID_AUTO_INTEGRATION.md` |

## PARTIAL

| Area | What exists | What is missing |
|---|---|---|
| Plate normalisation | `reference/plate-validator.js` validates against the catalogue (`TUN_STD` = `SSS TUN NNNN`); search strips spaces | No structured plate object (country / registrationType / series / number / normalized / confidence). `TU` (Latin transliteration), `تونس` (Arabic), Arabic-Indic digits and the reversed key `8646TU230` are all refused. No `RS` (régime suspensif) format at all. Scanner is digits-only, so OCR cannot distinguish TU from RS. |
| Vehicle identification | Plate → local vehicle (public + authenticated); VIN → vehicle via search | No `VehicleResolver` abstraction, no provider chain, no cache/TTL, no `resolveByVIN` / `resolveByManualSelection` service, no provenance of an identification |
| Vehicle record | `idauto_vehicles` has make/model/variant/year/body/fuel/engine_cc; VIN is a scoped fact | No motorisation, engine_code, year_from/year_to, tecdoc_car_id, identification source/confidence/verified/verified_by/method; no identification history |
| Manual fallback | Admin manual entry (`/admin`) creates vehicles/plates/facts | No workshop-facing "plate failed → VIN → make/model/motorisation" flow |
| Error handling | API answers safe JSON errors; citizen UI shows French copy | No typed error vocabulary for provider timeout / unavailable / catalogue not configured |
| Observability | JSON auth-decision logs, audit table | No structured resolution events, no metrics endpoint |
| Documentation | 33 docs, thorough on protocol/privacy/legal | No `VEHICLE_RESOLUTION.md`, `TECDOC.md`, `ANPR.md`, `DATABASE.md`, `DEPLOYMENT.md`, `API.md`, `docs/SECURITY.md` (root `SECURITY.md` is the disclosure policy); README "current state" table is stale (says nothing is deployed) |

## MISSING

| Area | State in the tree |
|---|---|
| TecDoc / parts catalogue adapter (`TecDocAdapter`, `PartsCatalog`) | No file, no table, no route, no mention of TecDoc anywhere in the repository (`grep -ri tecdoc` = 0 hits) |
| Vehicle → parts path | none |
| Local parts catalogue and organisation stock (catalogue ≠ stock) | none |
| Workshop workflow (visit, operation, order) and `WorkshopVehicleService` | none — `docs/ID_AUTO_INTEGRATION.md` delegates all workshop records to Fixpert; `/home/deploy/projects/fixpert` is a static website with no workshop system |
| Vehicle fiche (edit / confirm / refresh / history) | none |
| Vehicle memory with provenance (plate → VIN → vehicle → tecdoc_car_id, source, timestamp, verified_by, method) | none |
| Mock providers for tests (`MockVehicleResolver`, `MockTecDocProvider`) | none |
| End-to-end test camera → plate → vehicle → parts → workshop | none |
| Metrics (`resolution_success_rate`, latency, provider error rate, OCR confidence, cache hit rate) | none |

## BLOCKED / EXTERNAL

| Dependency | Status | Handling in this completion |
|---|---|---|
| External plate → vehicle provider for Tunisia (TU/RS) | **No legitimate, licensed, API-backed source identified** (see `docs/VEHICLE_RESOLUTION.md` §Sources, written in Phase 4). The only known plate-resolving sites are consumer services behind captcha and private keys; reusing them is excluded by the order. | `VehicleResolver` with `LocalVehicleResolver` first, a configurable generic HTTP provider adapter (no credential in the repo, disabled by default), manual VIN / make-model-motorisation fallback |
| TecDoc licence / API access | Not configured on this host; no credential exists | `TecDocAdapter` reports `not_configured`; the UI shows « Catalogue fournisseur non configuré » and continues with the local catalogue |
| Automated gate ANPR (camera stream, no human in the loop) | LEGAL-REVIEW-REQUIRED (INPDP notification per workshop), unchanged since IDA-1 | The implemented ANPR is operator-initiated (a person points the camera and confirms the reading). Stream-based Smart Gate stays specified only. |
| Parts data found on this host (`ssangyong_autos` database = empty; SPY holds 45k autopart.tn URLs) | autopart.tn robots.txt forbids automated catalogue collection without written authorisation | **Not used.** The local catalogue is populated only by the workshop's own references. |
| `ida-admin-french-copy` (origin branch, not merged, touches `admin.html`, `admin-ui.js`, 5 tests) | Owner's branch, pending | This completion does not edit `admin.html` / `admin-ui.js`; the workshop surface is a new page, so the branch stays mergeable |

## RISK

| Risk | Mitigation |
|---|---|
| The production checkout is the git worktree of `main` (unit `WorkingDirectory=/home/deploy/projects/idauto`); a stray edit there is a live change | All work happens in the separate worktree `idauto-final`; production is untouched until the owner merges and restarts |
| `config/idauto.example.json` is copied to the host as `idauto.json`; new plate formats added to the example must also be present on the host copy | Deployment note in `docs/DEPLOYMENT.md`; the validator's default path is the repository file, so runtime behaviour is covered either way |
| Adding columns to `idauto_vehicles` must not leak through the public passport | The public route selects columns by name; new columns are not selected; asserted by test |
| PII: a workshop "customer" concept must not enter IDauto tables | Customer identity stays in the workshop's own system; IDauto stores only an opaque `customer_ref` per organisation |
| `web/vendor/tesseract` is ~9 MB shipped from this origin; first scan is slow on mobile | Already lazy-loaded; unchanged |
| The `RS` pattern and all Tunisian patterns are UNVERIFIED DRAFTS (AD-3) | Configurable, not hardcoded; manual correction always available |
