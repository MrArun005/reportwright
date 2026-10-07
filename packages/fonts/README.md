# @reportwright/fonts

[![npm](https://img.shields.io/npm/v/%40reportwright%2Ffonts)](https://www.npmjs.com/package/@reportwright/fonts) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/fonts)](https://socket.dev/npm/package/@reportwright/fonts) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The fonts `@reportwright/engine` renders with (Inter, JetBrains Mono, Noto for Arabic, Hebrew, Indic, Thai and more),
the HarfBuzz shaper (`fonts/harfbuzz.wasm`), the PDF font subsetter (`harfbuzz-subset.wasm`) and the PDF/A colour
profile (`icc/`). Kept out of the engine so it stays small. Install it next to the engine and the engine finds it:

```bash
npm i @reportwright/engine @reportwright/fonts
```

Fonts: SIL Open Font License. Chinese, Japanese and Korean: `@reportwright/fonts-cjk`.
