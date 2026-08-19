# IDA-4 Legal Gate Matrix

**Date:** 2026-08-19
**Repo state:** branch `gate-closure` @ `24a28dd` — the merged main content: readiness audit,
threat model, IDA-4 gate-free foundation subset, IDA-5..IDA-9 preparation pass, and stage-5
prep docs are all present.
**Purpose:** a single, citable engineering artefact tracking every one of the 16
`LEGAL-REVIEW-REQUIRED` items found in this repository, so that legal counsel review can be
requested, tracked and recorded item-by-item rather than as one undifferentiated blocker.
This document does not answer any legal question, does not offer a legal opinion, and does
not predict how counsel will rule. It states facts already established elsewhere in this
repository (which capability each item gates, which data and users it touches, which stage
depends on it) and provides the structure into which counsel's answer, once obtained, gets
recorded.

**Source:** [`docs/IDA4_READINESS_AUDIT.md`](IDA4_READINESS_AUDIT.md) §B, which enumerates
these 16 items (its own numbering `#1`–`#16`) against `docs/PRODUCT_SPEC.md` §12,
`docs/INGESTION_ARCHITECTURE.md`, `docs/CAPTURE_PIPELINE.md`, `docs/FIXPERT_INTEGRATION.md`,
`docs/PRIVACY_ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/THREAT_MODEL.md`. This matrix
renumbers those 16 items `L01`–`L16` in the audit's own order (the audit itself uses `#1`–
`#16`, not an `L`-prefixed scheme) and adds the per-item fields the audit's prose did not
tabulate: affected data (columns/records, cited to `database/schema.sql` and
`protocol/schemas/`), affected users, jurisdiction, required decision, evidence, owner, and
dependency.

---

## Status vocabulary

| Status | Meaning |
|---|---|
| **OPEN** | No legal review has occurred. This is the status of all 16 items today. |
| **UNDER_REVIEW** | Submitted to qualified legal counsel; awaiting their answer. |
| **APPROVED** | Counsel has reviewed the item and approved the described processing, with any conditions recorded in the Evidence column. |
| **REJECTED** | Counsel has reviewed the item and found the described processing impermissible as specified; the feature must be removed or redesigned. |
| **NOT_APPLICABLE** | The item's underlying feature has been permanently removed from scope, so the legal question no longer applies to anything this repository builds. |
| **OWNER_DECISION** | Before counsel can even review the item, the project owner must first make a choice this document cannot make for them (e.g. author an internal governance policy, or choose between two viable technical paths). Applied *in addition to* OPEN where relevant — an item can be both OPEN and OWNER_DECISION at once. |

**Binding rule: `APPROVED` requires actual legal evidence recorded in the Evidence column —
a memo reference, a signed-off decision record, a named counsel and date. Engineering can
never set an item to `APPROVED`.** This document is written by engineering; every one of the
16 items below is `OPEN` because no legal evidence exists anywhere in this repository for any
of them. That is not a placeholder pending a later editing pass — it is the accurate status
today, and will remain accurate until this file is edited by whoever receives counsel's
actual answer and records the evidence that answer produces.

---

## L01 — Public image contribution, legal basis

| Field | Value |
|---|---|
| **Feature** | Public/community photo submission of vehicles in public spaces (gates `IDA-3G` → `IDA-3I`) |
| **Legal question** | "Can members of the public legally submit photos of vehicles in public spaces in Tunisia? What consent and notice is required?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_observation_media` (`media_type='original_image'`, default `access_scope='mythos_private'`); `idauto_submissions`; `idauto_observations` (`capture_method`, `ip_hash`) |
| **Affected users** | Citizen contributors (anonymous and authenticated); vehicle owners and bystanders incidentally captured in submitted images |
| **Jurisdiction** | Tunisia (primary market per `docs/PRODUCT_SPEC.md` §1) |
| **Current status** | **OPEN** |
| **Required decision** | Whether, and under what consent/notice conditions, public photo submission of vehicles is lawful |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Bundled with L02, L05 under `IDA-3G`; blocks `IDA-3H`→`IDA-3I` |
| **Engineering consequence** | While OPEN: `PUBLIC_UPLOAD`/`CONTRIBUTOR_UPLOAD` capture sources stay seeded but unexposed (`docs/INGESTION_ARCHITECTURE.md` §22, `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO`). If REJECTED: public image contribution is removed from scope or redesigned (e.g. restricted to consenting professional capture only). |

