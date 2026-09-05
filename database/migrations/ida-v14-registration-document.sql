-- =============================================================================
-- IDA-V14 — CARTE GRISE: registration document faces, metadata only
-- =============================================================================
-- Owner order, 2026-09-05 ("Carte grise scanner V1"): a vehicle may carry
-- its registration document, face 1 (recto) and optionally face 2 (verso),
-- captured in the atelier, optimised in the browser, stored in the private
-- media store, OCR'd for the TECHNICAL fields only, and shown on the
-- passport to signed-in, authorised users.
--
-- PostgreSQL = metadata. The image bytes live in the media store behind the
-- RegistrationDocumentStorage abstraction (reference/documents/); only the
-- storage key is here. No OCR raw text is ever stored: ocr_fields holds the
-- parsed TECHNICAL fields (plate, make, model, VIN, energy, year, …) with
-- their confidences and nothing about the holder.
--
-- Access: the organisation that uploaded a face (org_id) and admins. A
-- technician of another organisation never sees it (404, not 403).
--
-- PURELY ADDITIVE. One table, one widened CHECK. REVERSIBLE — see DOWN.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_vehicle_documents (
    id                  BIGSERIAL    PRIMARY KEY,
    vehicle_id          INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    org_id              INTEGER      REFERENCES idauto_organizations(id),   -- NULL = uploaded by an admin
    document_type       VARCHAR(30)  NOT NULL DEFAULT 'carte_grise',
    face                SMALLINT     NOT NULL,
    storage_key         TEXT         NOT NULL,
    thumb_storage_key   TEXT,
    mime_type           VARCHAR(50)  NOT NULL,
    byte_size           INTEGER      NOT NULL,
    width               INTEGER      NOT NULL,
    height              INTEGER      NOT NULL,
    sha256              VARCHAR(64)  NOT NULL,
    original_byte_size  INTEGER,                    -- what the phone produced, before the browser pipeline
    capture_meta        JSONB,                      -- { detection: auto|manual|none, format, quality, max_edge } — no image data
    ocr_status          VARCHAR(20)  NOT NULL DEFAULT 'none',
    ocr_confidence      REAL,
    ocr_fields          JSONB,                      -- technical fields + confidences ONLY; never raw text, never holder data
    ocr_at              TIMESTAMPTZ,
    created_by          VARCHAR(64)  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vdoc_type   CHECK (document_type IN ('carte_grise')),
    CONSTRAINT chk_vdoc_face   CHECK (face IN (1, 2)),
    CONSTRAINT chk_vdoc_ocr    CHECK (ocr_status IN ('none','extracted','confirmed','failed')),
    CONSTRAINT chk_vdoc_conf   CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0.0 AND 1.0),
    CONSTRAINT chk_vdoc_size   CHECK (byte_size > 0 AND width > 0 AND height > 0),
    CONSTRAINT uq_vdoc_vehicle_type_face UNIQUE (vehicle_id, document_type, face)
);
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_vehicle ON idauto_vehicle_documents (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_idauto_vdoc_key     ON idauto_vehicle_documents (storage_key);
COMMENT ON TABLE idauto_vehicle_documents IS
    'IDA-V14. Registration document (carte grise) faces of a vehicle: metadata + storage key. Image bytes are in the private media store. ocr_fields = technical fields only. Sensitive: holder data is on the image, never in a column.';

-- The confirm() path may now record that an identification came from the
-- registration document OCR (provenance carte_grise_ocr).
ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_ident_method;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_ident_method
    CHECK (identification_method IS NULL OR identification_method IN
        ('plate_ocr','plate_manual','vin','manual_selection','provider','import','admin','carte_grise_ocr'));

-- =============================================================================
-- DOWN
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_vehicle_documents;
-- ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_ident_method;
-- ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_ident_method CHECK (identification_method IS NULL OR
--   identification_method IN ('plate_ocr','plate_manual','vin','manual_selection','provider','import','admin'));
