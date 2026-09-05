'use strict';
// =====================================================
// IDauto — IDA-V12 — plate normaliser
// reference/vehicle/plate-normalizer.js
//
// Pure, offline, no database, no network, no environment. Turns whatever a
// human, a camera or an integration hands us into ONE structured plate:
//
//   {
//     ok: true,
//     country: 'TN',
//     registrationType: 'TU',        // TU (série normale) | RS (régime suspensif) | catalogue code
//     series: '230',
//     number: '8646',
//     normalized: '8646TU230',       // format-tolerant search key: number + type + series
//     canonical: '230 TUN 8646',     // the stored form (idauto_plates.plate_number) — unchanged since IDA-0
//     display: '230 تونس 8646',
//     format_code: 'TUN_STD',
//     confidence: 0.98,
//     requires_confirmation: false,
//     warnings: []
//   }
//
// Accepted inputs for the same plate, all mapping to the object above:
//   "230 TU 8646"  "230TU8646"  "230 تونس 8646"  "230 TUN 8646"  "٢٣٠ تونس ٨٦٤٦"
//   "8646TU230" (the normalized key itself, only when the forward reading is impossible)
//
// WHAT THIS NEVER DOES. It never completes a partial plate and never picks a
// split for an ambiguous digit run. Those come back as { ok:false } with a
// reason the UI turns into a confirm/correct step. A low OCR confidence does
// not change the parse; it sets requires_confirmation so nothing downstream
// records the plate as truth without a human.
//
// Format validity is still decided by the catalogue in
// config/idauto.example.json through reference/plate-validator.js (AD-3):
// this module only canonicalises the SPELLING, the validator decides whether
// the canonical string is a plate at all.
// =====================================================

var plateValidator = require('../plate-validator.js');

var COUNTRY = 'TN';
var DEFAULT_CONFIRM_THRESHOLD = 0.75;   // mirrors the scanner's CONFIDENT = 75

// Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits.
var ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

// Registration-type tokens → the token the catalogue pattern expects, and
// the type reported to callers.
var TYPE_TOKENS = {
  'TUN': { type: 'TU', token: 'TUN', display: 'تونس' },
  'TU':  { type: 'TU', token: 'TUN', display: 'تونس' },
  'تونس': { type: 'TU', token: 'TUN', display: 'تونس' },
  'RS':  { type: 'RS', token: 'RS',  display: 'RS' }
};

function asciiDigits(s) {
  return s.replace(/[٠-٩۰-۹]/g, function (d) { return ARABIC_DIGITS[d] || d; });
}

function clampConfidence(c) {
  if (c === undefined || c === null || c === '') return null;
  var n = Number(c);
  if (!isFinite(n)) return null;
  if (n > 1) n = n / 100;          // OCR engines report 0–100
  if (n < 0) n = 0;
  if (n > 1) n = 1;
  return n;
}

