-- =============================================================================
-- IDauto — IDA-UI-4 — simplification (2026-11-06)
-- =============================================================================
-- Additive and idempotent (safe to apply twice). No existing row is changed.
-- Only what the simplified forms need and the schema could not hold:
--
-- 1. idauto_vehicles.odometer_km / odometer_at — the vehicle's last known mileage
--    (typed at registration, raised by an intervention's mileage). Nowhere else
--    in the schema held a vehicle mileage (only the legacy idauto_service_events).
-- 2. idauto_vehicle_notes — « Informations complémentaires » of the vehicle form,
--    ONE per vehicle and workshop. A separate table because vehicles are shared
--    between workshops and a free-text note must not cross them (the same rule as
--    the owner contact, PRIVACY_ARCHITECTURE §1a). Never on the passport.
-- 3. idauto_workshop_visits.performed_on / odometer_km / technician_ref — the
--    intervention form's date, mileage and technician; reason widened to hold the
--    « description du travail effectué ».
-- =============================================================================

ALTER TABLE idauto_vehicles ADD COLUMN IF NOT EXISTS odometer_km INTEGER;
ALTER TABLE idauto_vehicles ADD COLUMN IF NOT EXISTS odometer_at DATE;
ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_odometer;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_odometer CHECK (odometer_km IS NULL OR (odometer_km >= 0 AND odometer_km <= 3000000));

CREATE TABLE IF NOT EXISTS idauto_vehicle_notes (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  INTEGER NOT NULL REFERENCES idauto_vehicles(id),
    org_id      INTEGER REFERENCES idauto_organizations(id),   -- NULL = written by an administrator
    notes       VARCHAR(500) NOT NULL,
    updated_by  VARCHAR(80) NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vehicle_notes_len CHECK (length(btrim(notes)) >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_notes_org ON idauto_vehicle_notes (vehicle_id, COALESCE(org_id, 0));

ALTER TABLE idauto_workshop_visits ADD COLUMN IF NOT EXISTS performed_on DATE;
ALTER TABLE idauto_workshop_visits ADD COLUMN IF NOT EXISTS odometer_km INTEGER;
ALTER TABLE idauto_workshop_visits ADD COLUMN IF NOT EXISTS technician_ref VARCHAR(64);
ALTER TABLE idauto_workshop_visits DROP CONSTRAINT IF EXISTS chk_visit_odometer;
ALTER TABLE idauto_workshop_visits ADD CONSTRAINT chk_visit_odometer CHECK (odometer_km IS NULL OR (odometer_km >= 0 AND odometer_km <= 3000000));
ALTER TABLE idauto_workshop_visits ALTER COLUMN reason TYPE VARCHAR(1000);

-- =============================================================================
-- DOWN (manual; removes the notes and the new columns — data loss, owner decision)
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_vehicle_notes;
-- ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_odometer, DROP COLUMN IF EXISTS odometer_km, DROP COLUMN IF EXISTS odometer_at;
-- ALTER TABLE idauto_workshop_visits DROP CONSTRAINT IF EXISTS chk_visit_odometer, DROP COLUMN IF EXISTS performed_on,
--   DROP COLUMN IF EXISTS odometer_km, DROP COLUMN IF EXISTS technician_ref;
-- (reason: leave at VARCHAR(1000); narrowing could fail on longer descriptions.)
