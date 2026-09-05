-- =============================================================================
-- ID Auto — Database Schema (IDA-2 Phase A — Migration-Ready)
-- Originally drafted Stage IDA-1 (2026-08-05); finalized as the IDA-2 Phase A
-- migration source 2026-08-10. Structurally re-verified (22 tables, all
-- idauto_-prefixed, parenthesis-balanced) before this status change.
-- Corrected same day (IDA-2A-CORRECTION-0): the scope column, originally
-- visibility_scope, is renamed to access_scope on idauto_observation_media
-- and idauto_vehicle_facts, resolving tracked risk R-T03 (naming
-- divergence with AutoValeur's access_scope — see
-- docs/AUTOMOTIVE_RISK_REGISTER.md). No other content changed.
-- Domain: idauto.tn
-- Platform: Mythos ecosystem
-- =============================================================================
--
-- TARGET DBMS: PostgreSQL
-- PostgreSQL is the selected target database management system.
-- This file is now migration-ready but has NOT been applied to any database.
-- Provisioning the actual PostgreSQL cluster and running this migration is
-- deferred to a separate, explicitly-authorized IDA-2 Phase B (production
-- infrastructure change) — see docs/ROADMAP.md.
--
-- LOGICAL SCHEMA SEPARATION
-- -------------------------
-- Target PostgreSQL cluster contains schemas including:
--   mythos_core     — users, roles, permissions, global audit, platform admin
--   idauto          — vehicles, plates, observations, facts, evidence, captures,
--                     sources, review queue, ID Auto activity
--   atelier_network — workshop registry, inspections, repair estimates, AutoCheck reports
--                     (created by atelier-network schema spec, NOT this file)
--   fixpert         — Fixpert clients, work orders, interventions, stock,
--                     quotations, invoices, payments, workshop activity
--
-- The atelier_network and fixpert schema tables are NOT created by this file.
-- fixpert is an external system. atelier_network is governed by projects/atelier-network/.
-- Fixpert is the first pilot workshop on the Atelier Network; each workshop org owns its own data.
--
-- PRIVACY CONTRACT
-- ----------------
-- No table queryable by plate number may store:
--   owner name, owner address, national ID (CIN), passport number,
--   phone, email, insurance policy number, insurer identity.
-- PII columns are marked -- [NO PII] to make absences explicit.
-- Owner PII from carte grise scans goes to fixpert.clients (with consent),
-- never to any idauto_ table.
--
-- OBSERVATION-FIRST INVARIANT
-- ---------------------------
-- Every capture (camera, upload, manual, document) creates an
-- idauto_observations record first. Vehicle fiches and facts are derived
-- from observations. Observations are immutable after creation.
-- Facts are versioned; old values are never silently overwritten.
--
-- ACCESS SCOPES
-- -------------
-- Facts and media references carry an access_scope:
--   public          — any caller within rate limits
--   professional    — verified professional subscriber
--   mythos_private  — Mythos super admin only (all access audit-logged)
--
-- =============================================================================


