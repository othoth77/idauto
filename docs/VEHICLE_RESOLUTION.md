# Vehicle resolution

**Stage:** IDA-V12 · **Last updated:** 2026-09-05 · **Status:** IMPLEMENTED (local + manual); external provider: NOT CONFIGURED

How IDauto turns a plate, a VIN or a manual selection into a vehicle record, in what order it asks whom, and what it does when nobody knows.

---

## 1. The chain

```
Request ──► cache ──► local database ──► trusted providers (in order) ──► not found
                                                 │
                                          candidate (unrecorded)
                                                 │
                                        human confirms / corrects
                                                 │
                                    confirm() writes the vehicle
```

| Hop | Module | What it answers |
|---|---|---|
| cache | `reference/vehicle/resolution-cache.js` | in-process, TTL (`IDAUTO_RESOLUTION_CACHE_TTL_SECONDS`, default 300 s; negatives 60 s; bounded LRU). Invalidated on confirm/edit. |
| local | `reference/vehicle/providers/local-vehicle-resolver.js` → `vehicle-repository.js` | `idauto_plates.plate_number` (canonical form), the VIN fact, merges followed |
| providers | `reference/vehicle/providers/*` | whatever the operator configured; none by default |
| manual | `resolveByManualSelection()` | exact local match on make/model/motorisation/year, else a candidate |

