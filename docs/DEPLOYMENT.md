# Deployment

**Last updated:** 2026-09-05. Complements `PRODUCTION_RUNBOOK.md` (host steps, rollback) and the host record at `/home/deploy/deployments/idauto-api/DEPLOYMENT_RECORD.md`.

## 1. Topology (as deployed on idauto.tn)

nginx (TLS, `idauto.tn`) → `127.0.0.1:3001` ← `idauto-api.service` (user unit, `deploy`, `node reference/api.js`, checkout `/home/deploy/projects/idauto` = `main`) → PostgreSQL 16 (`idauto-postgres` container, `idauto_production`) + media root `/home/deploy/deployments/idauto-api/media`. Env file `/home/deploy/deployments/idauto-api/.env` (0600, outside the worktree). Nightly off-host backup of `idauto_production`.

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

## 5. Logging and monitoring

Structured JSON events on stdout → journald (`SyslogIdentifier=idauto-api`). `GET /api/metrics` (admin token) exposes the resolution metrics; scrape it or read it by hand. No log line carries a token, a captcha value, an IP or a full VIN (asserted by `tests/ida-v12` §12).

## 6. Tests before shipping

`npm run test:offline` (no database) — then the live suites against a scratch database (`ops/runbooks/TEST_RUNBOOK.md`), including `npm run test:v12` and `npm run test:v13` (needs `IDAUTO_AUTH_SECRET` in the environment). Reference result on 2026-09-05: 29 suites, 2175 assertions, 0 failures.
