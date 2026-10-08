# Third-party notices

ReportWright is MIT licensed (see LICENSE). It ships or bundles the following third-party work, under their own licenses.

## Bundled code

| Component | Version | License | Used for |
|---|---|---|---|
| [HarfBuzz](https://github.com/harfbuzz/harfbuzz), compiled to WebAssembly by [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | harfbuzzjs 1.6.2 | HarfBuzz: "Old MIT" (below); harfbuzzjs: MIT, Copyright (c) 2019-2026 The harfbuzzjs project authors | text shaping (`harfbuzz.wasm`) and font subsetting (`harfbuzz-subset.wasm`) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT, Copyright (c) 2019 Andrew Dillon | the classic PDF writer (encryption, `prepare`, `save`) |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | reading font files |
| [@pdf-lib/standard-fonts](https://github.com/Hopding/standard-fonts) | 1.0.0 | MIT; the metrics are Adobe's AFM files for the 14 standard PDF fonts | Helvetica, Times and Courier widths: generated from its AFM data into src/engine/text/standard-metrics.js (scripts/gen-standard-metrics.mjs); the package itself is not a runtime dependency |
| [bwip-js](https://github.com/metafloor/bwip-js) | 4.11.4 | MIT | barcodes |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | zip and deflate (Excel, Word, PowerPoint, PDF streams) |
| [bidi-js](https://github.com/lojjic/bidi-js) | 1.0.3 | MIT | right-to-left text |

The full license text of each npm dependency is in its package under `node_modules`.

### HarfBuzz ("Old MIT" license)

HarfBuzz is licensed under the so-called "Old MIT" license. Its copyright holders are listed in
[COPYING](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING) in the HarfBuzz repository.

> Permission is hereby granted, without written agreement and without license or royalty fees, to use, copy, modify,
> and distribute this software and its documentation for any purpose, provided that the above copyright notice and
> the following two paragraphs appear in all copies of this software.
>
> IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE TO ANY PARTY FOR DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR
> CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF THE COPYRIGHT HOLDER HAS
> BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
>
> THE COPYRIGHT HOLDER SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS ON AN "AS IS" BASIS, AND THE
> COPYRIGHT HOLDER HAS NO OBLIGATION TO PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.

## Fonts (in @reportwright/fonts and @reportwright/fonts-cjk)

All fonts are under the [SIL Open Font License 1.1](https://openfontlicense.org); each family's license file ships next
to it in `public/fonts` (OFL-Inter.txt, OFL-JetBrainsMono.txt, OFL-NotoSans*.txt).

| Family | Source |
|---|---|
| Inter | [rsms/inter](https://github.com/rsms/inter) |
| JetBrains Mono | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) |
| Noto Sans Arabic, Bengali, Devanagari, Gujarati, Hebrew, Kannada, Khmer, Lao, Myanmar, Tamil, Telugu, Thai | [notofonts](https://github.com/notofonts) |
| Noto Sans CJK and Noto Emoji (fonts-cjk, downloaded on demand) | [notofonts](https://github.com/notofonts) |

## Colour profile

`sRGB-v2-magic.icc` (the PDF/A output intent) is from
[Compact-ICC-Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles) by Clinton Ingram, released under
CC0 1.0 (public domain).
