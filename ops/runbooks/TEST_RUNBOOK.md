# ID Auto — Live Test Runbook

**Purpose:** run the ID Auto regression suites correctly, and tell an environment problem apart from a real code regression.

**Why this exists.** The six ID Auto suites run against the **live** `idauto-postgres` container and the **live** media directory. When their environment is missing they do **not** skip and do **not** say "environment missing" — they emit ordinary-looking assertion failures and a `FATAL`. During `MYTHOS-IDENTITY-CORE-0` this cost real investigation time: IDA-2C appeared to fail 8 assertions, and IDA-2H reported `36 passed, 1 failed`, both purely because environment variables were unset. Nothing was wrong with the code. **Read §5 before concluding you have found a regression.**

**Scope:** running and interpreting tests. This runbook changes no credential, no database configuration, no deployment environment, and no file ownership.

---

## 1. Required environment

| Variable | Used by | Notes |
|---|---|---|
| `IDAUTO_DB_HOST` | `db.js` | `127.0.0.1` — the container publishes to loopback only |
| `IDAUTO_DB_PORT` | `db.js` | `5432` (verify with `docker port idauto-postgres`) |
| `IDAUTO_DB_USER` | `db.js` | **maps from** `POSTGRES_USER` |
| `IDAUTO_DB_PASSWORD` | `db.js` | **maps from** `POSTGRES_PASSWORD` |
| `IDAUTO_DB_NAME` | `db.js` | **maps from** `POSTGRES_DB` |
| `IDAUTO_MEDIA_STORAGE_PATH` | `storage.js` | deployment-defined media root (no default) |

`IDAUTO_ADMIN_IDENTITIES` is **not** required — each suite generates a fresh throwaway token into `process.env` before loading `api.js`. Never set it manually for a test run.

### 1.1 The naming mismatch — the single most common cause of confusion

The deployment env file (mode `600`, owner of the deployment) defines:

```
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
```

The ID Auto runtime reads `IDAUTO_DB_USER` / `IDAUTO_DB_PASSWORD` / `IDAUTO_DB_NAME`. **The names do not match and nothing maps them for you.** Sourcing the `.env` alone is not enough; you must map the three names explicitly (§3, step 2).

## 2. Run as `deploy`

In the reference deployment the media root is `drwxr-x---` mode `750`, owned by the deployment user. Only that user (and root) can read or write it, so **IDA-2F and IDA-2H must run as that user**. Running them as another user produces filesystem errors that look like storage bugs.

Do **not** widen those permissions, change ownership, or add another account to the `docker` group to work around this. Run as `deploy`.

## 3. Exact command sequence

Run from the repository root as the user that owns the media directory (see §4).

```bash
cd <path-to-idauto-checkout>

# 1. Load the canonical deployment credentials.
#    Sourcing a file keeps values out of the command line and out of shell history.
set -a; . $IDAUTO_DEPLOY_ENV  # e.g. <deployment-dir>/idauto-postgres/.env; set +a

# 2. Map POSTGRES_* to the names the ID Auto runtime actually reads.
export IDAUTO_DB_HOST=127.0.0.1
export IDAUTO_DB_PORT=5432
export IDAUTO_DB_USER="$POSTGRES_USER"
export IDAUTO_DB_PASSWORD="$POSTGRES_PASSWORD"
export IDAUTO_DB_NAME="$POSTGRES_DB"
export IDAUTO_MEDIA_STORAGE_PATH="$IDAUTO_MEDIA_STORAGE_PATH"   # the deployment's media root

# 3. Confirm every variable is set WITHOUT printing any value.
for v in IDAUTO_DB_HOST IDAUTO_DB_PORT IDAUTO_DB_USER IDAUTO_DB_PASSWORD \
         IDAUTO_DB_NAME IDAUTO_MEDIA_STORAGE_PATH; do
  eval "[ -n \"\${$v}\" ]" && echo "  $v set" || echo "  $v MISSING"
done

# 4. Run the six suites and print one summary line each.
for t in ida-2a-schema-and-plate-validation ida-2c-readonly-api \
         ida-2d-write-api-and-audit ida-2f-object-storage \
         ida-2g-admin-manual-entry-ui ida-2h-review-queue-ui; do
  printf '%-38s ' "$t"
  node "tests/$t-test.js" 2>&1 | grep -E 'passed, [0-9]+ failed' | tail -1
done
```

**Expected total: 195 passed, 0 failed** — IDA-2A 44 · 2C 26 · 2D 39 · 2F 32 · 2G 17 · 2H 37.

`tests/identity-conformance-test.js` (`IDA-DECOUPLE-3`) is **not** part of this live-suite
total — it is offline and environment-free like IDA-2A, and is reported separately with its
own count: `node tests/identity-conformance-test.js` → **81 passed, 0 failed**. Do not fold
its count into the 195 above; the two totals cover different suite sets and mixing them makes
a partial run look complete.

Step 3 prints only `set` / `MISSING`. If any line says `MISSING`, stop and fix the environment — do **not** interpret the resulting test output.

### 3.1 Fallback if the `.env` is unavailable

Read the values from the running container instead. Same rule: never echo a value.

```bash
E=$(docker inspect idauto-postgres --format '{{range .Config.Env}}{{println .}}{{end}}')
export IDAUTO_DB_USER=$(echo "$E" | grep '^POSTGRES_USER=' | cut -d= -f2-)
export IDAUTO_DB_PASSWORD=$(echo "$E" | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)
export IDAUTO_DB_NAME=$(echo "$E" | grep '^POSTGRES_DB=' | cut -d= -f2-)
```

