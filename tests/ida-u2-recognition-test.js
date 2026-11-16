#!/usr/bin/env node
'use strict';
/* IDauto — Update 2 — automatic plate detection, tracking, colour, vehicle vision and provenance.
 *
 * Offline: no database, no camera, no network. The detector, tracker and colour functions are pure and
 * run here on images drawn by this file; the vision module runs against a stub in place of the provider;
 * the rest is static analysis of the page, the scanner and the migration.
 *
 * What these tests do NOT establish: accuracy on real photographs. That is measured separately (see
 * docs/VEHICLE_RECOGNITION.md §6) and must not be inferred from the synthetic images below. */

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function read(p) { return fs.readFileSync(path.join(BASE, p), 'utf8'); }

var D = require(path.join(BASE, 'web', 'citizen', 'plate-detector.js'));
var S = require(path.join(BASE, 'web', 'citizen', 'plate-scanner.js'));
var vision = require(path.join(BASE, 'reference', 'recognition', 'vehicle-vision.js'));
var provenance = require(path.join(BASE, 'reference', 'recognition', 'provenance.js'));

/* ---- a tiny 5×7 digit font, enough to draw a plate ---- */
var FONT = { '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100' };
function canvas(w, h, tone) { var g = new Uint8Array(w * h); g.fill(tone); return g; }
function rect(g, w, x0, y0, x1, y1, tone) { for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) g[y * w + x] = tone; }
function glyph(g, w, ch, x, y, s, tone) { var f = FONT[ch]; for (var r = 0; r < 7; r++) for (var c = 0; c < 5; c++) if (f[r * 5 + c] === '1') rect(g, w, x + c * s, y + r * s, x + (c + 1) * s + 1, y + (r + 1) * s + 1, tone); }   // +1: strokes that meet by a corner are joined, as in a real typeface
/* A plate: ground, thin border, série, a low wide "word", numéro. Returns its rectangle in fractions. */
function plate(g, w, h, px, py, s, serie, numero, o) {
  o = o || {};
  var ground = o.ground === undefined ? 12 : o.ground, ink = o.ink === undefined ? 235 : o.ink;
  var dw = 5 * s, gap = s, word = 12 * s, pad = 3 * s;
  var content = (serie.length + numero.length) * (dw + gap) + word + 2 * 2 * s;
  var pw = content + 2 * pad, ph = 7 * s + 2 * pad;
  rect(g, w, px, py, px + pw, py + ph, ground);
  rect(g, w, px, py, px + pw, py + 1, ink); rect(g, w, px, py + ph - 1, px + pw, py + ph, ink); rect(g, w, px, py, px + 1, py + ph, ink); rect(g, w, px + pw - 1, py, px + pw, py + ph, ink);
  var x = px + pad, y = py + pad, i;
  for (i = 0; i < serie.length; i++) { glyph(g, w, serie[i], x, y, s, ink); x += dw + gap; }
  x += 2 * s;
  if (!o.noWord) { rect(g, w, x, y + 3 * s, x + word, y + 5 * s, ink); rect(g, w, x + 2 * s, y + 2 * s, x + 3 * s, y + 3 * s, ink); }   // lower and wider than a digit
  x += word + 2 * s;
  for (i = 0; i < numero.length; i++) { glyph(g, w, numero[i], x, y, s, ink); x += dw + gap; }
  return { x: px / w, y: py / h, w: pw / w, h: ph / h };
}

