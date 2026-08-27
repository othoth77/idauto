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
  var plateBlock = document.querySelector("[data-plate-block]");
  var plateSerie = document.querySelector("[data-plate-serie]");
  var plateNumero = document.querySelector("[data-plate-numero]");
  var plateWord = document.querySelector("[data-plate-word]");
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

  /* IDA-V6, 2026-08-27 — the vehicle's plate, shown beside its IVID.
   *
   * OWNER DECISION: the registration plate is public data, so the passport
   * carries it and the page simply renders what it was served — by plate, by
   * IVID, or straight from a QR, the block appears the same way. The earlier
   * URL-hint-and-confirm dance is gone with the rule that forced it.
   *
   * Rendering only. The plate comes from passport.plates, which the server
   * built from the authoritative idauto_plates row; nothing here reads the
   * query string, so no caller-supplied text can reach this component.
   *
   * The série/numéro split is presentational: PlateDisplay draws
   * SSS تونس NNNN, and the stored plate_number is the catalogue's canonical
   * "SSS TUN NNNN". A plate that does not match that shape is shown whole in
   * the same component rather than guessed at or dropped. */
  function renderPlate(passport) {
    if (!plateBlock) return;
    var plates = (passport && Array.isArray(passport.plates)) ? passport.plates : [];
    if (!plates.length || !plates[0].plate_number) { plateBlock.hidden = true; return; }
    var number = String(plates[0].plate_number).trim();
    var parts = /^(\d{1,3})\s+TUN\s+(\d{1,4})$/.exec(number.toUpperCase().replace(/\s+/g, " "));
    if (parts) {
      plateSerie.textContent = parts[1];
      plateNumero.textContent = parts[2];
      plateWord.hidden = false;
    } else {
      plateSerie.textContent = number;
      plateNumero.textContent = "";
      plateWord.hidden = true;
    }
    plateBlock.hidden = false;
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
      /* Independent of the passport rendering below, deliberately: the plate
       * confirmation answers its own question against its own route, so a
       * hiccup in either one cannot take the other down with it. */
      renderPlate(passport);
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
