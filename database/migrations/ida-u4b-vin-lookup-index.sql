-- =============================================================================
-- IDauto — Update 4b — index for the VIN lookup on the raw value
-- =============================================================================
-- Some VIN facts were written without fact_value_normalized (found in production on
-- 2026-11-18: 1 of 1). The public VIN search therefore also matches UPPER(TRIM(fact_value));
-- this partial expression index keeps that match an index scan. Additive, idempotent.
CREATE INDEX IF NOT EXISTS idx_idauto_facts_vin_upper
    ON idauto_vehicle_facts (UPPER(TRIM(fact_value)))
    WHERE fact_key = 'vin';
-- DOWN: DROP INDEX IF EXISTS idx_idauto_facts_vin_upper;
