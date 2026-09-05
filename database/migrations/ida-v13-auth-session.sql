-- =============================================================================
-- IDA-V13 — LOGIN / PASSWORD + SERVER-SIDE SESSIONS (Better Auth on PostgreSQL)
-- =============================================================================
-- Owner order, 2026-09-05: remove the manual admin access-token model for web
-- users and replace it with email + password sign-in, a server-side session
-- and an HttpOnly + Secure cookie. Better Auth (npm `better-auth`, 1.7.x)
-- owns users, password hashing (scrypt), sessions, sign-in/out, password
-- change, expiry, revocation and the login rate limit; these are its tables,
-- named with the idauto_ prefix and with the two fields IDauto adds
-- (role, org_id). Column names are Better Auth's own (camelCase, quoted).
--
-- WHAT IS NOT TOUCHED. IDAUTO_ADMIN_IDENTITIES (organisation service
-- credentials, server-to-server) and the owner-session cookie of IDA-V1B are
-- left in place; the web UI simply no longer asks for a token. Removal of the
-- manual admin token entries is a separate, later step after validation.
--
-- PURELY ADDITIVE. Five new tables, no existing row or column touched.
-- REVERSIBLE — see the DOWN block at the bottom.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_auth_user (
    "id"            TEXT         PRIMARY KEY,
    "name"          TEXT         NOT NULL,
    "email"         TEXT         NOT NULL UNIQUE,
    "emailVerified" BOOLEAN      NOT NULL DEFAULT FALSE,
    "image"         TEXT,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "role"          TEXT         NOT NULL DEFAULT 'technician',
    "org_id"        INTEGER      REFERENCES idauto_organizations(id),
    CONSTRAINT chk_auth_user_role CHECK ("role" IN ('admin','manager','technician'))
);
COMMENT ON TABLE idauto_auth_user IS
    'IDA-V13. Web users (Better Auth). role is read SERVER-SIDE only; org_id binds a manager/technician to one organisation. No password here (see idauto_auth_account).';

CREATE TABLE IF NOT EXISTS idauto_auth_session (
    "id"        TEXT         PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ  NOT NULL,
    "token"     TEXT         NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId"    TEXT         NOT NULL REFERENCES idauto_auth_user("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_idauto_auth_session_user ON idauto_auth_session ("userId");
COMMENT ON TABLE idauto_auth_session IS
    'IDA-V13. Server-side sessions. The cookie carries a signed reference to token; validity is checked here on every request. Delete a row = revoke.';

CREATE TABLE IF NOT EXISTS idauto_auth_account (
    "id"                    TEXT         PRIMARY KEY,
    "issuer"                TEXT         NOT NULL,
    "accountId"             TEXT         NOT NULL,
    "providerId"            TEXT         NOT NULL,
    "userId"                TEXT         NOT NULL REFERENCES idauto_auth_user("id") ON DELETE CASCADE,
    "accessToken"           TEXT,
    "refreshToken"          TEXT,
    "idToken"               TEXT,
    "accessTokenExpiresAt"  TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope"                 TEXT,
    "password"              TEXT,
    "createdAt"             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idauto_auth_account_user ON idauto_auth_account ("userId");
COMMENT ON COLUMN idauto_auth_account."password" IS
    'IDA-V13. scrypt hash produced by Better Auth. Never plaintext, never logged, never returned by any route.';

CREATE TABLE IF NOT EXISTS idauto_auth_verification (
    "id"         TEXT         PRIMARY KEY,
    "identifier" TEXT         NOT NULL,
    "value"      TEXT         NOT NULL,
    "expiresAt"  TIMESTAMPTZ  NOT NULL,
    "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idauto_auth_verification_identifier ON idauto_auth_verification ("identifier");

CREATE TABLE IF NOT EXISTS idauto_auth_rate_limit (
    "id"          TEXT    PRIMARY KEY,
    "key"         TEXT    NOT NULL UNIQUE,
    "count"       INTEGER NOT NULL,
    "lastRequest" BIGINT  NOT NULL
);
COMMENT ON TABLE idauto_auth_rate_limit IS
    'IDA-V13. Better Auth login/auth rate-limit counters (database storage, so every process shares them).';

-- =============================================================================
-- DOWN
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_auth_rate_limit, idauto_auth_verification,
--   idauto_auth_session, idauto_auth_account, idauto_auth_user;
