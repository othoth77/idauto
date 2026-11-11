// Builds docs/architecture/IDauto_Dossier_Technique_Architecture.pdf from dossier.html and the SVG
// diagrams in ./svg (run render-diagrams.mjs first), then validates the PDF.
//
//   IDAUTO_PDF_CHROME=<chrome or chrome-headless-shell>  IDAUTO_PDF_PDFJS=<pdfjs-dist directory, v4>
//   node build-pdf.mjs [--pages <dir>]     (--pages also writes one PNG per page for visual review)
//
// Layout: headings and figures are numbered here, the table of contents is generated from the headings,
// and each figure is sized from its real dimensions so that it is never cropped and keeps its proportions.
// A figure stays in the text when its smallest label prints at >= 6 pt, otherwise it gets a page of its
// own, portrait or landscape, whichever prints it larger. TOC page numbers come from a first print: the
// PDF's link destinations are read back with pdf.js, written into the TOC, and the document printed again.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../IDauto_Dossier_Technique_Architecture.pdf');
const MIN_PT = 5.5;          // smallest label size accepted on a figure page
const INLINE_PT = 6.0;       // smallest label size for a figure kept inside the text
const pagesDir = process.argv.includes('--pages') ? process.argv[process.argv.indexOf('--pages') + 1] : null;
const pdfjsDir = process.env.IDAUTO_PDF_PDFJS;
if (!pdfjsDir) throw new Error('set IDAUTO_PDF_PDFJS to a pdfjs-dist (v4) directory');

// ---------- inputs ----------
const report = JSON.parse(readFileSync(join(here, 'svg/render-report.json'), 'utf8'));
const diagrams = Object.fromEntries(report.diagrams.map((d) => [d.file.replace(/\.mmd$/, ''), d]));
for (const [k, d] of Object.entries(diagrams)) if (!d.ok) throw new Error('diagram not rendered: ' + k);
const splitOf = {};
for (const c of report.coverage) for (let i = 1; i <= c.parts; i++) splitOf[`${c.source}-${i}`] = c.source;

