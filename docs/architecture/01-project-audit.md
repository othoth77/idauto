# 01 — Project audit

**Audited on:** 2026-11-10, against `main` at `9a0f5b1` (the version deployed on idauto.tn on 2026-11-09).

**Method:**
- read the source;
- extract the schema and the routes with scripts;
- run read-only checks on the deployed hosts.

Nothing is described from intention. When an older document disagrees with the code, the code wins; the differences
are listed in §7.

## 1. Repository structure

| Path | Content | Executed in production |
|---|---|---|
| `reference/` | The application: one Node.js HTTP server (`api.js`), its route modules, services, repositories, the static pages (`*.html`) and their scripts (`app-*.js`, `admin-*.js`) | **yes** |
| `reference/workspace/` | Services of the simplified application: vehicle registration, vehicle details, owner contacts, interventions, lists and dashboard | yes |
| `reference/auth/` | Better Auth setup (`auth.js`) and session → principal mapping (`principal.js`) | yes |
| `reference/documents/` | Registration-document (carte grise) photos: storage, metadata, retired OCR parser | yes (OCR routes answer 410) |
| `reference/vehicle/` | Plate normalisation, VIN validation, vehicle repository and resolver | yes |
| `reference/workshop/` | Workshop visits / operations / orders repository and the plate-reading workshop service | yes |
| `reference/parts/` | Local parts catalogue, TecDoc adapter (unconfigured), mock provider (tests only) | yes, local catalogue only |
| `reference/admin/` | Read models of the operator console | yes |
| `web/citizen/`, `web/design-system/`, `web/vendor/` | Public pages, the shared design system (tokens, CSS, small JS), vendored browser libraries (Tesseract, scanic, qrcodegen) | yes |
| `database/` | `schema.sql`, ordered migrations, synthetic test seed | yes (applied) |
| `ops/` | Operator tools: `auth-users.js` (accounts), `offhost-backup.js` + `adapters/s3-compatible.js`, `media-ops.js`, page and catalogue generators (`ops/ui/`), runbooks | operator-run, not services |
| `config/idauto.example.json` | Plate formats, public-resolution switch and rate limit | **read at runtime** by `plate-validator.js`. The public switch is read from the file named by `IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH`; production points it at a host-local `idauto.json`, where `enabled` = true. |
| `tests/` | 44 suites: 16 database-free, the rest on a scratch PostgreSQL | CI and local |
| `protocol/` | JSON schemas and vocabularies of the open vehicle-identity protocol | no (specification) |
| `src/` | README files only (`api`, `blockchain`, `identity`, `provenance`, `verification`) | no (planned) |
| `docs/` | Product, privacy, security, deployment and history documents | — |

## 2. Technology stack (versions confirmed)

| Layer | Technology | Version | Where confirmed |
|---|---|---|---|
| Runtime | Node.js | 22.22.1 (production and staging) | `node --version` on the hosts; CI uses Node 22 |
| HTTP server | Node core `http`, no web framework | — | `reference/api.js` `createServer()` |
| Authentication | Better Auth (email + password, cookie sessions) | 1.7.2 | `package-lock.json`, `reference/auth/auth.js` |
| Database driver | node-postgres (`pg`) | 8.23.0 | `package-lock.json`, `reference/db.js` |
| Database | PostgreSQL | **15.18** in production (Docker container); 16.9 on staging | `SELECT version()`; staging binary |
| Front end | Static HTML + vanilla JavaScript (CommonJS-free IIFEs), CSS design tokens | — | `reference/*.html`, `web/design-system/` |
| Browser libraries | Tesseract (OCR, plate scanner of the legacy workshop page), scanic, qrcodegen | vendored | `web/vendor/` |
| Reverse proxy / TLS | nginx, certificates from Let's Encrypt (Certbot) | nginx 1.28.3 | `nginx -v`; certificate issuer |
| Containers | Docker (PostgreSQL only) | 29.6.1 | `docker --version` |
| OS (production) | Ubuntu | 26.04 LTS | `lsb_release` |
| CI | GitHub Actions, `ubuntu-latest` | — | `.github/workflows/ci.yml` |
| Runtime dependencies | exactly two: `better-auth`, `pg` | — | `package.json` |

## 3. Component inventory

