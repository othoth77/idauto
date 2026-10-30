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
customer reference; document storage keys and OCR fields; a VIN fact under any key spelling (`vin`, `VIN`, ` Vin `);
audit rows about observations (submission time and submitter identity); the VIN digest of a `vehicle.search.vin`
audit summary (masked). Reason: no read of restricted data is audit-logged yet
(`PRIVACY_ARCHITECTURE.md` §3), the rule every other GET here already follows.

## 3. Pages

`/admin/vehicles` and `/admin/vehicle` are static shells served from `ADMIN_ASSETS` with the admin CSP
(`script-src 'self'`, no inline code, `frame-ancestors 'none'`, `no-store`). `reference/admin-console.js` is the shared
helper: every server value is placed with `textContent` (no `innerHTML`/`insertAdjacentHTML` — asserted), plates in a
`<bdi dir="ltr">` so the Arabic word never reorders the digits, labels only for values the schema allows, loading /
empty / error states, filter state in the URL (Back works). French copy, like `/admin`.

## 4. Tests

- `tests/ida-admin-registry-test.js` (in `npm run test:db`; refuses any database not named `idauto_scratch_*`):
  **135 passed, 0 failed** (118 before the pre-release review, §6). Fixtures go through the real routes (`/api/resolve/confirm`, facts, review, workshop visits
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

## 6. Pre-release review (2026-10-30)

An independent review of the PR found no critical or high issue (access control, SQL construction and XSS checked
clean). Fixed before merge, each with a regression test that fails on the earlier commit:

| Finding | Fix |
|---|---|
| M1 — the dossier's audit join included `idauto_observations` rows, i.e. submission times and submitter identities | observation targets dropped from the audit join |
| M2 — VIN exclusion matched `fact_key = 'vin'` exactly; `createFact` stores keys verbatim and defaults to public | `LOWER(TRIM(fact_key)) <> 'vin'` on every fact read |
| L3 — `vin_digest=` in audit summaries | masked in the dossier |
| L6 — a NUL byte in `q` or `:ref` produced a 500 | 400 / 404 |
| L7 — filter values were cut before validation (`year=20245` → 2024, `page=1.5` → 1) | refused instead |
| L8 — registry conflict count included restricted facts; pending observations counted from a 200-row list | aligned with the dossier; counted in SQL |

Accepted residual risks (admin-only surface): fact dates and evidence dates approximate when a published fact was
observed; free-text workshop fields (visit reason, operation description) are shown as entered and could contain
personal data typed by a workshop; plates, facts and aliases lists are not row-limited; the registry's free-text OR
and per-request `count(*)` scan the vehicle table (fine at today's size, revisit past ~10⁵ vehicles).


## 7. The six Admin modules — status audit (2026-10-30, `main` @ `138aa5e`)

Evidence = pages in `ADMIN_ASSETS`, links in each page's nav, routes in `api.js`/`v12-routes.js`/`admin-routes.js`, and
suites. A table or an endpoint alone does not count as a module. **Production (`0b005e7`) serves only `/admin` (Saisie)
and `/admin/review` (Revue)** — PR #39 is merged but not deployed.

| Module | Frontend page / nav | Backend | Real data | Access control | Tests | Status | Missing work |
|---|---|---|---|---|---|---|---|
| 1. Dashboard | none of its own; 7 count tiles at the top of `/admin/vehicles` | `GET /api/admin/overview` | yes (SQL counts, provider/catalogue state) | admin-only, twice | `ida-admin-registry` §5 | **PARTIAL** | a dedicated page; recent activity is returned but not shown; links from each tile to its module |
| 2. Vehicles | `/admin/vehicles` (registry), `/admin/vehicle?ref=` (dossier); in nav | `GET /api/admin/vehicles`, `…/:ref/dossier`, VIN via audited fiche | yes | admin-only, twice | `ida-admin-registry` 135/0, browser check 34/0 | **COMPLETE (read)** | edits stay in Saisie / review / merge routes; no merge/split UI |
| 3. Maintenance History | per-vehicle section of the dossier only; no page, no nav entry | workshop routes are **per organisation** (admin must pass `org_id`); no cross-organisation list | yes (visits, operations, service events) | org-scoped for workshops | `ida-v12` (workshop API) | **MISSING** on `main` → **IMPLEMENTED on branch `ida-admin-2-maintenance`**: `/admin/maintenance` + `GET /api/admin/maintenance` (§8) | merge + deploy |
| 4. Ateliers & Data Sources | none on `main` | **no route lists organisations or capture sources** on `main`; `GET /api/resolution/providers` and `/api/catalog/status` exist (admin) | tables `idauto_organizations`, `idauto_capture_sources`, `idauto_auth_user` (role/org); provider/TecDoc state | — | none for a listing | **MISSING** on `main` → **IMPLEMENTED on branch `ida-admin-2-maintenance`**: `/admin/sources` + `GET /api/admin/organisations`, `GET /api/admin/sources` (§9) | merge + deploy |
| 5. Data Quality | `/admin/review` (Revue) — pending observations + accept/reject; **English copy**; no conflict view | `/api/review/observations`, `…/decision`, `/api/review/submissions` (unused by the page), `/api/review/facts/:id/decision`, merge/split routes | yes | admin-only (absent from scope tables) | `ida-2h` 37/0, `ida-3e` 63/0 | **PARTIAL** on `main` → **IMPLEMENTED on branch `ida-admin-2-maintenance`**: `/admin/quality` + `GET /api/admin/quality`, `/admin/review` in French (§10) | merge + deploy; fact-level accept/reject UI (route exists, not wired) |
| 6. Security & Audit | none | **no route reads `idauto_audit_log` globally** (dossier shows one vehicle's rows); `GET /api/metrics` (admin); users only via `ops/auth-users.js` CLI | `idauto_audit_log`, `idauto_auth_user`/`_session` | — | auth suites (`ida-v13`) test the mechanism, not a console | **MISSING** on `main` → **IMPLEMENTED on branch `ida-admin-2-maintenance`**: `/admin/security` + `GET /api/admin/audit`, `GET /api/admin/accounts` (§11) | merge + deploy; account actions (create, role, revoke) stay in `ops/auth-users.js` until audited routes exist |

**Plan, in order of product value and dependency:**
1. **Maintenance History** (this branch, `ida-admin-2-maintenance`) — the vehicle history the product exists for, across every organisation; plus one shared navigation for all console pages.
2. **Ateliers & Data Sources** — read routes for organisations and capture sources; reuses the providers/catalogue status.
3. **Data Quality** — cross-vehicle disagreement/pending/alias lists; wire the existing review queue and submissions; French copy.
4. **Security & Audit** — global audit log (masked like the dossier), accounts/roles read-only, session counts.
5. **Dashboard** — its own page last, because its tiles should link into modules 2–6.

Each increment: admin-only routes (absent from every scope table + handler check), read-only SQL, `textContent`-only
rendering, loading/empty/error states, 390/1280 px browser check, a DB suite mutation-checked, nothing invented — what
is not recorded is shown as not recorded.

## 8. Maintenance History (IDA-ADMIN-2, branch `ida-admin-2-maintenance`)

`/admin/maintenance` — every recorded workshop visit (with its operations) and every service event, **across all
organisations**, admin only. The per-organisation workshop routes are unchanged.

`GET /api/admin/maintenance?kind=visits|service_events&q=&org_id=&status=&operation_type=&identified=&from=&to=&dir=&page=&page_size=`
→ `{ kind, page, page_size, total, pages, dir, organisations[{id,name,status}] (only those with records), totals{visits,
unidentified_visits, operations, service_events, service_events_with_mileage}, mileage_recorded_on_visits:false,
results[] }`. A visit: `{ id, org_id, org_name, status, opened_at, closed_at, reason, identification_method,
plate_read_method, plate_read (unidentified visits only), customer_ref_present, odometer_km:null, vehicle{ivid,…,plate,
merged_into}|null, operations[] }`. A service event: `{ id, org_id, org_name, event_type, event_date, odometer_km|null,
description, outcome, next_service_due, is_public, recorded_at, vehicle }`. `q` = IVID / internal_ref / any current or
historical plate in any spelling, or the plate read at the workshop for an unidentified visit. Every filter is validated
(400 + `message_fr`; impossible dates refused; visit-only filters refused for service events).

Never returned: the customer reference (flag only), `plate_read` of an identified visit, the read confidence, any fact.

Tests: `tests/ida-admin-maintenance-test.js` 71/0 (mutation-checked: exposing `plate_read`, ignoring the organisation
filter, removing the handler's admin check, selecting the customer reference — each turns it red). Browser 390/1280 px
26/0. Also fixed: on both console list pages, Back to a page whose URL omits a filter kept the stale value (registry
browser check 36/0, failing 34/2 before the fix). One navigation (Véhicules · Entretien · Revue · Saisie) on all five
console pages.

## 9. Ateliers & Data Sources (IDA-ADMIN-3, branch `ida-admin-2-maintenance`)

`/admin/sources` (nav « Ateliers ») — three sections, admin only, read only.

- `GET /api/admin/organisations?q=&status=&org_type=&sort=name|activity|created&dir=&page=&page_size=` →
  `{ page, page_size, total, pages, sort, dir, by_status, results[{ id, name, org_type, status, subscription_tier, city,
  governorate, verified_at, is_fixpert_pilot, created_at, contact_present, tax_id_present, accounts{managers,
  technicians}, integration{credentials, scopes}|null, activity{visits, open_visits, operations, service_events,
  documents, observations, stock_lines, last_activity_at|null} }] }`. `q` matches name or city (`%`/`_` literal).
- `GET /api/admin/sources` → `{ capture_sources[{ code, name_fr, name_ar, source_type, trust_level, requires_consent,
  legal_basis, active, notes, usage{observations, facts, submissions} }], vehicle_providers[{name, kind}],
  parts_catalogue{local, supplier{configured, provider, message_fr}}, service_credentials{admin_credentials,
  organisation_credentials, organisations, invalid_entries} }`.

Never returned: an organisation's contact e-mail or tax id (presence flags only); any service credential or
`actor_ref` — `identity.credentialSummary()` reports counts and scopes per organisation, validating each entry through
`resolvePrincipal()` so an entry the gate refuses is counted as invalid, not described. Last activity = latest visit,
document or service event; `null` when none — never estimated. Providers and the parts supplier are reported as
configured or not configured, never assumed.

Tests: `tests/ida-admin-sources-test.js` 61/0 (mutation-checked: contact e-mail selected as a value, `actor_ref` added
to the credential summary, the handler's admin check removed, the type filter ignored — each turns it red). Browser
390/1280 px 22/0. Row headers in console tables now read as content (no uppercase label style).

## 10. Data Quality (IDA-ADMIN-4, branch `ida-admin-2-maintenance`)

`/admin/quality` (nav « Qualité ») — read only, admin only. Decisions stay on `/admin/review`, through the existing
audited routes; the quality page only links there.

`GET /api/admin/quality?issue=all|disagreement|pending_facts|conflict_facts|pending_observations|incomplete|no_plate&q=&page=&page_size=`
→ `{ issue, q, page, page_size, total, pages, totals{identities, all, disagreement, pending_facts, conflict_facts,
pending_observations, incomplete, no_plate}, results[{ ivid, internal_ref, make, model, year, fiche_status, plate,
plate_display, updated_at, aliases, issues{…, no_plate:boolean}, disagreements[{fact_key, distinct_values, values[≤5]}] }],
review{pending_review, pending_confirmation, pending_unlinked, pending_by_source[{code, name_fr, n}],
submissions_by_status}, facts_by_status, fiche_by_status, merged_records, unidentified_visits }`.

- One row per **canonical** identity, over the identity and every record merged into it (the dossier's set), so a
  disagreement left on an alias is reported on the identity. Computed with grouped joins (≈20–60 ms on the 680-identity
  scratch register; the first version, one subquery per identity, took ≈500 ms and was replaced).
- Each issue is a fact of the data: *disagreement* = an active fact key with more than one distinct value (trimmed,
  upper-cased; values cut at 80 characters); *conflict_facts* = facts entered as `conflict` (createFact keeps the
  status sent; nothing detects conflicts automatically, which is why disagreement exists); *incomplete* = make, model or
  year missing; *no_plate* = no active plate on the identity or its aliases.
- Totals describe the whole register; `q` (IVID, internal_ref, make/model prefix, `%`/`_` literal) narrows the list.
- Never returned: a restricted (`mythos_private`) fact or a VIN fact (by key, any case, any scope) — not as a value, a
  count or a disagreement; no observation timestamp or capture detail.

`/admin/review` is now French (copy, statuses, roles), loads its queue once the admin session is confirmed, and shows
the decision confirmation after the reload (it was overwritten before, in the English page too). Hardened:
`GET /api/review/observations/:id` no longer returns a VIN fact written with a non-restricted scope.

Tests: `tests/ida-admin-quality-test.js` 65/0 (mutation-checked: VIN guard dropped, aliases not followed, the handler's
admin check removed, the review VIN filter reverted, the issue filter ignored — each turns it red). Browser 390/1280 px
35/0, including a real Rejeter decision writing exactly one audit row.

Not done: the per-fact accept/reject route (`POST /api/review/facts/:id/decision`) has no UI yet; submissions are counted
by status, not listed.

## 11. Security & Audit (IDA-ADMIN-5, branch `ida-admin-2-maintenance`)

`/admin/security` (nav « Sécurité ») — read only, admin only.

- `GET /api/admin/audit?event=&actor_type=&actor=&org_id=&target_type=&target=&from=&to=&page=&page_size=` →
  `{ page, page_size, total, pages, filters{event_types, target_types, actor_types}, last_30_days{by_family,
  by_actor_type, by_type}, results[{ id, at, masked, event_type, actor_type, actor_ref, actor_name, org_id, org_name,
  target_type, target_ref, summary }] }`. `event` is an exact type or a family ending in `.` (`workshop.`). Never
  returned: `old_value_json` / `new_value_json` (they hold the record written — a restricted fact's value, an IVID),
  the client hash, the request id. `vin_digest` is masked. **Capture rows** (target an observation, its media, a
  submission or a rate-limit bucket) keep only event, actor type and day: actor, target and hour together would rebuild
  a contributor's sightings; an `actor` or `target` filter never matches them. (Their position in the time-ordered list
  still brackets them between neighbouring rows; it reveals no actor or vehicle.)
- `GET /api/admin/accounts?role=&q=` → `{ totals{accounts, active_sessions, accounts_signed_in, without_organisation,
  by_role}, truncated, results[{ id, name, email, email_verified, role, org_id, org_name, org_status, created_at,
  can_sign_in, active_sessions, last_seen_at }], service_credentials{admin_credentials, invalid_entries,
  organisations[{org_id, credentials, scopes}]}, auth_decisions{since, counters} }`. Staff name and e-mail are shown to
  admins. Never read: `idauto_auth_account` (password hash, OAuth tokens), a session's token, address or user agent.
- Auth decisions: `api.js logAuthDecision` now also counts `auth_granted`, `auth_denied` and `auth_denied:<reason class>`
  (`missing_scope:x` → `missing_scope`), never by actor. They are in-process counters, reset on restart, reported with
  the process start time; password failures at `/login` (Better Auth) are not counted.

Tests: `tests/ida-admin-security-test.js` 75/0 (mutation-checked: new_value_json returned, capture masking off, the actor
filter reaching capture rows, vin_digest unmasked, a session user agent selected, counters keyed by actor, the handler's
admin check removed — each turns it red). Browser 390/1280 px 23/0.
