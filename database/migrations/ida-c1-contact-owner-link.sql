-- =============================================================================
-- IDauto — CONTACT integration, step 1 — owner rows can carry a CONTACT id (2026-11-20)
-- =============================================================================
-- DRAFT. Not applied to any database. Additive and idempotent (safe to apply twice).
-- No existing row is changed: every existing owner row keeps its full_name and gets
-- contact_id NULL, contact_sync_pending FALSE.
--
-- CONTACT (https://github.com/othoth77/contact) is the Mythos master contact registry and
-- the single owner of person identity (CNT000001 ids). IDauto integrates in modes
-- (IDAUTO_CONTACT_MODE, reference/contact/owner-identity.js):
--   * shadow        — the local owner row stays authoritative; after the commit the owner is
--                     resolved in CONTACT and its CNT is stored in contact_id. CONTACT
--                     unavailable → contact_sync_pending = TRUE (retried later), the request
--                     still succeeds.
--   * authoritative — NOT enabled anywhere. The row stores only contact_id: full_name (and
--                     phone, e-mail, address, notes) stay NULL. Hence full_name becomes
--                     nullable, with a CHECK that a row always has a name OR a CNT.
-- The local table is NOT dropped here: that is blocked until CONTACT is deployed and the
-- backfill is verified (before/after counts).
-- =============================================================================

ALTER TABLE idauto_vehicle_owner_contacts ADD COLUMN IF NOT EXISTS contact_id VARCHAR(20);
ALTER TABLE idauto_vehicle_owner_contacts ADD COLUMN IF NOT EXISTS contact_sync_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE idauto_vehicle_owner_contacts DROP CONSTRAINT IF EXISTS chk_owner_contact_cnt;
ALTER TABLE idauto_vehicle_owner_contacts ADD CONSTRAINT chk_owner_contact_cnt
    CHECK (contact_id IS NULL OR contact_id ~ '^CNT[0-9]{6,}$');

-- authoritative rows: CNT only, no local personal data
ALTER TABLE idauto_vehicle_owner_contacts ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE idauto_vehicle_owner_contacts DROP CONSTRAINT IF EXISTS chk_owner_contact_name;
ALTER TABLE idauto_vehicle_owner_contacts ADD CONSTRAINT chk_owner_contact_name
    CHECK (full_name IS NULL OR length(btrim(full_name)) >= 2);
ALTER TABLE idauto_vehicle_owner_contacts DROP CONSTRAINT IF EXISTS chk_owner_contact_identity;
ALTER TABLE idauto_vehicle_owner_contacts ADD CONSTRAINT chk_owner_contact_identity
    CHECK (full_name IS NOT NULL OR contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_owner_contact_cnt ON idauto_vehicle_owner_contacts (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_contact_sync_pending ON idauto_vehicle_owner_contacts (id) WHERE contact_sync_pending AND superseded_at IS NULL;

-- =============================================================================
-- DOWN (manual; only while no row has full_name NULL, i.e. authoritative mode was never used):
-- DROP INDEX IF EXISTS idx_owner_contact_sync_pending; DROP INDEX IF EXISTS idx_owner_contact_cnt;
-- ALTER TABLE idauto_vehicle_owner_contacts DROP CONSTRAINT IF EXISTS chk_owner_contact_identity, DROP CONSTRAINT IF EXISTS chk_owner_contact_cnt;
-- ALTER TABLE idauto_vehicle_owner_contacts DROP CONSTRAINT IF EXISTS chk_owner_contact_name;
-- ALTER TABLE idauto_vehicle_owner_contacts ADD CONSTRAINT chk_owner_contact_name CHECK (length(btrim(full_name)) >= 2);
-- ALTER TABLE idauto_vehicle_owner_contacts ALTER COLUMN full_name SET NOT NULL;
-- ALTER TABLE idauto_vehicle_owner_contacts DROP COLUMN IF EXISTS contact_sync_pending, DROP COLUMN IF EXISTS contact_id;
-- =============================================================================
