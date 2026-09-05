# Database

**Last updated:** 2026-09-05 (IDA-V12) · PostgreSQL 16 · base `database/schema.sql` (24 tables) + migrations in order.

## 1. Applying

Fresh database: `schema.sql`, then every file in `database/migrations/` in this order:
`ida-3a-ingestion-schema.sql` → `ida4-option-c-ivid.sql` → `ida-v4-verification-scope-separation.sql` → `ida-v8-identity-resolution.sql` → `ida-v9-organisation-scoped-access.sql` → `ida-v10-vehicle-search.sql` → `ida-v12-vehicle-identification.sql`.
Every migration is additive and idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); each ends with a commented DOWN block. `ida-v12` was applied twice in a row on the scratch database as proof (second run: NOTICEs only). Result: 33 `idauto_` tables.

Production: `idauto_production` in the `idauto-postgres` container. The older `idauto` database is test residue, not production. Live suites refuse any database whose name does not start with `idauto_scratch_`.

## 2. Vehicle data ≠ customer data

| Vehicle data (IDauto) | Customer data |
|---|---|
| `idauto_vehicles`, `idauto_plates`, `idauto_vehicle_facts` (VIN), `idauto_vehicle_identification_history` | lives in the **workshop's own system** (Fixpert etc.). IDauto holds `idauto_workshop_customer_refs.customer_ref` — an opaque identifier of that record, per organisation. |
| no owner column anywhere (asserted by `tests/ida-2a`) | no name / phone / address / email column in any `idauto_workshop_*` table (asserted by `tests/ida-v12`) |

## 3. The Vehicle model (IDA-V12)

`idauto_vehicles` (columns added by `ida-v12` in bold) → exposed as the Vehicle record by `reference/vehicle/vehicle-repository.js` `record()`:

| Order field | Column | Notes |
|---|---|---|
| id | `ivid` | public identifier; `internal_ref` also returned |
| plate / registration_type | `idauto_plates.plate_number` (active) | canonical `SSS TUN NNNN` / `SSS RS NNNN`; type derived by the normaliser |
| vin | `idauto_vehicle_facts` `fact_key='vin'` | a scoped **fact**, never a column; returned only to `vin:search` holders, disclosure audited |
| manufacturer / model / version | `make` / `model` / `variant` | |
| **motorisation**, **engine_code** | new | |
| year, **year_from**, **year_to** | | |
| **tecdoc_car_id** | new, partial index `idx_idauto_vehicles_tecdoc` | written only from a configured catalogue or a human who names it |
| source / source_timestamp / confidence / verified / verified_by / verified_at / verification_method | **identification_source**, **identification_source_at**, **identification_confidence**, **identification_verified**, **identification_verified_by**, **identification_verified_at**, **identification_method** | provenance of the CURRENT identification |
| created_at / updated_at | | |

Indexes: plate — `uidx_idauto_plates_number_active`, `idx_idauto_plates_nospace`; VIN — `idx_idauto_facts_vin_lookup`; tecdoc — `idx_idauto_vehicles_tecdoc`.

## 4. New tables (ida-v12)

| Table | Purpose | Key relations |
|---|---|---|
| `idauto_vehicle_identification_history` | technical history of an identification (`resolved` / `confirmed` / `edited` / `refreshed` / `rejected`), `previous` / `next` JSONB, actor, org | → vehicle |
| `idauto_parts` | CATALOGUE: what a part is (reference, brand, OE ref, category, name, optional `tecdoc_article_id`, `source`, `org_id` NULL = shared) | unique (reference_normalized, brand, org) |
| `idauto_part_compatibility` | what a part fits: `tecdoc_car_id` **or** `vehicle_id` **or** make/model/motorisation/years | → part, → vehicle |
| `idauto_org_stock` | STOCK: quantity, price (millimes), currency per organisation and part | unique (org, part) |
| `idauto_workshop_customer_refs` | opaque customer reference per organisation — **no PII** | unique (org, customer_ref) |
| `idauto_workshop_visits` | one arrival of one vehicle at one workshop; plate as read, method, confidence; status open → in_progress → closed / cancelled | → org, → vehicle (nullable until identified), → customer_ref |
| `idauto_workshop_operations` | diagnosis / replacement / service / repair / inspection / other, optional part + quantity, status | → visit, → part |
| `idauto_workshop_orders`, `idauto_workshop_order_lines` | parts order per organisation, optionally for a visit | → org, → visit, → part |

Many visits per vehicle; a visit may exist with no vehicle (camera failed) and be identified later.

## 5. Audit

Every write goes through `writes.withAudit()` (one transaction: rows + `idauto_audit_log`). New event types: `vehicle.identify.create|confirmed|edited|refreshed`, `vehicle.vin.read`, `part.create`, `part.compatibility.create`, `stock.set`, `workshop.visit.create|vehicle|close|cancel`, `workshop.operation.create|status`, `workshop.order.create|status`. `idauto_audit_log` is append-only; never delete from it.
