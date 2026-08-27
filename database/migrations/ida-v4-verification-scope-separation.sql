-- =============================================================================
-- IDA-V4 — verification, publication, source and confidence are independent
-- =============================================================================
-- Owner decision, 2026-08-27. A fact now carries four INDEPENDENT dimensions:
--
--   SOURCE           where the information came from  (idauto_fact_evidence)
--   VERIFICATION     has it been checked              (verification_status)
--   ACCESS SCOPE     who may see it                   (access_scope)
--   CONFIDENCE       how much it is trusted           (confidence_score)
--
-- Before this change one of them silently drove another: accepting a fact in
-- review set verification_status='verified' AND access_scope='public' in the
-- same statement, so a perfectly verified VIN could not stay private. That is
-- fixed in reference/writes.js, not here — no column changes.
--
-- THIS MIGRATION IS PURELY ADDITIVE. It widens one CHECK constraint to admit a
-- new evidence type and touches no row, no column and no other constraint.
--
--   document_scan_official — the value was read off an OFFICIAL registration
--   document (Tunisian certificat d'immatriculation and equivalents), legibly
--   and without inference. Deliberately DISTINCT from 'document_scan', which
--   covers any scanned document including unofficial ones: the distinction is
--   what justifies confidence 1.0, so collapsing the two would erase the
--   justification.
--
-- REVERSIBLE. To roll back, restore the previous constraint — the DOWN block
-- at the bottom of this file. It fails only if a row already uses the new
-- value, which is the correct behaviour: rolling back must not silently
-- discard provenance.
-- =============================================================================

ALTER TABLE idauto_fact_evidence DROP CONSTRAINT IF EXISTS chk_evidence_type;

ALTER TABLE idauto_fact_evidence ADD CONSTRAINT chk_evidence_type CHECK (
    evidence_type IN (
        'user_confirmation','cross_source_match','vin_decode','document_scan',
        'document_scan_official',
        'professional_assertion','automated_check','admin_validation'
    )
);

-- -----------------------------------------------------------------------------
-- DOWN (manual):
--   ALTER TABLE idauto_fact_evidence DROP CONSTRAINT IF EXISTS chk_evidence_type;
--   ALTER TABLE idauto_fact_evidence ADD CONSTRAINT chk_evidence_type CHECK (
--       evidence_type IN (
--           'user_confirmation','cross_source_match','vin_decode','document_scan',
--           'professional_assertion','automated_check','admin_validation'
--       )
--   );
-- -----------------------------------------------------------------------------
