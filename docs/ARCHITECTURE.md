# ID Auto — Architecture

**Stage:** IDA-1 Product Vision, Capture, Access and Data Governance Specification
**Last updated:** 2026-08-11 (IDA-2 Phase B deep audit)
**Domain:** idauto.tn
**Platform:** standalone open protocol · remains interoperable with the Mythos ecosystem (optional integration)
**Repository:** othoth77/idauto  
**Provenance:** migrated 2026-08-18 from `othoth77/mythos-prod` (`projects/idauto/`, `docs/IDAUTO_*.md`) — see [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md). Content below is the migrated baseline, unchanged except for path and repository references.

---

## 1. Product Position

ID Auto is a vehicle intelligence platform within the Mythos ecosystem. It is a **distinct product domain**, not an isolated platform. Mythos OS provides shared platform services (authentication, billing, audit, notifications, search, document storage) that ID Auto consumes through defined integration contracts.

ID Auto data lives in a logically separate `idauto` schema in the target PostgreSQL cluster. Mythos OS data lives in `mythos_core`. Atelier Network platform data lives in `atelier_network`. Fixpert workshop data lives in `fixpert` (external system, not created by this repository). Cross-schema data exchange is only permitted through explicitly defined integration contracts; no ad-hoc cross-schema joins are permitted from application code.

The previous IDA-0 framing of ID Auto as an "entirely independent platform" is superseded. ID Auto is integrated into the Mythos ecosystem at the service level, not at the data level.

---

## 2. Target Database Architecture

**Target DBMS: PostgreSQL** — selected as the target database system for ID Auto and the broader Mythos platform evolution.

**Current status:** PostgreSQL is live in the private, loopback-bound `idauto-postgres` container and the 22-table source schema has been applied and verified. Local content-addressed media storage is live at the deployment's configured media root (`IDAUTO_MEDIA_STORAGE_PATH`). The repository's API and admin UIs remain reference implementations only: no ID Auto API/UI service, container, systemd unit, public listener, or public endpoint is deployed.

```
PostgreSQL cluster (`idauto-postgres` live; other schemas remain target contracts)
├── mythos_core schema
│   └── users, global roles, permissions, global audit, platform administration
│
├── idauto schema
│   └── vehicles, plates, observations, facts, evidence, documents, captures,
│       sources, review queue, organisations, user roles, service events,
│       verifications, consent records, audit log, contributor records,
│       camera sources, vehicle movements
│
├── atelier_network schema
│   └── workshop registry, inspection providers, work orders, repair estimates,
│       AutoCheck reports, Smart Gate device registry (DRAFT — not deployed)
│
└── fixpert schema (external — not created by this repository)
    └── clients, workshop visits, work orders, interventions, parts, stock,
        quotations, invoices, payments, workshop activity
        (Fixpert-owned; first pilot of Atelier Network; referenced by idauto via vehicle_id only)
```

---

## 3. Founding Architecture Decisions

### AD-1 — Logical schema separation, not physical isolation

**Decision (revised from IDA-0):** All ID Auto tables use the `idauto` schema in a PostgreSQL cluster. Atelier Network platform tables use `atelier_network`. Fixpert workshop tables use `fixpert` (external, not created here). Mythos platform tables use `mythos_core`. These schemas are logically separated; physical separation (separate databases or clusters) is an operational decision for IDA-2.

**Why:** Mythos OS holds live production data for paying clients. ID Auto is a new product domain. Fixpert is a separate business domain and the first Atelier Network pilot. Mixing schemas would create migration risk and compliance ambiguity; physical isolation is a deployment concern, not a design constraint at this stage.

**Constraint:** Application code must never perform cross-schema joins except through defined integration contracts.

---

### AD-2 — Privacy-by-design: public search never returns owner PII

**Decision (unchanged from IDA-0):** The public plate search endpoint returns only vehicle attributes. Owner identity is never returned and is not stored in any table queryable by plate number.

**Why:** Tunisian organic law 63-2004 on personal data protection, and reasonable expectation of privacy for vehicle owners, prohibit exposing owner identity through a public lookup service.

**Enforcement:**
- `idauto_vehicles` has no owner columns — absence is explicit with `-- [NO PII]` comments.
- `idauto_plates` has no owner columns.
- `idauto_vehicle_facts` has no owner columns.
- Carte grise owner PII (name, CIN, address) is never stored in any `idauto_` table.
- `config/idauto.example.json` `public_field_policy.never_public` lists all prohibited fields.

