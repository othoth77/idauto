# IDA-4 Option C — Independent Review Verdicts

Date: 2026-08-19
Branch: `ida4-option-c` (base `main` @ `0044d57`)
Subject: the implementation described in `IDA4_OPTION_C_IMPLEMENTATION_REPORT.md`.

Both reviews below were run by models independent of the implementer (Sonnet) and of
each other, each running the test suites and its own mutations directly against the
branch and the live database. Neither review authorizes deployment: per the owner's A5
decision, production/public deployment additionally requires the documented
security/readiness conditions, the L01–L16 legal gates, and an owner ruling on A5-PLATE
(`IDA4_READINESS_AUDIT.md` §I).

---

## 1. Opus architecture/security review — FINAL VERDICT: **APPROVE**

Three passes were run.

**Pass 1 (at `74fc3d3`): APPROVE-WITH-FINDINGS.** 14 of 16 verification items PASS on
first review; item 13 (mutation claims) verified by Opus independently reproducing three
of the eight documented mutations byte-identically; item 14 (documentation accuracy)
FAILED on findings F1/F2. Findings raised: F1 stale assertion counts in four documents;
F2 issuance not wired into any production path (plus two false doc claims about it);
F3 dead `enabled` kill-switch; F4 no fact-key allowlist on the public surface — VIN half
classified TECHNICAL DEFECT, plate-exposure half classified **OWNER DECISION REQUIRED**
(A5 decided plate *resolution*, not plate *exposure*); F5 the test suite mutated live
operational rows unboundedly; F6–F11 notes (audit atomicity, headersSent/error echo,
VARCHAR(40) headroom, one guard tooth lost in the ida-3d narrowing, THREAT_MODEL table
structure, quote labelling).

**Pass 2 (at `9480b16`): APPROVE-WITH-FINDINGS.** All nine technical-defect findings
verified RESOLVED — several re-verified by fresh Opus mutations (kill-switch deletion,
deny-list neutralization, forced `skipAudit`). The `skipAudit` option was verified unable
to suppress an audit row outside the `createVehicle` transaction path. One residual
technical defect: R1 — the open plate-exposure owner question was not yet registered in
the decision register; plus notes R2–R5.

**Pass 3 (at `4ffa446`): APPROVE.** R1–R5 verified resolved; the R2 empty-deny-list
guard and the deny-list control re-verified by direct mutation (identical kill profile).
Opus stated explicitly that the open A5-PLATE question — correctly defaulted closed,
honestly labelled, and now formally registered — leaves no reason short of APPROVE:
"An open owner question that is correctly defaulted closed, honestly labelled, and
formally registered is not a defect in the implementation." No LEGAL findings in any
pass. Standing pre-deployment items (all recorded in the implementation report §14):
A5-PLATE owner ruling; fixed-window boundary doubling; `remoteAddress` behind a reverse
proxy; pool-mode issuance audit non-atomicity for backfill tooling; VARCHAR(40) zero
headroom.

Opus modified nothing in any pass (clean tree and HEAD hash verified after each;
mutated files sha256-restored).

## 2. Haiku independent audit — VERDICT: **ACCEPT-WITH-FINDINGS**

Audit items A–Q all PASS at `4ffa446`, run independently: live-server route inventory
(19 authenticated routes + exactly 1 unauthenticated); auth boundaries; six live
plate-resolution attempts (all 404); enumeration-resistance controls; rate limiting
(config, dimension isolation, 429/Retry-After, manual burst); invalid-input fuzzing
(NUL, traversal, SQL metacharacters, unicode, overlong — no 500s, no leakage);
DB-touch ordering; SQL parameterization and the two-layer scope filter with the
`['vin','plate_number']` deny-list; PII-leakage inspection of real passports; person-
store/Magic-Link/Option-B detection with guard non-vacuity; three mutations reproduced
and byte-identically restored; regression suites (ida4-option-c 104/0, ida-3d 74/0,
ida-2d 39/0, foundation 130/0 env-free, identity-conformance 81/0); ≥13 documentation
claims spot-checked true, both readiness flags verified NO and unchanged; git
cleanliness; commit provenance (linear 9 commits from `0044d57`); kill-switch; fixture
cleanup (zero leftover rows).

