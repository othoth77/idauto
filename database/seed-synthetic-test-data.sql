-- =============================================================================
-- ID Auto — Synthetic Test Data (IDA-2C)
-- =============================================================================
-- Not real vehicle, plate, or observation data of any kind. Every value is
-- explicitly marked TEST/SYNTHETIC. Uses the TEST_ONLY capture source
-- already seeded by schema.sql ("IDA-0/IDA-1 seed. No real vehicle or
-- owner data. Never use in production.").
--
-- Adds exactly one vehicle, one plate, one observation, and two facts (one
-- public, one mythos_private — the private one exists specifically to
-- prove the read-only API's access_scope filter actually excludes it, not
-- just that it happens to have nothing to return), plus one evidence row.
-- =============================================================================

INSERT INTO idauto_vehicles
    (internal_ref, make, model, variant, year, body_type, fuel_type, colour, fiche_status)
VALUES
    ('IDA2C-TEST-VEHICLE-001', 'TestMake', 'TestModel', 'TestVariant', 2020, 'sedan', 'petrol', 'white', 'verified');

INSERT INTO idauto_plates
    (plate_number, format_code, governorate_id, vehicle_id, status)
SELECT
    '999 TUN 9999', 'TUN_STD', (SELECT id FROM idauto_governorates WHERE code = '01'),
    (SELECT id FROM idauto_vehicles WHERE internal_ref = 'IDA2C-TEST-VEHICLE-001'), 'active';

INSERT INTO idauto_observations
    (vehicle_id, plate_id, capture_source_id, capture_method, plate_normalised, status)
SELECT
    (SELECT id FROM idauto_vehicles WHERE internal_ref = 'IDA2C-TEST-VEHICLE-001'),
    (SELECT id FROM idauto_plates WHERE plate_number = '999 TUN 9999'),
    (SELECT id FROM idauto_capture_sources WHERE code = 'TEST_ONLY'),
    'manual_admin', '999 TUN 9999', 'accepted';

INSERT INTO idauto_vehicle_facts
    (vehicle_id, fact_key, fact_value, confidence_score, verification_status, access_scope)
SELECT
    (SELECT id FROM idauto_vehicles WHERE internal_ref = 'IDA2C-TEST-VEHICLE-001'),
    'colour', 'white', 0.9, 'verified', 'public';

INSERT INTO idauto_vehicle_facts
    (vehicle_id, fact_key, fact_value, confidence_score, verification_status, access_scope)
SELECT
    (SELECT id FROM idauto_vehicles WHERE internal_ref = 'IDA2C-TEST-VEHICLE-001'),
    'vin', 'TESTVINSYNTHETIC0001', 0.5, 'unverified', 'mythos_private';

INSERT INTO idauto_fact_evidence
    (fact_id, evidence_type, weight)
SELECT
    (SELECT id FROM idauto_vehicle_facts WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE internal_ref = 'IDA2C-TEST-VEHICLE-001') AND fact_key = 'colour'),
    'admin_validation', 0.5;