say('\n1. PLATE LOCALISATION — white digits on a black ground, série · word · numéro');
var W = 640, H = 360, g, gt, det;
g = canvas(W, H, 128); gt = plate(g, W, H, 200, 220, 3, '173', '8116'); det = D.detect(g, W, H);
ok(det && D.iou(det, gt) >= 0.6, 'a plate on a plain body is found where it is (IoU ' + (det ? D.iou(det, gt).toFixed(2) : 'none') + ')');
ok(det && det.groups && det.groups.length === 2 && det.groups[0].digits === 3 && det.groups[1].digits === 4 && det.groups[0].counted && det.groups[1].counted, 'the two groups are separated and their digits counted: 3 and 4');
ok(det && det.groups && det.groups[0].x + det.groups[0].w < det.groups[1].x, 'the série group lies left of the numéro group, the word between them is in neither');
g = canvas(W, H, 128); gt = plate(g, W, H, 40, 40, 2, '5', '123'); det = D.detect(g, W, H);
ok(det && D.iou(det, gt) >= 0.5 && det.groups[0].digits === 1 && det.groups[1].digits === 3, 'a short number (1 + 3 digits) far from the camera is found too');
g = canvas(W, H, 128); gt = plate(g, W, H, 60, 150, 6, '88', '9024'); det = D.detect(g, W, H);
ok(det && D.iou(det, gt) >= 0.6, 'a plate filling most of the frame is found');
g = canvas(W, H, 40); gt = plate(g, W, H, 200, 220, 3, '173', '8116', { ground: 4, ink: 70 }); det = D.detect(g, W, H);
ok(det && D.iou(det, gt) >= 0.6, 'the same plate in poor light (ink 70 on ground 4) is still found');

// The layout of a REAL plate (owner's reference photo, « 173تونس8116 »): the word sits tight between the groups, is
// nearly as tall as the digits, and its last letter — as tall as a digit — overlaps the rest of the word.
function realPlate(g, w, h, px, py, s, serie, numero) {
  var dw = 5 * s, gap = s, pad = 3 * s, x = px + pad, y = py + pad, i, wordW = 9 * s;
  var pw = (serie.length + numero.length) * (dw + gap) + wordW + 4 * s + 2 * pad, ph = 7 * s + 2 * pad;
  rect(g, w, px, py, px + pw, py + ph, 12);
  rect(g, w, px, py, px + pw, py + 1, 235); rect(g, w, px, py + ph - 1, px + pw, py + ph, 235); rect(g, w, px, py, px + 1, py + ph, 235); rect(g, w, px + pw - 1, py, px + pw, py + ph, 235);
  for (i = 0; i < serie.length; i++) { glyph(g, w, serie[i], x, y, s, 235); x += dw + gap; }
  rect(g, w, x, y + 2 * s, x + wordW, y + 6 * s, 235); rect(g, w, x + s, y + 3 * s, x + wordW - s, y + 5 * s, 12);        // the body of the word: wide, a little lower than a digit
  rect(g, w, x + wordW + s - 2, y, x + wordW + 3 * s, y + 7 * s, 235); rect(g, w, x + wordW - 1, y + 5 * s, x + wordW + s, y + 6 * s, 235); // its last letter: digit-high, joined to the word, overlapping it
  x += wordW + 3 * s + gap;
  for (i = 0; i < numero.length; i++) { glyph(g, w, numero[i], x, y, s, 235); x += dw + gap; }
  return { x: px / w, y: py / h, w: pw / w, h: ph / h };
}
g = canvas(W, H, 128); gt = realPlate(g, W, H, 180, 200, 4, '173', '8116'); det = D.detect(g, W, H);
ok(det && D.iou(det, gt) >= 0.6 && det.groups && det.groups[0].digits === 3 && det.groups[1].digits === 4, 'the real layout « 173تونس8116 » (word tight, its last letter as tall as a digit) is found and counted 3 + 4, not 3 + 5');
ok(det && det.groups && det.groups[1].cells && det.groups[1].cells.length === 4 && det.groups[1].cells[0].x > det.groups[0].x + det.groups[0].w, 'each digit has its own rectangle (read one by one when a group reading miscounts), and none of them is the word\'s letter');
g = canvas(W, H, 128); realPlate(g, W, H, 180, 200, 4, '', '8116');
ok(D.detect(g, W, H) === null, 'the word followed by four digits, with no série before it, is not a plate');

say('\n2. WHAT IS NOT A PLATE');
ok(D.detect(canvas(W, H, 128), W, H) === null, 'an empty frame gives no detection');
g = canvas(W, H, 128); plate(g, W, H, 200, 220, 3, '173', '8116', { ground: 235, ink: 12 });
ok(D.detect(g, W, H) === null, 'black digits on a white plate (a foreign plate) are not taken for a Tunisian one');
g = canvas(W, H, 128); for (var k = 0; k < 12; k++) rect(g, W, 100 + k * 30, 100, 104 + k * 30, 190, 240);
ok(D.detect(g, W, H) === null, 'a grille of evenly spaced bright bars (no word-sized gap) is not a plate');
g = canvas(W, H, 128); plate(g, W, H, 200, 220, 3, '173', '', { noWord: true });
ok(D.detect(g, W, H) === null, 'three digits alone are not a plate (four at least, in two groups)');
ok(D.detect(new Uint8Array(10), 4, 2) === null && D.detect(null, 640, 360) === null, 'too small or missing input is refused, not read');

