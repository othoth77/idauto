# ID Auto — Product Specification

**Stage:** IDA-1 Product Vision, Capture, Access and Data Governance Specification  
**Last updated:** 2026-08-05  
**Domain:** idauto.tn  
**Platform:** standalone open protocol · remains interoperable with the Mythos ecosystem (optional integration)  
**Repository:** othoth77/idauto  
**Provenance:** migrated 2026-08-18 from `othoth77/mythos-prod` (`projects/idauto/`, `docs/IDAUTO_*.md`) — see [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md). Content below is the migrated baseline, unchanged except for path and repository references.

---

## 1. Product Vision

ID Auto is a progressively enriched vehicle intelligence platform for Tunisia. Its long-term objective is to build the most complete, privacy-respecting, and legally sound vehicle database covering vehicles across the Tunisian Republic — achieved through legal and traceable data-acquisition channels.

The product begins with manual and public capture opportunities, then expands to the Fixpert Smart Gate camera, professional partner networks, and authorised official sources.

ID Auto is a product within the Mythos platform ecosystem. It does not operate as an isolated platform. Mythos OS provides shared platform services (authentication, billing, audit, notifications, search, document storage). ID Auto provides vehicle intelligence as a distinct product domain within that ecosystem.

---

## 2. Strategic Growth Path

The national vehicle database grows in a deliberate sequence:

| Milestone | Vehicles | Method |
|-----------|----------|--------|
| Pilot | 1,000 | Manual entry, correction cycle, synthetic test data |
| Early growth | 10,000 | Fixpert Smart Gate pilot + first professional partners |
| Network scale | 100,000 | Professional and field partner network |
| National scale | 500,000+ | Authorised source ingestion + nationwide partnerships |

These are strategic targets, not guaranteed forecasts. Each milestone depends on legal approvals and partner agreements defined in subsequent stages.

---

## 3. User Groups

### 3.1 Anonymous Public User

Any person who accesses idauto.tn without an account. Can search vehicle plates and receive public-tier information within rate limits. No registration required for basic search.

### 3.2 Authenticated Contributor

A registered public user who contributes vehicle observations (photos, scans, manual corrections) in exchange for higher rate limits and a trust score. Not a professional subscriber.

### 3.3 Professional Subscriber

A verified organisation (garage, insurer, fleet manager, authorised field team) with a paid subscription. Access to professional-tier data and the ability to write service events for vehicles they have serviced.

**Professional organisation types:**
- `garage` — vehicle repair and maintenance workshops
- `insurer` — insurance companies
- `fleet` — fleet management operators
- `judicial` — judicial officers (huissiers) acting under legal mandate
- `government` — authorised public-sector entities
- `other` — case-by-case review

### 3.4 Fixpert — First Workshop Pilot (Atelier Network)

Fixpert is the first professional workshop pilot on the Atelier Network. It operates as a professional subscriber with additional integration through the Smart Gate camera. Fixpert clients, work orders, invoices and workshop data belong to Fixpert; the vehicle identity layer is shared with ID Auto. Future workshops joining the Atelier Network will have the same relationship: each owns its own customer and operational data; ID Auto owns the vehicle identity layer.

### 3.5 Mythos Super Admin

Mythos platform administrators with privileged read access across all modules, including ID Auto and Fixpert. Every super-admin access or action must be audit-logged. Mythos super-admin visibility does not change Fixpert's legal ownership of its invoices, customers or workshop records.

---

## 4. Access Model

ID Auto uses three access scopes. These replace the simplistic public/private boolean from IDA-0.

### 4.1 PUBLIC

Available to any caller (anonymous or authenticated) within rate limits.

**Publicly returnable fields:**
- Plate number (as searched or confirmed)
- Vehicle colour
- Vehicle category / body type
- Make and model — only after adequate verification and confidence threshold
- Year, fuel type, or technical attributes — only when supported by a trusted source
- Data confidence status: `initial`, `verified`, `incomplete`
- Governorate of registration

**Never public (permanent):**
- Exact observation date and time
- Exact observation location
- Original vehicle image
- Cropped plate image
- Movement history or patterns
- Contributor identity
- Raw OCR output
- VIN
- Carte grise image
- Owner identity, name, address, contact, CIN, passport
- Insurance policy number or insurer identity
- Fixpert customer data
- Workshop invoice or payment data

### 4.2 PROFESSIONAL

Available to verified professional subscribers within their contractual scope.

**Accessible with professional subscription:**
- Approved technical vehicle information beyond public defaults
- Authorised professional service data contributed by the subscriber's own organisation
- Data according to the subscriber's organisation type, role, contract and consent record

**Constraints:**
- An organisation does not automatically see another organisation's private service events
- `is_public = FALSE` service events are visible only to the writing organisation
- Each workshop organisation may see its own workshop and customer activity via its Atelier Network integration (Fixpert is the first)
- No cross-organisation PII access via ID Auto queries

### 4.3 MYTHOS_PRIVATE

Available only to Mythos platform administrators under the super-admin policy. All access is audit-logged.

