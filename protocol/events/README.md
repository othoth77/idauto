# Event Vocabulary

**Protocol version `0.1.0-draft` · SPECIFIED, not implemented**

An `Event` is something that happened to a vehicle. Facts describe what a vehicle *is*;
events describe what has *happened to it*. A passport without events is a specification
sheet, not a history.

Schema: [`event.schema.json`](event.schema.json).

---

## Rules

1. **Immutable.** An event is never edited. A correction is a new event with `supersedes`.
2. **Two timestamps, always.** `occurred_at` (when it happened) and `recorded_at` (when
   IDauto learned of it) are different, and the gap between them is informative — a service
   recorded four years late is worth less than one recorded the same day.
3. **Provenance mandatory.** Every event carries the full envelope. An event with no
   evidence is a T0 event, visibly so.
4. **No personal data in `detail`.** The event describes the vehicle, not the people around
   it. The garage is an Issuer with a DID; the holder is a pseudonymous reference.
5. **Mileage is append-only.** A regression is an `Anomaly`, never an overwrite. Silently
   correcting a mileage regression destroys the single most useful fraud signal in the
   entire dataset.

---

## The vocabulary

| Event | Typical issuer | Notes |
|---|---|---|
| `registration_created` | citizen or institution | The first event on every passport |
| `service_performed` | garage | The backbone of the maintenance history |
| `inspection_performed` | inspector | Usually institutional (T3) |
| `damage_recorded` | insurer, garage, citizen | Recording damage is not an accusation |
| `repair_performed` | garage | Pairs with `damage_recorded` where both are known |
| `mileage_recorded` | any | Can also be a side effect of another event |
| `part_installed` / `part_removed` | garage | See [`../../docs/PART_IDENTITY.md`](../../docs/PART_IDENTITY.md) |
| `plate_changed` | institution or citizen | Opens a new `Plate` interval; the IVID is unchanged |
| `ownership_transferred` | any | Pseudonymous holder refs only |
| `insurance_event_recorded` | insurer | Claim occurred; not the claim file itself |
| `import_recorded` / `export_recorded` | institution | Cross-border continuity |
| `written_off` | insurer | Materially affects value; high-consequence, so evidence expectations are high |
| `scrapped` | authorised institution | Closes the passport. A scrapped identity reappearing is exactly the signal a buyer needs |
| `records_merged` / `merge_reversed` | operator | Merges are sometimes wrong, so they are reversible |
| `erasure_applied` | operator | The tombstone for a data-protection erasure — never a silent gap |

The vocabulary is **extensible**. A deployment may add types; unknown types **MUST** be
preserved on round-trip rather than dropped, so an extension never silently loses data as it
crosses an implementation boundary.

---

## What is deliberately absent

- No `fraud_detected` event. Fraud is a legal finding about people, not a record type. What
  the protocol has is `Anomaly` — an observation about records, routed to human review.
- No `verified` event. Verification is a computed assessment, not something that happens to
  a vehicle.
- No `score_updated` event. There is no score. See
  [`../../docs/TRUST_MODEL.md`](../../docs/TRUST_MODEL.md) §7.
