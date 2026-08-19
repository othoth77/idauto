# IDauto Protocol

**Open Vehicle Identity Protocol (OVIP) · version `0.1.0-draft`**

The normative prose specification is
[`../docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](../docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md).
This directory holds the machine-readable artefacts.

```
protocol/
├── schemas/        JSON Schema for the canonical entities
├── vocabularies/   closed-set value vocabularies asserted against the live schema
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

## Vocabularies

[`vocabularies/`](vocabularies/) publishes the closed-set value vocabularies IDauto's live
schema enforces — `actor_type`, `org_role`, `actor_identifier` — as machine-readable data.

**These are vocabulary data documents, not JSON Schemas.** They deliberately carry no
`$schema` and no `$id`: a JSON Schema describes the *shape* a document must have, while these
files *are* the data being described — the value sets a `CHECK` constraint accepts today.
Giving them `$id` would invite validating instances against them as if they were schemas,
which is not what they are for.

This inverts the relationship the rest of `protocol/` has with the running system. Per
[Status](#status) above, `protocol/schemas/` describes what is being **converged toward** and
may disagree with `database/schema.sql`. Vocabularies describe what **runs today**: each file
names the exact `CHECK` constraint(s) and column(s) it publishes, and
[`tests/identity-conformance-test.js`](../tests/identity-conformance-test.js) asserts —
offline, on every run — that the artifact and `database/schema.sql` still agree. A vocabulary
file that drifts from the schema is a test failure, not a documentation gap.

The vocabularies are individually versioned and are currently `status: "stable"` at `v1`,
independent of OVIP's own `0.1.0-draft` status — a stable vocabulary can exist inside a draft
protocol because it describes something already deployed, not something being designed.

**Versioning rule**, per [`GOVERNANCE.md`](../GOVERNANCE.md) §3:

- The integer major version lives in both the filename (`actor-type.v1.json`) and the
  document's `version` field. They must match.
- `revision` increments for additive or editorial change (a new value, a clarified
  description) without changing the value set's meaning.
- A breaking change (removal, rename, or semantic change) is never made in place — it
  produces a new `actor-type.v2.json`, and `v1` stays published with `status: "superseded"`.
- A value stays present with `status: "deprecated"` for at least one major version before
  removal, matching the deprecation rule for schema fields.

**Consumer rule.** A consumer pins both the version *and* the SHA-256 digest of the raw file
bytes — not just the version number, since a revision bump changes the bytes without changing
the major version. This is exactly why the artifacts are required to be LF-only, UTF-8,
BOM-free, with exactly one trailing newline, and why the [`vocabularies/.gitattributes`](vocabularies/.gitattributes)
`text eol=lf` rule exist: a digest is computed over raw bytes, and any line-ending or encoding
drift between systems would silently change the hash without changing a single value.

---

## Versioning

- Semantic versioning. A breaking schema change requires a major version.
- Every schema carries `$id` with its version, and every instance carries `protocol_version`.
- Unknown fields **MUST** be preserved on round-trip. An implementation that drops fields it
  does not recognise breaks forward compatibility for everyone downstream.
- Deprecation: a field is marked deprecated for at least one major version before removal.

Change governance is in [`../GOVERNANCE.md`](../GOVERNANCE.md).

---

## Closed canonical schemas vs. OVIP §13 round-trip preservation (2026-08-19)

Every canonical record schema in `schemas/` sets `additionalProperties: false` (with the
single deliberate exception of `provenance-envelope.schema.json`, which is `true` because it
is designed to be embedded and extended by whatever record carries it). OVIP §13 states
"Unknown fields **MUST** be preserved on round-trip. An implementation that drops fields it
does not recognise breaks forward compatibility for everyone downstream." Read at face value
these look like a contradiction: a closed schema rejects an unknown field outright, which is
not the same as preserving one it doesn't recognise.

They are not in tension once the two are read as governing different layers:

- **`additionalProperties: false` governs the canonical validators** — the schemas in this
  directory, used to validate a record's own shape at the boundary where it is authored or
  ingested. Closing them is deliberate: it makes an invalid or malformed record **fail
  loudly**, at the point of entry, rather than silently accepting a field nobody defined and
  discovering the mistake later. For a protocol whose central promise is trustworthy
  provenance, a validator that shrugs at an unrecognised field is a worse failure mode than
  one that rejects it.
- **OVIP §13's round-trip duty binds implementations**, not the canonical validators — the
  transport, storage and relay layers that move an already-valid record between systems.
  Those layers **MUST NOT** drop a field they don't understand while passing a record
  through, because doing so silently destroys data a downstream consumer (running a newer
  protocol minor/patch version, or an extension) might need. A relay is not the same
  component as an authoring-time validator, and the two owe different duties.

What this note does **not** do is resolve how a schema-valid extension field would actually be
declared and versioned — a caller wanting to attach protocol-recognised-but-optional data to a
canonical record has no mechanism today, because `additionalProperties: false` has no escape
hatch. A versioned extension mechanism (a reserved `x-ext` namespace, a companion
`additionalProperties: true` "envelope" wrapper, or a minor-version-gated field-addition
process) is an **open protocol question**, deliberately not resolved here and not resolved
silently by flipping `additionalProperties` on the canonical schemas. It is deferred to
**IDA-9** (protocol v1.0 / open ecosystem, per [`../docs/ROADMAP.md`](../docs/ROADMAP.md)),
where the question can be settled alongside the other cross-implementation compatibility work
that stage already covers.

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
| [`schemas/holder-ref.schema.json`](schemas/holder-ref.schema.json) | Opaque pseudonymous holder reference — the person-store boundary |
| [`schemas/tombstone.schema.json`](schemas/tombstone.schema.json) | Erasure record: what/when/basis, without the erased content |
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
