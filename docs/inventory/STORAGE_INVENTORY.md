# IDauto — storage and directory inventory

> On Haddad, `~` is the home directory of the single service user (`<haddad-user>`); the account name is not published.

> Read-only audit, 2026-11-19 (UTC). Counts, sizes, owners and modes come from `find`, `du`, `stat` and `findmnt` on the live machines. MIME types come from `file --mime-type` (content, not extension). **No file was opened for its content** beyond the MIME probe; no document data is reproduced. Hash-named paths are shown with `<sha256>` placeholders.

## 1. Directories

### VPS (`vps-4722f0a9`, root filesystem `/dev/sda1` ext4, 72 G, **97 % used**)

| Absolute path | Purpose | Env | Owner / mode | Files | Size | Backup | Used by |
|---|---|---|---|---:|---:|---|---|
| `/home/deploy/deployments/idauto-api/media` | **Production media store** — content-addressed originals of carte grise faces, vehicle photos and observation images (`IDAUTO_MEDIA_STORAGE_PATH`) | Production | `deploy:deploy` 750 (sub-dirs 755/775) | 137 | 2.7 M | Yes — referenced objects only, daily, R2 (see [BACKUP_INVENTORY.md](BACKUP_INVENTORY.md)); every object also replicated to Haddad | `idauto-api` (its only `ReadWritePaths`) |
| `/home/deploy/deployments/idauto-api/` | Deployment config: `.env` (600), two older `.env.bak-*` (600), `idauto.json` (public-resolution config, 640), `idauto-api.user.service` (unit source), `DEPLOYMENT_RECORD.md`, and two plain-text credential files (600) | Production | `deploy:deploy` 750 | 208 (incl. media) | 4.7 M | Not by the scheduled job | `idauto-api` |
| `/home/deploy/deployments/idauto-api/media-test-final` | Media store left from the 2026-09-05 V14 final test | Test (leftover) | `deploy:deploy` 750 | 63 | 1.9 M | No | none |
| `/home/deploy/deployments/idauto-media` | Older media store (IDA-3, August 2026) | Legacy | `deploy:deploy` 700 | 71 (70 `text/plain`, 1 `octet-stream`) | 1012 K | No | none (no env file points to it) |
| `/home/deploy/deployments/idauto-staging/` | Old VPS staging config (`.env`, a test-account note, `staging.log`, `media/`) — `staging.idauto.tn` nginx site exists | Staging (dormant) | `deploy:deploy` 750 | 3 | 20 K | No | no running unit |
| `/home/deploy/deployments/idauto-postgres/` | `docker-compose.yml` + `.env` (600) of the database container | Production | `deploy:deploy` 750 | 2 | 12 K | No | Docker |
| `/var/lib/docker/volumes/idauto-postgres-data/_data` | PostgreSQL cluster files (holds `idauto_production` **and** 10 non-IDauto databases) | Production | container uid, 700 | — | 293 M | Logical dump of `idauto_production` daily | `idauto-postgres` |
| `/home/deploy/projects/idauto` | Git checkout the service runs from (`WorkingDirectory`) at `06c3951` | Production code | `deploy:deploy` 755 | — | — | GitHub | `idauto-api` |
| `/home/deploy/mythos-backups/db-dumps` | Latest `idauto-<ts>.dump` hand-off | Backup | `deploy:deploy` 700 | 1 | 296 K | is the backup | `mythos-backup` |
| `/home/deploy/mythos-backups/media-set` | Referenced media objects + `manifest.json` for the backup | Backup | `deploy:deploy` 700 | 10 | 1.1 M | is the backup | `mythos-backup` |
| `/home/deploy/mythos-backups/staging` | Staged backup sets before push | Backup | `deploy:deploy` 700 | 1364 | 80 M | is the backup | `mythos-backup` |
| `/var/backups/mythos` | Root-side archive of dumps + `SHA256SUMS-<ts>.txt` | Backup | `root:root` 700 | 231 | 26 M | is the backup | `mythos-backup-capture` |
| `/home/deploy/backups/idauto-predeploy-<ts>` (×17, 2026-11-04 → 11-18) | Manual pre-deploy sets: `idauto_production.dump`, `media.tar`, `SHA256SUMS` | Backup | `deploy:deploy` 700 | — | (whole `backups/` 24 M) | is the backup | deploy procedure |
| `/home/deploy/backups/idauto*`, `idauto-postgres-*`, `idauto-media-backup-*` (Aug–Sep 2026) | Older one-off backups | Backup (old) | mixed (`root` 700 / `deploy`) | — | — | — | none |
| journald (`/var/log/journal`) | Application logs (`SyslogIdentifier=idauto-api`) | Production | root | — | 177 M (all units) | No | systemd |

