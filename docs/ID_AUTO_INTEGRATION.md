# IDauto — Integration Contract

**Official integration contract for `atelier.fixpert.tn`.**
Base URL: `https://idauto.tn`
Protocol version: `0.1.0-draft`
Last updated: 2026-08-27

---

## 1. What each side owns

| | Owns |
|---|---|
| **IDauto** | Vehicle identity (IVID, internal_ref, aliases), plates, general vehicle data, facts, observations, provenance, audit |
| **Fixpert / atelier** | Workshop records, its own users, its own scheduling and billing |

IDauto never stores a workshop user account. Fixpert authenticates its own
users; IDauto records **who acted** as provenance and never as an
authorisation subject. This is the owner's decision of 2026-08-27 (option B).

**Fixpert must never connect to PostgreSQL.** Every read and write goes
through the HTTP API below. There is no other supported path.

---

## 2. Authentication

One **service credential per organisation**, sent as a bearer token:

```
Authorization: Bearer <service-token>
```

The credential identifies the **organisation**, not a person. An atelier is a
row in `idauto_organizations` (`org_type = 'garage'`).

- `401` — no credential, or an unrecognised one.
- `403` — the credential is valid but lacks the scope for this route.

Credentials are provisioned by the IDauto operator. Rotating one revokes the
whole organisation's access immediately.

> **Forward compatibility.** The organisation and scope model is independent of
> how the credential is verified. Moving to OAuth2/OIDC later replaces the
> verification step only; organisations, scopes, isolation, provenance and
> audit are unchanged.

---

## 3. Authorization — scopes

| Scope | Grants |
|---|---|
| `vehicle:read` | `GET /api/vehicles/:ref` |
| `vehicle:write` | `POST /api/vehicles` |
| `plate:read` | `GET /api/plates/:plate` |
| `fact:read` | `GET /api/vehicles/:ref/facts` |
| `fact:write` | `POST /api/vehicles/:ref/facts` |
| `observation:write` | `POST /api/observations` |
| `observation:read` | `GET /api/observations/:id` |
| `passport:read` | `GET /api/passport/:ivid` |
| `identity:resolve` | `GET /api/vehicles/:ref/resolve` |

**Any route not listed is administrator-only.** That includes the review
queue, `/health`, ingestion, media, and **merge / split** — an organisation
can never rewrite vehicle identity.

Scopes are exact strings. There is no wildcard, no inheritance and no implicit
scope: a permission that can be inferred is a permission nobody reviewed.

---

## 4. Identifiers

| Identifier | Shape | Public? | Notes |
|---|---|---|---|
| **IVID** | `ivid:1:<payload>:<check>` | **yes** | The vehicle's public identity. Printed under its QR. Issued by IDauto, never chosen, never reused. |
| **internal_ref** | `IDA2D-<base36>-<hex>` | no | IDauto's internal handle. Stable, never reused. |
| **plate** | `SSS TUN NNNN` | **yes** | Canonical machine form. Displayed as `SSS تونس NNNN`. |

**Store the IVID as your primary reference.** Store `internal_ref` if you
need it; both keep resolving forever, including after a merge.

The QR encodes **only** the IVID — never a plate, never a token.

---

## 5. Endpoints

### Search a vehicle by plate — public, no credential

```
GET /public/plates/217%20TUN%20424
→ 200 { "plate_number": "217 TUN 424", "ivid": "ivid:1:…" }
→ 404 unknown or malformed plate (identical bodies — the route confirms nothing)
```

Follows merges: always returns the **canonical** IVID.

### Get the public passport — public, no credential

```
GET /public/passport/ivid:1:…
→ 200 { protocol_version, ivid, vehicle, plates, facts, trust_summary, qr, … }
```

Follows merges: an IVID printed before a merge still opens the canonical
passport. `qr.payload` always equals the served `vehicle.ivid`.

### Get a vehicle — `vehicle:read`

```
GET /api/vehicles/:ref          :ref = ivid or internal_ref
→ 200 { internal_ref, make, model, year, … }
```

### Create a vehicle — `vehicle:write`

```
POST /api/vehicles
{ "make": "SSANGYONG", "model": "…", "year": 2020, … }
→ 201 { internal_ref, ivid, … }
```

Every field is optional. **Send only what you have verified** — IDauto never
invents vehicle data, and neither should a caller. The IVID is issued by the
server; there is no field to propose one.

### Add an observation — `observation:write`

```
POST /api/observations
{
  "vehicle_internal_ref": "IDA2D-…",
  "status": "received",
  "author":           "mechanic-42",          ← REQUIRED
  "source":           "fixpert",              ← REQUIRED
  "source_type":      "workshop_record",      ← REQUIRED
  "source_reference": "FX-2026-000123"        ← REQUIRED
}
→ 201 { observation: { id, org_id, author_ref, source, source_type, source_reference, … } }
→ 400 provenance incomplete — the response names every missing field
```

See §6. `org_id` is taken from your credential; sending one in the body is
ignored.

### Get vehicle facts — `fact:read` · Add a fact — `fact:write`

