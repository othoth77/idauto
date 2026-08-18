# Blockchain Architecture

**Status:** **SPECIFIED — NOT IMPLEMENTED.** No chain integration, no wallet, no signing key,
no anchoring code and no chain dependency exists anywhere in this repository. Everything
below is design.
**Target stage:** IDA-8 · **Last updated:** 2026-08-18

---

## 1. Position

Blockchain is a **trust and integrity layer at the bottom of the stack**. It is not the
product, not the database, and not a requirement.

```
Product        Vehicle identity · Digital Vehicle Passport · verification
Protocol       Entities · evidence · trust ladder · credentials
Operational    PostgreSQL — every read and every write
Integrity      Hash · Merkle batch · anchor          ← optional, this document
```

An IDauto deployment with no chain integration whatsoever is **fully conforming**. Anchoring
adds one property — third-party-checkable tamper-evidence — to a system that already works
without it.

Stated plainly, because this is where comparable projects go wrong: putting vehicle records
on a chain does not make them true, does not make them complete, and does not make them
private. It makes them *unalterable*, which is only valuable once the record was worth
preserving. Getting evidence, provenance and issuer identity right is the hard part;
anchoring is the easy part, and doing the easy part first produces a permanent record of
unverified claims.

---

## 2. What anchoring is for

Exactly one purpose: **allowing a third party to detect that a record has been altered or
back-dated since it was anchored — without trusting IDauto.**

Without anchoring, "this service record was filed in March" rests on IDauto's own database.
An operator with database access could alter it. With anchoring, altering it is detectable
by anyone, including someone who distrusts IDauto entirely.

That is the whole benefit. It is real and worth having. It is also all of it.

### What anchoring does not provide

| Claim | Reality |
|---|---|
| "Anchored, therefore true" | No. See [`TRUST_MODEL.md`](TRUST_MODEL.md) §1. A false record anchors just as well as a true one. |
| "Anchored, therefore complete" | No. Anchoring says nothing about records that were never written. |
| "Anchored, therefore decentralised" | No. Operational data stays in one operational store. |
| "Anchored, therefore trustless" | No. The claim's trust still comes from its issuer and evidence. |

---

## 3. Non-negotiable constraints

1. **Chain-neutral.** The protocol names no chain, no token and no vendor. Any chain that
   can accept ~32 bytes with a durable, publicly-checkable timestamp qualifies. Swapping the
   chain **MUST NOT** require a protocol change.
2. **Optional at protocol level.** A conforming deployment MAY anchor nothing.
3. **Never the operational database.** Reads and writes never touch a chain. A chain outage
   **MUST NOT** degrade any user-facing function.
4. **No mandatory token.** No cryptocurrency, token, NFT or DAO is required to register a
   vehicle, issue a credential, verify a passport, or anchor a record. A chain whose use
   requires holding a speculative asset is disqualified on that ground alone.
