/* IDauto citizen UI — home.js
 *
 * IDA-V2, 2026-08-27 — OWNER DECISION: a plate resolves publicly.
 *
 * This replaces the A5-PLATE rule that a plate must never resolve on the
 * public surface. Both paths are now real, and neither asks for a key:
 *
 *   PLATE  → GET /public/plates/:plate  → IVID
 *          → GET /public/passport/:ivid → public identity → passport
 *   IVID   → GET /public/passport/:ivid → public identity → passport
 *
 * Privacy is unchanged, and is enforced on the server, not here. The plate
 * route returns exactly two fields (plate_number, ivid) and no vehicle
 * attribute; everything shown below comes from the public passport route,
 * which applies the access_scope filter and the reviewed deny-list, so VIN,
 * plate facts, PII and mis-scoped facts never reach this page. This module
 * renders what it is given and never asks for more.
 *
 * No key, no token, no Authorization header — V1 is personal use and the
 * citizen surface asks the visitor for nothing. */

(function () {
  "use strict";

  var plateForm = document.querySelector("[data-plate-form]");
  var plateEl = plateForm.querySelector(".ida-plate-input");
  var plateErr = plateForm.querySelector("[data-plate-error]");
  var message = document.querySelector("[data-plate-message]");
  var messageTitle = document.querySelector("[data-plate-message-title]");
  var messageBody = document.querySelector("[data-plate-message-body]");
  var result = document.querySelector("[data-plate-result]");
  var unknown = document.querySelector("[data-plate-unknown]");
  var unknownPlate = document.querySelector("[data-unknown-plate]");
  var unknownRegister = document.querySelector("[data-unknown-register]");
  var resultSummary = document.querySelector("[data-result-summary]");
  var resultPlate = document.querySelector("[data-result-plate]");
  var resultIvid = document.querySelector("[data-result-ivid]");
  var resultPassport = document.querySelector("[data-result-passport]");
  var submitButton = plateForm.querySelector("button[type=submit]");
  var live = document.getElementById("ida-live");

  var plateApi = IdaPlate.enhance(plateEl, {
    onChange: function () { plateErr.hidden = true; }
  });

  function say(text) { if (live) live.textContent = text; }

  function clearOutcome() {
    message.hidden = true;
    result.hidden = true;
    unknown.hidden = true;
    plateErr.hidden = true;
  }

  function showPlateError(text) {
    plateErr.textContent = text;
    plateErr.hidden = false;
  }

  /* Every user-facing failure goes through here. A raw server error, a
   * status code or a driver message must never reach the page — the visitor
   * gets a sentence they can act on, and nothing about the internals. */
  function showMessage(title, body) {
    messageTitle.textContent = title;
    messageBody.textContent = body;
    message.hidden = false;
    say(title);
  }

  function summarize(vehicle) {
    if (!vehicle || !vehicle.summary) return "Identité publique disponible";
    var s = vehicle.summary;
    var words = [s.make, s.model, s.variant].filter(Boolean).join(" ");
    if (s.year) words = words ? words + " (" + s.year + ")" : String(s.year);
    return words || "Identité publique disponible";
  }

  /* IDA-V3 — the unregistered-vehicle surface. It creates nothing itself:
   * it hands the plate to /admin, the existing audited manual-entry form,
   * which already carries every field this workflow needs (vehicle, plate,
   * observation, fact, document image) and writes through writes.js's
   * withAudit() — so provenance and audit are the ones already in place, and
   * there is no second vehicle store and no second creation path.
   *
   * The IVID is issued by the server on creation. Nothing here can propose,
   * influence or carry one. */
  function showUnknown(canonicalPlate, displayPlate) {
    unknownPlate.textContent = displayPlate;
    unknownRegister.setAttribute("href", "/admin?plate=" + encodeURIComponent(canonicalPlate));
    unknown.hidden = false;
    say("Véhicule non enregistré — la recherche est conservée dans l'historique");
  }

  function showResult(plateNumber, ividValue, passport) {
    resultSummary.textContent = summarize(passport && passport.vehicle);
    resultPlate.textContent = plateNumber;
    resultIvid.textContent = ividValue;
    resultPassport.setAttribute("href", "/passport?ivid=" + encodeURIComponent(ividValue));
    result.hidden = false;
    say("Véhicule trouvé");
  }

  /* Fetches the public passport for an IVID. A failure here is not fatal to
   * the flow: the plate resolved, so the IVID and the passport link are
   * still shown — only the one-line summary is omitted. */
  async function fetchPublicPassport(ividValue) {
    try {
      var response = await fetch("/public/passport/" + encodeURIComponent(ividValue));
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      return null;
    }
  }

  async function resolvePlate(canonicalPlate, displayPlate) {
    plateApi.setState("loading");
    submitButton.disabled = true;
    try {
      var response = await fetch("/public/plates/" + encodeURIComponent(canonicalPlate));

      if (response.status === 404) {
        /* IDA-V3 — not an error. The server has already recorded the search
         * in the audit trail; here the visitor is offered the registration
         * path, with the plate carried through. */
        plateApi.setState("invalid");
        showUnknown(canonicalPlate, displayPlate);
        return;
      }
      if (response.status === 429) {
        plateApi.setState("invalid");
        showMessage("Trop de recherches",
          "Vous avez fait trop de recherches en peu de temps. Patientez une minute avant de réessayer.");
        return;
      }
      if (!response.ok) {
        plateApi.setState("invalid");
        showMessage("Consultation momentanément indisponible",
          "La recherche n'a pas abouti. Réessayez dans un instant.");
        return;
      }

      var body = await response.json();
      if (!body || !body.ivid) {
        plateApi.setState("invalid");
        showMessage("Aucun véhicule pour cette plaque",
          "Cette plaque n'est reliée à aucun véhicule identifié dans IDauto.");
        return;
      }

      plateApi.setState("verified");
      var passport = await fetchPublicPassport(body.ivid);
      showResult(body.plate_number || displayPlate, body.ivid, passport);
    } catch (e) {
      plateApi.setState("invalid");
      showMessage("Connexion interrompue",
        "La recherche n'a pas pu aboutir. Vérifiez votre connexion et réessayez.");
    } finally {
      submitButton.disabled = false;
    }
  }

  plateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearOutcome();
    var res = plateApi.validate();
    if (!res.valid) {
      plateApi.setState("invalid");
      /* Focus FIRST, then show the error. plate.js binds refresh() to `blur`,
       * and refresh() calls onChange below, which clears the error — so
       * showing it before moving the focus would hide it again immediately.
       * Same race that IDA-V1D removed from the resolution path; here the
       * focus move is genuinely wanted (it puts the caret on the bad field),
       * so the order is what changes, not the behaviour. */
      var firstBad = Object.keys(res.errors)[0];
      var input = plateEl.querySelector(".ida-plate-" + firstBad);
      if (input) input.focus();
      showPlateError("Plaque incomplète ou invalide — série (1 à 3 chiffres) puis numéro (1 à 4 chiffres).");
      return;
    }
    /* canonical() is the machine form the API matches on (SSS TUN NNNN);
     * format.display() is the human form with تونس, used only if the server
     * does not echo the stored plate back. */
    resolvePlate(plateApi.canonical(), plateApi.format.display(plateApi.getParts()));
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
    ividErr.hidden = true;
    window.location.href = "/passport?ivid=" + encodeURIComponent(raw);
  });
})();
