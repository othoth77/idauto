'use strict';
// IDauto — Update 2 — vehicle visual recognition (make, model, colour, body type).
//
// What this is: a photo of the whole vehicle is shown to a vision model, which
// names what it SEES. It never receives the registration number, and nothing
// here looks a vehicle up in a database: every value returned is marked
// `source: 'vision'` so it cannot be mistaken for a fact from a register.
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

var SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vehicle_visible', 'make', 'make_confidence', 'model', 'model_confidence', 'colour', 'colour_confidence', 'body_type', 'body_type_confidence'],
  properties: {
    vehicle_visible: { type: 'boolean' },
    make: { type: 'string' }, make_confidence: { type: 'number' },
    model: { type: 'string' }, model_confidence: { type: 'number' },
    colour: { type: 'string', enum: COLOURS }, colour_confidence: { type: 'number' },
    body_type: { type: 'string', enum: BODY_TYPES }, body_type_confidence: { type: 'number' }
  }
};

var SYSTEM = [
  'You identify what is visible in one photograph of a road vehicle, for a workshop that will check your answer before saving it.',
  'Name the make from what the photo shows: the badge, the grille, the lamps, the body shape. Name the model and its trim only when lettering or an unmistakable shape supports it.',
  'A wrong name is worse than no name: the person may trust it. When you are not confident, answer "unknown" and give a low confidence. Confidence is your own estimate between 0 and 1 that the value is right.',
  'Do not read, use or repeat the registration plate, and do not infer anything from it. Do not describe people.',
  'make: the manufacturer as written on its cars (for example "Chevrolet"). model: the model name with its trim when the lettering shows it (for example "Aveo LS").',
  'colour: the paint colour of the body, one of the listed French words. body_type: one of the listed French words.',
  'If the photo does not show a vehicle, set vehicle_visible to false and every value to "unknown".'
].join('\n');

function config(env) {
  env = env || process.env;
  var provider = String(env.IDAUTO_VISION_PROVIDER || '').trim().toLowerCase();
  var key = env.IDAUTO_VISION_API_KEY || env.ANTHROPIC_API_KEY || '';
  return { provider: provider, enabled: provider === 'anthropic' && !!key, hasKey: !!key, model: env.IDAUTO_VISION_MODEL || DEFAULT_MODEL, secret: key };   // the key itself: server memory only, never logged, never sent to the browser
}

function unknownField() { return { value: null, confidence: 0, source: 'vision' }; }
function emptyResult(extra) {
  return Object.assign({ enabled: false, vehicle_visible: null, fields: { make: unknownField(), model: unknownField(), colour: unknownField(), body_type: unknownField() } }, extra || {});
}

function clamp01(n) { n = Number(n); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function cleanText(v, max) {
  var s = String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /^(unknown|inconnu|n\/a|none|null)$/i.test(s)) return null;
  return s.slice(0, max);
}

// Turns the model's answer into the four fields. Anything unexpected becomes "unknown":
// a value is kept only when it is well formed AND its confidence reaches MIN_CONFIDENCE.
function normalise(raw) {
  var out = { vehicle_visible: !!(raw && raw.vehicle_visible), fields: {} };
  function field(name, max, allowed) {
    var value = cleanText(raw && raw[name], max), confidence = clamp01(raw && raw[name + '_confidence']);
    if (allowed && value && allowed.indexOf(value.toLowerCase()) === -1) value = null;
    if (allowed && value) value = value.toLowerCase();
    if (!out.vehicle_visible || !value || confidence < MIN_CONFIDENCE) return { value: null, confidence: value ? Math.round(confidence * 100) / 100 : 0, source: 'vision' };
    return { value: value, confidence: Math.round(confidence * 100) / 100, source: 'vision' };
  }
  out.fields.make = field('make', 80);
  out.fields.model = field('model', 80);
  out.fields.colour = field('colour', 40, COLOURS);
  out.fields.body_type = field('body_type', 40, BODY_TYPES);
  // A model without its make is not offered: the model name alone means nothing.
  if (!out.fields.make.value) out.fields.model = { value: null, confidence: out.fields.model.confidence, source: 'vision' };
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
        { type: 'text', text: 'Identify the vehicle in this photo.' }
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
  return { enabled: true, provider: 'anthropic', model: response.model || cfg.model, vehicle_visible: n.vehicle_visible, fields: n.fields };
}

module.exports = { analyse: analyse, config: config, normalise: normalise, isJpeg: isJpeg, SCHEMA: SCHEMA, COLOURS: COLOURS, BODY_TYPES: BODY_TYPES, MIN_CONFIDENCE: MIN_CONFIDENCE, MAX_IMAGE_BYTES: MAX_IMAGE_BYTES, DEFAULT_MODEL: DEFAULT_MODEL };
