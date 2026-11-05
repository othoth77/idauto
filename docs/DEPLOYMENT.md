# Deployment

**Last updated:** 2026-09-05. Complements `PRODUCTION_RUNBOOK.md` (host steps, rollback) and the host record at `/home/deploy/deployments/idauto-api/DEPLOYMENT_RECORD.md`.

## 1. Topology (as deployed on idauto.tn)

nginx (TLS, `idauto.tn`) → `127.0.0.1:3001` ← `idauto-api.service` (user unit, `deploy`, `node reference/api.js`, checkout `/home/deploy/projects/idauto` = `main`) → PostgreSQL 16 (`idauto-postgres` container, `idauto_production`) + media root `/home/deploy/deployments/idauto-api/media`. Env file `/home/deploy/deployments/idauto-api/.env` (0600, outside the worktree). Nightly off-host backup of `idauto_production` (database + media set, remote verification, monthly restore test — re-checked read-only 2026-10-30).

**IDA-ADMIN-1 (2026-10-30):** the registry and dossier need no host change — `/admin/*` and `/api/admin/*` are served by the same process behind the same `location /`. Release = pull + `systemctl --user restart idauto-api`; no migration, no environment variable. Smoke: `GET /admin/vehicles` 200 · `GET /api/admin/vehicles` 401 anonymous · signed in as admin, the registry lists vehicles and a dossier opens. Rollback = previous commit + restart.

## 2. Environments

| | development | test | staging | production |
|---|---|---|---|---|
| database | any local `idauto_*` | **must** be `idauto_scratch_*` (live suites refuse others) | a copy of production schema | `idauto_production` |
| `NODE_ENV` | unset | unset | `production` | `production` |
| mocks | allowed | injected by suites | **refused** (`NODE_ENV=production`) | **refused** |
| vehicle provider / TecDoc | unset | unset | optional | unset today (not contracted) |
| `public_resolution.enabled` | any | any | mirrors production | `true` |

No real key exists in the repository: `.env.example` documents every variable with placeholders; `config/idauto.example.json` holds no secret.

## 3. Rolling out IDA-V12

1. Merge `ida-v12-final-completion` to `main`; on the host `git pull --ff-only` in `/home/deploy/projects/idauto` (an operator shell, not an agent session).
2. `npm ci --omit=dev` (no new dependency; `pg` only).
3. Apply `database/migrations/ida-v12-vehicle-identification.sql` to `idauto_production` (idempotent; take the nightly dump first as the runbook requires).
4. If the host config `idauto.json` is a copy of the example, add the `TUN_RS` entry to its `plate_formats.formats` (the runtime validator reads the repository file by default, so this only matters if the host copy is pointed at by future code).
5. `systemctl --user restart idauto-api`; check `GET /health`, `GET /atelier` (200, CSP with `wasm-unsafe-eval`), `GET /admin` (CSP unchanged), `GET /api/catalog/status` with a token (`configured:false` expected).
6. Optional providers: set the `IDAUTO_VEHICLE_PROVIDER_*` / `IDAUTO_TECDOC_*` variables in the env file **only** with the owner's own contracted credential; restart. `GET /api/resolution/providers` (admin) shows what is active.

Rollback: revert the checkout to the previous `main` and restart; the migration's DOWN block is in the file. New columns are ignored by the previous code.

## 4. Rolling out IDA-V13 (login / password + sessions)

Do **not** deploy without the validation in `docs/AI_HANDOVER.md` (V13 record) — the full suite and the browser suite must be green on a scratch database first.

1. **Backup**: run the nightly off-host backup (or `pg_dump -Fc idauto_production`) and keep the dump path.
2. Merge `ida-v13-auth-session` → `main`; on the host `git pull --ff-only` in `/home/deploy/projects/idauto`; `npm ci --omit=dev` (adds `better-auth`, ≈34 MB, 0 vulnerabilities).
3. **Migration** (additive, idempotent, applied twice on the scratch DB): `database/migrations/ida-v13-auth-session.sql` on `idauto_production`.
4. **Environment** (`/home/deploy/deployments/idauto-api/.env`, 0600): add `IDAUTO_AUTH_SECRET` (`openssl rand -base64 32`), `IDAUTO_AUTH_BASE_URL=https://idauto.tn`, `IDAUTO_COOKIE_SECURE=1` (or `NODE_ENV=production`), optionally `IDAUTO_SESSION_TTL_SECONDS`. Keep `IDAUTO_ADMIN_IDENTITIES` (service credentials). nginx already forwards `X-Real-IP`.
5. `systemctl --user restart idauto-api`.
6. **First user** (typed password, never on the command line): `node ops/auth-users.js create --email <admin@…> --name "…" --role admin`. Managers/technicians: `--role manager|technician --org <id>`.
7. **Smoke tests**: `GET /login` 200 · `GET /atelier` → 302 `/login` · `GET /api/metrics` → 401 `login:/login` · sign in at https://idauto.tn/login → `/atelier` loads with « Connecté : … », no token asked · `GET /admin` shows the session line · `POST /api/auth/sign-up/email` → 404 · cookie has `HttpOnly; Secure; SameSite=Lax`.
8. **Browser test**: the mechanic flow on `/atelier` (scan / manual / confirm / parts / visit) and Déconnexion.

