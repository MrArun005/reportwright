# @reportwright/fonts-cjk (optional)

Chinese, Japanese, Korean and emoji fonts for ReportWright, downloaded on demand and checked by SHA-256.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Ffonts-cjk)](https://www.npmjs.com/package/@reportwright/fonts-cjk) [![license](https://img.shields.io/badge/license-OFL--1.1%20%2B%20MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/fonts-cjk)](https://socket.dev/npm/package/@reportwright/fonts-cjk)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) (the gallery and the [designer playground](https://mrarun005.github.io/reportwright-demo/play.html); the demo serves the bundled fonts, so CJK text there needs this package's files in its `fontsUrl` folder).

The fonts are Noto (SIL Open Font License). They are not in
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

## Quick start (30 seconds)

After `npx reportwright-fonts-cjk`, CJK text renders with no other change:

```js
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
const fonts = defaultFontStore();   // also reads the CJK cache folder
const def = { $schema: 'reportwright/report@1', name: 'Hello', page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { body: { items: [{ type: 'textbox', name: 'Hi', x: 0, y: 0, w: 400, h: 24, value: 'こんにちは · 안녕하세요 · 你好' }] } } };
const pdf = await exportPdf(await render(def, { fontStore: fonts }), { fonts });
```

Verified against this version in Node 20 (Japanese, Korean and Simplified Chinese; the emoji download returned HTTP 504
from the upstream host on the day it was checked, and the command stops at the first failed file).

## Examples

**Docker image:** download at build time into a fixed folder the server also reads.

```dockerfile
ENV REPORTWRIGHT_FONTS_DIR=/opt/reportwright/fonts
RUN npx reportwright-fonts-cjk
```

**Simplified Chinese shapes** instead of the default (Japanese) Han shapes: `"style": { "fontFamily": "Noto Sans SC" }`.

**Browser viewer:** download into the served fonts folder, under `cjk/`:
`npx reportwright-fonts-cjk public/pw/fonts/cjk` with `fontsUrl: '/pw/fonts/'`.

## API

| Export | What |
|---|---|
| `fetchCjkFonts(dir?, { log?, fetch? })` | downloads and checks every file into `dir` (default `cacheDir()`) |
| `cacheDir(env?, platform?, home?)` | the folder the fonts go to (rules below) |
| `fontPath(name)` | a downloaded file's path |
| `CJK_FONTS` | the files: upstream path, file name, SHA-256 |
| CLI `reportwright-fonts-cjk [dir]` | `fetchCjkFonts` from the command line |

Requires Node 20.16 or later (it uses the global `fetch`). Related: [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts) (the bundled
fonts), [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine), [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer).