### Haddad (`haddad`)

| Absolute path | Purpose | Env | Owner / mode | Files | Size | Filesystem | Backup | Used by |
|---|---|---|---|---:|---:|---|---|---|
| `/srv/hybrid/idauto-media` | **Copy of production media** received from the VPS (`IDAUTO_MEDIA_RECEIVER_ROOT`) | Production copy | `<haddad-user>` 700 | 35 | 3.3 M | `/dev/mapper/ubuntu--vg-hybrid--store` ext4 | **None found** (no unit, timer or crontab references it) | `idauto-media-receiver` |
| `~/.local/share/idauto-media-receiver/` | Installed receiver code (`idauto-media-receiver.js`, byte-identical to `ops/haddad/idauto-media-receiver.js` on `main`) | Production | `<haddad-user>` 775 | 3 | 52 K | `ubuntu--vg-ubuntu--lv` | Git | receiver |
| `~/.local/share/idauto-staging/pgdata` | Staging PostgreSQL 16 cluster (3 IDauto databases) | Staging / test | `<haddad-user>` 700 | — | 100 M | `ubuntu--vg-ubuntu--lv` | `backup-drills/` only (manual) | `idauto-staging-db` |
| `~/.local/share/idauto-staging/media` | Staging media store | Staging | `<haddad-user>` 700 | 8 | 944 K | same | No | `idauto-staging-api` (inactive) |
| `~/.local/share/idauto-staging/backup-drills` | Backup/restore drill output (#694) | Staging | `<haddad-user>` 700 | 25 | 1.7 M | same | — | manual |
| `~/.local/share/idauto-staging/samples` | Sample files for CG2 acceptance | Staging | `<haddad-user>` 775 | 8 | 720 K | same | No | manual |
| `~/.local/share/idauto-preview/media` | Preview media store | Preview | `<haddad-user>` 700 | 66 | 11 M | same | No | `idauto-preview-api` (inactive) |
| `~/.local/share/idauto-testenv/media` | Test media store | Test | `<haddad-user>` 700 | 89 | 1.9 M | same | No | test suites |
| `~/.local/share/mythos-lens-releases/current` | LENS release (separate project) | LENS | `<haddad-user>` | — | — | same | `mythos-lens-backup.timer` (LENS only) | `mythos-lens` |

## 2. File categories and where each lives

| Category | Authoritative location | Copy / derived | Format (by content) | Content-addressed? | Sidecar / index |
|---|---|---|---|---|---|
| Carte grise originals (recto, `face=1`) | VPS media store, key = `idauto_vehicle_documents.storage_key` | Haddad `/srv/hybrid/idauto-media/<aa>/<bb>/<sha256>` + hard link in `YYYY/MM/carte-grise/<ts>_<sha16>_<docid>.<ext>` | `image/jpeg`, `image/png` seen; PDF and UTF-8 text allowed by schema (`source_format`) | **Yes** — SHA-256 of the bytes, sharded `<2>/<2>/<64>` | Haddad: `<file>.json` sidecar + `.archive-index/<sha256>` (JSON) |
| Carte grise verso (`face=2`) | same table, `face = 2` — same store, same layout | same | `image/jpeg` | Yes | same |
| Vehicle photos | `idauto_vehicle_documents` rows with `document_type='vehicle_photo'` + `idauto_vehicle_photos` | Haddad `YYYY/MM/vehicle-photos/…` | `image/jpeg` | Yes | same |
| Public scanner / observation images | `idauto_observation_media.object_key` (2 rows) | — | `image/jpeg` | Yes | — |
| Thumbnails | `thumb_storage_key` column — **0 production rows use it** | — | — | (would be) | — |
| Derived (OCR/processed) files | `derived_storage_key` — **0 production rows** | — | — | — | — |
| Other vehicle documents | none: `document_type` CHECK allows only `carte_grise` and `vehicle_photo` | — | — | — | — |
| LENS input files | Would be the Haddad copy, POSTed to LENS `/v1/files` over HTTP by the receiver — **disabled** (`IDAUTO_LENS_*` commented out since 2026-11-18) | — | — | — | — |
| LENS extraction outputs | Database only: `idauto_vehicle_documents.lens_extraction`, `idauto_media_archive.lens_fields` / `lens_status` | — | JSONB | — | — |
| Temporary files | `PrivateTmp=yes` on `idauto-api` (per-service tmp, discarded); nginx client body buffered in memory (`client_body_buffer_size 8m`, `client_max_body_size 20M` for idauto.tn) | — | — | — | — |
| Backup archives | see [BACKUP_INVENTORY.md](BACKUP_INVENTORY.md) | — | `pg_dump -Fc`, tar, SHA256SUMS | — | `manifest.json` |
| Logs | journald on each machine | — | — | — | — |
| Audit records | Database table `idauto_audit_log` (1336 rows, append-only) | — | — | — | — |

## 3. Production media store — measured breakdown

137 files in `/home/deploy/deployments/idauto-api/media`, all named `<aa>/<bb>/<sha256>` (no other names, **0 hard links**):

| Group | Files | Content types | Dated |
|---|---:|---|---|
| Referenced by the database (`storage_key` ∪ `object_key`) | **8** | 7 `image/jpeg`, 1 `image/png` | 7 in 2026-11, 1 earlier |
| **Not referenced** by any row | **129** | 128 `text/plain` (all < 200 bytes), 1 `application/octet-stream` | 2026-08 |

The 129 unreferenced objects date from August 2026 (pre-ship test era, same period as the legacy `idauto-media` store). They are **not** in the backup media set (which only carries referenced objects). They were not opened; their origin is **UNVERIFIED** (most likely early test submissions). Nothing was deleted.

Every one of the 8 referenced keys resolves to a file (0 missing).

## 4. Haddad copy — measured breakdown

35 files under `/srv/hybrid/idauto-media`:

| Group | Files | Detail |
|---|---:|---|
| Content-addressed objects `<aa>/<bb>/<sha256>` | 17 | 16 `image/jpeg`, 1 `image/png` |
| Archive tree `2026/11/{carte-grise,vehicle-photos}/<ts>_<sha16>_<docid>.<ext>` | 6 | **hard links** (link count 2) to 6 of the 17 objects — not extra copies |
| Sidecars `…<ext>.json` | 6 | metadata next to each archived file |
| `.archive-index/<sha256>` | 6 | JSON index entries, one per archived object |

Production records 8 replicas to Haddad (`idauto_media_replicas`, all `stored`) and 6 archive rows (`idauto_media_archive`, all `stored`). Haddad holds 17 objects: **9 more than production's replica table records**. All Haddad files are dated 2026-11-16 or 2026-11-18. The 9 extra objects are most likely from replicas whose database rows were removed by the Update 5.1 rollback or from deploy-day tests — **UNVERIFIED**; nothing was deleted.

## 5. Findings

| # | Finding | Status |
|---|---|---|
| S-1 | The Haddad copy `/srv/hybrid/idauto-media` has **no backup** of its own; it is itself the second copy of production media | Verified (no unit/timer/crontab references it) |
| S-2 | 129 unreferenced objects (Aug 2026) in the production media store; legacy store `idauto-media` (71 files) and `media-test-final` (63 files) are unused | Verified; cleanup is an owner decision |
| S-3 | Plain-text credential files sit next to the deployment (two credential files, two `.env.bak-*` copies, a test-account note in the old staging dir), all mode 600 owned by `deploy`; names withheld here | Verified (names and modes only; not opened) |
| S-4 | VPS root filesystem 97 % full; media, database volume and backups all share it | Verified |
| S-5 | Haddad holds 9 more objects than production's replica table records | Verified count; cause UNVERIFIED |