**Rollback**: `git checkout <previous main>` + restart. The V13 tables are unused by the previous code and can stay (DOWN block in the migration if removal is wanted). Removing the admin entries from `IDAUTO_ADMIN_IDENTITIES` is a separate step **after** validation — not part of this rollout.

## 5. Rolling out IDA-V14 (carte grise)

1. Backup `idauto_production` (as for V13).
2. Merge `ida-v14-carte-grise`; pull; `npm ci --omit=dev` (no new npm dependency — Scanic and the OCR models are vendored under `web/vendor/`).
3. Apply `database/migrations/ida-v14-registration-document.sql` (additive, idempotent, applied twice on scratch; DOWN block inside). Existing vehicles and documents are untouched.
4. Environment: nothing required. Optional `IDAUTO_DOCUMENT_STORAGE=local`, `IDAUTO_DOCUMENT_MAX_BYTES`, `IDAUTO_DOCUMENT_UPLOADS_PER_10MIN` (`.env.example`). The media root is the one already in `ReadWritePaths` of the unit.
5. Restart `idauto-api`.
6. Smoke: `GET /atelier/assets/scanic.umd.js` 200 · `GET /atelier/assets/tesseract/fra.traineddata.gz` 200 · signed in: the fiche shows « Ouvrir le passeport » and « Scanner la carte grise » · `GET /api/vehicles/<ivid>/registration-document` 200 `has_document:false`.
7. Browser test on a phone (Android Chrome): scan face 1, optional face 2, proposal, confirm, passport section, reload.

Rollback: previous `main` + restart; the table is inert for the old code.

## 6. Logging and monitoring

Structured JSON events on stdout → journald (`SyslogIdentifier=idauto-api`). `GET /api/metrics` (admin token) exposes the resolution metrics; scrape it or read it by hand. No log line carries a token, a captcha value, an IP or a full VIN (asserted by `tests/ida-v12` §12).

## 7. Tests before shipping

`npm run test:offline` (no database) — then the live suites against a scratch database (`ops/runbooks/TEST_RUNBOOK.md`): `npm run test:db`, `npm run test:v12`, `npm run test:v13` and `npm run test:v14` (needs `IDAUTO_AUTH_SECRET` in the environment). Reference result on 2026-09-05: 29 suites, 2175 assertions, 0 failures.

> **Corrected 2026-09-22.** "(no database)" was not true of `test:offline` between `4570604` and this correction: `ida-v8`, `ida-v9` and `ida-v10` had been added to it and each opens a PostgreSQL connection, so the script exited non-zero on any host without `IDAUTO_DB_*`. Those three moved to the new `test:db`. Re-measured on a clean checkout with no database: **`test:offline` = 16 suites, 1021 assertions, 0 failures**. `.github/workflows/ci.yml` runs it on every push with no database service, so the claim is now proved by the run rather than asserted here.

## 8. Rolling out IDA-UI (redesign, manual registration, owner contact) — owner approval required

**Prerequisites (each verified, not assumed):** the off-host backup includes the carte grise images (mythos-prod #694
installed on the VPS, one clean nightly run whose manifest shows `source_references.vehicle_document`, one restore
test); VPS disk ≤ 89 %; owner go.

1. Read-only pre-checks on `idauto_production` (inside `idauto-postgres`):
   - `SELECT to_regclass('public.idauto_vehicle_documents'), to_regclass('public.idauto_workshop_operations');` — both
     must exist (IDA-V12 and IDA-V14 applied; the photos of a manual registration are V14 documents);
   - `SELECT identification_method, count(*) FROM idauto_vehicles GROUP BY 1;` — every value must be in the new list
     (`plate_ocr, plate_manual, vin, manual_selection, provider, import, admin, carte_grise_ocr, manual_registration`
     or NULL), otherwise the new CHECK constraint is refused and the migration stops.
2. Backup `idauto_production` (`pg_dump -Fc`, sha256, `pg_restore --list`) and confirm the nightly off-host backup is green.
3. Merge; fast-forward the production checkout. No new npm dependency.
4. Apply `database/migrations/ida-ui3-registration-maintenance.sql` **in one transaction**
   (`psql -1 -v ON_ERROR_STOP=1`): additive, idempotent (applied twice on scratch). It creates
   `idauto_vehicle_owner_contacts` (personal data — owner decision 2026-11-05) and adds nullable columns to
   `idauto_workshop_operations`; no existing row changes.
5. Environment: nothing new is required. `IDAUTO_CG_OCR_ENABLED` stays unset (the OCR routes answer 410).
   Optional on a constrained host: `IDAUTO_DB_IDLE_TIMEOUT_MS`, `IDAUTO_DB_CONNECT_TIMEOUT_MS`.
6. Restart `idauto-api`.
7. Smoke: `/login` (language selector), `/atelier/tableau-de-bord` signed in (sidebar + top bar), `/atelier/vehicules/nouveau`,
   `/api/search?q=…` 200, `/api/vehicles/:ref/registration-document/ocr` 410, an Arabic page served with `dir="rtl"`.

**Rollback:** previous release + restart; **do not run the DOWN block**. The previous code was run against a database
with this migration applied (2026-11-05, scratch: IDA-V12 125/0, IDA-V14 document 68/0, home registration 38/0): the
new table and columns are inert for it. The DOWN block deletes the owner contacts and the part-source columns — it is
data loss, an owner decision, and only after a dump. Restoring the pre-deploy dump goes into a NEW database first,
never over `idauto_production` without the owner.
