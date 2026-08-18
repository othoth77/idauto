# ID Auto — IDA-3 Community Ingestion Architecture (Binding Design)

**Status:** DECIDED — binding on all IDA-3 implementation slices.
**Stage:** `IDA-3-DESIGN-GATE` · **Decided:** 2026-08-12 · **Baseline:** `c6aef86071358d67583a60b9a63bfa2898fc15c5`

**Design only.** No endpoint was implemented, nothing was exposed, no SQL executed, no schema changed, nothing deployed. No scraping, OCR, or AI vision was added.

**Predecessors:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`ROADMAP.md`](ROADMAP.md) · `MYTHOS_IDENTITY_ARCHITECTURE.md` (external — Mythos OS repository) · [`STORAGE_RUNBOOK.md`](../ops/runbooks/STORAGE_RUNBOOK.md) · `MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md` (external — Mythos OS repository)

---

## 0. The single most important finding

**Most of the IDA-3 data model already exists and is live.** The schema authored in IDA-1/IDA-2 anticipated community capture with unusual completeness. Verified against the live schema at baseline:

| Capability | Already present |
|---|---|
| Submission lifecycle | `idauto_observations.status` — `received · processing · pending_confirmation · pending_review · accepted · rejected · duplicate · conflict · blocked` (9 states, CHECK-constrained) |
| Contributor trust & blocking | `idauto_contributors` — `trust_score` (0–100), `total/accepted/rejected_submissions`, `blocked`, `blocked_at`, `blocked_reason` |
| Source trust tiers | `idauto_capture_sources` — `source_type` (7), `trust_level` 1–5, `requires_consent`, `legal_basis`; **`PUBLIC_UPLOAD` (trust 1) and `CONTRIBUTOR_UPLOAD` (trust 2) already seeded** |
| Fact provenance | `idauto_vehicle_facts` — `source_id`, `observation_id`, `confidence_score`, `verification_status` (5), `access_scope` (3), `is_active` supersession, `first_seen_at`/`last_seen_at`, `validated_by`/`validated_at` |
| Media provenance & privacy | `idauto_observation_media` — `object_key`, `image_hash`, `access_scope`, `blurred`, `retention_status`, `accessed_count` |
| Capture provenance | `idauto_observations` — `capture_source_id`, `contributor_id`, `capture_time`, `ip_hash`, `ocr_confidence`, `capture_method` (7) |
| Audit | `idauto_audit_log` — append-only, `actor_type` CHECK, `actor_ref`, `ip_hash`, `request_id` |

**Consequence:** IDA-3 is mostly *wiring and enforcement*, not modelling. The design below therefore adds the **minimum** new structure and says "already exists" wherever that is true. Resisting the urge to redesign what is already correct is the main discipline of this document.

---

## 1. Product boundary — what IDA-3 v1 is

**One canonical v1 submission = one observation of one vehicle, optionally with images and attribute assertions.**

| Who may submit (v1) | Allowed? |
|---|---|
| Admin / operator (existing token) | **Yes** — first slice |
| Authenticated Mythos user | **Yes, but gated** on real auth (§5) |
| Verified contributor | Yes, same mechanism as authenticated |
| Professional (org member) | **Deferred** to IDA-4 — needs org-scoped roles in a deployed identity core |
| Anonymous (no credential) | **Yes, last** — public gate only, strictest limits |
| Automated service (`svc_*`) | **Deferred** — see §19 (web ingestion) |

| What may be submitted (v1) | In scope |
|---|---|
| Plate string (raw + normalised) | **Yes** |
| Observation (capture method, capture time) | **Yes** |
| 0–N images | **Yes**, bounded (§10) |
| Vehicle attribute assertions (`fact_key`/`fact_value`) | **Yes**, restricted key set |
| Free-text note | **No** — abuse and PII surface with no v1 consumer |
| Location / GPS | **No** in v1 (§9) — schema has no observation GPS column and adding one is a privacy decision, not an ingestion one |
| Documents (carte grise) | **No** — `carte_grise_*` media types exist but belong to IDA-4 professional flows |
| Source URL / scraped evidence | **No** — §19 |
| VIN | **No** from public/anonymous sources; professional/official only |
| Owner / person data | **Never** — no owner-PII column exists anywhere and none will be added |

**Explicitly out of v1:** OCR, AI vision, plate detection, image derivatives/crops, thumbnails, web crawling, external providers, public *lookup* rate-limit changes beyond what §7 defines, professional org flows, payments, notifications.

---

## 2. Trust model

Trust is **already** expressed by `idauto_capture_sources.trust_level` (1–5) plus `idauto_contributors.trust_score` (0–100). **No new reputation engine.** v1 uses source tier for routing and leaves `trust_score` as an existing, already-implemented input to queue priority.

| Source class | capture_source | trust_level | May submit | Auto-accept? | Review | Confidence seed | Rate class | actor_type |
|---|---|---|---|---|---|---|---|---|
| Anonymous | `PUBLIC_UPLOAD` | 1 | plate, observation, ≤2 images | **Never** | `pending_review` | 0.30 | strictest | `anonymous` |
| Authenticated user | `CONTRIBUTOR_UPLOAD` | 2 | + attribute facts | **Never** | `pending_review` | 0.45 | standard | `contributor` |
| Verified contributor (`trust_score ≥ 60`) | `CONTRIBUTOR_UPLOAD` | 2 | same | **Never in v1** | `pending_confirmation` (lighter queue) | 0.55 | relaxed | `contributor` |
| Professional | `PROFESSIONAL_SCAN` | 4 | + VIN, documents | Deferred | `pending_review` | 0.70 | high | `professional_user` |
| Admin | `MANUAL_ADMIN` | 5 | everything | **Yes** (existing behaviour) | `accepted` | 0.90 | none | `admin` |
| Automated service | — | — | — | — | — | — | `system` |