Findings: three, all INFORMATIONAL and all already documented in the implementation
report §14 (pool-mode issuance audit atomicity for backfill calls; fixed-window
boundary burst; per-IP hashing behind a reverse proxy). No CRITICAL, no HIGH. Haiku's
summary: technically sound, fully compliant with the A5 decision, **not** production
ready (readiness flags NO, deployment not authorized).

Haiku modified nothing (clean tree, HEAD unchanged, mutated files sha256-verified
restored).

---

## 3. Status after both reviews

- Implementation status: **IMPLEMENTATION COMPLETE** (per the implementation report §0),
  Opus **APPROVE**, Haiku **ACCEPT-WITH-FINDINGS** (informational only).
- Deployment: **NOT AUTHORIZED** — unchanged.
- `CITIZEN_FACING_IDA4_READY` = NO; `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` = NO — unchanged.
- Legal gates L01–L16: 16/16 OPEN, 0 APPROVED — untouched.
- Open owner item: **A5-PLATE** (`IDA4_READINESS_AUDIT.md` §I) — may an anonymous public
  passport display a `plate_number` fact? Interim default-closed (deny-listed) until the
  owner rules.

---

## 4. Revised A5-PLATE ruling round (2026-08-19, commits `b80b00d`..`59855be`)

The owner issued a revised A5-PLATE decision (FINAL RULE: PRIVATE plate permitted /
PUBLIC plate hidden / public resolution IVID-only, with an explicit public-surface
policy and a tested PRIVATE→PUBLIC configuration gate). Implementation: the
`reference/public-surface-policy.js` policy artifact (deny keys `vin`, `plate_number`
as a non-configurable floor), the authenticated `GET /api/passport/:ivid` private
surface (IVID-only lookup, professional scope with a parameterized
`access_scope != 'mythos_private'` SQL layer, protocol-conformant vehicle and plate
objects via shared builders), and the `public_resolution.enabled` phase gate.

**Opus (two passes): APPROVE-WITH-FINDINGS, findings fixed.** Pass 1 affirmed the
interpretation on all three design questions (non-configurable policy floor, phase
gate, IVID-only private lookup) and raised P1 (private route served restricted-scope
facts on a miscited precedent) and P2 (private passport not protocol-conformant) —
both fixed in `7bc4ff9` and re-verified by Opus mutation (each scope layer proven
independently sufficient). Pass 2 caught two prose-tripped structural-guard
regressions (`ida-2c` 25/1, `ida-3e` 47/1) and the report's consequent false
full-green claim — fixed in `59855be` by rewording comments (guards untouched, per
Opus's explicit instruction), adding windowed structural pins for both private-route
scope layers, and recording the standing rule that any commit touching
`reference/api.js` comments must re-run `ida-2c`, `ida-3d`, and `ida-3e`.

**Haiku (independent, owner-mandated five-point test): ACCEPT.** All five points
verified against a live server at `59855be`: (1) private mode → plate visible
(200 with `plate_number`; 401 without auth); (2) public mode → plate hidden (no
`plate_number`/`vin` anywhere in the anonymous body, same vehicle); (3) plate cannot
resolve publicly (every vector 404); (4) IVID resolution functional on both surfaces,
identical 404s, zero DB queries for malformed input; (5) no PII leakage on either
surface. Phase gate verified: disabled → anonymous surface 404 with zero DB queries
while the private surface still serves plate. Full suite 128/0 (documented safe-skip
branch); all 16 repository suites green at this commit. No findings above
informational.

Unchanged throughout: L01–L16 (16/16 OPEN), B1/B2/B3, `CITIZEN_FACING_IDA4_READY` =
NO, `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` = NO, deployment NOT authorized.
