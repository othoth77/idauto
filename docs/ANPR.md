# ANPR — plate reading

**Stage:** IDA-V11 (scanner) + IDA-V12 (normalisation, workshop use) · **Last updated:** 2026-09-05

## 1. What exists

| | State |
|---|---|
| Operator-initiated camera reading in the browser (Tesseract.js, vendored, same-origin, digits-only whitelist, geometry-based split, weakest-digit confidence) | **IMPLEMENTED** — `web/citizen/plate-scanner.js`, used by `/` and `/atelier` |
| Structured normalisation (TU / RS / Arabic / spaces / reversed key) | **IMPLEMENTED** — `reference/vehicle/plate-normalizer.js` |
| Confidence gate + human confirmation before any lookup | **IMPLEMENTED** — below 0.75 the read is returned as `needs_confirmation`; the search never runs on a plate the person has not seen |
| Automated gate ANPR from a camera stream (Smart Gate) | **SPECIFIED only** — `docs/FIXPERT_INTEGRATION.md`; **LEGAL-REVIEW-REQUIRED** (per-workshop INPDP notification). Not built. |

The implemented ANPR is a person pointing a device at a plate and confirming the reading. No stream is processed, no image leaves the device, no image is stored.

## 2. Normalisation

Input → `parsePlate(raw, { confidence, registrationType })`:

| Input | Result |
|---|---|
| `230 TU 8646` · `230TU8646` · `230 تونس 8646` · `٢٣٠ تونس ٨٦٤٦` · `230 TUN 8646` · `230-tu-8646` | `{ registrationType:'TU', series:'230', number:'8646', normalized:'8646TU230', canonical:'230 TUN 8646', display:'230 تونس 8646', format_code:'TUN_STD' }` |
| `8646TU230` (the search key) | same, with warning `read_as_search_key` (only when the forward reading is impossible) |
| `123 RS 4567` | `registrationType:'RS'`, `format_code:'TUN_RS'`, canonical `123 RS 4567` |
| `GN 123 456`, `CD 12 345`, … | the other catalogue formats, unchanged |
| `230 8646` (no type read) | `{ ok:false, reason:'partial' }` → the UI asks TU or RS (or the hint `registrationType` completes it) |
| `1884523` (one digit run) | `{ ok:false, reason:'ambiguous' }` — never split by guesswork |
| `abc`, empty, too long | `{ ok:false, reason:'invalid_plate' }` |
| any, with `confidence < 0.75` | parses normally, `requires_confirmation:true`, warning `low_confidence` |

The **stored** form is unchanged since IDA-0 (`SSS TUN NNNN`, `idauto_plates.plate_number`); `normalized` is the format-tolerant key. Validity is still decided by the catalogue in `config/idauto.example.json` (AD-3). `TUN_RS` is an **UNVERIFIED DRAFT** like every other pattern: correct it in the configuration, not in code.

## 3. Camera → confirmation → search (the scanner)

1. The engine reads digits only (`tessedit_char_whitelist = 0123456789`), single line.
2. Two clean digit groups of valid lengths → exact read. One run → split at the widest inter-digit gap only when it is ≥ 2.2 × the median gap and both halves are valid lengths; otherwise refused.
3. Confidence = the weakest digit. Page/word confidence from this engine build is always 0 and is ignored.
4. Exact read and weakest digit ≥ 75 → the search runs. Anything else → confirm/correct with editable digits.
5. On `/atelier`, the type (TU / RS) is chosen by the person; OCR cannot read it (digits-only).

## 4. Fallbacks

CAMERA FAILED → type the plate · PLATE NOT FOUND → VIN · VIN NOT AVAILABLE → make / model / motorisation. All three are first-class paths of `WorkshopVehicleService` and are tested (`tests/ida-v12-vehicle-identification-test.js` §11).

## 5. What is never done

No brute force over plate ranges, no lookup on a low-confidence read without confirmation, no third-party site protection bypassed, no image or raw OCR output stored on the server (`ocr_raw_output` is in the `never_public` list and is not persisted at all by this path).