```
GET  /api/vehicles/:ref/facts
POST /api/vehicles/:ref/facts
{ "fact_key": "colour", "fact_value": "blanc",
  "access_scope": "public", "evidence_type": "document_scan_official" }
```

`access_scope`: `public` · `professional` · `mythos_private`.
`evidence_type`: `document_scan_official` (an official registration document,
legibly read) · `document_scan` · `user_confirmation` · `cross_source_match` ·
`vin_decode` · `professional_assertion` · `automated_check` ·
`admin_validation`.

Facts carry four **independent** dimensions — source, verification status,
access scope and confidence. Verified does **not** mean public: a VIN can be
`verified`, `confidence 1.0`, and `mythos_private`.

### Resolve an identifier — `identity:resolve`

```
GET /api/vehicles/:ref/resolve
→ 200 {
    "requested_ref": "…", "is_alias": true, "merge_hops": 1,
    "requested": { "ivid", "internal_ref", "status" },
    "canonical": { "ivid", "internal_ref", "status" }
  }
```

**Call this whenever a stored reference behaves unexpectedly.** It is the
supported way to follow a merge.

### Merge / Split — administrator only

```
POST /api/vehicles/:ref/merge   { "canonical_ref": "ivid:1:…" }
POST /api/vehicles/:ref/split
```

Not available to an organisation credential (`403`).

---

## 6. Provenance — mandatory

Every observation originating from an organisation **must** carry:

| Field | Source |
|---|---|
| `organization_id` | your credential — never the request body |
| `author` | your user identity, as **you** identify them |
| `source` | the originating system, e.g. `fixpert` |
| `source_type` | e.g. `workshop_record` |
| `source_reference` | **your** record id, so a row is traceable both ways |
| timestamp | set by IDauto (`capture_time`) |

This is enforced by a **database constraint**, not by application code: an
organisation-originated row without complete provenance cannot be stored by
any code path. Incomplete provenance returns `400` naming each missing field.

---

## 7. Merge, split and aliases

Two records that turn out to be one vehicle are merged. **Nothing is ever
destroyed:**

- the merged record keeps its own IVID and internal_ref — permanently;
- its observations, facts, evidence and audit rows are not moved or rewritten;
- no identifier is ever freed, so none is ever reused;
- an identifier minted before a merge keeps resolving, forever;
- a merge is reversible by a split, which restores the previous status verbatim.

**What this means for you:** a reference you stored never breaks. After a
merge it resolves to the canonical vehicle — through `/resolve`, through
`/public/passport/:ivid`, and through the plate route.

---

## 8. Isolation between ateliers

An organisation sees an observation only if **its own** organisation submitted
it, or if the row belongs to no organisation.

Another atelier's record answers **`404`, not `403`** — confirming that a
record you may not read *exists* would itself be a disclosure. Do not treat a
404 as proof that nothing exists.

---

## 9. What is never public

Never on the anonymous surface, under any circumstance:

- **VIN** — deny-listed by fact key *and* by access scope.
- Owner name, address, national ID (CIN) — IDauto does not store them.
- Any `mythos_private` or `professional` fact.
- Media object keys, IP hashes, capture timestamps, internal_ref.

The registration **plate is public** (owner decision, 2026-08-27). The
authoritative plate record is served on the public passport; a
community-submitted *fact* keyed `plate_number` remains deny-listed.

---

## 10. Errors

| Code | Meaning |
|---|---|
| `400` | Malformed request, or incomplete provenance (fields named) |
| `401` | No credential, or unrecognised |
| `403` | Authenticated, but missing the required scope (`required_scope` given) |
| `404` | Not found — **or** not visible to you |
| `405` | Wrong method (`Allow` header given) |
| `409` | Conflict: already merged, not merged, would create a cycle |
| `429` | Rate limited (`Retry-After` in seconds) |
| `500` | Server error. Bodies are generic by design and never echo internals |

Error bodies never contain a credential, a token, a VIN or PII.

---

## 11. Rate limits

The public resolution surface (`/public/plates/:plate`,
`/public/passport/:ivid`) is limited **per client** to **30 requests per
minute**, shared across both routes. Exceeding it returns `429` with
`Retry-After`.

Authenticated organisation routes are not separately limited today. Do not
rely on that: batch where you can, and handle `429` everywhere.

---

## 12. Audit

Every write is audited in the same transaction as the write itself — there is
no code path that writes data without an attributable actor. Audit rows carry
the event type, the acting `actor_ref`, the organisation, the target, and a
salted client hash. **Raw IP addresses are never stored.**

Merges and splits are permanent audit records.

---

## 13. Integration checklist

1. Obtain a service credential and the scopes your integration needs.
2. Store the **IVID** as your primary vehicle reference.
3. Send complete provenance on every observation.
4. Handle `403` (missing scope) distinctly from `401` (bad credential).
5. Treat `404` as "not found **or** not yours".
6. Call `/resolve` when a stored reference behaves unexpectedly.
7. Never send data you have not verified. IDauto invents nothing.
