# Vendored OCR engine (IDA-V11)

Tesseract.js and its WebAssembly core, vendored so the plate scanner never
reaches an external origin. Same precedent as `../qrcodegen.js`.

The citizen CSP is `connect-src 'self'`: the engine could not fetch a core or
a language model from a CDN even if it tried. Everything it loads is served
from this origin through the explicit map in `reference/api.js`.

| File | What it is |
|---|---|
| `tesseract.min.js` | the library (Apache-2.0) |
| `worker.min.js` | its worker script, loaded as a same-origin URL (`workerBlobURL:false`) |
| `tesseract-core-{,simd-,relaxedsimd-}lstm.wasm.js` | emscripten glue — the engine feature-detects and imports ONE |
| `tesseract-core-{,simd-,relaxedsimd-}lstm.wasm` | the matching WebAssembly binary |
| `eng.traineddata.gz` | English model, `tessdata_fast` (Apache-2.0) |

All three core variants are present because a missing one is a hard failure,
not a fallback: Chrome requests `relaxedsimd`, older engines `simd`, and the
rest the plain build. A visitor downloads exactly **one** pair (~2.9 MB) plus
the model (~2.0 MB), and only after tapping "Scanner la plaque".

The English model is used for its DIGIT shapes only — the scanner runs with
`tessedit_char_whitelist = "0123456789"`, because a Tunisian série plate
(`SSS تونس NNNN`) contains no letters. The Arabic word is never read; the gap
it leaves is what separates the two digit groups.

Upstream: https://github.com/naptha/tesseract.js — do not edit these files.
