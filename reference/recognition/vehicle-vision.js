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
var MAX_IMAGE_BYTES = 1500000;     // the browser sends a 1280 px JPEG, a few hundred KB
var COLOURS = ['noir', 'blanc', 'gris', 'argent', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'marron', 'beige', 'unknown'];
var BODY_TYPES = ['berline', 'citadine', 'break', 'suv', 'monospace', 'coupe', 'cabriolet', 'pick-up', 'utilitaire', 'unknown'];

var VIEWS = ['front', 'rear', 'unknown'];

var SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vehicle_visible', 'view', 'make', 'make_confidence', 'model', 'model_confidence', 'trim', 'trim_confidence', 'colour', 'colour_confidence', 'body_type', 'body_type_confidence',
    'year', 'year_confidence', 'plate_visible', 'plate_first_digits', 'plate_last_digits', 'plate_confidence'],
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
    plate_first_digits: { type: 'string' }, plate_last_digits: { type: 'string' }, plate_confidence: { type: 'number' }
  }
};

var SYSTEM = [
  'You describe what is visible in one photograph of a road vehicle, for a workshop that will check every value before saving it.',
  'A wrong value is worse than no value: the person may trust it. When you are not confident, answer "unknown" and give a low confidence. Each confidence is your own estimate, between 0 and 1, that the value is right.',
  'view: "front" when the photograph shows the front of the vehicle, "rear" when it shows the back, "unknown" otherwise.',
  'make: the manufacturer as written on its cars (for example "Chevrolet"), named from the badge, the grille, the lamps, the body shape. model: the model name (for example "Aveo"). trim: the version only when lettering on the car shows it (for example "LS"); otherwise "unknown".',
  'colour: the paint colour of the body, one of the listed French words. body_type: one of the listed French words.',
  'year: a four-digit model year ONLY when the photograph gives direct evidence of it; a generation or a guess is not evidence — then "unknown".',
  'Registration plate: Tunisian plates are white characters on black, digits · the Arabic word تونس · digits. If such a plate is clearly readable, set plate_visible to true, plate_first_digits to the digits before the word (1 to 3) and plate_last_digits to the digits after it (1 to 4). If no plate is visible, or you cannot read every digit, set plate_visible to false and both to "". Many front photographs show no plate: that is normal.',
  'Identify the make and model from the vehicle itself. Never infer them, or anything else, from the registration number. Do not describe people or the surroundings.',
  'If the photograph does not show a vehicle, set vehicle_visible to false and every value to "unknown".'
].join('\n');

function config(env) {
  env = env || process.env;
  var provider = String(env.IDAUTO_VISION_PROVIDER || '').trim().toLowerCase();
  var key = env.IDAUTO_VISION_API_KEY || env.ANTHROPIC_API_KEY || '';
  return { provider: provider, enabled: provider === 'anthropic' && !!key, hasKey: !!key, model: env.IDAUTO_VISION_MODEL || DEFAULT_MODEL, secret: key };   // the key itself: server memory only, never logged, never sent to the browser
}

function unknownField() { return { value: null, confidence: 0, source: 'vision' }; }
function emptyFields() { return { make: unknownField(), model: unknownField(), trim: unknownField(), colour: unknownField(), body_type: unknownField(), year: unknownField() }; }
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
  function field(name, max, allowed, test) {
    var value = cleanText(raw && raw[name], max), confidence = clamp01(raw && raw[name + '_confidence']);
    if (allowed && value && allowed.indexOf(value.toLowerCase()) === -1) value = null;
    if (allowed && value) value = value.toLowerCase();
    if (test && value && !test(value)) value = null;
    if (!out.vehicle_visible || !value || confidence < MIN_CONFIDENCE) return { value: null, confidence: value ? Math.round(confidence * 100) / 100 : 0, source: 'vision' };
    return { value: value, confidence: Math.round(confidence * 100) / 100, source: 'vision' };
  }
  out.fields.make = field('make', 80);
  out.fields.model = field('model', 80);
  out.fields.trim = field('trim', 40);
  out.fields.colour = field('colour', 40, COLOURS);
  out.fields.body_type = field('body_type', 40, BODY_TYPES);
  out.fields.year = field('year', 4, null, function (v) { return /^(19[5-9]\d|20\d\d)$/.test(v) && Number(v) <= new Date().getFullYear() + 1; });
  // A model without its make is not offered, nor a trim without its model: alone they mean nothing.
  if (!out.fields.make.value) out.fields.model = { value: null, confidence: out.fields.model.confidence, source: 'vision' };
  if (!out.fields.model.value) out.fields.trim = { value: null, confidence: out.fields.trim.confidence, source: 'vision' };
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
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
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
  return { enabled: true, provider: 'anthropic', model: response.model || cfg.model, vehicle_visible: n.vehicle_visible, view: n.view, plate: n.plate, fields: n.fields };
}

module.exports = { analyse: analyse, config: config, normalise: normalise, isJpeg: isJpeg, SCHEMA: SCHEMA, VIEWS: VIEWS, COLOURS: COLOURS, BODY_TYPES: BODY_TYPES, MIN_CONFIDENCE: MIN_CONFIDENCE, MAX_IMAGE_BYTES: MAX_IMAGE_BYTES, DEFAULT_MODEL: DEFAULT_MODEL };
