# Migration Audit Report

**Audit date:** 2026-08-18
**Scope:** validation of the extraction of ID Auto from `othoth77/mythos-prod`
(`projects/idauto/`) into `othoth77/idauto`
**Origin baseline:** `5e2011b` on `othoth77/mythos-prod` `main`
**Result:** **PASS**, with the pre-existing blockers carried forward unchanged and one
functional defect found and fixed (§4).

Everything below was executed and observed. Nothing is inferred, and nothing is reported as
run that was not run.

---

## 1. Test execution

All 13 suites were run in the new repository layout against **PostgreSQL 16** with
`database/schema.sql`, `database/migrations/ida-3a-ingestion-schema.sql` and
`database/seed-synthetic-test-data.sql` applied. The DB-backed suites are live, not mocked.

| Suite | Assertions | Failures | Mode |
|---|---|---|---|
| `ida-2a-schema-and-plate-validation` | 44 | 0 | offline |
| `ida-2c-readonly-api` | 26 | 0 | live DB |
| `ida-2d-write-api-and-audit` | 39 | 0 | live DB |
| `ida-2f-object-storage` | 32 | 0 | live DB + filesystem |
| `ida-2g-admin-manual-entry-ui` | 17 | 0 | live DB |
| `ida-2h-review-queue-ui` | 37 | 0 | live DB |
| `ida-3a-ingestion-schema` | 47 | 0 | offline |
| `ida-3b-ingestion-service` | 67 | 0 | live DB + filesystem |
| `ida-3c-rate-limit` | 63 | 0 | live DB |
| `ida-3d-private-ingest-route` | 73 | 0 | live DB + HTTP |
| `ida-3e-review-queue` | 48 | 0 | live DB + HTTP |
| `ida-3f-offhost-backup` | 35 | 0 | offline, incl. AWS's published SigV4 vector |
| `idauto-storage-ops` | 73 | 0 | offline |
| **Total** | **601** | **0** | |

**Comparison with the origin baseline.** Every suite matches its last recorded count in the
origin repository except `idauto-storage-ops` (72 → 73), where the protected-path assertion
was replaced by a stronger pair (§4). No suite lost an assertion; no suite was skipped, and
no suite silently passed because its dependencies were absent — these suites fail loudly
with a `FATAL` naming every missing variable when the environment is incomplete.

**Also verified independently:** the three static-only modes still work
(`IDA3B_STATIC_ONLY=1` 37/37, `IDA3C_STATIC_ONLY=1` 37/37, `IDA3D_STATIC_ONLY=1` 45/45,
`IDA3E_STATIC_ONLY=1` 30/30), so the offline path a sandboxed environment relies on is
intact.

---

## 2. Database schema consistency

Applied to a clean PostgreSQL 16 database, no errors.

| Check | Result |
|---|---|
| Base tables created | **24** — matches the origin's live count |
| Tables outside the `idauto_` prefix | **0** |
| `access_scope` present on `idauto_observation_media`, `idauto_vehicle_facts` | **Both confirmed** (this is the IDA-2A-CORRECTION-0 rename, still in place) |
| `ida-3a` migration re-applied over the schema | **Idempotent** — every object reported "already exists, skipping"; the migration and the schema file agree |
| Synthetic seed applied | **Clean** |

### Owner-PII column scan

A column-name search across all 24 tables for `owner`, `first_name`, `last_name`, `surname`,
`address`, `phone`, `mobile`, `email`, `national_id`, `cin`, `passport_no`, `birth` and
`insurance_holder` returned three matches, each inspected:

| Column | Verdict |
|---|---|
| `idauto_document_scans.has_owner_pii` | **Control flag, not PII.** A boolean recording that OCR *found* owner PII on a document. The schema comment states "PII never stored in this table", and the adjacent `pii_handled` column tracks routing or discard |
| `idauto_organizations.address_city` | **Business address, not personal.** A city name for a garage/insurer/fleet entity |
| `idauto_organizations.contact_email` | **Organisational contact, not personal.** Commented as such in the schema |

**No owner-PII column exists on any vehicle, plate, observation, fact, evidence or movement
table.** The founding constraint holds, structurally, and the assertion is enforced by
`ida-2a`'s schema test on every run.

