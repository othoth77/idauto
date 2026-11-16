-- =============================================================================
-- IDauto — Update 2 — automatic plate and vehicle recognition (2026-11-16)
-- =============================================================================
-- Additive and idempotent (safe to apply twice). No existing row is changed.
--
-- Registration number, make, model, colour, body type and year ALREADY have
-- their columns (idauto_plates.plate_number; idauto_vehicles.make, model,
-- colour, body_type, year). This migration adds nothing for them.
--
-- The one thing the schema could not hold is WHERE a value came from when the
-- camera proposed it: which fields were recognised, by which engine, with what
-- confidence, and whether the person kept or corrected each of them. That is
-- one nullable JSONB column:
--
--   idauto_vehicles.visual_recognition
--     { "at": "<ISO date>", "plate": { "confidence": 96, "auto": true },
--       "provider": "anthropic" | null, "model": "<model id>" | null,
--       "fields": { "make":   { "proposed": "Chevrolet", "confidence": 0.93, "source": "vision", "kept": true },
--                   "colour": { "proposed": "noir", "confidence": 0.71, "source": "camera", "kept": false }, … } }
--
-- NULL for every existing vehicle and for every vehicle typed by hand. The
-- columns themselves (make, model, colour, body_type) always hold what the
-- person CONFIRMED, never a raw proposal. No photo is stored.
-- =============================================================================

ALTER TABLE idauto_vehicles ADD COLUMN IF NOT EXISTS visual_recognition JSONB;
ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_visual_recognition;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_visual_recognition
  CHECK (visual_recognition IS NULL OR (jsonb_typeof(visual_recognition) = 'object' AND pg_column_size(visual_recognition) <= 4096));

COMMENT ON COLUMN idauto_vehicles.visual_recognition IS
  'Update 2: provenance of values proposed by the camera at registration (engine, confidence, kept or corrected). NULL when typed by hand. Never a photo.';

-- DOWN (data loss: the provenance only — never the confirmed values). Owner decision, after a dump:
-- ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_visual_recognition;
-- ALTER TABLE idauto_vehicles DROP COLUMN IF EXISTS visual_recognition;
