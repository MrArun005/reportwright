# @pagewrightjs/engine

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fengine)](https://www.npmjs.com/package/@pagewrightjs/engine) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/engine)](https://socket.dev/npm/package/@pagewrightjs/engine) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The Pagewright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, PowerPoint (exportPptx), HTML or CSV. Includes the `pw` command line.

```bash
npm i @pagewrightjs/engine @pagewrightjs/fonts
```

```js
import { render, defaultFontStore, exportPdf } from '@pagewrightjs/engine';
import fs from 'node:fs';
// the fonts, the text shaper (Arabic, Hebrew, Indic, Thai…) and the PDF subsetter come from @pagewrightjs/fonts;
// for your own fonts: new FontStore((key) => bytesOf(fontFile(key)))
const fonts = defaultFontStore();
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts, parameters: { accountId: 'LN-1' } });
// fonts are subset by default (only the glyphs the PDF uses); { subset: false } embeds every font in full
fs.writeFileSync('statement.pdf', await exportPdf(model, { fonts, title: 'Statement' }));
// the same options object everywhere: exportXlsx(model, { fonts }), exportDocx(model, { fonts }), exportPptx(model, { fonts })
// Excel, CSV, Word, interactive HTML and the accessible PDF rebuild tables from the table data, which render() keeps
// only when asked: render(def, { exportData: true }) (needsExportData(format) says which formats need it)
```

The `pw` command line is in `@pagewrightjs/cli`:

```bash
npx -p @pagewrightjs/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @pagewrightjs/cli pw test reports        # snapshot tests for reports-as-code
```

MIT.
