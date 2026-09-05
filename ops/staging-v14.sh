#!/bin/bash
# IDauto — V14 STAGING instance for the REAL ANDROID TEST (docs/REAL_ANDROID_TEST.md).
#
#   ops/staging-v14.sh start      start in the background (pid file), refuse if already running
#   ops/staging-v14.sh stop       stop it
#   ops/staging-v14.sh status     is it running? which database? which port?
#   ops/staging-v14.sh check-db   prove the database is a scratch one and not production
#   ops/staging-v14.sh user       create the tester account (manager of a test organisation)
#
# Environment file (default /home/deploy/deployments/idauto-staging/.env, mode 0600):
#   IDAUTO_DB_* for a DEDICATED role that owns ONLY the scratch database (never the
#   production role), IDAUTO_API_PORT (distinct from production's 3001),
#   IDAUTO_MEDIA_STORAGE_PATH (a scratch directory), IDAUTO_AUTH_BASE_URL, IDAUTO_COOKIE_SECURE.
# Safety: the database name MUST start with idauto_scratch_; the media path MUST NOT be the
# production media root; the Better Auth secret is generated per start (every session dies
# with the process); no organisation service credentials (IDAUTO_ADMIN_IDENTITIES = {}).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${IDAUTO_STAGING_ENV:-/home/deploy/deployments/idauto-staging/.env}"
RUN_DIR="${IDAUTO_STAGING_RUN_DIR:-/home/deploy/deployments/idauto-staging}"
PID_FILE="$RUN_DIR/staging.pid"; LOG_FILE="$RUN_DIR/staging.log"

load_env() {
  [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 2; }
  set -a; . "$ENV_FILE"; set +a
  : "${IDAUTO_DB_NAME:?}" "${IDAUTO_DB_USER:?}" "${IDAUTO_DB_PASSWORD:?}" "${IDAUTO_MEDIA_STORAGE_PATH:?}"
  case "$IDAUTO_DB_NAME" in idauto_scratch_*) ;; *) echo "refusing: IDAUTO_DB_NAME='$IDAUTO_DB_NAME' is not a scratch database (idauto_scratch_*)"; exit 2;; esac
  case "$IDAUTO_DB_USER" in idauto_staging*) ;; *) echo "refusing: IDAUTO_DB_USER must be the dedicated staging role"; exit 2;; esac
  case "$IDAUTO_MEDIA_STORAGE_PATH" in */idauto-api/media|*/idauto-api/media/) echo "refusing: media path is the production media root"; exit 2;; esac
  export IDAUTO_DB_HOST="${IDAUTO_DB_HOST:-127.0.0.1}" IDAUTO_DB_PORT="${IDAUTO_DB_PORT:-5432}" IDAUTO_API_PORT="${IDAUTO_API_PORT:-3999}"
  [ "$IDAUTO_API_PORT" != "3001" ] || { echo "refusing: port 3001 is production"; exit 2; }
  export IDAUTO_ADMIN_IDENTITIES='{}'
  # Secure cookies + mocks refused, like production, on a scratch database. IDAUTO_STAGING_INSECURE=1
  # is ONLY for the SSH-tunnel variant (plain http origin on the phone): cookies then lose `Secure`.
  if [ "${IDAUTO_STAGING_INSECURE:-0}" = "1" ]; then export NODE_ENV=staging IDAUTO_COOKIE_SECURE=0; unset IDAUTO_AUTH_BASE_URL; else export NODE_ENV=production; fi
}
running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

case "${1:-}" in
  start)
    load_env; running && { echo "already running (pid $(cat "$PID_FILE"))"; exit 0; }
    export IDAUTO_AUTH_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
    mkdir -p "$IDAUTO_MEDIA_STORAGE_PATH"
    nohup node reference/api.js >> "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE"
    sleep 1.5; running && echo "started pid $(cat "$PID_FILE") on 127.0.0.1:$IDAUTO_API_PORT, database $IDAUTO_DB_NAME, log $LOG_FILE" || { echo "failed to start — see $LOG_FILE"; tail -5 "$LOG_FILE"; exit 1; } ;;
  stop)
    running && { kill "$(cat "$PID_FILE")"; sleep 1; running && kill -9 "$(cat "$PID_FILE")" || true; rm -f "$PID_FILE"; echo "stopped"; } || { rm -f "$PID_FILE"; echo "not running"; } ;;
  status)
    load_env; if running; then echo "running pid $(cat "$PID_FILE") on 127.0.0.1:$IDAUTO_API_PORT — database $IDAUTO_DB_NAME (role $IDAUTO_DB_USER), media $IDAUTO_MEDIA_STORAGE_PATH"; curl -s -o /dev/null -w "GET /login -> %{http_code}\n" "http://127.0.0.1:$IDAUTO_API_PORT/login"; else echo "not running"; fi ;;
  check-db)
    load_env
    node -e 'var db=require("./reference/db.js");db.query("SELECT current_database() d, current_user u, (SELECT count(*)::int FROM idauto_vehicles) v, (SELECT count(*)::int FROM idauto_auth_user) users, (SELECT count(*)::int FROM idauto_vehicle_documents) docs").then(function(r){var x=r.rows[0];console.log("database="+x.d+" role="+x.u+" vehicles="+x.v+" users="+x.users+" documents="+x.docs+" scratch="+(/^idauto_scratch_/.test(x.d)));return db.closePool()}).catch(function(e){console.error("DB check failed: "+e.message);process.exit(1)})'
    echo "production reachable with this role? (must be 'no'):"; PGPASSWORD="$IDAUTO_DB_PASSWORD" docker exec -e PGPASSWORD idauto-postgres psql -U "$IDAUTO_DB_USER" -d idauto_production -Atc "select 1" >/dev/null 2>&1 && echo "YES — STOP, fix the role" || echo "no" ;;
  user)
    load_env; export IDAUTO_AUTH_SECRET="x"   # not used for provisioning
    : "${IDAUTO_TEST_EMAIL:?}" "${IDAUTO_NEW_PASSWORD:?}"
    ORG=$(node -e 'var db=require("./reference/db.js");db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($$Atelier test Android$$,$$garage$$,$$active$$) RETURNING id").then(function(r){console.log(r.rows[0].id);return db.closePool()})')
    IDAUTO_AUTH_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')" node ops/auth-users.js create --email "$IDAUTO_TEST_EMAIL" --name "Testeur Android" --role manager --org "$ORG" 2>&1 | grep -v WARN ;;
  *) echo "usage: $0 start|stop|status|check-db|user"; exit 2 ;;
esac
