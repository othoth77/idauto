# IDauto

**An open vehicle identity and history protocol.**

A vehicle outlives its owners, its plates, and the databases that describe it. IDauto gives
each vehicle a durable identity and a lifecycle record that any party can contribute to and
any party can verify — without any of them having to be trusted.

```
Citizen → Vehicle Identity → Digital Vehicle Passport → Evidence
        → Verification → Trust → Interoperability
```

---

## What IDauto is

A **protocol** for stating and verifying facts about a vehicle, plus a **reference
implementation** of that protocol.

- **Citizen-first.** Any citizen can create a passport for a vehicle they hold. No garage,
  dealer, insurer or authority has to sponsor them.
- **Free at the base.** Registration, the core passport and its QR representation are free
  and stay free.
- **Evidence-first.** Nothing in IDauto is simply "true". Every claim carries its source,
  its evidence, its observation, a confidence value, a verification status, a timestamp,
  and its issuer where one exists.
- **Privacy-separated.** The vehicle record and the owner record are different things.
  Personal data never enters the public record and never touches a public ledger.
- **Open.** The schemas, the event and credential formats, the verification rules and the
  reference implementation are open source under Apache-2.0.

## What IDauto is not

| Not this | Because |
|---|---|
| A blockchain project | Anchoring is one optional integrity layer at the bottom of the stack. The product is the identity and the evidence. |
| A car marketplace | IDauto never lists, prices, brokers or sells a vehicle. Marketplaces may *consume* IDauto passports. |
| A plate database | A plate is one mutable attribute of a vehicle, not the vehicle. Plates change; identity does not. |
| A truth oracle | IDauto records who claimed what, on what evidence, and how strongly it is corroborated. It does not adjudicate truth. |

> **Immutable does not mean true.** A cryptographic anchor proves a record existed at a
> point in time and has not been altered since. It proves nothing at all about whether the
> record was accurate when it was written. Anyone who conflates the two is misreading the
> protocol, and every part of this specification is written to keep them apart.

---

## The core objects

| Object | What it is |
|---|---|
| **IDauto Vehicle ID** | A stable, protocol-owned identifier for a vehicle. Independent of VIN, of registration plate, and of owner identity. It survives re-plating, resale, and re-registration. |
| **Digital Vehicle Passport** | The lifecycle record of one vehicle: what it is, what has happened to it, and what backs each of those statements. |
| **Evidence** | The artefact a claim rests on — a document scan, a photograph, an inspection report, an issuer-signed credential. |
| **Trust ladder (T0–T4)** | How strongly a given claim is corroborated, from self-declared to cryptographically anchored. See [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md). |
| **Issuer** | A garage, insurer, fleet operator, inspector, dealer or authorised institution with a verifiable identity, able to sign claims about vehicles it has actually handled. |

---

## Trust ladder, at a glance

| | Level | Meaning |
|---|---|---|
| **T0** | Self-declared | Someone said so. No evidence attached. |
| **T1** | Documented | A supporting artefact exists and is attached. |
| **T2** | Professionally verified | A verified professional issuer attests it from direct handling. |
| **T3** | Institutional | An authorised institution is the source. |
| **T4** | Cryptographically anchored | The record's hash is anchored so tampering is detectable. |

T4 is a property of the *record*, not of the *claim*. A T0 claim can be anchored: the result
is a self-declaration that provably has not been edited since it was made. It is still a
self-declaration. Full definition in [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md).

---

## Repository layout

```
docs/           specification, architecture, strategy, roadmap, migration record
protocol/       the open protocol — schemas, events, credentials, verification rules
reference/      the working reference implementation (Node.js, PostgreSQL)
database/       PostgreSQL schema, migrations, synthetic seed data
config/         configurable rules and feature flags (no secrets)
ops/            operator tooling and runbooks — media integrity, backup, restore
src/            reserved layout for the protocol-era implementation — NOT yet implemented
tests/          the automated suite (601 assertions across 13 suites)
```

`reference/` is where the code that runs today lives. `src/` is a reserved skeleton for the
protocol-era rewrite and contains no implementation — see [`src/README.md`](src/README.md).
Nothing in this repository pretends to be further along than it is.

---

## Current state — honest version

| Area | State |
|---|---|
| PostgreSQL schema (24 tables, zero owner-PII columns) | **IMPLEMENTED** |
| Read + write API, atomic audit logging | **IMPLEMENTED** (reference implementation; not deployed publicly) |
| Content-addressed media storage | **IMPLEMENTED** |
| Community ingestion service, rate limiting, review queue | **IMPLEMENTED** (admin-only route; no public endpoint exists) |
| Off-host backup, restore-verified | **IMPLEMENTED** — a verified off-host copy of the database exists (2026-08-14); recurring scheduling and retention automation are **PLANNED** |
| Real multi-user authentication | **BLOCKED** — see [`docs/ROADMAP.md`](docs/ROADMAP.md) IDA-2E |
| Citizen passport, professional issuers, AI verification | **SPECIFIED**, not implemented |
| W3C Verifiable Credentials / DID interoperability | **SPECIFIED**, not implemented |
| Blockchain anchoring and Merkle batching | **SPECIFIED**, not implemented — no chain integration exists in this repository |
| Public capture surface | **BLOCKED** — legal review and real authentication outstanding |

