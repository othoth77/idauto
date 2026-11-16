/* IDauto — plate scanner (IDA-V11)
 * ============================================================================
 * "Scanner la plaque": camera → OCR → the SAME search the typed plate runs.
 *
 * WHAT THIS DOES NOT DO. It never invents a reading. Every plate it proposes
 * came out of the OCR engine; when the engine is unsure, or when what it read
 * does not fit the TUN_STD structure, the visitor is asked to confirm or
 * correct it before any search happens. There is no code path here that
 * guesses a digit, completes a partial plate, or searches on a value the
 * visitor has not seen.
 *
 * WHY TESSERACT, AND WHY IT IS SMALL HERE. Tunisian standard plates are
 * SSS تونس NNNN — digits either side of a fixed Arabic word, and NO letters.
 * That turns general OCR into constrained digit recognition, so the engine
 * runs with tessedit_char_whitelist = "0123456789" and a single-line page
 * segmentation mode. Everything is vendored under /assets/tesseract and
 * loaded from this origin; the engine never reaches a CDN.
 *
 * LAZY. Nothing in this file loads the engine until the visitor taps the
 * button. The homepage's first paint is byte-for-byte what it was.
 *
 * THE CAMERA IS ALWAYS CLOSED. stop() releases every MediaStreamTrack, and it
 * is called on success, on cancel, on error, on Escape, on backdrop click and
 * on pagehide. A scanner that leaves the camera light on is a privacy defect,
 * not a cosmetic one.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPlateScanner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ENGINE_BASE = "/assets/tesseract/";
  /* IDA-V12 — the atelier page serves the same vendored engine under its own
   * prefix (so it works in the PRIVATE phase too); configure() moves the
   * base before the first scan. Still same-origin, still no CDN. */
  function configure(opts) {
    if (opts && typeof opts.engineBase === "string" && /^\/[A-Za-z0-9\/_-]+\/$/.test(opts.engineBase)) ENGINE_BASE = opts.engineBase;
  }
  /* Below this the reading is treated as UNCERTAIN and must be confirmed by a
   * human before anything is searched. Tesseract reports 0–100 per word. 75 is
   * deliberately cautious: a wrong plate sends someone to the wrong vehicle's
   * passport, which is worse than one extra tap. */
  var CONFIDENT = 75;

  var state = {
    stream: null,     // the live MediaStream, or null when the camera is closed
    worker: null,     // the Tesseract worker, reused across scans in one session
    workerLoading: null,
    els: null,
    onPlate: null,
    onResult: null,   // Update 2 — when set, a reading is handed over with the captured frame (result card)
    lastRead: null,
    lastCapture: null, // { frame: canvas, box: plate rectangle in video fractions, colour }
    mode: "manual",   // "auto" (the plate is found and read by itself) or "manual" (the adjustable frame)
    auto: null
  };

  /* Update 2 — automatic detection. The plate is looked for on a small copy of
   * the frame five times a second; ONE frame is read, and only once the plate
   * has stopped moving. After three uncertain readings the person takes over. */
  var AUTO = { interval: 200, maxAttempts: 3, cooldown: 1200 };
  var LOW_CONTRAST = 80;            // grey levels between the digits and the plate ground
  function detectorModule() {
    var g = (typeof self !== "undefined" ? self : globalThis);
    return g.IdaPlateDetector || null;
  }

  /* ---------------- camera lifecycle ---------------- */

  function cameraSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }

  function stopCamera() {
    stopAuto();
    if (!state.stream) return;
    state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    state.stream = null;
    if (state.els && state.els.video) state.els.video.srcObject = null;
  }

  /* ---------------- the OCR engine ---------------- */

  function loadEngine(onProgress) {
    if (state.worker) return Promise.resolve(state.worker);
    if (state.workerLoading) return state.workerLoading;

    state.workerLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = ENGINE_BASE + "tesseract.min.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("engine_script_failed")); };
      document.head.appendChild(s);
    }).then(function () {
      /* Update 1 fix: `root` belongs to the UMD wrapper and is NOT in scope
       * here — the old `root.Tesseract` threw a ReferenceError, so every scan
       * ended in « Lecteur indisponible ». The engine script sets a global. */
      var T = (typeof self !== "undefined" ? self : globalThis).Tesseract;
      if (!T) throw new Error("engine_script_failed");
      return T.createWorker("eng", 1, {
        /* Every path is same-origin. workerBlobURL:false keeps the worker a
         * real same-origin URL instead of a blob:, so the CSP does not need
         * blob: in worker-src. */
        workerPath: ENGINE_BASE + "worker.min.js",
        corePath: ENGINE_BASE,
        langPath: ENGINE_BASE,
        workerBlobURL: false,
        gzip: true,
        logger: function (m) {
          if (onProgress && m && typeof m.progress === "number") onProgress(m);
        }
      });
    }).then(function (worker) {
      return worker.setParameters({
        // Digits only — a Tunisian série plate contains no letters at all.
        tessedit_char_whitelist: "0123456789",
        // 7 = treat the image as a single text line.
        tessedit_pageseg_mode: "7"
      }).then(function () { state.worker = worker; return worker; });
    }).catch(function (e) {
      state.workerLoading = null;
      throw e;
    });

    return state.workerLoading;
  }

  /* ---------------- scan frame (Update 1) ----------------
   * The frame the person adjusts on screen IS the area sent to the engine.
   * It is kept as fractions of the visible stage (x, y = top-left corner,
   * w, h = size), and cropRect() converts it to video pixels, taking the
   * stage's object-fit: cover into account (the video is scaled to fill the
   * stage and the overflow is cut off, so stage fractions are NOT video
   * fractions unless the aspect ratios match). */
  var FRAME_DEFAULT = { x: 0.07, y: 0.35, w: 0.86, h: 0.30 };
  var FRAME_LIMITS = { wMin: 0.30, wMax: 1, hMin: 0.12, hMax: 0.80 };
  var frame = { x: FRAME_DEFAULT.x, y: FRAME_DEFAULT.y, w: FRAME_DEFAULT.w, h: FRAME_DEFAULT.h };

  function clampFrame(f) {
    var w = Math.min(FRAME_LIMITS.wMax, Math.max(FRAME_LIMITS.wMin, +f.w || FRAME_DEFAULT.w));
    var h = Math.min(FRAME_LIMITS.hMax, Math.max(FRAME_LIMITS.hMin, +f.h || FRAME_DEFAULT.h));
    var x = Math.min(1 - w, Math.max(0, isFinite(+f.x) ? +f.x : FRAME_DEFAULT.x));
    var y = Math.min(1 - h, Math.max(0, isFinite(+f.y) ? +f.y : FRAME_DEFAULT.y));
    return { x: x, y: y, w: w, h: h };
  }

  /* Stage fractions → source rectangle in video pixels (object-fit: cover). */
  function cropRect(f, stageW, stageH, vw, vh) {
    f = clampFrame(f);
    if (!stageW || !stageH) { stageW = vw; stageH = vh; }
    var scale = Math.max(stageW / vw, stageH / vh);
    var ox = (stageW - vw * scale) / 2, oy = (stageH - vh * scale) / 2;
    var x0 = (f.x * stageW - ox) / scale, y0 = (f.y * stageH - oy) / scale;
    var x1 = ((f.x + f.w) * stageW - ox) / scale, y1 = ((f.y + f.h) * stageH - oy) / scale;
    x0 = Math.max(0, Math.min(vw, x0)); x1 = Math.max(0, Math.min(vw, x1));
    y0 = Math.max(0, Math.min(vh, y0)); y1 = Math.max(0, Math.min(vh, y1));
    return { sx: Math.round(x0), sy: Math.round(y0), sw: Math.max(1, Math.round(x1 - x0)), sh: Math.max(1, Math.round(y1 - y0)) };
  }

  function getFrame() { return { x: frame.x, y: frame.y, w: frame.w, h: frame.h }; }
  function setFrame(f) { frame = clampFrame(f); renderFrame(); return getFrame(); }

  /* ---------------- image preparation ----------------
   * Only the adjusted frame is read: cropping to it removes the rest of the
   * scene before OCR, and upscaling + a contrast stretch makes the digits
   * legible to the engine at phone-camera resolutions. This is ordinary
   * preprocessing, not interpretation: no pixel decision here can produce a
   * digit. */
  function prepare(video, stage) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    return prepareRect(video, cropRect(frame, stage ? stage.clientWidth : 0, stage ? stage.clientHeight : 0, vw, vh));
  }

  /* The same preparation for any source rectangle: the manual frame above, or
   * the rectangle the detector found (Update 2). `source` is a video, an image
   * or a canvas. */
  function prepareRect(source, r) {
    var bandW = r.sw, bandH = r.sh, sx = r.sx, sy = r.sy, video = source;
    state.lastCrop = r;

    var scale = Math.min(3, Math.max(1, 900 / bandW));
    var c = document.createElement("canvas");
    c.width = Math.round(bandW * scale);
    c.height = Math.round(bandH * scale);
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, bandW, bandH, 0, 0, c.width, c.height);

    var img = ctx.getImageData(0, 0, c.width, c.height);
    var d = img.data;
    var i, lum;
    // Grayscale + measure the range actually present.
    var min = 255, max = 0;
    for (i = 0; i < d.length; i += 4) {
      lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = lum;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    // Stretch that range to full scale. Guarded against a flat image, where
    // the divisor would be zero.
    var span = max - min;
    if (span > 12) {
      for (i = 0; i < d.length; i += 4) {
        lum = ((d[i] - min) * 255 / span) | 0;
        d[i] = d[i + 1] = d[i + 2] = lum < 0 ? 0 : lum > 255 ? 255 : lum;
      }
    }
    // Update 2 — a Tunisian plate is white on black, and the reader was trained on
    // dark text on a light page: a dark crop is inverted before it is read.
    // The ground is the commonest tone (digits cover less than half of a plate): its median decides.
    var hist = new Uint32Array(256), seen = 0, half = d.length / 8, median = 0;
    for (i = 0; i < d.length; i += 4) hist[d[i]]++;
    for (median = 0; median < 256; median++) { seen += hist[median]; if (seen >= half) break; }
    if (median < 128) {
      for (i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; }
    }
    ctx.putImageData(img, 0, 0);
    // A light margin all round: a digit touching the edge of the image is the one the reader drops.
    var pad = Math.round(c.height * 0.18), out = document.createElement("canvas");
    out.width = c.width + 2 * pad; out.height = c.height + 2 * pad;
    var octx = out.getContext("2d");
    octx.fillStyle = "#fff";                 // the ground is light by now (a dark one was inverted above)
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, pad, pad);
    return out;
  }

  /* One look at a frame: the plate at the normal working width and, when
   * nothing is found, once more on a larger copy (a plate held far away). */
  function counted(box) { return !!(box && box.groups && box.groups[0].counted && box.groups[1].counted); }
  function rank(box) { return box.score + (counted(box) ? 0.1 : 0) + (box.chars || 0) * 0.05; }
  function locate(source, sw, sh, scratch, fine) {
    var D = detectorModule(), widths = fine && sw > D.WORK_W * 1.3 ? [D.WORK_W, Math.min(D.WORK_W_FINE, sw)] : [D.WORK_W];
    var res = { box: null, data: null, w: 0, h: 0 };
    for (var i = 0; i < widths.length; i++) {
      var w = Math.min(widths[i], sw), h = Math.max(1, Math.round(sh * w / sw));
      if (scratch.canvas.width !== w || scratch.canvas.height !== h) { scratch.canvas.width = w; scratch.canvas.height = h; }
      scratch.ctx.drawImage(source, 0, 0, w, h);
      var data = scratch.ctx.getImageData(0, 0, w, h).data, box = D.detect(D.toGray(data, w, h), w, h);
      if (box && (!res.box || rank(box) > rank(res.box))) res = { box: box, data: data, w: w, h: h };
      else if (!res.data) res = { box: null, data: data, w: w, h: h };
      // a clear plate, every digit counted: no need for the second look — except at capture time (`fine === "both"`),
      // when both looks are always taken and the one that counts more digits wins
      if (fine !== "both" && res.box && res.box.score >= 0.97 && counted(res.box)) break;
    }
    return res;
  }

  function fracRect(b, vw, vh) {
    var x0 = Math.max(0, b.x * vw), y0 = Math.max(0, b.y * vh), x1 = Math.min(vw, (b.x + b.w) * vw), y1 = Math.min(vh, (b.y + b.h) * vh);
    return { sx: Math.round(x0), sy: Math.round(y0), sw: Math.max(1, Math.round(x1 - x0)), sh: Math.max(1, Math.round(y1 - y0)) };
  }

  /* Update 2 — reads a detected plate. When the detector separated the two
   * groups of digits, each group is read on its own: the série and the numéro
   * are then known by POSITION, and the word between them is never shown to the
   * reader. Otherwise the whole plate is read as before. */
  async function readDetected(source, vw, vh, box) {
    if (box.groups && box.groups.length === 2) {
      var worker;
      try { worker = await loadEngine(function () {}); } catch (e) { var e1 = new Error("engine"); e1.stage = "engine"; throw e1; }
      var parts = [];
      for (var k = 0; k < 2; k++) {
        var out = await worker.recognize(prepareRect(source, fracRect(box.groups[k], vw, vh)), {}, { text: true, blocks: true });
        var data = out && out.data ? out.data : {}, digits = (data.text || "").replace(/\D/g, ""), sc = readConfidence(data);
        var part = { digits: digits, confidence: sc === null ? (typeof data.confidence === "number" ? data.confidence : 0) : sc };
        // The group reading miscounts (two thin 1s side by side are easily read as one): each digit is then read on its own.
        var cells = box.groups[k].cells;
        if (cells && cells.length === box.groups[k].digits && digits.length !== cells.length) {
          await worker.setParameters({ tessedit_pageseg_mode: "10" });        // 10 = one character
          var one = "", worst = 100;
          try {
            for (var q = 0; q < cells.length; q++) {
              var o = await worker.recognize(prepareRect(source, fracRect(cells[q], vw, vh)), {}, { text: true, blocks: true });
              var od = o && o.data ? o.data : {}, ch = (od.text || "").replace(/\D/g, ""), oc = readConfidence(od);
              if (ch.length !== 1) { one = ""; break; }
              one += ch; worst = Math.min(worst, oc === null ? (typeof od.confidence === "number" ? od.confidence : 0) : oc);
            }
          } finally { await worker.setParameters({ tessedit_pageseg_mode: "7" }); }
          if (one.length === cells.length) part = { digits: one, confidence: worst, byCell: true };
        }
        parts.push(part);
      }
      var okShape = /^\d{1,3}$/.test(parts[0].digits) && /^\d{1,4}$/.test(parts[1].digits);
      // The detector counted the digits of each group one by one: a reading with another number of digits is not a reading.
      var okCount = [0, 1].every(function (q) { return parts[q].digits.length === box.groups[q].digits; });
      if (okShape && !okCount) okShape = false;
      // Digits that touched each other were not counted one by one: such a reading is shown, never accepted by itself.
      // …and so is a plate seen in poor light: with little contrast the reader confuses digits (a 5 for a 9) while
      // still reporting a high confidence. Measured on 2026-11-16; LOW_CONTRAST is the floor below which the person checks.
      var sure = counted(box) && (box.contrast || 0) >= LOW_CONTRAST;
      state.lastCrop = fracRect(box, vw, vh);
      return { text: parts[0].digits + " " + parts[1].digits, confidence: sure ? Math.min(parts[0].confidence, parts[1].confidence) : Math.min(CONFIDENT - 1, parts[0].confidence, parts[1].confidence), groups: true,
        parsed: okShape ? { serie: parts[0].digits, numero: parts[1].digits, exact: true } : (parts[0].digits + parts[1].digits ? { raw: parts[0].digits + parts[1].digits, serie: "", numero: "", exact: false } : null) };
    }
    var mx = box.w * 0.02, my = box.h * 0.04;
    return recognize(prepareRect(source, fracRect({ x: box.x - mx, y: box.y - my, w: box.w + 2 * mx, h: box.h + 2 * my }, vw, vh)));
  }

  /* ---------------- reading a TUN_STD plate ----------------
   * The engine returns digits and whatever separators survived. A Tunisian
   * série plate is 1-3 digits, the word تونس, then 1-4 digits. The Arabic word
   * is NOT read (the whitelist is digits only) — it is the GAP between the two
   * digit groups that identifies them, which is why the whitelist helps rather
   * than hurts.
   *
   * Returns null when the text does not yield exactly two digit groups of the
   * right sizes. Returning null is a real answer: it means "not read", and the
   * caller asks the human. Nothing is padded, truncated or assumed. */
  function parseTunStd(text) {
    if (!text) return null;
    var groups = String(text).match(/\d+/g);
    if (!groups) return null;

    // Exactly two groups is the unambiguous case.
    if (groups.length === 2) {
      var a = groups[0], b = groups[1];
      if (a.length >= 1 && a.length <= 3 && b.length >= 1 && b.length <= 4) {
        return { serie: a, numero: b, exact: true };
      }
      return null;
    }
    // A single run of digits could be a plate whose gap was lost, but WHERE to
    // split it is a guess — and guessing is exactly what this must not do.
    // It is surfaced for the human to correct, never searched automatically.
    if (groups.length === 1 && groups[0].length >= 2 && groups[0].length <= 7) {
      return { serie: "", numero: "", raw: groups[0], exact: false };
    }
    return null;
  }

  /* SPLITTING BY GEOMETRY, NOT BY GUESSWORK.
   *
   * A Tunisian plate is SSS تونس NNNN. The whitelist is digits only, so the
   * Arabic word is never returned — and with it goes the whitespace that told
   * the two groups apart, which is why a clean read can still arrive as one
   * run like "1884523". Splitting that by assuming "3 then the rest" would be
   * inventing a reading; the série is 1-3 digits, so 1884523 could equally be
   * 1|884523 or 18|84523.
   *
   * The engine also returns WHERE each digit was found. The gap the Arabic
   * word left behind is still there in the geometry: it is much wider than
   * the gap between two digits of the same group. Splitting at that gap is a
   * measurement, not an assumption — and it is only accepted when the gap is
   * decisively wider than the others (>= GAP_RATIO x the median) AND the two
   * halves are valid série/numéro lengths. Anything less certain falls
   * through to the human, exactly as before.
   */
  var GAP_RATIO = 2.2;

  function symbolsOf(data) {
    if (!data) return [];
    if (Array.isArray(data.symbols) && data.symbols.length) return data.symbols;
    // v7 nests them under blocks → paragraphs → lines → words → symbols.
    var out = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (par) {
        (par.lines || []).forEach(function (ln) {
          (ln.words || []).forEach(function (w) {
            (w.symbols || []).forEach(function (sym) { out.push(sym); });
          });
        });
      });
    });
    return out;
  }

  /* CONFIDENCE IS THE WEAKEST DIGIT, NOT THE AVERAGE.
   *
   * data.confidence (page level) and word confidence both come back 0 from
   * this engine build — measured, not assumed — so neither can gate anything.
   * The per-SYMBOL confidences are populated and are the right measure anyway:
   * a plate is only as trustworthy as its least certain digit, because ONE
   * wrong digit resolves to a different vehicle's passport. Averaging would
   * let a 12%-confident digit hide behind five 98% ones.
   *
   * Returns null when there is nothing to measure, and the caller then treats
   * the read as uncertain rather than as confident-by-default. */
  function readConfidence(data) {
    var syms = symbolsOf(data).filter(function (sy) {
      return sy && typeof sy.text === "string" && /^\d$/.test(sy.text.trim()) && typeof sy.confidence === "number";
    });
    if (!syms.length) return null;
    return syms.reduce(function (lo, sy) { return Math.min(lo, sy.confidence); }, 100);
  }

  function splitByGeometry(data) {
    var syms = symbolsOf(data).filter(function (sy) {
      return sy && typeof sy.text === "string" && /^\d$/.test(sy.text.trim()) && sy.bbox;
    });
    if (syms.length < 2 || syms.length > 7) return null;

    syms.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; });

    var gaps = [];
    for (var i = 1; i < syms.length; i++) gaps.push(syms[i].bbox.x0 - syms[i - 1].bbox.x1);
    if (!gaps.length) return null;

    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var maxGap = Math.max.apply(null, gaps);
    var at = gaps.indexOf(maxGap);

    // A median of zero (digits touching) would make any gap "infinitely"
    // wider; require an absolute separation too, scaled to digit width.
    var width = syms[0].bbox.x1 - syms[0].bbox.x0;
    if (maxGap < width * 0.6) return null;
    if (median > 0 && maxGap < median * GAP_RATIO) return null;

    var serie = syms.slice(0, at + 1).map(function (x) { return x.text.trim(); }).join("");
    var numero = syms.slice(at + 1).map(function (x) { return x.text.trim(); }).join("");
    if (serie.length < 1 || serie.length > 3 || numero.length < 1 || numero.length > 4) return null;
    return { serie: serie, numero: numero, exact: true, via: "geometry" };
  }

  /* ---------------- frame controls (Update 1) ----------------
   * Width and height sliders, the frame itself can be dragged (mouse, finger)
   * or moved with the arrow keys, and « Recentrer » restores the default.
   * Built here so the citizen page and the atelier page get the same
   * controls from the same markup contract. */
  function pct(v) { return Math.round(v * 1000) / 10 + "%"; }

  function renderFrame() {
    if (!state.els || !state.els.root) return;
    var g = state.els.root.querySelector(".ida-scan-guide");
    if (g) { g.style.left = pct(frame.x); g.style.top = pct(frame.y); g.style.width = pct(frame.w); g.style.height = pct(frame.h); }
    var w = state.els.root.querySelector("[data-scan-frame-w]"), h = state.els.root.querySelector("[data-scan-frame-h]");
    if (w && document.activeElement !== w) w.value = String(Math.round(frame.w * 100));
    if (h && document.activeElement !== h) h.value = String(Math.round(frame.h * 100));
    var wo = state.els.root.querySelector("[data-scan-frame-w-out]"), ho = state.els.root.querySelector("[data-scan-frame-h-out]");
    if (wo) wo.textContent = Math.round(frame.w * 100) + " %";
    if (ho) ho.textContent = Math.round(frame.h * 100) + " %";
  }

  /* Resize keeps the frame's centre where it is. */
  function resizeFrame(dim, value) {
    var c = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    var f = getFrame();
    f[dim] = value;
    var n = clampFrame(f);
    if (dim === "w") n.x = c.x - n.w / 2; else n.y = c.y - n.h / 2;
    setFrame(n);
  }

  function buildFrameControls(root) {
    var stage = root.querySelector(".ida-scan-stage");
    var guide = root.querySelector(".ida-scan-guide");
    if (!stage || !guide || root.querySelector("[data-scan-frame]")) return;
    guide.removeAttribute("aria-hidden");
    guide.setAttribute("tabindex", "0");
    guide.setAttribute("role", "group");
    guide.setAttribute("aria-label", "Cadre de lecture — flèches pour le déplacer");
    guide.setAttribute("data-scan-guide", "");

    var box = document.createElement("div");
    box.className = "ida-scan-frame";
    box.setAttribute("data-scan-frame", "");
    box.innerHTML =
      '<p class="ida-caption">Glissez le cadre sur la plaque. Seule la zone du cadre est lue.</p>' +
      '<div class="ida-scan-frame-row"><label for="scan-frame-w">Largeur</label>' +
      '<input type="range" id="scan-frame-w" min="30" max="100" step="1" data-scan-frame-w>' +
      '<output data-scan-frame-w-out data-i18n-skip></output></div>' +
      '<div class="ida-scan-frame-row"><label for="scan-frame-h">Hauteur</label>' +
      '<input type="range" id="scan-frame-h" min="12" max="80" step="1" data-scan-frame-h>' +
      '<output data-scan-frame-h-out data-i18n-skip></output></div>' +
      '<button type="button" class="ida-btn ida-btn--ghost ida-btn--sm" data-scan-action="frame-reset">Recentrer le cadre</button>';
    stage.parentNode.insertBefore(box, stage.nextSibling);

    box.querySelector("[data-scan-frame-w]").addEventListener("input", function (e) { resizeFrame("w", e.target.value / 100); });
    box.querySelector("[data-scan-frame-h]").addEventListener("input", function (e) { resizeFrame("h", e.target.value / 100); });

    var drag = null;
    guide.addEventListener("pointerdown", function (e) {
      drag = { id: e.pointerId, px: e.clientX, py: e.clientY, x: frame.x, y: frame.y, W: stage.clientWidth || 1, H: stage.clientHeight || 1 };
      try { guide.setPointerCapture(e.pointerId); } catch (err) {}
      guide.classList.add("is-dragging");
      e.preventDefault();
    });
    guide.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      setFrame({ x: drag.x + (e.clientX - drag.px) / drag.W, y: drag.y + (e.clientY - drag.py) / drag.H, w: frame.w, h: frame.h });
    });
    function end(e) { if (drag && e.pointerId === drag.id) { drag = null; guide.classList.remove("is-dragging"); } }
    guide.addEventListener("pointerup", end);
    guide.addEventListener("pointercancel", end);
    guide.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 0.05 : 0.01, f = getFrame();
      if (e.key === "ArrowLeft") f.x -= step; else if (e.key === "ArrowRight") f.x += step;
      else if (e.key === "ArrowUp") f.y -= step; else if (e.key === "ArrowDown") f.y += step;
      else return;
      e.preventDefault(); e.stopPropagation();
      setFrame(f);
    });
    renderFrame();
  }

  /* Update 2 — the detection rectangle and the auto / manual switch, built once. */
  function buildAutoControls(root) {
    var stage = root.querySelector(".ida-scan-stage");
    if (!stage || root.querySelector("[data-scan-detect]")) return;
    var d = document.createElement("div");
    d.className = "ida-scan-detect";
    d.setAttribute("data-scan-detect", "");
    d.setAttribute("aria-hidden", "true");
    d.hidden = true;
    stage.appendChild(d);
    var captureBtn = root.querySelector('[data-scan-action="capture"]');
    if (captureBtn && detectorModule()) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ida-btn ida-btn--secondary";
      b.setAttribute("data-scan-action", "mode");
      b.textContent = "Cadrage manuel";
      captureBtn.parentNode.insertBefore(b, captureBtn.nextSibling);
    }
    root.setAttribute("data-scan-mode", detectorModule() ? "auto" : "manual");
  }

  /* ---------------- UI ---------------- */

  function el(id) { return state.els.root.querySelector("[data-scan-" + id + "]"); }

  function show(name) {
    ["intro", "live", "busy", "confirm", "error"].forEach(function (n) {
      var node = el(n);
      if (node) node.hidden = (n !== name);
    });
  }

  function setStatus(msg) {
    var s = el("status");
    if (s) s.textContent = msg || "";
  }

  function fail(titleText, bodyText) {
    stopCamera();
    show("error");
    var t = el("error-title"), b = el("error-body");
    if (t) t.textContent = titleText;
    if (b) b.textContent = bodyText;
  }

  function close() {
    stopCamera();
    if (state.els && state.els.root) {
      state.els.root.hidden = true;
      state.els.root.setAttribute("aria-hidden", "true");
    }
    if (state.els && state.els.opener && typeof state.els.opener.focus === "function") {
      state.els.opener.focus();
    }
  }

  async function start() {
    if (!cameraSupported()) {
      fail("Caméra indisponible",
        "Ce navigateur ne donne pas accès à la caméra. Saisissez la plaque à la main ci-dessous — la recherche est identique.");
      return;
    }
    show("live");
    setStatus("Ouverture de la caméra…");
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      var name = e && e.name ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        fail("Accès à la caméra refusé",
          "Vous avez refusé l'accès à la caméra, ou le navigateur l'a bloqué. Saisissez la plaque à la main ci-dessous — la recherche est identique.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
        fail("Aucune caméra détectée",
          "Aucune caméra utilisable n'a été trouvée sur cet appareil. Saisissez la plaque à la main ci-dessous.");
      } else if (name === "NotReadableError") {
        fail("Caméra déjà utilisée",
          "Une autre application utilise la caméra. Fermez-la et réessayez, ou saisissez la plaque à la main.");
      } else {
        fail("Caméra indisponible",
          "La caméra n'a pas pu être ouverte. Saisissez la plaque à la main ci-dessous.");
      }
      return;
    }
    var video = state.els.video;
    video.srcObject = state.stream;
    video.setAttribute("playsinline", "");
    try { await video.play(); } catch (e) { /* autoplay policies — the frame still arrives */ }
    if (!startAuto()) setStatus("Cadrez la plaque dans le rectangle, puis appuyez sur Lire la plaque.");
  }

  /* Reads one prepared canvas. Resolves { text, confidence, parsed }; rejects
   * with .stage = "engine" | "read" so the caller can say what failed. */
  async function recognize(canvas, onProgress) {
    var worker;
    try { worker = await loadEngine(onProgress || function () {}); }
    catch (e) { var e1 = new Error("engine"); e1.stage = "engine"; throw e1; }
    var out;
    try {
      // blocks:true asks the engine for per-symbol geometry as well as text —
      // splitByGeometry() needs the digit bounding boxes.
      out = await worker.recognize(canvas, {}, { text: true, blocks: true });
    } catch (e) { var e2 = new Error("read"); e2.stage = "read"; throw e2; }
    var data = out && out.data ? out.data : {};
    var text = (data.text || "").trim();
    var symbolConfidence = readConfidence(data);
    var confidence = symbolConfidence === null
      ? (typeof data.confidence === "number" ? data.confidence : 0)
      : symbolConfidence;
    /* Text first — when the engine kept the gap, the answer is unambiguous.
     * When it did not, the geometry is consulted before giving up. */
    var parsed = parseTunStd(text);
    if (parsed && !parsed.exact) {
      var geo = splitByGeometry(data);
      if (geo) parsed = geo;
    }
    return { text: text, confidence: confidence, parsed: parsed };
  }

  /* The structured registration number: first group, the word, last group. */
  function structure(serie, numero) {
    return { first: serie, text: "تونس", last: numero, normalized: serie + " تونس " + numero, canonical: serie + " TUN " + numero };
  }

  /* A copy of the whole frame (1280 px at most) — shown on the result card and,
   * only where the page asks for it, sent to the vehicle analysis. */
  function snapshot(video) {
    var vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
    if (!vw || !vh) return null;
    var s = Math.min(1, 1280 / Math.max(vw, vh)), c = document.createElement("canvas");
    c.width = Math.round(vw * s); c.height = Math.round(vh * s);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  function colourFrom(canvas, box) {
    var D = detectorModule();
    if (!D || !canvas || !box) return { value: "unknown", confidence: 0 };
    var w = Math.min(320, canvas.width), h = Math.round(canvas.height * w / canvas.width), c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    return D.colourOf(ctx.getImageData(0, 0, w, h).data, w, h, box);
  }

  /* Hands a reading to the page. With onResult the page shows the result card
   * (image, number, confidence); otherwise the plate goes to the search as before. */
  function deliver(serie, numero, confidence, auto) {
    var cap = state.lastCapture || {};
    var payload = { serie: serie, numero: numero, confidence: confidence, auto: auto, plate: structure(serie, numero),
      frame: cap.frame || null, plateBox: cap.box || null, colour: cap.colour || { value: "unknown", confidence: 0 } };
    close();
    if (typeof state.onResult === "function") state.onResult(payload);
    else state.onPlate({ serie: serie, numero: numero, confidence: confidence, auto: auto });
  }

  function showUncertain(read) {
    var parsed = read ? read.parsed : null, confidence = read ? read.confidence : 0;
    show("confirm");
    if (!parsed) {
      // Not read. Not a failure of the visitor, and not something to guess at.
      el("confirm-serie").value = "";
      el("confirm-numero").value = "";
      setConfirmNote("La plaque n'a pas pu être lue automatiquement. Saisissez-la, ou reprenez une photo.");
      el("confirm-serie").focus();
      return;
    }
    // Read, but not confidently enough to act on unaided.
    el("confirm-serie").value = parsed.serie || (parsed.raw ? parsed.raw.slice(0, 3) : "");
    el("confirm-numero").value = parsed.numero || (parsed.raw ? parsed.raw.slice(3) : "");
    setConfirmNote(parsed.exact
      ? "Lecture incertaine (" + Math.round(confidence) + "%). Vérifiez les chiffres avant de lancer la recherche."
      : "Lecture ambiguë — les deux groupes de chiffres n'ont pas pu être séparés avec certitude. Corrigez si besoin.");
    el("confirm-serie").focus();
    el("confirm-serie").select();
  }

  async function capture() {
    var video = state.els.video;
    var canvas = prepare(video, video.parentNode);
    if (!canvas) {
      setStatus("L'image n'est pas encore prête — réessayez dans un instant.");
      return;
    }
    var vw = video.videoWidth, vh = video.videoHeight, r = state.lastCrop;
    var box = { x: r.sx / vw, y: r.sy / vh, w: r.sw / vw, h: r.sh / vh }, shot = snapshot(video);
    state.lastCapture = { frame: shot, box: box, colour: colourFrom(shot, box) };
    // The camera is released as soon as the frame is taken: OCR does not need
    // it, and holding it open during a slow recognition is what makes a
    // scanner feel like it is spying.
    stopCamera();
    show("busy");
    setStatus("Chargement du lecteur…");

    var read;
    try {
      read = await recognize(canvas, function (m) {
        if (m.status === "recognizing text") setStatus("Lecture de la plaque…");
        else setStatus("Chargement du lecteur… " + Math.round((m.progress || 0) * 100) + "%");
      });
    } catch (e) {
      if (e.stage === "engine") fail("Lecteur indisponible", "Le lecteur de plaque n'a pas pu être chargé. Saisissez la plaque à la main ci-dessous.");
      else fail("Lecture impossible", "La plaque n'a pas pu être lue. Réessayez avec plus de lumière, ou saisissez-la à la main.");
      return;
    }
    state.lastRead = read;
    if (read.parsed && read.parsed.exact && read.confidence >= CONFIDENT) {
      // Read cleanly and with confidence: run the same search the typed plate
      // runs. The visitor still sees the plate in the field afterwards.
      deliver(read.parsed.serie, read.parsed.numero, read.confidence, true);
      return;
    }
    showUncertain(read);
  }

  /* ---------------- Update 2 — automatic detection loop ---------------- */

  function setMode(mode) {
    state.mode = mode;
    var root = state.els && state.els.root;
    if (!root) return;
    root.setAttribute("data-scan-mode", mode);
    var b = root.querySelector('[data-scan-action="mode"]');
    if (b) b.textContent = mode === "auto" ? "Cadrage manuel" : "Détection automatique";
    if (mode === "manual") { renderDetect(null); setStatus("Cadrez la plaque dans le rectangle, puis appuyez sur Lire la plaque."); }
  }

  /* A rectangle in video fractions → stage fractions (object-fit: cover). */
  function videoToStage(b, stageW, stageH, vw, vh) {
    var scale = Math.max(stageW / vw, stageH / vh), ox = (stageW - vw * scale) / 2, oy = (stageH - vh * scale) / 2;
    return { x: (b.x * vw * scale + ox) / stageW, y: (b.y * vh * scale + oy) / stageH, w: b.w * vw * scale / stageW, h: b.h * vh * scale / stageH };
  }

  function renderDetect(box, stable) {
    var n = state.els && state.els.root ? state.els.root.querySelector("[data-scan-detect]") : null;
    if (!n) return;
    var video = state.els.video, stage = video ? video.parentNode : null;
    if (!box || !stage || !video.videoWidth) { n.hidden = true; return; }
    var s = videoToStage(box, stage.clientWidth || 1, stage.clientHeight || 1, video.videoWidth, video.videoHeight);
    n.hidden = false;
    n.style.left = pct(s.x); n.style.top = pct(s.y); n.style.width = pct(s.w); n.style.height = pct(s.h);
    n.classList.toggle("is-stable", !!stable);
  }

  function stopAuto() {
    if (state.auto && state.auto.timer) clearInterval(state.auto.timer);
    state.auto = null;
  }

  function startAuto() {
    var D = detectorModule();
    stopAuto();
    if (!D) { setMode("manual"); return false; }
    var c = document.createElement("canvas");
    state.auto = { tracker: D.createTracker(), attempts: 0, busy: false, canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }), timer: null, ticks: 0, reads: 0, every: AUTO.interval, cost: 0, following: false, counted: false, candidate: null };
    setMode("auto");
    setStatus("Recherche de la plaque… Visez l'avant ou l'arrière du véhicule.");
    state.auto.timer = setInterval(autoTick, AUTO.interval);
    // The reader is loaded while the plate is being looked for, so the first reading does not wait for it.
    loadEngine(function () {}).catch(function () {});
    return true;
  }

  function autoTick() {
    var a = state.auto, D = detectorModule();
    if (!a || a.busy || !D || !state.stream || state.mode !== "auto" || document.visibilityState === "hidden") return;
    var video = state.els.video, vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    var t0 = Date.now();
    // the larger second look is taken every other tick only, and never while a plate is being followed
    var found = locate(video, vw, vh, a, a.ticks % 2 === 1 && (!a.following || !a.counted));
    var tr = a.tracker.update(found.box);
    a.following = !!tr.box;
    a.counted = counted(found.box);
    a.ticks++;
    a.cost = Date.now() - t0;
    // a slow device is given more time between looks: the analysis never takes more than about a third of the time
    var want = Math.max(AUTO.interval, Math.min(1000, a.cost * 3));
    if (Math.abs(want - a.every) > 60) { a.every = want; clearInterval(a.timer); a.timer = setInterval(autoTick, want); }
    renderDetect(tr.box, tr.stable);
    if (tr.stable) { a.busy = true; autoRead(tr.box); }
    else setStatus(tr.box ? "Plaque repérée — ne bougez plus…" : "Recherche de la plaque… Visez l'avant ou l'arrière du véhicule.");
  }

  async function autoRead(box) {
    var a = state.auto, video = state.els.video, vw = video.videoWidth, vh = video.videoHeight;
    // at capture time the frame is looked at once more, at both sizes: the finer look separates digits the first one merged or dropped
    var again = locate(video, vw, vh, a, "both").box, D = detectorModule();
    if (again && D && D.iou(again, box) > 0.3) box = again;
    var shot = snapshot(video);
    state.lastCapture = { frame: shot, box: { x: box.x, y: box.y, w: box.w, h: box.h }, colour: colourFrom(shot, box) };
    setStatus("Plaque stable — lecture…");
    var read = null;
    try { read = await readDetected(video, vw, vh, box); }
    catch (e) {
      if (e.stage === "engine") { fail("Lecteur indisponible", "Le lecteur de plaque n'a pas pu être chargé. Saisissez la plaque à la main ci-dessous."); return; }
    }
    if (state.auto !== a) return;            // closed or switched to manual meanwhile
    a.attempts++; a.reads++;
    state.lastRead = read;
    if (read && read.parsed && read.parsed.exact && read.confidence >= CONFIDENT) {
      // A confident reading is accepted only when a SECOND frame gives the same digits: one frame can
      // turn a 7 into a 4 with full confidence, two different frames rarely agree on the same mistake.
      var key = read.parsed.serie + "/" + read.parsed.numero;
      if (a.candidate === key) { deliver(read.parsed.serie, read.parsed.numero, read.confidence, true); return; }
      a.candidate = key; a.attempts--;                       // not a failed attempt: a first reading awaiting its confirmation
      a.tracker.reset();
      setStatus("Plaque lue — vérification sur une deuxième image…");
      setTimeout(function () { if (state.auto === a) a.busy = false; }, 350);
      return;
    }
    a.candidate = null;
    if (a.attempts >= AUTO.maxAttempts) {
      // Three uncertain readings: nothing is accepted by itself. The person checks the digits,
      // or goes back and frames the plate by hand.
      stopCamera();
      showUncertain(read);
      return;
    }
    a.tracker.reset();
    renderDetect(null);
    setStatus("Lecture incertaine — rapprochez-vous ou améliorez l'éclairage.");
    setTimeout(function () { if (state.auto === a) a.busy = false; }, AUTO.cooldown);
  }

  /* Update 2 — the same pipeline on a still image (a canvas): find the plate,
   * read it, name the colour. Used by the tests and the accuracy measurements;
   * the camera path above runs exactly these steps. */
  async function analyzeStill(source) {
    var D = detectorModule(), w0 = source.width, h0 = source.height;
    if (!D || !w0 || !h0) return { box: null, read: null, colour: { value: "unknown", confidence: 0 } };
    var c = document.createElement("canvas"), found = locate(source, w0, h0, { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }) }, "both");
    var box = found.box, data = found.data, w = found.w, h = found.h;
    if (!box) return { box: null, read: null, colour: { value: "unknown", confidence: 0 } };
    var read = null;
    try { read = await readDetected(source, w0, h0, box); } catch (e) { read = null; }
    return { box: box, read: read, colour: D.colourOf(data, w, h, box), accepted: !!(read && read.parsed && read.parsed.exact && read.confidence >= CONFIDENT) };
  }

  function setConfirmNote(msg) {
    var n = el("confirm-note");
    if (n) n.textContent = msg;
  }

  function confirmSubmit() {
    var serie = (el("confirm-serie").value || "").replace(/\D/g, "");
    var numero = (el("confirm-numero").value || "").replace(/\D/g, "");
    if (!serie || serie.length > 3 || !numero || numero.length > 4) {
      setConfirmNote("Série : 1 à 3 chiffres. Numéro : 1 à 4 chiffres.");
      return;
    }
    deliver(serie, numero, state.lastRead ? state.lastRead.confidence : 0, false);
  }

  /* ---------------- public API ---------------- */

  function open(opts) {
    state.els = opts.els;
    state.onPlate = opts.onPlate;
    state.onResult = opts.onResult || null;
    state.lastCapture = null;
    state.els.root.hidden = false;
    state.els.root.setAttribute("aria-hidden", "false");
    show("intro");
    setStatus("");
    var startBtn = el("start");
    if (startBtn) startBtn.focus();
  }

  function bind(els) {
    state.els = els;
    buildFrameControls(els.root);
    buildAutoControls(els.root);
    els.root.addEventListener("click", function (e) {
      var t = e.target.closest("[data-scan-action]");
      if (t) {
        var a = t.getAttribute("data-scan-action");
        if (a === "start") return start();
        if (a === "capture") return capture();
        if (a === "retry") { show("intro"); setStatus(""); return; }
        if (a === "confirm") return confirmSubmit();
        if (a === "close") return close();
        if (a === "frame-reset") { setFrame(FRAME_DEFAULT); return; }
        if (a === "mode") {
          if (state.mode === "auto") { stopAuto(); setMode("manual"); }
          else if (state.stream) startAuto();
          return;
        }
      }
      if (e.target === els.root) close();   // backdrop
    });
    els.root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    // A page being hidden or unloaded must never leave the camera running.
    window.addEventListener("pagehide", stopCamera);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") stopCamera();
    });
  }

  return {
    open: open,
    bind: bind,
    configure: configure,
    close: close,
    stopCamera: stopCamera,
    cameraSupported: cameraSupported,
    parseTunStd: parseTunStd,
    splitByGeometry: splitByGeometry,
    readConfidence: readConfidence,
    cropRect: cropRect,
    analyzeStill: analyzeStill,
    _prepareRect: prepareRect,
    _fracRect: fracRect,
    structure: structure,
    videoToStage: videoToStage,
    getMode: function () { return state.mode; },
    autoStats: function () { return state.auto ? { ticks: state.auto.ticks, reads: state.auto.reads, attempts: state.auto.attempts, busy: state.auto.busy, every: state.auto.every, cost: state.auto.cost } : null; },
    lastCapture: function () { return state.lastCapture; },
    AUTO: AUTO,
    LOW_CONTRAST: LOW_CONTRAST,
    clampFrame: clampFrame,
    getFrame: getFrame,
    setFrame: setFrame,
    lastCrop: function () { return state.lastCrop || null; },
    FRAME_DEFAULT: FRAME_DEFAULT,
    CONFIDENT: CONFIDENT
  };
});
