/* IDauto — passport: the « Carte grise » section (IDA-V14)
 * ============================================================================
 * Shown to SIGNED-IN users only. The public passport route knows nothing of
 * the document; this script asks the authenticated route with the session
 * cookie + X-IDauto-Session header. A visitor without a session gets 401 and
 * the section simply does not appear. Images are fetched with credentials
 * into blob: URLs (never a server path, never persisted), thumbnails first,
 * the archive only on click; nothing downloads by itself.
 */
(function () {
  "use strict";
  var host = document.querySelector("[data-passport-result]");
  if (!host) return;
  var urls = [];
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  async function api(path) { var r = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json", "X-IDauto-Session": "1" } }); if (!r.ok) throw Object.assign(new Error("status"), { status: r.status }); return r.json(); }
  async function fetchBlob(path) { var r = await fetch(path, { credentials: "same-origin", headers: { "X-IDauto-Session": "1" } }); if (!r.ok) throw new Error("status"); var u = URL.createObjectURL(await r.blob()); urls.push(u); return u; }
  var FR = { plate: "Plaque", registration: "Plaque", manufacturer: "Marque", type: "Type", model: "Modèle", vin: "VIN", year: "Année", fuel: "Énergie", engine_cc: "Cylindrée", seats: "Places", gross_weight_kg: "Poids total", fiscal_power: "Puissance fiscale", genre: "Genre", engine: "Moteur", first_registration_date: "1ère mise en circulation", category_code: "Catégorie" };

  function zoom(path, alt) {
    var overlay = el("div", "ida-cg-full"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-label", alt);
    var img = el("img"); img.alt = alt; overlay.appendChild(img);
    overlay.addEventListener("click", function () { overlay.remove(); });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); } });
    document.body.appendChild(overlay);
    fetchBlob(path).then(function (u) { img.src = u; }).catch(function () { overlay.remove(); });
  }

  async function render(ivid) {
    var base = "/api/vehicles/" + encodeURIComponent(ivid) + "/registration-document";
    var doc;
    try { doc = await api(base); } catch (e) { return; }   // 401/403: not for this visitor; nothing shown
    var section = el("section", "ida-passport-section"); section.setAttribute("data-passport-document", "");
    section.appendChild(el("h2", "ida-label", "Carte grise"));
    if (!doc.has_document) { section.appendChild(el("p", "ida-small ida-muted", "Aucune carte grise enregistrée.")); host.appendChild(section); return; }
    var grid = el("div", "ida-cg-thumbs");
    [1, 2].forEach(function (n) {
      var f = doc.faces[n]; if (!f) return;
      var fig = el("figure", "ida-cg-thumb"); fig.setAttribute("data-passport-face", String(n));
      var img = el("img"); img.alt = "Carte grise — face " + n + (n === 1 ? " (recto)" : " (verso)"); img.loading = "lazy"; img.width = 480; img.height = Math.round(480 * f.height / f.width);
      img.addEventListener("click", function () { zoom(base + "/" + n + "/image", img.alt); });
      fig.appendChild(img);
      fig.appendChild(el("figcaption", "ida-caption", (n === 1 ? "Face 1 — Recto" : "Face 2 — Verso") + " · " + f.width + "×" + f.height + " · " + Math.round(f.byte_size / 1024) + " Ko" + (f.capture && f.capture.detection === "auto" ? " · carte détectée" : "")));
      grid.appendChild(fig);
      fetchBlob(base + "/" + n + "/image" + (f.has_thumbnail ? "?variant=thumb" : "")).then(function (u) { img.src = u; }).catch(function () { img.alt += " (indisponible)"; });
    });
    section.appendChild(grid);
    if (!doc.faces[2]) section.appendChild(el("p", "ida-caption ida-muted", "Face 2 — Verso : non enregistrée (optionnelle)."));
    if (doc.ocr && doc.ocr.fields && doc.ocr.fields.length) {
      section.appendChild(el("h3", "ida-h4", "Informations extraites"));
      var dl = el("dl", "ida-atelier-fiche");
      doc.ocr.fields.forEach(function (f) { var d = el("div"); d.appendChild(el("dt", null, FR[f.key] || f.key)); d.appendChild(el("dd", null, String(f.value))); dl.appendChild(d); });
      section.appendChild(dl);
      section.appendChild(el("p", "ida-caption ida-muted", "Lecture automatique (" + (doc.ocr.status === "confirmed" ? "confirmée" : "à confirmer") + ", confiance " + Math.round((doc.ocr.confidence || 0) * 100) + " %). Les données du titulaire ne sont jamais extraites."));
    }
    host.appendChild(section);
  }

  // The passport script renders the public passport into [data-passport-result]
  // and un-hides it; this observer adds the document section once, per IVID.
  var rendered = null;
  new MutationObserver(function () {
    if (host.hidden || !host.firstChild) return;
    var ivid = new URLSearchParams(location.search).get("ivid");
    if (!ivid || rendered === ivid || host.querySelector("[data-passport-document]")) return;
    rendered = ivid; render(ivid);
  }).observe(host, { attributes: true, childList: true });
  window.addEventListener("pagehide", function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); });
})();