Every roadmap item is tagged IMPLEMENTED / SPECIFIED / PLANNED / BLOCKED /
LEGAL-REVIEW-REQUIRED in [`docs/ROADMAP.md`](docs/ROADMAP.md), and those tags are meant
literally.

---

## No mandatory token

IDauto functions with no cryptocurrency, no token, no NFT and no DAO. None is required to
register a vehicle, to issue a credential, to verify a passport, or to anchor a record. Any
future anchoring integration that requires one is disqualified on that basis alone.

---

## Getting started

```bash
npm install
cp .env.example .env          # then fill it in — never commit .env
createdb idauto
psql -d idauto -f database/schema.sql
psql -d idauto -f database/seed-synthetic-test-data.sql   # synthetic data only
node tests/ida-2a-schema-and-plate-validation-test.js
```

Test execution, including which suites need a live database, is documented in
[`ops/runbooks/TEST_RUNBOOK.md`](ops/runbooks/TEST_RUNBOOK.md).

---

## Documentation

**Protocol and architecture**
[`OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md) ·
[`ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`IDENTITY_ARCHITECTURE.md`](docs/IDENTITY_ARCHITECTURE.md) ·
[`TRUST_MODEL.md`](docs/TRUST_MODEL.md) ·
[`PRIVACY_ARCHITECTURE.md`](docs/PRIVACY_ARCHITECTURE.md) ·
[`BLOCKCHAIN_ARCHITECTURE.md`](docs/BLOCKCHAIN_ARCHITECTURE.md) ·
[`PART_IDENTITY.md`](docs/PART_IDENTITY.md) ·
[`protocol/README.md`](protocol/README.md)

**Product**
[`PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) ·
[`CAPTURE_PIPELINE.md`](docs/CAPTURE_PIPELINE.md) ·
[`INGESTION_ARCHITECTURE.md`](docs/INGESTION_ARCHITECTURE.md) ·
[`FIXPERT_INTEGRATION.md`](docs/FIXPERT_INTEGRATION.md)

**Strategy, risk and governance**
[`ROADMAP.md`](docs/ROADMAP.md) ·
[`RISK_REGISTER.md`](docs/RISK_REGISTER.md) ·
[`ROADMAP_EVOLUTION_2026-08-18.md`](docs/ROADMAP_EVOLUTION_2026-08-18.md) ·
[`OPEN_SOURCE_STRATEGY.md`](docs/OPEN_SOURCE_STRATEGY.md) ·
[`BUSINESS_MODEL.md`](docs/BUSINESS_MODEL.md) ·
[`GO_TO_MARKET.md`](docs/GO_TO_MARKET.md) ·
[`GOVERNANCE.md`](GOVERNANCE.md) ·
[`CONTRIBUTING.md`](CONTRIBUTING.md) ·
[`SECURITY.md`](SECURITY.md)

**Operations**
[`TEST_RUNBOOK.md`](ops/runbooks/TEST_RUNBOOK.md) ·
[`STORAGE_RUNBOOK.md`](ops/runbooks/STORAGE_RUNBOOK.md) ·
[`OFF_HOST_BACKUP_GATE.md`](ops/runbooks/OFF_HOST_BACKUP_GATE.md)

**History**
[`AI_HANDOVER.md`](docs/AI_HANDOVER.md) ·
[`MIGRATION_FROM_MYTHOS_PROD.md`](docs/MIGRATION_FROM_MYTHOS_PROD.md) ·
[`STANDALONE_MIGRATION_AUDIT.md`](docs/STANDALONE_MIGRATION_AUDIT.md) ·
[`CHANGELOG.md`](CHANGELOG.md)

---

## Provenance

IDauto was developed inside the Mythos OS monorepo (`othoth77/mythos-prod`,
`projects/idauto/`) from 2026-08-05 and extracted into this standalone repository on
2026-08-18. Stages IDA-0 through IDA-3 were completed there; that history is preserved, not
restarted. The full record is in
[`docs/MIGRATION_FROM_MYTHOS_PROD.md`](docs/MIGRATION_FROM_MYTHOS_PROD.md).

IDauto remains compatible with Mythos ecosystem services, but does not require any of them.

## Licence

Apache-2.0 for the software and the protocol specification — see [`LICENSE`](LICENSE).
The IDauto name and brand are not covered by that licence; see [`GOVERNANCE.md`](GOVERNANCE.md).
