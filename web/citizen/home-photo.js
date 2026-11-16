/* IDauto — Update 3.1 — the homepage scanner, photograph first.
 *
 * Same analysis as the workshop page (photo-analysis.js: EXIF, location, plate found and read on the
 * whole photograph, colour hint, the vision analysis when configured) — called through the PUBLIC routes:
 *   GET/POST /public/vehicle-analysis, GET /public/geo/tn, GET /public/geo/resolve.
 * Nothing is saved and nothing about a vehicle is read here. The plate, once the person has seen and, if
 * needed, corrected it, goes to the SAME public search as the typed field (home.js applyScannedPlate →
 * /public/plates/:plate, IVID only). Make, model and colour are shown for the person's information only.
 */
(function () {
  "use strict";
  var root = document.querySelector("[data-scan-root]"), openBtn = document.querySelector("[data-scan-open]");
  var A = window.IdaPhotoAnalysis, I = window.IdAutoI18n || { t: function (s) { return s; } }, t = I.t;
  if (!root || !openBtn || !A || !window.IdaPhotoMeta) return;
  function q(sel) { return root.querySelector(sel); }
  var intro = q("[data-scan-intro]"), result = q("[data-hp-result]"), take = q("[data-hp-take]"), pick = q("[data-hp-pick-file]");
  var vision = { enabled: false }, geoData = null, livePosition = null, current = null, seq = 0;
  var COLOUR = { noir: "Noir", blanc: "Blanc", gris: "Gris", argent: "Argent", rouge: "Rouge", bleu: "Bleu", vert: "Vert", jaune: "Jaune", orange: "Orange", marron: "Marron", beige: "Beige" };
  var BODY = { berline: "Berline", citadine: "Citadine", "break": "Break", suv: "SUV", monospace: "Monospace", coupe: "Coupé", cabriolet: "Cabriolet", "pick-up": "Pick-up", utilitaire: "Utilitaire" };
  var SOURCE = { exif: "position enregistrée dans la photo", browser: "position de l'appareil à la prise de vue", manual: "lieu saisi à la main" };
  var FROM = { ocr: "lu sur la photo", vision: "analyse d'image", camera: "estimation de la caméra" };

  function el(tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); }); if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function getJson(url) { return fetch(url, { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }
  function post(url, blob) {
    return fetch(url, { method: "POST", credentials: "omit", headers: { "Content-Type": "image/jpeg" }, body: blob }).then(function (r) {
      if (r.status === 429) { var e = new Error("rate"); e.rate = true; throw e; }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function view() { var v = root.querySelector('input[name="hp-view"]:checked'); return v ? v.value : "unknown"; }
  function dateText(iso) { try { return new Date(iso).toLocaleDateString(document.documentElement.lang === "ar" ? "ar-TN" : "fr-FR", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } }

  function placeText(l) {
    if (!l) return t("Lieu inconnu");
    var r = l.resolved || {}, parts = [l.place_name || r.place_name, l.governorate || r.governorate, l.country || r.country].filter(Boolean);
    var s = parts.length ? parts.join(", ") : (r.outside ? t("hors de Tunisie") : (l.latitude !== null && l.latitude !== undefined ? l.latitude.toFixed(4) + ", " + l.longitude.toFixed(4) : t("Lieu inconnu")));
    if (l.source !== "manual" && !l.place_name && (r.place_name || r.governorate)) s += " " + t("(approximatif)");
    return s;
  }
  function renderPlace() {
    var line = q("[data-hp-place-line]"); clear(line);
    var l = current && current.location;
    line.appendChild(el("strong", null, t("Lieu de la photo : ")));
    line.appendChild(el("span", { "data-hp-place-text": "" }, placeText(l)));
    if (l) line.appendChild(el("span", { class: "ida-muted" }, " — " + t(SOURCE[l.source])));
    line.appendChild(document.createTextNode(" · " + (current && current.capturedAt ? dateText(current.capturedAt) : t("date inconnue")) + " "));
    var b = el("button", { type: "button", class: "ida-btn ida-btn--ghost ida-btn--sm", "data-hp-loc": "" }, l ? t("Corriger le lieu") : t("Indiquer le lieu"));
    b.addEventListener("click", function () { var e = q("[data-hp-loc-edit]"); e.hidden = !e.hidden; });
    line.appendChild(b);
  }
  function field(label, v, fmt) {
    var dl = q("[data-hp-fields]");
    dl.appendChild(el("dt", null, t(label)));
    var dd = el("dd", { "data-hp-field": label });
    if (v && v.value) { dd.appendChild(el("span", { dir: "auto" }, fmt ? t(fmt[v.value] || v.value) : v.value)); dd.appendChild(el("span", { class: "ida-recog-conf" }, " " + t(FROM[v.source] || "") + " · " + Math.round((v.confidence || 0) * 100) + " %")); }
    else dd.textContent = vision.enabled ? t("Non reconnu") : t("Non disponible");
    dl.appendChild(dd);
  }

  function showResult() {
    intro.hidden = true; result.hidden = false;
    ["live", "busy", "confirm", "error"].forEach(function (n) { var x = q("[data-scan-" + n + "]"); if (x) x.hidden = true; });
    var ph = q("[data-hp-photo]"); clear(ph);
    if (current && current.url) ph.appendChild(el("img", { src: current.url, alt: t("Photo du véhicule"), class: "ida-recog-img" }));
  }

  function render(r) {
    var a = r.analysis, p = a.plate;
    q("[data-hp-busy]").textContent = "";
    q("[data-hp-serie]").value = p ? p.serie : ""; q("[data-hp-numero]").value = p ? p.numero : "";
    var note = q("[data-hp-plate-note]");
    note.textContent = p
      ? (p.accepted ? t("Plaque lue sur la photo") : t("Lecture à vérifier")) + " · " + p.confidence + " %" + (r.plateDisagree ? " — " + t("l'analyse d'image lit : ") + r.plateDisagree : "")
      : (r.plateSeen ? t("Plaque repérée mais non lue : saisissez-la.") : (view() === "front" ? t("Aucune plaque lisible sur cette vue avant : saisissez-la si vous la connaissez.") : t("Aucune plaque lisible sur cette photo : saisissez-la, ou reprenez une photo plus proche.")));
    note.className = p && p.accepted ? "ida-caption" : "ida-caption ida-field-error";
    var dl = q("[data-hp-fields]"); clear(dl);
    field("Marque", a.fields.make); field("Modèle", a.fields.model && a.fields.trim && a.fields.trim.value ? { value: a.fields.model.value + " " + a.fields.trim.value, source: a.fields.model.source, confidence: a.fields.model.confidence } : a.fields.model);
    field("Couleur", a.fields.colour, COLOUR); field("Carrosserie", a.fields.body_type, BODY);
    renderPlace();
    q("[data-hp-note]").textContent = !vision.enabled
      ? t("La reconnaissance de la marque et du modèle n'est pas disponible sur ce service : seuls la plaque et une estimation de la couleur sont proposés.")
      : r.visionError ? t("L'analyse d'image n'a pas abouti : seuls la plaque et une estimation de la couleur sont proposés.")
      : t("Marque, modèle et carrosserie sont proposés à partir de l'image, pas d'un registre : ce sont des indications.");
    (p && !p.accepted ? q("[data-hp-serie]") : q("[data-hp-search]")).focus();
  }

  async function handle(file, taken) {
    if (!file) return;
    var my = ++seq;
    current = null; showResult();
    q("[data-hp-busy]").textContent = t("Lecture de la photo…");
    clear(q("[data-hp-fields]")); q("[data-hp-plate-note]").textContent = ""; q("[data-hp-note]").textContent = ""; clear(q("[data-hp-place-line]")); q("[data-hp-loc-edit]").hidden = true;
    try { current = await A.prepare(file, taken, livePosition); }
    catch (e) { q("[data-hp-busy]").textContent = t("Cette image ne peut pas être lue : choisissez une autre photo."); return; }
    if (my !== seq) return;
    showResult(); renderPlace();
    if (current.location && current.location.source !== "manual") {
      getJson("/public/geo/resolve?lat=" + encodeURIComponent(current.location.latitude) + "&lon=" + encodeURIComponent(current.location.longitude))
        .then(function (o) { if (my === seq && current && current.location) { current.location.resolved = o.resolved; renderPlace(); } }).catch(function () {});
    }
    q("[data-hp-busy]").textContent = t("Analyse en cours…");
    var r;
    try { r = await A.analyse(current, { visionEnabled: vision.enabled, visionUrl: "/public/vehicle-analysis", post: post }); }
    catch (e) { r = { analysis: { plate: null, fields: {} }, plateSeen: false, visionError: e && e.rate ? "rate" : "unreachable" }; }
    if (my !== seq) return;
    current.result = r;
    render(r);
  }

  // ---- wiring ----
  var takeLabel = q("[data-hp-take-label]");
  takeLabel.addEventListener("click", function () { livePosition = A.askPosition(); });     // asked at the moment a photograph is requested, never before
  take.addEventListener("change", function () { var f = take.files && take.files[0]; take.value = ""; handle(f, true); });
  pick.addEventListener("change", function () { var f = pick.files && pick.files[0]; pick.value = ""; handle(f, false); });
  q("[data-hp-again]").addEventListener("click", function () { seq++; current = null; result.hidden = true; intro.hidden = false; });
  openBtn.addEventListener("click", function () { seq++; current = null; result.hidden = true; });
  q("[data-hp-search]").addEventListener("click", function () {
    var s = (q("[data-hp-serie]").value || "").replace(/\D/g, ""), n = (q("[data-hp-numero]").value || "").replace(/\D/g, "");
    var note = q("[data-hp-plate-note]");
    if (!/^\d{1,3}$/.test(s) || !/^\d{1,4}$/.test(n)) { note.textContent = t("Série : 1 à 3 chiffres. Numéro : 1 à 4 chiffres."); note.className = "ida-caption ida-field-error"; q("[data-hp-serie]").focus(); return; }
    var p = current && current.result && current.result.analysis.plate, auto = !!(p && p.accepted && p.serie === s && p.numero === n);
    if (window.IdaPlateScanner) window.IdaPlateScanner.close();
    if (window.IdaHome) window.IdaHome.applyScannedPlate({ serie: s, numero: n, confidence: p ? p.confidence : 0, auto: auto });
  });
  // manual location
  var gov = q("[data-hp-gov]"), placeIn = q("[data-hp-place]"), dl = root.querySelector("#hp-places");
  gov.addEventListener("change", function () { clear(dl); var g = (geoData ? geoData.governorates : []).filter(function (x) { return x.name === gov.value; })[0]; (g ? g.delegations : []).forEach(function (d) { dl.appendChild(el("option", { value: d })); }); });
  q("[data-hp-loc-ok]").addEventListener("click", function () {
    if (!current || (!gov.value && !placeIn.value.trim())) return;
    // a GPS position keeps its coordinates and source; only its name is corrected. Without coordinates: manual.
    if (current.location && current.location.source !== "manual") { current.location.place_name = placeIn.value.trim() || null; current.location.governorate = gov.value || null; current.location.country = gov.value ? "Tunisie" : current.location.country || null; }
    else current.location = { source: "manual", latitude: null, longitude: null, place_name: placeIn.value.trim() || null, governorate: gov.value || null, country: gov.value ? "Tunisie" : null };
    q("[data-hp-loc-edit]").hidden = true; renderPlace();
  });

  getJson("/public/vehicle-analysis").then(function (o) {
    vision = { enabled: !!o.enabled };
    if (vision.enabled) q("[data-hp-privacy]").textContent = t("La photo est envoyée au service d'analyse d'IDauto pour proposer la marque et le modèle ; elle n'est pas enregistrée. Pour une photo prise ici, la position de l'appareil vous est demandée afin de situer la photo : vous pouvez refuser.");
  }).catch(function () {});
  getJson("/public/geo/tn").then(function (g) {
    geoData = g;
    g.governorates.forEach(function (x) { var o = el("option", { value: x.name, "data-i18n-skip": "" }, x.name); gov.appendChild(o); });
  }).catch(function () {});

  window.IdaHomePhoto = { _handle: handle, _current: function () { return current; } };
}());
