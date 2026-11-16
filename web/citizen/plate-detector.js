/* IDauto — Update 2 — automatic plate localisation, tracking and vehicle colour.
 *
 * Runs entirely in the browser, on a small grayscale copy of the camera frame.
 * No image leaves the device from this file, and nothing here reads a digit:
 * the detector only answers "where is a registration plate", the tracker
 * answers "has it stopped moving", and colourOf() names the dominant paint
 * colour around the plate. Reading the number stays in plate-scanner.js.
 *
 * How a plate is found: a Tunisian plate is a BLACK rectangle carrying WHITE
 * characters, « 173تونس8116 ». Every pixel clearly brighter than its
 * neighbourhood is kept, the kept pixels are grouped into shapes, and the
 * shapes standing on one line are chained. A plate reads: one to three single
 * digits, then something that is not a digit (the word تونس: one or two wide
 * shapes — or, on a spaced plate, a wide gap), then one to four single digits.
 * A grille, a headlamp, a line of ordinary lettering or a white foreign plate
 * does not read that way.
 *
 * Pure functions, no DOM: the same file is exercised by Node tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPlateDetector = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WORK_W = 640;                 // detection runs at this width
  var WORK_W_FINE = 1024;           // second look, only when nothing was found: a plate held far away
  var WINDOWS = [8, 18];            // half-sizes of the local-contrast window (near and far plates)
  var MIN_CHARS = 4;                // a Tunisian plate carries 4 to 7 digits
  var MIN_SCORE = 0.8;

  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return g;
  }

  function integral(g, w, h) {
    var W = w + 1, I = new Uint32Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
    }
    return I;
  }

  /* Bright glyphs: pixels clearly brighter than their neighbourhood. */
  function brightMap(g, I, w, h, r) {
    var W = w + 1, m = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var y0 = y - r < 0 ? 0 : y - r, y1 = y + r + 1 > h ? h : y + r + 1;
      for (var x = 0; x < w; x++) {
        var x0 = x - r < 0 ? 0 : x - r, x1 = x + r + 1 > w ? w : x + r + 1;
        var area = (x1 - x0) * (y1 - y0), sum = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
        var mean = sum / area;
        if (g[y * w + x] > mean + 12 + mean * 0.08) m[y * w + x] = 1;
      }
    }
    return m;
  }

  /* Connected components → bounding boxes with their area. */
  function components(m, w, h) {
    var seen = new Uint8Array(w * h), out = [], stack = new Int32Array(w * h), x, y, dx, dy;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var s = y * w + x;
      if (!m[s] || seen[s]) continue;
      var top = 0, x0 = x, x1 = x, y0 = y, y1 = y, area = 0;
      stack[top++] = s; seen[s] = 1;
      while (top) {
        var p = stack[--top], px = p % w, py = (p / w) | 0; area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
          if (dx && dy) continue;                       // 4-neighbours: two digits touching by a corner stay two
          var nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var q = ny * w + nx;
          if (m[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
      out.push({ x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, area: area });
    }
    return out;
  }

  /* Keeps what is shaped like a digit: taller than wide, neither a speck nor a panel. */
  function glyphs(cs, w, h, g) {
    var out = [];
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], cw = c.x1 - c.x0, ch = c.y1 - c.y0;
      // up to four digits may touch each other (a blurred or distant plate): such a shape counts for several
      if (ch < 7 || ch > h * 0.3 || cw > ch * 3.1 || cw < Math.max(1, ch * 0.07)) continue;
      if (c.area < cw * ch * 0.18) continue;
      if (g) {
        // a character on a plate stands on a dark ground: at least one of its two sides must be dark
        // (the other side may be the next digit, a pixel away on a distant plate)
        var mx = 0, sl = 0, sr = 0, nl = 0, nr = 0, x, y;
        for (y = c.y0; y < c.y1; y++) {
          for (x = c.x0; x < c.x1; x++) if (g[y * w + x] > mx) mx = g[y * w + x];
          if (c.x0 >= 2) { sl += g[y * w + c.x0 - 2]; nl++; }
          if (c.x1 + 1 < w) { sr += g[y * w + c.x1 + 1]; nr++; }
        }
        var side = Math.min(nl ? sl / nl : 255, nr ? sr / nr : 255);
        if (mx - side < 30 || side > mx * 0.62) continue;
      }
      out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, w: cw, h: ch, cy: (c.y0 + c.y1) / 2, n: Math.max(1, Math.round(cw / (ch * 0.62))) });
    }
    out.sort(function (a, b) { return a.x0 - b.x0; });
    return out;
  }

  /* Chains what stands on one line: digits (single, one height, one baseline) and,
   * between them, the word تونس. On a real plate the word sits tight between the two
   * groups and is nearly as tall as the digits (« 173تونس8116 »); it shows up as one
   * or two WIDE shapes. On a spaced plate it may instead leave a wide gap. Either way
   * a plate reads: 1–3 single digits · something that is not a digit · 1–4 single digits. */
  function chains(gl) {
    var out = [];
    for (var i = 0; i < gl.length; i++) {
      if (gl[i].n > 3) continue;                                        // a plate starts on a digit (or two or three touching)
      // kind: "d" one digit · "x" digits touching each other OR a piece of the word (same height) · "w" the word (another height)
      var members = [{ g: gl[i], kind: gl[i].n === 1 ? "d" : "x" }], cur = gl[i], at = i, H = cur.h, base = cur.y1, baseX = cur.x1, bigGap = 0, nH = 1;
      for (;;) {
        var next = null, kind = "";
        for (var j = at + 1; j < gl.length; j++) {                      // sorted by x0: what follows `cur` comes after it
          var c = gl[j], gap = c.x0 - cur.x1;
          if (gap < -H * 0.15) continue;
          if (gap > H * 5) break;
          var like = Math.abs(c.h - H) <= H * 0.22 && Math.abs(c.y1 - base) <= H * 0.14 + Math.max(0, c.x0 - baseX) * 0.13;   // a plate may lean a few degrees
          // Digits never overlap sideways. A shape that overlaps the word shape before it belongs to the word, however
          // digit-like it looks: on a real plate the last letter of تونس is as tall as a digit.
          if (like && gap <= 0 && members[members.length - 1].kind !== "d") kind = "w";
          else if (like) kind = c.n === 1 ? "d" : "x";
          else if (c.h >= H * 0.45 && c.h <= H * 1.25 && c.cy > base - H * 1.05 - Math.max(0, c.x0 - baseX) * 0.13 && c.cy < base + H * 0.1 + Math.max(0, c.x0 - baseX) * 0.13) kind = "w";
          else continue;
          next = c; at = j; break;
        }
        if (!next) break;
        var g2 = next.x0 - cur.x1;
        // spacing: close together, or ONE wide gap (a plate whose word is small and set apart)
        if (g2 > H * 0.9) { if (bigGap || g2 < H * 1.1) break; bigGap = members.length; }
        members.push({ g: next, kind: kind });
        if (kind === "d") { H = (H * nH + next.h) / (nH + 1); nH++; base = next.y1; baseX = next.x1; }
        cur = next;
      }
      // Where is the word? Every way of cutting the line into série · middle · numéro is tried; the middle is a run
      // of shapes that are not single digits (or the wide gap). Kept: the cut that leaves the most digits, a real
      // word shape in the middle being preferred to digits that merely touched.
      var best = null, n = members.length, p, q, k;
      for (p = 1; p < n; p++) {
        for (q = p; q < n; q++) {
          if (q === p && bigGap !== p) continue;                         // an empty middle only at the wide gap
          var ok = true, hasW = false;
          for (k = p; k < q; k++) { if (members[k].kind === "d") { ok = false; break; } if (members[k].kind === "w") hasW = true; }
          if (!ok) break;
          var left = 0, right = 0, merged = 0;
          for (k = 0; k < p; k++) { if (members[k].kind === "w") { left = 99; break; } left += members[k].g.n; if (members[k].kind === "x") merged++; }
          for (k = q; k < n; k++) { if (members[k].kind === "w") { right = 99; break; } right += members[k].g.n; if (members[k].kind === "x") merged++; }
          if (left < 1 || left > 3 || right < 1 || right > 4 || left + right < MIN_CHARS) continue;
          var mid = (members[q].g.x0 - members[p - 1].g.x1) / H;
          if (mid < 0.9 || mid > 5.5) continue;
          var value = (left + right) * 10 + (hasW ? 5 : 0) - merged * 3 - Math.abs(mid - 2) ;
          if (!best || value > best.value) best = { value: value, a: p, z: q, left: left, right: right, merged: merged };
        }
      }
      if (!best) continue;
      out.push({ members: members.map(function (m) { return m.g; }), h: H, a: best.a, z: best.z, left: best.left, right: best.right, count: best.left + best.right, bigGap: bigGap ? 1 : 0, merged: best.merged, singles: nH });
    }
    return out;
  }

  /* detect(gray, w, h) → { x, y, w, h, score, groups } in FRACTIONS of the image, or null. */
  function detect(g, w, h) {
    if (!g || w < 64 || h < 48) return null;
    var I = integral(g, w, h), best = null;
    for (var wi = 0; wi < WINDOWS.length; wi++) {
      var m = brightMap(g, I, w, h, WINDOWS[wi]);
      var cs = chains(glyphs(components(m, w, h), w, h, g));
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], mem = c.members, n = mem.length, H = c.h, count = c.count;
        var x0 = mem[0].x0, x1 = mem[n - 1].x1, y0 = Infinity, y1 = -Infinity, k, x, y;
        var digits = mem.slice(0, c.a).concat(mem.slice(c.z));
        for (k = 0; k < digits.length; k++) { if (digits[k].y0 < y0) y0 = digits[k].y0; if (digits[k].y1 > y1) y1 = digits[k].y1; }
        var tw = x1 - x0, aspect = tw / H;
        if (aspect < 2.6 || aspect > 9) continue;
        // the glyphs must be bright and the ground between them dark
        var on = 0, off = 0, nOn = 0, nOff = 0;
        for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { if (m[y * w + x]) { on += g[y * w + x]; nOn++; } else { off += g[y * w + x]; nOff++; } }
        if (!nOn || !nOff) continue;
        var onMean = on / nOn, offMean = off / nOff, contrast = onMean - offMean, ink = nOn / (nOn + nOff);
        var ratio = onMean / Math.max(1, offMean);              // in poor light the difference shrinks, the ratio holds
        if ((contrast < 35 && ratio < 2) || contrast < 18 || ink < 0.1 || ink > 0.6) continue;
        // digits of one plate are alike: one height
        var hs = 0, hq = 0;
        for (k = 0; k < digits.length; k++) { hs += digits[k].h; hq += digits[k].h * digits[k].h; }
        var hsd = Math.sqrt(Math.max(0, hq / digits.length - (hs / digits.length) * (hs / digits.length))) / (hs / digits.length);
        if (hsd > 0.09 || c.singles < 2) continue;
        var a1 = mem[c.a - 1].x1, b0 = mem[c.z].x0, mid = (b0 - a1) / H;       // what lies between the groups, in digit heights
        if (mid < 0.9 || mid > 5.5) continue;
        var score = 0.62 + 0.2 * Math.min(1, count / 6) + 0.18 * Math.min(1, Math.max(contrast / 100, (ratio - 1) / 3)) - hsd + 0.012 * count - 0.03 * c.merged;
        if (!best || score > best.score) {
          // the plate itself: about half a character above and below, a little more on the sides
          best = { x0: Math.max(0, x0 - H * 0.45), y0: Math.max(0, y0 - H * 0.42), x1: Math.min(w, x1 + H * 0.45), y1: Math.min(h, y1 + H * 0.42), score: score, chars: count, contrast: contrast, groups: null };
          // The two groups of digits, each with a small margin: they are read separately, the word between them is not read.
          // The count is trusted (« counted ») unless something says the chain is not the whole plate:
          //   – the middle is wider than a word can be (digits that touched each other were taken for the word);
          //   – strokes are left over just beyond either end.
          // …or the plate leans: digits read off a slanted line are confused (a 7 for a 1) with full confidence.
          var lean = Math.abs(mem[n - 1].y1 - mem[0].y1) / Math.max(1, mem[n - 1].x0 - mem[0].x0);
          var clean = !c.merged && lean <= 0.035 && (mid <= 3.4 || (c.bigGap === 1 && c.z === c.a));
          var zw = Math.max(2, Math.round(H * 0.3)), zg = Math.max(1, Math.round(H * 0.1)), extra = 0, zn = 0;   // narrow: on a real plate the border runs half a digit away
          for (y = y0; y < y1; y++) {
            for (x = Math.max(0, x0 - zg - zw); x < x0 - zg; x++) { zn++; if (m[y * w + x]) extra++; }
            for (x = x1 + zg; x < Math.min(w, x1 + zg + zw); x++) { zn++; if (m[y * w + x]) extra++; }
          }
          if (zn && extra / zn > 0.28) clean = false;      // (the plate's own border is a thin line: well under this)
          var mgx = Math.min(H * 0.25, Math.max(1, (b0 - a1) * 0.12)), mgy = H * 0.12;
          best.groups = [[mem[0].x0, a1, c.left, mem.slice(0, c.a)], [b0, mem[n - 1].x1, c.right, mem.slice(c.z)]].map(function (r) {
            return { x: Math.max(0, r[0] - mgx) / w, y: Math.max(0, y0 - mgy) / h, w: (Math.min(w, r[1] + mgx) - Math.max(0, r[0] - mgx)) / w, h: (Math.min(h, y1 + mgy) - Math.max(0, y0 - mgy)) / h,
              digits: r[2], counted: clean,     // how many digits stand there (trusted when `counted`)
              // each digit on its own, when every shape of the group is one digit: read one by one if the group reading miscounts
              cells: r[3].every(function (q) { return q.n === 1; }) ? r[3].map(function (q) {
                var cx = Math.max(1, q.h * 0.12);
                return { x: Math.max(0, q.x0 - cx) / w, y: Math.max(0, y0 - mgy) / h, w: (Math.min(w, q.x1 + cx) - Math.max(0, q.x0 - cx)) / w, h: (Math.min(h, y1 + mgy) - Math.max(0, y0 - mgy)) / h };
              }) : null };
          });
        }
      }
    }
    if (!best || best.score < MIN_SCORE) return null;
    return { x: best.x0 / w, y: best.y0 / h, w: (best.x1 - best.x0) / w, h: (best.y1 - best.y0) / h,
      score: Math.round(Math.min(1, best.score) * 1000) / 1000, chars: best.chars, contrast: Math.round(best.contrast), groups: best.groups };
  }

  function iou(a, b) {
    var x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    var inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return inter ? inter / (a.w * a.h + b.w * b.h - inter) : 0;
  }

  /* A plate is STABLE when it was seen `need` times in a row at (nearly) the same
   * place. Only then is one frame captured and read — never one OCR per frame. */
  function createTracker(opts) {
    opts = opts || {};
    var need = opts.need || 4, minIou = opts.minIou || 0.55, maxMiss = opts.maxMiss || 2, alpha = 0.5;
    var box = null, hits = 0, miss = 0;
    return {
      update: function (det) {
        if (!det) { if (++miss > maxMiss) { box = null; hits = 0; } return { box: box, hits: hits, stable: false, lost: !box }; }
        miss = 0;
        if (box && iou(box, det) >= minIou) {
          hits++;
          box = { x: box.x + (det.x - box.x) * alpha, y: box.y + (det.y - box.y) * alpha, w: box.w + (det.w - box.w) * alpha, h: box.h + (det.h - box.h) * alpha, score: det.score, groups: det.groups || null, contrast: det.contrast, chars: det.chars };
        } else { box = { x: det.x, y: det.y, w: det.w, h: det.h, score: det.score, groups: det.groups || null, contrast: det.contrast, chars: det.chars }; hits = 1; }
        return { box: box, hits: hits, stable: hits >= need, lost: false };
      },
      reset: function () { box = null; hits = 0; miss = 0; }
    };
  }

  /* ---------------- vehicle colour ----------------
   * The paint is sampled on the body panel just ABOVE the plate (bonnet or boot
   * lid), three plate-widths wide; the plate itself, the bumper below and the
   * background are left out. Each pixel votes for a colour name; the answer is
   * "unknown" when no colour clearly wins. A hint, never a fact: reflections,
   * night and coloured light all change what a camera sees. */
  var COLOURS = ["noir", "blanc", "gris", "argent", "rouge", "bleu", "vert", "jaune", "orange", "marron", "beige"];
  function nameOf(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), v = max / 255, s = max ? (max - min) / max : 0, hue = 0, d = max - min;
    if (d) {
      if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
      hue *= 60; if (hue < 0) hue += 360;
    }
    if (v < 0.20) return "noir";
    if (s < 0.14) return v > 0.80 ? "blanc" : v > 0.52 ? "argent" : v < 0.30 ? "noir" : "gris";
    if (s < 0.30 && v < 0.28) return "noir";
    if (hue < 15 || hue >= 340) return "rouge";
    if (hue < 45) return v < 0.50 ? "marron" : (s < 0.38 ? "beige" : "orange");
    if (hue < 70) return s < 0.35 ? "beige" : "jaune";
    if (hue < 170) return "vert";
    if (hue < 265) return "bleu";
    return "rouge";
  }
  function colourOf(rgba, w, h, plate) {
    if (!rgba || !plate) return { value: "unknown", confidence: 0 };
    // In a dark scene every car looks black: no colour is named at all.
    var lum = 0, ln = 0, step = Math.max(4, ((w * h / 4000) | 0) * 4);
    for (var q = 0; q < rgba.length; q += step) { lum += (rgba[q] * 77 + rgba[q + 1] * 150 + rgba[q + 2] * 29) >> 8; ln++; }
    if (!ln || lum / ln < 60) return { value: "unknown", confidence: 0, reason: "too_dark" };
    // Two places are looked at and must agree: the panel right beside and just above the plate, and the body higher
    // up. Beside the plate may be a black bumper or grille on a white car; higher up may be a window full of sky on a
    // black car. When the two disagree no colour is named — the person (or the vision analysis) decides.
    var px = plate.x * w, py = plate.y * h, pw = plate.w * w, ph = plate.h * h;
    function tally(rects) {
      var votes = {}, n = 0;
      rects.forEach(function (r) {
        var x0 = Math.max(0, Math.round(r[0])), y0 = Math.max(0, Math.round(r[1])), x1 = Math.min(w, Math.round(r[2])), y1 = Math.min(h, Math.round(r[3]));
        if (x1 - x0 < 3 || y1 - y0 < 2) return;
        var sx = Math.max(1, ((x1 - x0) / 60) | 0), sy = Math.max(1, ((y1 - y0) / 24) | 0);
        for (var y = y0; y < y1; y += sy) for (var x = x0; x < x1; x += sx) {
          var i = (y * w + x) * 4, c = nameOf(rgba[i], rgba[i + 1], rgba[i + 2]);
          if (c === "argent") c = "gris";                       // one family for this purpose
          votes[c] = (votes[c] || 0) + 1; n++;
        }
      });
      var top = null;
      Object.keys(votes).forEach(function (k) { if (!top || votes[k] > votes[top]) top = k; });
      return { value: top, share: n >= 30 && top ? votes[top] / n : 0 };
    }
    var near = tally([[px - pw * 0.9, py - ph * 0.2, px - pw * 0.12, py + ph * 1.2], [px + pw * 1.12, py - ph * 0.2, px + pw * 1.9, py + ph * 1.2], [px - pw * 0.3, py - ph * 1.5, px + pw * 1.3, py - ph * 0.45]]);
    var high = tally([[px - pw, py - ph * 4, px + 2 * pw, py - ph * 1.6]]);
    var conf = Math.round(Math.min(near.share, high.share) * 100) / 100;
    if (!near.value || near.value !== high.value || near.share < 0.4 || high.share < 0.4) return { value: "unknown", confidence: conf };
    return { value: near.value, confidence: conf };
  }

  // Update 3.2 — the paint colour measured on the pixels of a paint-only area (`box`: [x, y, w, h], fractions of the
  // image, given by the vision analysis). The brightest and darkest 12 % are dropped (reflections, shadows), then the
  // remaining pixels vote; grey and silver count as one family. A clear majority names the colour, otherwise "unknown".
  function paintColour(rgba, w, h, box) {
    if (!rgba || !box || box.length !== 4) return { value: "unknown", confidence: 0, reason: "no_area" };
    var x0 = Math.max(0, Math.floor(box[0] * w)), y0 = Math.max(0, Math.floor(box[1] * h)), x1 = Math.min(w, Math.ceil((box[0] + box[2]) * w)), y1 = Math.min(h, Math.ceil((box[1] + box[3]) * h));
    if (x1 - x0 < 4 || y1 - y0 < 4) return { value: "unknown", confidence: 0, reason: "area_too_small" };
    var px = [], sx = Math.max(1, ((x1 - x0) / 80) | 0), sy = Math.max(1, ((y1 - y0) / 80) | 0);
    for (var y = y0; y < y1; y += sy) for (var x = x0; x < x1; x += sx) { var i = (y * w + x) * 4; px.push([rgba[i], rgba[i + 1], rgba[i + 2], (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8]); }
    if (px.length < 40) return { value: "unknown", confidence: 0, reason: "area_too_small" };
    px.sort(function (a, b) { return a[3] - b[3]; });
    var keep = px.slice(Math.floor(px.length * 0.12), Math.ceil(px.length * 0.88)), lum = 0;
    keep.forEach(function (p) { lum += p[3]; });
    // black paint is dark (luminance ~20–50): only an area with almost no light at all is refused here; a dark SCENE
    // (night) is judged on the whole photograph, below
    if (lum / keep.length < 12) return { value: "unknown", confidence: 0, reason: "too_dark" };
    var scene = 0, sn = 0, st = Math.max(4, ((w * h / 3000) | 0) * 4);
    for (var q = 0; q < rgba.length; q += st) { scene += (rgba[q] * 77 + rgba[q + 1] * 150 + rgba[q + 2] * 29) >> 8; sn++; }
    if (sn && scene / sn < 45 && lum / keep.length < 60) return { value: "unknown", confidence: 0, reason: "night" };   // at night every paint looks black or grey
    var votes = {}, fam = {};
    keep.forEach(function (p) { var c = nameOf(p[0], p[1], p[2]); votes[c] = (votes[c] || 0) + 1; var f = c === "argent" ? "gris" : c; fam[f] = (fam[f] || 0) + 1; });
    var top = null, topF = null;
    Object.keys(votes).forEach(function (k) { if (!top || votes[k] > votes[top]) top = k; });
    Object.keys(fam).forEach(function (k) { if (!topF || fam[k] > fam[topF]) topF = k; });
    var share = fam[topF] / keep.length;
    if (share < 0.55) return { value: "unknown", confidence: Math.round(share * 100) / 100, reason: "mixed" };
    var value = topF === "gris" ? (votes.argent > (votes.gris || 0) ? "argent" : "gris") : topF;
    return { value: value, confidence: Math.round(share * 100) / 100, family: topF };
  }

  return { paintColour: paintColour, _: { integral: integral, brightMap: brightMap, components: components, glyphs: glyphs, chains: chains, WINDOWS: WINDOWS }, WORK_W: WORK_W, WORK_W_FINE: WORK_W_FINE, toGray: toGray, detect: detect, iou: iou, createTracker: createTracker, colourOf: colourOf, nameOf: nameOf, COLOURS: COLOURS, MIN_SCORE: MIN_SCORE };
});
