# Governance

**Last updated:** 2026-08-18

---

## 1. Three separable things

IDauto is deliberately split into three layers with different governance and different
licences. Conflating them is how open protocols become single-vendor products.

| Layer | What it is | Licence | Who decides |
|---|---|---|---|
| **Open protocol** | Schemas, specifications, verification rules, reference implementation | Apache-2.0 | Protocol change process (§3) |
| **Brand** | The IDauto name, marks, visual identity | Not licensed | The trademark holder |
| **Hosted services** | The operated deployment, support, enterprise integrations | Commercial terms | The operator |

A fork may implement the protocol, run it, and compete. A fork may **not** call itself
IDauto. The separation protects users from an implementation that carries the name without
the invariants.

---

## 2. Current governance model — stated honestly

**Benevolent maintainer.** The project is maintained by its original author. There is no
foundation, no steering committee, no elected technical body, and no multi-organisation
governance.

This is the appropriate model for a project at this stage — pre-launch, with a small
codebase and no external implementers — and it is **inadequate for what IDauto is trying to
become**. A protocol that expects institutional adoption cannot indefinitely be governed by
one party, because the institutions being asked to depend on it have no recourse if that
party changes direction.

The transition is not scheduled, and pretending otherwise would be worse than admitting it.
What is committed to now:

- The protocol is Apache-2.0, so a fork is always possible. That is the only real guarantee
  currently on offer, and it is stated rather than dressed up.
- Protocol changes follow the documented process in §3 even while one person applies them.
- The invariants in §4 are treated as constitutional rather than as maintainer preference.

**Trigger for change:** once there is a second independent implementation, or a second
organisation operating a deployment, this model has to be replaced. That is when the
question becomes real.

---

## 3. Protocol change process

Protocol changes are governed differently from code changes, because a schema change breaks
every implementation and a bug fix does not.

### Change classes

| Class | Examples | Requires |
|---|---|---|
| **Editorial** | Wording, examples, typos | Maintainer review |
| **Additive** | New optional field, new event type, new credential type | Proposal + review; minor version |
| **Breaking** | Removing or renaming a field, changing a constraint, changing semantics | Proposal + review + migration plan + deprecation period; **major version** |
| **Invariant-touching** | Anything in §4 | Rejected by default; see §4 |

### Process

1. **Propose.** An issue stating the problem, the proposed change, the alternatives
   considered, and the impact on existing implementations.
2. **Review.** Public discussion. Breaking changes need a stated migration path.
3. **Decide.** Recorded with reasoning, including for rejections.
4. **Version.** Semantic versioning. Breaking → major. Additive → minor. Editorial → patch.
5. **Deprecate before removal.** A field is marked deprecated for at least one major version
   before it is removed.

Unknown fields **MUST** be preserved on round-trip by every implementation, so additive
changes never silently lose data crossing an implementation boundary.

---

## 4. Invariants

These are not design preferences. A change that violates one is rejected regardless of its
technical quality, and a fork that violates one is not implementing this protocol.

1. **No owner PII in the vehicle record.** No schema gains an owner, holder, contact or
   personal-identifier field. The constraint is structural, not a permission rule.
2. **No personal data on a public ledger.** Absolute; no configuration flag, no enterprise
   exception.
3. **History is append-only.** Consequential records are superseded, never edited or
   silently deleted. Erasure leaves a tombstone.
4. **Trust is computed, never asserted or purchased.** A client-supplied trust level is a
   `400`, and a purchasable trust level is fraud.
5. **Immutable does not mean true.** Anchoring state stays orthogonal to trust level, in the
   data model and in every interface.
6. **AI does not declare fraud or legal guilt.** Detection produces observations routed to
   human review.
7. **Anchoring stays optional and chain-neutral.** A deployment that anchors nothing is
   fully conforming.
8. **No mandatory token.** No cryptocurrency, token, NFT or DAO is required for any protocol
   function.
9. **Registration stays free.** Creating a passport is never gated on payment.
10. **Verification is independently checkable.** A third party can verify claims without
    trusting IDauto.

Changing an invariant requires a **major protocol version, a public rationale, and an
explicit statement of what protection is being given up and who is exposed by it.** They are
not immutable — they are expensive, which is the point.

---

## 5. Trademark and brand

The IDauto name, logo and visual identity are **not** covered by the Apache-2.0 licence.

**Permitted without permission:**
- Stating that your software implements the IDauto protocol
- Referring to IDauto in documentation, articles, comparisons and research
- "Compatible with IDauto", "implements OVIP"

**Not permitted without written permission:**
- Naming your product or service IDauto, or a confusingly similar name
- Using the logo or visual identity as your own
- Implying endorsement, certification or affiliation
- Registering IDauto or a confusable variant as a domain, mark or handle

If a fork diverges from the protocol, it must not carry the name — that is the point of
separating brand from protocol.

---

## 6. Conformance

**No conformance suite exists yet.** "Conforming implementation" is therefore currently
unverifiable, and any claim of conformance is self-assessed.

When one exists, a conforming implementation must state which protocol version it implements
and which optional capabilities it supports, and must satisfy the invariants in §4. Until
then, conformance is a stated intention, not a certification, and this document will not
imply otherwise.

---

## 7. Decision record

Consequential decisions are recorded with their reasoning, including reasoning for rejected
alternatives, in:

- [`docs/ROADMAP_EVOLUTION_2026-08-18.md`](docs/ROADMAP_EVOLUTION_2026-08-18.md) — the
  strategic decisions of 2026-08-18
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture decisions AD-1 onward
- [`docs/AI_HANDOVER.md`](docs/AI_HANDOVER.md) — the implementation record, including
  blockers and things that did not work
- [`CHANGELOG.md`](CHANGELOG.md)

A decision that is not recorded with its reasoning will be re-litigated by whoever inherits
it, so the reasoning is the deliverable, not the conclusion.
