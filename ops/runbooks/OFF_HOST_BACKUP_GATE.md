# Off-Host Backup Gate — Runbook

**Status:** **EXECUTED — GATE CLOSED (2026-08-14).** All seven gate conditions met; see §6.
**Date:** 2026-08-14 · **Authority:** this file is the operational runbook;
[`../../docs/AI_HANDOVER.md`](../../docs/AI_HANDOVER.md) records outcomes.

**Provenance:** migrated 2026-08-18 from `docs/OFF_HOST_BACKUP_GATE.md` in
`othoth77/mythos-prod` — see [`../../docs/MIGRATION_FROM_MYTHOS_PROD.md`](../../docs/MIGRATION_FROM_MYTHOS_PROD.md).

> **Two corrections applied during migration, and nothing else changed.**
>
> 1. **The original header was stale.** It read *"Execution: BLOCKED — no authorised
>    destination exists. Nothing in this document has been executed. No backup exists
>    off-host."* — while §6 of the same file recorded the gate as **CLOSED** on 2026-08-14
>    with all seven conditions met. The header was written before execution and never
>    updated. §6 is the correct record; the header has been corrected to match it.
> 2. **§7 was likewise stale** and is marked as such in place rather than deleted.
>
> **Scope note.** This runbook covers three production databases, of which `idauto` is one.
> The other two (`coolify`, `darhijama_prod`) are **Mythos infrastructure, outside this
> repository's scope**. They are retained here rather than stripped, because the verified
> batch is a single joint operation and editing the evidence to fit the repository boundary
> would misrepresent what was actually done. Only the `idauto` rows are IDauto's concern.

---

## 0. What already exists — do not rebuild it

The repository **already contains a provider-neutral, S3-compatible off-host backup implementation**:

| Component | Path |
|---|---|
| Core (manifest, stage, push, verify, restore-verify, retention, redact) | [`../offhost-backup.js`](../offhost-backup.js) |
| SigV4 S3-compatible transport | [`../adapters/s3-compatible.js`](../adapters/s3-compatible.js) |
| Test suite | [`../../tests/ida-3f-offhost-backup-test.js`](../../tests/ida-3f-offhost-backup-test.js) |

It is **R2-ready as written**: AWS SigV4 signing, injectable transport (so it tests offline), HTTPS-only endpoints enforced, and a config file whose permissions are checked. **No new tooling is required, and none should be installed** — not `rclone`, not `aws`, not `s3cmd`. Introducing a second mechanism would create two backup paths with one set of guarantees between them.

**The one real gap:** this tooling backs up **file artefacts with a manifest**. Database dumps are not files it produces — they are files it *carries*. The dump step (§D) is therefore an addition in front of the existing pipeline, not a replacement for it.

---

## 1. Sources — verified read-only, 2026-08-14

| # | Container | Database | Engine | Tables | Size | Dump method | Format |
|---|---|---|---|---|---|---|---|
| 1 | `idauto-postgres` | `idauto` | PostgreSQL **15.18** | 24 | 11 MB | `pg_dump -Fc` | custom, compressed |
| 2 | `coolify-db` | `coolify` | PostgreSQL **15.19** | 66 | 24 MB | `pg_dump -Fc` | custom, compressed |
| 3 | `dar-hijama-production-mysql-1` | `darhijama_prod` | MySQL **8.4.11** | 39 | — | `mysqldump --single-transaction` | plain SQL |

**Order is fixed: `idauto` → `coolify` → `darhijama_prod`.**

**`pg_dump` MUST run inside each source container.** The two PostgreSQL servers are on *different minor versions* (15.18 and 15.19). A `pg_dump` client older than its server refuses to run, so a single external client cannot safely serve both. Running in-container guarantees client and server versions match and removes any need for a network path to the database.

Credentials come from each container's own environment (`$POSTGRES_USER`, `$MYSQL_ROOT_PASSWORD`) and are **never** placed on a command line, in a shell variable, or in this repository.

---

## 2. The four distinct artefacts — never conflate them

The gate is meaningful only because these are separate things, checked separately:

| Symbol | Artefact | How it is verified |
|---|---|---|
| **C1** | **source checksum** — SHA-256 of the dump file as written on the VPS | computed at rest, before upload |
| **O** | **uploaded object** — the object stored in the bucket | existence + size via `HEAD` |
| **C2** | **downloaded copy checksum** — SHA-256 of a *freshly downloaded* copy | recomputed from bytes off the wire |
| **R** | **restored database** — a live database rebuilt from the downloaded copy | structural validation, **not** a checksum |

