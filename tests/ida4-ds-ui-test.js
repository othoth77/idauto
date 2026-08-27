#!/usr/bin/env node
/* IDA-DS-1 — IDauto Design System + citizen UI test suite.
 * Offline: no database, no network, no browser. Run:
 *   node tests/ida4-ds-ui-test.js
 *
 * Verifies: DTCG token integrity, tokens.json ↔ tokens.css sync, the
 * no-arbitrary-values policy, WCAG AA contrast for every semantic pairing
 * (computed, both themes), plate logic INCLUDING cross-consistency with the
 * real config catalogue (AD-3), the browser IVID mirror against
 * reference/ivid.js, the vendored QR generator, CSP conformance of every
 * served citizen asset, the A5-PLATE invariants of the citizen JS, and the
 * phase gate on serveCitizenAsset(). */

"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error("  FAIL: " + name); }
}
const read = (p) => fs.readFileSync(path.join(WEB, p), "utf8");

/* ---------- 1. tokens.json — DTCG integrity ---------- */
const tokens = JSON.parse(read("design-system/tokens/idauto.tokens.json"));
function walkLeaves(node, cb, trail) {
  for (const k of Object.keys(node)) {
    if (k.startsWith("$")) continue;
    const v = node[k];
    if (v && typeof v === "object" && "$value" in v) cb(trail.concat(k), v);
    else if (v && typeof v === "object") walkLeaves(v, cb, trail.concat(k));
  }
}
let leafCount = 0;
walkLeaves(tokens, () => leafCount++, []);
ok(leafCount >= 60, "tokens.json carries a full token set (" + leafCount + " leaves)");
walkLeaves(tokens, (trail, leaf) => {
  ok(leaf.$value !== undefined && leaf.$value !== "", "token " + trail.join(".") + " has a $value");
}, []);

/* ---------- 2. tokens.css ↔ tokens.json color sync ---------- */
const tokensCss = read("design-system/tokens/tokens.css");
for (const theme of ["light", "dark"]) {
  for (const [name, leaf] of Object.entries(tokens.color[theme])) {
    if (name.startsWith("$")) continue;
    const re = new RegExp("--ida-" + name + ":\\s*" + leaf.$value, "i");
    ok(re.test(tokensCss), `tokens.css defines --ida-${name} = ${leaf.$value} (${theme})`);
  }
}
const darkBlocks = tokensCss.split(/@media \(prefers-color-scheme: dark\)|\[data-theme="dark"\]/);
ok(darkBlocks.length === 3, "dark palette exists twice: system preference + pinned choice");

