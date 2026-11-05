#!/usr/bin/env node
'use strict';
// =====================================================
// IDauto — IDA-CG2 STAGING: synthetic carte grise images for the acceptance test
// ops/staging-cg2-samples.js <output directory>
//
// Draws each card of ops/staging-cg2-seed.js FIXTURES (recto + verso, 1700×1100 PNG) in a
// headless Chrome canvas — the same drawing as tests/ida-cg2-carte-grise-browser-test.js —
// plus one image too small to be legible (refused, step 3) and an index.html sheet to show on
// a screen and photograph with a phone. Every card is marked SPÉCIMEN: fictitious values only,
// no real plate, VIN, person or document layout.
// CHROME=<binary> selects the browser (default: the first of google-chrome / chromium on PATH).
// =====================================================

var fs = require('fs');
var path = require('path');
var http = require('http');
var cp = require('child_process');
var seed = require('./staging-cg2-seed.js');

var OUT = process.argv[2];
if (!OUT) { console.error('usage: staging-cg2-samples.js <output directory>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
var CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'].filter(function (b) { try { cp.execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch (_) { return false; } })[0];
if (!CHROME) { console.error('no Chrome/Chromium found (set CHROME=)'); process.exit(2); }

function recto(f) {
  return ['N D IMMATRICULATION : ' + f.plate_series + ' TU ' + f.plate_number, 'MARQUE : ' + f.make, 'TYPE : ' + f.model,
    'NOM : ' + seed.HOLDER.name, 'ADRESSE : ' + seed.HOLDER.address, 'D.P.M.C : ' + f.date, 'ENERGIE : ' + f.fuel];
}
function verso(f) { return ['N DE SERIE : ' + f.vin, 'CYLINDREE : ' + f.cc, 'NOMBRE DE PLACES : ' + f.seats, 'PUISSANCE FISCALE : ' + f.fiscal]; }
var CARDS = [];
Object.keys(seed.FIXTURES).forEach(function (k) {
  CARDS.push({ file: 'carte-' + k + '-face1.png', lines: recto(seed.FIXTURES[k]), w: 1700, h: 1100 });
  CARDS.push({ file: 'carte-' + k + '-face2.png', lines: verso(seed.FIXTURES[k]), w: 1700, h: 1100 });
});
CARDS.push({ file: 'image-trop-petite.png', lines: recto(seed.FIXTURES.A), w: 560, h: 360 });

function get(url) { return new Promise(function (r, j) { http.get(url, function (res) { var c = []; res.on('data', function (x) { c.push(x); }); res.on('end', function () { try { r(JSON.parse(Buffer.concat(c).toString())); } catch (e) { j(e); } }); }).on('error', j); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var port = 9790 + Math.floor(Math.random() * 100);
  var profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'idauto-samples-'));
  var chrome = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', function () { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} });
  var targets = null;
  for (var a = 0; a < 40 && !targets; a++) { await sleep(750); try { targets = await get('http://127.0.0.1:' + port + '/json'); } catch (e) { targets = null; } }
  if (!targets) throw new Error('Chrome did not open its DevTools port');
  var ws = new WebSocket(targets.filter(function (t) { return t.type === 'page'; })[0].webSocketDebuggerUrl), id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(function (r) { ws.onopen = r; });
  function send(method, params) { return new Promise(function (r) { var i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  for (var i = 0; i < CARDS.length; i++) {
    var c = CARDS[i], k = c.w / 1700;
    var js = '(function(){var c=document.createElement("canvas");c.width=' + c.w + ';c.height=' + c.h + ';var x=c.getContext("2d");x.scale(' + k + ',' + k + ');' +
      'x.fillStyle="#f4efe2";x.fillRect(0,0,1700,1100);x.fillStyle="#151515";x.font="bold 46px sans-serif";x.fillText("CERTIFICAT D IMMATRICULATION",70,100);' +
      'x.font="40px sans-serif";' + JSON.stringify(c.lines) + '.forEach(function(l,i){x.fillText(l,70,190+i*70);});' +
      'x.fillStyle="#a33";x.font="bold 30px sans-serif";x.fillText("SPECIMEN - DONNEES FICTIVES - IDAUTO STAGING",70,1060);' +
      'return c.toDataURL("image/png").split(",")[1];})()';
    var r = await send('Runtime.evaluate', { expression: js, returnByValue: true });
    fs.writeFileSync(path.join(OUT, c.file), Buffer.from(r.result.result.value, 'base64'));
  }
  var rows = Object.keys(seed.FIXTURES).map(function (k) {
    return '<section><h2>Carte ' + k + '</h2><figure><img src="carte-' + k + '-face1.png" alt="Carte ' + k + ' face 1"><figcaption>Face 1 (recto)</figcaption></figure>' +
      '<figure><img src="carte-' + k + '-face2.png" alt="Carte ' + k + ' face 2"><figcaption>Face 2 (verso)</figcaption></figure></section>';
  }).join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>IDauto staging — cartes grises SPÉCIMEN</title><style>body{font-family:sans-serif;margin:16px;background:#fff;color:#111}img{max-width:100%;border:1px solid #ccc}figure{margin:0 0 16px}section{margin-bottom:32px}</style>' +
    '<h1>Cartes grises SPÉCIMEN (données fictives)</h1><p>Affichez une face en plein écran et photographiez-la avec le téléphone, ou envoyez le fichier PNG depuis l\'ordinateur. Voir docs/STAGING_CG2.md.</p>\n' + rows +
    '<section><h2>Image trop petite (doit être refusée)</h2><img src="image-trop-petite.png" alt="Image trop petite"></section>');
  console.log('samples: ' + CARDS.length + ' images + index.html in ' + OUT);
  process.exit(0);
})().catch(function (e) { console.error('samples failed: ' + e.message); process.exit(1); });
