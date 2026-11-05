#!/usr/bin/env node
'use strict';
// =====================================================
// IDauto — IDA-CG2 gate D7: measure OCR on REAL, REDACTED Tunisian cartes grises
// ops/cg2-ocr-validate.js --samples <dir> --base <origin> --out <report.json> [--min-cards 20]
//
// Runs the SAME pipeline as /atelier/carte-grise, without storing anything:
//   browser OCR  — the vendored Tesseract (fra+ara, psm 4) loaded from <origin>/atelier/assets/
//                  in headless Chrome, the image prepared exactly as the page does (long edge 2400 px,
//                  enlarged if smaller, grayscale + contrast) — keep OCR equal to atelier-carte-grise-ui.js;
//   server parse — reference/documents/registration-parser.js + the submission normaliser, with
//                  the faces combined as extraction does (agreeing → read, disagreeing → conflict).
// Each card is compared with its ground truth, typed by a person from the card itself.
//
// Sample layout (docs/CG2_OCR_VALIDATION.md §3), one card per prefix:
//   <card>.face1.jpg|png   <card>.face2.jpg|png (absent for a one-sided card)   <card>.truth.json
//   truth = { "registration": "123 TU 4567", "vin": "…", "manufacturer": "…", "type": "…",
//             "first_registration_date": "2019-03-12", "fuel": "petrol", "engine_cc": "1199", "seats": "5",
//             "holder_redacted": true }     — a key the card does not show is null.
//
// D1/D5: OCR text lives in memory only and is never written. The report holds, per card and
// field, a STATUS (correct / wrong / missing / conflict / spurious) and, for registration and VIN,
// only a character distance — never the value. Run it on Haddad, against the STAGING origin.
// =====================================================

var fs = require('fs');
var path = require('path');
var http = require('http');
var cp = require('child_process');
var crypto = require('crypto');
var parser = require('../reference/documents/registration-parser.js');
var submissions = require('../reference/documents/registration-submissions.js');

function arg(n, d) { var i = process.argv.indexOf('--' + n); return i !== -1 ? process.argv[i + 1] : d; }
var DIR = arg('samples'), BASE = arg('base', 'http://127.0.0.1:8805'), OUT = arg('out'), MIN = parseInt(arg('min-cards', '20'), 10);
if (!DIR || !OUT) { console.error('usage: cg2-ocr-validate.js --samples <dir> --base <origin> --out <report.json> [--min-cards 20]'); process.exit(2); }
var CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME) { console.error('no Chrome/Chromium (set CHROME=)'); process.exit(2); }

var FIELDS = ['registration', 'vin', 'manufacturer', 'type', 'first_registration_date', 'fuel', 'engine_cc', 'seats', 'fiscal_power', 'gross_weight_kg'];
var IDENTIFIERS = ['registration', 'vin'];

