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
  var plateCaption = document.querySelector("[data-plate-caption]");
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

  /* IDA-V5 — the vehicle's plate, shown beside its IVID.
   *
   * WHERE IT COMES FROM. Not from the passport: the anonymous passport does
   * not carry plate records, and that invariant is untouched here. The plate
   * arrives as a HINT in the query string when the visitor came from a plate
   * search, and is then CONFIRMED against the server — GET /public/plates/:plate
   * must return this exact IVID before anything is drawn. A hint that does not
   * confirm draws nothing.
   *
   * That confirmation is what makes this real vehicle data rather than
   * caller-supplied text: a crafted link carrying someone else's plate
   * resolves to a different IVID, or to nothing, and the block stays hidden.
   * It also opens no new surface — plate → IVID has been public since IDA-V2,
   * so this asks the server a question anyone could already ask.
   *
   * Opened straight from a QR (?ivid= alone) there is no hint to confirm, so
   * no plate block appears. */
  async function showConfirmedPlate(ivid, plateHint) {
    if (!plateHint || !plateBlock) return;
    var parts = /^(\d{1,3})\s+TUN\s+(\d{1,4})$/.exec(String(plateHint).trim().toUpperCase().replace(/\s+/g, " "));
    if (!parts) return;
    try {
      var resp = await fetch("/public/plates/" + encodeURIComponent(parts[1] + " TUN " + parts[2]));
      if (!resp.ok) return;
      var body = await resp.json();
      if (!body || body.ivid !== ivid) return;      /* not this vehicle — draw nothing */
      plateSerie.textContent = parts[1];
      plateNumero.textContent = parts[2];
      plateCaption.textContent = "Plaque confirmée pour cet IVID.";
      plateBlock.hidden = false;
    } catch (e) {
      /* A failed confirmation shows nothing. Silence is the safe outcome:
       * an unconfirmed plate must never be drawn as if it were the car's. */
    }
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
      showConfirmedPlate(ivid, new URLSearchParams(window.location.search).get("plate"));
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
