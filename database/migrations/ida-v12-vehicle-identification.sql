-- =============================================================================
-- IDA-V12 — VEHICLE IDENTIFICATION, VEHICLE MEMORY, PARTS CATALOGUE, WORKSHOP
-- =============================================================================
-- Owner order, 2026-09-05 ("IDauto FINAL COMPLETION"): the workshop journey
-- CAMERA → ANPR → PLATE → VEHICLE → CATALOGUE → PARTS → ATELIER must exist end
-- to end, with a manual fallback at every step.
--
-- WHAT WAS ALREADY THERE and is therefore NOT repeated:
--   idauto_vehicles.make/model/variant/year/fuel_type/engine_cc    (IDA-2)
--   idauto_plates.plate_number (+ nospace index, IDA-V10)           — the plate
--   VIN as a scoped FACT with its reverse index (IDA-V10)           — the VIN
--   idauto_organizations                                            — the workshop
--   idauto_audit_log                                                — every write
--
-- WHAT THIS ADDS.
--   1. TUN_RS plate format row (config/idauto.example.json is the source; this
--      row exists because idauto_plates.format_code is a foreign key).
--   2. Identification columns on idauto_vehicles: motorisation, engine_code,
--      year_from/year_to, tecdoc_car_id and the PROVENANCE of the
--      identification (source, source timestamp, confidence, verified,
--      verified_by, verified_at, method). The public passport route selects
--      its columns by name and never reads these.
--   3. idauto_vehicle_identification_history — technical history only: what
--      the identification was, what it became, who changed it, how. No
--      customer data.
--   4. Parts CATALOGUE (idauto_parts, idauto_part_compatibility) — separate
--      from STOCK (idauto_org_stock, per organisation).
--   5. Workshop: customer_refs (an OPAQUE reference to the workshop's own
--      customer record — never a name, never a phone), visits, operations,
--      orders, order lines. Vehicle identity and customer identity never meet
--      in the same table: a visit points at a vehicle AND at a customer_ref,
--      and that is the only join.
--
-- PURELY ADDITIVE. No existing column changed, no row touched. REVERSIBLE —
-- see the DOWN block at the bottom.
-- =============================================================================

-- 1. RS plate format ---------------------------------------------------------
INSERT INTO idauto_plate_formats
    (code, name_fr, name_ar, pattern, example, introduced_year, active, verified, notes)
VALUES
    ('TUN_RS', 'Régime suspensif (RS)', 'نظام توقيفي',
     '^\d{1,3}\s?RS\s?\d{1,4}$', '123 RS 4567', NULL, TRUE, FALSE,
     'UNVERIFIED DRAFT (IDA-V12). Temporary-admission vehicles. Shape mirrored on the série normale.')
ON CONFLICT (code) DO NOTHING;

-- 2. Identification columns --------------------------------------------------
ALTER TABLE idauto_vehicles
    ADD COLUMN IF NOT EXISTS motorisation                VARCHAR(80),
    ADD COLUMN IF NOT EXISTS engine_code                 VARCHAR(30),
    ADD COLUMN IF NOT EXISTS year_from                   SMALLINT,
    ADD COLUMN IF NOT EXISTS year_to                     SMALLINT,
    ADD COLUMN IF NOT EXISTS tecdoc_car_id               INTEGER,
    ADD COLUMN IF NOT EXISTS identification_source       VARCHAR(40),
    ADD COLUMN IF NOT EXISTS identification_source_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS identification_confidence   REAL,
    ADD COLUMN IF NOT EXISTS identification_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS identification_verified_by  VARCHAR(64),
    ADD COLUMN IF NOT EXISTS identification_verified_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS identification_method       VARCHAR(40);

ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_ident_conf;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_ident_conf
    CHECK (identification_confidence IS NULL OR identification_confidence BETWEEN 0.0 AND 1.0);
ALTER TABLE idauto_vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_ident_method;
ALTER TABLE idauto_vehicles ADD CONSTRAINT chk_vehicle_ident_method
    CHECK (identification_method IS NULL OR identification_method IN
        ('plate_ocr','plate_manual','vin','manual_selection','provider','import','admin'));

CREATE INDEX IF NOT EXISTS idx_idauto_vehicles_tecdoc
    ON idauto_vehicles (tecdoc_car_id) WHERE tecdoc_car_id IS NOT NULL;

COMMENT ON COLUMN idauto_vehicles.tecdoc_car_id IS
    'IDA-V12. Catalogue vehicle id (TecDoc K-Type / carId) when known. Never invented: written only from a configured catalogue adapter or a human selection that names it.';
COMMENT ON COLUMN idauto_vehicles.identification_source IS
    'IDA-V12. Where the CURRENT identification came from: local | manual | provider:<name> | mock. Provenance, not authority.';
COMMENT ON COLUMN idauto_vehicles.identification_verified IS
    'IDA-V12. TRUE only after a human confirmed the identification (identification_verified_by / _at record who and when).';

