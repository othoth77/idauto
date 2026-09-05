# IDA-V14 — REAL ANDROID TEST (manual checklist)

**Before merge.** Run on a staging or scratch instance of the branch `ida-v14-carte-grise` (never on production data), with a real Android phone (Chrome), signed in as a **manager** of a test organisation, on a test vehicle. Use your own test card, or a card whose holder has agreed; delete the faces at the end (step 14).

| # | Step | Expected | OK |
|---|---|---|---|
| 1 | `/atelier` → identify the test vehicle → « Scanner la carte grise » | Dialog « Carte grise », « Valider » disabled, « Face 1 — Recto », « Face 2 — Verso (optionnel) » | ☐ |
| 2 | « Scanner la face 1 » | The rear camera opens directly (`capture="environment"`) | ☐ |
| 3 | Take a **real face 1** photo, card entirely visible, flat | Progress Capture → Détection → Correction; « Carte détectée »; preview is the card only, straight; « photo : N Ko » shows the phone size, stored size a few hundred Ko at most | ☐ |
| 4 | Note the sizes shown under the preview | Phone photo 5–10 Mo → stored ≤ ~400 Ko, still legible when zoomed on the passport | ☐ |
| 5 | « Refaire la face 1 » → photo **tilted ~20°** | Still « Carte détectée », preview straightened; otherwise « Ajustez les coins » editor appears and dragging the 4 corners then confirming produces a straight preview | ☐ |
| 6 | Photo in **low light** | Either detected, or the corner editor; never a dead end (the editor's « Retour » returns to the faces) | ☐ |
| 7 | Photo with a **reflection / glare** | Same as 6; if OCR later misses fields, the proposal table shows fewer rows, nothing invented | ☐ |
| 8 | « Terminer avec la face 1 » | Enregistrement → OCR (first time: model download, fra + ara, ~2.4 Mo) → Analyse → proposal table | ☐ |
| 9 | Read the proposal | Plaque / marque / type / VIN / énergie / année / cylindrée / places read from the card; **no holder name, address or CIN anywhere**; conflicts with the fiche shown « conflit — actuel : … » and unchecked | ☐ |
| 10 | « Confirmer » | « Carte grise enregistrée. »; fiche updated only for the checked rows; source `carte_grise_ocr` | ☐ |
| 11 | « Ouvrir le passeport » | Section « Carte grise » with face 1 thumbnail; tap → full image; « Informations extraites » | ☐ |
| 12 | Reload the passport; open it in a private window without signing in | Signed in: still there. Anonymous: no « Carte grise » section at all | ☐ |
| 13 | Back to `/atelier` → scanner → face 1 **and** face 2 (real verso) → « Valider la carte grise » | Both previews; both faces on the passport; face 2 marked « Verso » | ☐ |
| 14 | Replace face 1 (rescan) then delete face 2 and face 1 (manager) | Replacement shows the new image; deletion removes the section (« Aucune carte grise enregistrée. ») | ☐ |
| 15 | Phone settings → Chrome site data for the host | No stored data for the site beyond the session cookie (nothing in localStorage / IndexedDB) | ☐ |
| 16 | Server: `journalctl --user -u idauto-api` during the test | Events `registration_document_stored` / `registration_ocr_done` with sizes and counts only; no OCR text, no name, no path | ☐ |

Record: phone model, Chrome version, photo size before/after, OCR fields read correctly / missed, and any step where the corner editor was needed. A missed field is acceptable (the person types it); a **wrong field pre-checked** is not — report it.
