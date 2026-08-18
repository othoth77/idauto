# IDauto Protocol

**Open Vehicle Identity Protocol (OVIP) · version `0.1.0-draft`**

The normative prose specification is
[`../docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](../docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md).
This directory holds the machine-readable artefacts.

```
protocol/
├── schemas/        JSON Schema for the canonical entities
├── events/         the event vocabulary — what can happen to a vehicle
├── credentials/    W3C Verifiable Credentials profile and DID usage
└── verification/   the verification specification — how a claim is checked
```

---

## Status

**These schemas are a draft specification, not a description of the running system.**

The reference implementation in [`../reference/`](../reference/) and the live PostgreSQL
schema in [`../database/schema.sql`](../database/schema.sql) predate this protocol layer.
They implement the same *concepts* — observation-first capture, evidence-backed facts,
append/supersede semantics, access scopes — under different field names.

The mapping between the two is in [`schemas/MAPPING.md`](schemas/MAPPING.md). Where they
disagree, `database/schema.sql` describes what runs and `protocol/schemas/` describes what
is being converged toward. Neither is silently authoritative over the other, and the
convergence is an IDA-7 task.

---

## Versioning

- Semantic versioning. A breaking schema change requires a major version.
- Every schema carries `$id` with its version, and every instance carries `protocol_version`.
- Unknown fields **MUST** be preserved on round-trip. An implementation that drops fields it
  does not recognise breaks forward compatibility for everyone downstream.
- Deprecation: a field is marked deprecated for at least one major version before removal.

Change governance is in [`../GOVERNANCE.md`](../GOVERNANCE.md).

---

## Design rules these schemas follow

1. **Provenance is not optional.** Every claim-bearing object embeds the provenance envelope
   ([`schemas/provenance-envelope.schema.json`](schemas/provenance-envelope.schema.json)).
   There is no way to express a bare claim.
2. **Server-derived fields are marked.** `trust_level`, `confidence`, `verification_status`,
   `source` and any actor reference are computed. A submitted instance containing one is
   rejected, not sanitised.
3. **Confidence ≠ trust.** They are separate fields with separate ranges and separate
   meanings. See [`../docs/TRUST_MODEL.md`](../docs/TRUST_MODEL.md) §4.
4. **No personal data in any schema.** No schema here has a field for a person's name,
   address, contact details or national identifier. The omission is structural.
5. **Supersession, not mutation.** Objects that can be corrected carry `supersedes` and
   `superseded_by`. None carries an "edit" affordance.
6. **W3C first.** Credentials are Verifiable Credentials; issuers are DIDs. Proprietary
   identity primitives appear only where no W3C primitive fits, and each such case is
   documented in [`credentials/README.md`](credentials/README.md).

---

## Files

| Path | Contents |
|---|---|
| [`schemas/vehicle.schema.json`](schemas/vehicle.schema.json) | `Vehicle` and the IVID |
| [`schemas/passport.schema.json`](schemas/passport.schema.json) | The Digital Vehicle Passport aggregate |
| [`schemas/provenance-envelope.schema.json`](schemas/provenance-envelope.schema.json) | The envelope every claim carries |
| [`schemas/fact.schema.json`](schemas/fact.schema.json) | `Fact` — a claim about an attribute |
| [`schemas/observation.schema.json`](schemas/observation.schema.json) | `Observation` — one act of perceiving a vehicle |
| [`schemas/evidence.schema.json`](schemas/evidence.schema.json) | `Evidence` and `Document` |
| [`schemas/issuer.schema.json`](schemas/issuer.schema.json) | `Issuer` and its verifiable identity |
| [`schemas/trust-assessment.schema.json`](schemas/trust-assessment.schema.json) | Computed T0–T4 and anchoring state |
| [`schemas/ownership-transfer.schema.json`](schemas/ownership-transfer.schema.json) | Transfer with pseudonymous holder refs |
| [`schemas/blockchain-anchor.schema.json`](schemas/blockchain-anchor.schema.json) | Merkle batch anchor and inclusion proof |
| [`schemas/plate.schema.json`](schemas/plate.schema.json) | Time-bounded registration assignment |
| [`schemas/MAPPING.md`](schemas/MAPPING.md) | Protocol ↔ live PostgreSQL schema mapping |
| [`events/README.md`](events/README.md) | The event vocabulary |
| [`events/event.schema.json`](events/event.schema.json) | `Event` |
| [`credentials/README.md`](credentials/README.md) | VC / DID profile |
| [`verification/README.md`](verification/README.md) | The verification specification |

---

## Validating an instance

The schemas are plain JSON Schema (draft 2020-12) and work with any conforming validator.
No IDauto-specific tooling is required — that is the point of publishing them.

```bash
npx ajv-cli validate -s protocol/schemas/fact.schema.json -d my-fact.json --spec=draft2020
```
