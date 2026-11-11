// Renders every Mermaid source in ../diagrams to a black-and-white vector SVG in ./svg.
// Usage: IDAUTO_PDF_CHROME=<chrome> IDAUTO_PDF_MERMAID=<path to mermaid.min.js 11.x> node render-diagrams.mjs
// Labels are rendered as SVG <text> (htmlLabels off), so the PDF keeps them as vector text.
// The front-matter title is removed (it becomes the figure caption in the PDF); emoji, which the
// print font cannot draw, are removed from labels. Nothing else in the source is changed.
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mermaidPath = process.env.IDAUTO_PDF_MERMAID;
if (!mermaidPath) throw new Error('set IDAUTO_PDF_MERMAID to mermaid.min.js (v11)');
const FONT = 'DejaVu Sans';
const BW = {
  fontFamily: FONT, fontSize: '14px', background: '#ffffff',
  primaryColor: '#ffffff', primaryTextColor: '#000000', primaryBorderColor: '#000000',
  secondaryColor: '#ffffff', secondaryTextColor: '#000000', secondaryBorderColor: '#000000',
  tertiaryColor: '#ffffff', tertiaryTextColor: '#000000', tertiaryBorderColor: '#000000',
  mainBkg: '#ffffff', nodeBorder: '#000000', nodeTextColor: '#000000', textColor: '#000000', titleColor: '#000000',
  lineColor: '#000000', clusterBkg: '#ffffff', clusterBorder: '#000000', edgeLabelBackground: '#ffffff',
  actorBkg: '#ffffff', actorBorder: '#000000', actorTextColor: '#000000', actorLineColor: '#000000',
  signalColor: '#000000', signalTextColor: '#000000', labelBoxBkgColor: '#ffffff', labelBoxBorderColor: '#000000',
  labelTextColor: '#000000', loopTextColor: '#000000', noteBkgColor: '#ffffff', noteBorderColor: '#000000',
  noteTextColor: '#000000', activationBkgColor: '#ffffff', activationBorderColor: '#000000', sequenceNumberColor: '#ffffff',
  attributeBackgroundColorOdd: '#ffffff', attributeBackgroundColorEven: '#ffffff',
  classText: '#000000',
};
const CONFIG = {
  startOnLoad: false, htmlLabels: false, theme: 'base', themeVariables: BW, securityLevel: 'strict', fontFamily: FONT,
  flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', nodeSpacing: 28, rankSpacing: 40, padding: 10, diagramPadding: 8 },
  class: { htmlLabels: false, useMaxWidth: false, nodeSpacing: 30, rankSpacing: 40 }, er: { useMaxWidth: false, nodeSpacing: 30, rankSpacing: 45, entityPadding: 10, minEntityWidth: 80 },
  sequence: { useMaxWidth: false, mirrorActors: false, wrap: true, width: 185, actorMargin: 24, messageMargin: 30, boxMargin: 6, noteMargin: 6, diagramMarginX: 8 },
};

import { buildViews } from './views.mjs';
const coverage = buildViews();
if (coverage.some((c) => c.missingNodes.length || c.missingEdges.length)) throw new Error('split views do not cover their source: ' + JSON.stringify(coverage));
const files = [
  ...readdirSync(join(here, '../diagrams')).filter((f) => f.endsWith('.mmd')).sort().map((f) => join(here, '../diagrams', f)),
  ...readdirSync(join(here, 'views')).filter((f) => f.endsWith('.mmd')).sort().map((f) => join(here, 'views', f)),
];
const page = await launch();
const shell = join(here, 'svg', '.render.html');
writeFileSync(shell, `<!doctype html><meta charset="utf-8"><body><script src="${pathToFileURL(mermaidPath)}"></script></body>`);
await page.goto(pathToFileURL(shell).href);
await page.eval('mermaid.initialize(' + JSON.stringify(CONFIG) + ')');
const version = [...readFileSync(mermaidPath, 'utf8').matchAll(/version:"(\d+)\.(\d+)\.(\d+)"/g)].map((m) => m.slice(1).join('.')).sort((x, y) => parseInt(y) - parseInt(x))[0] || 'unknown';
const report = [];
for (const path of files) {
  const f = path.split('/').pop();
  const src = readFileSync(path, 'utf8');
  const title = (src.match(/^---\ntitle: "?(.*?)"?\n---\n/) || [])[1] || '';
  const body = src.replace(/^---\n.*?\n---\n/s, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]\s?/gu, '');
  const out = await page.eval(`(async () => { try { const r = await mermaid.render('d_${f.replace(/\W/g, '_')}', ${JSON.stringify(body)}); return { ok: true, svg: r.svg }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  if (!out.ok) { report.push({ file: f, ok: false, error: out.error }); continue; }
  const vb = out.svg.match(/viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"/);
  const w = vb ? +vb[3] : 0, h = vb ? +vb[4] : 0;
  // Give the root element its intrinsic size (Mermaid writes width="100%" and a max-width style).
  let svg = out.svg.replace(/^<svg([^>]*)>/, (m, attrs) => '<svg' + attrs.replace(/ (width|height)="[^"]*"/g, '')
    .replace(/ style="[^"]*"/, '') + ` width="${w}" height="${h}">`);
  if (!/xmlns:xlink=/.test(svg.slice(0, 600))) svg = svg.replace(/^<svg /, '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  // The file must be well-formed XML: an <img> refuses an SVG that is not.
  const xmlError = await page.eval(`(() => { const d = new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml'); const e = d.querySelector('parsererror'); return e ? e.textContent.slice(0, 200) : ''; })()`);
  if (xmlError) { report.push({ file: f, ok: false, error: 'invalid SVG XML: ' + xmlError }); continue; }
  if (!/^<\?xml/.test(svg)) svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
  writeFileSync(join(here, 'svg', f.replace(/\.mmd$/, '.svg')), svg + '\n');
  // Smallest label size actually drawn, used by the PDF build to check readability once scaled to the page.
  const minFontPx = await page.eval(`(() => { const host = document.createElement('div'); host.innerHTML = ${JSON.stringify(svg.replace(/^<\?xml[^>]*>\n/, ''))}; document.body.appendChild(host); const sizes = [...host.querySelectorAll('text, tspan')].filter((t) => t.textContent.trim()).map((t) => parseFloat(getComputedStyle(t).fontSize)); host.remove(); return sizes.length ? Math.min(...sizes) : 0; })()`);
  report.push({ file: f, ok: true, title, width: Math.round(w), height: Math.round(h), minFontPx, foreignObject: (svg.match(/<foreignObject/g) || []).length });
}
await page.close();
unlinkSync(shell); // holds the local path to mermaid.min.js; never committed
writeFileSync(join(here, 'svg', 'render-report.json'), JSON.stringify({ mermaid: version, coverage, diagrams: report }, null, 2) + '\n');
console.log(JSON.stringify({ mermaid: version, diagrams: report }, null, 1));
if (report.some((r) => !r.ok)) process.exit(1);
