-- IDA-4 Option C: adds the IVID column to idauto_vehicles.
-- A5 OPTION C, 2026-08-19 — owner-approved zero-account public passport
-- surface (docs/IDA4_READINESS_AUDIT.md §A5; the owner decision text is
-- quoted verbatim in that document's Option C note). This migration is
-- the ONLY schema change Option C requires: one nullable, unique column.
-- No new table. No person/citizen table. No PII column anywhere.
--
-- idauto_vehicles already has no owner-PII columns (§7 of schema.sql,
-- "[NO PII]") — this migration does not change that invariant. `ivid` is
-- a credential-shaped identifier (reference/ivid.js format
-- ivid:1:<16-symbol payload>:<2-symbol check>), never a person or plate
-- identifier — see reference/ivid-issuance.js's header for the
-- permanence rule this column backs.
--
-- Additive-only, idempotent: ADD COLUMN IF NOT EXISTS, so applying this
-- file twice against the same database is a no-op the second time (see
-- tests/ida4-option-c-test.js's migration-idempotence case).

BEGIN;

ALTER TABLE idauto_vehicles ADD COLUMN IF NOT EXISTS ivid VARCHAR(40) UNIQUE;

COMMENT ON COLUMN idauto_vehicles.ivid IS
    'IDA-4 Option C — public credential identifier (reference/ivid.js format). Permanent once issued; never overwritten. Never a plate or person identifier. NULL until reference/ivid-issuance.js issues one.';

COMMIT;