// Table inventory, read from 06-data-model.md (generated from the SQL): one block per domain heading.
const md = readFileSync(join(here, '../06-data-model.md'), 'utf8');
const DOMAINS = { 'Identity, accounts and organisations': 'Identité, comptes et organisations', 'Vehicle registry, documents and private workshop data': 'Registre des véhicules, documents et données privées d\'atelier', 'Workshop maintenance, parts and provenance': 'Entretien en atelier, pièces et provenance', 'Capture, ingestion and review': 'Capture, réception et revue', 'Cross-cutting: audit and rate limiting': 'Éléments transverses : audit et limitation de débit' };
const inventory = []; let domain = null;
for (const line of md.split('\n')) {
  const h = line.match(/^## (.+)$/); if (h) domain = DOMAINS[h[1]] || null;
  const m = line.match(/^\| `(idauto_\w+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
  if (m && domain) inventory.push({ domain, table: m[1], status: m[2].includes('schema only') ? 'schéma seulement (prévue)' : 'utilisée par le code', pk: m[3].trim(), fks: m[4].trim(), file: m[5].trim() });
}
if (inventory.length !== 41) throw new Error('expected 41 tables in 06-data-model.md, found ' + inventory.length);

const SOURCES = {
  'use-case': ['diagrams/use-case.mmd (+ use-case.puml)', 'reference/auth/principal.js, workspace-routes.js, v14-routes.js, api.js, ops/auth-users.js'],
  'class-diagram': ['diagrams/class-diagram.mmd (+ class-diagram.puml)', 'database/schema.sql, database/migrations/*.sql'],
  'class-modules': ['diagrams/class-modules.mmd (copie de 03-class-diagram.md)', 'reference/workspace/*.js, documents/document-service.js, vehicle/vehicle-repository.js, workshop/workshop-repository.js, writes.js, db.js'],
  'er-identity': ['diagrams/er-identity.mmd', 'database/schema.sql, database/migrations/*.sql'],
  'er-vehicle': ['diagrams/er-vehicle.mmd', 'database/schema.sql, database/migrations/*.sql'],
  'er-workshop': ['diagrams/er-workshop.mmd', 'database/schema.sql, database/migrations/*.sql'],
  'er-capture': ['diagrams/er-capture.mmd', 'database/schema.sql, database/migrations/*.sql'],
  'er-crosscut': ['diagrams/er-crosscut.mmd', 'database/schema.sql, database/migrations/*.sql'],
  'logical-architecture': ['diagrams/logical-architecture.mmd', 'reference/api.js createServer(), reference/workspace|documents|vehicle|workshop|parts|auth, writes.js, db.js, storage.js'],
  'sequence-intervention': ['diagrams/sequence-intervention.mmd (copie de 04-logical-architecture.md)', 'workspace-routes.js postIntervention, workspace/intervention-service.js create, writes.js withAudit'],
  'physical-architecture': ['diagrams/physical-architecture.mmd', 'contrôles en lecture seule des serveurs ; .github/workflows/ci.yml ; ops/offhost-backup.js'],
};

// ---------- in-page layout ----------
function layout(data) {
  const MM = 96 / 25.4; const PX_MM = 25.4 / 96;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // headings
  let n2 = 0, n3 = 0; const toc = [];
  for (const h of document.querySelectorAll('h2, h3')) {
    const annex = h.classList.contains('annex');
    if (h.tagName === 'H2') { if (!annex) { n2++; n3 = 0; } }
    else n3++;
    const num = h.tagName === 'H2' ? (annex ? '' : n2 + '.') : (annex ? '' : n2 + '.' + n3);
    if (!h.id) h.id = 'h-' + (toc.length + 1);
    if (num) h.insertAdjacentHTML('afterbegin', `<span class="num">${num}</span>`);
    toc.push({ id: h.id, level: h.tagName === 'H2' ? 2 : 3, num, title: h.textContent.replace(num, '').trim(), text: (num ? num + ' ' : '') + h.textContent.replace(num, '').trim() });
  }
  document.getElementById('toc').innerHTML = toc.map((t) => `<a class="toc-l${t.level}" href="#${t.id}"><span class="toc-text">${t.num ? '<span class="toc-num">' + t.num + '</span>' : ''}${esc(t.title)}</span><span class="toc-dots"></span><span class="toc-page-no" data-for="${t.id}">00</span></a>`).join('');
  // table inventory
  let inv = ''; let cur = null;
  for (const r of data.inventory) {
    if (r.domain !== cur) {
      if (cur) inv += '</tbody></table>';
      cur = r.domain;
      inv += `<div class="inv-group">${esc(cur)}</div><table class="grid small inv"><colgroup><col style="width:27%"><col style="width:13%"><col style="width:10%"><col style="width:30%"><col style="width:20%"></colgroup><thead><tr><th>Table</th><th>Statut</th><th>Clé primaire</th><th>Clés étrangères appliquées</th><th>Définie dans</th></tr></thead><tbody>`;
    }
    const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    inv += `<tr><td><code>${r.table}</code></td><td>${r.status.startsWith('schéma') ? '<strong>' + r.status + '</strong>' : r.status}</td><td>${code(r.pk)}</td><td>${code(r.fks)}</td><td>${code(r.file)}</td></tr>`;
  }
  document.getElementById('tables-inventory').innerHTML = inv + '</tbody></table>';
  // figures
  const figs = [...document.querySelectorAll('figure.dia')];
  const out = [];
  figs.forEach((f, i) => {
    const key = f.dataset.svg; const d = data.diagrams[key];
    if (!d) throw new Error('no SVG for figure ' + key);
    const source = data.splitOf[key];
    const notes = f.innerHTML; f.innerHTML = '';
    f.id = 'fig-' + (i + 1);
    f.insertAdjacentHTML('beforeend', `<div class="fig-box"><img src="svg/${key}.svg" alt="${esc(f.dataset.caption)}"></div>` +
      `<figcaption>Figure ${i + 1} — ${esc(f.dataset.caption)}</figcaption>` +
      `<div class="fig-src">Source : <code>${source ? 'pdf/views/' + key + '.mmd — vue détaillée de diagrams/' + source + '.mmd' : esc((data.sources[key] || ['diagrams/' + key + '.mmd'])[0])}</code></div>` + notes);
    out.push({ n: i + 1, key, caption: f.dataset.caption, source: source || key, part: !!source, w: d.width, h: d.height, minFontPx: d.minFontPx });
  });
  // sizing
  const pullHeading = (f) => { const prev = f.previousElementSibling; if (prev && prev.tagName === 'H3') f.prepend(prev); };
  const content = { portrait: { w: 186, h: 263 }, landscape: { w: 273, h: 180 } };
  const PAD = 4.8;            // fig-box padding + border, mm
  const fitScale = (d, wmm, hmm) => Math.min(1, wmm / (d.w * PX_MM), hmm / (d.h * PX_MM));
  const setImg = (f, d, s) => { const img = f.querySelector('img'); img.style.width = (d.w * s * PX_MM) + 'mm'; img.style.height = (d.h * s * PX_MM) + 'mm'; };
  const chrome = (f) => (f.getBoundingClientRect().height - f.querySelector('img').getBoundingClientRect().height) * PX_MM; // caption + notes + box, mm
  out.forEach((o, i) => {
    const f = figs[i]; const pt = (s) => o.minFontPx * 0.75 * s;
    // try inline: full text width, at most 120 mm high
    setImg(f, o, fitScale(o, content.portrait.w - PAD, 120));
    let s = fitScale(o, content.portrait.w - PAD, 120);
    if (pt(s) >= data.INLINE_PT) { o.mode = 'texte'; o.scale = s; return; }
    // own page: portrait or landscape, whichever is larger once the caption and notes are counted
    const best = ['portrait', 'landscape'].map((orient) => {
      f.classList.toggle('page', true); f.classList.toggle('landscape', orient === 'landscape');
      f.style.width = content[orient].w + 'mm';
      let sc = fitScale(o, content[orient].w - PAD, content[orient].h - 30);
      for (let k = 0; k < 3; k++) { setImg(f, o, sc); sc = fitScale(o, content[orient].w - PAD, content[orient].h - chrome(f) - 6); }
      setImg(f, o, sc);
      return { orient, sc, total: f.getBoundingClientRect().height * PX_MM };
    }).sort((a, b) => b.sc - a.sc - (a.orient === 'portrait' ? -0.02 : 0.02))[0];
    f.classList.toggle('landscape', best.orient === 'landscape'); f.style.width = '';
    if (f.previousElementSibling && f.previousElementSibling.tagName === 'H3') { pullHeading(f); f.style.width = content[best.orient].w + 'mm'; let sc = best.sc; for (let k = 0; k < 3; k++) { setImg(f, o, sc); sc = fitScale(o, content[best.orient].w - PAD, content[best.orient].h - chrome(f) - 6); } best.sc = sc; f.style.width = ''; }
    setImg(f, o, best.sc);
    o.mode = best.orient === 'landscape' ? 'page paysage' : 'page portrait'; o.scale = best.sc;
  });
  out.forEach((o) => { o.pt = +(o.minFontPx * 0.75 * o.scale).toFixed(1); });
  // traceability table and annex
  const rows = out.map((o) => `<tr><td>${o.n}</td><td>${esc(o.caption)}</td><td><code>${o.part ? 'pdf/views/' + o.key + '.mmd' : esc((data.sources[o.key] || [''])[0])}</code></td><td>${esc((data.sources[o.source] || ['', ''])[1])}</td></tr>`).join('');
  document.getElementById('figures-trace').innerHTML = `<table class="grid small"><colgroup><col style="width:6%"><col style="width:30%"><col style="width:27%"><col style="width:37%"></colgroup><thead><tr><th>Fig.</th><th>Figure</th><th>Fichier source</th><th>Code ou données de référence</th></tr></thead><tbody>${rows}</tbody></table>`;
  const ann = out.map((o) => `<tr><td>${o.n}</td><td><code>${o.key}.svg</code></td><td>${o.w} × ${o.h}</td><td>${o.mode}</td><td>${(o.scale * 100).toFixed(0)} %</td><td>${o.pt.toLocaleString('fr-FR')} pt${o.part || o.pt >= data.MIN_PT ? '' : ' (vue d\'ensemble)'}</td></tr>`).join('');
  document.getElementById('render-annex').innerHTML = `
    <h3 class="annex-h">Chaîne de rendu</h3>
    <ul>
      <li><strong>Mermaid.</strong> Chaque diagramme est rendu par Mermaid ${esc(data.mermaid)} dans Chrome sans interface, en SVG vectoriel. Les libellés sont des textes SVG et non du HTML : ils restent du texte vectoriel dans le PDF. Le thème est noir et blanc, et la police est DejaVu Sans.</li>
      <li><strong>Modifications au rendu.</strong> Le titre du fichier source devient la légende de la figure. Les émojis des libellés d'acteurs (👤, ⚙️), que la police d'impression ne sait pas dessiner, sont retirés. Rien d'autre n'est modifié.</li>
      <li><strong>Vues détaillées.</strong> Elles sont générées par <code>pdf/views.mjs</code> à partir des sources, sans réécriture. Un contrôle automatique vérifie que, pour chaque diagramme découpé, l'ensemble des vues contient tous les éléments et toutes les relations de l'original. Résultat : ${data.coverage.map((c) => `${esc(c.source)} ${c.parts} vues, ${c.nodes} éléments, ${c.edges} relations, ${c.missingNodes.length + c.missingEdges.length} manquant`).join(' ; ')}. Une vue peut disposer un groupe verticalement plutôt qu'horizontalement, pour mieux occuper la page ; son contenu est inchangé.</li>
      <li><strong>PlantUML.</strong> <code>use-case.puml</code> et <code>class-diagram.puml</code> n'ont <strong>pas été rendus</strong> : aucun moteur PlantUML n'est installé sur la machine de construction, et son téléchargement n'était pas autorisé. Un contrôle automatique a établi que leurs cas d'utilisation, acteurs, relations, classes et multiplicités sont identiques à ceux des diagrammes Mermaid des figures correspondantes.</li>
      <li><strong>Mise en page.</strong> Chaque figure garde ses proportions et n'est jamais recadrée. Elle reste dans le texte si son plus petit libellé s'imprime à ${data.INLINE_PT.toLocaleString('fr-FR')} pt ou plus. Sinon, elle occupe une page entière, en portrait ou en paysage selon l'orientation qui l'imprime le plus grand.</li>
      <li><strong>Seuil de lisibilité.</strong> Il est fixé à ${data.MIN_PT.toLocaleString('fr-FR')} pt pour le plus petit libellé. Les vues d'ensemble des grands diagrammes passent sous ce seuil : elles montrent la structure, et leurs vues détaillées, toutes au-dessus du seuil, se lisent dans les figures qui les suivent.</li>
    </ul>
    <h3 class="annex-h">Dimensions et lisibilité des figures</h3>
    <table class="grid small"><colgroup><col style="width:6%"><col style="width:30%"><col style="width:16%"><col style="width:16%"><col style="width:10%"><col style="width:22%"></colgroup><thead><tr><th>Fig.</th><th>Fichier</th><th>Taille d'origine (px)</th><th>Placement</th><th>Échelle</th><th>Plus petit libellé imprimé</th></tr></thead><tbody>${ann}</tbody></table>
    <h3 class="annex-h">Validation du PDF</h3>
    <p id="pdf-validation">Les contrôles du PDF sont exécutés par <code>pdf/build-pdf.mjs</code> après l'impression. Ils vérifient : le nombre de pages ; le numéro de page imprimé sur chaque page ; la correspondance entre la table des matières et les pages réelles ; la présence de chaque figure ; l'absence de débordement horizontal.</p>`;
  // horizontal overflow check (content wider than its page box)
  const overflow = [...document.querySelectorAll('table, figure, pre, p, li')].filter((e) => e.scrollWidth > e.clientWidth + 1 && !e.closest('#toc')).map((e) => e.tagName + ': ' + e.textContent.slice(0, 60));
  return { figures: out, toc, overflow };
}

// ---------- print + read back ----------
const pdfjs = await import(pathToFileURL(join(pdfjsDir, 'legacy/build/pdf.mjs')).href);
async function readPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), standardFontDataUrl: join(pdfjsDir, 'standard_fonts') + '/', verbosity: 0 }).promise;
  const pages = []; const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const text = (await p.getTextContent()).items.map((t) => t.str).join(' ').replace(/\s+/g, ' ');
    pages.push({ n: i, text, landscape: p.view[2] > p.view[3] });
    for (const a of await p.getAnnotations()) {
      if (a.subtype !== 'Link' || !a.dest) continue;
      const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
      if (!dest) continue;
      links.push({ from: i, name: typeof a.dest === 'string' ? a.dest : null, to: (await doc.getPageIndex(dest[0])) + 1 });
    }
  }
  const outline = await doc.getOutline();
  return { numPages: doc.numPages, pages, links, outline: outline ? outline.length : 0 };
}

const page = await launch();
await page.send('Emulation.setEmulatedMedia', { media: 'print' });
// The layout is measured at the real column width (186 mm), so text wraps as it will on paper.
await page.send('Emulation.setDeviceMetricsOverride', { width: Math.round(186 * 96 / 25.4), height: 1100, deviceScaleFactor: 1, mobile: false });
await page.goto(pathToFileURL(join(here, 'dossier.html')).href);
await page.eval('document.fonts.ready.then(() => true)');
await page.eval(`Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))`);
const result = await page.eval(`(${layout.toString()})(${JSON.stringify({ inventory, diagrams, splitOf, sources: SOURCES, mermaid: report.mermaid, coverage: report.coverage, MIN_PT, INLINE_PT })})`);
await page.eval(`Promise.all([...document.images].map((i) => i.complete && i.naturalWidth ? 1 : new Promise((r, j) => { i.onload = r; i.onerror = () => j(new Error('image failed: ' + i.src)); })))`);
const broken = await page.eval(`[...document.images].filter((i) => !i.naturalWidth).map((i) => i.src)`);
if (broken.length) throw new Error('images not loaded: ' + broken.join(', '));

const print = async () => Buffer.from((await page.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true, generateTaggedPDF: true, displayHeaderFooter: false })).data, 'base64');
const tocTargets = (pdf) => {
  const tocPages = new Set(pdf.pages.filter((p) => p.n <= 4 && /Table des matières|^\s*\d+\./.test(p.text)).map((p) => p.n));
  const byName = {};
  for (const l of pdf.links) if (l.name && !byName[l.name]) byName[l.name] = l.to;
  return { byName, tocPages };
};

let pdf1 = await readPdf(await print());
let { byName } = tocTargets(pdf1);
const missing = result.toc.filter((t) => !byName[t.id]).map((t) => t.id);
if (missing.length) throw new Error('TOC entries without a PDF destination: ' + missing.join(', '));
await page.eval(`(${((map) => { for (const s of document.querySelectorAll('.toc-page-no')) s.textContent = map[s.dataset.for]; return true; }).toString()})(${JSON.stringify(byName)})`);
const finalBuf = await print();
const pdf = await readPdf(finalBuf);
const final = tocTargets(pdf);

// ---------- validation ----------
const CHECK_FR = {
  'page count stable between the two prints': 'Nombre de pages identique entre les deux impressions',
  'every page after the cover prints "Page n / N" with its own number': 'Chaque page après la couverture porte « Page n / N » avec son propre numéro',
  'no blank page (each page has its own content)': 'Aucune page blanche',
  'TOC page numbers equal the real page of every heading': 'Les numéros de la table des matières sont les pages réelles des titres',
  'each heading text is on the page the TOC gives': 'Chaque titre se trouve sur la page indiquée par la table des matières',
  'every figure caption is present': 'Chaque figure est présente',
  'figures appear in order': 'Les figures se suivent dans l\'ordre',
  'landscape figures are on landscape pages': 'Les figures en paysage sont sur des pages en paysage',
  'every detail view prints its smallest label at >= 5.5 pt': 'Chaque vue détaillée imprime son plus petit libellé à 5,5 pt ou plus',
  'no horizontal overflow in the laid-out document': 'Aucun débordement horizontal',
  'PDF outline (bookmarks) present': 'Signets du PDF présents',
  'no IP address (other than 127.0.0.1), home path, private host, connection string or key in the text': 'Aucune adresse IP (hors 127.0.0.1), chemin personnel, hôte privé, chaîne de connexion ni clé dans le texte',
};
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
check('page count stable between the two prints', pdf.numPages === pdf1.numPages, `${pdf1.numPages} → ${pdf.numPages}`);
const footerBad = pdf.pages.filter((p) => p.n > 1 && !p.text.includes(`Page ${p.n} / ${pdf.numPages}`)).map((p) => p.n);
check('every page after the cover prints "Page n / N" with its own number', footerBad.length === 0, footerBad.length ? 'pages: ' + footerBad.join(', ') : `${pdf.numPages - 1} pages`);
const blank = pdf.pages.filter((p) => p.text.replace(/IDauto — Dossier technique et architecture du système|Version 1\.0 — 11 novembre 2026|Page \d+ \/ \d+/g, '').trim().length < 20).map((p) => p.n);
check('no blank page (each page has its own content)', blank.length === 0, blank.length ? 'pages: ' + blank.join(', ') : '');
const tocMismatch = result.toc.filter((t) => final.byName[t.id] !== byName[t.id]).map((t) => t.id);
check('TOC page numbers equal the real page of every heading', tocMismatch.length === 0, tocMismatch.length ? tocMismatch.join(', ') : `${result.toc.length} entries`);
const squash = (x) => x.replace(/\s+/g, '');
const headingPagesOk = result.toc.filter((t) => !squash(pdf.pages[final.byName[t.id] - 1].text).includes(squash(t.text).slice(0, 30))).map((t) => t.text);
check('each heading text is on the page the TOC gives', headingPagesOk.length === 0, headingPagesOk.join(' | '));
const figPage = {};
for (const f of result.figures) { const p = pdf.pages.find((pg) => pg.text.includes(`Figure ${f.n} — `)); figPage[f.n] = p ? p.n : null; }
const figMissing = result.figures.filter((f) => !figPage[f.n]).map((f) => f.n);
check('every figure caption is present', figMissing.length === 0, figMissing.length ? 'figures: ' + figMissing.join(', ') : `${result.figures.length} figures`);
const order = result.figures.map((f) => figPage[f.n]);
check('figures appear in order', order.every((p, i) => i === 0 || p >= order[i - 1]));
const landscapeOk = result.figures.filter((f) => f.mode === 'page paysage').every((f) => pdf.pages[figPage[f.n] - 1].landscape);
check('landscape figures are on landscape pages', landscapeOk);
const small = result.figures.filter((f) => f.part && f.pt < MIN_PT).map((f) => `${f.n} (${f.pt} pt)`);
check(`every detail view prints its smallest label at >= ${MIN_PT} pt`, small.length === 0, small.join(', '));
check('no horizontal overflow in the laid-out document', result.overflow.length === 0, result.overflow.slice(0, 5).join(' | '));
check('PDF outline (bookmarks) present', pdf.outline > 0, `${pdf.outline} top-level entries`);
const secretLike = pdf.pages.filter((p) => /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\/home\/|ts\.net|postgres(ql)?:\/\/|PRIVATE KEY|\bAKIA[0-9A-Z]{8}/.test(p.text.replace(/127\.0\.0\.1/g, ''))).map((p) => p.n);
check('no IP address (other than 127.0.0.1), home path, private host, connection string or key in the text', secretLike.length === 0, secretLike.join(', '));

// Write the results into Annex A and print a last time; the page count and the TOC must not move.
const resultsHtml = '<p>Résultats des contrôles exécutés par <code>pdf/build-pdf.mjs</code> sur ce PDF :</p><table class="grid small"><colgroup><col style="width:66%"><col style="width:10%"><col style="width:24%"></colgroup><thead><tr><th>Contrôle</th><th>Résultat</th><th>Détail</th></tr></thead><tbody>' +
  checks.map((c) => `<tr><td>${CHECK_FR[c.name] || c.name}</td><td><strong>${c.ok ? 'réussi' : 'ÉCHEC'}</strong></td><td>${String(c.detail).replace(/[<>&]/g, '')}</td></tr>`).join('') + '</tbody></table>';
await page.eval(`(document.getElementById('pdf-validation').outerHTML = ${JSON.stringify('<div id="pdf-validation">' + resultsHtml + '</div>')}, true)`);
const lastBuf = await print();
const last = await readPdf(lastBuf);
const lastToc = tocTargets(last);
check('final print: same page count and same TOC targets after the annex results were written', last.numPages === pdf.numPages && result.toc.every((t) => lastToc.byName[t.id] === final.byName[t.id]), `${last.numPages} pages`);
const lastFooter = last.pages.filter((p) => p.n > 1 && !p.text.includes(`Page ${p.n} / ${last.numPages}`)).length;
check('final print: page numbers still correct', lastFooter === 0);
const finalPdf = lastBuf;
writeFileSync(OUT, finalPdf);
const summary = { pdf: 'docs/architecture/IDauto_Dossier_Technique_Architecture.pdf', bytes: finalPdf.length, pages: pdf.numPages, landscapePages: pdf.pages.filter((p) => p.landscape).length, figures: result.figures.map((f) => ({ n: f.n, key: f.key, mode: f.mode, scale: +f.scale.toFixed(3), pt: f.pt, page: figPage[f.n] })), toc: result.toc.map((t) => ({ text: t.text, page: final.byName[t.id] })), checks };
writeFileSync(join(here, 'build-report.json'), JSON.stringify(summary, null, 2) + '\n');

if (pagesDir) {
  // One PNG per page, drawn by pdf.js in Chrome, for visual review.
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(join(pagesDir, 'final.pdf'), finalPdf);
  const html = `<!doctype html><body style="margin:0;background:#888"><canvas id="c"></canvas><script type="module">
    import * as pdfjsLib from '${pathToFileURL(join(pdfjsDir, 'build/pdf.mjs')).href}';
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${pathToFileURL(join(pdfjsDir, 'build/pdf.worker.mjs')).href}';
    window.doc = await pdfjsLib.getDocument({ url: 'final.pdf', standardFontDataUrl: '${pathToFileURL(join(pdfjsDir, 'standard_fonts')).href}/' }).promise;
    window.renderPage = async (n, scale) => { const p = await doc.getPage(n); const v = p.getViewport({ scale }); const c = document.getElementById('c'); c.width = v.width; c.height = v.height; await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise; return c.toDataURL('image/png'); };
    window.ready = true;</script></body>`;
  writeFileSync(join(pagesDir, 'view.html'), html);
  await page.send('Emulation.setEmulatedMedia', { media: 'screen' });
  await page.goto(pathToFileURL(join(pagesDir, 'view.html')).href);
  for (let k = 0; k < 100 && !(await page.eval('!!window.ready')); k++) await new Promise((r) => setTimeout(r, 200));
  for (let i = 1; i <= pdf.numPages; i++) {
    const url = await page.eval(`renderPage(${i}, 1.6)`);
    writeFileSync(join(pagesDir, `page-${String(i).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
}
await page.close();

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
console.log(`pdf: ${OUT} (${last.numPages} pages, ${(finalPdf.length / 1024).toFixed(0)} KiB)`);
if (checks.some((c) => !c.ok)) process.exit(1);
