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
    lastRead: null
  };

  /* ---------------- camera lifecycle ---------------- */

  function cameraSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }

  function stopCamera() {
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
      if (!root.Tesseract) throw new Error("engine_script_failed");
      return root.Tesseract.createWorker("eng", 1, {
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

  /* ---------------- image preparation ----------------
   * The plate occupies a band in the middle of the frame (where the guide
   * rectangle is drawn). Cropping to it removes most of the scene before OCR,
   * and upscaling + a contrast stretch makes the digits legible to the engine
   * at phone-camera resolutions. This is ordinary preprocessing, not
   * interpretation: no pixel decision here can produce a digit. */
  function prepare(video) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    var bandW = Math.round(vw * 0.86);
    var bandH = Math.round(vh * 0.30);
    var sx = Math.round((vw - bandW) / 2);
    var sy = Math.round((vh - bandH) / 2);

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
    ctx.putImageData(img, 0, 0);
    return c;
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
    setStatus("Cadrez la plaque dans le rectangle, puis appuyez sur Lire la plaque.");
  }

  async function capture() {
    var video = state.els.video;
    var canvas = prepare(video);
    if (!canvas) {
      setStatus("L'image n'est pas encore prête — réessayez dans un instant.");
      return;
    }
    // The camera is released as soon as the frame is taken: OCR does not need
    // it, and holding it open during a slow recognition is what makes a
    // scanner feel like it is spying.
    stopCamera();
    show("busy");
    setStatus("Chargement du lecteur…");

    var worker;
    try {
      worker = await loadEngine(function (m) {
        if (m.status === "recognizing text") setStatus("Lecture de la plaque…");
        else setStatus("Chargement du lecteur… " + Math.round((m.progress || 0) * 100) + "%");
      });
    } catch (e) {
      fail("Lecteur indisponible",
        "Le lecteur de plaque n'a pas pu être chargé. Saisissez la plaque à la main ci-dessous.");
      return;
    }

    setStatus("Lecture de la plaque…");
    var out;
    try {
      // blocks:true asks the engine for per-symbol geometry as well as text —
      // splitByGeometry() needs the digit bounding boxes.
      out = await worker.recognize(canvas, {}, { text: true, blocks: true });
    } catch (e) {
      fail("Lecture impossible",
        "La plaque n'a pas pu être lue. Réessayez avec plus de lumière, ou saisissez-la à la main.");
      return;
    }

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

    state.lastRead = { text: text, confidence: confidence, parsed: parsed };

    if (!parsed) {
      // Not read. Not a failure of the visitor, and not something to guess at.
      show("confirm");
      el("confirm-serie").value = "";
      el("confirm-numero").value = "";
      setConfirmNote("La plaque n'a pas pu être lue automatiquement. Saisissez-la, ou reprenez une photo.");
      el("confirm-serie").focus();
      return;
    }

    if (parsed.exact && confidence >= CONFIDENT) {
      // Read cleanly and with confidence: run the same search the typed plate
      // runs. The visitor still sees the plate in the field afterwards.
      close();
      state.onPlate({ serie: parsed.serie, numero: parsed.numero, confidence: confidence, auto: true });
      return;
    }

    // Read, but not confidently enough to act on unaided.
    show("confirm");
    el("confirm-serie").value = parsed.serie || (parsed.raw ? parsed.raw.slice(0, 3) : "");
    el("confirm-numero").value = parsed.numero || (parsed.raw ? parsed.raw.slice(3) : "");
    setConfirmNote(parsed.exact
      ? "Lecture incertaine (" + Math.round(confidence) + "%). Vérifiez les chiffres avant de lancer la recherche."
      : "Lecture ambiguë — les deux groupes de chiffres n'ont pas pu être séparés avec certitude. Corrigez si besoin.");
    el("confirm-serie").focus();
    el("confirm-serie").select();
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
    close();
    state.onPlate({ serie: serie, numero: numero, confidence: state.lastRead ? state.lastRead.confidence : 0, auto: false });
  }

  /* ---------------- public API ---------------- */

  function open(opts) {
    state.els = opts.els;
    state.onPlate = opts.onPlate;
    state.els.root.hidden = false;
    state.els.root.setAttribute("aria-hidden", "false");
    show("intro");
    setStatus("");
    var startBtn = el("start");
    if (startBtn) startBtn.focus();
  }

  function bind(els) {
    state.els = els;
    els.root.addEventListener("click", function (e) {
      var t = e.target.closest("[data-scan-action]");
      if (t) {
        var a = t.getAttribute("data-scan-action");
        if (a === "start") return start();
        if (a === "capture") return capture();
        if (a === "retry") { show("intro"); setStatus(""); return; }
        if (a === "confirm") return confirmSubmit();
        if (a === "close") return close();
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
    CONFIDENT: CONFIDENT
  };
});
