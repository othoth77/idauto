/* IDauto — IDA-V14 — TunisianRegistrationDocumentParser
 * ============================================================================
 * Pure, offline, shared by the server (reference/) and the browser (served
 * as /atelier/assets/registration-parser.js). Turns the raw OCR text of a
 * Tunisian carte grise (face 1, optionally face 2; French + Arabic labels,
 * Latin/Arabic-Indic digits) into a structure of TECHNICAL fields only:
 *
 *   { registration, manufacturer, model, type, genre, engine, motorisation,
 *     vin, year, first_registration_date, fuel, engine_cc, seats,
 *     gross_weight_kg, fiscal_power, confidence, fields:[{key,value,confidence,source,label}], warnings:[] }
 *
 * WHAT IT NEVER EXTRACTS. The holder's name, address, CIN, birth date or
 * any owner line: those labels are on a deny-list and the line (and the one
 * after it) is dropped before any field detector runs. The raw text itself
 * is never stored by the caller; this parser is the only thing that reads it.
 *
 * OCR IS A PROPOSAL. Every value carries a confidence; the caller compares
 * it with what the vehicle already holds and asks the person to confirm.
 * The label vocabulary below was assembled from the printed layout of the
 * Tunisian certificat d'immatriculation and has NOT been validated against a
 * corpus of real cards: it is a configurable starting point, not a promise.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaRegistrationParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ARABIC_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  function asciiDigits(s) { return String(s).replace(/[٠-٩۰-۹]/g, function (d) { return ARABIC_DIGITS[d] || d; }); }
  function stripAccents(s) { return s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s; }
  function norm(s) { return stripAccents(asciiDigits(s)).toUpperCase().replace(/[ \t]+/g, " ").trim(); }

  // Lines carrying holder data are removed BEFORE anything else looks at them.
  var DENY = [/\bNOM\b/, /\bPRENOM\b/, /\bADRESSE\b/, /\bC\.?I\.?N\b/, /\bPROPRIETAIRE\b/, /\bTITULAIRE\b/, /\bNE\s*LE\b/, /\bDATE DE NAISSANCE\b/,
    /الاسم/, /اللقب/, /العنوان/, /المالك/, /بطاقة التعريف/, /تاريخ الولادة/, /صاحب/];

  // label → field. Order matters when a label is a prefix of another.
  var LABELS = [
    { key: "vin", labels: ["N° DE SERIE DU TYPE", "NUMERO DE SERIE", "N° DE SERIE", "N° SERIE", "NO SERIE", "CHASSIS", "N° CHASSIS", "VIN", "رقم الهيكل", "الهيكل", "رقم السلسلة"] },
    { key: "registration", labels: ["N° D'IMMATRICULATION", "NUMERO D'IMMATRICULATION", "IMMATRICULATION", "N° IMMAT", "IMMAT", "رقم التسجيل", "التسجيل", "رقم المنجم"] },
    { key: "manufacturer", labels: ["MARQUE", "CONSTRUCTEUR", "الصانع", "ماركة", "الماركة"] },
    { key: "type", labels: ["TYPE COMMERCIAL", "TYPE", "MODELE", "VARIANTE", "الطراز", "النوع التجاري", "النوع"] },
    { key: "genre", labels: ["GENRE", "CATEGORIE", "الصنف", "الفئة"] },
    { key: "first_registration_date", labels: ["D.P.M.C", "DPMC", "DATE DE PREMIERE MISE EN CIRCULATION", "PREMIERE MISE EN CIRCULATION", "MISE EN CIRCULATION", "1ERE MISE", "تاريخ أول جولان", "أول جولان", "تاريخ اول جولان"] },
    { key: "fuel", labels: ["ENERGIE", "CARBURANT", "SOURCE D'ENERGIE", "الطاقة", "الوقود", "مصدر الطاقة"] },
    { key: "engine_cc", labels: ["CYLINDREE", "CYLINDRE", "السعة الاسطوانية", "السعة", "سعة المحرك"] },
    { key: "fiscal_power", labels: ["PUISSANCE FISCALE", "PUISSANCE", "P. FISCALE", "القوة الجبائية", "القوة"] },
    { key: "seats", labels: ["NOMBRE DE PLACES", "PLACES ASSISES", "PLACES", "عدد المقاعد", "المقاعد"] },
    { key: "gross_weight_kg", labels: ["POIDS TOTAL AUTORISE", "POIDS TOTAL", "PTAC", "P.T.A.C", "الوزن الجملي المرخص", "الوزن الجملي", "الوزن"] },
    { key: "engine", labels: ["TYPE MOTEUR", "N° MOTEUR", "NUMERO MOTEUR", "MOTEUR", "رقم المحرك", "نوع المحرك", "المحرك"] }
  ];
  var LABEL_INDEX = [];
  LABELS.forEach(function (d) { d.labels.forEach(function (l) { LABEL_INDEX.push({ key: d.key, label: norm(l) }); }); });
  LABEL_INDEX.sort(function (a, b) { return b.label.length - a.label.length; });

  var FUEL = [[/ESS|ES\b|ESSENCE|بنزين/, "petrol"], [/GO\b|GAS ?OIL|GAZOLE|DIESEL|قازوال|ديزل|مازوط/, "diesel"], [/GPL|LPG|غاز/, "lpg"], [/EL\b|ELEC|كهرب/, "electric"], [/HYB|هجين/, "hybrid"]];
  var GENRE = [[/^VP\b|VOITURE PART|سيارة خاصة|سيارة سياحية/, "M1"], [/CTTE|CAMIONNETTE|شاحنة خفيفة/, "N1"], [/^CAM\b|CAMION|شاحنة/, "N2"], [/MOTO|دراجة/, "L3"], [/BUS|AUTOCAR|حافلة/, "M3"]];

  function cleanValue(v) { return v.replace(/^[\s:،:\-–—.]+/, "").replace(/[\s:،\-–—.]+$/, "").trim(); }

  // The value of a labelled line: the remainder after the label, or the
  // next non-empty line when the label stands alone on its line.
  function valueAfter(lines, i, labelEnd) {
    var rest = cleanValue(lines[i].slice(labelEnd));
    if (rest && /[A-Z0-9؀-ۿ]/.test(rest)) return { value: rest, span: 0 };
    if (i + 1 < lines.length) { var nxt = cleanValue(lines[i + 1]); if (nxt && !labelAt(nxt)) return { value: nxt, span: 1 }; }
    return null;
  }
  function labelAt(line) {
    for (var k = 0; k < LABEL_INDEX.length; k++) {
      var idx = line.indexOf(LABEL_INDEX[k].label);
      if (idx !== -1 && idx <= 4) return { key: LABEL_INDEX[k].key, end: idx + LABEL_INDEX[k].label.length, label: LABEL_INDEX[k].label };
    }
    return null;
  }

  // OCR confusions inside a 17-character VIN candidate.
  function vinCandidates(text) {
    var out = [];
    var re = /[A-Z0-9OIQ]{17}/g, m;
    var t = text.replace(/[^A-Z0-9؀-ۿ]+/g, " ");
    while ((m = re.exec(t)) !== null) {
      var raw = m[0], fixed = raw.replace(/O/g, "0").replace(/I/g, "1").replace(/Q/g, "0");
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(fixed)) out.push({ value: fixed, corrected: fixed !== raw });
    }
    return out;
  }

  function parseDate(v) {
    var m = /(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})/.exec(v) || /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(v);
    if (!m) { var y = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(v); return y ? { year: Number(y[1]), date: null } : null; }
    var year = m[1].length === 4 ? Number(m[1]) : Number(m[3]);
    if (year < 1950 || year > 2049) return null;
    var dd = m[1].length === 4 ? m[3] : m[1], mm = m[2];
    return { year: year, date: year + "-" + ("0" + mm).slice(-2) + "-" + ("0" + dd).slice(-2) };
  }

  function intValue(v, min, max) { var m = /(\d{1,6})/.exec(v.replace(/[\s.]/g, "")); if (!m) return null; var n = Number(m[1]); return n >= min && n <= max ? n : null; }

  function parseFace(text, opts) {
    opts = opts || {};
    var source = opts.source || "face_1";
    var base = typeof opts.confidence === "number" ? Math.max(0, Math.min(1, opts.confidence > 1 ? opts.confidence / 100 : opts.confidence)) : 0.6;
    var fields = [], warnings = [];
    var rawLines = String(text || "").split(/\r?\n/).map(norm).filter(Boolean);
    // Holder lines out first — and the line after a lone holder label.
    var lines = [], skipNext = false;
    rawLines.forEach(function (l) {
      if (skipNext) { skipNext = false; return; }
      if (DENY.some(function (re) { return re.test(l); })) { skipNext = /^(NOM|PRENOM|ADRESSE|الاسم|اللقب|العنوان)\s*[:：]?\s*$/.test(l); return; }
      lines.push(l);
    });
    var joined = lines.join("\n");
    function add(key, value, conf, label) { if (value === null || value === undefined || value === "") return; fields.push({ key: key, value: value, confidence: Math.round(Math.max(0.05, Math.min(1, conf)) * 100) / 100, source: source, label: label || null }); }

    // 1. Labelled fields.
    for (var i = 0; i < lines.length; i++) {
      var hit = labelAt(lines[i]);
      if (!hit) continue;
      var got = valueAfter(lines, i, hit.end);
      if (!got) continue;
      var v = got.value;
      if (hit.key === "vin") { var vc = vinCandidates(v); if (vc.length) add("vin", vc[0].value, base + (vc[0].corrected ? 0.05 : 0.2), hit.label); }
      else if (hit.key === "registration") add("registration", v, base + 0.1, hit.label);
      else if (hit.key === "manufacturer") add("manufacturer", v.replace(/[^A-Z0-9 \-]/g, "").trim().slice(0, 80), base + 0.1, hit.label);
      else if (hit.key === "type") add("type", v.replace(/[^A-Z0-9 \-\/.]/g, "").trim().slice(0, 80), base, hit.label);
      else if (hit.key === "genre") { add("genre", v.slice(0, 40), base, hit.label); GENRE.forEach(function (g) { if (g[0].test(v)) add("category_code", g[1], base, hit.label); }); }
      else if (hit.key === "first_registration_date") { var d = parseDate(v); if (d) { if (d.date) add("first_registration_date", d.date, base + 0.1, hit.label); add("year", d.year, base + 0.1, hit.label); } }
      else if (hit.key === "fuel") { var f = null; FUEL.forEach(function (x) { if (!f && x[0].test(v)) f = x[1]; }); add("fuel", f || v.toLowerCase().slice(0, 20), f ? base + 0.15 : base - 0.2, hit.label); }
      else if (hit.key === "engine_cc") add("engine_cc", intValue(v, 49, 20000), base + 0.05, hit.label);
      else if (hit.key === "fiscal_power") add("fiscal_power", intValue(v, 1, 99), base, hit.label);
      else if (hit.key === "seats") add("seats", intValue(v, 1, 99), base + 0.05, hit.label);
      else if (hit.key === "gross_weight_kg") add("gross_weight_kg", intValue(v, 100, 60000), base, hit.label);
      else if (hit.key === "engine") add("engine", v.replace(/[^A-Z0-9 \-\/.]/g, "").trim().slice(0, 30), base - 0.1, hit.label);
      i += got.span;
    }

    // 2. Unlabelled detectors over the whole face (labels are often lost by OCR).
    if (!fields.some(function (f) { return f.key === "vin"; })) { var vc2 = vinCandidates(joined); if (vc2.length) add("vin", vc2[0].value, base + (vc2[0].corrected ? 0 : 0.15), null); if (vc2.length > 1) warnings.push("several_vin_candidates"); }
    if (!fields.some(function (f) { return f.key === "registration"; })) {
      var pm = /(\d{1,4})\s*(TUN|TU|تونس|RS)\s*(\d{1,4})/.exec(joined) || /(\d{1,4})\s+(\d{3,4})\s*(تونس)/.exec(joined);
      if (pm) add("registration", pm[0].replace(/\s+/g, " "), base, null);
    }
    if (!fields.some(function (f) { return f.key === "year"; })) { var anyDate = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(joined); if (anyDate) { var d2 = parseDate(anyDate[0]); if (d2) { add("first_registration_date", d2.date, base - 0.15, null); add("year", d2.year, base - 0.15, null); } } }
    if (!fields.some(function (f) { return f.key === "fuel"; })) { FUEL.forEach(function (x) { if (!fields.some(function (f) { return f.key === "fuel"; }) && new RegExp("\\b" + x[0].source.split("|")[0] + "\\b").test(joined)) add("fuel", x[1], base - 0.25, null); }); }

    return { fields: fields, warnings: warnings, line_count: lines.length, dropped_lines: rawLines.length - lines.length };
  }

  // Merge the faces: one value per key, the most confident wins; a
  // disagreement between faces is reported, never silently resolved.
  function merge(parsedFaces) {
    var byKey = {}, warnings = [];
    parsedFaces.forEach(function (pf) { (pf.warnings || []).forEach(function (w) { warnings.push(w); }); (pf.fields || []).forEach(function (f) {
      var cur = byKey[f.key];
      if (!cur) { byKey[f.key] = f; return; }
      if (String(cur.value) !== String(f.value)) { warnings.push("faces_disagree:" + f.key); if (f.confidence > cur.confidence) byKey[f.key] = Object.assign({}, f, { alternatives: [cur.value] }); else cur.alternatives = (cur.alternatives || []).concat([f.value]); }
      else if (f.confidence > cur.confidence) byKey[f.key] = f;
    }); });
    var fields = Object.keys(byKey).map(function (k) { return byKey[k]; });
    var confidence = fields.length ? Math.round(fields.reduce(function (s, f) { return s + f.confidence; }, 0) / fields.length * 100) / 100 : 0;
    var out = { confidence: confidence, fields: fields, warnings: warnings.filter(function (w, i, a) { return a.indexOf(w) === i; }) };
    ["registration", "manufacturer", "type", "genre", "engine", "vin", "year", "first_registration_date", "fuel", "engine_cc", "seats", "gross_weight_kg", "fiscal_power", "category_code"].forEach(function (k) { out[k] = byKey[k] ? byKey[k].value : null; });
    out.model = out.type; out.motorisation = null;   // the card carries no separate motorisation line; type ≈ model/version
    return out;
  }

  // parse({ faces: [{ face:1, text, confidence }, { face:2, text, confidence }] })
  function parse(input) {
    var faces = (input && input.faces) || [];
    var parsed = faces.filter(function (f) { return f && typeof f.text === "string"; }).map(function (f) { return parseFace(f.text, { source: "face_" + (f.face || 1), confidence: f.confidence }); });
    var merged = merge(parsed);
    merged.faces = parsed.map(function (p, i) { return { face: faces[i].face || 1, field_count: p.fields.length, dropped_lines: p.dropped_lines }; });
    return merged;
  }

  // Maps the parsed document onto the IDauto identification candidate shape
  // (the same one confirm() takes). Fields without an IDauto column are NOT
  // mapped (fiscal_power, genre, engine serial): nothing is invented.
  function toIdautoCandidate(parsed) {
    var c = {};
    if (parsed.manufacturer) c.manufacturer = parsed.manufacturer;
    if (parsed.model) c.model = parsed.model;
    if (parsed.year) c.year = parsed.year;
    if (parsed.fuel) c.fuel_type = parsed.fuel;
    if (parsed.engine_cc) c.engine_cc = parsed.engine_cc;
    if (parsed.seats) c.seats = parsed.seats;
    if (parsed.gross_weight_kg) c.gross_weight_kg = parsed.gross_weight_kg;
    if (parsed.category_code) c.category_code = parsed.category_code;
    if (parsed.engine && /^[A-Z0-9][A-Z0-9 \-\/.]{1,29}$/.test(parsed.engine) && /[A-Z]/.test(parsed.engine) && /\d/.test(parsed.engine)) c.engine_code = parsed.engine;
    if (parsed.vin) c.vin = parsed.vin;
    if (parsed.registration) c.plate = parsed.registration;
    return c;
  }

  return { parse: parse, parseFace: parseFace, merge: merge, toIdautoCandidate: toIdautoCandidate, LABELS: LABELS, DENY: DENY, asciiDigits: asciiDigits, norm: norm };
});
