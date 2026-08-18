'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-3A ingestion schema tests
// tests/ida-3a-ingestion-schema-test.js
//
// Deterministic, offline, static/textual validation only.
// No PostgreSQL connection, migration execution, network access,
// package dependency, or environment variable is required.
//
// Run with: node tests/ida-3a-ingestion-schema-test.js
// =====================================================

var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var SCHEMA_PATH = path.join(BASE, 'database', 'schema.sql');
var MIGRATION_PATH = path.join(BASE, 'database', 'migrations', 'ida-3a-ingestion-schema.sql');
var schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
var migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

function tableBody(sql, tableName) {
  var match = sql.match(new RegExp('CREATE TABLE(?: IF NOT EXISTS)? ' + tableName + ' \\(([\\s\\S]*?)\\n\\);'));
  return match ? match[1] : '';
}

function checkRequiredDefinitions(sql, label) {
  var submissions = tableBody(sql, 'idauto_submissions');
  var counters = tableBody(sql, 'idauto_rate_limit_counters');

  ok(!!submissions, label + ': idauto_submissions table is defined');
  ok(/id\s+BIGSERIAL\s+PRIMARY KEY/.test(submissions), label + ': submissions id is BIGSERIAL PRIMARY KEY');
  ok(/idempotency_key\s+VARCHAR\(64\)\s+NOT NULL UNIQUE/.test(submissions), label + ': idempotency key is required and unique');
  ok(/actor_ref\s+VARCHAR\(64\)(?:\s+NULL)?,(?:\s+--[^\n]*)?\n/.test(submissions), label + ': actor_ref is nullable VARCHAR(64)');
  ok(/actor_type\s+VARCHAR\(20\)\s+NOT NULL/.test(submissions), label + ': actor_type is required');
  ok(/actor_type IN \('system','contributor','professional_user','admin','anonymous'\)/.test(submissions), label + ': actor types are exactly the five binding values');
  ok(/capture_source_id\s+INTEGER(?:\s+NULL)?\s+REFERENCES idauto_capture_sources\(id\)/.test(submissions), label + ': capture source is a nullable default-behaviour foreign key');
  ok(/ip_hash\s+VARCHAR\(64\)(?:\s+NULL)?,(?:\s+--[^\n]*)?\n/.test(submissions), label + ': ip_hash is nullable and no raw IP column exists');
  ok(/received_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT NOW\(\)/i.test(submissions), label + ': received_at defaults to now()');
  ok(/status\s+VARCHAR\(20\)\s+NOT NULL\s+DEFAULT 'pending'/.test(submissions), label + ': submission status defaults to pending');
  ok(/status IN \('pending','accepted','rejected','duplicate'\)/.test(submissions), label + ': submission statuses are exactly the four binding values');
  ok(/observation_id\s+BIGINT(?:\s+NULL)?\s+REFERENCES idauto_observations\(id\)/.test(submissions), label + ': observation link is a nullable default-behaviour foreign key');

  ok(!!counters, label + ': idauto_rate_limit_counters table is defined');
  ok(/bucket_key\s+VARCHAR\(64\)\s+NOT NULL/.test(counters), label + ': bucket_key is required VARCHAR(64)');
  ok(/window_start\s+TIMESTAMPTZ\s+NOT NULL/.test(counters), label + ': window_start is required TIMESTAMPTZ');
  ok(/count\s+INTEGER\s+NOT NULL DEFAULT 0/.test(counters), label + ': counter starts at zero');
  ok(/PRIMARY KEY \(bucket_key, window_start\)/.test(counters), label + ': counter uses the required composite primary key');
}

console.log('\n1. SOURCE SCHEMA — exact IDA-3A definitions');
checkRequiredDefinitions(schema, 'Source schema');
ok(/derived_from_media_id\s+BIGINT(?:\s+NULL)?\s+REFERENCES idauto_observation_media\(id\)/.test(tableBody(schema, 'idauto_observation_media')),
  'Source schema: media provenance is a nullable self-reference with no default');
ok((schema.match(/CREATE INDEX idx_idauto_submissions_(?:ip_hash|status|observation_id)/g) || []).length === 3,
  'Source schema: all three required submission indexes exist');

console.log('\n2. MIGRATION — additive, idempotent, transactional definitions');
checkRequiredDefinitions(migration, 'Migration');
ok(/^BEGIN;[\s\S]*COMMIT;\s*$/.test(migration.replace(/^--.*\n/gm, '').trim()),
  'Migration: all statements are wrapped in one BEGIN/COMMIT transaction');
ok((migration.match(/CREATE TABLE IF NOT EXISTS idauto_/g) || []).length === 2,
  'Migration: both and only both new tables use IF NOT EXISTS');
ok(/ADD COLUMN IF NOT EXISTS derived_from_media_id BIGINT NULL\s+REFERENCES idauto_observation_media\(id\)/.test(migration),
  'Migration: nullable media self-reference is added idempotently with no default or backfill');
ok((migration.match(/CREATE INDEX IF NOT EXISTS idx_idauto_submissions_(?:ip_hash|status|observation_id)/g) || []).length === 3,
  'Migration: all three required indexes are idempotent');
ok(migration.indexOf('IDA-3A') !== -1 && migration.indexOf('docs/INGESTION_ARCHITECTURE.md') !== -1 && /additive-only/i.test(migration),
  'Migration: header names the stage, binding design, and additive-only scope');

console.log('\n3. SAFETY — no destructive or out-of-scope SQL');
var changedSql = tableBody(schema, 'idauto_submissions') + '\n'
  + tableBody(schema, 'idauto_rate_limit_counters') + '\n'
  + migration;
var destructive = /\b(?:DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b|ALTER\s+COLUMN\s+\w+\s+TYPE\b/i;
ok(!destructive.test(changedSql), 'No DROP, DELETE, TRUNCATE, UPDATE, RENAME, or ALTER COLUMN TYPE');
ok(!/ON DELETE (?:CASCADE|SET NULL)/i.test(changedSql), 'No destructive foreign-key delete behaviour');
ok(!/\braw_ip\b|\bip_address\b/i.test(changedSql), 'No raw IP storage column');
var migrationTables = (migration.match(/CREATE TABLE IF NOT EXISTS (\w+)/g) || []).map(function (line) {
  return line.replace('CREATE TABLE IF NOT EXISTS ', '');
});
ok(migrationTables.join(',') === 'idauto_submissions,idauto_rate_limit_counters',
  'Migration creates no table outside the approved pair');
ok(!/idauto_verifications|Redis/i.test(migration), 'Migration does not overload verifications or introduce Redis');
ok(!/require\(['"](?:pg|http|https)['"]\)|process\.env|\.query\s*\(/.test(fs.readFileSync(__filename, 'utf8')),
  'Test has no database, network, query, or environment dependency');

console.log('\nStage IDA-3A ingestion schema: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
