# IDauto — database inventory

> Read-only audit of the running systems, 2026-11-19 (UTC). Every value below was read from a live process, container, catalogue or file listing on that date unless it is marked **UNVERIFIED**. No password, token or connection string is reproduced: only variable *names* and non-secret values (host, port, database name, paths).

## 1. Every database IDauto uses or holds

| # | Database | Machine | Engine | Port | Service / container | Data directory | Connected application(s) | Environment | Tables | Vehicles / documents | Size |
|---|---|---|---|---|---|---|---|---|---:|---|---:|
| 1 | **`idauto_production`** | VPS (`vps-4722f0a9`) | PostgreSQL **15.18** (Alpine image `postgres:15-alpine`) | 5432, bound to **127.0.0.1** only | Docker container `idauto-postgres` (compose project in `/home/deploy/deployments/idauto-postgres/`) | Docker volume `idauto-postgres-data` → `/var/lib/docker/volumes/idauto-postgres-data/_data` (293 MB for the whole cluster) on `/dev/sda1` ext4 | `idauto-api.service` (user unit of `deploy`), `mythos-backup-capture` (root, `pg_dump` in-container) | **Production** (idauto.tn) | 45 | 9 / 6 | 12 MB |
| 2 | `idauto` | VPS, same container | PostgreSQL 15.18 | 5432 (same server) | `idauto-postgres` | same volume | **none found** — no running unit or env file points at it | Legacy pre-ship development database | 61 (40 `idauto_*` + 20 `pi_*` + `schema_migrations`) | 0 / 0 (every table empty) | 13 MB |
| 3 | `idauto_scratch_cg2_staging` | Haddad | PostgreSQL **16.9** (user-built binary in `~/.local/share/idauto-staging/pg/`) | 55440, 127.0.0.1 only | `idauto-staging-db.service` (user unit of the Haddad service user) | `~/.local/share/idauto-staging/pgdata` (100 MB cluster) on `/dev/mapper/ubuntu--vg-ubuntu--lv` | `idauto-staging-api.service` (**inactive**), API port 8805 | Staging (carte grise V2 acceptance) | 42 | 3 / 0 | 10 MB |
| 4 | `idauto_scratch_ui_preview` | Haddad | PostgreSQL 16.9 | 55440 (same cluster) | `idauto-staging-db.service` | same `pgdata` | `idauto-preview-api.service` (**inactive**, disabled), API port 8805, served on tailnet `:8443` when running | Owner preview (UI redesign) | 45 | 109 / 74 | 12 MB |
| 5 | `idauto_scratch_test` | Haddad | PostgreSQL 16.9 | 55440 (same cluster) | `idauto-staging-db.service` | same `pgdata` | `npm run test:db` via `~/.local/share/idauto-testenv/env.sh` | Test (CI-style scratch, synthetic data) | 45 | 1867 / 595 (test rows) | 22 MB |

Notes:

- **The production database runs only on the VPS.** No IDauto database on Haddad is production; Haddad's cluster holds staging, preview and test databases only.
- Haddad does **not** run the production IDauto API. `idauto-staging-api` and `idauto-preview-api` were both inactive at audit time; the only IDauto process running on Haddad is the media receiver (no database).
- Databases 3 and 4 are owned by their own roles (`idauto_staging_cg2`, `idauto_preview`); the test role cannot open them, so their row counts were read with each service's own (unprinted) credentials.
- Database 3 has 42 tables and **no** Update 6 intake columns; databases 4 and 5 have 45 tables. Database 4 was built before Update 6 (`intake_status` absent). Only `idauto_production` and `idauto_scratch_test` have the Update 6 schema.
- The VPS container `idauto-postgres` also holds databases that are **not IDauto**: `agribee_registre*` (4), `ssangyong_autos`, `shop_mythos`, `shop_mythos_test`, `mythos_command_center`, `mythos_command_center_test`. They are listed for completeness only and are not part of this inventory.
- Other PostgreSQL containers on the VPS (`kacem-postgres` :5472, `mapi-postgres` :5442, `evolution-postgres`) are **not** used by IDauto.
- LENS (Haddad, `mythos-lens.service`, 127.0.0.1:8830) keeps its own store; IDauto never connects to it as a database — only over HTTP, and that path is currently disabled (see [VPS_HADDAD_ARCHITECTURE.md](VPS_HADDAD_ARCHITECTURE.md)).

## 2. Service → database mapping

