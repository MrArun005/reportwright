# Engine text: fonts and shaping

- Bundled (public/fonts, 5.0 MB, OFL): Inter, JetBrains Mono, and Noto Sans Arabic, Hebrew, Devanagari, Thai, Lao,
  Khmer, Myanmar, Tamil, Bengali, Telugu, Kannada, Gujarati; HarfBuzz (harfbuzz.wasm) shapes complex scripts.
- Optional (public/fonts/cjk, 39.8 MB): Noto Sans JP, KR, SC and Noto Emoji. See packages/fonts-cjk/README.md and
  `npm run fonts:cjk`. Measured: a one-line Japanese/Korean/emoji PDF is 8 KB with subsetting.
- A loader must map each key to its file with `fontFile(key)` (the shaper's key is `harfbuzz` → `harfbuzz.wasm`,
  optional faces are under `cjk/`). A loader that misses the shaper now warns: before R3-A the CLI and the README
  loader asked for `harfbuzz.ttf` and silently drew Arabic and Indic text unshaped (tests/engine/r3a-cli-shaping.test.js
  checks the glyph clusters).
