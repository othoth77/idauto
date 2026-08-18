# Security Policy

---

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately through GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). If that is unavailable to you, open a public issue
containing **only** a request for a private channel — no technical detail.

Please include what you can: what the issue is, how to reproduce it, what an attacker
achieves, and which version or commit you tested.

### What to expect

| | |
|---|---|
| Acknowledgement | Within 5 working days |
| Initial assessment | Within 10 working days |
| Fix timeline | Communicated after assessment; depends on severity |
| Disclosure | Coordinated. We will agree a date with you |
| Credit | Offered by default; tell us if you would rather not be named |

**Honest scope note:** this is a single-maintainer project, pre-launch, with no public
deployment. There is no security team and no 24/7 rotation. The timelines above are what can
be committed to, not what a funded programme would offer.

---

## Scope

### In scope

- The reference implementation in `reference/`
- Operator tooling in `ops/`
- The database schema in `database/`
- The protocol specification and schemas — **including design flaws**. A specification that
  permits an unsafe implementation is a vulnerability in the specification.
- Privacy invariant violations (see below)

### Out of scope

- Vulnerabilities requiring an already-compromised operator account
- Missing hardening on a local development setup
- Findings against a deployment not operated by this project
- Automated scanner output with no demonstrated impact

---

## What counts as a vulnerability here

Beyond ordinary classes (injection, authentication bypass, privilege escalation, SSRF,
path traversal, denial of service), these are treated as security issues in this project
specifically:

| Issue | Why |
|---|---|
| **Any path exposing owner PII** | The founding constraint. Structurally enforced; a way around it is critical |
| **A join path from a plate to a person** | Same |
| **A way to edit or silently delete a historical claim** | Breaks the append-only invariant that makes history worth anything |
| **A client-supplied field reaching a server-derived one** | Trust and audit spoofing |
| **A write reaching the database without an audit row** | Breaks attribution |
| **Restricted-scope data in a public or professional response** | Scope escape |
| **Personal data reaching an anchor or any published artefact** | Unerasable disclosure |
| **A `mythos_private`/restricted read with no audit** | The scope's whole premise |
| **De-anonymisation of a contributor** | Contributors are pseudonymous by design |
| **Recovering record content from a published hash** | Why record hashes are salted |
| **A UI rendering an anchor as verification** | Not a code bug; it is the trust model failing at the last inch, and it is in scope |

The last one is unusual to list in a security policy. It is here because the difference
between "this record has not been altered" and "this record is true" is the difference the
entire trust model exists to preserve, and defeating it in the interface defeats it
completely.

---

## Security properties currently relied on

Stated so you know what to test against — and what is honestly not there yet.

**Implemented and test-enforced:**

- No owner-PII column exists on any table
- Parameterised SQL only; no raw-SQL escape hatch in the database module
- Every mutation writes an audit row in the same transaction, or both roll back
- Writes fail closed when no identity is resolved — no unattributed write path exists
- Seven server-derived fields are rejected on submission, one test per field
- Restricted-scope facts are excluded from all read paths (no audit-on-read exists, so
  restricted reads stay closed)
- IP addresses are hashed before storage and confined to the submission envelope
- Anonymous submissions create no contributor record
- Driver errors are mapped to safe status codes; raw messages are never echoed
- Content-addressed media; orphan cleanup never removes a file another row references
- Restore tooling refuses protected system paths, any user's home root, the live media
  store, and any path inside the repository
- Backup retention is report-only; there is no deletion path, and `--destructive` is refused
- **Off-host backup exists and was restore-verified** (2026-08-14): dump → SHA-256 → upload →
  fresh download → checksum match → isolated restore, 24 tables / 2,551 rows source-identical

**Not present — do not assume otherwise:**

- **No real authentication.** The only mechanism is an operator-provisioned map of admin
  bearer tokens to identity strings. It is not an auth service and is not described as one.
- **No backup *schedule*.** One verified off-host batch exists; a single batch is not a
  backup regime. Recurring scheduling and retention automation do not exist, so treat the
  backup gate as stale once the newest verified batch ages beyond tolerance.
- **No verified off-host copy of the *media store*.** The verified batch covered the
  database. Media backup and restore are implemented locally and untested off-host.
- **No public deployment.** No IDauto API, UI or endpoint is publicly reachable.
- **No anchoring.** No chain integration exists.
- **No audit-on-read.** Which is why restricted reads are closed rather than logged.

---

## Secrets

- Never commit credentials, tokens, real vehicle data or personal data — in code, fixtures,
  documentation, commit messages or test output.
- All connection parameters come from environment variables.
- No credential value is logged, thrown in an error message, or returned to a caller.
- Off-host backup credentials are read from a user-local file at mode 600, never from the
  repository and never from a command-line argument.
- Non-HTTPS endpoints are refused outright by the storage adapter.

If you find a committed secret, report it privately — do not open a public issue naming it.
