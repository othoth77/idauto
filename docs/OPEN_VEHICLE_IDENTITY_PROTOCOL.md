# Open Vehicle Identity Protocol (OVIP)

**Protocol version:** `0.1.0-draft`
**Status:** SPECIFIED — normative for future implementation. Parts of it are already
implemented in `reference/` and `database/schema.sql`; §14 states exactly which.
**Last updated:** 2026-08-18

This document is the formal protocol specification. It defines the entities, their
identifiers, their lifecycle rules, and the invariants an implementation must not break.
Strategy lives in [`ROADMAP_EVOLUTION_2026-08-18.md`](ROADMAP_EVOLUTION_2026-08-18.md);
trust semantics in [`TRUST_MODEL.md`](TRUST_MODEL.md); privacy in
[`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md); anchoring in
[`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md). Machine-readable schemas are in
[`../protocol/`](../protocol/README.md).

Key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** are used per
RFC 2119.

---

## 1. What the protocol is for

Vehicle history is currently held in unconnected silos: a workshop's job cards, an
insurer's claim files, an inspector's reports, a registry's records, a seller's word. Each
silo is internally trusted and externally unverifiable. A buyer cannot check any of it, and
the party with the strongest incentive to misrepresent the vehicle is the one narrating it.

OVIP does not solve this by building a bigger silo. It defines a way to state a fact about a
vehicle such that the statement carries its own provenance, and a way to verify that
statement without trusting the party that relayed it.

The protocol's obligation is therefore narrow and strict:

> Record **who** claimed **what**, **when**, on **what evidence**, and **how strongly** it is
> corroborated — and never collapse those five things into a single "verified" flag.

---

## 2. Identifiers

### 2.1 IDauto Vehicle ID (`IVID`)

The protocol's own identifier for a vehicle.

```
IVID = "ivid:" <version> ":" <base32-crockford payload> ":" <check>
example: ivid:1:7K2QF9WBN4TXJ0R3:HN
```

Normative properties:

- An IVID **MUST** be independent of the VIN, of any registration plate, and of any owner
  identity. None of the three may be derivable from it.
- An IVID **MUST NOT** be derived by hashing a VIN or plate. A hash of a low-entropy,
  enumerable identifier is a lookup table, not a pseudonym.
- An IVID **MUST** be issued at random with at least 80 bits of entropy, and carry a check
  symbol so a mistyped ID fails locally rather than resolving to a different vehicle.
- An IVID **MUST** survive re-plating, resale, re-registration, export and import.
- An IVID **MUST NOT** be reused, ever, including after a vehicle is scrapped.
- Two IVIDs later found to denote one physical vehicle are resolved by **merge**
  (§9.4), never by deleting one of them.

VIN, when known, is a **Fact** about the vehicle (`fact_key = "vin"`), held at restricted
scope, with its own evidence and trust level — exactly like every other claim. It is not the
vehicle's identity and **MUST NOT** be treated as one.

**Implementation note.** `idauto_vehicles.internal_ref` (`VARCHAR(40) UNIQUE`) is the
column that carries the IVID. It exists and is populated today with a
deployment-local reference format; the formal IVID format above is **SPECIFIED, not yet
implemented**, and adopting it is an IDA-4 task with a documented migration.

### 2.2 Issuer identifiers

An Issuer is identified by a DID (`did:web`, `did:key`, or another method the deployment
accepts). See §7 and [`../protocol/credentials/README.md`](../protocol/credentials/README.md).

### 2.3 Part identifiers (`IPID`)

Parts get their own identifiers with the same properties as an IVID. See
[`PART_IDENTITY.md`](PART_IDENTITY.md).

---

## 3. Canonical entities

