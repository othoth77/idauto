# ID Auto — Fixpert Integration Specification

**Stage:** IDA-1 Product Vision, Capture, Access and Data Governance Specification  
**Last updated:** 2026-08-05  
**Repository:** othoth77/idauto  
**Provenance:** migrated 2026-08-18 from `othoth77/mythos-prod` (`projects/idauto/`, `docs/IDAUTO_*.md`) — see [`MIGRATION_FROM_MYTHOS_PROD.md`](MIGRATION_FROM_MYTHOS_PROD.md). Content below is the migrated baseline, unchanged except for path and repository references.
**Integration scope:** Fixpert Smart Gate + Fixpert Atelier workshop system

---

> **ATN-0 Amendment Note (2026-08-05):** The Smart Gate architecture described in this document generalises to any participating workshop in the Atelier Network. Fixpert is the first pilot; IDA-4 scope is preserved exactly as specified here. Future workshops joining the Atelier Network will have equivalent Smart Gate integrations under the same ID Auto ownership rules: the participating workshop owns its physical camera device and its consent/notice obligation; ID Auto owns the resulting vehicle observation. One workshop cannot access another workshop's Smart Gate events. This document remains Fixpert-specific for IDA-4; generic ATN multi-workshop Smart Gate is governed by `docs/ATELIER_NETWORK_ARCHITECTURE.md`.

---

## 1. Context

Fixpert is the first professional pilot for the ID Auto platform and for the Atelier Network. It operates as a professional subscriber with a direct camera integration (Smart Gate) for vehicle entry/exit detection at the workshop entrance.

This document specifies the integration architecture, data ownership boundaries, and the Fixpert Atelier relationship. No live camera connection exists in IDA-1. This document is a specification only.

---

## 2. Physical Camera Context

Fixpert currently has **5 surveillance cameras** on the premises.

| Camera | In scope for ID Auto | Notes |
|---|---|---|
| 1 — Selected entrance/exit door | **Yes** | The single camera authorised for Smart Gate ANPR |
| 2, 3, 4, 5 — Other cameras | **No** | Outside ID Auto scope unless separately authorised |

Only the one designated entrance/exit camera feeds the Smart Gate pipeline. The other four cameras are outside the ID Auto integration entirely and are not processed, recorded, or accessed by ID Auto systems.

Authorisation for any additional camera must be explicit and separately approved.

---

## 3. Fixpert Smart Gate Flow

The Smart Gate is an automatic number-plate recognition (ANPR) process triggered by the entrance/exit camera stream.

```
Step 1: Receive authorised RTSP stream
    - Source: single designated entrance/exit camera only
    - Access: authenticated camera source credential
    - Stream processed in near-real-time
    - No continuous recording; event-based capture only

Step 2: Detect a vehicle event
    - Motion or vehicle-presence trigger
    - Capture one or more frames of the vehicle at the door
    - Frames stored temporarily for processing (MYTHOS_PRIVATE)

Step 3: Read and normalise the plate
    - ANPR applied to best-quality frame
    - Plate normalised against idauto_plate_formats catalogue
    - OCR confidence score recorded

Step 4: Classify colour and vehicle category
    - Colour detection from vehicle region
    - Category classification (berline, utilitaire, camion, moto, etc.)
    - Confidence scores recorded for both

Step 5: Prevent duplicate detections
    - While the same vehicle remains near the door, do not create multiple events
    - Deduplication window: configurable in idauto.example.json (fixpert_smart_gate.dedup_window_seconds)
    - Deduplication by plate + time window; secondary: image similarity

Step 6: Determine direction
    - Entry: vehicle approaching from outside
    - Exit: vehicle departing from inside
    - Direction inference method: configurable (single-camera heuristic or two-zone detection)
    - Unknown direction recorded if inference is below confidence threshold

Step 7: Create a MYTHOS_PRIVATE camera observation / movement record
    - CREATE idauto_observations record (immutable)
        capture_method = 'smart_gate'
        camera_source_id → idauto_camera_sources
        capture_time (exact, MYTHOS_PRIVATE)
        plate_candidate
        ocr_confidence
        direction (entry | exit | unknown)
        image_references (MYTHOS_PRIVATE object storage)
        validation_status = 'auto_accepted' or 'pending_review'
    - CREATE idauto_vehicle_movements record (MYTHOS_PRIVATE)

Step 8: Match the existing vehicle
    - Normalised plate searched in idauto_plates
    - Match found → link observation to existing vehicle fiche
    - No match → proceed to Step 9

Step 9: Create a preliminary fiche if no vehicle exists
    - New vehicle fiche created from Smart Gate data
    - Public profile: colour + category only initially
    - Mark as "Première observation ID Auto (Smart Gate)"
    - Plate marked as unverified; pending confirmation from a trusted source

Step 10: Optionally link to Fixpert Atelier
    - Smart Gate event may be linked to a Fixpert work order or visit
    - Link is optional; Smart Gate operates independently of Atelier
    - If linked: the Fixpert work order records the visit; ID Auto records the vehicle event
    - No Fixpert customer data crosses into the ID Auto vehicle fiche
```