---

## L02 — Precise GPS collection, consent and notice

| Field | Value |
|---|---|
| **Feature** | Observation-level GPS/location capture (currently not built; gates `IDA-3G`) |
| **Legal question** | "What notice and consent is required to collect and store GPS coordinates of vehicle observations?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_observation_locations` (`latitude`, `longitude`, `accuracy_m`, `location_method`) — an entirely-restricted table, unpopulated: "**not collected in v1**" (`docs/INGESTION_ARCHITECTURE.md` §9) |
| **Affected users** | Citizen contributors capturing observations; vehicle owners as subjects of movement/location data |
| **Jurisdiction** | Tunisia; no further jurisdictional detail is stated in sources — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Whether, and under what notice/consent, GPS collection may begin at all |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Bundled with L01, L05 under `IDA-3G` |
| **Engineering consequence** | While OPEN: `observations.location_*` / GPS columns stay `DEFERRED` (`docs/INGESTION_ARCHITECTURE.md` §3); `idauto_observation_locations` remains unwritten. If REJECTED: GPS capture is permanently removed from product scope, not merely deferred. |

---

## L03 — Public plate lookup, legal basis

| Field | Value |
|---|---|
| **Feature** | Public plate search service (gates `IDA-3I`) |
| **Legal question** | "What legal basis permits operating a public plate search service in Tunisia?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_plates` (`plate_number`); `idauto_vehicles` (public-scope fields); `idauto_verifications` (every plate-search event) |
| **Affected users** | Public lookup users (query side); vehicle owners as data subjects whose plate becomes publicly searchable |
| **Jurisdiction** | Tunisia — Organic Law 63-2004 and INPDP rules named as the applicable regime (`docs/RISK_REGISTER.md` `R-L01`) |
| **Current status** | **OPEN** |
| **Required decision** | Whether a public plate-search feature has legal basis in Tunisia, and under what conditions (purpose limitation, rate limits) |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Related to L01, L05; blocks `IDA-3I` |
| **Engineering consequence** | While OPEN: no public plate-lookup endpoint is exposed. If REJECTED: the feature is removed or narrowed (e.g. professional-tier-only lookup). |

---

## L04 — Registration-certificate (carte grise) OCR, processing basis and consent flow

| Field | Value |
|---|---|
| **Feature** | Carte grise document scan/OCR ingestion (gates `IDA-6`) |
| **Legal question** | "What legal basis permits processing a carte grise image? What consent must the document owner provide?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_document_scans` (`consent_declared`, `has_owner_pii`, `pii_handled`, `technical_fields_extracted` — no PII columns); `idauto_observation_media` (`carte_grise_original`/`carte_grise_derivative`, `access_scope='mythos_private'`, super-admin-only per `docs/CAPTURE_PIPELINE.md` §5) |
| **Affected users** | Vehicle owners (document subjects); citizen contributors submitting the document; professional workshop staff during Fixpert intake |
| **Jurisdiction** | Tunisia; no further detail stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Legal basis and formal consent mechanism for OCR-processing a carte grise — the ownership/consent-declaration UI is *specified* (`docs/CAPTURE_PIPELINE.md` §5 step 9) but not legally reviewed |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel (design already drafted by engineering; needs sign-off, not authorship) |
| **Dependency** | Overlaps L05 (contributor consent) and L16 (owner-identity processing) — this is the exact flow where owner PII is transiently present |
| **Engineering consequence** | While OPEN: `carte_grise_scan` capture method may not be activated on any public/authenticated surface; retention for this document category is separately blocked (L07). If REJECTED: the OCR-then-discard flow (`docs/CAPTURE_PIPELINE.md` §5 step 8) must be redesigned, or the feature restricted to Fixpert-professional intake under Fixpert's own consent basis. |

