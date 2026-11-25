# 03 — Class diagram

Source files:
- Mermaid: [`diagrams/class-diagram.mmd`](diagrams/class-diagram.mmd)
- PlantUML: [`diagrams/class-diagram.puml`](diagrams/class-diagram.puml)

**What a "class" is here.** IDauto is written as CommonJS modules that export functions. It defines **no JavaScript
class, no ORM model and no TypeScript type** for its domain; rows travel as plain objects built from SQL results.
This document therefore gives two separate views, and does not mix them with the database tables:

- **View A — domain entities.** These are the conceptual classes the application reads and writes. Each one is
  backed by exactly one table, and §2 gives the mapping. Attribute names and types are copied from
  `database/schema.sql` and `database/migrations/*.sql`. Only attributes that the code uses are shown; the full
  column lists are in 06-data-model.
- **View B — service modules.** These are the code units and the functions they really export
  (`Object.keys(require(module))`).

## 1. View A — IDauto domain entities (used by the application)

```mermaid
---
title: IDauto — Class diagram (domain entities used by the application)
---
classDiagram
    direction LR

    class Organisation {
        <<entity>>
        +SERIAL id PK
        +VARCHAR name
        +VARCHAR org_type
        +VARCHAR status
        +INTEGER governorate_id FK
    }
    class UserAccount {
        <<entity>>
        +TEXT id PK
        +TEXT name
        +TEXT email
        +TEXT role
        +INTEGER org_id FK
    }
    class Credential {
        <<entity>>
        +TEXT id PK
        +TEXT userId FK
        +TEXT providerId
        +TEXT password (hash)
    }
    class Session {
        <<entity>>
        +TEXT id PK
        +TEXT userId FK
        +TIMESTAMPTZ expiresAt
    }
    class Role {
        <<enumeration>>
        admin
        manager
        technician
    }
    class Vehicle {
        <<entity>>
        +SERIAL id PK
        +VARCHAR ivid
        +VARCHAR make
        +VARCHAR model
        +INTEGER year
        +INTEGER odometer_km
        +DATE odometer_at
        +VARCHAR fiche_status
        +INTEGER merged_into_id FK
    }
    class Plate {
        <<entity>>
        +SERIAL id PK
        +VARCHAR plate_number
        +VARCHAR status
        +INTEGER vehicle_id FK
        +VARCHAR format_code FK
    }
    class VehicleFact {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER vehicle_id FK
        +VARCHAR fact_key
        +TEXT fact_value
        +BOOLEAN is_active
    }
    class IdentificationHistory {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER vehicle_id FK
        +INTEGER org_id FK
        +VARCHAR method
    }
    class RegistrationDocument {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER vehicle_id FK
        +INTEGER org_id FK
        +SMALLINT face
        +TEXT storage_key
        +VARCHAR sha256
    }
    class OwnerContact {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER vehicle_id FK
        +INTEGER org_id FK
        +VARCHAR full_name
        +VARCHAR phone
        +TIMESTAMPTZ superseded_at
    }
    class VehicleNote {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER vehicle_id FK
        +INTEGER org_id FK
        +VARCHAR notes
    }
    class Intervention {
        <<entity>>
        +BIGSERIAL id PK
        +INTEGER org_id FK
        +INTEGER vehicle_id FK
        +VARCHAR status
        +VARCHAR reason
        +DATE performed_on
        +INTEGER odometer_km
        +VARCHAR technician_ref
    }
    class Operation {
        <<entity>>
        +BIGSERIAL id PK
        +BIGINT visit_id FK
        +VARCHAR operation_type
        +BIGINT part_id FK
        +VARCHAR part_label
        +VARCHAR part_reference_text
        +INTEGER quantity
        +PartSource part_source
        +VARCHAR status
    }
    class PartSource {
        <<enumeration>>
        our_shop
        customer_supplied
        external_supplier (legacy)
    }
    class CataloguePart {
        <<entity>>
        +BIGSERIAL id PK
        +VARCHAR reference
        +VARCHAR brand
        +VARCHAR name
        +INTEGER org_id FK
    }
    class AuditEntry {
        <<entity>>
        +BIGSERIAL id PK
        +VARCHAR event_type
        +VARCHAR actor_ref
        +INTEGER org_id
        +VARCHAR target_ref
    }

    Organisation "0..1" <-- "0..*" UserAccount : org_id
    UserAccount "1" *-- "0..*" Credential : userId
    UserAccount "1" *-- "0..*" Session : userId
    UserAccount ..> Role : role
    Vehicle "0..1" <-- "0..*" Plate : vehicle_id
    Vehicle "1" *-- "0..*" VehicleFact : vehicle_id
    Vehicle "1" *-- "0..*" IdentificationHistory : vehicle_id
    Vehicle "1" *-- "0..*" RegistrationDocument : vehicle_id
    Vehicle "1" *-- "0..*" OwnerContact : vehicle_id
    Vehicle "1" *-- "0..*" VehicleNote : vehicle_id
    Vehicle "0..1" <-- "0..*" Vehicle : merged_into_id
    Vehicle "0..1" <-- "0..*" Intervention : vehicle_id
    Organisation "1" <-- "0..*" Intervention : org_id
    Organisation "0..1" <-- "0..*" RegistrationDocument : org_id
    Organisation "0..1" <-- "0..*" OwnerContact : org_id
    Organisation "0..1" <-- "0..*" VehicleNote : org_id
    Organisation "0..1" <-- "0..*" IdentificationHistory : org_id
    Intervention "1" *-- "0..*" Operation : visit_id
    CataloguePart "0..1" <-- "0..*" Operation : part_id
    Organisation "0..1" <-- "0..*" CataloguePart : org_id
    Operation ..> PartSource : part_source
```