-- =============================================================================
-- PART 1 — REFERENCE TABLES (unchanged from IDA-0, minor additions)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PLATE FORMATS — configurable rules catalogue
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_plate_formats (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(20)  NOT NULL UNIQUE,
    name_fr         VARCHAR(100) NOT NULL,
    name_ar         VARCHAR(100),
    pattern         TEXT         NOT NULL,           -- POSIX regex
    example         VARCHAR(30),
    introduced_year INTEGER,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    captures_json   TEXT,                            -- JSON capture-group semantics
    notes           TEXT,
    verified        BOOLEAN      NOT NULL DEFAULT FALSE,
        -- FALSE = draft/unverified format rule; TRUE = confirmed against official source
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE idauto_plate_formats IS
    'Configurable plate format rules. verified=FALSE means unconfirmed against official source.';


-- -----------------------------------------------------------------------------
-- 2. GOVERNORATES — reference lookup
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_governorates (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(4)   NOT NULL UNIQUE,
    name_fr         VARCHAR(80)  NOT NULL,
    name_ar         VARCHAR(80),
    region_fr       VARCHAR(80),
    active          BOOLEAN      NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE idauto_governorates IS
    'Tunisian governorate reference. 24 governorates.';


-- =============================================================================
-- PART 2 — CAPTURE PROVENANCE
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 3. CAPTURE SOURCES — types of data origin
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_capture_sources (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(40)  NOT NULL UNIQUE,
    name_fr         VARCHAR(100) NOT NULL,
    name_ar         VARCHAR(100),
    source_type     VARCHAR(30)  NOT NULL,
        -- public_upload | contributor_upload | smart_gate | professional_scan |
        -- manual_admin | official_import | test
    trust_level     SMALLINT     NOT NULL DEFAULT 1,
        -- 1=lowest (anonymous) … 5=highest (official/authorised)
    requires_consent BOOLEAN     NOT NULL DEFAULT FALSE,
    legal_basis     TEXT,
        -- LEGAL-REVIEW-REQUIRED for most source types
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_source_type CHECK (
        source_type IN (
            'public_upload','contributor_upload','smart_gate',
            'professional_scan','manual_admin','official_import','test'
        )
    )
);

COMMENT ON TABLE idauto_capture_sources IS
    'Catalogue of data-origin types. trust_level determines confidence weight.';


-- -----------------------------------------------------------------------------
-- 4. CAMERA SOURCES — registered Smart Gate cameras
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_camera_sources (
    id              SERIAL PRIMARY KEY,
    camera_ref      VARCHAR(64)  NOT NULL UNIQUE,   -- internal opaque identifier
    capture_source_id INTEGER    NOT NULL REFERENCES idauto_capture_sources(id),
    org_id          INTEGER,                         -- FK → idauto_organizations (owning org)
    location_label  VARCHAR(100),                    -- human-readable location description
    direction_mode  VARCHAR(30)  NOT NULL DEFAULT 'single_zone',
        -- single_zone | dual_zone | manual_review
    stream_type     VARCHAR(20)  NOT NULL DEFAULT 'rtsp',
    active          BOOLEAN      NOT NULL DEFAULT FALSE,
        -- FALSE until regulatory approval and IDA-4 implementation
    activated_at    TIMESTAMPTZ,
    deactivated_at  TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [MYTHOS_PRIVATE] physical location and stream details not stored in public columns
    CONSTRAINT chk_camera_dir CHECK (
        direction_mode IN ('single_zone','dual_zone','manual_review')
    )
);

COMMENT ON TABLE idauto_camera_sources IS
    'Registered ANPR cameras (Smart Gate). active=FALSE until IDA-4 + legal approval.';


-- -----------------------------------------------------------------------------
-- 5. CONTRIBUTORS — authenticated public submitters
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_contributors (
    id              SERIAL PRIMARY KEY,
    mythos_user_id  VARCHAR(64)  NOT NULL UNIQUE,   -- opaque Mythos user reference
    trust_score     SMALLINT     NOT NULL DEFAULT 10,
        -- 0–100; affects review queue priority
    total_submissions INTEGER    NOT NULL DEFAULT 0,
    accepted_submissions INTEGER NOT NULL DEFAULT 0,
    rejected_submissions INTEGER NOT NULL DEFAULT 0,
    blocked          BOOLEAN     NOT NULL DEFAULT FALSE,
    blocked_at       TIMESTAMPTZ,
    blocked_reason   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- [NO PII] name/email not stored; resolved via Mythos OS auth at runtime
    CONSTRAINT chk_trust_score CHECK (trust_score BETWEEN 0 AND 100)
);

COMMENT ON TABLE idauto_contributors IS
    'Public contributor accounts. NO raw PII. Trust score derived from submission history.';


-- -----------------------------------------------------------------------------
-- 6. CAPTURE SESSIONS — groups of related observations in one user session
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_capture_sessions (
    id              BIGSERIAL    PRIMARY KEY,
    session_token_hash VARCHAR(64) NOT NULL,         -- SHA-256 of session token
    contributor_id  INTEGER      REFERENCES idauto_contributors(id),
    capture_source_id INTEGER    NOT NULL REFERENCES idauto_capture_sources(id),
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    observation_count INTEGER    NOT NULL DEFAULT 0,
    ip_hash         VARCHAR(64),                     -- SHA-256 of client IP
    -- [NO PII] session token and raw IP not stored
    CONSTRAINT chk_session_dates CHECK (ended_at IS NULL OR ended_at >= started_at)
);

COMMENT ON TABLE idauto_capture_sessions IS
    'Groups observations from a single user session. Used for rate limiting and abuse detection.';


-- =============================================================================
-- PART 3 — VEHICLE IDENTITY (canonical records)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 7. VEHICLES — canonical vehicle fiche (no PII)
-- -----------------------------------------------------------------------------
-- [NO PII] — owner identity is never stored in this table.

CREATE TABLE idauto_vehicles (
    id              SERIAL PRIMARY KEY,
    internal_ref    VARCHAR(40)  NOT NULL UNIQUE,
    make            VARCHAR(80),
    model           VARCHAR(80),
    variant         VARCHAR(80),
    year            INTEGER,
    body_type       VARCHAR(40),
    fuel_type       VARCHAR(20),
    colour          VARCHAR(40),
    seats           SMALLINT,
    gross_weight_kg INTEGER,
    engine_cc       INTEGER,
    category_code   VARCHAR(10),                     -- M1, N1, L3, … (EU vehicle category)
    fiche_status    VARCHAR(20)  NOT NULL DEFAULT 'initial',
        -- initial | pending_review | verified | conflict | merged | archived
    first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    observation_count INTEGER    NOT NULL DEFAULT 0,
    -- [NO PII] owner fields deliberately absent
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vehicle_status CHECK (
        fiche_status IN ('initial','pending_review','verified','conflict','merged','archived')
    )
);

COMMENT ON TABLE idauto_vehicles IS
    'Canonical vehicle fiche. NO owner PII. Enriched from observations and facts.';

CREATE INDEX idx_idauto_vehicles_make_model ON idauto_vehicles (make, model);
CREATE INDEX idx_idauto_vehicles_year       ON idauto_vehicles (year);
CREATE INDEX idx_idauto_vehicles_status     ON idauto_vehicles (fiche_status);


-- -----------------------------------------------------------------------------
-- 8. PLATES — registration records (no PII)
-- -----------------------------------------------------------------------------
-- [NO PII] — owner identity is never stored in this table.

CREATE TABLE idauto_plates (
    id              SERIAL PRIMARY KEY,
    plate_number    VARCHAR(20)  NOT NULL,
    plate_raw       VARCHAR(30),
    format_code     VARCHAR(20)  NOT NULL REFERENCES idauto_plate_formats(code),
    governorate_id  INTEGER      REFERENCES idauto_governorates(id),
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | cancelled | exported | stolen | unknown
    valid_from      DATE,
    valid_until     DATE,
    -- [NO PII] owner fields deliberately absent
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_plates_status CHECK (
        status IN ('active','suspended','cancelled','exported','stolen','unknown')
    )
);

COMMENT ON TABLE idauto_plates IS
    'Plate registration records. NO owner PII. One plate per row.';

CREATE UNIQUE INDEX uidx_idauto_plates_number_active
    ON idauto_plates (plate_number)
    WHERE status = 'active';

CREATE INDEX idx_idauto_plates_vehicle ON idauto_plates (vehicle_id);
CREATE INDEX idx_idauto_plates_format  ON idauto_plates (format_code);
CREATE INDEX idx_idauto_plates_status  ON idauto_plates (status);


-- =============================================================================
-- PART 4 — OBSERVATION AND FACT MODEL
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 9. OBSERVATIONS — immutable capture events
-- -----------------------------------------------------------------------------
-- Every input (scan, upload, Smart Gate, manual entry) creates one row here.
-- Rows are never updated after creation; status column is the only exception.

CREATE TABLE idauto_observations (
    id              BIGSERIAL    PRIMARY KEY,
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    plate_id        INTEGER      REFERENCES idauto_plates(id),
    capture_source_id INTEGER    NOT NULL REFERENCES idauto_capture_sources(id),
    capture_session_id BIGINT    REFERENCES idauto_capture_sessions(id),
    camera_source_id INTEGER     REFERENCES idauto_camera_sources(id),
    contributor_id  INTEGER      REFERENCES idauto_contributors(id),
    capture_method  VARCHAR(30)  NOT NULL,
        -- plate_scan | vehicle_scan | carte_grise_scan | smart_gate |
        -- manual_admin | professional_scan | official_import
    capture_time    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        -- exact timestamp; always MYTHOS_PRIVATE
    plate_candidate VARCHAR(30),                     -- raw OCR/input before normalisation
    plate_normalised VARCHAR(20),
    ocr_confidence  REAL,                            -- 0.0–1.0
    direction       VARCHAR(10),                     -- entry | exit | unknown | null
    status          VARCHAR(20)  NOT NULL DEFAULT 'received',
        -- received | processing | pending_confirmation | pending_review |
        -- accepted | rejected | duplicate | conflict | blocked
    rejected_reason TEXT,
    ip_hash         VARCHAR(64),
    -- [MYTHOS_PRIVATE] exact capture_time and location never in public response
    -- [NO PII] contributor identity resolved from contributor_id, not stored here
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_obs_method CHECK (
        capture_method IN (
            'plate_scan','vehicle_scan','carte_grise_scan','smart_gate',
            'manual_admin','professional_scan','official_import'
        )
    ),
    CONSTRAINT chk_obs_status CHECK (
        status IN (
            'received','processing','pending_confirmation','pending_review',
            'accepted','rejected','duplicate','conflict','blocked'
        )
    ),
    CONSTRAINT chk_obs_direction CHECK (
        direction IN ('entry','exit','unknown') OR direction IS NULL
    )
);

COMMENT ON TABLE idauto_observations IS
    'Immutable capture events. Every input creates one row. '
    'status is the only mutable column after creation.';

CREATE INDEX idx_idauto_obs_vehicle    ON idauto_observations (vehicle_id);
CREATE INDEX idx_idauto_obs_plate      ON idauto_observations (plate_id);
CREATE INDEX idx_idauto_obs_time       ON idauto_observations (capture_time);
CREATE INDEX idx_idauto_obs_status     ON idauto_observations (status);
CREATE INDEX idx_idauto_obs_source     ON idauto_observations (capture_source_id);
CREATE INDEX idx_idauto_obs_camera     ON idauto_observations (camera_source_id);


-- -----------------------------------------------------------------------------
-- 9A. SUBMISSIONS — ingestion envelopes and idempotency anchors
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_submissions (
    id              BIGSERIAL    PRIMARY KEY,
    idempotency_key VARCHAR(64)  NOT NULL UNIQUE,
    actor_ref       VARCHAR(64),                     -- NULL for anonymous; never invent an identifier
    actor_type      VARCHAR(20)  NOT NULL,
    capture_source_id INTEGER    REFERENCES idauto_capture_sources(id),
    ip_hash         VARCHAR(64),                     -- hash only, never a raw IP address
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

COMMENT ON TABLE idauto_submissions IS
    'Ingestion submission envelopes. Durable idempotency anchors, including rejected and duplicate submissions.';

CREATE INDEX idx_idauto_submissions_ip_hash        ON idauto_submissions (ip_hash);
CREATE INDEX idx_idauto_submissions_status         ON idauto_submissions (status);
CREATE INDEX idx_idauto_submissions_observation_id ON idauto_submissions (observation_id);


-- -----------------------------------------------------------------------------
-- 9B. RATE LIMIT COUNTERS — durable fixed-window ingestion counters
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_rate_limit_counters (
    bucket_key      VARCHAR(64)  NOT NULL,           -- sha256(dimension || ':' || identifier)
    window_start    TIMESTAMPTZ  NOT NULL,
    count           INTEGER      NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
);

COMMENT ON TABLE idauto_rate_limit_counters IS
    'Durable fixed-window ingestion rate-limit counters.';


-- -----------------------------------------------------------------------------
-- 10. OBSERVATION LOCATION — exact location (always MYTHOS_PRIVATE)
-- -----------------------------------------------------------------------------
-- Stored separately to enforce access scope at the schema level.
-- Joined only when caller has MYTHOS_PRIVATE access.

CREATE TABLE idauto_observation_locations (
    id              BIGSERIAL    PRIMARY KEY,
    observation_id  BIGINT       NOT NULL UNIQUE REFERENCES idauto_observations(id),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    accuracy_m      REAL,                            -- GPS accuracy in metres
    location_method VARCHAR(20)  NOT NULL DEFAULT 'unknown',
        -- gps | exif | manual | inferred | unknown
    governorate_id  INTEGER      REFERENCES idauto_governorates(id),
    location_label  VARCHAR(200),                    -- human-readable (admin only)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    -- [MYTHOS_PRIVATE] this entire table is MYTHOS_PRIVATE; never joined in public queries
);

COMMENT ON TABLE idauto_observation_locations IS
    'Exact GPS coordinates per observation. MYTHOS_PRIVATE. Never included in public API responses.';


-- -----------------------------------------------------------------------------
-- 11. OBSERVATION MEDIA — image and document references
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_observation_media (
    id              BIGSERIAL    PRIMARY KEY,
    observation_id  BIGINT       NOT NULL REFERENCES idauto_observations(id),
    derived_from_media_id BIGINT REFERENCES idauto_observation_media(id),
    media_type      VARCHAR(20)  NOT NULL,
        -- original_image | plate_crop | vehicle_crop | processed_derivative |
        -- carte_grise_original | carte_grise_derivative
    object_key      TEXT         NOT NULL,           -- object-storage key (private bucket)
    mime_type       VARCHAR(50),
    width_px        INTEGER,
    height_px       INTEGER,
    file_size_bytes INTEGER,
    image_hash      VARCHAR(64),                     -- SHA-256 for duplicate detection
    access_scope VARCHAR(20) NOT NULL DEFAULT 'mythos_private',
        -- mythos_private | professional | public (public not used for media in current design)
    blurred         BOOLEAN      NOT NULL DEFAULT FALSE,
    retention_status VARCHAR(20) NOT NULL DEFAULT 'active',
        -- active | pending_deletion | deleted | legal_hold
    accessed_count  INTEGER      NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_media_type CHECK (
        media_type IN (
            'original_image','plate_crop','vehicle_crop','processed_derivative',
            'carte_grise_original','carte_grise_derivative'
        )
    ),
    CONSTRAINT chk_media_scope CHECK (
        access_scope IN ('mythos_private','professional','public')
    ),
    CONSTRAINT chk_media_retention CHECK (
        retention_status IN ('active','pending_deletion','deleted','legal_hold')
    )
);

COMMENT ON TABLE idauto_observation_media IS
    'Object-storage references for images and documents. No image binary in database.';

CREATE INDEX idx_idauto_media_obs       ON idauto_observation_media (observation_id);
CREATE INDEX idx_idauto_media_hash      ON idauto_observation_media (image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX idx_idauto_media_scope     ON idauto_observation_media (access_scope);


-- -----------------------------------------------------------------------------
-- 12. VEHICLE FACTS — versioned, evidence-backed attributes
-- -----------------------------------------------------------------------------
-- Facts are never silently overwritten. When a new observation contradicts
-- an existing fact, the new fact is inserted with status = 'conflict'.
-- The previous fact row is not modified; it remains as historical record.

CREATE TABLE idauto_vehicle_facts (
    id              BIGSERIAL    PRIMARY KEY,
    vehicle_id      INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    fact_key        VARCHAR(50)  NOT NULL,
        -- colour | make | model | variant | year | body_type | fuel_type |
        -- seats | engine_cc | category_code | vin | gross_weight_kg | plate_number
    fact_value      TEXT         NOT NULL,
    fact_value_normalized TEXT,                      -- lowercased / canonical form
    source_id       INTEGER      REFERENCES idauto_capture_sources(id),
    observation_id  BIGINT       REFERENCES idauto_observations(id),
    confidence_score REAL        NOT NULL DEFAULT 0.5,
        -- 0.0–1.0
    verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified',
        -- unverified | pending_review | verified | conflict | rejected
    access_scope VARCHAR(20) NOT NULL DEFAULT 'public',
        -- public | professional | mythos_private
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        -- FALSE when superseded by a newer fact for the same key
    first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    validated_by    VARCHAR(64),                     -- mythos_user_id of validator
    validated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] VIN stored in mythos_private scope; no owner fields
    CONSTRAINT chk_fact_conf   CHECK (confidence_score BETWEEN 0.0 AND 1.0),
    CONSTRAINT chk_fact_status CHECK (
        verification_status IN ('unverified','pending_review','verified','conflict','rejected')
    ),
    CONSTRAINT chk_fact_scope CHECK (
        access_scope IN ('public','professional','mythos_private')
    )
);

COMMENT ON TABLE idauto_vehicle_facts IS
    'Versioned vehicle attributes. Old values retained on update. '
    'VIN is mythos_private scope. No owner PII.';

CREATE INDEX idx_idauto_facts_vehicle   ON idauto_vehicle_facts (vehicle_id, fact_key);
CREATE INDEX idx_idauto_facts_active    ON idauto_vehicle_facts (vehicle_id, fact_key) WHERE is_active = TRUE;
CREATE INDEX idx_idauto_facts_status    ON idauto_vehicle_facts (verification_status);
CREATE INDEX idx_idauto_facts_obs       ON idauto_vehicle_facts (observation_id);


-- -----------------------------------------------------------------------------
-- 13. FACT EVIDENCE — additional evidence supporting a fact
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_fact_evidence (
    id              BIGSERIAL    PRIMARY KEY,
    fact_id         BIGINT       NOT NULL REFERENCES idauto_vehicle_facts(id),
    evidence_type   VARCHAR(30)  NOT NULL,
        -- user_confirmation | cross_source_match | vin_decode | document_scan |
        -- professional_assertion | automated_check | admin_validation
    evidence_ref    VARCHAR(64),                     -- observation_id, document_id, or other ref
    weight          REAL         NOT NULL DEFAULT 0.1,
        -- additive weight toward confidence score
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_evidence_type CHECK (
        evidence_type IN (
            'user_confirmation','cross_source_match','vin_decode','document_scan',
            'professional_assertion','automated_check','admin_validation'
        )
    ),
    CONSTRAINT chk_evidence_weight CHECK (weight BETWEEN 0.0 AND 1.0)
);

COMMENT ON TABLE idauto_fact_evidence IS
    'Additional evidence contributing to a fact confidence score.';

CREATE INDEX idx_idauto_evidence_fact ON idauto_fact_evidence (fact_id);


-- =============================================================================
-- PART 5 — DOCUMENT SCANS
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 14. DOCUMENT SCANS — carte grise and technical documents
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_document_scans (
    id              BIGSERIAL    PRIMARY KEY,
    observation_id  BIGINT       NOT NULL REFERENCES idauto_observations(id),
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    document_type   VARCHAR(30)  NOT NULL,
        -- carte_grise | technical_control | assurance | other
    media_id        BIGINT       REFERENCES idauto_observation_media(id),
        -- reference to original document in protected storage
    ocr_raw_ref     TEXT,                            -- object-storage key for raw OCR output
    extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        -- pending | processing | extracted | confirmed | failed
    submitter_confirmed BOOLEAN  NOT NULL DEFAULT FALSE,
    consent_declared BOOLEAN     NOT NULL DEFAULT FALSE,
    has_owner_pii   BOOLEAN      NOT NULL DEFAULT FALSE,
        -- TRUE if OCR found owner PII fields; PII never stored in this table
    pii_handled     BOOLEAN,
        -- NULL=not applicable; TRUE=PII routed to fixpert.clients or discarded; FALSE=pending
    technical_fields_extracted TEXT,                 -- JSON of extracted public technical fields
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] owner name, CIN, address never stored in any column here
    CONSTRAINT chk_doc_type CHECK (
        document_type IN ('carte_grise','technical_control','assurance','other')
    ),
    CONSTRAINT chk_doc_status CHECK (
        extraction_status IN ('pending','processing','extracted','confirmed','failed')
    )
);

COMMENT ON TABLE idauto_document_scans IS
    'Document scan records. Original in protected storage. '
    'Owner PII is NEVER stored in this table — routed to fixpert.clients or discarded.';

CREATE INDEX idx_idauto_docs_obs     ON idauto_document_scans (observation_id);
CREATE INDEX idx_idauto_docs_vehicle ON idauto_document_scans (vehicle_id);


-- =============================================================================
-- PART 6 — MOVEMENT EVENTS (MYTHOS_PRIVATE)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 15. VEHICLE MOVEMENTS — Smart Gate entry/exit events
-- -----------------------------------------------------------------------------
-- Always MYTHOS_PRIVATE. Never returned in public or professional API responses.

CREATE TABLE idauto_vehicle_movements (
    id              BIGSERIAL    PRIMARY KEY,
    observation_id  BIGINT       NOT NULL UNIQUE REFERENCES idauto_observations(id),
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    plate_id        INTEGER      REFERENCES idauto_plates(id),
    camera_source_id INTEGER     NOT NULL REFERENCES idauto_camera_sources(id),
    event_direction VARCHAR(10)  NOT NULL DEFAULT 'unknown',
        -- entry | exit | unknown
    event_time      TIMESTAMPTZ  NOT NULL,           -- exact, MYTHOS_PRIVATE
    plate_candidate VARCHAR(30),
    ocr_confidence  REAL,
    vehicle_colour  VARCHAR(40),
    colour_confidence REAL,
    vehicle_category VARCHAR(40),
    category_confidence REAL,
    validation_status VARCHAR(20) NOT NULL DEFAULT 'auto_accepted',
        -- auto_accepted | pending_review | reviewed | rejected
    fixpert_visit_ref VARCHAR(64),                   -- optional Fixpert work order reference
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [MYTHOS_PRIVATE] this entire table; event_time and direction never in public API
    CONSTRAINT chk_move_direction CHECK (
        event_direction IN ('entry','exit','unknown')
    ),
    CONSTRAINT chk_move_validation CHECK (
        validation_status IN ('auto_accepted','pending_review','reviewed','rejected')
    )
);

COMMENT ON TABLE idauto_vehicle_movements IS
    'Smart Gate entry/exit events. MYTHOS_PRIVATE. '
    'Never returned in public or professional API responses.';

CREATE INDEX idx_idauto_move_vehicle ON idauto_vehicle_movements (vehicle_id);
CREATE INDEX idx_idauto_move_camera  ON idauto_vehicle_movements (camera_source_id);
CREATE INDEX idx_idauto_move_time    ON idauto_vehicle_movements (event_time);


-- =============================================================================
-- PART 7 — REVIEW QUEUE
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 16. REVIEW QUEUE — observations and facts needing human review
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_review_queue (
    id              BIGSERIAL    PRIMARY KEY,
    item_type       VARCHAR(30)  NOT NULL,
        -- observation | fact | document_scan | contributor_report
    item_ref        BIGINT       NOT NULL,            -- id in the referenced table
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    reason          VARCHAR(50)  NOT NULL,
        -- low_confidence | unknown_format | fact_conflict | duplicate_image |
        -- new_contributor | low_trust_contributor | ocr_uncertainty |
        -- abuse_report | admin_escalation
    priority        SMALLINT     NOT NULL DEFAULT 3,
        -- 1=urgent, 2=high, 3=medium, 4=low
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
        -- pending | in_review | resolved | escalated
    assigned_to     VARCHAR(64),                     -- mythos_user_id of reviewer
    assigned_at     TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    resolution      VARCHAR(30),
        -- accepted | accepted_with_corrections | rejected | escalated | merged
    resolution_notes TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_queue_item  CHECK (
        item_type IN ('observation','fact','document_scan','contributor_report')
    ),
    CONSTRAINT chk_queue_reason CHECK (
        reason IN (
            'low_confidence','unknown_format','fact_conflict','duplicate_image',
            'new_contributor','low_trust_contributor','ocr_uncertainty',
            'abuse_report','admin_escalation'
        )
    ),
    CONSTRAINT chk_queue_status CHECK (
        status IN ('pending','in_review','resolved','escalated')
    ),
    CONSTRAINT chk_queue_priority CHECK (priority BETWEEN 1 AND 4)
);

COMMENT ON TABLE idauto_review_queue IS
    'Human review queue for uncertain, conflicting or flagged items.';

CREATE INDEX idx_idauto_queue_status   ON idauto_review_queue (status, priority);
CREATE INDEX idx_idauto_queue_vehicle  ON idauto_review_queue (vehicle_id);
CREATE INDEX idx_idauto_queue_assigned ON idauto_review_queue (assigned_to) WHERE assigned_to IS NOT NULL;


-- =============================================================================
-- PART 8 — PROFESSIONAL ORGANISATIONS AND SUBSCRIPTIONS
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 17. ORGANIZATIONS — professional subscriber entities
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_organizations (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    org_type        VARCHAR(30)  NOT NULL,
        -- garage | insurer | fleet | judicial | government | other
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'GARAGE',
    tax_id          VARCHAR(30),                     -- Matricule fiscal (entity ID, not personal PII)
    address_city    VARCHAR(80),
    governorate_id  INTEGER      REFERENCES idauto_governorates(id),
    contact_email   VARCHAR(200),                    -- organisational contact
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
        -- pending | active | suspended | cancelled
    verified_at     TIMESTAMPTZ,
    is_fixpert_pilot BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_org_type CHECK (
        org_type IN ('garage','insurer','fleet','judicial','government','other')
    ),
    CONSTRAINT chk_org_status CHECK (
        status IN ('pending','active','suspended','cancelled')
    )
);

COMMENT ON TABLE idauto_organizations IS
    'Professional subscriber organizations. tax_id is entity identifier.';


-- -----------------------------------------------------------------------------
-- 18. USER ROLES — professional user accounts linked to organizations
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_user_roles (
    id              SERIAL PRIMARY KEY,
    mythos_user_id  VARCHAR(64)  NOT NULL,
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    role            VARCHAR(30)  NOT NULL DEFAULT 'member',
        -- owner | admin | member | readonly
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
        -- active | suspended | revoked
    granted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    granted_by      VARCHAR(64),
    revoked_at      TIMESTAMPTZ,
    revoked_by      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] name/email resolved from Mythos OS auth at runtime
    CONSTRAINT chk_user_role   CHECK (role   IN ('owner','admin','member','readonly')),
    CONSTRAINT chk_user_status CHECK (status IN ('active','suspended','revoked')),
    CONSTRAINT uq_user_org     UNIQUE (mythos_user_id, org_id)
);

COMMENT ON TABLE idauto_user_roles IS
    'Role assignments for professional users. Identity from Mythos OS. No raw PII.';


-- -----------------------------------------------------------------------------
-- 19. SERVICE EVENTS — professional annotations on vehicle history
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_service_events (
    id              BIGSERIAL    PRIMARY KEY,
    vehicle_id      INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    plate_id        INTEGER      REFERENCES idauto_plates(id),
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    user_role_id    INTEGER      NOT NULL REFERENCES idauto_user_roles(id),
    event_type      VARCHAR(40)  NOT NULL,
    event_date      DATE         NOT NULL,
    odometer_km     INTEGER,
    description     TEXT,
    outcome         VARCHAR(30),
    next_service_due DATE,
    is_public       BOOLEAN      NOT NULL DEFAULT FALSE,
    source_ref      TEXT,                            -- Mythos OS document reference if attached
    -- [NO PII] customer name/contact deliberately absent
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_event_outcome CHECK (
        outcome IN ('pass','fail','conditional','informational') OR outcome IS NULL
    )
);

COMMENT ON TABLE idauto_service_events IS
    'Professional service annotations. NO customer PII. '
    'is_public controls cross-org visibility.';

CREATE INDEX idx_idauto_svc_vehicle ON idauto_service_events (vehicle_id);
CREATE INDEX idx_idauto_svc_org     ON idauto_service_events (org_id);
CREATE INDEX idx_idauto_svc_date    ON idauto_service_events (event_date);


-- =============================================================================
-- PART 9 — LOOKUP EVENTS AND AUDIT
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 20. VERIFICATIONS — plate lookup events
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_verifications (
    id              BIGSERIAL    PRIMARY KEY,
    plate_queried   VARCHAR(30)  NOT NULL,
    plate_normalised VARCHAR(20),
    result_status   VARCHAR(20)  NOT NULL,
        -- found | not_found | invalid_format | rate_limited | error | blocked
    format_code     VARCHAR(20),
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    caller_type     VARCHAR(20)  NOT NULL DEFAULT 'anonymous',
        -- anonymous | authenticated | professional
    org_id          INTEGER      REFERENCES idauto_organizations(id),
    user_role_id    INTEGER      REFERENCES idauto_user_roles(id),
    ip_hash         VARCHAR(64),
    user_agent_hash VARCHAR(64),
    response_ms     INTEGER,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] raw IP, User-Agent, owner data absent
    CONSTRAINT chk_verif_result CHECK (
        result_status IN ('found','not_found','invalid_format','rate_limited','error','blocked')
    ),
    CONSTRAINT chk_verif_caller CHECK (
        caller_type IN ('anonymous','authenticated','professional')
    )
);

