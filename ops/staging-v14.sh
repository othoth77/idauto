#!/bin/bash
# IDauto — start the V14 branch as a TEST instance (never production) for the
# REAL ANDROID TEST (docs/REAL_ANDROID_TEST.md). Scratch database only,
# loopback only, throwaway auth secret, one manager account for the tester.
#
#   IDAUTO_DEPLOY_ENV=/path/to/idauto-postgres/.env \
#   IDAUTO_DB_NAME=idauto_scratch_final \
#   IDAUTO_MEDIA_STORAGE_PATH=/path/to/a/scratch/media/dir \
#   IDAUTO_TEST_EMAIL=testeur@idauto.test IDAUTO_NEW_PASSWORD='<12+ chars>' \
#   ops/staging-v14.sh
#
# Then expose 127.0.0.1:3999 to the phone (see the runbook): a staging TLS
# vhost, or an SSH tunnel + Android's "insecure origin treated as secure" flag.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${IDAUTO_DEPLOY_ENV:-}" ] && { set -a; . "$IDAUTO_DEPLOY_ENV"; set +a; export IDAUTO_DB_USER="${POSTGRES_USER}" IDAUTO_DB_PASSWORD="${POSTGRES_PASSWORD}"; unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; }
export IDAUTO_DB_HOST="${IDAUTO_DB_HOST:-127.0.0.1}" IDAUTO_DB_PORT="${IDAUTO_DB_PORT:-5432}"
: "${IDAUTO_DB_NAME:?set IDAUTO_DB_NAME to a scratch database (idauto_scratch_*)}"
case "$IDAUTO_DB_NAME" in idauto_scratch_*) ;; *) echo "refusing: IDAUTO_DB_NAME must start with idauto_scratch_"; exit 2;; esac
: "${IDAUTO_MEDIA_STORAGE_PATH:?set IDAUTO_MEDIA_STORAGE_PATH to a scratch directory}"
export IDAUTO_API_PORT="${IDAUTO_API_PORT:-3999}"
export IDAUTO_AUTH_SECRET="${IDAUTO_AUTH_SECRET:-$(head -c 48 /dev/urandom | base64 | tr -d '\n')}"
export IDAUTO_ADMIN_IDENTITIES='{}'
if [ -n "${IDAUTO_TEST_EMAIL:-}" ] && [ -n "${IDAUTO_NEW_PASSWORD:-}" ]; then
  ORG=$(node -e 'var db=require("./reference/db.js");db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($$Atelier test Android$$,$$garage$$,$$active$$) RETURNING id").then(function(r){console.log(r.rows[0].id);return db.closePool()})')
  node ops/auth-users.js create --email "$IDAUTO_TEST_EMAIL" --name "Testeur Android" --role manager --org "$ORG" 2>&1 | grep -v WARN || true
fi
echo "IDauto V14 test instance on http://127.0.0.1:${IDAUTO_API_PORT}  (database ${IDAUTO_DB_NAME}) — Ctrl+C to stop"
exec node reference/api.js
