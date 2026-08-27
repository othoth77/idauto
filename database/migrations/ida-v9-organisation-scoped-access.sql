-- =============================================================================
-- IDA-V9 — organisation-scoped access and mandatory Fixpert provenance
-- =============================================================================
-- Owner decision, 2026-08-27: OPTION B. Fixpert authenticates to IDauto as ONE
-- organisation holding a service credential. Fixpert keeps authenticating its
-- own users; IDauto never stores a workshop user account. The acting person
-- travels as PROVENANCE, not as an authorisation subject.
--
-- The domains stay separated: IDauto owns vehicle identity, Fixpert owns
-- workshop records. This migration adds the smallest thing that lets IDauto
-- answer "which organisation submitted this, and who inside it" without
-- becoming an account directory.
--
-- WHAT ALREADY EXISTED, and is reused rather than rebuilt:
--   idauto_organizations  — org_type already includes 'garage', and the table
--                           already carries is_fixpert_pilot. An atelier IS an
--                           organisation row; no new concept is introduced.
--   idauto_user_roles     — org membership and roles, already modelled.
--   idauto_audit_log      — already has org_id and actor_ref columns.
--   idauto_service_events — already requires org_id AND user_role_id, which is
--                           why provenance below is mandatory, not optional.
--
-- WHAT WAS MISSING: idauto_observations had no organisation at all, so two
-- ateliers' submissions were indistinguishable and could not be isolated from
-- one another. That is what this adds.
--
-- PROVENANCE IS ENFORCED BY THE DATABASE, NOT BY THE APPLICATION. The CHECK
-- below makes an organisation-originated observation without complete
-- provenance impossible to store, from any code path, including a future one
-- that forgets. An application-level check would only bind the callers that
-- remember to run it.
--
-- B → C LATER, WITHOUT REDOING THIS. Nothing here depends on HOW the caller
-- was authenticated. org_id and the provenance columns are the same whether
-- the organisation was proven by a service token today or by an OIDC claim
-- tomorrow; only the verification step in reference/identity.js would change.
--
-- PURELY ADDITIVE. Five nullable columns, one CHECK, two indexes. No row is
-- touched, no column dropped, no existing constraint altered. Every existing
-- observation has org_id NULL and is therefore not organisation-scoped —
-- exactly what was true before this ran.
-- =============================================================================

ALTER TABLE idauto_observations
    ADD COLUMN IF NOT EXISTS org_id           INTEGER      REFERENCES idauto_organizations(id),
    ADD COLUMN IF NOT EXISTS author_ref       VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source           VARCHAR(60),
    ADD COLUMN IF NOT EXISTS source_type      VARCHAR(30),
    ADD COLUMN IF NOT EXISTS source_reference VARCHAR(200);

-- The owner's rule, made unbreakable: data originating from an organisation
-- carries author, organisation, source, source_type, source_reference and a
-- timestamp, or it does not get stored. capture_time is already NOT NULL and
-- is the timestamp.
ALTER TABLE idauto_observations DROP CONSTRAINT IF EXISTS chk_obs_org_provenance;
ALTER TABLE idauto_observations ADD CONSTRAINT chk_obs_org_provenance CHECK (
    org_id IS NULL OR (
        author_ref       IS NOT NULL AND author_ref       <> '' AND
        source           IS NOT NULL AND source           <> '' AND
        source_type      IS NOT NULL AND source_type      <> '' AND
        source_reference IS NOT NULL AND source_reference <> ''
    )
);

CREATE INDEX IF NOT EXISTS idx_idauto_observations_org ON idauto_observations (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_observations_source_ref ON idauto_observations (org_id, source_reference) WHERE org_id IS NOT NULL;

COMMENT ON COLUMN idauto_observations.org_id IS
    'IDA-V9. Organisation that submitted this observation. NULL = not organisation-originated (admin/manual entry). Isolation between ateliers is enforced on this column.';
COMMENT ON COLUMN idauto_observations.author_ref IS
    'IDA-V9. The acting person, as identified BY THE SUBMITTING ORGANISATION. IDauto stores it as provenance and never authenticates it — Fixpert owns its users (option B).';
COMMENT ON COLUMN idauto_observations.source_reference IS
    'IDA-V9. The submitting system''s own record id, so a row can be traced back across the boundary in both directions.';

-- -----------------------------------------------------------------------------
-- DOWN (manual):
--   DROP INDEX IF EXISTS idx_idauto_observations_source_ref;
--   DROP INDEX IF EXISTS idx_idauto_observations_org;
--   ALTER TABLE idauto_observations DROP CONSTRAINT IF EXISTS chk_obs_org_provenance;
--   ALTER TABLE idauto_observations
--     DROP COLUMN IF EXISTS source_reference, DROP COLUMN IF EXISTS source_type,
--     DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS author_ref,
--     DROP COLUMN IF EXISTS org_id;
-- Dropping these loses which organisation submitted what, and the provenance
-- that made it attributable. Export before rolling back if that matters.
-- -----------------------------------------------------------------------------