**C1 == C2 is the round-trip proof.** **R is not byte-comparable to anything** — a restored database is never byte-identical to its dump, so it is validated structurally (schema, table count, row counts, accessibility).

> **Do not use ETag as the checksum.** S3/R2 ETag equals MD5 only for single-part uploads; for multipart uploads it is a hash-of-hashes and is not a content checksum at all. The round-trip proof must be *download and re-hash*, never an ETag comparison.

---

## 3. R2 configuration contract — documented, NOT created

Cloudflare R2 is S3-compatible; the existing adapter needs no code change.

Config file: **`~/.config/mythos/idauto-offhost.env`**, mode **`0600`** — the loader *refuses to run* if the mode is anything else, and refuses any non-HTTPS endpoint.

Required keys (the adapter throws if any is missing):

```
ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
REGION=auto
BUCKET=<bucket-name>
ACCESS_KEY_ID=<scoped key id>
SECRET_ACCESS_KEY=<scoped secret>
```

- `REGION=auto` is R2's convention; the adapter passes it through to SigV4 unchanged.
- The credential must be **scoped to this one bucket**, Object Read & Write only — never an account-wide token.
- **The owner creates this file directly.** Values are never pasted into chat, never typed by an agent, never committed, never echoed, never printed in test output or a report, and never placed in a command line where they would enter shell history.
- The file is outside the repository. `.gitignore` is irrelevant to it and must not be relied on as the protection.

**Rotation:** if a key is ever exposed, revoke at Cloudflare first, then rewrite the file. Revoking first bounds the exposure window; rewriting first leaves a live key loose.

---

## 4. Runbook — A through M

### A. Destination preflight
Confirm a destination exists at all. Read-only:
```bash
# expect a non-zero count before proceeding
docker exec -i coolify-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT 's3_storages='||count(*) FROM s3_storages;
SQL
```
Also confirm `~/.config/mythos/idauto-offhost.env` exists with mode `0600`. **Never print its contents.**
**If absent → STOP. The gate is blocked and no dump should be taken.**

### B. Credentials validation
Validate by **use, not by inspection**: a signed `HEAD` against the bucket root. A 200/204 proves endpoint, region, key, and bucket scope together. A 403 means the key is wrong or not scoped to this bucket; a 404 means the bucket name is wrong. Never print the key to distinguish them.

### C. Source identification
Re-verify §1 immediately before dumping — container names, database names, engine versions, table counts. If any differs from §1, **STOP**: something changed underneath the runbook.

### D. Dump
Run inside each container; stream to a file on the VPS.
```bash
mkdir -p /var/backups/mythos && chmod 700 /var/backups/mythos
TS=$(date -u +%Y%m%dT%H%M%SZ)

docker exec idauto-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /var/backups/mythos/idauto-$TS.dump
docker exec coolify-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /var/backups/mythos/coolify-$TS.dump
docker exec dar-hijama-production-mysql-1 sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events darhijama_prod' \
  > /var/backups/mythos/darhijama_prod-$TS.sql
```
`--single-transaction` gives a consistent InnoDB snapshot **without locking the production tables** — the difference between a backup and an outage. Nothing is written to any production database; `pg_dump` and `mysqldump` are read-only.

### E. SHA-256 generation (**C1**)
```bash
cd /var/backups/mythos && sha256sum *-$TS.* > SHA256SUMS-$TS.txt
```
Record every C1 in the evidence table. A dump whose C1 was never recorded cannot be round-trip proven later.

### F. Upload (**O**)
Use the existing `push()` in `ops/offhost-backup.js`. Do not hand-roll a `curl` upload — it would bypass the manifest, the retention rules, and the redaction path.

### G. Fresh download (**C2 source**)
Download to a **different directory** — `/var/backups/mythos-verify/`. Never re-hash the local original and call it a round trip; that proves only that the disk still works.

### H. Round-trip verification
```bash
cd /var/backups/mythos-verify && sha256sum -c ../mythos/SHA256SUMS-$TS.txt
```
**C1 == C2 for all three, or the gate fails.** No partial pass.

### I. Isolated restore
Restore **from the downloaded copy**, never from the local original — restoring the original would not test the round trip at all. See §5 for isolation requirements.

### J. Restore validation
For each restored database: schema present · table count matches §1 · row counts match the source within the window · a representative query returns · for PostgreSQL, `pg_restore --list` parses cleanly. **Compare against §1 figures, not against expectations.**

### K. Evidence recording
Record in `docs/AI_HANDOVER.md`: timestamp · per-database C1 · object key · C2 · match yes/no · restored table/row counts · production-unchanged confirmation · scratch cleanup confirmation. **No credential, endpoint secret, or object URL containing a signature.**

