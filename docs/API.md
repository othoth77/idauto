# API

**Last updated:** 2026-09-05 (IDA-V13). Base URL `https://idauto.tn`.

**Authentication (IDA-V13).** Web users sign in at `/login`; the server sets the session cookie and every `/api/*` call from a page carries it plus the header `X-IDauto-Session: 1`. Server-to-server integrations keep `Authorization: Bearer <service credential>`. `401` without either (body `{ error, reason: no_credentials|invalid_credentials, login: '/login' }`), `403` when the principal lacks the scope.

| Route | Answer |
|---|---|
| `GET /login` | the French sign-in page |
| `POST /api/auth/sign-in/email` `{ email, password }` | 200 + `Set-Cookie: idauto.session_token=…; HttpOnly; SameSite=Lax; Path=/` (+ `Secure` in production) · 401 `INVALID_EMAIL_OR_PASSWORD` · 429 after 5 failures/min per client |
| `POST /api/auth/sign-out` | 200, session row deleted (needs the cookie and an `Origin` header) |
| `GET /api/auth/get-session` | `{ session, user:{ id, name, email, role, org_id } }` or `null` |
| `POST /api/auth/change-password` `{ currentPassword, newPassword, revokeOtherSessions? }` | 200 |
| `GET /api/auth/list-sessions` · `POST /api/auth/revoke-session` · `/revoke-sessions` · `/revoke-other-sessions` | Better Auth session management |
| `GET /session` (header `X-IDauto-Owner: 1`) | `{ owner, user:{ name, email, role, org_id } | null }` |
| any other `/api/auth/*` (sign-up, social, e-mail reset) | 404 — users are provisioned with `ops/auth-users.js` |

Roles: **admin** (everything, may act for an organisation by naming `org_id`), **manager** (its organisation, incl. `vin:search`), **technician** (its organisation, no VIN). A manager/technician without organisation is refused with 403 `role_without_organisation`. Errors from the V12 routes are `{ error: <CODE>, message_fr, details? }` — never a technical string. Full organisation contract: `ID_AUTO_INTEGRATION.md`.

## Public (no token)

| Route | Answer |
|---|---|
| `GET /public/plates/:plate` | `{ plate_number, ivid }` — any accepted spelling (`230 TU 8646`, `230TU8646`, `230 تونس 8646`, `8646TU230`, RS) · 404 unknown/invalid · 429 |
| `GET /public/passport/:ivid` | the public passport (no VIN, no identification internals) |
| `GET /`, `/passport`, `/atelier`, `/admin` | static pages |

## Identification (IDA-V12)

| Route | Scope | Body / query | Answer |
|---|---|---|---|
| `POST /api/resolve/plate` | `vehicle:resolve` | `{ plate, ocr_confidence?, registration_type?, method?: 'camera_ocr'|'manual', confirmed? }` | `{ status: needs_confirmation|resolved|candidate|not_found, plate:{…}, vehicle?, candidate?, source, confidence, verified, cache, latency_ms, provider_errors[] }` · 400 `INVALID_PLATE` / `PLATE_AMBIGUOUS` / `PLATE_PARTIAL` |
| `POST /api/resolve/vin` | `vehicle:resolve` + **`vin:search`** (audited) | `{ vin }` | same shape, `vin:{…}` · 400 `INVALID_VIN` |
| `POST /api/resolve/manual` | `vehicle:resolve` | `{ manufacturer, model, motorisation?, year?, engine_code?, tecdoc_car_id? }` | `resolved` (exact local match) or `candidate` (+ `alternatives`) |
| `POST /api/resolve/confirm` | `vehicle:write` | `{ vehicle_ref?, plate?, registration_type?, vin?, candidate:{…}, method, source?, confidence?, action?: 'edit' }` | `{ status:'confirmed', vehicle }` — the ONLY call that writes an identification |
| `GET /api/vehicles/:ref/fiche` | `vehicle:read` | | the Vehicle record + `history[]`; `vin` only with `vin:search` (disclosure audited), else `vin_present` |
| `GET /api/vehicles/:ref/identification/history` | `vehicle:read` | | `{ vehicle, history[] }` |
| `POST /api/vehicles/:ref/identification/refresh` | `vehicle:resolve` | | `{ status: candidate|no_change, proposals[], provider_errors[], providers_configured }` — writes nothing |
| `GET /api/resolution/providers` | admin | | active providers, catalogue state, cache stats |
| `GET /api/metrics` | admin | | resolution metrics |

