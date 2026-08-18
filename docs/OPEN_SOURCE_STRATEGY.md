# Open Source Strategy

**Status:** the licence and governance files are in place; the community infrastructure they
describe (SDKs, published context URL, conformance suite) is not.
**Last updated:** 2026-08-18

---

## 1. Why open

A vehicle passport is only useful if a party outside IDauto can verify it — a buyer's bank,
an insurer in another country, a customs authority, a competing platform. Verification that
requires trusting IDauto is not verification; it is a reputation transfer.

Publishing the schemas, the verification rules and a working implementation is what makes
independent verification possible. It also means a competent competitor can implement the
protocol. That trade is made deliberately: a protocol that only one party can implement is a
product with extra steps, and it will not be adopted by the institutions whose participation
determines whether any of this matters.

---

## 2. What is open — Apache-2.0

| Open | Where |
|---|---|
| Protocol specification | [`OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](OPEN_VEHICLE_IDENTITY_PROTOCOL.md) |
| Entity schemas | [`../protocol/schemas/`](../protocol/schemas/) |
| Event vocabulary | [`../protocol/events/`](../protocol/events/) |
| Credential profile (VC / DID) | [`../protocol/credentials/`](../protocol/credentials/) |
| Verification specification | [`../protocol/verification/`](../protocol/verification/) |
| Trust model | [`TRUST_MODEL.md`](TRUST_MODEL.md) |
| Privacy architecture | [`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md) |
| Anchoring architecture | [`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md) |
| Reference implementation | [`../reference/`](../reference/) |
| Database schema | [`../database/schema.sql`](../database/schema.sql) |
| Operator tooling | [`../ops/`](../ops/) |
| Test suite | [`../tests/`](../tests/) |
| SDKs and API contracts | **PLANNED** |
| Interoperability rules | [`../protocol/README.md`](../protocol/README.md) |

Apache-2.0: permissive, patent-granting, and familiar to the institutional legal departments
whose sign-off adoption depends on. A copyleft licence would have made institutional
adoption meaningfully harder for no benefit that matters here — the goal is implementations,
not derivative-work control.

---

## 3. What is controlled, and why

Openness is not the same as publishing everything. Four categories stay closed, each for a
reason that is not commercial convenience:

| Controlled | Reason |
|---|---|
| **Private citizen data** | It is not IDauto's to publish. Non-negotiable. |
| **Security-sensitive fraud detection rules** | Publishing exact thresholds and heuristics hands an evasion manual to the people the rules exist to catch. The *categories* of detection are published (see [`../protocol/verification/`](../protocol/verification/) and the `Anomaly` schema); the tuned parameters are not. |
| **Commercial analytics** | Aggregate market intelligence is a product, not protocol. |
| **Hosted service operations** | Infrastructure configuration, credentials, deployment topology. |
| **Enterprise integrations** | Bilateral, often under NDA. |

The fraud-rules exception is the uncomfortable one, and it is worth being precise about its
limits: what stays closed is *tuning*, not *mechanism*. Anyone can see that duplicate
evidence, mileage regression and chronology conflicts are detected, and can implement their
own detectors. What is withheld is the specific thresholds at which IDauto's deployment
flags them. A reader who thinks that is a rationalisation for opacity has a fair point to
press, and the boundary is deliberately narrow so it can be argued about concretely.

---

## 4. Protocol, brand and service are three separate things

| Layer | Governs | Licence |
|---|---|---|
| **Protocol** | Schemas, specifications, reference implementation | Apache-2.0 — fork it, implement it, compete with it |
| **Brand** | The IDauto name, marks and visual identity | Not licensed. See [`../GOVERNANCE.md`](../GOVERNANCE.md) |
| **Hosted service** | The operated deployment | Commercial terms |

A fork may implement the protocol. It may not call itself IDauto. The distinction protects
users from a fork that implements the protocol badly while carrying the name that is
supposed to mean something.

---

## 5. Contribution

Rules in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Two that are strategy rather than
process:

- **Protocol changes are governed differently from code changes.** A schema change breaks
  every implementation; a bug fix does not. Protocol changes go through
  [`../GOVERNANCE.md`](../GOVERNANCE.md)'s change process.
- **Contributions must not weaken privacy or trust invariants.** A change that adds an owner
  column, lets a client supply a trust level, allows silent overwriting of history, or
  renders an anchor as verification is rejected on principle, regardless of quality.

---

## 6. Ecosystem — what does not exist yet

Stated as a gap list rather than a roadmap, because none of it is built:

| Missing | Consequence |
|---|---|
| SDKs (JS, Python, PHP) | Every integrator writes their own client |
| Published JSON-LD context at `https://idauto.org/protocol/0.1.0/context.jsonld` | The VC examples in the credential profile do not resolve |
| Conformance test suite | "Conforming implementation" is currently unverifiable |
| Independent proof verifier | Anchoring's trustlessness claim is unexercised |
| Public issue tracker conventions, RFC process | Governance is a document, not yet a practice |

An "open protocol" with none of these is a published specification, which is a real but
smaller thing. Calling it an ecosystem before the conformance suite exists would be
overclaiming.

---

## 7. Implementation status

| Element | Status |
|---|---|
| Apache-2.0 licence | **IMPLEMENTED** |
| `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md` | **IMPLEMENTED** |
| Protocol schemas published | **IMPLEMENTED** (draft version) |
| Reference implementation published | **IMPLEMENTED** |
| Protocol versioning policy | **SPECIFIED** |
| SDKs | **PLANNED** |
| JSON-LD context published | **PLANNED** |
| Conformance suite | **PLANNED** |
| Independent verifier | **PLANNED** |
| Public RFC process | **PLANNED** |