**How to read the diagram:**

| Notation | Meaning |
|---|---|
| `*--` (composition) | The child row has a **NOT NULL** foreign key to the parent and has no meaning without it (contacts, notes, photos, facts, operations). |
| `<--` (association) | The foreign key is optional. The multiplicity on the parent side is `0..1` when the FK is nullable and `1` when it is NOT NULL. |
| `..>` to an «enumeration» | A CHECK-constrained column. `Role` is enforced by the CHECK `chk_auth_user_role` (migration `ida-v13-auth-session.sql`); `PartSource` by the CHECK on `part_source` (migration `ida-ui3-registration-maintenance.sql`). |

**Domain rules not visible as relationships:**
- **Vehicle deletion** archives the vehicle: `fiche_status = 'archived'`, its plates are cancelled and its VIN fact is
  deactivated. Nothing is physically deleted (`vehicle-details.js remove()`).
- **Only one active plate per plate number.** This is a partial unique index, `uidx_idauto_plates_number_active`.
- **Only one current owner contact per vehicle and workshop.** `uq_owner_contact_current` covers the rows where
  `superseded_at IS NULL`. A new contact supersedes the old one; the old one is kept.
- **One note per vehicle and workshop** (`uq_vehicle_notes_org`).
- **Cancelling an intervention** sets `status = 'cancelled'`. It is never a physical delete.
- **Part provenance.** `PartSource` has two values in the application: `our_shop` and `customer_supplied`.
  `external_supplier` is still accepted by the CHECK for older rows, but the application no longer offers it.
- **Every write is audited.** `AuditEntry` has no foreign key, on purpose: it records references (`actor_ref`,
  `target_ref`, `org_id`) as text and numbers so that the log survives deletions. Each row is written in the same
  transaction as the change it records (`writes.withAudit`).

## 2. Traceability — entity → table → code

| Entity | Table | Main code reading / writing it | Verified |
|---|---|---|---|
| Organisation | `idauto_organizations` | `intervention-service.orgOf`, `admin-repository`, `principal.js` (via `org_id`) | ✔ |
| UserAccount | `idauto_auth_user` | Better Auth (`auth/auth.js`), `ops/auth-users.js`, `workspace-repository.listTechnicians` | ✔ |
| Credential | `idauto_auth_account` | Better Auth (password hash, scrypt) | ✔ |
| Session | `idauto_auth_session` | Better Auth | ✔ |
| Vehicle | `idauto_vehicles` | `vehicle-repository`, `registration-service`, `vehicle-details`, `writes.createVehicle / mergeVehicle / splitVehicle` | ✔ |
| Plate | `idauto_plates` | `vehicle-repository.attachPlate / findByPlate`, `writes.createPlate` | ✔ |
| VehicleFact | `idauto_vehicle_facts` | `vehicle-repository.vinOf` (VIN is a fact), `writes.createFact / reviewFact` | ✔ |
| IdentificationHistory | `idauto_vehicle_identification_history` | `vehicle-repository.insertHistory / history` | ✔ |
| RegistrationDocument | `idauto_vehicle_documents` | `documents/document-repository`, `document-service.store / list / remove` | ✔ |
| OwnerContact | `idauto_vehicle_owner_contacts` | `owner-contacts.put / current / remove / search` | ✔ |
| VehicleNote | `idauto_vehicle_notes` | `vehicle-details.upsertNotesWith / notesOf` | ✔ |
| Intervention | `idauto_workshop_visits` | `intervention-service.create / update / cancel`, `workshop-repository.createVisit` | ✔ |
| Operation | `idauto_workshop_operations` | `intervention-service.insertParts`, `workshop-repository.addOperation` | ✔ |
| CataloguePart | `idauto_parts` | `parts/local-parts-catalog.js`, `workshop-repository` | ✔ |
| AuditEntry | `idauto_audit_log` | `writes.withAudit` and every `record*Audit` function | ✔ |

