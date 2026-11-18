/* IDauto — Update 6 — homepage: « Ajouter la carte grise », next to « Rechercher le véhicule ». ALWAYS available.
 * The carte grise is an independent entry point: the vehicle does not have to exist in IDauto, and no search is needed.
 *   · a vehicle was just found (plate or VIN): the document goes to that vehicle's dossier (Update 5, unchanged);
 *   · otherwise (no search, empty / unknown VIN, no result): the document is received on its own (intake), LENS
 *     extracts its technical fields on Haddad, and an administrator attaches it to the vehicle or creates the vehicle.
 * Signed in (workshop / administrator): sent directly. A visitor: only if the owner opened public deposit
 * (GET /public/carte-grise-config); otherwise the visitor is asked to sign in.
 * The capture itself is carte-grise-capture.js (scanner / file / paste → preview → explicit « Enregistrer »).
 */
(function () {
  "use strict";
  var btn = document.querySelector("[data-cgc-home-open]"), note = document.querySelector("[data-cgc-home-note]");
  var ividOut = document.querySelector("[data-result-ivid]"), S = window.IdaRegistrationScanner, C = window.IdaCarteGrise;
  var result = document.querySelector("[data-plate-result]");
  if (!btn || !C) return;
  function t(s) { var T = window.IdaI18n; return T && T.t ? T.t(s) : s; }
  if (S) { S.configure({ scanicUrl: "/assets/scanic.umd.js" }); var host = document.querySelector("[data-cg-root]"); if (host) S.mount(host); }
  btn.disabled = false;   // never disabled by the search state
  var mode = null;
  function detect() {
    if (mode) return Promise.resolve(mode);
    return fetch("/api/workspace/overview", { credentials: "same-origin", headers: { "X-IDauto-Session": "1", Accept: "application/json" } })
      .then(function (r) { if (r.ok) return "session"; return fetch("/public/carte-grise-config", { credentials: "omit" }).then(function (x) { return x.json(); }).then(function (c) { return c && c.public_deposit ? "public" : "signin"; }); })
      .catch(function () { return "signin"; }).then(function (m) { mode = m; return m; });
  }
  // the vehicle of the CURRENT successful search, if there is one — optional
  function found() { if (!ividOut || !result) return null; var ivid = (ividOut.textContent || "").trim(); return !result.hidden && /^ivid:/.test(ivid) ? ivid : null; }
  btn.addEventListener("click", function () {
    var ivid = found();
    detect().then(function (m) {
      if (m === "signin") { note.hidden = false; note.querySelector("[data-cgc-home-note-text]").textContent = t("Connectez-vous pour ajouter une carte grise."); return; }
      note.hidden = true; C.open({ ivid: ivid, mode: m });
    });
  });
})();
