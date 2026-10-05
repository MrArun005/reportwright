# @pagewrightjs/fonts

The fonts `@pagewrightjs/engine` renders with (Inter, JetBrains Mono, Noto for Arabic, Hebrew, Indic, Thai and more),
the HarfBuzz shaper (`fonts/harfbuzz.wasm`), the PDF font subsetter (`harfbuzz-subset.wasm`) and the PDF/A colour
profile (`icc/`). Kept out of the engine so it stays small. Install it next to the engine and the engine finds it:

```bash
npm i @pagewrightjs/engine @pagewrightjs/fonts
```

Fonts: SIL Open Font License. Chinese, Japanese and Korean: `@pagewrightjs/fonts-cjk`.
