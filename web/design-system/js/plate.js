/* IDauto Design System — plate.js
 * Plate format registry + PlateInput behavior.
 * Runs in the browser (progressive enhancement) and in Node (validation logic
 * is exported for tests).
 *
 * ARCHITECTURE (AD-3 — "plate formats are configuration, never hardcoded"):
 * the authoritative catalogue is config/idauto.example.json → plate_formats
 * (all entries UNVERIFIED DRAFTS per that file's own note), validated
 * server-side by reference/plate-validator.js. This module is the UI-side
 * mirror of the ONE format the citizen surface renders (TUN_STD); its
 * canonical() output MUST match the TUN_STD pattern, and
 * tests/ida4-ds-ui-test.js asserts that cross-consistency against the real
 * config. Adding a national format = adding a registry entry here that
 * mirrors a catalogue entry — never a rewrite of the component. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPlate = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Tunisian standard série plate (catalogue code TUN_STD): displayed as
   * `SSS تونس NNNN` — série 1-3 digits, numéro 1-4 digits, white glyphs on a
   * black field. No country band, no flag. Canonical machine form is the
   * catalogue's own: `SSS TUN NNNN` (pattern ^(\d{1,3})\s?TUN\s?(\d{1,4})$). */
  var FORMATS = {
    TUN_STD: {
      country: "TN",
      label: "Tunisie — plaque standard (série courante)",
      word: "تونس",
      fields: [
        { key: "serie", label: "Série", maxLength: 3, pattern: /^[0-9]{1,3}$/ },
        { key: "numero", label: "Numéro", maxLength: 4, pattern: /^[0-9]{1,4}$/ }
      ],
      canonical: function (parts) {
        return parts.serie + " TUN " + parts.numero;
      },
      display: function (parts) {
        return parts.serie + " تونس " + parts.numero;
      }
    }
  };

  function getFormat(id) {
    return FORMATS[id] || null;
  }

  /* validate(formatId, parts) → { valid, complete, errors: {field: code} } */
  function validate(formatId, parts) {
    var fmt = getFormat(formatId);
    if (!fmt) return { valid: false, complete: false, errors: { format: "unknown_format" } };
    var errors = {};
    var complete = true;
    fmt.fields.forEach(function (f) {
      var v = (parts && parts[f.key]) ? String(parts[f.key]).trim() : "";
      if (!v) { complete = false; errors[f.key] = "empty"; return; }
      if (!f.pattern.test(v)) errors[f.key] = "invalid";
    });
    var valid = complete && Object.keys(errors).length === 0;
    return { valid: valid, complete: complete, errors: errors };
  }

  /* parse free text like "123 تونس 4567", "123 TUN 4567", "123-4567" */
  function parse(formatId, text) {
    var fmt = getFormat(formatId);
    if (!fmt || typeof text !== "string") return null;
    var m = text.trim().match(/^([0-9]{1,3})\s*(?:تونس|TUN|tun)?[\s-]*([0-9]{1,4})$/);
    if (!m) return null;
    return { serie: m[1], numero: m[2] };
  }

  /* ---- PlateInput enhancement ----
   * Markup contract:
   * <div class="ida-plate-input" data-plate-format="TUN_STD" data-state="empty">
   *   <input class="ida-plate-serie" inputmode="numeric" ...>
   *   <span class="ida-plate-word" aria-hidden="true">تونس</span>
   *   <input class="ida-plate-numero" inputmode="numeric" ...>
   * </div>
   * State machine: empty → typing → valid | invalid; verified/loading/disabled
   * are set by the caller (product code) via setState. */
  function enhance(rootEl, opts) {
    opts = opts || {};
    var formatId = rootEl.getAttribute("data-plate-format") || "TUN_STD";
    var fmt = getFormat(formatId);
    var inputs = {
      serie: rootEl.querySelector(".ida-plate-serie"),
      numero: rootEl.querySelector(".ida-plate-numero")
    };

    function parts() {
      return { serie: inputs.serie.value.trim(), numero: inputs.numero.value.trim() };
    }

    function refresh() {
      var p = parts();
      var res = validate(formatId, p);
      var state;
      if (!p.serie && !p.numero) state = "empty";
      else if (res.valid) state = "valid";
      else if (res.complete) state = "invalid";
      else state = "typing";
      rootEl.setAttribute("data-state", state);
      if (typeof opts.onChange === "function") opts.onChange(state, p, res);
      return res;
    }

    ["serie", "numero"].forEach(function (key) {
      var el = inputs[key];
      if (!el) return;
      el.addEventListener("input", function () {
        var clean = el.value.replace(/[^0-9]/g, "");
        if (clean !== el.value) el.value = clean;
        refresh();
        if (key === "serie" && clean.length === 3 && inputs.numero) inputs.numero.focus();
      });
      el.addEventListener("blur", refresh);
    });

    return {
      format: fmt,
      getParts: parts,
      validate: function () { return validate(formatId, parts()); },
      canonical: function () { return fmt.canonical(parts()); },
      setState: function (state) { rootEl.setAttribute("data-state", state); },
      refresh: refresh
    };
  }

  return { FORMATS: FORMATS, getFormat: getFormat, validate: validate, parse: parse, enhance: enhance };
});