say('\n3. TRACKING — one capture, and only when the plate has stopped moving');
var tr = D.createTracker(), r, box = { x: 0.3, y: 0.6, w: 0.25, h: 0.07, score: 0.9, groups: null };
r = tr.update(box); ok(!r.stable && r.hits === 1, 'first sighting: not stable');
tr.update(box); tr.update(box); r = tr.update(box);
ok(r.stable && r.hits === 4, 'four sightings in a row at the same place: stable');
r = tr.update({ x: 0.6, y: 0.2, w: 0.25, h: 0.07, score: 0.9 });
ok(!r.stable && r.hits === 1, 'the plate jumps elsewhere: the count starts again');
tr.reset(); tr.update(box); tr.update(box); tr.update(null); tr.update(null); r = tr.update(null);
ok(!r.box && r.lost, 'three frames without a plate: it is lost');
tr.reset(); tr.update(box); tr.update({ x: 0.305, y: 0.602, w: 0.25, h: 0.07, score: 0.9 }); tr.update({ x: 0.31, y: 0.6, w: 0.252, h: 0.07, score: 0.9 }); r = tr.update({ x: 0.308, y: 0.601, w: 0.25, h: 0.07, score: 0.9 });
ok(r.stable && Math.abs(r.box.x - 0.306) < 0.01, 'a hand that trembles a little still locks, on a smoothed rectangle');
ok(Math.abs(D.iou(box, box) - 1) < 1e-9 && D.iou(box, { x: 0.8, y: 0.1, w: 0.1, h: 0.05 }) === 0, 'IoU: 1 for the same rectangle, 0 for disjoint ones');

