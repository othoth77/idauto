# ID Auto — Capture Pipeline Specification

**Stage:** IDA-1 Product Vision, Capture, Access and Data Governance Specification  
**Last updated:** 2026-08-05  
**Domain:** idauto.tn  
**Repository:** othoth77/idauto  
**Provenance:** migrated 2026-08-18 from `othoth77/mythos-prod` (`projects/idauto/`, `docs/IDAUTO_*.md`) — see [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md). Content below is the migrated baseline, unchanged except for path and repository references.

---

## 1. Overview

The ID Auto capture pipeline is the process by which vehicle data enters the system — from raw input (camera, photo, document, manual entry) to an integrated vehicle fiche with verified facts.

The pipeline is **observation-first**: every capture creates an Observation record before any matching, fact extraction or fiche creation occurs. Observations are immutable source events; facts derived from them are versioned and evidence-backed.

No capture pipeline code exists in IDA-1. This document is a specification only.

---

## 2. Scanner Modes

The primary public-facing entry point is a single button:

> **Scanner un véhicule**

The scanner may automatically detect the content of a submitted image, or present explicit modes:

| Mode | Label (FR) | Description |
|---|---|---|
| `plate_scan` | Scanner une plaque | Photograph or upload an image focused on a plate |
| `vehicle_scan` | Scanner une voiture | Photograph or upload a vehicle image |
| `carte_grise_scan` | Scanner une carte grise | Photograph or upload a carte grise document |
| `photo_import` | Importer une photo | Import an existing photo from device storage |

Future modes (not implemented in IDA-1 through IDA-3):

| Mode | Label (FR) | Notes |
|---|---|---|
| `vin_scan` | Scanner un VIN | VIN label on dashboard or door frame |
| `odometer_scan` | Scanner le compteur | Odometer reading capture |
| `technical_doc` | Document technique | CT, révision, rapport |
| `invoice_scan` | Facture d'entretien | Maintenance invoice (Fixpert integration scope) |

---

## 3. Observation-First Invariant

```
INPUT (any source)
    │
    ▼
CREATE OBSERVATION RECORD (immutable)
    - capture_time (exact, MYTHOS_PRIVATE)
    - capture_location (exact, MYTHOS_PRIVATE)
    - capture_method (camera | upload | manual | carte_grise | smart_gate)
    - source_id
    - contributor_ref or camera_source_id
    - raw media references (MYTHOS_PRIVATE)
    - status = 'received'
    │
    ▼
PIPELINE PROCESSING
    │
    ▼
VEHICLE MATCHING
    │
    ├── match found ──► ADD OBSERVATION to existing fiche
    │                   EXTRACT FACTS
    │                   COMPARE with existing facts
    │                   RECORD new / unchanged / conflicting
    │
    └── no match ────► CREATE new vehicle fiche
                       CREATE first plate link
                       INSERT available facts
                       MARK "Première observation ID Auto"
```

The Observation record is created **before** matching. It is never modified after creation. Corrections and updates produce new observation or fact records.

---

## 4. Plate / Vehicle Image Flow

```
Step 1: Capture or upload
    - Camera (mobile or Fixpert Smart Gate)
    - File upload from device
    - URL import (admin only)

Step 2: Image quality check
    - Resolution threshold
    - Blur detection
    - Lighting adequacy
    - Reject with user feedback if below threshold

Step 3: Detect vehicle and plate regions
    - Object detection model identifies vehicle bounding box
    - Plate region detected and isolated
    - If no plate detected: offer manual entry fallback

Step 4: Crop the plate region
    - Perspective correction applied
    - Cropped image stored as derivative (MYTHOS_PRIVATE reference)

Step 5: OCR and plate normalisation
    - OCR applied to cropped plate region
    - Raw OCR output stored (MYTHOS_PRIVATE)
    - Normalised plate: uppercase, standard spacing, stripped artefacts
    - Matched against idauto_plate_formats catalogue
    - Unmatched plate → flagged as unknown_format, sent to review queue

Step 6: Detect vehicle colour
    - Dominant colour extracted from vehicle region (excluding plate, windows)
    - Mapped to standard colour vocabulary: blanc, noir, gris, rouge, bleu, vert,
      jaune, orange, marron, beige, violet, autre
    - Confidence score assigned

Step 7: Classify vehicle category / body type
    - Model classifies: berline, break, SUV, utilitaire, camion, moto,
      scooter, camionnette, bus, tracteur, autre
    - Confidence score assigned

Step 8: Propose make / model
    - Only when confidence score meets threshold defined in config
    - Presented to user as proposal, not assertion
    - Low-confidence make/model stored as unverified fact

Step 9: User confirmation
    - Present extracted data to user for review
    - Plate number (editable)
    - Colour (selectable from palette)
    - Category (selectable)
    - Make / model (editable, if proposed)
    - User edits become additional evidence with lower weight than OCR
    - User confirms → status advances to 'pending_confirmation' → 'accepted' or 'pending_review'

Step 10: Vehicle matching
    - Normalised plate searched in idauto_plates
    - Match found → add observation to existing fiche
    - No match → create new fiche

Step 11: Create observation or new fiche
    - Observation record already created (Step 1)
    - Update observation status
    - Attach facts to vehicle fiche with evidence references

Step 12: Uncertain / conflicting records → review queue
    - Low confidence score
    - Fact value conflicts with existing verified fact
    - Unknown format
    - Duplicate image detected
    → INSERT into idauto_review_queue with priority and reason
```

