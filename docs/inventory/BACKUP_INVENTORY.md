# IDauto — backup and recovery inventory

> Read-only audit, 2026-11-19 (UTC). Nothing was backed up or restored during this audit: timestamps come from systemd (`ExecMainExitTimestamp`, `Result`), journald and the backup health file.

## 1. Scheduled backup (VPS)

| Item | Value |
|---|---|
| Units | `mythos-backup-capture.service` (root: in-container `pg_dump -Fc` of `idauto_production` + copy of referenced media) → `mythos-backup.service` (user `deploy`: stage → manifest → verify-local → push → verify-remote) |
| Config | `/home/deploy/.config/mythos/backup-schedule.env` (600): `MYTHOS_BACKUP_DB_CONTAINER=idauto-postgres`, `MYTHOS_BACKUP_DB_NAME=idauto_production`, `MYTHOS_BACKUP_MEDIA_SOURCE=/home/deploy/deployments/idauto-api/media`, `MYTHOS_BACKUP_PREFIX=mythos` |
| Destination | Off-host object storage through `projects/infrastructure/ops/adapters/s3-compatible.js` (Cloudflare R2 per `ops/backup/README.md`; bucket/endpoint not reproduced) |
| What the media set holds | Only objects **referenced** by `idauto_observation_media`, `idauto_vehicle_documents` (`storage_key`, `thumb_storage_key`) — read from the same snapshot as the dump. The 129 unreferenced objects are not included |
| Schedule | `mythos-backup.timer` daily 03:30 UTC (+ ≤ 15 min jitter); `mythos-backup-verify.timer` daily 15:00 (remote verify, read-only); `mythos-restore-test.timer` **monthly**, 1st at 05:00 (restore into a throwaway destination) |
| Last successful backup | **2026-11-19 03:40:48 UTC** (`backup completed clean`; dump `idauto-20261119T034041Z.dump`, 295 145 bytes) |
| Last remote verify | 2026-11-18 15:11:03 UTC — ok |
| Last restore test | 2026-11-18 17:18:10 UTC — ok (run by hand in the pre-deploy procedure); scheduled one last 2026-11-01, next 2026-12-01 |
| Consecutive failures | 0 (`/home/deploy/mythos-backups/health/backup-health.json`) |
| DB/media synchronised? | **Yes** — one capture run takes the dump and the media list from one snapshot; journald shows both completing within the same second |
| Retention | **Report-only**: the adapter is append-only and deletion is refused (`--destructive` → exit 3). No automatic pruning; remote retention is managed outside this job (UNVERIFIED how) |
| Local hand-off dirs | `/home/deploy/mythos-backups/{db-dumps,media-set,staging}` (deploy 700), `/var/backups/mythos` (root 700, 231 files, 26 M) |

## 2. Manual pre-deploy backups (VPS)

Before every deploy the owner-approved procedure writes `/home/deploy/backups/idauto-predeploy-<UTC ts>/` (deploy 700) with `idauto_production.dump`, `media.tar` (whole media store) and `SHA256SUMS` (checked with `sha256sum -c`). 17 sets exist, 2026-11-04 → 2026-11-18 (latest `idauto-predeploy-20261118T171810Z`). These stay **on the VPS** (same disk as production, 97 % full). No retention rule.

Older one-off sets in `/home/deploy/backups/`: `idauto/` (2026-09-05), `idauto-postgres-2026081*` (4), `idauto-media-backup-2026-08-12*` (2), `idauto-hardening-20260827`, `idauto-ship-20260827`, `idauto-v14-20260905T202541Z`, `phase2-pgdump-20260813T174143Z`.

## 3. Haddad

| Data | Backup |
|---|---|
| `/srv/hybrid/idauto-media` (copy of production media) | **None found** |
| Staging cluster `~/.local/share/idauto-staging/pgdata` | Manual drill output only (`backup-drills/`, 25 files) |
| LENS | `mythos-lens-backup.timer` — LENS's own data, not IDauto |

## 4. Gaps

| # | Gap | Effect |
|---|---|---|
| B-1 | Restore test is monthly; the daily job only verifies checksums remotely | A broken dump would be noticed up to a month later (mitigated by the manual restore test before each deploy) |
| B-2 | Pre-deploy backups live on the same disk as production | Not a disaster-recovery copy |
| B-3 | No retention rule anywhere (R2 append-only, local sets accumulate) | Disk pressure on a 97 % full VPS |
| B-4 | Haddad copy has no backup and is not used by restores | It is a convenience copy, not a backup tier |
| B-5 | Unreferenced media objects are excluded from backups | Intended; listed so nobody expects them back after a restore |
