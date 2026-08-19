# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The protocol is versioned separately from the implementation; see
[`GOVERNANCE.md`](GOVERNANCE.md) §3.

---

## [Unreleased]

### Added — identity vocabularies (2026-08-18)

feat(protocol): publish identity vocabularies — actor-type.v1, org-role.v1,
actor-identifier.v1; schema conformance suite tests/identity-conformance-test.js; no schema
change, no runtime change.

### Added — standalone repository and Open Vehicle Identity Protocol (2026-08-18)

Extracted from `othoth77/mythos-prod` (`projects/idauto/`) into `othoth77/idauto` and
repositioned as an open vehicle identity and history protocol.

**Protocol (`0.1.0-draft`, SPECIFIED — not implemented)**

- `docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` — canonical entities, identifiers, lifecycle
  rules, and the append-only invariant
- `docs/TRUST_MODEL.md` — the T0–T4 ladder, with T4 kept orthogonal to T0–T3
- `docs/PRIVACY_ARCHITECTURE.md` — public/private boundary, erasure, surveillance limits
- `docs/BLOCKCHAIN_ARCHITECTURE.md` — chain-neutral, optional, Merkle-batched anchoring
- `docs/PART_IDENTITY.md` — part identity as a future extension
- `protocol/schemas/` — 12 JSON Schemas plus the protocol↔implementation mapping
- `protocol/events/` — the event vocabulary
- `protocol/credentials/` — W3C VC and DID profile
- `protocol/verification/` — the eight-step verification specification

**Strategy and governance**

- `docs/ROADMAP_EVOLUTION_2026-08-18.md` — the seventeen strategic decisions, with reasoning
- `docs/OPEN_SOURCE_STRATEGY.md`, `docs/BUSINESS_MODEL.md`, `docs/GO_TO_MARKET.md`
- `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md`
- `docs/ROADMAP.md` extended from IDA-6 to IDA-9, with completed stages preserved
- `README.md` rewritten around the protocol identity

**Migration record**

- `docs/MIGRATION_FROM_MYTHOS_PROD.md` — inventory, path mapping, dependency classification
- `docs/STANDALONE_MIGRATION_AUDIT.md` — validation evidence
- `docs/AI_HANDOVER.md` — 25 implementation-record sections extracted verbatim

### Changed

- Deployment paths in `ops/` are now environment-driven; no `/home/deploy` default remains
- Restore guards generalised from a hardcoded `/home/deploy` to a rule refusing any user
  home root — same protection, every host
- `package.json` renamed from `@mythos/idauto` to `idauto`, unscoped and no longer private
- Documentation headers reflect the new repository, with provenance retained

### Fixed

- Repository-root computation in `ops/media-ops.js` and `ops/offhost-backup.js`, which
  assumed `ops/` sat three levels below the repository root. The "refuse to restore inside
  the repository" guard would otherwise have pointed at the wrong directory after the move

### Preserved unchanged

The IDA-0 → IDA-3 baseline: the 24-table schema, observation-first capture, three access
scopes, the API with atomic audit logging, content-addressed media, the ingestion service,
rate limiting, the review queue, off-host backup tooling, and all 13 test suites
(601 assertions, 0 failures in the new layout).

Blockers moved with the code and were not dropped: **IDA-2E** (real authentication) remains
blocked, and every LEGAL-REVIEW-REQUIRED item remains open.

### Corrected on 2026-08-18, after the completeness audit

The first pass of this migration reported **IDA-3F (off-host backup) as BLOCKED with no
off-host copy in existence.** That was wrong. It relied on the IDA-3F stage entries of
2026-08-12 without scanning forward for later entries that superseded them: on **2026-08-14**
the object-store destination was provisioned, a transport defect in the S3 adapter was found
and fixed, and a verified off-host backup of the database was created and restore-tested.
The gate closed the same day. Corrected throughout, and the five superseding handover entries
have been added to `docs/AI_HANDOVER.md`.

Also added in the same pass, after the audit found them missing: `docs/RISK_REGISTER.md`
(8 IDauto-owned open risks plus 9 cross-product), `docs/IDENTITY_ARCHITECTURE.md`, and
`ops/runbooks/OFF_HOST_BACKUP_GATE.md`.

---

## History before 2026-08-18

Stages IDA-0 through IDA-3 were executed in `othoth77/mythos-prod` between 2026-08-05 and
2026-08-12. The verbatim record, including commit hashes resolvable in that repository, is
in [`docs/AI_HANDOVER.md`](docs/AI_HANDOVER.md). The stage-level summary is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).