/* ---------- 3. no-arbitrary-values policy ---------- */
for (const cssFile of ["design-system/css/base.css", "design-system/css/components.css"]) {
  const css = read(cssFile);
  const hexes = css.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  ok(hexes.length === 0, cssFile + " contains no raw hex colors (found: " + hexes.join(",") + ")");
  const rgbas = (css.match(/rgba?\(/g) || []).length;
  const rgbaFallbacks = (css.match(/var\(--ida-[a-z-]+,\s*rgba?\(/g) || []).length;
  ok(rgbas === rgbaFallbacks, cssFile + " uses rgba only as var() fallback");
}
const defined = new Set([...tokensCss.matchAll(/--ida-[a-z0-9-]+(?=\s*:)/g)].map(m => m[0]));
const cssSources = ["design-system/css/base.css", "design-system/css/components.css",
  "citizen/index.html", "citizen/passport.html"];
for (const f of cssSources) {
  const used = new Set([...read(f).matchAll(/var\((--ida-[a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(u => !defined.has(u));
  ok(missing.length === 0, f + " uses only defined tokens (missing: " + missing.join(",") + ")");
}

/* ---------- 4. WCAG contrast (computed) ---------- */
function lum(hex) {
  const c = hex.replace("#", "");
  const n = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const C = { light: {}, dark: {} };
for (const theme of ["light", "dark"])
  for (const [name, leaf] of Object.entries(tokens.color[theme]))
    if (!name.startsWith("$")) C[theme][name] = leaf.$value;
for (const theme of ["light", "dark"]) {
  const c = C[theme];
  const pairs = [
    [c.text, c.bg, 4.5, "text/bg"],
    [c.text, c.surface, 4.5, "text/surface"],
    [c.text, c["surface-sunken"], 4.5, "text/surface-sunken"],
    [c["text-muted"], c.bg, 4.5, "muted/bg"],
    [c["text-muted"], c.surface, 4.5, "muted/surface"],
    [c["text-muted"], c["surface-sunken"], 4.5, "muted/surface-sunken"],
    [c["primary-contrast"], c.primary, 4.5, "primary button text"],
    [c.verify, c["verify-tint"], 4.5, "verified seal/status text"],
    [c.pending, c["pending-tint"], 4.5, "pending seal/status text"],
    [c.danger, c["danger-tint"], 4.5, "anomaly seal/status text"],
    [c.info, c["info-tint"], 4.5, "info seal/status text"],
    [c.verify, c.bg, 4.5, "verify used as text on bg"],
    [c.danger, c.surface, 4.5, "error message on surface"],
    [c["plate-glyph"], c["plate-field"], 4.5, "plate glyphs on plate field"],
    [c.focus, c.bg, 3.0, "focus ring vs page (non-text 3:1)"],
    [c.focus, c.surface, 3.0, "focus ring vs surface (non-text 3:1)"],
    [c["border-strong"], c.bg, 1.6, "strong border visible"],
  ];
  for (const [fg, bg, min, label] of pairs) {
    const r = ratio(fg, bg);
    ok(r >= min, `${theme} ${label}: ${r.toFixed(2)}:1 ≥ ${min}:1`);
  }
}

/* ---------- 5. plate logic — incl. AD-3 cross-consistency ---------- */
const IdaPlate = require(path.join(WEB, "design-system/js/plate.js"));
ok(IdaPlate.getFormat("TUN_STD") !== null, "TUN_STD format registered (catalogue code)");
ok(IdaPlate.validate("TUN_STD", { serie: "220", numero: "4518" }).valid, "220/4518 valid");
ok(IdaPlate.validate("TUN_STD", { serie: "7", numero: "1" }).valid, "short serie/numero valid");
ok(!IdaPlate.validate("TUN_STD", { serie: "2204", numero: "4518" }).valid, "4-digit serie invalid");
ok(!IdaPlate.validate("TUN_STD", { serie: "", numero: "4518" }).valid, "empty serie invalid");
ok(!IdaPlate.validate("TUN_STD", { serie: "22a", numero: "4518" }).valid, "non-digit serie invalid");
ok(!IdaPlate.validate("TUN_STD", { serie: "220", numero: "45189" }).valid, "5-digit numero invalid");
ok(!IdaPlate.validate("TUN_STD", {}).complete, "empty parts incomplete");
ok(IdaPlate.validate("nope", {}).errors.format === "unknown_format", "unknown format rejected");
const p1 = IdaPlate.parse("TUN_STD", "220 تونس 4518");
ok(p1 && p1.serie === "220" && p1.numero === "4518", "parse Arabic display form");
const p2 = IdaPlate.parse("TUN_STD", "220 TUN 4518");
ok(p2 && p2.serie === "220" && p2.numero === "4518", "parse canonical form");
ok(IdaPlate.parse("TUN_STD", "ABC تونس 4518") === null, "reject letters");
const fmt = IdaPlate.getFormat("TUN_STD");
ok(fmt.display({ serie: "220", numero: "4518" }) === "220 تونس 4518", "display form is SSS تونس NNNN");
ok(fmt.word === "تونس", "plate carries تونس — no TN band, no flag");

/* AD-3: the UI canonical form must satisfy the REAL catalogue pattern via
 * the REAL server-side validator — the config stays the single authority. */
const plateValidator = require(path.join(ROOT, "reference", "plate-validator.js"));
const canon = fmt.canonical({ serie: "220", numero: "4518" });
const matched = plateValidator.matchPlateFormat(canon);
ok(matched && matched.format_code === "TUN_STD", "UI canonical '" + canon + "' matches catalogue TUN_STD via reference/plate-validator.js");
ok(plateValidator.isValidPlate(fmt.canonical({ serie: "7", numero: "1" })), "short canonical also validates server-side");

/* ---------- 6. IVID browser mirror vs reference implementation ---------- */
const IdaIvid = require(path.join(WEB, "design-system/js/ivid-client.js"));
const refIvid = require(path.join(ROOT, "reference", "ivid.js"));
for (let i = 0; i < 20; i++) {
  const generated = refIvid.generate();
  ok(IdaIvid.validate(generated).ok, "mirror accepts reference-generated IVID " + generated);
  // mutate one payload symbol → both implementations must reject
  const mutated = generated.slice(0, 8) + (generated[8] === "0" ? "1" : "0") + generated.slice(9);
  ok(IdaIvid.validate(mutated).ok === refIvid.validate(mutated).ok,
    "mirror agrees with reference on mutated " + mutated);
}
for (const bad of ["", "ivid:1:SHORT:00", "ivid:1:7K2QF9WBN4TXJ0R3:XX", "plate:220TUN4518",
  "ivid:1:7K2QF9WBN4TXJ0RI:0D", "IVID:1:7K2QF9WBN4TXJ0R3:0D"]) {
  ok(IdaIvid.validate(bad).ok === false, "mirror rejects " + JSON.stringify(bad));
  ok(refIvid.validate(bad).ok === false, "reference also rejects " + JSON.stringify(bad));
}
ok(IdaIvid.normalize(" ivid:1:abc :") === "ivid:1:ABC :", "normalize uppercases after prefix");

/* ---------- 7. vendored QR generator (nayuki, MIT) ---------- */
const qrcodegen = require(path.join(WEB, "vendor", "qrcodegen.js"));
const sampleIvid = refIvid.generate();
const qr = qrcodegen.QrCode.encodeText(sampleIvid, qrcodegen.QrCode.Ecc.MEDIUM);
ok(qr.size >= 21 && qr.size % 4 === 1, "QR matrix has a legal size (" + qr.size + ")");
let darkCount = 0;
for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) darkCount++;
ok(darkCount > 0 && darkCount < qr.size * qr.size, "QR matrix is non-trivial");
const qr2 = qrcodegen.QrCode.encodeText(sampleIvid, qrcodegen.QrCode.Ecc.MEDIUM);
let identical = qr.size === qr2.size;
if (identical) for (let y = 0; y < qr.size && identical; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y) !== qr2.getModule(x, y)) { identical = false; break; }
ok(identical, "QR encoding is deterministic for the same IVID");
ok(read("vendor/qrcodegen.js").indexOf("Project Nayuki") !== -1 && fs.existsSync(path.join(WEB, "vendor", "qrcodegen.LICENSE")),
  "vendored QR keeps its MIT attribution + license file");

/* ---------- 8. citizen pages — CSP conformance + structure + honesty ---------- */
const api = require(path.join(ROOT, "reference", "api.js"));
const assets = api._citizenAssets;
ok(assets && typeof assets === "object", "api.js exposes the citizen asset map");
for (const [route, spec] of Object.entries(assets)) {
  const full = path.join(WEB, spec.file);
  ok(fs.existsSync(full), "served asset exists: " + route + " → web/" + spec.file);
  ok(!spec.file.includes(".."), "asset path is map-fixed (no traversal): " + spec.file);
}
const servedHtml = Object.values(assets).filter(s => s.contentType.startsWith("text/html")).map(s => s.file);
ok(servedHtml.length >= 2, "citizen surface serves at least index + passport");
for (const f of new Set(servedHtml)) {
  const html = read(f);
  // CSP: script-src/style-src 'self' — nothing inline, nothing external
  ok(!/<script[^>]*>[^<]/.test(html.replace(/\s/g, "")), f + " has no inline script bodies");
  ok(!/ style="/.test(html), f + " has no inline style attributes");
  ok(!/ on[a-z]+="/.test(html), f + " has no inline event handlers");
  ok(!/https?:\/\/[^"']*\.(css|js|woff|png|svg)/.test(html), f + " loads no external assets (CSP 'self')");
  ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), f + " does not reference remote fonts");
  // structure
  ok(/<html lang="fr">/.test(html), f + " declares lang");
  ok(/name="viewport"/.test(html), f + " has viewport meta");
  ok(/ida-skip-link/.test(html), f + " has a skip link");
  ok(/<main id="main"/.test(html), f + " has a main landmark");
  ok(/aria-label="Navigation principale"/.test(html), f + " labels its nav");
  const inputIds = [...html.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
  for (const id of inputIds) {
    ok(new RegExp('<label[^>]*for="' + id + '"').test(html), f + " input #" + id + " has a label");
  }
  // honesty
  ok(!/\d+\s*%\s*(fiable|reliable|disponib)/i.test(html), f + " has no fabricated percentages");
  ok(!/\b\d{3,}\s*([Kk]\+?|[Mm]\+?)\s*(véhicules|vehicles|recherches|searches|clients)/.test(html), f + " has no fabricated volume stats");
  // every /assets/ reference the page makes is actually in the served map
  for (const m of html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)) {
    ok(!!assets[m[1]], f + " references served asset " + m[1]);
  }
}
// every served .js asset parses and stays CSP-safe (no eval / new Function)
for (const spec of Object.values(assets)) {
  if (!spec.contentType.startsWith("application/javascript")) continue;
  const src = read(spec.file);
  ok(!/\beval\s*\(|new Function\s*\(/.test(src), spec.file + " avoids eval/new Function");
}

/* ---------- 9. A5-PLATE invariants of the citizen JS ---------- */
const homeJs = read("citizen/home.js");
const passportJs = read("citizen/passport.js");
const renderJs = read("citizen/passport-render.js");
// Comments stripped before the prohibition checks below: these files' own
// headers legitimately DISCUSS Authorization, vehicle_id and VIN in order to
// explain why they are never used. A prohibition must be checked against code.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const homeCode = stripComments(homeJs);
const citizenCode = stripComments(homeJs + passportJs + renderJs);
// IDA-V2, 2026-08-27 — OWNER DECISION: a plate now DOES resolve publicly.
// These two assertions encoded the withdrawn A5-PLATE rule and are replaced
// by ones that pin the new rule's boundaries instead of forbidding it:
// the citizen surface may call the PUBLIC plate route and nothing else, and
// it still asks the visitor for no credential. The behaviour — request made,
// IVID rendered, private fields absent, no raw error shown — is asserted by
// running the code in tests/ida-v2-public-plate-resolution-test.js.
ok(!/\/api\/plates/.test(citizenCode),
  "citizen JS never calls the AUTHENTICATED plate route");
ok(/\/public\/plates\//.test(homeCode),
  "home.js resolves plates through the public plate route (IDA-V2)");
ok(!/internal_ref|vehicle_id|\bvin\b/i.test(homeCode),
  "citizen JS never references a private vehicle identifier");
// V1 PERSONAL: no key or token is ever asked of the user — the citizen
// surface carries no Authorization header, no bearer, no token input.
ok(!/Authorization|Bearer/i.test(citizenCode),
  "V1 personal: citizen JS sends no Authorization/Bearer header");
const citizenHome = read("citizen/index.html");
const citizenPassport = read("citizen/passport.html");
ok(!/pro-token|Jeton d'accès|type="password"/.test(citizenHome + citizenPassport),
  "V1 personal: no key/token input anywhere in the citizen pages");
ok(!/github\.com|open.?source|protocole ouvert|Apache-2\.0/i.test(citizenHome + citizenPassport),
  "V1 personal: no open-source or GitHub presentation in the citizen UI");
ok(!/localStorage|sessionStorage|document\.cookie/.test(citizenCode),
  "no token or identifier ever touches browser storage in citizen flows");
ok(/qr\.payload does not match|passport\.qr\.payload !== requestedIvid/.test(renderJs) ||
   /qr\.payload !== requestedIvid/.test(renderJs),
  "renderer asserts qr.payload === requested ivid");
ok(/textContent/.test(renderJs) && !/innerHTML/.test(renderJs),
  "renderer builds DOM via textContent, never innerHTML");
ok(/anchored/.test(renderJs) && /T0/.test(renderJs),
  "renderer shows T0–T3 and anchored separately");
ok(/completeness_note/.test(renderJs), "renderer includes the completeness note verbatim");

/* ---------- 10. phase gate on serveCitizenAsset ---------- */
ok(typeof api._serveCitizenAsset === "function", "serveCitizenAsset exported for tests");
const apiSrc = fs.readFileSync(path.join(ROOT, "reference", "api.js"), "utf8");
ok(/function serveCitizenAsset[\s\S]*?loadPublicResolutionConfig\(\)\.enabled\) return false/.test(apiSrc),
  "serveCitizenAsset checks the A5-PLATE phase gate before serving anything");
const dispatchOrder = apiSrc.indexOf("serveAdminAsset(req, res, pathname)") <
  apiSrc.indexOf("serveCitizenAsset(req, res, pathname)") &&
  apiSrc.indexOf("serveCitizenAsset(req, res, pathname)") < apiSrc.indexOf("if (!requireAuth(req, res)) return;");
ok(dispatchOrder, "dispatch order: admin assets → citizen assets → public route → auth");
ok(/vehicle_ivid/.test(apiSrc) && /LEFT JOIN idauto_vehicles v ON v\.id = p\.vehicle_id/.test(apiSrc),
  "getPlate exposes vehicle_ivid via a JOIN on the authenticated route only");
ok(!/vehicle_ivid/.test(apiSrc.slice(apiSrc.indexOf("async function handlePublicPassportRoute"), apiSrc.indexOf("// GET /api/vehicles/:internal_ref"))),
  "the public route is untouched by the vehicle_ivid addition");

/* ---------- 11. motion + touch discipline ---------- */
const baseCss = read("design-system/css/base.css");
const compCss = read("design-system/css/components.css");
ok(/prefers-reduced-motion/.test(baseCss), "reduced-motion kill switch present");
ok(/\.ida-btn\s*{[^}]*min-height:\s*44px/s.test(compCss), "buttons meet 44px touch floor");
ok(/\.ida-input\s*{[^}]*min-height:\s*44px/s.test(compCss), "inputs meet 44px touch floor");
ok(!/glow|neon/i.test(compCss), "no glow/neon effects");
ok((compCss.match(/@keyframes/g) || []).length <= 2, "motion stays minimal (≤2 keyframes)");

/* ---------- report ---------- */
console.log(`ida4-ds-ui: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
