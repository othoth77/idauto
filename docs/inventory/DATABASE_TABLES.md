# IDauto — database tables (production, live schema)

> Generated 2026-11-19 from the **running** production database `idauto_production` (container `idauto-postgres` on the VPS) with read-only catalogue queries (`information_schema`, `pg_constraint`, `pg_indexes`, `pg_class`). Row counts are exact `count(*)` at audit time; sizes are `pg_total_relation_size` (table + indexes + TOAST). Purpose = the table's own `COMMENT` in the database where one exists, otherwise marked *(no comment in DB)* with the role inferred from the code in brackets.
>
> No row contents are reproduced here. Other databases (staging, preview, test, the legacy `idauto` database) carry the same table set; their differences are listed in [DATABASE_INVENTORY.md](DATABASE_INVENTORY.md).

## Summary

| # | Table | Rows | Size | Purpose |
|---|---|---:|---:|---|
| 1 | [`idauto_audit_log`](#idauto_audit_log) | 1336 | 552 kB | Immutable append-only audit trail |
| 2 | [`idauto_auth_account`](#idauto_auth_account) | 1 | 48 kB | *(no comment in DB)* |
| 3 | [`idauto_auth_rate_limit`](#idauto_auth_rate_limit) | 2 | 80 kB | IDA-V13 |
| 4 | [`idauto_auth_session`](#idauto_auth_session) | 20 | 64 kB | IDA-V13 |
| 5 | [`idauto_auth_user`](#idauto_auth_user) | 1 | 48 kB | IDA-V13 |
| 6 | [`idauto_auth_verification`](#idauto_auth_verification) | 0 | 24 kB | *(no comment in DB)* |
| 7 | [`idauto_camera_sources`](#idauto_camera_sources) | 0 | 24 kB | Registered ANPR cameras (Smart Gate) |
| 8 | [`idauto_capture_sessions`](#idauto_capture_sessions) | 0 | 8192 bytes | Groups observations from a single user session |
| 9 | [`idauto_capture_sources`](#idauto_capture_sources) | 7 | 48 kB | Catalogue of data-origin types |
| 10 | [`idauto_consent_records`](#idauto_consent_records) | 0 | 32 kB | Legal basis and consent records |
| 11 | [`idauto_contributors`](#idauto_contributors) | 0 | 24 kB | Public contributor accounts |
| 12 | [`idauto_document_scans`](#idauto_document_scans) | 0 | 32 kB | Document scan records |
| 13 | [`idauto_fact_evidence`](#idauto_fact_evidence) | 10 | 40 kB | Additional evidence contributing to a fact confidence score. |
| 14 | [`idauto_governorates`](#idauto_governorates) | 24 | 40 kB | Tunisian governorate reference |
| 15 | [`idauto_media_archive`](#idauto_media_archive) | 6 | 104 kB | Update 4 |
| 16 | [`idauto_media_replicas`](#idauto_media_replicas) | 8 | 40 kB | *(no comment in DB)* |
| 17 | [`idauto_observation_locations`](#idauto_observation_locations) | 0 | 16 kB | Exact GPS coordinates per observation |
| 18 | [`idauto_observation_media`](#idauto_observation_media) | 2 | 80 kB | Object-storage references for images and documents |
| 19 | [`idauto_observations`](#idauto_observations) | 2 | 144 kB | Immutable capture events |
| 20 | [`idauto_org_stock`](#idauto_org_stock) | 0 | 16 kB | IDA-V12 |
| 21 | [`idauto_organizations`](#idauto_organizations) | 2 | 32 kB | Professional subscriber organizations |
| 22 | [`idauto_part_compatibility`](#idauto_part_compatibility) | 0 | 40 kB | *(no comment in DB)* |
| 23 | [`idauto_parts`](#idauto_parts) | 0 | 40 kB | IDA-V12 |
| 24 | [`idauto_plate_formats`](#idauto_plate_formats) | 8 | 48 kB | Configurable plate format rules |
| 25 | [`idauto_plates`](#idauto_plates) | 6 | 104 kB | Plate registration records |
| 26 | [`idauto_rate_limit_counters`](#idauto_rate_limit_counters) | 730 | 232 kB | Durable fixed-window ingestion rate-limit counters. |
| 27 | [`idauto_review_queue`](#idauto_review_queue) | 0 | 40 kB | Human review queue for uncertain, conflicting or flagged items. |
| 28 | [`idauto_scan_photos`](#idauto_scan_photos) | 1 | 72 kB | *(no comment in DB)* |
| 29 | [`idauto_service_events`](#idauto_service_events) | 0 | 40 kB | Professional service annotations |
| 30 | [`idauto_submissions`](#idauto_submissions) | 0 | 40 kB | Ingestion submission envelopes |
| 31 | [`idauto_user_roles`](#idauto_user_roles) | 0 | 16 kB | Role assignments for professional users |
| 32 | [`idauto_vehicle_documents`](#idauto_vehicle_documents) | 6 | 160 kB | IDA-V14 |
| 33 | [`idauto_vehicle_facts`](#idauto_vehicle_facts) | 5 | 128 kB | Versioned vehicle attributes |
| 34 | [`idauto_vehicle_identification_history`](#idauto_vehicle_identification_history) | 4 | 48 kB | IDA-V12 |
| 35 | [`idauto_vehicle_movements`](#idauto_vehicle_movements) | 0 | 40 kB | Smart Gate entry/exit events |
| 36 | [`idauto_vehicle_notes`](#idauto_vehicle_notes) | 1 | 48 kB | *(no comment in DB)* |
| 37 | [`idauto_vehicle_owner_contacts`](#idauto_vehicle_owner_contacts) | 2 | 80 kB | *(no comment in DB)* |
| 38 | [`idauto_vehicle_photos`](#idauto_vehicle_photos) | 1 | 48 kB | Update 3 |
| 39 | [`idauto_vehicles`](#idauto_vehicles) | 9 | 128 kB | Canonical vehicle fiche |
| 40 | [`idauto_verifications`](#idauto_verifications) | 0 | 32 kB | Every plate search event |
| 41 | [`idauto_workshop_customer_refs`](#idauto_workshop_customer_refs) | 0 | 16 kB | IDA-V12 |
| 42 | [`idauto_workshop_operations`](#idauto_workshop_operations) | 5 | 64 kB | *(no comment in DB)* |
| 43 | [`idauto_workshop_order_lines`](#idauto_workshop_order_lines) | 0 | 16 kB | *(no comment in DB)* |
| 44 | [`idauto_workshop_orders`](#idauto_workshop_orders) | 0 | 16 kB | *(no comment in DB)* |
| 45 | [`idauto_workshop_visits`](#idauto_workshop_visits) | 3 | 64 kB | IDA-V12 |

**Database objects other than tables** (live query): views 0, materialized views 0, triggers 0, functions in `public` 0, enum/custom types 0, extensions `plpgsql` only, schemas `public` only. Sequences: 36 (one per serial/identity column, listed at the end). There is **no migration-history table** in `idauto_production`: migrations are plain SQL files in `database/migrations/` applied by hand at deploy time (see [DATABASE_INVENTORY.md](DATABASE_INVENTORY.md#migration-history)).

---

## idauto_audit_log

**Rows:** 1336 · **Size:** 552 kB

**Purpose:** Immutable append-only audit trail. No row ever updated or deleted. No raw PII.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_audit_log_id_seq'::regclass)` |
| `event_time` | timestamp with time zone | NOT NULL | `now()` |
| `event_type` | character varying(60) | NOT NULL |  |
| `actor_type` | character varying(20) | NOT NULL |  |
| `actor_ref` | character varying(64) | NULL |  |
| `org_id` | integer | NULL |  |
| `target_type` | character varying(40) | NULL |  |
| `target_ref` | character varying(64) | NULL |  |
| `change_summary` | text | NULL |  |
| `old_value_json` | text | NULL |  |
| `new_value_json` | text | NULL |  |
| `ip_hash` | character varying(64) | NULL |  |
| `request_id` | character varying(64) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_audit_log_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `chk_audit_actor` | CHECK | `CHECK (((actor_type)::text = ANY ((ARRAY['system'::character varying, 'contributor'::character varying, 'professional_user'::character varying, 'admin'::character varying, 'anonymous'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_audit_log_pkey` | `CREATE UNIQUE INDEX idauto_audit_log_pkey ON idauto_audit_log USING btree (id)` |
| `idx_idauto_audit_actor` | `CREATE INDEX idx_idauto_audit_actor ON idauto_audit_log USING btree (actor_ref)` |
| `idx_idauto_audit_target` | `CREATE INDEX idx_idauto_audit_target ON idauto_audit_log USING btree (target_type, target_ref)` |
| `idx_idauto_audit_time` | `CREATE INDEX idx_idauto_audit_time ON idauto_audit_log USING btree (event_time)` |
| `idx_idauto_audit_type` | `CREATE INDEX idx_idauto_audit_type ON idauto_audit_log USING btree (event_type)` |
| `idx_idauto_audit_vin_search` | `CREATE INDEX idx_idauto_audit_vin_search ON idauto_audit_log USING btree (org_id, event_time) WHERE ((event_type)::text = 'vehicle.search.vin'::text)` |

---

## idauto_auth_account

**Rows:** 1 · **Size:** 48 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `issuer` | text | NOT NULL |  |
| `accountId` | text | NOT NULL |  |
| `providerId` | text | NOT NULL |  |
| `userId` | text | NOT NULL |  |
| `accessToken` | text | NULL |  |
| `refreshToken` | text | NULL |  |
| `idToken` | text | NULL |  |
| `accessTokenExpiresAt` | timestamp with time zone | NULL |  |
| `refreshTokenExpiresAt` | timestamp with time zone | NULL |  |
| `scope` | text | NULL |  |
| `password` | text | NULL |  |
| `createdAt` | timestamp with time zone | NOT NULL | `now()` |
| `updatedAt` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_auth_account_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_auth_account_userId_fkey` | FOREIGN KEY | `FOREIGN KEY ("userId") REFERENCES idauto_auth_user(id) ON DELETE CASCADE` |

| Index | Definition |
|---|---|
| `idauto_auth_account_pkey` | `CREATE UNIQUE INDEX idauto_auth_account_pkey ON idauto_auth_account USING btree (id)` |
| `idx_idauto_auth_account_user` | `CREATE INDEX idx_idauto_auth_account_user ON idauto_auth_account USING btree ("userId")` |

---

## idauto_auth_rate_limit

**Rows:** 2 · **Size:** 80 kB

**Purpose:** IDA-V13. Better Auth login/auth rate-limit counters (database storage, so every process shares them).

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `key` | text | NOT NULL |  |
| `count` | integer | NOT NULL |  |
| `lastRequest` | bigint | NOT NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_auth_rate_limit_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_auth_rate_limit_key_key` | UNIQUE | `UNIQUE (key)` |

| Index | Definition |
|---|---|
| `idauto_auth_rate_limit_key_key` | `CREATE UNIQUE INDEX idauto_auth_rate_limit_key_key ON idauto_auth_rate_limit USING btree (key)` |
| `idauto_auth_rate_limit_pkey` | `CREATE UNIQUE INDEX idauto_auth_rate_limit_pkey ON idauto_auth_rate_limit USING btree (id)` |

---

## idauto_auth_session

**Rows:** 20 · **Size:** 64 kB

**Purpose:** IDA-V13. Server-side sessions. The cookie carries a signed reference to token; validity is checked here on every request. Delete a row = revoke.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `expiresAt` | timestamp with time zone | NOT NULL |  |
| `token` | text | NOT NULL |  |
| `createdAt` | timestamp with time zone | NOT NULL | `now()` |
| `updatedAt` | timestamp with time zone | NOT NULL | `now()` |
| `ipAddress` | text | NULL |  |
| `userAgent` | text | NULL |  |
| `userId` | text | NOT NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_auth_session_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_auth_session_userId_fkey` | FOREIGN KEY | `FOREIGN KEY ("userId") REFERENCES idauto_auth_user(id) ON DELETE CASCADE` |
| `idauto_auth_session_token_key` | UNIQUE | `UNIQUE (token)` |

| Index | Definition |
|---|---|
| `idauto_auth_session_pkey` | `CREATE UNIQUE INDEX idauto_auth_session_pkey ON idauto_auth_session USING btree (id)` |
| `idauto_auth_session_token_key` | `CREATE UNIQUE INDEX idauto_auth_session_token_key ON idauto_auth_session USING btree (token)` |
| `idx_idauto_auth_session_user` | `CREATE INDEX idx_idauto_auth_session_user ON idauto_auth_session USING btree ("userId")` |

---

## idauto_auth_user

**Rows:** 1 · **Size:** 48 kB

**Purpose:** IDA-V13. Web users (Better Auth). role is read SERVER-SIDE only; org_id binds a manager/technician to one organisation. No password here (see idauto_auth_account).

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `email` | text | NOT NULL |  |
| `emailVerified` | boolean | NOT NULL | `false` |
| `image` | text | NULL |  |
| `createdAt` | timestamp with time zone | NOT NULL | `now()` |
| `updatedAt` | timestamp with time zone | NOT NULL | `now()` |
| `role` | text | NOT NULL | `'technician'::text` |
| `org_id` | integer | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_auth_user_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_auth_user_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_auth_user_email_key` | UNIQUE | `UNIQUE (email)` |
| `chk_auth_user_role` | CHECK | `CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'technician'::text])))` |

| Index | Definition |
|---|---|
| `idauto_auth_user_email_key` | `CREATE UNIQUE INDEX idauto_auth_user_email_key ON idauto_auth_user USING btree (email)` |
| `idauto_auth_user_pkey` | `CREATE UNIQUE INDEX idauto_auth_user_pkey ON idauto_auth_user USING btree (id)` |

---

## idauto_auth_verification

**Rows:** 0 · **Size:** 24 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `identifier` | text | NOT NULL |  |
| `value` | text | NOT NULL |  |
| `expiresAt` | timestamp with time zone | NOT NULL |  |
| `createdAt` | timestamp with time zone | NOT NULL | `now()` |
| `updatedAt` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_auth_verification_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |

| Index | Definition |
|---|---|
| `idauto_auth_verification_pkey` | `CREATE UNIQUE INDEX idauto_auth_verification_pkey ON idauto_auth_verification USING btree (id)` |
| `idx_idauto_auth_verification_identifier` | `CREATE INDEX idx_idauto_auth_verification_identifier ON idauto_auth_verification USING btree (identifier)` |

---

## idauto_camera_sources

**Rows:** 0 · **Size:** 24 kB

**Purpose:** Registered ANPR cameras (Smart Gate). active=FALSE until IDA-4 + legal approval.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_camera_sources_id_seq'::regclass)` |
| `camera_ref` | character varying(64) | NOT NULL |  |
| `capture_source_id` | integer | NOT NULL |  |
| `org_id` | integer | NULL |  |
| `location_label` | character varying(100) | NULL |  |
| `direction_mode` | character varying(30) | NOT NULL | `'single_zone'::character varying` |
| `stream_type` | character varying(20) | NOT NULL | `'rtsp'::character varying` |
| `active` | boolean | NOT NULL | `false` |
| `activated_at` | timestamp with time zone | NULL |  |
| `deactivated_at` | timestamp with time zone | NULL |  |
| `notes` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_camera_sources_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_camera_sources_capture_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (capture_source_id) REFERENCES idauto_capture_sources(id)` |
| `idauto_camera_sources_camera_ref_key` | UNIQUE | `UNIQUE (camera_ref)` |
| `chk_camera_dir` | CHECK | `CHECK (((direction_mode)::text = ANY ((ARRAY['single_zone'::character varying, 'dual_zone'::character varying, 'manual_review'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_camera_sources_camera_ref_key` | `CREATE UNIQUE INDEX idauto_camera_sources_camera_ref_key ON idauto_camera_sources USING btree (camera_ref)` |
| `idauto_camera_sources_pkey` | `CREATE UNIQUE INDEX idauto_camera_sources_pkey ON idauto_camera_sources USING btree (id)` |

---

## idauto_capture_sessions

**Rows:** 0 · **Size:** 8192 bytes

**Purpose:** Groups observations from a single user session. Used for rate limiting and abuse detection.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_capture_sessions_id_seq'::regclass)` |
| `session_token_hash` | character varying(64) | NOT NULL |  |
| `contributor_id` | integer | NULL |  |
| `capture_source_id` | integer | NOT NULL |  |
| `started_at` | timestamp with time zone | NOT NULL | `now()` |
| `ended_at` | timestamp with time zone | NULL |  |
| `observation_count` | integer | NOT NULL | `0` |
| `ip_hash` | character varying(64) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_capture_sessions_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_capture_sessions_capture_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (capture_source_id) REFERENCES idauto_capture_sources(id)` |
| `idauto_capture_sessions_contributor_id_fkey` | FOREIGN KEY | `FOREIGN KEY (contributor_id) REFERENCES idauto_contributors(id)` |
| `chk_session_dates` | CHECK | `CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))` |

| Index | Definition |
|---|---|
| `idauto_capture_sessions_pkey` | `CREATE UNIQUE INDEX idauto_capture_sessions_pkey ON idauto_capture_sessions USING btree (id)` |

---

## idauto_capture_sources

**Rows:** 7 · **Size:** 48 kB

**Purpose:** Catalogue of data-origin types. trust_level determines confidence weight.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_capture_sources_id_seq'::regclass)` |
| `code` | character varying(40) | NOT NULL |  |
| `name_fr` | character varying(100) | NOT NULL |  |
| `name_ar` | character varying(100) | NULL |  |
| `source_type` | character varying(30) | NOT NULL |  |
| `trust_level` | smallint | NOT NULL | `1` |
| `requires_consent` | boolean | NOT NULL | `false` |
| `legal_basis` | text | NULL |  |
| `active` | boolean | NOT NULL | `true` |
| `notes` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_capture_sources_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_capture_sources_code_key` | UNIQUE | `UNIQUE (code)` |
| `chk_source_type` | CHECK | `CHECK (((source_type)::text = ANY ((ARRAY['public_upload'::character varying, 'contributor_upload'::character varying, 'smart_gate'::character varying, 'professional_scan'::character varying, 'manual_admin'::character varying, 'official_import'::character varying, 'test'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_capture_sources_code_key` | `CREATE UNIQUE INDEX idauto_capture_sources_code_key ON idauto_capture_sources USING btree (code)` |
| `idauto_capture_sources_pkey` | `CREATE UNIQUE INDEX idauto_capture_sources_pkey ON idauto_capture_sources USING btree (id)` |

---

## idauto_consent_records

**Rows:** 0 · **Size:** 32 kB

**Purpose:** Legal basis and consent records. Required for Tunisian organic law 63-2004.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_consent_records_id_seq'::regclass)` |
| `subject_type` | character varying(30) | NOT NULL |  |
| `subject_ref` | character varying(64) | NOT NULL |  |
| `processing_purpose` | character varying(60) | NOT NULL |  |
| `legal_basis` | character varying(60) | NOT NULL |  |
| `consent_given` | boolean | NULL |  |
| `consent_version` | character varying(20) | NULL |  |
| `ip_hash` | character varying(64) | NULL |  |
| `granted_at` | timestamp with time zone | NOT NULL | `now()` |
| `withdrawn_at` | timestamp with time zone | NULL |  |
| `expires_at` | timestamp with time zone | NULL |  |
| `notes` | text | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_consent_records_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `chk_consent_basis` | CHECK | `CHECK (((legal_basis)::text = ANY ((ARRAY['legitimate_interest'::character varying, 'contract'::character varying, 'legal_obligation'::character varying, 'vital_interest'::character varying, 'public_task'::character varying, 'explicit_consent'::character varying])::text[])))` |
| `chk_consent_subject` | CHECK | `CHECK (((subject_type)::text = ANY ((ARRAY['organization'::character varying, 'user_role'::character varying, 'contributor'::character varying, 'anonymous_session'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_consent_records_pkey` | `CREATE UNIQUE INDEX idauto_consent_records_pkey ON idauto_consent_records USING btree (id)` |
| `idx_idauto_consent_active` | `CREATE INDEX idx_idauto_consent_active ON idauto_consent_records USING btree (withdrawn_at) WHERE (withdrawn_at IS NULL)` |
| `idx_idauto_consent_subject` | `CREATE INDEX idx_idauto_consent_subject ON idauto_consent_records USING btree (subject_type, subject_ref)` |

---

## idauto_contributors

**Rows:** 0 · **Size:** 24 kB

**Purpose:** Public contributor accounts. NO raw PII. Trust score derived from submission history.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_contributors_id_seq'::regclass)` |
| `mythos_user_id` | character varying(64) | NOT NULL |  |
| `trust_score` | smallint | NOT NULL | `10` |
| `total_submissions` | integer | NOT NULL | `0` |
| `accepted_submissions` | integer | NOT NULL | `0` |
| `rejected_submissions` | integer | NOT NULL | `0` |
| `blocked` | boolean | NOT NULL | `false` |
| `blocked_at` | timestamp with time zone | NULL |  |
| `blocked_reason` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_contributors_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_contributors_mythos_user_id_key` | UNIQUE | `UNIQUE (mythos_user_id)` |
| `chk_trust_score` | CHECK | `CHECK (((trust_score >= 0) AND (trust_score <= 100)))` |

| Index | Definition |
|---|---|
| `idauto_contributors_mythos_user_id_key` | `CREATE UNIQUE INDEX idauto_contributors_mythos_user_id_key ON idauto_contributors USING btree (mythos_user_id)` |
| `idauto_contributors_pkey` | `CREATE UNIQUE INDEX idauto_contributors_pkey ON idauto_contributors USING btree (id)` |

---

## idauto_document_scans

**Rows:** 0 · **Size:** 32 kB

**Purpose:** Document scan records. Original in protected storage. Owner PII is NEVER stored in this table — routed to fixpert.clients or discarded.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_document_scans_id_seq'::regclass)` |
| `observation_id` | bigint | NOT NULL |  |
| `vehicle_id` | integer | NULL |  |
| `document_type` | character varying(30) | NOT NULL |  |
| `media_id` | bigint | NULL |  |
| `ocr_raw_ref` | text | NULL |  |
| `extraction_status` | character varying(20) | NOT NULL | `'pending'::character varying` |
| `submitter_confirmed` | boolean | NOT NULL | `false` |
| `consent_declared` | boolean | NOT NULL | `false` |
| `has_owner_pii` | boolean | NOT NULL | `false` |
| `pii_handled` | boolean | NULL |  |
| `technical_fields_extracted` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_document_scans_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_document_scans_media_id_fkey` | FOREIGN KEY | `FOREIGN KEY (media_id) REFERENCES idauto_observation_media(id)` |
| `idauto_document_scans_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_document_scans_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_doc_status` | CHECK | `CHECK (((extraction_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'extracted'::character varying, 'confirmed'::character varying, 'failed'::character varying])::text[])))` |
| `chk_doc_type` | CHECK | `CHECK (((document_type)::text = ANY ((ARRAY['carte_grise'::character varying, 'technical_control'::character varying, 'assurance'::character varying, 'other'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_document_scans_pkey` | `CREATE UNIQUE INDEX idauto_document_scans_pkey ON idauto_document_scans USING btree (id)` |
| `idx_idauto_docs_obs` | `CREATE INDEX idx_idauto_docs_obs ON idauto_document_scans USING btree (observation_id)` |
| `idx_idauto_docs_vehicle` | `CREATE INDEX idx_idauto_docs_vehicle ON idauto_document_scans USING btree (vehicle_id)` |

---

## idauto_fact_evidence

**Rows:** 10 · **Size:** 40 kB

**Purpose:** Additional evidence contributing to a fact confidence score.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_fact_evidence_id_seq'::regclass)` |
| `fact_id` | bigint | NOT NULL |  |
| `evidence_type` | character varying(30) | NOT NULL |  |
| `evidence_ref` | character varying(64) | NULL |  |
| `weight` | real | NOT NULL | `0.1` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_fact_evidence_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_fact_evidence_fact_id_fkey` | FOREIGN KEY | `FOREIGN KEY (fact_id) REFERENCES idauto_vehicle_facts(id)` |
| `chk_evidence_type` | CHECK | `CHECK (((evidence_type)::text = ANY ((ARRAY['user_confirmation'::character varying, 'cross_source_match'::character varying, 'vin_decode'::character varying, 'document_scan'::character varying, 'document_scan_official'::character varying, 'professional_assertion'::character varying, 'automated_check'::character varying, 'admin_validation'::character varying])::text[])))` |
| `chk_evidence_weight` | CHECK | `CHECK (((weight >= (0.0)::double precision) AND (weight <= (1.0)::double precision)))` |

| Index | Definition |
|---|---|
| `idauto_fact_evidence_pkey` | `CREATE UNIQUE INDEX idauto_fact_evidence_pkey ON idauto_fact_evidence USING btree (id)` |
| `idx_idauto_evidence_fact` | `CREATE INDEX idx_idauto_evidence_fact ON idauto_fact_evidence USING btree (fact_id)` |

---

## idauto_governorates

**Rows:** 24 · **Size:** 40 kB

**Purpose:** Tunisian governorate reference. 24 governorates.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_governorates_id_seq'::regclass)` |
| `code` | character varying(4) | NOT NULL |  |
| `name_fr` | character varying(80) | NOT NULL |  |
| `name_ar` | character varying(80) | NULL |  |
| `region_fr` | character varying(80) | NULL |  |
| `active` | boolean | NOT NULL | `true` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_governorates_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_governorates_code_key` | UNIQUE | `UNIQUE (code)` |

| Index | Definition |
|---|---|
| `idauto_governorates_code_key` | `CREATE UNIQUE INDEX idauto_governorates_code_key ON idauto_governorates USING btree (code)` |
| `idauto_governorates_pkey` | `CREATE UNIQUE INDEX idauto_governorates_pkey ON idauto_governorates USING btree (id)` |

---

## idauto_media_archive

**Rows:** 6 · **Size:** 104 kB

**Purpose:** Update 4. One record per archived photograph / carte grise: dates, GPS (device or EXIF, never IP), source, uploader, original name and type, SHA-256, Haddad archive path, LENS reference. Never overwritten: a new capture is a new row. The VIN is read through the vehicle, not copied.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_media_archive_id_seq'::regclass)` |
| `object_key` | character varying(64) | NOT NULL |  |
| `category` | character varying(20) | NOT NULL |  |
| `vehicle_id` | integer | NULL |  |
| `document_id` | bigint | NULL |  |
| `scan_media_id` | bigint | NULL |  |
| `source` | character varying(20) | NOT NULL |  |
| `uploaded_by` | character varying(80) | NULL |  |
| `uploaded_at` | timestamp with time zone | NOT NULL | `now()` |
| `captured_at` | timestamp with time zone | NULL |  |
| `latitude` | double precision | NULL |  |
| `longitude` | double precision | NULL |  |
| `location_source` | character varying(10) | NULL |  |
| `place_name` | character varying(160) | NULL |  |
| `mime_type` | character varying(50) | NOT NULL |  |
| `original_filename` | character varying(255) | NULL |  |
| `sha256` | character varying(64) | NOT NULL |  |
| `byte_size` | integer | NULL |  |
| `archive_path` | character varying(200) | NULL |  |
| `archive_status` | character varying(12) | NOT NULL | `'pending'::character varying` |
| `archive_error` | character varying(200) | NULL |  |
| `lens_job_ref` | character varying(128) | NULL |  |
| `lens_status` | character varying(20) | NULL |  |
| `lens_fields` | jsonb | NULL |  |
| `meta_corrected_by` | character varying(80) | NULL |  |
| `meta_corrected_at` | timestamp with time zone | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_media_archive_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_media_archive_document_id_fkey` | FOREIGN KEY | `FOREIGN KEY (document_id) REFERENCES idauto_vehicle_documents(id) ON DELETE SET NULL` |
| `idauto_media_archive_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_arch_category` | CHECK | `CHECK (((category)::text = ANY ((ARRAY['vehicle-photos'::character varying, 'carte-grise'::character varying])::text[])))` |
| `chk_arch_coords` | CHECK | `CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))))` |
| `chk_arch_gps` | CHECK | `CHECK (((latitude IS NULL) OR ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying, 'manual'::character varying])::text[]))))` |
| `chk_arch_key` | CHECK | `CHECK ((((object_key)::text ~ '^[a-f0-9]{64}$'::text) AND ((sha256)::text ~ '^[a-f0-9]{64}$'::text)))` |
| `chk_arch_lens` | CHECK | `CHECK (((lens_fields IS NULL) OR ((jsonb_typeof(lens_fields) = 'array'::text) AND (pg_column_size(lens_fields) <= 4096))))` |
| `chk_arch_locsrc` | CHECK | `CHECK (((location_source IS NULL) OR ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying, 'manual'::character varying])::text[]))))` |
| `chk_arch_path` | CHECK | `CHECK (((archive_path IS NULL) OR ((archive_path)::text ~ '^[0-9]{4}/[0-9]{2}/(vehicle-photos\|carte-grise)/[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}(_[0-9]{1,18})?\.(jpg\|png\|webp\|pdf\|txt\|bin)$'::text)))` |
| `chk_arch_source` | CHECK | `CHECK (((source)::text = ANY ((ARRAY['public_scanner'::character varying, 'admin'::character varying, 'workshop'::character varying])::text[])))` |
| `chk_arch_status` | CHECK | `CHECK (((archive_status)::text = ANY ((ARRAY['pending'::character varying, 'stored'::character varying, 'failed'::character varying, 'removed'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_media_archive_pkey` | `CREATE UNIQUE INDEX idauto_media_archive_pkey ON idauto_media_archive USING btree (id)` |
| `idx_idauto_arch_key` | `CREATE INDEX idx_idauto_arch_key ON idauto_media_archive USING btree (object_key)` |
| `idx_idauto_arch_pending` | `CREATE INDEX idx_idauto_arch_pending ON idauto_media_archive USING btree (archive_status) WHERE ((archive_status)::text = ANY ((ARRAY['pending'::character varying, 'failed'::character varying])::text[]))` |
| `idx_idauto_arch_vehicle` | `CREATE INDEX idx_idauto_arch_vehicle ON idauto_media_archive USING btree (vehicle_id, category, uploaded_at DESC)` |
| `uq_idauto_arch_document` | `CREATE UNIQUE INDEX uq_idauto_arch_document ON idauto_media_archive USING btree (document_id) WHERE (document_id IS NOT NULL)` |
| `uq_idauto_arch_scan` | `CREATE UNIQUE INDEX uq_idauto_arch_scan ON idauto_media_archive USING btree (scan_media_id) WHERE (scan_media_id IS NOT NULL)` |

---

## idauto_media_replicas

**Rows:** 8 · **Size:** 40 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `object_key` | character varying(64) | NOT NULL |  |
| `target` | character varying(20) | NOT NULL |  |
| `status` | character varying(16) | NOT NULL | `'pending'::character varying` |
| `attempts` | integer | NOT NULL | `0` |
| `last_error` | character varying(200) | NULL |  |
| `replicated_at` | timestamp with time zone | NULL |  |
| `next_try_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_media_replicas_pkey` | PRIMARY KEY | `PRIMARY KEY (object_key, target)` |
| `chk_replica_key` | CHECK | `CHECK (((object_key)::text ~ '^[a-f0-9]{64}$'::text))` |
| `chk_replica_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'stored'::character varying, 'failed'::character varying, 'delete_pending'::character varying, 'deleted'::character varying])::text[])))` |
| `chk_replica_target` | CHECK | `CHECK (((target)::text = 'haddad'::text))` |

| Index | Definition |
|---|---|
| `idauto_media_replicas_pkey` | `CREATE UNIQUE INDEX idauto_media_replicas_pkey ON idauto_media_replicas USING btree (object_key, target)` |
| `idx_idauto_media_replicas_due` | `CREATE INDEX idx_idauto_media_replicas_due ON idauto_media_replicas USING btree (next_try_at) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'failed'::character varying, 'delete_pending'::character varying])::text[]))` |

---

## idauto_observation_locations

**Rows:** 0 · **Size:** 16 kB

**Purpose:** Exact GPS coordinates per observation. MYTHOS_PRIVATE. Never included in public API responses.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_observation_locations_id_seq'::regclass)` |
| `observation_id` | bigint | NOT NULL |  |
| `latitude` | double precision | NULL |  |
| `longitude` | double precision | NULL |  |
| `accuracy_m` | real | NULL |  |
| `location_method` | character varying(20) | NOT NULL | `'unknown'::character varying` |
| `governorate_id` | integer | NULL |  |
| `location_label` | character varying(200) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_observation_locations_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_observation_locations_governorate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (governorate_id) REFERENCES idauto_governorates(id)` |
| `idauto_observation_locations_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_observation_locations_observation_id_key` | UNIQUE | `UNIQUE (observation_id)` |

| Index | Definition |
|---|---|
| `idauto_observation_locations_observation_id_key` | `CREATE UNIQUE INDEX idauto_observation_locations_observation_id_key ON idauto_observation_locations USING btree (observation_id)` |
| `idauto_observation_locations_pkey` | `CREATE UNIQUE INDEX idauto_observation_locations_pkey ON idauto_observation_locations USING btree (id)` |

---

## idauto_observation_media

**Rows:** 2 · **Size:** 80 kB

**Purpose:** Object-storage references for images and documents. No image binary in database.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_observation_media_id_seq'::regclass)` |
| `observation_id` | bigint | NOT NULL |  |
| `derived_from_media_id` | bigint | NULL |  |
| `media_type` | character varying(20) | NOT NULL |  |
| `object_key` | text | NOT NULL |  |
| `mime_type` | character varying(50) | NULL |  |
| `width_px` | integer | NULL |  |
| `height_px` | integer | NULL |  |
| `file_size_bytes` | integer | NULL |  |
| `image_hash` | character varying(64) | NULL |  |
| `access_scope` | character varying(20) | NOT NULL | `'mythos_private'::character varying` |
| `blurred` | boolean | NOT NULL | `false` |
| `retention_status` | character varying(20) | NOT NULL | `'active'::character varying` |
| `accessed_count` | integer | NOT NULL | `0` |
| `last_accessed_at` | timestamp with time zone | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_observation_media_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_observation_media_derived_from_media_id_fkey` | FOREIGN KEY | `FOREIGN KEY (derived_from_media_id) REFERENCES idauto_observation_media(id)` |
| `idauto_observation_media_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `chk_media_retention` | CHECK | `CHECK (((retention_status)::text = ANY ((ARRAY['active'::character varying, 'pending_deletion'::character varying, 'deleted'::character varying, 'legal_hold'::character varying])::text[])))` |
| `chk_media_scope` | CHECK | `CHECK (((access_scope)::text = ANY ((ARRAY['mythos_private'::character varying, 'professional'::character varying, 'public'::character varying])::text[])))` |
| `chk_media_type` | CHECK | `CHECK (((media_type)::text = ANY ((ARRAY['original_image'::character varying, 'plate_crop'::character varying, 'vehicle_crop'::character varying, 'processed_derivative'::character varying, 'carte_grise_original'::character varying, 'carte_grise_derivative'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_observation_media_pkey` | `CREATE UNIQUE INDEX idauto_observation_media_pkey ON idauto_observation_media USING btree (id)` |
| `idx_idauto_media_hash` | `CREATE INDEX idx_idauto_media_hash ON idauto_observation_media USING btree (image_hash) WHERE (image_hash IS NOT NULL)` |
| `idx_idauto_media_obs` | `CREATE INDEX idx_idauto_media_obs ON idauto_observation_media USING btree (observation_id)` |
| `idx_idauto_media_scope` | `CREATE INDEX idx_idauto_media_scope ON idauto_observation_media USING btree (access_scope)` |

---

## idauto_observations

**Rows:** 2 · **Size:** 144 kB

**Purpose:** Immutable capture events. Every input creates one row. status is the only mutable column after creation.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_observations_id_seq'::regclass)` |
| `vehicle_id` | integer | NULL |  |
| `plate_id` | integer | NULL |  |
| `capture_source_id` | integer | NOT NULL |  |
| `capture_session_id` | bigint | NULL |  |
| `camera_source_id` | integer | NULL |  |
| `contributor_id` | integer | NULL |  |
| `capture_method` | character varying(30) | NOT NULL |  |
| `capture_time` | timestamp with time zone | NOT NULL | `now()` |
| `plate_candidate` | character varying(30) | NULL |  |
| `plate_normalised` | character varying(20) | NULL |  |
| `ocr_confidence` | real | NULL |  |
| `direction` | character varying(10) | NULL |  |
| `status` | character varying(20) | NOT NULL | `'received'::character varying` |
| `rejected_reason` | text | NULL |  |
| `ip_hash` | character varying(64) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `org_id` | integer | NULL |  |
| `author_ref` | character varying(64) | NULL |  |
| `source` | character varying(60) | NULL |  |
| `source_type` | character varying(30) | NULL |  |
| `source_reference` | character varying(200) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_observations_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_observations_camera_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (camera_source_id) REFERENCES idauto_camera_sources(id)` |
| `idauto_observations_capture_session_id_fkey` | FOREIGN KEY | `FOREIGN KEY (capture_session_id) REFERENCES idauto_capture_sessions(id)` |
| `idauto_observations_capture_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (capture_source_id) REFERENCES idauto_capture_sources(id)` |
| `idauto_observations_contributor_id_fkey` | FOREIGN KEY | `FOREIGN KEY (contributor_id) REFERENCES idauto_contributors(id)` |
| `idauto_observations_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_observations_plate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (plate_id) REFERENCES idauto_plates(id)` |
| `idauto_observations_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_obs_direction` | CHECK | `CHECK ((((direction)::text = ANY ((ARRAY['entry'::character varying, 'exit'::character varying, 'unknown'::character varying])::text[])) OR (direction IS NULL)))` |
| `chk_obs_method` | CHECK | `CHECK (((capture_method)::text = ANY ((ARRAY['plate_scan'::character varying, 'vehicle_scan'::character varying, 'carte_grise_scan'::character varying, 'smart_gate'::character varying, 'manual_admin'::character varying, 'professional_scan'::character varying, 'official_import'::character varying])::text[])))` |
| `chk_obs_org_provenance` | CHECK | `CHECK (((org_id IS NULL) OR ((author_ref IS NOT NULL) AND ((author_ref)::text <> ''::text) AND (source IS NOT NULL) AND ((source)::text <> ''::text) AND (source_type IS NOT NULL) AND ((source_type)::text <> ''::text) AND (source_reference IS NOT NULL) AND ((source_reference)::text <> ''::text))))` |
| `chk_obs_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['received'::character varying, 'processing'::character varying, 'pending_confirmation'::character varying, 'pending_review'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'duplicate'::character varying, 'conflict'::character varying, 'blocked'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_observations_pkey` | `CREATE UNIQUE INDEX idauto_observations_pkey ON idauto_observations USING btree (id)` |
| `idx_idauto_obs_camera` | `CREATE INDEX idx_idauto_obs_camera ON idauto_observations USING btree (camera_source_id)` |
| `idx_idauto_obs_plate` | `CREATE INDEX idx_idauto_obs_plate ON idauto_observations USING btree (plate_id)` |
| `idx_idauto_obs_source` | `CREATE INDEX idx_idauto_obs_source ON idauto_observations USING btree (capture_source_id)` |
| `idx_idauto_obs_status` | `CREATE INDEX idx_idauto_obs_status ON idauto_observations USING btree (status)` |
| `idx_idauto_obs_time` | `CREATE INDEX idx_idauto_obs_time ON idauto_observations USING btree (capture_time)` |
| `idx_idauto_obs_vehicle` | `CREATE INDEX idx_idauto_obs_vehicle ON idauto_observations USING btree (vehicle_id)` |
| `idx_idauto_observations_org` | `CREATE INDEX idx_idauto_observations_org ON idauto_observations USING btree (org_id) WHERE (org_id IS NOT NULL)` |
| `idx_idauto_observations_source_ref` | `CREATE INDEX idx_idauto_observations_source_ref ON idauto_observations USING btree (org_id, source_reference) WHERE (org_id IS NOT NULL)` |

---

## idauto_org_stock

**Rows:** 0 · **Size:** 16 kB

**Purpose:** IDA-V12. STOCK of one organisation for one catalogue part. Availability and price live here and only here; one organisation never reads another's.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_org_stock_id_seq'::regclass)` |
| `org_id` | integer | NOT NULL |  |
| `part_id` | bigint | NOT NULL |  |
| `quantity` | integer | NOT NULL | `0` |
| `price_millimes` | bigint | NULL |  |
| `currency` | character(3) | NOT NULL | `'TND'::bpchar` |
| `updated_by` | character varying(64) | NULL |  |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_org_stock_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_org_stock_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_org_stock_part_id_fkey` | FOREIGN KEY | `FOREIGN KEY (part_id) REFERENCES idauto_parts(id)` |
| `uq_stock_org_part` | UNIQUE | `UNIQUE (org_id, part_id)` |
| `chk_stock_price` | CHECK | `CHECK (((price_millimes IS NULL) OR (price_millimes >= 0)))` |
| `chk_stock_qty` | CHECK | `CHECK ((quantity >= 0))` |

| Index | Definition |
|---|---|
| `idauto_org_stock_pkey` | `CREATE UNIQUE INDEX idauto_org_stock_pkey ON idauto_org_stock USING btree (id)` |
| `uq_stock_org_part` | `CREATE UNIQUE INDEX uq_stock_org_part ON idauto_org_stock USING btree (org_id, part_id)` |

---

## idauto_organizations

**Rows:** 2 · **Size:** 32 kB

**Purpose:** Professional subscriber organizations. tax_id is entity identifier.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_organizations_id_seq'::regclass)` |
| `name` | character varying(200) | NOT NULL |  |
| `org_type` | character varying(30) | NOT NULL |  |
| `subscription_tier` | character varying(20) | NOT NULL | `'GARAGE'::character varying` |
| `tax_id` | character varying(30) | NULL |  |
| `address_city` | character varying(80) | NULL |  |
| `governorate_id` | integer | NULL |  |
| `contact_email` | character varying(200) | NULL |  |
| `status` | character varying(20) | NOT NULL | `'pending'::character varying` |
| `verified_at` | timestamp with time zone | NULL |  |
| `is_fixpert_pilot` | boolean | NOT NULL | `false` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_organizations_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_organizations_governorate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (governorate_id) REFERENCES idauto_governorates(id)` |
| `chk_org_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'suspended'::character varying, 'cancelled'::character varying])::text[])))` |
| `chk_org_type` | CHECK | `CHECK (((org_type)::text = ANY ((ARRAY['garage'::character varying, 'insurer'::character varying, 'fleet'::character varying, 'judicial'::character varying, 'government'::character varying, 'other'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_organizations_pkey` | `CREATE UNIQUE INDEX idauto_organizations_pkey ON idauto_organizations USING btree (id)` |

---

## idauto_part_compatibility

**Rows:** 0 · **Size:** 40 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_part_compatibility_id_seq'::regclass)` |
| `part_id` | bigint | NOT NULL |  |
| `tecdoc_car_id` | integer | NULL |  |
| `vehicle_id` | integer | NULL |  |
| `make` | character varying(80) | NULL |  |
| `model` | character varying(80) | NULL |  |
| `motorisation` | character varying(80) | NULL |  |
| `year_from` | smallint | NULL |  |
| `year_to` | smallint | NULL |  |
| `source` | character varying(40) | NOT NULL | `'local'::character varying` |
| `created_by` | character varying(64) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_part_compatibility_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_part_compatibility_part_id_fkey` | FOREIGN KEY | `FOREIGN KEY (part_id) REFERENCES idauto_parts(id)` |
| `idauto_part_compatibility_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_part_compat_target` | CHECK | `CHECK (((tecdoc_car_id IS NOT NULL) OR (vehicle_id IS NOT NULL) OR (make IS NOT NULL)))` |

| Index | Definition |
|---|---|
| `idauto_part_compatibility_pkey` | `CREATE UNIQUE INDEX idauto_part_compatibility_pkey ON idauto_part_compatibility USING btree (id)` |
| `idx_idauto_part_compat_make` | `CREATE INDEX idx_idauto_part_compat_make ON idauto_part_compatibility USING btree (upper((make)::text), upper((model)::text))` |
| `idx_idauto_part_compat_part` | `CREATE INDEX idx_idauto_part_compat_part ON idauto_part_compatibility USING btree (part_id)` |
| `idx_idauto_part_compat_tecdoc` | `CREATE INDEX idx_idauto_part_compat_tecdoc ON idauto_part_compatibility USING btree (tecdoc_car_id) WHERE (tecdoc_car_id IS NOT NULL)` |
| `idx_idauto_part_compat_vehicle` | `CREATE INDEX idx_idauto_part_compat_vehicle ON idauto_part_compatibility USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL)` |

---

## idauto_parts

**Rows:** 0 · **Size:** 40 kB

**Purpose:** IDA-V12. Parts CATALOGUE: what a part is. Never stock, never price. Local entries are the workshop's own references; tecdoc_article_id is set only by a configured catalogue adapter.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_parts_id_seq'::regclass)` |
| `reference` | character varying(60) | NOT NULL |  |
| `reference_normalized` | character varying(60) | NOT NULL |  |
| `brand` | character varying(80) | NOT NULL |  |
| `oe_reference` | character varying(60) | NULL |  |
| `category` | character varying(80) | NULL |  |
| `name` | character varying(200) | NULL |  |
| `tecdoc_article_id` | bigint | NULL |  |
| `source` | character varying(40) | NOT NULL | `'local'::character varying` |
| `org_id` | integer | NULL |  |
| `created_by` | character varying(64) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_parts_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_parts_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |

| Index | Definition |
|---|---|
| `idauto_parts_pkey` | `CREATE UNIQUE INDEX idauto_parts_pkey ON idauto_parts USING btree (id)` |
| `idx_idauto_parts_category` | `CREATE INDEX idx_idauto_parts_category ON idauto_parts USING btree (category)` |
| `idx_idauto_parts_oe` | `CREATE INDEX idx_idauto_parts_oe ON idauto_parts USING btree (oe_reference) WHERE (oe_reference IS NOT NULL)` |
| `uidx_idauto_parts_ref_brand_org` | `CREATE UNIQUE INDEX uidx_idauto_parts_ref_brand_org ON idauto_parts USING btree (reference_normalized, upper((brand)::text), COALESCE(org_id, 0))` |

---

## idauto_plate_formats

**Rows:** 8 · **Size:** 48 kB

**Purpose:** Configurable plate format rules. verified=FALSE means unconfirmed against official source.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_plate_formats_id_seq'::regclass)` |
| `code` | character varying(20) | NOT NULL |  |
| `name_fr` | character varying(100) | NOT NULL |  |
| `name_ar` | character varying(100) | NULL |  |
| `pattern` | text | NOT NULL |  |
| `example` | character varying(30) | NULL |  |
| `introduced_year` | integer | NULL |  |
| `active` | boolean | NOT NULL | `true` |
| `captures_json` | text | NULL |  |
| `notes` | text | NULL |  |
| `verified` | boolean | NOT NULL | `false` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_plate_formats_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_plate_formats_code_key` | UNIQUE | `UNIQUE (code)` |

| Index | Definition |
|---|---|
| `idauto_plate_formats_code_key` | `CREATE UNIQUE INDEX idauto_plate_formats_code_key ON idauto_plate_formats USING btree (code)` |
| `idauto_plate_formats_pkey` | `CREATE UNIQUE INDEX idauto_plate_formats_pkey ON idauto_plate_formats USING btree (id)` |

---

## idauto_plates

**Rows:** 6 · **Size:** 104 kB

**Purpose:** Plate registration records. NO owner PII. One plate per row.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_plates_id_seq'::regclass)` |
| `plate_number` | character varying(20) | NOT NULL |  |
| `plate_raw` | character varying(30) | NULL |  |
| `format_code` | character varying(20) | NOT NULL |  |
| `governorate_id` | integer | NULL |  |
| `vehicle_id` | integer | NULL |  |
| `status` | character varying(20) | NOT NULL | `'active'::character varying` |
| `valid_from` | date | NULL |  |
| `valid_until` | date | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_plates_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_plates_format_code_fkey` | FOREIGN KEY | `FOREIGN KEY (format_code) REFERENCES idauto_plate_formats(code)` |
| `idauto_plates_governorate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (governorate_id) REFERENCES idauto_governorates(id)` |
| `idauto_plates_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_plates_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'cancelled'::character varying, 'exported'::character varying, 'stolen'::character varying, 'unknown'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_plates_pkey` | `CREATE UNIQUE INDEX idauto_plates_pkey ON idauto_plates USING btree (id)` |
| `idx_idauto_plates_format` | `CREATE INDEX idx_idauto_plates_format ON idauto_plates USING btree (format_code)` |
| `idx_idauto_plates_nospace` | `CREATE INDEX idx_idauto_plates_nospace ON idauto_plates USING btree (replace((plate_number)::text, ' '::text, ''::text))` |
| `idx_idauto_plates_status` | `CREATE INDEX idx_idauto_plates_status ON idauto_plates USING btree (status)` |
| `idx_idauto_plates_vehicle` | `CREATE INDEX idx_idauto_plates_vehicle ON idauto_plates USING btree (vehicle_id)` |
| `uidx_idauto_plates_number_active` | `CREATE UNIQUE INDEX uidx_idauto_plates_number_active ON idauto_plates USING btree (plate_number) WHERE ((status)::text = 'active'::text)` |

---

## idauto_rate_limit_counters

**Rows:** 730 · **Size:** 232 kB

**Purpose:** Durable fixed-window ingestion rate-limit counters.

| Column | Type | Null | Default |
|---|---|---|---|
| `bucket_key` | character varying(64) | NOT NULL |  |
| `window_start` | timestamp with time zone | NOT NULL |  |
| `count` | integer | NOT NULL | `0` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_rate_limit_counters_pkey` | PRIMARY KEY | `PRIMARY KEY (bucket_key, window_start)` |

| Index | Definition |
|---|---|
| `idauto_rate_limit_counters_pkey` | `CREATE UNIQUE INDEX idauto_rate_limit_counters_pkey ON idauto_rate_limit_counters USING btree (bucket_key, window_start)` |

---

## idauto_review_queue

**Rows:** 0 · **Size:** 40 kB

**Purpose:** Human review queue for uncertain, conflicting or flagged items.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_review_queue_id_seq'::regclass)` |
| `item_type` | character varying(30) | NOT NULL |  |
| `item_ref` | bigint | NOT NULL |  |
| `vehicle_id` | integer | NULL |  |
| `reason` | character varying(50) | NOT NULL |  |
| `priority` | smallint | NOT NULL | `3` |
| `status` | character varying(20) | NOT NULL | `'pending'::character varying` |
| `assigned_to` | character varying(64) | NULL |  |
| `assigned_at` | timestamp with time zone | NULL |  |
| `resolved_at` | timestamp with time zone | NULL |  |
| `resolution` | character varying(30) | NULL |  |
| `resolution_notes` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_review_queue_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_review_queue_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_queue_item` | CHECK | `CHECK (((item_type)::text = ANY ((ARRAY['observation'::character varying, 'fact'::character varying, 'document_scan'::character varying, 'contributor_report'::character varying])::text[])))` |
| `chk_queue_priority` | CHECK | `CHECK (((priority >= 1) AND (priority <= 4)))` |
| `chk_queue_reason` | CHECK | `CHECK (((reason)::text = ANY ((ARRAY['low_confidence'::character varying, 'unknown_format'::character varying, 'fact_conflict'::character varying, 'duplicate_image'::character varying, 'new_contributor'::character varying, 'low_trust_contributor'::character varying, 'ocr_uncertainty'::character varying, 'abuse_report'::character varying, 'admin_escalation'::character varying])::text[])))` |
| `chk_queue_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_review'::character varying, 'resolved'::character varying, 'escalated'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_review_queue_pkey` | `CREATE UNIQUE INDEX idauto_review_queue_pkey ON idauto_review_queue USING btree (id)` |
| `idx_idauto_queue_assigned` | `CREATE INDEX idx_idauto_queue_assigned ON idauto_review_queue USING btree (assigned_to) WHERE (assigned_to IS NOT NULL)` |
| `idx_idauto_queue_status` | `CREATE INDEX idx_idauto_queue_status ON idauto_review_queue USING btree (status, priority)` |
| `idx_idauto_queue_vehicle` | `CREATE INDEX idx_idauto_queue_vehicle ON idauto_review_queue USING btree (vehicle_id)` |

---

## idauto_scan_photos

**Rows:** 1 · **Size:** 72 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `media_id` | bigint | NOT NULL |  |
| `observation_id` | bigint | NOT NULL |  |
| `token` | character varying(43) | NOT NULL |  |
| `org_id` | integer | NULL |  |
| `actor_ref` | character varying(80) | NOT NULL |  |
| `view` | character varying(10) | NOT NULL | `'unknown'::character varying` |
| `captured_at` | timestamp with time zone | NULL |  |
| `latitude` | double precision | NULL |  |
| `longitude` | double precision | NULL |  |
| `place_name` | character varying(120) | NULL |  |
| `governorate` | character varying(60) | NULL |  |
| `country` | character varying(60) | NULL |  |
| `location_source` | character varying(10) | NULL |  |
| `analysis` | jsonb | NULL |  |
| `analysis_status` | character varying(12) | NOT NULL | `'pending'::character varying` |
| `confirmed` | boolean | NOT NULL | `false` |
| `vehicle_id` | integer | NULL |  |
| `attached_document_id` | bigint | NULL |  |
| `expires_at` | timestamp with time zone | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_scan_photos_pkey` | PRIMARY KEY | `PRIMARY KEY (media_id)` |
| `idauto_scan_photos_attached_document_id_fkey` | FOREIGN KEY | `FOREIGN KEY (attached_document_id) REFERENCES idauto_vehicle_documents(id) ON DELETE SET NULL` |
| `idauto_scan_photos_media_id_fkey` | FOREIGN KEY | `FOREIGN KEY (media_id) REFERENCES idauto_observation_media(id) ON DELETE CASCADE` |
| `idauto_scan_photos_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_scan_photos_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_scan_photos_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `idauto_scan_photos_token_key` | UNIQUE | `UNIQUE (token)` |
| `chk_scan_analysis` | CHECK | `CHECK (((analysis IS NULL) OR ((jsonb_typeof(analysis) = 'object'::text) AND (pg_column_size(analysis) <= 8192))))` |
| `chk_scan_astatus` | CHECK | `CHECK (((analysis_status)::text = ANY ((ARRAY['pending'::character varying, 'done'::character varying, 'failed'::character varying])::text[])))` |
| `chk_scan_coords` | CHECK | `CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))))` |
| `chk_scan_gps_src` | CHECK | `CHECK (((latitude IS NULL) OR ((location_source IS NOT NULL) AND ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying])::text[])))))` |
| `chk_scan_source` | CHECK | `CHECK (((location_source IS NULL) OR ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying, 'manual'::character varying])::text[]))))` |
| `chk_scan_view` | CHECK | `CHECK (((view)::text = ANY ((ARRAY['front'::character varying, 'rear'::character varying, 'unknown'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_scan_photos_pkey` | `CREATE UNIQUE INDEX idauto_scan_photos_pkey ON idauto_scan_photos USING btree (media_id)` |
| `idauto_scan_photos_token_key` | `CREATE UNIQUE INDEX idauto_scan_photos_token_key ON idauto_scan_photos USING btree (token)` |
| `idx_idauto_scan_photos_expiry` | `CREATE INDEX idx_idauto_scan_photos_expiry ON idauto_scan_photos USING btree (expires_at) WHERE (expires_at IS NOT NULL)` |
| `idx_idauto_scan_photos_vehicle` | `CREATE INDEX idx_idauto_scan_photos_vehicle ON idauto_scan_photos USING btree (vehicle_id)` |

---

## idauto_service_events

**Rows:** 0 · **Size:** 40 kB

**Purpose:** Professional service annotations. NO customer PII. is_public controls cross-org visibility.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_service_events_id_seq'::regclass)` |
| `vehicle_id` | integer | NOT NULL |  |
| `plate_id` | integer | NULL |  |
| `org_id` | integer | NOT NULL |  |
| `user_role_id` | integer | NOT NULL |  |
| `event_type` | character varying(40) | NOT NULL |  |
| `event_date` | date | NOT NULL |  |
| `odometer_km` | integer | NULL |  |
| `description` | text | NULL |  |
| `outcome` | character varying(30) | NULL |  |
| `next_service_due` | date | NULL |  |
| `is_public` | boolean | NOT NULL | `false` |
| `source_ref` | text | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_service_events_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_service_events_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_service_events_plate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (plate_id) REFERENCES idauto_plates(id)` |
| `idauto_service_events_user_role_id_fkey` | FOREIGN KEY | `FOREIGN KEY (user_role_id) REFERENCES idauto_user_roles(id)` |
| `idauto_service_events_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_event_outcome` | CHECK | `CHECK ((((outcome)::text = ANY ((ARRAY['pass'::character varying, 'fail'::character varying, 'conditional'::character varying, 'informational'::character varying])::text[])) OR (outcome IS NULL)))` |

| Index | Definition |
|---|---|
| `idauto_service_events_pkey` | `CREATE UNIQUE INDEX idauto_service_events_pkey ON idauto_service_events USING btree (id)` |
| `idx_idauto_svc_date` | `CREATE INDEX idx_idauto_svc_date ON idauto_service_events USING btree (event_date)` |
| `idx_idauto_svc_org` | `CREATE INDEX idx_idauto_svc_org ON idauto_service_events USING btree (org_id)` |
| `idx_idauto_svc_vehicle` | `CREATE INDEX idx_idauto_svc_vehicle ON idauto_service_events USING btree (vehicle_id)` |

---

## idauto_submissions

**Rows:** 0 · **Size:** 40 kB

**Purpose:** Ingestion submission envelopes. Durable idempotency anchors, including rejected and duplicate submissions.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_submissions_id_seq'::regclass)` |
| `idempotency_key` | character varying(64) | NOT NULL |  |
| `actor_ref` | character varying(64) | NULL |  |
| `actor_type` | character varying(20) | NOT NULL |  |
| `capture_source_id` | integer | NULL |  |
| `ip_hash` | character varying(64) | NULL |  |
| `received_at` | timestamp with time zone | NOT NULL | `now()` |
| `status` | character varying(20) | NOT NULL | `'pending'::character varying` |
| `observation_id` | bigint | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_submissions_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_submissions_capture_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (capture_source_id) REFERENCES idauto_capture_sources(id)` |
| `idauto_submissions_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_submissions_idempotency_key_key` | UNIQUE | `UNIQUE (idempotency_key)` |
| `chk_submission_actor` | CHECK | `CHECK (((actor_type)::text = ANY ((ARRAY['system'::character varying, 'contributor'::character varying, 'professional_user'::character varying, 'admin'::character varying, 'anonymous'::character varying])::text[])))` |
| `chk_submission_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'duplicate'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_submissions_idempotency_key_key` | `CREATE UNIQUE INDEX idauto_submissions_idempotency_key_key ON idauto_submissions USING btree (idempotency_key)` |
| `idauto_submissions_pkey` | `CREATE UNIQUE INDEX idauto_submissions_pkey ON idauto_submissions USING btree (id)` |
| `idx_idauto_submissions_ip_hash` | `CREATE INDEX idx_idauto_submissions_ip_hash ON idauto_submissions USING btree (ip_hash)` |
| `idx_idauto_submissions_observation_id` | `CREATE INDEX idx_idauto_submissions_observation_id ON idauto_submissions USING btree (observation_id)` |
| `idx_idauto_submissions_status` | `CREATE INDEX idx_idauto_submissions_status ON idauto_submissions USING btree (status)` |

---

## idauto_user_roles

**Rows:** 0 · **Size:** 16 kB

**Purpose:** Role assignments for professional users. Identity from Mythos OS. No raw PII.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_user_roles_id_seq'::regclass)` |
| `mythos_user_id` | character varying(64) | NOT NULL |  |
| `org_id` | integer | NOT NULL |  |
| `role` | character varying(30) | NOT NULL | `'member'::character varying` |
| `status` | character varying(20) | NOT NULL | `'active'::character varying` |
| `granted_at` | timestamp with time zone | NOT NULL | `now()` |
| `granted_by` | character varying(64) | NULL |  |
| `revoked_at` | timestamp with time zone | NULL |  |
| `revoked_by` | character varying(64) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_user_roles_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_user_roles_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `uq_user_org` | UNIQUE | `UNIQUE (mythos_user_id, org_id)` |
| `chk_user_role` | CHECK | `CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying, 'readonly'::character varying])::text[])))` |
| `chk_user_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'revoked'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_user_roles_pkey` | `CREATE UNIQUE INDEX idauto_user_roles_pkey ON idauto_user_roles USING btree (id)` |
| `uq_user_org` | `CREATE UNIQUE INDEX uq_user_org ON idauto_user_roles USING btree (mythos_user_id, org_id)` |

---

## idauto_vehicle_documents

**Rows:** 6 · **Size:** 160 kB

**Purpose:** IDA-V14. Registration document (carte grise) faces of a vehicle: metadata + storage key. Image bytes are in the private media store. ocr_fields = technical fields only. Sensitive: holder data is on the image, never in a column.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_documents_id_seq'::regclass)` |
| `vehicle_id` | integer | NULL |  |
| `org_id` | integer | NULL |  |
| `document_type` | character varying(30) | NOT NULL | `'carte_grise'::character varying` |
| `face` | smallint | NOT NULL |  |
| `storage_key` | text | NOT NULL |  |
| `thumb_storage_key` | text | NULL |  |
| `mime_type` | character varying(50) | NOT NULL |  |
| `byte_size` | integer | NOT NULL |  |
| `width` | integer | NOT NULL |  |
| `height` | integer | NOT NULL |  |
| `sha256` | character varying(64) | NOT NULL |  |
| `original_byte_size` | integer | NULL |  |
| `capture_meta` | jsonb | NULL |  |
| `ocr_status` | character varying(20) | NOT NULL | `'none'::character varying` |
| `ocr_confidence` | real | NULL |  |
| `ocr_fields` | jsonb | NULL |  |
| `ocr_at` | timestamp with time zone | NULL |  |
| `created_by` | character varying(64) | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `version` | integer | NOT NULL | `1` |
| `superseded_at` | timestamp with time zone | NULL |  |
| `superseded_by` | bigint | NULL |  |
| `original_filename` | character varying(255) | NULL |  |
| `source_format` | character varying(24) | NOT NULL | `'CARTE_GRISE_IMAGE'::character varying` |
| `input_method` | character varying(16) | NOT NULL | `'legacy'::character varying` |
| `derived_storage_key` | text | NULL |  |
| `text_chars` | integer | NULL |  |
| `review_status` | character varying(16) | NOT NULL | `'accepted'::character varying` |
| `reviewed_by` | character varying(80) | NULL |  |
| `reviewed_at` | timestamp with time zone | NULL |  |
| `processing_status` | character varying(16) | NOT NULL | `'NONE'::character varying` |
| `lens_job_ref` | character varying(128) | NULL |  |
| `lens_extraction` | jsonb | NULL |  |
| `extraction_version` | character varying(64) | NULL |  |
| `processed_at` | timestamp with time zone | NULL |  |
| `validation_status` | character varying(20) | NOT NULL | `'NOT_VALIDATED'::character varying` |
| `intake_status` | character varying(24) | NULL |  |
| `intake_fields` | jsonb | NULL |  |
| `resolved_by` | character varying(80) | NULL |  |
| `resolved_at` | timestamp with time zone | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_documents_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_documents_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_vehicle_documents_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_vdoc_conf` | CHECK | `CHECK (((ocr_confidence IS NULL) OR ((ocr_confidence >= (0.0)::double precision) AND (ocr_confidence <= (1.0)::double precision))))` |
| `chk_vdoc_face` | CHECK | `CHECK (((((document_type)::text = 'carte_grise'::text) AND (face = ANY (ARRAY[1, 2]))) OR (((document_type)::text = 'vehicle_photo'::text) AND ((face >= 1) AND (face <= 999)))))` |
| `chk_vdoc_format_mime` | CHECK | `CHECK (((((source_format)::text = 'CARTE_GRISE_IMAGE'::text) AND ((mime_type)::text ~~ 'image/%'::text)) OR (((source_format)::text = 'CARTE_GRISE_PDF'::text) AND ((mime_type)::text = 'application/pdf'::text)) OR (((source_format)::text = 'CARTE_GRISE_TEXT'::text) AND ((mime_type)::text = 'text/plain; charset=utf-8'::text))))` |
| `chk_vdoc_input_method` | CHECK | `CHECK (((input_method)::text = ANY ((ARRAY['legacy'::character varying, 'camera'::character varying, 'upload'::character varying, 'paste_image'::character varying, 'paste_text'::character varying])::text[])))` |
| `chk_vdoc_intake` | CHECK | `CHECK (((intake_status IS NULL) OR ((intake_status)::text = ANY ((ARRAY['pending_extraction'::character varying, 'extraction_failed'::character varying, 'pending_review'::character varying, 'linked_existing_vehicle'::character varying, 'vehicle_created'::character varying, 'unassigned'::character varying])::text[]))))` |
| `chk_vdoc_intake_fields` | CHECK | `CHECK (((intake_fields IS NULL) OR ((jsonb_typeof(intake_fields) = 'object'::text) AND (pg_column_size(intake_fields) <= 8192))))` |
| `chk_vdoc_intake_vehicle` | CHECK | `CHECK ((((vehicle_id IS NULL) AND (intake_status IS NOT NULL) AND ((intake_status)::text = ANY ((ARRAY['pending_extraction'::character varying, 'extraction_failed'::character varying, 'pending_review'::character varying, 'unassigned'::character varying])::text[]))) OR ((vehicle_id IS NOT NULL) AND ((intake_status IS NULL) OR ((intake_status)::text = ANY ((ARRAY['linked_existing_vehicle'::character varying, 'vehicle_created'::character varying])::text[]))))))` |
| `chk_vdoc_lens` | CHECK | `CHECK (((lens_extraction IS NULL) OR ((jsonb_typeof(lens_extraction) = 'object'::text) AND (pg_column_size(lens_extraction) <= 65536))))` |
| `chk_vdoc_ocr` | CHECK | `CHECK (((ocr_status)::text = ANY ((ARRAY['none'::character varying, 'extracted'::character varying, 'confirmed'::character varying, 'failed'::character varying])::text[])))` |
| `chk_vdoc_processing` | CHECK | `CHECK (((processing_status)::text = ANY ((ARRAY['NONE'::character varying, 'PENDING_LENS'::character varying, 'PROCESSING'::character varying, 'DONE'::character varying, 'FAILED'::character varying])::text[])))` |
| `chk_vdoc_review` | CHECK | `CHECK (((review_status)::text = ANY ((ARRAY['accepted'::character varying, 'pending_review'::character varying, 'rejected'::character varying])::text[])))` |
| `chk_vdoc_size` | CHECK | `CHECK (((byte_size > 0) AND (width >= 0) AND (height >= 0) AND (((mime_type)::text !~~ 'image/%'::text) OR ((width > 0) AND (height > 0)))))` |
| `chk_vdoc_source_format` | CHECK | `CHECK (((source_format)::text = ANY ((ARRAY['CARTE_GRISE_IMAGE'::character varying, 'CARTE_GRISE_PDF'::character varying, 'CARTE_GRISE_TEXT'::character varying])::text[])))` |
| `chk_vdoc_type` | CHECK | `CHECK (((document_type)::text = ANY ((ARRAY['carte_grise'::character varying, 'vehicle_photo'::character varying])::text[])))` |
| `chk_vdoc_validation` | CHECK | `CHECK (((validation_status)::text = ANY ((ARRAY['NOT_VALIDATED'::character varying, 'VALIDATED'::character varying, 'CORRECTED'::character varying, 'REJECTED'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_documents_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_documents_pkey ON idauto_vehicle_documents USING btree (id)` |
| `idx_idauto_vdoc_history` | `CREATE INDEX idx_idauto_vdoc_history ON idauto_vehicle_documents USING btree (vehicle_id, document_type, face, version DESC)` |
| `idx_idauto_vdoc_intake` | `CREATE INDEX idx_idauto_vdoc_intake ON idauto_vehicle_documents USING btree (intake_status, created_at DESC) WHERE (intake_status IS NOT NULL)` |
| `idx_idauto_vdoc_key` | `CREATE INDEX idx_idauto_vdoc_key ON idauto_vehicle_documents USING btree (storage_key)` |
| `idx_idauto_vdoc_pending` | `CREATE INDEX idx_idauto_vdoc_pending ON idauto_vehicle_documents USING btree (review_status) WHERE ((review_status)::text = 'pending_review'::text)` |
| `idx_idauto_vdoc_sha` | `CREATE INDEX idx_idauto_vdoc_sha ON idauto_vehicle_documents USING btree (vehicle_id, sha256)` |
| `idx_idauto_vdoc_vehicle` | `CREATE INDEX idx_idauto_vdoc_vehicle ON idauto_vehicle_documents USING btree (vehicle_id)` |
| `uq_vdoc_current_face` | `CREATE UNIQUE INDEX uq_vdoc_current_face ON idauto_vehicle_documents USING btree (vehicle_id, document_type, face) WHERE ((superseded_at IS NULL) AND ((review_status)::text = 'accepted'::text))` |
| `uq_vdoc_intake_sha` | `CREATE UNIQUE INDEX uq_vdoc_intake_sha ON idauto_vehicle_documents USING btree (sha256) WHERE ((vehicle_id IS NULL) AND ((document_type)::text = 'carte_grise'::text))` |

---

## idauto_vehicle_facts

**Rows:** 5 · **Size:** 128 kB

**Purpose:** Versioned vehicle attributes. Old values retained on update. VIN is mythos_private scope. No owner PII.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_facts_id_seq'::regclass)` |
| `vehicle_id` | integer | NOT NULL |  |
| `fact_key` | character varying(50) | NOT NULL |  |
| `fact_value` | text | NOT NULL |  |
| `fact_value_normalized` | text | NULL |  |
| `source_id` | integer | NULL |  |
| `observation_id` | bigint | NULL |  |
| `confidence_score` | real | NOT NULL | `0.5` |
| `verification_status` | character varying(20) | NOT NULL | `'unverified'::character varying` |
| `access_scope` | character varying(20) | NOT NULL | `'public'::character varying` |
| `is_active` | boolean | NOT NULL | `true` |
| `first_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `last_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `validated_by` | character varying(64) | NULL |  |
| `validated_at` | timestamp with time zone | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_facts_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_facts_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_vehicle_facts_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (source_id) REFERENCES idauto_capture_sources(id)` |
| `idauto_vehicle_facts_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_fact_conf` | CHECK | `CHECK (((confidence_score >= (0.0)::double precision) AND (confidence_score <= (1.0)::double precision)))` |
| `chk_fact_scope` | CHECK | `CHECK (((access_scope)::text = ANY ((ARRAY['public'::character varying, 'professional'::character varying, 'mythos_private'::character varying])::text[])))` |
| `chk_fact_status` | CHECK | `CHECK (((verification_status)::text = ANY ((ARRAY['unverified'::character varying, 'pending_review'::character varying, 'verified'::character varying, 'conflict'::character varying, 'rejected'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_facts_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_facts_pkey ON idauto_vehicle_facts USING btree (id)` |
| `idx_idauto_facts_active` | `CREATE INDEX idx_idauto_facts_active ON idauto_vehicle_facts USING btree (vehicle_id, fact_key) WHERE (is_active = true)` |
| `idx_idauto_facts_obs` | `CREATE INDEX idx_idauto_facts_obs ON idauto_vehicle_facts USING btree (observation_id)` |
| `idx_idauto_facts_status` | `CREATE INDEX idx_idauto_facts_status ON idauto_vehicle_facts USING btree (verification_status)` |
| `idx_idauto_facts_vehicle` | `CREATE INDEX idx_idauto_facts_vehicle ON idauto_vehicle_facts USING btree (vehicle_id, fact_key)` |
| `idx_idauto_facts_vin_lookup` | `CREATE INDEX idx_idauto_facts_vin_lookup ON idauto_vehicle_facts USING btree (fact_value_normalized) WHERE ((fact_key)::text = 'vin'::text)` |
| `idx_idauto_facts_vin_upper` | `CREATE INDEX idx_idauto_facts_vin_upper ON idauto_vehicle_facts USING btree (upper(TRIM(BOTH FROM fact_value))) WHERE ((fact_key)::text = 'vin'::text)` |

---

## idauto_vehicle_identification_history

**Rows:** 4 · **Size:** 48 kB

**Purpose:** IDA-V12. Technical identification history of a vehicle (what it was identified as, by whom, how). NO customer data, ever.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_identification_history_id_seq'::regclass)` |
| `vehicle_id` | integer | NOT NULL |  |
| `changed_at` | timestamp with time zone | NOT NULL | `now()` |
| `actor_type` | character varying(20) | NOT NULL |  |
| `actor_ref` | character varying(64) | NULL |  |
| `org_id` | integer | NULL |  |
| `action` | character varying(30) | NOT NULL |  |
| `method` | character varying(40) | NULL |  |
| `source` | character varying(40) | NULL |  |
| `confidence` | real | NULL |  |
| `previous` | jsonb | NULL |  |
| `next` | jsonb | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_identification_history_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_identification_history_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_vehicle_identification_history_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_ident_hist_action` | CHECK | `CHECK (((action)::text = ANY ((ARRAY['resolved'::character varying, 'confirmed'::character varying, 'edited'::character varying, 'refreshed'::character varying, 'rejected'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_identification_history_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_identification_history_pkey ON idauto_vehicle_identification_history USING btree (id)` |
| `idx_idauto_ident_hist_vehicle` | `CREATE INDEX idx_idauto_ident_hist_vehicle ON idauto_vehicle_identification_history USING btree (vehicle_id, changed_at DESC)` |

---

## idauto_vehicle_movements

**Rows:** 0 · **Size:** 40 kB

**Purpose:** Smart Gate entry/exit events. MYTHOS_PRIVATE. Never returned in public or professional API responses.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_movements_id_seq'::regclass)` |
| `observation_id` | bigint | NOT NULL |  |
| `vehicle_id` | integer | NULL |  |
| `plate_id` | integer | NULL |  |
| `camera_source_id` | integer | NOT NULL |  |
| `event_direction` | character varying(10) | NOT NULL | `'unknown'::character varying` |
| `event_time` | timestamp with time zone | NOT NULL |  |
| `plate_candidate` | character varying(30) | NULL |  |
| `ocr_confidence` | real | NULL |  |
| `vehicle_colour` | character varying(40) | NULL |  |
| `colour_confidence` | real | NULL |  |
| `vehicle_category` | character varying(40) | NULL |  |
| `category_confidence` | real | NULL |  |
| `validation_status` | character varying(20) | NOT NULL | `'auto_accepted'::character varying` |
| `fixpert_visit_ref` | character varying(64) | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_movements_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_movements_camera_source_id_fkey` | FOREIGN KEY | `FOREIGN KEY (camera_source_id) REFERENCES idauto_camera_sources(id)` |
| `idauto_vehicle_movements_observation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (observation_id) REFERENCES idauto_observations(id)` |
| `idauto_vehicle_movements_plate_id_fkey` | FOREIGN KEY | `FOREIGN KEY (plate_id) REFERENCES idauto_plates(id)` |
| `idauto_vehicle_movements_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `idauto_vehicle_movements_observation_id_key` | UNIQUE | `UNIQUE (observation_id)` |
| `chk_move_direction` | CHECK | `CHECK (((event_direction)::text = ANY ((ARRAY['entry'::character varying, 'exit'::character varying, 'unknown'::character varying])::text[])))` |
| `chk_move_validation` | CHECK | `CHECK (((validation_status)::text = ANY ((ARRAY['auto_accepted'::character varying, 'pending_review'::character varying, 'reviewed'::character varying, 'rejected'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_movements_observation_id_key` | `CREATE UNIQUE INDEX idauto_vehicle_movements_observation_id_key ON idauto_vehicle_movements USING btree (observation_id)` |
| `idauto_vehicle_movements_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_movements_pkey ON idauto_vehicle_movements USING btree (id)` |
| `idx_idauto_move_camera` | `CREATE INDEX idx_idauto_move_camera ON idauto_vehicle_movements USING btree (camera_source_id)` |
| `idx_idauto_move_time` | `CREATE INDEX idx_idauto_move_time ON idauto_vehicle_movements USING btree (event_time)` |
| `idx_idauto_move_vehicle` | `CREATE INDEX idx_idauto_move_vehicle ON idauto_vehicle_movements USING btree (vehicle_id)` |

---

## idauto_vehicle_notes

**Rows:** 1 · **Size:** 48 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_notes_id_seq'::regclass)` |
| `vehicle_id` | integer | NOT NULL |  |
| `org_id` | integer | NULL |  |
| `notes` | character varying(500) | NOT NULL |  |
| `updated_by` | character varying(80) | NOT NULL |  |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_notes_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_notes_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_vehicle_notes_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_vehicle_notes_len` | CHECK | `CHECK ((length(btrim((notes)::text)) >= 1))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_notes_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_notes_pkey ON idauto_vehicle_notes USING btree (id)` |
| `uq_vehicle_notes_org` | `CREATE UNIQUE INDEX uq_vehicle_notes_org ON idauto_vehicle_notes USING btree (vehicle_id, COALESCE(org_id, 0))` |

---

## idauto_vehicle_owner_contacts

**Rows:** 2 · **Size:** 80 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_vehicle_owner_contacts_id_seq'::regclass)` |
| `vehicle_id` | integer | NOT NULL |  |
| `org_id` | integer | NULL |  |
| `full_name` | character varying(120) | NOT NULL |  |
| `phone` | character varying(30) | NULL |  |
| `phone_normalized` | character varying(20) | NULL |  |
| `email` | character varying(160) | NULL |  |
| `address` | character varying(240) | NULL |  |
| `notes` | character varying(300) | NULL |  |
| `created_by` | character varying(80) | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `superseded_at` | timestamp with time zone | NULL |  |
| `superseded_by` | character varying(80) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_owner_contacts_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicle_owner_contacts_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_vehicle_owner_contacts_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_owner_contact_name` | CHECK | `CHECK ((length(btrim((full_name)::text)) >= 2))` |
| `chk_owner_contact_phone` | CHECK | `CHECK (((phone_normalized IS NULL) OR ((phone_normalized)::text ~ '^\+?[0-9]{6,15}$'::text)))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_owner_contacts_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_owner_contacts_pkey ON idauto_vehicle_owner_contacts USING btree (id)` |
| `idx_owner_contact_org_name` | `CREATE INDEX idx_owner_contact_org_name ON idauto_vehicle_owner_contacts USING btree (org_id, lower((full_name)::text) text_pattern_ops) WHERE (superseded_at IS NULL)` |
| `idx_owner_contact_org_phone` | `CREATE INDEX idx_owner_contact_org_phone ON idauto_vehicle_owner_contacts USING btree (org_id, phone_normalized) WHERE (superseded_at IS NULL)` |
| `uq_owner_contact_current` | `CREATE UNIQUE INDEX uq_owner_contact_current ON idauto_vehicle_owner_contacts USING btree (vehicle_id, COALESCE(org_id, 0)) WHERE (superseded_at IS NULL)` |

---

## idauto_vehicle_photos

**Rows:** 1 · **Size:** 48 kB

**Purpose:** Update 3. One row per vehicle photograph (bytes referenced by idauto_vehicle_documents, type vehicle_photo): view, capture date, ORIGINAL coordinates, readable location and its source, per-photograph analysis. The location is the photograph's, not the vehicle's.

| Column | Type | Null | Default |
|---|---|---|---|
| `document_id` | bigint | NOT NULL |  |
| `vehicle_id` | integer | NOT NULL |  |
| `view` | character varying(10) | NOT NULL | `'unknown'::character varying` |
| `captured_at` | timestamp with time zone | NULL |  |
| `latitude` | double precision | NULL |  |
| `longitude` | double precision | NULL |  |
| `place_name` | character varying(120) | NULL |  |
| `governorate` | character varying(60) | NULL |  |
| `country` | character varying(60) | NULL |  |
| `location_source` | character varying(10) | NULL |  |
| `analysis` | jsonb | NULL |  |
| `confidence` | real | NULL |  |
| `confirmed` | boolean | NOT NULL | `false` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicle_photos_pkey` | PRIMARY KEY | `PRIMARY KEY (document_id)` |
| `idauto_vehicle_photos_document_id_fkey` | FOREIGN KEY | `FOREIGN KEY (document_id) REFERENCES idauto_vehicle_documents(id) ON DELETE CASCADE` |
| `idauto_vehicle_photos_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_vphoto_analysis` | CHECK | `CHECK (((analysis IS NULL) OR ((jsonb_typeof(analysis) = 'object'::text) AND (pg_column_size(analysis) <= 8192))))` |
| `chk_vphoto_conf` | CHECK | `CHECK (((confidence IS NULL) OR ((confidence >= (0.0)::double precision) AND (confidence <= (1.0)::double precision))))` |
| `chk_vphoto_coords` | CHECK | `CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))))` |
| `chk_vphoto_gps_src` | CHECK | `CHECK (((latitude IS NULL) OR ((location_source IS NOT NULL) AND ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying])::text[])))))` |
| `chk_vphoto_source` | CHECK | `CHECK (((location_source IS NULL) OR ((location_source)::text = ANY ((ARRAY['exif'::character varying, 'browser'::character varying, 'manual'::character varying])::text[]))))` |
| `chk_vphoto_view` | CHECK | `CHECK (((view)::text = ANY ((ARRAY['front'::character varying, 'rear'::character varying, 'unknown'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_vehicle_photos_pkey` | `CREATE UNIQUE INDEX idauto_vehicle_photos_pkey ON idauto_vehicle_photos USING btree (document_id)` |
| `idx_idauto_vphoto_vehicle` | `CREATE INDEX idx_idauto_vphoto_vehicle ON idauto_vehicle_photos USING btree (vehicle_id)` |

---

## idauto_vehicles

**Rows:** 9 · **Size:** 128 kB

**Purpose:** Canonical vehicle fiche. NO owner PII. Enriched from observations and facts.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | integer | NOT NULL | `nextval('idauto_vehicles_id_seq'::regclass)` |
| `internal_ref` | character varying(40) | NOT NULL |  |
| `make` | character varying(80) | NULL |  |
| `model` | character varying(80) | NULL |  |
| `variant` | character varying(80) | NULL |  |
| `year` | integer | NULL |  |
| `body_type` | character varying(40) | NULL |  |
| `fuel_type` | character varying(20) | NULL |  |
| `colour` | character varying(40) | NULL |  |
| `seats` | smallint | NULL |  |
| `gross_weight_kg` | integer | NULL |  |
| `engine_cc` | integer | NULL |  |
| `category_code` | character varying(10) | NULL |  |
| `fiche_status` | character varying(20) | NOT NULL | `'initial'::character varying` |
| `first_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `last_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `observation_count` | integer | NOT NULL | `0` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `ivid` | character varying(40) | NULL |  |
| `merged_into_id` | integer | NULL |  |
| `pre_merge_status` | character varying(20) | NULL |  |
| `motorisation` | character varying(80) | NULL |  |
| `engine_code` | character varying(30) | NULL |  |
| `year_from` | smallint | NULL |  |
| `year_to` | smallint | NULL |  |
| `tecdoc_car_id` | integer | NULL |  |
| `identification_source` | character varying(40) | NULL |  |
| `identification_source_at` | timestamp with time zone | NULL |  |
| `identification_confidence` | real | NULL |  |
| `identification_verified` | boolean | NOT NULL | `false` |
| `identification_verified_by` | character varying(64) | NULL |  |
| `identification_verified_at` | timestamp with time zone | NULL |  |
| `identification_method` | character varying(40) | NULL |  |
| `odometer_km` | integer | NULL |  |
| `odometer_at` | date | NULL |  |
| `visual_recognition` | jsonb | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_vehicles_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_vehicles_merged_into_id_fkey` | FOREIGN KEY | `FOREIGN KEY (merged_into_id) REFERENCES idauto_vehicles(id)` |
| `idauto_vehicles_internal_ref_key` | UNIQUE | `UNIQUE (internal_ref)` |
| `idauto_vehicles_ivid_key` | UNIQUE | `UNIQUE (ivid)` |
| `chk_vehicle_ident_conf` | CHECK | `CHECK (((identification_confidence IS NULL) OR ((identification_confidence >= (0.0)::double precision) AND (identification_confidence <= (1.0)::double precision))))` |
| `chk_vehicle_ident_method` | CHECK | `CHECK (((identification_method IS NULL) OR ((identification_method)::text = ANY ((ARRAY['plate_ocr'::character varying, 'plate_manual'::character varying, 'vin'::character varying, 'manual_selection'::character varying, 'provider'::character varying, 'import'::character varying, 'admin'::character varying, 'carte_grise_ocr'::character varying, 'manual_registration'::character varying])::text[]))))` |
| `chk_vehicle_not_self_merged` | CHECK | `CHECK (((merged_into_id IS NULL) OR (merged_into_id <> id)))` |
| `chk_vehicle_odometer` | CHECK | `CHECK (((odometer_km IS NULL) OR ((odometer_km >= 0) AND (odometer_km <= 3000000))))` |
| `chk_vehicle_status` | CHECK | `CHECK (((fiche_status)::text = ANY ((ARRAY['initial'::character varying, 'pending_review'::character varying, 'verified'::character varying, 'conflict'::character varying, 'merged'::character varying, 'archived'::character varying])::text[])))` |
| `chk_vehicle_visual_recognition` | CHECK | `CHECK (((visual_recognition IS NULL) OR ((jsonb_typeof(visual_recognition) = 'object'::text) AND (pg_column_size(visual_recognition) <= 4096))))` |

| Index | Definition |
|---|---|
| `idauto_vehicles_internal_ref_key` | `CREATE UNIQUE INDEX idauto_vehicles_internal_ref_key ON idauto_vehicles USING btree (internal_ref)` |
| `idauto_vehicles_ivid_key` | `CREATE UNIQUE INDEX idauto_vehicles_ivid_key ON idauto_vehicles USING btree (ivid)` |
| `idauto_vehicles_pkey` | `CREATE UNIQUE INDEX idauto_vehicles_pkey ON idauto_vehicles USING btree (id)` |
| `idx_idauto_vehicles_make_model` | `CREATE INDEX idx_idauto_vehicles_make_model ON idauto_vehicles USING btree (make, model)` |
| `idx_idauto_vehicles_merged_into` | `CREATE INDEX idx_idauto_vehicles_merged_into ON idauto_vehicles USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL)` |
| `idx_idauto_vehicles_status` | `CREATE INDEX idx_idauto_vehicles_status ON idauto_vehicles USING btree (fiche_status)` |
| `idx_idauto_vehicles_tecdoc` | `CREATE INDEX idx_idauto_vehicles_tecdoc ON idauto_vehicles USING btree (tecdoc_car_id) WHERE (tecdoc_car_id IS NOT NULL)` |
| `idx_idauto_vehicles_year` | `CREATE INDEX idx_idauto_vehicles_year ON idauto_vehicles USING btree (year)` |

---

## idauto_verifications

**Rows:** 0 · **Size:** 32 kB

**Purpose:** Every plate search event. Rate-limiting source. IP as SHA-256 only.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_verifications_id_seq'::regclass)` |
| `plate_queried` | character varying(30) | NOT NULL |  |
| `plate_normalised` | character varying(20) | NULL |  |
| `result_status` | character varying(20) | NOT NULL |  |
| `format_code` | character varying(20) | NULL |  |
| `vehicle_id` | integer | NULL |  |
| `caller_type` | character varying(20) | NOT NULL | `'anonymous'::character varying` |
| `org_id` | integer | NULL |  |
| `user_role_id` | integer | NULL |  |
| `ip_hash` | character varying(64) | NULL |  |
| `user_agent_hash` | character varying(64) | NULL |  |
| `response_ms` | integer | NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_verifications_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `fk_verif_org` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `fk_verif_user_role` | FOREIGN KEY | `FOREIGN KEY (user_role_id) REFERENCES idauto_user_roles(id)` |
| `idauto_verifications_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_verifications_user_role_id_fkey` | FOREIGN KEY | `FOREIGN KEY (user_role_id) REFERENCES idauto_user_roles(id)` |
| `idauto_verifications_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_verif_caller` | CHECK | `CHECK (((caller_type)::text = ANY ((ARRAY['anonymous'::character varying, 'authenticated'::character varying, 'professional'::character varying])::text[])))` |
| `chk_verif_result` | CHECK | `CHECK (((result_status)::text = ANY ((ARRAY['found'::character varying, 'not_found'::character varying, 'invalid_format'::character varying, 'rate_limited'::character varying, 'error'::character varying, 'blocked'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_verifications_pkey` | `CREATE UNIQUE INDEX idauto_verifications_pkey ON idauto_verifications USING btree (id)` |
| `idx_idauto_verif_created` | `CREATE INDEX idx_idauto_verif_created ON idauto_verifications USING btree (created_at)` |
| `idx_idauto_verif_org` | `CREATE INDEX idx_idauto_verif_org ON idauto_verifications USING btree (org_id)` |
| `idx_idauto_verif_plate` | `CREATE INDEX idx_idauto_verif_plate ON idauto_verifications USING btree (plate_normalised)` |

---

## idauto_workshop_customer_refs

**Rows:** 0 · **Size:** 16 kB

**Purpose:** IDA-V12. An OPAQUE pointer to a customer record held by the workshop's own system. No name, no phone, no address — those never enter IDauto (PRIVACY_ARCHITECTURE §3).

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_workshop_customer_refs_id_seq'::regclass)` |
| `org_id` | integer | NOT NULL |  |
| `customer_ref` | character varying(64) | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_workshop_customer_refs_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_workshop_customer_refs_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `uq_customer_ref_org` | UNIQUE | `UNIQUE (org_id, customer_ref)` |

| Index | Definition |
|---|---|
| `idauto_workshop_customer_refs_pkey` | `CREATE UNIQUE INDEX idauto_workshop_customer_refs_pkey ON idauto_workshop_customer_refs USING btree (id)` |
| `uq_customer_ref_org` | `CREATE UNIQUE INDEX uq_customer_ref_org ON idauto_workshop_customer_refs USING btree (org_id, customer_ref)` |

---

## idauto_workshop_operations

**Rows:** 5 · **Size:** 64 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_workshop_operations_id_seq'::regclass)` |
| `visit_id` | bigint | NOT NULL |  |
| `operation_type` | character varying(40) | NOT NULL |  |
| `description` | character varying(300) | NULL |  |
| `part_id` | bigint | NULL |  |
| `quantity` | integer | NOT NULL | `1` |
| `status` | character varying(20) | NOT NULL | `'planned'::character varying` |
| `created_by` | character varying(64) | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `part_source` | character varying(24) | NULL |  |
| `part_condition` | character varying(8) | NULL |  |
| `part_label` | character varying(120) | NULL |  |
| `part_reference_text` | character varying(60) | NULL |  |
| `performed_on` | date | NULL |  |
| `notes` | character varying(500) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_workshop_operations_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_workshop_operations_part_id_fkey` | FOREIGN KEY | `FOREIGN KEY (part_id) REFERENCES idauto_parts(id)` |
| `idauto_workshop_operations_visit_id_fkey` | FOREIGN KEY | `FOREIGN KEY (visit_id) REFERENCES idauto_workshop_visits(id)` |
| `chk_op_qty` | CHECK | `CHECK ((quantity > 0))` |
| `chk_op_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['planned'::character varying, 'done'::character varying, 'cancelled'::character varying])::text[])))` |
| `chk_op_type` | CHECK | `CHECK (((operation_type)::text = ANY ((ARRAY['diagnosis'::character varying, 'replacement'::character varying, 'service'::character varying, 'repair'::character varying, 'inspection'::character varying, 'other'::character varying])::text[])))` |
| `chk_workshop_op_part_condition` | CHECK | `CHECK (((part_condition IS NULL) OR ((part_condition)::text = ANY ((ARRAY['new'::character varying, 'used'::character varying])::text[]))))` |
| `chk_workshop_op_part_source` | CHECK | `CHECK (((part_source IS NULL) OR ((part_source)::text = ANY ((ARRAY['our_shop'::character varying, 'customer_supplied'::character varying, 'external_supplier'::character varying])::text[]))))` |

| Index | Definition |
|---|---|
| `idauto_workshop_operations_pkey` | `CREATE UNIQUE INDEX idauto_workshop_operations_pkey ON idauto_workshop_operations USING btree (id)` |
| `idx_idauto_ops_visit` | `CREATE INDEX idx_idauto_ops_visit ON idauto_workshop_operations USING btree (visit_id)` |
| `idx_workshop_op_part_source` | `CREATE INDEX idx_workshop_op_part_source ON idauto_workshop_operations USING btree (part_source) WHERE (part_source IS NOT NULL)` |

---

## idauto_workshop_order_lines

**Rows:** 0 · **Size:** 16 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_workshop_order_lines_id_seq'::regclass)` |
| `order_id` | bigint | NOT NULL |  |
| `part_id` | bigint | NOT NULL |  |
| `quantity` | integer | NOT NULL |  |
| `unit_price_millimes` | bigint | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_workshop_order_lines_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_workshop_order_lines_order_id_fkey` | FOREIGN KEY | `FOREIGN KEY (order_id) REFERENCES idauto_workshop_orders(id)` |
| `idauto_workshop_order_lines_part_id_fkey` | FOREIGN KEY | `FOREIGN KEY (part_id) REFERENCES idauto_parts(id)` |
| `chk_line_price` | CHECK | `CHECK (((unit_price_millimes IS NULL) OR (unit_price_millimes >= 0)))` |
| `chk_line_qty` | CHECK | `CHECK ((quantity > 0))` |

| Index | Definition |
|---|---|
| `idauto_workshop_order_lines_pkey` | `CREATE UNIQUE INDEX idauto_workshop_order_lines_pkey ON idauto_workshop_order_lines USING btree (id)` |
| `idx_idauto_order_lines_order` | `CREATE INDEX idx_idauto_order_lines_order ON idauto_workshop_order_lines USING btree (order_id)` |

---

## idauto_workshop_orders

**Rows:** 0 · **Size:** 16 kB

**Purpose:** *(no comment in DB)*

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_workshop_orders_id_seq'::regclass)` |
| `org_id` | integer | NOT NULL |  |
| `visit_id` | bigint | NULL |  |
| `status` | character varying(20) | NOT NULL | `'draft'::character varying` |
| `supplier_ref` | character varying(120) | NULL |  |
| `created_by` | character varying(64) | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_workshop_orders_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_workshop_orders_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_workshop_orders_visit_id_fkey` | FOREIGN KEY | `FOREIGN KEY (visit_id) REFERENCES idauto_workshop_visits(id)` |
| `chk_order_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'placed'::character varying, 'received'::character varying, 'cancelled'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_workshop_orders_pkey` | `CREATE UNIQUE INDEX idauto_workshop_orders_pkey ON idauto_workshop_orders USING btree (id)` |
| `idx_idauto_orders_org` | `CREATE INDEX idx_idauto_orders_org ON idauto_workshop_orders USING btree (org_id, created_at DESC)` |

---

## idauto_workshop_visits

**Rows:** 3 · **Size:** 64 kB

**Purpose:** IDA-V12. One arrival of one vehicle at one workshop. Many visits per vehicle. Points at a vehicle and at an opaque customer_ref; never carries customer data itself.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL | `nextval('idauto_workshop_visits_id_seq'::regclass)` |
| `org_id` | integer | NOT NULL |  |
| `vehicle_id` | integer | NULL |  |
| `customer_ref_id` | bigint | NULL |  |
| `status` | character varying(20) | NOT NULL | `'open'::character varying` |
| `plate_read` | character varying(20) | NULL |  |
| `plate_read_method` | character varying(20) | NULL |  |
| `plate_read_confidence` | real | NULL |  |
| `identification_method` | character varying(40) | NULL |  |
| `reason` | character varying(1000) | NULL |  |
| `opened_by` | character varying(64) | NOT NULL |  |
| `opened_at` | timestamp with time zone | NOT NULL | `now()` |
| `closed_at` | timestamp with time zone | NULL |  |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `performed_on` | date | NULL |  |
| `odometer_km` | integer | NULL |  |
| `technician_ref` | character varying(64) | NULL |  |

| Constraint | Kind | Definition |
|---|---|---|
| `idauto_workshop_visits_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `idauto_workshop_visits_customer_ref_id_fkey` | FOREIGN KEY | `FOREIGN KEY (customer_ref_id) REFERENCES idauto_workshop_customer_refs(id)` |
| `idauto_workshop_visits_org_id_fkey` | FOREIGN KEY | `FOREIGN KEY (org_id) REFERENCES idauto_organizations(id)` |
| `idauto_workshop_visits_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES idauto_vehicles(id)` |
| `chk_visit_ident_method` | CHECK | `CHECK (((identification_method IS NULL) OR ((identification_method)::text = ANY ((ARRAY['plate'::character varying, 'vin'::character varying, 'manual_selection'::character varying])::text[]))))` |
| `chk_visit_odometer` | CHECK | `CHECK (((odometer_km IS NULL) OR ((odometer_km >= 0) AND (odometer_km <= 3000000))))` |
| `chk_visit_plate_method` | CHECK | `CHECK (((plate_read_method IS NULL) OR ((plate_read_method)::text = ANY ((ARRAY['camera_ocr'::character varying, 'manual'::character varying, 'none'::character varying])::text[]))))` |
| `chk_visit_status` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'closed'::character varying, 'cancelled'::character varying])::text[])))` |

| Index | Definition |
|---|---|
| `idauto_workshop_visits_pkey` | `CREATE UNIQUE INDEX idauto_workshop_visits_pkey ON idauto_workshop_visits USING btree (id)` |
| `idx_idauto_visits_org` | `CREATE INDEX idx_idauto_visits_org ON idauto_workshop_visits USING btree (org_id, opened_at DESC)` |
| `idx_idauto_visits_vehicle` | `CREATE INDEX idx_idauto_visits_vehicle ON idauto_workshop_visits USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL)` |

---

## Sequences

| Sequence | Last value |
|---|---:|
| `idauto_audit_log_id_seq` | 1336 |
| `idauto_camera_sources_id_seq` | (unused) |
| `idauto_capture_sessions_id_seq` | (unused) |
| `idauto_capture_sources_id_seq` | 7 |
| `idauto_consent_records_id_seq` | (unused) |
| `idauto_contributors_id_seq` | (unused) |
| `idauto_document_scans_id_seq` | (unused) |
| `idauto_fact_evidence_id_seq` | 10 |
| `idauto_governorates_id_seq` | 24 |
| `idauto_media_archive_id_seq` | 6 |
| `idauto_observation_locations_id_seq` | (unused) |
| `idauto_observation_media_id_seq` | 2 |
| `idauto_observations_id_seq` | 2 |
| `idauto_org_stock_id_seq` | (unused) |
| `idauto_organizations_id_seq` | 2 |
| `idauto_part_compatibility_id_seq` | (unused) |
| `idauto_parts_id_seq` | (unused) |
| `idauto_plate_formats_id_seq` | 8 |
| `idauto_plates_id_seq` | 10 |
| `idauto_review_queue_id_seq` | (unused) |
| `idauto_service_events_id_seq` | (unused) |
| `idauto_submissions_id_seq` | (unused) |
| `idauto_user_roles_id_seq` | (unused) |
| `idauto_vehicle_documents_id_seq` | 10 |
| `idauto_vehicle_facts_id_seq` | 11 |
| `idauto_vehicle_identification_history_id_seq` | 4 |
| `idauto_vehicle_movements_id_seq` | (unused) |
| `idauto_vehicle_notes_id_seq` | 3 |
| `idauto_vehicle_owner_contacts_id_seq` | 2 |
| `idauto_vehicles_id_seq` | 12 |
| `idauto_verifications_id_seq` | (unused) |
| `idauto_workshop_customer_refs_id_seq` | (unused) |
| `idauto_workshop_operations_id_seq` | 5 |
| `idauto_workshop_order_lines_id_seq` | (unused) |
| `idauto_workshop_orders_id_seq` | (unused) |
| `idauto_workshop_visits_id_seq` | 3 |