---

### AD-3 — Plate formats as configurable rules, not hardcode

**Decision (unchanged from IDA-0):** Tunisian plate format patterns are defined in `config/idauto.example.json` and seeded into `idauto_plate_formats`. No format regex is hardcoded.

**Clarification (IDA-1):** Current plate format patterns in the configuration and database seed are **UNVERIFIED DRAFTS**. The `idauto_plate_formats.verified` column defaults to `FALSE`. Formats must be confirmed against an authoritative official source before being marked `verified = TRUE`. Do not present unverified format rules as official facts.

---

### AD-4 — Immutable audit log

**Decision (unchanged from IDA-0):** `idauto_audit_log` is append-only. Rows are never updated or deleted. Corrections are new rows. No raw PII is stored in any column of this table.

**Extension (IDA-1):** Mythos Super Admin access to Fixpert data is also audit-logged in `idauto_audit_log` with `actor_type = 'admin'` and `target_type = 'fixpert.*'`.

---

### AD-5 — Hashed identifiers for IP and User-Agent

**Decision (unchanged from IDA-0):** `idauto_verifications`, `idauto_observations`, `idauto_audit_log` and related tables store IP addresses and User-Agent strings as SHA-256 hashes only.

---

### AD-6 — Professional service events are org-scoped by default

**Decision (unchanged from IDA-0):** `idauto_service_events.is_public` defaults to `FALSE`. A service event is visible only to the writing organisation unless explicitly set public.

---

### AD-7 — No real data ingestion in IDA-0 or IDA-1

**Decision (unchanged from IDA-0):** No real vehicle, plate, or person data is ingested, scraped, or imported until the legal basis and data-processing agreements defined in IDA-1 are reviewed.

**Note (IDA-1):** IDA-1 itself does not complete the legal review. The legal items identified in `docs/PRODUCT_SPEC.md` under LEGAL-REVIEW-REQUIRED remain open. Real data ingestion does not begin before IDA-2 with legal items resolved.

---

### AD-8 — Observation-first data model

**Decision (new in IDA-1):** Every data input (scan, upload, manual entry, Smart Gate detection) creates an `idauto_observations` record first. Vehicle fiches and facts are derived from observations, not created directly. Observations are immutable after creation.

**Why:** A flat direct-insert model loses provenance information. The observation-first model makes every fact traceable to its source event, enables conflict detection, and supports the review queue without ambiguity.

**Enforcement:** Application code must create an `idauto_observations` row before creating or updating vehicle facts. Facts reference their observation via `observation_id`.

---

### AD-9 — Three access scopes replace public/private boolean

