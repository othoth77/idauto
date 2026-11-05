# IDA-CG2 — OCR validation on real, redacted Tunisian cartes grises (owner gate D7)

**Status:** procedure and tool ready; **not run** — it needs real samples, which only the owner can provide.
Until this report exists and the owner accepts it, OCR accuracy is **unknown**: every test so far uses
synthetic cards drawn by the test suites, which say nothing about real cards (fonts, layout, wear, photos).

## 1. What is measured

The exact production pipeline, with nothing stored:

1. **Browser OCR**, as in `/atelier/carte-grise`: vendored Tesseract `fra+ara`, page segmentation 6, the image scaled
   to ≤ 1800 px, loaded from the staging origin.
2. **Server parsing**: `reference/documents/registration-parser.js` (holder lines dropped first), then the submission
   normaliser, with the two faces combined as `extract()` does (agreeing → read, disagreeing → conflict).
3. **Comparison** with a ground truth typed by a person from the card.

Per field: `correct`, `wrong` (read, but a different value), `missing` (not read or not normalisable), `conflict`
(the faces disagree), `spurious` (read where the card shows nothing). Accuracy = correct ÷ expected.

## 2. Samples (owner)

- **At least 20 cards** for a first decision; 50+ to trust a per-field rate. Mix: old and new cards, worn
  ones, each region you serve, phone photos taken in a workshop (not scans).
- **Redaction before anything leaves your hands**: cover the holder's name, address and ID number (opaque box,
  not blur) on the card or on the photo. The plate and VIN stay readable: they are what is measured.
- Keep the samples **on Haddad only** (e.g. `~/idauto-d7-samples/`, mode 0700). Never in the repository (public),
  never in a ticket or chat.

## 3. Layout

```
~/idauto-d7-samples/
  card01.face1.jpg  card01.face2.jpg  card01.truth.json
  card02.face1.jpg  card02.face2.jpg  card02.truth.json
  …
```

`cardNN.truth.json` — typed from the card; `null` for what the card does not show:

```json
{ "registration": "123 TU 4567", "vin": "VF3XXXXXXXXXXXXXX", "manufacturer": "PEUGEOT", "type": "208",
  "first_registration_date": "2019-03-12", "fuel": "petrol", "engine_cc": "1199", "seats": "5",
  "fiscal_power": "6", "gross_weight_kg": null, "holder_redacted": true }
```

`fuel` uses `petrol | diesel | lpg | electric | hybrid`; dates are `YYYY-MM-DD`.

## 4. Run (on Haddad, staging running)

```bash
ops/staging-cg2.sh status
```

```bash
CHROME=/path/to/chromium node ops/cg2-ocr-validate.js --samples ~/idauto-d7-samples --base http://127.0.0.1:8805 --out ~/idauto-d7-samples/report.json
```

The console prints one status line per card (cards are named by a hash, not by file name) and the per-field table.
`report.json` (mode 0600) holds the same, plus character distances for plate and VIN. **It never contains a plate
or a VIN value, nor any OCR text.** For other fields, a wrong read shows the read and expected values (technical
data only: make, type, fuel…).

## 5. Reading the result — what the owner decides

| Signal | Why it matters |
|---|---|
| `registration` and `vin` **wrong** count | The dangerous failure: a wrong identifier can propose the wrong vehicle. The reviewer must catch it; the count says how often they must. |
| `missing` and `conflict` | Cost, not risk: the reviewer types the value. |
| Per-field accuracy | Sets expectations for the workshop (how much typing per card). |
| `parser_substituted` | The parser changed O→0, I→1 in a VIN; shown to the reviewer as "lu avec substitution". |

Whatever the numbers, CG2 never decides on OCR alone: every field is confirmed, corrected or marked by a person,
and a decision is refused until then (`assessment.ready_for_decision`). The owner decides whether the measured
rates are acceptable for production; **this document makes no such claim.**

## 6. If the rates are poor

In order of cost: better capture guidance on the page (distance, light, flat card); parser vocabulary from the
real labels seen (the current label list is NOT validated on real cards); a layout-aware crop; a different OCR
engine. Each is a separate change, measured again with this tool.
