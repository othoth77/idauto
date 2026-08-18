# Part Identity

**Status:** **SPECIFIED — future extension.** Not implemented, and not in the MVP. No part
table, part identifier or part API exists in this repository.
**Target stage:** IDA-9 (with an optional narrow slice at IDA-5) · **Last updated:** 2026-08-18

---

## 1. Why the protocol extends below the vehicle

A vehicle is not an atom. Over a twenty-year life its engine may be rebuilt, its gearbox
replaced, its traction battery swapped, its turbo changed twice. The questions that matter
most to a buyer, an insurer or a regulator are increasingly about the *components*, not the
shell:

- Is this the original engine, or one from a different vehicle?
- Has the traction battery been replaced, and with what?
- Are the brake components genuine, or counterfeit?
- Does this part's history line up with the vehicle's mileage?

A vehicle-only identity model cannot answer any of these. Part identity is the natural
extension of the same primitives — identity, evidence, provenance, trust — one level down.

```
Vehicle
 ├── Engine
 ├── Gearbox
 ├── Battery
 ├── Turbo
 ├── Brakes
 └── Other parts
```

---

## 2. Scoping honesty

Part identity is **deliberately not** an MVP concern, for three reasons worth stating rather
than discovering later:

1. **Data availability.** Part-level provenance depends on manufacturers and distributors
   participating. Neither will participate before the vehicle-level network exists.
2. **Effort.** Recording a part fitment is real work for a garage. That cost is only
   justified once garages already have a reason to be in the system.
3. **Sequencing.** Getting the vehicle layer right — evidence, issuers, trust — is what
   makes the part layer meaningful. A part record with no issuer model is a T0 claim about
   a component, which is worth roughly nothing.

The specification exists now so that the vehicle-layer data model does not foreclose it.
That is its entire present purpose.

---

## 3. `Part` entity

| Field | Type | Notes |
|---|---|---|
| `ipid` | identifier | IDauto Part ID. Same properties as an IVID (§4) |
| `category` | enum | `engine` · `gearbox` · `battery` · `turbo` · `brakes` · `ecu` · `catalyst` · `body_panel` · `other` |
| `manufacturer` | issuer ref | Where known and identifiable |
| `oem_reference` | string | Manufacturer part number |
| `batch_ref` | string | Production batch / lot, where available |
| `serial_ref` | string | Component serial, where the part carries one |
| `source_type` | enum | `oem` · `aftermarket` · `remanufactured` · `used` · `unknown` |
| `provenance_claims` | fact refs | Where it came from — each with its own evidence and trust level |
| `warranty` | record | Terms, start, end, issuer |
| `status` | enum | `manufactured` · `in_stock` · `installed` · `removed` · `scrapped` |

A `Part` is a first-class subject. It carries its own facts, evidence and trust assessments
by exactly the same rules as a `Vehicle` — no parallel machinery, no second trust ladder.

---

## 4. Part identifiers (`IPID`)

Same normative properties as the IVID:

- Independent of any vehicle. A part outlives the vehicle it is fitted to and may be fitted
  to another.
- At least 80 bits of entropy, with a check symbol.
- Never derived by hashing a serial number — serials are low-entropy and enumerable.
- Never reused.
- Survives removal, refurbishment and refitting.

Where a part carries a manufacturer serial, that serial is a **Fact** about the part with its
own evidence, not the part's identity. This is the same rule as VIN-is-not-vehicle-identity,
applied one level down, and for the same reason: manufacturer identifiers are duplicated,
mis-stamped, restamped and forged.

---

## 5. Fitment — the part↔vehicle relationship

Fitment is a **time-bounded association**, never a foreign key on either object:

```
PartFitment {
  ipid, ivid,
  installed_at, installed_by (issuer), install_evidence,
  removed_at,   removed_by (issuer),   removal_evidence,
  position,                      // e.g. front-left
  vehicle_mileage_at_install,
  vehicle_mileage_at_removal
}
```

Rules:

- Fitment records are **append-only**. Removing a part closes the interval; it never deletes
  the record.
- A part **MUST NOT** have two open fitment intervals. Two open intervals is a detectable
  contradiction — either a data error or a cloned identity — and is surfaced as a conflict,
  never silently resolved.
- A vehicle's "current parts" is a **query** over open intervals, not stored state.
- Mileage at install and removal enables cross-checking: a part removed at lower mileage
  than it was installed is a chronology conflict.

---

## 6. Lifecycle

```
manufactured → distributed → installed → [ maintained ]* → removed
                                                          ├→ refurbished → installed (new fitment, same IPID)
                                                          └→ scrapped
```

Each transition is an `Event` with its own evidence and issuer. A refurbished part keeps its
IPID and gains a refurbishment event — the whole point is that its history follows it.

---

## 7. What part identity makes possible

| Capability | Mechanism |
|---|---|
| Counterfeit detection | A genuine part has a manufacturer-issued credential; an aftermarket copy cannot produce one |
| Cloned-part detection | One IPID with two open fitments is a contradiction the protocol surfaces |
| Battery health provenance | Capacity measurements over time, each with issuer and evidence |
| Recall targeting | Batch-level query: which vehicles currently hold a part from this batch |
| Honest used-part market | A used part with a verifiable history is worth more than one without |
| Cross-checked mileage | Part fitment mileages that contradict the vehicle's mileage curve |

The recall case is the one most likely to attract institutional participation, and it is
worth noting that it requires the batch field to be populated at manufacture — which is a
manufacturer-side integration, not something IDauto can produce on its own.

---

## 8. Privacy

Parts are objects, not people, so the surface is smaller — but not empty:

- A part's history reveals the **vehicle's** history, which is already governed by
  [`PRIVACY_ARCHITECTURE.md`](PRIVACY_ARCHITECTURE.md).
- Fitment records reveal which garage handled a vehicle when. That is professional
  information about the garage, and location/timing information about the vehicle's holder.
  Fitment records inherit the vehicle's access scopes.
- A part's full fitment chain across multiple vehicles **MUST NOT** be publicly resolvable
  to the identities of those vehicles' holders.

---

## 9. Open questions

Recorded rather than papered over:

1. **Granularity.** Where does the tree stop? An engine is a part; is a piston? Proposal:
   the protocol imposes no depth limit, and each deployment defines a required set.
2. **Identifier assignment at manufacture.** IPIDs are most valuable when assigned by the
   manufacturer, which requires manufacturer adoption. Interim: IDauto assigns an IPID on
   first observation, and reconciles with a manufacturer identifier later — with the same
   merge semantics as vehicles (§9.4 of the protocol).
3. **Sub-assembly composition.** A gearbox contains parts. Nested composition is expressible
   with the same fitment relation, but the query complexity is real and unmeasured.
4. **Garage effort.** Nothing in this design solves the incentive problem in §2.2. If
   recording a fitment is not near-zero effort at the point of work, it will not happen.

---

## 10. Implementation status

| Element | Status |
|---|---|
| `Part` entity | **SPECIFIED** — no table exists |
| `IPID` | **SPECIFIED** — no issuance exists |
| `PartFitment` | **SPECIFIED** — no table exists |
| Part events and evidence | **SPECIFIED** — reuses vehicle-layer primitives |
| Manufacturer credential issuance | **SPECIFIED** — depends on IDA-7 |
| Recall query | **PLANNED** |
| Counterfeit detection | **PLANNED** |

Nothing here is scheduled before IDA-9. The vehicle-layer schema has been checked to ensure
that adding parts later is additive, and that check is the deliverable of this document.
