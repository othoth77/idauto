# Vehicle photographs: analysis, front and rear, capture location (Update 3)

Builds on Update 2 (docs/VEHICLE_RECOGNITION.md). Where the two differ, this document is the current one.

## 1. What it does

On « Ajouter un véhicule », the person photographs the whole front or rear of the vehicle — or picks image files —
instead of aiming a camera at the plate.

```
take a photograph / choose an image  →  preview (analyse it or retake it)
  →  the file's own EXIF is read: GPS position, capture date
  →  location of THIS photograph: EXIF → device position (taken here, allowed) → typed by hand → unknown
  →  analysis: the plate is looked for on the whole photograph and read; colour hint;
               make, model, version, body type and view when the vehicle analysis is configured
  →  several photographs are combined; disagreements are shown, never settled silently
  →  result card  →  Confirmer / Corriger / Recommencer  →  form prefilled  →  the person saves
  →  each photograph is stored with its own view, date, location and analysis
```

Nothing is saved before the form is submitted. Every value can be corrected. The plate-only video scanner of
Update 2 remains as « Scanner la plaque en vidéo ».

## 2. Where each thing happens

| Step | Where | Leaves the device / the server? |
|---|---|---|
| EXIF position and date | browser (`web/citizen/photo-meta.js`) | no |
| Reducing the image (1600 px, JPEG) — the uploaded copy carries no hidden metadata | browser | — |
| Plate localisation and reading | browser (Update 2 detector + Tesseract.js) | no |
| Colour hint | browser | no |
| Make, model, version, body type, view, a second reading of the plate | server → vision provider | **only when configured** (§5) |
| Resolving coordinates to a place | server, offline (`reference/photos/tn-geo.js`) | no |
| Storing the photograph | server: private media store + PostgreSQL metadata | no |

Three kinds of value are never confused. Each one carries its source, in the page and in the database:

