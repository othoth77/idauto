-- IDA-3A ingestion schema foundation.
-- Binding design: docs/INGESTION_ARCHITECTURE.md.
-- Additive-only migration: two new tables and one nullable column.

BEGIN;

CREATE TABLE IF NOT EXISTS idauto_submissions (
    id              BIGSERIAL    PRIMARY KEY,
    idempotency_key VARCHAR(64)  NOT NULL UNIQUE,
    actor_ref       VARCHAR(64),
    actor_type      VARCHAR(20)  NOT NULL,
    capture_source_id INTEGER    REFERENCES idauto_capture_sources(id),
    ip_hash         VARCHAR(64),
    received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    observation_id  BIGINT       REFERENCES idauto_observations(id),
    CONSTRAINT chk_submission_actor CHECK (
        actor_type IN ('system','contributor','professional_user','admin','anonymous')
    ),
    CONSTRAINT chk_submission_status CHECK (
        status IN ('pending','accepted','rejected','duplicate')
    )
);

CREATE INDEX IF NOT EXISTS idx_idauto_submissions_ip_hash
    ON idauto_submissions (ip_hash);
CREATE INDEX IF NOT EXISTS idx_idauto_submissions_status
    ON idauto_submissions (status);
CREATE INDEX IF NOT EXISTS idx_idauto_submissions_observation_id
    ON idauto_submissions (observation_id);

CREATE TABLE IF NOT EXISTS idauto_rate_limit_counters (
    bucket_key      VARCHAR(64)  NOT NULL,
    window_start    TIMESTAMPTZ  NOT NULL,
    count           INTEGER      NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
);

ALTER TABLE idauto_observation_media
    ADD COLUMN IF NOT EXISTS derived_from_media_id BIGINT NULL
    REFERENCES idauto_observation_media(id);

COMMIT;
