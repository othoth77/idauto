# IDauto — Production readiness (Phase 23)

**Date:** 2026-09-05 · **Branch:** `ida-v12-final-completion` · **Base:** `main` @ `65548ed` (deployed on idauto.tn)
**Verdicts:** PASS · FAIL · BLOCKED · NOT CONFIGURED. No critical FAIL remains.

| Area | Verdict | Evidence |
|---|---|---|
| FUNCTIONALITY — plate → vehicle → parts → workshop with manual fallback | **PASS** | `tests/ida-v12-vehicle-identification-test.js` 124/0 (TEST 01–12), `tests/ida-v12-atelier-browser-test.js` 19/0 in headless Chrome |
| FUNCTIONALITY — everything shipped before (passport, public plate, search, merge/split, org auth, ingestion, review, media, backup) | **PASS** | 28 pre-existing suites unchanged in outcome; full run 29 suites / 2175 / 0 (before the browser suite) |
| SECURITY | **PASS** | `docs/SECURITY.md` matrix; no secret in tree; `npm audit` 0; CSP pinned on all three surfaces; scopes per route; VIN behind `vin:search` + audited; SSRF-safe adapters; mocks refuse production |
| PERFORMANCE | **PASS** | in-process TTL cache (hit rate exposed), indexed lookups (plate, nospace plate, VIN, tecdoc_car_id), bounded LRU, provider timeouts (4 s / 5 s); p50 resolution latency in the suite: single-digit ms locally |
| DATABASE | **PASS** | `ida-v12` migration additive, applied twice (idempotent), DOWN documented, 33 tables, no PII column (asserted), audit in-transaction |
| API | **PASS** | 32 new routes documented in `docs/API.md`; typed errors with French messages; 401/403/404/409/501/503/504 semantics tested |
| UI | **PASS** | `/atelier`: 8 states (scanning, recognized, confirm, resolving, resolved, not found, error, manual); 320/390/768/1024/1280 screenshots, no horizontal overflow (measured at 390 with every panel open); French copy for mechanics |
| ANPR | **PASS** (operator-initiated) / **BLOCKED** (gate stream) | scanner + normaliser + confidence gate tested; stream-based Smart Gate stays LEGAL-REVIEW-REQUIRED (INPDP) — unchanged scope |
| VEHICLE RESOLUTION — local + manual | **PASS** | resolver chain, provenance, history, cache, refresh |
| VEHICLE RESOLUTION — external Tunisian plate → vehicle provider | **NOT CONFIGURED / BLOCKED (EXTERNAL)** | no licensed source contracted; candidates and classes in `docs/VEHICLE_RESOLUTION.md` §3; the `HttpVehicleProvider` seam is ready (5 env vars) |
| TECDOC | **NOT CONFIGURED** | adapter + gateway contract implemented; UI says « Catalogue fournisseur non configuré »; local catalogue works; licence is an owner purchase |
| WORKSHOP | **PASS** | visits / operations / orders / order lines, org isolation, several visits per vehicle, opaque customer references |
| ERROR HANDLING | **PASS** | provider timeout, unavailable, invalid plate, invalid VIN, not found, catalogue unavailable / not configured, OCR low confidence, network failure — all typed, tested, never raw |
| LOGGING / MONITORING | **PASS** | structured events (8 names of the order), `GET /api/metrics` with the 5 metrics, redaction tested |
| DOCUMENTATION | **PASS** | README, ARCHITECTURE §10, VEHICLE_RESOLUTION, TECDOC, ANPR, DATABASE, DEPLOYMENT, SECURITY, API, ID_AUTO_INTEGRATION, CHANGELOG, ROADMAP, AI_HANDOVER, FINAL_AUDIT, this file |
| DEPLOYMENT of this branch | **BLOCKED (owner step)** | merge to `main`, `git pull` on the production checkout, apply `ida-v12` migration, restart the unit (`docs/DEPLOYMENT.md` §3). Not done by this session: the production checkout is live. |

## What runs in production after the owner step

CAMERA → plate (scanner) → normalisation → `VehicleResolver` (cache → **local IDauto database** → manual VIN / make-model-motorisation) → Vehicle record with provenance → **local parts catalogue + organisation stock** → workshop visit / operations / orders. Every step has its fallback; nothing depends on an external service.

## What needs an external party

| Dependency | Who | Effect when present |
|---|---|---|
| Plate → vehicle provider (e.g. a contracted vehiculeapi.tn account, or an ATTT data agreement) | owner (contract + legal basis) | unknown plates get a candidate to confirm instead of manual entry |
| TecDoc licence (TecAlliance) | owner | supplier parts appear beside local ones, `tecdoc_car_id` identification |
| INPDP notification per workshop | owner + workshop | enables the stream-based Smart Gate design (still to be built) |

## Mock vs real, stated plainly

| | Real | Mock |
|---|---|---|
| Plate normaliser, VIN validation, resolver chain, repository, cache, metrics | real | — |
| Local database resolution, manual identification, confirm/edit/history | real | — |
| Local parts catalogue, stock, workshop | real | — |
| Plate → vehicle **provider** in tests | — | `MockVehicleResolver` (labelled) |
| TecDoc in tests | — | `MockTecDocProvider` (labelled) |
| Plate → vehicle provider in production | **none configured** | never |
| TecDoc in production | **none configured** | never |

The end-to-end test (Phase 22) therefore passed under option **B** of the order: mock providers + test data, on a scratch database, with the mocks named in every assertion that uses them. Option A (real provider) is not available on this host.
