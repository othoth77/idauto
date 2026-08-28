-- =============================================================================
-- IDA-V10 — VEHICLE SEARCH: the reverse lookup, and the index it needs
-- =============================================================================
-- Owner requirement, 2026-08-28: "SEARCH VEHICLE = vraie recherche véhicule",
-- supporting exact plate, exact VIN (under a dedicated scope, always audited),
-- Vehicle ID (IVID), internal_ref, make, model and year.
--
-- WHAT WAS ALREADY THERE, and is therefore NOT repeated here:
--   idx_idauto_vehicles_make_model  (make, model)  — schema.sql:262
--   idx_idauto_vehicles_year        (year)         — schema.sql:263
--   idauto_vehicles.ivid / internal_ref are already UNIQUE, so an exact
--   lookup on either is already an index scan.
--   idauto_plates.plate_number is already the key the public plate route
--   uses; no new index is needed for exact plate search.
--
-- WHAT IS MISSING, and is the whole point of this migration. VIN is not a
-- column on idauto_vehicles — it is a FACT (fact_key = 'vin'), which is what
-- keeps it under the access_scope machinery and the public-surface deny-list.
-- Facts are indexed by (vehicle_id, fact_key): that answers "what is this
-- vehicle's VIN". VIN SEARCH asks the reverse — "which vehicle has this VIN" —
-- and on those indexes that is a sequential scan of every fact row.
--
-- A partial index keyed on the normalized value answers the reverse question
-- directly, and being partial it costs nothing for the other fact keys: only
-- rows with fact_key = 'vin' are stored in it.
--
-- WHY NOT UNIQUE. Two records that turn out to share a VIN is exactly the
-- condition a MERGE exists to resolve (IDA-V8) — the duplicate must be
-- findable, not rejected at write time. A unique index here would make the
-- duplicate unwritable and so unmergeable, turning a resolvable data problem
-- into a lost observation. Detection belongs to search; resolution belongs to
-- merge.
--
-- PURELY ADDITIVE. One index. No column added, no row touched, no constraint
-- changed. REVERSIBLE — see the DOWN block at the bottom.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_idauto_facts_vin_lookup
    ON idauto_vehicle_facts (fact_value_normalized)
    WHERE fact_key = 'vin';

COMMENT ON INDEX idx_idauto_facts_vin_lookup IS
    'IDA-V10. Reverse VIN lookup for GET /api/search/vehicles?vin=. Partial on fact_key=''vin''. Deliberately NOT unique: a shared VIN is the signal a merge resolves, so it must be findable rather than unwritable.';

-- SPACING-TOLERANT PLATE SEARCH, and why it needs its own index.
--
-- normalizePlate() deliberately does NOT strip spaces: several plate formats
-- match on an optional separator, and the spaced form is the canonical, human
-- readable value stored in idauto_plates.plate_number. The public resolution
-- route (GET /public/plates/:plate) matches it exactly, and must keep doing
-- so — a RESOLVER should be strict.
--
-- A SEARCH is a different job. An atelier typing "188tun4523" is looking for
-- the same car as "188 TUN 4523", and answering "no such vehicle" because of
-- a space would send it off to create a duplicate identity — the exact
-- outcome merge exists to repair. So search compares the space-stripped
-- forms, and this functional index keeps that comparison an index scan
-- instead of a sequential scan of every plate.
--
-- This changes NO stored value and NO other route's behaviour: strict
-- resolution stays strict, and only the search route consults this index.
CREATE INDEX IF NOT EXISTS idx_idauto_plates_nospace
    ON idauto_plates (REPLACE(plate_number, ' ', ''));

COMMENT ON INDEX idx_idauto_plates_nospace IS
    'IDA-V10. Spacing-tolerant exact plate search for GET /api/search/vehicles?plate=. The public resolver stays strict-exact; only search uses this.';

-- Supports the audit query "every VIN search this organisation performed",
-- which is the read the VIN audit trail exists to answer. Partial for the
-- same reason: it indexes one event type, not the whole audit log.
CREATE INDEX IF NOT EXISTS idx_idauto_audit_vin_search
    ON idauto_audit_log (org_id, event_time)
    WHERE event_type = 'vehicle.search.vin';

COMMENT ON INDEX idx_idauto_audit_vin_search IS
    'IDA-V10. Answers "every VIN search by this organisation, in time order" — the review the mandatory VIN audit exists for.';

-- =============================================================================
-- DOWN
-- =============================================================================
-- DROP INDEX IF EXISTS idx_idauto_facts_vin_lookup;
-- DROP INDEX IF EXISTS idx_idauto_plates_nospace;
-- DROP INDEX IF EXISTS idx_idauto_audit_vin_search;