**Decision — no auto-accept for any non-admin source in v1.** A community platform that auto-accepts unreviewed public claims about identifiable vehicles is the failure mode most likely to cause real-world harm and a legal complaint. Auto-accept for high-trust contributors may be reconsidered once acceptance/rejection statistics exist — the counters already in `idauto_contributors` are precisely the evidence that decision will need.

---

## 3. Provenance model

Every submitted item must answer: who, from where, captured when, submitted when, source type, original vs derived, transformation history, confidence, review status, evidence linkage.

| Question | Where answered | Status |
|---|---|---|
| Who submitted | `observations.contributor_id` → `contributors.mythos_user_id` | **Exists** |
| Source class | `observations.capture_source_id` → `capture_sources` | **Exists** |
| Captured when | `observations.capture_time` (mythos_private) | **Exists** |
| Submitted when | `observations.created_at` | **Exists** |
| Source type / trust | `capture_sources.source_type`, `.trust_level` | **Exists** |
| Confidence | `facts.confidence_score`, `observations.ocr_confidence` | **Exists** |
| Review status | `observations.status`, `facts.verification_status` | **Exists** |
| Evidence linkage | `facts.observation_id`, `media.observation_id` | **Exists** |
| Original vs derived | — | **GAP** |
| Transformation history | — | **GAP** (not needed until derivatives exist) |
| Idempotency / replay identity | — | **GAP** |
| Rate-limit accounting | — | **GAP** |

### Proposed schema changes

| Change | Classification | Rationale |
|---|---|---|
| `idauto_observation_media.derived_from_media_id BIGINT NULL` | **REQUIRED_NOW** | One nullable self-reference makes "original vs derived" answerable forever. `media_type` already distinguishes `original_image` from `plate_crop`/`processed_derivative`, but does not say *which* original a derivative came from. Adding it now costs one column; adding it after derivatives exist costs a backfill. |
| `idauto_submissions` (submission envelope: `id`, `idempotency_key UNIQUE`, `actor_ref`, `actor_type`, `capture_source_id`, `ip_hash`, `received_at`, `status`, `observation_id`) | **REQUIRED_NOW** | A submission is not the same entity as an observation: it may be rejected before any observation exists, it is the unit of idempotency and rate limiting, and it must be auditable even when it produces nothing. Without it there is nowhere to record a rejected or duplicate submission. |
| `idauto_rate_limit_counters` (`bucket_key`, `window_start`, `count`, PK `(bucket_key, window_start)`) | **REQUIRED_NOW** | §7. Deliberately **not** `idauto_verifications`. |
| `idauto_contributors.trust_score` recalculation trigger | **REJECTED** | Application-level concern; a trigger hides trust changes from the audit trail. |
| `observations.location_*` / GPS | **DEFERRED** | Privacy decision (§9), no v1 consumer. |
| Transformation-history table | **DEFERRED** | Until image derivatives exist (post-v1). `derived_from_media_id` covers the one-hop case. |
| Per-fact `submitted_by` | **REJECTED** | Redundant: `facts.observation_id` → `observations.contributor_id`. |
| New `access_scope` values | **REJECTED** | §9 — the existing three suffice. |

**Net: 2 new tables, 1 new column.** Everything else already exists.

---

## 4. Deduplication

Content-addressed SHA-256 storage already makes media dedup exact and free (§ storage runbook). The classification below is what the ingestion service must implement.

| Case | Detection | Class | Action |
|---|---|---|---|
| Same image uploaded twice | `image_hash` identical | **HARD_DUPLICATE (media)** | Reuse the existing object; create a **new** media row. Never collapse rows — two observations legitimately share one object (live data already has an object referenced by 17 rows). |
| Same submission retried | `idempotency_key` match | **HARD_DUPLICATE (submission)** | Return the original result, `200`, create nothing. |
| Same observation resubmitted by the **same** actor | same actor + plate + `capture_time` within 60s | **HARD_DUPLICATE** | `observations.status = 'duplicate'`, link to the original. |
| Same plate/event from **different** users | same plate, `capture_time` within a short window | **RELATED_EVIDENCE — never merged** | Two independent observations. Independent corroboration is *signal*, and collapsing it destroys exactly the value community capture creates. |
| Same vehicle, conflicting attributes | same `vehicle_id` + `fact_key`, different normalised value | **CONFLICT** | Both facts persist; newer does **not** auto-supersede. Set `verification_status='conflict'` and route to review. `is_active` supersession is an admin decision, never automatic for community sources. |
| Same evidence, different source | identical `image_hash`, different `capture_source_id` | **SOFT_DUPLICATE** | Keep both rows, flag for review. Could be corroboration *or* one user re-uploading another's image — a human must decide. |

**Invariant:** deduplication may collapse **bytes**, never **claims**. Object storage is deduplicated; evidence is not.

---

## 5. Identity and actor model

Uses the ratified contract in `MYTHOS_IDENTITY_ARCHITECTURE.md` unchanged. No redesign, no auth implementation here.

