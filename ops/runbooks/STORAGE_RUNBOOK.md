# ID Auto — Storage, Backup and Recovery Runbook

**Scope:** operating the existing local content-addressed media store — audit, backup, verify, restore, disaster recovery. This runbook does **not** change the storage design, and `IDAUTO-STORAGE-OPS` did not migrate anything to cloud object storage.

**Companion documents:** [`TEST_RUNBOOK.md`](TEST_RUNBOOK.md) (environment and test execution) · [`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

---

## 1. Architecture summary

Media objects are stored on the local filesystem, **content-addressed by SHA-256**:

```
$IDAUTO_MEDIA_STORAGE_PATH/<hash[0:2]>/<hash[2:4]>/<full-64-char-hash>
```

Three properties follow from this, and every operational procedure below depends on them:

1. **The filename *is* the checksum.** Integrity is verifiable offline with no database and no manifest — re-hash the file and compare it to its own name.
2. **Identical bytes produce one object.** Uploading the same image for two observations creates **one** file and **two** database rows. Objects are therefore routinely shared.
3. **The object is written before its database row commits.** `writes.js` calls `storage.store()` first, then `INSERT`s inside the audited transaction. On failure it deletes the object **only if no other row references it**.

Database metadata lives in `idauto_observation_media` (`object_key`, `image_hash`, `file_size_bytes`, `access_scope`, `retention_status`, …). `object_key` and `image_hash` currently hold the same value.

### Why this matters for backups

Because objects are written **before** rows commit, a backup must export **database metadata first, then copy media**. A committed row's object is guaranteed to already be on disk and will not be removed underneath the copy. The reverse order is unsafe: a row committing mid-copy could reference a file created after its directory was already walked. `media-ops.js` implements the safe order and records the strategy in every manifest.

## 2. Paths, ownership and permissions

| Item | Path | Mode | Owner |
|---|---|---|---|
| Live media store | `${IDAUTO_MEDIA_STORAGE_PATH}` | `750` | deployment user |
| Media objects | `…/aa/bb/<hash>` | `640` | deployment user |
| Media backups | `${IDAUTO_BACKUP_ROOT}/idauto-media-backup-<UTC-timestamp>/` | `700` dir, `600` files | deployment user |
| PostgreSQL backups (IDA-2B) | `${IDAUTO_BACKUP_ROOT}/idauto-postgres-<date>/` | root-only, `600` | `root` |
| Restore testing | `${IDAUTO_RESTORE_TEST_DIR}/…` | `750` | deployment user |

All media operations run **as `deploy`**. The store is mode `750`, so no other unprivileged account can read it.

## 3. Commands

All commands run from the repository root as `deploy`, with the environment loaded per [`TEST_RUNBOOK.md`](TEST_RUNBOOK.md) §3. `audit` and `backup` need database access; `verify-backup`, `restore-dry-run` and `restore` do **not**.

```bash
# Read-only integrity report (DB <-> filesystem)
node ops/media-ops.js audit
node ops/media-ops.js audit --json     # machine-readable

# Create a verified backup (default destination ${IDAUTO_BACKUP_ROOT})
node ops/media-ops.js backup
node ops/media-ops.js backup --dest ${IDAUTO_BACKUP_ROOT}

# Re-verify a backup already on disk
node ops/media-ops.js verify-backup --backup <backup-dir>

# Show exactly what a restore would do — writes nothing
node ops/media-ops.js restore-dry-run --backup <backup-dir> --dest <dir>

# Restore into an explicit destination
node ops/media-ops.js restore --backup <backup-dir> --dest <dir>
```

**Exit codes:** `0` clean · `1` usage/environment error · `2` anomaly or verification failure · `3` refused (unsafe destination, or a conflicting file). These are stable and safe to branch on in automation.

### Safety properties built into the tool

- There is **no delete or prune command**, deliberately. Cleanup is a separately-authorised operation.
- `restore` has **no default destination** — `--dest` is mandatory.
- `restore` refuses the live media store, any path inside it, protected system paths (`/`, `/home`, any direct child of `/home` (a user home root, by rule not by name), `/etc`, `/var`, `/usr`, `/root`, …), and any path inside the git repository.
- `restore` **never silently overwrites** a file whose bytes differ; it refuses with exit `3`. Identical bytes are skipped, so restore is idempotent.
- `restore` refuses to run from a backup that fails verification.
- The tool issues **no** `INSERT`/`UPDATE`/`DELETE`/`ALTER`; metadata is exported inside a `REPEATABLE READ READ ONLY` transaction.

## 4. Backup artifact

```
idauto-media-backup-<UTC-timestamp>/
  manifest.json                        format version, counts, integrity hashes, consistency state
  checksums.sha256                     "<sha256>  media/aa/bb/<hash>" per object
  media/aa/bb/<hash>                   the objects, layout preserved
  metadata/observation-media.json      idauto_observation_media export (reference/verification only)
```

The manifest records format version, UTC creation time, tool path and git commit, source storage path (**path only — never a credential**), host identifier, backup mode (`online-live`), the consistency strategy and snapshot time, source fingerprints taken **before and after** the copy, `source_changed_during_backup`, media file count and bytes, DB row count and distinct object keys, SHA-256 of both the checksums file and the metadata export, and any anomalies.

**Consistency states:** `CONSISTENT` — the source did not change during the copy and every referenced object is present. `DEGRADED` — the source changed mid-backup, an object was missing, or a source object failed its own hash check. A degraded backup is still written (it is better than nothing) but says so honestly and exits `2`.

**No credential of any kind is written into a backup.** The metadata export contains only object-reference columns.

## 5. Identifying and validating backups

```bash
# Latest backup
ls -1dt ${IDAUTO_BACKUP_ROOT}/idauto-media-backup-* | head -1

# Verify it BEFORE you ever need it — an unverified backup is not a backup
node ops/media-ops.js verify-backup \
  --backup "$(ls -1dt ${IDAUTO_BACKUP_ROOT}/idauto-media-backup-* | head -1)"

# Consistency state and counts at a glance
node -e "const m=require('<backup-dir>/manifest.json');console.log(m.consistency.state,m.media.file_count,m.database.row_count)"
```

Verify **every** backup at creation time and re-verify periodically. Per `AGENTS.md` §16, a backup is valid only after restoration has been tested.

## 6. Relationship to the PostgreSQL backup

Two independent backups protect ID Auto and **both are required** for a full recovery:

| | Media backup (this stage) | PostgreSQL backup (IDA-2B) |
|---|---|---|
| Covers | media objects + a metadata export | the entire database |
| Tool | `media-ops.js backup` | `pg_dump --format=custom` |
| Location | `${IDAUTO_BACKUP_ROOT}/idauto-media-backup-<ts>/` | `${IDAUTO_BACKUP_ROOT}/idauto-postgres-<date>/` |
| Owner | `deploy`, `700`/`600` | root-only, `600` |
| Authoritative for | object bytes | all rows, including `idauto_observation_media` |

**The metadata export inside a media backup is NOT a database backup.** It exists to verify cross-consistency and to tell an operator which objects a given generation expected. Restoring rows is the PostgreSQL dump's job. `media-ops.js` never writes to a database.

### Pairing generations

Take both backups **close together** and record the pair. The media manifest already carries everything needed to check alignment afterwards: `created_at_utc`, `consistency.metadata_snapshot_utc`, `database.row_count`, `database.distinct_object_keys`. Note the `pg_dump` filename next to the media backup directory name in your operations log; no live database change is needed to link them.

## 7. Restore order — media first, then database

**Always restore media before the database.**

The live write path stores an object before its row commits, and recovery should mirror that ordering:

- **Media first:** extra objects with no rows yet are harmless — they are classified `UNKNOWN` orphans and nothing acts on them automatically.
- **Database first:** creates a window where committed rows reference objects that are not yet on disk. Every media read in that window fails.

```bash
# 1. Restore media into a staging directory (never directly over live)
node ops/media-ops.js restore --backup <backup-dir> --dest ${IDAUTO_RESTORE_TEST_DIR}/idauto-media-<date>

# 2. Have an operator deliberately move/merge staging into the live path.
#    The tool refuses to write to the live store by design.

# 3. Restore the database from the IDA-2B pg_dump (root procedure).

# 4. Verify cross-consistency
node ops/media-ops.js audit
```

Step 4 must report `missing_objects: 0`. Orphans may be non-zero after a mismatched restore and are **not** an error — see §9.

## 8. Disaster scenarios

| Scenario | Response |
|---|---|
| **Media directory deleted** | The database still holds every row. Restore the newest verified media backup into a staging directory, move it into place, then `audit`. Any object created after the backup is unrecoverable — this is exactly what backup cadence (§11) bounds. |
| **Database restored older than media** | Rows are missing for objects that exist. `audit` reports **orphans**. This is safe and non-destructive; the extra objects are simply unreferenced. **Do not delete them** — a newer database restore may reference them again. |
| **Media restored older than database** | Rows reference objects that are absent. `audit` reports **`missing_objects` (CRITICAL)**. Reads of those objects will fail. Restore a newer media backup, or accept and document the loss. This is the genuinely damaging direction, and it is why media is restored first. |
| **Individual corrupt object** | `audit` reports a `hash_mismatch` (the file no longer hashes to its own name). Extract the good copy from a verified backup: `media/aa/bb/<hash>`. Because storage is content-addressed, a correct replacement is byte-identical by definition. |
| **Disk full** | Writes fail; the write path deletes the object it just wrote when the row cannot commit, so partial rows are not created. Free space, then run `audit` to confirm no `missing_objects`. Never delete backups to free space before confirming a newer verified backup exists elsewhere. |
| **Failed / partial backup** | A backup that failed verification must never be used. `restore` already refuses one. Delete the failed directory and re-run `backup`. If `consistency.state` is `DEGRADED`, read `anomalies` in the manifest before trusting it. |
| **Whole server loss** | Provision the host, restore the PostgreSQL dump and the media backup **(media first, §7)**, restore `IDAUTO_MEDIA_STORAGE_PATH` ownership to deployment user `750` and objects to `640`, then `audit`. Note that both backup sets currently live **on the same host** — see §11. |

## 9. What must never be deleted automatically

- **Orphan objects.** An object with no database row may simply be newer than the snapshot you compared against, because the write path stores objects before rows commit. The audit therefore classifies orphans `UNKNOWN` and **never** `SAFE_CANDIDATE`, and the tool has no delete command at all. Any cleanup is a separate, explicitly-authorised operation that must re-check references immediately before acting.
- **Shared objects.** One object is routinely referenced by many rows — the live store currently has an object referenced by **17** rows. Deleting an object because *one* referencing row disappeared would silently corrupt every other row pointing at it.
- **Audit log rows.** `idauto_audit_log` is append-only by design and must never be pruned or rewritten.
- **Any backup** that has not been superseded by a newer *verified* backup.

## 10. Credential safety

- Database configuration comes from the same `IDAUTO_DB_*` variables the runtime uses, loaded per the test runbook. **Never** type a credential on the command line; source the `.env` and map the names.
- No credential is ever written into a manifest, a metadata export, a report, or `--json` output. This is asserted by the automated suite.
- Backups are `700`/`600` and `deploy`-owned. Keep them that way.
- Never commit a backup — media, manifest, or metadata — to git.

## 11. Cadence, retention and monitoring

**Current state (2026-08-12):** all media is small, synthetic test fixtures created by the IDA-2F/2H suites. Losing it would cost nothing. **This changes the moment IDA-3 begins accepting community capture** — contributor-submitted evidence is non-disposable, may be legally relevant, and cannot be regenerated.

**Recommended once IDA-3 ingestion starts:**

| Item | Recommendation |
|---|---|
| Cadence | **Daily**, plus an on-demand backup immediately before any schema change, storage change, or deployment touching ID Auto |
| Pairing | Take the PostgreSQL dump immediately after the media backup and record the pair (§6) |
| Retention | 7 daily · 4 weekly · 3 monthly, pruned oldest-first and **only** after verifying a newer backup |
| Verification | `verify-backup` on every new backup; a full restore-to-staging drill at least monthly |
| Off-host copy | **Currently both backup sets live on the same host as the data they protect.** That protects against accidental deletion and corruption but **not** against loss of the host or its disk. Moving backups off-host is the single largest remaining gap and should be resolved before IDA-3 stores real evidence. |
| Growth monitoring | Track `manifest.media.total_bytes` across generations and alert on `df -h` for the media filesystem. Content-addressed storage is append-mostly, so growth is monotonic and dedup means row count grows faster than byte count |

**Automation is deliberately NOT scheduled by this stage.** No approved scheduling mechanism was established for it, and scheduling an unattended job that touches production storage warrants its own authorised change. The recommendation above is the input to that future decision.

## 12. Known observations (recorded, no action taken)

- **Empty directories accumulate.** `storage.removeUnconditionally()` unlinks a file but does not prune its now-empty `aa/bb/` parents; the live store currently holds 16 empty directories. This is **cosmetic and deliberately not fixed**: pruning inside the delete path would race the `mkdir` in `storage.store()`, so a concurrent upload could have its directory removed between `mkdir` and `writeFileSync`. Content-addressed stores conventionally leave directories in place for exactly this reason. Backups intentionally do not reproduce empty directories — they carry no data, and the write path recreates them on demand.
- **Directory mode drift.** Media subdirectories are a mix of `755` and `775` (both deployment user), reflecting different umasks at creation time. The store root is `750`, so nothing outside `deploy` can traverse them, and object files are consistently `640`. Not a security issue; recorded for completeness.