**Accessible to Mythos Super Admin only:**
- Raw captures (original images, unprocessed files)
- Exact capture time and GPS coordinates
- OCR output (raw and processed)
- Confidence scores per field
- Source identifier and contributor identity
- Camera source identifier (Smart Gate)
- Review and correction history
- Duplicate detection records
- Audit and security events
- Administrative access to Fixpert modules per super-admin policy

---

## 5. Access Matrix

| Data element | PUBLIC | PROFESSIONAL | MYTHOS_PRIVATE |
|---|---|---|---|
| Plate number | ✓ | ✓ | ✓ |
| Colour | ✓ | ✓ | ✓ |
| Category / body type | ✓ | ✓ | ✓ |
| Make / model (verified) | ✓ | ✓ | ✓ |
| Year / fuel (trusted source) | ✓ | ✓ | ✓ |
| Confidence status | ✓ | ✓ | ✓ |
| Governorate | ✓ | ✓ | ✓ |
| Service events (own org) | — | ✓ | ✓ |
| Service events (cross-org, public) | — | ✓ | ✓ |
| Service events (cross-org, private) | — | — | ✓ |
| Observation timestamp (exact) | — | — | ✓ |
| Observation location (exact) | — | — | ✓ |
| Original image | — | — | ✓ |
| Cropped plate image | — | — | ✓ |
| OCR output | — | — | ✓ |
| VIN | — | — | ✓ |
| Movement history | — | — | ✓ |
| Contributor identity | — | — | ✓ |
| Camera source (Smart Gate) | — | — | ✓ |
| Owner name / CIN / contact | — | — | — (never stored in ID Auto) |
| Carte grise image | — | — | ✓ (protected storage) |
| Fixpert customer / invoice data | — | Fixpert own | ✓ (audited) |

---

## 6. Data Ownership

| Domain | Owner | Description |
|---|---|---|
| Vehicle identity (idauto schema) | ID Auto / Mythos | Vehicle fiche, plates, observations, facts |
| Platform infrastructure | Mythos | Auth, billing, audit, notifications, search |
| Workshop operations (Atelier Network) | Each workshop organisation (Fixpert first) | Clients, work orders, interventions, stock, invoices, payments — each org owns its own |
| ID Auto professional subscriptions | ID Auto | Org records, subscription tiers, service events |

**Ownership rule:**
- ID Auto vehicle intelligence belongs to the ID Auto platform.
- Workshop operations, customers, invoices and accounting belong legally and operationally to each workshop organisation (Fixpert for the Fixpert schema; future workshops in their own Atelier Network operational tables).
- Mythos is the platform owner and has MYTHOS_SUPER_ADMIN visibility and administration over the complete ecosystem.
- Every Mythos privileged access or change must be audit-logged.
- Mythos visibility does not change each workshop organisation's ownership of its invoices, customers or workshop records.

---

## 7. Logical Database Architecture

Target database cluster (PostgreSQL — **not yet installed**):

```
PostgreSQL cluster
├── mythos_core schema
│   users, global roles, permissions, global audit, platform administration
│
├── idauto schema
│   vehicles, plates, observations, facts, evidence, documents, captures,
│   sources, review queue, ID Auto activity
│
├── atelier_network schema
│   Workshop registry, inspection providers, work orders, repair estimates,
│   AutoCheck reports, Smart Gate device registry (DRAFT — not deployed)
│
└── fixpert schema (external — not created by this repository)
    Fixpert clients, workshop visits, work orders, interventions, parts,
    stock, quotations, Fixpert invoices, Fixpert payments, workshop activity
```

**Cross-schema policy:**
- `idauto` tables do not contain workshop customer or financial data.
- `fixpert` tables do not duplicate vehicle identity data; they reference `idauto.vehicles`.
- `atelier_network` tables do not store customer PII — each workshop organisation owns its own customer records.
- `mythos_core` is the authority for user identity and global roles.
- Cross-schema joins are permitted only through explicitly defined integration contracts.

PostgreSQL is the **selected target DBMS** for IDA-2 onwards. It is not installed or deployed in IDA-0 or IDA-1. The `database/schema.sql` file is a draft specification, not a deployed migration.

---

## 8. Vehicle Fiche Lifecycle

### 8.1 Core Matching Rule

Every scan, upload, manual entry, document scan or camera detection creates an **Observation** first.

The system then searches for an existing vehicle using:
1. Normalised plate number (primary key for public lookups)
2. VIN — when legally and technically available
3. Trusted matching evidence from verified sources
4. Image similarity — as secondary evidence only; never as the sole identity proof

### 8.2 Existing Vehicle

If the vehicle already exists:
- **Never create a duplicate fiche**
- Add a new observation to the existing fiche
- Record date, time, location, source and capture method
- Extract new facts from the observation
- Compare new facts with existing facts
- Record what is new, unchanged or conflicting
- **Never silently overwrite an existing fact**
- Maintain fact history and evidence chain

### 8.3 New Vehicle

If no matching vehicle is found:
- Create a new vehicle fiche
- Create its first plate link
- Create its first observation
- Insert only the facts that are available and above confidence threshold
- Public profile starts with colour and category / body type by default
- Mark it as "Première observation ID Auto"
- **Never describe this as an official first registration**

