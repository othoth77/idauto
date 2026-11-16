# Automatic plate and vehicle recognition (Update 2)

Status: built and tested locally on branch `feature/update2-auto-recognition-20261116`. **Not merged, not deployed.**
The production scanner is unchanged until the owner approves a release.

## 1. What it does

On « Ajouter un véhicule », **Scanner le véhicule** opens the camera and, without any tap:

```
camera opens → plate looked for (5 times a second) → rectangle follows it → plate steady
  → ONE frame captured → the two digit groups read (OCR) → a second frame must give the same digits
  → vehicle photo analysed (only if configured) → result card → Confirmer / Corriger / Recommencer
  → the form is prefilled → the person saves
```

Nothing recognised is saved by itself. The card shows the captured image, the number, make, model, colour, body type
and how sure each value is; the form stays editable; only the form's submit creates a vehicle.

The public home page uses the same automatic plate detection for its plate search. It never analyses the vehicle.

## 2. Where each thing happens

| Step | Where | Engine | Leaves the device? |
|---|---|---|---|
| Plate localisation and tracking | browser | `web/citizen/plate-detector.js` (our code, no model file) | no |
| Reading the digits | browser | Tesseract.js (already vendored), digits only | no |
| Colour hint | browser | `colourOf()` in the detector | no |
| Make, model, body type, colour | server → provider | `reference/recognition/vehicle-vision.js`, Anthropic Messages API (vision) | **yes, when enabled** |
| Duplicate check | server | `GET /api/search` then the `409` of `POST /api/vehicles/register` | — |

**OCR reads the plate. Vision names what the vehicle looks like.** The registration number is never sent to the
vision provider and nothing is inferred from it. A value from vision is marked `source: 'vision'`, the colour hint
`source: 'camera'`; neither is presented as a fact from a register.

## 3. Plate detection (no model, no dependency)

A Tunisian plate is a black rectangle carrying white characters. On a real plate the word sits tight between the two
groups and is nearly as tall as the digits: `173تونس8116`.

1. every pixel clearly brighter than its neighbourhood is kept (two window sizes: near and far plates);
2. the kept pixels are grouped into shapes; shapes that stand on a dark ground are kept;
3. shapes standing on one line are chained, and the line must read **1–3 single digits · something that is not a
   digit · 1–4 single digits**. The « something » is the word تونس (one or two wide shapes; a digit-like shape that
   overlaps the word belongs to the word — its last letter is as tall as a digit) or, on a spaced plate, a wide gap;
4. the rectangle grows from the characters to the plate; the two digit groups are returned with the number of digits
   counted in each, and each digit's own rectangle.

The frame is looked at on a 640 px copy, and on a 1024 px copy when nothing clear is found (a plate held far away)
and always once at capture time. A look costs about 20–60 ms on a desktop; a slow device is given more time between
looks (the analysis never takes more than about a third of the time). Nothing runs in a hidden tab, and the loop stops
with the camera.

Reading: each digit group is read on its own, so the série and the numéro are known by position and the word between
them is never shown to the reader. When a group reading miscounts (two thin 1s side by side are easily read as one),
each digit is read on its own. A reading is accepted without a warning only when **all** of these hold:

- the reader's confidence in its least certain digit is at least 75 %;
- the number of digits read equals the number the detector counted, in both groups;
- the count is trusted: no digits touching each other, nothing left over beyond the ends, a middle no wider than a word;
- the plate does not lean more than about 2° (digits read off a slanted line are confused with full confidence);
- the contrast between digits and ground is at least 80 grey levels (in poor light a 5 was read as a 9 at 95 %);
- a second frame gave the same digits.

Otherwise the person sees the digits with a warning and validates or corrects them, or switches to **Cadrage manuel**
(the adjustable frame of Update 1, unchanged). These rules are deliberately strict: on the images tested so far most
readings are correct but are still shown for validation (§6). Without the detector script the scanner behaves exactly
as before.

## 4. Vehicle analysis: configuration, privacy, cost

**Off by default.** With nothing configured, make, model and body type are « Non reconnu » and no image leaves the
device. To enable it, the operator sets in the server's environment (never in the repository, never in the browser):