`:ref` = IVID or `internal_ref`. Vehicle record fields: `id, internal_ref, plate, plate_display, registration_type, plates[], vin?, vin_present, manufacturer, model, version, motorisation, engine_code, year, year_from, year_to, fuel_type, engine_cc, tecdoc_car_id, source, source_timestamp, confidence, verified, verified_by, verified_at, verification_method, fiche_status, created_at, updated_at`.

## Catalogue and parts

| Route | Scope | Notes |
|---|---|---|
| `GET /api/catalog/status` | `parts:read` | `{ local:true, supplier:{ configured, provider, message_fr } }` |
| `GET /api/catalog/manufacturers` · `/manufacturers/:id/models` · `/models/:id/vehicles` · `/vehicles/:carId` | `parts:read` | supplier walk; **501 `CATALOG_NOT_CONFIGURED`** without a configured catalogue |
| `GET /api/vehicles/:ref/parts?category=` | `parts:read` | `{ vehicle, parts[], sources:{local,supplier}, supplier:{status,error,message_fr} }` — local + supplier merged, each part labelled `source`; availability/price only for the caller's organisation |
| `GET /api/parts/search?q=` | `parts:read` | reference (space/slash-tolerant), OE, name, brand |
| `GET /api/parts/:id` | `parts:read` | `local:<n>` or `tecdoc:<articleId>` |
| `POST /api/parts` | `parts:write` | `{ reference, brand, oe_reference?, category?, name? }` → 201; an organisation's entry is visible to it alone |
| `POST /api/parts/:localId/compatibility` | `parts:write` | `{ vehicle_ref | tecdoc_car_id | manufacturer+model(+motorisation, year_from, year_to) }` |
| `PUT /api/parts/:localId/stock` | `stock:write` | `{ quantity, price_millimes?, currency?, org_id? (admin) }` |

## Workshop

| Route | Scope | Notes |
|---|---|---|
| `POST /api/workshop/visits` | `workshop:write` | `{ plate? | vin? | selection?, plate_read_method?, ocr_confidence?, plate_confirmed?, customer_ref?, reason?, org_id? (admin) }` → 201 `{ visit, identification }` — identification runs inline; the visit gets its vehicle only when `resolved` |
| `GET /api/workshop/visits?vehicle_ref=&status=` | `workshop:read` | the organisation's visits |
| `GET /api/workshop/visits/:id` | `workshop:read` | visit + operations + orders; 404 for another organisation's visit |
| `POST /api/workshop/visits/:id/identification` | `workshop:write` + `vehicle:write` | same body as `/api/resolve/confirm`; attaches the confirmed vehicle |
| `GET /api/workshop/visits/:id/parts?category=` | `workshop:read` | parts compatible with the visit's vehicle |
| `POST /api/workshop/visits/:id/operations` | `workshop:write` | `{ operation_type: diagnosis|replacement|service|repair|inspection|other, description?, part_id?: 'local:<n>', quantity? }` |
| `POST /api/workshop/visits/:id/operations/:opId/status` | `workshop:write` | `{ status: planned|done|cancelled }` |
| `POST /api/workshop/visits/:id/close` · `/cancel` | `workshop:write` | 409 if not open |
| `POST /api/workshop/orders` | `workshop:write` | `{ visit_id?, supplier_ref?, lines:[{ part_id:'local:<n>', quantity, unit_price_millimes? }] }` → 201 draft |
| `GET /api/workshop/orders/:id` · `POST …/status` | `workshop:read` / `workshop:write` | `draft|placed|received|cancelled` |

`customer_ref` is an opaque identifier of the workshop's own customer record (1–64 chars, no spaces); a value that looks like a name or phone is refused.

## Error codes (V12)

`INVALID_PLATE 400 · PLATE_AMBIGUOUS 400 · PLATE_PARTIAL 400 · INVALID_VIN 400 · VALIDATION 400 · FORBIDDEN 403 · VEHICLE_NOT_FOUND 404 · NOT_FOUND 404 · CONFLICT 409 · OCR_LOW_CONFIDENCE 409 · CATALOG_NOT_CONFIGURED 501 · PROVIDER_UNAVAILABLE 503 · CATALOG_UNAVAILABLE 503 · NETWORK_FAILURE 503 · PROVIDER_TIMEOUT 504`

## Pre-V12 routes (unchanged)

Vehicles, plates, facts, observations, media, review queue, search (`GET /api/search/vehicles`), merge/split/resolve, passport, session — documented in `ID_AUTO_INTEGRATION.md` §5.
