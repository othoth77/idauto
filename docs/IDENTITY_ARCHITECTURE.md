# Identity Architecture

**Status:** the adapter is IMPLEMENTED; the canonical-identifier contract is **SPECIFIED,
not applied**; real authentication is **BLOCKED** and re-scoped to IDA-7.
**Last updated:** 2026-08-18

**Provenance:** the IDauto-relevant decisions from `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` in
`othoth77/mythos-prod` (stage `MYTHOS-IDENTITY-CORE-0`, 2026-08-11), extracted 2026-08-18.
That document is a **Mythos platform** specification governing several products; it was
correctly not migrated whole. This file carries the parts IDauto's own code and schema
depend on, so the repository is understandable without it. The adapter-side contract is in
[`../reference/IDENTITY_ADAPTER.md`](../reference/IDENTITY_ADAPTER.md).

---

## 1. Why identity is the project's oldest open problem

IDA-2E was scoped as "integrate the real Mythos OS auth service". Investigation before any
code was written found **no such service existed** — the host application's only
authentication was a single shared password with no per-user identity, and the JWT contract
the architecture referenced had never actually been specified. The stage was blocked rather
than faked, and it has been blocked ever since.

In a standalone repository this is not a waiting problem, because there is nothing to wait
for. It is a build problem, scheduled at **IDA-7** on W3C DID and Verifiable Credential
primitives. See [`../protocol/credentials/README.md`](../protocol/credentials/README.md).

---

## 2. What exists today

`reference/identity.js` (stage `IDA-2E-PRE`) resolves an operator-provisioned bearer token
to a stable identity string, from a JSON map in `IDAUTO_ADMIN_IDENTITIES`.

```js
resolveIdentity(token)   // -> identity string | null
clearIdentityCache()     // test/ops helper
```

**It is not authentication**, has no user table, no credential store, no session, no
organisation and no role, and it must never be described as authentication anywhere.

What it does buy — and the reason it exists at all — is that an audit row can say *who*
acted rather than "some admin, unspecified". `writes.js` **fails closed**: it throws before
opening a transaction if no identity resolves, so there is no code path that writes data
with an unattributed audit record. Two distinct tokens producing two distinct `actor_ref`
values is proven by test, not asserted.

---

## 3. The identifier decision, and why it constrains IDauto

The platform contract chose a **string identifier** — `usr_<uuidv7>`, `svc_<name>` for
system actors — over a `BIGSERIAL`. Three reasons, of which the second is IDauto's:

1. **Zero migration.** IDauto's deployed columns are already `VARCHAR(64)`:
   `idauto_contributors.mythos_user_id`, `idauto_user_roles.mythos_user_id`,
   `idauto_audit_log.actor_ref`. A 40-character identifier fits with 24 to spare.
   A `BIGSERIAL` would have forced a type change on a live **append-only audit log** — the
   most expensive column in the system to alter.
2. **Sequential integers are unsafe here.** Community ingestion exposes contributors.
   A `BIGSERIAL` contributor id leaks total contributor count and growth rate, and permits
   trivial enumeration. That is a privacy and abuse-surface defect, not a preference.
   A random-component identifier removes it.
3. Federation and merge-safety across independently-operated deployments.

**Cost accepted:** a 40-byte index instead of 8, and slower joins in principle. At current
scale this is immaterial, and privacy and correctness dominate.

**Scope limit.** Domain identifiers are *not* affected and keep their declared types:
`vehicle_id`, `plate_id`, `observation_id`, `fact_id`, `document_scan_id` remain
`BIGSERIAL`. Only *actor* identity is a string.

---

## 4. Actor reference convention

A contract, not a table. `actor_ref` is already live in `idauto_audit_log`; what the contract
added was the **format rule**.

| Actor | Form | Example |
|---|---|---|
| User | `usr_<uuidv7>` | `usr_018f3c1a…` |
| System service | `svc_<name>` | `svc_idauto-api` |
| Anonymous | `NULL` | — |

`actor_type` vocabulary — `system · contributor · professional_user · admin · anonymous` —
was adopted platform-wide **from IDauto's own live CHECK constraint**, verbatim. IDauto did
not inherit a vocabulary here; it supplied one.

### Hard constraints on `actor_ref`

- **Never** write a bearer token, credential, email or any personal data into it. It carries
  a canonical `usr_`/`svc_` identifier or `NULL`, and nothing else.
- **Never** log the raw value of `IDAUTO_ADMIN_IDENTITIES`. The current parse-failure path
  already avoids this and must keep doing so.
- The audit log is **append-only** and must not be rewritten under any circumstances.
- IDauto **must not** add the platform's format `CHECK` constraints to its own columns.
  Products stay decoupled from another schema's internal validation — which is precisely why
  this repository can stand alone.

