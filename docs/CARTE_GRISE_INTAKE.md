# Carte grise without a vehicle (intake) — Update 6

The carte grise is an **independent entry point**: the vehicle does not have to exist in IDauto and no search is needed.
The document is stored first; LENS (local, on Haddad) extracts its technical fields; an administrator reviews them and
then attaches the document to a vehicle or creates the vehicle. Nothing is created or changed without that confirmation.

This supersedes the 2026-11-18 morning decision "LENS is not integrated" **for intake documents only**: the owner asked
that the Haddad receiver submit them to the existing local LENS workflow. Documents added to a known vehicle (Update 5)
are unchanged.

## Flow

```
homepage « Ajouter la carte grise » (always enabled)
   ├─ a vehicle was just found by plate / VIN → POST /api/vehicles/:ivid/carte-grise           (Update 5, unchanged)
   └─ otherwise (no search, empty / unknown VIN, no result) → POST /api/carte-grise/intake       (Update 6)
        scanner / file / paste → preview → explicit « Enregistrer »
        idauto_vehicle_documents: vehicle_id NULL, intake_status pending_extraction, SHA-256, MIME, source, time
        idauto_media_archive record (no vehicle) → replica copies the original to Haddad
        Haddad receiver → LENS /v1/files + /v1/jobs (127.0.0.1 only) → technical fields only (holder fields dropped)
        archive pass → lens_status / lens_fields → carte-grise-intake.syncFromArchive()
            succeeded / needs_review → pending_review      failed / not configured / text → extraction_failed
/admin/cartes-grises (administrators): original preview, extracted fields + confidence, correction, then
   A  VIN already on a vehicle  → attached to it (never a duplicate), differences listed, vehicle NOT modified
   B  VIN unknown + « Créer »    → vehicle created in idauto_vehicles from the confirmed fields, document attached
   C  no valid VIN              → no vehicle created; « Garder non rattaché », or attach to an IVID the admin names
```

Attaching makes the document the vehicle's new current version of that face; the previous version is kept (superseded).

## Statuses (`idauto_vehicle_documents.intake_status`)

`pending_extraction` · `extraction_failed` · `pending_review` · `unassigned` (vehicle_id NULL) ·
`linked_existing_vehicle` · `vehicle_created` (vehicle_id set). NULL for every document added to a known vehicle.
A database constraint refuses a row without a vehicle unless it is an unresolved intake.

## Guarantees

- Original kept byte for byte (server + Haddad), even when LENS fails.
- Idempotent: same bytes = same document (unique index on SHA-256 for unresolved intake); resolving twice → 409;
  creation serialised by the VIN / plate advisory locks; one VIN, one vehicle.
- Privacy: technical fields only (VIN, plate, make, model, genre, energy, seats, first registration, fiscal power).
  Holder name, CIN and address are filtered by the receiver, filtered again in IDauto, never accepted from a client.
- Access: upload = any signed-in account (`document:write`); queue, original, resolution = administrators only
  (organisation credentials 403, anonymous 401). Public upload only with `IDAUTO_PUBLIC_CARTE_GRISE=1` (same switch as
  Update 5, off by default); a visitor only learns "received, pending review".

## Known limits

- LENS `/v1/files` accepts PNG, JPEG, WebP and PDF, not text: a pasted **text** goes to `extraction_failed` and is
  reviewed by hand (the text is shown on the review screen).
- The fields depend on what LENS returns for `tn-vehicle-registration` (receiver `LENS_FIELDS`); the document's own
  registration date is not in that list yet.
- In production LENS is **disabled in the receiver** (`IDAUTO_LENS_*` commented out in `~/.config/idauto-media/receiver.env`
  since 2026-11-18). Until it is enabled, intake documents go to `extraction_failed` and are reviewed by hand.

## Deployment (owner approval required)

1. Backup + restore test, then `ida-u6-carte-grise-intake.sql` on `idauto_production` (dry run in BEGIN … ROLLBACK, then `psql -1`).
2. Merge, `git merge --ff-only` on the VPS, restart `idauto-api`.
3. Optional, separate decision: re-enable `IDAUTO_LENS_URL` / `IDAUTO_LENS_TOKEN_FILE` in the Haddad receiver env, restart it.

Rollback: previous commit + restart. The migration is additive; its DOWN block applies only while no row has vehicle_id NULL.
