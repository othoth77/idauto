# IDA-CG2 — staging environment and owner acceptance guide (carte grise V2)

**Purpose:** let the owner test carte grise V2 personally, as a real user, before any merge or production step.
**Status:** staging runs on Haddad from PR #43's branch. **Nothing is merged, nothing is deployed, production
is untouched.** Production use stays blocked by gates D6 (off-host backup installed and verified on the VPS) and
D7 (OCR measured on real redacted cards), see `docs/CARTE_GRISE_V2.md` §6 and `docs/DEPLOYMENT.md` §6.

## 1. What staging is

| | Staging | Production |
|---|---|---|
| Host | Haddad (tailnet only) | VPS |
| Code | worktree `~/projects/worktrees/idauto-staging`, detached at the PR #43 commit | `main` |
| Database | its own PostgreSQL cluster `127.0.0.1:55440`, database `idauto_scratch_cg2_staging`, non-superuser role `idauto_staging_cg2` | `idauto_production` (VPS) — never reachable from staging |
| Media | `~/.local/share/idauto-staging/media` | VPS media root |
| Accounts | 4 synthetic accounts (below) | real users |
| Data | synthetic only (« SPÉCIMEN ») | real |
| Services | user units `idauto-staging-db`, `idauto-staging-api`, **not enabled at boot** | systemd on the VPS |

`ops/staging-cg2.sh check` proves the isolation: the cluster holds only the staging database, no service tokens, no
provider credentials, media under the staging directory, both ports bound to 127.0.0.1.

## 2. Operating it (on Haddad)

```bash
cd ~/projects/worktrees/idauto-staging
```

| Command | Effect |
|---|---|
| `ops/staging-cg2.sh status` | units, code commit, origin, database, media size |
| `ops/staging-cg2.sh start` / `stop` | start or stop both units (after a reboot: `start`) |
| `ops/staging-cg2.sh check` | the isolation proof above |
| `ops/staging-cg2.sh reset --yes` | **erases** the staging database and media, re-seeds, **new passwords** |
| `ops/staging-cg2.sh backup-drill` | backup + restore drill of every referenced image (step 16) |
| `ops/staging-cg2.sh tailnet-on` / `tailnet-off` | publish / withdraw `https://haddad.tail23f990.ts.net:8443` (§3) |

First installation (already done): `ops/staging-cg2.sh init` with the PostgreSQL binaries in
`~/.local/share/idauto-staging/pg/` (the `@embedded-postgres/linux-x64` 16.9 bundle).

## 3. Reaching it

- **On Haddad itself:** `http://127.0.0.1:8805/login` (live now).
- **From your PC or phone (owner step, one command):** staging is not reachable from other devices until you
  publish it on the tailnet. This adds **one** `tailscale serve` HTTPS port (8443), tailnet-only, and leaves the
  existing `/mcp`, `/qwen` and `/mobile` paths untouched. It also switches the login cookie to `Secure` for that
  origin:

  ```bash
  ~/projects/worktrees/idauto-staging/ops/staging-cg2.sh tailnet-on
  ```

  Then open **`https://haddad.tail23f990.ts.net:8443/login`** on any device signed in to the tailnet (the phone
  needs the Tailscale app). Withdraw it with `ops/staging-cg2.sh tailnet-off`.
  It is a separate owner step because it changes this host's serving configuration.

## 4. Accounts

Passwords are random, stored **only** in `~/.config/idauto-staging/ACCOUNTS.txt` (mode 0600) on Haddad. Read them
there yourself; they are never printed in a chat, a log or this document. `reset --yes` regenerates them.

```bash
cat ~/.config/idauto-staging/ACCOUNTS.txt
```

| Account | Role | Workshop | Used for |
|---|---|---|---|
| `atelier@staging.idauto.test` | manager | Atelier Démo Staging | the workshop user (steps 1–12) |
| `admin@staging.idauto.test` | admin | — | dossier and ambiguous cases (13–14) |
| `technicien@staging.idauto.test` | technician (no VIN search, no delete) | Atelier Démo Staging | permissions (15) |
| `autre-atelier@staging.idauto.test` | manager | Autre Atelier Staging | isolation between workshops (15) |

## 5. Test data

Synthetic cards in `~/.local/share/idauto-staging/samples/` (open `index.html` there to show them on a screen and
photograph them with the phone — the realistic path — or upload the PNG files from a computer):

| Card | Plate | Make / type | In IDauto before the test | Scenario |
|---|---|---|---|---|
| A | 101 TU 2001 | PEUGEOT 208 | no | new vehicle (9), then the same card again (10) |
| B | 102 TU 2002 | RENAULT CLIO | **yes** — vehicle E, same plate and VIN | existing vehicle (11) |
| C | 103 TU 2003 | VOLKSWAGEN POLO | plate on vehicle **F** (no VIN); its VIN on vehicle **G** (plate 104 TU 2004) | conflicting plate and VIN (12, 14) |
| `image-trop-petite.png` | — | — | — | refused upload (3) |

Each card carries a fictitious holder name and address (« SPECIMEN FICTIF ») to show they are never extracted. The
VIN of each card is printed on its face 2.

## 6. Acceptance scenario — 16 steps and what you should see

Workshop pages: `/atelier/carte-grise`. Admin dossier: `/admin/vehicle?ref=<IVID>`.

