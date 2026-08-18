# Contributing to IDauto

Thank you for considering it. This document is short and specific, because most of what
matters here is a small number of rules that are unusual enough to be worth reading before
you write code.

---

## Before you start

Read [`GOVERNANCE.md`](GOVERNANCE.md) §4 — **the invariants**. A contribution that violates
one is rejected regardless of its quality. They are not style preferences; they are what the
protocol is for.

The short version:

- No owner PII in the vehicle record — ever, anywhere.
- No personal data on a public ledger.
- History is append-only; supersede, never edit or silently delete.
- Trust is computed by the server, never client-supplied, never purchasable.
- Anchoring state stays orthogonal to trust level — including in the UI.
- AI produces observations, not accusations.

---

## Contribution types

| Type | Process |
|---|---|
| **Bug fix** | Issue → PR with a test that fails before and passes after |
| **Documentation** | PR directly |
| **New feature (implementation)** | Issue first, to agree on scope |
| **Protocol change** | [`GOVERNANCE.md`](GOVERNANCE.md) §3 — a different, stricter process |
| **Security issue** | **Do not open an issue.** See [`SECURITY.md`](SECURITY.md) |

---

## Development

```bash
npm install
cp .env.example .env         # fill in; never commit .env
createdb idauto
psql -d idauto -f database/schema.sql
psql -d idauto -f database/seed-synthetic-test-data.sql
```

### Running tests

Some suites are fully offline; others need a live PostgreSQL database. Details, including
the environment contract, are in
[`ops/runbooks/TEST_RUNBOOK.md`](ops/runbooks/TEST_RUNBOOK.md).

```bash
# Offline — no database, no network
node tests/ida-2a-schema-and-plate-validation-test.js
node tests/ida-3a-ingestion-schema-test.js
node tests/ida-3f-offhost-backup-test.js

# Static-only mode for the ingestion suites
IDA3B_STATIC_ONLY=1 node tests/ida-3b-ingestion-service-test.js

# Live database (env vars set)
node tests/ida-2c-readonly-api-test.js
```

A suite that cannot reach its dependencies **fails loudly** with a message naming every
missing variable. It never silently skips. If you add a suite, keep that property: a test
that quietly passes because it did not run is worse than no test.

---

## Code conventions

Match the surrounding code. Concretely, in `reference/` and `ops/`:

- Node.js, no framework. The HTTP layer is Node's built-in `http`.
- `var`, `function`, `'use strict'`. This is deliberate consistency with the existing
  codebase, not an opinion about modern JavaScript.
- **One runtime dependency (`pg`).** Adding a second needs a strong justification in the PR.
  The SigV4 implementation in `ops/adapters/` was written against Node's built-in `crypto`
  rather than pulling in an SDK, and that trade — more code, fewer supply-chain surfaces —
  is the house preference.
- Parameterised SQL only. No string-built queries, no raw-SQL escape hatch.
- All mutations go through `writes.js`'s `withAudit()`. Transaction atomicity is implemented
  in exactly one place, and a new endpoint must not add a second.
- Never echo a driver error to a caller. Map to a safe status code.
- Keep operational tooling line-reviewable. Backup and restore code is read under pressure
  when something has already gone wrong.

---

## Testing expectations

- A behavioural change needs a test. A bug fix needs a test that fails before it.
- Tests run against a live database where the behaviour involves the database. Mocking the
  database to test database behaviour tests the mock.
- **Test idempotently.** Suites run repeatedly against a persistent database. Absolute
  assertions like "exactly 2 rows for this key" break on the second run. Seed unique content
  per run.
- Prove the negative too. The audit-atomicity test deliberately makes the *audit* insert fail
  and confirms the data insert rolled back — not just that the happy path works.

---

## Pull requests

1. One coherent change. Do not combine a refactor with a behavioural change.
2. State what you changed and why. The reasoning is the part reviewers cannot reconstruct.
3. Include test results. Never report an unrun test as passing.
4. Note anything you deliberately did not do.
5. No secrets, credentials, real vehicle data or personal data — in code, fixtures,
   documentation, commit messages, or test output.

### Never do

- Weaken a security control to make a test pass.
- Add an owner-PII column "temporarily".
- Add a code path that edits a historical claim.
- Let a client supply a trust level, confidence, verification status, source, issuer, or an
  actor reference.
- Render an anchor as a verification badge, checkmark or "verified" label.
- Describe a planned feature as implemented, in code comments, documentation or a PR
  description.

That last one matters as much as the others. This repository's documentation tags every
capability IMPLEMENTED / SPECIFIED / PLANNED / BLOCKED, and the tags are meant literally.
Overstating status is the failure mode that makes all the other honesty pointless.

---

## Documentation

If you change behaviour, update the documentation in the same PR. If you change a protocol
schema, update [`protocol/schemas/MAPPING.md`](protocol/schemas/MAPPING.md) so the gap
between specification and implementation stays accurate.

---

## Licence

Contributions are licensed under Apache-2.0 (see [`LICENSE`](LICENSE)). By submitting a
contribution you confirm you have the right to license it that way.
