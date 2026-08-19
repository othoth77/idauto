# IDA-4 Option C — Implementation Report

Date: 2026-08-19
Branch: `ida4-option-c` (base: `main` @ `0044d57`)
Authority: A5 OWNER DECISION, 2026-08-19 — "APPROVE OPTION C. Proceed with the zero-account
IDA-4 public passport surface: IVID issuance, passport assembly, IVID-only QR resolution,
never resolve by plate, no citizen PII, credential is never the vehicle/person identifier,
apply the approved rate limiting and threat-model controls."

**FINAL STATUS: IMPLEMENTATION COMPLETE**

"Complete" means: the approved Option C surface is implemented, tested, and
mutation-verified on this branch. It does NOT mean production ready, deployed, or
publicly activated — see §15 and §16.

---

## 1. Scope

Implemented exactly the owner-approved Option C surface and nothing beyond it:

- Permanent IVID issuance for vehicles (`idauto_vehicles.ivid`).
- One public, unauthenticated route: `GET /public/passport/:ivid` — IVID-only resolution
  to a public-scope Digital Vehicle Passport.
- The threat-model controls attached to that route (format gate before any database
  touch, per-IP rate limiting on a dedicated bucket, identical 404s, no plate path).

Explicitly NOT implemented, per the owner's binding prohibitions: Option B / Magic Link,
any citizen person store, any citizen PII collection, any citizen authentication,
sessions, or recovery flows, any plate-based public resolution.

## 2. Files

Added:
- `database/migrations/ida4-option-c-ivid.sql` — the only schema change.
- `reference/ivid-issuance.js` — the only writer of `idauto_vehicles.ivid`.
- `reference/public-surface-policy.js` — A5-PLATE REVISED RULING (2026-08-19): the one
  reviewed public-surface-policy artifact the owner's ruling requires. Declares the
  PUBLIC-phase fact-key deny-list (`vin`, `plate_number`) as data, NOT config-toggleable —
  changing the policy means changing this one file.
- `tests/ida4-option-c-test.js` — live-database suite (exact count in §11 — not restated
  here as a fixed number, since it grows with each fix).
- `docs/IDA4_OPTION_C_IMPLEMENTATION_REPORT.md` — this report.

Modified:
- `reference/api.js` — the public route and its control chain; NEW authenticated route
  `GET /api/passport/:ivid` (the A5-PLATE PRIVATE-phase internal surface — see §3/§6).
- `reference/writes.js` — `createVehicle()` now issues an ivid inside its own transaction
  (F2).
- `reference/rate-limit.js` — new exported `enforcePublicResolution()` /
  `floorPublicResolutionWindow()` (the public-resolution bucket lives in the
  rate-limiting module, not in `api.js`).
- `config/idauto.example.json` — new `public_resolution` section (limit 30 / 60 s,
  `enabled` — now the A5-PLATE PRIVATE/PUBLIC phase gate, see §8).
- `tests/ida-3d-private-ingest-route-test.js` — structural guards narrowed/extended (see
  §11).
- `docs/IDA4_READINESS_AUDIT.md` (A5 → DECIDED, owner text excerpted; A5-PLATE → DECIDED,
  revised ruling quoted in full; new §J), `docs/THREAT_MODEL.md` (§5 QR-resolution
  controls marked IMPLEMENTED; plate-exclusion note updated to RULED), `docs/ROADMAP.md`,
  `docs/AI_HANDOVER.md`, `CHANGELOG.md`.

## 3. Routes

- `GET /public/passport/:ivid` — the repository's only unauthenticated
  route, dispatched before `requireAuth()` deliberately and commented as such
  (A5 OPTION C, 2026-08-19). Any other path under `/public/` → 404. Non-GET on the
  matched path → 405. This is the PUBLIC-phase surface under the A5-PLATE ruling.