| Submitter | `actor_ref` | `actor_type` | `contributor_id` |
|---|---|---|---|
| Admin (operator token) | `usr_<uuidv7>` from `IDAUTO_ADMIN_IDENTITIES` | `admin` | NULL |
| Authenticated user | `usr_<uuidv7>` | `contributor` | resolved/created |
| Professional | `usr_<uuidv7>` | `professional_user` | resolved |
| Automated service | `svc_<name>` | `system` | NULL |
| **Anonymous** | **`NULL`** | `anonymous` | **NULL** |

**Decision — anonymous submitters get NO canonical user ID and NO contributor row.** Minting a `usr_` identifier for an unauthenticated caller would create a permanent identity record for someone who never authenticated, and would corrupt the meaning of `mythos_user_id`. The contract already permits `actor_ref = NULL` with `actor_type='anonymous'`.

Anonymous accountability instead comes from the **submission envelope**: `idauto_submissions.ip_hash` (already the established pattern in `observations` and `verifications`) plus the rate-limit bucket key. That is sufficient to throttle and to block, without inventing an identity.

**Rejected:** a "temporary submission actor" / pseudo-user table. It is an identity system in disguise, and `ip_hash` + submission envelope already covers throttling and abuse response.

---

## 6. Review pipeline

**The nine existing `observations.status` values are sufficient. No new state is added.**

```
submission → validate → dedup → trust-classify → persist → route → review → accept/reject
```

| Route | Resulting status |
|---|---|
| Admin submission | `accepted` (existing behaviour, unchanged) |
| Verified contributor (`trust_score ≥ 60`) | `pending_confirmation` — lighter-touch queue |
| Anonymous / standard contributor | `pending_review` |
| Detected duplicate | `duplicate` |
| Conflicting attribute claim | `conflict` |
| Blocked contributor or abuse rule | `blocked` |
| Failed validation | no observation created; `submissions.status='rejected'` |

`received` and `processing` are reserved for a future asynchronous pipeline; v1 is synchronous and transitions straight to a terminal or review state.

**Decision — accepting an observation does NOT auto-accept its facts or media.** They are separate rows with their own `verification_status` / `retention_status`, and a reviewer may accept a sighting while rejecting a bogus attribute claim attached to it. Bulk-accept is an admin UI convenience (IDA-3E), never an implicit data rule.

**Admin visibility:** reviewers see everything, including `mythos_private` fields, because review requires the raw evidence. Non-admin responses continue to exclude `mythos_private` exactly as `api.js` does today (already covered by IDA-2C/2H tests).

---

## 7. Rate limiting — the IDA-2I decision

**`RATE_LIMIT_STAGE = BEFORE_ENDPOINT`** — enforcement ships as its own slice **before** any publicly reachable ingestion route exists. This honours the binding roadmap statement: *"Rate-limit design and enforcement must land before IDA-3 exposes public plate lookup or community capture."*

### Store decision

| Option | Verdict |
|---|---|
| In-memory only | **Insufficient alone.** Lost on restart, not shared across processes. Useful only as a fast path in front of the durable store. |
| **`idauto_verifications`** | **REJECTED.** It is a *lookup* history table (`plate_queried`, `result_status`, `response_ms`) — a read log, not a write counter. The roadmap already forbids overloading it, and that judgement is correct. |
| Reuse the VPS Redis instances | **REJECTED.** They belong to Dar Hijama and Coolify. Cross-product coupling, and the memory audit flagged those containers as the largest uncapped-memory risk on the host. ID Auto must not take a runtime dependency on another product's datastore. |
| **Dedicated PostgreSQL table** | **CHOSEN.** `idauto_rate_limit_counters` — fixed-window counters, durable across restarts, same transactional store as the data, no new infrastructure, trivially inspectable by an operator. |
| n8n | **Not involved.** Unrelated system; must remain so. |

### Key dimensions and limits (starting values, tunable without redesign)

Bucket key = `sha256(dimension || ':' || identifier)`, window = fixed 60s and 24h tiers.

| Class | Per minute | Per day | Keyed on |
|---|---|---|---|
| Anonymous | 3 | 30 | `ip_hash` |
| Authenticated contributor | 10 | 200 | `mythos_user_id` |
| Verified contributor | 20 | 500 | `mythos_user_id` |
| Professional / service | 60 | 5,000 | `mythos_user_id` + `org` |
| Admin | unlimited | unlimited | not counted |

A second `ip_hash` bucket applies **in addition** to the user bucket for all non-admin classes, so one actor cannot bypass IP limits by rotating accounts, nor bypass account limits by rotating IPs. Media bytes/day is a third bucket (§10).

Exceeded → `429` with `Retry-After`, an audit event, and `submissions.status='rejected'`. Rate-limit rejections are counted but **not** stored as observations.

---

## 8. Threat model

