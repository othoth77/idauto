-- =============================================================================
-- IDauto — Update 5 — carte grise capture: camera, upload (image / PDF), paste (image / text)
-- =============================================================================
-- Additive and idempotent. Existing rows keep their meaning: an existing carte grise face is an
-- image (source_format CARTE_GRISE_IMAGE, input_method 'legacy'), accepted, not sent to LENS.
--
-- Document CAPTURE and STORAGE only. No OCR and no extraction happen in IDauto: every new
-- source document is stored as it was given and marked PENDING_LENS. The LENS columns below
-- are the place the future LENS results will be kept (owner decision 2026-11-18: LENS is not
-- integrated yet); they stay empty until then.
-- =============================================================================

ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS source_format       VARCHAR(24)  NOT NULL DEFAULT 'CARTE_GRISE_IMAGE';
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS input_method        VARCHAR(16)  NOT NULL DEFAULT 'legacy';
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS derived_storage_key TEXT;            -- the corrected crop of a photographed card (the original stays in storage_key)
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS text_chars          INTEGER;         -- CARTE_GRISE_TEXT: number of characters (the text itself is the stored file)
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS review_status       VARCHAR(16)  NOT NULL DEFAULT 'accepted';
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS reviewed_by         VARCHAR(80);
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ;
-- processing by LENS (future): status, job, results, version, time, validation
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS processing_status   VARCHAR(16)  NOT NULL DEFAULT 'NONE';
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS lens_job_ref        VARCHAR(128);
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS lens_extraction     JSONB;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS extraction_version  VARCHAR(64);
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS processed_at        TIMESTAMPTZ;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS validation_status   VARCHAR(20)  NOT NULL DEFAULT 'NOT_VALIDATED';

ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_source_format;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_source_format CHECK (source_format IN ('CARTE_GRISE_IMAGE', 'CARTE_GRISE_PDF', 'CARTE_GRISE_TEXT'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_input_method;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_input_method CHECK (input_method IN ('legacy', 'camera', 'upload', 'paste_image', 'paste_text'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_review;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_review CHECK (review_status IN ('accepted', 'pending_review', 'rejected'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_processing;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_processing CHECK (processing_status IN ('NONE', 'PENDING_LENS', 'PROCESSING', 'DONE', 'FAILED'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_validation;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_validation CHECK (validation_status IN ('NOT_VALIDATED', 'VALIDATED', 'CORRECTED', 'REJECTED'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_lens;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_lens CHECK (lens_extraction IS NULL OR (jsonb_typeof(lens_extraction) = 'object' AND pg_column_size(lens_extraction) <= 65536));
-- an image has dimensions; a PDF or a text has none (width / height 0)
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_size;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_size CHECK (byte_size > 0 AND width >= 0 AND height >= 0 AND (mime_type NOT LIKE 'image/%' OR (width > 0 AND height > 0)));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_format_mime;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_format_mime CHECK (
    (source_format = 'CARTE_GRISE_IMAGE' AND mime_type LIKE 'image/%') OR
    (source_format = 'CARTE_GRISE_PDF'   AND mime_type = 'application/pdf') OR
    (source_format = 'CARTE_GRISE_TEXT'  AND mime_type = 'text/plain; charset=utf-8'));

-- the CURRENT version of a face is an accepted one; a public deposit waiting for review is not current
DROP INDEX IF EXISTS uq_vdoc_current_face;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vdoc_current_face ON idauto_vehicle_documents (vehicle_id, document_type, face) WHERE superseded_at IS NULL AND review_status = 'accepted';
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_pending ON idauto_vehicle_documents (review_status) WHERE review_status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_sha ON idauto_vehicle_documents (vehicle_id, sha256);

-- the monthly archive accepts PDF and text sources too
DO $$ BEGIN
  IF to_regclass('public.idauto_media_archive') IS NOT NULL THEN
    ALTER TABLE idauto_media_archive DROP CONSTRAINT IF EXISTS chk_arch_path;
    ALTER TABLE idauto_media_archive ADD CONSTRAINT chk_arch_path CHECK (archive_path IS NULL OR archive_path ~ '^[0-9]{4}/[0-9]{2}/(vehicle-photos|carte-grise)/[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}(_[0-9]{1,18})?\.(jpg|png|webp|pdf|txt|bin)$');
  END IF;
END $$;

-- =============================================================================
-- DOWN (manual, only before any PDF / text / pending row exists):
-- DROP INDEX uq_vdoc_current_face; CREATE UNIQUE INDEX uq_vdoc_current_face ON idauto_vehicle_documents (vehicle_id, document_type, face) WHERE superseded_at IS NULL;
-- ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT chk_vdoc_format_mime, DROP CONSTRAINT chk_vdoc_size;
-- ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_size CHECK (byte_size > 0 AND width > 0 AND height > 0);
-- ALTER TABLE idauto_vehicle_documents DROP COLUMN source_format, DROP COLUMN input_method, … (the columns above)
-- =============================================================================
