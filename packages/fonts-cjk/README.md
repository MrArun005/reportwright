# @reportwright/fonts-cjk (optional)

[![npm](https://img.shields.io/npm/v/%40reportwright%2Ffonts-cjk)](https://www.npmjs.com/package/@reportwright/fonts-cjk) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/fonts-cjk)](https://socket.dev/npm/package/@reportwright/fonts-cjk)

Chinese, Japanese, Korean and emoji fonts for ReportWright (Noto, SIL Open Font License). They are not in
`@reportwright/fonts` because they are large:

| File | Covers | Size |
|---|---|---|
| `NotoSansJP.ttf` | kana, Han (the default for Han text), CJK punctuation, full-width forms | 9.6 MB |
| `NotoSansKR.ttf` | Hangul | 10.4 MB |
| `NotoSansSC.ttf` | Simplified Chinese Han shapes (set `fontFamily: "Noto Sans SC"`) | 17.8 MB |
| `NotoEmoji.ttf` | emoji (monochrome) | 2.0 MB |
| total | | 39.8 MB (the bundled fonts are 5.0 MB) |

The package is small: the fonts are downloaded on demand (no install script runs), from
[google/fonts](https://github.com/google/fonts) at a pinned commit, and each file is checked against its SHA-256 before
it is written.

```bash
npm i @reportwright/engine @reportwright/fonts @reportwright/fonts-cjk
npx reportwright-fonts-cjk              # into the cache folder (below), where defaultFontStore() looks
npx reportwright-fonts-cjk public/pw/fonts/cjk   # or a folder you serve to the viewer (fontsUrl + cjk/)
```

```js
import { fetchCjkFonts } from '@reportwright/fonts-cjk';
await fetchCjkFonts();                 // the same, from code (e.g. in your Docker build)
```

The fonts go to a cache folder outside `node_modules`, so upgrading or reinstalling the package keeps them:

| | Folder |
|---|---|
| `REPORTWRIGHT_FONTS_DIR` set | that folder |
| `XDG_CACHE_HOME` set | `$XDG_CACHE_HOME/reportwright/fonts-cjk` |
| Windows | `%LOCALAPPDATA%\reportwright\fonts-cjk` |
| otherwise | `~/.cache/reportwright/fonts-cjk` |

`defaultFontStore()` reads that folder first, then `node_modules/@reportwright/fonts-cjk/fonts`, where earlier versions
downloaded them (so an existing install keeps working until its next upgrade). In a Docker image, set
`REPORTWRIGHT_FONTS_DIR` for both the download step and the server, or run the download as the user the server runs as.
`cacheDir()` and `fontPath(name)` give the folder and a downloaded file's path from code.

In the ReportWright app repository: `npm run fonts:cjk` (into `public/fonts/cjk`).

Licences: the fonts are SIL Open Font License 1.1 (`OFL.txt` is downloaded with them); the downloader is MIT.

The engine loads a face only when text needs it (`FontStore` asks for `cjk/NotoSansJP.ttf` through `fontFile(key)`),
and a PDF embeds only the glyphs it uses: a line of Japanese, Korean and emoji adds about 8 KB. Without the files,
those characters draw as boxes and the render warns how to add them. The fonts are variable fonts drawn at their
default (regular) weight; bold CJK text is drawn regular.
