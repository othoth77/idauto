# IDauto Design System — « Encre & Papier, scellé de vert »

**Version 1.0.0 · 2026-08-26 · stage IDA-DS-1 · lives in [`web/`](../web)**

Provenance: designed and first delivered as `projects/idauto-design-system/` in
`othoth77/mythos-prod` (PR #90, IDA-DS-1), then transplanted here — the canonical
repository — and adapted to the real architecture (this document supersedes the
mythos-prod copy for everything IDauto).

---

## 1. Positioning

IDauto must read as: identity, trust, verification, traceability, precision — without ever
looking like crypto, a bank, cyber-security, or a technical dashboard. The felt statement
is *« cette voiture possède une identité numérique fiable »*.

**Banned patterns** (enforced by `tests/ida4-ds-ui-test.js`, not just documented): no
blue-dominant palette, no neon/glow/particles (`no glow/neon` assertion), no decorative
gradients, no SaaS-template composition, no fabricated statistics (assertions reject
percent-claims and volume-claims in served pages), no dark-mode cyberpunk (dark is a warm
« asphalte » charcoal).

## 2. Principles

1. **The document, not the dashboard.** The passport reads as an official piece:
   marginal labels, perforated separators, identifier typography.
2. **One accent, and it means something.** The « vert cachet » green belongs to
   verification. Actions are ink. Nothing else carries accent color.
3. **Trust is proven, not decorated.** Levels shown are the protocol's T0–T3, with
   `anchored` displayed SEPARATELY (docs/TRUST_MODEL.md §2.1 forbids conflating);
   confidence values come from the data, never invented.
4. **The plate is an object, not a decorated field.** Tunisian representation:
   black field, white glyphs, `SSS تونس NNNN`, no TN band, no flag, no European element.
5. **Accessibility is not negotiable.** WCAG AA contrast computed in tests, keyboard
   everywhere, `prefers-reduced-motion` global kill, touch targets ≥ 44px.

## 3. Visual signature

| Object | Role | Implementation |
|---|---|---|
| **La Plaque** | identity's entry point | `.ida-plate`, `.ida-plate-input` |
| **Le Sceau** | verification state (solid ring = verified, dashed = pending) | `.ida-seal--*`, `.ida-status--*` |
| **Les Repères** | dated control-point history | `.ida-timeline`, `.ida-event--*` |
| **La Trame** | fine security-line pattern, single tokenised intensity | `.ida-trame`, `--ida-trame-opacity` |
| **La Perforation** | passport section separators | `.ida-perf`, `.ida-passport-section` |

## 4. Foundations

- **Tokens:** `web/design-system/tokens/idauto.tokens.json` — W3C DTCG Format Module
  2025.10 — is the source of truth; `tokens.css` is the hand-maintained CSS build,
  **sync verified by test** (every color value cross-checked).
- **Color:** light « Papier » default (paper `#F6F4EE`, ink `#1C1B18`, vert cachet
  `#1D6B4F`); dark « Asphalte » (`#171614`, warm — never blue-black). Three theme
  states: pinned `data-theme`, else `prefers-color-scheme`. Every semantic pairing
  passes WCAG AA **by computation** in the suite (17 pairs × 2 themes).
- **Typography:** two roles — editorial (IBM Plex Sans + IBM Plex Sans Arabic, SIL OFL)
  and identifiers (IBM Plex Mono, tabular; IVID/plates/dates never share the editorial
  face). Pages ship font-family stacks with system fallbacks; **self-hosting the Plex
  faces is a deployment step** (no CDN reference exists — CSP `style-src 'self'`
  forbids it anyway, test-asserted).
- **Space/radius/elevation/motion:** 4px-base scale; radii 2/4/6(plate)/8/999(seals
  only); 3 ink-tinted shadows; motion 120/200/320ms `cubic-bezier(0.2,0,0,1)`, ≤2
  keyframes (test-capped), `prefers-reduced-motion` kills everything.
- **No arbitrary values:** zero raw hex outside tokens.css; rgba only as var()
  fallback; every `var(--ida-*)` used is defined — all test-enforced.

## 5. The plate system

`web/design-system/js/plate.js`. Per **AD-3** ("plate formats are configuration, never
hardcoded"), the authoritative catalogue is `config/idauto.example.json` →
`plate_formats` (all entries UNVERIFIED DRAFTS per that file's own note), validated
server-side by `reference/plate-validator.js`. The UI module mirrors the one format the
citizen surface renders (**TUN_STD**); its canonical output `SSS TUN NNNN` is
**cross-checked against the real catalogue through the real validator in the test
suite**. Display form: `SSS تونس NNNN` (`<bdi>` isolation in running text keeps bidi
order correct). PlateInput states: `empty → typing → valid | invalid` (internal) plus
`loading / verified / disabled` (set by product code). Adding a national format = one
registry entry mirroring one catalogue entry.

## 6. The citizen surface (`web/citizen/`)

Two pages served by `reference/api.js` (map-based static routes, same CSP and
`Cache-Control: no-store` as the admin shell — no inline scripts/styles, test-asserted):

- **`/` — homepage.** Hierarchy: identity statement → the plate (first functional
  object) → QR/IVID alternatives → passport explanation. No marketing sections, no
  fabricated numbers.
- **`/passport` — Vehicle Passport.** `?ivid=` → client-side IVID validation
  (`ivid-client.js`, a browser mirror of `reference/ivid.js`, cross-checked in tests
  against generated and mutated samples) → `GET /public/passport/:ivid` → the passport
  document: identity, facts with real `verification_status` vocabulary
  (schema `chk_fact_status`) and confidence, trust T0–T3 + `anchored` separate,
  `completeness_note` verbatim, QR (inline SVG). Errors mirror the route contract:
  identical 404s, 429 + Retry-After.

**A5-PLATE, implemented in the UI exactly as ruled:**

| Phase | Behavior |
|---|---|
| ANONYMOUS (public) | a plate resolves NOTHING — submit shows the IVID-only explainer, zero requests made (E2E-asserted); public resolution is IVID-only |
| PROFESSIONAL (private) | Bearer token (page memory only, never stored — admin-UI discipline) → existing `GET /api/plates/:plate_number` → `vehicle_ivid` → existing `GET /api/passport/:ivid`; no new lookup path |
| PHASE GATE | the citizen UI is served ONLY when `public_resolution.enabled` is true — the same single owner switch as the public route, same config loader; PRIVATE phase leaves `/` byte-identical to before (401) |

`qr.payload === ivid` is asserted at the route boundary (server), in the assembler
(server), AND in the renderer (client) — the renderer throws rather than draw a QR for
a mismatched passport.

## 7. QR

Vendored `web/vendor/qrcodegen.js` — nayuki-qr-code-generator v1.8.0, MIT, byte-identical
to the npm artifact except the documented export tail (ESM → CJS/browser-global), license
preserved at `web/vendor/qrcodegen.LICENSE`. Rendered as inline SVG (CSP `img-src 'self'`
holds; no data: URI), 2-module quiet zone, `role="img"` + label. Tested: legal matrix
size, non-trivial, deterministic; malformed payloads are rejected before encoding by the
IVID gate.

## 8. Backend touch points (minimal, per the "do not modify core" rule)

1. `reference/api.js`: `CITIZEN_ASSETS` map + `serveCitizenAsset()` (static shells only,
   phase-gated, no data path, no query parsing, map-fixed file resolution — no
   traversal), dispatched between admin assets and the public route.
2. `reference/api.js` `getPlate()`: `vehicle_ivid` added via a JOIN — the one missing
   link for the authenticated plate → passport flow. The public route is untouched
   (test-asserted). No schema change, no protocol change, no new route.

## 9. Verification record (2026-08-26, this branch, local PostgreSQL 16)

- `tests/ida4-ds-ui-test.js` (new, offline): **345/0**.
- Full repository pass, all 17 suites: ida-2a 44/0 · 2c 26/0 · 2d 39/0 · 2f 32/0 ·
  2g 17/0 · 2h 37/0 · 3a 47/0 · 3b 67/0 · 3c 63/0 · 3d 74/0 · 3e 48/0 · 3f 35/0 ·
  foundation 130/0 (env-free run) · **option-c 128/0** · storage-ops 73/0 ·
  identity-conformance 81/0 · ds-ui 345/0.
- E2E (Chromium against the live server + live DB): anonymous-plate zero-request
  invariant, IVID→public passport, malformed-IVID client gate, 404 state,
  professional plate→passport with plate displayed, zero console errors.
- Responsive: 320/390/768/1024/1280 × light/dark on `/` and `/passport` — **0
  horizontal overflow** (20/20).
- Phase gate live: with `enabled:false`, `/` and `/assets/*` return 401 exactly as
  before the citizen surface existed; `/public/passport/:ivid` 404s.

## 10. Honest remaining work

1. Self-host IBM Plex faces at deployment (pages currently render on system fallbacks).
2. Full Arabic locale for the citizen pages (the system is RTL-ready — logical
   properties throughout, `[lang="ar"]` typography rules, `<bdi>` isolation — but page
   copy is French).
3. Timeline component: shipped in the design system; the public passport carries no
   dated event stream yet, so no timeline is rendered from real data (nothing is
   invented in its place).
4. `web/design-system/pages/components.html` — the component gallery — is repository
   documentation, deliberately NOT served by the API (it is not part of the public
   surface).
5. Plate formats beyond TUN_STD (registry accepts them without component changes).
6. CITIZEN_FACING_IDA4_READY remains **NO** (legal gates L06/L07/L09/L16 et al.) —
   this stage changes engineering readiness only, never that gate.