| Service | Machine | Run as | Env file (mode) | `IDAUTO_DB_HOST` : `PORT` / `NAME` | State 2026-11-19 |
|---|---|---|---|---|---|
| `idauto-api.service` | VPS | `deploy` (user systemd, linger) | `/home/deploy/deployments/idauto-api/.env` (600) | 127.0.0.1:5432 / `idauto_production` | active |
| `mythos-backup-capture.service` | VPS | root | `/home/deploy/.config/mythos/backup-schedule.env` (600) | `docker exec idauto-postgres` / `idauto_production` | last run 03:40 UTC, success |
| `idauto-staging-api.service` | Haddad | `<haddad-user>` | `~/.config/idauto-staging/staging.env` (600) | 127.0.0.1:55440 / `idauto_scratch_cg2_staging` | inactive |
| `idauto-preview-api.service` | Haddad | `<haddad-user>` | `~/.config/idauto-preview/preview.env` (600) | 127.0.0.1:55440 / `idauto_scratch_ui_preview` | inactive |
| test suites (`npm run test:db`) | Haddad | `<haddad-user>` | `~/.local/share/idauto-testenv/env.sh` | 127.0.0.1:55440 / `idauto_scratch_test` | on demand |
| `idauto-media-receiver.service` | Haddad | `<haddad-user>` | `~/.config/idauto-media/receiver.env` (600) | — (no database) | active |

Environment variable **names** in the production env file: `IDAUTO_DB_HOST`, `IDAUTO_DB_PORT`, `IDAUTO_DB_USER`, `IDAUTO_DB_PASSWORD`, `IDAUTO_DB_NAME`, `IDAUTO_API_PORT` (=3001), `IDAUTO_MEDIA_STORAGE_PATH`, `IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH`, `IDAUTO_ADMIN_IDENTITIES`, `IDAUTO_SESSION_SECRET`, `IDAUTO_AUTH_SECRET`, `IDAUTO_AUTH_BASE_URL` (=https://idauto.tn), `IDAUTO_COOKIE_SECURE`, `IDAUTO_HADDAD_MEDIA_URL`, `IDAUTO_HADDAD_MEDIA_ADDR`, `IDAUTO_HADDAD_MEDIA_TOKEN`. Values of the secret ones are not reproduced.

## 3. Production database objects (live catalogue)

| Object | Count |
|---|---:|
| Tables (`public`) | 45 |
| Views / materialized views | 0 / 0 |
| Sequences | 36 |
| Triggers | 0 |
| Functions in `public` | 0 |
| Enum / custom types | 0 (all status columns are `VARCHAR` + `CHECK`) |
| Schemas | `public` only |
| Extensions | `plpgsql` 1.0 only |

Full per-table detail: [DATABASE_TABLES.md](DATABASE_TABLES.md). Relationships: [DATABASE_RELATIONSHIPS.md](DATABASE_RELATIONSHIPS.md).

## Migration history

There is **no migration-tracking table** in `idauto_production` (`schema_migrations` and `idauto_schema_migrations` both absent — checked with `to_regclass`). Migrations are idempotent SQL files in the repository, applied by hand at deploy time (dry run in `BEGIN … ROLLBACK`, then `psql -1`):

`database/schema.sql` (base) and `database/migrations/`:
`ida-3a-ingestion-schema.sql`, `ida-v4-verification-scope-separation.sql`, `ida-v8-identity-resolution.sql`, `ida-v9-organisation-scoped-access.sql`, `ida-v10-vehicle-search.sql`, `ida-v12-vehicle-identification.sql`, `ida-v13-auth-session.sql`, `ida-v14-registration-document.sql`, `ida4-option-c-ivid.sql`, `ida-ui3-registration-maintenance.sql`, `ida-ui4-simplification.sql`, `ida-u2-visual-recognition.sql`, `ida-u3-vehicle-photos.sql`, `ida-u31-scan-photos.sql`, `ida-u4-archive-vin.sql`, `ida-u4b-vin-lookup-index.sql`, `ida-u5-carte-grise-sources.sql`, `ida-u6-carte-grise-intake.sql` (+ `ivid-migration-dry-run.js`).

Which file was applied when is recorded only in the deploy records and PR descriptions, not in the database. The legacy `idauto` database does have a `schema_migrations` table (empty).

## 4. Findings

| # | Finding | Evidence | Status |
|---|---|---|---|
| D-1 | No migration-history table in production | `to_regclass` NULL for both candidate names | Verified |
| D-2 | `idauto_verifications` carries **duplicate foreign keys** (`fk_verif_org` + `idauto_verifications_org_id_fkey`, `fk_verif_user_role` + `idauto_verifications_user_role_id_fkey`) | `pg_constraint` | Verified; harmless but redundant |
| D-3 | Legacy `idauto` database on the production server, empty, unused | row counts 0, no env file references it | Verified |
| D-4 | Production on PostgreSQL 15, Haddad staging/test on 16 | `version()` on both | Verified; a version skew between test and production |
| D-5 | Staging database lacks Update 6 schema | `information_schema.columns` | Verified |
| D-6 | VPS root filesystem 97 % full (70 G / 72 G) — shared by the database volume and media | `df -h /` | Verified; operational risk |
