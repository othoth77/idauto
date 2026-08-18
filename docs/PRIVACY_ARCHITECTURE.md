# Privacy Architecture

**Status:** partly IMPLEMENTED and test-enforced, partly SPECIFIED. §9 states which.
**Last updated:** 2026-08-18
**Predecessors:** the privacy contract established at IDA-0/IDA-1 in
[`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) and [`CAPTURE_PIPELINE.md`](CAPTURE_PIPELINE.md), which
this document preserves rather than replaces.

---

## 1. The founding constraint

> **Public records must never expose owner name, address, phone number, national ID,
> insurance identity, or any other protected personal information.**

This was non-negotiable at IDA-0 and remains non-negotiable. It is enforced structurally,
not by policy: `idauto_vehicles` and `idauto_plates` contain **no owner columns at all**,
and there is no join path from a plate number to a person anywhere in the schema.

A constraint enforced by absence cannot be forgotten in a code review, cannot be bypassed by
a misconfigured role, and cannot be quietly relaxed by a later feature. That is why it is
implemented this way rather than as a permission rule.

**Verified, not asserted:** the schema test asserts zero owner-PII columns across all
tables, and it runs in the suite on every change.

---

## 2. Two subjects, deliberately not joined

IDauto describes **vehicles**. Vehicles are not people. The conflation of the two is what
makes vehicle databases dangerous.

| | Vehicle record | Person record |
|---|---|---|
| Subject | A physical vehicle | A citizen, contributor or professional |
| Identifier | IVID | Pseudonymous reference |
| Lifetime | Decades; survives every owner | The person's relationship with the service |
| Erasable | No — history is the product | Yes — on request, per law |
| Public surface | Permitted vehicle-level attributes | None, ever |

The link between them — "this person currently holds this vehicle" — is a **separate,
access-controlled association**, not a column on the vehicle. Severing it (on sale, or on an
erasure request) leaves the vehicle record whole.

---

## 3. Public / private boundary

**Public — vehicle-level permitted information only:**

- Plate number, colour, body type
- Make/model where verified, year/fuel where from a trusted source
- Confidence and verification status
- Governorate / region (coarse only)

**Never public:**

| Category | Examples |
|---|---|
| Owner identity | Name, address, phone, national ID, insurance identity |
| Sensitive documents | Registration certificate scans, invoices, claim files |
| Precise movement / location | Exact GPS, exact capture time, movement history |
| Raw capture | Original images, plate crops, OCR output, image hashes |
| Contributor identity | Who submitted what |
| Restricted attributes | VIN, engine number |
| Internal signals | Confidence internals, source identity, camera source, correction history |

**Access scopes** (implemented today as `public` / `professional` / `mythos_private`):

- **Public** — any caller within rate limits. Permitted vehicle-level attributes only.
- **Professional** — verified professional subscribers. Approved technical data plus their
  own service events. One organisation never sees another's private data.
- **Restricted** — operator-only. Raw captures, exact timestamps, GPS, OCR, source
  identity, correction history. **Every access is audit-logged.**

> **Naming note.** The third scope's stored value is the string `mythos_private`, inherited
> from the Mythos monorepo where IDauto was built. It is ID Auto's own scope vocabulary,
> persisted in a live database and in every access-control code path. Renaming it is a
> breaking data migration with no behavioural benefit, so it is retained. Documentation and
> the protocol layer call it **restricted**; the two are the same scope. A rename is a
> candidate for the IDA-7 protocol alignment, not a migration blocker.

---

## 4. Data minimisation at capture

Enforced at the ingestion boundary, before storage:

- IP addresses are **hashed** before storage (`ip_hash`, 64-char hex). No dotted or colonned
  address is ever persisted. *Verified on live data: every stored value is a hex digest.*
- `ip_hash` is stored on the **submission envelope only** — never propagated to the
  observation, and never written into an audit row. *Verified: zero observations and zero
  audit rows carry one.*
- Anonymous submissions create **no contributor record** and leave `actor_ref` and
  `contributor_id` NULL. Anonymity is the absence of a record, not a record labelled
  "anonymous".
- Ingestion-created media defaults to **restricted** scope. Widening is explicit, never
  default.
- Precise location lives in its own table (`idauto_observation_locations`), restricted in
  its entirety, and is never joined in a public query.
- Owner personal data encountered during capture (for example on a registration certificate)
  is **routed to its legitimate controller or discarded** — never stored in the IDauto
  schema.

---

## 5. Blockchain and personal data

**Absolute rule: personal data never goes on a public blockchain.** No exception, no
configuration flag, no enterprise tier.

Concretely, an anchor **MUST NOT** contain:

- any payload, plaintext or encrypted
- any identifier that resolves to a person
- any hash of a low-entropy personal value (a hash of a plate, a phone number or a national
  ID is a lookup table with extra steps, not a pseudonym)
- any per-person or per-vehicle transaction pattern that reveals activity through timing

What an anchor contains is a **Merkle root over a batch of record hashes**, where each
record hash is salted with a per-record secret that is never published. See
[`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md) §5.

