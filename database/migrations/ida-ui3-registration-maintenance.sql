-- =============================================================================
-- IDauto — IDA-UI-3 — manual vehicle registration, private owner contact,
-- maintenance part source (2026-11-05)
-- =============================================================================
-- Additive and idempotent (safe to apply twice). No existing row is changed.
--
-- 1. idauto_vehicle_owner_contacts — the owner's name and contact, PRIVATE.
--    Owner decision 2026-11-05 (reverses docs/PRIVACY_ARCHITECTURE.md §1/§3
--    "no owner data"): a workshop may record the owner of a vehicle it handles,
--    as its own client record. Rules, enforced in code and tests:
--      * a separate table — never a column of idauto_vehicles, never joined by
--        the passport, the public routes, the registry search or the audit log;
--      * visible only to the organisation that recorded it, and to admins;
--      * every read is audited (event vehicle.owner.read, no personal data in
--        the audit row); a change supersedes the previous row (history kept).
-- 2. idauto_workshop_operations — what was done and with which part: the part
--    SOURCE chosen by the technician (declared, not proven: a sale by the shop
--    is claimed only by an invoice, which IDauto does not hold), condition,
--    free-text label/reference for a part outside the catalogue, date, notes.
-- 3. identification_method 'manual_registration' (the manual registration form).
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_vehicle_owner_contacts (
    id                BIGSERIAL PRIMARY KEY,
    vehicle_id        INTEGER NOT NULL REFERENCES idauto_vehicles(id),
    org_id            INTEGER REFERENCES idauto_organizations(id),   -- NULL = recorded by an administrator
    full_name         VARCHAR(120) NOT NULL,
    phone             VARCHAR(30),
    phone_normalized  VARCHAR(20),
    email             VARCHAR(160),
    address           VARCHAR(240),
    notes             VARCHAR(300),
    created_by        VARCHAR(80) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_at     TIMESTAMPTZ,
    superseded_by     VARCHAR(80),
    CONSTRAINT chk_owner_contact_name CHECK (length(btrim(full_name)) >= 2),
    CONSTRAINT chk_owner_contact_phone CHECK (phone_normalized IS NULL OR phone_normalized ~ '^\+?[0-9]{6,15}$')
);
-- One current contact per vehicle and organisation (admin entries: org_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_contact_current ON idauto_vehicle_owner_contacts (vehicle_id, COALESCE(org_id, 0)) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_contact_org_phone ON idauto_vehicle_owner_contacts (org_id, phone_normalized) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_contact_org_name ON idauto_vehicle_owner_contacts (org_id, lower(full_name) text_pattern_ops) WHERE superseded_at IS NULL;

ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS part_source VARCHAR(24);
ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS part_condition VARCHAR(8);
ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS part_label VARCHAR(120);
ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS part_reference_text VARCHAR(60);
ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS performed_on DATE;
ALTER TABLE idauto_workshop_operations ADD COLUMN IF NOT EXISTS notes VARCHAR(500);
ALTER TABLE idauto_workshop_operations DROP CONSTRAINT IF EXISTS chk_workshop_op_part_source;
ALTER TABLE idauto_workshop_operations ADD CONSTRAINT chk_workshop_op_part_source
    CHECK (part_source IS NULL OR part_source IN ('our_shop', 'customer_supplied', 'external_supplier'));
ALTER TABLE idauto_workshop_operations DROP CONSTRAINT IF EXISTS chk_workshop_op_part_condition;
ALTER TABLE idauto_workshop_operations ADD CONSTRAINT chk_workshop_op_part_condition
    CHECK (part_condition IS NULL OR part_condition IN ('new', 'used'));
CREATE INDEX IF NOT EXISTS idx_workshop_op_part_source ON idauto_workshop_operations (part_source) WHERE part_source IS NOT NULL;

ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_ident_method;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_ident_method
    CHECK (identification_method IS NULL OR identification_method IN
        ('plate_ocr','plate_manual','vin','manual_selection','provider','import','admin','carte_grise_ocr','manual_registration'));

-- =============================================================================
-- DOWN (manual; removes the owner contacts — personal data — and the new columns)
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_vehicle_owner_contacts;
-- ALTER TABLE idauto_workshop_operations DROP CONSTRAINT IF EXISTS chk_workshop_op_part_source, DROP CONSTRAINT IF EXISTS chk_workshop_op_part_condition,
--   DROP COLUMN IF EXISTS part_source, DROP COLUMN IF EXISTS part_condition, DROP COLUMN IF EXISTS part_label,
--   DROP COLUMN IF EXISTS part_reference_text, DROP COLUMN IF EXISTS performed_on, DROP COLUMN IF EXISTS notes;
-- (identification_method: restore the IDA-V14 list once no row uses 'manual_registration'.)
