# Carte grise capture — Update 5

Capture and **storage** of carte grise source documents. **No OCR and no extraction in IDauto** (owner decision,
2026-11-18): LENS is still under development and is not integrated; every new document is stored as given and marked
`PENDING_LENS`.

## 1. Architecture audit (before the change)

| Area | What existed | Used by |
|---|---|---|
| VIN search | `POST /public/vin` (Update 4): exact VIN → IVID, plate-route disclosure | homepage |
| Plate scanner | `plate-scanner.js` (video + still), Tesseract for **plates** | homepage, workshop « Ajouter un véhicule » — unchanged |
| Carte grise scanner | `registration-scanner.js`: camera / gallery / image paste, Scanic corner detection + perspective, manual corners, recto / verso, **then Tesseract OCR + server parser** | **no page loaded it any more** (homepage mount removed in IDA-UI-4) |
| Carte grise OCR routes | `POST …/registration-document/ocr`, `POST /api/identify/registration-document` | already retired: **410** unless `IDAUTO_CG_OCR_ENABLED=1` |
| Carte grise storage | `idauto_vehicle_documents` (`carte_grise`, face 1/2), versions since Update 4 | workshop dossier, admin dossier |
| Storage | content-addressed media store (`storage.js`), images only | every upload |
| Haddad archive | receiver + monthly tree (Update 4); its LENS submission is **disabled** in production (`IDAUTO_LENS_*` commented out, 2026-11-18) | all files |
| LENS | `/v1/files` accepts PNG, JPEG, WebP, PDF (not text); `tn-vehicle-registration` doctype | not integrated |

## 2. The pipeline

```
 Scanner (camera / gallery / pasted image)      Fichier (image or PDF)      Coller (image or TEXT)
   registration-scanner.js, mode "capture"           carte-grise-capture.js       carte-grise-capture.js
   detection · perspective · corners · rotate          preview · replace            preview · clear
                 │                                         │                             │
                 └───────────────► POST /api/vehicles/:ivid/carte-grise ◄──────────────────┘
                                   (or POST /public/vehicles/:ivid/carte-grise, off by default)
                                   headers: X-IDauto-Face, X-IDauto-Input, X-IDauto-Filename
                                                   │
                         carte-grise-service.store(): type from the BYTES (JPEG/PNG/WebP/PDF magic,
                         strict UTF-8 for text) · limits · duplicate by SHA-256 · original stored unchanged ·
                         new version (previous kept) · archive record (Haddad) · processing_status PENDING_LENS
                                                   │
                         PUT /api/vehicles/:ivid/carte-grise/:id/preview — the corrected crop (camera only)
```

- The **original** is never re-encoded: same bytes, same SHA-256 (camera photo, image, PDF, pasted image, text).
- Pasted **text** is stored as `text/plain; charset=utf-8`, exactly as pasted (Arabic, French, digits, spaces, line
  breaks), type `CARTE_GRISE_TEXT`. It is never converted to a PDF or an image.
- PDF and text are accepted by the media store **only** through this pipeline (`storage.store(…, { documents: true })`);
  every other upload stays images-only.
- A public deposit is `pending_review`: never the vehicle's current carte grise until an administrator accepts it
  (`POST /api/carte-grise/:id/review`, admin only).
- Tesseract stays in `web/vendor/tesseract/` for the **plate** scanner; no carte grise page loads it, and the carte
  grise OCR routes stay retired (410).

## 3. LENS interface (not active)

`reference/lens/lens-adapter.js` is the only place LENS will be called from. `enabled()` is `false`; `submit()` and
`status()` throw `LENS_NOT_ENABLED`. The contract (inputs: original bytes or original text; outputs: fields with
confidence, evidence, extraction version, processing time, missing fields, consistency checks; technical fields only,
never holder data; nothing applied to the vehicle without human validation; VIN mismatch = review, never an update) is
written in that file. The columns are ready: `processing_status`, `lens_job_ref`, `lens_extraction`,
`extraction_version`, `processed_at`, `validation_status`.

Not implemented on purpose (they need extraction): VIN comparison with the searched VIN, mismatch detection,
missing-field detection, low-confidence handling, correction of extracted values. Duplicate detection is implemented
(identical file, SHA-256).

## 4. Database — `database/migrations/ida-u5-carte-grise-sources.sql`

Additive, idempotent. On `idauto_vehicle_documents`: `source_format`, `input_method`, `derived_storage_key`,
`text_chars`, `review_status`, `reviewed_by`, `reviewed_at`, `processing_status`, `lens_job_ref`, `lens_extraction`,
`extraction_version`, `processed_at`, `validation_status`; size check relaxed for PDF / text (no dimensions);
format ↔ MIME check; current version = accepted and not superseded. Archive path accepts `.txt`.
`ida-u4-archive-vin.sql` is aligned (its path check also accepts `.txt`) so it stays re-runnable.