function cards() {
  return fs.readdirSync(DIR).filter(function (f) { return /\.truth\.json$/.test(f); }).sort().map(function (t) {
    var name = t.replace(/\.truth\.json$/, '');
    function img(n) { var c = ['jpg', 'jpeg', 'png', 'webp'].map(function (e) { return path.join(DIR, name + '.face' + n + '.' + e); }).filter(fs.existsSync); return c[0] || null; }
    return { name: name, truth: JSON.parse(fs.readFileSync(path.join(DIR, t), 'utf8')), faces: [img(1), img(2)].filter(Boolean) };
  });
}
function lev(a, b) {
  var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++) { d[i] = [i]; } for (var j = 0; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { try { r(JSON.parse(Buffer.concat(c).toString())); } catch (e) { j(e); } }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// The extraction rule of registration-submissions.extract(), applied to parsed faces.
function combine(parsedFaces) {
  var out = {};
  submissions.KEYS.forEach(function (key) {
    var hits = []; parsedFaces.forEach(function (pf) { pf.fields.filter(function (f) { return f.key === key; }).forEach(function (f) { hits.push(f); }); });
    if (!hits.length) return;
    var norms = hits.map(function (h) { var n = submissions.normalize(key, h.value); return n.ok ? n.value : null; });
    var distinct = norms.filter(function (v, i, a) { return v !== null && a.indexOf(v) === i; });
    if (distinct.length > 1) { out[key] = { status: 'conflict' }; return; }
    var best = hits.slice().sort(function (a, b) { return b.confidence - a.confidence; })[0], n = submissions.normalize(key, best.value);
    out[key] = { status: n.ok ? 'read' : 'unnormalisable', value: n.ok ? n.value : null, confidence: best.confidence, corrected: !!best.corrected };
  });
  return out;
}

(async function () {
  var list = cards();
  if (!list.length) throw new Error('no <card>.truth.json in ' + DIR);
  var port = 9890 + Math.floor(Math.random() * 90), profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cg2-ocr-'));
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} });
  var targets = null; for (var a = 0; a < 40 && !targets; a++) { await sleep(750); try { targets = await get('http://127.0.0.1:' + port + '/json'); } catch (e) { targets = null; } }
  if (!targets) throw new Error('Chrome did not open its DevTools port');
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl), id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/login' }); await sleep(2500);
  var ENGINE = '/atelier/assets/tesseract/';
  await ev('new Promise(function(res,rej){var s=document.createElement("script");s.src=' + JSON.stringify(ENGINE + 'tesseract.min.js') + ';s.onload=res;s.onerror=function(){rej(new Error("engine not served"))};document.head.appendChild(s)})');
  await ev('window.Tesseract.createWorker("fra+ara",1,{workerPath:' + JSON.stringify(ENGINE + 'worker.min.js') + ',corePath:' + JSON.stringify(ENGINE) + ',langPath:' + JSON.stringify(ENGINE) + ',workerBlobURL:false,gzip:true}).then(function(w){window.__w=w;return w.setParameters({tessedit_pageseg_mode:"4",preserve_interword_spaces:"1"})}).then(function(){return true})');

  var report = { tool: 'ops/cg2-ocr-validate.js', at: new Date().toISOString(), base: BASE, pipeline: 'tesseract.js fra+ara psm4+psm11 2400px grayscale+contrast → registration-parser → submission normaliser',
    cards: [], per_field: {}, gate: null };
  FIELDS.forEach(function (f) { report.per_field[f] = { expected: 0, correct: 0, wrong: 0, missing: 0, conflict: 0, spurious: 0 }; });
  for (var c = 0; c < list.length; c++) {
    var card = list[c], parsed = [], conf = [];
    for (var f = 0; f < card.faces.length; f++) {
      var b64 = fs.readFileSync(card.faces[f]).toString('base64');
      var r = await ev('(async function(){var bin=atob("' + b64 + '"),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);var bm=await createImageBitmap(new Blob([u]));var s=2400/Math.max(bm.width,bm.height);' +
        'var c=document.createElement("canvas");c.width=Math.round(bm.width*s);c.height=Math.round(bm.height*s);var x=c.getContext("2d");x.filter="grayscale(1) contrast(1.6)";x.imageSmoothingQuality="high";x.drawImage(bm,0,0,c.width,c.height);var t=[],k=[],ps=["4","11"];for(var q=0;q<ps.length;q++){await window.__w.setParameters({tessedit_pageseg_mode:ps[q]});var o=await window.__w.recognize(c);t.push(o.data.text);k.push(o.data.confidence);}return {text:t.join("\\n"),confidence:k.reduce(function(a,b){return a+b},0)/k.length}})()');
      parsed.push(parser.parseFace(r.text, { source: 'face_' + (f + 1), confidence: r.confidence }));   // text dropped right here
      conf.push(Math.round(r.confidence));
    }
    var got = combine(parsed), row = { card: crypto.createHash('sha256').update(card.name).digest('hex').slice(0, 10), faces: card.faces.length, ocr_confidence: conf, fields: {} };
    FIELDS.forEach(function (k) {
      var want = card.truth[k] === undefined ? null : card.truth[k], pf = report.per_field[k], g = got[k], st, extra = {};
      var wantN = want === null ? null : (submissions.normalize(k, String(want)).ok ? submissions.normalize(k, String(want)).value : String(want).toUpperCase());
      if (wantN === null) { st = g && g.status === 'read' ? 'spurious' : 'absent_ok'; if (st === 'spurious') pf.spurious++; }
      else {
        pf.expected++;
        if (!g || g.status === 'unnormalisable') { st = 'missing'; pf.missing++; }
        else if (g.status === 'conflict') { st = 'conflict'; pf.conflict++; }
        else if (g.value === wantN) { st = 'correct'; pf.correct++; }
        else { st = 'wrong'; pf.wrong++; }
        if (IDENTIFIERS.indexOf(k) !== -1 && g && g.value) extra.char_distance = lev(String(g.value).replace(/\s/g, ''), String(wantN).replace(/\s/g, ''));
        if (IDENTIFIERS.indexOf(k) === -1 && st === 'wrong') { extra.read = g.value; extra.expected = wantN; }
        if (g && g.corrected) extra.parser_substituted = true;
      }
      row.fields[k] = Object.assign({ status: st }, extra);
    });
    report.cards.push(row);
    console.log('card ' + (c + 1) + '/' + list.length + ' ' + row.card + ' — ' + FIELDS.map(function (k) { return k + ':' + row.fields[k].status; }).join(' '));
  }
  Object.keys(report.per_field).forEach(function (k) { var p = report.per_field[k]; p.accuracy = p.expected ? Math.round(1000 * p.correct / p.expected) / 1000 : null; });
  // The gate (docs/CG2_OCR_VALIDATION.md §5): enough cards, and a WRONG identifier is the failure
  // that matters (a missing one is caught by the reviewer; a wrong one can link the wrong vehicle).
  var idWrong = IDENTIFIERS.reduce(function (s, k) { return s + report.per_field[k].wrong; }, 0);
  report.gate = { cards: list.length, min_cards: MIN, enough_cards: list.length >= MIN, identifier_wrong_reads: idWrong,
    note: 'OCR is a PROPOSAL: every field is reviewed by a person before any decision. The owner decides acceptance from this report.' };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('\nper field (accuracy = correct / expected):');
  FIELDS.forEach(function (k) { var p = report.per_field[k]; console.log('  ' + k.padEnd(24) + (p.accuracy === null ? '—' : (p.accuracy * 100).toFixed(1) + ' %').padStart(8) + '   correct ' + p.correct + ' wrong ' + p.wrong + ' missing ' + p.missing + ' conflict ' + p.conflict + ' spurious ' + p.spurious); });
  console.log('\ncards ' + list.length + (list.length < MIN ? ' (FEWER than ' + MIN + ': not enough to decide)' : '') + ' — wrong identifier reads: ' + idWrong + '\nreport: ' + OUT);
  process.exit(0);
})().catch(function (e) { console.error('validation failed: ' + e.message); process.exit(1); });
