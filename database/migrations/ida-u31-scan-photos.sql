-- =============================================================================
-- IDauto — Update 3.1 (final scanner) — photographs saved at the moment they are taken,
-- and a second copy of every photograph on the Haddad server.
-- =============================================================================
-- Additive and idempotent. No existing row is changed.
--
-- A photograph taken with « Scanner la plaque » is stored BEFORE anyone knows which
-- vehicle it shows. It is therefore an OBSERVATION (idauto_observations, capture_method
-- 'vehicle_scan', vehicle_id NULL until it is attached) with its file as an
-- idauto_observation_media row (media_type 'original_image') — tables that already
-- exist, and whose files the nightly off-host backup already copies.
--
-- 1. idauto_scan_photos — what a scan photograph has and an observation does not:
--    an unguessable token (the page's only handle on it), capture date, ORIGINAL
--    coordinates, readable place and its source, the view, what was recognised,
--    whether it was confirmed, and — once known — the vehicle and the vehicle photograph
--    it became. An unattached photograph from an anonymous visitor expires (expires_at).
-- 2. idauto_media_replicas — one row per stored file (content-addressed key) and copy
--    target ('haddad'): pending | stored | failed, attempts, last error. A failed copy is
--    visible and retried; the file is never discarded because a copy failed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_scan_photos (
    media_id             BIGINT       PRIMARY KEY REFERENCES idauto_observation_media(id) ON DELETE CASCADE,
    observation_id       BIGINT       NOT NULL REFERENCES idauto_observations(id),
    token                VARCHAR(43)  NOT NULL UNIQUE,
    org_id               INTEGER      REFERENCES idauto_organizations(id),    -- NULL = anonymous visitor
    actor_ref            VARCHAR(80)  NOT NULL,
    view                 VARCHAR(10)  NOT NULL DEFAULT 'unknown',
    captured_at          TIMESTAMPTZ,
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    place_name           VARCHAR(120),
    governorate          VARCHAR(60),
    country              VARCHAR(60),
    location_source      VARCHAR(10),
    analysis             JSONB,
    analysis_status      VARCHAR(12)  NOT NULL DEFAULT 'pending',
    confirmed            BOOLEAN      NOT NULL DEFAULT FALSE,
    vehicle_id           INTEGER      REFERENCES idauto_vehicles(id),
    attached_document_id BIGINT       REFERENCES idauto_vehicle_documents(id) ON DELETE SET NULL,
    expires_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_scan_view      CHECK (view IN ('front', 'rear', 'unknown')),
    CONSTRAINT chk_scan_source    CHECK (location_source IS NULL OR location_source IN ('exif', 'browser', 'manual')),
    CONSTRAINT chk_scan_coords    CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
    CONSTRAINT chk_scan_gps_src   CHECK (latitude IS NULL OR (location_source IS NOT NULL AND location_source IN ('exif', 'browser'))),
    CONSTRAINT chk_scan_analysis  CHECK (analysis IS NULL OR (jsonb_typeof(analysis) = 'object' AND pg_column_size(analysis) <= 8192)),
    CONSTRAINT chk_scan_astatus   CHECK (analysis_status IN ('pending', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_scan_photos_expiry ON idauto_scan_photos (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_scan_photos_vehicle ON idauto_scan_photos (vehicle_id);

CREATE TABLE IF NOT EXISTS idauto_media_replicas (
    object_key    VARCHAR(64)  NOT NULL,
    target        VARCHAR(20)  NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
    attempts      INTEGER      NOT NULL DEFAULT 0,
    last_error    VARCHAR(200),
    replicated_at TIMESTAMPTZ,
    next_try_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (object_key, target),
    CONSTRAINT chk_replica_key    CHECK (object_key ~ '^[a-f0-9]{64}$'),
    CONSTRAINT chk_replica_target CHECK (target IN ('haddad')),
    CONSTRAINT chk_replica_status CHECK (status IN ('pending', 'stored', 'failed', 'delete_pending', 'deleted'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_media_replicas_due ON idauto_media_replicas (next_try_at) WHERE status IN ('pending', 'failed', 'delete_pending');

-- DOWN (owner decision, after a dump): DROP TABLE IF EXISTS idauto_media_replicas; DROP TABLE IF EXISTS idauto_scan_photos;
-- (the observations and their files stay; they are removed only through their own retention)
