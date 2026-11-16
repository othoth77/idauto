'use strict';
// IDauto — Update 3 — what is kept of a photograph's metadata (pure: no database, no network).
// Everything the browser sends about a photograph passes through here and is REBUILT, field by field.

var geo = require('./tn-geo.js');

var VIEWS = ['front', 'rear', 'unknown'];
var FIELDS = ['make', 'model', 'trim', 'colour', 'body_type', 'year'];
// Where a value comes from. Kept with every value so the three are never confused:
//   ocr     read on the image by the on-device reader (the registration digits)
//   vision  named by the vision model from what the photograph shows
//   camera  a simple estimate computed on the device (the colour hint)
//   manual  typed or confirmed by the person
var SOURCES = ['ocr', 'vision', 'camera', 'manual'];

function str(v, max) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
function num(v) { var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return isFinite(n) ? n : null; }
function conf01(v) { var n = num(v); return n === null ? null : Math.round(Math.max(0, Math.min(1, n)) * 100) / 100; }

// A capture date is kept when it is a real date, not in the future, not before 2000.
function capturedAt(v) {
  if (!v) return null;
  var d = new Date(v);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 86400000 || d.getUTCFullYear() < 2000) return null;
  return d.toISOString();
}

// location → { source, latitude, longitude, place_name, governorate, country } or null (unknown).
//   exif | browser : coordinates are REQUIRED and must be real; the names are optional corrections.
//   manual         : NO coordinates are kept, whatever was sent; a place or a governorate is required.
function location(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var place = str(raw.place_name, 120), gov = raw.governorate ? (geo.governorateOf(raw.governorate) || str(raw.governorate, 60)) : null, country = str(raw.country, 60);
  if (raw.source === 'exif' || raw.source === 'browser') {
    var lat = num(raw.latitude), lon = num(raw.longitude);
    if (lat === null || lon === null || !geo.validCoords(lat, lon)) return null;
    return { source: raw.source, latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6, place_name: place, governorate: gov, country: country };
  }
  if (raw.source === 'manual') {
    if (!place && !gov) return null;
    return { source: 'manual', latitude: null, longitude: null, place_name: place, governorate: gov, country: country };
  }
  return null;        // an unknown source (an IP address, a guess…) is not a location
}

function analysis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var out = { plate: null, fields: {}, provider: null, model: null, vehicle_visible: null }, any = false;
  if (raw.plate && typeof raw.plate === 'object') {
    var serie = String(raw.plate.serie === undefined || raw.plate.serie === null ? '' : raw.plate.serie).replace(/\D/g, ''), numero = String(raw.plate.numero === undefined || raw.plate.numero === null ? '' : raw.plate.numero).replace(/\D/g, '');
    var c = num(raw.plate.confidence), src = SOURCES.indexOf(raw.plate.source) !== -1 && raw.plate.source !== 'camera' ? raw.plate.source : null;
    if (src && /^\d{1,3}$/.test(serie) && /^\d{1,4}$/.test(numero)) {
      out.plate = { serie: serie, numero: numero, format: 'TUN_STD', text: serie + ' تونس ' + numero, confidence: c === null ? null : Math.round(Math.max(0, Math.min(100, c))), source: src, accepted: raw.plate.accepted === true };
      any = true;
    } else if (raw.plate.detected === false) { out.plate = { detected: false }; any = true; }
  }
  FIELDS.forEach(function (f) {
    var r = raw.fields && raw.fields[f];
    if (!r || typeof r !== 'object') return;
    var value = str(r.value, 80);
    if (!value || SOURCES.indexOf(r.source) === -1 || r.source === 'ocr') return;
    out.fields[f] = { value: value, confidence: conf01(r.confidence), source: r.source };
    any = true;
  });
  if (raw.provider === 'anthropic') out.provider = 'anthropic';
  if (typeof raw.model === 'string' && /^[a-z0-9.\-]{1,60}$/i.test(raw.model)) out.model = raw.model;
  if (raw.vehicle_visible === true || raw.vehicle_visible === false) out.vehicle_visible = raw.vehicle_visible;
  return any ? out : null;
}

function photoMeta(raw) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var a = analysis(raw.analysis);
  return { view: VIEWS.indexOf(raw.view) !== -1 ? raw.view : 'unknown', captured_at: capturedAt(raw.captured_at), location: location(raw.location), analysis: a,
    confidence: a && a.plate && typeof a.plate.confidence === 'number' ? Math.round(a.plate.confidence) / 100 : null, confirmed: raw.confirmed === true };
}

// A correction: only what is present is changed. `location: null` means "the location is unknown".
function photoPatch(raw) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var out = { view: VIEWS.indexOf(raw.view) !== -1 ? raw.view : null, confirmed: raw.confirmed === true ? true : raw.confirmed === false ? false : null, captured_at: undefined, location: undefined };
  if ('captured_at' in raw) out.captured_at = capturedAt(raw.captured_at);
  if ('location' in raw) out.location = raw.location === null ? null : location(raw.location);
  return out;
}

module.exports = { photoMeta: photoMeta, photoPatch: photoPatch, location: location, analysis: analysis, capturedAt: capturedAt, VIEWS: VIEWS, FIELDS: FIELDS, SOURCES: SOURCES };
