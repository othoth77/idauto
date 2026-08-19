# IVID Migration Plan

**Status: PLAN ONLY — NOT EXECUTED.** This document describes how the live
`idauto_vehicles.internal_ref` column would adopt the formal IVID format
(`docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md` §2.1). It authorises nothing by
itself. Nothing in this document has run against a live database, and this
document is not the trigger that would make it run — execution requires an
explicit owner order (a decision, not a technical gate) and the live
database (which nothing built for this stage connects to; see
[`../database/migrations/ivid-migration-dry-run.js`](../database/migrations/ivid-migration-dry-run.js)'s
refusal guard).

**Written:** 2026-08-19, branch `ida4-foundation`, as part of the IDA-4
gate-free foundation subset. Grounded in
[`OPEN_VEHICLE_IDENTITY_PROTOCOL.md`](OPEN_VEHICLE_IDENTITY_PROTOCOL.md)
§2.1, [`protocol/schemas/vehicle.schema.json`](../protocol/schemas/vehicle.schema.json),
[`protocol/schemas/MAPPING.md`](../protocol/schemas/MAPPING.md), and
[`IDA4_READINESS_AUDIT.md`](IDA4_READINESS_AUDIT.md) §H (schema/protocol
groundwork that creates no reachable write path is the arguable, in-scope
part of IDA-4; this plan — a document — is exactly that, and its execution
is not).

---

## 1. Why this is needed

`idauto_vehicles.internal_ref` (`VARCHAR(40) UNIQUE`, `database/schema.sql`
line 234) exists and is populated today with a **deployment-local reference
format** — not the formal `ivid:<version>:<payload>:<check>` format OVIP
§2.1 specifies. `protocol/schemas/MAPPING.md`'s `VehicleID (IVID)` row
states this plainly: "Column exists; format differs. The formal `ivid:`
format is specified, not adopted." Adopting it is named in
`docs/ROADMAP.md`'s IDA-4 deliverable table as "Migration of `internal_ref`
to the IVID format | **SPECIFIED**".

## 2. What does not change

- The column itself: `internal_ref VARCHAR(40) UNIQUE NOT NULL`. No column
  migration is required — see §5 for why the format was deliberately bounded
  to fit it exactly.
- Every other column, table, and foreign-key relationship in
  `database/schema.sql`.
- Vehicle identity semantics: a vehicle's row and its history are
  unaffected. This is a **format** migration of one column's string
  contents, not an identity migration — no vehicle merges, splits, or
  reassigns as a result of this plan.

## 3. Format and issuance

`reference/ivid.js` (this stage) implements the format:

```
ivid:1:<16-symbol payload>:<2-symbol check>
```

- Payload: 16 symbols of Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
  excluding I/L/O/U), from `crypto.randomBytes(10)` — 80 bits of entropy,
  matching OVIP §2.1's "MUST be issued at random with at least 80 bits of
  entropy."
