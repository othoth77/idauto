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
    var live = taken && livePosition ? await livePosition : null;
    return { canvas: c, blob: blob, url: URL.createObjectURL(blob), location: M ? M.chooseLocation(exif, live, !!taken) : null,
      capturedAt: exif.capturedAt || (taken ? new Date().toISOString() : null) };
  }

  async function analyse(prep, opts) {
    opts = opts || {};
    var S = g().IdaPlateScanner, out = { analysis: { plate: null, fields: {}, provider: null, model: null, vehicle_visible: null }, view: null, plateSeen: false, plateDisagree: null, visionError: null };
    var a = out.analysis, ocr = null;
    try { ocr = S && S.analyzeStill ? await S.analyzeStill(prep.canvas) : null; } catch (e) { ocr = null; }
    if (ocr && ocr.read && ocr.read.parsed && ocr.read.parsed.exact) a.plate = { serie: ocr.read.parsed.serie, numero: ocr.read.parsed.numero, confidence: Math.round(ocr.read.confidence), source: "ocr", accepted: !!ocr.accepted };
    out.plateSeen = !!(ocr && ocr.box);
    if (ocr && ocr.colour && ocr.colour.value && ocr.colour.value !== "unknown") a.fields.colour = { value: ocr.colour.value, confidence: ocr.colour.confidence, source: "camera" };
    if (opts.visionEnabled && opts.visionUrl && typeof opts.post === "function") {
      try {
        var v = (await opts.post(opts.visionUrl, prep.blob)).vehicle_analysis;
        out.visionError = v && v.error ? v.error : null;
        if (v && v.enabled && !v.error) {
          a.provider = v.provider || null; a.model = v.model || null; a.vehicle_visible = v.vehicle_visible;
          Object.keys(v.fields || {}).forEach(function (f) { if (v.fields[f] && v.fields[f].value) a.fields[f] = v.fields[f]; });
          if (v.view === "front" || v.view === "rear") out.view = v.view;
          // the device's reading and the model's: agreement confirms; disagreement is shown, never settled silently
          if (v.plate) {
            if (!a.plate) a.plate = { serie: v.plate.serie, numero: v.plate.numero, confidence: v.plate.confidence, source: "vision", accepted: false };
            else if (a.plate.serie !== v.plate.serie || a.plate.numero !== v.plate.numero) { a.plate.accepted = false; out.plateDisagree = v.plate.serie + " " + v.plate.numero; }
          }
        }
      } catch (e) { out.visionError = "unreachable"; }
    }
    return out;
  }

  return { prepare: prepare, analyse: analyse, askPosition: askPosition, MAX_EDGE: MAX_EDGE };
});