COMMENT ON TABLE idauto_verifications IS
    'Every plate search event. Rate-limiting source. IP as SHA-256 only.';

CREATE INDEX idx_idauto_verif_plate   ON idauto_verifications (plate_normalised);
CREATE INDEX idx_idauto_verif_org     ON idauto_verifications (org_id);
CREATE INDEX idx_idauto_verif_created ON idauto_verifications (created_at);


-- -----------------------------------------------------------------------------
-- 21. CONSENT RECORDS — legal basis records
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_consent_records (
    id              BIGSERIAL    PRIMARY KEY,
    subject_type    VARCHAR(30)  NOT NULL,
        -- organization | user_role | contributor | anonymous_session
    subject_ref     VARCHAR(64)  NOT NULL,
    processing_purpose VARCHAR(60) NOT NULL,
    legal_basis     VARCHAR(60)  NOT NULL,
    consent_given   BOOLEAN,
    consent_version VARCHAR(20),
    ip_hash         VARCHAR(64),
    granted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    withdrawn_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    notes           TEXT,
    CONSTRAINT chk_consent_subject CHECK (
        subject_type IN ('organization','user_role','contributor','anonymous_session')
    ),
    CONSTRAINT chk_consent_basis CHECK (
        legal_basis IN (
            'legitimate_interest','contract','legal_obligation',
            'vital_interest','public_task','explicit_consent'
        )
    )
);

