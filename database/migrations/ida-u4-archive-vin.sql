-- =============================================================================
-- IDauto — Update 4 — monthly photo / carte grise archive, carte grise versions
-- =============================================================================
-- Additive and idempotent. No existing row is changed except that every existing
-- document row receives version = 1 (its column default). No file is moved.
--
-- 1. idauto_media_archive — ONE RECORD PER FILE IN THE ARCHIVE (per stored file and
--    category). It is the history the dossier shows and what the Haddad receiver files
--    under <root>/<YYYY>/<MM>/<vehicle-photos|carte-grise>/. A new capture is a new
--    record; nothing is ever overwritten. The VIN is NOT copied here: it stays a scoped
--    fact (IDA-V10) and is read through the vehicle when the record is shown or sent.
--    Files themselves stay content-addressed (SHA-256) in the existing media store, so
--    every existing reference keeps working.
--
-- 2. Carte grise versions. Until now a new carte grise face DELETED the previous row and
--    its file (uq_vdoc_vehicle_type_face). Now the previous row is kept, marked
--    superseded_at / superseded_by, and only the CURRENT version is unique per face.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_media_archive (
    id                 BIGSERIAL    PRIMARY KEY,
    object_key         VARCHAR(64)  NOT NULL,
    category           VARCHAR(20)  NOT NULL,
    vehicle_id         INTEGER      REFERENCES idauto_vehicles(id),
    document_id        BIGINT       REFERENCES idauto_vehicle_documents(id) ON DELETE SET NULL,
    scan_media_id      BIGINT,                          -- idauto_scan_photos.media_id of a scanner photograph
    source             VARCHAR(20)  NOT NULL,
    uploaded_by        VARCHAR(80),                     -- the authenticated identity; NULL for an anonymous scan
    uploaded_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    captured_at        TIMESTAMPTZ,
    latitude           DOUBLE PRECISION,
    longitude          DOUBLE PRECISION,
    location_source    VARCHAR(10),
    place_name         VARCHAR(160),
    mime_type          VARCHAR(50)  NOT NULL,
    original_filename  VARCHAR(255),
    sha256             VARCHAR(64)  NOT NULL,
    byte_size          INTEGER,
    archive_path       VARCHAR(200),                    -- relative to the receiver root, set once Haddad has filed it
    archive_status     VARCHAR(12)  NOT NULL DEFAULT 'pending',
    archive_error      VARCHAR(200),
    lens_job_ref       VARCHAR(128),
    lens_status        VARCHAR(20),
    lens_fields        JSONB,                           -- carte grise technical fields only (never holder data)
    meta_corrected_by  VARCHAR(80),
    meta_corrected_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_arch_key      CHECK (object_key ~ '^[a-f0-9]{64}$' AND sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT chk_arch_category CHECK (category IN ('vehicle-photos', 'carte-grise')),
    CONSTRAINT chk_arch_source   CHECK (source IN ('public_scanner', 'admin', 'workshop')),
    CONSTRAINT chk_arch_status   CHECK (archive_status IN ('pending', 'stored', 'failed', 'removed')),
    CONSTRAINT chk_arch_coords   CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
    CONSTRAINT chk_arch_locsrc   CHECK (location_source IS NULL OR location_source IN ('exif', 'browser', 'manual')),
    CONSTRAINT chk_arch_gps      CHECK (latitude IS NULL OR location_source IN ('exif', 'browser', 'manual')),
    CONSTRAINT chk_arch_lens     CHECK (lens_fields IS NULL OR (jsonb_typeof(lens_fields) = 'array' AND pg_column_size(lens_fields) <= 4096)),
    CONSTRAINT chk_arch_path     CHECK (archive_path IS NULL OR archive_path ~ '^[0-9]{4}/[0-9]{2}/(vehicle-photos|carte-grise)/[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}\.(jpg|png|webp|pdf|bin)$')
);
CREATE INDEX IF NOT EXISTS idx_idauto_arch_vehicle ON idauto_media_archive (vehicle_id, category, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_idauto_arch_key     ON idauto_media_archive (object_key);
CREATE INDEX IF NOT EXISTS idx_idauto_arch_pending ON idauto_media_archive (archive_status) WHERE archive_status IN ('pending', 'failed');
CREATE UNIQUE INDEX IF NOT EXISTS uq_idauto_arch_document ON idauto_media_archive (document_id) WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idauto_arch_scan     ON idauto_media_archive (scan_media_id) WHERE scan_media_id IS NOT NULL;

COMMENT ON TABLE idauto_media_archive IS
    'Update 4. One record per archived photograph / carte grise: dates, GPS (device or EXIF, never IP), source, uploader, original name and type, SHA-256, Haddad archive path, LENS reference. Never overwritten: a new capture is a new row. The VIN is read through the vehicle, not copied.';

-- 2. carte grise versions -----------------------------------------------------------------
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS version            INTEGER      NOT NULL DEFAULT 1;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS superseded_at      TIMESTAMPTZ;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS superseded_by      BIGINT;
ALTER TABLE idauto_vehicle_documents ADD COLUMN IF NOT EXISTS original_filename  VARCHAR(255);
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS uq_vdoc_vehicle_type_face;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vdoc_current_face ON idauto_vehicle_documents (vehicle_id, document_type, face) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_history ON idauto_vehicle_documents (vehicle_id, document_type, face, version DESC);

-- =============================================================================
-- DOWN (manual, only before any second version exists):
-- DROP INDEX IF EXISTS uq_vdoc_current_face; DROP INDEX IF EXISTS idx_idauto_vdoc_history;
-- ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT uq_vdoc_vehicle_type_face UNIQUE (vehicle_id, document_type, face);
-- ALTER TABLE idauto_vehicle_documents DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS superseded_at, DROP COLUMN IF EXISTS superseded_by, DROP COLUMN IF EXISTS original_filename;
-- DROP TABLE IF EXISTS idauto_media_archive;
-- =============================================================================