---

## 4. Smart Gate Data Stored

The following fields are stored for each Smart Gate event. All are MYTHOS_PRIVATE.

| Field | Type | Notes |
|---|---|---|
| Camera source reference | `idauto_camera_sources.id` | Identifies the specific camera |
| Event direction | `entry \| exit \| unknown` | Vehicle direction through door |
| Exact event timestamp | TIMESTAMPTZ | MYTHOS_PRIVATE |
| Plate candidate | VARCHAR | Raw ANPR output (before normalisation) |
| Plate normalised | VARCHAR | After format normalisation |
| OCR confidence score | FLOAT | 0.0–1.0 |
| Vehicle colour | VARCHAR | Detected colour |
| Colour confidence | FLOAT | 0.0–1.0 |
| Vehicle category | VARCHAR | Body type classification |
| Category confidence | FLOAT | 0.0–1.0 |
| Image references | TEXT[] | Object-storage keys (MYTHOS_PRIVATE) |
| Validation status | VARCHAR | `auto_accepted \| pending_review \| rejected` |
| Vehicle match ID | `idauto_vehicles.id` | NULL if no match |
| Fixpert work order ref | VARCHAR | Optional link to Fixpert system |

---

## 5. What Is Not Published from Smart Gate Data

The following Smart Gate data is **never** published publicly or professionally:

- Exact entry/exit timestamp
- Exact location context (inferred from camera = workshop location)
- Individual vehicle movement patterns (entry/exit history)
- Camera source identity
- Image frames or derivatives
- OCR confidence details

Aggregate statistics (e.g. number of vehicles serviced per governorate, anonymised) may be shared professionally only if no individual vehicle or person is identifiable.

---

## 6. Data Ownership Boundaries

| Data | Owner | Schema | Notes |
|---|---|---|---|
| Vehicle fiche (make, model, colour, etc.) | ID Auto / Mythos | `idauto` | Shared vehicle identity |
| Plate record | ID Auto / Mythos | `idauto` | Canonical plate-to-vehicle link |
| Smart Gate observation | ID Auto / Mythos | `idauto` | MYTHOS_PRIVATE |
| Vehicle movement event | ID Auto / Mythos | `idauto` | MYTHOS_PRIVATE |
| Fixpert client (customer) | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert work order | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert interventions | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert stock / parts | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert quotations | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert invoices | Fixpert | `fixpert` | Never in idauto schema |
| Fixpert payments | Fixpert | `fixpert` | Never in idauto schema |

**The ID Auto system supplies the shared vehicle identity. Fixpert workshop operations, customers, invoices and accounting belong legally and operationally to Fixpert.**

---

## 7. Fixpert Atelier Relationship

Fixpert Atelier is the workshop management system (CRM, work orders, invoicing). It is a separate product domain.

