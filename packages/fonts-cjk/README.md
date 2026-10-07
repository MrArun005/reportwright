# @pagewrightjs/fonts-cjk (optional)

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Ffonts-cjk)](https://www.npmjs.com/package/@pagewrightjs/fonts-cjk) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/fonts-cjk)](https://socket.dev/npm/package/@pagewrightjs/fonts-cjk) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

Chinese, Japanese, Korean and emoji fonts for Pagewright (Noto, SIL Open Font License). They are not in
`@pagewrightjs/fonts` because they are large:

| File | Covers | Size |
|---|---|---|
| `NotoSansJP.ttf` | kana, Han (the default for Han text), CJK punctuation, full-width forms | 9.6 MB |
| `NotoSansKR.ttf` | Hangul | 10.4 MB |
| `NotoSansSC.ttf` | Simplified Chinese Han shapes (set `fontFamily: "Noto Sans SC"`) | 17.8 MB |
| `NotoEmoji.ttf` | emoji (monochrome) | 2.0 MB |
| total | | 39.8 MB (the bundled fonts are 5.0 MB) |

Fetch them into the folder the font loader reads, `fonts/cjk/`:

```bash
npm run fonts:cjk                                   # in the app: public/fonts/cjk
node scripts/fetch-fonts-cjk.mjs node_modules/@pagewrightjs/fonts/public/fonts/cjk   # for the engine package
```

The engine loads a face only when text needs it (`FontStore` asks for `cjk/NotoSansJP.ttf` through `fontFile(key)`),
and a PDF embeds only the glyphs it uses: a line of Japanese, Korean and emoji adds about 8 KB. Without the files,
those characters draw as boxes and the render warns how to add them. The fonts are variable fonts drawn at their
default (regular) weight; bold CJK text is drawn regular.
