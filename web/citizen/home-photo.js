/* IDauto — Update 3.1 (final) — « Scanner la plaque »: the camera opens at once.
 *
 *   click → live camera preview (and the location permission is asked) → « Prendre la photo »
 *     → the photograph is SAVED (when this visitor may store: a signed-in workshop, or anonymous visitors if the
 *       owner enabled it on the server) — in parallel with the analysis
 *     → analysis: the one shared pipeline (photo-analysis.js): plate found and read on the whole photo, colour hint,
 *       view / make / model / body type from the vision analysis when configured — nothing invented
 *     → location of THIS photograph: a fresh device position taken at the shutter (if allowed), else the file's EXIF,
 *       else typed by hand, else unknown
 *     → result: the person corrects, then searches, saves the vehicle, or adds the photograph to the existing vehicle.
 * Saving and analysing fail independently, and each says so and can be retried; a photograph is never dropped silently.
 * Public calls carry no cookie; workshop calls carry the session. No front/rear question.
 */
(function () {
  "use strict";
  var root = document.querySelector("[data-scan-root]"), openBtn = document.querySelector("[data-scan-open]");
  var A = window.IdaPhotoAnalysis, I = window.IdAutoI18n || { t: function (s) { return s; } }, t = I.t;
  if (!root || !openBtn || !A || !window.IdaPhotoMeta) return;
  function q(sel) { return root.querySelector(sel); }
  var intro = q("[data-scan-intro]"), result = q("[data-hp-result]"), video = q("[data-hp-video]"), shutter = q("[data-hp-shutter]"), pick = q("[data-hp-pick-file]"), take = q("[data-hp-take]");
  var vision = { enabled: false }, geoData = null, mode = "analysis", stream = null, current = null, seq = 0;
  var COLOUR = { noir: "Noir", blanc: "Blanc", gris: "Gris", argent: "Argent", rouge: "Rouge", bleu: "Bleu", vert: "Vert", jaune: "Jaune", orange: "Orange", marron: "Marron", beige: "Beige" };
  var BODY = { berline: "Berline", citadine: "Citadine", "break": "Break", suv: "SUV", monospace: "Monospace", coupe: "Coupé", cabriolet: "Cabriolet", "pick-up": "Pick-up", utilitaire: "Utilitaire" };
  var VIEW = { front: "avant", rear: "arrière" };
  var SOURCE = { exif: "position enregistrée dans la photo", browser: "position de l'appareil à la prise de vue", manual: "lieu saisi à la main" };
  var FROM = { ocr: "lu sur la photo", vision: "analyse d'image", camera: "estimation de la caméra" };
  var HADDAD = { stored: "copie Haddad enregistrée", pending: "copie Haddad en cours", failed: "copie Haddad en échec — nouvel essai automatique", not_configured: "copie Haddad non configurée" };

  function el(tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); }); if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  // workshop calls carry the session; public calls carry no cookie
  function base() { return mode === "workshop" ? "/api/workspace/scans" : "/public/scans"; }
  function req(method, url, body, headers) {
    var ws = url.indexOf("/api/") === 0;
    return fetch(url, { method: method, credentials: ws ? "same-origin" : "omit", headers: Object.assign(ws ? { "X-IDauto-Session": "1" } : {}, headers || {}), body: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) { var e = new Error(b.message_fr || String(r.status)); e.status = r.status; e.body = b; throw e; } return b; });
    });
  }
  function postImage(url, blob) { return req("POST", url, blob, { "Content-Type": "image/jpeg" }); }
  function b64url(o) { var b = new TextEncoder().encode(JSON.stringify(o)), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function dateText(iso) { try { return new Date(iso).toLocaleString(document.documentElement.lang === "ar" ? "ar-TN" : "fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

  // ---- camera ------------------------------------------------------------------------------------------------
  function stopCamera() { if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; } video.srcObject = null; shutter.disabled = true; }
  async function openCamera() {
    intro.hidden = false; result.hidden = true;
    var st = q("[data-hp-cam-status]");
    st.textContent = t("Ouverture de la caméra…");
    A.askPosition();                         // the location permission is asked as the scanner opens; the position itself is taken again at the shutter
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { q("[data-hp-native]").hidden = false; st.textContent = t("La caméra ne peut pas s'ouvrir dans cette page : utilisez « Ouvrir l'appareil photo » ou « Choisir une image »."); return; }
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
      catch (first) {
        if (first && first.name === "NotAllowedError") throw first;
        // some cameras refuse the size request: the camera as it is, rather than no camera
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      }
      video.srcObject = stream; try { await video.play(); } catch (e) {}
      shutter.disabled = false; st.textContent = t("Cadrez le véhicule en entier, puis prenez la photo.");
    } catch (e) {
      q("[data-hp-native]").hidden = false;
      st.textContent = e && e.name === "NotAllowedError" ? t("Accès à la caméra refusé : utilisez « Ouvrir l'appareil photo » ou « Choisir une image ».") : t("La caméra n'a pas pu s'ouvrir : utilisez « Ouvrir l'appareil photo » ou « Choisir une image ».");
    }
  }
  function frameFile() {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return Promise.resolve(null);
    var c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(video, 0, 0, w, h);
    return new Promise(function (res) { c.toBlob(function (b) { res(b ? new File([b], "photo.jpg", { type: "image/jpeg" }) : null); }, "image/jpeg", 0.92); });
  }

  // ---- saving (in parallel with the analysis) -------------------------------------------------------------------
  function savedLine() {
    var n = q("[data-hp-saved]"); clear(n); n.hidden = mode === "analysis";
    if (mode === "analysis" || !current) return;
    var s = current.save;
    if (s.state === "saving") n.appendChild(el("span", null, t("Enregistrement de la photo…")));
    else if (s.state === "saved") {
      n.appendChild(el("strong", null, "✓ " + t("Photo enregistrée")));
      n.appendChild(el("span", { class: "ida-muted", "data-hp-haddad": s.haddad || "" }, " — " + t(HADDAD[s.haddad] || HADDAD.pending)));
    } else if (s.state === "failed") {
      n.appendChild(el("span", { class: "ida-field-error" }, t("La photo n'a pas été enregistrée : ") + (s.error || "") + " "));
      var b = el("button", { type: "button", class: "ida-btn ida-btn--secondary ida-btn--sm", "data-hp-retry-save": "" }, t("Réessayer l'enregistrement"));
      b.addEventListener("click", function () { save(current); }); n.appendChild(b);
    }
  }
  async function save(c) {
    if (mode === "analysis") return;
    c.save = { state: "saving" }; savedLine();
    try {
      // the original as taken; if the server refuses it (too large, or a format it does not keep such as HEIC),
      // the reduced JPEG of the same photograph — never nothing
      var meta = { captured_at: c.capturedAt || (c.taken ? new Date().toISOString() : null), location: c.location ? { source: c.location.source, latitude: c.location.latitude, longitude: c.location.longitude } : null };
      var send = function (body) { return req("POST", base(), body, { "Content-Type": body.type || "image/jpeg", "X-IDauto-Photo-Meta": b64url(meta) }); };
      var out;
      try { out = (await send(c.original)).scan; }
      catch (e) {
        if ((e.status !== 413 && e.status !== 415) || !(c.blob || c.ready)) throw e;
        if (!c.blob) await c.ready;
        if (!c.blob) throw e;
        out = (await send(c.blob)).scan; c.reduced = true;
      }
      if (c !== current) return;
      c.save = { state: "saved", token: out.token, haddad: out.haddad }; savedLine();
      pollHaddad(c);
      if (!meta.location && c.location) pushAnalysisLocation(c);   // the position arrived after the upload started
      if (c.result) { pushAnalysis(c); checkExisting(); }      // the save / attach buttons need the saved photograph
    } catch (e) { if (c === current) { c.save = { state: "failed", error: e.status === 429 ? t("trop d'envois, patientez") : e.status === 413 ? t("image trop volumineuse") : (e.message || "") }; savedLine(); } }
  }
  function pollHaddad(c) {
    var n = 0;
    (function tick() {
      if (c !== current || !c.save.token || c.save.haddad === "stored" || c.save.haddad === "not_configured" || n++ > 20) return;
      setTimeout(function () { req("GET", base() + "/" + c.save.token).then(function (o) { if (c === current) { c.save.haddad = o.scan.haddad; savedLine(); tick(); } }).catch(function () {}); }, 1500);
    }());
  }
  function pushAnalysisLocation(c) {
    if (!c.save || !c.save.token || !c.location) return;
    req("PUT", base() + "/" + c.save.token, JSON.stringify({ location: { source: c.location.source, latitude: c.location.latitude, longitude: c.location.longitude }, captured_at: c.capturedAt }), { "Content-Type": "application/json" }).catch(function () {});
  }
  function pushAnalysis(c) {
    if (!c.save || !c.save.token) return;
    var a = c.result.analysis;
    req("PUT", base() + "/" + c.save.token, JSON.stringify({ analysis: a, view: c.result.view || "unknown", location: c.location ? { source: c.location.source, latitude: c.location.latitude, longitude: c.location.longitude, place_name: c.location.place_name || null, governorate: c.location.governorate || null, country: c.location.country || null } : null }), { "Content-Type": "application/json" }).catch(function () {});
  }

  // ---- result --------------------------------------------------------------------------------------------------
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
    if (v && v.value) { dd.appendChild(el("span", { dir: "auto" }, fmt ? t(fmt[v.value] || v.value) : v.value)); dd.appendChild(el("span", { class: "ida-recog-conf" }, " " + t(FROM[v.source] || "") + (typeof v.confidence === "number" ? " · " + Math.round(v.confidence * 100) + " %" : ""))); }
    else dd.textContent = vision.enabled ? t("Non reconnu") : t("Non disponible");
    dl.appendChild(dd);
  }
  function showResult() {
    intro.hidden = true; result.hidden = false;
    ["live", "busy", "confirm", "error"].forEach(function (n) { var x = q("[data-scan-" + n + "]"); if (x) x.hidden = true; });
    var ph = q("[data-hp-photo]"); clear(ph);
    if (current && current.url) ph.appendChild(el("img", { src: current.url, alt: t("Photo du véhicule"), class: "ida-recog-img" }));
    q("[data-hp-save]").hidden = true; q("[data-hp-attach]").hidden = true; q("[data-hp-existing]").hidden = true; q("[data-hp-edit]").hidden = mode === "analysis";
  }
  function render(r) {
    var a = r.analysis, p = a.plate;
    q("[data-hp-busy]").textContent = r.failed ? t("L'analyse n'a pas abouti.") : "";
    if (r.failed) { var again = el("button", { type: "button", class: "ida-btn ida-btn--secondary ida-btn--sm", "data-hp-retry-analysis": "" }, t("Relancer l'analyse")); again.addEventListener("click", function () { analyse(current); }); q("[data-hp-busy]").appendChild(document.createTextNode(" ")); q("[data-hp-busy]").appendChild(again); }
    q("[data-hp-serie]").value = p ? p.serie : ""; q("[data-hp-numero]").value = p ? p.numero : "";
    var note = q("[data-hp-plate-note]");
    note.textContent = p
      ? (p.accepted ? t("Plaque lue sur la photo") : t("Lecture à vérifier")) + " · " + p.confidence + " %" + (r.plateDisagree ? " — " + t("l'analyse d'image lit : ") + r.plateDisagree : "")
      : (r.plateSeen ? t("Plaque repérée mais non lue : saisissez-la.") : t("Aucune plaque lisible sur cette photo : saisissez-la si vous la connaissez."));
    note.className = p && p.accepted ? "ida-caption" : "ida-caption ida-field-error";
    var dl = q("[data-hp-fields]"); clear(dl);
    dl.appendChild(el("dt", null, t("Vue"))); dl.appendChild(el("dd", { "data-hp-field": "Vue" }, r.view ? t(VIEW[r.view]) + " — " + t("reconnue sur l'image") : t("non déterminée")));
    field("Marque", a.fields.make); field("Modèle", a.fields.model && a.fields.trim && a.fields.trim.value ? { value: a.fields.model.value + " " + a.fields.trim.value, source: a.fields.model.source, confidence: a.fields.model.confidence } : a.fields.model);
    field("Couleur", a.fields.colour, COLOUR); field("Carrosserie", a.fields.body_type, BODY);
    if (a.fields.year && a.fields.year.value) field("Année", a.fields.year);
    if (mode !== "analysis") {
      // the editable values start from what was recognised, never from anything else
      q("[data-hp-make]").value = a.fields.make && a.fields.make.value || ""; q("[data-hp-model]").value = a.fields.model && a.fields.model.value ? a.fields.model.value + (a.fields.trim && a.fields.trim.value ? " " + a.fields.trim.value : "") : "";
      q("[data-hp-colour]").value = a.fields.colour && a.fields.colour.value || ""; q("[data-hp-body]").value = a.fields.body_type && a.fields.body_type.value || "";
    }
    renderPlace();
    q("[data-hp-note]").textContent = !vision.enabled
      ? t("La reconnaissance de la marque et du modèle n'est pas disponible sur ce service : seuls la plaque et une estimation de la couleur sont proposés.")
      : r.visionError ? t("L'analyse d'image n'a pas abouti : seuls la plaque et une estimation de la couleur sont proposés.")
      : t("Marque, modèle et carrosserie sont proposés à partir de l'image, pas d'un registre : ce sont des indications.");
    checkExisting();
  }
  // existence of the plate: the PUBLIC plate route (IVID only) — the same answer anyone gets by typing it
  function plateParts() { return { s: (q("[data-hp-serie]").value || "").replace(/\D/g, ""), n: (q("[data-hp-numero]").value || "").replace(/\D/g, "") }; }
  function checkExisting() {
    if (mode === "analysis" || !current) return;
    var pp = plateParts(), box = q("[data-hp-existing]"), c = current;
    q("[data-hp-save]").hidden = true; q("[data-hp-attach]").hidden = true; box.hidden = true; clear(box);
    if (!/^\d{1,3}$/.test(pp.s) || !/^\d{1,4}$/.test(pp.n)) return;
    fetch("/public/plates/" + encodeURIComponent(pp.s + " TUN " + pp.n), { credentials: "omit" }).then(function (r) {
      // only a 404 means « not registered »; a refused or failed check offers nothing rather than a wrong « save »
      if (r.status === 200) return r.json();
      if (r.status === 404) return null;
      throw new Error(String(r.status));
    }).then(function (o) {
      if (c !== current) return;
      c.existing = o && o.ivid ? o.ivid : null;
      if (c.existing) {
        box.hidden = false;
        box.appendChild(el("p", { class: "ida-alert ida-alert--warning ida-small" }, t("Ce véhicule existe déjà dans IDauto.")));
        var a = el("a", { href: mode === "workshop" ? "/atelier/vehicule?ref=" + encodeURIComponent(c.existing) : "/passport?ivid=" + encodeURIComponent(c.existing), class: "ida-btn ida-btn--ghost ida-btn--sm", "data-hp-open-existing": "" }, mode === "workshop" ? t("Ouvrir sa fiche") : t("Voir son passeport"));
        box.appendChild(a);
        q("[data-hp-attach]").hidden = !(c.save && c.save.state === "saved");
      } else q("[data-hp-save]").hidden = !(c.save && c.save.state === "saved");
    }).catch(function () {});
  }

  // ---- one photograph: save and analyse in parallel ------------------------------------------------------------
  async function analyse(c) {
    q("[data-hp-busy]").textContent = t("Analyse en cours…");
    var r;
    try { r = await A.analyse(c, { visionEnabled: vision.enabled, visionUrl: "/public/vehicle-analysis", post: function (url, blob) { return req("POST", url, blob, { "Content-Type": "image/jpeg" }); } }); }
    catch (e) { r = { analysis: { plate: null, fields: {} }, plateSeen: false, visionError: "unreachable", failed: true }; }
    if (c !== current) return;
    c.result = r;
    if (r.failed && c.save && c.save.token) req("PUT", base() + "/" + c.save.token, JSON.stringify({ analysis_status: "failed" }), { "Content-Type": "application/json" }).catch(function () {});
    render(r);
    if (!r.failed) pushAnalysis(c);
  }
  async function handle(file, taken) {
    if (!file) return;
    var my = ++seq;
    stopCamera();
    var fix = taken ? A.askPosition() : null;            // a FRESH position for THIS photograph, taken now
    current = { original: file, save: { state: mode === "analysis" ? "none" : "saving" } };
    var c = current;
    showResult(); savedLine();
    q("[data-hp-busy]").textContent = t("Lecture de la photo…");
    clear(q("[data-hp-fields]")); q("[data-hp-plate-note]").textContent = ""; q("[data-hp-note]").textContent = ""; clear(q("[data-hp-place-line]")); q("[data-hp-loc-edit]").hidden = true;
    c.taken = !!taken;
    // the photograph is saved at once — it does not wait for decoding or the location, nor depend on them
    var prepared, prep = A.prepare(file, taken, fix);
    c.ready = prep.then(function (x) { Object.assign(c, x); }).catch(function () {});
    save(c);
    try { prepared = await prep; }
    catch (e) { q("[data-hp-busy]").textContent = t("Cette image ne peut pas être lue : choisissez une autre photo."); return; }
    if (my !== seq) return;
    Object.assign(c, prepared);
    showResult(); renderPlace();
    if (c.save && c.save.token) pushAnalysisLocation(c);
    if (c.location && c.location.source !== "manual") {
      fetch("/public/geo/resolve?lat=" + encodeURIComponent(c.location.latitude) + "&lon=" + encodeURIComponent(c.location.longitude), { credentials: "omit" }).then(function (r) { return r.json(); })
        .then(function (o) { if (c === current && c.location) { c.location.resolved = o.resolved; renderPlace(); } }).catch(function () {});
    }
    analyse(c);        // …analysed while it is being saved
  }

  // ---- wiring ----------------------------------------------------------------------------------------------------
  // « Scanner la plaque » opens the camera at once (home.js still binds the video scanner to the same dialog)
  openBtn.addEventListener("click", function () { seq++; current = null; setTimeout(openCamera, 0); });
  root.addEventListener("click", function (e) {
    var a = e.target.closest("[data-scan-action]");
    if (a && (a.getAttribute("data-scan-action") === "close" || a.getAttribute("data-scan-action") === "start")) stopCamera();
    if (e.target === root) stopCamera();
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") stopCamera(); });
  shutter.addEventListener("click", async function () { shutter.disabled = true; var f = await frameFile(); if (f) handle(f, true); else shutter.disabled = false; });
  take.addEventListener("change", function () { var f = take.files && take.files[0]; take.value = ""; handle(f, true); });
  pick.addEventListener("change", function () { var f = pick.files && pick.files[0]; pick.value = ""; handle(f, false); });
  q("[data-hp-again]").addEventListener("click", function () { seq++; current = null; openCamera(); });
  q("[data-hp-serie]").addEventListener("change", checkExisting); q("[data-hp-numero]").addEventListener("change", checkExisting);
  q("[data-hp-search]").addEventListener("click", function () {
    var pp = plateParts(), note = q("[data-hp-plate-note]");
    if (!/^\d{1,3}$/.test(pp.s) || !/^\d{1,4}$/.test(pp.n)) { note.textContent = t("Série : 1 à 3 chiffres. Numéro : 1 à 4 chiffres."); note.className = "ida-caption ida-field-error"; q("[data-hp-serie]").focus(); return; }
    var p = current && current.result && current.result.analysis.plate, auto = !!(p && p.accepted && p.serie === pp.s && p.numero === pp.n);
    stopCamera();
    if (window.IdaPlateScanner) window.IdaPlateScanner.close();
    if (window.IdaHome) window.IdaHome.applyScannedPlate({ serie: pp.s, numero: pp.n, confidence: p ? p.confidence : 0, auto: auto });
  });
  function done(msg, href, label) {
    var box = q("[data-hp-existing]"); clear(box); box.hidden = false;
    box.appendChild(el("p", { class: "ida-alert ida-alert--success ida-small", "data-hp-done": "" }, msg));
    if (href) box.appendChild(el("a", { href: href, class: "ida-btn ida-btn--secondary ida-btn--sm" }, label));
    q("[data-hp-save]").hidden = true; q("[data-hp-attach]").hidden = true;
  }
  function fail(msg) { var n = q("[data-hp-note]"); n.textContent = msg; n.className = "ida-caption ida-field-error"; }
  q("[data-hp-attach]").addEventListener("click", async function () {
    var c = current, pp = plateParts(); if (!c || !c.save.token || !c.existing) return;
    this.disabled = true;
    try {
      if (mode === "workshop") { await req("POST", base() + "/" + c.save.token + "/attach", JSON.stringify({ vehicle: c.existing }), { "Content-Type": "application/json" }); done(t("Photo ajoutée au dossier du véhicule."), "/atelier/vehicule?ref=" + encodeURIComponent(c.existing), t("Ouvrir sa fiche")); }
      else { await req("POST", base() + "/" + c.save.token + "/attach", JSON.stringify({ serie: pp.s, numero: pp.n }), { "Content-Type": "application/json" }); done(t("Photo ajoutée au dossier du véhicule."), "/passport?ivid=" + encodeURIComponent(c.existing), t("Voir son passeport")); }
    } catch (e) { fail(t("La photo n'a pas pu être ajoutée : ") + (e.message || "")); } finally { this.disabled = false; }
  });
  q("[data-hp-save]").addEventListener("click", async function () {
    var c = current, pp = plateParts(); if (!c || !c.save.token) return;
    if (!/^\d{1,3}$/.test(pp.s) || !/^\d{1,4}$/.test(pp.n)) { fail(t("Série : 1 à 3 chiffres. Numéro : 1 à 4 chiffres.")); return; }
    var y = c.result && c.result.analysis.fields.year && c.result.analysis.fields.year.value || "";
    var vals = { make: q("[data-hp-make]").value.trim(), model: q("[data-hp-model]").value.trim(), colour: q("[data-hp-colour]").value, body_type: q("[data-hp-body]").value, year: y };
    this.disabled = true;
    try {
      if (c.save.token) await req("PUT", base() + "/" + c.save.token, JSON.stringify({ confirmed: true }), { "Content-Type": "application/json" });
      var out = mode === "workshop"
        ? await req("POST", base() + "/" + c.save.token + "/vehicle", JSON.stringify(Object.assign({ plate: { type: "TU", series: pp.s, number: pp.n } }, vals)), { "Content-Type": "application/json" })
        : await req("POST", base() + "/" + c.save.token + "/vehicle", JSON.stringify(Object.assign({ serie: pp.s, numero: pp.n }, vals)), { "Content-Type": "application/json" });
      done(t("Véhicule enregistré avec sa photo."), mode === "workshop" ? "/atelier/vehicule?ref=" + encodeURIComponent(out.ivid) : "/passport?ivid=" + encodeURIComponent(out.ivid), mode === "workshop" ? t("Ouvrir sa fiche") : t("Voir son passeport"));
    } catch (e) { fail(e.status === 409 ? t("Ce véhicule existe déjà dans IDauto.") : t("Le véhicule n'a pas été enregistré : ") + (e.message || "")); checkExisting(); } finally { this.disabled = false; }
  });
  // manual location
  var gov = q("[data-hp-gov]"), placeIn = q("[data-hp-place]"), dl = root.querySelector("#hp-places");
  gov.addEventListener("change", function () { clear(dl); var g = (geoData ? geoData.governorates : []).filter(function (x) { return x.name === gov.value; })[0]; (g ? g.delegations : []).forEach(function (d) { dl.appendChild(el("option", { value: d })); }); });
  q("[data-hp-loc-ok]").addEventListener("click", function () {
    if (!current || (!gov.value && !placeIn.value.trim())) return;
    if (current.location && current.location.source !== "manual") { current.location.place_name = placeIn.value.trim() || null; current.location.governorate = gov.value || null; current.location.country = gov.value ? "Tunisie" : current.location.country || null; }
    else current.location = { source: "manual", latitude: null, longitude: null, place_name: placeIn.value.trim() || null, governorate: gov.value || null, country: gov.value ? "Tunisie" : null };
    q("[data-hp-loc-edit]").hidden = true; renderPlace();
    if (current.result) pushAnalysis(current);
  });

  // what this visitor may do: a signed-in workshop stores and saves; an anonymous visitor only if the owner enabled it
  getJson("/public/vehicle-analysis").then(function (o) { vision = { enabled: !!o.enabled }; }).catch(function () {});
  getJson("/public/geo/tn").then(function (g) { geoData = g; g.governorates.forEach(function (x) { gov.appendChild(el("option", { value: x.name, "data-i18n-skip": "" }, x.name)); }); }).catch(function () {});
  fetch("/api/workspace/vehicle-recognition", { credentials: "same-origin", headers: { "X-IDauto-Session": "1" } }).then(function (r) {
    if (r.ok) { mode = "workshop"; return null; }
    return getJson("/public/scans").then(function (o) { if (o.store) mode = "public"; });
  }).catch(function () {}).then(function () {
    q("[data-hp-privacy]").textContent = mode === "analysis"
      ? t("Photographiez le véhicule en entier, de face ou de dos. La photo est analysée sur votre appareil ; elle n'est pas enregistrée.")
      : t("Photographiez le véhicule en entier, de face ou de dos. La photo est enregistrée par IDauto dès la prise de vue, avec sa date et son lieu.");
  });
  function getJson(url) { return fetch(url, { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }

  window.IdaHomePhoto = { _handle: handle, _current: function () { return current; }, _mode: function () { return mode; }, _open: openCamera };
}());