---

## L05 — Contributor consent, formal mechanism

| Field | Value |
|---|---|
| **Feature** | The consent-capture mechanism underlying every contributor/public submission (gates `IDA-3G`) |
| **Legal question** | "What consent must an authenticated contributor provide for their submissions to be stored and used?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_consent_records` (`subject_type`, `processing_purpose`, `legal_basis`, `consent_given`, `consent_version`, `withdrawn_at`) — table schema exists; the consent *flow* is **SPECIFIED**, not implemented (`docs/PRIVACY_ARCHITECTURE.md` §9) |
| **Affected users** | Citizen contributors (authenticated and anonymous) |
| **Jurisdiction** | Tunisia; notice specified in Arabic + French (`docs/PRIVACY_ARCHITECTURE.md` §7) |
| **Current status** | **OPEN** |
| **Required decision** | What consent text, mechanism and versioning satisfies applicable law before `IDA-3G` may close |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel + engineering (design exists, needs review and then building) |
| **Dependency** | Bundled with L01, L02 under `IDA-3G`; the flip side of L06 (withdrawal/correction/deletion) |
| **Engineering consequence** | While OPEN: `IDA-3G` cannot close, which blocks `IDA-3H` (authenticated pilot) and `IDA-3I` (public gate). If REJECTED as currently designed: the consent flow must be redesigned before any contributor pilot begins. |

---

## L06 — Data correction / deletion rights for individuals