**No owner-PII column was introduced by this migration.** The schema is byte-identical to the
origin apart from two documentation-path comments.

---

## 3. API, auth and identity behaviour

Verified through the live suites, not by inspection alone:

| Property | Evidence |
|---|---|
| Read routes return correct data; non-GET on a matched route returns 405; unmatched returns 404 | `ida-2c` 26/26 |
| Every mutation writes an audit row **in the same transaction** | `ida-2d` 39/39 — proven in both directions: a failed data insert leaves the audit count unchanged, and a deliberately failed *audit* insert rolls the data insert back |
| No inline write SQL in `api.js`; all mutation SQL lives in `writes.js` | `ida-2c` source assertion |
| Writes **fail closed** without a resolved identity — no unattributed write path | `ida-2d` |
| Two distinct admin tokens produce two distinct `actor_ref` values | `ida-2d` |
| Restricted-scope facts are excluded from every read path | `ida-2c`, `ida-2d` |
| Seven server-derived fields rejected on submission, one test each | `ida-3b` 67/67 |
| Rate limiting enforced | `ida-3c` 63/63 |
| The ingestion route is admin-only; no public endpoint exists | `ida-3d` 73/73 |
| Media orphan cleanup never deletes a file another row references | `ida-2f` 32/32 |
| Restore refuses protected paths, home roots, the live store and the repository | `idauto-storage-ops` 73/73 |

**Auth status is unchanged and remains BLOCKED.** The only identity mechanism is the
operator-provisioned admin token map (IDA-2E-PRE). It is not authentication and is not
described as such anywhere in this repository.

---

## 4. One functional defect found and fixed

Both `ops/media-ops.js` and `ops/offhost-backup.js` computed the repository root as
`path.resolve(__dirname, '..', '..', '..')` — correct when `ops/` sat at
`projects/idauto/ops/`, wrong once `ops/` sits at the repository root.

**Impact if unfixed:** the "refuse to restore inside the git repository" safety guard would
have resolved to a directory two levels above the repository, so a restore *into* the
repository would not have been refused. A silent weakening of a safety guard, introduced by
the move and not by any code change.

**Fixed** to `path.resolve(__dirname, '..')` in both files. Covered by
`idauto-storage-ops` 73/73.

This is the class of defect a "copy the files and rename the docs" migration produces, which
is why the suites were re-run live rather than assumed to carry over.

### Related change: the restore-refusal guard was generalised

`/home/deploy` was a hardcoded entry in both refusal lists. Rather than delete it (which
would have removed a protection) or keep it (a hardcoded deployment path), the guard now
refuses **any direct child of `/home`** — a user's home root — by rule. `/home/deploy` is
still refused, on every host, and the tests now prove it through the CLI rather than by
checking the constant's contents.

---

## 5. Repository scan

| Search | Matches | Verdict |
|---|---|---|
| `projects/idauto` | **0** | Clean |
| `mythos-prod` | 4 | All are deliberate provenance lines in document headers |
| `/home/deploy` | 4 | Two explanatory comments naming it as the canonical home-root example; two test assertions proving it is refused. **No functional dependency** |
| `/srv/mythos`, `/home/ubuntu`, other absolute production paths | 0 functional | One `/home/ubuntu` appears in a test asserting refusal |
| `mythos_private` | 148 | ID Auto's own persisted access-scope value. Class D — retained deliberately, documented, rename scheduled at IDA-7 |
| `mythos_user_id` | 20 | Opaque external identity reference. Class D — retained, rename an IDA-7 candidate |
| `mythos_core`, `mythos_auth`, `mythos_documents`, `mythos_billing`, `mythos_search`, `mythos_notifications`, `mythos_audit` | 22 | Class B optional integrations, none implemented, all documented |
| Stale Mythos-only imports | **0** | No source file imports anything outside this repository or `pg` |

