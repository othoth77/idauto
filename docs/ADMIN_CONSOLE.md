# Admin console — registry and vehicle dossier (IDA-ADMIN-1)

**Date:** 2026-10-30 · **Branch:** `ida-admin-registry-dossier` · **Status:** IMPLEMENTED on the branch, tested on a
scratch database; **not deployed**.

The operator console gains its first read workspace: a **registry** of vehicle identities (`/admin/vehicles`) and a
**vehicle dossier** (`/admin/vehicle?ref=<IVID|internal_ref>`) that gathers everything recorded against one identity.
Both are read-only. Every change the console leads to goes through an audited route that already existed.

## 1. Capability matrix

Evidence = code and tests in this repository on 2026-10-30, not documentation alone.

| Capability | Existing code (before) | API / database contract | Added here | Tests | Infrastructure dependency |
|---|---|---|---|---|---|
| Dashboard | none (only `/api/metrics`, resolution counters) | — | `GET /api/admin/overview`: real counts (identities, plates, facts by status, pending review, visits, operations, service events, documents, organisations, last 15 audit events), DB + provider health | `ida-admin-registry` §5 (counts equal SQL) | none |
| Vehicle registry | `GET /api/search/vehicles` — exact criteria, **capped at 50, never paged** (IDA-V10 anti-enumeration) | unchanged for organisations | `GET /api/admin/vehicles` — admin only, filters, 6 sorts, server-side paging (≤ 100/page, offset ≤ 10 000), current **and historical** plates in any spelling | §3 (page walk without gap/duplicate, sorts, filters, 9 validation refusals, injection, `%` literal) | none |
| Vehicle detail | `GET /api/vehicles/:ref/fiche`, `/identification/history`, `/api/passport/:ivid`, `/facts` — separate calls, active plates only | unchanged | `GET /api/admin/vehicles/:ref/dossier` — one canonical identity + aliases, all plates with status/validity, facts with verification/scope/confidence/source/evidence, observations, workshop visits + operations, service events, documents (metadata), identification history, data quality, audit | §4 | none |
| Plate history | `idauto_plates.status/valid_from/valid_until` existed; no read exposed retired plates | — | dossier `plates[]` (incl. plates recorded on merged aliases) | §4 | none |
| Maintenance / workshop | visits, operations, orders per organisation (`/api/workshop/*`) | org-scoped; admin must name `org_id` | dossier shows every organisation's visits to an admin; customer reference reduced to `customer_ref_present` | §4, browser check | none |
| Mileage | **no column on workshop visits**; `idauto_service_events.odometer_km` exists but **no code writes service events** | — | displayed where it exists; visits say « non enregistré » | §4 | — (gap, see §5) |
| Trust / provenance | `verification_status`, `access_scope`, `confidence_score`, `idauto_fact_evidence.evidence_type`, capture source; T0–T3 only computed in `passport-assembly.js` from trust assessments **that no live route persists** | — | shown as recorded (no derived T-level is invented); « aucune source institutionnelle » stated | §4 | — |
| Data quality | review queue (`/admin/review`), merge/split routes (IDA-V8) | `fiche_status`, `verification_status='conflict'` (allowed by schema, **written by no code path**) | dossier `quality`: disagreeing active values per key (what `createFact` actually produces), pending review, aliases; registry `disagreement_count` | §4 | none |
| Merge / split / alias | `POST /api/vehicles/:ref/merge|split`, `GET …/resolve` — audited | unchanged | read side only: aliases listed, alias ref answers with the canonical dossier | §4 | none |
| VIN | fact in `mythos_private`; `vin:search` + audit on search/resolve/fiche | unchanged | never in registry/dossier; explicit « Afficher » button uses the existing audited fiche | §0, §4, browser | none |
| Documents / media | carte-grise faces (`/registration-document`, org-scoped), observation media | unchanged | metadata only (no storage key, no OCR fields, no bytes) | §4 | local media store (unchanged) |
| Data sources | `idauto_capture_sources`, providers (none configured), TecDoc (not configured) | — | overview reports configured provider count and catalogue state; nothing claimed | §5 | — |
| ANPR | operator-initiated scanner on `/atelier` and `/` (IDA-V11/V14) | unchanged | not touched; no Smart Gate | existing suites | — |
| Global search | per-surface searches | — | registry free text = plate / IVID / internal ref / make / model prefix; never VIN | §3 | — |
| Auth / audit | Better Auth sessions + `X-IDauto-Session`, scope gate, `withAudit()` | unchanged | console routes admin-only twice (central gate + handler) | §0, §1 | — |

