# `src/` — reserved, NOT IMPLEMENTED

**This directory contains no implementation.** It is a reserved layout for the protocol-era
codebase (IDA-7 onward), kept here so the target structure is visible and so that the
question "where would this go?" has an answer before the code exists.

**The code that runs today lives in [`../reference/`](../reference/).** It is not a
prototype: it is a working implementation with 601 test assertions against a live
PostgreSQL database. It is called `reference/` because it is the reference implementation of
the protocol, not because it is throwaway.

| Directory | Intended contents | Status |
|---|---|---|
| `api/` | Protocol-shaped HTTP API — passport retrieval, claim submission, verification | **NOT IMPLEMENTED** — see `reference/api.js` for what exists |
| `identity/` | IVID issuance, DID resolution, issuer registry | **NOT IMPLEMENTED** — see `reference/identity.js` for the current minimal admin-identity stub |
| `verification/` | The verification pipeline in `protocol/verification/` | **NOT IMPLEMENTED** |
| `provenance/` | Provenance envelope construction, trust computation, anomaly attachment | **NOT IMPLEMENTED** |
| `blockchain/` | Canonical serialisation, Merkle batching, anchoring, inclusion proofs | **NOT IMPLEMENTED** — no chain integration exists anywhere in this repository |

Each subdirectory carries a `README.md` saying the same thing, so that nobody browsing the
tree mistakes an empty directory for an unfinished one, or for a finished one.

## Why the split exists at all

Rewriting `reference/` in place would mean either breaking a working, tested system to chase
a specification, or letting the specification quietly drift to match whatever the code
already does. Keeping them separate lets the protocol be designed on its merits and the
implementation converge deliberately — with
[`../protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md) as the running record of
the gap.

The migration path is convergence, not replacement: `reference/` gains protocol-shaped
outputs first, then the internals move.
