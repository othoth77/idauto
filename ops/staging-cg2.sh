#!/bin/bash
# IDauto — IDA-CG2 STAGING on Haddad (owner acceptance of carte grise V2). docs/STAGING_CG2.md
#
#   ops/staging-cg2.sh init        first time: database cluster, schema, accounts, seed vehicles, samples, units
#   ops/staging-cg2.sh start       start the database and the API (user systemd units, NOT enabled at boot)
#   ops/staging-cg2.sh stop        stop both
#   ops/staging-cg2.sh status      what runs, on which port, which database, which code commit
#   ops/staging-cg2.sh check       prove the isolation (scratch database, own media, no production setting)
#   ops/staging-cg2.sh reset       erase EVERYTHING staging holds (database + media) and seed it again
#   ops/staging-cg2.sh backup-drill copy every referenced image out, verify, restore into an empty root, compare (D6)
#   ops/staging-cg2.sh tailnet-on  OWNER STEP — publish on the tailnet: https://<host>.<tailnet>.ts.net:8443
#   ops/staging-cg2.sh tailnet-off OWNER STEP — withdraw it (local only again)
#
# Isolation by construction: its own PostgreSQL cluster (port 55440, own data directory, own
# superuser and app role), database idauto_scratch_cg2_staging, its own media directory, no
# organisation service tokens (IDAUTO_ADMIN_IDENTITIES={}), no provider credentials, 127.0.0.1
# only. It never reads a production setting: the API's environment is the generated
# $CONF/staging.env (0600) and nothing else.
set -euo pipefail
CODE="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${IDAUTO_STAGING_HOME:-$HOME/.local/share/idauto-staging}"
CONF="${IDAUTO_STAGING_CONF:-$HOME/.config/idauto-staging}"
PG_BIN="${IDAUTO_STAGING_PG_BIN:-$STATE/pg/bin}"
PG_LIB="$(dirname "$PG_BIN")/lib"
PGDATA="$STATE/pgdata" SOCK="$STATE/sock" MEDIA="$STATE/media" SAMPLES="$STATE/samples"
ENV_FILE="$CONF/staging.env" SUPER_PW="$CONF/pg-superuser.pw" ACCOUNTS="$CONF/ACCOUNTS.txt"
DB_PORT=55440 API_PORT=8805 TAILNET_PORT=8443
DB_NAME=idauto_scratch_cg2_staging DB_ROLE=idauto_staging_cg2
UNITS="$HOME/.config/systemd/user"
MIGRATIONS="schema.sql migrations/ida-3a-ingestion-schema.sql migrations/ida4-option-c-ivid.sql migrations/ida-v4-verification-scope-separation.sql
  migrations/ida-v8-identity-resolution.sql migrations/ida-v9-organisation-scoped-access.sql migrations/ida-v10-vehicle-search.sql
  migrations/ida-v12-vehicle-identification.sql migrations/ida-v13-auth-session.sql migrations/ida-v14-registration-document.sql
  migrations/ida-cg2-registration-submissions.sql"
NODE="$(command -v node)"

say() { echo "[staging-cg2] $*"; }
die() { echo "[staging-cg2] REFUSED: $*" >&2; exit 2; }
rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }
pg() { LD_LIBRARY_PATH="$PG_LIB" "$PG_BIN/$1" "${@:2}"; }