| Field | Value |
|---|---|
| **Feature** | Citizen ability to request correction or deletion of data linked to them; the tombstone-based erasure mechanism |
| **Legal question** | "What rights do individuals have to request correction or deletion of data about vehicles linked to them?" — `docs/PRODUCT_SPEC.md` §12; ROADMAP "open items" table names it directly as blocking `IDA-4` |
| **Affected data** | The person/holder store (not yet built); `protocol/schemas/tombstone.schema.json` (specified, not implemented — `record_kind`, `erased_record_ref`, `legal_basis`, `erased_at`, `actor_ref`); `idauto_contributors.mythos_user_id` (tombstoning on account deletion, per `docs/INGESTION_ARCHITECTURE.md` §17) |
| **Affected users** | Vehicle owners as data subjects; contributors; citizen holders |
| **Jurisdiction** | Tunisia; no specific statutory citation is given in sources beyond the general Organic Law 63-2004 reference elsewhere in this repository — counsel to confirm |
| **Current status** | **OPEN**, and **OWNER_DECISION** — `docs/IDA4_READINESS_AUDIT.md` §H step 1 records that the owner must first decide the A5 question (wait for IDA-7's real auth, or build an IDA-4-scoped interim auth mechanism) before this item is even buildable, independent of what counsel decides |
| **Required decision** | What correction/deletion rights exist, under what process, and what "erasure" legally requires (full deletion vs. a tombstone recording legal basis and date) |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel + owner (A5 decision) + engineering (build) |
| **Dependency** | Depends on A5 (owner decision on auth path) and A1 (real authentication) per the readiness audit; blocks the audit's §C4 (deletion/correction mechanics) |
| **Engineering consequence** | While OPEN: the tombstone-based erasure design (`docs/PRIVACY_ARCHITECTURE.md` §6) stays SPECIFIED/BLOCKED — no erasure code path, no tombstone-table population, no correction workflow exists. This is one of the four items directly blocking the citizen-facing IDA-4 surface (see summary below). If REJECTED in its current form: the erasure mechanism must be redesigned before any citizen data may be processed. |

---

## L07 — Data retention periods, all categories

| Field | Value |
|---|---|
| **Feature** | Retention periods across every data category IDauto stores |
| **Legal question** | "What are the minimum and maximum retention periods for verification logs, audit logs, media files and service events under Tunisian law?" (`docs/PRODUCT_SPEC.md` §12); `docs/INGESTION_ARCHITECTURE.md` §17 breaks this into six rows — accepted media, rejected media, anonymous submissions, abuse payloads, deleted-account evidence, `mythos_private` evidence — each independently marked `LEGAL-REVIEW-REQUIRED`. ROADMAP names it directly as blocking `IDA-4` |
| **Affected data** | `idauto_observation_media.retention_status` (`active`/`pending_deletion`/`deleted`/`legal_hold`); `idauto_document_scans`; `idauto_verifications`; `idauto_audit_log` (never deleted, by design); `idauto_submissions` |
| **Affected users** | Citizen contributors, professional users, vehicle owners as data subjects |
| **Jurisdiction** | Tunisia; no specific periods are stated in any source — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Minimum and maximum retention per category listed in `docs/INGESTION_ARCHITECTURE.md` §17; `docs/CAPTURE_PIPELINE.md` §7.1 states plainly "**All media retention periods are LEGAL-REVIEW-REQUIRED. No retention periods are specified in this document.**" |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Overlaps L04 (carte grise retention specifically) and L06 (deleted-account evidence retention) |
| **Engineering consequence** | While OPEN: `retention_status`/`legal_hold` exist in the schema as a mechanism, but no enforced expiry timer runs against any real value — the "90 days" figure in `docs/INGESTION_ARCHITECTURE.md` §17's "rejected media" row is a stated business default, not a legally reviewed period. This is one of the four items directly blocking the citizen-facing IDA-4 surface (see summary below). If counsel sets different periods: the `pending_deletion` transition timers must be implemented to match. |

---

## L08 — Professional data-sharing legal basis

| Field | Value |
|---|---|
| **Feature** | Sharing service-event data between professional subscribers (gates `IDA-5`) |
| **Legal question** | "What legal basis permits sharing service event data between professional subscribers?" — `docs/PRODUCT_SPEC.md` §12 |
| **Affected data** | `idauto_service_events.is_public` (cross-org visibility flag); `idauto_organizations`; `idauto_user_roles` |
| **Affected users** | Professional users (organisations); vehicle owners as data subjects of the shared service history |
| **Jurisdiction** | Tunisia; no further detail is stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Legal basis for professional-to-professional data sharing (e.g. legitimate interest, contract, consent) |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Depends on IDA-5 issuer-onboarding design; independent of the four IDA-4 blockers |
| **Engineering consequence** | While OPEN: `is_public` cross-org visibility for service events stays conservative (default `FALSE`). If REJECTED: cross-org sharing is removed and service events stay single-organisation-visible only. |

---

## L09 — Operator super-admin access governance policy

| Field | Value |
|---|---|
| **Feature** | Governance of Mythos Super Admin access to restricted `idauto` data and to Fixpert customer/financial data |
| **Legal question** | "What internal governance policy governs super-admin access to Fixpert customer and financial data?" (`docs/PRODUCT_SPEC.md` §12); `docs/RISK_REGISTER.md` `R-O03`: "no access review schedule or access revocation procedure." ROADMAP names it directly as blocking `IDA-4` |
| **Affected data** | `idauto_audit_log` (`event_type='admin.access'`/`'admin.action'` per `docs/FIXPERT_INTEGRATION.md` §8); every `mythos_private`-scope column across every `idauto_` table; `fixpert.clients`/`fixpert.invoices` (referenced cross-schema, never joined) |
| **Affected users** | Operators/super-admins (as actors); professional users (Fixpert customers) and vehicle owners as data subjects of the data super-admins can read |
| **Jurisdiction** | Tunisia (the underlying data-protection obligations governing what may be accessed are Tunisian; the governance policy itself is internal, not a jurisdictional question) |
| **Current status** | **OPEN**, and **OWNER_DECISION** — `docs/FIXPERT_INTEGRATION.md` §8 states the policy "is defined in the Mythos platform governance policy... outside the scope of this document," meaning the owner must author the policy before counsel has anything concrete to review |
| **Required decision** | Owner must first define the governance policy (who may access what, under what approval, with what review cadence); counsel then reviews it for legal sufficiency |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Owner (policy authorship) + legal counsel (review) |
| **Dependency** | Relates to the readiness audit's §C5 (audit-on-read — not built; restricted data is currently protected by exclusion-from-query, not by logged-and-reviewed access) |
| **Engineering consequence** | While OPEN: super-admin access remains governed only by "every access is audit-logged" (`docs/PRIVACY_ARCHITECTURE.md` §3) — no periodic access review, no revocation procedure. This is one of the four items directly blocking the citizen-facing IDA-4 surface (see summary below). If the eventual policy requires tiered/reviewable access: the `IDAUTO_ADMIN_IDENTITIES` flat bearer-token map will need reworking to support it. |

---

## L10 — ANPR, regulatory notification or approval

| Field | Value |
|---|---|
| **Feature** | Fixpert Smart Gate ANPR camera operation (gates `IDA-6`) |
| **Legal question** | "Does operating an ANPR camera at a private business entrance in Tunisia require notification to or approval from INPDP (Instance Nationale de Protection des Données Personnelles)?" — `docs/FIXPERT_INTEGRATION.md` §10 |
| **Affected data** | `idauto_camera_sources`; `idauto_observations` (`capture_method='smart_gate'`); `idauto_vehicle_movements` (all `mythos_private`) |
| **Affected users** | Vehicle owners/drivers passing the gate (data subjects); Fixpert workshop employees; visitors |
| **Jurisdiction** | Tunisia — INPDP named explicitly as the relevant regulator |
| **Current status** | **OPEN** |
| **Required decision** | Whether INPDP notification or approval is required, and how to obtain it before any camera connection |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Bundled with L11, L12 as the Smart Gate legal package — all three block `IDA-6` camera activation together |
| **Engineering consequence** | "No live camera connection is established in IDA-1 or before legal review is complete" (`docs/FIXPERT_INTEGRATION.md` §10) — all Smart Gate feature flags stay `false`. If REJECTED: ANPR is removed entirely from the Tunisian pilot's scope. |

---

## L11 — Camera disclosure to visitors and employees

| Field | Value |
|---|---|
| **Feature** | Smart Gate camera disclosure obligations (gates `IDA-6`) |
| **Legal question** | "Must customers or visitors be notified that ANPR is in operation at the entrance?" — `docs/FIXPERT_INTEGRATION.md` §10. The audit folds in a related but distinct question here rather than counting it separately: `docs/FIXPERT_INTEGRATION.md` §10's "Worker privacy" — "Do workshop employees whose vehicles pass the Smart Gate have data-subject rights that must be addressed?" — because the roadmap's phrasing ("to visitors **and employees**") already names both populations. `docs/IDA4_READINESS_AUDIT.md` §B.2 itself flags that disclosure and data-subject-rights are legally distinct obligations even for the same people, and that a legal reviewer should confirm the two questions are actually the same scope before treating this as settled. |
| **Affected data** | `idauto_camera_sources`; `idauto_observations` (`smart_gate` captures) — no PII is stored, but employees' and visitors' vehicles are captured |
| **Affected users** | Fixpert workshop employees; visitors/customers; vehicle owners generally |
| **Jurisdiction** | Tunisia; no further detail stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | What disclosure (signage, notice) is legally required, and whether employee data-subject rights need a separate mechanism from visitor disclosure |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Bundled with L10, L12 |
| **Engineering consequence** | Same as L10 — no camera activation until resolved. If conditions are imposed: a disclosure/signage mechanism must be built before Smart Gate activation. |

---

## L12 — Video retention periods

| Field | Value |
|---|---|
| **Feature** | Smart Gate frame/derivative retention (gates `IDA-6`) |
| **Legal question** | "What is the maximum permitted retention period for camera frames and derivatives under Tunisian law?" — `docs/FIXPERT_INTEGRATION.md` §10 |
| **Affected data** | `idauto_observation_media` (Smart Gate `image_references`, `mythos_private`); `docs/FIXPERT_INTEGRATION.md` §3 step 2: "frames stored temporarily for processing" |
| **Affected users** | Vehicle owners/drivers, employees, visitors captured on camera |
| **Jurisdiction** | Tunisia; no specific period stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Maximum (and minimum, if any) retention for camera frames and derivatives |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Bundled with L10, L11; related to L07 (general retention item) but Smart-Gate-specific |
| **Engineering consequence** | No retention timer can be implemented for Smart Gate frames until this is answered. If the answer requires shorter windows than currently designed: the "no continuous recording, event-based capture only" design (`docs/FIXPERT_INTEGRATION.md` §3 step 1) may need further tightening. |

---

## L13 — Confirmation that no personal data can reach an anchor

| Field | Value |
|---|---|
| **Feature** | Blockchain anchoring (gates `IDA-8`) |
| **Legal question** | Implicit confirmation requirement from `docs/BLOCKCHAIN_ARCHITECTURE.md` §8 gate condition 5: "legal review confirms no personal data can reach an anchor" |
| **Affected data** | Merkle-batched record hashes (salted per `docs/PRIVACY_ARCHITECTURE.md` §5); the salt store |
| **Affected users** | All data subjects indirectly — the confirmation exists to protect them from personal data becoming permanently public on-chain |
| **Jurisdiction** | Cross-border by nature (a public blockchain is inherently multi-jurisdictional); the technical rule is stated absolutely in `docs/PRIVACY_ARCHITECTURE.md` §5, but the legal confirmation itself is a separate, unmet gate condition |
| **Current status** | **OPEN** |
| **Required decision** | Counsel must confirm the salted-hash-only anchor design in fact contains no personal data, and no hash of a low-entropy personal value, under applicable law |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | One of six hard-gate conditions for `IDA-8` (`docs/ROADMAP.md` IDA-8 section); independent of the four IDA-4 blockers |
| **Engineering consequence** | Anchoring cannot begin regardless of technical readiness until this confirmation is on file. If REJECTED: the salting/hashing design (`docs/PRIVACY_ARCHITECTURE.md` §5) must be revised before any anchor submission. |

---

## L14 — Official data-source agreement

| Field | Value |
|---|---|
| **Feature** | Institutional/official data-source integration (gates `IDA-9`) |
| **Legal question** | Not phrased as a question in sources; `docs/ROADMAP.md` "LEGAL-REVIEW-REQUIRED — open items" lists "Official data-source agreement" as blocking `IDA-9`. The implicit question is what agreement or legal basis permits ingesting registry/inspection-authority data. |
| **Affected data** | Future `idauto_capture_sources` rows for `official_import` capture method; `idauto_vehicle_facts` sourced from official records |
| **Affected users** | Vehicle owners as data subjects of officially-sourced facts; the government/registry counterparty |
| **Jurisdiction** | Tunisia (registry/inspection authority integration is named in `docs/ROADMAP.md` IDA-9); no further detail stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | What agreement (data-sharing agreement, MOU, statutory basis) with an official source is required before ingesting its data |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel + owner (negotiating the agreement is a business/owner matter; counsel reviews terms) |
| **Dependency** | Independent of the four IDA-4 blockers; gates `IDA-9` only |
| **Engineering consequence** | `official_import` capture method stays unused. If REJECTED for a given source: that integration is dropped from `IDA-9` scope. |

---

## L15 — Cross-border data transfer basis

| Field | Value |
|---|---|
| **Feature** | Any processing of IDauto/Fixpert data outside Tunisia (gates `IDA-9` per ROADMAP's consolidated table; also raised at `IDA-6` scope by `docs/FIXPERT_INTEGRATION.md` §10 for Smart Gate/Fixpert data specifically) |
| **Legal question** | "If any Fixpert data or Smart Gate data is processed outside Tunisia, what additional requirements apply?" (`docs/FIXPERT_INTEGRATION.md` §10); `docs/ROADMAP.md`'s open-items table separately lists "Cross-border data transfer basis" blocking `IDA-9` |
| **Affected data** | Any data processed by infrastructure/services outside Tunisia — e.g. the off-host backup destination, or any externally-hosted OCR/ANPR processing service if one is ever used instead of self-hosted processing |
| **Affected users** | All data subjects whose data might leave Tunisia |
| **Jurisdiction** | Cross-border by definition — Tunisia as origin; destination jurisdiction(s) unstated in sources — counsel to confirm which destinations actually apply |
| **Current status** | **OPEN** — `docs/IDA4_READINESS_AUDIT.md` §B.2 notes a discrepancy this matrix preserves rather than resolves: `docs/ROADMAP.md` attributes this item to `IDA-9`, while `docs/FIXPERT_INTEGRATION.md` §10 raises the same question at `IDA-6` scope for Smart Gate/Fixpert data. Both citations are carried here. |
| **Required decision** | Legal basis for any cross-border transfer, and confirmation of which processing (if any) actually leaves Tunisia today or under `IDA-6`/`IDA-9` plans |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Relates to L10–L12 (Smart Gate bundle) if invoked at `IDA-6` scope; independently gates `IDA-9` |
| **Engineering consequence** | No engineering action currently depends on this — no cross-border processing is implemented today. If a future design requires cross-border processing, that specific integration is blocked until resolved. |

---

## L16 — Owner identity processing

| Field | Value |
|---|---|
| **Feature** | Any internal processing of owner identity data at all (as distinct from *publishing* vehicle facts) |
| **Legal question** | "Under what conditions, if any, may owner identity (CIN, name, address) be processed internally?" — `docs/PRODUCT_SPEC.md` §12, row "Owner identity processing" |
| **Affected data** | Owner PII momentarily extracted during carte grise OCR (`docs/CAPTURE_PIPELINE.md` §5 step 3) — full name, address, CIN, date of birth, registration date — explicitly **not** stored in any `idauto_` table column; routed to `fixpert.clients` (a different schema) or discarded |
| **Affected users** | Vehicle owners as data subjects |
| **Jurisdiction** | Tunisia; no further detail stated — counsel to confirm |
| **Current status** | **OPEN** |
| **Required decision** | Under what conditions, if any, owner identity may be processed internally at all — distinct from L01 and L03, which ask whether facts may be *published*, not whether owner identity may be *processed internally* in the first place |
| **Evidence** | — none yet; no legal evidence on file |
| **Owner** | Legal counsel |
| **Dependency** | Overlaps L04 (carte grise OCR consent) and L06 (correction/deletion — owner identity is exactly the kind of data those rights would apply to) |
| **Engineering consequence** | This is one of the four items directly blocking the citizen-facing IDA-4 surface (see summary below). The current design already discards or never-stores owner PII in the `idauto` schema as a technical mitigation (`docs/CAPTURE_PIPELINE.md` §5 step 8), but that technical mitigation is **not itself a legal answer** to whether processing owner PII in memory during OCR is lawful in the first place. If REJECTED: the OCR-then-discard flow itself may need redesign, up to and including not OCR-reading PII fields at all. |
| **Finding** | `docs/IDA4_READINESS_AUDIT.md` §B.2 records that this item does not appear, in substance or in a mapped-to-stage form, anywhere in `docs/ROADMAP.md`'s 15-row consolidated "open items" table — it was present at IDA-1 in `docs/PRODUCT_SPEC.md` §12 and appears to have been dropped, not resolved, when the roadmap's list was consolidated. This matrix reproduces that finding rather than correcting either document; resolving which list is authoritative was explicitly out of the readiness audit's read-only scope, and remains out of this matrix's scope too. |

---

## The four items directly blocking the citizen-facing IDA-4 surface

Per `docs/IDA4_READINESS_AUDIT.md` §B.3 and §H, and independently verified against
`docs/ROADMAP.md`'s "LEGAL-REVIEW-REQUIRED — open items" table (which tags three of these four
directly to `IDA-4`) plus the audit's own reasoning for the fourth:

1. **L06 — Data correction / deletion rights for individuals.** Tagged `IDA-4` directly in `docs/ROADMAP.md`.
2. **L07 — Data retention periods, all categories.** Tagged `IDA-4` directly in `docs/ROADMAP.md`.
3. **L09 — Operator super-admin access governance policy.** Tagged `IDA-4` directly in `docs/ROADMAP.md`.
4. **L16 — Owner identity processing.** Not tagged to any stage in `docs/ROADMAP.md`'s consolidated table (see the Finding under L16 above), but the readiness audit attributes it to `IDA-4` "arguably... given it concerns the same owner-identity data IDA-4's holder-association and correction/deletion mechanics would touch" (§B.3).

This matches the task brief's expected four items (correction/deletion rights, retention
periods, super-admin governance, owner-identity processing) exactly, and this matrix confirms
that mapping directly against both the audit's own text and the primary source documents
rather than taking the audit's summary on faith.

