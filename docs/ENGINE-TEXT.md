# Engine text: fonts and shaping

- Bundled (public/fonts, 5.0 MB, OFL): Inter, JetBrains Mono, and Noto Sans Arabic, Hebrew, Devanagari, Thai, Lao,
  Khmer, Myanmar, Tamil, Bengali, Telugu, Kannada, Gujarati; HarfBuzz (harfbuzz.wasm) shapes complex scripts.
- The 14 standard PDF fonts (no file, nothing embedded): `Helvetica`, `Times-Roman` and `Courier` (regular, bold,
  italic and bold-italic: Helvetica-Bold, Helvetica-Oblique, Helvetica-BoldOblique, Times-Italic…), `Symbol` and
  `ZapfDingbats`. A PDF names them (Type1, WinAnsiEncoding, the AFM widths from @pdf-lib/standard-fonts) and every reader
  draws them; layout measures with the same widths, so line breaks match the PDF. Aliases: `Arial` is Helvetica,
  `Times` and `Times New Roman` are Times-Roman, `Courier New` is Courier (each pair has the same widths); `serif` is
  Times-Roman. A character WinAnsi lacks (Ł, →, Greek, CJK) is drawn in Inter (JetBrains Mono for Courier), or a
  script's fallback, with a warning: `Font "Helvetica" can't show "Ł→"; used Inter for them.` PDF/A and PDF/UA forbid
  fonts that are not embedded: there the text is drawn in that embedded stand-in, each glyph at the standard font's
  position (no metric-compatible face such as Liberation ships, so the letters' widths differ), with a warning. SVG and
  HTML name the font with a fallback list (`Helvetica, Arial, "Liberation Sans", sans-serif`); Word and PowerPoint
  name Arial, Times New Roman and Courier New. An invoice in Helvetica is about 1.6 KB.
- Any other family the engine does not have is drawn in Inter (JetBrains Mono for a monospace name such as Consolas
  or Menlo) with a warning: `Font "NoSuchFont" is not available; using Inter.` A CSS list (`"Brand, Helvetica"`)
  uses its first available font; `sans-serif` and `monospace` are Inter and JetBrains Mono.
- Optional (public/fonts/cjk, 39.8 MB): Noto Sans JP, KR, SC and Noto Emoji. See packages/fonts-cjk/README.md and
  `npm run fonts:cjk`. Measured: a one-line Japanese/Korean/emoji PDF is 8 KB with subsetting.
- A loader must map each key to its file with `fontFile(key)` (the shaper's key is `harfbuzz` → `harfbuzz.wasm`,
  optional faces are under `cjk/`). A loader that misses the shaper now warns: before R3-A the CLI and the README
  loader asked for `harfbuzz.ttf` and silently drew Arabic and Indic text unshaped (tests/engine/r3a-cli-shaping.test.js
  checks the glyph clusters).
