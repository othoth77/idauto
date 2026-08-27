-- =============================================================================
-- IDA-V8 — MERGE / SPLIT / ALIAS: identity resolution
-- =============================================================================
-- Owner requirement, 2026-08-27. Two records that turn out to be the same
-- vehicle must be mergeable, an incorrect merge must be reversible, and every
-- identifier ever issued must keep resolving — Fixpert will hold references
-- that were minted before a merge and must never see them break.
--
-- THE CONTRACT ALREADY EXISTED. protocol/schemas/vehicle.schema.json declares
--   "merged_into": "Set when this record was merged into another. Both records
--    are retained; a merge is itself an Event and MUST be reversible."
-- and its status enum already contains 'merged' — which database/schema.sql's
-- chk_vehicle_status already permits. This migration implements that contract;
-- it does not invent one.
--
-- WHY TWO COLUMNS AND NO NEW TABLE. Keeping the merged record in place, with a
-- pointer to its canonical successor, satisfies every requirement at once:
--   - no historical identity is deleted; the row, its ivid and its internal_ref
--     all survive untouched;
--   - its observations, facts, evidence and audit rows keep pointing at it, so
--     nothing is rewritten and no provenance moves;
--   - an old identifier resolves by following the pointer;
--   - an identifier is never freed, so it can never be reused;
--   - reversing is clearing the pointer.
-- A separate alias table would duplicate what the vehicle row already is.
--
--   merged_into_id   the canonical vehicle. FK, so a merge can never point at
--                    a vehicle that does not exist, and the canonical vehicle
--                    cannot be deleted out from under it.
--   pre_merge_status the status this record held before the merge, so a split
--                    restores exactly what was there rather than guessing.
--                    Reading it back is deterministic; reconstructing it from
--                    the audit log would not be.
--
-- PURELY ADDITIVE. Two nullable columns and one partial index. No row is
-- touched, no column dropped, no constraint changed. Every existing vehicle
-- has merged_into_id NULL and is therefore its own canonical record, which is
-- exactly what was true before this ran.
--
-- REVERSIBLE — see the DOWN block at the bottom.
-- =============================================================================

ALTER TABLE idauto_vehicles
    ADD COLUMN IF NOT EXISTS merged_into_id   INTEGER REFERENCES idauto_vehicles(id),
    ADD COLUMN IF NOT EXISTS pre_merge_status VARCHAR(20);

-- A vehicle can never be merged into itself. Cheap to enforce here, and it
-- closes the shortest path to an unresolvable cycle.
ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_not_self_merged;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_not_self_merged
    CHECK (merged_into_id IS NULL OR merged_into_id <> id);

-- Partial: only merged rows carry the column, and resolution walks it.
CREATE INDEX IF NOT EXISTS idx_idauto_vehicles_merged_into
    ON idauto_vehicles (merged_into_id) WHERE merged_into_id IS NOT NULL;

COMMENT ON COLUMN idauto_vehicles.merged_into_id IS
    'IDA-V8. Canonical vehicle this record was merged into. NULL means this record IS canonical. The merged record is retained in full; resolution follows this pointer. Reversible by clearing it (split).';
COMMENT ON COLUMN idauto_vehicles.pre_merge_status IS
    'IDA-V8. fiche_status held before the merge, restored verbatim on split.';

-- -----------------------------------------------------------------------------
-- DOWN (manual):
--   DROP INDEX IF EXISTS idx_idauto_vehicles_merged_into;
--   ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_not_self_merged;
--   ALTER TABLE idauto_vehicles DROP COLUMN IF EXISTS pre_merge_status;
--   ALTER TABLE idauto_vehicles DROP COLUMN IF EXISTS merged_into_id;
-- Dropping these loses which records were merged. Split every merged record
-- first if that history matters.
-- -----------------------------------------------------------------------------
