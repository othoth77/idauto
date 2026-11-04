# Carte grise V2 — audit, gaps and staged plan

**Started:** 2026-11-04 on branch `feature/carte-grise-v2-20261104` (from `main` @ `54b3fa5`). **Not deployed.**
Owner mission: two-sided capture → extraction → existing-vehicle check → update or create → original images in the
dossier, with provenance, verification and audit. This document records what exists, what is missing, what needs an
owner decision, and the stages.

## 1. What already exists (IDA-V14, measured in the code)

| Capability | Where | Notes |
|---|---|---|
| Face 1 / face 2 capture in the atelier and on the homepage, card detection (Scanic), browser optimisation | `web/citizen/registration-scanner.js`, `reference/atelier-ui.js`, `web/citizen/home-registration.js` | the browser re-encodes and resizes before upload (`max_edge` 1600, JPEG 0.85) |
| OCR | **in the browser**: Tesseract.js `fra+ara`, page-segmentation 6 | the server receives the raw text only, never runs OCR |
| Parsing | `reference/documents/registration-parser.js` (shared browser/server) | French/Arabic labels → technical fields with confidence + `source` (face); holder lines dropped by a deny-list; **the label vocabulary has not been validated on real cards** (its own header) |
| Storage | `idauto_vehicle_documents` (V14 migration), `document-storage.js` (private media store, sha256 keys), `image-meta.js` (magic bytes, dimensions) | one row per (vehicle, face); MIME by magic bytes; 6 MB / 400–5000 px; private reads only through an authenticated route, `Cache-Control: private, no-store` |
| Access | `document:read/write/delete`, organisation scope (another organisation's document is a 404), admins | |
| Confirmation | `POST …/registration-document/confirm` → `resolver.confirm()` (the single identification write path, audited) | |
| Identification without storage | `POST /api/identify/registration-document` | VIN (only with `vin:search`, audited), then plate, then make + model |
| Vehicle identifier | **IVID** `ivid:1:<16>:<2>` (`reference/ivid.js`, `ivid-issuance.js`): 80-bit random + check, issued in the creating transaction, `UNIQUE`, permanent; plus `internal_ref` and the `idauto_vehicles.id` sequence | plate changes never change the IVID |
| Tests | `ida-v14-registration-document` (68), `-registration-browser` (46, real OCR on a synthetic card), `-home-registration` (38), `-home-registration-browser` (32) | |

## 2. Gaps against the mission

| # | Requirement | Today | Gap |
|---|---|---|---|
| G1 | Match on current plate, **historical plates**, VIN, aliases; report ambiguity | `findByPlate` = active plates only; `findByVin` = first active fact (`LIMIT 1`), exact key `vin`; `confirm()` picks the plate's vehicle when plate and VIN point to **different** vehicles, silently | **Stage 1** |
| G2 | Never create when identifiers disagree; no duplicate under concurrency | the active-plate unique index prevents a duplicate plate; **nothing prevents two vehicles with the same VIN** (a fact, not unique); make + model alone can "identify" | Stage 1 (matcher) + Stage 3 (locked creation) |
| G3 | Both faces required | face 2 optional ("never alone") | owner decision D2 |
| G4 | A document independent of a vehicle until matched (scan first, decide after) | a document is attached to an existing vehicle from the first upload | Stage 2: a pending document (submission) not yet linked to a vehicle |
| G5 | Versions, retries without loss | a replaced face's bytes are deleted | Stage 2: versioned faces, nothing deleted on replace |
| G6 | Originals without destructive processing | the browser stores an optimised re-encode; the original is not kept | owner decision D4 (disk) |
| G7 | Raw OCR preserved; field-level provenance (side, region), confidence, status; unreadable/missing/absent distinguished | raw text deliberately **never stored** (holder data); fields carry `source` = face, confidence; no region, no per-field status | owner decision D1; Stage 2 data model |
| G8 | Review UI: confirm / correct / unreadable / request better image / reject / confirm match / approve creation | the atelier dialog confirms or edits a proposal for a known vehicle | Stage 4 |
| G9 | Image quality checks (blur, resolution, orientation, completeness), same image twice | dimensions only; card detection in the browser | Stage 2 (sha256 equality across faces = same image twice; resolution) / browser checks |
| G10 | Both images in the dossier | the admin dossier lists document metadata; images open from the passport, signed in | Stage 4 |
| G11 | Backup of the images | the off-host media capture copies only `idauto_observation_media` keys (found 2026-10-30) | owner/ops decision D6 |
| G12 | HYBRID | the orchestrator on Haddad has classes `local-ci`, `selftest.*`, `qwen.infer` (Qwen2.5-7B-Instruct, **text completion only, no vision, no OCR**); production runs on the VPS, which has no route to submit to it | see §4 |

## 3. Owner decisions needed before Stage 2

| # | Question | Why it matters |
|---|---|---|
| D1 | May the **raw OCR text** (it contains the holder's name, address, CIN) be stored? If yes: where, who reads it, retention? | today's privacy rule is "never stored"; the mission asks to preserve it |
| D2 | Is face 2 **mandatory** for every card, or only when the card has one? | changes "complete" and blocks registration on single-sided cards |
| D3 | The vehicle identifier: keep the **IVID** (existing convention: random, unique, permanent, issued in the creating transaction) — or add a **sequential, human-readable number** as well (e.g. `IDA-000123` from a PostgreSQL sequence)? | the mission says "use the existing convention if one exists" **and** "IDs must increment"; both cannot hold for the IVID itself |
| D4 | Keep **untouched originals** (phone photos, 2–6 MB each) in addition to the optimised copy? | production disk is at 91 % |
| D5 | **Holder data**: extract nothing (today), or extract into a restricted store for an authorised role? | legal/privacy policy (`docs/PRIVACY.md`) |
| D6 | Extend the off-host backup to `idauto_vehicle_documents` keys | ops change outside this repository |
| D7 | **Real cards**: provide a few authorised, holder-redacted samples (photos of face 1 and face 2) to validate the label vocabulary | without them, extraction accuracy on real cards cannot be claimed |

## 4. HYBRID — what is real

Measured on Haddad, 2026-11-04: `hybrid` CLI and daemon, classes `local-ci`, `selftest.light/heavy`, `qwen.infer`;
the model reports `capabilities: ["completion"]` (no image input). Therefore:

- **OCR and image analysis: not available in HYBRID.** OCR stays Tesseract.js (local, in the browser, no external call).
- **Normalisation, validation, cross-field checks, duplicate detection: deterministic code in IDauto** (this branch).
  The mission requires deterministic validation separate from AI; a 7B text model adds no certainty here.
- **An AI proposal** (e.g. "explain why these identifiers conflict") could be a `qwen.infer` task later, but it would
  send document content from the production VPS to Haddad (cross-host transfer of sensitive data; no submit path from
  the VPS exists yet). Not built; not claimed.

## 5. Stages

| Stage | Content | Needs |
|---|---|---|
| **1** | **Multi-identifier matcher** (`reference/documents/vehicle-matcher.js`) + read-only route: current and historical plates (any spelling the normaliser accepts), VIN (any key case, active and superseded, permission-gated and audited), merge aliases → `existing` / `ambiguous` / `none` with evidence; make + model is never a match. | nothing — built on this branch |
| 2 | Pending registration document (not yet linked), versioned faces, both-faces rule, same-image check, per-field extraction records (raw/normalised/side/confidence/status) | D1, D2, D4, D5 |
| 3 | Locked decision path: link to the matched vehicle (proposals only, verified values never overwritten) or create (transaction + advisory lock on plate/VIN, IVID issued inside, faces linked atomically) | D3 |
| 4 | Review UI (atelier + admin) and both images in the dossier | 2, 3 |
| 5 | Browser end-to-end on synthetic cards; backup coverage | D6, D7 |

## 6. Owner decisions recorded (2026-11-04)

| # | Decision |
|---|---|
| D1 | The raw OCR text is **not stored**. It is parsed in memory on the server and dropped; only per-field technical readings are kept. |
| D2 | Both faces are required when the card has two (`two_sided`, default true; a single-sided card needs a stated reason). |
| D3 | The vehicle identifier stays the **IVID** — no second ID system. |
| D4 | The stored bytes are the **original upload**, never replaced by a compressed copy. Storage report below; no capacity change adopted. |
| D5 | **No holder data** is extracted (field allow-list in code and in the table's CHECK; holder lines dropped by the parser). |
| D6 | The off-host backup of document images is a **precondition for production use**. |
| D7 | Accuracy is **not claimed** until tested on real, holder-redacted Tunisian cards. |

### D4 — storage and backup report (measured 2026-11-04, read only)

| Item | Value |
|---|---|
| Production disk | 91 % (7.0 GB free) after the approved cleanup |
| IDauto media root today | 153 KB, 130 files (1 observation image + test leftovers) |
| Carte grise images in production | **0** (V14 table empty); V2 tables not created in production |
| Expected size | originals ≈ 2–6 MB per face → ≈ 4–12 MB per card; 100 cards ≈ 0.4–1.2 GB, plus thumbnails (≤ 512 KB) |
| Off-host backup | `mythos-backup.service` (nightly, verified). Its media capture (`mythos-prod/ops/backup/mythos-backup-capture.sh`) selects keys from `idauto_observation_media` **only** → **neither V14 nor V2 document images are backed up today** |

Needed before production (owner, other repository): extend the capture's key query to
`idauto_registration_submission_faces.storage_key`, `thumb_storage_key` (and V14's `idauto_vehicle_documents`), then
watch one nightly run and one restore test. Capacity: at 91 % disk, a real roll-out needs either more disk or an
off-host object store for originals — a decision, not made here.

## 7. Stage status (branch `feature/carte-grise-v2-stages-2-5`)

| Stage | Status | Evidence |
|---|---|---|
| 1 matcher | built (also PR #42) | `ida-cg2-vehicle-matcher-test` 33/0, 8 mutations |
| 2 submissions, versioned originals, fields with provenance | **built** | `ida-cg2-registration-submissions-test` §1–§4 |
| 3 locked link / create | **built** | same suite §5–§9 (incl. two concurrent races), 11 mutations caught |
| 4 review page + images in the dossier | **built** | `/atelier/carte-grise`, admin dossier « Cartes grises vérifiées » |
| 5 end-to-end | **built on synthetic cards** | `ida-cg2-carte-grise-browser-test` (real Tesseract OCR) |
| Accuracy on real cards (D7) | **not done** | needs authorised redacted samples |
| Backup of the images (D6) | **not done** | change in `mythos-prod` backup capture |

### Found and fixed while building
- The parser **silently corrected** VIN characters (O→0, I→1, Q→0) and kept only the corrected value: it now also returns
  what was read (`raw`) and `corrected: true`, shown to the reviewer.
- The parser's unlabelled plate detector read **a piece of a VIN** (« …4TU7… ») as a registration number, producing a
  false conflict between the faces: the plate must now stand alone (found by a randomised test, pinned by a fixed one).
- `saveIdentification` / `attachVin` overwrite existing values and replace the VIN: the V2 link path does not use
  them — it fills only missing columns and records every difference as a discrepancy.

### Known limits
- The server checks format by magic bytes and dimensions; it does not fully decode the image (no image library). The
  browser decodes it (`createImageBitmap`) before upload and refuses what it cannot decode.
- Sharpness is measured in the browser (Laplacian variance) and reported; it warns, it does not block — a person decides.
- Rotation / orientation is not corrected or detected on the server.
- An interrupted upload can leave an unreferenced, content-addressed file in the media store (no row points to it).
- A VIN is never shown back: the operator reads it on the photo and confirms or types it.
- No database constraint makes a VIN unique (existing data and tests rely on that); duplicates are prevented by the
  matcher plus an advisory lock per plate/VIN during the decision.