Batching is a privacy control before it is a cost control: one transaction per event turns
the public ledger into a timing side-channel over individual citizens' activity.

---

## 6. Erasure

Data-protection law grants erasure rights over **personal** data. Vehicle history is not
personal data about the vehicle's holder, and erasing it is neither required nor desirable —
a buyer's ability to see a vehicle's past cannot be extinguished by the seller.

The architecture makes both possible at once:

1. Personal data lives only in the person store.
2. Erasing a person removes the person record and the holder association.
3. The vehicle record is untouched. Claims that were attributed to that person become
   attributed to a pseudonymous, non-resolving reference.
4. A **tombstone** records that an erasure occurred, its legal basis and its date. Never a
   silent gap — a history with an invisible hole is a history that cannot be trusted.
5. Content-addressed evidence attributable to the erased person is removed from the media
   store; the evidence record survives as a tombstone stating that the artefact was erased.

**Anchored records and erasure.** A record whose hash is inside an anchored Merkle batch
cannot be un-anchored. This is precisely why anchors contain only salted hashes of
vehicle-level records and never personal data: there is nothing personal in the anchor to
erase. Anchoring anything personal would create an unerasable personal record, which is why
§5 is absolute.

---

## 7. Consent

- Consent is recorded as a first-class record (`idauto_consent_records`), with its scope,
  its basis, its timestamp and its withdrawal state.
- Consent for one purpose is never consent for another.
- Withdrawal is honoured going forward and recorded, not backdated.
- Public contribution requires a privacy notice in the languages of the deployment
  (Arabic + French for the Tunisian deployment).
- **LEGAL-REVIEW-REQUIRED.** The consent mechanism for public contribution, precise GPS
  collection, public plate lookup and registration-certificate OCR is specified but has not
  been legally reviewed. No public capture surface may be exposed until it has been. This
  is tracked in [`ROADMAP.md`](ROADMAP.md).

---

## 8. Surveillance boundary

ANPR and gate cameras make this a surveillance-capable architecture, so the limits are
stated rather than assumed:

- Movement events are **restricted scope in their entirety**, permanently. There is no tier
  at which movement history becomes public or professional.
- **Permanently out of scope:** public tracking of individual vehicles or persons, and
  exposure of individual movement history. This is a product boundary, not a phase.
- Camera deployment requires regulatory approval, visitor/employee disclosure, and a
  documented retention period before activation. All three are open
  **LEGAL-REVIEW-REQUIRED** items.
- Camera scope is explicit and minimal: at the first pilot site, one designated
  entrance/exit camera out of five on the premises. The other four are out of scope, and
  "out of scope" means no integration exists.

---

## 9. Implementation status

| Control | Status |
|---|---|
| Zero owner-PII columns in the schema | **IMPLEMENTED**, test-enforced |
| Three access scopes enforced at query level | **IMPLEMENTED** |
| Restricted-scope facts excluded from reads | **IMPLEMENTED** (no audit-on-read path exists yet, so restricted reads stay closed) |
| Audit row written atomically with every mutation | **IMPLEMENTED** |
| Real per-admin actor identity in audit rows | **IMPLEMENTED** (operator-provisioned token map) |
| IP hashing; `ip_hash` confined to submissions | **IMPLEMENTED**, verified on live data |
| Anonymous submissions create no contributor record | **IMPLEMENTED** |
| Location isolated in a restricted table | **IMPLEMENTED** |
| Media restricted by default | **IMPLEMENTED** |
| Consent records table | **IMPLEMENTED** (schema); consent *flow* **SPECIFIED** |
| Person store / holder association separation | **SPECIFIED** — no person store exists yet |
| Erasure with tombstones | **SPECIFIED** — not implemented |
| Real multi-user authentication | **BLOCKED** — see [`ROADMAP.md`](ROADMAP.md) IDA-2E |
| Audit-on-read for restricted scope | **PLANNED** — required before any restricted read is exposed |
| Off-host backup of evidence | **BLOCKED** — tooling implemented, no off-host copy exists |
| Public capture surface | **BLOCKED** on legal review, off-host backup and real auth |
