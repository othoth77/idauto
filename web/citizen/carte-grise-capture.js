/* IDauto — Update 5.1 — carte grise capture, direct: three separate methods, ONE preview, ONE upload.
 * ============================================================================
 *   Scanner            → the camera opens at once (rear camera on mobile), live preview, « Capturer »; the captured
 *                        image is shown; « Reprendre » or « Confirmer ». Never a file picker. The original is the
 *                        camera's own photograph (ImageCapture.takePhoto) or, where that does not exist, the full frame
 *                        as a lossless PNG — never a recompressed copy.
 *   Importer un fichier → the system file picker opens at once (image or PDF).
 *   Coller             → the clipboard image is read at once (navigator.clipboard.read); where that is not available or
 *                        not allowed, a focused paste target takes Ctrl+V. Text in the clipboard is NOT an image: it is
 *                        said so; it can be kept, explicitly, as a text source (CARTE_GRISE_TEXT).
 * Every method ends in the same preview (image / PDF / text, type, size, replace, cancel, confirm) and the same upload:
 * POST /api/vehicles/:ivid/carte-grise (the one pipeline: original unchanged, SHA-256, versions, Haddad, PENDING_LENS).
 * Nothing is uploaded before « Confirmer ». No OCR, no extraction here.
 *
 *   IdaCarteGrise.start(method, { ivid, mode: "session" | "public", newVersion: bool, onDone(result) })
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaCarteGrise = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var LIMITS = { image: 12 * 1024 * 1024, pdf: 10 * 1024 * 1024, textMin: 10 };
  var IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  var st = { root: null, opts: null, method: null, item: null, stream: null, urls: [], busy: false };
  function g() { return typeof self !== "undefined" ? self : globalThis; }
  function t(s) { var T = g().IdaI18n; return T && T.t ? T.t(s) : s; }
  function q(sel) { return st.root.querySelector(sel); }
  function el(tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]); }); if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function url(blob) { var u = URL.createObjectURL(blob); st.urls.push(u); return u; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; }
  function view(name) { ["camera", "paste", "preview", "done"].forEach(function (v) { var e = q("[data-cgc-view=" + v + "]"); if (e) e.hidden = v !== name; }); }
  function say(msg, kind) { var s = q("[data-cgc-status]"); s.textContent = msg || ""; s.className = "ida-small" + (kind === "error" ? " ida-field-error" : ""); s.hidden = !msg; }

  // ---- dialog (a fixed template: no value from a request is ever placed in it) -------------------------------------
  function template() {
    return '<div class="ida-scan-panel ida-card ida-stack" role="document">' +
      '<div class="ida-scan-head"><h2 class="ida-h3" id="cgc-title">' + t("Carte grise") + '</h2><button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" data-cgc-close aria-label="' + t("Fermer") + '">✕</button></div>' +
      '<p class="ida-small" data-cgc-status aria-live="polite" hidden></p>' +
      '<div class="ida-stack" data-cgc-view="camera" hidden><div class="ida-cgc-stage"><video data-cgc-video autoplay playsinline muted></video></div>' +
      '<div class="ida-cluster"><button type="button" class="ida-btn ida-btn--primary" data-cgc-shutter disabled>' + t("Capturer") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--ghost" data-cgc-cancel>' + t("Annuler") + '</button></div></div>' +
      '<div class="ida-stack" data-cgc-view="paste" hidden><div class="ida-cgc-paste-target" tabindex="0" role="textbox" aria-label="' + t("Zone de collage") + '" data-cgc-paste-target>' + t("Appuyez sur Ctrl+V (ou ⌘+V) pour coller l'image de la carte grise.") + '</div>' +
      '<div class="ida-cluster" data-cgc-text-offer hidden><button type="button" class="ida-btn ida-btn--secondary ida-btn--sm" data-cgc-keep-text>' + t("Enregistrer ce texte comme source texte") + '</button></div>' +
      '<div class="ida-cluster"><button type="button" class="ida-btn ida-btn--ghost" data-cgc-cancel>' + t("Annuler") + '</button></div></div>' +
      '<div class="ida-stack" data-cgc-view="preview" hidden><div data-cgc-preview></div><p class="ida-caption" data-cgc-meta></p>' +
      '<label class="ida-small">' + t("Face") + ' <select class="ida-select ida-select--sm" data-cgc-face><option value="1">' + t("Recto") + '</option><option value="2">' + t("Verso") + '</option></select></label>' +
      '<div class="ida-cluster"><button type="button" class="ida-btn ida-btn--primary" data-cgc-confirm>' + t("Confirmer et enregistrer") + '</button>' +
      '<button type="button" class="ida-btn ida-btn--secondary" data-cgc-again></button>' +
      '<button type="button" class="ida-btn ida-btn--ghost" data-cgc-cancel>' + t("Annuler") + '</button></div></div>' +
      '<div class="ida-stack" data-cgc-view="done" hidden><p class="ida-alert ida-alert--success ida-small" data-cgc-done-msg></p>' +
      '<div class="ida-cluster"><button type="button" class="ida-btn ida-btn--secondary" data-cgc-close>' + t("Fermer") + '</button></div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-cgc-file hidden></div>';
  }
  function mount() {
    var r = document.querySelector("[data-cgc-root]");
    if (!r) { r = el("div", { "data-cgc-root": "", class: "ida-scan", role: "dialog", "aria-modal": "true", "aria-labelledby": "cgc-title", hidden: true }); document.body.appendChild(r); }
    if (!r.firstChild) r.innerHTML = template();
    st.root = r;
    if (r.getAttribute("data-cgc-bound")) return;
    r.setAttribute("data-cgc-bound", "1");
    r.addEventListener("click", function (e) {
      if (e.target.closest("[data-cgc-close]") || e.target.closest("[data-cgc-cancel]") || e.target === r) return close();
      if (e.target.closest("[data-cgc-shutter]")) return capture();
      if (e.target.closest("[data-cgc-confirm]")) return confirm();
      if (e.target.closest("[data-cgc-again]")) return start(st.method, st.opts);
      if (e.target.closest("[data-cgc-keep-text]")) return keepText();
      if (e.target.closest("[data-cgc-fallback-file]")) return start("file", st.opts);
    });
    q("[data-cgc-file]").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) fromFile(f); else if (!st.item) close(); });
    q("[data-cgc-paste-target]").addEventListener("paste", onPaste);
    r.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
  function show() { st.root.hidden = false; st.root.setAttribute("aria-hidden", "false"); }
  function close() {
    stopCamera();
    st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); st.urls = []; st.item = null;
    if (st.root) { st.root.hidden = true; st.root.setAttribute("aria-hidden", "true"); }
  }

  // ---- entry: each method starts at once, from the click itself (camera, picker and clipboard need that gesture) ---
  function start(method, opts) {
    mount(); st.opts = opts || st.opts || {}; st.method = method; st.item = null; say("");
    var again = q("[data-cgc-again]");
    again.textContent = method === "camera" ? t("Reprendre") : method === "paste" ? t("Coller une autre image") : t("Choisir un autre fichier");
    if (method === "camera") return openCamera();
    if (method === "paste") return paste();
    // file: the system picker, nothing else; the dialog appears only with the preview
    stopCamera(); q("[data-cgc-file]").click();
  }

  // ---- 1. camera ------------------------------------------------------------------------------------------------------
  function stopCamera() { if (st.stream) { st.stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} }); st.stream = null; } var v = st.root && q("[data-cgc-video]"); if (v) v.srcObject = null; }
  async function openCamera() {
    view("camera"); show();
    var v = q("[data-cgc-video]"), shutter = q("[data-cgc-shutter]"); shutter.disabled = true;
    var md = g().navigator && g().navigator.mediaDevices;
    if (!md || !md.getUserMedia) return cameraFailed("unsupported");
    try {
      try { st.stream = await md.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false }); }
      catch (e) { if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw e; st.stream = await md.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
      v.srcObject = st.stream; await v.play().catch(function () {});
      var waited = 0; while (!v.videoWidth && waited < 4000) { await new Promise(function (r) { setTimeout(r, 100); }); waited += 100; }
      shutter.disabled = false; say(t("Cadrez la carte grise entière, puis capturez."));
    } catch (e) { cameraFailed(e && e.name); }
  }
  function cameraFailed(reason) {
    stopCamera(); view("camera");
    var msg = reason === "NotAllowedError" || reason === "SecurityError" ? t("L'accès à la caméra a été refusé. Autorisez-le dans le navigateur, ou importez un fichier.")
      : reason === "NotFoundError" || reason === "OverconstrainedError" ? t("Aucune caméra n'est disponible sur cet appareil. Importez un fichier.")
      : t("La caméra n'a pas pu être ouverte. Importez un fichier.");
    say(msg, "error");
    var box = q("[data-cgc-view=camera] .ida-cluster");
    if (!q("[data-cgc-fallback-file]")) box.insertBefore(el("button", { type: "button", class: "ida-btn ida-btn--secondary", "data-cgc-fallback-file": "" }, t("Importer un fichier")), box.firstChild);
    q("[data-cgc-shutter]").disabled = true;
  }
  async function capture() {
    var v = q("[data-cgc-video]"); if (!st.stream || !v.videoWidth) return;
    q("[data-cgc-shutter]").disabled = true;
    var blob = null, track = st.stream.getVideoTracks()[0];
    // the camera's own photograph when the browser offers it (full sensor resolution, as the camera encodes it)
    if (g().ImageCapture && track) { try { blob = await new g().ImageCapture(track).takePhoto(); } catch (e) { blob = null; } }
    if (!blob) {   // otherwise the full frame, losslessly (PNG): no recompression of the archival original
      var c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
      blob = await new Promise(function (r) { c.toBlob(r, "image/png"); });
    }
    stopCamera();
    var stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    preview({ blob: blob, type: blob.type || "image/png", method: "camera", name: "carte-grise-" + stamp + (blob.type === "image/jpeg" ? ".jpg" : ".png") });
  }

  // ---- 2. file --------------------------------------------------------------------------------------------------------
  async function fromFile(f) {
    var head = new Uint8Array(await f.slice(0, 5).arrayBuffer()), pdf = String.fromCharCode.apply(null, head) === "%PDF-";
    show();
    if (!pdf && IMAGE_TYPES.indexOf(f.type) === -1) { view("preview"); clear(q("[data-cgc-preview]")); q("[data-cgc-meta]").textContent = ""; q("[data-cgc-confirm]").disabled = true; return say(t("Type de fichier non accepté : JPEG, PNG, WebP ou PDF."), "error"); }
    if (f.size > (pdf ? LIMITS.pdf : LIMITS.image)) { view("preview"); clear(q("[data-cgc-preview]")); q("[data-cgc-confirm]").disabled = true; return say(t("Fichier trop volumineux.") + " (" + kb(f.size) + ")", "error"); }
    preview({ blob: f, type: pdf ? "application/pdf" : f.type, method: "upload", name: f.name || null });
  }

  // ---- 3. clipboard ---------------------------------------------------------------------------------------------------
  async function paste() {
    var clip = g().navigator && g().navigator.clipboard;
    if (clip && typeof clip.read === "function") {
      try {
        var items = await clip.read();
        for (var i = 0; i < items.length; i++) {
          var type = items[i].types.filter(function (x) { return IMAGE_TYPES.indexOf(x) !== -1; })[0];
          if (type) { var b = await items[i].getType(type); return preview({ blob: b, type: type, method: "paste_image", name: null }); }
        }
        var tt = items.some(function (it) { return it.types.indexOf("text/plain") !== -1; });
        if (tt) { var tb = await items.filter(function (it) { return it.types.indexOf("text/plain") !== -1; })[0].getType("text/plain"); return textInClipboard(await tb.text()); }
        return pasteTarget(t("Le presse-papiers ne contient pas d'image. Copiez l'image de la carte grise, puis appuyez sur Ctrl+V ici."));
      } catch (e) { /* not allowed or not supported here: the Ctrl+V target below */ }
    }
    pasteTarget(null);
  }
  function pasteTarget(msg) {
    view("paste"); show(); q("[data-cgc-text-offer]").hidden = true; say(msg || "");
    var tgt = q("[data-cgc-paste-target]"); tgt.focus();
  }
  function onPaste(e) {
    var dt = e.clipboardData; if (!dt) return;
    e.preventDefault();
    var img = Array.from(dt.items || []).filter(function (i) { return i.kind === "file" && IMAGE_TYPES.indexOf(i.type) !== -1; })[0];
    if (img) { var f = img.getAsFile(); if (f) return preview({ blob: f, type: f.type, method: "paste_image", name: null }); }
    var text = dt.getData && dt.getData("text/plain");
    if (text) return textInClipboard(text);
    say(t("Le presse-papiers ne contient pas d'image."), "error");
  }
  // text is NOT an image: said plainly; keeping it as a text source is a separate, explicit choice
  function textInClipboard(text) {
    view("paste"); show(); st.pendingText = text;
    say(t("Le presse-papiers contient du texte, pas une image de carte grise."), "error");
    q("[data-cgc-text-offer]").hidden = !(text && text.trim().length >= LIMITS.textMin);
  }
  function keepText() {
    var text = st.pendingText || ""; if (text.trim().length < LIMITS.textMin) return;
    preview({ blob: new Blob([new TextEncoder().encode(text)], { type: "text/plain;charset=utf-8" }), type: "text/plain; charset=utf-8", method: "paste_text", name: null, text: text });
  }

  // ---- the one preview ------------------------------------------------------------------------------------------------
  var TYPE_FR = { "image/jpeg": "Image JPEG", "image/png": "Image PNG", "image/webp": "Image WebP", "application/pdf": "PDF", "text/plain; charset=utf-8": "Texte" };
  function preview(item) {
    st.item = item; view("preview"); show(); say("");
    var box = clear(q("[data-cgc-preview]")), conf = q("[data-cgc-confirm]");
    if (/^image\//.test(item.type)) box.appendChild(el("img", { src: url(item.blob), alt: t("Aperçu de la carte grise"), class: "ida-cgc-preview", "data-cgc-preview-image": "" }));
    else if (item.type === "application/pdf") {
      var u = url(item.blob);
      box.appendChild(el("p", { class: "ida-cgc-doc", "data-cgc-preview-pdf": "" }, "PDF — " + (item.name || "document.pdf")));
      box.appendChild(el("a", { href: u, target: "_blank", rel: "noopener", class: "ida-btn ida-btn--ghost ida-btn--sm" }, t("Ouvrir l'aperçu du PDF")));
    } else box.appendChild(el("pre", { class: "ida-cgc-text", dir: "auto", "data-cgc-preview-text": "" }, item.text));
    q("[data-cgc-meta]").textContent = t(TYPE_FR[item.type] || item.type) + " · " + kb(item.blob.size) + (item.name ? " · " + item.name : "");
    conf.disabled = false; conf.focus();
  }

  // ---- upload, only on « Confirmer » ----------------------------------------------------------------------------------
  var REASONS = {
    carte_grise_exists: "Une carte grise est déjà enregistrée pour cette face : rien n'a été remplacé.",
    carte_grise_exists_new_version_required: "Une carte grise existe déjà : utilisez « Ajouter une nouvelle version ».",
    unsupported_type: "Type de fichier non accepté : JPEG, PNG, WebP ou PDF.", too_large: "Fichier trop volumineux.", too_small: "Image trop petite pour être lisible.",
    pdf_incomplete: "Ce PDF est incomplet ou endommagé.", pdf_encrypted: "Ce PDF est protégé par un mot de passe.", not_utf8: "Ce texte n'a pas pu être lu.", too_short: "Le texte est trop court.",
    face_1_required_first: "Ajoutez d'abord le recto (face 1)."
  };
  async function confirm() {
    var it = st.item, o = st.opts || {}; if (!it || st.busy) return;
    st.busy = true; var btn = q("[data-cgc-confirm]"); btn.disabled = true; say(t("Enregistrement…"));
    var h = { "Content-Type": it.type, "X-IDauto-Face": q("[data-cgc-face]").value === "2" ? "2" : "1", "X-IDauto-Input": it.method };
    if (it.name) h["X-IDauto-Filename"] = encodeURIComponent(it.name);
    if (o.mode !== "public") h["X-IDauto-Session"] = "1";
    if (o.newVersion) h["X-IDauto-New-Version"] = "1";
    try {
      var path = o.mode === "public" ? "/public/vehicles/" + encodeURIComponent(o.ivid) + "/carte-grise" : "/api/vehicles/" + encodeURIComponent(o.ivid) + "/carte-grise";
      var r = await fetch(path, { method: "POST", credentials: o.mode === "public" ? "omit" : "same-origin", headers: h, body: it.blob });
      var b = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        var why = b && b.details && b.details.reason || b.reason;
        throw new Error(r.status === 401 || r.status === 403 ? t("Connectez-vous pour enregistrer une carte grise.") : r.status === 429 ? t("Trop d'envois : réessayez plus tard.") : t(REASONS[why] || b.message_fr || "L'enregistrement n'a pas abouti."));
      }
      var dup = !!(b.duplicate_of || b.duplicate);
      q("[data-cgc-done-msg]").textContent = dup ? t("Ce document est déjà dans le dossier du véhicule : rien n'a été ajouté.")
        : o.mode === "public" ? t("Reçu — un administrateur le vérifiera avant de l'ajouter au dossier.") : t("Carte grise enregistrée dans le dossier du véhicule.");
      view("done"); say("");
      if (o.onDone) o.onDone({ duplicate: dup, document: b.document || null });
    } catch (e) { say(e.message, "error"); btn.disabled = false; }
    finally { st.busy = false; }
  }

  return { start: start, close: close, LIMITS: LIMITS, _state: st, _fromFile: fromFile, _onPaste: onPaste, _textInClipboard: textInClipboard };
});
