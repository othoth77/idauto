/* IDauto citizen UI — passport.js
 * Public passport page: ?ivid=… → GET /public/passport/:ivid (the one
 * unauthenticated route). Client-side format validation runs first so a
 * malformed IVID never even produces a request; the server's own format
 * gate remains the authority. Error states mirror the route's contract:
 * identical 404s (unknown, malformed, or PRIVATE phase), 429 + Retry-After. */

(function () {
  "use strict";

  var form = document.querySelector("[data-ivid-form]");
  var errEl = form.querySelector("[data-ivid-error]");
  var input = document.getElementById("pp-ivid");
  var loading = document.querySelector("[data-passport-loading]");
  var errorBox = document.querySelector("[data-passport-error]");
  var errorTitle = document.querySelector("[data-passport-error-title]");
  var errorDetail = document.querySelector("[data-passport-error-detail]");
  var resultHost = document.querySelector("[data-passport-result]");
  var live = document.getElementById("ida-live");

  function say(message) { if (live) live.textContent = message; }

  function showError(title, detail) {
    loading.hidden = true;
    resultHost.hidden = true;
    errorTitle.textContent = title;
    errorDetail.textContent = detail;
    errorBox.hidden = false;
    say(title);
  }

  async function load(ivid) {
    errorBox.hidden = true;
    resultHost.hidden = true;
    loading.hidden = false;
    try {
      var resp = await fetch("/public/passport/" + encodeURIComponent(ivid));
      if (resp.status === 404) {
        return showError("Passeport introuvable",
          "Aucun véhicule ne correspond à cet IVID, ou la consultation publique n'est pas activée.");
      }
      if (resp.status === 429) {
        var retry = resp.headers.get("Retry-After");
        return showError("Trop de consultations",
          "Réessayez dans " + (retry || "quelques") + " seconde(s).");
      }
      if (!resp.ok) {
        return showError("Consultation impossible", "Le service a répondu " + resp.status + ".");
      }
      var passport = await resp.json();
      loading.hidden = true;
      resultHost.textContent = "";
      resultHost.appendChild(IdaPassportRender.render(passport, ivid));
      resultHost.hidden = false;
      say("Passeport chargé");
    } catch (e) {
      showError("Erreur réseau", "Impossible de joindre le service — réessayez.");
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = IdaIvid.normalize(input.value);
    if (!IdaIvid.validate(raw).ok) {
      errEl.textContent = "IVID invalide — format attendu : ivid:1:… (alphabet sans I, L, O, U).";
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    var target = new URL(window.location.href);
    target.searchParams.set("ivid", raw);
    window.history.replaceState(null, "", target.toString());
    load(raw);
  });

  var fromUrl = new URLSearchParams(window.location.search).get("ivid");
  if (fromUrl) {
    var normalized = IdaIvid.normalize(fromUrl);
    input.value = normalized;
    if (IdaIvid.validate(normalized).ok) load(normalized);
    else {
      errEl.textContent = "L'IVID de l'adresse est invalide.";
      errEl.hidden = false;
    }
  }
})();
