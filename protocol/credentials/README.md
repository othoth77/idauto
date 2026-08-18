# Credentials — W3C Verifiable Credentials profile

**Protocol version `0.1.0-draft` · SPECIFIED, NOT IMPLEMENTED.**
No credential issuance, verification, DID resolution or revocation exists in this
repository. Target stage: IDA-7.

---

## Position

IDauto does **not** invent identity primitives. Issuer identity is a
[W3C DID](https://www.w3.org/TR/did-core/); an issuer's signed statement is a
[W3C Verifiable Credential](https://www.w3.org/TR/vc-data-model-2.0/).

The reason is not standards-compliance for its own sake. It is that a vehicle passport is
only useful if a party outside IDauto can verify it — an insurer in another country, a
buyer's bank, a customs authority. A proprietary signature format makes every one of those
integrations a bilateral negotiation. A VC makes it a library call.

**Rule:** a proprietary primitive is introduced only where no W3C primitive fits, and each
such case is recorded in §6 with its reason.

---

## 1. Passport is a subject, not a credential

A Digital Vehicle Passport is **not** a VC.

A VC is *one issuer's signed statement at one point in time*. A passport is *an aggregation
of many claims from many issuers over many years*, rendered per request and filtered to the
caller's access scope. Signing that aggregate would mean IDauto attesting to claims it did
not make and cannot vouch for — precisely the "trust the platform" property the protocol
exists to remove.

So:

- Each issuer-signed claim is its own VC.
- The passport references those VCs and presents them with their signatures intact.
- A verifier checks each issuer's signature directly, against that issuer's DID. IDauto is
  the transport, not the authority.

## 2. Credential subject

The credential subject is the vehicle, identified by its IVID:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://idauto.org/protocol/0.1.0/context.jsonld"
  ],
  "type": ["VerifiableCredential", "VehicleServiceCredential"],
  "issuer": "did:web:garage.example.tn",
  "validFrom": "2026-08-18T09:00:00Z",
  "credentialSubject": {
    "id": "ivid:1:7K2QF9WBN4TXJ0R3:HN",
    "event": {
      "type": "service_performed",
      "occurredAt": "2026-08-17",
      "mileageKm": 84210,
      "workItems": ["oil_change", "brake_pads_front"]
    },
    "evidenceHash": "3f5c…"
  },
  "credentialStatus": {
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "1024",
    "statusListCredential": "https://garage.example.tn/status/1"
  },
  "proof": { "…": "…" }
}
```

Notes on that example, all of them load-bearing:

- The subject `id` is the **IVID** — not a VIN, not a plate, not an owner.
- `evidenceHash` is a hash. The evidence artefact itself is never embedded in a credential,
  because credentials travel and artefacts may contain personal data.
- No natural person appears anywhere. The garage is a legal entity with a DID; the vehicle's
  holder is not a party to the credential at all.
- Revocation is a standard status list — never deletion.

## 3. Credential types

| Type | Issued by | Attests |
|---|---|---|
| `VehicleServiceCredential` | garage | Work performed on a vehicle it handled |
| `VehicleInspectionCredential` | inspector | Inspection outcome |
| `VehicleDamageCredential` | insurer, garage | Recorded damage |
| `VehicleMileageCredential` | any issuer | An odometer reading observed directly |
| `PartFitmentCredential` | garage | A part installed or removed |
| `IssuerAccreditationCredential` | accreditor | That an issuer is what it claims to be |
| `VehicleIdentityCredential` | IDauto | That an IVID was issued, and when |

`VehicleIdentityCredential` is the only type IDauto itself issues, and it deliberately
attests the narrowest possible thing: that this identifier was created at this time. It says
nothing about the vehicle.

## 4. DID methods

| Method | Use |
|---|---|
| `did:web` | Default for organisational issuers. Cheap, no ledger, verifiable via DNS + TLS the issuer already has |
| `did:key` | Ephemeral or offline issuers; no resolution infrastructure needed |
| others | A deployment may accept more; the accepted set is deployment configuration, not protocol |

`did:web` depends on the issuer's domain remaining under their control. That is a real
weakness — a lapsed domain breaks resolution — and the mitigation is that historical
credentials remain checkable against **archived** DID documents captured at issuance time.
Archiving the DID document with the credential is therefore mandatory, not optional.

## 5. Revocation

- Standard status-list mechanism (`BitstringStatusListEntry`).
- Revocation **MUST NOT** be implemented by deleting the credential. A deleted credential
  cannot be distinguished from one that never existed, which is exactly the property a bad
  actor wants.
- Revoking a credential does **not** delete the underlying Event or Fact. It changes that
  record's trust assessment, with the reassessment recorded and the prior assessment
  retained.
- Issuer-wide compromise triggers reassessment of every claim that issuer signed. This is
  supported by design because it will happen.

## 6. Deviations from W3C primitives

Recorded here as the protocol requires. Currently:

| Deviation | Reason |
|---|---|
| `IVID` is not a DID | A vehicle is not an agent: it holds no keys, signs nothing, and controls nothing. A DID implies a controller, and the natural controller would be the vehicle's holder — which would attach vehicle identity to a person, defeating the separation the whole architecture rests on. IVID is therefore a plain resolvable identifier used as `credentialSubject.id`, which the VC data model permits. |

No other deviation is currently specified. Any future one must be added to this table with
its justification before it is implemented.

## 7. Selective disclosure

A holder should be able to prove *"this vehicle has a complete service history"* without
disclosing every invoice. This is what BBS+ / SD-JWT-style selective disclosure is for, and
it maps naturally onto passports.

**Status: PLANNED, not specified.** The mechanism is not chosen and the privacy analysis has
not been done. It is recorded here so the credential design does not foreclose it — in
particular, per-claim credentials (rather than one aggregate credential) are what make
selective disclosure possible later.

## 8. Implementation status

| Element | Status |
|---|---|
| VC issuance | **SPECIFIED** — no implementation |
| VC verification | **SPECIFIED** — no implementation |
| DID resolution | **SPECIFIED** — no implementation |
| DID document archiving | **SPECIFIED** — no implementation |
| Status-list revocation | **SPECIFIED** — no implementation |
| JSON-LD context at `https://idauto.org/protocol/0.1.0/context.jsonld` | **NOT PUBLISHED** — the URL does not resolve yet |
| Selective disclosure | **PLANNED** |

The current implementation's identity layer is an operator-provisioned map of admin bearer
tokens to stable identity strings — deliberately minimal, explicitly not an auth service,
and unrelated to anything in this document. See
[`../../reference/IDENTITY_ADAPTER.md`](../../reference/IDENTITY_ADAPTER.md).