say('\n4. THE SCANNER LOOP — no reading per frame, nothing accepted on a doubt');
var scanJs = read('web/citizen/plate-scanner.js'), detJs = read('web/citizen/plate-detector.js');
ok(S.AUTO.interval >= 150 && S.AUTO.maxAttempts === 3, 'the frame is looked at about five times a second at most, and three uncertain readings hand over to the person');
ok(/if \(tr\.stable\) \{ a\.busy = true; autoRead\(tr\.box\); \}/.test(scanJs) && /if \(!a \|\| a\.busy \|\|/.test(scanJs), 'a reading starts only on a stable plate, and no look happens while one is running');
ok(S.AUTO.maxReads === 6 && /a\.attempts >= AUTO\.maxAttempts \|\| a\.reads >= AUTO\.maxReads/.test(scanJs) && !/a\.attempts--/.test(scanJs), 'the loop always ends: six readings at most, however confident and unconfirmed they alternate');
ok(/a\.fineLock \? "both" :/.test(scanJs) && /if \(found\.box && found\.w > D\.WORK_W\) a\.fineLock = true;/.test(scanJs) && /if \(!tr\.box\) a\.fineLock = false;/.test(scanJs), 'a plate found by the larger look keeps being looked at the same way, so it can count as steady');
ok(/a\.candidate === key/.test(scanJs) && /deuxième image/.test(scanJs), 'a confident reading is accepted only when a second frame gives the same digits');
ok(/parts\[q\]\.digits\.length === box\.groups\[q\]\.digits/.test(scanJs), 'a reading whose digit count differs from what the detector counted is not accepted');
ok(S.LOW_CONTRAST >= 80 && /counted\(box\) && \(box\.contrast \|\| 0\) >= LOW_CONTRAST/.test(scanJs), 'a plate seen in poor light (little contrast) is never accepted by itself: the person checks the digits');
ok(/tessedit_pageseg_mode: "10"/.test(scanJs) && /finally \{ await worker\.setParameters\(\{ tessedit_pageseg_mode: "7" \}\); \}/.test(scanJs), 'a miscounted group is read digit by digit, and the reader is always put back in line mode');
ok(/lean <= 0\.035/.test(detJs), 'a plate that leans is never counted as trusted: its reading is shown, not accepted');
ok(/Math\.min\(CONFIDENT - 1/.test(scanJs), 'digits that touched each other (not counted one by one) can never reach the acceptance floor');
ok(/document\.visibilityState === "hidden"/.test(scanJs) && /function stopCamera\(\) \{\s*stopAuto\(\);/.test(scanJs), 'the loop stops with the camera and does nothing in a hidden tab');
ok(/Math\.max\(AUTO\.interval, Math\.min\(1000, a\.cost \* 3\)\)/.test(scanJs), 'a slow device is given more time between looks');
ok(/data-scan-action", "mode"/.test(scanJs) && /setMode\("manual"\)/.test(scanJs) && typeof S.setFrame === 'function' && typeof S.cropRect === 'function', 'the manual frame stays available as a fallback');
ok(/if \(!D\) \{ setMode\("manual"\); return false; \}/.test(scanJs), 'without the detector the scanner behaves exactly as before (manual frame)');
var st = S.structure('173', '8116');
ok(st.first === '173' && st.text === 'تونس' && st.last === '8116' && st.normalized === '173 تونس 8116' && st.canonical === '173 TUN 8116', 'the number is structured: first group, the word, last group, normalised form');
ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(detJs) && !/fetch\(|XMLHttpRequest|sendBeacon/.test(scanJs), 'neither the detector nor the scanner makes a network call: plate work stays on the device');
var vs = S.videoToStage({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 400, 400, 1280, 720);
ok(Math.abs(vs.y - 0.25) < 1e-6 && Math.abs(vs.h - 0.5) < 1e-6 && vs.w > 0.5, 'the rectangle is drawn where the plate is on a cropped (object-fit: cover) preview');

say('\n5. COLOUR — a hint from the pixels around the plate');
function rgbFrame(w, h, r, gg, b) { var d = new Uint8ClampedArray(w * h * 4); for (var i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; } return d; }
var pl = { x: 0.4, y: 0.7, w: 0.2, h: 0.06 };
ok(D.colourOf(rgbFrame(320, 180, 200, 20, 25), 320, 180, pl).value === 'rouge', 'a red body → rouge');
var blackCar = rgbFrame(320, 180, 170, 175, 180); for (var yb = 95; yb < 150; yb++) for (var xb = 30; xb < 290; xb++) { var ib = (yb * 320 + xb) * 4; blackCar[ib] = 15; blackCar[ib + 1] = 15; blackCar[ib + 2] = 18; }
ok(D.colourOf(blackCar, 320, 180, pl).value === 'noir', 'a black body in daylight → noir');
ok(D.colourOf(rgbFrame(320, 180, 240, 240, 238), 320, 180, pl).value === 'blanc', 'a white body → blanc');
ok(D.colourOf(rgbFrame(320, 180, 30, 60, 170), 320, 180, pl).value === 'bleu', 'a blue body → bleu');
var mixed = rgbFrame(320, 180, 200, 20, 25); for (var i2 = 0; i2 < mixed.length; i2 += 12) { mixed[i2] = 20; mixed[i2 + 1] = 160; mixed[i2 + 2] = 40; } for (var i3 = 4; i3 < mixed.length; i3 += 12) { mixed[i3] = 30; mixed[i3 + 1] = 60; mixed[i3 + 2] = 200; }
ok(D.colourOf(mixed, 320, 180, pl).value === 'unknown', 'no clear winner → unknown, never a guess');
var night = rgbFrame(320, 180, 14, 14, 16); ok(D.colourOf(night, 320, 180, pl).value === 'unknown' && D.colourOf(night, 320, 180, pl).reason === 'too_dark', 'a dark scene → unknown: at night every car looks black');
ok(D.colourOf(null, 0, 0, pl).value === 'unknown' && D.colourOf(rgbFrame(8, 8, 1, 1, 1), 8, 8, null).value === 'unknown', 'no image or no plate → unknown');

say('\n6. VEHICLE VISION — off by default, unknown when unsure, the key never in the browser');
var JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
function stub(answer, capture) { return { beta: { messages: { create: async function (req) { if (capture) capture.req = req; if (answer instanceof Error) throw answer; return answer; } } } }; }
function reply(obj, extra) { return Object.assign({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] }, extra || {}); }
(async function () {
  var c0 = vision.config({});
  ok(!c0.enabled && c0.model === 'claude-opus-5-5', 'with nothing configured the analysis is OFF');
  ok(!vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic' }).enabled, 'a provider name without a key does not enable it');
  ok(vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic', IDAUTO_VISION_API_KEY: 'k' }).enabled && !vision.config({ IDAUTO_VISION_PROVIDER: 'other', IDAUTO_VISION_API_KEY: 'k' }).enabled, 'only the documented provider, with a key, enables it');
  var off = await vision.analyse(JPEG, { env: {} });
  ok(off.enabled === false && off.fields.make.value === null && off.fields.colour.value === null, 'OFF: analyse() answers unknown for every field and calls nobody');
  var cap = {}, good = await vision.analyse(JPEG, { env: {}, client: stub(reply({ vehicle_visible: true, make: 'Chevrolet', make_confidence: 0.94, model: 'Aveo LS', model_confidence: 0.81, colour: 'noir', colour_confidence: 0.97, body_type: 'berline', body_type_confidence: 0.9 }), cap) });
  ok(good.fields.make.value === 'Chevrolet' && good.fields.model.value === 'Aveo LS' && good.fields.colour.value === 'noir' && good.fields.body_type.value === 'berline', 'a confident answer is returned field by field');
  ok(['make', 'model', 'colour', 'body_type'].every(function (f) { return good.fields[f].source === 'vision'; }), 'every value is marked source: vision — never presented as a register fact');
  var sent = JSON.stringify(cap.req);
  ok(cap.req.messages[0].content[0].type === 'image' && cap.req.messages[0].content[0].source.media_type === 'image/jpeg' && cap.req.output_config.format.type === 'json_schema', 'the request carries one JPEG and asks for the schema');
  ok(!/173|8116|TUN|تونس/.test(sent) && /Do not read, use or repeat the registration plate/.test(cap.req.system), 'the registration number is not sent, and the model is told not to use the plate');
  ok(cap.req.model === 'claude-opus-5-5' && cap.req.fallbacks === 'default' && !('temperature' in cap.req) && !('thinking' in cap.req), 'model, fallback and parameters follow the provider\'s current rules');
  var unsure = await vision.analyse(JPEG, { env: {}, client: stub(reply({ vehicle_visible: true, make: 'Chevrolet', make_confidence: 0.9, model: 'Aveo', model_confidence: 0.4, colour: 'noir', colour_confidence: 0.5, body_type: 'unknown', body_type_confidence: 0.2 })) });
  ok(unsure.fields.make.value === 'Chevrolet' && unsure.fields.model.value === null && unsure.fields.colour.value === null && unsure.fields.body_type.value === null, 'below 0.6 a value is withheld: unknown');
  var noMake = await vision.analyse(JPEG, { env: {}, client: stub(reply({ vehicle_visible: true, make: 'unknown', make_confidence: 0.2, model: 'Aveo LS', model_confidence: 0.9, colour: 'noir', colour_confidence: 0.9, body_type: 'berline', body_type_confidence: 0.9 })) });
  ok(noMake.fields.model.value === null, 'a model is never offered without its make');
  var noCar = await vision.analyse(JPEG, { env: {}, client: stub(reply({ vehicle_visible: false, make: 'Chevrolet', make_confidence: 0.99, model: 'Aveo', model_confidence: 0.99, colour: 'noir', colour_confidence: 0.99, body_type: 'berline', body_type_confidence: 0.99 })) });
  ok(Object.keys(noCar.fields).every(function (f) { return noCar.fields[f].value === null; }), 'no vehicle in the photo → every field unknown, whatever else the answer says');
  var odd = await vision.analyse(JPEG, { env: {}, client: stub(reply({ vehicle_visible: true, make: '<img src=x onerror=1>Chevrolet', make_confidence: 7, model: 'A'.repeat(300), model_confidence: 0.9, colour: 'turquoise', colour_confidence: 0.9, body_type: 'tank', body_type_confidence: 0.9 })) });
  ok(!/[<>]/.test(odd.fields.make.value) && odd.fields.make.confidence === 1 && odd.fields.model.value.length === 80 && odd.fields.colour.value === null && odd.fields.body_type.value === null, 'odd answers are cleaned: no markup, confidence clamped, length capped, values outside the lists dropped');
  var bad = await vision.analyse(JPEG, { env: {}, client: stub({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'I cannot tell.' }] }) });
  ok(bad.error === 'provider_bad_answer' && bad.fields.make.value === null, 'an answer that is not the schema → unknown, with a reason');
  var refused = await vision.analyse(JPEG, { env: {}, client: stub({ stop_reason: 'refusal', content: [] }) });
  ok(refused.error === 'provider_declined' && refused.fields.make.value === null, 'a declined request → unknown, with a reason');
  var e429 = Object.assign(new Error('x'), { status: 429 }), e401 = Object.assign(new Error('x'), { status: 401 }), e500 = Object.assign(new Error('x'), { status: 503 });
  ok((await vision.analyse(JPEG, { env: {}, client: stub(e429) })).error === 'provider_rate_limited' && (await vision.analyse(JPEG, { env: {}, client: stub(e401) })).error === 'provider_auth' &&
     (await vision.analyse(JPEG, { env: {}, client: stub(e500) })).error === 'provider_unavailable' && (await vision.analyse(JPEG, { env: {}, client: stub(new Error('down')) })).error === 'provider_unreachable', 'provider failures never throw: unknown fields and a named reason');
  var notJpeg = await vision.analyse(Buffer.from('GIF89a....'), { env: {}, client: stub(reply({})) });
  var tooBig = await vision.analyse(Buffer.concat([JPEG, Buffer.alloc(vision.MAX_IMAGE_BYTES)]), { env: {}, client: stub(reply({})) });
  ok(notJpeg.error === 'invalid_image' && tooBig.error === 'invalid_image', 'only a JPEG of at most 1.5 MB is ever passed on');

  say('\n7. THE PAGE AND THE SERVER — no key, no provider address, no new origin in the browser');
  var routes = read('reference/workspace-routes.js'), v12 = read('reference/v12-routes.js'), apiJs = read('reference/api.js');
  var front = ['web/citizen/plate-scanner.js', 'web/citizen/plate-detector.js', 'reference/app-register.js', 'reference/app-register.html', 'reference/app-vehicles.js', 'web/citizen/index.html', 'reference/atelier.html'].map(read).join('\n');
  ok(!/anthropic|api[_-]?key|sk-ant|x-api-key|IDAUTO_VISION/i.test(front), 'no key, key name or provider name appears in any file served to the browser');
  ok(/connect-src 'self'/.test(v12.match(/var ATELIER_CSP = "[^"]+"/)[0]) && !/connect-src [^;]*https?:/.test(v12 + apiJs), 'connect-src stays \'self\' on every page: the browser can reach this server only');
  ok(/scope: 'vehicle:write' \},\n    \{ method: 'GET', pattern: \/\^\\\/api\\\/workspace\\\/vehicle-recognition\$\/, scope: 'vehicle:write'/.test(routes) && /method: 'POST', pattern: \/\^\\\/api\\\/workspace\\\/vehicle-recognition\$\/, scope: 'vehicle:write'/.test(routes), 'the analysis route needs a signed-in account allowed to register vehicles');
  ok(/VISION_LIMIT = \{ limit: 12, window_seconds: 60 \}/.test(routes) && /enforcePublicResolution\(db, 'vision:'/.test(routes), 'the analysis is rate-limited per account');
  ok(/not stored\)/.test(routes) && !/storage\.|writeFile|putObject/.test(routes), 'the photo is not stored by the route; the audit line says so and carries no image');
  var reg = read('reference/app-register.js'), regHtml = read('reference/app-register.html');
  ok(/id="recog-confirm"/.test(regHtml) && /id="recog-correct"/.test(regHtml) && /id="recog-retry"/.test(regHtml), 'the result card offers Confirmer, Corriger, Recommencer');
  ok(/id="recog-photo"/.test(regHtml) && /id="recog-plate"/.test(regHtml) && /id="recog-make"/.test(regHtml) && /id="recog-model"/.test(regHtml) && /id="recog-colour"/.test(regHtml), 'and shows the image, the number, make, model and colour with their confidence');
  ok(/name="colour"/.test(regHtml) && /name="body_type"/.test(regHtml), 'the vehicle form has Couleur and Carrosserie');
  ok(/if \(f\.make && !val\('make'\)\)/.test(reg) && /if \(f\.colour && !val\('colour'\)\)/.test(reg), 'a value typed by hand before the scan is never overwritten');
  ok(/i\.plate === canonical/.test(reg) && /recog-open-existing/.test(reg) && /getElementById\('recog-confirm'\)\.disabled = !!existing/.test(reg), 'an existing registration: its file is offered and Confirm is disabled');
  ok(!/C\.send\('POST', '\/api\/vehicles\/register'/.test(reg.slice(reg.indexOf('async function onScan'), reg.indexOf('function applyScan'))), 'recognition alone saves nothing: only the form\'s submit creates the vehicle');
  ok(/'Immatriculation', 'Marque', 'Modèle', 'Couleur', 'Année'/.test(read('reference/app-vehicles.js')), 'the vehicle list shows Immatriculation, Marque, Modèle, Couleur, Année');

  say('\n8. PROVENANCE AND MIGRATION — confirmed values in the columns, proposals beside them');
  var pv = provenance.cleanRecognition({ provider: 'anthropic', model: 'claude-opus-5-5', plate: { confidence: 96.4, auto: true }, extra: 'x',
    fields: { make: { proposed: 'Chevrolet', confidence: 0.93, source: 'vision' }, colour: { proposed: 'noir', confidence: 0.7, source: 'camera' }, model: { proposed: '<b>x', confidence: 2, source: 'register' }, vin: { proposed: 'X', confidence: 1, source: 'vision' } } },
    { make: 'CHEVROLET', colour: 'rouge' });
  ok(pv.fields.make.kept === true && pv.fields.colour.kept === false, 'each field records whether the person kept the proposal or corrected it');
  ok(!pv.fields.model && !pv.fields.vin && !('extra' in pv) && pv.plate.confidence === 96, 'unknown sources, unknown fields and stray keys are dropped; nothing is stored as it came');
  ok(provenance.cleanRecognition(null, {}) === null && provenance.cleanRecognition({ fields: {} }, {}) === null && provenance.cleanRecognition('x', {}) === null, 'no proposal → NULL (a vehicle typed by hand has no provenance)');
  var sql = read('database/migrations/ida-u2-visual-recognition.sql'), live = sql.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
  ok(/ADD COLUMN IF NOT EXISTS visual_recognition JSONB;/.test(live) && (live.match(/ADD COLUMN/g) || []).length === 1, 'the migration adds ONE nullable column');
  ok(!/\b(UPDATE|DELETE|DROP COLUMN|DROP TABLE|TRUNCATE|NOT NULL|ALTER COLUMN)\b/.test(live), 'it changes no existing row and removes nothing');
  ok(/DROP CONSTRAINT IF EXISTS chk_vehicle_visual_recognition/.test(live) && /IF NOT EXISTS/.test(live), 'it is safe to apply twice');
  var svc = read('reference/workspace/registration-service.js');
  ok(/SET visual_recognition = \$1::jsonb WHERE id = \$2/.test(svc) && /delete input\.recognition/.test(svc), 'the provenance is written only for the vehicle just created, never into a vehicle column');
  ok(/colour: str\(body\.colour, 40\)/.test(svc) && /body_type: str\(body\.body_type, 40\)/.test(svc), 'colour and body type reuse the columns that already existed');

  say('\n9. BOTH LANGUAGES');
  var cat = read('reference/i18n-catalog-ar.js');
  ['Scanner le véhicule', 'Véhicule reconnu', 'Corriger', 'Recommencer', 'Non reconnu', 'Cadrage manuel', 'Détection automatique', 'Plaque repérée — ne bougez plus…', 'Ce véhicule existe déjà dans IDauto', 'Ouvrir sa fiche', 'Noir', 'Berline', 'Aucune image ne quitte l\'appareil.']
    .forEach(function (k) { ok(cat.indexOf(JSON.stringify(k) + ':') !== -1, 'Tunisian Arabic exists for « ' + k + ' »'); });

  console.log('\nIDA-U2 automatic recognition: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(function (e) { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
