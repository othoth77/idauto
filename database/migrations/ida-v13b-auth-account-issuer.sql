-- =============================================================================
-- IDA-V13b — idauto_auth_account."issuer" is no longer required
-- =============================================================================
-- Better Auth 1.7.0 through 1.7.2 wrote a required "issuer" on every account
-- row, and ida-v13-auth-session.sql declared it NOT NULL accordingly. Better
-- Auth 1.7.3 removed that field again (the account schema is back to the 1.6
-- one), and from then on refuses to start against a database where a column
-- it never writes is NOT NULL ("Database schema mismatch ... Inserts into
-- idauto_auth_account will fail"). The dependency is raised to 1.7.7 for the
-- advisories reported against 1.7.2, so the constraint has to go first.
--
-- The column and its existing values are KEPT, only the NOT NULL is removed:
-- nothing is lost, and the previous code (Better Auth 1.7.2, which still
-- writes the value) keeps working against the migrated table. So this is safe
-- to apply BEFORE the code is deployed, and a code rollback needs no DOWN.
-- The upstream guide also names a unique index account_issuer_accountId_uidx;
-- IDauto never created one (see ida-v13-auth-session.sql), the DROP below is
-- a no-op kept for a database that Better Auth's own generator touched.
--
-- Idempotent. Apply after ida-v13-auth-session.sql.
-- =============================================================================

DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
ALTER TABLE idauto_auth_account ALTER COLUMN "issuer" DROP NOT NULL;

COMMENT ON COLUMN idauto_auth_account."issuer" IS
    'IDA-V13b. Written by Better Auth 1.7.0-1.7.2 only; unused since 1.7.3. Kept, nullable.';

-- =============================================================================
-- DOWN (only if returning to Better Auth <= 1.7.2 AND no row was written since)
-- =============================================================================
-- ALTER TABLE idauto_auth_account ALTER COLUMN "issuer" SET NOT NULL;
