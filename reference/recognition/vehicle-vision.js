'use strict';
// IDauto — Update 2 — vehicle visual recognition (make, model, colour, body type).
//
// What this is: a photo of the whole vehicle is shown to a vision model, which
// names what it SEES: front or rear, make, model, trim, colour, body type and —
// Update 3 — the registration number when it is clearly readable. Nothing here
// looks a vehicle up in a database, and nothing is inferred from the number:
// every value returned is marked `source: 'vision'` so it cannot be mistaken
// for a fact from a register.
//
// OFF BY DEFAULT. A photo leaves this server only when the operator sets
//   IDAUTO_VISION_PROVIDER=anthropic   and an API key (ANTHROPIC_API_KEY, or
//   IDAUTO_VISION_API_KEY to keep it apart from any other use)
// in the server's environment. Without them analyse() answers
// { enabled: false } and every field is "unknown": the form is then filled by
// hand, exactly as before. The key is read on the server only; no key and no
// provider address ever reaches the browser (the page calls our own route and
// its Content-Security-Policy stays `connect-src 'self'`).
//
// The photo is not stored by IDauto: it is held in memory for the length of
// the request. The provider's own retention is the provider's (docs/VEHICLE_RECOGNITION.md).

var DEFAULT_MODEL = 'claude-opus-5-5';
var MIN_CONFIDENCE = 0.6;          // below this a value is not shown at all: "unknown"
var SURE_CONFIDENCE = 0.8;         // Update 3.2 — from here a value is "recognised"; between the two it is "uncertain" (shown, flagged, never pre-accepted)
var MAX_IMAGE_BYTES = 1500000;     // the browser sends a 1280 px JPEG, a few hundred KB
var COLOURS = ['noir', 'blanc', 'gris', 'argent', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'marron', 'beige', 'unknown'];
var BODY_TYPES = ['berline', 'citadine', 'break', 'suv', 'monospace', 'coupe', 'cabriolet', 'pick-up', 'utilitaire', 'unknown'];

var VIEWS = ['front', 'rear', 'unknown'];
var EVIDENCE = ['badge_or_lettering', 'distinctive_design', 'general_shape', 'none'];

var BOX = { type: 'array', items: { type: 'number' } };   // [x, y, width, height], fractions of the image; [] when not applicable

var SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vehicle_visible', 'view', 'make', 'make_confidence', 'model', 'model_confidence', 'trim', 'trim_confidence', 'colour', 'colour_confidence', 'body_type', 'body_type_confidence',
    'year', 'year_confidence', 'plate_visible', 'plate_first_digits', 'plate_last_digits', 'plate_confidence',
    'generation', 'generation_confidence', 'make_model_evidence', 'colour_secondary', 'vehicle_box', 'paint_box'],
  properties: {
    vehicle_visible: { type: 'boolean' },
    view: { type: 'string', enum: VIEWS },
    make: { type: 'string' }, make_confidence: { type: 'number' },
    model: { type: 'string' }, model_confidence: { type: 'number' },
    trim: { type: 'string' }, trim_confidence: { type: 'number' },
    colour: { type: 'string', enum: COLOURS }, colour_confidence: { type: 'number' },
    body_type: { type: 'string', enum: BODY_TYPES }, body_type_confidence: { type: 'number' },
    year: { type: 'string' }, year_confidence: { type: 'number' },
    plate_visible: { type: 'boolean' },
    plate_first_digits: { type: 'string' }, plate_last_digits: { type: 'string' }, plate_confidence: { type: 'number' },
    // Update 3.2
    generation: { type: 'string' }, generation_confidence: { type: 'number' },
    make_model_evidence: { type: 'string', enum: EVIDENCE },
    colour_secondary: { type: 'string', enum: COLOURS },
    vehicle_box: BOX, paint_box: BOX
  }
};

