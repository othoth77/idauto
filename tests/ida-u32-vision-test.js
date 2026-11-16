'use strict';
// IDA-U3.2 — real vehicle recognition: make, model, generation, body type and paint colour, each with its status;
// the paint colour measured on the pixels; a plate « recognised » only when two readings agree. Database-free.
var fs = require('fs'), path = require('path');
var vision = require('../reference/recognition/vehicle-vision.js');
var D = require('../web/citizen/plate-detector.js');
var A = require('../web/citizen/photo-analysis.js');
var clean = require('../reference/photos/photo-clean.js');
var pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function section(t) { console.log('\n' + t); }
var root = path.join(__dirname, '..'), read = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };

function answer(o) {
  return Object.assign({ vehicle_visible: true, view: 'front', make: 'Kia', make_confidence: 0.95, model: 'Picanto', model_confidence: 0.92, generation: 'JA (2017–)', generation_confidence: 0.85,
    trim: 'unknown', trim_confidence: 0, colour: 'rouge', colour_confidence: 0.9, colour_secondary: 'unknown', body_type: 'citadine', body_type_confidence: 0.9, year: 'unknown', year_confidence: 0,
    plate_visible: false, plate_first_digits: '', plate_last_digits: '', plate_confidence: 0, make_model_evidence: 'badge_or_lettering', vehicle_box: [0.05, 0.1, 0.9, 0.8], paint_box: [0.4, 0.5, 0.1, 0.1] }, o || {});
}
function stub(reply, capture) {
  return { beta: { messages: { create: async function (req) { if (capture) capture.push(req); if (reply instanceof Error) throw reply; return reply; } } } };
}
function msg(obj, extra) { return Object.assign({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1700, output_tokens: 180 } }, extra || {}); }
var JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