- `GET /api/passport/:ivid` — NEW (A5-PLATE REVISED RULING, 2026-08-19): the
  authenticated PRIVATE-phase internal passport surface, in the ordinary `ROUTES`
  table, behind `requireAuth()` exactly like every other route below it. IVID-only
  lookup (no new plate-resolution path — internal plate lookup already existed at
  `GET /api/plates/:plate_number` and is unchanged). **Assembles at scope
  `'professional'`, WITH `mythos_private`-scope facts excluded in SQL as a second
  layer** (corrected post-Opus-review, P1 — an earlier cut of this route wrongly
  assembled at `mythos_private`; see §14), INCLUDING the vehicle's plate records
  regardless of fact scope (`idauto_plates.vehicle_id`, a direct FK — the same join
  `getPlate()` already uses, joined here through the resolved vehicle's id instead of
  a plate number — plates are not Facts and are unaffected by this correction). This
  is where the ruling's PRIVATE-phase plate display is implemented. Both the vehicle
  and plate objects are protocol-conformant (P2; see §6, `vehicle.schema.json` and
  `plate.schema.json`), built by shared helper functions the public route also uses,
  not raw DB rows.

  **`plate.schema.json` mapping** (`additionalProperties:false`; `buildProtocolConformantPlate()`):

  | Schema field | Source | Note |
  |---|---|---|
  | `protocol_version` | constant `'0.1.0-draft'` | |
  | `id` | `idauto_plates.id`, stringified | schema requires a string, not the raw numeric DB id |
  | `subject_ivid` | the already-resolved vehicle's `ivid` | every plate belongs to the vehicle this route resolved |
  | `plate_number`, `plate_raw`, `format_code` | direct passthrough | same names in DB and schema |
  | `region_code` | `idauto_governorates.code` (e.g. `"01"`) | **interpretive choice**, flagged for review: the schema names no "governorate" field; `region_code`'s own description — "Coarse region only. Never a precise location" — is exactly what a Tunisian governorate is, so the governorate CODE (not its French name) is mapped here |
  | `valid_from` | `idauto_plates.valid_from`, falling back to the plate's own `created_at` if null | schema-required; the DB column is nullable, so a null is never emitted for a required field |
  | `valid_to` | `idauto_plates.valid_until`, renamed | null while the interval is open, matching the schema's own description |
  | *(dropped)* `governorate_name`, `status` | — | no corresponding schema field exists for either; per the review finding's own instruction, dropped rather than force-mapped |
- Every pre-existing route (the entire `ROUTES` table, `/health` included) remains
  behind `requireAuth()` exactly as before — test-asserted (§10 of the suite).

## 4. Database changes

One additive, idempotent migration:
`ALTER TABLE idauto_vehicles ADD COLUMN IF NOT EXISTS ivid VARCHAR(40) UNIQUE;`
No new table. No person/citizen table. No PII column. Applied to the live database;
all 86 pre-existing vehicles were issued permanent IVIDs via `issueMissing()` — the one
intentional mutation of operational data this stage makes (plus an audit row per
issuance, `actor_type='system'`). Table count unchanged at 24.

## 5. IVID model

Format (from `reference/ivid.js`, unchanged): `ivid:1:<16-symbol Crockford base32
payload (80 bits, I/L/O/U excluded)>:<2-symbol check>`; check = Σ value(payload[i])×(i+1)
mod 1024 → two 5-bit symbols. Issuance (`reference/ivid-issuance.js`):

- PERMANENT — never overwritten; enforced twice: in module logic AND at the SQL layer
  (`UPDATE ... WHERE id = $2 AND ivid IS NULL`), so even racing callers cannot
  overwrite; the loser re-reads and returns the winner's value.
- UNIQUE-collision handled by bounded regeneration (5 attempts; 80-bit entropy makes
  even one retry unexpected).
- Audit row per real issuance, `actor_type='system'`, same shape as every other write's —
  EXCEPT when the caller passes `{ skipAudit: true }` (used exactly once: see the wiring
  note immediately below), in which case the issuance is instead captured inside the
  caller's own single audit row.
- **Wired into production (Opus review F2, fixed on this branch):** `reference/writes.js`'s
  `createVehicle()` calls `issueForVehicle()` inside the SAME transaction as the vehicle
  `INSERT`, so every vehicle created through the authenticated `POST /api/vehicles` path
  gets a permanent ivid immediately, in the create response — not only via the out-of-band
  `issueMissing()` backfill this stage's own live-DB test run performed. (Before this fix,
  nothing in production ever called `reference/ivid-issuance.js` at all — see §14 for the
  pool-mode-atomicity nuance this wiring resolves for the write path specifically.)