```
IDAUTO_VISION_PROVIDER=anthropic
IDAUTO_VISION_API_KEY=<key>          # or ANTHROPIC_API_KEY
IDAUTO_VISION_MODEL=claude-opus-5-5  # optional; this is the default
```

- The browser calls our own route `POST /api/workspace/vehicle-recognition` (signed-in account with `vehicle:write`,
  12 analyses a minute per account, JPEG of at most 1.5 MB). The page's `connect-src` stays `'self'`.
- The server sends that one JPEG to the provider with a fixed instruction and a JSON schema. The photo is held in
  memory for the request and **not stored by IDauto**. Retention on the provider's side is governed by the operator's
  agreement with the provider.
- One audit line (`vehicle.recognition.vision`) records who sent a photo, its size and that it was not stored. No image.
- A value is shown only when the model's own confidence is at least 0.6; a model is never shown without its make;
  values outside the colour and body-type lists are dropped. Any provider failure gives « Non reconnu » and a
  message, never an error page.
- The scanner dialog tells the person, before the camera opens, whether an image will be sent.
- Cost: one image and a few dozen output tokens per scan, at the provider's current price for the chosen model.

A vehicle photo can show people, a street or a house. Enabling the analysis is the operator's decision and belongs in
the privacy notice (docs/PRIVACY.md) before it is used with customers.

## 5. Data

Registration number, make, model, colour, body type and year already had their columns
(`idauto_plates.plate_number`; `idauto_vehicles.make, model, colour, body_type, year`). They are reused.

`database/migrations/ida-u2-visual-recognition.sql` adds **one nullable column**, `idauto_vehicles.visual_recognition`
(JSONB): for a vehicle confirmed from a scan, what was proposed for each field, by which engine, with what confidence,
and whether the person kept or corrected it. `NULL` for existing vehicles and for vehicles typed by hand. Additive,
idempotent, no existing row changes; the previous release runs unchanged on a database that has it. PostgreSQL 15.

The columns always hold what the person **confirmed**. A value typed before the scan is never overwritten. A
registration that already exists is never created twice: the card offers « Ouvrir sa fiche » and disables Confirm, and
the save itself answers `409`.

The vehicle list shows Immatriculation · Marque · Modèle · Couleur · Année.

## 6. Measured accuracy (2026-11-16) — read this before trusting it

### 6.1 The plate — what was actually measured

**(a) The owner's reference photo** — a real Tunisian plate, `173 تونس 8116`, on a black Chevrolet Aveo LS. The file
supplied is a small screenshot (267 × 354 px; the plate is about 90 px wide), so it was tested as received and
enlarged, which adds no detail.

| Image | Plate located | Digits read | Outcome |
|---|---|---|---|
| as received, 267 px wide | yes, imprecisely | wrong (« 16 ») | not accepted: shown for correction |
| enlarged ×1.5 (401 px) | **no** | — | manual frame or typing |
| enlarged ×2, ×3, ×4, ×5 | yes (3 + 4 digits) | **173 / 8116, correct** | shown for validation (not accepted by itself) |
| close-up crop of the rear, 1280 × 720 | yes | **173 / 8116, correct** | shown for validation |

Camera path with that photo as the camera feed:
- close-up crop: rectangle drawn, `173` / `8116` proposed with a warning, validated in one tap, card shown, and — the
  number being already in the test database — « Ouvrir sa fiche » offered with Confirm disabled;
- whole photo letterboxed in a 1280 × 720 frame (plate ≈ 7 % of the frame width): rectangle drawn, digits **not** read
  (ambiguous), typed by hand;
- whole photo as a portrait feed: **not detected** (the test rig rescales a portrait feed; inconclusive).

The colour hint answered « unknown » on this photo (the panel beside the plate says black, the boot lid above it
reflects the sky: the two places disagree, so no colour is named).

**(b) 80 composed images**: 10 freely licensed photographs of cars (Wikimedia Commons), each with a **drawn** plate
laid out like the owner's real one and pasted over the car's own plate, in 8 conditions. One frame per image, so the
two-frame agreement of the live scanner is not part of these numbers.

