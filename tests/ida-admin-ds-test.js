'use strict';

/* IDA-ADMIN-DS — the operator console uses the real IDauto Design System.
 * Owner requirement, 2026-08-28.
 *
 * /admin and /admin/review carried their own stylesheet with their own
 * palette (#0b1220 ground, #72d7c5 accent), predating the Design System. They
 * looked like a different product from idauto.tn and /passport. The
 * requirement was explicit: no redesign, no new art direction — REUSE the
 * existing Design System's tokens and components.
 *
 * This suite exists to keep that true. The failure it is built to catch is
 * not "the page looks wrong" — it is the two ways this kind of alignment
 * silently rots:
 *
 *   1. Someone reintroduces a literal colour, font or radius into admin.css
 *      instead of using a token. §2 fails on the first raw hex value.
 *   2. Someone "reuses" the Design System by COPYING its CSS into the admin
 *      tree, which then drifts from the real one. §4 asserts the bytes served
 *      under /admin/assets/ are the bytes of web/design-system — one source,
 *      two mount points, no copy.
 *
 * It also pins the two properties that are easy to break while restyling:
 * the form's API contract (§5) and the fact that styling never became a way
 * in (§6).
 *
 * Static-analysis and HTTP only — no database, no fixtures.
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ ['t-' + crypto.randomBytes(8).toString('hex')]: 'usr_admin_ds_test' });

var api = require(path.join(BASE, 'reference', 'api.js'));
var server, port;

function get(p) {
  return new Promise(function (resolve, reject) {
    http.get({ hostname: '127.0.0.1', port: port, path: p }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(c) }); });
    }).on('error', reject);
  });
}

var adminHtml = fs.readFileSync(path.join(BASE, 'reference', 'admin.html'), 'utf8');
var reviewHtml = fs.readFileSync(path.join(BASE, 'reference', 'review.html'), 'utf8');
var adminCss = fs.readFileSync(path.join(BASE, 'reference', 'admin.css'), 'utf8');
// The stylesheet minus its comment block — the header explains which literal
// values were REMOVED, and naming them must not count as using them.
var adminCssCode = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');

async function main() {
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  say('\n1. BOTH ADMIN PAGES LOAD THE DESIGN SYSTEM');
  [['admin.html', adminHtml], ['review.html', reviewHtml]].forEach(function (pair) {
    var name = pair[0], html = pair[1];
    ok(html.indexOf('/admin/assets/tokens.css') !== -1, name + ' loads tokens.css');
    ok(html.indexOf('/admin/assets/base.css') !== -1, name + ' loads base.css');
    ok(html.indexOf('/admin/assets/components.css') !== -1, name + ' loads components.css');
    ok(html.indexOf('/admin/admin.css') !== -1, name + ' still loads its own layout layer, after the DS');
    ok(html.indexOf('tokens.css') < html.indexOf('/admin/admin.css'),
      name + ' loads the DS BEFORE admin.css, so the layer overrides tokens and never the reverse');
  });

  say('\n2. admin.css DEFINES NO VALUE OF ITS OWN — every value is a token');
  var hexes = adminCssCode.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok(hexes.length === 0, 'no literal hex colour survives in admin.css (found: ' + (hexes.join(', ') || 'none') + ')');
  ok(!/\brgba?\(/.test(adminCssCode.replace(/var\([^)]*\)/g, '')), 'no literal rgb()/rgba() colour');
  ok(!/font-family\s*:/.test(adminCssCode), 'admin.css sets no font-family — typography comes from base.css');
  /* Checked by reading each DECLARATION's value, not with a lookahead regex.
   * A lookahead like /\bcolor\s*:\s*(?!var\()/ is wrong twice over: \b
   * matches inside `border-color`, and \s* backtracks to zero width so the
   * lookahead lands before the space and passes on a value that IS a token.
   * Both produced false failures against correct CSS. */
  var decls = [];
  adminCssCode.replace(/\{([^}]*)\}/g, function (_, block) {
    block.split(';').forEach(function (d) {
      var i = d.indexOf(':');
      if (i > 0) decls.push({ prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() });
    });
    return '';
  });
  ok(decls.length > 0, 'admin.css declarations parsed (' + decls.length + ')');

  function everyValue(props, allowed, label) {
    var bad = decls.filter(function (d) { return props.indexOf(d.prop) !== -1 && !allowed(d.value); });
    ok(bad.length === 0, label + (bad.length ? ' — offending: ' + bad.map(function (b) { return b.prop + ': ' + b.value; }).join('; ') : ''));
  }
  var isToken = function (v) { return /^var\(--ida-/.test(v); };
  everyValue(['color'], isToken, 'every color: is an --ida-* token');
  everyValue(['background', 'background-color'],
    function (v) { return isToken(v) || v === 'transparent'; },
    'every background is an --ida-* token or transparent');
  everyValue(['border-color'], isToken, 'every border-color: is an --ida-* token');
  var radii = adminCssCode.match(/border-radius\s*:\s*([^;]+);/g) || [];
  ok(radii.length > 0 && radii.every(function (r) { return /var\(--ida-radius-/.test(r); }),
    'every border-radius is an --ida-radius-* token (' + radii.length + ' checked)');
  ok(/var\(--ida-space-/.test(adminCssCode), 'spacing uses --ida-space-* tokens');
  ok(adminCssCode.indexOf('#0b1220') === -1 && adminCssCode.indexOf('#72d7c5') === -1,
    'the pre-Design-System palette is gone from the code');

  say('\n3. THE MARKUP USES DESIGN SYSTEM COMPONENTS, NOT LOOKALIKES');
  [['admin.html', adminHtml], ['review.html', reviewHtml]].forEach(function (pair) {
    var name = pair[0], html = pair[1];
    ok(/class="ida-nav"/.test(html), name + ' uses the shared .ida-nav header');
    ok(/class="ida-container ida-nav-inner"/.test(html), name + ' uses the same nav inner as the homepage');
    ok(/ida-wordmark/.test(html), name + ' carries the IDauto wordmark');
    ok(/class="ida-footer"/.test(html), name + ' uses the shared .ida-footer');
    ok(/ida-card/.test(html), name + ' builds its sections from .ida-card');
    ok(/ida-btn ida-btn--/.test(html), name + ' uses .ida-btn with a Design System variant');
    ok(/data-theme-toggle/.test(html), name + ' carries the same theme toggle as the citizen surface');
    ok(/ida-skip-link/.test(html), name + ' keeps the accessibility skip link');
    ok(/name="viewport"/.test(html), name + ' declares the viewport (responsive)');
  });
  ok(/class="ida-field"/.test(adminHtml) && /class="ida-input"/.test(adminHtml),
    'the entry form uses .ida-field / .ida-input rather than bare labels and inputs');

  // Every ida-* class in the markup must exist in the Design System or in the
  // admin layer. This is what stops a plausible-looking but undefined class
  // (a typo, or a component someone assumed existed) from shipping unstyled.
  var ds = fs.readFileSync(path.join(BASE, 'web', 'design-system', 'css', 'components.css'), 'utf8')
    + fs.readFileSync(path.join(BASE, 'web', 'design-system', 'css', 'base.css'), 'utf8')
    + adminCss;
  var used = {};
  (adminHtml + reviewHtml).replace(/class="([^"]+)"/g, function (_, list) {
    list.split(/\s+/).forEach(function (c) { if (c.indexOf('ida-') === 0) used[c] = true; });
    return '';
  });
  var undefinedClasses = Object.keys(used).filter(function (c) { return ds.indexOf('.' + c) === -1; });
  ok(undefinedClasses.length === 0,
    'every ida-* class in the markup is defined (' + Object.keys(used).length + ' used; undefined: ' + (undefinedClasses.join(', ') || 'none') + ')');

  say('\n4. THE SAME FILES AS THE CITIZEN SURFACE — one source, not a copy');
  var pairs = [
    ['/admin/assets/tokens.css', 'design-system/tokens/tokens.css', 'text/css'],
    ['/admin/assets/base.css', 'design-system/css/base.css', 'text/css'],
    ['/admin/assets/components.css', 'design-system/css/components.css', 'text/css'],
    ['/admin/assets/ui.js', 'design-system/js/ui.js', 'application/javascript']
  ];
  for (var i = 0; i < pairs.length; i++) {
    var served = await get(pairs[i][0]);
    var onDisk = fs.readFileSync(path.join(BASE, 'web', pairs[i][1]));
    ok(served.status === 200, pairs[i][0] + ' is served');
    ok(new RegExp('^' + pairs[i][2]).test(served.headers['content-type'] || ''), pairs[i][0] + ' has the right content type');
    ok(Buffer.compare(served.raw, onDisk) === 0,
      pairs[i][0] + ' is byte-identical to web/' + pairs[i][1] + ' — the real DS, not a copy');
  }
  ok(!fs.existsSync(path.join(BASE, 'reference', 'tokens.css')) &&
     !fs.existsSync(path.join(BASE, 'reference', 'components.css')),
    'no second copy of the Design System exists under reference/');

  say('\n5. THE ADMIN SURFACE IS NOT PHASE-GATED');
  // The citizen assets under /assets/ decline when public_resolution is off
  // (the A5-PLATE gate). The operator console must not inherit that switch,
  // so its Design System copies are served by serveAdminAsset(), which has
  // no gate — asserted on the source, because the gate is a property of
  // WHICH function serves the path.
  var apiSrc = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var adminMap = apiSrc.slice(apiSrc.indexOf('var ADMIN_ASSETS'), apiSrc.indexOf('function serveAdminAsset'));
  ok(adminMap.indexOf('/admin/assets/tokens.css') !== -1, 'the DS paths live in ADMIN_ASSETS, not CITIZEN_ASSETS');
  var citizenMap = apiSrc.slice(apiSrc.indexOf('var CITIZEN_ASSETS'), apiSrc.indexOf('function serveCitizenAsset'));
  ok(citizenMap.indexOf('/admin/') === -1, 'no /admin/ path is served through the phase-gated citizen map');
  ok(apiSrc.indexOf('function serveAdminAsset') < apiSrc.indexOf('function serveCitizenAsset'),
    'admin assets are still dispatched before citizen assets');
  ok(/asset\.root \|\| __dirname/.test(apiSrc),
    'ADMIN_ASSETS resolves an optional root, so entries without one still resolve against reference/');

  say('\n6. FUNCTIONALITY AND PROTECTION ARE UNCHANGED');
  var page = await get('/admin');
  ok(page.status === 200, 'GET /admin still serves the page');
  var html = page.raw.toString('utf8');
  ok(html.indexOf("Enregistrement manuel d'un véhicule") !== -1 && html.indexOf('Review queue') === -1,
    'it is still the manual-entry page only (IDA-2G invariant)');
  ok(html.indexOf('admin-token') !== -1 && html.indexOf('localStorage') === -1,
    'still takes a token with no browser-storage persistence (IDA-2G invariant)');
  ok((page.headers['content-security-policy'] || '').indexOf("default-src 'self'") !== -1,
    'the restrictive CSP is still applied');
  ok((await get('/admin/review')).status === 200, 'GET /admin/review still serves the review page');

  // The form is the API contract. Restyling must not rename, drop or retype a
  // single control — tests/ida-2g's fakeForm() drives exactly these names.
  var required = ['make', 'model', 'variant', 'year', 'body_type', 'fuel_type', 'colour', 'seats',
    'gross_weight_kg', 'engine_cc', 'category_code', 'plate_number', 'format_code', 'governorate_code',
    'status', 'fact_key', 'fact_value', 'confidence_score', 'access_scope', 'evidence_type',
    'media', 'media_type', 'media_access_scope', 'blurred'];
  var missingNames = required.filter(function (n) { return adminHtml.indexOf('name="' + n + '"') === -1; });
  ok(missingNames.length === 0, 'all ' + required.length + ' form controls kept their name (missing: ' + (missingNames.join(', ') || 'none') + ')');

  var ids = ['entry-form', 'admin-token', 'enroll-button', 'forget-button', 'enroll-result', 'submit-button', 'result'];
  var missingIds = ids.filter(function (n) { return adminHtml.indexOf('id="' + n + '"') === -1; });
  ok(missingIds.length === 0, 'every id admin-ui.js reads still exists (missing: ' + (missingIds.join(', ') || 'none') + ')');

  var reviewIds = ['review-token', 'load-queue', 'queue-status', 'queue-list', 'review-detail'];
  var missingReviewIds = reviewIds.filter(function (n) { return reviewHtml.indexOf('id="' + n + '"') === -1; });
  ok(missingReviewIds.length === 0, 'every id review-ui.js reads still exists (missing: ' + (missingReviewIds.join(', ') || 'none') + ')');

  ok(adminHtml.indexOf('type="file"') !== -1 && adminHtml.indexOf('type="checkbox"') !== -1,
    'the file and checkbox controls kept their input types');

  say('\n7. THE RUNTIME STATE CLASSES THE ADMIN JS EMITS ARE STYLED');
  // admin-ui.js and review-ui.js assign className directly, overwriting any
  // Design System class in the markup. Those hooks must therefore be styled,
  // or a result message renders unstyled the moment it appears.
  ['success', 'error', 'empty', 'queue-item', 'detail-field', 'review-actions'].forEach(function (c) {
    ok(new RegExp('\\.' + c + '[\\s,{:]').test(adminCss), '.' + c + ' is styled (emitted by the admin JS at runtime)');
  });
  ok(/\.review-actions \.accept/.test(adminCss) && /\.review-actions \.reject/.test(adminCss),
    'the accept and reject buttons review-ui.js creates are styled');

  say('\n8. RESPONSIVE — no construct that forces horizontal overflow');
  ok(/minmax\(min\(100%, *220px\), *1fr\)/.test(adminCss),
    'the entry grid floor is min(100%, 220px), so a 320px viewport gets one full-width column');
  ok(/\.ida-admin-grid > \* \{[^}]*min-width: 0/.test(adminCss),
    'grid children may shrink below their content — the usual cause of a horizontal scrollbar');
  ok(/grid-template-columns: minmax\(0, 0\.8fr\) minmax\(0, 1\.2fr\)/.test(adminCss),
    'the review two-column layout uses minmax(0, …), not a fixed px floor that overflows below its sum');
  ok(/@media \(min-width: 768px\)/.test(adminCss), 'the second column appears at the DS 768px breakpoint, mobile-first');
  /* Only DECLARATIONS count. The earlier form of this check also matched the
   * `min-width: 768px` inside `@media (...)` preludes — breakpoints, not
   * element widths — and failed on correct, mobile-first CSS. */
  var fixedWidths = decls.filter(function (d) { return /^(width|min-width)$/.test(d.prop) && /[0-9]+px/.test(d.value); });
  ok(fixedWidths.length === 0,
    'no fixed px width is set on any admin element (media-query breakpoints are not element widths)' +
    (fixedWidths.length ? ' — offending: ' + fixedWidths.map(function (b) { return b.prop + ': ' + b.value; }).join('; ') : ''));

  server.close();
  console.log('\nIDA-ADMIN-DS design-system alignment: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