**All four remain OPEN.** No document read for this matrix, or for the audit it is built
from, claims any of the four is resolved or imminent.

---

## Summary status table

| ID | Item | Status | Blocks | Blocks IDA-4 directly? |
|---|---|---|---|---|
| L01 | Public image contribution — legal basis | OPEN | IDA-3G | No (feeds IDA-4's capture pipeline indirectly) |
| L02 | Precise GPS collection — consent and notice | OPEN | IDA-3G | No |
| L03 | Public plate lookup — legal basis | OPEN | IDA-3I | No |
| L04 | Registration-certificate OCR — processing basis and consent flow | OPEN | IDA-6 | No (adjacent — citizen registration is a plausible OCR entry point) |
| L05 | Contributor consent — formal mechanism | OPEN | IDA-3G | No |
| L06 | Data correction / deletion rights for individuals | OPEN | IDA-4 | **Yes** |
| L07 | Data retention periods, all categories | OPEN | IDA-4 | **Yes** |
| L08 | Professional data-sharing legal basis | OPEN | IDA-5 | No |
| L09 | Operator super-admin access governance policy | **OPEN, OWNER_DECISION** | IDA-4 | **Yes** |
| L10 | ANPR — regulatory notification or approval | OPEN | IDA-6 | No |
| L11 | Camera disclosure to visitors and employees | OPEN | IDA-6 | No |
| L12 | Video retention periods | OPEN | IDA-6 | No |
| L13 | Confirmation that no personal data can reach an anchor | OPEN | IDA-8 | No |
| L14 | Official data-source agreement | OPEN | IDA-9 | No |
| L15 | Cross-border data transfer basis | OPEN | IDA-9 (per ROADMAP) / raised at IDA-6 scope | No |
| L16 | Owner identity processing | OPEN | Not tagged in ROADMAP; audit attributes to IDA-4 | **Yes (arguably, per audit reasoning)** |

**No item is APPROVED.** No item has any legal evidence on file. This document will be
edited, item by item, as counsel's answers arrive — never bulk-approved, and never approved
by engineering.