- **read / named from the image**: `ocr` (digits read on the device), `vision` (named by the vision model),
  `camera` (the device's colour estimate);
- **typed by the person**: `manual`;
- **confirmed by the person**: the form's own fields — what is saved on the vehicle is always what the person
  confirmed (`idauto_vehicles.make, model, colour, body_type, year`), with the proposals kept beside them
  (`visual_recognition`, Update 2) and on each photograph (`analysis`).

## 3. Front and rear

A rear photograph usually carries the plate; a front one often does not, and that is not a failure: the plate is
reported as absent for that photograph and the rest of its analysis stands. When several photographs are supplied:

- the plate comes from the photograph(s) that show it — the accepted, more confident reading is proposed;
- each other field takes the vision value when there is one, otherwise the more confident value;
- **two photographs that disagree** (two plate readings, two colours…) produce a visible warning naming the field
  and both values; the person decides. The device's reading and the model's reading of the same plate are compared
  the same way;
- a value already typed in the form is never overwritten.

If the registration already exists, the card offers « Ouvrir sa fiche » and « Ajouter ces photos à ce véhicule »;
Confirm is disabled and no second vehicle is created (the save itself answers 409).

## 4. Location — it belongs to the photograph

Order, and no other:

1. **EXIF**: valid GPS coordinates written in the file → stored exactly, source `exif`.
2. **Device position**: only for a photograph *taken* in the application, only after the person pressed « Prendre
   une photo » (the permission is asked then, with an explanation), only if they allow it → source `browser`.
   A refusal never blocks the photograph. A file *chosen* from the device never receives the current position.
3. **Typed by hand**: governorate (24) and delegation or locality (suggestions; free text accepted) → source
   `manual`, **no coordinates**.
4. Otherwise the location stays unknown (all NULL).

Never used: the uploader's current position for an old file, an IP address, a guess.

Stored per photograph: latitude, longitude (the original values), place name, governorate, country, source, capture
date. The vehicle record has no location column; the list's column is « Lieu de la dernière photo », with its date.

**Resolving coordinates is offline and approximate.** The server names the nearest of about a hundred listed towns
when the point is within 12 km of it, and that town's governorate; otherwise only the governorate whose centre is
nearest. It is shown as « (approximatif) » and can be corrected (the coordinates and their source are kept). The
delegation lists and town positions were compiled by hand and should be checked against official data; a point
near a governorate border can be assigned to the neighbouring one.

## 5. Vision provider: status and configuration

**Status: not configured — make, model, version and body type are NOT recognised automatically.** The page says so,
the fields stay empty for the person to type, and nothing is simulated. What exactly is missing:

```
IDAUTO_VISION_PROVIDER=anthropic
IDAUTO_VISION_API_KEY=<a key of the provider>      # or ANTHROPIC_API_KEY
IDAUTO_VISION_MODEL=claude-opus-5-5                # optional (default)
```

in the **server's** environment file (mode 0600), plus the provider's package installed on the server
(`npm ci`; on production it could not be installed on 2026-11-16 because of a file-permission problem in
`node_modules`, to be fixed first). Never in Git, in the browser, in logs or in an API response: the key is read
only by `reference/recognition/vehicle-vision.js`.

When enabled: the browser sends the reduced JPEG to our own route (`POST /api/workspace/vehicle-recognition`,
signed-in, `vehicle:write`, 12 a minute per account); the server sends that one image to the provider with a fixed
instruction and a JSON schema; the answer is filtered (confidence ≥ 0.6, no model without its make, no version
without its model, a year only with direct evidence, a plate only in the Tunisian shape) and every value is marked
`source: vision`. The model is told never to infer anything from the registration number. The photograph is not
stored by that route; an audit line records who sent it. Retention on the provider's side follows the operator's
agreement with the provider. A vehicle photograph can show people and places: enabling the analysis is the
operator's decision and belongs in the privacy notice first.

## 6. Data

`database/migrations/ida-u3-vehicle-photos.sql` — additive, idempotent, no existing row changes:

- a photograph's file is referenced by a row of `idauto_vehicle_documents` with `document_type = 'vehicle_photo'`
  (the two CHECK constraints of that table are widened; a carte grise still has faces 1 and 2). **Why there:** the
  nightly off-host backup copies every file referenced by that table, so photographs are backed up with no change
  to the backup, and the "is this file still referenced?" rule keeps working;
- new table `idauto_vehicle_photos` (one row per photograph): view, capture date, original coordinates, place,
  governorate, country, location source, analysis (JSON), confidence, confirmed.

No image bytes in PostgreSQL. The same image stored twice for one vehicle by one workshop returns the existing
photograph. A workshop reads, corrects and deletes its own photographs only; images are served to signed-in
accounts, private and uncached. Rollback: previous release + restart; the widened checks and the new table are inert
for older code. Do not run the DOWN block without the owner (it deletes photograph metadata).

Routes: `GET|POST /api/vehicles/:ref/photos`, `PUT|DELETE /api/vehicles/:ref/photos/:id`,
`GET /api/vehicles/:ref/photos/:id/image`, `GET /api/workspace/geo/tn`, `GET /api/workspace/geo/resolve`.

## 7. What was measured (2026-11-16) — and what was not

### Measured

| What | On what | Result |
|---|---|---|
| Plate found on a whole photograph and read, real plate | the owner's reference photo (`173 تونس 8116`, a 267 × 354 px screenshot enlarged ×3) | found; read 173 / 8116, proposed « à vérifier » (74 %) |
| Plate found and read, drawn plates | 80 composed images (10 car photos × 8 conditions) | see the table in docs/VEHICLE_RECOGNITION.md §6.1, re-run on this code |
| EXIF GPS extraction | 4 test files carrying coordinates written by a test tool (Khelidia, Tunis, Sfax, Paris) + 2 without | 4/4 positions read to 5 decimals, 4/4 dates; 2/2 "no position" |
| Offline place resolution | the same 4 positions | Khelidia → Khelidia, Ben Arous · Tunis → Tunis · Sfax → Sfax · Paris → outside Tunisia, no name |
| Device position | emulated browser position, permission granted / refused | granted: attached to the photograph taken here, resolved La Marsa, Tunis; refused: unknown, photograph still taken; a chosen file: never |
| Manual location | governorate + locality typed | stored as manual, no coordinates |
| Two photographs, one vehicle | rear with plate + front without | plate from the rear, front analysed without failing, colour disagreement shown |
| New vehicle, end to end | photographs → card → form → save → dossier → list (French, desktop) | 28/28 checks |
| Existing vehicle | the owner's plate, photographs added to the existing record (Tunisian Arabic, phone-sized) | 24/24 checks, no duplicate vehicle |

### NOT measured

- **Make, model, version, body type, view and the model's plate reading: nothing measured.** The provider is not
  configured; the module is tested against a stub only. The reference vehicle (Chevrolet · Aveo LS · black · sedan)
  has not been through a real model.
- **No real phone.** Camera capture (`<input capture>`), the permission prompt on a real device and real EXIF from
  a phone camera were not exercised. Many phones strip GPS from a photograph handed to a web page: then the device
  position (if allowed) or a typed place is used.
- **GPS accuracy on real files**: the test positions were written into the files by a tool; no photograph with a
  camera-written position was available.
- One real Tunisian plate only, from a small screenshot. The other plates are drawn.
- Place resolution was checked on 4 points; it is approximate by design (§4).

## 8. Files

- `web/citizen/photo-meta.js` (EXIF, location priority, combining), `reference/app-photos.js` (registration page),
  `reference/app-dossier-photos.js` (dossier), `reference/app-register.{html,js}`, `reference/app-dossier.{html,js}`,
  `reference/app-vehicles.js`
- `reference/photos/photo-service.js`, `photo-clean.js`, `tn-geo.js`; `reference/workspace-routes.js`;
  `reference/workspace/workspace-repository.js`; `reference/recognition/vehicle-vision.js`
- `database/migrations/ida-u3-vehicle-photos.sql`
- `ops/ui/i18n/strings-04-update3.json`, `reference/i18n-catalog-ar.js`
- `tests/ida-u3-photos-test.js` (offline), `tests/ida-u3-photos-db-test.js` (database)