- The credential is never the vehicle/person identifier: `internal_ref` remains the
  internal identity; the IVID is a public resolution credential only.

## 6. Public resolution

Ordered control chain in `handlePublicPassportRoute()` (order is itself a security
requirement):

1. Path gate (`/^\/public\/passport\/([^/]+)$/` only) → 404 otherwise; method gate → 405.
2. FORMAT GATE BEFORE ANY DATABASE TOUCH — `ivid.validate()`; malformed (or
   undecodable) → 404 with the identical shape a well-formed-but-unknown IVID gets;
   spy-asserted zero `db.query` calls.
2.5. PHASE GATE (A5-PLATE REVISED RULING, 2026-08-19) — before the format gate even
   resolves, `config/idauto.example.json`'s `public_resolution.enabled` is checked
   (`loadPublicResolutionConfig().enabled`): `false` = PRIVATE phase, this whole route
   returns the identical 404 shape for every method, before any database touch, no
   exception. `true` = PUBLIC phase, proceed with the deny-list applied (below).
3. Per-IP rate limit — `rateLimit.enforcePublicResolution()`, dedicated dimension
   `public_resolution:window`; exceeded → 429 + `Retry-After`.
4. The query string is never parsed — `?plate=` is inert by construction.
5. Lookup `WHERE ivid = $1` only. Scope HARDCODED `'public'` in the
   `assemblePassport()` call; the facts SQL additionally filters
   `access_scope = 'public'` AND excludes `reference/public-surface-policy.js`'s
   deny-listed fact_keys (`vin`, `plate_number`) as defense-in-depth — the deny-list is
   the one reviewed policy artifact, deliberately NOT a local constant in `api.js` and
   NOT config-toggleable, per the A5-PLATE ruling's "controlled by an explicit
   public-surface policy, not by manual code edits."
6. `qr.payload === ivid` asserted at the route boundary (the assembler also enforces it).
7. Existing CSP/security-header set; `Cache-Control: no-store`.

The response's `vehicle` object is protocol-conformant
(`protocol/schemas/vehicle.schema.json`): exactly
`{protocol_version, ivid, status, created_at, observation_count, summary}` with
`summary` = the schema's full allowed set of public-safe descriptive fields.
`status` is a direct passthrough of `fiche_status`, whose CHECK constraint is an exact
subset of the protocol enum. `internal_ref` and non-public columns (`seats`,
`gross_weight_kg`, `engine_cc`, `fiche_status` as a raw key) are excluded from the
SELECT itself. `current_plate_ref` is omitted on the public surface (A5: no plate).
Built by `buildProtocolConformantVehicle()`, shared with (not duplicated by) the
private route (§3) — one function, both routes stay conformant by construction (P2).

## 7. Privacy (zero citizen PII)

- No person/citizen/account table exists or was created — live-DB guard asserts no
  table matching `/person|citizen|account|user|identity|holder/i` beyond the
  pre-existing, documented `idauto_user_roles` (opaque `mythos_user_id` keys,
  schema-commented `[NO PII]`).
- No migration file CREATEs any person-shaped table — guard scans the migrations
  directory.
- The public response body contains no PII-shaped substrings (email, phone, address,
  national_id, cin, owner_name, holder) — guard-asserted with non-vacuity preconditions.
- No Magic Link, no citizen auth, no sessions, no cookies, no recovery flows — the
  IDA-3D structural guards (no JWT/OAuth/session/cookie) still pass unchanged.

## 8. Rate limiting

Implemented in `reference/rate-limit.js` (`enforcePublicResolution()`), reusing the
IDA-3C `bucketKey()`/atomic-UPSERT primitives with a dimension
(`public_resolution:window`) used by no other route, so public-resolution counters can
never collide with ingestion buckets despite sharing `idauto_rate_limit_counters`.
Config: `config/idauto.example.json` → `public_resolution.rate_limit`
(limit 30 / window 60 s; safe defaults if absent — the route never silently runs
unlimited). Evidence is behavioral, not documentation: the suite's §7 proves burst →
429 with `Retry-After` ≥ 1 s, then recovery after the window, over real HTTP against
the live database in an isolated child process.