| Component | Kind | Responsibility | Source |
|---|---|---|---|
| HTTP server and request pipeline | module | Asset serving with CSP, page gate, public route, auth routes, authentication, scope gate, dispatch | `reference/api.js` |
| Workspace routes | route module | Simplified application API: register, dossier, owner, details, delete, interventions, parts, overview, search, notifications | `reference/workspace-routes.js` |
| V12 routes | route module | Workshop pages, plate-based vehicle identification, visits, operations, orders, catalogue | `reference/v12-routes.js` |
| V14 routes | route module | Registration-document photos; OCR endpoints retired (410 unless `IDAUTO_CG_OCR_ENABLED=1`) | `reference/v14-routes.js` |
| Console routes | route module | Admin read models: dashboard, vehicles, maintenance, organisations, sources, quality, audit, accounts | `reference/admin-routes.js` |
| Registration service | service | Validate and register a vehicle (plate required), duplicate check, owner contact, note | `workspace/registration-service.js` |
| Intervention service | service | Record / edit / cancel an intervention with its parts and two-value declared provenance | `workspace/intervention-service.js` |
| Vehicle details | service | Edit make, model, year, mileage, per-workshop note; delete = archive | `workspace/vehicle-details.js` |
| Owner contacts | service | Private, per-workshop owner contact; every read audited | `workspace/owner-contacts.js` |
| Workspace repository | read model | Dossier, lists, dashboard counts, global search, organisation scoping | `workspace/workspace-repository.js` |
| Document service | service | Store / list / delete carte grise photos (content-addressed), thumbnails | `documents/document-service.js` |
| Vehicle repository / resolver | repository / service | Plates, VIN facts, identification history, resolution | `vehicle/*.js` |
| Workshop repository | repository | Visits, operations, orders (V12) | `workshop/workshop-repository.js` |
| Writes + audit | data access | Every write paired with an `idauto_audit_log` row in one transaction (`withAudit`) | `reference/writes.js` |
| DB pool | data access | One `pg` pool, configured from `IDAUTO_DB_*` | `reference/db.js` |
| Media storage | data access | Content-addressed files under `IDAUTO_MEDIA_STORAGE_PATH` | `reference/storage.js`, `documents/document-storage.js` |
| Authentication | security | Better Auth (sign-in limited to 5 per minute per client), principal mapping, Bearer service identities, owner browser session | `auth/auth.js`, `auth/principal.js`, `identity.js`, `session.js` |
| Rate limiting | security | Per-identity windows for public resolution, search and registration | `reference/rate-limit.js` |
| Observability | cross-cutting | One JSON line per auth decision / event on stdout | `reference/observability.js` |
| i18n | presentation | French source, Arabic catalogue, server-side `lang`/`dir` | `i18n.js`, `i18n-serve.js`, `i18n-catalog-ar.js` |
| Account CLI | operator tool | Create, delete, set role, set password, revoke sessions | `ops/auth-users.js` |
| Off-host backup tool | operator tool | Stage, manifest, verify, push to an S3-compatible store, restore-verify | `ops/offhost-backup.js`, `ops/adapters/s3-compatible.js` |

**Background jobs.** The application starts **no scheduler, worker or timer**. The scheduled backup runs on the
production host as systemd timers installed from another repository (`othoth77/mythos-prod`, `ops/backup/`). Those
timers capture the `idauto_production` database and the media files, then call `ops/offhost-backup.js` (see
05-physical-architecture §2).

## 4. Roles and permissions (from `reference/auth/principal.js`)

| Principal | How it is obtained | Scopes | Data scope |
|---|---|---|---|
| Administrator | Web account with `role = 'admin'`, or a Bearer service identity mapped to admin | `*` (all) | every organisation |
| Manager | Web account with `role = 'manager'` and an `org_id` | 24 scopes: the technician's 17 plus `vin:search`, `fact:write`, `parts:write`, `stock:write`, `document:delete`, `team:read`, `vehicle:delete` | own organisation |
| Technician | Web account with `role = 'technician'` and an `org_id` | 17 scopes: `vehicle:read/write/search/resolve`, `plate:read`, `fact:read`, `observation:read/write`, `passport:read`, `identity:resolve`, `parts:read`, `workshop:read/write`, `document:read/write`, `owner:read/write` | own organisation |
| Organisation service client | Bearer token listed in `IDAUTO_ADMIN_IDENTITIES` with an `org_id` and explicit scopes | as configured | own organisation |
| Owner browser session | Signed cookie installed from the console (`/session/enroll`), when `IDAUTO_SESSION_SECRET` is set | two read routes only | — |
| Anonymous | none | `/public/*` only (IVID passport), sign-in, public pages | — |

**The authorisation rule** (`api.js`, after `authenticate()`):
- an organisation principal must hold the scope that `ALL_ROUTE_SCOPES` lists for the route;
- a route absent from that table is **admin-only**;
- organisation isolation is enforced again **in SQL** by every workspace query (`org_id = $n`).

## 5. Functional status

