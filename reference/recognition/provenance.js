'use strict';
// IDauto — Update 2 — what is kept about a camera proposal (pure: no database, no network).

function str(v, max) { if (v === null || v === undefined) return null; var s = String(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; }

// Update 2 — provenance of what the camera proposed. The CONFIRMED values are the form's own fields
// (make, model, colour, body_type); this only records, per field, what was proposed, by which engine,
// with what confidence, and whether the person kept it. Rebuilt field by field: nothing from the browser
// is stored as it came, and a proposal is never written into a vehicle column from here.
var REC_FIELDS = ['make', 'model', 'colour', 'body_type'];
var REC_SOURCES = ['vision', 'camera'];
function cleanRecognition(raw, vehicle) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var out = { at: new Date().toISOString(), provider: null, model: null, plate: null, fields: {} }, any = false;
  if (raw.provider === 'anthropic') out.provider = 'anthropic';
  if (typeof raw.model === 'string' && /^[a-z0-9.\-]{1,60}$/i.test(raw.model)) out.model = raw.model;
  if (raw.plate && typeof raw.plate === 'object') {
    var pc = Number(raw.plate.confidence);
    out.plate = { confidence: isFinite(pc) ? Math.max(0, Math.min(100, Math.round(pc))) : null, auto: raw.plate.auto === true };
    any = true;
  }
  REC_FIELDS.forEach(function (f) {
    var r = raw.fields && raw.fields[f];
    if (!r || typeof r !== 'object') return;
    var proposed = str(r.proposed, 80), c = Number(r.confidence);
    if (!proposed || REC_SOURCES.indexOf(r.source) === -1) return;
    var saved = vehicle[f] === null || vehicle[f] === undefined ? '' : String(vehicle[f]);
    out.fields[f] = { proposed: proposed, confidence: isFinite(c) ? Math.round(Math.max(0, Math.min(1, c)) * 100) / 100 : null, source: r.source, kept: saved.toUpperCase() === proposed.toUpperCase() };
    any = true;
  });
  return any ? out : null;
}

module.exports = { cleanRecognition: cleanRecognition, REC_FIELDS: REC_FIELDS };
