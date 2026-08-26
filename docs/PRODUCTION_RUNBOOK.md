# IDauto — Production Runbook (idauto.tn)

**Status of this document:** written at the 2026-08-26 ship point (PR #6 + PR #7
merged, `main` = `c65215a`). It records the verified release state, the exact
host steps that remain, and the rollback procedure. It invents no
infrastructure: everything below either exists in this repository or is an
explicitly-listed owner/host step.

---

## 1. Release state (verified 2026-08-26, clean clone of `main`)

| Gate | Result |
|---|---|
| Repository suites | 17/17 suites, 1186 assertions, 0 failures (fresh PostgreSQL 16, schema + `ida-3a` + `ida4-option-c-ivid` migrations + synthetic seed) |
| IDA-4 Option C live-DB suite | 128/0 |
| Design System UI suite | 345/0 |
| Foundation suite (env-free mode) | 130/0 |
| Browser QA (Chromium, real server) | Flows A–E pass; 0 unexpected console errors |
| Responsive | 320/390/768/1024/1280 px, `/` and `/passport?ivid=…`: 0 horizontal overflow |
| Lighthouse (local) | Home 99/100/96/100 · Passport 89/100/96/90 (perf/a11y/bp/seo) |
| `npm audit --omit=dev` | 0 vulnerabilities (runtime deps: `pg` only) |
| Secrets | no `.env`, no credential committed (suite-asserted) |
| A5-PLATE | public passport: plate hidden, IVID-only resolution, malformed/unknown IVID byte-identical 404; private `/api/passport/:ivid` 401 unauthenticated |
| QR invariant | `qr.payload === ivid` (server- and client-asserted) |

## 2. Architecture (as it exists in this repository)

- Node 22, zero framework. Entry: `node reference/api.js`, binds
  **127.0.0.1** on `IDAUTO_API_PORT` (default 3001). TLS/domain routing is a
  host-level reverse-proxy concern (the Mythos VPS convention is nginx +
  certbot, user-scope systemd unit — same pattern as MCC/OTHMODE units).
- Config: copy `config/idauto.example.json` → `config/idauto.json` (never
  committed). The A5-PLATE phase gate is `public_resolution.enabled`
  (read once per process; restart to change).
- Env (from the host secret store, never committed): `IDAUTO_DB_HOST`,
  `IDAUTO_DB_PORT`, `IDAUTO_DB_USER`, `IDAUTO_DB_PASSWORD`, `IDAUTO_DB_NAME`,
  `IDAUTO_MEDIA_STORAGE_PATH`, `IDAUTO_API_PORT`, admin/professional tokens.
- Database: PostgreSQL. Order of SQL application on a fresh database:
  1. `database/schema.sql`
  2. `database/migrations/ida-3a-ingestion-schema.sql`
  3. `database/migrations/ida4-option-c-ivid.sql` (additive, idempotent —
     the only IDA-4 schema change)
  Production seed data: **none** (synthetic seed is for tests only).

## 3. Host deployment steps (owner / host session — NOT executable from a Claude Code cloud session)

1. **DNS (owner action):** `idauto.tn` and `www.idauto.tn` currently resolve
   to `213.186.33.5` (OVH shared hosting), **not** the Mythos VPS. Point the
   A records at the VPS before any TLS issuance.
2. Backup the production database and **verify the backup restores**
   (`ops/offhost-backup.js`, `ops/runbooks/OFF_HOST_BACKUP_GATE.md`).
3. Apply migrations in the order of §2 (both are `IF NOT EXISTS`-idempotent).
4. Install the service (user-scope systemd, same hardening set as MCC-1 —
   do **not** carry `ProtectKernelTunables`/`ProtectClock`/
   `MemoryDenyWriteExecute` into a user unit; see the SYA `218/CAPABILITIES`
   incident in mythos-prod's handover).
5. nginx vhost for `idauto.tn` + `www` → `127.0.0.1:<port>`; certbot cert;
   `nginx -t` before reload.
6. Smoke test from **outside** the server: `GET /` 200, CSS/JS load,
   `GET /public/passport/<known ivid>` 200 with `qr.payload === ivid`,
   malformed IVID 404, `/api/passport/...` 401 unauthenticated, valid HTTPS,
   no mixed content, no 5xx.
7. Wire monitoring: HTTPS probe asserting **content-type** as well as status
   (the SYA outage lesson — a catch-all 200 HTML page is not a healthy API).

## 4. Rollback procedure

- **Application:** the deployed unit runs a git checkout. Rollback =
  `git checkout <previous tag/commit>` (pre-ship main was `0044d57`;
  ship merge commits: PR #6 `33557f0`, PR #7 `c65215a`) → restart unit →
  re-run §3.6 smoke test.
- **Database:** `ida4-option-c-ivid.sql` is additive (one nullable unique
  column + backfill). Rolling the application back to pre-IDA-4 does **not**
  require dropping the column; if a full DB rollback is ever needed, restore
  the §3.2 verified backup.
- **Config:** `config/idauto.json` is host-local; keep the previous copy
  alongside (`idauto.json.bak`) when editing; restore + restart to revert.
- **Verification after rollback:** same smoke test as §3.6.

## 5. Phase gate at launch

`public_resolution.enabled` ships `true` in the example config. The owner
decides the production value: `false` = PRIVATE phase (anonymous surface off,
404 with zero DB queries; `/` serves 401), `true` = public IVID resolution
live. Changing it is a config edit + process restart, never a code change.

## 6. Verdict at the ship point (2026-08-26)

- **ENGINEERING: COMPLETE** — both PRs merged, clean-clone verification green.
- **PRODUCTION: NOT READY** — DNS points away from the VPS; deploy, backup
  verification, TLS, and outside-in smoke test are open host steps (§3).
- **CITIZEN-FACING: NOT READY** — legal gates L01–L16 remain 16/16 OPEN;
  `CITIZEN_FACING_IDA4_READY = NO` (unchanged by this ship).