var SYSTEM = [
  'You describe what is visible in one photograph of a road vehicle, for a workshop that will check every value before saving it.',
  'A wrong value is worse than no value: the person may trust it. When you are not confident, answer "unknown" and give a low confidence. Each confidence is your own estimate, between 0 and 1, that the value is right.',
  'view: "front" when the photograph shows the front of the vehicle, "rear" when it shows the back, "unknown" otherwise.',
  'make: the manufacturer as written on its cars (for example "Chevrolet"), named from the badge, the grille, the lamps, the body shape. model: the model name (for example "Aveo"). trim: the version only when lettering on the car shows it (for example "LS"); otherwise "unknown".',
  'colour: one of the listed French words (argent = metallic silver, gris = grey). body_type: one of the listed French words — berline: a saloon with a separate boot (three volumes); citadine: a small or compact hatchback (two volumes); break: an estate; suv; monospace: an MPV; coupe; cabriolet; pick-up; utilitaire: a van.',
  'generation: the generation or series of the model ONLY when it can be told apart from the neighbouring generations by what is visible (lamps, grille, bumpers, body panels) — for example "Clio IV" vs "Clio V", "Picanto (2017–)" vs "Picanto (2011–2017)"; otherwise "unknown". Name it the way the manufacturer or common usage does.',
  'Similar-looking vehicles (twins, rebadged models, facelifts, sedan and hatchback versions of one model) are easy to confuse: name a model only when a badge, lettering or a design detail specific to it is visible; if two models remain possible, answer "unknown" for the model. make_model_evidence: "badge_or_lettering" when a badge or name on the car is readable, "distinctive_design" when design details specific to the model are visible, "general_shape" when only the overall shape suggests it, "none" when not identified.',
  'colour: the main PAINT colour of the bodywork — judge it on the painted panels only (doors, bonnet, wings, boot lid), never on windows, tyres, wheels, chrome, lamps, the road, the sky, shadows or reflections. If light, reflections or night make the paint colour uncertain, answer "unknown". colour_secondary: a second paint colour only when the car is clearly two-tone (for example a contrasting roof); otherwise "unknown".',
  'vehicle_box: the main vehicle as [x, y, width, height], fractions (0 to 1) of the image width and height. paint_box: a small area of that vehicle showing ONLY its paint — a door, a wing or the bonnet — without glass, tyres, badges, stickers, strong reflections or shadows, as [x, y, width, height]. Use [] for either when there is no vehicle or no clean paint area.',
  'year: a four-digit model year ONLY when the photograph gives direct evidence of it; a generation or a guess is not evidence — then "unknown".',
  'Registration plate: Tunisian plates are white characters on black, digits · the Arabic word تونس · digits. If such a plate is clearly readable, set plate_visible to true, plate_first_digits to the digits before the word (1 to 3) and plate_last_digits to the digits after it (1 to 4). If no plate is visible, or you cannot read every digit, set plate_visible to false and both to "". Many front photographs show no plate: that is normal.',
  'Identify the make and model from the vehicle itself. Never infer them, or anything else, from the registration number. Do not describe people or the surroundings.',
  'If the photograph does not show a vehicle, set vehicle_visible to false and every value to "unknown".'
].join('\n');

function config(env) {
  env = env || process.env;
  var provider = String(env.IDAUTO_VISION_PROVIDER || '').trim().toLowerCase();
  var key = env.IDAUTO_VISION_API_KEY || env.ANTHROPIC_API_KEY || '';
  return { provider: provider, enabled: provider === 'anthropic' && !!key, hasKey: !!key, model: env.IDAUTO_VISION_MODEL || DEFAULT_MODEL, effort: ['low', 'medium', 'high'].indexOf(env.IDAUTO_VISION_EFFORT) !== -1 ? env.IDAUTO_VISION_EFFORT : 'low', secret: key };   // the key itself: server memory only, never logged, never sent to the browser
}