```
Fixpert Atelier
    ├── fixpert.clients       — customer identity and contact (PII, Fixpert-owned)
    ├── fixpert.work_orders   — workshop visit records
    ├── fixpert.interventions — technical operations performed
    ├── fixpert.parts         — parts used
    ├── fixpert.stock         — inventory
    ├── fixpert.quotations    — customer quotations
    ├── fixpert.invoices      — billing records (Fixpert-owned)
    └── fixpert.payments      — payment records (Fixpert-owned)

ID Auto (vehicle intelligence)
    ├── idauto.vehicles       — canonical vehicle fiche
    ├── idauto.plates         — plate-to-vehicle links
    ├── idauto.observations   — Smart Gate and other observations
    ├── idauto.vehicle_facts  — enriched vehicle attributes
    └── idauto.vehicle_movements — entry/exit events (MYTHOS_PRIVATE)

Integration point
    └── fixpert.work_orders.vehicle_id → idauto.vehicles.id
        (Fixpert references ID Auto vehicle identity; no reverse PII join)
```

The Atelier accesses vehicle intelligence through the ID Auto API (professional tier). It does not query the idauto schema directly.

ID Auto does not access Fixpert customer or financial data except through Mythos super-admin (audited).

---

## 8. Mythos Audited Supervision

Mythos Super Admin has read access to both ID Auto and Fixpert modules for platform governance.

**All Mythos super-admin actions on Fixpert data must be logged in `idauto_audit_log`:**

| Action | Log fields |
|---|---|
| Admin reads Fixpert customer records | `event_type='admin.access'`, `target_type='fixpert.clients'`, `actor_ref=mythos_user_id` |
| Admin reads Fixpert invoices | `event_type='admin.access'`, `target_type='fixpert.invoices'`, `actor_ref=mythos_user_id` |
| Admin modifies any record | `event_type='admin.action'`, old/new value snapshots |

The super-admin access policy for Fixpert data (what is permitted, under what circumstances, and with what approval) is defined in the Mythos platform governance policy. That policy is outside the scope of this document.

---

## 9. Deployment Prerequisites for Smart Gate

The following must be in place before the Smart Gate can be activated. None of these exist in IDA-1.

| Prerequisite | Stage |
|---|---|
| PostgreSQL cluster deployed with idauto schema | IDA-2 |
| ID Auto API deployed | IDA-2 |
| Camera source credential system | IDA-4 |
| RTSP stream access from selected camera | IDA-4 |
| ANPR model integrated and tested | IDA-4 |
| Deduplication logic implemented | IDA-4 |
| Entry/exit direction inference logic | IDA-4 |
| Fixpert Atelier work order link | IDA-4 |
| Legal regulatory approval for ANPR operation | LEGAL-REVIEW-REQUIRED |

---

## 10. LEGAL-REVIEW-REQUIRED — Smart Gate Specific

| Item | Question |
|---|---|
| ANPR regulatory approval | Does operating an ANPR camera at a private business entrance in Tunisia require notification to or approval from INPDP (Instance Nationale de Protection des Données Personnelles)? |
| Video retention | What is the maximum permitted retention period for camera frames and derivatives under Tunisian law? |
| Worker privacy | Do workshop employees whose vehicles pass the Smart Gate have data-subject rights that must be addressed? |
| Camera disclosure | Must customers or visitors be notified that ANPR is in operation at the entrance? |
| Cross-border data | If any Fixpert data or Smart Gate data is processed outside Tunisia, what additional requirements apply? |

**No live camera connection is established in IDA-1 or before legal review is complete.**

---

## 11. Scope in This Stage (IDA-1)

This document is a specification only. In IDA-1:

- No camera stream is connected
- No ANPR model is integrated
- No Smart Gate events are created
- No Fixpert Atelier integration code is written
- No Fixpert schema tables are created
- All Smart Gate feature flags remain `false`

Smart Gate implementation begins in IDA-4.