---

## 5. Target interface

Any component that turns a credential into an identity must satisfy:

```
resolveActor(credential) -> { subject_ref, actor_type } | null
```

- `subject_ref` — canonical `usr_<uuidv7>` (the column is named `mythos_user_id` today; see
  §7)
- `actor_type` — one of the five values above
- `null` — credential not recognised; callers **MUST** treat this as unauthenticated

`resolveIdentity(token) -> string | null` already has this shape. The change is that values
become canonical and an `actor_type` accompanies the identifier.

---

## 6. Migration procedure — NOT executed

1. Mint one canonical identifier per existing admin token.
2. Re-issue `IDAUTO_ADMIN_IDENTITIES` with the same token keys and canonical values.
   **Token secrets do not change**, so no operator credential rotation is required.
3. Extend `identity.js` to return `{ subject_ref, actor_type }`, keeping `resolveIdentity()`
   as a backward-compatible wrapper until callers are updated.
4. Update the `api.js` / `writes.js` call sites.
5. Re-run the full suite.

**No stored data requires rewriting.** `idauto_user_roles` and `idauto_contributors` hold
**0 rows**, and existing `idauto_audit_log` rows are synthetic fixtures the suites
regenerate.

> **One external dependency, documented.** The origin procedure called
> `identityContract.newUserId()` / `isValidUserId()` / `assertResolvedActor()` from
> `projects/mythos-core/reference/identity-contract.js`, which was **not migrated**. It is a
> **documentation-level** dependency of a procedure that has not run — no IDauto source file
> imports it, and none ever did. A standalone implementation needs a UUIDv7 generator and a
> format validator, both a few lines. This is recorded rather than left implicit because an
> unstated external dependency in an identity migration is exactly the kind of thing that
> surfaces at the worst moment.

---

## 7. Naming, and what IDA-7 changes

| Today | Why it stays | IDA-7 |
|---|---|---|
| `mythos_user_id VARCHAR(64)` | An **opaque external identity reference** that any provider can populate — not a Mythos dependency. Renaming is a breaking migration on live columns | Rename to `subject_ref` |
| `access_scope = 'mythos_private'` | IDauto's own persisted scope vocabulary, used in every access-control path | Rename to `restricted` |
| `mythos_super_admin` | Referenced by `config/idauto.example.json`. Defined by the origin contract as a platform-wide role granting the restricted scope | Replaced by an issuer/role model on DIDs |
| `idauto_organizations.id SERIAL` | A local primary key with real foreign keys from four tables. Retyping it is expensive and avoidable | Unchanged; an additive external org reference if needed |

All four are breaking migrations, scheduled together and deliberately, not opportunistically.

---

## 8. Implementation status

| Element | Status |
|---|---|
| Operator-provisioned admin token → identity map | **IMPLEMENTED** |
| Fail-closed write path (no unattributed audit rows) | **IMPLEMENTED** |
| Distinct `actor_ref` per admin token | **IMPLEMENTED**, test-proven |
| `actor_type` CHECK vocabulary on the audit log | **IMPLEMENTED** |
| Canonical `usr_<uuidv7>` values | **SPECIFIED** — values are currently operator-chosen strings |
| `actor_type` returned by the adapter | **SPECIFIED** |
| Real authentication (users, credentials, sessions, MFA) | **BLOCKED** → IDA-7 |
| Authorisation beyond a role comparison | **NOT STARTED** |
| DID resolution, VC issuance | **SPECIFIED** → IDA-7 |

---

## 9. Published vocabularies (2026-08-18, `IDA-DECOUPLE-3`)

The `actor_type`, `org_role` and `actor_identifier` vocabularies described in §3–§4 above are
now published as machine-readable artifacts under
[`../protocol/vocabularies/`](../protocol/vocabularies/): `actor-type.v1.json`,
`org-role.v1.json`, `actor-identifier.v1.json`. They are data documents describing the
deployed `CHECK` constraints and column widths, not a new design.

Conformance between these artifacts and the live `database/schema.sql` — both named
`actor_type` CHECK sites, `chk_user_role`, and the four `VARCHAR(64)` actor-reference columns
— is enforced offline by
[`../tests/identity-conformance-test.js`](../tests/identity-conformance-test.js) on every run.
The publication is an **additive** change per [`GOVERNANCE.md`](../GOVERNANCE.md) §3; the
reasoning is recorded per §7 in `docs/AI_HANDOVER.md`.

Mythos OS consumes pinned copies of these three files (version + SHA-256 of the raw bytes),
so `mythos-prod`'s identity-core contract test no longer reads `database/schema.sql` or
`reference/identity.js` directly. No schema change, no API change, no runtime change resulted
from this stage.