---

## 5. Carte Grise Flow

The carte grise (vehicle registration card) is the most information-dense document in the pipeline. It contains both public technical data and owner PII. These must be strictly separated.

```
Step 1: Detect document and correct perspective
    - Document boundary detection
    - Perspective transform (deskew)
    - If document not detected: return error with guidance

Step 2: OCR — Arabic and French fields
    - Dual-language OCR (Arabic right-to-left fields, French left-to-right)
    - Raw OCR output stored in protected storage (MYTHOS_PRIVATE)

Step 3: Extract all technically available fields
    Technical fields (may be stored in idauto schema):
    - Plate number
    - VIN (numéro de châssis)
    - Make, model, variant
    - Year of manufacture
    - Body type
    - Fuel type
    - Engine displacement
    - Number of seats
    - Gross vehicle weight
    - Colour
    - Vehicle category (EU category code)

    Owner PII fields (extracted but NEVER stored in idauto schema):
    - Owner full name
    - Owner address
    - Owner CIN (national ID number)
    - Owner date of birth (where present)
    - Registration date

Step 4: Mandatory confirmation form
    - Present all extracted technical fields to submitter
    - Present extracted plate number
    - PII fields are shown to submitter for verification only; they are NOT stored
    - Submitter must confirm the data before it is integrated
    - Submitter acknowledges the privacy and consent notice

Step 5: Match or create the vehicle fiche
    - Same vehicle matching logic as plate scan
    - Technical facts receive higher confidence than visual scan alone
    - Carte grise facts marked as source = 'carte_grise_scan'

Step 6: Store the original document in protected storage
    - Original carte grise image → object storage, MYTHOS_PRIVATE
    - Access: super admin only
    - Reference stored in idauto_document_scans (not in vehicle or plate tables)
    - Retention: LEGAL-REVIEW-REQUIRED

Step 7: Store public technical facts separately
    - Technical fields go into idauto_vehicle_facts with appropriate scope
    - VIN stored in MYTHOS_PRIVATE scope
    - Make / model / year / fuel etc. stored in PUBLIC or PROFESSIONAL scope as appropriate

Step 8: Never expose owner PII publicly
    - Owner name, CIN, address are extracted from the document in memory only
    - They are used to populate the confirmation form for the submitter
    - They are NOT written to any idauto_ table column
    - If the workflow requires linking to a Fixpert customer (see below), the PII
      goes to fixpert.clients, not to idauto schema

Step 9: Carte grise ownership / consent for public contribution
    - Anonymous users may not upload another person's carte grise without consent
    - Public carte grise contribution requires an ownership or consent declaration
    - Ownership declaration: "I am the registered owner of this vehicle"
    - Consent declaration: "I have the explicit consent of the owner to submit this document"
    - False declarations are an abuse violation; contributor trust score penalised
    - LEGAL-REVIEW-REQUIRED: formal consent mechanism design
```

### 5.1 Carte Grise in Fixpert Context

When a Fixpert workshop scans a carte grise for a customer intake:

```
Fixpert customer CRM
    ├── Customer PII (name, CIN, contact) → fixpert.clients
    └── Vehicle link (idauto vehicle_id) → fixpert.work_orders.vehicle_id

ID Auto
    ├── Vehicle technical facts → idauto.vehicle_facts (PUBLIC/PROFESSIONAL scope)
    ├── Original document → protected storage (MYTHOS_PRIVATE reference)
    └── Document scan record → idauto.document_scans (MYTHOS_PRIVATE)
```

Customer PII never crosses into the `idauto` schema. The vehicle identity crosses into the `fixpert` schema as a reference only.

---

## 6. Confidence and Evidence

### 6.1 Confidence Scores

Every fact carries a floating-point confidence score (0.0–1.0).

| Score range | Meaning |
|---|---|
| 0.90–1.00 | High confidence — trusted source or multi-source agreement |
| 0.70–0.89 | Medium confidence — single reliable source |
| 0.50–0.69 | Low confidence — automated extraction, unconfirmed |
| 0.00–0.49 | Very low confidence — speculative; do not display publicly |

Thresholds for displaying to public are defined in `config/idauto.example.json` under `confidence_thresholds`.

### 6.2 Evidence Chain

Each fact references:
- The observation that produced it
- The source that produced the observation
- The capture method
- The confidence score at extraction time
- Any user confirmations (additive evidence, lower weight)
- Any automated cross-checks (VIN decode, make/model database match)