COMMENT ON TABLE idauto_consent_records IS
    'Legal basis and consent records. Required for Tunisian organic law 63-2004.';

CREATE INDEX idx_idauto_consent_subject  ON idauto_consent_records (subject_type, subject_ref);
CREATE INDEX idx_idauto_consent_active   ON idauto_consent_records (withdrawn_at) WHERE withdrawn_at IS NULL;


-- -----------------------------------------------------------------------------
-- 22. AUDIT LOG — immutable event record
-- -----------------------------------------------------------------------------

CREATE TABLE idauto_audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    event_time      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    event_type      VARCHAR(60)  NOT NULL,
    actor_type      VARCHAR(20)  NOT NULL,
        -- system | contributor | professional_user | admin | anonymous
    actor_ref       VARCHAR(64),
    org_id          INTEGER,
    target_type     VARCHAR(40),
    target_ref      VARCHAR(64),
    change_summary  TEXT,
    old_value_json  TEXT,
    new_value_json  TEXT,
    ip_hash         VARCHAR(64),
    request_id      VARCHAR(64),
    -- [NO PII] raw IP, name, address, owner fields absent
    CONSTRAINT chk_audit_actor CHECK (
        actor_type IN ('system','contributor','professional_user','admin','anonymous')
    )
);

COMMENT ON TABLE idauto_audit_log IS
    'Immutable append-only audit trail. No row ever updated or deleted. No raw PII.';