| # | Do | Expected result |
|---|---|---|
| 1 | Sign in as `atelier@…` at `/login?next=/atelier/carte-grise` | The page « Carte grise » opens; « Connecté : Gérant Atelier Démo ». |
| 2 | Click **Nouvelle carte grise** | A submission opens (address bar `?ref=cgs_…`), status « Brouillon », sections 1–4 shown. |
| 3 | Face 1: first choose `image-trop-petite.png`, then card **A** face 1 | The small image is refused with a message (too small to be legible). Card A face 1: preview shown, « Version 1 … (originale) ». The server keeps the exact bytes (no recompression). |
| 4 | Face 2: card **A** face 2 | Preview shown, « Version 1 … (originale) ». Choosing the same photo for both faces is refused. |
| 5 | Click **Lire la carte** | « Lecture terminée ». The table lists the technical fields with « Lu — à vérifier », « Non lu » or « Les faces ne concordent pas ». No holder name or address anywhere. The VIN shows only « présent », never its value. |
| 6 | Correct any wrong value (type the value from the card, **Corriger**); confirm the right ones (**Confirmer**) | Each row turns « Corrigé » or « Confirmé ». The VIN is typed from the photo. |
| 7 | For a field the card does not show or you cannot read: **Absent** / **Illisible** | Row « Absent de la carte » / « Illisible ». For the VIN, a reason is asked first. When every row is settled: « Toutes les informations sont vérifiées. » |
| 8 | Click **Rechercher le véhicule** | « Aucun véhicule » (card A is new). |
| 9 | Click **Créer le véhicule** | « Véhicule créé : ivid:1:… ». Status « Véhicule créé ». A link opens the vehicle's dossier. |
| 10 | Back to the list, **Nouvelle carte grise**, upload card **A** again (same files), read, review, search | Upload warns « Cette photo a déjà été envoyée dans un autre dossier ». Search: « Véhicule trouvé » = the IVID of step 9; **no « Créer » button** (a second vehicle is impossible). **Rattacher** links it to the same IVID. |
| 11 | New submission with card **B**; read, review, search, **Rattacher** | « Véhicule trouvé », VIN « concorde ». After linking: « Complété sur le véhicule : … » lists only what the vehicle was missing; nothing existing is overwritten (differences, if any, are listed, not applied). |
| 12 | New submission with card **C**; read, review, search | « Ambigu — à décider · plusieurs véhicules correspondent », two candidates (POLO with the plate, GOLF with the VIN). **Rattacher** stays disabled until you tick the confirmation box; even then a workshop user is refused (only an administrator decides). |
| 13 | Sign out; sign in as `admin@…`; open `/admin/vehicle?ref=<IVID of step 9>` | « Cartes grises vérifiées (2) »: both submissions of card A, each with **both original images** at full size, « Ouvrir l'originale » opens the file. |
| 14 | As admin, open card C's submission (`/atelier/carte-grise`, list « Cartes en cours »); search; tick the confirmation; **Rattacher** on the POLO (vehicle F) | « Carte rattachée à ivid:… ». « Différences non appliquées : vin » — the VIN that belongs to vehicle G is **not** copied to F (one VIN, one vehicle). |
| 15 | Permissions and privacy: (a) sign in as `autre-atelier@…` → list; open a `?ref=` of step 2 directly. (b) sign in as `technicien@…` → card with a VIN → search and decide. (c) open an image URL `/api/registration-submissions/<ref>/faces/1/image` in a private window | (a) No card of Atelier Démo; the direct link → « introuvable » (404, not 403). (b) Search uses the plate only; a decision on a card with a VIN is refused (VIN search permission). (c) 401 — images are never public. |
| 16 | Backup and restore evidence: on Haddad `ops/staging-cg2.sh backup-drill` | `references … (observation 0, vehicle_document 0, registration_submission N)`, `restore N/N … byte-identical`, `CG2 n/n carte grise originals (every version) restored with the sha256 recorded at upload`, `RESULT PASS`. See §8 for the production backup evidence. |

Mobile: repeat 1–8 on the phone (§3). Expected: no horizontal scrolling, the camera opens from the face buttons,
every control reachable with a thumb.

After the test: `ops/staging-cg2.sh reset --yes` gives a clean environment again (new passwords).

## 7. Known limitations (staging and V2)

- **OCR accuracy is unknown on real cards** (gate D7). The synthetic cards use a plain font; real cards will read
  worse. Every field is reviewed by a person before any decision, whatever OCR proposes.
- The parser's label vocabulary was written from public descriptions of Tunisian cards and is **not validated** on
  real ones.
- Staging runs on Haddad, which is memory- and I/O-constrained: OCR can take a minute per card under load.
- The tailnet URL needs the owner's `tailnet-on` step (§3); until then staging is reachable from Haddad only.
- Thumbnails are made by the browser; the dossier always shows the hash-checked original.
- No HYBRID / server-side OCR: OCR runs in the browser.

## 8. Backup and restore evidence (D6)

| Evidence | Where | Result |
|---|---|---|
| Capture includes carte grise images | mythos-prod PR #694 (`ops/backup/mythos-backup-capture.sh`) | new test 16/0; existing backup suites green |
| Full off-host path drill on a scratch IDauto database | Haddad, 2026-11-05, real `offhost-backup.js` stage → verify-local → push → verify-remote → restore-verify, filesystem adapter | 537 references (50 observation, 12 V14, 475 CG2) → 455 objects → **455/455 restored byte-identical**, including replaced versions |
| Staging drill | `ops/staging-cg2.sh backup-drill` | the result printed in step 16 |
| **Production** | owner: merge #694, re-run `install.sh` on the VPS, one nightly run, one restore test | **not done** — gate D6 stays closed until then |