| Condition | Plate located (IoU ≥ 0.5) | Read exactly | Accepted without warning | Accepted but wrong |
|---|---|---|---|---|
| normal | 10/10 | 9/10 | 2/10 | 0 |
| far (plate 6–13 % of the frame width) | 9/10 | 7/10 | 2/10 | 0 |
| very far (4–9 %) | 7/10 | 2/10 | 1/10 | 0 |
| light blur | 8/10 | 7/10 | 2/10 | 0 |
| strong blur | 4/10 | 0/10 | 0/10 | 0 |
| low light | 10/10 | 10/10 | 0/10 | 0 |
| low light and far | 9/10 | 7/10 | 0/10 | 0 |
| plate tilted 5° | 10/10 | 5/10 | 0/10 | 0 |
| **all** | **67/80** | **47/80** | **7/80** | **0/80** |

« Accepted without warning » is low on purpose: a correct reading that fails one of the rules of §3 is shown for
validation instead. Earlier versions of the rules accepted more and were wrong 1 to 3 times in 80 (a 7 read as a 4 on
a blurred image; a 5 read as a 9 in poor light; three confusions on tilted plates) — each rule of §3 answers one of
those. Colour hint on the same images: 18 right, 9 wrong, 44 « unknown », 9 without a plate.

**(c) Camera path on composed scenes** (fake camera): plates `173 تونس 8116` and `214 تونس 3907` located, read at 99 %
and delivered to the card with no tap, in French on desktop; a low-light scene shown for validation in Tunisian Arabic
on a phone-sized screen; prefill, save, list and duplicate handling verified. These runs predate the stricter rules:
with them, expect the validation step more often.

### 6.2 Make, model, body type — NOT measured

- No provider key was available, by decision: the analysis stays off. **No make, model or body-type recognition has
  been measured on any image**, including the reference photo (expected: Chevrolet · Aveo LS · black).
- What is tested is the server module against a stub: the request (one JPEG, no registration number, the schema),
  the 0.6 confidence floor, « no model without its make », cleaning of odd answers, every provider failure.
- Colour from the vision model: not measured either. The on-device colour hint is measured above and is weak.

### 6.3 Other limits

- One real plate, from one small screenshot. No real phone camera, no hand movement, no night scene with headlamps.
- The drawn plates use a computer typeface on a clean rectangle: no embossing, dirt, screws, frames or reflections.
- Only `digits · تونس · digits` on one line is looked for: no RS, diplomatic, temporary or two-line plates.
- A plate smaller than about 7 % of the frame width is located but rarely read.

Before production: photograph 30–50 real vehicles with real phones in a workshop, in daylight and indoors, at full
camera resolution, and repeat these tables; enable the provider on staging and measure make and model against the
carte grise.

## 7. Files

- `web/citizen/plate-detector.js` — detection, tracking, colour (new)
- `web/citizen/plate-scanner.js` — automatic loop, group reading, two-frame agreement, manual fallback
- `reference/recognition/vehicle-vision.js`, `reference/recognition/provenance.js` (new)
- `reference/workspace-routes.js` — `GET` / `POST /api/workspace/vehicle-recognition`
- `reference/workspace/registration-service.js`, `workspace-repository.js` — provenance, list columns
- `reference/app-register.html`, `app-register.js`, `app-vehicles.js` — scan button, result card, form fields, list
- `database/migrations/ida-u2-visual-recognition.sql` (new)
- `ops/ui/i18n/strings-05-update2.json`, `reference/i18n-catalog-ar.js`
- `tests/ida-u2-recognition-test.js` (offline), `tests/ida-u2-recognition-db-test.js` (database)
- New dependency: `@anthropic-ai/sdk` (loaded only when the analysis is enabled)

## 8. Release notes for whoever deploys it (owner approval required)

1. `npm ci` (new dependency) — check the host's free disk first.
2. Apply `ida-u2-visual-recognition.sql` to `idauto_production` in one transaction (`psql -d idauto_production -1`).
3. Restart `idauto-api`. The analysis stays off until the three variables of §4 are set.
4. Rollback: previous release + restart. Do not run the DOWN block; the column is inert for older code.
