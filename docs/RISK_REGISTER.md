# IDauto — Risk Register

**Provenance:** the ID Auto rows of `docs/AUTOMOTIVE_RISK_REGISTER.md` in
`othoth77/mythos-prod` (stage ATN-0, last updated 2026-08-05), extracted 2026-08-18 during
the standalone migration. Risk text, likelihood, impact, mitigation and status are
**reproduced unchanged**; only the owner column and the cross-product rows are reorganised.

**Why this file exists.** The origin register is a portfolio document covering ID Auto,
AutoValeur, Atelier Network, AutoMarket and shared infrastructure. It was correctly *not*
migrated whole — most of it governs products that are not IDauto. But the ID Auto rows are
IDauto's own open risks, and leaving them behind would have silently dropped eight tracked
items. That is what this extraction prevents.

**Stage references** below use the **origin roadmap's numbering** (IDA-3 = public capture,
IDA-4 = Smart Gate). Under the standalone roadmap these moved: see
[`ROADMAP_EVOLUTION_2026-08-18.md`](ROADMAP_EVOLUTION_2026-08-18.md) §6. The mapping is given
per row in the last section.

**Likelihood / Impact:** H = High, M = Medium, L = Low.

---

## 1. Risks owned by IDauto

| ID | Category | Risk | L/I | Mitigation | Status |
|---|---|---|---|---|---|
| `R-L01` | Legal and Regulatory Risks | No confirmed legal basis for public plate lookup under Tunisian data protection law (organic law 63-2004 + INPDP rules) | H/H | Legal counsel review before IDA-3; no public lookup launched without resolution | OPEN |
| `R-L02` | Legal and Regulatory Risks | ANPR regulatory approval (INPDP) not yet obtained for Smart Gate camera operation | H/H | Regulatory pathway mapping; no camera connection before approval | OPEN |
| `R-D02` | Data and Identity Risks | Plate format rules are UNVERIFIED DRAFTS; public plate lookup results will contain errors until confirmed against official source | H/M | Plate format verification required before IDA-3 public launch; current flags: `verified = FALSE` | OPEN |
| `R-D05` | Data and Identity Risks | Vehicle fiche merge creates orphaned references in AutoValeur and Fixpert if no propagation protocol exists | M/H | Merge/split event publication required; consumers must handle vehicle_id alias resolution | OPEN |
| `R-P02` | Privacy and Data Protection Risks | Contributor identity leakage — contributor who submitted an observation identified from public output | M/M | Contributor identity is PROFESSIONAL+ scope; public output never includes contributor reference | OPEN |
| `R-P04` | Privacy and Data Protection Risks | Carte grise OCR extracts owner PII in memory; must not persist to any idauto_ column | M/H | Architecture enforces: OCR → confirm → route to fixpert.clients or discard. `idauto_document_scans` has no PII columns | OPEN |

## 2. Cross-product risks that involve IDauto

Owned elsewhere in the origin portfolio, but they constrain IDauto's interfaces or are
jointly owned. Recorded here because a standalone IDauto still has to honour the contract
they describe. `R-O03` and `R-P01` are **jointly owned** and should be read as IDauto's own.

| ID | Origin owner | Category | Risk | L/I | Mitigation | Status |
|---|---|---|---|---|---|---|
| `R-D03` | AutoValeur | Data and Identity Risks | AutoValeur Deal Radar flow describes creating a "preliminary fiche in ID Auto queue" — this must be implemented as an ingestion request submission, not a direct cross-schema write | M/H | Architecture audit finding incorporated; implementation must submit to ID Auto ingestion API | OPEN |
| `R-T03` | Integration | Technical and Architecture Risks | Scope column named `visibility_scope` in ID Auto docs and `access_scope` in AutoValeur — divergence will cause cross-product filter bugs | H/M | Standardise on `access_scope` as the canonical column name across all products; update ID Auto schema in IDA-2 | RESOLVED (IDA-2A-CORRECTION-0, 2026-08-10) — `schema.sql`, `docs/IDAUTO_ARCHITECTURE.md`, `docs/IDAUTO_PRODUCT_SPEC.md` all renamed to `access_scope`. Not yet applied to a live database — the naming is now consistent at the source level; live-migration verification remains part of IDA-2 Phase B. |
| `R-T04` | Integration | Technical and Architecture Risks | Rate limiting designed in ID Auto (IP hash + `idauto_verifications`) but only a placeholder in AutoValeur; two products will implement divergent rate-limit behaviours | M/M | Unified rate-limit service defined in MAE-1 shared platform spec; both products converge in IDA-2/AVA-1 | OPEN |
| `R-T07` | Infrastructure | Technical and Architecture Risks | PostgreSQL installation authority doubly stated: ID Auto says "before IDA-2"; AVA-1 also lists PostgreSQL as prerequisite | M/M | One shared cluster provisioned in IDA-2; AVA-1 is a consumer, not a separate installer | OPEN |
| `R-T09` | Architecture | Technical and Architecture Risks | No shared vehicle taxonomy API is defined; AutoValeur, AutoMarket, and Parts Network may each grow private lookup tables | M/M | ID Auto taxonomy API endpoint included in IDA-2 scope | OPEN |
| `R-O03` | ID Auto / AutoValeur | Operational Risks | Uncontrolled Mythos Super Admin access — no access review schedule or access revocation procedure | M/H | Periodic access review scheduled in Operating Model; all access audit-logged | OPEN |
| `R-B06` | AutoMarket | Business and Market Risks | Marketplace fraud — fake listings, false identities, payment disputes | M/H | ID Auto vehicle verification required for listing; identity check badge; escrow or monitored payment; seller verification | OPEN |
| `R-P01` | ID Auto / AutoValeur | Privacy and Data Protection Risks | Cross-product PII leakage — customer or owner PII inadvertently included in cross-product API response | M/H | Scope-filtered API responses; no PII columns in ID Auto vehicle/fact/observation tables; no PII columns in AutoValeur tables; verified by automated checks | OPEN |
| `R-ATN-D04` | ATN / Data | Atelier Network Risks (ATN-0) | ATN→ID Auto vehicle_id resolution failure — work orders and inspections reference a vehicle_id that ID Auto cannot resolve (e.g. vehicle not yet in ID Auto, or vehicle_id alias not propagated) | M/M | Graceful degradation: work order valid without vehicle_id until resolved; vehicle_id linkage is async and advisory in ATN-1 | OPEN |

