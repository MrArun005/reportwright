# @reportwright/engine

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fengine)](https://www.npmjs.com/package/@reportwright/engine) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/engine)](https://socket.dev/npm/package/@reportwright/engine) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The ReportWright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, PowerPoint (exportPptx), HTML or CSV. Includes the `pw` command line.

```bash
npm i @reportwright/engine @reportwright/fonts
```

```js
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
import fs from 'node:fs';
// the fonts, the text shaper (Arabic, Hebrew, Indic, Thai…) and the PDF subsetter come from @reportwright/fonts;
// for your own fonts: new FontStore((key) => bytesOf(fontFile(key)))
const fonts = defaultFontStore();
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts, parameters: { accountId: 'LN-1' } });
// fonts are subset by default (only the glyphs the PDF uses); { subset: false } embeds every font in full
fs.writeFileSync('statement.pdf', await exportPdf(model, { fonts, title: 'Statement' }));
// the same options object everywhere: exportXlsx(model, { fonts }), exportDocx(model, { fonts }), exportPptx(model, { fonts })
// Excel, CSV, Word, interactive HTML and the accessible PDF rebuild tables from the table data, which render() keeps
// only when asked: render(def, { exportData: true }) (needsExportData(format) says which formats need it)
```

## Implicit behaviour, and how to switch it

- **ISO dates.** When a data set has no `fields`, they are detected from the rows, and a string that looks like an ISO
  date (`2024-01-31`, `2024-01-31T10:00:00Z`) becomes a date. Keep such strings as text with `detectDates: false` on
  the data set, or declare the fields and give that one `type: 'string'`.
- **Chart colours.** By default colours go by position. `colorByCategory: true` on charts gives each category (pie,
  donut and funnel slices; `seriesGroup` series) one colour in every chart of the report that sets it.
- **Network.** Only data sources of a fetched type (`rest`, `graphql`, `soap`, `odata`, and `csv` or `xml` with a URL) and SQL sources without
  `sql` make requests, through `render(def, { fetch })`. Without that option the engine falls back to
  `globalThis.fetch`. Pass your own to add auth, a proxy or an allow-list, or to forbid requests altogether:
  `render(def, { fetch: () => { throw new Error('no network') } })`.
- **Currency.** `C2` with no `currency` on the report uses the locale's own (`en-IN` ₹, `de-DE` €, `en-US` $).

## Many reports at once (Node): a worker pool

```js
import { createPool } from '@reportwright/engine/pool';
const pool = createPool({ workers: 4 });            // default: CPU count - 1; each worker loads the engine and fonts once
const pdf = await pool.render(definition, { format: 'pdf', parameters: { id: 42 } });   // Uint8Array
await pool.close();
```

Measured on an 8-core laptop, 40 copies of a one-page chart report (`node scripts/bench-pool.mjs`): 1 worker 14.7/s,
4 workers 40.7/s.

The `pw` command line is in `@reportwright/cli`:

```bash
npx -p @reportwright/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @reportwright/cli pw test reports        # snapshot tests for reports-as-code
```

MIT.
