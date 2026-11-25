# 04 — Logical architecture

Source file: [`diagrams/logical-architecture.mmd`](diagrams/logical-architecture.mmd)

IDauto is a **layered monolith**: one Node.js process serves the pages, the static assets and the JSON API. There
is no web framework, no message broker, no cache server and no background worker.

## 1. Diagram — layers and request pipeline

```mermaid
---
title: IDauto — Logical architecture (as implemented)
---
flowchart TB
    subgraph PRES["Presentation layer — browser (static HTML + vanilla JS, no framework)"]
        direction LR
        APP["Workspace pages /atelier/*<br/>app-dashboard, app-vehicles, app-register,<br/>app-dossier, app-interventions, app-parts-used, app-account"]
        ADMINUI["Operator console /admin/*<br/>(out of the simplified menu, still served)"]
        CIT["Public pages / and /passport<br/>web/citizen"]
        SHELL["Shared shell and helpers<br/>admin-shell.js · admin-console.js<br/>i18n.js + i18n-catalog-ar.js · design system CSS"]
    end

    subgraph API["API layer — one Node.js http server (reference/api.js createServer)"]
        direction TB
        ASSETS["1 · Console assets /admin/* (serveAdminAsset, own CSP)<br/>i18n-serve.js sets lang/dir from the ida_lang cookie"]
        PGATE["2 · Page gate: /atelier/* pages need a session<br/>(else 302 /login)"]
        ASSETS2["3 · Workshop and public page assets<br/>serveAtelierAsset · serveCitizenAsset"]
        PUB["4 · /public/* — the only anonymous data route<br/>(passport by IVID, rate-limited)"]
        BA["5 · Better Auth routes /api/auth/*<br/>(sign-in, sign-out, session, change-password)"]
        OWN["6 · Owner browser session /session<br/>(signed cookie, two read routes)"]
        AUTHN["7 · authenticate(): Bearer service credential<br/>OR user session cookie + X-IDauto-Session header"]
        AUTHZ["8 · Authorisation gate: organisation principals need<br/>the route's scope (ALL_ROUTE_SCOPES); absent = admin-only"]
        ROUTES["9 · Route tables, first match wins<br/>workspace-routes · core ROUTES · v14-routes · v12-routes · admin-routes"]
        ASSETS --> PGATE --> ASSETS2 --> PUB --> BA --> OWN --> AUTHN --> AUTHZ --> ROUTES
    end

    subgraph BIZ["Business logic layer — modules (CommonJS, exported functions)"]
        direction LR
        WS["workspace/<br/>registration-service · intervention-service<br/>vehicle-details · owner-contacts · workspace-repository"]
        DOCS["documents/<br/>document-service · image-meta<br/>(registration-parser: retired OCR, 410)"]
        VEHM["vehicle/<br/>vehicle-resolver · plate-normalizer · vin"]
        WSH["workshop/<br/>workshop-vehicle-service"]
        PARTS["parts/<br/>parts-catalog · local-parts-catalog · tecdoc-adapter"]
        CORE["ingestion · passport-assembly · ivid-issuance<br/>public-surface-policy · rate-limit"]
        ADM["admin/admin-repository"]
        AUTHMOD["auth/auth.js (Better Auth) · auth/principal.js · identity.js · session.js"]
    end

    subgraph DATA["Data access layer"]
        direction LR
        REPO["Repositories<br/>vehicle-repository · workshop-repository · document-repository"]
        WRITES["writes.js<br/>withAudit(): write + audit row in one transaction"]
        DB["db.js — pg Pool (node-postgres)"]
        STO["storage.js · document-storage.js<br/>content-addressed media files"]
    end

    PGSQL[("PostgreSQL<br/>database idauto_production<br/>41 tables")]
    MEDIA[("Private media directory<br/>IDAUTO_MEDIA_STORAGE_PATH")]
    LOGS["observability.js<br/>JSON lines via console.log → stdout → journald"]
    TECDOC["TecDoc catalogue adapter<br/>NOT CONFIGURED (returns 'not configured')"]
    VPROV["Licensed vehicle-data provider adapter<br/>(plate / VIN lookup) NOT CONFIGURED"]

    APP -- "fetch /api/* + X-IDauto-Session: 1" --> ASSETS
    ADMINUI -- "fetch /api/*" --> ASSETS
    CIT -- "GET /public/passport/:ivid" --> ASSETS
    SHELL -.-> APP
    ROUTES --> WS
    ROUTES --> DOCS
    ROUTES --> VEHM
    ROUTES --> WSH
    ROUTES --> PARTS
    ROUTES --> CORE
    ROUTES --> ADM
    BA --> AUTHMOD
    AUTHN --> AUTHMOD
    WS --> REPO
    WS --> WRITES
    DOCS --> STO
    DOCS --> REPO
    VEHM --> REPO
    PARTS -.-> TECDOC
    PARTS --> DB
    VEHM -.-> VPROV
    WSH --> REPO
    CORE --> WRITES
    ADM --> DB
    AUTHMOD --> DB
    REPO --> DB
    WRITES --> DB
    DB --> PGSQL
    STO --> MEDIA
    API -.-> LOGS
```

