# Database

**Last updated:** 2026-09-05 (IDA-V12) · PostgreSQL 16 · base `database/schema.sql` (24 tables) + migrations in order.

## 1. Applying

**Since 2026-11-25 (IDA-G9) the order is `database/migrations/MANIFEST`** — `schema.sql`, then every file of
`database/migrations/`, one line each, with a read-only probe per line. It is the only list: `npm run migrate`
(`scripts/migrate.js`) applies it, `.github/workflows/database.yml` builds the CI database with it, and
`tests/ida-migration-manifest-test.js` fails when a file on disk is missing from it. The list that used to stand
here stopped at `ida-ui4` and was already incomplete. A new migration is APPENDED to the manifest (with a probe);
a line a database has applied is never edited or moved.

Fresh database: `npm run migrate` (reads `IDAUTO_DB_*`, like the application). Each pending file runs in its own
transaction together with its row in `idauto_schema_migrations` (`file`, `sha256`, `method`, `applied_at`,
`applied_by`). The runner refuses to run when an applied file was edited since (sha256 differs), when the record
names a file the manifest no longer lists, or when a pending line sits before an applied one. It writes to a
database not named `idauto_scratch_*` only with `--confirm-database=<that name>` (the wrong-database incident of
`docs/DEPLOYMENT.md` §8). `npm run migrate -- --dry-run` lists each file as `applied` / `baseline` / `pending` /
`CHANGED` and writes nothing; add `--check` to exit 1 unless the database is at the head.

### 1a. A database migrated by hand (every database built before the runner)

Its schema is there but nothing records it. A plain `npm run migrate` sees that (the `schema.sql` probe holds,
the record is empty), **refuses and writes nothing** — it never re-runs `schema.sql` or a migration over existing
data. To adopt it:

1. `npm run migrate -- --dry-run` — every line `pending`, each with `probe: present|absent`.
2. `npm run migrate -- --baseline --dry-run` — what would be recorded.
3. `npm run migrate -- --baseline [--confirm-database=<name>]` — records, with method `baseline` and today's
   sha256, every manifest line whose probe holds, **without running any of them**. Refused when the database
   already records migrations, when even `schema.sql` is absent (that is a fresh database: plain run), and when an
   absent line precedes a present one (the database was built in another order — a person must look at it).
4. Lines after the adopted prefix stay `pending`; `npm run migrate` applies them.

A probe is a fixed catalogue check (`table`, `column`, `index`, `constraint [has …]`, `nullable`), never SQL taken
from the manifest. It checks what its file creates last, so a half-applied file reads as absent. The runner itself
issues no DROP, TRUNCATE or DELETE; it never restarts the application. Running it against `idauto_production` is
the owner's action — take the backup of `docs/DEPLOYMENT.md` first, and mind the deploy-order hazard of §9 there
(`ida-v13b` before the new code starts: run the runner before the restart).

**IDA-UI-3 (2026-11-05)** — `idauto_vehicle_owner_contacts` (the owner's private contact, per organisation, superseded not edited — `docs/PRIVACY_ARCHITECTURE.md` §1a); `idauto_workshop_operations` gains `part_source` (our_shop / customer_supplied / external_supplier), `part_condition` (new / used), `part_label`, `part_reference_text`, `performed_on`, `notes`; `identification_method` accepts `manual_registration`. Additive, idempotent, DOWN block inside.
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
