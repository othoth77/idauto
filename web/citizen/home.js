/* IDauto citizen UI — home.js
 * Homepage behavior. Two flows, mirroring the A5-PLATE ruling exactly:
 *
 * ANONYMOUS (public phase): a plate NEVER resolves anything — submitting a
 * plate shows the IVID-only explainer (no request is made; no public
 * plate-lookup path exists server-side either). IVID entry navigates to
 * /passport?ivid=… where the public route is queried.
 *
 * PROFESSIONAL (private): with a bearer token (page memory only, never
 * stored — same discipline as reference/admin-ui.js), the plate resolves
 * through the EXISTING authenticated routes: GET /api/plates/:plate_number
 * → vehicle_ivid → GET /api/passport/:ivid. No new lookup path. */

(function () {
  "use strict";

  var plateForm = document.querySelector("[data-plate-form]");
  var plateEl = plateForm.querySelector(".ida-plate-input");
  var plateErr = plateForm.querySelector("[data-plate-error]");
  var publicNotice = document.querySelector("[data-plate-public-notice]");
  var proToken = document.getElementById("pro-token");
  var proErr = document.querySelector("[data-pro-error]");
  var resultHost = document.querySelector("[data-passport-result]");
  var live = document.getElementById("ida-live");

  var plateApi = IdaPlate.enhance(plateEl, {
    onChange: function () { plateErr.hidden = true; publicNotice.hidden = true; }
  });

  function say(message) { if (live) live.textContent = message; }

  function showPlateError(message) {
    plateErr.textContent = message;
    plateErr.hidden = false;
  }

  async function professionalLookup(token) {
    plateApi.setState("loading");
    try {
      var plateResp = await fetch("/api/plates/" + encodeURIComponent(plateApi.canonical()), {
        headers: { Authorization: "Bearer " + token }
      });
      if (plateResp.status === 401) { plateApi.setState("invalid"); proErr.textContent = "Jeton refusé."; proErr.hidden = false; return; }
      if (plateResp.status === 404) { plateApi.setState("invalid"); showPlateError("Aucun véhicule connu pour cette plaque."); return; }
      if (!plateResp.ok) { plateApi.setState("invalid"); showPlateError("Consultation impossible (" + plateResp.status + ")."); return; }
      var plate = await plateResp.json();
      if (!plate.vehicle_ivid) { plateApi.setState("invalid"); showPlateError("Cette plaque n'est pas reliée à un véhicule identifié."); return; }
      var ppResp = await fetch("/api/passport/" + encodeURIComponent(plate.vehicle_ivid), {
        headers: { Authorization: "Bearer " + token }
      });
      if (!ppResp.ok) { plateApi.setState("invalid"); showPlateError("Passeport inaccessible (" + ppResp.status + ")."); return; }
      var passport = await ppResp.json();
      plateApi.setState("verified");
      resultHost.textContent = "";
      resultHost.appendChild(IdaPassportRender.render(passport, plate.vehicle_ivid));
      resultHost.hidden = false;
      say("Passeport chargé");
      resultHost.scrollIntoView();
    } catch (e) {
      plateApi.setState("invalid");
      showPlateError("Erreur réseau — réessayez.");
    }
  }

  plateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    proErr.hidden = true;
    var res = plateApi.validate();
    if (!res.valid) {
      plateApi.setState("invalid");
      showPlateError("Plaque incomplète ou invalide — série (1 à 3 chiffres) puis numéro (1 à 4 chiffres).");
      var firstBad = Object.keys(res.errors)[0];
      var input = plateEl.querySelector(".ida-plate-" + firstBad);
      if (input) input.focus();
      return;
    }
    var token = proToken && proToken.value.trim();
    if (token) {
      professionalLookup(token);
    } else {
      /* A5-PLATE: public resolution is IVID-only — no request is made. */
      publicNotice.hidden = false;
      say("La consultation publique se fait par IVID, pas par plaque.");
      var ividInput = document.getElementById("q-ivid");
      if (ividInput) ividInput.focus();
    }
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
