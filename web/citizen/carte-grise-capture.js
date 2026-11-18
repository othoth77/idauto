/* IDauto — Update 5 — carte grise capture: THREE input methods, ONE pipeline.
 * ============================================================================
 *   1. Scanner      the camera (or a gallery image, or a pasted image) through the existing scanner
 *                   (registration-scanner.js, mode "capture"): card detection, perspective, manual corners, rotation,
 *                   recto / verso, retake. Sends the ORIGINAL photograph and, separately, its corrected crop.
 *   2. Fichier      an image (JPEG / PNG / WebP) or a PDF, previewed (image) or described (PDF), replaceable, sent as is.
 *   3. Coller       an image pasted from another application (previewed), or the carte grise TEXT pasted as is
 *                   (UTF-8: Arabic, French, digits — never converted to a PDF or an image).
 * Every method ends in the same call: POST /api/vehicles/:ivid/carte-grise (signed in) or
 * POST /public/vehicles/:ivid/carte-grise (a visitor, only when the owner has enabled it). The server decides the type
 * from the bytes, stores the original unchanged and marks it PENDING_LENS. Nothing here reads the document:
 * no OCR, no parser (owner decision 2026-11-18 — LENS will do it later).
 *
 *   IdaCarteGrise.open({ ivid, mode: "session" | "public", onDone(results) })
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaCarteGrise = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var LIMITS = { image: 12 * 1024 * 1024, pdf: 10 * 1024 * 1024, textChars: 20000, textMin: 10 };
  var IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  var st = { root: null, ivid: null, mode: "session", onDone: null, file: null, paste: null, urls: [] };
  function g() { return typeof self !== "undefined" ? self : globalThis; }
  function t(s) { var T = g().IdaI18n; return T && T.t ? T.t(s) : s; }
  function q(sel) { return st.root.querySelector(sel); }
  function el(tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); }); if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function url(blob) { var u = URL.createObjectURL(blob); st.urls.push(u); return u; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; }
  function say(msg, kind) { var s = q("[data-cgc-status]"); s.textContent = msg || ""; s.className = "ida-small" + (kind === "error" ? " ida-field-error" : kind === "ok" ? " ida-text-success" : ""); }

  // ---- the one submission --------------------------------------------------------------------------------------------
  // Update 6 — no vehicle (ivid null): the carte grise is received on its own (intake) and reviewed by an administrator
  function endpoint() {
    if (!st.ivid) return st.mode === "public" ? "/public/carte-grise/intake" : "/api/carte-grise/intake";
    return st.mode === "public" ? "/public/vehicles/" + encodeURIComponent(st.ivid) + "/carte-grise" : "/api/vehicles/" + encodeURIComponent(st.ivid) + "/carte-grise";
  }
  async function send(body, type, face, method, filename) {
    var h = { "Content-Type": type, "X-IDauto-Face": String(face || 1), "X-IDauto-Input": method };
    if (filename) h["X-IDauto-Filename"] = encodeURIComponent(filename);
    if (st.mode !== "public") h["X-IDauto-Session"] = "1";
    var r = await fetch(endpoint(), { method: "POST", credentials: st.mode === "public" ? "omit" : "same-origin", headers: h, body: body });
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(reason(b, r.status)); e.status = r.status; throw e; }
    return b;
  }
  async function sendPreview(id, crop) {
    var r = await fetch("/api/vehicles/" + encodeURIComponent(st.ivid) + "/carte-grise/" + encodeURIComponent(id) + "/preview", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "image/jpeg", "X-IDauto-Session": "1" }, body: crop });
    return r.ok;
  }
  var REASONS = {
    unsupported_type: "Type de fichier non accepté : JPEG, PNG, WebP ou PDF.", too_large: "Fichier trop volumineux.", too_small: "Image trop petite pour être lisible.",
    pdf_incomplete: "Ce PDF est incomplet ou endommagé.", pdf_encrypted: "Ce PDF est protégé par un mot de passe : il ne peut pas être conservé tel quel.",
    not_utf8: "Ce texte n'a pas pu être lu.", too_short: "Le texte collé est trop court.", face_1_required_first: "Ajoutez d'abord le recto (face 1).", unreadable_image: "Cette image ne peut pas être lue."
  };
  function reason(b, status) {
    if (status === 401 || status === 403) return t("Connectez-vous pour ajouter une carte grise.");
    if (status === 404 && st.mode === "public") return t("Le dépôt public de carte grise n'est pas ouvert : connectez-vous.");
    if (status === 429) return t("Trop d'envois : réessayez plus tard.");
    var r = b && (b.reason || (b.details && b.details.reason));
    return t(REASONS[r] || b.message_fr || "L'envoi n'a pas abouti.");
  }
  function outcome(list) {
    var box = clear(q("[data-cgc-done]")); box.hidden = false;
    list.forEach(function (o) {
      var line = o.error ? t("Non enregistré : ") + o.error
        : o.duplicate && !st.ivid ? t("Ce document a déjà été reçu : rien n'a été ajouté.")
        : o.duplicate ? t("Ce document est déjà dans le dossier du véhicule : rien n'a été ajouté.")
        : !st.ivid ? t("Reçu — en attente d'extraction (LENS) puis de vérification par un administrateur avant d'être rattaché à un véhicule.")
        : st.mode === "public" ? t("Reçu — un administrateur le vérifiera avant de l'ajouter au dossier.")
        : t("Enregistré dans le dossier — en attente d'analyse (LENS).");
      box.appendChild(el("p", { class: "ida-small" + (o.error ? " ida-field-error" : ""), "data-cgc-result": o.error ? "error" : o.duplicate ? "duplicate" : "stored" }, (o.label ? o.label + " — " : "") + line));
    });
    if (st.ivid && st.mode !== "public" && list.some(function (o) { return !o.error; })) box.appendChild(el("a", { class: "ida-btn ida-btn--secondary ida-btn--sm", href: dossierHref(), "data-cgc-open-dossier": "" }, t("Ouvrir le dossier du véhicule")));
    if (st.onDone) st.onDone(list);
  }
  function dossierHref() { return (g().location && /^\/admin/.test(g().location.pathname) ? "/admin/vehicle?ref=" : "/atelier/vehicule?ref=") + encodeURIComponent(st.ivid); }

  // ---- 1. scanner: the camera, inside this dialog (Update 6.1) --------------------------------------------------------
  // The « Scanner » tab itself calls getUserMedia() from its click: no second button, no file picker. Rear camera
  // preferred, highest practical resolution; the photograph is kept as taken (JPEG 0.95 at the camera's full size, or
  // the camera's own still via ImageCapture.takePhoto when available). The stream is stopped after capture, on cancel,
  // on another tab and when the dialog closes.
  var cam = { stream: null, devices: [], index: -1, blob: null, busy: false };
  function camView(v) {
    if (!st.root) return;
    q("[data-cgc-video]").hidden = v !== "live"; q("[data-cgc-cam-live]").hidden = v !== "live";
    q("[data-cgc-shot]").hidden = v !== "review"; q("[data-cgc-cam-review]").hidden = v !== "review";
    if (v === "idle") { cam.blob = null; q("[data-cgc-cam-msg]").hidden = false; }
  }
  function camMsg(m, kind) { var p = q("[data-cgc-cam-msg]"); p.hidden = !m; p.textContent = m || ""; p.className = "ida-small" + (kind === "error" ? " ida-field-error" : ""); }
  function camStop() {
    if (cam.stream) { cam.stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} }); cam.stream = null; }
    if (st.root) { var v = q("[data-cgc-video]"); if (v) v.srcObject = null; }
  }
  function camError(e) {
    var n = e && e.name;
    var m = n === "NotAllowedError" || n === "SecurityError" ? t("Accès à la caméra refusé. Autorisez la caméra dans le navigateur, ou utilisez « Fichier ».")
      : n === "NotFoundError" || n === "OverconstrainedError" ? t("Aucune caméra disponible sur cet appareil. Utilisez « Fichier ».")
      : n === "NotReadableError" || n === "AbortError" ? t("La caméra est déjà utilisée par une autre application. Fermez-la et réessayez, ou utilisez « Fichier ».")
      : t("La caméra n'a pas pu être ouverte. Utilisez « Fichier ».");
    camMsg(m, "error"); camView("error");
  }
  function camStart() {
    camStop(); cam.blob = null;
    var w = g();
    if (w.isSecureContext === false) { camMsg(t("La caméra exige une connexion sécurisée (HTTPS). Utilisez « Fichier »."), "error"); return camView("error"); }
    var md = w.navigator && w.navigator.mediaDevices;
    if (!md || !md.getUserMedia) { camMsg(t("Ce navigateur ne permet pas d'utiliser la caméra. Utilisez « Fichier »."), "error"); return camView("error"); }
    var dev = cam.index >= 0 && cam.devices[cam.index];
    var video = { width: { ideal: 4096 }, height: { ideal: 3072 } };
    if (dev) video.deviceId = { exact: dev.deviceId }; else video.facingMode = { ideal: "environment" };
    camMsg(t("Ouverture de la caméra…"));
    // called synchronously from the click: the browser sees the user gesture
    return md.getUserMedia({ video: video, audio: false }).then(function (stream) {
      if (st.root.hidden || q("[data-cgc-pane='scan']").hidden) { stream.getTracks().forEach(function (tr) { tr.stop(); }); return; }   // closed meanwhile
      cam.stream = stream;
      var v = q("[data-cgc-video]"); v.srcObject = stream; var pl = v.play(); if (pl && pl.catch) pl.catch(function () {});
      camMsg(t("Cadrez la carte grise (") + faceLabel() + t(") puis prenez la photo.")); camView("live");
      if (md.enumerateDevices) md.enumerateDevices().then(function (list) {
        cam.devices = list.filter(function (d) { return d.kind === "videoinput"; });
        var cur = stream.getVideoTracks()[0], id = cur && cur.getSettings ? cur.getSettings().deviceId : null;
        cam.index = Math.max(0, cam.devices.findIndex(function (d) { return d.deviceId === id; }));
        q("[data-cgc-switch]").hidden = cam.devices.length < 2;
      }).catch(function () {});
    }, camError);
  }
  function camSwitch() { if (cam.devices.length < 2) return; cam.index = (cam.index + 1) % cam.devices.length; camStart(); }
  function faceLabel() { return Number(q("[data-cgc-face]").value) === 2 ? t("Verso") : t("Recto"); }
  async function camCapture() {
    if (!cam.stream || cam.busy) return;
    cam.busy = true;
    try {
      var track = cam.stream.getVideoTracks()[0], blob = null, IC = g().ImageCapture;
      if (IC && track) { try { blob = await new IC(track).takePhoto(); } catch (e) { blob = null; } }   // the camera's full-resolution still
      if (!blob) {
        var v = q("[data-cgc-video]"), c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        if (!c.width || !c.height) throw new Error("no frame");
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        blob = await new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.95); });
      }
      if (!blob) throw new Error("no image");
      camStop();
      cam.blob = blob; cam.face = Number(q("[data-cgc-face]").value) === 2 ? 2 : 1;
      q("[data-cgc-shot]").src = url(blob);
      camMsg(faceLabel() + " — " + t("vérifiez la photo, puis « Confirmer » ou « Reprendre »."));
      camView("review");
    } catch (e) { camMsg(t("La photo n'a pas pu être prise. Réessayez."), "error"); }
    finally { cam.busy = false; }
  }
  async function camConfirm() {
    if (!cam.blob) return;
    var blob = cam.blob, face = cam.face, label = face === 2 ? t("Verso") : t("Recto");
    q("[data-cgc-confirm]").disabled = true; say(t("Envoi…"));
    var out;
    try { var r = await send(blob, blob.type || "image/jpeg", face, "camera", "carte-grise-" + (face === 2 ? "verso" : "recto") + ".jpg"); out = { label: label, duplicate: !!(r.duplicate_of || r.duplicate) }; }
    catch (e) { out = { label: label, error: e.message }; }
    q("[data-cgc-confirm]").disabled = false; say(""); outcome([out]);
    if (!out.error) {
      camView("idle");
      if (face === 1) { q("[data-cgc-face]").value = "2"; camMsg(t("Recto enregistré. Appuyez sur « Scanner » pour photographier le verso.")); }
      else camMsg(t("Verso enregistré."));
    }
  }

  // ---- 2. file (image or PDF) -----------------------------------------------------------------------------------------
  function looksPdf(head) { return head.length >= 5 && String.fromCharCode.apply(null, head.slice(0, 5)) === "%PDF-"; }
  async function pickFile(file) {
    var box = clear(q("[data-cgc-file-preview]"));
    st.file = null; q("[data-cgc-file-send]").disabled = true;
    if (!file) return;
    var head = new Uint8Array(await file.slice(0, 8).arrayBuffer()), pdf = looksPdf(head);
    if (!pdf && IMAGE_TYPES.indexOf(file.type) === -1) { say(t(REASONS.unsupported_type), "error"); return; }
    if (file.size > (pdf ? LIMITS.pdf : LIMITS.image)) { say(t(REASONS.too_large) + " (" + kb(file.size) + ")", "error"); return; }
    st.file = { blob: file, pdf: pdf };
    if (pdf) {
      var txt = new TextDecoder("latin1").decode(new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer()));
      var pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
      box.appendChild(el("p", { class: "ida-small", "data-cgc-pdf": "" }, "PDF — " + (file.name || "document.pdf") + " · " + kb(file.size) + (pages ? " · " + pages + " " + t("page(s)") : "")));
    } else box.appendChild(el("img", { src: url(file), alt: t("Aperçu du document"), class: "ida-cgc-preview", "data-cgc-image": "" }));
    say(t("Vérifiez l'aperçu, puis envoyez — ou choisissez un autre fichier.")); q("[data-cgc-file-send]").disabled = false;
  }
  async function sendFile() {
    if (!st.file) return;
    q("[data-cgc-file-send]").disabled = true; say(t("Envoi…"));
    var f = st.file, face = q("[data-cgc-face]").value === "2" ? 2 : 1, out;
    try { var r = await send(f.blob, f.pdf ? "application/pdf" : f.blob.type, face, "upload", f.blob.name || null); out = { duplicate: !!(r.duplicate_of || r.duplicate) }; }
    catch (e) { out = { error: e.message }; q("[data-cgc-file-send]").disabled = false; }
    say(""); outcome([out]);
  }

  // ---- 3. paste (an image from another application, or the text) -----------------------------------------------------
  function setPaste(p) {
    st.paste = p; var box = clear(q("[data-cgc-paste-preview]"));
    q("[data-cgc-paste-send]").disabled = !p; q("[data-cgc-paste-clear]").hidden = !p;
    if (!p) return;
    if (p.kind === "image") box.appendChild(el("img", { src: url(p.blob), alt: t("Image collée"), class: "ida-cgc-preview", "data-cgc-paste-image": "" }));
    else box.appendChild(el("p", { class: "ida-caption", "data-cgc-paste-count": "" }, Array.from(p.text).length + " " + t("caractères — le texte est conservé tel quel, sans conversion.")));
  }
  function onPaste(e) {
    var dt = e.clipboardData; if (!dt) return;
    var items = Array.from(dt.items || []), img = items.filter(function (i) { return i.kind === "file" && /^image\//.test(i.type); })[0];
    if (img) { e.preventDefault(); var f = img.getAsFile(); if (f) { q("[data-cgc-text]").value = ""; setPaste({ kind: "image", blob: f }); } return; }
    // text: let the textarea receive it, then preview
    setTimeout(onText, 0);
  }
  function onText() {
    var v = q("[data-cgc-text]").value;
    if (!v.trim()) return setPaste(null);
    if (Array.from(v).length > LIMITS.textChars) { say(t("Texte trop long."), "error"); return setPaste(null); }
    say(""); setPaste({ kind: "text", text: v });
  }
  async function sendPaste() {
    var p = st.paste; if (!p) return;
    if (p.kind === "text" && p.text.trim().length < LIMITS.textMin) { say(t(REASONS.too_short), "error"); return; }
    q("[data-cgc-paste-send]").disabled = true; say(t("Envoi…"));
    var face = q("[data-cgc-face]").value === "2" ? 2 : 1, out;
    try {
      var r = p.kind === "image" ? await send(p.blob, p.blob.type || "image/png", face, "paste_image", null)
        : await send(new Blob([new TextEncoder().encode(p.text)], { type: "text/plain;charset=utf-8" }), "text/plain; charset=utf-8", face, "paste_text", null);   // the exact UTF-8 bytes of what was pasted
      out = { duplicate: !!(r.duplicate_of || r.duplicate) };
    } catch (e) { out = { error: e.message }; q("[data-cgc-paste-send]").disabled = false; }
    say(""); outcome([out]);
  }

  // ---- dialog ---------------------------------------------------------------------------------------------------------
  function template() {
    return '<div class="ida-scan-panel ida-card ida-stack" role="document">' +
      '<div class="ida-scan-head"><h2 class="ida-h3" id="cgc-title">' + t("Carte grise") + '</h2><button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" data-cgc-close aria-label="' + t("Fermer") + '">✕</button></div>' +
      '<p class="ida-small ida-muted">' + t("Le document est conservé tel quel dans le dossier du véhicule. Ses informations seront lues plus tard (LENS) : rien n'est extrait ici.") + '</p>' +
      '<label class="ida-small">' + t("Face") + ' <select class="ida-select ida-select--sm" data-cgc-face><option value="1">' + t("Recto") + '</option><option value="2">' + t("Verso") + '</option></select></label>' +
      '<div class="ida-cluster" role="tablist" data-cgc-tabs>' +
      '<button type="button" class="ida-btn ida-btn--primary ida-btn--sm" role="tab" data-cgc-tab="scan">' + t("Scanner") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" role="tab" data-cgc-tab="file">' + t("Fichier (image ou PDF)") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" role="tab" data-cgc-tab="paste">' + t("Coller") + '</button></div>' +
      '<div data-cgc-pane="scan" class="ida-stack"><p class="ida-small" data-cgc-cam-msg>' + t("Appuyez sur « Scanner » pour ouvrir la caméra et photographier la face choisie.") + '</p>' +
      '<video class="ida-cgc-video" data-cgc-video playsinline muted autoplay hidden></video>' +
      '<img class="ida-cgc-video" data-cgc-shot alt="' + t("Photo prise") + '" hidden>' +
      '<div class="ida-cluster" data-cgc-cam-live hidden><button type="button" class="ida-btn ida-btn--primary" data-cgc-capture>' + t("Prendre la photo") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--secondary ida-btn--sm" data-cgc-switch hidden>' + t("Changer de caméra") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" data-cgc-cam-cancel>' + t("Annuler") + '</button></div>' +
      '<div class="ida-cluster" data-cgc-cam-review hidden><button type="button" class="ida-btn ida-btn--primary" data-cgc-confirm>' + t("Confirmer") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--secondary ida-btn--sm" data-cgc-retake>' + t("Reprendre") + '</button></div></div>' +
      '<div data-cgc-pane="file" class="ida-stack" hidden><label class="ida-btn ida-btn--secondary ida-btn--sm">' + t("Choisir un fichier") + '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-cgc-file hidden></label>' +
      '<div data-cgc-file-preview></div><button type="button" class="ida-btn ida-btn--primary ida-btn--sm" data-cgc-file-send disabled>' + t("Envoyer ce document") + '</button></div>' +
      '<div data-cgc-pane="paste" class="ida-stack" hidden><p class="ida-small">' + t("Collez ici (Ctrl+V) une image de la carte grise, ou son texte.") + '</p>' +
      '<textarea class="ida-input" rows="6" dir="auto" data-cgc-text aria-label="' + t("Zone de collage") + '" placeholder="' + t("Collez ici…") + '"></textarea>' +
      '<div data-cgc-paste-preview></div><div class="ida-cluster"><button type="button" class="ida-btn ida-btn--primary ida-btn--sm" data-cgc-paste-send disabled>' + t("Envoyer") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" data-cgc-paste-clear hidden>' + t("Effacer") + '</button></div></div>' +
      '<p class="ida-small" data-cgc-status aria-live="polite"></p><div class="ida-stack" data-cgc-done hidden aria-live="polite"></div></div>';
  }
  function tab(name) {
    if (name !== "scan") { camStop(); camView("idle"); }
    Array.from(st.root.querySelectorAll("[data-cgc-pane]")).forEach(function (p) { p.hidden = p.getAttribute("data-cgc-pane") !== name; });
    Array.from(st.root.querySelectorAll("[data-cgc-tab]")).forEach(function (b) { var on = b.getAttribute("data-cgc-tab") === name; b.className = "ida-btn ida-btn--sm " + (on ? "ida-btn--primary" : "ida-btn--ghost"); b.setAttribute("aria-selected", on ? "true" : "false"); });
    say("");
  }
  function mount() {
    var r = document.querySelector("[data-cgc-root]");
    if (!r) { r = el("div", { "data-cgc-root": "", class: "ida-scan", role: "dialog", "aria-modal": "true", "aria-labelledby": "cgc-title", hidden: "" }); document.body.appendChild(r); }
    if (!r.firstChild) r.innerHTML = template();          // a fixed template: no value from a request is ever placed in it
    st.root = r;
    if (r.getAttribute("data-cgc-bound")) return;
    r.setAttribute("data-cgc-bound", "1");
    r.addEventListener("click", function (e) {
      var tb = e.target.closest("[data-cgc-tab]");
      if (tb) { var name = tb.getAttribute("data-cgc-tab"); tab(name); if (name === "scan") return camStart(); return; }   // « Scanner » opens the camera on THIS click (user gesture)
      if (e.target.closest("[data-cgc-close]") || e.target === r) return close();
      if (e.target.closest("[data-cgc-capture]")) return camCapture();
      if (e.target.closest("[data-cgc-switch]")) return camSwitch();
      if (e.target.closest("[data-cgc-cam-cancel]")) { camStop(); return camView("idle"); }
      if (e.target.closest("[data-cgc-retake]")) return camStart();
      if (e.target.closest("[data-cgc-confirm]")) return camConfirm();
      if (e.target.closest("[data-cgc-file-send]")) return sendFile();
      if (e.target.closest("[data-cgc-paste-send]")) return sendPaste();
      if (e.target.closest("[data-cgc-paste-clear]")) { q("[data-cgc-text]").value = ""; return setPaste(null); }
    });
    q("[data-cgc-file]").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; pickFile(f); });
    q("[data-cgc-text]").addEventListener("paste", onPaste);
    q("[data-cgc-text]").addEventListener("input", onText);
    r.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
  function open(opts) {
    mount();
    st.ivid = opts.ivid || null; st.mode = opts.mode === "public" ? "public" : "session"; st.onDone = opts.onDone || null; st.file = null; st.paste = null;
    clear(q("[data-cgc-file-preview]")); q("[data-cgc-text]").value = ""; setPaste(null); q("[data-cgc-done]").hidden = true; tab("scan");
    st.root.hidden = false; st.root.setAttribute("aria-hidden", "false");
    var first = q("[data-cgc-tab]"); if (first) first.focus();
  }
  function close() { camStop(); camView("idle"); st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); st.urls = []; if (st.root) { st.root.hidden = true; st.root.setAttribute("aria-hidden", "true"); } }

  return { open: open, close: close, LIMITS: LIMITS, _state: st, _cam: cam, _pickFile: pickFile, _setText: function (v) { q("[data-cgc-text]").value = v; onText(); } };
});
