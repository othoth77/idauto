# Strategic Evolution — 2026-08-18

**Type:** decision record. Documentation only; no implementation is claimed by this file.
**Applies from:** the standalone repository's first commit.

This records the strategic decisions taken on 2026-08-18, at the point ID Auto was extracted
from the Mythos OS monorepo into `othoth77/idauto`. It states what changed, what did not,
and — where a decision closes off an option — why.

---

## 1. What did not change

Worth stating first, because a strategy document that appears to restart a project
misrepresents it.

The IDA-0 through IDA-3 baseline is **preserved, not rebuilt**: the 24-table PostgreSQL
schema, the observation-first capture model, the three access scopes, the privacy contract,
the read/write API with atomic audit logging, content-addressed media storage, the ingestion
service, rate limiting, the review queue, the off-host backup tooling, and 601 test
assertions across 13 suites. All of it moved intact and all of it still passes.

The founding privacy constraint is unchanged and remains non-negotiable:

> Public records must never expose owner name, address, phone number, national ID,
> insurance identity, or any other protected personal information.

The known blockers moved with the code and are not quietly dropped: real authentication is
**BLOCKED**, and every legal-review item remains open. (Off-host backup was reported blocked
in this document's first draft; a completeness audit the same day found it had been executed
and restore-verified on 2026-08-14. Corrected — see [`ROADMAP.md`](ROADMAP.md) IDA-3F.)

---

## 2. Repositioning

**Before:** ID Auto — a progressively enriched vehicle intelligence platform for Tunisia,
built as a product inside the Mythos ecosystem.

**After:** IDauto — an **open vehicle identity and history protocol**, with a reference
implementation, deployable by anyone, whose first deployment is Tunisia.

The change is not cosmetic. A platform's value is the data it accumulates, which makes
enclosure rational: the more you hold and the less you share, the stronger you are. A
protocol's value is the number of parties that implement it, which makes openness rational.
Those two strategies pull in opposite directions on nearly every design decision — data
portability, schema publication, verification independence, whether a competitor can read
your passports — so they cannot both be pursued. This picks one.

### Consequences accepted

- IDauto cannot rely on data lock-in for defensibility. Its moat has to be the network and
  the quality of verification, not the exit cost.
- The schemas, the verification rules and the reference implementation are published, so a
  competent competitor can implement the protocol. That is the intended outcome.
- Revenue must come from services around the protocol, never from access to truth
  (§4, and [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md) §5).

---

## 3. The seventeen decisions

Recorded as decisions, each with the reasoning where it is not self-evident.

### 3.1 Citizen-first registration
Any citizen can create a vehicle passport. No garage, dealer, insurer or authority has to
sponsor them.

*Why:* a professional-first system reaches vehicles that professionals already see, which
excludes exactly the older, informally-maintained vehicles whose history is hardest to
establish and most valuable to surface. It also makes the platform's coverage a function of
professional adoption, which is the slowest variable to move.

### 3.2 Free basic registration
Registration, the core passport and the QR representation are free, permanently.

*Why:* the network effect requires volume, and a fee at registration is a tax on the
behaviour the whole system depends on. It also makes coverage a function of ability to pay,
which is both bad product design and, in a market where vehicle history disproportionately
matters to lower-income buyers, bad for the stated purpose.

### 3.3 IDauto Vehicle ID
A protocol-owned identifier, independent of VIN, plate and owner identity.

*Why:* every existing candidate identifier fails. Plates change and are reassigned. VINs are
mis-stamped, restamped, cloned and unknown for many older vehicles. Owner identity is
personal data and changes on every sale. An identifier that survives all three is a
prerequisite for history that survives all three. Specification:
[`OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](OPEN_VEHICLE_IDENTITY_PROTOCOL.md) §2.1.

### 3.4 Digital Vehicle Passport
The vehicle's lifecycle record: what it is, what has happened to it, what backs each claim.

### 3.5 Evidence-first architecture
Every claim carries source, evidence, observation, confidence, verification status,
timestamp, and issuer where applicable.

*Why:* this is the decision the rest of the design hangs from. A system that stores
conclusions without provenance cannot be audited, cannot be corrected without losing
history, and cannot distinguish a manufacturer's record from a seller's assertion. Storing
provenance is more expensive in every dimension — schema, API, UI, cognitive load — and it
is the only thing that makes the output worth anything.

### 3.6 Trust ladder T0–T4
T0 self-declared · T1 documented · T2 professionally verified · T3 institutional ·
T4 cryptographically anchored. **Immutable does not mean true**, stated explicitly and
enforced by keeping T4 orthogonal to T0–T3. Specification:
[`TRUST_MODEL.md`](TRUST_MODEL.md).

### 3.7 Professional issuers
Garages, insurers, fleet operators, inspectors, dealers and authorised institutions, each
with a verifiable identity.

### 3.8 AI verification, bounded
AI may OCR, extract, and detect anomalies, chronology conflicts, duplicate evidence,
suspicious mileage and document inconsistencies. AI **must not** declare fraud or legal
guilt.

*Why the hard line:* an anomaly is a statistical signal about records; fraud is a legal
finding about people. A system that lets the first print the second will be wrong about real
people, at scale, with a permanent record. The output of detection is therefore an
`Anomaly` routed to human review, worded to describe the observation and not the conclusion.

### 3.9 QR
Every passport has a QR representation, encoding a resolvable IVID reference only — never
personal data, never a bearer token.

### 3.10 Ownership transfer
Identity and history survive the transfer. Owner personal data stays separated. A new holder
cannot delete, hide, edit or reset prior history.

*Why:* if history resets on sale, the system is worthless precisely at the transaction it
exists to inform.

### 3.11 Privacy
Public: permitted vehicle-level information. Private: owner identity, contact details,
sensitive documents, precise movement and location, raw capture. **Personal data never on a
public blockchain** — absolute, no configuration. Specification:
[`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md).

