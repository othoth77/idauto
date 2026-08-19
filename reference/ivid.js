'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-4-FOUNDATION — IVID issuance/validation library
// reference/ivid.js
//
// Pure, offline, no database/network/filesystem dependency. Issues and
// validates the formal IVID format specified in
// docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md §2.1 and
// protocol/schemas/vehicle.schema.json's `ivid` property:
//
//   IVID = "ivid:" <version> ":" <payload> ":" <check>
//   example: ivid:1:7K2QF9WBN4TXJ0R3:HN
//
// This module does NOT persist, look up, or reserve an IVID anywhere. It
// has no notion of "already issued" — uniqueness in practice comes from
// 80 bits of CSPRNG entropy (collision probability is astronomically
// small at any v1 population size), not from a registry this file would
// need a database to check against. Persisting/registering an issued
// IVID is a caller concern, deliberately out of scope for this stage
// (see docs/IVID_MIGRATION_PLAN.md — PLAN ONLY, NOT EXECUTED).
//
// ---------------------------------------------------------------------
// ALPHABET
// ---------------------------------------------------------------------
// Crockford base32: "0123456789ABCDEFGHJKMNPQRSTVWXYZ" — 32 symbols,
// digits 0-9 then uppercase letters with I, L, O, U excluded (I/L read as
// 1, O reads as 0, U is excluded by Crockford's own spec to reduce the
// chance of forming accidental obscenities). This is EXACTLY the
// character class protocol/schemas/vehicle.schema.json's `ivid` pattern
// uses for the payload and check segments: `[0-9A-HJKMNP-TV-Z]`, which
// expands to the same 32-symbol set --
//   0-9                     -> 10 digits
//   A-H                     -> A,B,C,D,E,F,G,H (skips nothing yet)
//   J,K                     -> (skips I)
//   M,N                     -> (skips L)
//   P-T                     -> P,Q,R,S,T (skips O)
//   V-Z                     -> V,W,X,Y,Z (skips U)
// = 10 + 8 + 2 + 2 + 5 + 5 = 32 symbols, identical membership and order
// to CROCKFORD_ALPHABET below. Verified by a direct string-equality test
// in tests/ida4-foundation-test.js, not merely asserted here.
// ---------------------------------------------------------------------
//
// ---------------------------------------------------------------------
// CHECK-SYMBOL ALGORITHM (v1) — precisely, so it is pinned forever
// ---------------------------------------------------------------------
// Given a payload of n symbols (16 <= n <= 30), each mapped to its
// alphabet index (0-31):
//
//   1. Compute a position-weighted sum, 1-indexed from the left:
//        S = sum_{i=0}^{n-1}  value(payload[i]) * (i + 1)
//   2. Reduce mod 1024 (1024 = 2^10 = exactly two base32 symbols' worth
//      of bits):
//        checkValue = S mod 1024
//   3. Split checkValue into two 5-bit groups and encode each as one
//      alphabet symbol:
//        high = floor(checkValue / 32)   -> alphabet[high]
//        low  = checkValue mod 32        -> alphabet[low]
//   4. checkSymbols = alphabet[high] + alphabet[low]
//
// This is a from-scratch weighted checksum chosen for this v1 issuance,
// not an implementation of any external standard (it resembles, but is
// not, an ISO 7064 or Damm check — deliberately simpler, since the only
// requirement is catching common transcription errors offline).
//
// Error classes it is proven to catch, for any payload of length
// n <= 30 (which is exactly the schema's upper bound — chosen together
// with this proof, not by coincidence):
//
//   - EVERY single-symbol substitution error. Changing position i from
//     value a to a distinct value a' changes S by (i+1)*(a-a'). Since
//     1 <= i+1 <= 30 and 1 <= |a-a'| <= 31, the magnitude of the change
//     is at most 30*31 = 930 < 1024, so the change can be exactly 0
//     mod 1024 only if (i+1)*(a-a') = 0 outright, which requires
//     a = a'. A real substitution (a != a') is therefore always
//     detected.
//   - EVERY adjacent transposition of two DIFFERENT symbols. Swapping
//     positions i and i+1 (values a, b, weights i+1 and i+2) changes S
//     by exactly (a - b) (the position-weight difference is 1). This is
//     nonzero — and so is detected — whenever a != b. (A transposition
//     of two equal symbols is not an error in the first place: the
//     string is unchanged.)
//
// It does NOT claim to catch every possible multi-symbol error or every
// non-adjacent transposition; no 2-symbol check over a 16-30 symbol
// payload can (the pigeonhole bound alone rules that out). Those two
// classes are the ones transcription errors overwhelmingly produce, and
// both are proven above, not merely hoped for.
//
// TEST VECTORS (payload -> check), computed from the algorithm above and
// pinned so it can never silently drift. Reproduced and asserted in
// tests/ida4-foundation-test.js, which also cross-checks each against a
// from-scratch reimplementation of the formula so a copy-paste of one
// buggy implementation into the other cannot silently agree.
//
//   0000000000000000               (16 symbols, all-zero)   -> 00
//   ZZZZZZZZZZZZZZZZ               (16 symbols, all-max)    -> 3R
//   7K2QF9WBN4TXJ0R3               (16 symbols, mixed)       -> 0D
//   0123456789ABCDEFGHJK           (20 symbols)              -> K4
//   10ABCDEFGHJKMNPQRSTVWXYZ012345 (30 symbols, max payload) -> 7D
//
// Note: docs/OPEN_VEHICLE_IDENTITY_PROTOCOL.md §2.1's illustrative
// example "ivid:1:7K2QF9WBN4TXJ0R3:HN" predates this check-symbol
// algorithm and its check segment ("HN") is not this algorithm's output
// for that payload ("0D" per the vector above) — it was always a
// format-shape example, not a computed value, and is not treated as a
// pinned vector.
// ---------------------------------------------------------------------

