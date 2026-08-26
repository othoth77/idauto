/* IDauto Design System — ivid-client.js
 * Browser-side structural validation of an IVID, mirroring
 * reference/ivid.js (format ivid:<version>:<payload>:<check>, Crockford
 * base32 alphabet without I/L/O/U, check = Σ value(payload[i])×(i+1) mod
 * 1024 → two 5-bit symbols). This mirror exists so the citizen UI can
 * reject malformed input before making any network request — the server's
 * own format gate (reference/ivid.js via api.js) remains the authority.
 * tests/ida4-ds-ui-test.js cross-checks this module against the reference
 * implementation on generated and mutated samples. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaIvid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var IVID_RE = /^ivid:([0-9]+):([0-9A-HJKMNP-TV-Z]+):([0-9A-HJKMNP-TV-Z]{2})$/;
  var PAYLOAD_MIN = 16;
  var PAYLOAD_MAX = 30;

  var ALPHABET_INDEX = (function () {
    var m = {};
    for (var i = 0; i < CROCKFORD_ALPHABET.length; i++) m[CROCKFORD_ALPHABET[i]] = i;
    return m;
  })();

  function checkSymbols(payload) {
    var sum = 0;
    for (var i = 0; i < payload.length; i++) {
      var ch = payload[i];
      if (!Object.prototype.hasOwnProperty.call(ALPHABET_INDEX, ch)) return null;
      sum += ALPHABET_INDEX[ch] * (i + 1);
    }
    var v = sum % 1024;
    return CROCKFORD_ALPHABET[Math.floor(v / 32)] + CROCKFORD_ALPHABET[v % 32];
  }

  /* validate(ivid) → { ok: boolean } — structural + check-symbol match. */
  function validate(ivid) {
    if (typeof ivid !== "string" || ivid.length === 0) return { ok: false };
    var m = IVID_RE.exec(ivid.trim());
    if (!m) return { ok: false };
    var payload = m[2];
    if (payload.length < PAYLOAD_MIN || payload.length > PAYLOAD_MAX) return { ok: false };
    return { ok: checkSymbols(payload) === m[3] };
  }

  /* normalize user input: trim, uppercase everything after the prefix */
  function normalize(text) {
    if (typeof text !== "string") return "";
    var t = text.trim();
    if (/^ivid:/i.test(t)) {
      return "ivid:" + t.slice(5).toUpperCase();
    }
    return t;
  }

  return { validate: validate, normalize: normalize, IVID_RE: IVID_RE };
});