- Check: 2 symbols, a deterministic weighted checksum over the payload
  (documented precisely in `reference/ivid.js`'s header) that provably
  catches every single-symbol substitution and every adjacent
  transposition of two different symbols.
- Full string length: `ivid:1:` (7 chars) + 16-symbol payload + `:` (1
  char) + 2-symbol check = **26 characters** for a v1 IVID.

## 4. Migration procedure (planned, not executed)

1. **Freeze new legacy-format issuance.** Before migration begins, the code
   path that currently mints a fresh `internal_ref` for a newly-created
   vehicle switches to `reference/ivid.js`'s `generate()` for all NEW rows.
   This is a small, forward-only code change and can ship independently of
   backfilling existing rows.
2. **Dual-key window.** For some deployment-chosen period, both the legacy
   deployment-local format and the new `ivid:1:...` format are valid,
   distinguishable values of the SAME column (`internal_ref` stays a single
   `VARCHAR(40)` — no new column is introduced). Any code path that reads
   `internal_ref` must accept either shape during this window; `validate()`
   in `reference/ivid.js` recognises only the new shape, so a caller that
   wants to branch on "is this row migrated yet" uses
   `ivid.validate(row.internal_ref).ok` as the discriminator, exactly as
   `database/migrations/ivid-migration-dry-run.js` does in its synthetic
   model.
3. **Backfill order.** Batches are processed oldest-`created_at`-first,
   in fixed-size pages (recommended starting page size: 500 rows,
   tunable without a design change), each page in its own transaction so a
   failure part-way through never leaves a batch half-committed. For each
   row in a page:
   a. Skip if `internal_ref` already validates as a well-formed IVID
      (idempotent — see §6).
   b. Generate a candidate via `ivid.generate()`.
   c. Attempt the `UPDATE ... SET internal_ref = $candidate WHERE id = $id`
      inside the page's transaction. The column's own `UNIQUE` constraint
      is the real collision guard in production (unlike the dry run, which
      has no live constraint to lean on and does its own in-batch
      collision tracking instead); on a unique-violation, regenerate and
      retry a bounded number of times before failing the row out to a
      manual-review list rather than looping unboundedly.
   d. Write one `idauto_audit_log` row per migrated vehicle, actor
      `svc_ivid-migration` (per `docs/IDENTITY_ARCHITECTURE.md` §4's
      `svc_` service-identity convention), recording the old and new
      `internal_ref` values — this is itself a `Fact`-shaped
      "correction," not a silent overwrite, consistent with OVIP §4's
      "never silently overwrite a historical fact" even though
      `internal_ref` itself is not a `Fact` record today.
4. **Verification pass.** After each page, and once more after the full
   backfill: every row's `internal_ref` validates via `ivid.validate()`;
   the full set is unique (the column's own constraint already guarantees
   this, but an independent application-level count is cheap insurance);
   row count before equals row count after (no row silently dropped or
   duplicated).
5. **Close the dual-key window.** Once 100% of rows validate as the new
   format, any code path still branching on "which shape is this" is
   removed. This is a code cleanup step, not a data step, and carries no
   further migration risk.
6. **Rollback.** Because step 3.d records the old value in the audit log
   before overwriting, a rollback within the dual-key window is a reverse
   backfill: for each audited migration row, `UPDATE ... SET internal_ref
   = <old value> WHERE id = $id`, run in the same paged/transactional
   manner. Rollback is NOT available once a migrated IVID has been
   externally distributed (e.g. printed on a QR code shown to a citizen,
   per `passport.schema.json`'s `qr.payload`) — this plan does not cover
   fabric/print-material re-issuance, which is a product/ops decision for
   whoever authorises execution, not a data-migration concern.

## 5. The `{16,30}` payload bound — rationale

`protocol/schemas/vehicle.schema.json`'s `ivid` pattern bounds the payload
to 16-30 symbols specifically so the maximum possible full IVID string fits
`internal_ref VARCHAR(40)` **exactly**, with no column migration required,
at any future payload length within the bound:

```
"ivid:" (5) + version digits (up to 2, e.g. "99") + ":" (1)
  + payload (up to 30) + ":" (1) + check (2)
= 5 + 2 + 1 + 30 + 1 + 2 = 41 for a 2-digit version... see note below
```

The exact fit for the v1 case that matters today:
`"ivid:1:"` (7 chars: `i-v-i-d-:-1-:`) + 30-char payload (upper bound) +
`":"` + 2-char check = **7 + 30 + 1 + 2 = 40**, matching `VARCHAR(40)`
exactly. v1 itself issues 26-char IVIDs (16-symbol payload, §3 above),
well inside the bound — the upper bound of 30 is headroom for a future
higher-entropy issuance (e.g. moving from 80 to a larger bit count) without
forcing a column-width migration alongside a format change. A double-digit
protocol version (`ivid:10:...`) combined with a 30-symbol payload would
exceed 40 characters by one; this is flagged here as a known edge the
schema pattern does not itself prevent, and is not expected to matter
before IDA-9 (protocol v1.0), by which point a column-width review is
warranted regardless.

## 6. Idempotency

Running the backfill procedure twice must be a no-op on the second pass:
every row already holding a well-formed IVID is skipped (§4 step 3.a).
`database/migrations/ivid-migration-dry-run.js` proves this property
in-memory — it runs its planned transformation twice over the same
synthetic row set and asserts the second run reassigns nothing and every
`internal_ref` value is byte-identical before and after.

## 7. What this plan does not cover

- Execution against the live database (explicitly out of scope for this
  stage — see `docs/IDA4_READINESS_AUDIT.md` §H).
- Any change to who can create a vehicle, register as a citizen, or reach
  a write path — this plan concerns the FORMAT of an existing column on
  existing rows, not access to it.
- Re-issuance of any physical/printed QR material bearing a legacy-format
  reference.
- A decision on the dual-key window's length — that is an operational
  parameter for whoever authorises execution, not fixed here.

## 8. Dry-run tooling

[`../database/migrations/ivid-migration-dry-run.js`](../database/migrations/ivid-migration-dry-run.js)
implements §4's transformation and §4/§6's invariant checks entirely
in-memory, against synthetic rows, with **no database connection of any
kind** — it refuses to run (exit code 3, `REFUSED` to stderr) if any of
the five `IDAUTO_DB_*` environment variables `reference/db.js` reads for a
live connection are set, even though it never reads them for a connection
itself. See that file's header for the full guard rationale and
`tests/ida4-foundation-test.js` for the automated proof (an in-process run
with 50 synthetic rows, and a REFUSED child-process run with a fake
`IDAUTO_DB_HOST` set).

Run it directly: `node database/migrations/ivid-migration-dry-run.js [N]`
(N defaults to 200).