5. **No personal data, ever.** See [`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md) §5.
   Absolute; no configuration can relax it.
6. **Anchoring costs are borne by the operator**, never passed to a citizen as a per-record
   fee. A citizen who cannot pay must not end up with a second-class record.

---

## 4. The pattern

```
Record
  → canonical serialisation (deterministic, versioned)
  → salted hash            (per-record salt, never published)
  → Merkle batch           (periodic, thousands of records per batch)
  → single anchor          (one transaction per batch)
  → inclusion proof        (issued to anyone who needs to verify one record)
```

**Not** one transaction per event. Per-event anchoring:

- costs a transaction per record, making cost scale with citizen activity;
- turns the public ledger into a **timing side-channel** — the pattern of transactions
  reveals when a vehicle was serviced, inspected or transferred, even if the payload is a
  hash;
- couples user-facing latency to chain confirmation times;
- makes chain congestion a product outage.

Batching fixes all four. One anchor covering ten thousand records costs one transaction,
reveals only that *some* records were written in that window, and confirms asynchronously.

### 4.1 Canonical serialisation

A record hashes to the same value everywhere or the scheme is useless. Requirements:

- deterministic field ordering
- explicit encoding for every type (no locale-dependent numbers or dates)
- a version tag inside the serialised form
- unknown fields preserved and included

The serialisation format is versioned independently, because changing it invalidates every
prior proof and therefore requires a migration in which old proofs remain verifiable under
the old version.

### 4.2 Salting

Each record hash is `H(salt ‖ canonical_bytes)` with a per-record salt held in the
operational store and never published.

Without a salt, a low-entropy record (a plate, a date, a mileage) is brute-forceable from
its hash: an attacker enumerates candidate records, hashes each, and matches. The Merkle
root would then leak record contents. The salt is released only alongside an inclusion proof
that the record's own subject or holder has chosen to share.

### 4.3 Inclusion proofs

To prove one record is in an anchored batch, IDauto issues:

- the record's canonical bytes
- its salt
- the Merkle path to the root
- the anchor reference (chain, transaction, block, timestamp)

A verifier recomputes the leaf hash, walks the path, compares to the on-chain root, and
checks the anchor's timestamp. **No trust in IDauto is required** at any step. This is the
only part of the design where the trustlessness claim is actually earned, and it is earned
by the proof, not by the anchor.

Proof verification **MUST** be implementable independently. A reference verifier is part of
the open-source deliverable so that no one has to take IDauto's word for an anchor.

### 4.4 Batch cadence

A trade-off, configurable per deployment:

| Cadence | Cost | Anchor latency | Timing leakage |
|---|---|---|---|
| Hourly | Higher | ≤ 1 h | Higher (narrow windows) |
| Daily | Low | ≤ 24 h | Low |
| Weekly | Lowest | ≤ 7 d | Lowest |

Default: **daily**. Records carry `anchor_status: pending | anchored | failed` so their
state is never ambiguous.

---

## 5. What is anchored

| Anchored | Not anchored |
|---|---|
| Facts and their provenance envelopes | Any personal data |
| Events (service, inspection, damage, transfer) | Raw media bytes |
| Evidence **references and content hashes** | Owner or holder identity |
| Issuer credentials and revocation-list roots | Precise location or movement |
| Ownership-transfer records (pseudonymous refs only) | Anything at restricted scope containing personal data |
| Supersession links | Rate-limit, session or operational state |

Evidence anchoring covers the **hash** of a document, never the document. That is sufficient:
anyone holding the document can prove it is the one that was anchored, and nobody who
doesn't hold it learns anything from the chain.

---

## 6. Chain selection — criteria, not a choice

No chain is selected. When IDA-8 is authorised, candidates are assessed against:

| Criterion | Requirement |
|---|---|
| Durability | Credible multi-decade persistence — a vehicle outlives most chains |
| Cost | Predictable, low, per-batch; not exposed to speculative asset prices |
| Token requirement | No requirement to hold a speculative asset (constraint 4) |
| Finality | Clear, documented finality semantics |
| Public verifiability | Anyone can check an anchor without a permissioned relationship |
| Neutrality | No single-vendor dependency; exit is possible |
| Energy | Proportionate to writing ~32 bytes per day |
| Jurisdiction | Compatible with the deployment's legal environment |

Multi-chain anchoring (the same root to more than one ledger) is supported by design and is
the recommended hedge against any single chain's failure. The protocol treats anchors as a
set, not a singleton.

---

## 7. Failure behaviour

| Failure | Behaviour |
|---|---|
| Chain unreachable | Records stay `pending`. No user-facing degradation. Batches queue. |
| Anchor transaction fails | Retried; batch is re-anchored. The root is unchanged, so no record changes. |
| Chain permanently abandoned | Existing anchors remain valid for their period. New batches anchor elsewhere. Records anchored to a dead chain keep their historical proof and are re-anchored going forward. |
| Salt store lost | Inclusion proofs for affected records become unissuable. Salts are therefore part of the backup set, and this is why off-host backup gates any real-evidence stage. |
| Merkle implementation bug | Caught by the independent reference verifier; a re-anchor with corrected serialisation supersedes, and both versions remain documented. |

---

## 8. Implementation gate

IDA-8 anchoring **MUST NOT** begin until all of the following are true:

1. Off-host backup is operational and restore-tested (currently **BLOCKED**).
2. Real authentication exists (currently **BLOCKED**).
3. Canonical serialisation is specified, versioned and independently implemented twice.
4. The salt store's backup and recovery path is tested.
5. Legal review confirms no personal data can reach an anchor under the deployment's law.
6. The independent proof verifier exists and is published.

Anchoring an incomplete or unverified record set early is worse than not anchoring: it
produces permanent, publicly checkable evidence of a system that was not ready.

---

## 9. Implementation status

**Nothing in this document is implemented.**

| Element | Status |
|---|---|
| Canonical serialisation | **SPECIFIED** |
| Salted record hashing | **SPECIFIED** |
| Merkle batching | **SPECIFIED** |
| Anchor submission | **SPECIFIED** — no chain client exists |
| Inclusion proofs | **SPECIFIED** |
| Independent verifier | **PLANNED** |
| Chain selection | **NOT STARTED** — criteria only |
| `src/blockchain/` | Empty placeholder — see [`../src/README.md`](../src/README.md) |

Content-addressed media storage (SHA-256 keyed) **is** implemented, and is the one piece of
integrity infrastructure that exists today. It is a local content-addressing scheme, not an
anchor, and it is not described as one anywhere in the code.