| Threat | Likelihood | Impact | Existing mitigation | Missing | Fixed in |
|---|---|---|---|---|---|
| Spam flood | High | High | none | rate limiting | IDA-3C |
| Fake plates | High | Medium | `plate-validator.js` format check | review routing | IDA-3B/D |
| Fabricated vehicle data | High | Medium | facts default `unverified` | conflict routing | IDA-3B |
| Image flooding | High | High (storage) | none | per-day byte quota | IDA-3C |
| Oversized payload | Medium | High | `MAX_UPLOAD_BYTES` 20 MB in `storage.js` | request-level body cap **before** buffering | IDA-3B |
| Malicious MIME | Medium | Medium | MIME allow-list | magic-byte check | IDA-3B |
| Path traversal | Low | Critical | content-addressed paths derived from a computed hash — caller input never touches the path | none | — |
| Crafted JSON | Medium | Medium | none | strict schema + size cap | IDA-3B |
| Duplicate flooding | High | Medium | `image_hash` dedup | submission dedup + limits | IDA-3B/C |
| Replay | Medium | Medium | none | idempotency key | IDA-3B |
| Bot submissions | High | Medium | none | rate limits; CAPTCHA only if evidence demands | IDA-3C |
| Endpoint scraping | Medium | Low | write-only endpoint returns no corpus | — | — |
| Probing private data | Medium | High | `mythos_private` exclusion, tested | keep tests green | ongoing |
| Enumeration | Medium | Medium | opaque `usr_`/`internal_ref` identifiers (identity decision §2) | — | — |
| Privilege escalation | Low | Critical | role checked server-side; client never supplies trust | never trust client-declared source | IDA-3B |
| Audit spoofing | Low | High | `actor_ref` set server-side from resolved identity | reject client-supplied `actor_ref` | IDA-3B |
| Token leakage | Medium | High | tokens never logged | rotation procedure | IDA-3D |
| CSRF | Medium | Medium | token-in-header, not cookie | keep it that way | IDA-3D |
| XSS via metadata | Medium | Medium | API returns JSON | escaping in admin UI | IDA-3E |
| Malformed EXIF | Medium | Medium | none | **strip all EXIF** (§10) | IDA-3B |
| Image decoder exploit | Low | Critical | **no decoding happens today** | keep it that way in v1 | — |
| Denial of storage | High | High | none | byte quotas + monitoring | IDA-3C |
| Legal / privacy complaint | **High** | **High** | `requires_consent`, `LEGAL-REVIEW-REQUIRED` already recorded in schema | consent flow + takedown | IDA-3G |

**Highest-priority gaps: rate limiting, byte quotas, EXIF stripping, and the consent/legal gate.**

---

## 9. Privacy model

**The three existing scopes — `public`, `professional`, `mythos_private` — are sufficient. No new scope.**

| Data | Default scope | Note |
|---|---|---|
| Plate number | `public` | The product's core public identifier |
| Uploaded original image | **`mythos_private`** | Already the column default. May contain faces, bystanders, locations, addresses |
| Plate crop (future) | `public` | Narrow crop, minimal incidental content |
| Vehicle crop (future) | `professional` | May include surroundings |
| Reporter identity | **never exposed** | `contributor_id` is an internal FK; never in a public response |
| Exact capture time | `mythos_private` | Already documented as such in the schema |
| GPS / location | **not collected in v1** | Location plus timestamp plus plate is a movement-tracking dataset |
| VIN | `mythos_private` | Already documented; never accepted from anonymous sources |
| Ownership data | **never stored** | No owner-PII column exists anywhere; none will be added |
| EXIF | **stripped, not stored** | §10 |
| `ip_hash` | `mythos_private` | Hash only; raw IP never stored |

**Faces and bystanders:** originals default to `mythos_private`, so nothing containing a face is publicly served in v1. Blur/redaction is what `media.blurred` exists for; a derivative pipeline is post-v1, and until it exists no public image serving may be enabled.

---

## 10. Media ingestion safety

```
request → body size cap → count cap → MIME allow-list → magic-byte check
        → EXIF strip → SHA-256 → dedup → storage.store() → media row → audit → review
```

| Rule | v1 value | Rationale |
|---|---|---|
| Max images/submission | **2** anonymous · **5** authenticated | Bounds a single abusive request |
| Max bytes/image | **10 MB** public (`storage.js` keeps its 20 MB ceiling for admin) | Public need is lower than the admin ceiling |
| Max bytes/submission | 20 MB | |
| Daily byte quota | 50 MB anonymous · 250 MB authenticated | Denial-of-storage control |
| MIME allow-list | `image/jpeg`, `image/png`, `image/webp` | Matches `storage.js` minus HEIC |
| **HEIC publicly** | **NOT allowed in v1** | Its decoder surface is the least battle-tested of the four, and we deliberately do not decode images at all in v1. Remains allowed for admin uploads. |
| Magic-byte check | Required | A declared MIME is caller-controlled and must never be trusted alone |
| **EXIF** | **Stripped before hashing and storage** | EXIF routinely carries GPS, device serials, and timestamps — exactly the data §9 excludes. Stripping before hashing means the stored hash matches the stored bytes, preserving the content-addressing invariant. |
| Image dimension limits | **Not enforced in v1** | Enforcing dimensions requires decoding, which is the risk we are avoiding. Byte caps bound the damage. |
| Malformed image | Accepted as opaque bytes; never decoded | Decoding is the attack surface |
| Actual decoding | **NOT required in v1** and deliberately not performed | |
| Derivatives / crops / thumbnails | **Post-v1, asynchronous job** | Never synchronous in the request path |

**EXIF stripping is the one image operation v1 performs.** It must be a container-level strip (parse and drop metadata segments without decoding pixels), not a re-encode.

---

## 11. Off-host backup gate

**`OFFHOST_REQUIRED_BEFORE_IDA3_PUBLIC = YES`** — and more precisely, **before the first stage that accepts real (non-synthetic) evidence from anyone other than an admin.**

Today both the media backup and the PostgreSQL dump live on the **same host as the data they protect** (`ops/runbooks/STORAGE_RUNBOOK.md` §11). That covers accidental deletion and corruption but not host or disk loss. Synthetic fixtures make that acceptable now; contributor-submitted evidence cannot be regenerated and may be legally relevant, so it is not acceptable then.

