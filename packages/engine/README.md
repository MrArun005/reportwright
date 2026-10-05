# @pagewrightjs/engine

The Pagewright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, HTML or CSV. Includes the `pw` command line.

```js
import { render, FontStore, fontFile, exportPdf, createSubsetter } from '@pagewrightjs/engine';
import fs from 'node:fs';
const pub = new URL('./node_modules/@pagewrightjs/engine/public/', import.meta.url);
// fontFile(key) names the file behind a key: a .ttf face, or harfbuzz.wasm for the text shaper (Arabic, Hebrew, Indic, Thai…)
const fonts = new FontStore((key) => fs.readFileSync(new URL(`fonts/${fontFile(key)}`, pub)));
// embed only the glyphs a PDF uses (without it, every font embeds in full: a few hundred KB each)
const subset = createSubsetter(() => fs.promises.readFile(new URL('harfbuzz-subset.wasm', pub)));
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts, parameters: { accountId: 'LN-1' } });
fs.writeFileSync('statement.pdf', await exportPdf(model, fonts, { title: 'Statement', subset }));
// Excel, CSV, Word, interactive HTML and the accessible PDF rebuild tables from the table data, which render() keeps
// only when asked: render(def, { exportData: true }) (needsExportData(format) says which formats need it)
```

```bash
npx pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx pw test reports        # snapshot tests for reports-as-code
```

MIT. The fonts in `public/fonts` are under the SIL Open Font License.
