/* IDauto — Update 3 / 3.1 — ONE analysis of a vehicle photograph, shared by the workshop page
 * (« Ajouter un véhicule ») and the public homepage scanner. Neither page has its own pipeline.
 *
 *   prepare(file, taken, livePosition) → { canvas, blob, url, location, capturedAt }
 *     reads the file's EXIF (GPS, date) BEFORE reducing it to 1600 px JPEG (the reduced copy carries no
 *     hidden metadata), and chooses the photograph's location: EXIF → device position (only for a photograph
 *     taken here, only if allowed) → none. A chosen file never receives the device's position.
 *   analyse(prepared, { visionUrl, visionEnabled, post }) → { analysis, view, plateSeen, plateDisagree, visionError }
 *     the plate is looked for on the whole photograph and read on the device (plate-scanner.js); the colour
 *     hint is computed on the device; when the vision analysis is enabled the photograph is posted to the
 *     page's own server route (the workshop route or the public one) for make, model, version, body type,
 *     view and a second reading of the plate. Nothing is invented: what is not recognised stays empty.
 *   askPosition() → Promise<{latitude, longitude, accuracy}|null> — never rejects; a refusal is null.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPhotoAnalysis = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MAX_EDGE = 1600;
  function g() { return typeof self !== "undefined" ? self : globalThis; }

  function askPosition() {
    var nav = g().navigator;
    if (!nav || !nav.geolocation) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false, timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 12000);
      nav.geolocation.getCurrentPosition(function (pos) {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
      }, function () { if (done) return; done = true; clearTimeout(timer); resolve(null); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    });
  }

  async function prepare(file, taken, livePosition) {
    var M = g().IdaPhotoMeta;
    if (!file || !/^image\//.test(file.type || "")) throw new Error("not_an_image");
    var exif = /jpe?g/i.test(file.type) && M ? M.readExif(await file.arrayBuffer()) : { latitude: null, longitude: null, capturedAt: null };
    var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    var s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.85); });
    // Update 3.2 — a photograph that cannot be analysed is said so at once, never silently analysed
    var quality = assess(c, bmp);
    var live = taken && livePosition ? await livePosition : null;
    return { canvas: c, quality: quality, blob: blob, url: URL.createObjectURL(blob), location: M ? M.chooseLocation(exif, live, !!taken) : null,
      capturedAt: exif.capturedAt || (taken ? new Date().toISOString() : null) };
  }

  // Too small, too dark, washed out or flat (no edges at all: a blurred or covered lens) → { ok: false, reason }.
  // Measured on a 160 px thumbnail; the thresholds only reject images nothing could be read from.
  function assess(c, bmp) {
    var minEdge = Math.min(bmp.width, bmp.height);
    if (minEdge < 400) return { ok: false, reason: "too_small" };
    var t = document.createElement("canvas"), w = 160, h = Math.max(1, Math.round(160 * c.height / c.width));
    t.width = w; t.height = h; var x = t.getContext("2d", { willReadFrequently: true }); x.drawImage(c, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, sum = 0, sq = 0, edge = 0, n = w * h, L = new Float32Array(n);
    for (var i = 0; i < n; i++) { L[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; sum += L[i]; sq += L[i] * L[i]; }
    for (var y = 1; y < h - 1; y++) for (var k = 1; k < w - 1; k++) { var j = y * w + k; edge += Math.abs(4 * L[j] - L[j - 1] - L[j + 1] - L[j - w] - L[j + w]); }
    var mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)), sharp = edge / ((w - 2) * (h - 2));
    if (mean < 18) return { ok: false, reason: "too_dark", mean: Math.round(mean) };
    if (mean > 245) return { ok: false, reason: "overexposed", mean: Math.round(mean) };
    if (sd < 8 || sharp < 1.5) return { ok: false, reason: "no_detail", contrast: Math.round(sd), sharpness: Math.round(sharp * 10) / 10 };
    return { ok: true, mean: Math.round(mean), contrast: Math.round(sd), sharpness: Math.round(sharp * 10) / 10 };
  }

  // the paint colour measured on the photograph's own pixels, inside the paint-only area the vision analysis pointed at
  function measurePaint(canvas, box) {
    var D = g().IdaPlateDetector;
    if (!D || !D.paintColour || !box || !canvas) return null;
    try {
      var w = Math.min(640, canvas.width), h = Math.round(canvas.height * w / canvas.width), t = document.createElement("canvas");
      t.width = w; t.height = h; var x = t.getContext("2d", { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h);
      return D.paintColour(x.getImageData(0, 0, w, h).data, w, h, box);
    } catch (e) { return null; }
  }
  // Two independent judgements of the paint: the vision model's and the pixels'. Agreement → recognised; grey vs silver →
  // the model's word, uncertain; any other disagreement → unknown, both candidates kept for the person to choose.
  function mergeColour(vc, px, cam) {
    var fam = function (c) { return c === "argent" ? "gris" : c; };
    var pv = px && px.value && px.value !== "unknown" ? px.value : null, vv = vc && vc.value ? vc.value : null;
    if (vv && pv) {
      if (vv === pv) return { value: vv, confidence: Math.max(vc.confidence, px.confidence), source: "vision+pixels", status: "recognised", pixels: px };
      if (fam(vv) === fam(pv)) return { value: vv, confidence: Math.min(vc.confidence, px.confidence), source: "vision+pixels", status: "uncertain", pixels: px };
      return { value: null, confidence: 0, source: "vision+pixels", status: "unknown", candidates: [vv, pv], pixels: px };
    }
    if (vv) return { value: vv, confidence: vc.confidence, source: "vision", status: vc.status === "recognised" ? "uncertain" : vc.status, pixels: px || null };   // one judgement alone is never "recognised"
    if (pv) return { value: pv, confidence: px.confidence, source: "pixels", status: "uncertain", pixels: px };
    return cam || { value: null, confidence: 0, source: "vision", status: "unknown" };
  }

  async function analyse(prep, opts) {
    opts = opts || {};
    var S = g().IdaPlateScanner, out = { analysis: { plate: null, fields: {}, provider: null, model: null, vehicle_visible: null }, view: null, plateSeen: false, plateDisagree: null, visionError: null };
    var a = out.analysis, ocr = null;
    if (prep.quality && !prep.quality.ok) { out.rejected = prep.quality.reason; return out; }
    try { ocr = S && S.analyzeStill ? await S.analyzeStill(prep.canvas) : null; } catch (e) { ocr = null; }
    // Update 3.2 — a plate is « recognised » only when TWO independent readings agree (the device's OCR and the vision
    // model's). One reading alone, however confident, is « to check »: measured 2026-11-16 on 50 phone-size scenes, the
    // OCR alone accepted 14 plates of which 3 were wrong (a digit dropped at a distance — « 246 » read « 26 » at 99 %).
    if (ocr && ocr.read && ocr.read.parsed && ocr.read.parsed.exact) a.plate = { serie: ocr.read.parsed.serie, numero: ocr.read.parsed.numero, confidence: Math.round(ocr.read.confidence), source: "ocr", accepted: false, ocrConfident: !!ocr.accepted };
    out.plateSeen = !!(ocr && ocr.box);
    if (ocr && ocr.colour && ocr.colour.value && ocr.colour.value !== "unknown") a.fields.colour = { value: ocr.colour.value, confidence: ocr.colour.confidence, source: "camera" };
    if (opts.visionEnabled && opts.visionUrl && typeof opts.post === "function") {
      try {
        var v = (await opts.post(opts.visionUrl, prep.blob)).vehicle_analysis;
        out.visionError = v && v.error ? v.error : null;
        if (v && v.enabled && !v.error) {
          a.provider = v.provider || null; a.model = v.model || null; a.vehicle_visible = v.vehicle_visible;
          var camColour = a.fields.colour || null;
          Object.keys(v.fields || {}).forEach(function (f) { if (v.fields[f] && v.fields[f].value) a.fields[f] = v.fields[f]; else if (f !== "colour") delete a.fields[f]; });
          a.evidence = v.evidence || null;
          a.fields.colour = mergeColour(v.fields && v.fields.colour, measurePaint(prep.canvas, v.paint_box), camColour);
          if (v.view === "front" || v.view === "rear") out.view = v.view;
          // the device's reading and the model's: agreement confirms; disagreement is shown, never settled silently
          if (v.plate) {
            if (!a.plate) a.plate = { serie: v.plate.serie, numero: v.plate.numero, confidence: v.plate.confidence, source: "vision", accepted: false };
            else if (a.plate.serie !== v.plate.serie || a.plate.numero !== v.plate.numero) { a.plate.accepted = false; out.plateDisagree = v.plate.serie + " " + v.plate.numero; }
            else { a.plate.accepted = true; a.plate.source = "ocr+vision"; a.plate.confidence = Math.max(a.plate.confidence, v.plate.confidence); }
          }
        }
      } catch (e) { out.visionError = "unreachable"; }
    }
    return out;
  }

  return { prepare: prepare, analyse: analyse, assess: assess, mergeColour: mergeColour, askPosition: askPosition, MAX_EDGE: MAX_EDGE };
});
