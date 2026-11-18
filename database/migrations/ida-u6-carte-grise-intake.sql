-- =============================================================================
-- IDauto — Update 6 — carte grise INTAKE: a carte grise without an existing vehicle
-- =============================================================================
-- Additive and idempotent. The carte grise is an independent entry point: it is stored first (vehicle_id NULL), LENS
-- (local, on Haddad) extracts the TECHNICAL fields, an administrator reviews them, then the document is attached to the
-- vehicle with that VIN (case A), to a new vehicle (case B), or kept unassigned (case C, no VIN fabricated).
--
-- Same table as every other carte grise version (idauto_vehicle_documents): no second document system.
-- Existing rows: intake_status stays NULL (they were attached to a vehicle from the start) and nothing changes for them.
-- =============================================================================

ALTER TABLE idauto_vehicle_documents ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS intake_status  VARCHAR(24);
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS intake_fields  JSONB;          -- the fields the administrator confirmed (technical only)
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS resolved_by    VARCHAR(80);
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMPTZ;

ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_intake;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_intake CHECK (intake_status IS NULL OR intake_status IN
    ('pending_extraction', 'extraction_failed', 'pending_review', 'linked_existing_vehicle', 'vehicle_created', 'unassigned'));
-- a document without a vehicle is an intake document that is not resolved yet; a resolved one always has its vehicle
-- (IS NOT NULL is explicit: « NULL IN (…) » is NULL, which a CHECK would accept)
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_intake_vehicle;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_intake_vehicle CHECK (
    (vehicle_id IS NULL AND intake_status IS NOT NULL AND intake_status IN ('pending_extraction', 'extraction_failed', 'pending_review', 'unassigned')) OR
    (vehicle_id IS NOT NULL AND (intake_status IS NULL OR intake_status IN ('linked_existing_vehicle', 'vehicle_created'))));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_intake_fields;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_intake_fields CHECK (intake_fields IS NULL OR (jsonb_typeof(intake_fields) = 'object' AND pg_column_size(intake_fields) <= 8192));

-- one unresolved intake per file: a retry (same bytes) finds the first one, never a second row
CREATE UNIQUE INDEX IF NOT EXISTS uq_vdoc_intake_sha ON idauto_vehicle_documents (sha256) WHERE vehicle_id IS NULL AND document_type = 'carte_grise';
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_intake ON idauto_vehicle_documents (intake_status, created_at DESC) WHERE intake_status IS NOT NULL;

-- the archive record of an intake document has no vehicle yet; it gets one when the document is attached
-- (idauto_media_archive.vehicle_id is already nullable since Update 4)

-- =============================================================================
-- DOWN (manual, only while no row has vehicle_id NULL):
-- DROP INDEX uq_vdoc_intake_sha; DROP INDEX idx_idauto_vdoc_intake;
-- ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT chk_vdoc_intake_vehicle, DROP CONSTRAINT chk_vdoc_intake, DROP CONSTRAINT chk_vdoc_intake_fields;
-- ALTER TABLE idauto_vehicle_documents DROP COLUMN intake_status, DROP COLUMN intake_fields, DROP COLUMN resolved_by, DROP COLUMN resolved_at;
-- ALTER TABLE idauto_vehicle_documents ALTER COLUMN vehicle_id SET NOT NULL;
-- =============================================================================