**A5-PLATE phase gate (2026-08-19).** The same config section's `enabled` flag — until
now a documented kill-switch with no policy meaning beyond "on/off" — is the owner
ruling's required "tested configuration/policy gate" for the PRIVATE→PUBLIC transition:
`false` = PRIVATE phase (the anonymous `GET /public/passport/:ivid` surface is off
entirely; the authenticated `GET /api/passport/:ivid` surface is the only passport
resolution reachable, and per the ruling it may show `plate_number`); `true` = PUBLIC
phase (the anonymous surface is on, with `reference/public-surface-policy.js`'s
deny-list always applied). The gate itself is config (an operational switch); the
deny-list it does not affect is an owner ruling in reviewed code — the two are
deliberately not the same mechanism, so a config edit can never relax what the owner
decided. The suite's §11 proves both halves from the identical config state in one
child process: the anonymous route 404s with zero DB queries while the authenticated
private route simultaneously returns 200 with `plate_number` present.

## 9. Threat-model controls

All four controls the THREAT_MODEL §5 QR-resolution row required are implemented and
test-asserted: format-gate-before-DB (spy: zero queries), dedicated rate limiting
(429/recovery), identical 404s (malformed vs unknown vs plate-shaped — same
`{"error":"not found"}` shape), no plate path (path, route, and query-string forms all
covered). Enumeration resistance rests on 80-bit IVID entropy AND the rate limit —
independent layers, per the threat model's own requirement.

## 10. Authentication boundary

`requireAuth()` is untouched. The public dispatch branch handles `/public/` paths
before auth and NEVER falls through to the `ROUTES` table; everything else still hits
`requireAuth()` first. Suite §8 proves `/api/vehicles/:ref` and `/health` still 401
without credentials; §9 proves the public route succeeds with zero `Authorization`
header. Mutation 5 (auth removal) fails the suite.

## 11. Tests