CREATE INDEX idx_idauto_audit_time   ON idauto_audit_log (event_time);
CREATE INDEX idx_idauto_audit_type   ON idauto_audit_log (event_type);
CREATE INDEX idx_idauto_audit_actor  ON idauto_audit_log (actor_ref);
CREATE INDEX idx_idauto_audit_target ON idauto_audit_log (target_type, target_ref);


-- =============================================================================
-- FOREIGN KEY ADDITIONS (cross-part references)
-- =============================================================================

ALTER TABLE idauto_verifications ADD CONSTRAINT fk_verif_org
    FOREIGN KEY (org_id) REFERENCES idauto_organizations(id);

ALTER TABLE idauto_verifications ADD CONSTRAINT fk_verif_user_role
    FOREIGN KEY (user_role_id) REFERENCES idauto_user_roles(id);


-- =============================================================================
-- SEED DATA — safe to run in development only
-- IDA-0 seed data preserved; new seeds added for IDA-1 model
-- =============================================================================

INSERT INTO idauto_plate_formats
    (code, name_fr, name_ar, pattern, example, introduced_year, active, verified, notes)
VALUES
    ('TUN_STD', 'Plaque standard (série courante)', 'لوحة قياسية',
     '^\d{1,3}\s?TUN\s?\d{1,4}$', '123 TUN 4567', 2002, TRUE, FALSE,
     'UNVERIFIED DRAFT. Main passenger series. Left: batch prefix. Right: sequential within batch.'),
    ('TUN_OLD', 'Plaque ancienne (avant 2002)', 'لوحة قديمة',
     '^\d{1,4}\s?TUN\s?\d{1,2}$', '1234 TUN 56', NULL, FALSE, FALSE,
     'UNVERIFIED DRAFT. Pre-2002 series still in circulation.'),
    ('TUN_GVT', 'Véhicule gouvernemental', 'مركبة حكومية',
     '^GN\s?\d{1,3}\s?\d{1,3}$', 'GN 123 456', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT. Ministries and public institutions.'),
    ('TUN_DIP', 'Corps diplomatique', 'سلك دبلوماسي',
     '^CD\s?\d{1,2}\s?\d{1,3}$', 'CD 12 345', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT. Diplomatic corps.'),
    ('TUN_MIL', 'Forces armées', 'القوات المسلحة',
     '^ARN\s?\d{1,6}$', 'ARN 123456', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT. Military vehicles. Public lookup returns vehicle type only.'),
    ('TUN_TMP', 'Immatriculation temporaire / transit', 'ترخيص مؤقت',
     '^TT\s?\d{1,5}\s?[A-Z]$', 'TT 12345 A', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT. Short-term and transit registration.'),
    ('TUN_ECO', 'Zone économique / spéciale', 'منطقة اقتصادية',
     '^ZE\s?\d{1,4}\s?\d{1,3}$', 'ZE 1234 567', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT. Free-trade and industrial zone vehicles.'),
    ('TUN_RS', 'Régime suspensif (RS)', 'نظام توقيفي',
     '^\d{1,3}\s?RS\s?\d{1,4}$', '123 RS 4567', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT (IDA-V12). Temporary-admission vehicles. Shape mirrored on the série normale.');

INSERT INTO idauto_governorates (code, name_fr, name_ar, region_fr) VALUES
    ('01','Tunis','تونس','Grand Tunis'),
    ('02','Ariana','أريانة','Grand Tunis'),
    ('03','Ben Arous','بن عروس','Grand Tunis'),
    ('04','Manouba','منوبة','Grand Tunis'),
    ('11','Bizerte','بنزرت','Nord'),
    ('12','Nabeul','نابل','Nord-Est'),
    ('13','Zaghouan','زغوان','Nord-Est'),
    ('21','Béja','باجة','Nord-Ouest'),
    ('22','Jendouba','جندوبة','Nord-Ouest'),
    ('23','Kef','الكاف','Nord-Ouest'),
    ('24','Siliana','سليانة','Nord-Ouest'),
    ('31','Sousse','سوسة','Centre-Est'),
    ('32','Monastir','المنستير','Centre-Est'),
    ('33','Mahdia','المهدية','Centre-Est'),
    ('34','Sfax','صفاقس','Centre-Est'),
    ('41','Kairouan','القيروان','Centre'),
    ('42','Kasserine','القصرين','Centre-Ouest'),
    ('43','Sidi Bouzid','سيدي بوزيد','Centre'),
    ('51','Gabès','قابس','Sud-Est'),
    ('52','Médenine','مدنين','Sud-Est'),
    ('53','Tataouine','تطاوين','Sud-Est'),
    ('61','Gafsa','قفصة','Sud-Ouest'),
    ('62','Tozeur','توزر','Sud-Ouest'),
    ('63','Kébili','قبلي','Sud-Ouest');

INSERT INTO idauto_capture_sources
    (code, name_fr, source_type, trust_level, requires_consent, legal_basis, notes)
VALUES
    ('TEST_ONLY', 'Données de test — aucune donnée réelle', 'test', 1, FALSE, NULL,
     'IDA-0/IDA-1 seed. No real vehicle or owner data. Never use in production.'),
    ('PUBLIC_UPLOAD', 'Contribution publique — application web', 'public_upload', 1, TRUE,
     'LEGAL-REVIEW-REQUIRED',
     'Anonymous or authenticated user upload via idauto.tn. Requires consent flow.'),
    ('CONTRIBUTOR_UPLOAD', 'Contribution — compte enregistré', 'contributor_upload', 2, TRUE,
     'LEGAL-REVIEW-REQUIRED',
     'Registered contributor with trust score. Higher limits than anonymous.'),
    ('SMART_GATE', 'Smart Gate — caméra entrée Fixpert', 'smart_gate', 3, TRUE,
     'LEGAL-REVIEW-REQUIRED — ANPR regulatory approval required before activation',
     'Single designated entrance/exit camera at Fixpert. Active=FALSE until IDA-4 + legal approval.'),
    ('PROFESSIONAL_SCAN', 'Scan professionnel — abonné vérifié', 'professional_scan', 4, TRUE,
     'LEGAL-REVIEW-REQUIRED',
     'Verified professional subscriber document or plate scan.'),
    ('MANUAL_ADMIN', 'Saisie manuelle — administrateur', 'manual_admin', 5, FALSE,
     'platform_administration',
     'Admin manual entry. Highest trust level. Audit-logged.'),
    ('OFFICIAL_IMPORT', 'Import source officielle', 'official_import', 5, FALSE,
     'LEGAL-REVIEW-REQUIRED — data-source agreement required before activation',
     'Authorised official data source import. Inactive until IDA-6 + legal agreement.');

-- Fixpert as a pilot professional organization (no real data)
INSERT INTO idauto_organizations
    (name, org_type, subscription_tier, address_city, status, is_fixpert_pilot)
VALUES
    ('Fixpert (Pilote Smart Gate)', 'garage', 'GARAGE', NULL, 'pending', TRUE);

-- =============================================================================
-- FIXPERT SCHEMA REFERENCE (documentation only — not created by this file)
-- =============================================================================
--
-- The fixpert schema is a separate product domain. Tables are listed here
-- for reference to document the integration boundary.
-- These CREATE TABLE statements are commented out — they belong to the Fixpert
-- product, not the ID Auto schema.
--
-- fixpert.clients       (customer PII — Fixpert-owned)
-- fixpert.work_orders   (workshop visits — references idauto.vehicles.id)
-- fixpert.interventions (technical operations)
-- fixpert.parts         (parts used)
-- fixpert.stock         (inventory)
-- fixpert.quotations    (customer quotations — Fixpert-owned)
-- fixpert.invoices      (billing — Fixpert-owned)
-- fixpert.payments      (payment records — Fixpert-owned)
--
-- Integration point:
--   fixpert.work_orders.vehicle_id → idauto.vehicles.id
--   (Fixpert references ID Auto vehicle identity; no reverse PII join)
--
-- =============================================================================

-- =============================================================================
-- END OF SCHEMA — IDA-2 Phase A source, applied and live-verified in IDA-2B
-- PostgreSQL runtime: private idauto-postgres service; API/UI remain undeployed reference implementations
-- =============================================================================