**How to read the diagram.**
- The API layer is drawn **in the order a request crosses it**: the numbers 1 to 9 follow the order of the checks in
  `createServer()` (`reference/api.js`). The first step that answers ends the request.
- The business modules hold the rules (validation, organisation scoping, provenance values, archive instead of
  delete).
- Every write goes through `writes.withAudit()`, which wraps the change and its audit row in one transaction.
- Dotted arrows are optional or secondary paths:
  - the TecDoc and vehicle-data provider adapters, neither configured in production;
  - the logs;
  - the shared shell script loaded by every page.

## 2. Layers

| Layer | Contents | Rules it owns |
|---|---|---|
| Presentation | Static HTML pages built by `ops/ui/build-pages.py`; one script per page (`app-*.js`), the shared shell (`admin-shell.js`), console helpers, French / Arabic catalogue, design-system CSS | No business rule. Calls the API with `fetch` and the `X-IDauto-Session: 1` header. |
| API | `api.js` pipeline + route tables (`workspace-routes`, core `ROUTES`, `v14-routes`, `v12-routes`, `admin-routes`) | Body size, CSP and security headers, authentication, scope gate, rate limits, JSON errors |
| Business logic | `workspace/*`, `documents/*`, `vehicle/*`, `workshop/*`, `parts/*`, ingestion / passport / IVID modules, `admin/admin-repository` | Validation, organisation isolation, archive-only deletion, audit of sensitive reads (owner contact, VIN) |
| Data access | Repositories, `writes.js`, `db.js` (one `pg` pool), `storage.js` / `document-storage.js` | Transactions, audit rows, content-addressed file names |
| Data | PostgreSQL (41 tables, see 06-data-model), private media directory | Foreign keys, CHECKs, partial unique indexes |

## 3. Sequence — recording an intervention

This is the most complete write path of the simplified application. Every step below is in the code.

```mermaid
---
title: IDauto — POST /api/workspace/interventions (record a maintenance intervention)
---
sequenceDiagram
    autonumber
    actor T as Technician (browser)
    participant N as nginx (TLS)
    participant A as api.js pipeline
    participant BA as Better Auth
    participant R as workspace-routes
    participant S as intervention-service
    participant VR as vehicle-repository
    participant W as writes.withAudit
    participant P as PostgreSQL

    T->>N: POST /api/workspace/interventions<br/>cookie + X-IDauto-Session: 1, JSON body
    N->>A: proxy to 127.0.0.1:3001
    A->>BA: authenticate(): read the session cookie
    BA-->>A: user (role, org_id) → principal (principal.js)
    A->>A: scope gate: workshop:write required (ALL_ROUTE_SCOPES)
    alt scope missing
        A-->>T: 403 FORBIDDEN
    end
    A->>R: postIntervention(req)
    R->>S: create(body, actor)
    S->>S: validate(): date, odometer, description,<br/>parts with part_source in {our_shop, customer_supplied}
    S->>VR: findByRef(vehicle_ref)
    VR->>P: SELECT vehicle
    S->>W: withAudit(event workshop.intervention.record)
    W->>P: BEGIN
    W->>P: INSERT idauto_workshop_visits (org_id of the actor)
    W->>P: INSERT idauto_workshop_operations (one per part)
    W->>P: UPDATE vehicle odometer (only if higher)
    W->>P: INSERT idauto_audit_log
    W->>P: COMMIT (ROLLBACK on any error)
    W-->>S: id, vehicle IVID
    S-->>R: { id, vehicle }
    R-->>T: 201 JSON
```

**How to read the diagram.**
- A validation error (400), an unknown vehicle (404) or a missing organisation (403) stops the flow before the
  transaction starts.
