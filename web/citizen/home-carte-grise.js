/* IDauto — Update 5 — homepage: « Ajouter la carte grise » for the vehicle just found (by VIN or by plate).
 * Signed in (workshop / administrator session): the document goes straight into the vehicle's dossier.
 * A visitor: only if the owner opened public deposit (GET /public/carte-grise-config); the deposit then waits for an
 * administrator and never changes the dossier by itself. Otherwise the visitor is asked to sign in.
 * The capture itself is carte-grise-capture.js (scanner / file / paste → one pipeline; no OCR, no extraction).
 */
(function () {
  "use strict";
  var btn = document.querySelector("[data-cgc-home-open]"), note = document.querySelector("[data-cgc-home-note]");
  var ividOut = document.querySelector("[data-result-ivid]"), S = window.IdaRegistrationScanner, C = window.IdaCarteGrise;
  if (!btn || !ividOut || !C) return;
  function t(s) { var T = window.IdaI18n; return T && T.t ? T.t(s) : s; }
  if (S) { S.configure({ scanicUrl: "/assets/scanic.umd.js" }); var host = document.querySelector("[data-cg-root]"); if (host) S.mount(host); }
  var mode = null;
  function detect() {
    if (mode) return Promise.resolve(mode);
    return fetch("/api/workspace/overview", { credentials: "same-origin", headers: { "X-IDauto-Session": "1", Accept: "application/json" } })
      .then(function (r) { if (r.ok) return "session"; return fetch("/public/carte-grise-config", { credentials: "omit" }).then(function (x) { return x.json(); }).then(function (c) { return c && c.public_deposit ? "public" : "signin"; }); })
      .catch(function () { return "signin"; }).then(function (m) { mode = m; return m; });
  }
  btn.addEventListener("click", function () {
    var ivid = (ividOut.textContent || "").trim();
    if (!/^ivid:/.test(ivid)) return;
    detect().then(function (m) {
      if (m === "signin") { note.hidden = false; note.querySelector("[data-cgc-home-note-text]").textContent = t("Connectez-vous pour ajouter une carte grise au dossier de ce véhicule."); return; }
      note.hidden = true; C.open({ ivid: ivid, mode: m });
    });
  });
})();
