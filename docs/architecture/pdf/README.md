# PDF build of the architecture dossier

[`../IDauto_Dossier_Technique_Architecture.pdf`](../IDauto_Dossier_Technique_Architecture.pdf) is the French technical dossier,
« IDauto — Dossier Technique et Architecture du Système ». It is built from the documents and diagrams of
`docs/architecture/`. The Markdown and diagram sources are unchanged; this folder only adds the build.

| File | Role |
|---|---|
| `dossier.html`, `dossier.css` | French text of the dossier (A4, black and white). Taken only from README and 01 to 06. |
| `views.mjs` | Splits a diagram too large for an A4 page into parts, without rewriting it. Fails unless the parts together hold every node and every edge of the source. Output: `views/*.mmd` |
| `render-diagrams.mjs` | Renders `../diagrams/*.mmd` and `views/*.mmd` to vector SVG with Mermaid 11 in headless Chrome. Output: `svg/*.svg` and `svg/render-report.json` |
| `build-pdf.mjs` | Lays out and prints the PDF, then validates it. Output: the PDF and `build-report.json` |
| `cdp.mjs` | Minimal Chrome DevTools Protocol driver (no npm dependency) |

## Rebuild

Requirements:
- Node 22;
- a Chrome or chrome-headless-shell binary;
- `mermaid.min.js` 11.x;
- `pdfjs-dist` 4.x.

None of these is a dependency of the application.

```bash
export IDAUTO_PDF_CHROME=/path/to/chrome-headless-shell
export IDAUTO_PDF_MERMAID=/path/to/mermaid.min.js
export IDAUTO_PDF_PDFJS=/path/to/node_modules/pdfjs-dist
node render-diagrams.mjs && node build-pdf.mjs
```

`node build-pdf.mjs --pages <dir>` also writes one PNG per page, for visual review.

## What the build checks

- page count;
- a "Page n / N" footer on every page;
- no blank page;
- table-of-contents numbers equal the real pages (read back from the PDF's link destinations);
- every figure present, in order;
- landscape figures on landscape pages;
- every detail view's smallest label at 5.5 pt or more;
- no horizontal overflow;
- PDF bookmarks;
- no IP address, home path, private host, connection string or key in the text.

The results are printed in annex A of the PDF and in `build-report.json`.

## Not rendered

The PlantUML files (`../diagrams/*.puml`) are not rendered, because no PlantUML engine was available. Their content is
checked equal to the Mermaid diagrams, which the PDF includes.