**Truth is written only by `confirm()`.** A provider answer, a manual selection and an OCR read are all candidates until a person confirms them. A low OCR confidence (`< 0.75`, the scanner's own threshold) returns `needs_confirmation` before any lookup.

## 2. The interface

`reference/vehicle/vehicle-resolver.js` — `createVehicleResolver({ repository, providers, cache, observability })`:

| Method | Input | Result `status` |
|---|---|---|
| `resolveByPlate(raw, { confidence, registrationType, confirmed })` | any accepted spelling (`docs/ANPR.md` §2) | `needs_confirmation` · `resolved` · `candidate` · `not_found` |
| `resolveByVIN(raw)` | 17-char VIN | `resolved` · `candidate` · `not_found` |
| `resolveByManualSelection({ manufacturer, model, motorisation, year, engine_code, tecdoc_car_id })` | | `resolved` · `candidate` (+ `alternatives`) |
| `confirm({ vehicle_ref?, plate?, vin?, candidate, method, source, confidence, action })` | | the confirmed Vehicle record |
| `refresh(ref)` | | `candidate` (proposals) · `no_change` — writes nothing |

Errors are typed (`reference/vehicle/errors.js`): `INVALID_PLATE`, `PLATE_AMBIGUOUS`, `PLATE_PARTIAL`, `INVALID_VIN`, `VEHICLE_NOT_FOUND`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `NETWORK_FAILURE`, each with an HTTP status and a French `message_fr`. A provider failure never fails a request the local database can answer: it is reported in `provider_errors` and counted in the metrics.

### Provider contract

```js
{ name, kind,
  resolveByPlate(parsedPlate) → null | { source, confidence, verified:false, candidate:{ manufacturer, model, version, motorisation, engine_code, year, year_from, year_to, fuel_type, tecdoc_car_id, vin } },
  resolveByVIN(vin)           → same (optional) }
```
Swapping a provider changes the `providers` array and nothing else. The frontend never sees a provider.

## 3. Sources for Tunisia — research record (Phase 4, 2026-09-05)

Criteria: name · country · TU · RS · VIN · API · pricing · licence · rate limits · commercial use · confidence. Classes: **A** usable · **B** possible · **C** research required · **D** unusable.

| # | Source | Country | TU | RS | VIN | API | Pricing | Licence / terms | Rate limits | Commercial use | Class | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **IDauto local database** (`LocalVehicleResolver`) | TN | yes | yes | yes | internal | — | own data, confirmed by workshops | — | yes | **A** | the only source active today; grows with every confirmed identification |
| 2 | **Manual identification** (VIN, make/model/motorisation) | — | yes | yes | yes | internal | — | — | — | yes | **A** | always available; the fallback the order requires |
| 3 | **ATTT** (Agence Technique des Transports Terrestres) — online "situation administrative d'un véhicule" | TN | yes | ? | no | no public API | free (citizen) | citizen self-service; no documented programmatic access | unknown | no | **C** | the authoritative registry; a data-source agreement is the only legitimate path (`config` capture source `OFFICIAL_IMPORT`, LEGAL-REVIEW-REQUIRED) |
| 4 | **catalogue-data.transport.tn** (open-data portal, CKAN, ATTT organisation) | TN | no | no | no | CKAN API | free | Open Licence (OTL) | unknown | yes | **D** for resolution | 7 datasets, all geographic/aggregate (centres, directions); no per-vehicle record |
| 5 | **vehiculeapi.tn** (third-party, SOAP `.asmx` webservice) | TN | yes | ? | ? | yes, documented (PDF) | 0.67 TND / lookup, −10 % above 1000; 10 free | terms not published on the page; data "requested in real time from official government data sources" | not stated | account-based | **B** | candidate for the `HttpVehicleProvider` seam **only** under a written contract signed by the owner, with the owner's own credential, after legal review of the personal-data basis (a plate lookup returning 40 fields is a personal-data processing under Tunisian law 2004-63 / INPDP) |
| 6 | Consumer maintenance sites with plate lookup (captcha + private `ws_key`) | TN | yes | ? | ? | no (browser app) | — | private; reuse forbidden by the order | — | no | **D** | not used, not integrated, no credential reused |
| 7 | **TecAlliance TecDoc** (VIN / K-Type identification, parts) | EU/global | no (plate) | no | yes (VIN → KBA/K-Type, licence-dependent) | REST/SOAP webservice | licence, per contract | commercial licence required | per contract | yes | **B** | the parts source; see `docs/TECDOC.md`. Identifies vehicles from VIN in some licence tiers — not a plate resolver for Tunisia |
| 8 | **NHTSA vPIC** (US) | US | no | no | yes | free REST | free | public domain, commercial use allowed | fair use | yes | **C** | decodes WMI/model year for many makes; weak for the European/Asian fleet that dominates Tunisia; no plate |
| 9 | Commercial VIN decoders (vindecoder.eu, AutomotivAPI, VehicleDatabases, Vincario) | EU | no | no | yes | REST | from ~€/$99 per month | commercial | per plan | yes | **B** | a VIN → make/model/motorisation provider for the `resolveByVIN` seam; no plate; needs a contract |

**Conclusion.** No legitimate, licensed, API-backed **plate → vehicle** source for Tunisian TU/RS plates is configured or contracted. The project is therefore delivered with the `VehicleResolver` interface, the `LocalVehicleResolver`, the manual VIN / make-model-motorisation fallback, and a disabled generic HTTP adapter for the day the owner signs a contract with source #5 or a data-source agreement with source #3. This dependency is **BLOCKED / EXTERNAL** and is the only one.

Configuring a provider later = five environment variables (`.env.example`), no code change:
`IDAUTO_VEHICLE_PROVIDER_NAME`, `_URL` (`{plate}` receives the search key, e.g. `8646TU230`), `_VIN_URL`, `_TOKEN`, `_TIMEOUT_MS`. Only `https` is accepted. A provider with a different JSON shape gets a `map()` function in `http-vehicle-provider.js` — the documented default shape is in that file's header.

## 4. Vehicle memory (Phase 6)

On `confirm()` the repository writes, in one transaction: the vehicle (with `identification_*` provenance), the plate row, the VIN fact (`access_scope = professional`), one `idauto_vehicle_identification_history` row (`previous` / `next` snapshots, actor, org, method, source, confidence) and the audit row. Every later lookup for that plate or VIN is answered locally, before any provider.

## 5. Observability

Events (`reference/observability.js`): `plate_resolution_started`, `plate_resolution_success`, `plate_resolution_failed`, `vehicle_resolved`, `vehicle_confirmed`, `tecdoc_lookup_started`, `tecdoc_lookup_success`, `tecdoc_lookup_failed`, `route_error`. Metrics (`GET /api/metrics`, admin): `resolution_success_rate`, `resolution_latency_ms {count, avg, p50, p95}`, `provider_error_rate`, `ocr_confidence`, `local_cache_hit_rate`. Keys that look like credentials are redacted, VINs truncated, IPs never accepted.

## 6. Tests

`tests/ida-v12-vehicle-identification-test.js` (scratch database) — TEST 01–12 of the completion order. Providers in the suite are the **mocks** (`MockVehicleResolver`), injected through `resolver.setProviders()` (a test hook that throws in production). Every assertion that depends on a mock says so in its label.