Full classification in
[`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md) §4.

---

## 6. Secrets and data

| Check | Result |
|---|---|
| Credential-shaped literals | 2 matches, both benign (below) |
| `.env` or any real environment file committed | **None.** `.gitignore` excludes `.env` and `.env.*` while keeping `.env.example` |
| `.env.example` contents | Placeholders only (`REPLACE_WITH_GENERATED_TOKEN`); no real value |
| Real vehicle data | **None.** The only data is `database/seed-synthetic-test-data.sql`, explicitly marked TEST/SYNTHETIC |
| Backups, dumps, uploads, runtime data | **None** |
| Personal data of any natural person | **None** |
| Origin repository's production backups or credentials | **Not migrated**, deliberately |

The two credential-shaped matches:

1. `wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY` in `tests/ida-3f-offhost-backup-test.js` —
   **AWS's own published SigV4 documentation example key**, present so the test can pin the
   published signature vector exactly. Not a credential to anything.
2. `var TOKEN = 'ida3d-token-' + crypto.randomBytes(18).toString('hex')` — a per-run
   generated value, not a literal.

Both were flagged and investigated in the origin repository too; the finding is the same.

---

## 7. Documentation ↔ implementation consistency

| Check | Result |
|---|---|
| Protocol documentation matches the implementation | **Consistent.** Every divergence is enumerated in [`../protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md), which states which side is authoritative for what |
| Blockchain described as implemented anywhere | **No.** `BLOCKCHAIN_ARCHITECTURE.md` is headed "SPECIFIED — NOT IMPLEMENTED"; the roadmap, README, protocol §14 and `src/blockchain/README.md` all agree. **No chain code exists in this repository** |
| Roadmap statuses truthful | **Verified stage by stage** (§8) |
| `src/` mistaken for implementation | **Guarded.** `src/README.md` and all five subdirectory READMEs state NOT IMPLEMENTED and point at `reference/` |
| Blockers preserved rather than dropped | **Yes.** IDA-2E and IDA-3F are blocked in the roadmap, the README status table, `PRIVACY_ARCHITECTURE.md`, `SECURITY.md` and the strategy record |
| Stale claims carried over | **One corrected.** The origin `projects/idauto/README.md` still described IDA-1 as the current stage — three stages behind. The new README states the real state |
| JavaScript parses | All 30 files: **clean** |
| JSON valid | All 14 schema and config files: **clean** |
| Relative documentation links resolve | **All resolve**, except links inside the verbatim historical record in `AI_HANDOVER.md`, which point at origin-repository paths by design and are flagged as such in that file's header |

---

## 8. Roadmap truthfulness — stage by stage

Each claim checked against evidence in this repository, not against the previous document.

| Stage | Claimed | Verified by |
|---|---|---|
| IDA-0 | IMPLEMENTED | Config, schema and plate-format catalogue present; `ida-2a` 44/44 |
| IDA-1 | IMPLEMENTED | Four specification documents present; 22→24-table schema present |
| IDA-2A | IMPLEMENTED | `ida-2a` 44/44 |
| IDA-2B | IMPLEMENTED | Schema applies cleanly to a fresh database; 24 tables |
| IDA-2C | IMPLEMENTED | `ida-2c` 26/26 live |
| IDA-2D | IMPLEMENTED | `ida-2d` 39/39 live, atomicity proven both directions |
| IDA-2E | **BLOCKED** | No auth service exists. Correctly reported as blocked, and re-scoped to IDA-7 |
| IDA-2E-PRE | IMPLEMENTED | `reference/identity.js` present; distinct `actor_ref` per token proven |
| IDA-2F | IMPLEMENTED | `ida-2f` 32/32 live |
| IDA-2G / 2H | IMPLEMENTED | 17/17, 37/37 live |
| IDA-3A | IMPLEMENTED | `ida-3a` 47/47; migration idempotent against the live schema |
| IDA-3B | IMPLEMENTED | `ida-3b` 67/67 live |
| IDA-3C | IMPLEMENTED | `ida-3c` 63/63 live |
| IDA-3D | IMPLEMENTED | `ida-3d` 73/73 live; admin-only, no public route |
| IDA-3E | IMPLEMENTED | `ida-3e` 48/48 live |
| IDA-3F | **BLOCKED** | Tooling present, 35/35 offline. **No off-host copy exists** — correctly reported as blocked, not complete |
| IDA-3G/H/I | Not started | No corresponding code |
| IDA-4 – IDA-9 | SPECIFIED / PLANNED | Documentation only; **no implementation, and none claimed** |
| Anything DEPLOYED | **Nothing** | No public endpoint exists in or from this repository |

**No stage is represented as further along than it is**, and the two blockers are stated in
every place the corresponding capability is mentioned.