(async function () {
  section('1. WHY VISION WAS OFF — AND STAYS OFF WITHOUT A KEY');
  var off = vision.config({});
  ok(!off.enabled && off.provider === '', 'no IDAUTO_VISION_PROVIDER → disabled');
  ok(!vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic' }).enabled && vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic' }).hasKey === false, 'provider set but no key → disabled (key_missing)');
  var r0 = await vision.analyse(JPEG, { env: { IDAUTO_VISION_PROVIDER: 'anthropic' } });
  ok(r0.enabled === false && r0.reason === 'key_missing' && !r0.fields.make.value, 'analyse without a key answers key_missing and recognises nothing');
  ok(vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic', IDAUTO_VISION_API_KEY: 'k' }).effort === 'low' && vision.config({ IDAUTO_VISION_PROVIDER: 'anthropic', IDAUTO_VISION_API_KEY: 'k', IDAUTO_VISION_EFFORT: 'medium' }).effort === 'medium', 'effort: low by default, settable to medium/high');
  ok(vision.config({ IDAUTO_VISION_EFFORT: 'max; rm' }).effort === 'low', 'an unexpected effort value falls back to low');

  section('2. STRUCTURED RESULT — MAKE, MODEL, GENERATION, BODY, COLOUR, EACH WITH A STATUS');
  var n = vision.normalise(answer());
  ok(n.fields.make.value === 'Kia' && n.fields.make.status === 'recognised', 'make recognised (badge, 0.95)');
  ok(n.fields.generation.value === 'JA (2017–)' && n.fields.generation.status === 'recognised', 'generation returned with its own confidence and status');
  ok(n.fields.body_type.value === 'citadine', 'body type from the fixed list');
  ok(vision.normalise(answer({ model_confidence: 0.7 })).fields.model.status === 'uncertain', '0.6 ≤ confidence < 0.8 → « uncertain »');
  ok(vision.normalise(answer({ model_confidence: 0.5 })).fields.model.value === null && vision.normalise(answer({ model_confidence: 0.5 })).fields.model.status === 'unknown', 'confidence < 0.6 → unknown (no value at all)');
  var shape = vision.normalise(answer({ make_model_evidence: 'general_shape' }));
  ok(shape.fields.make.status === 'uncertain' && shape.fields.model.status === 'uncertain' && shape.fields.generation.status === 'uncertain', 'make/model named from the overall shape alone are never « recognised », however confident');
  ok(vision.normalise(answer({ make: 'unknown' })).fields.model.value === null && vision.normalise(answer({ make: 'unknown' })).fields.generation.value === null, 'no model or generation without a make');
  ok(vision.normalise(answer({ model: 'unknown' })).fields.generation.value === null, 'no generation without a model');
  ok(vision.normalise(answer({ colour: 'fuchsia' })).fields.colour.value === null, 'a colour outside the list is not accepted');
  ok(vision.normalise(answer({ body_type: 'hatchback' })).fields.body_type.value === null, 'a body type outside the list is not accepted');
  ok(vision.normalise(answer({ colour_secondary: 'noir' })).fields.colour_secondary.value === 'noir' && vision.normalise(answer({ colour_secondary: 'rouge' })).fields.colour_secondary.value === null, 'second colour kept only when it differs from the main one');
  ok(vision.normalise(answer({ vehicle_visible: false })).fields.make.value === null, 'no vehicle → nothing');
  ok(JSON.stringify(vision.normalise(answer()).paint_box) === '[0.4,0.5,0.1,0.1]', 'paint area kept');
  ok(vision.normalise(answer({ paint_box: [0.9, 0.9, 0.5, 0.5] })).paint_box === null && vision.normalise(answer({ paint_box: [0, 0, 'x', 1] })).paint_box === null && vision.normalise(answer({ paint_box: [] })).paint_box === null, 'a paint area outside the image, malformed or empty is dropped');
  ok(vision.normalise(answer({ make: '<img onerror=x>', make_confidence: 0.9 })).fields.make.value.indexOf('<') === -1, 'markup is stripped from names');
  var s = vision.SCHEMA;
  ok(['generation', 'generation_confidence', 'make_model_evidence', 'colour_secondary', 'vehicle_box', 'paint_box'].every(function (k) { return s.required.indexOf(k) !== -1 && s.properties[k]; }), 'the schema asks for generation, evidence, second colour and the two areas');
  var src = read('reference/recognition/vehicle-vision.js');
  ok(/never infer them, or anything else, from the registration number/i.test(src), 'prompt: make and model never inferred from the registration number');
  ok(/Similar-looking vehicles[\s\S]{0,300}answer "unknown"/.test(src), 'prompt: look-alike models and generations → unknown unless a specific detail is visible');
  ok(/never on windows, tyres, wheels, chrome, lamps, the road, the sky, shadows or reflections/.test(src), 'prompt: colour judged on painted panels only');

  section('3. THE PROVIDER CALL — AND ITS FAILURES NEVER SHOWN AS A RECOGNITION');
  var env = { IDAUTO_VISION_PROVIDER: 'anthropic', IDAUTO_VISION_API_KEY: ['placeholder', 'value'].join('-') }, cap = [];
  var r1 = await vision.analyse(JPEG, { env: env, client: stub(msg(answer()), cap) });
  ok(r1.enabled && !r1.error && r1.fields.make.value === 'Kia' && r1.evidence === 'badge_or_lettering', 'a good answer is returned with its evidence');
  ok(r1.usage && r1.usage.input_tokens === 1700, 'token usage is returned (cost is measured, not guessed)');
  ok(cap[0].model === 'claude-opus-5-5' && cap[0].output_config.effort === 'low' && cap[0].output_config.format.type === 'json_schema', 'request: model, effort and JSON schema');
  ok(cap[0].fallbacks === 'default' && cap[0].betas.indexOf('server-side-fallback-2026-07-01') !== -1, 'request: server-side fallback on a declined request');
  ok(JSON.stringify(r1).indexOf('placeholder-value') === -1, 'the key never appears in a result');
  var fails = [[Object.assign(new Error('x'), { status: 401 }), 'provider_auth'], [Object.assign(new Error('x'), { status: 429 }), 'provider_rate_limited'], [Object.assign(new Error('x'), { status: 529 }), 'provider_unavailable'], [new Error('ECONNRESET'), 'provider_unreachable']];
  for (var i = 0; i < fails.length; i++) {
    var rf = await vision.analyse(JPEG, { env: env, client: stub(fails[i][0]) });
    ok(rf.error === fails[i][1] && !rf.fields.make.value && !rf.fields.colour.value && rf.fields.make.status === 'unknown', 'provider failure ' + fails[i][1] + ' → error, every field unknown');
  }
  var rr = await vision.analyse(JPEG, { env: env, client: stub(msg(answer(), { stop_reason: 'refusal' })) });
  ok(rr.error === 'provider_declined' && !rr.fields.make.value, 'a declined request recognises nothing');
  var rb = await vision.analyse(JPEG, { env: env, client: stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }) });
  ok(rb.error === 'provider_bad_answer', 'an unreadable answer is an error, not a result');
  ok((await vision.analyse(Buffer.from('GIF89a'), { env: env, client: stub(msg(answer())) })).error === 'invalid_image', 'a non-JPEG is refused before any call');
  var home = read('web/citizen/home-photo.js');
  ok(/var un = r\.visionError \? "error" : null/.test(home) && /l'analyse d'image a échoué/.test(home), 'page: a failed vision analysis shows « Indisponible — l\'analyse d\'image a échoué », never a recognised status');

  section('4. PAINT COLOUR MEASURED ON THE PIXELS');
  function img(rgb, opts) {
    opts = opts || {}; var w = 120, h = 80, a = new Uint8ClampedArray(w * h * 4);
    for (var k = 0; k < w * h; k++) {
      var c = rgb;
      if (opts.glare && k % 9 === 0) c = [252, 252, 252];        // reflections
      if (opts.shadow && k % 11 === 0) c = [8, 8, 10];           // shadow
      if (opts.mix && (k % w) < w / 2) c = opts.mix;             // two colours half and half
      a[k * 4] = c[0]; a[k * 4 + 1] = c[1]; a[k * 4 + 2] = c[2]; a[k * 4 + 3] = 255;
    }
    return D.paintColour(a, w, h, [0.1, 0.1, 0.8, 0.8]);
  }
  var cases = [['blanc', [236, 236, 232]], ['argent', [176, 178, 182]], ['gris', [100, 102, 106]], ['rouge', [190, 25, 30]], ['bleu', [30, 70, 170]], ['vert', [40, 130, 60]], ['jaune', [220, 200, 40]]];
  cases.forEach(function (c) { var r = img(c[1]); ok(r.value === c[0], 'plain ' + c[0] + ' paint → ' + r.value); });
  ok(img([190, 25, 30], { glare: true, shadow: true }).value === 'rouge', 'red with reflections and shadows → still red (extremes dropped)');
  ok(img([236, 236, 232], { shadow: true }).value === 'blanc', 'white with shadows → still white');
  ok(img([190, 25, 30], { mix: [30, 70, 170] }).value === 'unknown', 'half red, half blue → unknown (no majority)');
  ok(img([5, 5, 6]).value === 'unknown' && img([5, 5, 6]).reason === 'too_dark', 'no light at all → unknown');
  (function () { var w = 120, h = 80, a = new Uint8ClampedArray(w * h * 4); for (var k = 0; k < w * h; k++) { a[k * 4] = 30; a[k * 4 + 1] = 25; a[k * 4 + 2] = 40; a[k * 4 + 3] = 255; }
    var r = D.paintColour(a, w, h, [0.1, 0.1, 0.8, 0.8]); ok(r.value === 'unknown' && r.reason === 'night', 'a dark scene (night) → unknown, not « black »'); })();
  (function () { var w = 120, h = 80, a = new Uint8ClampedArray(w * h * 4); for (var k = 0; k < w * h; k++) { var inBox = (k % w) > 12 && (k % w) < 108 && k / w > 8 && k / w < 72, c = inBox ? 28 : 170; a[k * 4] = c; a[k * 4 + 1] = c; a[k * 4 + 2] = c + 4; a[k * 4 + 3] = 255; }
    ok(D.paintColour(a, w, h, [0.1, 0.1, 0.8, 0.8]).value === 'noir', 'a black car in daylight → black'); })();
  ok(D.paintColour(new Uint8ClampedArray(400), 10, 10, null).value === 'unknown', 'no paint area → unknown');

  section('5. TWO JUDGEMENTS OF THE COLOUR');
  var V = function (v, c, st) { return { value: v, confidence: c, source: 'vision', status: st || 'recognised' }; }, P = function (v, c) { return { value: v, confidence: c }; };
  ok(A.mergeColour(V('rouge', 0.9), P('rouge', 0.8)).status === 'recognised', 'vision and pixels agree → recognised');
  var gs = A.mergeColour(V('argent', 0.9), P('gris', 0.7));
  ok(gs.value === 'argent' && gs.status === 'uncertain', 'silver vs grey → the model\'s word, to check');
  var dis = A.mergeColour(V('rouge', 0.9), P('bleu', 0.8));
  ok(dis.value === null && dis.status === 'unknown' && dis.candidates.join() === 'rouge,bleu', 'real disagreement → unknown, both candidates shown');
  ok(A.mergeColour(V('noir', 0.95), null).status === 'uncertain', 'vision alone is never « recognised » for the colour');
  ok(A.mergeColour(null, P('blanc', 0.8)).status === 'uncertain' && A.mergeColour(null, P('blanc', 0.8)).source === 'pixels', 'pixels alone → to check');
  ok(A.mergeColour(null, null, { value: 'gris', source: 'camera' }).source === 'camera', 'without vision the existing camera estimate is kept');

  section('6. THE REGISTRATION NUMBER — NEVER REPLACED SILENTLY');
  var pa = read('web/citizen/photo-analysis.js');
  ok(/source: "ocr", accepted: false, ocrConfident/.test(pa), 'the device\'s reading alone is never accepted (to check)');
  ok(/else \{ a\.plate\.accepted = true; a\.plate\.source = "ocr\+vision"/.test(pa), 'accepted only when the vision reading agrees exactly');
  ok(/a\.plate\.accepted = false; out\.plateDisagree/.test(pa), 'disagreement → not accepted, the other reading shown');
  ok(/if \(!a\.plate\) a\.plate = \{ serie: v\.plate\.serie, numero: v\.plate\.numero, confidence: v\.plate\.confidence, source: "vision", accepted: false \}/.test(pa), 'the vision reading alone → to check');
  ok(/« 246 » read « 26 » at 99 %/.test(pa), 'the measured reason is written next to the rule');
  ok(/data-hp-serie\]"\)\.value = p \? p\.serie/.test(home) && /Les deux lectures de la plaque diffèrent/.test(home), 'the plate stays editable; a disagreement says so');
  ok(/if \(prep\.quality && !prep\.quality\.ok\) \{ out\.rejected = prep\.quality\.reason; return out; \}/.test(pa) && /too_small|too_dark|overexposed|no_detail/.test(pa), 'an unusable photograph (too small, dark, overexposed, blurred) is rejected before analysis');

  section('7. WHAT IS STORED');
  var st = clean.analysis({ plate: { serie: '173', numero: '8116', confidence: 92, source: 'ocr+vision', accepted: true }, evidence: 'badge_or_lettering', provider: 'anthropic',
    fields: { generation: { value: 'T250', confidence: 0.8, source: 'vision', status: 'recognised' }, colour: { value: 'noir', confidence: 0.9, source: 'vision+pixels', status: 'recognised' }, model: { value: 'Aveo LS', confidence: 1, source: 'manual', status: 'manual' }, make: { value: 'X', source: 'evil', status: 'recognised' }, body_type: { value: 'berline', confidence: 0.9, source: 'vision', status: 'hacked' } } });
  ok(st.plate.source === 'ocr+vision' && st.fields.generation.status === 'recognised' && st.fields.colour.source === 'vision+pixels', 'generation, sources and statuses are stored');
  ok(st.fields.model.source === 'manual' && st.fields.model.status === 'manual', 'a value the person typed is stored as « manual »');
  ok(!st.fields.make && st.fields.body_type && !st.fields.body_type.status, 'an unknown source or status is not stored');
  ok(st.evidence === 'badge_or_lettering', 'the evidence is stored');
  ok(/source: "manual", status: "manual"/.test(home) && /conf\.analysis = an/.test(home), 'on confirmation the page records what was corrected by hand');

  section('8. FRENCH AND TUNISIAN ARABIC');
  var cat = require('../reference/i18n-catalog-ar.js'), C = (cat.strings || (cat.catalog && cat.catalog.strings) || cat);
  var lookup = function (k) { return C[k] || (cat.strings && cat.strings[k]) || (typeof cat.t === 'function' ? cat.t(k) : null); };
  var json = JSON.parse(read('ops/ui/i18n/strings-06-update32.json'));
  var keys = Object.keys(json).filter(function (k) { return k[0] !== '$'; });
  ok(keys.length >= 15 && keys.every(function (k) { return /[؀-ۿ]/.test(json[k]); }), keys.length + ' new strings, each with an Arabic translation');
  ok(keys.every(function (k) { return read('reference/i18n-catalog-ar.js').indexOf(JSON.stringify(k).slice(1, -1)) !== -1; }), 'every new string is in the built catalog');

  console.log('\nIDA-U3.2 vehicle recognition: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