var crypto = require('crypto');

var CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
var ALPHABET_INDEX = (function () {
  var m = Object.create(null);
  for (var i = 0; i < CROCKFORD_ALPHABET.length; i++) {
    m[CROCKFORD_ALPHABET[i]] = i;
  }
  return m;
})();

var IVID_RE = /^ivid:([0-9]+):([0-9A-HJKMNP-TV-Z]+):([0-9A-HJKMNP-TV-Z]{2})$/;
var PAYLOAD_MIN = 16;
var PAYLOAD_MAX = 30;
var V1_PAYLOAD_SYMBOLS = 16; // 80 bits / 5 bits per symbol
var V1_ENTROPY_BYTES = 10;   // 80 bits

// Encodes a Buffer as Crockford base32, 5 bits per output symbol, most
// significant bit first. Does not pad or trim — for exactly-80-bit
// (10-byte) input this yields exactly 16 symbols with no leftover bits,
// which is why v1 issuance uses a 10-byte buffer specifically.
function base32Encode(buf) {
  var bits = '';
  for (var i = 0; i < buf.length; i++) {
    var byteBits = buf[i].toString(2);
    while (byteBits.length < 8) byteBits = '0' + byteBits;
    bits += byteBits;
  }
  var out = '';
  for (var j = 0; j + 5 <= bits.length; j += 5) {
    var chunk = bits.slice(j, j + 5);
    out += CROCKFORD_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

// Computes the 2-symbol check for a payload string. Throws on an empty
// or non-string payload — callers must not treat a thrown error as "no
// check" and silently proceed.
function checkSymbols(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('ivid.checkSymbols: payload must be a non-empty string');
  }
  var sum = 0;
  for (var i = 0; i < payload.length; i++) {
    var ch = payload[i];
    if (!Object.prototype.hasOwnProperty.call(ALPHABET_INDEX, ch)) {
      throw new Error('ivid.checkSymbols: payload contains a non-alphabet symbol: ' + JSON.stringify(ch));
    }
    sum += ALPHABET_INDEX[ch] * (i + 1);
  }
  var checkValue = sum % 1024;
  var high = Math.floor(checkValue / 32);
  var low = checkValue % 32;
  return CROCKFORD_ALPHABET[high] + CROCKFORD_ALPHABET[low];
}

// Issues a new v1 IVID: 80 bits of CSPRNG entropy (10 bytes ->
// 16-symbol payload) plus its 2-symbol check. See the file header for
// why this module never checks for prior issuance.
function generate() {
  var payload = base32Encode(crypto.randomBytes(V1_ENTROPY_BYTES));
  var check = checkSymbols(payload);
  return 'ivid:1:' + payload + ':' + check;
}

// Parses a well-formed-looking IVID string into { version, payload,
// check }, or returns null. Does NOT validate the check symbols or the
// payload length bound — use validate() for that. Kept intentionally
// permissive on length here (only the alphabet/prefix/colon shape is
// checked) so parse() can be used as the first step of a validator that
// wants to report *which* rule failed, rather than only that parsing
// failed.
function parse(ivid) {
  if (typeof ivid !== 'string') return null;
  var m = IVID_RE.exec(ivid);
  if (!m) return null;
  return { version: m[1], payload: m[2], check: m[3] };
}

// Full validation. Returns { ok: boolean, problems: string[] }.
// problems is always an array (empty when ok), never undefined, so
// callers can iterate it unconditionally.
function validate(ivid) {
  var problems = [];
  if (typeof ivid !== 'string' || ivid.length === 0) {
    return { ok: false, problems: ['ivid must be a non-empty string'] };
  }
  var m = IVID_RE.exec(ivid);
  if (!m) {
    // Distinguish a few common shapes to give an actionable problem
    // list rather than one opaque "malformed" message.
    if (ivid.indexOf('ivid:') !== 0) {
      problems.push('missing "ivid:" prefix');
    }
    if (!/^ivid:[0-9]+:/.test(ivid)) {
      problems.push('version segment missing or not numeric');
    }
    problems.push('does not match the required format ivid:<version>:<payload>:<check>, alphabet [0-9A-HJKMNP-TV-Z] only (no I, L, O, U)');
    return { ok: false, problems: problems };
  }
  var version = m[1], payload = m[2], check = m[3];

  if (payload.length < PAYLOAD_MIN || payload.length > PAYLOAD_MAX) {
    problems.push('payload length ' + payload.length + ' is out of bounds [' + PAYLOAD_MIN + ', ' + PAYLOAD_MAX + ']');
  }
  if (check.length !== 2) {
    problems.push('check segment must be exactly 2 symbols');
  }
  if (version.length === 0 || !/^[0-9]+$/.test(version)) {
    problems.push('version segment must be one or more digits');
  }

  if (problems.length === 0) {
    var expectedCheck;
    try {
      expectedCheck = checkSymbols(payload);
    } catch (e) {
      problems.push('could not compute expected check symbols: ' + e.message);
    }
    if (expectedCheck !== undefined && expectedCheck !== check) {
      problems.push('check symbols do not match payload (expected ' + expectedCheck + ', got ' + check + ')');
    }
  }

  return { ok: problems.length === 0, problems: problems };
}

module.exports = {
  CROCKFORD_ALPHABET: CROCKFORD_ALPHABET,
  PAYLOAD_MIN: PAYLOAD_MIN,
  PAYLOAD_MAX: PAYLOAD_MAX,
  V1_PAYLOAD_SYMBOLS: V1_PAYLOAD_SYMBOLS,
  V1_ENTROPY_BYTES: V1_ENTROPY_BYTES,
  base32Encode: base32Encode,
  checkSymbols: checkSymbols,
  generate: generate,
  parse: parse,
  validate: validate
};
