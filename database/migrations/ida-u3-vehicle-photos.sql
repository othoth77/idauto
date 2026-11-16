-- =============================================================================
-- IDauto — Update 3 — vehicle photographs, their analysis and capture location
-- =============================================================================
-- Additive and idempotent (safe to apply twice). No existing row is changed.
--
-- WHERE THE BYTES ARE REFERENCED. A vehicle photograph is one more row of
-- idauto_vehicle_documents (document_type = 'vehicle_photo'), exactly like a
-- carte grise face: metadata + a key into the private, content-addressed media
-- store. Nothing is stored in PostgreSQL but the key. This is deliberate: the
-- nightly off-host backup copies every file referenced by that table, so the
-- photographs are backed up with no change to the backup itself, and the
-- existing "is this file still referenced?" check keeps working.
--   · chk_vdoc_type is widened to allow 'vehicle_photo';
--   · chk_vdoc_face keeps faces 1 and 2 for a carte grise; for a photograph,
--     `face` is simply its running number on the vehicle (1, 2, 3 …).
-- Both changes only ALLOW more: every existing row satisfies the new checks,
-- and the previous release (which only ever asks for 'carte_grise') is unaffected.
--
-- WHAT IS NEW. idauto_vehicle_photos — one row per photograph, holding what a
-- photograph has and a document does not:
--   view              front | rear | unknown
--   captured_at       when the photograph was taken, when known (EXIF or the capture itself)
--   latitude/longitude  the ORIGINAL coordinates, when known
--   place_name, governorate, country   human-readable capture location
--   location_source   exif | browser | manual — NULL when the location is unknown
--   analysis          what was recognised on THIS photograph (plate reading, vision fields, confidences, engines)
--   confidence        the plate reading's confidence for this photograph (0–1), when there is one
--   confirmed         the person confirmed this photograph's values
-- The location belongs to the photograph, never to the vehicle.
-- =============================================================================

ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_type;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_type CHECK (document_type IN ('carte_grise', 'vehicle_photo'));
ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_face;
ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_face
  CHECK ((document_type = 'carte_grise' AND face IN (1, 2)) OR (document_type = 'vehicle_photo' AND face BETWEEN 1 AND 999));

CREATE TABLE IF NOT EXISTS idauto_vehicle_photos (
    document_id      BIGINT       PRIMARY KEY REFERENCES idauto_vehicle_documents(id) ON DELETE CASCADE,
    vehicle_id       INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    view             VARCHAR(10)  NOT NULL DEFAULT 'unknown',
    captured_at      TIMESTAMPTZ,
    latitude         DOUBLE PRECISION,
    longitude        DOUBLE PRECISION,
    place_name       VARCHAR(120),
    governorate      VARCHAR(60),
    country          VARCHAR(60),
    location_source  VARCHAR(10),
    analysis         JSONB,
    confidence       REAL,
    confirmed        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vphoto_view     CHECK (view IN ('front', 'rear', 'unknown')),
    CONSTRAINT chk_vphoto_source   CHECK (location_source IS NULL OR location_source IN ('exif', 'browser', 'manual')),
    CONSTRAINT chk_vphoto_coords   CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
    CONSTRAINT chk_vphoto_gps_src  CHECK (latitude IS NULL OR (location_source IS NOT NULL AND location_source IN ('exif', 'browser'))),
    CONSTRAINT chk_vphoto_conf     CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0),
    CONSTRAINT chk_vphoto_analysis CHECK (analysis IS NULL OR (jsonb_typeof(analysis) = 'object' AND pg_column_size(analysis) <= 8192))
);
CREATE INDEX IF NOT EXISTS idx_idauto_vphoto_vehicle ON idauto_vehicle_photos (vehicle_id);

COMMENT ON TABLE idauto_vehicle_photos IS
  'Update 3. One row per vehicle photograph (bytes referenced by idauto_vehicle_documents, type vehicle_photo): view, capture date, ORIGINAL coordinates, readable location and its source, per-photograph analysis. The location is the photograph''s, not the vehicle''s.';

-- DOWN (data loss: the photographs' metadata; the files stay in the store until removed). Owner decision, after a dump:
-- DROP TABLE IF EXISTS idauto_vehicle_photos;
-- DELETE FROM idauto_vehicle_documents WHERE document_type = 'vehicle_photo';
-- ALTER TABLE idauto_vehicle_documents DROP CONSTRAINT IF EXISTS chk_vdoc_face, DROP CONSTRAINT IF EXISTS chk_vdoc_type;
-- ALTER TABLE idauto_vehicle_documents ADD CONSTRAINT chk_vdoc_type CHECK (document_type IN ('carte_grise')), ADD CONSTRAINT chk_vdoc_face CHECK (face IN (1, 2));
