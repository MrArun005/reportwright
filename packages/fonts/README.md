# @pagewrightjs/fonts

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Ffonts)](https://www.npmjs.com/package/@pagewrightjs/fonts) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/fonts)](https://socket.dev/npm/package/@pagewrightjs/fonts) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The fonts `@pagewrightjs/engine` renders with (Inter, JetBrains Mono, Noto for Arabic, Hebrew, Indic, Thai and more),
the HarfBuzz shaper (`fonts/harfbuzz.wasm`), the PDF font subsetter (`harfbuzz-subset.wasm`) and the PDF/A colour
profile (`icc/`). Kept out of the engine so it stays small. Install it next to the engine and the engine finds it:

```bash
npm i @pagewrightjs/engine @pagewrightjs/fonts
```

Fonts: SIL Open Font License. Chinese, Japanese and Korean: `@pagewrightjs/fonts-cjk`.
