# Verification Specification

**Protocol version `0.1.0-draft`**
**Status:** the checks in §2 steps 1–4 are largely IMPLEMENTED; steps 5–8 are SPECIFIED.
§6 states exactly which.

Verification is the act of checking a claim and recording the outcome. This document
specifies what "checking" means, so that two independent implementations reach the same
answer about the same passport.

---

## 1. What verification is, and is not

**Is:** establishing what provenance a claim has, whether its evidence holds up, whether it
contradicts anything, and what trust level follows from that.

**Is not:** deciding whether the claim is true. IDauto does not adjudicate truth. It reports
who said what, on what basis, and how well corroborated it is — and leaves the judgement to
the person whose money is at stake.

That distinction is the reason the output of verification is a `TrustAssessment` plus a set
of `Anomaly` records, and never a boolean.

---

## 2. The verification pipeline

Each step is independently implementable and independently testable. A step's failure
records a finding; it does not abort the pipeline, because a claim with three problems
should surface three problems rather than the first one.

### Step 1 — Structural validation
The record validates against its protocol schema, its provenance envelope is complete, and
no server-derived field was client-supplied. A payload carrying `trust_level`, `confidence`,
`verification_status`, `source`, `issuer` or any actor reference is **rejected with 400
naming every offending field** — never sanitised and accepted. Silently dropping a spoofed
privilege field hides an attack; reporting it surfaces one. *(IMPLEMENTED.)*

### Step 2 — Evidence integrity
Each referenced Evidence exists, its `content_hash` matches the stored bytes, and it has not
been tombstoned. A claim whose evidence has vanished drops to T0 and gains an anomaly — it
does not keep a trust level it can no longer justify. *(IMPLEMENTED for content-addressed
media; the automatic downgrade is SPECIFIED.)*

### Step 3 — Evidence re-use detection
Content-addressed storage makes byte-identical re-use across subjects detectable by
construction. Perceptual hashing catches near-duplicates (recompression, crop, watermark).
Re-use across different vehicles raises `reused_evidence_across_subjects`. *(Content
addressing IMPLEMENTED; cross-subject detection SPECIFIED.)*

### Step 4 — Internal consistency
Chronology (does the sequence make sense), mileage monotonicity, plate-interval overlap,
part-fitment overlap, geographic plausibility between consecutive observations. Each failure
is an `Anomaly` with neutral wording. *(Conflict recording IMPLEMENTED; the full check set
SPECIFIED.)*

### Step 5 — Issuer verification
Where the claim is issuer-signed: resolve the issuer DID (or its archived DID document),
verify the signature, check the credential's status-list entry, and check the claim is
within the issuer's `authority_scope`. An out-of-scope claim raises `issuer_out_of_scope`
rather than being silently accepted at the issuer's trust class. *(SPECIFIED.)*

### Step 6 — Anomaly detection
Rule-based and model-based detectors produce `Anomaly` records. Bounds are normative:

- AI **MAY** OCR, extract, and flag anomalies, chronology conflicts, duplicate evidence,
  suspicious mileage and document inconsistencies.
- AI **MUST NOT** declare fraud, assert legal guilt, raise a trust level, or be the sole
  basis for an adverse decision about a person.
- Anomaly wording **MUST** describe the observation, never the conclusion.

*(SPECIFIED.)*

### Step 7 — Trust computation
Compute the `TrustAssessment` per [`../../docs/TRUST_MODEL.md`](../../docs/TRUST_MODEL.md)
§3. Deterministic and recomputable; the rules version is recorded so a past assessment can
be explained. *(SPECIFIED.)*

### Step 8 — Anchoring check
If the record claims an anchor, verify the inclusion proof against the on-chain root
independently of IDauto's own assertion. Anchoring state is recorded **separately** from
trust level and is never rendered as verification. *(SPECIFIED — no chain integration
exists.)*

---

## 3. Independent verification

A third party must be able to verify a passport **without trusting IDauto**. What they need:

| To check | They need | Trust required in IDauto |
|---|---|---|
| An issuer's signed claim | The VC and the issuer's DID document | **None** |
| That evidence matches its hash | The artefact and the recorded hash | **None** |
| That a record was anchored | The inclusion proof and public chain access | **None** |
| That a claim's trust level is right | The record, its evidence, and the published rules | **None** |
| That the passport is *complete* | — | **Total** |

The last row is the honest limit and it is stated deliberately: nothing in this protocol can
prove that a record was never written. An empty history is indistinguishable from a hidden
one. Any implementation that presents a sparse passport as a clean bill of health is
misrepresenting what the protocol can do, which is why
[`../schemas/passport.schema.json`](../schemas/passport.schema.json) makes
`completeness_note` a first-class field rather than fine print.

---

## 4. Verification outputs

A `Verification` record is immutable and carries:

- what was verified (record reference and version)
- which pipeline steps ran, and each step's outcome
- the anomalies raised
- the resulting `TrustAssessment`
- the rules version and detector versions
- who or what performed it, and when

Re-verification produces a **new** record. Verification history is retained, because the
question "when did we last check this, and with which rules?" has to be answerable.

---

## 5. Human review

Human review is not a fallback for when automation fails; it is a required part of the
pipeline for consequential outcomes.

- Anomalies of severity `medium` or above route to review.
- A citizen whose submission is rejected **MUST** have a human-reviewable path. An automated
  rejection with no appeal is not acceptable for a service that positions itself as
  citizen-first.
- A reviewer's decision is itself a record with an actor, a rationale and a timestamp.
- A reviewer **MUST NOT** be able to edit a claim. They accept, reject, or supersede — the
  same three verbs everything else has.

*(Review queue IMPLEMENTED. Automated routing by anomaly severity SPECIFIED.)*

---

## 6. Implementation status

| Step | Status |
|---|---|
| 1 · Structural validation, server-derived field rejection | **IMPLEMENTED** |
| 2 · Evidence integrity (content-addressed hashes) | **IMPLEMENTED**; automatic T0 downgrade **SPECIFIED** |
| 3 · Byte-identical duplicate detection | **IMPLEMENTED**; perceptual + cross-subject **SPECIFIED** |
| 4 · Conflict recording | **IMPLEMENTED**; full consistency check set **SPECIFIED** |
| 5 · Issuer / DID / VC verification | **SPECIFIED** |
| 6 · Anomaly detection | **SPECIFIED** |
| 7 · Trust computation | **SPECIFIED** |
| 8 · Anchor verification | **SPECIFIED** — no chain integration exists |
| Human review queue | **IMPLEMENTED** |
| Automated severity routing | **SPECIFIED** |
| Independent verifier tool | **PLANNED** |