function unknownField() { return { value: null, confidence: 0, source: 'vision', status: 'unknown' }; }
function emptyFields() { return { make: unknownField(), model: unknownField(), generation: unknownField(), trim: unknownField(), colour: unknownField(), colour_secondary: unknownField(), body_type: unknownField(), year: unknownField() }; }
// recognised (≥ SURE_CONFIDENCE) · uncertain (≥ MIN_CONFIDENCE) · unknown
function statusOf(value, confidence) { return !value ? 'unknown' : confidence >= SURE_CONFIDENCE ? 'recognised' : 'uncertain'; }
// a box the model drew: four finite fractions inside the image, of a sensible size — otherwise none
function box(v) {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(function (n) { return typeof n === 'number' && isFinite(n); })) return null;
  var x = v[0], y = v[1], w = v[2], h = v[3];
  if (x < 0 || y < 0 || w <= 0.01 || h <= 0.01 || x + w > 1.001 || y + h > 1.001) return null;
  return [x, y, w, h].map(function (n) { return Math.round(n * 1000) / 1000; });
}
function emptyResult(extra) {
  return Object.assign({ enabled: false, vehicle_visible: null, view: 'unknown', plate: null, fields: emptyFields() }, extra || {});
}

function clamp01(n) { n = Number(n); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function cleanText(v, max) {
  var s = String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /^(unknown|inconnu|n\/a|none|null)$/i.test(s)) return null;
  return s.slice(0, max);
}

// Turns the model's answer into fields. Anything unexpected becomes "unknown": a value is kept only
// when it is well formed AND its confidence reaches MIN_CONFIDENCE. Every value is marked source: 'vision'
// — what the model names from the image, to be confirmed by the person, never a fact from a register.
function normalise(raw) {
  var out = { vehicle_visible: !!(raw && raw.vehicle_visible), view: raw && VIEWS.indexOf(raw.view) !== -1 ? raw.view : 'unknown', plate: null, fields: {} };
  function field(name, max, allowed, test, confKey) {
    var value = cleanText(raw && raw[name], max), confidence = clamp01(raw && raw[confKey || name + '_confidence']);
    if (allowed && value && allowed.indexOf(value.toLowerCase()) === -1) value = null;
    if (allowed && value) value = value.toLowerCase();
    if (test && value && !test(value)) value = null;
    if (!out.vehicle_visible || !value || confidence < MIN_CONFIDENCE) return { value: null, confidence: value ? Math.round(confidence * 100) / 100 : 0, source: 'vision', status: 'unknown' };
    var c = Math.round(confidence * 100) / 100;
    return { value: value, confidence: c, source: 'vision', status: statusOf(value, c) };
  }
  out.fields.make = field('make', 80);
  out.fields.model = field('model', 80);
  out.fields.generation = field('generation', 40);
  out.fields.trim = field('trim', 40);
  out.fields.colour = field('colour', 40, COLOURS);
  out.fields.colour_secondary = field('colour_secondary', 40, COLOURS, function (v) { return v !== 'unknown'; }, 'colour_confidence');
  if (out.fields.colour_secondary.value && out.fields.colour_secondary.value === out.fields.colour.value) out.fields.colour_secondary = unknownField();
  out.fields.body_type = field('body_type', 40, BODY_TYPES);
  out.fields.year = field('year', 4, null, function (v) { return /^(19[5-9]\d|20\d\d)$/.test(v) && Number(v) <= new Date().getFullYear() + 1; });
  // A model without its make is not offered, nor a trim without its model: alone they mean nothing.
  if (!out.fields.make.value) out.fields.model = { value: null, confidence: out.fields.model.confidence, source: 'vision', status: 'unknown' };
  if (!out.fields.model.value) { out.fields.trim = { value: null, confidence: out.fields.trim.confidence, source: 'vision', status: 'unknown' }; out.fields.generation = { value: null, confidence: out.fields.generation.confidence, source: 'vision', status: 'unknown' }; }
  // A make or model named from the general shape alone is never "recognised": it is shown as uncertain.
  var ev = raw && EVIDENCE.indexOf(raw.make_model_evidence) !== -1 ? raw.make_model_evidence : 'none';
  out.evidence = out.fields.make.value ? ev : 'none';
  if (ev === 'general_shape' || ev === 'none') ['make', 'model', 'generation'].forEach(function (k) { if (out.fields[k].status === 'recognised') out.fields[k].status = 'uncertain'; });
  out.vehicle_box = out.vehicle_visible ? box(raw && raw.vehicle_box) : null;
  out.paint_box = out.vehicle_visible ? box(raw && raw.paint_box) : null;
  if (!out.vehicle_visible) out.view = 'unknown';
  // The registration number as the model read it: kept only when it has the shape of a Tunisian number and the model is confident.
  var first = String(raw && raw.plate_first_digits || '').replace(/\s/g, ''), last = String(raw && raw.plate_last_digits || '').replace(/\s/g, ''), pc = clamp01(raw && raw.plate_confidence);
  if (out.vehicle_visible && raw && raw.plate_visible === true && /^\d{1,3}$/.test(first) && /^\d{1,4}$/.test(last) && pc >= MIN_CONFIDENCE) {
    out.plate = { serie: first, numero: last, format: 'TUN_STD', text: first + ' تونس ' + last, confidence: Math.round(pc * 100), source: 'vision' };
  }
  return out;
}

