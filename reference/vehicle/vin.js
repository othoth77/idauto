'use strict';
// =====================================================
// IDauto — IDA-V12 — VIN validation (ISO 3779)
// reference/vehicle/vin.js — pure, offline.
//
// A VIN is 17 characters from [A-HJ-NPR-Z0-9] (no I, O, Q). The 9th-position
// check digit is mandatory in North America only; elsewhere it is often a
// plain character. So the check digit is REPORTED (check_digit_valid:
// true | false | null), never used to reject — rejecting a valid European VIN
// because it does not follow a North-American rule would send a mechanic to
// the manual path for nothing.
// =====================================================

var TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function normalize(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[\s\-_.]/g, '');
}

function checkDigit(vin) {
  var sum = 0;
  for (var i = 0; i < 17; i++) {
    var c = vin[i];
    var v = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    if (v === undefined) return null;
    sum += v * WEIGHTS[i];
  }
  var r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

function validate(raw) {
  var vin = normalize(raw);
  if (!vin) return { ok: false, reason: 'empty' };
  if (vin.length !== 17) return { ok: false, reason: 'length', vin: vin };
  if (/[IOQ]/.test(vin)) return { ok: false, reason: 'forbidden_letter', vin: vin };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, reason: 'charset', vin: vin };
  var expected = checkDigit(vin);
  return {
    ok: true,
    vin: vin,
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 9),
    vis: vin.slice(9),
    model_year_code: vin[9],
    check_digit_valid: expected === null ? null : expected === vin[8]
  };
}

module.exports = { normalize: normalize, validate: validate, checkDigit: checkDigit };