## 5. Configuration

| Variable | Default | Effect |
|---|---|---|
| `IDAUTO_PUBLIC_CARTE_GRISE` | unset (off) | `1` opens the public deposit (owner gate: personal data, legal gates L01/L02) |
| `IDAUTO_PUBLIC_CG_PER_HOUR` | 6 | public deposits per visitor per hour |
| `IDAUTO_CG_IMAGE_MAX_BYTES` / `IDAUTO_CG_PDF_MAX_BYTES` | 12 MB / 10 MB | limits (text: 64 KB) |

## 6. Deployment (only after the owner's approval)

1. `git -C /home/deploy/projects/idauto fetch` and check the merged commit.
2. Backup + restore test: `mythos-backup.service`, `mythos-restore-test.service`, then a dated `pg_dump -Fc idauto_production`
   and a tar of `media/` with SHA256SUMS (as for Updates 3–4).
3. Migration on `idauto_production`: dry run inside `BEGIN … ROLLBACK`, then `psql -1 -f ida-u5-carte-grise-sources.sql`.
4. `git merge --ff-only origin/main` as `deploy`; `systemctl --user -M deploy@ restart idauto-api`.
5. Haddad receiver: copy `ops/haddad/idauto-media-receiver.js` to `~/.local/share/idauto-media-receiver/` (adds `.txt`),
   `systemctl --user restart idauto-media-receiver`. Keep `IDAUTO_LENS_*` commented out.
6. Keep `IDAUTO_PUBLIC_CARTE_GRISE` unset unless the owner decides otherwise.
7. Checks: `/public/carte-grise-config` → `{public_deposit:false}`; signed-in deposit of an image, a PDF and a text on a
   test vehicle; history shows PENDING_LENS; Haddad archive shows `.jpg/.pdf/.txt` under `AAAA/MM/carte-grise/`.

## 7. Rollback

- Code: `git reset --hard <previous commit>` in `/home/deploy/projects/idauto` (as `deploy`), restart `idauto-api`.
  The previous code ignores the new columns; PDF / text rows stay in the table (the old dossier shows image faces only).
- Receiver: restore `idauto-media-receiver.js.bak-*`, restart.
- Database: the migration is additive; reverting it is only needed if no PDF / text / pending row exists (DOWN block in
  the migration). Otherwise restore the pre-deploy dump.

## 8. Update 5.1 — direct workflow (2026-11-18)

- **Where.** The carte grise belongs to the vehicle found: under the identity card (plate or VIN search), never before
  it. Its status comes from the database — `GET /public/vehicles/:ivid/carte-grise-status` → `{ exists, latest_date }`
  only (no id, no file, no holder data; rate-limited like the plate route).
  - **A — exists:** « Carte grise enregistrée » + date, « Consulter la carte grise », « Historique des documents »
    (signed in); « Ajouter une nouvelle version » for an administrator only, as an explicit action.
  - **B — none:** « Aucune carte grise enregistrée » → « Ajouter la carte grise : Scanner · Importer un fichier · Coller ».
  - A visitor sees the status and is asked to sign in; the document itself is never public.
- **No accidental duplicate, enforced on the server.** When a current carte grise exists for a face, an upload is
  refused (409 `carte_grise_exists`); only an administrator with `X-IDauto-New-Version: 1` adds a version
  (409 `carte_grise_exists_new_version_required` without it). Identical files are still answered « already there ».
- **Three separate methods, one preview, one upload** (`web/citizen/carte-grise-capture.js`, `IdaCarteGrise.start`):
  - *Scanner* → live camera at once (`facingMode: environment`), « Capturer », preview, « Reprendre », « Confirmer ».
    Never a file picker. Original = the camera's own photograph (`ImageCapture.takePhoto`) or the full frame as
    lossless PNG. Camera refused / missing → a clear message and « Importer un fichier ».
  - *Importer un fichier* → the system picker at once (image or PDF; PDF preview card + « Ouvrir l'aperçu »).
  - *Coller* → `navigator.clipboard.read()` at once; otherwise a focused Ctrl+V target. Text is not an image: said so;
    keeping it as `CARTE_GRISE_TEXT` is a separate explicit button.
  - Preview: image / PDF / text, type, size, replace (same method), cancel, « Confirmer et enregistrer ». Nothing is
    uploaded before that. Then the identity card refreshes to State A without a new search.
- The old standalone scanner (`registration-scanner.js`) is no longer loaded by these pages.
- Tests: `tests/ida-u5-carte-grise-test.js` (server, 65) and `tests/ida-u51-carte-grise-browser-test.js` (headless
  Chrome with a fake camera, desktop + mobile, 50).
