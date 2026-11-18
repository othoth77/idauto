/* IDauto — Update 5.1 — the carte grise under the vehicle identity found by plate or VIN.
 * Its status is read from the DATABASE (GET /public/vehicles/:ivid/carte-grise-status: yes / no and the latest date —
 * no file, no id, no holder data), never guessed from the page:
 *   A. « Carte grise enregistrée » + date → « Consulter la carte grise », « Historique des documents » (signed in);
 *      an administrator may add a NEW VERSION, explicitly. No ordinary « add » that could create a duplicate.
 *   B. « Aucune carte grise enregistrée » → « Ajouter la carte grise » : Scanner · Importer un fichier · Coller.
 * Visitors see the status only; the document itself is never public. After an upload the status refreshes at once.
 */
(function () {
  "use strict";
  var card = document.querySelector("[data-cgc-card]"), result = document.querySelector("[data-plate-result]"), ividOut = document.querySelector("[data-result-ivid]");
  var C = window.IdaCarteGrise;
  if (!card || !result || !ividOut || !C) return;
  function t(s) { var T = window.IdaI18n; return T && T.t ? T.t(s) : s; }
  function el(tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text) n.textContent = text; return n; }
  var $ = function (s) { return card.querySelector(s); };
  var who = null;   // "admin" | "workshop" | "visitor"
  function role() {
    if (who) return Promise.resolve(who);
    var h = { "X-IDauto-Session": "1", Accept: "application/json" };
    return fetch("/api/admin/overview", { credentials: "same-origin", headers: h }).then(function (r) {
      if (r.ok) return "admin";
      return fetch("/api/workspace/overview", { credentials: "same-origin", headers: h }).then(function (x) { return x.ok ? "workshop" : "visitor"; });
    }).catch(function () { return "visitor"; }).then(function (r) { who = r; return r; });
  }
  function dossier(ivid) { return (who === "admin" ? "/admin/vehicle?ref=" : "/atelier/vehicule?ref=") + encodeURIComponent(ivid); }
  function fmt(d) { try { return new Date(d + "T12:00:00").toLocaleDateString(document.documentElement.lang === "ar" ? "ar-TN" : "fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return d; } }
  function methods(ivid, newVersion) {
    return ["camera", "file", "paste"].map(function (m) {
      var b = el("button", { type: "button", class: "ida-btn ida-btn--sm " + (m === "camera" ? "ida-btn--primary" : "ida-btn--secondary"), "data-cgc-method": m }, t(m === "camera" ? "Scanner" : m === "file" ? "Importer un fichier" : "Coller"));
      // the method starts from THIS click: camera, file picker and clipboard all need the user's gesture
      b.addEventListener("click", function () { C.start(m, { ivid: ivid, mode: "session", newVersion: !!newVersion, onDone: function () { refresh(ivid); } }); });
      return b;
    });
  }
  function note(text) { var n = $("[data-cgc-home-note]"); n.hidden = !text; n.querySelector("[data-cgc-home-note-text]").textContent = text || ""; }
  function render(ivid, s, r) {
    var actions = $("[data-cgc-actions]"); while (actions.firstChild) actions.removeChild(actions.firstChild);
    note(null); card.hidden = false; card.setAttribute("data-cgc-exists", s.exists ? "yes" : "no");
    if (s.exists) {
      $("[data-cgc-state]").textContent = t("Carte grise enregistrée") + (s.latest_date ? " — " + t("dernier document du") + " " + fmt(s.latest_date) : "");
      if (r === "visitor") return note(t("Connectez-vous pour consulter la carte grise et son historique."));
      actions.appendChild(el("a", { class: "ida-btn ida-btn--secondary ida-btn--sm", href: dossier(ivid) + "#sec-" + (r === "admin" ? "cg" : "docs"), "data-cgc-view-doc": "" }, t("Consulter la carte grise")));
      actions.appendChild(el("a", { class: "ida-btn ida-btn--ghost ida-btn--sm", href: dossier(ivid) + "#sec-" + (r === "admin" ? "cg" : "docs"), "data-cgc-history": "" }, t("Historique des documents")));
      if (r === "admin") {
        var nv = el("button", { type: "button", class: "ida-btn ida-btn--ghost ida-btn--sm", "data-cgc-new-version": "" }, t("Ajouter une nouvelle version"));
        nv.addEventListener("click", function () { nv.remove(); methods(ivid, true).forEach(function (b) { actions.appendChild(b); }); });
        actions.appendChild(nv);
      }
      return;
    }
    $("[data-cgc-state]").textContent = t("Aucune carte grise enregistrée");
    if (r === "visitor") return note(t("Connectez-vous pour ajouter la carte grise de ce véhicule."));
    actions.appendChild(el("span", { class: "ida-small ida-u-block" }, t("Ajouter la carte grise :")));
    methods(ivid, false).forEach(function (b) { actions.appendChild(b); });
  }
  function refresh(ivid) {
    return Promise.all([fetch("/public/vehicles/" + encodeURIComponent(ivid) + "/carte-grise-status", { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }), role()])
      .then(function (x) { if ((ividOut.textContent || "").trim() === ivid) render(ivid, x[0], x[1]); })
      .catch(function () { if (!card.hidden) card.hidden = true; });
  }
  // the identity card appears (plate or VIN found) → its carte grise status
  var last = null;
  function check() {
    var ivid = (ividOut.textContent || "").trim();
    if (result.hidden || !/^ivid:/.test(ivid)) { if (!card.hidden) card.hidden = true; last = null; return; }   // change only what differs
    if (ivid !== last) { last = ivid; refresh(ivid); }
  }
  // watch ONLY the result's own visibility and the IVID text — never this block, which check() itself changes
  new MutationObserver(check).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(check).observe(ividOut, { childList: true, characterData: true, subtree: true });
  window.IdaHomeCarteGrise = { refresh: refresh, _check: check };
})();