| Option | Cost | Complexity | Restore | Encryption | Lock-in | Verdict |
|---|---|---|---|---|---|---|
| **A. rsync/scp to a second host** | Second host only | Low | Trivial — plain files | SSH in transit; at-rest is the host's | None | **CHOSEN** for the first increment |
| B. Generic S3-compatible | Low | Medium | Good | SSE + client-side | Low | Reasonable later |
| C. Cloudflare R2 | Low (no egress fee) | Medium | Good | SSE | Medium | Strong candidate at volume; Cloudflare work is already gated by `INF-CF-2` |
| D. Backblaze B2 | Lowest | Medium | Good | SSE | Medium | Viable |
| E. OVH Object Storage | Low | Medium | Good | SSE | Medium | Same provider as the VPS — correlated failure domain, weakest choice |
| F. Encrypted archive to another host | Second host | Medium | Needs key custody | Strong | None | Fold into A as `age`/`gpg` encryption |

**Rationale for A first:** the backup artifact is already a plain directory of content-addressed files with a manifest and checksums — `rsync` reproduces it exactly, and restore is a file copy verified by the existing `verify-backup` command. No new SDK, credential class, bucket policy, or vendor dependency. Object storage (B/C/D) becomes worthwhile at volume or when a second host is not available; the artifact format is deliberately portable to it with no redesign.

**Non-negotiable for whichever is chosen:** the off-host copy must be **restore-tested** (`AGENTS.md` §16), and the destination must not be writable by the source host in a way that lets a compromise delete both copies — append-only or pull-based replication is strongly preferred.

---

## 12. API contract

**Endpoint (not implemented):** `POST /api/ingest/observations`

- **Versioning:** URI-versioned from first public exposure — `/api/v1/ingest/observations`. Internal/private-pilot slices may use the unversioned path; the public gate must be versioned.
- **Transport:** `multipart/form-data` — one `submission` part (JSON) plus 0–N `image` parts. JSON-with-base64 is rejected: it inflates payloads ~33% and forces full buffering before size can be judged.
- **Auth modes:** operator token (private pilot) → Mythos session/bearer (authenticated) → none (anonymous, public gate only). Always a header, never a cookie (CSRF, §8).

**Headers:** `Authorization: Bearer <token>` (optional per mode) · `Idempotency-Key: <client-uuid>` (**required**) · `Content-Type: multipart/form-data`.

**Request (`submission` part):**
```json
{
  "plate": "123 TUN 4567",
  "capture_method": "plate_scan",
  "captured_at": "2026-08-12T09:15:00Z",
  "facts": [ { "key": "colour", "value": "white" } ],
  "consent": true
}
```
`capture_source_id`, `contributor_id`, `actor_ref`, `trust_level` and `confidence` are **server-derived**. A client-supplied value for any of them is a `400`, never silently ignored (§8 audit spoofing / privilege escalation).

**Responses:**

| Status | Meaning | Body |
|---|---|---|
| `201` | Accepted for review | `submission_id`, `observation_id`, `status`, `media[]` refs |
| `200` | Idempotent replay | the original result, unchanged |
| `202` | Accepted, duplicate detected | `status: "duplicate"`, `original_observation_id` |
| `400` | Validation error | field-level errors, no partial write |
| `401` | Credential required/invalid | |
| `403` | Blocked contributor, or consent absent where required | |
| `413` | Payload/image too large | limit echoed |
| `415` | MIME not allowed | allow-list echoed |
| `422` | Plate format invalid | `format_code` hint from `plate-validator.js` |
| `429` | Rate limited | `Retry-After` |
| `500` | Server fault | opaque; details only to the audit log |

Responses never include `mythos_private` fields, reporter identity, or object storage paths — the existing `GET` media contract (metadata-only, no raw path) is preserved.

---

## 13. Atomicity model

Media is filesystem-first; the DB write is transactional. This is already true and already correct (`ops/runbooks/STORAGE_RUNBOOK.md` §1).

**Decision: staged transaction, not a saga.**

```
1. Validate + rate-limit          (no writes)
2. INSERT submission              (own transaction, committed — the durable idempotency anchor)
3. Store media objects            (filesystem, content-addressed, idempotent by construction)
4. ONE transaction:               observation + facts + media rows + audit  → COMMIT
5. UPDATE submission              status + observation_id
```

**Invariants:**
1. A committed observation's media objects always already exist on disk (step 3 precedes step 4).
2. An orphaned object may exist if step 4 fails — harmless, `UNKNOWN`-classified, never auto-deleted, and cheap because content-addressing means a retry reuses the same object rather than creating another.
3. Cleanup on failure deletes an object **only if no row references it** — the existing `writes.js` rule, which must be preserved.
4. `idempotency_key` is UNIQUE, so a concurrent duplicate loses the insert race and returns the winner's result.
5. Audit is written **inside** the same transaction as the data (existing `withAudit` pattern) — data and audit commit together or not at all.
6. No submission may leave the DB in a state where an observation exists without an audit row.

A saga was rejected: it needs compensating actions, and step 3 is already idempotent while steps 4–5 are a single transaction. There is nothing to compensate.

---

## 14. Error and retry model