- An error inside the transaction rolls back the visit, its operations and the audit row together.
- `withAudit` refuses to run without an authenticated identity (401). An unattributed write is therefore impossible.
- Source: `workspace-routes.js postIntervention`, `intervention-service.js create`, `writes.js withAudit`.

## 4. Security boundaries

| Boundary | Mechanism | Source |
|---|---|---|
| Internet → host | nginx terminates TLS. The Node process binds `127.0.0.1` only. | `api.js` `listen(port, '127.0.0.1')`; nginx site |
| Anonymous → data | Only `/public/passport/:ivid` (IVID only, rate-limited, switchable in config). Plate lookup is closed. | `api.js`, `public-surface-policy.js` |
| Pages | `/atelier/*` pages redirect to `/login` without a session. | `api.js` page gate |
| API | No session (or Bearer token) → 401. Cookie requests also need the `X-IDauto-Session: 1` header, which protects against cross-site requests. | `api.js authenticate()` |
| Role | Route scope from `ALL_ROUTE_SCOPES`. A route absent from it is admin-only. | `api.js`, `principal.js` |
| Organisation | `org_id = $n` in every workspace query; owner contacts and notes are private per workshop | `workspace/*.js` |
| Sensitive reads | Owner contact read and VIN disclosure each write an audit row | `owner-contacts.js`, `writes.recordVinDisclosureAudit` |
| Media | Photos served only through authenticated routes, after an organisation check. No public URL. | `v14-routes.js`, `document-service.image` |
| Browser | Content-Security-Policy per page family, `X-Content-Type-Options`, frame denial | `api.js` asset servers |
| Brute force | Sign-in and change-password: 5 per minute per client | `auth/auth.js` rate-limit rules |

## 5. Cross-cutting concerns

- **Audit.** `idauto_audit_log` gets one row per write, in the same transaction. Sensitive reads are audited too.
- **Logging.** `observability.js` writes one JSON line per event (auth decisions, errors) to stdout, and the
  systemd journal keeps it. There is no external log or metrics service.
- **Internationalisation.** Pages are written in French. `i18n-serve.js` sets `lang` / `dir` on the server from the
  `ida_lang` cookie; `i18n.js` translates in the browser from `i18n-catalog-ar.js`.
- **Configuration.**
  - Environment variables: `IDAUTO_DB_*`, `IDAUTO_MEDIA_STORAGE_PATH`, `IDAUTO_ADMIN_IDENTITIES`,
    `IDAUTO_AUTH_SECRET`, `IDAUTO_AUTH_BASE_URL`, `IDAUTO_SESSION_SECRET`, `IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH`.
  - Optional variables, **not set in production**: `IDAUTO_TECDOC_*`, `IDAUTO_VEHICLE_PROVIDER_*`,
    `IDAUTO_CG_OCR_ENABLED`, `IDAUTO_ALLOW_MOCK_PROVIDERS`.
  - Also read: `config/idauto.example.json` for plate formats. The public-resolution switch comes from the file named by
    `IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH`.
  - Only variable **names** are documented here.

## 6. Traceability

| Diagram element | Code |
|---|---|
| Steps 1 to 9 | `reference/api.js` `createServer()`: `serveAdminAsset`, page gate, `serveAtelierAsset`, `serveCitizenAsset`, `/public/`, `auth.handler`, `/session`, `authenticate()`, scope gate, `ALL_ROUTES` loop |
| Route order | `ALL_ROUTES = workspace.routes.concat(ROUTES, v14.routes, v12.routes, adminConsole.routes)` |
| workspace/ | `reference/workspace/*.js` |
| documents/ | `reference/documents/*.js` |
| vehicle/ | `reference/vehicle/*.js` |
| workshop/ | `reference/workshop/*.js` |
| parts/ | `reference/parts/*.js` (used by `v12-routes.js`) |
| Repositories | `vehicle/vehicle-repository.js`, `workshop/workshop-repository.js`, `documents/document-repository.js` |
| writes.js, db.js, storage.js | `reference/writes.js`, `reference/db.js`, `reference/storage.js`, `documents/document-storage.js` |
| TecDoc | `reference/parts/tecdoc-adapter.js` |
| Vehicle-data provider (not configured) | `reference/vehicle/providers/http-vehicle-provider.js` |
| Logs | `reference/observability.js` |

## 7. Uncertainties

- The operator console (`/admin/*`) is still served and reachable by administrators, although it has left the
  simplified menu. This document treats it as implemented. Whether it is meant to stay is a product decision,
  not an architecture fact.