### 3.2 IDA-V12 suites (2026-09-05)

`npm run test:v12` runs `tests/ida-v12-vehicle-identification-test.js` (HTTP + database; refuses any database
not named `idauto_scratch_*`) and `tests/ida-v12-atelier-browser-test.js` (the `/atelier` page in headless
Chrome over the DevTools protocol; reports SKIPPED and exits 0 when no Chrome is on PATH). Both need the
same environment as §3. Expected: **124 passed, 0 failed** and **19 passed, 0 failed**.

## 4. What each suite touches

| Suite | Database | Media filesystem | Must run as `deploy` |
|---|---|---|---|
| **IDA-2A** — schema + plate validation | **No** | No | No |
| **IDA-2C** — read-only API | Yes | No | No |
| **IDA-2D** — write API + audit | Yes | No | No |
| **IDA-2F** — object storage | Yes | **Yes** | **Yes** |
| **IDA-2G** — admin manual entry UI | Yes | No | No |
| **IDA-2H** — review queue UI | Yes | **Yes** (media metadata) | **Yes** |
| **identity-conformance** — vocabulary artifact conformance | No | No | No |

IDA-2A is pure static analysis — it reads `schema.sql` and `plate-validator.js` from disk and requires **no** environment at all. If IDA-2A fails, the cause is real; it cannot be an environment problem. `identity-conformance` is the same kind of suite — it reads `schema.sql`, `reference/identity.js` and `protocol/vocabularies/*.json` from disk and requires no environment either.

## 5. Telling environment failure from a real regression

**Signatures of a missing/incorrect environment — not regressions:**

| Signature | Cause |
|---|---|
| `FATAL: Cannot read properties of undefined (reading '0')` | DB env missing — a query returned nothing and the suite indexed the empty result |
| `FATAL: The "path" argument must be of type string. Received undefined` | `IDAUTO_MEDIA_STORAGE_PATH` unset |
| Many `FAIL ... -> 200` assertions, plus a response body whose only field is `error` | DB unreachable; the API is returning an error envelope |
| IDA-2H `36 passed, 1 failed` where the single failure is `Detail includes allowed media metadata only` | `IDAUTO_MEDIA_STORAGE_PATH` unset — 2H reaches storage through `api.js` |
| A suite produces **no** summary line at all | It aborted on `FATAL` before reaching its summary |

**Triage in order:**

1. Re-run step 3. Any `MISSING` explains the failure — fix and re-run.
2. Run **IDA-2A** (and, for identity-related changes, **identity-conformance**) alone. Neither needs any environment. If they pass, the runtime and schema are structurally intact and your failures are almost certainly environmental.
3. Confirm the database is actually up: `docker inspect idauto-postgres --format '{{.State.Health.Status}}'` should report `healthy`.
4. Only if the environment is fully confirmed and failures persist should you treat it as a regression. Then compare against the stage baseline with an isolated worktree — per `projects/meta/known-baselines.json`, **never** classify a failure as a known baseline failure without that comparison:
   ```bash
   git worktree add /tmp/idauto-baseline <baseline-sha>
   # re-run the same suite there with the same environment, then:
   git worktree remove /tmp/idauto-baseline
   ```

## 6. Test data behaviour

- The database is **persistent**. Suites append synthetic fixtures on each run; row counts grow over time and that is expected, not a leak.
- All fixture data is synthetic. **No real personal data is present, and none may ever be introduced.**
- `idauto_audit_log` is **append-only by design**. Its rows are synthetic and are regenerated by the suites. **Never** rewrite, prune, or `DELETE` from it to "clean up" a test run.
- IDA-2F writes content-addressed files under `IDAUTO_MEDIA_STORAGE_PATH`. These accumulate; leave them in place. If the directory ever needs pruning, that is a separate, explicitly-authorised operations task — not part of a test run.
- Suites are self-contained: each generates its own admin token and its own fixtures. There is no shared setup step and no teardown to run.

## 7. Credential handling — non-negotiable

- **Never** copy a credential value into this repository, into any document, or into a commit message.
- **Never** echo, `cat`, or log a credential value. Source files and use `[ -n "$VAR" ]` presence checks, as in §3 step 3.
- **Never** pass a credential as a literal command-line argument — it lands in shell history and in `ps` output for every user on the host.
- **Never** change the credential, the database configuration, the deployment `.env`, or file ownership as part of running tests.
- Both `.env` (`600`) and the media directory (`750`) are owned by `deploy`. Preserve those modes.

## 8. Automatic test selection

Since `DEVX-1`, `projects/meta/test-impact-map.json` selects the correct suites automatically from changed files. To see what a change requires:

```bash
node scripts/mythos-stage.js close <STAGE-ID>
```

Mappings are derived from the real require graph — `api.js` requires `db.js`, `identity.js`, `storage.js`, `writes.js`; `writes.js` requires `db.js`, `storage.js`. So a change to any shared boundary selects every API-loading suite (2C/2D/2F/2G/2H), while a change to `admin-ui.js` selects only IDA-2G and a change to `review-ui.js` selects only IDA-2H.

**Rules are first-match-wins in array order.** Any new, more specific `...` rule MUST be inserted **above** the general `` rule, or it will never match. `tests/devx-1-idauto-test-impact-test.js` enforces this.