`tests/ida4-option-c-test.js`: **133 passed / 0 failed** when `issueMissing()` (§2/F5) takes
its normal branch, **128 passed / 0 failed** when it takes its safe-skip branch instead
(5 fewer assertions in that branch — see §2/F5's own note; NEITHER count is invariant —
which branch runs depends on whether any OTHER suite's own direct-SQL fixture vehicles
happen to be sitting in the live database ivid-less at the moment this suite runs). Run
twice consecutively at this commit, both green (128/0, 128/0 — the skip branch, since
`ida-3b`/`ida-3e`'s own fixtures were present in the database at the time); a separate
run immediately after manually backfilling those strays confirmed the non-skip count is
genuinely 133/0. Live database, fixtures marked `IDA4OPTIONC-TEST-%` and cleaned up (zero
leftovers verified, including the linked-plate fixture).

Full repository pass (all 16 suites, run by the Chef directly at this commit, not taken
on trust — corrected here after the report's own prior full-green claim was found false
at `7bc4ff9`, see the regressions paragraph below):

| Suite | Result |
|---|---|
| ida-2a schema+plate validation | 44/0 |
| ida-2c read-only API | 26/0 |
| ida-2d write API + audit | 39/0 |
| ida-2f object storage | 32/0 |
| ida-2g admin manual entry UI | 17/0 |
| ida-2h review queue UI | 37/0 |
| ida-3a ingestion schema | 47/0 |
| ida-3b ingestion service | 67/0 |
| ida-3c rate limiting | 63/0 |
| ida-3d private ingest route | 74/0 (F9 added one assertion post-Opus-review) |
| ida-3e review queue | 48/0 |
| ida-3f offhost backup (mythos-side suite) | 35/0 |
| idauto-storage-ops | 73/0 |
| identity-conformance | 81/0 |
| ida4-foundation (env-free) | 130/0 |
| ida4-option-c | 128/0 (safe-skip branch this run) or 133/0 (normal branch) — see above, both verified at this commit |

Two regressions were found and fixed. **Phase 2:** `ida-3d`'s structural guard ("api.js
contains no rate-limit or counter implementation") tripped on the first implementation,
which hosted bucket logic in `api.js`. Classified OPTION-C REGRESSION (0 matches for the
guard tokens on baseline `0044d57`). Resolution preserved the guard's teeth: the limiter
moved into `reference/rate-limit.js`; only the require-prohibition was narrowed (commit
`1d50368`), with the counter-machinery prohibitions intact — and still mutation-enforced.
**This commit's immediate predecessor (`7bc4ff9`):** new prose comments (added to explain
P1/P2's own fixes) tripped TWO structural guards that scan `api.js`'s source text for
specific substrings — `ida-2c`'s `/DROP\s+/i` write-verb scan (25/1: one comment's "…
instruction to drop\n    fields…" line-wrapped into a false match) and `ida-3e`'s
`/public[^\n]*review|anonymous[^\n]*review/i` scan (47/1: two separate comments each
paired "public"/"anonymous" with "review" on one line). Neither guard was touched — both
were rewritten to describe the same facts without the trigger substrings ("the one
audited artifact", "P2/Opus audit", "instruction to omit"). **This report's own prior
claim of a full 16/16 green pass at `7bc4ff9` was therefore false** — the table above is
the corrected, actually re-run count at the current commit. **Standing rule, going
forward: any commit that touches a COMMENT in `reference/api.js` — not only its code —
must re-run `ida-2c`, `ida-3d`, and `ida-3e` before claiming green.** All three contain
prose-scanning structural guards (`DROP`, `anonymous...route`, `public...review`
respectively) that a purely explanatory comment can trip with zero functional change,
and none of the other thirteen suites scan `api.js`'s comment text this way.

## 12. Mutation testing

Eight mutations, each applied to the working tree, run against the suite, and restored
byte-identically (sha256-verified). All eight fail the suite; every kill is by the
assertion that guards that specific property:

| # | Mutation | Killed by |
|---|---|---|
| 1 | Plate-resolution route added under /public/ | "/public/plate/... does not exist as a route" |
| 2 | IVID format gate bypassed | zero-DB-query spy (2 assertions) |
| 3 | Rate limiter bypassed (`{allowed:true}`) | "third request returns 429" + Retry-After |
| 4 | SQL `access_scope` filter removed | structural pin on the facts query (see note) |
| 5 | `requireAuth` made a pass-through | admin 401 assertions (2) |
| 6 | PII field (`owner_email`) added to public body | exact-key-set + no-email-substring |
| 7 | Person store introduced (live table AND migration file) | both §10 prohibition guards |
| 8 | DB lookup moved before format validation | zero-DB-query spy |

Note on 4: this mutation initially SURVIVED — `assemblePassport()`'s primary scope
filter fully masks the SQL layer, which is precisely what defense-in-depth predicts.
The layer was then pinned with a structural assertion (commit `1bfdd9c`) and the
mutation now fails. The episode is documented rather than hidden because it shows the
behavioral tests cannot see the SQL layer while the primary control holds.

## 13. Commits

All on `ida4-option-c`, base `0044d57` (= `origin/main`):

1. `e220213` feat(ida4): Option C — IVID issuance and the IVID-only public passport surface
2. `c003029` fix(ida4): public passport vehicle object — protocol-conformant, no internal_ref, no non-public columns
3. `1d50368` fix(ida4): relocate the public-resolution limiter into reference/rate-limit.js; narrow the IDA-3D structural guard accordingly
4. `93f662b` test(ida4): A5 prohibition guards — no person store, no citizen-PII surface
5. `1bfdd9c` test(ida4): pin the SQL access_scope defense-in-depth layer; isolate the burst test's rate-limit window
6. `74fc3d3` docs(ida4): Option C implementation report — IMPLEMENTATION COMPLETE, deployment not authorized
7. `421bb08` fix(ida4): Opus review follow-up — deny-list, issuance wiring, kill-switch, error hygiene
8. `9480b16` docs(ida4): Opus review follow-up — doc corrections, F1/F10/F11a, report update
9. `4ffa446` docs+fix(ida4): register the plate-exposure owner question in the decision register; deny-list empty guard; minor review notes
10. `79fb471` docs(ida4): record Opus APPROVE and Haiku ACCEPT-WITH-FINDINGS verdicts; close the Option C stage entry
11. `b80b00d` feat(ida4): A5-PLATE revised ruling — public-surface policy module, private passport surface, tested phase gate
12. `7bc4ff9` fix(ida4): private passport surface — professional scope with restricted-fact exclusion, protocol-conformant vehicle and plate objects
13. (this commit) fix(ida4): reword prose that tripped ida-2c/ida-3e structural guards; pin the private-route scope layers; correct the report's suite table

`c003029` fixes three Chef-audit findings in the first implementation (public exposure
of `internal_ref`; non-public columns passing through at the column level; protocol
non-conformance of the vehicle object) — found by empirical inspection of a live
response, fixed, and re-verified empirically.

Commits 7–8 (Opus architecture review, APPROVE-WITH-FINDINGS) fix eleven findings, split
code/tests (7) from documentation (8): a fact-key deny-list (F4, `vin` + interim
`plate_number`) independent of stored `access_scope`; issuance wired into the authenticated
vehicle-creation write path (F2); the `public_resolution.enabled` kill-switch, previously
read by nothing (F3); the live suite no longer mutates non-fixture rows without an explicit
guard (F5); an anonymous-caller error-message echo and a missing `headersSent` guard, fixed
(F7); a restored ingestion-limiter structural guard in `tests/ida-3d...` (F9);
`docs/THREAT_MODEL.md`'s orphaned table row, reattached (F10); the A5 quote relabelled from
"verbatim" to "excerpted" everywhere it appears, not just where first flagged (F11a);
corrections in `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, `docs/IDA4_READINESS_AUDIT.md` §J,
and `CHANGELOG.md` — stale assertion counts (reworded to avoid a hardcoded figure where the
doc doesn't need one) and a stale, since-relocated function name (F1); and two new,
documented limitations plus one documentation fix in §14 below (F6/F8). Test suite grew
from 86 to 104 (99 in the safe-skip case — not a fixed count either way, see above);
`tests/ida4-option-c-test.js` was run twice consecutively,
both green.

Commits 9–10 registered and then closed the open A5-PLATE owner question in the decision
register and recorded both independent review verdicts (Opus **APPROVE**, Haiku
**ACCEPT-WITH-FINDINGS** — `docs/IDA4_OPTION_C_REVIEW_VERDICTS.md`). Commit 11 implements
the owner's subsequent REVISED A5-PLATE ruling (§17): the `reference/public-surface-policy.js`
policy module, the authenticated `GET /api/passport/:ivid` private surface, and the
`public_resolution.enabled` phase gate — see §2/§3/§6/§8/§17 above. Test suite grew from
104 to 118 assertions, run twice consecutively, both green; ida-3d, ida-2d,
ida4-foundation, and identity-conformance all re-verified unchanged or expected-changed
(ida-3d 74/0, unchanged from commit 8's count — one new false-positive self-trip from this
commit's own prose was caught and rephrased before commit, not left for a reviewer to
find). **This commit's work is PENDING RE-REVIEW** — it postdates both verdicts above.

Commit 12 fixes two technical defects Opus found reviewing commit 11: P1 — the private
route's earlier scope-`mythos_private`/no-filter cut and its miscited justification (§14);
P2 — its non-protocol-conformant vehicle and plate objects (§14, same defect class
`c003029` already fixed once for the public route). Also P3 — one stale test-assertion
label ("owner decision pending" → "per the A5-PLATE ruling"). Test suite grew from 118 to
128 assertions (professional-vs-restricted fact assertions, exact vehicle/plate key-set
assertions), run twice consecutively, both green; ida-3d, ida-2d, ida4-foundation,
identity-conformance all re-verified unchanged. This commit's work is also PENDING
RE-REVIEW.

Commit 13 fixes the two prose-tripped structural-guard regressions Opus found in commit
12 (`ida-2c` 25/1, `ida-3e` 47/1 — see §11's own account) by rewording three comments
(Q1, Q2), never by touching either guard. It also pins the private route's two scope
layers structurally (Q4, mirroring commit 5's public-route pin) and adds a value-level
drift guard proving the two `buildProtocolConformantVehicle()` call sites produce
identical values for the same vehicle, not just the same key set (Q5); parameterizes
`'mythos_private'` in the private facts query to match this file's own binding
convention (Q6); and corrects this report's own §11 table, which had claimed a false
16/16 green pass at `7bc4ff9`. Test suite grew from 128 to 133 assertions in the normal
branch (128 in the safe-skip branch — see §11). All 16 suites re-run and verified green
at this commit (§11's table). This commit's work is also PENDING RE-REVIEW.

## 14. Known limitations

- **Private-surface scope, corrected (Opus review P1, 2026-08-19):** the first cut of
  `GET /api/passport/:ivid` assembled at scope `'mythos_private'` with no `access_scope`
  filter in SQL at all, serving restricted facts (including `vin`) to any authenticated
  caller. This violated this file's own stated invariant (its header: every GET response
  excludes `mythos_private` because no audit-on-read path exists) and
  `docs/PRIVACY_ARCHITECTURE.md` §3's requirement that every Restricted access be
  audit-logged — a requirement this route, like every other GET in this file, cannot
  satisfy. The justifying comment also miscited precedent (claimed `getReviewSubmission()`
  as support; the real, exact precedent is `getFactsForVehicle()`'s
  `access_scope != 'mythos_private'`). Corrected: the route now assembles at scope
  `'professional'` with `mythos_private` excluded in SQL — the public route's own
  two-layer pattern, mirrored rather than reinvented. The A5-PLATE ruling never needed
  restricted facts: plates live in `idauto_plates`, entirely independent of a fact's
  `access_scope`, so plate display is unaffected by this correction.
- **Private-surface protocol conformance, corrected (Opus review P2, 2026-08-19):** the
  same first cut returned the raw `idauto_vehicles` row (leaking `internal_ref`, `seats`,
  `gross_weight_kg`, `engine_cc`) and raw `idauto_plates` rows (`governorate_name`,
  `status`, `valid_until` — none of which exist in `plate.schema.json`, which is
  `additionalProperties:false` like `vehicle.schema.json`) — the exact defect class
  `c003029` had already fixed for the public route, leaving the branch internally
  inconsistent for one commit. Corrected: both routes now share one vehicle-building
  function (`buildProtocolConformantVehicle()`) and the private route additionally uses a
  new `buildProtocolConformantPlate()` — see §3/§6 for the exact field mapping, including
  the interpretive choice of mapping `idauto_governorates.code` to the schema's
  `region_code` (flagged there for a reviewer's eyes, since the schema does not name
  "governorate" anywhere).
- The passport's `credentials` slot remains the untyped `{}` placeholder in
  `passport.schema.json` (pre-existing, documented; typed in IDA-7).
- `enforcePublicResolution()` uses fixed-window counting (matching IDA-3C's design):
  a burst straddling a window boundary can briefly see up to 2× the limit. Accepted
  for this stage; noted for pre-deployment review.
- The per-IP key hashes `req.socket.remoteAddress` directly; behind a reverse proxy
  every caller shares one IP. Deployment topology is a deployment-gate concern
  (deployment is not authorized), flagged for that review.
- IVID issuance audit rows use the shared audit-log shape; no dedicated issuance
  ledger. Acceptable at current volume.
- `status` passthrough assumes `chk_vehicle_status` remains a subset of the protocol
  enum; the conformance suite guards the schema side.
- **Pool-mode issuance atomicity (Opus review F6/F8, flagged, not fully closed):**
  `issueForVehicle()`/`issueMissing()` called with the plain pool object (`reference/db.js`'s
  `db`) — e.g. this stage's own live-DB backfill and this suite's direct
  `issueForVehicle(db, ...)` test calls — write the `ivid` `UPDATE` and its own audit-log
  `INSERT` as two SEPARATE, non-atomic statements, weaker than `reference/writes.js`'s
  `withAudit()` standard (one `BEGIN`/`COMMIT` wrapping both). **Mitigated for the one call
  path that matters for live traffic:** `createVehicle()`'s new wiring (F2, §5 above) calls
  `issueForVehicle()` with the SAME transaction client the vehicle `INSERT` uses, so
  issuance IS atomic with creation for every vehicle created through the authenticated API.
  The non-atomic pattern remains for maintenance/backfill-style pool-mode calls, which is
  accepted as a deliberate scope boundary of this fix, not a further defect.
- **`idauto_vehicles.ivid VARCHAR(40)` has zero headroom** for a future multi-digit IVID
  version or a maximum-length payload: today's v1 format (`ivid:1:<16-symbol
  payload>:<2-symbol check>`) is 26 characters, but `protocol/schemas/vehicle.schema.json`'s
  `ivid` pattern permits payloads up to 30 symbols — a maximum-length v1 IVID is exactly 40
  characters (fits, zero slack), and any version number beyond a single digit (`ivid:10:...`)
  would not fit at all. Flagged for whoever plans the IDA-7 protocol alignment or any future
  higher-entropy issuance; not a defect in what exists today (v1 issuance is fixed at exactly
  16 payload symbols, `reference/ivid.js`'s `V1_PAYLOAD_SYMBOLS`).
- **`issueMissing()`'s `already_had` field (Opus review F6/F8, documented rather than
  changed):** hardcoded `false` for every row it processes, since every row it selects had
  `ivid IS NULL` at SELECT time by definition. Under a race, a concurrent caller could set
  that exact vehicle's `ivid` between this function's `SELECT` and its own call to
  `issueForVehicle()`, which would then correctly return the OTHER caller's value while this
  field still reports `false` — a narrow, now-documented imprecision in a diagnostic field
  only (see `reference/ivid-issuance.js`'s own comment on `issueMissing()`); it never affects
  the correctness of issuance itself, since `issueForVehicle()` never overwrites regardless
  of what this field claims. Changing the field's contract (e.g. to a real boolean derived
  from the actual outcome) was assessed and deliberately NOT done, because every existing
  caller of `issueForVehicle()` — including this stage's own already-passing, already-
  mutation-verified tests — depends on it returning the bare ivid string, and widening that
  return shape would ripple beyond this fix's scope for a diagnostic-only field.

## 15. Legal status

UNCHANGED by this branch. L01–L16 remain OPEN, 0 APPROVED
(`docs/IDA4_LEGAL_GATE_MATRIX.md`). Option C was chosen specifically to avoid the
citizen-surface legal triggers (no PII, no accounts), but implementation existence is
not legal evidence and closes no legal gate. B1/B2/B3 remain OWNER-BLOCKED.

## 16. Deployment status

NOT DEPLOYED. NOT AUTHORIZED FOR DEPLOYMENT. No public production activation occurred
or is implied. `CITIZEN_FACING_IDA4_READY` = NO and `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT`
= NO, both unchanged (`docs/IDA4_READINESS_AUDIT.md` §I/§J). Per the owner's decision,
production/public deployment additionally requires the Opus architecture review and
Haiku independent audit of this implementation, and the documented security/readiness
conditions — none of which this report satisfies by itself.

## 17. Open owner items

Standing register of owner decisions this branch surfaced or received, with each item's
current state — findable here, not only in code comments, `docs/THREAT_MODEL.md`, a
CHANGELOG entry, or a test. Named row in the actual decision register:
`docs/IDA4_READINESS_AUDIT.md` (§I, the **A5-PLATE** row, and §J).

- **A5-PLATE — RULED, 2026-08-19 (was OPEN, registered by Opus review R1 the same day the
  revised ruling arrived).** May an anonymous public passport
  (`GET /public/passport/:ivid`) display a `plate_number` fact? **Answered: no, never, on
  the anonymous surface — but yes, on an authenticated internal surface.** Owner ruling,
  quoted in full in `docs/IDA4_READINESS_AUDIT.md`'s A5-PLATE row; FINAL RULE: "PRIVATE:
  plate_number = permitted. PUBLIC: plate_number = hidden. PUBLIC RESOLUTION: IVID only."
  **Implemented, this branch:** `reference/public-surface-policy.js` (the required
  reviewed policy artifact, not config-toggleable) carries the PUBLIC-phase deny-list;
  `reference/api.js`'s new `GET /api/passport/:ivid` is the authenticated PRIVATE-phase
  surface, plate included; `config/idauto.example.json`'s `public_resolution.enabled` is
  the tested PRIVATE/PUBLIC phase gate (`tests/ida4-option-c-test.js` §11 proves both
  phases from one config state, one child process). `plate_number` was not deleted from
  the database; no plate-based public lookup exists anywhere, including on the new
  private route; the A5 IVID-only public resolution decision is unchanged. This item is
  CLOSED — no further owner action needed on A5-PLATE itself, though the implementation
  remains subject to re-review before any deployment consideration.
