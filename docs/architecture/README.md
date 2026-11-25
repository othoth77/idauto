# IDauto — UML and system architecture

This folder describes **IDauto as it is implemented**:
- the code on `main` at `9a0f5b1`;
- the version running on idauto.tn since 2026-11-09;
- the production and staging hosts, checked read-only on 2026-11-10.

It documents the system only. Nothing in the application or in its configuration was changed to write it.

## Contents

| # | Document | Diagrams |
|---|---|---|
| 01 | [Project audit](01-project-audit.md): structure, stack, components, roles, status of each functionality, integrations, differences with older documents | — |
| 02 | [Use case diagram](02-use-case.md): actors, use cases, use case → route → scope table | [`use-case.mmd`](diagrams/use-case.mmd), [`use-case.puml`](diagrams/use-case.puml) |
| 03 | [Class diagram](03-class-diagram.md): domain entities (with the table behind each one) and service modules | [`class-diagram.mmd`](diagrams/class-diagram.mmd), [`class-diagram.puml`](diagrams/class-diagram.puml) |
| 04 | [Logical architecture](04-logical-architecture.md): layers, request pipeline, a sequence diagram, security boundaries | [`logical-architecture.mmd`](diagrams/logical-architecture.mmd) |
| 05 | [Physical architecture](05-physical-architecture.md): production, staging, local and CI nodes | [`physical-architecture.mmd`](diagrams/physical-architecture.mmd) |
| 06 | [Data model](06-data-model.md): all 41 tables, keys, foreign keys, status (generated from the SQL) | [`er-identity.mmd`](diagrams/er-identity.mmd), [`er-vehicle.mmd`](diagrams/er-vehicle.mmd), [`er-workshop.mmd`](diagrams/er-workshop.mmd), [`er-capture.mmd`](diagrams/er-capture.mmd), [`er-crosscut.mmd`](diagrams/er-crosscut.mmd) |

## Summary

**One sentence.** IDauto is a single Node.js 22 process without a web framework. It uses Better Auth for accounts and
PostgreSQL 15 for data, and serves static French / Arabic pages and a JSON API behind nginx on one OVH VPS.

**Shape of the system:**
- a layered monolith;
- no background worker, no message queue, no cache, no external service called at runtime;
- every write is paired with an audit row in the same transaction;
- three web roles (technician ⊂ manager ⊂ administrator), each limited to its own organisation in SQL.

## Status legend

Every document uses the same four words:

| Status | Meaning |
|---|---|
| **Implemented** | The code exists, a route or page reaches it, and it runs in production. |
| **Partial** | Some code or tables exist, but no page uses them or they are not configured in production. |
| **Planned** | Only documents, READMEs or empty tables exist; no code path. |
| **Deprecated** | The code is still present but switched off (for example, carte grise OCR answers 410). |

Planned functionality is never drawn as implemented. The use case, class and logical diagrams show implemented
elements only. The few partial elements that appear are labelled « NOT CONFIGURED ».

## Reading and rendering the diagrams

- **Mermaid** (`.mmd`, and the `mermaid` blocks inside the documents). GitHub renders these blocks directly in the
  documents. The standalone `.mmd` files also open in the Mermaid live editor and in IDE previews. Each embedded block
  is a copy of its `.mmd` file.
- **PlantUML** (`.puml`). Use any PlantUML renderer, for example `java -jar plantuml.jar diagrams/*.puml`.
  The use case and class diagrams exist in PlantUML too, because Mermaid has no native use-case notation.
- **Tables are not classes.** The 41 PostgreSQL tables are described in 06. The class diagram (03) shows the
  15 domain entities the application handles, and for each one it names the single table behind it. The code has no
  ORM classes.

## Consolidated traceability

| Element | Where it is verified |
|---|---|
| Roles and scopes (technician 17, manager 24, administrator `*`) | `reference/auth/principal.js` |
| Authentication: Better Auth, Bearer identities, owner session | `reference/auth/auth.js`, `reference/identity.js`, `reference/session.js` |
| Request pipeline order | `reference/api.js` `createServer()` |
| Route → scope (141 route and scope entries extracted) | `ALL_ROUTE_SCOPES` in `api.js`, `workspace-routes.js`, `v14-routes.js`, `v12-routes.js`; `admin-routes.js` (admin-only) |
| Domain entities, attributes, relationships | `database/schema.sql`, `database/migrations/*.sql`, and the code listed in 03 §2 |
| Service modules and their functions | `Object.keys(require(module))` for each module in 03 §3 |
| Table status (used / schema only) | code search in `reference/` and `ops/` for each table name (06) |
| Production versions, ports, services, database | read-only commands on the production host (05 §6) |
| Production table set = repository table set | `information_schema.tables` of `idauto_production` compared with the schema: 41 = 41, no difference |
| Optional integrations not configured | variable names counted in the production environment: `IDAUTO_TECDOC_*` 0, `IDAUTO_VEHICLE_PROVIDER_*` 0, `IDAUTO_CG_OCR_ENABLED` 0 (values never read) |

## Validation

| Check | Result |
|---|---|
| Class diagram against the SQL: every attribute name and base type, every relation against an enforced foreign key, every multiplicity against the key's nullability | **102 items, 0 differences** |
| Structural lint of all Mermaid and PlantUML sources: title present, `subgraph` / `end` balanced, every edge endpoint and related class declared, no duplicate ids, YAML-safe titles. It also checks that the PlantUML use case and class diagrams have the same use cases, actor links, include / extend and relations as their Mermaid versions. | **22 sources, 0 problems** |
| Data model generated from the SQL; every table assigned to exactly one diagram group | 41 / 41 |
| Production database table set | 41, identical to the repository |
| Mermaid rendering by GitHub | every document was opened on GitHub (PR branch) in a browser. All 11 embedded diagrams render. One ER diagram failed at first, because its YAML title contained « : »; titles are now quoted, and the lint checks for this. |
| PlantUML rendering | **not checked with the PlantUML tool.** No PlantUML jar was available, and downloading one was not permitted in this environment. The syntax was checked by the lint above only. |
| Sensitive data scan of this folder: IP addresses, private host names, home paths, connection strings, key and token patterns | clean |

## Missing information and assumptions

- **Off-host backup provider.** It is configured on the production host and was not read. The documents only say
  "S3-compatible".
- **Backup schedule.** It is owned by another repository (`othoth77/mythos-prod`) and can change independently.
- **Operator console (`/admin/*`).** It is still served, although it is out of the simplified menu. It is treated as
  implemented.
- **Staging and production PostgreSQL versions.** Staging runs 16.9 and production 15.18. Compatibility of each
  migration with 15 was not separately checked.
- **`docs/ARCHITECTURE.md` (2026-08).** It describes a target platform and says that no API is deployed. It is kept
  unchanged; 01 §7 lists where it differs from today's system.