### 6.3 Conflict Handling

When a new observation produces a fact value that conflicts with an existing verified fact:

1. The new fact is stored with its own evidence and confidence score
2. The conflict is flagged in `idauto_vehicle_facts.verification_status = 'conflict'`
3. A record is inserted into `idauto_review_queue` with reason `fact_conflict`
4. The existing verified fact remains the active value until a reviewer resolves the conflict
5. Resolution options: accept new, keep old, escalate to trusted source check

---

## 7. Media and Location Privacy

### 7.1 Media Storage Design

The database stores metadata and object-storage references, not image binaries.

| Asset | Storage | Access scope |
|---|---|---|
| Original capture image | Object storage (private bucket) | MYTHOS_PRIVATE |
| Cropped plate derivative | Object storage (private bucket) | MYTHOS_PRIVATE |
| Processed / blurred derivative | Object storage (semi-private) | PROFESSIONAL or MYTHOS_PRIVATE |
| Carte grise scan | Object storage (private bucket, encrypted) | MYTHOS_PRIVATE |
| Image hash (for duplicate detection) | Database column | MYTHOS_PRIVATE |

**Face and plate blurring:** Where practical, the processing pipeline blurs faces and unrelated plates in derivatives used for review or display.

**Retention:** All media retention periods are **LEGAL-REVIEW-REQUIRED**. No retention periods are specified in this document.

**Access logging:** Access to original images is logged. Who accessed what original, and when, is recorded in `idauto_audit_log`.

### 7.2 Location Policy

Location capture options available to users:

| Option | Notes |
|---|---|
| Current GPS (explicit permission) | User must grant location permission; shown clearly in UI |
| EXIF metadata (if available and allowed) | Read from uploaded image if present; user notified |
| Manual map selection | User selects approximate location on map |
| No location | Always an option; location is optional |

**Exact location and time are always MYTHOS_PRIVATE by default.**

Individual vehicle movement maps are not exposed publicly or professionally. Aggregate, anonymised spatial analysis (e.g. coverage by governorate) is permitted if no individual vehicle or person is identifiable.

---

## 8. Review Queue

The review queue receives observations and facts that require human or elevated-automation review before integration.

### 8.1 Trigger Conditions

| Trigger | Priority |
|---|---|
| Low confidence score (below threshold) | Low |
| Unknown plate format | Medium |
| Fact conflict with existing verified fact | High |
| Duplicate image detected | Low |
| First submission from new contributor | Medium |
| Contributor trust score below threshold | Medium |
| Carte grise with OCR uncertainty | High |
| Flagged by abuse report | Urgent |
| Smart Gate entry with low plate confidence | Medium |

### 8.2 Review Actions

- Accept observation as-is
- Accept with corrections
- Reject (quality, false data, duplicate, policy violation)
- Escalate to senior reviewer
- Request additional evidence from contributor
- Block contributor (abuse)

### 8.3 Review Outcome

Accepted observations are integrated into the vehicle fiche. Rejected observations are marked rejected and never appear in public results. The contributor trust score is updated based on outcomes.

---

## 9. Pipeline Lifecycle Diagram

```
CAPTURE (camera / upload / manual / document)
    │
    ▼
QUALITY CHECK ──── fail ──────────────────────► reject with user guidance
    │ pass
    ▼
CREATE OBSERVATION (immutable, MYTHOS_PRIVATE metadata)
    │
    ▼
PROCESS (detect / OCR / classify / extract)
    │
    ▼
CONFIRM (user reviews extracted data)
    │
    ├── user rejects ──────────────────────────► observation status = 'rejected'
    │
    └── user confirms
            │
            ▼
        MATCH VEHICLE
            │
            ├── match found ──────────────────► ADD OBSERVATION to fiche
            │                                    EXTRACT and COMPARE FACTS
            │                                    CONFLICT? ──► review queue
            │
            └── no match ────────────────────► CREATE new vehicle fiche
                                                FIRST OBSERVATION
                                                INSERT facts (PUBLIC defaults)
            │
            ▼
        CONFIDENCE CHECK
            │
            ├── above threshold ─────────────► accept facts, update fiche
            │
            └── below threshold ─────────────► pending_review, review queue
                                                existing fiche unchanged until review
```

---

## 10. Scope Exclusions — IDA-1

No pipeline code is written in this stage.

The following are explicitly out of scope until the stages noted:

| Feature | Stage |
|---|---|
| OCR engine integration | IDA-3 |
| Object detection model | IDA-3 |
| Smart Gate camera connection | IDA-4 |
| Public capture API | IDA-3 |
| Automated review pipeline | IDA-3 |
| Professional service event write | IDA-2 |
| Real vehicle data | IDA-2 (synthetic only), IDA-6 (authorised sources) |
| PostgreSQL installation | IDA-2 |