function isJpeg(buf) { return Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff; }

var sdkClient = null;
function defaultClient(cfg) {
  if (!sdkClient) { var Anthropic = require('@anthropic-ai/sdk'); var options = { maxRetries: 1, timeout: 45000 }; options.apiKey = cfg.secret; sdkClient = new (Anthropic.default || Anthropic)(options); }
  return sdkClient;
}

// analyse(jpeg, { env, client }) → { enabled, provider, model, vehicle_visible, fields }
// Never throws for a provider failure: the caller gets { enabled: true, error: '…' } with every field unknown,
// and the form is filled by hand.
async function analyse(jpeg, opts) {
  opts = opts || {};
  var cfg = config(opts.env);
  if (!cfg.enabled && !opts.client) return emptyResult({ enabled: false, reason: cfg.provider && !cfg.hasKey ? 'key_missing' : 'not_configured' });
  if (!isJpeg(jpeg) || jpeg.length > MAX_IMAGE_BYTES) return emptyResult({ enabled: true, provider: 'anthropic', model: cfg.model, error: 'invalid_image' });
  var client = opts.client || defaultClient(cfg), response;
  try {
    response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 2000,                              // four short values; the answer is a few dozen tokens
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                          // a declined request is retried on the fallback model inside the same call
      system: SYSTEM,
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: 'Describe the vehicle in this photograph.' }
      ] }]
    });
  } catch (err) {
    var status = err && typeof err.status === 'number' ? err.status : 0;
    return emptyResult({ enabled: true, provider: 'anthropic', model: cfg.model,
      error: status === 401 || status === 403 ? 'provider_auth' : status === 429 ? 'provider_rate_limited' : status >= 500 ? 'provider_unavailable' : status ? 'provider_refused_request' : 'provider_unreachable' });
  }
  if (!response || response.stop_reason === 'refusal') return emptyResult({ enabled: true, provider: 'anthropic', model: cfg.model, error: 'provider_declined' });
  var text = '';
  (response.content || []).forEach(function (b) { if (b && b.type === 'text') text += b.text; });
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { var m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; } } }
  if (!parsed || typeof parsed !== 'object') return emptyResult({ enabled: true, provider: 'anthropic', model: response.model || cfg.model, error: 'provider_bad_answer' });
  var n = normalise(parsed);
  return { enabled: true, provider: 'anthropic', model: response.model || cfg.model, vehicle_visible: n.vehicle_visible, view: n.view, plate: n.plate, fields: n.fields,
    evidence: n.evidence, vehicle_box: n.vehicle_box, paint_box: n.paint_box, usage: response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : null };
}

module.exports = { SURE_CONFIDENCE: SURE_CONFIDENCE, EVIDENCE: EVIDENCE, statusOf: statusOf, analyse: analyse, config: config, normalise: normalise, isJpeg: isJpeg, SCHEMA: SCHEMA, VIEWS: VIEWS, COLOURS: COLOURS, BODY_TYPES: BODY_TYPES, MIN_CONFIDENCE: MIN_CONFIDENCE, MAX_IMAGE_BYTES: MAX_IMAGE_BYTES, DEFAULT_MODEL: DEFAULT_MODEL };