| Functionality | Status | Evidence |
|---|---|---|
| Sign-in, sign-out, change own password, sessions (Better Auth) | **Implemented** | `auth/auth.js`, `/api/auth/*`, tests `ida-v13-*` |
| Password reset | **Implemented as an operator step**: « Mot de passe oublié » shows a message, the operator runs `ops/auth-users.js set-password`; no e-mail | `login-ui.js`, `ops/auth-users.js` |
| Account creation / deletion | **Operator CLI only**; the web « Gestion des utilisateurs » page lists accounts read-only | `ops/auth-users.js`, `/api/admin/accounts` |
| Roles and permissions page | **Implemented** (read-only matrix from `principal.js`) | `/api/admin/roles` |
| French / Arabic, RTL | **Implemented** | `i18n*.js`, tests `ida-ui-browser` |
| Vehicle list, search, register (plate only required), view, edit | **Implemented** | `workspace-routes.js`, `registration-service.js`, `vehicle-details.js` |
| Vehicle delete | **Implemented as archive** (`fiche_status = 'archived'`, plates cancelled, VIN fact inactive); refused when an intervention exists | `vehicle-details.js remove()` |
| Owner contact (private, per workshop, audited) | **Implemented** | `owner-contacts.js` |
| Carte grise face 1 / face 2 photos | **Implemented** (private store, authenticated route, organisation check) | `v14-routes.js`, `document-service.js` |
| Carte grise OCR (automatic reading) | **Deprecated**: routes answer 410 unless `IDAUTO_CG_OCR_ENABLED=1`; UI removed | `v14-routes.js ocrRetired()` |
| Interventions with several parts and two-value provenance | **Implemented** | `intervention-service.js` |
| Parts list (filter by provenance, search) | **Implemented** | `listPartsUsed()` |
| Dashboard (5 real counts) | **Implemented** | `overview()` |
| Global search | **Implemented** | `/api/search` |
| Public passport by IVID | **Implemented** and enabled in production (host config `idauto.json`: `enabled` = true; IVID only, rate-limited). Public plate lookup is closed (404). | `api.js handlePublicPassportRoute` |
| Observation ingestion, facts, review queue decisions, vehicle merge / split | **Implemented** (API + operator console, out of the simplified menu) | `api.js` ROUTES, `admin-routes.js` |
| Legacy workshop page with in-browser plate OCR (`/atelier`) | **Implemented**, out of the simplified menu | `atelier.html`, `v12-routes.js` |
| Workshop orders and stock (`idauto_workshop_orders`, `idauto_org_stock`) | **Partial**: tables and repository functions exist, no page in the simplified application | `workshop-repository.js`, `local-parts-catalog.js` |
| TecDoc parts catalogue | **Partial / not configured**: adapter present, no `IDAUTO_TECDOC_*` variable on the production host | `parts/tecdoc-adapter.js` |
| Licensed plate / VIN → vehicle data provider | **Partial / not configured**: generic HTTPS adapter, disabled unless `IDAUTO_VEHICLE_PROVIDER_URL` is set. No `IDAUTO_VEHICLE_PROVIDER_*` variable exists on the production host, so resolution uses the local database only. | `vehicle/providers/http-vehicle-provider.js`, `vehicle/vehicle-resolver.js` |
| Camera / ANPR capture, vehicle movements, consent records, verifications, document scans, user roles table, observation locations, review-queue table | **Planned**: the tables exist in the schema (production too) but no code path reads or writes them | 06-data-model §« schema only » |
| Blockchain anchoring, provenance service, Mythos platform schemas (`mythos_core`, `atelier_network`, `fixpert`) | **Planned** (documents and READMEs only) | `src/*/README.md`, `docs/BLOCKCHAIN_ARCHITECTURE.md`, `docs/ARCHITECTURE.md` §2 |
| Piece.Autos / Casse.Autos integration, invoicing, stock management | **Not implemented** (excluded by the owner) | `docs/SIMPLIFICATION_2026-11.md` §6 |

## 6. External integrations

| Integration | Status | Direction |
|---|---|---|
| Better Auth | library inside the process (no external call) | — |
| S3-compatible off-host storage | used by the backup tool (operator / timer), not by the API | outbound HTTPS from the host |
| TecDoc | adapter only, not configured | (would be outbound HTTPS) |
| Licensed vehicle-data provider (plate / VIN lookup) | adapter only, not configured; no provider chosen | (would be outbound HTTPS, Bearer token from the environment) |
| Let's Encrypt | certificate issuance by Certbot on the host | outbound |
| E-mail, SMS, payment, analytics | **none** | — |

## 7. Differences with older documents

| Document | Statement | Reality on 2026-11-10 |
|---|---|---|
| `docs/ARCHITECTURE.md` (2026-08-11) | « no ID Auto API/UI service … is deployed » | the API runs on idauto.tn behind nginx since 2026-11 |
| `docs/ARCHITECTURE.md` §2 | target schemas `mythos_core`, `idauto`, `atelier_network`, `fixpert` | one database, 41 tables in `public` |
| `docs/ARCHITECTURE.md` §1 | Mythos OS provides auth, billing… | authentication is local (Better Auth); no billing |
| `config/idauto.example.json` `database.target_dbms_status` | « selected — not yet installed or deployed » | PostgreSQL is deployed, so that field is stale. The file's plate formats are still read. |

These documents are kept unchanged; this folder describes the implementation as it is.