-- 3. Identification history ----------------------------------------------------
CREATE TABLE IF NOT EXISTS idauto_vehicle_identification_history (
    id              BIGSERIAL    PRIMARY KEY,
    vehicle_id      INTEGER      NOT NULL REFERENCES idauto_vehicles(id),
    changed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor_type      VARCHAR(20)  NOT NULL,          -- admin | organisation | system
    actor_ref       VARCHAR(64),
    org_id          INTEGER      REFERENCES idauto_organizations(id),
    action          VARCHAR(30)  NOT NULL,          -- resolved | confirmed | edited | refreshed | rejected
    method          VARCHAR(40),
    source          VARCHAR(40),
    confidence      REAL,
    previous        JSONB,
    next            JSONB,
    CONSTRAINT chk_ident_hist_action CHECK (action IN ('resolved','confirmed','edited','refreshed','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_ident_hist_vehicle
    ON idauto_vehicle_identification_history (vehicle_id, changed_at DESC);
COMMENT ON TABLE idauto_vehicle_identification_history IS
    'IDA-V12. Technical identification history of a vehicle (what it was identified as, by whom, how). NO customer data, ever.';

-- 4. Parts CATALOGUE ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idauto_parts (
    id                   BIGSERIAL    PRIMARY KEY,
    reference            VARCHAR(60)  NOT NULL,
    reference_normalized VARCHAR(60)  NOT NULL,     -- uppercased, separators stripped
    brand                VARCHAR(80)  NOT NULL,
    oe_reference         VARCHAR(60),
    category             VARCHAR(80),
    name                 VARCHAR(200),
    tecdoc_article_id    BIGINT,                    -- only when a configured catalogue adapter supplied it
    source               VARCHAR(40)  NOT NULL DEFAULT 'local',   -- local | tecdoc | import
    org_id               INTEGER      REFERENCES idauto_organizations(id),  -- NULL = shared entry; set = that organisation's own reference
    created_by           VARCHAR(64),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_idauto_parts_ref_brand_org
    ON idauto_parts (reference_normalized, UPPER(brand), COALESCE(org_id, 0));
CREATE INDEX IF NOT EXISTS idx_idauto_parts_oe ON idauto_parts (oe_reference) WHERE oe_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_parts_category ON idauto_parts (category);
COMMENT ON TABLE idauto_parts IS
    'IDA-V12. Parts CATALOGUE: what a part is. Never stock, never price. Local entries are the workshop''s own references; tecdoc_article_id is set only by a configured catalogue adapter.';

CREATE TABLE IF NOT EXISTS idauto_part_compatibility (
    id              BIGSERIAL    PRIMARY KEY,
    part_id         BIGINT       NOT NULL REFERENCES idauto_parts(id),
    tecdoc_car_id   INTEGER,
    vehicle_id      INTEGER      REFERENCES idauto_vehicles(id),
    make            VARCHAR(80),
    model           VARCHAR(80),
    motorisation    VARCHAR(80),
    year_from       SMALLINT,
    year_to         SMALLINT,
    source          VARCHAR(40)  NOT NULL DEFAULT 'local',
    created_by      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_part_compat_target CHECK (tecdoc_car_id IS NOT NULL OR vehicle_id IS NOT NULL OR make IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_idauto_part_compat_tecdoc  ON idauto_part_compatibility (tecdoc_car_id) WHERE tecdoc_car_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_part_compat_vehicle ON idauto_part_compatibility (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idauto_part_compat_make    ON idauto_part_compatibility (UPPER(make), UPPER(model));
CREATE INDEX IF NOT EXISTS idx_idauto_part_compat_part    ON idauto_part_compatibility (part_id);

-- 5. STOCK — per organisation, separate from the catalogue ---------------------------
CREATE TABLE IF NOT EXISTS idauto_org_stock (
    id              BIGSERIAL    PRIMARY KEY,
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    part_id         BIGINT       NOT NULL REFERENCES idauto_parts(id),
    quantity        INTEGER      NOT NULL DEFAULT 0,
    price_millimes  BIGINT,
    currency        CHAR(3)      NOT NULL DEFAULT 'TND',
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_qty   CHECK (quantity >= 0),
    CONSTRAINT chk_stock_price CHECK (price_millimes IS NULL OR price_millimes >= 0),
    CONSTRAINT uq_stock_org_part UNIQUE (org_id, part_id)
);
COMMENT ON TABLE idauto_org_stock IS
    'IDA-V12. STOCK of one organisation for one catalogue part. Availability and price live here and only here; one organisation never reads another''s.';

-- 6. WORKSHOP ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idauto_workshop_customer_refs (
    id              BIGSERIAL    PRIMARY KEY,
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    customer_ref    VARCHAR(64)  NOT NULL,          -- the workshop system's own opaque id. [NO PII]
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_ref_org UNIQUE (org_id, customer_ref)
);
COMMENT ON TABLE idauto_workshop_customer_refs IS
    'IDA-V12. An OPAQUE pointer to a customer record held by the workshop''s own system. No name, no phone, no address — those never enter IDauto (PRIVACY_ARCHITECTURE §3).';

CREATE TABLE IF NOT EXISTS idauto_workshop_visits (
    id                      BIGSERIAL    PRIMARY KEY,
    org_id                  INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    vehicle_id              INTEGER      REFERENCES idauto_vehicles(id),
    customer_ref_id         BIGINT       REFERENCES idauto_workshop_customer_refs(id),
    status                  VARCHAR(20)  NOT NULL DEFAULT 'open',
    plate_read              VARCHAR(20),            -- canonical plate as read at arrival
    plate_read_method       VARCHAR(20),            -- camera_ocr | manual | none
    plate_read_confidence   REAL,
    identification_method   VARCHAR(40),            -- plate | vin | manual_selection
    reason                  VARCHAR(200),
    opened_by               VARCHAR(64)  NOT NULL,
    opened_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at               TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_visit_status CHECK (status IN ('open','in_progress','closed','cancelled')),
    CONSTRAINT chk_visit_plate_method CHECK (plate_read_method IS NULL OR plate_read_method IN ('camera_ocr','manual','none')),
    CONSTRAINT chk_visit_ident_method CHECK (identification_method IS NULL OR identification_method IN ('plate','vin','manual_selection'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_visits_org     ON idauto_workshop_visits (org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_idauto_visits_vehicle ON idauto_workshop_visits (vehicle_id) WHERE vehicle_id IS NOT NULL;
COMMENT ON TABLE idauto_workshop_visits IS
    'IDA-V12. One arrival of one vehicle at one workshop. Many visits per vehicle. Points at a vehicle and at an opaque customer_ref; never carries customer data itself.';

CREATE TABLE IF NOT EXISTS idauto_workshop_operations (
    id              BIGSERIAL    PRIMARY KEY,
    visit_id        BIGINT       NOT NULL REFERENCES idauto_workshop_visits(id),
    operation_type  VARCHAR(40)  NOT NULL,
    description     VARCHAR(300),
    part_id         BIGINT       REFERENCES idauto_parts(id),
    quantity        INTEGER      NOT NULL DEFAULT 1,
    status          VARCHAR(20)  NOT NULL DEFAULT 'planned',
    created_by      VARCHAR(64)  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_op_type   CHECK (operation_type IN ('diagnosis','replacement','service','repair','inspection','other')),
    CONSTRAINT chk_op_qty    CHECK (quantity > 0),
    CONSTRAINT chk_op_status CHECK (status IN ('planned','done','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_ops_visit ON idauto_workshop_operations (visit_id);

CREATE TABLE IF NOT EXISTS idauto_workshop_orders (
    id              BIGSERIAL    PRIMARY KEY,
    org_id          INTEGER      NOT NULL REFERENCES idauto_organizations(id),
    visit_id        BIGINT       REFERENCES idauto_workshop_visits(id),
    status          VARCHAR(20)  NOT NULL DEFAULT 'draft',
    supplier_ref    VARCHAR(120),
    created_by      VARCHAR(64)  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_order_status CHECK (status IN ('draft','placed','received','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_idauto_orders_org ON idauto_workshop_orders (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idauto_workshop_order_lines (
    id                   BIGSERIAL    PRIMARY KEY,
    order_id             BIGINT       NOT NULL REFERENCES idauto_workshop_orders(id),
    part_id              BIGINT       NOT NULL REFERENCES idauto_parts(id),
    quantity             INTEGER      NOT NULL,
    unit_price_millimes  BIGINT,
    CONSTRAINT chk_line_qty   CHECK (quantity > 0),
    CONSTRAINT chk_line_price CHECK (unit_price_millimes IS NULL OR unit_price_millimes >= 0)
);
CREATE INDEX IF NOT EXISTS idx_idauto_order_lines_order ON idauto_workshop_order_lines (order_id);

-- =============================================================================
-- DOWN
-- =============================================================================
-- DROP TABLE IF EXISTS idauto_workshop_order_lines, idauto_workshop_orders,
--   idauto_workshop_operations, idauto_workshop_visits, idauto_workshop_customer_refs,
--   idauto_org_stock, idauto_part_compatibility, idauto_parts,
--   idauto_vehicle_identification_history;
-- ALTER TABLE idauto_vehicles DROP COLUMN IF EXISTS motorisation, DROP COLUMN IF EXISTS engine_code,
--   DROP COLUMN IF EXISTS year_from, DROP COLUMN IF EXISTS year_to, DROP COLUMN IF EXISTS tecdoc_car_id,
--   DROP COLUMN IF EXISTS identification_source, DROP COLUMN IF EXISTS identification_source_at,
--   DROP COLUMN IF EXISTS identification_confidence, DROP COLUMN IF EXISTS identification_verified,
--   DROP COLUMN IF EXISTS identification_verified_by, DROP COLUMN IF EXISTS identification_verified_at,
--   DROP COLUMN IF EXISTS identification_method;
-- DELETE FROM idauto_plate_formats WHERE code = 'TUN_RS';
