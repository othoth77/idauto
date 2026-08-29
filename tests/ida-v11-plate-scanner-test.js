'use strict';

/* IDA-V11 — plate scanner, the CSP change it needed, and the unregistered-
 * vehicle handoff. Owner requirement, 2026-08-28.
 *
 * THE SECURITY REGRESSION IS THE POINT OF §1. Adding 'wasm-unsafe-eval' to
 * script-src is the only CSP change in this work, and the risk is not the
 * token itself — it is that a later edit quietly widens something else in the
 * same header, or copies the relaxed header onto the admin surface. §1
 * therefore pins the WHOLE header on both surfaces, directive by directive,
 * rather than asserting "wasm-unsafe-eval is present" and calling it done.
 *
 * Static analysis + HTTP. No database, no camera, no network beyond loopback.
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ ['t-' + crypto.randomBytes(8).toString('hex')]: 'usr_v11_test' });

var api = require(path.join(BASE, 'reference', 'api.js'));
var scanner = require(path.join(BASE, 'web', 'citizen', 'plate-scanner.js'));
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

var homeHtml = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'index.html'), 'utf8');
var homeJs = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'home.js'), 'utf8');
var scanJs = fs.readFileSync(path.join(BASE, 'web', 'citizen', 'plate-scanner.js'), 'utf8');
var adminHtml = fs.readFileSync(path.join(BASE, 'reference', 'admin.html'), 'utf8');
var adminJs = fs.readFileSync(path.join(BASE, 'reference', 'admin-ui.js'), 'utf8');
/* IDA-ADMIN-FR — the operator console is French only. Matched by Unicode
 * block rather than by phrase, so a NEW Arabic string fails this too; a
 * verbatim-phrase check would only have caught the two sentences removed. */
var ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