### 3.12 W3C compatibility
Verifiable Credentials and DIDs. No proprietary identity primitive unless unavoidable, and
each unavoidable one documented with its reason.

*Why:* the passport is only useful if verifiable outside IDauto. A proprietary signature
format makes every external integration a bilateral negotiation instead of a library call.

### 3.13 Blockchain
Chain-neutral, optional at protocol level, used for integrity and anchoring, never the
operational database. Record → hash → Merkle batch → anchor, not one transaction per event.
Specification: [`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md).

*Why batching, specifically:* per-event anchoring makes cost scale with citizen activity and
turns the public ledger into a timing side-channel over individual vehicles. It is a privacy
decision before it is a cost decision.

### 3.14 No mandatory token
No cryptocurrency, token, NFT or DAO is required for anything. A chain whose use requires
holding a speculative asset is disqualified on that ground alone.

*Why:* a citizen registering a vehicle must never need to acquire a volatile asset first,
and a public-interest record must not have its availability coupled to a token's price.

### 3.15 Open protocol
Open source: schemas, protocol, verification specification, reference implementation, SDK
and API contracts, interoperability rules. Controlled: private citizen data,
security-sensitive fraud rules, commercial analytics, hosted services, enterprise
integrations. Specification: [`OPEN_SOURCE_STRATEGY.md`](OPEN_SOURCE_STRATEGY.md).

### 3.16 Network effect
```
Citizen → Vehicle Passport → Garage → Verified Maintenance
        → Buyer → New vehicle → More users
```
Specification: [`GO_TO_MARKET.md`](GO_TO_MARKET.md).

### 3.17 Business model
Free citizen tier; professional subscriptions; verification services; reports; API;
enterprise; integrations. **Truth and verification status are never monetised.**
Specification: [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md).

---

## 4. The line that constrains the business model

Two things IDauto will not sell, ever:

- **A trust level.** Paying for a verification *service* is legitimate — inspection,
  document review, issuer onboarding all cost real money to perform. Paying for a *level* is
  not. The moment a T-level is purchasable, the ladder measures willingness to pay rather
  than corroboration, and every downstream user has been defrauded.
- **Suppression.** No party can pay to hide, delay, downgrade or remove an adverse record.
  If that is purchasable, the passport is worthless exactly where it matters.

These are recorded here because they are the decisions most likely to come under commercial
pressure later, and the pressure will arrive with a plausible-sounding framing.

---

## 5. What the evolution does not resolve

Stated plainly, because a strategy document that lists only wins is not a strategy document.

1. **Real authentication is still BLOCKED.** Citizen-first registration requires
   multi-user auth that does not exist. Repositioning does not create it; it changes the
   answer from "integrate a Mythos service" (which never existed) to "build it on W3C
   primitives" — which is IDA-7 and is real work.
2. **Legal review is still open.** Public capture, GPS collection, public plate lookup,
   registration-certificate OCR and contributor consent are all unreviewed. No public
   surface may be exposed until they are.
3. **There is no backup *schedule*.** A verified off-host copy of the database exists
   (2026-08-14) and the gate is closed, but one batch is not a regime, and the media store
   has no verified off-host copy. Both must be addressed before real evidence accumulates.
4. **Professional adoption is unproven.** The whole growth loop depends on garages
   recording work. Nothing here demonstrates they will, and §3.1's citizen-first choice
   reduces but does not remove that dependency.
5. **Governance of an open protocol is not a solved problem.** [`GOVERNANCE.md`](../GOVERNANCE.md)
   describes a benevolent-maintainer model, which is honest about where the project is and
   inadequate for where it wants to be.
6. **Part identity is deferred to IDA-9** and depends on manufacturer participation that has
   not been sought.

None of these is closed by this document. Recording them is the point.

---

## 6. Roadmap impact

The roadmap extends from IDA-0…IDA-6 to IDA-0…IDA-9. Completed stages keep their completed
status and their original scope; the new stages are additive. Full detail, with per-stage
status tags, in [`ROADMAP.md`](ROADMAP.md).

| | Stage | Change |
|---|---|---|
| IDA-0…IDA-3 | Foundation → community ingestion | **Unchanged.** Preserved as completed. |
| IDA-4 | Was *Fixpert Smart Gate*; now **Citizen Vehicle Passport** | Smart Gate moves to IDA-6 with its scope intact |
| IDA-5 | Was *Professional partner network*; now **Professional Issuers / Garage Network** | Reframed around verifiable issuer identity |
| IDA-6 | Was *National enrichment / launch*; now **AI Trust & Anomaly Engine** | Absorbs Smart Gate; national enrichment moves to IDA-9 |
| IDA-7 | **New** — Verifiable Credentials / DID interoperability | Also where real auth is finally resolved |
| IDA-8 | **New** — Blockchain anchoring / Merkle proofs | Gated on IDA-7 and on a durable backup regime |
| IDA-9 | **New** — Open protocol, ecosystem, internationalisation, part identity | |