### 8.4 Fact Record Structure

Every fact attached to a vehicle fiche must contain:

| Field | Description |
|---|---|
| `value` | The fact value |
| `source` | The source record that produced this fact |
| `observation_ref` | The observation or evidence that established this fact |
| `confidence_score` | 0.0–1.0 confidence in the fact value |
| `verification_status` | `unverified`, `pending_review`, `verified`, `conflict`, `rejected` |
| `access_scope` (renamed from `visibility_scope` 2026-08-10, IDA-2A-CORRECTION-0, R-T03) | `public`, `professional`, `mythos_private` |
| `first_seen_at` | Timestamp of first observation of this value |
| `last_seen_at` | Timestamp of most recent observation confirming this value |
| `validated_by` | Mythos user ID of validator, when applicable |

---

## 9. Public Contribution Model

### 9.1 Limits and Trust

- Limited anonymous submissions (rate-limited by IP hash)
- Authenticated contributor accounts unlock higher submission limits
- Contributor trust score affects how quickly submissions enter the review queue
- High-trust contributors may have submissions auto-accepted for low-risk fields (colour, category)
- Low-trust or new contributors always enter `pending_review`

### 9.2 Duplicate Detection

- Image hashing prevents identical image submissions
- Plate normalisation prevents near-duplicate plate submissions
- Similarity detection for processed derivatives

### 9.3 Contribution Statuses

| Status | Meaning |
|---|---|
| `received` | Submission accepted by server |
| `processing` | Image/OCR pipeline running |
| `pending_confirmation` | Awaiting submitter confirmation of extracted data |
| `pending_review` | In human or automated review queue |
| `accepted` | Integrated into vehicle fiche |
| `rejected` | Not integrated (poor quality, false data, duplicate) |
| `duplicate` | Identified as a duplicate of an existing observation |
| `conflict` | Conflicts with existing fact; escalated to review |
| `blocked` | Contributor blocked; submission rejected without review |

### 9.4 Abuse Controls

- Rate limiting per IP hash and per contributor account
- Abuse and false-data reporting by other users
- Manual correction queue for disputed facts
- Source quality scoring updated on submission outcomes

### 9.5 User Confirmation is Evidence, Not Verification

A user confirming extracted data (e.g. OCR result) counts as supporting evidence and raises the confidence score. It does not constitute official verification. Official verification requires a trusted source (professional subscriber, authorised partner, or authorised official source).

---

## 10. Mythos Super Admin Role

The Mythos Super Admin role has platform-wide visibility for operational, security and audit purposes.

**Capabilities:**
- Read access across all ID Auto records including MYTHOS_PRIVATE tier
- Read access across Fixpert modules for supervision
- Audit log query across all schemas
- Administrative actions on organisations, users, subscriptions (subject to the super-admin policy)
- Configuration changes (logged)

**Constraints:**
- Every super-admin action is logged in `idauto_audit_log` with `actor_type = 'admin'`
- Super-admin access does not grant the right to modify Fixpert financial records
- Super-admin access does not grant the right to expose owner PII outside the defined privacy contract

---

## 11. Public Output Policy

The following rules govern what ID Auto will never return in any public API response, regardless of what data exists internally:

1. Owner name in any form
2. Owner address or locality beyond governorate level
3. National ID number (CIN) or passport number
4. Insurance policy number or insurer identity
5. Phone number or email of any person
6. Date of birth
7. Exact observation timestamp
8. Exact observation GPS coordinates
9. Original capture image
10. Any individual vehicle movement sequence
11. Contributor identity
12. Raw OCR output
13. VIN (public lookup returns vehicle attributes; VIN is MYTHOS_PRIVATE)

---

## 12. LEGAL-REVIEW-REQUIRED

The following items require formal legal review before the corresponding features may be implemented or activated. They are documented here to make the legal dependency explicit.

| Item | Legal question |
|---|---|
| Public image contribution | Can members of the public legally submit photos of vehicles in public spaces in Tunisia? What consent and notice is required? |
| Precise GPS collection | What notice and consent is required to collect and store GPS coordinates of vehicle observations? |
| Public plate lookup service | What legal basis permits operating a public plate search service in Tunisia? |
| Carte grise OCR | What legal basis permits processing a carte grise image? What consent must the document owner provide? |
| Owner identity processing | Under what conditions, if any, may owner identity (CIN, name, address) be processed internally? |
| Surveillance-camera ANPR | What regulatory approvals are required to operate ANPR cameras (Smart Gate) under Tunisian law? Does the INPDP require notification? |
| Data retention periods | What are the minimum and maximum retention periods for verification logs, audit logs, media files and service events under Tunisian law? |
| Contributor consent | What consent must an authenticated contributor provide for their submissions to be stored and used? |
| Data correction / deletion requests | What rights do individuals have to request correction or deletion of data about vehicles linked to them? |
| Professional data sharing | What legal basis permits sharing service event data between professional subscribers? |
| Mythos Super Admin access | What internal governance policy governs super-admin access to Fixpert customer and financial data? |

**No real data collection begins from this IDA-1 documentation commit.**