| Failure | HTTP | Client retry | Server retry | Audit? | Partial data | Cleanup |
|---|---|---|---|---|---|---|
| Validation | 400/422 | No (fix first) | No | Yes (rejection) | None | None |
| Rate limited | 429 | Yes after `Retry-After` | No | Yes | None | None |
| Payload too large | 413 | No | No | Yes | None | Reject before buffering |
| MIME rejected | 415 | No | No | Yes | None | None |
| Blocked contributor | 403 | No | No | Yes | None | None |
| DB unavailable | 503 | Yes (backoff) | No | **Cannot** — record in process log | None | Objects may be orphaned; audit catches them |
| Disk full | 507 | Yes later | No | Yes | None | Object write fails before DB insert |
| Media write failure | 500 | Yes (idempotent) | No | Yes | None | Existing reference-checked cleanup |
| Duplicate submission | 200/202 | No | No | Yes | None | None |
| Identity resolver failure | 401 | No | No | Yes | None | None |
| Audit failure | 500 | Yes | No | n/a | **None** — audit is in-transaction, so its failure rolls back the data | Automatic rollback |

Retries are always safe because `Idempotency-Key` is required.

### 14.1 Owner decisions — IDA-3C rate-limit semantics (decided 2026-08-12)

Implementing IDA-3C surfaced two questions this document did not settle. Both were escalated to the owner rather than guessed, and both are now **binding**. The original section text above is left unchanged so the record of what was ambiguous survives.

**Decision A — a rate-limited request writes an audit event and nothing else.** No `idauto_submissions` row, no observation, no fact, no media row.

This resolves a three-way conflict: §7 said `submissions.status='rejected'` (implying a row), §14 says `Partial data: None` (implying no rows), and §13 runs the rate-limit check at step 1, *before* the submission is inserted at step 2, leaving no row to mark. The decision follows §14 and §13, because writing a durable row for every rejected request is itself a denial-of-service amplification vector — an attacker would force unbounded table growth precisely by exceeding the limit, defeating the control. Forensics are preserved without it: the counter row's `bucket_key` is the SHA-256 of the actor or `ip_hash` dimension, so the abusive bucket remains identifiable, and §15 already sources "rate-limit hits" from `idauto_rate_limit_counters` plus audit events rather than from submissions.

Where §7 says `submissions.status='rejected'`, read it as describing a submission rejected *after* its envelope exists, not the rate-limited case.

**Decision B — idempotency is resolved before the rate-limit check; a replay consumes no quota.** A request whose `idempotency_key` is already present returns the original result and is never counted or rejected.

This document never stated the order. §13 lists rate-limiting at step 1 and the submission anchor at step 2, which would consume quota on replays; but §14 states that retries are always safe because `Idempotency-Key` is required, and instructs clients to retry after `Retry-After`. Those cannot both hold: an anonymous submitter limited to 3/minute would exhaust its entire allowance retrying a single timed-out submission. The decision makes §14's guarantee true. The cost is one indexed lookup on a `UNIQUE` column ahead of the limiter; a caller replaying a valid key can fetch a cached result without being limited, which is bounded work that creates nothing.

Consequently the enforced order is: **validate → server-derived actor and source identity → idempotency resolution → rate-limit decision → permitted submission flow.**

### 14.2 Owner decision — community fact visibility (decided 2026-08-12, IDA-3E)

This document defined scopes per data type (§9) and stated that reviewers see everything while non-admin responses keep excluding `mythos_private` exactly as `api.js` does today (§6). It never stated a visibility rule for community **attribute facts** by verification state. IDA-3B consequently wrote ingested facts as `access_scope='public'` with `verification_status='pending_review'`, and since `api.js` filters non-admin reads on scope alone, such a claim would have been servable before any review. That gap was recorded as a forward risk through IDA-3B, 3C and 3D and is now closed by owner decision.

**Binding rule — unreviewed community claims are never publicly servable.**

| Stage | `verification_status` | `access_scope` | Visible to non-admin reads |
|---|---|---|---|
| Ingested, awaiting review | `pending_review` | **`mythos_private`** | **No** |
| Accepted by a reviewer | `verified` | **`public`** | Yes |
| Rejected by a reviewer | `rejected` | `mythos_private` (unchanged) | **No** |

Ingestion therefore writes community facts as `mythos_private`, and **acceptance is the single act that makes a claim eligible for public serving** — still behind the IDA-3G legal gate and the IDA-3I public gate, neither of which this decision advances.

The mechanism is deliberately the **existing** scope filter, not a new one: `api.js` non-admin read queries are **unchanged**, exactly as §6 requires. No new status, no new scope, no schema change, and no read-query change. A claim is safe because of what the row *is*, not because a query remembered to exclude it.

**Consequence for admin review visibility.** §6 requires that reviewers see everything including `mythos_private`, because review requires the raw evidence. The IDA-2H review-detail route predates this document and does the opposite — it filters `access_scope != 'mythos_private'`, and its suite asserts that a private fact value never appears in the detail response. Rather than change a tested security-relevant behaviour of a completed stage, IDA-3E adds its **own** admin review surface for IDA-3 submissions which shows full provenance including `mythos_private` evidence, and leaves the IDA-2H routes and assertions untouched. Observation decisions continue to reuse `writes.reviewObservation()`; fact-level decisions extend the same primitive family in `writes.js` rather than introducing a second review architecture, as §6 requires them to be separately reviewable.

---

## 15. Observability

**Current stack: structured process logs + PostgreSQL + the `media-ops.js audit` command. No Prometheus or Grafana is installed, and none should be deployed for v1** — every metric below is derivable by query or by an existing command.

