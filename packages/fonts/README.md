# @reportwright/fonts

The fonts, text shaper, PDF font subsetter and PDF/A colour profile that `@reportwright/engine` and `@reportwright/viewer` render with.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Ffonts)](https://www.npmjs.com/package/@reportwright/fonts) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/fonts)](https://socket.dev/npm/package/@reportwright/fonts)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo): every report in the [live gallery](https://mrarun005.github.io/reportwright-demo/#gallery) is drawn with these fonts, loaded from a `fontsUrl` folder as described below.

Kept out of the engine so the engine stays small. It has no code: it is a folder of files the engine finds by itself in Node, and that you serve as static files to the browser.

## Install

```bash
npm i @reportwright/engine @reportwright/fonts
```

## Quick start (30 seconds)

**Node:** nothing to configure; `defaultFontStore()` finds the package.

```js
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
const fonts = defaultFontStore();   // reads node_modules/@reportwright/fonts/public/fonts
const def = { $schema: 'reportwright/report@1', name: 'Hello', page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { body: { items: [{ type: 'textbox', name: 'Hi', x: 0, y: 0, w: 400, h: 24, value: 'नमस्ते · مرحبا · שלום · สวัสดี' }] } } };
const pdf = await exportPdf(await render(def, { fontStore: fonts }), { fonts });   // shaped, subset, no warnings
```

**Browser (viewer, or the engine in a bundled app):** copy the folder to your static files and pass its URL.

```bash
cp -r node_modules/@reportwright/fonts/public public/pw   # → public/pw/fonts/, public/pw/harfbuzz-subset.wasm, public/pw/icc/
```

```js
mountViewer('#report', { definition, data, fontsUrl: '/pw/fonts/' });   // @reportwright/viewer
const fonts = defaultFontStore({ fontsUrl: '/pw/fonts/' });            // @reportwright/engine in a bundle
```

Both were verified against this version (Node 20; Vite 7 in Chromium).

## Examples

**Use the monospace face** for codes and numbers: set the family in the item's style.

```json
{ "type": "textbox", "name": "Code", "x": 0, "y": 30, "w": 400, "h": 24, "value": "INV-0042", "style": { "fontFamily": "JetBrains Mono" } }
```

**Cache the folder for a year.** The files do not change within a package version:
`Cache-Control: public, max-age=31536000, immutable` on `/pw/`.

**Your own fonts in Node:** a `FontStore` over your files (`new FontStore((key) => bytesOf(fontFile(key)))`, see the
engine), or upload them to the self-hosted server.

## What is inside

| Path | What |
|---|---|
| `public/fonts/Inter-*.ttf` | Inter Regular, Italic, SemiBold, Bold, Bold Italic (the default family) |
| `public/fonts/JetBrainsMono-*.ttf` | JetBrains Mono Regular and Bold |
| `public/fonts/NotoSans*-*.ttf` | Noto Sans Arabic, Hebrew, Devanagari, Bengali, Gujarati, Kannada, Tamil, Telugu, Thai, Khmer, Lao, Myanmar (Regular and Bold) |
| `public/fonts/harfbuzz.wasm` | the HarfBuzz text shaper (complex scripts, ligatures, right-to-left) |
| `public/harfbuzz-subset.wasm` | the PDF font subsetter: a PDF embeds only the glyphs it uses |
| `public/icc/sRGB-v2-magic.icc` | the sRGB output intent `exportPdf(model, { pdfa: true })` embeds |

5.3 MB unpacked. A face is loaded only when the layout first needs it. A font that cannot be loaded is an error
(there is no fallback font). Chinese, Japanese, Korean and emoji are in [`@reportwright/fonts-cjk`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts-cjk)
because they are large.

## Related packages

[`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine) (peer of this package), [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer), [`@reportwright/cli`](https://github.com/MrArun005/reportwright/tree/main/packages/cli), [`@reportwright/fonts-cjk`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts-cjk).

Fonts: SIL Open Font License 1.1 (the `OFL-*.txt` files); the rest MIT.