---

## 9. Acceptance criteria

| Criterion | Status |
|---|---|
| Existing ID Auto baseline migrated | ✅ 84 files; code, schema, tests, docs, history |
| IDA-0 → IDA-3 history and specification preserved | ✅ Roadmap + 25 verbatim handover sections |
| New strategy incorporated | ✅ `ROADMAP_EVOLUTION_2026-08-18.md`, all 17 decisions |
| Vehicle Passport defined | ✅ Protocol §3, `protocol/schemas/passport.schema.json` |
| Vehicle ID defined | ✅ Protocol §2.1, `protocol/schemas/vehicle.schema.json` |
| Trust T0–T4 defined | ✅ `TRUST_MODEL.md`, `trust-assessment.schema.json` |
| Citizen-first model defined | ✅ Protocol §9.1, `GO_TO_MARKET.md` §4 |
| Professional issuer model defined | ✅ Protocol §7, `issuer.schema.json` |
| AI verification model defined | ✅ Protocol §8, `anomaly.schema.json`, `protocol/verification/` |
| W3C VC/DID compatibility documented | ✅ Protocol §12, `protocol/credentials/` |
| Blockchain anchoring architecture documented | ✅ `BLOCKCHAIN_ARCHITECTURE.md`, marked NOT IMPLEMENTED |
| Merkle batching documented | ✅ `BLOCKCHAIN_ARCHITECTURE.md` §4 |
| No mandatory token | ✅ Stated in README, protocol §11, blockchain §3, governance §4 |
| Open-source governance added | ✅ LICENSE (Apache-2.0), CONTRIBUTING, SECURITY, GOVERNANCE |
| Commercial model documented | ✅ `BUSINESS_MODEL.md` |
| Roadmap extended to IDA-9 | ✅ `ROADMAP.md` |
| Privacy architecture preserved | ✅ `PRIVACY_ARCHITECTURE.md`; zero owner-PII columns re-verified |
| Tests pass | ✅ **601 / 601** |
| Migration audit completed | ✅ This document |
| Repository `othoth77/idauto` exists | ⛔ **BLOCKED** — see §10 |

---

## 10. Blockers at audit time

### 10.1 Repository creation — BLOCKS PUBLICATION

`othoth77/idauto` **does not exist**, and this session cannot create it: the GitHub
integration returned `403 Resource not accessible by integration` on
`POST /user/repos`. Repository creation requires an account-administration permission the
integration does not hold.

The repository content is complete and validated. Publishing requires the owner to create an
**empty** `othoth77/idauto` (no README, no `.gitignore`, no licence — the migrated tree must
be authoritative) and grant this session access to it. Nothing else is outstanding.

### 10.2 Carried forward from the origin — unchanged by the migration

| Blocker | Effect |
|---|---|
| **IDA-2E — no real authentication** | Blocks IDA-3H, IDA-4 and everything citizen-facing. Re-scoped to IDA-7 (W3C DID/VC) since no external service exists to integrate with |
| **IDA-3F — no off-host backup copy** | Blocks any stage accepting real evidence. Tooling is complete and offline-verified; a destination must be provisioned |
| **LEGAL-REVIEW-REQUIRED — 15 open items** | Blocks every public surface. Enumerated in [`ROADMAP.md`](ROADMAP.md) |
| **Plate formats unverified** | The seven Tunisian formats have never been confirmed against an official source. Flagged since IDA-0 and still flagged |
| **Test fixture lifecycle undefined** | Not a present correctness issue; define before volume makes backups material |

`PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` remains **NO**, exactly as at the origin baseline.

---

## 11. Conclusion

The migration is **complete and validated**, subject only to §10.1.

The IDA-0 → IDA-3 baseline moved intact: 601 assertions pass in the new layout against a
live database, the schema is unchanged and consistent, the privacy invariants hold, and no
completed stage was overstated or understated. One real defect introduced by the move was
found and fixed. Every Mythos coupling was classified rather than deleted, and the four that
cannot simply be kept are documented with a scheduled resolution.

The strategic evolution is integrated as documentation only. Nothing in the protocol,
blockchain, credential or part-identity specifications is implemented, and every one of
those documents says so in its own header rather than leaving the reader to infer it.
