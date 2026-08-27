/* IDauto citizen UI — home.js
 * Homepage behavior — V1 PERSONAL: one public flow, no key or token,
 * mirroring the A5-PLATE ruling exactly:
 *
 * ANONYMOUS (public phase): a plate NEVER resolves anything — submitting a
 * plate shows the IVID-only explainer (no request is made; no public
 * plate-lookup path exists server-side either). IVID entry navigates to
 * /passport?ivid=… where the public route is queried.
 *
 * The professional plate-lookup UI was removed by owner decision (V1
 * personal). The authenticated server routes are unchanged and remain
 * inaccessible without credentials. */

(function () {
  "use strict";

  var plateForm = document.querySelector("[data-plate-form]");
  var plateEl = plateForm.querySelector(".ida-plate-input");
  var plateErr = plateForm.querySelector("[data-plate-error]");
  var publicNotice = document.querySelector("[data-plate-public-notice]");
  var live = document.getElementById("ida-live");

  var plateApi = IdaPlate.enhance(plateEl, {
    onChange: function () { plateErr.hidden = true; publicNotice.hidden = true; }
  });

  function say(message) { if (live) live.textContent = message; }

  function showPlateError(message) {
    plateErr.textContent = message;
    plateErr.hidden = false;
  }

  plateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var res = plateApi.validate();
    if (!res.valid) {
      plateApi.setState("invalid");
      showPlateError("Plaque incomplète ou invalide — série (1 à 3 chiffres) puis numéro (1 à 4 chiffres).");
      var firstBad = Object.keys(res.errors)[0];
      var input = plateEl.querySelector(".ida-plate-" + firstBad);
      if (input) input.focus();
      return;
    }
    /* A5-PLATE: public resolution is IVID-only — no request is made.
     *
     * IDA-V1D, 2026-08-27 — the focus used to move to #q-ivid here. Two
     * reasons it is gone, and must not come back:
     *
     * 1. It defeated its own message. plate.js binds refresh() to `blur` on
     *    the plate inputs, and refresh() calls this module's onChange, which
     *    sets publicNotice.hidden = true. Moving the focus away from the
     *    plate field therefore re-hid the notice the line above had just
     *    shown — measured on both gestures, keyboard and click. The visible
     *    result was a button that did nothing except move the cursor into
     *    "IVID du véhicule", which reads as the plate having been sent
     *    there. (Before the [hidden] reset landed, .ida-alert's display rule
     *    overrode the attribute and the notice was permanently visible, so
     *    this race was invisible.)
     *
     * 2. A5-PLATE. A plate must never lead the citizen surface to discover
     *    or pre-fill an IVID. Nothing here ever wrote #q-ivid — the field
     *    stayed empty — but steering the cursor into it is the same claim
     *    made with the caret instead of a value.
     *
     * The notice names the next step; the visitor takes it. */
    publicNotice.hidden = false;
    say("La consultation publique se fait par IVID, pas par plaque.");
  });

  var ividForm = document.querySelector("[data-ivid-form]");
  var ividErr = ividForm.querySelector("[data-ivid-error]");
  ividForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = IdaIvid.normalize(document.getElementById("q-ivid").value);
    if (!IdaIvid.validate(raw).ok) {
      ividErr.textContent = "IVID invalide — format attendu : ivid:1:… (alphabet sans I, L, O, U).";
      ividErr.hidden = false;
      return;
    }
    window.location.href = "/passport?ivid=" + encodeURIComponent(raw);
  });
})();