guard() {
  [ -x "$PG_BIN/postgres" ] || die "no PostgreSQL binaries in $PG_BIN (see docs/STAGING_CG2.md §2)"
  case "$STATE" in */idauto-api/*|/home/deploy/*) die "state directory looks like production: $STATE";; esac
  [ "$API_PORT" != "3001" ] || die "port 3001 is production"
}
load_env() {
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE — run init first"
  set -a; . "$ENV_FILE"; set +a
  case "$IDAUTO_DB_NAME" in idauto_scratch_cg2_*) ;; *) die "IDAUTO_DB_NAME is not the staging database";; esac
  [ "$IDAUTO_DB_PORT" = "$DB_PORT" ] || die "IDAUTO_DB_PORT is not the staging cluster's"
  [ "$IDAUTO_MEDIA_STORAGE_PATH" = "$MEDIA" ] || die "media path is not the staging one"
}
psql_node() { # psql_node <database> <sql> — as the cluster superuser, over 127.0.0.1
  PGSUPER="$(cat "$SUPER_PW")" DBN="$1" SQL="$2" "$NODE" -e '
    const { Client } = require(process.argv[1] + "/node_modules/pg");
    const c = new Client({ host: "127.0.0.1", port: '"$DB_PORT"', user: "postgres", password: process.env.PGSUPER, database: process.env.DBN });
    c.connect().then(() => c.query(process.env.SQL)).then(r => { (Array.isArray(r) ? r : [r]).forEach(x => (x.rows || []).forEach(row => console.log(Object.values(row).join("|")))); return c.end(); })
      .catch(e => { console.error("sql failed: " + e.message); process.exit(1); });' "$CODE"
}
write_units() {
  mkdir -p "$UNITS"
  cat > "$UNITS/idauto-staging-db.service" <<EOF
[Unit]
Description=IDauto CG2 STAGING — PostgreSQL (port $DB_PORT, scratch data only)
[Service]
Type=simple
Environment=LD_LIBRARY_PATH=$PG_LIB
ExecStart=$PG_BIN/postgres -D $PGDATA -p $DB_PORT -k $SOCK -c listen_addresses=127.0.0.1 -c shared_buffers=32MB -c max_connections=25 -c work_mem=4MB
MemoryMax=320M
Restart=on-failure
EOF
  cat > "$UNITS/idauto-staging-api.service" <<EOF
[Unit]
Description=IDauto CG2 STAGING — API + web (127.0.0.1:$API_PORT, code $CODE)
Requires=idauto-staging-db.service
After=idauto-staging-db.service
[Service]
Type=simple
WorkingDirectory=$CODE
EnvironmentFile=$ENV_FILE
ExecStart=$NODE reference/api.js
MemoryMax=400M
Restart=on-failure
EOF
  systemctl --user daemon-reload
}
wait_db() { for i in $(seq 1 60); do pg pg_ctl -D "$PGDATA" status >/dev/null 2>&1 && psql_node postgres "SELECT 1" >/dev/null 2>&1 && return 0; sleep 1; done; die "database did not come up"; }
wait_api() { for i in $(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$API_PORT/login" && return 0; sleep 1; done; die "API did not answer on 127.0.0.1:$API_PORT (journalctl --user -u idauto-staging-api)"; }

schema_and_seed() {
  psql_node postgres "CREATE DATABASE $DB_NAME OWNER $DB_ROLE" >/dev/null
  load_env
  for f in $MIGRATIONS; do
    F="$CODE/database/$f" "$NODE" -e '
      const { Client } = require(process.argv[1] + "/node_modules/pg"); const fs = require("fs");
      const c = new Client({ host: "127.0.0.1", port: +process.env.IDAUTO_DB_PORT, user: process.env.IDAUTO_DB_USER, password: process.env.IDAUTO_DB_PASSWORD, database: process.env.IDAUTO_DB_NAME });
      c.connect().then(() => c.query(fs.readFileSync(process.env.F, "utf8"))).then(() => c.end()).catch(e => { console.error("migration failed: " + process.env.F + ": " + e.message); process.exit(1); });' "$CODE"
  done
  say "schema: $(echo $MIGRATIONS | wc -w) files applied to $DB_NAME"
  mkdir -p "$MEDIA" && chmod 0700 "$MEDIA"
  IDAUTO_STAGING=1 IDAUTO_STAGING_ACCOUNTS="$ACCOUNTS" "$NODE" "$CODE/ops/staging-cg2-seed.js"
}

case "${1:-}" in
  init)
    guard
    [ ! -e "$PGDATA" ] || die "$PGDATA exists — use reset (erases staging) or start"
    mkdir -p "$STATE" "$CONF" "$SOCK" && chmod 0700 "$STATE" "$CONF" "$SOCK"
    umask 077
    rand 40 > "$SUPER_PW"
    pg initdb -D "$PGDATA" -U postgres -A scram-sha-256 --pwfile="$SUPER_PW" -E UTF8 --locale=C >/dev/null
    cat > "$ENV_FILE" <<EOF
# IDauto CG2 STAGING — generated by ops/staging-cg2.sh init. Synthetic data only. Mode 0600.
IDAUTO_DB_HOST=127.0.0.1
IDAUTO_DB_PORT=$DB_PORT
IDAUTO_DB_USER=$DB_ROLE
IDAUTO_DB_PASSWORD=$(rand 40)
IDAUTO_DB_NAME=$DB_NAME
IDAUTO_API_PORT=$API_PORT
IDAUTO_MEDIA_STORAGE_PATH=$MEDIA
IDAUTO_AUTH_SECRET=$(rand 48)
IDAUTO_ADMIN_IDENTITIES={}
# Haddad is memory- and I/O-constrained: keep pool connections longer, wait longer for a new one.
IDAUTO_DB_IDLE_TIMEOUT_MS=600000
IDAUTO_DB_CONNECT_TIMEOUT_MS=30000
NODE_ENV=staging
IDAUTO_COOKIE_SECURE=0
IDAUTO_AUTH_BASE_URL=http://127.0.0.1:$API_PORT
EOF
    write_units
    systemctl --user start idauto-staging-db.service; wait_db
    psql_node postgres "CREATE ROLE $DB_ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$(grep ^IDAUTO_DB_PASSWORD= "$ENV_FILE" | cut -d= -f2)'" >/dev/null
    schema_and_seed
    if [ -n "${CHROME:-}" ] || command -v chromium >/dev/null || command -v google-chrome >/dev/null; then "$NODE" "$CODE/ops/staging-cg2-samples.js" "$SAMPLES"; else say "no Chrome on PATH: samples not drawn (CHROME=… $0 samples)"; fi
    systemctl --user start idauto-staging-api.service; wait_api
    say "ready: http://127.0.0.1:$API_PORT/login — accounts in $ACCOUNTS (0600), samples in $SAMPLES" ;;
  samples) "$NODE" "$CODE/ops/staging-cg2-samples.js" "$SAMPLES" ;;
  backup-drill)
    load_env; D="$STATE/backup-drills/$(date -u +%Y%m%dT%H%M%SZ)"; umask 077; mkdir -p "$D"
    "$NODE" "$CODE/ops/staging-cg2-backup-drill.js" "$D" ;;
  start) guard; load_env; systemctl --user start idauto-staging-db.service; wait_db; systemctl --user start idauto-staging-api.service; wait_api; say "running: $IDAUTO_AUTH_BASE_URL" ;;
  stop) systemctl --user stop idauto-staging-api.service idauto-staging-db.service 2>/dev/null || true; say "stopped" ;;
  status)
    load_env
    for u in idauto-staging-db idauto-staging-api; do printf '%-20s %s\n' "$u" "$(systemctl --user is-active $u.service 2>/dev/null || true)"; done
    say "code $(git -C "$CODE" rev-parse --short HEAD) ($(git -C "$CODE" log -1 --format=%s | cut -c1-70))"
    say "origin $IDAUTO_AUTH_BASE_URL — database $IDAUTO_DB_NAME on 127.0.0.1:$DB_PORT — media $MEDIA ($(du -sh "$MEDIA" 2>/dev/null | cut -f1))"
    curl -s -o /dev/null -w "[staging-cg2] GET /login -> %{http_code}\n" "http://127.0.0.1:$API_PORT/login" || true ;;
  check)
    load_env
    say "database: $(psql_node "$DB_NAME" "SELECT current_database()||' role='||(SELECT string_agg(rolname,',') FROM pg_roles WHERE rolcanlogin AND rolname<>'postgres')||' users='||(SELECT count(*) FROM idauto_auth_user)||' vehicles='||(SELECT count(*) FROM idauto_vehicles)||' submissions='||(SELECT count(*) FROM idauto_registration_submissions)")"
    psql_node postgres "SELECT datname FROM pg_database WHERE datname LIKE 'idauto%' AND datname <> '$DB_NAME'" | grep -q . && die "another IDauto database exists in the staging cluster" || say "cluster holds only $DB_NAME (no production database)"
    [ "$IDAUTO_ADMIN_IDENTITIES" = "{}" ] && say "no service tokens (IDAUTO_ADMIN_IDENTITIES={})" || die "service tokens configured"
    grep -qE '^IDAUTO_(VEHICLE_PROVIDER|TECDOC)_' "$ENV_FILE" && die "provider credentials present" || say "no provider credentials"
    case "$IDAUTO_MEDIA_STORAGE_PATH" in "$STATE"/*) say "media is staging-only: $IDAUTO_MEDIA_STORAGE_PATH";; *) die "media outside $STATE";; esac
    ss -ltn 2>/dev/null | grep -qE "(0\.0\.0\.0|\*|\[::\]):($API_PORT|$DB_PORT)\b" && die "a staging port listens beyond 127.0.0.1" || say "API and database listen on 127.0.0.1 only" ;;
  reset)
    guard; load_env
    [ "${2:-}" = "--yes" ] || { echo "reset ERASES the staging database and media (synthetic data). Run: $0 reset --yes"; exit 2; }
    systemctl --user stop idauto-staging-api.service 2>/dev/null || true
    systemctl --user start idauto-staging-db.service; wait_db
    psql_node postgres "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" >/dev/null
    case "$MEDIA" in "$STATE"/media) rm -rf -- "$MEDIA";; *) die "refusing to erase $MEDIA";; esac
    schema_and_seed
    systemctl --user start idauto-staging-api.service; wait_api
    say "reset done: fresh database, empty media, new passwords in $ACCOUNTS" ;;
  tailnet-on)
    load_env
    HOST="$(tailscale status --self --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
    URL="https://$HOST:$TAILNET_PORT"
    tailscale serve --bg --https=$TAILNET_PORT "http://127.0.0.1:$API_PORT"
    sed -i "s|^IDAUTO_AUTH_BASE_URL=.*|IDAUTO_AUTH_BASE_URL=$URL|; s|^IDAUTO_COOKIE_SECURE=.*|IDAUTO_COOKIE_SECURE=1|" "$ENV_FILE"
    systemctl --user restart idauto-staging-api.service; wait_api
    say "published on the tailnet only: $URL/login (existing tailscale serve paths untouched)" ;;
  tailnet-off)
    tailscale serve --https=$TAILNET_PORT off || true
    sed -i "s|^IDAUTO_AUTH_BASE_URL=.*|IDAUTO_AUTH_BASE_URL=http://127.0.0.1:$API_PORT|; s|^IDAUTO_COOKIE_SECURE=.*|IDAUTO_COOKIE_SECURE=0|" "$ENV_FILE"
    systemctl --user restart idauto-staging-api.service 2>/dev/null || true
    say "withdrawn from the tailnet; local only (http://127.0.0.1:$API_PORT)" ;;
  *) echo "usage: $0 init|start|stop|status|check|reset --yes|samples|backup-drill|tailnet-on|tailnet-off"; exit 2 ;;
esac
