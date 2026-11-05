# IDA-CG2 — storage and capacity assessment (owner decision D4)

**Date:** 2026-11-05 · **Status:** assessment only — nothing was deleted, compressed, moved or migrated.
**Decision D4 (owner):** originals are kept byte for byte (no recompression, no deletion); report storage before any change.

## 1. What CG2 stores per carte grise

| Object | Where | Size | Kept |
|---|---|---|---|
| Original of each face, every version | content-addressed media root (`aa/bb/<sha256>`), same root as observation media and IDA-V14 documents | the photo as taken: **≤ 15 MB** (`IDAUTO_CG_ORIGINAL_MAX_BYTES`); a modern phone JPEG of a card is typically 1.5–4 MB | forever (D4); a replaced face's earlier version is kept |
| Thumbnail of the current face | same root | ≤ 512 KB (the page makes ≈ 30–80 KB, 480 px JPEG) | while referenced |
| Database rows (submission, faces, fields, audit) | `idauto_production` | ≈ 10–20 KB per submission | forever |

Identical bytes are stored once (content addressing): the same photo uploaded twice costs nothing more.

## 2. Measured starting point (VPS, 2026-11-04 audit — not re-measured today)

| Item | Value |
|---|---|
| VPS root disk | 73 318 MiB; **7 044 MiB free, 91 % used** after the approved cleanup A–E |
| Owner release gate | ≤ 89 % used (≤ 65 253 MiB) — **closed by ≈ 1.0 GiB** at the time; IDauto deployed by owner override |
| IDauto media today | 130 files, 1.8 MB (observations only; no carte grise images in production) |
| `idauto_production` dump | 231 KB (`pg_dump -Fc`, 2026-11-04) |

Source: `idauto-private-audit/VPS_DISK_AUDIT_2026-11-04.md` §5–§6 (private). Re-measure before any rollout.

## 3. Projection (estimates — the per-card size is an assumption until real cards are measured, gate D7)

Assumption: 2 faces × 3 MB original + 2 × 60 KB thumbnails, plus 20 % of faces retaken once ⇒ **≈ 7.3 MB per carte grise**.

| Volume | Per month | Per year | Months until the VPS's 7.0 GiB free space is gone |
|---|---|---|---|
| 5 cards / day | 1.1 GB | 13 GB | ≈ 6 |
| 20 cards / day | 4.4 GB | 53 GB | ≈ 1.6 |
| 50 cards / day | 11 GB | 133 GB | < 1 |

With 4 MB originals the figures grow by a third. The 89 % gate is already reached, so **any** real volume needs more
space first.

## 4. The backup multiplies the need

- `mythos-backup-capture.sh` copies the **whole media set** into its staging directory each night before the
  off-host push (mythos-prod PR #694, D6): the VPS needs free space ≥ the media size **during** each backup, on top of
  the media itself. At 10 GB of cards, the nightly run needs ≈ 10 GB of headroom.
- Off-host copy: content-addressed objects are pushed once and kept; storage grows with the media (≈ 13–133 GB/year
  above), at the off-host provider's price.

## 5. Options for the owner (none applied)

1. **Larger VPS disk** — simplest; keeps one media root. Size it for one year of the expected volume, doubled for the
   backup staging copy.
2. **Separate volume for media** (`IDAUTO_MEDIA_STORAGE_PATH` on an attached block volume) — isolates growth from the
   system disk; one configuration change plus a reviewed data move (a migration of production data: owner approval).
3. **Object storage for originals** — the storage module is an interface (`documents/document-storage.js`); an
   S3-compatible adapter is new code, with its own review and backup design.
4. **Incremental backup staging** — capture only objects not yet off-host instead of copying the full set nightly;
   a mythos-prod change, after PR #694.

Not proposed: recompressing or deleting originals (D4).

## 6. Before CG2 production use

- Re-measure the VPS disk and the media size.
- Owner chooses an option of §5 and the expected volume.
- Merge and install the backup change (PR #694), run one nightly backup and one restore test (D6).
- Measure real card sizes on the redacted samples (D7) and redo §3 with the measured size.