| Metric | Source |
|---|---|
| Submissions/min, accepted/rejected/pending | `idauto_submissions` + `observations.status` |
| Rate-limit hits | `idauto_rate_limit_counters` + audit events |
| Validation failures | `submissions.status='rejected'` |
| Media bytes/day, storage growth | `sum(media.file_size_bytes)`; `manifest.media.total_bytes` across backup generations |
| Orphan / missing-object count | `media-ops.js audit --json` |
| Dedup ratio | `count(media) / count(distinct object_key)` — currently 73/38 |
| DB errors, audit failures | process log |
| Review backlog, oldest pending | `count/min(created_at) WHERE status IN ('pending_review','pending_confirmation')` |

**Required before public exposure:** a scheduled `media-ops.js audit` with alerting on non-zero `missing_objects`, and a review-backlog check. Both are cron-shaped, not a monitoring platform.

---

## 16. Moderation and admin operations

Design only; UI is IDA-3E.

Reviewers need: pending queue ordered by trust and age; source class, `trust_level`, and contributor history (the counters already exist); side-by-side conflicting facts; accept/reject **per item**, not only per observation; abuse flagging that sets `contributors.blocked` with `blocked_reason`; and a full audit trail of every decision.

**Rejected evidence is retained, not deleted.** Deleting it destroys the record needed to justify a block, to detect a repeat abuser, and to answer a complaint. `retention_status` already models `active | pending_deletion | deleted | legal_hold`, and `legal_hold` exists precisely for this. Malicious payloads are retained under `legal_hold` until an authorised operator decides otherwise.

---

## 17. Data retention

| Data | Business | Security | Legal/privacy |
|---|---|---|---|
| Accepted media | Indefinite while the vehicle record lives | — | **LEGAL-REVIEW-REQUIRED** |
| Rejected media | 90 days, then `pending_deletion` | Longer if abuse-linked | **LEGAL-REVIEW-REQUIRED** |
| Anonymous submissions | Same as rejected | `ip_hash` retained for abuse correlation | **LEGAL-REVIEW-REQUIRED** |
| Duplicate media | Object retained (shared); duplicate row retained as evidence | — | — |
| Abuse payloads | Retained under `legal_hold` | Required | **LEGAL-REVIEW-REQUIRED** |
| Process logs | 30 days | 90 days if security-relevant | — |
| Audit log | **Never deleted** — append-only by design | Required | — |
| Deleted user account | Contributor row anonymised (`mythos_user_id` tombstoned); submitted evidence **retained** as it is about a vehicle, not the person | — | **LEGAL-REVIEW-REQUIRED** |
| `mythos_private` evidence | Never publicly served | — | **LEGAL-REVIEW-REQUIRED** |

Every item marked **LEGAL-REVIEW-REQUIRED** needs a qualified human legal review before public ingestion. This document makes **no legal claim** — it flags where one is needed, consistent with `capture_sources.legal_basis` already carrying that marker for `PUBLIC_UPLOAD`.

---

## 18. Rollout phases

| Phase | Actors | Entry criteria | Exit criteria | Limits | Backup | Review SLA | Rollback |
|---|---|---|---|---|---|---|---|
| **IDA-3A/B/C** (build) | none | design approved | slices complete, tests green | n/a | same-host OK (synthetic only) | n/a | revert commit |
| **IDA-3D** private pilot | **admin only**, operator token, not publicly routed | 3A–3C complete | 50+ synthetic submissions, 0 integrity anomalies | admin unlimited | same-host OK | best effort | disable route |
| **IDA-3E** admin review | admin | 3D stable | reviewer can accept/reject/flag | — | — | — | — |
| **IDA-3F** off-host backup | — | before **any** real evidence | off-host copy restore-tested | — | **off-host required** | — | — |
| **IDA-3G** consent + legal gate | — | before authenticated pilot | legal review signed off; consent flow live | — | off-host | — | — |
| **IDA-3H** authenticated pilot | invited users | **real auth exists**; 3F+3G done | 2 weeks, abuse controls hold | contributor limits | off-host | 48h | revoke invites |
| **IDA-3I** public gate | anonymous + authenticated | 3H clean; monitoring live | — | anonymous limits | off-host | 72h | close endpoint |

---

## 19. Web ingestion / Firecrawl boundary

**`FIRECRAWL_STAGE = LATER`.** Web ingestion is **not** part of IDA-3 and belongs to a separate `IDA-4-WEB-INGESTION` stage. Nothing is installed by this design.

IDA-3 is about *human-submitted* evidence with a consenting contributor. Web collection has a different actor model (`svc_<name>`, `actor_type='system'`), different legal basis (robots/ToS/copyright rather than contributor consent), different trust characteristics (a scraped listing is an unverified third-party claim), different failure modes (crawl loops, blocking, throttling), and different provenance needs (source URL, fetch time, HTTP status, content hash, crawler version). Merging the two would double IDA-3's threat surface and its legal surface at once.

**Boundary contract for the future stage:** scraped evidence uses `svc_<name>` actor refs and `actor_type='system'`; needs a new `capture_source` (`web_import`, trust_level 1–2) and source-URL provenance columns that this design does **not** add; must respect robots and per-domain rate policy; and must be treated as `SOFT_DUPLICATE` at most against community evidence — a scraped claim must never silently override or corroborate a human observation.

---

## 20. Implementation slices

