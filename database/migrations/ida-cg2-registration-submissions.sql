-- =============================================================================
-- IDA-CG2 — CARTE GRISE V2: a registration document BEFORE it belongs to a vehicle
-- =============================================================================
-- Owner mission 2026-11-04 and decisions D1–D7 (docs/CARTE_GRISE_V2.md):
--   scan both faces → extract → is the vehicle already in IDauto? → a person
--   reviews → link to the existing vehicle OR create one (IVID issued in the
--   same transaction) → both original images in the vehicle's dossier.
--
-- A SUBMISSION is the document while it is being processed. It is not linked
-- to a vehicle until a person decides; the decision and the link happen in
-- one transaction (reference/documents/registration-submissions.js).
--
-- Rules carried by the schema:
--   - faces are VERSIONED: a replacement adds a version, nothing is deleted
--     (one current version per face, partial unique index);
--   - the stored bytes are the ORIGINAL upload (D4: never replaced by a
--     compressed copy); a small thumbnail is a separate, optional object;
--   - fields are APPEND-ONLY: an OCR run or a review adds rows; the current
--     value of a key is its newest row (superseded_at IS NULL). Nothing is
--     overwritten, so every value keeps its provenance;
--   - no raw OCR text (D1), no holder data (D5): field_key is an allow-list
--     of technical keys;
--   - linked/created ⇔ vehicle_id is set (CHECK).
--
-- PURELY ADDITIVE: three new tables, no change to an existing table.
-- REVERSIBLE — see DOWN.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idauto_registration_submissions (
    id               BIGSERIAL    PRIMARY KEY,
    public_ref       VARCHAR(40)  NOT NULL UNIQUE,          -- 'cgs_' + 24 hex, the only reference a client sees
    org_id           INTEGER      REFERENCES idauto_organizations(id),   -- NULL = an admin's submission
    document_type    VARCHAR(30)  NOT NULL DEFAULT 'carte_grise',
    two_sided        BOOLEAN      NOT NULL DEFAULT TRUE,     -- D2: both faces required when the card has two
    single_sided_reason TEXT,                                -- required when two_sided = FALSE
    status           VARCHAR(30)  NOT NULL DEFAULT 'draft',
    vehicle_id       INTEGER      REFERENCES idauto_vehicles(id),
    decision         VARCHAR(30),
    decision_reason  TEXT,
    match_snapshot   JSONB,                                  -- the matcher's answer at decision time (no VIN value)
    applied_changes  JSONB,                                  -- what the decision wrote to the vehicle, key by key
    discrepancies    JSONB,                                  -- card ≠ vehicle values that were NOT written
    version          INTEGER      NOT NULL DEFAULT 1,        -- optimistic concurrency for review/decision
    created_by       VARCHAR(64)  NOT NULL,
    decided_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    decided_at       TIMESTAMPTZ,
    CONSTRAINT chk_cgs_type     CHECK (document_type IN ('carte_grise')),
    CONSTRAINT chk_cgs_status   CHECK (status IN ('draft','extracted','in_review','needs_better_image','linked','created','rejected')),
    CONSTRAINT chk_cgs_decision CHECK (decision IS NULL OR decision IN ('link_existing','create_vehicle','reject')),
    CONSTRAINT chk_cgs_vehicle  CHECK ((status IN ('linked','created')) = (vehicle_id IS NOT NULL)),
    CONSTRAINT chk_cgs_single   CHECK (two_sided OR (single_sided_reason IS NOT NULL AND length(trim(single_sided_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_cgs_org     ON idauto_registration_submissions (org_id, status);
CREATE INDEX IF NOT EXISTS idx_cgs_vehicle ON idauto_registration_submissions (vehicle_id) WHERE vehicle_id IS NOT NULL;
COMMENT ON TABLE idauto_registration_submissions IS
    'IDA-CG2. A carte grise being processed: faces + extracted fields, then a human decision that links it to a vehicle or creates one. Sensitive: images are in the private media store.';

CREATE TABLE IF NOT EXISTS idauto_registration_submission_faces (
    id                BIGSERIAL    PRIMARY KEY,
    submission_id     BIGINT       NOT NULL REFERENCES idauto_registration_submissions(id),
    face              SMALLINT     NOT NULL,
    version           INTEGER      NOT NULL,
    is_current        BOOLEAN      NOT NULL DEFAULT TRUE,
    storage_key       TEXT         NOT NULL,                 -- the ORIGINAL bytes, as uploaded
    thumb_storage_key TEXT,
    mime_type         VARCHAR(50)  NOT NULL,
    byte_size         INTEGER      NOT NULL,
    width             INTEGER      NOT NULL,
    height            INTEGER      NOT NULL,
    sha256            VARCHAR(64)  NOT NULL,
    quality           JSONB,                                 -- server checks + what the browser measured (blur, detection)
    created_by        VARCHAR(64)  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    replaced_at       TIMESTAMPTZ,
    CONSTRAINT chk_cgsf_face CHECK (face IN (1, 2)),
    CONSTRAINT chk_cgsf_size CHECK (byte_size > 0 AND width > 0 AND height > 0),
    CONSTRAINT chk_cgsf_sha  CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT uq_cgsf_version UNIQUE (submission_id, face, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cgsf_current ON idauto_registration_submission_faces (submission_id, face) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_cgsf_sha ON idauto_registration_submission_faces (sha256);
COMMENT ON TABLE idauto_registration_submission_faces IS
    'IDA-CG2. Versioned faces of a submission. storage_key = the original upload (never a compressed replacement). A replaced version keeps its row and its bytes.';

CREATE TABLE IF NOT EXISTS idauto_registration_submission_fields (
    id                BIGSERIAL    PRIMARY KEY,
    submission_id     BIGINT       NOT NULL REFERENCES idauto_registration_submissions(id),
    field_key         VARCHAR(40)  NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    value_raw         TEXT,                                  -- what was read for THIS field (technical data only; never the OCR text)
    value_normalized  TEXT,
    corrected_by_parser BOOLEAN    NOT NULL DEFAULT FALSE,   -- a character substitution produced value_normalized
    confidence        REAL,
    source_face       SMALLINT,
    source_face_version INTEGER,
    source_label      VARCHAR(80),
    source_line       INTEGER,
    method            VARCHAR(40)  NOT NULL,                 -- 'ocr:tesseract.js+parser-v14' | 'operator'
    extraction_run    INTEGER,
    note              TEXT,
    created_by        VARCHAR(64)  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    superseded_at     TIMESTAMPTZ,
    CONSTRAINT chk_cgsfl_key CHECK (field_key IN ('registration','manufacturer','type','genre','category_code','vin','first_registration_date','year',
        'fuel','engine_cc','fiscal_power','seats','gross_weight_kg','engine')),
    CONSTRAINT chk_cgsfl_status CHECK (status IN ('extracted','conflict','missing','confirmed','corrected','unreadable','not_present')),
    CONSTRAINT chk_cgsfl_face CHECK (source_face IS NULL OR source_face IN (1, 2)),
    CONSTRAINT chk_cgsfl_conf CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cgsfl_current ON idauto_registration_submission_fields (submission_id, field_key) WHERE superseded_at IS NULL;
COMMENT ON TABLE idauto_registration_submission_fields IS
    'IDA-CG2. Append-only field history of a submission: OCR proposals and every review action, with source face/version/label/line and confidence. No holder field exists (allow-list).';

-- =============================================================================
-- DOWN
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_registration_submission_fields;
-- DROP TABLE IF EXISTS idauto_registration_submission_faces;
-- DROP TABLE IF EXISTS idauto_registration_submissions;
