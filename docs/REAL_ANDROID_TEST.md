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

---

## Reaching the branch from the phone (staging instance, never production)

The staging instance is prepared on the VPS: branch `ida-v14-carte-grise`, **scratch database `idauto_scratch_android`** owned by the dedicated PostgreSQL role `idauto_staging` (no access to `idauto_production`, verified), media in `/home/deploy/deployments/idauto-staging/media`, port **3999** on loopback, throwaway Better Auth secret generated at each start, no organisation service credentials. Environment: `/home/deploy/deployments/idauto-staging/.env` (0600, `deploy`).

| Action | Command (as `deploy`, in the branch checkout) |
|---|---|
| start | `ops/staging-v14.sh start` |
| stop | `ops/staging-v14.sh stop` |
| status | `ops/staging-v14.sh status` |
| prove the database is scratch (and that production is unreachable with this role) | `ops/staging-v14.sh check-db` |
| create the tester account | `IDAUTO_TEST_EMAIL=… IDAUTO_NEW_PASSWORD='…' ops/staging-v14.sh user` |

**HTTPS for the phone (required for the camera).** The nginx server block `/etc/nginx/sites-available/staging.idauto.tn` (→ 127.0.0.1:3999, `noindex`) is written but **not enabled**. Owner steps, in order:
1. DNS: create the A record `staging.idauto.tn → 51.68.226.211` (same host as idauto.tn). No record exists today.
2. On the host: `ln -s /etc/nginx/sites-available/staging.idauto.tn /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx`, then `certbot --nginx -d staging.idauto.tn` (adds the 443 block and the redirect).
3. `https://staging.idauto.tn/login` from the phone.

**Fallback without DNS (one session):** on a laptop `ssh -L 3999:127.0.0.1:3999 deploy@51.68.226.211`; start the instance with `IDAUTO_STAGING_INSECURE=1 ops/staging-v14.sh start` (cookies without `Secure`, staging only); on the Android phone (same Wi-Fi as the laptop) set `chrome://flags/#unsafely-treat-insecure-origin-as-secure` to `http://<laptop-ip>:3999`, relaunch Chrome, open `http://<laptop-ip>:3999/login`. Remove the flag afterwards.

Delete the faces at the end of the test; the scratch database and media directory can be dropped.

**This checklist has not been executed yet.** It needs a person, an Android phone and a real Tunisian carte grise; the automated suites cover the same journey on a synthetic card only.