function fail(reason, extra) {
  var out = { ok: false, reason: reason, country: COUNTRY };
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

// Splits the cleaned text into [leftDigits, typeToken, rightDigits].
function tokenize(clean) {
  // Insert spaces between digit runs and letter/Arabic runs so "230TU8646"
  // and "230 TU 8646" tokenize identically.
  var spaced = clean
    .replace(/(\d)([A-Zتونس])/g, '$1 $2')
    .replace(/([A-Zتونس])(\d)/g, '$1 $2')
    .trim();
  return spaced.split(/\s+/).filter(Boolean);
}

/**
 * parsePlate(raw, options) → structured plate or { ok:false, reason }.
 *   options.confidence          OCR confidence, 0–1 or 0–100 (optional)
 *   options.confirmThreshold    below this, requires_confirmation = true (default 0.75)
 *   options.registrationType    hint when the input carries digits only ('TU' | 'RS')
 */
function parsePlate(raw, options) {
  options = options || {};
  if (typeof raw !== 'string') return fail('empty');
  var confidence = clampConfidence(options.confidence);
  var threshold = typeof options.confirmThreshold === 'number' ? options.confirmThreshold : DEFAULT_CONFIRM_THRESHOLD;

  var clean = asciiDigits(raw).toUpperCase().replace(/[‎‏‪-‮]/g, '').replace(/[-_./|]/g, ' ').trim();
  if (!clean) return fail('empty');
  if (clean.length > 40) return fail('invalid_plate');

  var tokens = tokenize(clean);
  var warnings = [];

  // ---- Catalogue formats that are not série/RS (GN, CD, ARN, TT, ZE) ----
  // Delegate wholesale to the validator: their spelling has no aliases.
  if (tokens.length && /^[A-Z]{2,3}$/.test(tokens[0]) && !TYPE_TOKENS[tokens[0]]) {
    var other = plateValidator.matchPlateFormat(clean);
    if (!other) return fail('invalid_plate');
    return finish({
      registrationType: other.format_code.replace(/^TUN_/, ''),
      series: other.groups[0] || '',
      number: other.groups[1] || '',
      canonical: other.plate_normalised,
      display: other.plate_normalised,
      format_code: other.format_code
    }, confidence, threshold, warnings);
  }

  // ---- Série normale / RS: digits TYPE digits ----
  var left = null, type = null, right = null;
  if (tokens.length === 3 && /^\d+$/.test(tokens[0]) && TYPE_TOKENS[tokens[1]] && /^\d+$/.test(tokens[2])) {
    left = tokens[0]; type = TYPE_TOKENS[tokens[1]]; right = tokens[2];
  } else if (tokens.length === 2 && /^\d+$/.test(tokens[0]) && /^\d+$/.test(tokens[1])) {
    // Digits only, e.g. "230 8646" — the type was not read (OCR whitelist is
    // digits-only). Use the hint if given; otherwise ask.
    var hinted = options.registrationType && TYPE_TOKENS[String(options.registrationType).toUpperCase()];
    if (!hinted) return fail('partial', { series: tokens[0], number: tokens[1], missing: 'registrationType' });
    left = tokens[0]; type = hinted; right = tokens[1];
    warnings.push('registration_type_assumed');
  } else if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    // One digit run — the split is a guess, and guessing is refused.
    return fail('ambiguous', { raw_digits: tokens[0] });
  } else {
    return fail('invalid_plate');
  }

  // Forward reading first: series TYPE number. If the catalogue refuses it
  // but the reversed (search-key) reading is valid, take the reversed one.
  var forward = canonicalize(left, type, right);
  var result = forward.match ? forward : null;
  if (!result) {
    var reversed = canonicalize(right, type, left);
    if (reversed.match) { result = reversed; warnings.push('read_as_search_key'); }
  }
  if (!result) {
    return fail('invalid_plate', { series: left, number: right, registrationType: type.type });
  }

  return finish({
    registrationType: type.type,
    series: result.series,
    number: result.number,
    canonical: result.canonical,
    display: result.series + ' ' + type.display + ' ' + result.number,
    format_code: result.match.format_code
  }, confidence, threshold, warnings);
}

function canonicalize(series, type, number) {
  var canonical = series + ' ' + type.token + ' ' + number;
  var match = plateValidator.matchPlateFormat(canonical);
  return { series: series, number: number, canonical: canonical, match: match };
}

function finish(fields, confidence, threshold, warnings) {
  var out = {
    ok: true,
    country: COUNTRY,
    registrationType: fields.registrationType,
    series: fields.series,
    number: fields.number,
    normalized: searchKey(fields.number, fields.registrationType, fields.series),
    canonical: fields.canonical,
    display: fields.display,
    format_code: fields.format_code,
    confidence: confidence,
    requires_confirmation: confidence !== null && confidence < threshold,
    warnings: warnings
  };
  if (confidence !== null && confidence < threshold) out.warnings.push('low_confidence');
  return out;
}

function searchKey(number, type, series) {
  return String(number) + String(type) + String(series);
}

// True when two inputs denote the same plate, whatever their spelling.
function samePlate(a, b) {
  var pa = parsePlate(a), pb = parsePlate(b);
  return !!(pa.ok && pb.ok && pa.canonical === pb.canonical);
}

// The stored form for a plate expressed in any accepted spelling, or null.
function toCanonical(raw, options) {
  var p = parsePlate(raw, options);
  return p.ok ? p.canonical : null;
}

module.exports = {
  COUNTRY: COUNTRY,
  DEFAULT_CONFIRM_THRESHOLD: DEFAULT_CONFIRM_THRESHOLD,
  parsePlate: parsePlate,
  samePlate: samePlate,
  toCanonical: toCanonical,
  asciiDigits: asciiDigits
};