**Decision (new in IDA-1):** Data fields and tables carry an `access_scope` value: `public`, `professional`, or `mythos_private`. This replaces the IDA-0 design that used a boolean `is_public` flag. *(Corrected 2026-08-10, IDA-2A-CORRECTION-0: this decision was originally recorded and implemented in `schema.sql` as `visibility_scope` — renamed to `access_scope` to resolve R-T03, the tracked cross-product naming divergence with AutoValeur; see `docs/AUTOMOTIVE_ARCHITECTURE.md`'s canonical naming decision and `docs/AUTOMOTIVE_RISK_REGISTER.md`.)*

**Why:** The boolean model was insufficient to represent the Mythos Super Admin tier, which needs access to raw captures, exact locations, and movement events that professional subscribers must not see.

**Enforcement:** API response builders must filter fields by the caller's scope. The `mythos_private` scope requires `MYTHOS_SUPER_ADMIN` role and generates an audit log entry on every access.

---

### AD-10 — Smart Gate is MYTHOS_PRIVATE by design

**Decision (new in IDA-1):** All vehicle movement events from the Fixpert Smart Gate (entry/exit events, timestamps, direction, camera source, image references) are stored in `idauto_vehicle_movements` with `MYTHOS_PRIVATE` scope. They are never returned in public or professional API responses.

**Why:** Individual vehicle movement tracking through a camera is sensitive even when the vehicle is not directly linked to an identifiable person. Aggregate spatial analytics are permitted if they cannot identify individuals.

---

## 4. Integration Contracts with Mythos OS Services

All integrations are **disabled** in IDA-0 and IDA-1. They activate in IDA-2 and later.

### 4.1 Authentication (`mythos_auth`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto professional user login, contributor account, admin login |
| Provider | Mythos OS auth service |
| Protocol | Token-based (JWT or opaque ref); protocol defined in IDA-1 spec, implemented IDA-2 |
| ID Auto stores | `idauto_user_roles.mythos_user_id` — opaque reference only |
| ID Auto does NOT store | Username, email, phone, password hash |
| Activation | IDA-2 |

### 4.2 Permissions (`mythos_permissions`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto feature gates (which scope can call which endpoint) |
| Provider | Mythos OS permission service |
| Protocol | Permission check call with `(user_id, resource, action)` |
| Activation | IDA-2 |

### 4.3 Documents (`mythos_documents`)

| Contract point | Detail |
|---|---|
| Consumer | Professional subscribers attaching documents to service events; Fixpert carte grise protected storage |
| Provider | Mythos OS document storage |
| Protocol | Document reference stored as `source_ref` in `idauto_service_events`; actual file stored by Mythos OS |
| Privacy | Document must never contain owner PII visible to other orgs |
| Activation | IDA-4 |

### 4.4 Notifications (`mythos_notifications`)

| Contract point | Detail |
|---|---|
| Consumer | Subscription renewal reminders, Smart Gate alerts, review queue alerts |
| Provider | Mythos OS notification service |
| Protocol | Event-push: `{type, recipient_ref, payload}` |
| Activation | IDA-3 |

### 4.5 Billing (`mythos_billing`)

| Contract point | Detail |
|---|---|
| Consumer | Professional subscription payment and renewal |
| Provider | Mythos OS billing service |
| Protocol | Subscription record keyed by `org_id`; billing events update `idauto_organizations.status` |
| Activation | IDA-3 |

### 4.6 Search (`mythos_search`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto plate and vehicle data indexed for MythosSearch |
| Provider | MythosSearch provider registration pattern |
| Protocol | Register provider with `{name: 'idauto', search: fn}` |
| Privacy | Search index must never include owner PII or movement data |
| Activation | IDA-4 |

### 4.7 Audit (`mythos_audit`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto publishes high-level events to Mythos OS audit stream |
| Provider | Mythos OS audit service |
| Protocol | Event push; `idauto_audit_log` is the authoritative local record |
| Activation | IDA-2 |

---

## 5. Data Flow — Public Plate Search

```
Caller (anonymous or authenticated)
  │
  ▼
Rate-limit check (by IP hash)
  │  fail → 429; INSERT idauto_verifications(result_status='rate_limited')
  │  pass ↓
Format validation (idauto_plate_formats)
  │  no match → 400; INSERT idauto_verifications(result_status='invalid_format')
  │  match ↓
Plate lookup (idauto_plates JOIN idauto_vehicles)
  │  not found → 404; INSERT idauto_verifications(result_status='not_found')
  │  found ↓
Scope filter — apply public_field_policy
  │  remove: never_public fields
  │  remove: below-confidence fields
  │  remove: unverified facts below public threshold
  │
  ▼
Public JSON response
  {plate_number, format_code, governorate, fiche_status, colour, body_type,
   make (if verified), model (if verified), year (if trusted source), …}
  │
  ▼
INSERT idauto_verifications(result_status='found', vehicle_id, ip_hash, …)
INSERT idauto_audit_log(event_type='plate.lookup', …)
```

Owner PII is not in the data path. No owner table exists. No join to owner data is possible.

---

## 6. Data Flow — Capture and Observation

```
Input (scan / upload / Smart Gate / manual)
  │
  ▼
Quality check
  │  fail → error response with guidance
  │  pass ↓
CREATE idauto_observations (immutable)
  │
  ▼
Processing pipeline
(OCR / detection / extraction — IDA-3+)
  │
  ▼
User confirmation (for public submissions)
  │
  ▼
Vehicle matching
  │  match → add observation to fiche, extract facts, compare
  │  no match → create vehicle fiche, first observation
  │
  ▼
Confidence check
  │  above threshold → accept, update fiche
  │  below threshold → INSERT idauto_review_queue
  │
  ▼
INSERT idauto_audit_log
```

---

## 7. Data Flow — Smart Gate (Fixpert First Pilot; Generalises to Any Atelier Network Workshop)

```
RTSP stream (single authorised entrance/exit camera)
  │
  ▼
Vehicle event detected
  │
  ▼
Frame capture → object storage (MYTHOS_PRIVATE)
  │
  ▼
ANPR → plate candidate → normalise
  │
  ▼
Colour + category detection
  │
  ▼
Deduplication check (same vehicle near door?)
  │  duplicate → discard
  │  new event ↓
Direction inference (entry / exit / unknown)
  │
  ▼
CREATE idauto_observations(capture_method='smart_gate')
CREATE idauto_vehicle_movements (MYTHOS_PRIVATE)
  │
  ▼
Vehicle matching
  │  match → link to existing fiche
  │  no match → create preliminary fiche
  │
  ▼
Optional: link to workshop work order (via Atelier Network atn_work_orders)
  │
  ▼
INSERT idauto_audit_log
```

Smart Gate movements are **never** published publicly or professionally.

---

## 8. Deployment Separation

IDA-2B deployed the private PostgreSQL service and IDA-2F created the local media directory. The API and admin UIs remain undeployed reference implementations; there is no public ID Auto service.

**Permanent constraints:**
- Do not touch `/var/www/uthinachess/0726/Prod/` — Mythos OS production
- Do not restart nginx or PHP on the Mythos OS VPS
- Do not deploy ID Auto files to any server before IDA-2 with explicit authorisation
- Do not ingest real vehicle, plate, or person data before IDA-1 legal review is complete
- Do not install PostgreSQL before IDA-2 with explicit authorisation
- Do not connect any camera before IDA-4 with legal regulatory approval

---

## 9. Technology Decisions — Status

| Decision | IDA-0 status | IDA-1 status |
|---|---|---|
| Target DBMS | Deferred | **PostgreSQL — selected** (not deployed) |
| API framework | Deferred | Deferred to IDA-2 |
| Hosting model | Deferred | Deferred to IDA-2 |
| TLS for idauto.tn | Deferred | Deferred to IDA-2 |
| CDN / DDoS protection | Deferred | Deferred to IDA-2 |
| Backup / recovery | Deferred | Deferred to IDA-2 |
| ANPR model | Deferred | Deferred to IDA-3 |
| OCR engine | Deferred | Deferred to IDA-3 |
| Object storage provider | Deferred | Deferred to IDA-2 |


---

## 10. Identification, catalogue and workshop layer (IDA-V12, 2026-09-05)

```
CAMERA ─► ANPR (plate-scanner.js) ─► PLATE NORMALISATION (vehicle/plate-normalizer.js)
      ─► VEHICLE IDENTIFICATION (vehicle/vehicle-resolver.js: cache → local → providers → manual)
      ─► VEHICLE RECORD (vehicle/vehicle-repository.js, provenance + history)
      ─► PART CATALOGUE (parts/parts-catalog.js = local catalogue + parts/tecdoc-adapter.js)
      ─► PARTS (idauto_parts / idauto_part_compatibility; stock in idauto_org_stock)
      ─► ATELIER WORKFLOW (workshop/workshop-vehicle-service.js → visits, operations, orders)
```

| Interface | Module | Implementations |
|---|---|---|
| `PlateRecognizer` | `web/citizen/plate-scanner.js` (browser) + `reference/vehicle/plate-normalizer.js` (server) | Tesseract.js vendored; normaliser pure |
| `VehicleResolver` | `reference/vehicle/vehicle-resolver.js` | one; providers pluggable |
| provider contract | `reference/vehicle/providers/` | `LocalVehicleResolver` (always), `HttpVehicleProvider` (licensed, disabled unless configured), `MockVehicleResolver` (tests) |
| `VehicleRepository` | `reference/vehicle/vehicle-repository.js` | PostgreSQL |
| `PartsCatalog` | `reference/parts/parts-catalog.js` | local + supplier merge |
| `TecDocAdapter` | `reference/parts/tecdoc-adapter.js` | generic gateway (not configured), `MockTecDocProvider` (tests) |
| `WorkshopVehicleService` | `reference/workshop/workshop-vehicle-service.js` | over `workshop-repository.js` |
| routes | `reference/v12-routes.js` | mounted by `api.js` behind the same auth and scope gate |

Rules: the frontend talks to `/api/*` only and never to a provider; truth is written only by `confirm()`; mocks never enter the default production path; catalogue and stock are separate tables; vehicle identity and customer identity never share a table (opaque `customer_ref`). Details: `VEHICLE_RESOLUTION.md`, `TECDOC.md`, `ANPR.md`, `DATABASE.md`, `API.md`.