| Entity | Purpose | Mutability |
|---|---|---|
| `Vehicle` | The subject. Holds the IVID and a small set of derived summary attributes. | Summary attributes are derived; never authored directly |
| `VehicleID` | The IVID and its issuance record | Immutable |
| `Plate` | A registration assignment over a time interval | Append-only; intervals are closed, never deleted |
| `Observation` | A single act of perceiving a vehicle (scan, upload, manual entry, gate detection) | Immutable once written |
| `Event` | Something that happened to the vehicle (service, inspection, damage, transfer, part change) | Immutable once written; corrected by superseding |
| `Fact` | A claim about an attribute of the vehicle at a point in time | Append-only with supersession |
| `Evidence` | The artefact backing a Fact or Event | Immutable; content-addressed |
| `Document` | A structured evidence subtype (registration certificate, invoice, inspection report) | Immutable |
| `Part` | A component with its own identity and lifecycle | See `PART_IDENTITY.md` |
| `Issuer` | An identified party able to sign claims | Mutable status; history retained |
| `Credential` | A signed statement by an Issuer, W3C VC-shaped | Immutable; revocable by status |
| `Verification` | The record of a verification act and its outcome | Immutable |
| `OwnershipTransfer` | A change of holder | Append-only |
| `TrustAssessment` | The computed T-level of a Fact/Event at a point in time | Derived; recomputable; snapshots retained |
| `BlockchainAnchor` | A Merkle root committed to an external ledger | Immutable |

Field-level definitions are in [`../protocol/schemas/`](../protocol/schemas/).

---

## 4. The critical invariant

> **Never silently overwrite a historical fact.**

Normatively:

1. A consequential record — `Fact`, `Event`, `Observation`, `Evidence`, `Credential`,
   `OwnershipTransfer`, `Verification`, `Plate` assignment — **MUST NOT** be updated in
   place in a way that changes what it asserted.