---

## 3. Stage renumbering

| Risk | Origin stage | Standalone stage | Why |
|---|---|---|---|
| `R-L01` public plate lookup legal basis | IDA-3 | **IDA-3G / IDA-3I** | Unchanged in substance; the public gate is now its own slice |
| `R-L02` ANPR regulatory approval | IDA-4 | **IDA-6** | Smart Gate absorbed into the AI Trust & Anomaly Engine stage |
| `R-D02` unverified plate formats | IDA-3 | **IDA-3I** | Blocks public lookup, not private capture |
| `R-D05` merge orphan propagation | IDA-2 | **IDA-4** | Merge semantics are now protocol-level (OVIP §9.4) |
| `R-O03` super-admin access governance | IDA-2 | **IDA-4** | Tracked as a LEGAL-REVIEW-REQUIRED item |
| `R-P01` cross-product PII leakage | IDA-2 | **standing** | Structurally mitigated: zero owner-PII columns, test-enforced |
| `R-P02` contributor identity leakage | IDA-3 | **IDA-3I** | Contributor identity is restricted scope; public output never includes it |
| `R-P04` registration-certificate OCR PII | IDA-3 | **IDA-6** | OCR moved to the AI stage |

## 4. Risks closed since the origin register

| Risk | Resolution |
|---|---|
| `R-T03` — scope column named `visibility_scope` in ID Auto and `access_scope` in AutoValeur | **RESOLVED** (IDA-2A-CORRECTION-0, 2026-08-10). Standardised on `access_scope`; verified live on both affected tables at IDA-2B, and re-verified against the migrated schema on 2026-08-18 |
| `R-T04` — divergent rate-limit behaviour between products | **Superseded for IDauto.** Rate limiting was implemented at IDA-3C (63 assertions). Cross-product convergence is no longer IDauto's concern |
| `R-T06` — redundant `idauto.idauto_vehicles` prefix naming | **Accepted, not fixed.** The prefix is live in 24 tables and every query path. Renaming is a breaking migration with no behavioural benefit; folded into the IDA-7 protocol-convergence migration alongside the `mythos_private` and `mythos_user_id` renames |
| `R-T07` — doubly-stated PostgreSQL installation authority | **Moot.** IDauto provisions its own database; there is no second installer |
| `R-T09` — no shared vehicle taxonomy API | **Reframed.** The standalone answer is the open protocol itself — [`../protocol/schemas/`](../protocol/schemas/) is the shared taxonomy, published rather than API-gated |

## 5. Risks added by the standalone repositioning

Recorded on 2026-08-18; not present in the origin register.

| ID | Category | Risk | L/I | Mitigation | Status |
|---|---|---|---|---|---|
| `R-S01` | Governance | Single-maintainer governance is inadequate for a protocol seeking institutional adoption; adopters have no recourse if direction changes | M/H | Apache-2.0 makes forking always possible; governance model must be replaced once a second independent implementation exists | OPEN — [`../GOVERNANCE.md`](../GOVERNANCE.md) §2 |
| `R-S02` | Product | The growth loop depends on garages recording work; nothing yet demonstrates they will | H/H | Recording must be near-zero effort at the point of work; measured by "passports with ≥1 T2 claim" | OPEN — [`GO_TO_MARKET.md`](GO_TO_MARKET.md) §2 |
| `R-S03` | Product | Buyers may not check passports at point of sale, removing issuers' reason to issue | H/H | QR at the vehicle, marketplace embedding; measured by loop-closure metric | OPEN — [`GO_TO_MARKET.md`](GO_TO_MARKET.md) §2 |
| `R-S04` | Trust | An interface rendering an anchor as a verification badge would defeat the trust model at the last inch | M/H | T4 kept orthogonal in the data model; treated as a security issue in [`../SECURITY.md`](../SECURITY.md) | OPEN — mitigated by design, unenforceable until a UI exists |
| `R-S05` | Commercial | Pressure to sell a trust level or the suppression of an adverse record, arriving with a plausible framing | M/H | Named as a prohibition in [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md) §1 and a governance invariant | OPEN |
| `R-S06` | Operational | Test fixtures accumulate in the live database by design; no fixture lifecycle is defined | L/M | Define before volume makes backups or tests operationally material | OPEN — carried from the IDA-2 Phase B audit |
| `R-S07` | Conformance | No conformance suite exists, so "conforming implementation" is unverifiable and self-asserted | M/M | Build the suite at IDA-7; until then, do not claim certification | OPEN — [`../GOVERNANCE.md`](../GOVERNANCE.md) §6 |