**Automatic check.** A script compared every attribute (name and SQL base type) with the parsed schema. It compared
every relationship with an enforced foreign key, and every parent-side multiplicity with the nullability of that
key. Result: **102 items checked, 0 differences** (see README §Validation).

**Left out of View A on purpose:**
- the 9 tables that no code path uses (planned);
- the observation / evidence / review tables, which are used by the machine API and the console;
- the reference tables (governorates, plate formats).

All of them are in 06-data-model, with their status.

## 3. View B — service modules (code units, real exports)

```mermaid
---
title: IDauto — Service modules and their exported functions
---
classDiagram
    direction TB
    class workspace_routes["workspace-routes.js"] {
        <<module>>
        routes
        scopes
    }
    class registration_service["registration-service.js"] {
        <<module>>
        validate(body)
        register(body, actor)
    }
    class intervention_service["intervention-service.js"] {
        <<module>>
        SOURCES
        validate(body)
        create(body, actor)
        update(id, body, actor)
        cancel(id, actor)
    }
    class vehicle_details["vehicle-details.js"] {
        <<module>>
        cleanNotes()
        notesOf()
        upsertNotesWith()
        inScope()
        update()
        remove()
    }
    class owner_contacts["owner-contacts.js"] {
        <<module>>
        validate()
        normalizePhone()
        current()
        upsertWith()
        put()
        remove()
        search()
        hasContact()
    }
    class workspace_repository["workspace-repository.js"] {
        <<module>>
        dossier()
        listVehicles()
        listDocuments()
        listInterventions()
        listPartsUsed()
        listTechnicians()
        overview()
        notifications()
        search()
        vehicleOr404()
    }
    class document_service["document-service.js"] {
        <<module>>
        store()
        setThumbnail()
        identify()
        list()
        image()
        remove()
        ocr() «retired»
        markConfirmed()
        compare()
        inspectImage()
    }
    class vehicle_repository["vehicle-repository.js"] {
        <<module>>
        findByRef()
        findByPlate()
        findByVin()
        insertIdentifiedVehicle()
        attachPlate()
        insertHistory()
        lockIdentifiers()
        vinOf()
        canonicalById()
        …12 more
    }
    class workshop_repository["workshop-repository.js"] {
        <<module>>
        PART_SOURCES
        createVisit()
        addOperation()
        closeVisit()
        createOrder()
        …8 more
    }
    class writes["writes.js"] {
        <<module>>
        withAudit()
        createVehicle()
        mergeVehicle()
        splitVehicle()
        recordVinDisclosureAudit()
        recordVinSearchAudit()
        …9 more
    }
    class db["db.js"] {
        <<module>>
        getPool()
        query()
        getClientForTransaction()
        closePool()
    }

    workspace_routes ..> registration_service
    workspace_routes ..> intervention_service
    workspace_routes ..> vehicle_details
    workspace_routes ..> owner_contacts
    workspace_routes ..> workspace_repository
    registration_service ..> owner_contacts
    registration_service ..> vehicle_details
    registration_service ..> vehicle_repository
    registration_service ..> writes
    intervention_service ..> vehicle_repository
    intervention_service ..> writes
    vehicle_details ..> vehicle_repository
    vehicle_details ..> writes
    owner_contacts ..> writes
    workspace_repository ..> owner_contacts
    workspace_repository ..> vehicle_details
    workspace_repository ..> vehicle_repository
    document_service ..> vehicle_repository
    vehicle_repository ..> writes
    workshop_repository ..> writes
    writes ..> db
```

**How to read the diagram.**
- Each box is a file, not an instantiable class. The members are the names the file exports.
- The dashed arrows are `require()` dependencies, all read from the source.
- Every module that touches the database also requires `db.js` directly. Those arrows are left out to keep the
  diagram readable; only `writes ..> db` is drawn.
- `document-service` stores files through `document-storage.js` and its metadata through `document-repository.js`.
- `intervention-service` writes the visit and operation tables with its own SQL, inside `writes.withAudit`. It does
  not call `workshop-repository`, which serves the older `/atelier` workshop page (V12).

## 4. Uncertainties

- **Roles.** `Role` is stored as `TEXT` in `idauto_auth_user.role` and constrained by `chk_auth_user_role`. Do not
  confuse it with `idauto_user_roles` (`chk_user_role`: owner / admin / member / readonly): that table is
  schema-only and no code uses it.
- **Better Auth columns.** Better Auth owns the columns of the three auth tables. Only the columns IDauto reads, plus
  the `role` and `org_id` columns that IDauto adds, are drawn.