2. A correction **MUST** be expressed as a new record that supersedes the old one, carrying
   `supersedes` (the prior record's id), `superseded_reason`, and its own provenance.
3. The superseded record **MUST** remain retrievable and **MUST** be marked inactive rather
   than removed.
4. Deletion is permitted only for **erasure obligations** under data-protection law
   (§10.3), and an erasure **MUST** leave a tombstone recording that an erasure occurred,
   its legal basis, and its date — never a silent gap.
5. An implementation **MUST NOT** expose an API that lets a caller edit a historical claim.
   The only write verbs on history are *append* and *supersede*.

**Implementation note.** This is already enforced in the live schema:
`idauto_vehicle_facts.is_active` marks supersession rather than deleting, every mutation
runs through one shared `withAudit()` transaction that writes an audit row in the same
transaction or rolls both back, and no route updates a fact's value in place.

---

## 5. Provenance envelope

Every claim-bearing record **MUST** carry:

| Field | Meaning |
|---|---|
| `source` | Which channel produced it (`manual_admin`, `public_upload`, `professional_scan`, `smart_gate`, `official_import`, …) |
| `evidence_refs` | Zero or more Evidence ids. Zero is legal, and forces T0 |
| `observation_id` | The Observation this claim was extracted from, where one exists |
| `confidence` | `0.0`–`1.0`. The *extractor's* confidence, never a trust level |
| `verification_status` | `unverified` · `pending_review` · `verified` · `conflict` · `rejected` |
| `asserted_at` | When the claim was made |
| `observed_at` | When the underlying fact was observed, if different |
| `issuer` | The Issuer DID, when the claim is issuer-signed |
| `trust_level` | Derived T0–T4 (§6). Derived, never author-supplied |

`confidence` and `trust_level` are different quantities and **MUST NOT** be conflated. An
OCR engine can be 0.99 confident it read a number correctly off a document that is
fraudulent. Confidence measures extraction fidelity; trust measures corroboration.

**Server-derived fields.** `source`, `issuer`, `trust_level`, `confidence`,
`verification_status` and any actor reference **MUST** be derived by the server. A payload
that supplies one **MUST** be rejected with `400` naming every offending field. Silently
ignoring a spoofed privilege field hides an attack instead of surfacing it. *(Already
implemented — `reference/ingestion.js` rejects all seven, one test per field.)*

---

## 6. Trust ladder

Summarised in [`TRUST_MODEL.md`](TRUST_MODEL.md), which is normative. In brief:
**T0** self-declared · **T1** documented · **T2** professionally verified ·
**T3** institutional · **T4** cryptographically anchored.

Two rules the rest of the protocol depends on:

- **T4 is orthogonal.** It describes the *record's* tamper-evidence, not the *claim's*
  truth. A T0 claim MAY be anchored; it remains a self-declaration. Implementations
  **MUST** surface the substantive level and the anchoring state as two separate values,
  and **MUST NOT** display an anchor as if it were verification.
- **Trust is computed, never asserted.** A `TrustAssessment` is recomputable from the
  record and its evidence. If recomputation disagrees with a stored value, the stored value
  is wrong.

---

## 7. Issuers

An Issuer is a garage, insurer, fleet operator, inspector, dealer, or authorised
institution.

- An Issuer **MUST** have a verifiable identity — a DID, with a resolvable document and a
  documented onboarding check tying it to a real, identifiable legal entity.
- An Issuer **MUST** be able to sign claims about vehicles it has directly handled, and
  **SHOULD NOT** issue claims about vehicles it has not.
- An Issuer's credentials **MUST** remain verifiable after the Issuer's status changes.
  Suspension affects new issuance, not the checkability of past signatures.
- Revocation **MUST** be expressible per credential (status list) and **MUST NOT** be
  implemented by deleting the credential.
- An Issuer's trust class (T2 professional vs T3 institutional) is a property of the
  onboarding evidence, **MUST** be recorded, and **MUST** be re-assessable.

---

## 8. AI verification — bounds

AI **MAY**:

- OCR documents and plates
- extract structured records from unstructured evidence
- identify anomalies (mileage regressions, implausible intervals, geographic impossibilities)
- detect chronology conflicts between records
- detect duplicate or re-used evidence (perceptual and cryptographic hashing)
- detect suspicious mileage progression
- detect document inconsistencies (layout, font, metadata, arithmetic)

AI **MUST NOT**:

- declare fraud
- assert legal guilt or liability
- move a record's trust level upward on its own
- reject a citizen's submission with no human-reviewable path
- act as the sole basis for an adverse decision about a person

Normative shape: an AI finding is an **`Anomaly`** record attached to the claim. It carries
a type, a severity, the evidence it examined, and the model/version that produced it. It
routes the claim to review. It never mutates the claim. Anomaly severity **MUST** be
presented in language that describes the observation ("recorded mileage decreases between
two records") and not the conclusion ("odometer fraud").

Rationale: an anomaly is a statistical signal about records; fraud is a legal finding about
people. A system that lets the first print the second will be wrong about real people, and
will be wrong at scale.

---

## 9. Lifecycle rules

### 9.1 Registration

1. A citizen presents a vehicle. The system creates a `Vehicle` and issues an `IVID`.
2. The initial claims are T0 unless evidence is attached at creation.
3. Registration is free and **MUST NOT** be gated on payment, on a professional sponsor, or
   on institutional verification.
4. A duplicate-detection pass runs; a suspected duplicate is routed to review, and **MUST
   NOT** be auto-merged.

### 9.2 Observation → Fact

The observation-first flow (already implemented):

1. Every capture creates an `Observation` **first**.
2. The system searches for an existing vehicle by plate, VIN or other evidence.
3. If found: attach the observation, extract new facts, record conflicts explicitly.
4. If not found: create a new vehicle with this as its first observation.
5. A conflicting fact **MUST** be recorded as a conflict, not resolved by overwriting.

### 9.3 Ownership transfer

- Vehicle identity and history **MUST** survive the transfer intact.
- The `OwnershipTransfer` record references holders by **pseudonymous holder reference**,
  never by embedded personal data.
- A new holder **MUST NOT** be able to delete, hide, edit, or reset prior history.
- A new holder **MUST** gain access to the vehicle-level record, and **MUST NOT** gain
  access to the previous holder's personal data.
- Where law grants a former holder erasure rights over their *personal* data, that erasure
  removes the holder record, not the vehicle's history (§10.3).

### 9.4 Merge

When two IVIDs are found to denote one vehicle:

- Both records are retained. One is marked `merged_into` the other.
- Claims are carried across with their original provenance intact — a merge **MUST NOT**
  upgrade or downgrade any claim's trust level.
- The merge is itself an `Event`, with its own evidence and actor.
- A merge **MUST** be reversible, because merges are sometimes wrong.

### 9.5 End of life

Scrapping, export or write-off is an `Event`. The passport is closed, not deleted. A closed
passport remains verifiable — a scrapped vehicle's identity reappearing is precisely the
signal a buyer needs.

---

## 10. Privacy invariants

Normative here, elaborated in [`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md).

1. **Separation.** Vehicle data and person data are separate stores with no join path
   available to an ordinary caller. *(Already enforced: no owner-PII column exists on any
   table in `database/schema.sql`.)*
2. **Public surface.** Only vehicle-level permitted information may be public. Owner
   identity, contact details, sensitive documents, precise movement and location, and raw
   capture material **MUST NOT** be.
3. **Erasure.** Personal data must be erasable without destroying the vehicle record. This
   is why the vehicle record never embeds personal data: erasure removes a holder record
   and leaves a tombstone (§4.4).
4. **No personal data on a public ledger.** Anchoring commits hashes of batched records
   only. Never a payload, never an identifier that resolves to a person, never a hash of a
   low-entropy personal value. This constraint is absolute and has no exception.

---

## 11. Blockchain position

Normative rules; architecture in [`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md).

- Anchoring **MUST** be optional at protocol level. A conforming deployment with no chain
  integration is fully conforming.
- Anchoring **MUST** be chain-neutral. No chain, token or vendor may be named in the
  protocol's required interfaces.
- The ledger **MUST NOT** be the operational database. All reads and writes go to the
  operational store; the chain holds commitments only.
- The required pattern is:

  ```
  Record → canonical serialisation → hash → Merkle batch → single anchor
  ```

  One transaction per event is **NOT** the model: it does not scale, it leaks a timing
  side-channel, and it makes cost a function of a citizen's activity.
- An anchor proves existence-before-time and non-alteration-since. Implementations
  **MUST NOT** describe it as proving anything else.

---

## 12. W3C compatibility

- Issuer-signed claims **MUST** be expressible as W3C Verifiable Credentials.
- Issuer identity **MUST** be expressible as a W3C DID.
- Revocation **SHOULD** use a standard status-list mechanism.
- New identity primitives **MUST NOT** be invented where a W3C primitive fits. Where one is
  unavoidable, the deviation and its reason **MUST** be documented in
  [`../protocol/credentials/README.md`](../protocol/credentials/README.md).

The vehicle passport is modelled as a **credential subject**, not as a credential. A
passport is an aggregation of many claims from many issuers over time; a VC is one issuer's
signed statement at one time.

---

## 13. Versioning and conformance

- The protocol uses semantic versioning. Breaking changes to a schema require a major
  version.
- Every protocol document and schema carries an explicit version.
- A conforming implementation **MUST** state which protocol version it implements and which
  optional capabilities (anchoring, VC issuance, part identity) it supports.
- Unknown fields **MUST** be preserved on round-trip, not dropped.
- Governance of protocol changes is in [`../GOVERNANCE.md`](../GOVERNANCE.md).

---

## 14. Implementation status — what is real today

Stated precisely, because the rest of this document is a specification and specifications
are easy to mistake for systems.

| Protocol element | Status |
|---|---|
| Observation-first capture | **IMPLEMENTED** |
| Append/supersede semantics for facts (`is_active`) | **IMPLEMENTED** |
| Atomic audit logging on every mutation | **IMPLEMENTED** |
| Server-derived provenance fields; spoofed fields rejected | **IMPLEMENTED** |
| Evidence records, content-addressed media | **IMPLEMENTED** |
| Access scopes (public / professional / restricted) | **IMPLEMENTED** |
| No owner-PII columns anywhere | **IMPLEMENTED** and test-enforced |
| Review queue and conflict recording | **IMPLEMENTED** |
| Rate limiting | **IMPLEMENTED** |
| Vehicle identifier column (`internal_ref`) | **IMPLEMENTED**; formal IVID format **SPECIFIED** |
| Trust ladder T0–T4 as a computed assessment | **SPECIFIED** |
| Issuer registry, DIDs, Verifiable Credentials | **SPECIFIED** |
| AI anomaly engine | **SPECIFIED** |
| Merkle batching and chain anchoring | **SPECIFIED** — no chain code exists in this repository |
| Part identity | **SPECIFIED** as a future extension |
| Citizen self-registration surface | **SPECIFIED** — blocked on legal review, off-host backup and real auth |
| Public API surface | **NOT DEPLOYED** — no public endpoint exists |
