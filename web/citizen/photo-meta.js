/* IDauto — Update 3 — what a photograph file says about itself, and how several photographs of
 * one vehicle are put together. Pure functions, no DOM, no network: the same file runs in Node tests.
 *
 * readExif(bytes) reads, from a JPEG's own EXIF block, the GPS position and the capture date — nothing
 * else, and nothing is guessed: a file without them answers nulls. The position is the PHOTOGRAPH's:
 * it is never replaced by where the person happens to be when they upload it.
 *
 * combine(photos) merges what was recognised on each photograph of the same vehicle. A front view
 * usually has no plate and that is not a failure. When two photographs disagree, nothing is chosen
 * silently: the disagreement is returned as a conflict for the person to settle.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPhotoMeta = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function readExif(input) {
    var out = { latitude: null, longitude: null, capturedAt: null, hasExif: false };
    var b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    if (b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8) return out;
    var p = 2;
    while (p + 4 <= b.length) {                                   // walk the JPEG segments to APP1 "Exif"
      if (b[p] !== 0xff) break;
      var marker = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (marker === 0xda || len < 2) break;                      // start of scan: no more metadata
      if (marker === 0xe1 && len >= 8 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) { tiff(b, p + 10, p + 2 + len, out); break; }
      p += 2 + len;
    }
    return out;
  }

  function tiff(b, t, end, out) {
    if (t + 8 > end || end > b.length) return;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return;
    function u16(o) { return o + 2 > end ? 0 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
    function u32(o) { return o + 4 > end ? 0 : le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
    if (u16(t + 2) !== 42) return;
    out.hasExif = true;
    function entries(ifd) {
      var m = {};
      if (ifd + 2 > end) return m;
      var n = u16(ifd);
      for (var i = 0; i < n && i < 200; i++) { var e = ifd + 2 + i * 12; if (e + 12 > end) break; m[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 }; }
      return m;
    }
    function ascii(e) { if (!e || e.type !== 2) return ""; var o = e.count <= 4 ? e.at : t + u32(e.at), s = ""; for (var i = 0; i < e.count - 1 && o + i < end; i++) s += String.fromCharCode(b[o + i]); return s; }
    function rationals(e, k) { if (!e || e.type !== 5 || e.count < k) return null; var o = t + u32(e.at), r = []; for (var i = 0; i < k; i++) { var den = u32(o + i * 8 + 4); if (!den) return null; r.push(u32(o + i * 8) / den); } return r; }
    var ifd0 = entries(t + u32(t + 4));
    var ex = ifd0[0x8769] ? entries(t + u32(ifd0[0x8769].at)) : {};
    var d = ascii(ex[0x9003]) || ascii(ex[0x9004]) || ascii(ifd0[0x0132]);          // DateTimeOriginal "YYYY:MM:DD HH:MM:SS"
    var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(d);
    if (m && +m[1] >= 2000) { var dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); if (!isNaN(dt.getTime())) out.capturedAt = dt.toISOString(); }
    if (ifd0[0x8825]) {                                           // GPS IFD
      var g = entries(t + u32(ifd0[0x8825].at)), lat = rationals(g[2], 3), lon = rationals(g[4], 3), latRef = ascii(g[1]), lonRef = ascii(g[3]);
      if (lat && lon && /^[NS]/.test(latRef) && /^[EW]/.test(lonRef)) {
        var la = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef[0] === "S" ? -1 : 1), lo = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (lonRef[0] === "W" ? -1 : 1);
        if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) { out.latitude = Math.round(la * 1e6) / 1e6; out.longitude = Math.round(lo * 1e6) / 1e6; }
      }
    }
  }

  /* Which location a photograph gets, in this order and no other:
   *   1. the GPS position written in the file itself (EXIF);
   *   2. for a photograph TAKEN in the application, the device's position — only if the person allowed it;
   *   3. nothing: the person may then type the place (source "manual"), or leave it unknown.
   * A file chosen from the device never receives the device's current position. */
  function chooseLocation(exif, live, taken) {
    if (exif && exif.latitude !== null && exif.longitude !== null) return { source: "exif", latitude: exif.latitude, longitude: exif.longitude };
    if (taken && live && typeof live.latitude === "number" && typeof live.longitude === "number") return { source: "browser", latitude: live.latitude, longitude: live.longitude };
    return null;
  }

  var FIELDS = ["make", "model", "trim", "colour", "body_type", "year"];
  function norm(v) { return String(v === null || v === undefined ? "" : v).trim().toUpperCase(); }

  /* photos: [{ view, analysis: { plate: {serie, numero, confidence(0–100), source, accepted}, fields: {f: {value, confidence(0–1), source}} } }]
   * → { plate, fields, conflicts: [{ field, values: [{ value, photo, confidence, source }] }], platePhotos, withoutPlate } */
  function combine(photos) {
    var out = { plate: null, fields: {}, conflicts: [], platePhotos: 0, withoutPlate: 0 }, plates = [];
    (photos || []).forEach(function (ph, i) {
      var a = ph && ph.analysis;
      if (!a) return;
      if (a.plate && a.plate.serie && a.plate.numero) plates.push({ value: a.plate.serie + " " + a.plate.numero, serie: a.plate.serie, numero: a.plate.numero, confidence: typeof a.plate.confidence === "number" ? a.plate.confidence : 0, source: a.plate.source, accepted: !!a.plate.accepted, photo: i });
      else out.withoutPlate++;
    });
    out.platePhotos = plates.length;
    if (plates.length) {
      plates.sort(function (x, y) { return (y.accepted - x.accepted) || (y.confidence - x.confidence); });
      out.plate = plates[0];
      if (plates.some(function (p) { return p.value !== plates[0].value; })) out.conflicts.push({ field: "plate", values: plates.map(function (p) { return { value: p.value, photo: p.photo, confidence: p.confidence, source: p.source }; }) });
    }
    FIELDS.forEach(function (f) {
      var vals = [];
      (photos || []).forEach(function (ph, i) { var v = ph && ph.analysis && ph.analysis.fields && ph.analysis.fields[f]; if (v && v.value) vals.push({ value: v.value, confidence: typeof v.confidence === "number" ? v.confidence : 0, source: v.source, photo: i }); });
      if (!vals.length) return;
      // what the vision model named outranks the device's own estimate; then the more confident value
      vals.sort(function (x, y) { return ((y.source === "vision") - (x.source === "vision")) || (y.confidence - x.confidence); });
      out.fields[f] = vals[0];
      if (vals.some(function (v) { return norm(v.value) !== norm(vals[0].value); })) out.conflicts.push({ field: f, values: vals });
    });
    return out;
  }

  return { readExif: readExif, chooseLocation: chooseLocation, combine: combine, FIELDS: FIELDS };
});