| Slice | Objective | Files | Schema | Risk | Depends on |
|---|---|---|---|---|---|
| **IDA-3A** | Ingestion schema: `idauto_submissions`, `idauto_rate_limit_counters`, `media.derived_from_media_id` | `database/schema.sql` + migration | **Yes** (2 tables, 1 column) | HIGH_RISK (live DB) | this gate |
| **IDA-3B** | Pure ingestion service: validation, EXIF strip, magic-byte check, dedup classification, trust routing. No endpoint. | `reference/ingest.js` (new) | No | STANDARD | 3A |
| **IDA-3C** | Rate limiting: counter store + enforcement helper | `reference/rate-limit.js` (new) | uses 3A | STANDARD | 3A |
| **IDA-3D** | Private admin-only ingest route, not publicly routed | `reference/api.js`, `writes.js` | No | HIGH_RISK | 3B, 3C |
| **IDA-3E** | Admin review enhancements: trust, conflicts, per-item accept/reject, block | `reference/review-ui.js`, `api.js` | No | STANDARD | 3D |
| **IDA-3F** | **Off-host backup** + restore test | `ops/media-ops.js`, runbook | No | HIGH_RISK | 3D |
| **IDA-3G** | Consent flow + legal review sign-off + privacy defaults | docs, config | No | HIGH_RISK | 3F |
| **IDA-3H** | Authenticated pilot | `api.js`, identity adapter | No | HIGH_RISK | **real auth**, 3F, 3G |
| **IDA-3I** | Public gate: versioned route, anonymous tier, monitoring | `api.js`, ops | No | HIGH_RISK | 3H |

Each slice requires its own explicit authorisation. IDA-3A is the only one touching the live schema.

---

## 21. Test strategy

| Area | Type |
|---|---|
| Schema shape, constraints, defaults | static + live DB |
| Validation, plate format, size/MIME/magic bytes | unit + negative |
| EXIF stripping (metadata gone, pixels intact, hash matches stored bytes) | unit |
| Identity/actor mapping, anonymous → NULL `actor_ref` | unit + integration |
| Client cannot supply `actor_ref`/`capture_source_id`/trust | **negative, mandatory** |
| Provenance completeness on every created row | integration, live DB |
| Audit written in the same transaction; rollback leaves no observation | integration, live DB |
| Rate limiting: under/at/over limit, window rollover, dual IP+user buckets | integration + concurrency |
| Idempotency: replay returns original, concurrent same-key races | concurrency, live DB |
| Media: dedup reuse, shared-object safety, quota enforcement | integration + filesystem |
| Privacy: no `mythos_private`, no reporter identity, no object path in responses | **negative, mandatory** |
| Dedup classification: hard/soft/related/conflict, independent reporters not merged | unit + integration |
| Review routing per trust tier | integration |
| Malformed/hostile requests, path traversal attempts, crafted JSON | negative |
| Disk-full | **simulate with a quota'd temp dir only** — never fill the real disk |
| Persistent-DB reruns (fixtures accumulate) | live DB, per-run-unique fixtures |

All live-DB suites follow `ops/runbooks/TEST_RUNBOOK.md`; DEVX-1 already selects the right ID Auto suites automatically for these paths.

---

## 22. Decision gates

| Gate | Decision | Rationale |
|---|---|---|
| **IDENTITY_READY** | **YES (contract) / NO (runtime)** | The canonical contract is ratified and implemented as a draft schema + module. `mythos_core` is **not deployed** and real auth is **BLOCKED**. Sufficient for admin and anonymous tiers; **not** for authenticated tiers. |
| **STORAGE_READY** | **YES** | Content-addressed store audited CLEAN; backup, verify, and restore tooling implemented and restore-tested (`IDAUTO-STORAGE-OPS`). |
| **OFFHOST_REQUIRED_BEFORE_PUBLIC** | **YES** | Both backups are same-host. Required before any real, non-regenerable evidence — i.e. before IDA-3H, not before the admin-only pilot. |
| **RATE_LIMIT_STAGE** | **BEFORE_ENDPOINT** | Binding roadmap decision; enforcement is IDA-3C, before any reachable route. |
| **REAL_AUTH_REQUIRED_FOR_PRIVATE_PILOT** | **NO** | IDA-3D is admin-only behind the existing operator token and is not publicly routed — the same gate every current write route uses. |
| **REAL_AUTH_REQUIRED_FOR_PUBLIC** | **YES** | Anonymous tier needs no auth, but the authenticated/contributor tiers are meaningless without it, and trust routing depends on a real identity. IDA-2E remains BLOCKED. |
| **PUBLIC_ENDPOINT_READY_TO_IMPLEMENT** | **NO** | Blocked on IDA-3A–3C (not built), off-host backup, legal/consent review, and real auth. |
| **FIRECRAWL_STAGE** | **LATER** | Separate `IDA-4-WEB-INGESTION`; different actor, legal basis, and threat model. |

---

## 23. Blockers and next authorised stage

**Blockers to public ingestion (all must clear):**
1. IDA-3A–3C not implemented.
2. Off-host backup absent (§11).
3. `LEGAL-REVIEW-REQUIRED` on `PUBLIC_UPLOAD` — needs qualified human legal review; this document makes no legal determination.
4. Real Mythos auth (IDA-2E) BLOCKED — gates authenticated tiers only.

**Next authorised stage: `IDA-3A` — ingestion schema only.** Two tables and one nullable column, applied to the live database with a fresh verified `pg_dump` taken immediately before, following the IDA-2B provisioning pattern. It changes no runtime behaviour and unblocks 3B and 3C.

**Not authorised by this gate:** any endpoint, any public exposure, any deployment, real auth, web ingestion, image decoding, or derivative generation.
