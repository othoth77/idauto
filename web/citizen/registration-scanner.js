/* IDauto — carte grise scanner (IDA-V14)
 * ============================================================================
 *   CAPTURE (camera / gallery / clipboard paste) → DOCUMENT SCANNER (Scanic: corners + perspective,
 *   manual 4-corner fallback) → IMAGE OPTIMISATION (EXIF rotation, resize,
 *   JPEG, thumbnail) → FACE 1 / FACE 2 → OCR (Tesseract.js fra+ara, in a
 *   worker) → FIELD PARSER (server, shared parser) → CONFIDENCE / CONFLICT →
 *   USER CONFIRMATION → VEHICLE (resolver.confirm on the server) → PASSEPORT.
 *
 * Everything heavy runs in the browser: the phone photo (MB) never leaves the
 * device — only the optimised document image (a few hundred KB) and the OCR
 * text (parsed on the server, never stored) are sent. Nothing is persisted
 * in the browser; previews are blob: URLs revoked when the dialog closes.
 * Face 2 is always optional.
 *
 * Libraries (vendored, same-origin, see docs/ARCHITECTURE.md §12):
 *   Scanic 1.6.0 (MIT) — classical detector only, wasm inlined, no network.
 *   Tesseract.js (Apache-2.0) + fra/ara tessdata (Apache-2.0).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaRegistrationScanner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var root = typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this);

  var cfg = { engineBase: "/atelier/assets/tesseract/", scanicUrl: "/atelier/assets/scanic.umd.js", maxEdge: 1600, quality: 0.85, thumbEdge: 480, thumbQuality: 0.7, processEdge: 1400, minDetectionConfidence: 0.55, languages: "fra+ara" };
  var state = { els: null, ivid: null, onDone: null, pasteTarget: null, faces: { 1: null, 2: null }, worker: null, workerLoading: null, scanicLoading: null, editor: null, ocrResult: null, urls: [] };
  var STEPS = ["capture", "detect", "correct", "ocr", "analyse", "save"];
  var STEP_FR = { capture: "Capture", detect: "Détection", correct: "Correction", ocr: "OCR", analyse: "Analyse", save: "Enregistrement" };

  function configure(o) { Object.keys(o || {}).forEach(function (k) { if (k in cfg) cfg[k] = o[k]; }); }
  function el(sel) { return state.els.root.querySelector("[data-cg-" + sel + "]"); }
  function show(name) { ["faces", "editor", "progress", "result", "error"].forEach(function (n) { var e = el(n); if (e) e.hidden = n !== name; }); }
  function status(msg) { var s = el("status"); if (s) s.textContent = msg || ""; }
  function blobUrl(blob) { var u = URL.createObjectURL(blob); state.urls.push(u); return u; }
  function revokeAll() { state.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); state.urls = []; }

  /* ---------------- libraries ---------------- */
  function loadScript(src) { return new Promise(function (resolve, reject) { var s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("script_failed:" + src)); }; document.head.appendChild(s); }); }
  function loadScanic() {
    if (root.scanic) return Promise.resolve(root.scanic);
    if (!state.scanicLoading) state.scanicLoading = loadScript(cfg.scanicUrl).then(function () { if (!root.scanic) throw new Error("scanic_failed"); return root.scanic; }).catch(function (e) { state.scanicLoading = null; throw e; });
    return state.scanicLoading;
  }
  function loadOcr(onProgress) {
    if (state.worker) return Promise.resolve(state.worker);
    if (state.workerLoading) return state.workerLoading;
    state.workerLoading = (root.Tesseract ? Promise.resolve() : loadScript(cfg.engineBase + "tesseract.min.js")).then(function () {
      return root.Tesseract.createWorker(cfg.languages, 1, { workerPath: cfg.engineBase + "worker.min.js", corePath: cfg.engineBase, langPath: cfg.engineBase, workerBlobURL: false, gzip: true,
        logger: function (m) { if (onProgress && m && typeof m.progress === "number") onProgress(m); } });
    }).then(function (w) { return w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }).then(function () { state.worker = w; return w; }); })
      .catch(function (e) { state.workerLoading = null; throw e; });
    return state.workerLoading;
  }

  /* ---------------- image pipeline ---------------- */
  // 1. decode with the EXIF orientation applied, downscaled for processing.
  async function decode(file) {
    var bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { throw new Error("decode_failed"); }
    var scale = Math.min(1, cfg.processEdge / Math.max(bitmap.width, bitmap.height));
    var c = document.createElement("canvas"); c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
    c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close && bitmap.close();
    if (c.width < 300 && c.height < 300) throw new Error("too_small");
    return c;
  }
  // 2. detect the card and correct the perspective. → { canvas, detection:'auto'|'manual'|'none', corners }
  async function detect(canvas) {
    var scanic = await loadScanic();
    var r = await scanic.scanDocument(canvas, { mode: "extract", output: "canvas", minDetectionConfidence: cfg.minDetectionConfidence });
    if (r && r.success && r.output && r.output.width > 200 && r.output.height > 120) return { canvas: r.output, detection: "auto", corners: r.corners, confidence: r.confidence };
    return { canvas: null, detection: "none", corners: r && r.corners ? r.corners : null };
  }
  // 3. optimise: resize to maxEdge, light contrast/brightness, JPEG.
  function optimise(canvas, maxEdge, quality) {
    var scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(canvas.width * scale)); c.height = Math.max(1, Math.round(canvas.height * scale));
    var ctx = c.getContext("2d");
    try { ctx.filter = "contrast(1.08) brightness(1.03)"; } catch (e) {}
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return new Promise(function (resolve) { c.toBlob(function (b) { resolve({ blob: b, width: c.width, height: c.height, canvas: c }); }, "image/jpeg", quality); });
  }
  async function processFile(file, faceNo, forcedCorners) {
    setStep("capture"); status("Lecture de la photo…");
    var src = await decode(file);
    setStep("detect"); status("Détection de la carte…");
    var det;
    if (forcedCorners) { var scanic = await loadScanic(); var ex = await scanic.extractDocument(src, forcedCorners, { output: "canvas" }); det = { canvas: ex && ex.output ? ex.output : src, detection: "manual", corners: forcedCorners }; }
    else det = await detect(src);
    if (!det.canvas) return { needsCorners: true, source: src, corners: det.corners, file: file };
    setStep("correct"); status("Correction et optimisation…");
    var archive = await optimise(det.canvas, cfg.maxEdge, cfg.quality);
    var thumb = await optimise(det.canvas, cfg.thumbEdge, cfg.thumbQuality);
    return { face: faceNo, file: file, archive: archive, thumb: thumb, detection: det.detection, originalBytes: file.size, done: true };
  }

  /* ---------------- manual corners (fallback) ---------------- */
  function openEditor(pending, faceNo) {
    var host = el("editor-host"); host.textContent = "";
    var img = document.createElement("img"); img.src = pending.source.toDataURL("image/jpeg", 0.8); img.alt = "Photo à recadrer";
    show("editor"); el("editor-note").textContent = "Ajustez les coins de la carte grise (face " + faceNo + ").";
    img.onload = function () {
      loadScanic().then(function (scanic) {
        if (state.editor) { try { state.editor.destroy(); } catch (e) {} }
        state.editor = scanic.createCornerEditor({ container: host, image: img, corners: pending.corners || undefined, magnifier: { zoom: 2, size: 110 }, nudges: { enabled: true, steps: [1, 5] },
          onConfirm: function (corners) { try { state.editor.destroy(); } catch (e) {} state.editor = null; runFace(pending.file, faceNo, corners); },
          onCancel: function () { try { state.editor.destroy(); } catch (e) {} state.editor = null; show("faces"); } });
      }).catch(function () { fail("Le recadrage manuel n'est pas disponible.", "Reprenez la photo en cadrant la carte entière sur un fond contrasté."); });
    };
  }

  /* ---------------- faces UI ---------------- */
  function renderFaces() {
    [1, 2].forEach(function (n) {
      var f = state.faces[n], prev = el("preview-" + n), meta = el("meta-" + n), redo = el("redo-" + n), pick = el("pick-" + n);
      if (f) { prev.src = blobUrl(f.archive.blob); prev.hidden = false; meta.textContent = f.archive.width + "×" + f.archive.height + " · " + Math.round(f.archive.blob.size / 1024) + " Ko (photo : " + Math.round(f.originalBytes / 1024) + " Ko) · " + (f.detection === "auto" ? "Carte détectée" : "Recadrage manuel"); redo.hidden = false; pick.hidden = true; }
      else { prev.hidden = true; prev.removeAttribute("src"); meta.textContent = n === 2 ? "Optionnel" : ""; redo.hidden = true; pick.hidden = false; }
    });
    el("validate").disabled = !state.faces[1];
    el("finish-1").hidden = !(state.faces[1] && !state.faces[2]);
  }
  async function runFace(file, faceNo, corners) {
    show("progress"); resetSteps();
    try {
      var r = await processFile(file, faceNo, corners);
      if (r.needsCorners) { el("detect-flag").textContent = "Ajustez les coins"; openEditor(r, faceNo); return; }
      el("detect-flag").textContent = "Carte détectée";
      state.faces[faceNo] = r; renderFaces(); show("faces"); status("Face " + faceNo + " prête." + (faceNo === 1 ? " Vous pouvez ajouter le verso (optionnel) ou valider." : ""));
    } catch (e) {
      var reason = e && e.message ? String(e.message) : "";
      if (reason === "too_small") fail("Photo trop petite", "Prenez une photo plus proche de la carte.");
      else if (reason === "decode_failed") fail("Photo illisible", "Le fichier n'a pas pu être lu comme une image. Réessayez ou choisissez un autre fichier.");
      else if (/scanic|script_failed/.test(reason)) fail("Détection indisponible", "Le module de détection n'a pas pu être chargé. Réessayez ; en cas d'échec, reprenez la photo bien cadrée.");
      else fail("Traitement impossible", "La photo n'a pas pu être traitée (" + reason.slice(0, 80) + "). Réessayez ou choisissez un autre fichier.");
    }
  }
  function onPick(faceNo, input) { var f = input.files && input.files[0]; input.value = ""; if (!f) return; if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) return fail("Fichier refusé", "Choisissez une image (JPEG, PNG, WebP)."); if (faceNo === 2 && !state.faces[1]) return fail("Face 1 d'abord", "Scannez le recto avant le verso."); runFace(f, faceNo, null); }

  /* ---------------- clipboard (IDA-V14) ----------------
   * A pasted image follows EXACTLY the camera / gallery path: the File goes
   * to onPick(), so detection, crop, rotation, compression, OCR, proposal
   * and confirmation are the same code. The clipboard original is never
   * kept: it lives in the event for the duration of the call, nothing else.
   * Text, HTML or non-image files are refused with a message. */
  function imageFromClipboardItems(items) {
    if (!items) return null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === "file" && /^image\//.test(it.type || "")) { var f = it.getAsFile(); if (f) return f; }
    }
    return null;
  }
  function targetFaceForPaste() {
    if (state.pasteTarget === 1 || state.pasteTarget === 2) return state.pasteTarget;
    return state.faces[1] ? 2 : 1;   // Ctrl+V with no face chosen: the first empty face
  }
  function onPasteEvent(e) {
    if (!state.els || !state.els.root || state.els.root.hidden) return;
    var dt = e.clipboardData;
    var file = imageFromClipboardItems(dt && dt.items);
    if (!file && dt && dt.files && dt.files.length) { var f0 = dt.files[0]; if (/^image\//.test(f0.type || "")) file = f0; }
    e.preventDefault();
    if (!file) {
      var hasText = dt && (dt.getData && (dt.getData("text/plain") || dt.getData("text/html")));
      return fail("Aucune image dans le presse-papiers", hasText ? "Le presse-papiers contient du texte, pas une image. Copiez une image (capture d'écran ou photo) puis collez à nouveau." : "Copiez une image puis appuyez sur Ctrl+V, ou utilisez la caméra ou la galerie.");
    }
    var faceNo = targetFaceForPaste();
    state.pasteTarget = null;
    if (faceNo === 2 && !state.faces[1]) return fail("Face 1 d'abord", "Scannez ou collez le recto avant le verso.");
    if (state.faces[faceNo]) { state.faces[faceNo] = null; }
    // Same entry point as the file inputs — a named File so the rest of the pipeline sees one shape.
    var named = file.name ? file : new File([file], "clipboard." + ((file.type || "image/png").split("/")[1] || "png"), { type: file.type || "image/png" });
    onPick(faceNo, { files: [named], value: "" });
  }
  async function pasteButton(faceNo) {
    if (faceNo === 2 && !state.faces[1]) { state.pasteTarget = null; return fail("Face 1 d'abord", "Scannez ou collez le recto avant le verso."); }
    state.pasteTarget = faceNo;
    // Async Clipboard API when the browser grants it (secure context, user gesture); otherwise wait for Ctrl+V.
    if (navigator.clipboard && typeof navigator.clipboard.read === "function") {
      try {
        var items = await navigator.clipboard.read();
        for (var i = 0; i < items.length; i++) {
          var type = (items[i].types || []).filter(function (t) { return /^image\//.test(t); })[0];
          if (type) { var blob = await items[i].getType(type); var file = new File([blob], "clipboard." + (type.split("/")[1] || "png"), { type: type }); state.pasteTarget = null; return onPick(faceNo, { files: [file], value: "" }); }
        }
        return fail("Aucune image dans le presse-papiers", "Copiez une image (capture d'écran ou photo) puis réessayez, ou appuyez sur Ctrl+V.");
      } catch (e) { /* permission refused or API unavailable: fall back to Ctrl+V */ }
    }
    status("Appuyez sur Ctrl+V (ou Cmd+V) pour coller l'image de la face " + faceNo + ".");
  }

  /* ---------------- progress ---------------- */
  function resetSteps() { STEPS.forEach(function (s) { var li = el("step-" + s); if (li) { li.textContent = STEP_FR[s]; li.className = "ida-cg-step"; } }); }
  function setStep(s) { var seen = false; STEPS.forEach(function (k) { var li = el("step-" + k); if (!li) return; if (k === s) { li.className = "ida-cg-step is-active"; li.textContent = STEP_FR[k] + "…"; seen = true; } else if (!seen) { li.className = "ida-cg-step is-done"; li.textContent = "✓ " + STEP_FR[k]; } }); }
  function fail(title, body) { state.pasteTarget = null; el("error-title").textContent = title; el("error-body").textContent = body; show("error"); }

  /* ---------------- upload + OCR ---------------- */
  async function api(method, path, body, headers) {
    var h = Object.assign({ Accept: "application/json", "X-IDauto-Session": "1" }, headers || {});
    if (body && !(body instanceof Blob)) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    var res = await fetch(path, { method: method, credentials: "same-origin", headers: h, body: body });
    var json = null; try { json = await res.json(); } catch (e) {}
    if (res.status === 401) { location.replace("/login?next=" + encodeURIComponent("/atelier")); throw new Error("unauthenticated"); }
    if (!res.ok) throw new Error((json && json.message_fr) || "Le service a répondu " + res.status + ".");
    return json;
  }
  async function ocrFace(f, onProgress) {
    var worker = await loadOcr(onProgress);
    var r = await worker.recognize(f.archive.canvas);
    var text = r && r.data ? r.data.text : "";
    var conf = r && r.data && typeof r.data.confidence === "number" ? r.data.confidence : 0;
    return { face: f.face, text: text, confidence: conf };
  }
  async function validate() {
    var base = "/api/vehicles/" + encodeURIComponent(state.ivid) + "/registration-document";
    show("progress"); resetSteps();
    try {
      setStep("save"); status("Enregistrement des faces…");
      var faces = [1, 2].filter(function (n) { return state.faces[n]; });
      for (var i = 0; i < faces.length; i++) {
        var f = state.faces[faces[i]];
        await api("PUT", base + "/" + f.face, f.archive.blob, { "Content-Type": "image/jpeg", "X-IDauto-Original-Bytes": String(f.originalBytes), "X-IDauto-Capture": f.detection, "X-IDauto-Quality": String(cfg.quality), "X-IDauto-Max-Edge": String(cfg.maxEdge) });
        await api("PUT", base + "/" + f.face + "/thumbnail", f.thumb.blob, { "Content-Type": "image/jpeg" });
      }
      setStep("ocr"); status("Lecture du texte (OCR)… première utilisation : chargement du moteur.");
      var reads = [];
      for (var j = 0; j < faces.length; j++) reads.push(await ocrFace(state.faces[faces[j]], function (m) { if (m.status === "recognizing text") status("OCR face " + faces[j] + " : " + Math.round(m.progress * 100) + " %"); else status(m.status || "OCR…"); }));
      setStep("analyse"); status("Analyse des informations…");
      var result = await api("POST", base + "/ocr", { faces: reads });
      state.ocrResult = result;
      renderResult(result);
      show("result");
    } catch (e) {
      if (e && e.message === "unauthenticated") return;
      // The faces are stored even when OCR fails: the person can fill the fiche by hand.
      fail("Informations non extraites", (e && e.message) || "L'OCR n'a pas abouti. Les faces sont enregistrées ; complétez la fiche à la main.");
      el("error-close").textContent = "Fermer";
    }
  }
  var KEY_FR = { plate: "Plaque", manufacturer: "Marque", model: "Modèle / type", year: "Année", fuel_type: "Énergie", engine_cc: "Cylindrée", seats: "Places", gross_weight_kg: "Poids total (kg)", category_code: "Catégorie", engine_code: "Moteur", vin: "VIN" };
  function renderResult(result) {
    var tbl = el("result-rows"); tbl.textContent = "";
    var items = result.comparison.items;
    items.forEach(function (it) {
      var tr = document.createElement("tr"); tr.className = "ida-cg-row is-" + it.status;
      var td1 = document.createElement("th"); td1.scope = "row"; td1.textContent = KEY_FR[it.key] || it.key;
      var td2 = document.createElement("td"); td2.textContent = it.proposed === null || it.proposed === undefined ? "—" : String(it.proposed);
      var td3 = document.createElement("td"); td3.textContent = it.status === "same" ? "identique" : it.status === "new" ? "nouveau" : "conflit — actuel : " + it.current;
      var td4 = document.createElement("td"); var cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("data-cg-accept", it.key); cb.checked = it.status !== "conflict"; cb.disabled = it.status === "same"; cb.setAttribute("aria-label", "Accepter " + (KEY_FR[it.key] || it.key)); td4.appendChild(cb);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tbl.appendChild(tr);
    });
    el("result-conf").textContent = "Confiance OCR : " + Math.round((result.confidence || 0) * 100) + " %" + (result.comparison.conflicts ? " · " + result.comparison.conflicts + " conflit(s) : rien n'est remplacé sans votre accord." : "") + (result.warnings && result.warnings.length ? " · " + result.warnings.join(", ") : "");
    el("result-none").hidden = items.length > 0;
  }
  async function confirm() {
    var result = state.ocrResult; if (!result) return;
    var accepted = {}, plate, vin;
    result.comparison.items.forEach(function (it) {
      var cb = el("result-rows").querySelector("[data-cg-accept='" + it.key + "']");
      if (!cb || !cb.checked || it.status === "same") return;
      if (it.key === "plate") plate = it.proposed; else if (it.key === "vin") vin = it.proposed; else accepted[it.key] = it.proposed;
    });
    show("progress"); resetSteps(); setStep("save"); status("Enregistrement…");
    try {
      var r = await api("POST", "/api/vehicles/" + encodeURIComponent(state.ivid) + "/registration-document/confirm", { candidate: accepted, plate: plate, vin: vin, confidence: result.confidence });
      status("Carte grise enregistrée.");
      close(); if (state.onDone) state.onDone({ vehicle: r.vehicle, document: true });
    } catch (e) { if (e && e.message !== "unauthenticated") fail("Enregistrement impossible", e.message || ""); }
  }
  function skipConfirm() { close(); if (state.onDone) state.onDone({ vehicle: null, document: true }); }

  /* ---------------- lifecycle ---------------- */
  function open(opts) {
    state.els = { root: opts.root }; state.ivid = opts.ivid; state.onDone = opts.onDone; state.faces = { 1: null, 2: null }; state.ocrResult = null;
    state.els.root.hidden = false; state.els.root.setAttribute("aria-hidden", "false");
    renderFaces(); show("faces"); status("Photographiez le recto (face 1). Le verso est optionnel."); el("detect-flag").textContent = "";
    var first = el("pick-1"); if (first) first.focus();
  }
  function close() { state.pasteTarget = null; revokeAll(); if (state.editor) { try { state.editor.destroy(); } catch (e) {} state.editor = null; } if (state.els && state.els.root) { state.els.root.hidden = true; state.els.root.setAttribute("aria-hidden", "true"); } }
  function bind(rootEl) {
    state.els = { root: rootEl };
    rootEl.addEventListener("change", function (e) { var t = e.target.closest("[data-cg-file]"); if (t) onPick(parseInt(t.getAttribute("data-cg-file"), 10), t); });
    rootEl.addEventListener("click", function (e) {
      var t = e.target.closest("[data-cg-action]"); if (!t) { if (e.target === rootEl) close(); return; }
      var a = t.getAttribute("data-cg-action");
      if (a === "close" || a === "cancel") return close();
      if (a === "paste-1") return pasteButton(1);
      if (a === "paste-2") return pasteButton(2);
      if (a === "redo-1") { state.faces[1] = null; renderFaces(); return; }
      if (a === "redo-2") { state.faces[2] = null; renderFaces(); return; }
      if (a === "validate" || a === "finish-1") return validate();
      if (a === "confirm") return confirm();
      if (a === "skip") return skipConfirm();
      if (a === "back") { show("faces"); return; }
    });
    rootEl.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); close(); } });
    document.addEventListener("paste", onPasteEvent);
  }

  return { configure: configure, open: open, close: close, bind: bind, optimise: optimise, processFile: processFile, cfg: cfg };
});