### L. Cleanup
Remove scratch containers and volumes; verify zero remain; re-run the production census and diff it against the pre-run census. Local dumps: retain per the retention policy in `offhost-backup.js`, mode `0600`, **never committed to Git**.

### M. Rollback / failure handling
Backups are **additive** — there is nothing to roll back in production, and no step writes to a production database. Failure handling is therefore *stop and report*, not *undo*:

| Failing step | Action |
|---|---|
| A/B destination or credential | STOP. Do not dump. Report the gate as blocked. |
| D dump | STOP. Investigate the source container. Never retry with `--force`-style flags or by disabling `--single-transaction`. |
| E/H checksum mismatch | STOP. **Do not re-upload to "fix" it.** A mismatch means the stored object is untrustworthy; discover why before overwriting the evidence. |
| F upload | Retry once. On repeat failure, STOP — do not fall back to a different destination. |
| I/J restore | STOP. **The gate fails.** A backup that will not restore is not a backup; keep the dump for diagnosis. |
| L cleanup | Never leave scratch resources running. Cleanup failure is itself a reportable defect. |

---

## 5. Restore isolation — mandatory

The restore test runs in a throwaway container, matching the pattern used throughout the MPI stages:

- **No production database connection** — the scratch container is never given production credentials.
- **No production volume** — `--mount type=tmpfs,destination=…` only; never a named or bind volume.
- **No production network** — `--network none`. It cannot reach `idauto-postgres`, `coolify-db`, or MySQL even by accident.
- **No published port** — in particular never `5432` or `3306`.
- **Version-matched image** — `postgres:15-alpine` for the PostgreSQL dumps, `mysql:8.4` for MySQL.
- **Removed afterwards** with `docker rm -v`; verify **0 scratch containers and 0 scratch volumes**, then diff the production census before/after.

Restore is `pg_restore` / `mysql <` **into the scratch database only**. It is never run against a production container — that would be a restore-over-production, the single most destructive mistake this whole gate exists to avoid.

---

## 6. Gate logic

| Gate | Condition | Status |
|---|---|---|
| **A** | Authorised off-host destination exists | **MET** 2026-08-14 — R2 `mythos-offhost-backups`, bucket-scoped credential, connectivity round-trip PASS |
| **B** | Backup created | **MET** 2026-08-14 — batch `20260814T161856Z`: `idauto` + `coolify` (`pg_dump -Fc` in-container) + `darhijama_prod` (`mysqldump --single-transaction`) |
| **C** | SHA-256 verified (C1) | **MET** — C1 recorded for all three at dump time |
| **D** | Fresh download verified (C1 == C2) | **MET** — 3/3 byte-identical on fresh download from R2 |
| **E** | Restore-from-download succeeds | **MET** — 3/3 isolated restore tests: idauto 24 tables/2,551 rows source-identical; coolify 66 tables; darhijama 39 tables, largest-table rows source-identical |
| **F** | PC-DECOMMISSION-GATE closed | **CLOSED** — owner-declared, 2026-08-14 |
| **G** | Final VPS inventory reconciled | **MET** 2026-08-14 — full reconciliation PASS: Git clean at verified HEAD, R2 3/3 by metadata, 0 temp resources, census identical to pre-backup baseline, all DBs healthy and source-identical, 0 credentials in repo |

**GATE STATUS: CLOSED (2026-08-14).** All seven conditions are met; evidence lives in `docs/AI_HANDOVER.md` (batch `20260814T161856Z`). The `migrate.js` runner may now be given `backupGateClosed: true` **truthfully** — the assertion remains per-run and operator-made, and becomes false again the moment backups stop being current or restore-verified.

**Standing caution:** this gate closure reflects one verified batch. It is not a schedule — recurring backups, retention automation and Coolify integration are separate, not-yet-authorised work, and the gate should be treated as stale if the newest verified backup ages beyond the owner's tolerance.

---

## 7. What was required to unblock — SUPERSEDED

> **Stale as written; retained for the record.** This section described the state before
> execution. The R2 bucket, the bucket-scoped credential and the config file were all
> created on 2026-08-14, and the gate closed the same day (§6). What remains outstanding
> is **not** in this section: recurring backup scheduling, retention automation and
> Coolify integration are separate, not-yet-authorised work.

One owner action: **create the R2 bucket and a bucket-scoped credential, then write `~/.config/mythos/idauto-offhost.env` with mode `0600`.** Nothing else is missing — the tooling, the runbook, the validation procedure and the isolation requirements are all in place and tested offline.