async function main() {
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  /* ===================================================================== */
  say('\n1. CSP — the ONE directive that changed, and everything that did not');

  var CITIZEN_EXPECTED = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";
  var ADMIN_EXPECTED = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

  var home = await get('/');
  var admin = await get('/admin');
  ok(home.headers['content-security-policy'] === CITIZEN_EXPECTED,
    'the citizen CSP is EXACTLY the expected header, directive for directive');
  ok(admin.headers['content-security-policy'] === ADMIN_EXPECTED,
    'the admin CSP is UNCHANGED — the operator console runs no WebAssembly');
  ok(admin.headers['content-security-policy'].indexOf('wasm-unsafe-eval') === -1,
    'and cannot: wasm-unsafe-eval never reaches the admin surface');

  // Directive-by-directive, so a future edit that widens a different one fails
  // here rather than passing because the wasm token is still present.
  var citizen = home.headers['content-security-policy'];
  ok(/(^|; )default-src 'self'(;|$)/.test(citizen), "default-src is still exactly 'self'");
  ok(/(^|; )style-src 'self'(;|$)/.test(citizen), "style-src is still exactly 'self'");
  ok(/(^|; )connect-src 'self'(;|$)/.test(citizen), "connect-src is still exactly 'self' — the engine cannot fetch a model off-origin");
  ok(/(^|; )img-src 'self' blob:(;|$)/.test(citizen), "img-src is unchanged");
  ok(/(^|; )base-uri 'none'(;|$)/.test(citizen), "base-uri is still 'none'");
  ok(/(^|; )frame-ancestors 'none'(;|$)/.test(citizen), "frame-ancestors is still 'none'");

  // The tokens that must NOT appear anywhere.
  ["'unsafe-eval'", "'unsafe-inline'", 'http:', 'https:', 'data:', '*'].forEach(function (bad) {
    ok(citizen.indexOf(bad) === -1, 'the citizen CSP contains no ' + bad);
  });
  ok(citizen.indexOf('wasm-unsafe-eval') !== -1, "and it does carry 'wasm-unsafe-eval' — the one token the engine needs");

  // script-src must permit no ORIGIN beyond self.
  var scriptSrc = (citizen.match(/script-src ([^;]+)/) || [])[1];
  ok(scriptSrc === "'self' 'wasm-unsafe-eval'",
    'script-src is exactly "\'self\' \'wasm-unsafe-eval\'" — no external origin was admitted');

  /* ===================================================================== */
  say('\n2. THE ENGINE IS VENDORED AND SAME-ORIGIN');
  var assets = [
    ['/assets/tesseract/tesseract.min.js', 'application/javascript'],
    ['/assets/tesseract/worker.min.js', 'application/javascript'],
    ['/assets/tesseract/tesseract-core-simd-lstm.wasm', 'application/wasm'],
    ['/assets/tesseract/tesseract-core-lstm.wasm', 'application/wasm'],
    ['/assets/tesseract/eng.traineddata.gz', 'application/octet-stream'],
    ['/assets/plate-scanner.js', 'application/javascript']
  ];
  for (var i = 0; i < assets.length; i++) {
    var r = await get(assets[i][0]);
    ok(r.status === 200, assets[i][0] + ' is served from this origin');
    ok((r.headers['content-type'] || '').indexOf(assets[i][1]) === 0, assets[i][0] + ' has content-type ' + assets[i][1]);
  }
  var gz = await get('/assets/tesseract/eng.traineddata.gz');
  ok(!gz.headers['content-encoding'],
    'the model is served with NO Content-Encoding — the engine inflates it itself');
  ok(gz.raw[0] === 0x1f && gz.raw[1] === 0x8b, 'and it really is gzip data');

  ok(scanJs.indexOf('cdn.') === -1 && scanJs.indexOf('http://') === -1 && scanJs.indexOf('https://') === -1,
    'plate-scanner.js references no external URL at all');
  ok(/workerBlobURL:\s*false/.test(scanJs),
    'the worker is a same-origin URL, not a blob: — so blob: never had to enter worker-src');
  ok(/ENGINE_BASE\s*=\s*"\/assets\/tesseract\//.test(scanJs), 'every engine path is same-origin');

  /* ===================================================================== */
  say('\n3. THE BUTTON SITS BESIDE "Consulter l\'identité" AND REUSES THE DS');
  ok(/Scanner la plaque/.test(homeHtml), 'the button is labelled "Scanner la plaque"');
  var actions = homeHtml.slice(homeHtml.indexOf('ida-search-actions'));
  ok(actions.indexOf("Consulter l'identité") !== -1 && actions.indexOf('Scanner la plaque') !== -1 &&
     actions.indexOf('Scanner la plaque') - actions.indexOf("Consulter l'identité") < 500,
    'it sits in the same .ida-search-actions row as "Consulter l\'identité"');
  ok(/data-scan-open[^>]*hidden/.test(homeHtml),
    'it ships hidden and is revealed only when a camera API exists');
  ok(/class="ida-btn ida-btn--secondary" data-scan-open/.test(homeHtml),
    'it is a Design System button (.ida-btn--secondary), not a new control');
  ['ida-card', 'ida-field', 'ida-input', 'ida-alert', 'ida-btn'].forEach(function (c) {
    ok(homeHtml.indexOf(c) !== -1, 'the scanner dialog reuses .' + c);
  });
  ok(/data-scan-root[^>]*hidden/.test(homeHtml), 'the dialog is inert until opened');

  /* ===================================================================== */
  say('\n4. THE SCANNER RUNS THE SAME SEARCH — no parallel flow');
  ok(/function applyScannedPlate/.test(homeJs), 'the scanner hands its reading to one function');
  ok(/resolvePlate\(plateApi\.canonical\(\)/.test(homeJs.slice(homeJs.indexOf('function applyScannedPlate'))),
    'which calls the SAME resolvePlate() the typed form calls');
  ok(/plateApi\.refresh\(\)/.test(homeJs), 'after filling the real plate inputs, the DS component revalidates as if typed');
  /* Counts the CALL, not the string: the file's header comment names the
   * route too, and matching prose made this fail against correct code. */
  ok((homeJs.match(/fetch\("\/public\/plates\//g) || []).length === 1,
    'there is exactly ONE plate lookup CALL in the page — the scanner added no second search path');
  ok(scanJs.indexOf('/public/plates/') === -1 && scanJs.indexOf('/public/passport/') === -1,
    'plate-scanner.js performs no search of its own');

  /* ===================================================================== */
  say('\n5. IT NEVER INVENTS A READING');
  ok(scanner.parseTunStd('188 TUN 4523').serie === '188', 'two clean digit groups read exactly');
  ok(scanner.parseTunStd('188 4523').numero === '4523', 'the Arabic word is not needed — the gap identifies the groups');
  var ambiguous = scanner.parseTunStd('1884523');
  ok(ambiguous && ambiguous.exact === false,
    'ONE run of digits is reported as ambiguous, never split by guesswork');
  ok(ambiguous.serie === '' && ambiguous.numero === '',
    'and it proposes no série/numéro of its own for the ambiguous case');
  ok(scanner.parseTunStd('abc') === null, 'unreadable text reads as null, not as a plate');
  ok(scanner.parseTunStd('') === null, 'empty text reads as null');
  ok(scanner.parseTunStd('12 34 56') === null, 'three groups is not a TUN_STD plate — refused, not trimmed');
  ok(scanner.parseTunStd('1234 56789') === null, 'out-of-range group lengths are refused');
  /* The geometry split — the ONE place the two digit groups may be separated
   * without whitespace. It must split on a MEASURED gap and refuse otherwise. */
  function sym(txt, x0, x1) { return { text: txt, bbox: { x0: x0, x1: x1 } }; }
  var wideGap = [sym('1',0,20),sym('8',22,42),sym('8',44,64),sym('4',160,180),sym('5',182,202),sym('2',204,224),sym('3',226,246)];
  var geo = scanner.splitByGeometry({ symbols: wideGap });
  ok(geo && geo.serie === '188' && geo.numero === '4523',
    'a wide gap (where the Arabic word sat) splits the groups by measurement');
  ok(geo.via === 'geometry', 'and records that it came from geometry, not from text');
  var evenly = [sym('1',0,20),sym('8',22,42),sym('8',44,64),sym('4',66,86),sym('5',88,108),sym('2',110,130),sym('3',132,152)];
  ok(scanner.splitByGeometry({ symbols: evenly }) === null,
    'evenly spaced digits have no decisive gap — REFUSED, never split on a hunch');
  var badLen = [sym('1',0,20),sym('8',22,42),sym('8',44,64),sym('4',66,86),sym('5',200,220)];
  ok(scanner.splitByGeometry({ symbols: badLen }) === null,
    'a gap that would yield an invalid série length is refused');
  ok(scanner.splitByGeometry({}) === null, 'no geometry at all is refused, not guessed');
  ok(/blocks: true/.test(scanJs), 'the engine is asked for per-symbol geometry (blocks:true)');
  ok(/maxGap < median \* GAP_RATIO/.test(scanJs), 'the gap must be decisively wider than the median');

  ok(typeof scanner.CONFIDENT === 'number' && scanner.CONFIDENT >= 70,
    'a confidence floor exists and is cautious (' + scanner.CONFIDENT + ')');
  function syc(t, c) { return { text: t, confidence: c, bbox: { x0: 0, x1: 10 } }; }
  ok(scanner.readConfidence({ symbols: [syc('1',98), syc('8',97), syc('8',99)] }) === 97,
    'confidence is the WEAKEST digit, so a plate is only as good as its worst character');
  ok(scanner.readConfidence({ symbols: [syc('1',98), syc('4',12), syc('8',99)] }) === 12,
    'one doubtful digit governs the whole reading — averaging would hide it');
  ok(scanner.readConfidence({}) === null,
    'nothing to measure returns null, and the caller then treats the read as uncertain');
  ok(/a plate is only as trustworthy as its least certain digit/.test(scanJs),
    'and the reason is recorded where the next reader will find it');

  ok(/parsed\.exact && confidence >= CONFIDENT/.test(scanJs),
    'a search runs unaided ONLY when the read is exact AND above that floor');
  ok(/show\("confirm"\)/.test(scanJs), 'every other outcome goes to the confirm/correct step');
  ok(/tessedit_char_whitelist:\s*"0123456789"/.test(scanJs),
    'the engine is constrained to digits — a Tunisian série plate has no letters');

  /* ===================================================================== */
  say('\n6. CAMERA — explicit, recoverable, and always released');
  ok(/data-scan-action="start"/.test(homeHtml), 'the camera opens only from an explicit control');
  ok(/Autoriser et ouvrir la caméra/.test(homeHtml), 'which says plainly that it will open the camera');
  ok(!/getUserMedia/.test(homeJs), 'nothing on page load touches getUserMedia');
  ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError'].forEach(function (e) {
    ok(scanJs.indexOf(e) !== -1, 'the ' + e + ' case is handled explicitly');
  });
  ok(/Accès à la caméra refusé/.test(scanJs), 'a refused permission is explained, not swallowed');
  ok(/Aucune caméra détectée/.test(scanJs), 'an absent camera is explained');
  ok((scanJs.match(/stopCamera\(\)/g) || []).length >= 5, 'the camera is released on every exit path');
  ok(/getTracks\(\)\.forEach/.test(scanJs) && /t\.stop\(\)/.test(scanJs), 'and released track by track');
  ok(/pagehide/.test(scanJs) && /visibilitychange/.test(scanJs),
    'leaving or hiding the page also releases it');
  ok(/if\s*\(!cameraSupported\(\)\)/.test(scanJs), 'an unsupported browser is told, not left waiting');
  ok(/Saisir la plaque à la main|Saisir à la main|à la main/.test(homeHtml),
    'every failure path offers the manual fallback');

  /* ===================================================================== */
  say('\n7. UNREGISTERED VEHICLE — the plate is carried, never retyped');
  ok(/\/admin\?plate=/.test(homeJs), 'the unknown-vehicle path carries the plate in the link');
  ok(/encodeURIComponent\(canonicalPlate\)/.test(homeJs), 'in its canonical machine form, encoded');
  ok(/params\.get\('plate'\)/.test(adminJs), 'the registration page reads it back');
  ok(/\^\\d\{1,3\} TUN \\d\{1,4\}\$/.test(adminJs),
    'and accepts it only in the canonical form — a crafted link cannot seed arbitrary text');
  ok(/form\.elements\.plate_number\.value = plate/.test(adminJs), 'the plate field is prefilled');
  ok(/form\.elements\.format_code\.value = 'TUN_STD'/.test(adminJs), 'with its format, so nothing is retyped');

  /* IDA-ADMIN-FR — this notice used to be bilingual. The operator console is
   * now a French-only surface, so what is asserted here is the French wording
   * verbatim AND the absence of any Arabic on the page. */
  say('\n8. THE UNREGISTERED-VEHICLE NOTICE — French only');
  ok(/data-unregistered-notice/.test(adminHtml), 'the notice exists at the top of the registration page');
  ok(adminHtml.indexOf('data-unregistered-notice') < adminHtml.indexOf('<h1>'),
    'ABOVE the page title, where someone arriving from the search is looking');
  ok(/hidden/.test((adminHtml.match(/<div class="ida-alert ida-alert--info" data-unregistered-notice[^>]*>/) || [''])[0]),
    'hidden by default — it appears only when arriving from a plate search');
  ok(adminHtml.indexOf('Véhicule non enregistré') !== -1,
    'the notice title is present, verbatim');
  ok(adminHtml.indexOf("Cette voiture n'est pas encore enregistrée dans IDauto.") !== -1,
    'the French sentence is present, verbatim');
  ok(adminHtml.indexOf('Vous pouvez compléter son enregistrement avec les informations dont vous disposez.') !== -1,
    'including the second French sentence');
  ok(!ARABIC.test(adminHtml), 'no Arabic character is rendered anywhere on /admin');
  ok(!ARABIC.test(adminJs), 'and none is built in JavaScript either');
  ok(!/lang="ar"|dir="rtl"/.test(adminHtml), 'no Arabic language or RTL direction is declared');
  ok(/notice\.hidden = false/.test(adminJs), 'admin-ui.js reveals it when a plate was carried over');
  /* The plate is the ONE part of the notice that is not static markup — it is
   * whatever the search carried over, appended to a fixed French label. A
   * hard-coded plate here would be the bug this asserts against. */
  ok(/'Plaque reprise de la recherche — ' \+ plate/.test(adminJs),
    'the plate line is the fixed French label plus the plate from the search');
  ok(!/\d{1,3} TUN \d{1,4}/.test(adminJs) && !/\d{1,3} TUN \d{1,4}/.test(adminHtml),
    'no literal plate number is hard-coded in the page or its script');

  /* ===================================================================== */
  say('\n9. NOTHING PRIVATE, NOTHING PUBLIC, NOTHING CHANGED');
  /* Word boundaries, not substrings: "giving up" contains "vin", and matching
   * it failed this assertion against code that has nothing to do with VINs. */
  ok(!/\bvin\b/i.test(homeHtml) && !/\bvin\b/i.test(scanJs),
    'neither the homepage nor the scanner mentions a VIN');
  ok(!/\bivid\b/i.test(scanJs),
    'the scanner cannot propose, carry or influence an IVID');
  /* Comments stripped first: admin.html mentions IVID in a comment explaining
   * the owner session. What matters is that no CONTROL accepts one. */
  var adminMarkup = adminHtml.replace(/<!--[\s\S]*?-->/g, '');
  ok(!/name=["']?ivid/i.test(adminMarkup) && !/id=["']?[a-z-]*ivid/i.test(adminMarkup),
    'the registration page offers no IVID field — the server issues it');
  ok(!/ivid/i.test(adminMarkup), 'and its rendered markup never mentions an IVID at all');
  ok((await get('/api/vehicles')).status === 401, 'the API still refuses an unauthenticated read');
  ok((await get('/admin')).status === 200 && (await get('/api/review/observations')).status === 401,
    'the admin shell is served but its API stays protected');
  var pub = await get('/public/passport/ivid:1:BOGUS:XX');
  ok(pub.status === 404, 'the public passport route is untouched');
  ok(!/upload|FormData|fetch\(.*POST/i.test(scanJs),
    'the scanner uploads nothing — the image never leaves the device');

  say('\n10. RESPONSIVE — no construct that forces horizontal overflow');
  var css = fs.readFileSync(path.join(BASE, 'web', 'design-system', 'css', 'components.css'), 'utf8');
  var block = css.slice(css.indexOf('Plate scanner (IDA-V11)'));
  ok(/max-width: 30rem/.test(block), 'the panel is width-capped in rem, not px');
  ok(/width: 100%/.test(block), 'and fluid below that cap');
  ok(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.4fr\)/.test(block),
    'the confirm fields use minmax(0, …) — no fixed floor to overflow');
  ok(/@media \(max-width: 380px\)/.test(block), 'and collapse to one column on the narrowest phones');
  ok(!/#[0-9a-fA-F]{3,6}/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the scanner CSS introduces no literal colour — tokens only');

  server.close();
  console.log('\nIDA-V11 plate scanner + CSP + unregistered handoff: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
