# Trust Model

**Status:** SPECIFIED — normative. Partially implemented; §8 states exactly what.
**Protocol version:** `0.1.0-draft` · **Last updated:** 2026-08-18

---

## 1. The one sentence that governs this document

> **Immutable does not mean true.**

A cryptographic anchor proves that a record existed at a point in time and has not been
altered since. It proves nothing whatsoever about whether the record was accurate when it
was written. A lie, anchored, is a permanent lie with a timestamp.

Every design decision below follows from taking that seriously. Systems that blur it end up
laundering unverified claims into apparent facts, which is worse than having no system,
because it manufactures unearned confidence in exactly the transactions where people are
most exposed.

---

## 2. The ladder

| Level | Name | Definition | What it actually tells you |
|---|---|---|---|
| **T0** | Self-declared | A party stated it. No evidence attached. | Someone is willing to say this. Nothing more. |
| **T1** | Documented | A supporting artefact is attached and retained. | A document exists that says this. The document itself is unverified. |
| **T2** | Professionally verified | A verified professional issuer attests it from direct handling of the vehicle. | A identifiable business with a reputation staked it on this. |
| **T3** | Institutional | An authorised institution is the source (registry, inspection authority, manufacturer). | The authority of record says this. |
| **T4** | Cryptographically anchored | The record's hash is committed to an external ledger; tampering is detectable. | This record has not changed since it was anchored. |

### 2.1 T4 is orthogonal, not superior

T4 sits in the same list for practical reasons — deployments talk about it as a level — but
it answers a **different question** from T0–T3:

- T0–T3 answer: *how well corroborated is this claim?*
- T4 answers: *has this record been altered since it was written?*

They are independent. A T0 self-declaration can be anchored (T0 + anchored). A T3
institutional record might not be (T3, not anchored). Neither combination is contradictory.

**Normative consequences:**

- An implementation **MUST** store and expose the substantive level (T0–T3) and the
  anchoring state as **two separate values**.
- An interface **MUST NOT** render an anchor as a verification badge, a checkmark, a
  "verified" label, or any other affordance a user reads as "this is true".
- Anchoring a claim **MUST NOT** change its substantive level.

The visual language matters as much as the data model. If the UI shows a shield icon for
"anchored", users will read it as "checked", and the model's honesty will have been
defeated at the last inch.

---

## 3. How a level is determined

A `TrustAssessment` is **computed** from the record and its evidence. It is never author-supplied.

```
T3  if the claim's issuer is an institutional issuer acting within its authority
T2  if the claim's issuer is a verified professional issuer with direct-handling evidence
T1  if evidence is attached, retained, and content-addressed
T0  otherwise
```

Anchoring state is computed separately: `anchored` if a `BlockchainAnchor` covers a Merkle
batch containing this record's hash and the anchor is confirmed.

Rules:

- Levels **MUST** be recomputable from stored data. A stored level that disagrees with
  recomputation is a defect, not a fact.
- A level **MUST NOT** be purchasable. Paying for a verification *service* is legitimate;
  paying for a *level* is not (see [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md) §5).
- A level **MAY** be reduced retroactively — if an issuer is found fraudulent, every claim
  they signed is reassessed. History is not rewritten; a new assessment supersedes the old
  one, and the old assessment stays visible.
- Reassessment **MUST NOT** delete or edit the underlying claim.

---

## 4. Confidence is not trust

| | Confidence | Trust level |
|---|---|---|
| Range | `0.0`–`1.0` | `T0`–`T3` (+ anchoring state) |
| Measures | How reliably a value was *extracted* | How well a claim is *corroborated* |
| Produced by | OCR, detection, parsing | Provenance and issuer identity |
| Example | "0.98 that this string reads `123 TUN 4567`" | "T1: a photograph of a document is attached" |

An OCR engine can be 0.99 confident about a number it read perfectly off a forged document.
High confidence with low trust is the exact signature of well-executed forgery, and a system
that multiplies the two into one score destroys the signal that would have caught it.

These **MUST** remain separate fields, separately displayed.

---

## 5. Conflicts

When two claims about the same attribute disagree:

1. Both are retained. Neither is deleted.
2. The vehicle's `fiche_status` (or the fact's `verification_status`) becomes `conflict`.
3. The conflict is surfaced, not hidden behind a "best guess" single value.
4. Resolution requires either higher-trust evidence or human review — never
   last-write-wins, and never highest-confidence-wins.
5. A resolution is a new record superseding the losing claim, with a reason.

A conflict is information. A vehicle whose recorded mileage disagrees between two sources is
telling a prospective buyer something important, and a system that silently picks one value
has withheld it.

---

## 6. Adversarial assumptions

The model assumes bad actors, because vehicle history is a domain with direct financial
incentives to lie.

| Attack | Mitigation |
|---|---|
| Seller self-declares a clean history | T0 is visibly T0. A passport of nothing but T0 claims looks exactly as thin as it is. |
| Forged service document | T1 is only "a document exists". AI anomaly detection flags layout/arithmetic/duplication. T2 requires an identifiable issuer, not a document. |
| Colluding garage issues false records | Issuer identity is verifiable and reputational. Issuers are re-assessable, and retroactive downgrade is supported. |
| Evidence re-use across vehicles | Content-addressed storage makes byte-identical re-use detectable by construction; perceptual hashing catches near-duplicates. |
| Odometer rollback | Chronology conflict detection across records; mileage is append-only, so a regression is visible rather than overwritten. |
| Adverse history hidden by re-plating | Identity is the IVID, not the plate. Re-plating creates a new `Plate` interval on the same vehicle. |
| Adverse history hidden by resale | History survives ownership transfer; a new holder cannot edit or reset it. |
| Adverse history hidden by deletion | Consequential records cannot be deleted, only superseded. Erasure leaves a tombstone. |
| Anchoring used to imply truth | T4 is orthogonal and separately displayed; interfaces are forbidden from conflating them. |

None of these is fully solved by the protocol alone. The protocol's contribution is that
each attack leaves a visible trace rather than a clean record.

---

## 7. What the model deliberately does not do

- It does not adjudicate truth.
- It does not assign blame.
- It does not produce a single overall "vehicle score". A score is a compression of exactly
  the provenance detail a buyer needs, and it invites optimisation against the score rather
  than against reality.
- It does not treat absence of evidence as evidence of absence. A vehicle with no recorded
  damage has no recorded damage; that is not the same as an undamaged vehicle, and the
  interface **MUST NOT** imply otherwise.

---

## 8. Implementation status

| Element | Status |
|---|---|
| `confidence_score` (0.0–1.0) stored per fact | **IMPLEMENTED** |
| `verification_status` (`unverified`/`pending_review`/`verified`/`conflict`/`rejected`) | **IMPLEMENTED** |
| Conflicts recorded rather than overwritten (`is_active` supersession) | **IMPLEMENTED** |
| Evidence records with content-addressed media | **IMPLEMENTED** |
| Review queue for human adjudication | **IMPLEMENTED** |
| Explicit T0–T4 `TrustAssessment` entity and computation | **SPECIFIED** — not implemented |
| Issuer registry with verifiable identity | **SPECIFIED** — not implemented |
| Retroactive issuer-wide reassessment | **SPECIFIED** — not implemented |
| Anchoring state | **SPECIFIED** — no chain integration exists |
| AI anomaly detection | **SPECIFIED** — not implemented |

The mapping from today's `verification_status` to the T-ladder is a IDA-6 task and is not
yet defined in code. Nothing in the current implementation reports a T-level.