## 2. Routes and contracts

All three are `GET`, admin only, and absent from every scope table, so `api.js` answers **403** to any organisation
credential (service, manager, technician) before the handler runs, and the handler re-checks the admin scope.
Anonymous → 401 `{ login: '/login' }`. The owner cookie (IDA-V1B) is honoured on none of them.

| Route | Query / answer |
|---|---|
| `GET /api/admin/overview` | `{ vehicles:{canonical,merged,verified,created_30d}, plates, facts_by_status, review, workshop:{visits_by_status, operations_by_type, service_events}, organisations_by_status, documents, recent_activity[], health:{database, vehicle_providers_configured, parts_supplier_configured}, generated_at }` |
| `GET /api/admin/vehicles` | `q` (≤64: IVID, internal_ref, any current/historical plate in any accepted spelling, make/model prefix — never a VIN), `make`, `model` (exact, case-insensitive), `year` (4 digits), `fiche_status` (schema values), `verified` (`true`/`false`), `include_merged=1`, `sort` (`updated`·`created`·`make`·`model`·`year`·`ivid`), `dir` (`asc`/`desc`), `page`, `page_size` (1–100). → `{ page, page_size, total, pages, results:[{ ivid, internal_ref, make, model, variant, year, fuel_type, colour, fiche_status, verified, identification_source, merged_into, plate, plate_display, plate_count, visit_count, conflict_count, disagreement_count, created_at, updated_at }] }`. 400 + `message_fr` on any invalid filter. |
| `GET /api/admin/vehicles/:ref/dossier` | `:ref` = IVID or internal_ref (merges followed; `requested_alias` set when the ref was an alias). → `{ vehicle (Vehicle record, vin_present only), aliases[], plates[], identification_history[], facts[] (+evidence[], source), restricted_fact_count, observations[], maintenance:{ visits[] (+operations[], customer_ref_present, odometer_km:null), service_events[], timeline[], mileage_recorded_on_visits:false }, documents[], quality, audit[], completeness_note }`. 404 unknown. |

**Never returned, even to an admin:** VIN value; any `mythos_private` fact or media (counted only); observation
`capture_time`/`created_at`, `plate_candidate`, `ocr_confidence`, `ip_hash`, camera/contributor/session; workshop
customer reference; document storage keys and OCR fields. Reason: no read of restricted data is audit-logged yet
(`PRIVACY_ARCHITECTURE.md` §3), the rule every other GET here already follows.

## 3. Pages

`/admin/vehicles` and `/admin/vehicle` are static shells served from `ADMIN_ASSETS` with the admin CSP
(`script-src 'self'`, no inline code, `frame-ancestors 'none'`, `no-store`). `reference/admin-console.js` is the shared
helper: every server value is placed with `textContent` (no `innerHTML`/`insertAdjacentHTML` — asserted), plates in a
`<bdi dir="ltr">` so the Arabic word never reorders the digits, labels only for values the schema allows, loading /
empty / error states, filter state in the URL (Back works). French copy, like `/admin`.

## 4. Tests

- `tests/ida-admin-registry-test.js` (in `npm run test:db`; refuses any database not named `idauto_scratch_*`):
  **118 passed, 0 failed**. Fixtures go through the real routes (`/api/resolve/confirm`, facts, review, workshop visits
  and operations, merge). Mutation-checked: dropping the restricted-scope filter, selecting the customer reference, and
  removing the handler's admin check each turn the suite red.
- `tests/ida-2g-admin-manual-entry-ui-test.js`: one assertion looked for the English title removed in #33 and had
  failed on `main` since (database suites do not run in CI); now asserts structure. 17/0.

## 5. Not done / gaps found

- **Mileage** is not captured by workshop visits; adding it needs a migration (`odometer_km` on
  `idauto_workshop_visits` or writing `idauto_service_events` from the atelier) — a product decision.
- **No trust level is persisted**; T0–T3 are computed only from trust assessments that no route stores.
- **`verification_status = 'conflict'` is never written** by any code path; the console's conflict signal is the
  computed disagreement.
- **Organisation-scoped registry** (a manager browsing its own organisation's vehicles) is not offered: the console is
  admin-only; organisations keep the capped search.
- Review decisions, merge/split from the dossier, a data-sources page and ANPR in the console are not in this slice;
  their backend contracts exist (review, merge/split) or are legally gated (Smart Gate).
