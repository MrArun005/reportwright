# @reportwright/engine

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fengine)](https://www.npmjs.com/package/@reportwright/engine) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/engine)](https://socket.dev/npm/package/@reportwright/engine)

The ReportWright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, PowerPoint (exportPptx), HTML or CSV. The command line is `@reportwright/cli` (`pw`).

```bash
npm i @reportwright/engine @reportwright/fonts
```

Save this as `statement.pw.json` (a minimal report; the repository's `examples/` has more):

```json
{
  "$schema": "pagewright/report@1",
  "name": "Statement",
  "page": { "size": "A4", "margins": [36, 36, 36, 36] },
  "parameters": [{ "name": "accountId", "type": "string" }],
  "dataSources": [{ "name": "ledger", "type": "json", "data": { "rows": [{ "item": "Design", "amount": 1200 }, { "item": "Hosting", "amount": 99.5 }] } }],
  "dataSets": [{ "name": "Lines", "source": "ledger", "path": "$.rows" }],
  "sections": { "body": { "items": [
    { "type": "textbox", "name": "Title", "x": 0, "y": 0, "w": 400, "h": 24, "value": "Statement", "style": { "fontSize": 18, "fontWeight": "bold" } },
    { "type": "table", "name": "Table", "x": 0, "y": 40, "w": 400, "h": 60, "dataSet": "Lines",
      "columns": [{ "width": 250 }, { "width": 150 }],
      "header": [{ "height": 18, "cells": [{ "value": "Item" }, { "value": "Amount", "style": { "textAlign": "right" } }] }],
      "detail": [{ "height": 18, "cells": [{ "value": "=Fields.item" }, { "value": "=Fields.amount", "style": { "format": "C2", "textAlign": "right" } }] }],
      "footer": [{ "height": 18, "cells": [{ "value": "Total" }, { "value": "=Sum(Fields.amount)", "style": { "format": "C2", "textAlign": "right", "fontWeight": "bold" } }] }] }
  ] } }
}
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
// a bundled browser app (Vite, webpack, Next client code): copy the fonts folder to your site and point at it, since the
// package's location is not known to the bundler. `cp -r node_modules/@reportwright/fonts/public/fonts public/pw/fonts`
const bundledFonts = defaultFontStore({ fontsUrl: '/pw/fonts/' }); // a missing font is an error; a URL or, in Node, a path
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
  `sql` make requests, through `render(def, { fetch })`. Without that option the engine uses `globalThis.fetch` behind
  an SSRF guard: http(s) only; no loopback, private, link-local, CGNAT, multicast or reserved address in any spelling
  (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`), no `localhost` name; in Node (20.16+) the request goes through
  node:http(s) with the checked address pinned (no DNS rebinding; a failed lookup refuses); every redirect hop checked
  again (at most 5; never https → http; another origin gets none of the source's headers); a parameter fills a URL's path and query, never its scheme and host (unless the
  whole URL is a parameter and its host is in `allowHosts`). `allowHosts: ['10.0.0.5']` lets named hosts through;
  `unsafeFetch: true` turns the guard off. Pass your own `fetch` to add auth, a proxy or an allow-list, or to forbid
  requests altogether: `render(def, { fetch: () => { throw new Error('no network') } })`.
- **Fetch limits.** Every data request (yours too) stops after `fetchTimeoutMs` (30 s, never past the render's
  `timeoutMs`) and after `maxFetchBytes` (64 MB, counted decoded, so a gzip bomb stops too). Exporters take
  `timeoutMs` as well; the PDF exporter checks every PNG before decoding it and leaves a damaged one out (`onWarning`).
- **Currency.** `C2` with no `currency` on the report uses the locale's own (`en-IN` ₹, `de-DE` €, `en-US` $).

## Streaming PDF for large reports

`exportPdfStream(definition, options, sink)` writes the PDF as it is laid out: a flowing table is laid out a window of
rows at a time and each page leaves memory once it is written, so a million-row report's PDF needs about the memory of a
few pages (measured: peak RSS flat from 20,000 to 100,000 rows, about 270 MB for the whole Node process). The file reads as
`exportPdf`'s: the same pages, text and positions.

```js
import fs from 'node:fs';
import { exportPdfStream } from '@reportwright/engine';

const out = fs.createWriteStream('ledger.pdf');
const r = await exportPdfStream(definition, { parameters: { year: 2026 }, title: 'Ledger' }, out);
out.end();
console.log(r.streamed ? `${r.pages} pages, streamed` : `written whole: ${r.why}`);
```

The sink is a Node `Writable` or anything with `write(bytes)` that may return a promise (back-pressure); it is not
closed for you. Options are `render()`'s and `exportPdf`'s (`fonts`, `parameters`, `title`, `pdfa`, `tagged`, …), plus
`window` (rows laid out at once, 1,000), `maxRows` (rows read, 5,000,000) and `parallel` (Node: that many worker threads
lay out and paint the pages; the file is byte for byte the same; each thread loads the engine and fonts, so it costs
memory: about 150 MB a thread). Rows come from the report's source a batch at a time: CSV and REST (JSON) sources are read
as streams, and `sqlRows(source, params)`, an async iterable of row batches, stands in for a database cursor.

**What streams:** a body that is one table (with items above or below it), its rows' expressions row by row (fields,
parameters, functions of the row, `RowNumber()`), groups with headers that repeat, subtotals (`Sum`, `Count`, `Avg`,
`Min`, `Max` of a row expression, `CountRows()`), keep-together and page breaks, filters and sorts, page headers and
footers without aggregates ("Page N of M" included: the pages are counted first, so the source is read twice), PDF/A-2b,
and accessible PDFs (PDF/UA-1, PDF/A-2a; validated with veraPDF).

**What is written whole** (`exportPdf`, the result says why): matrices, charts, lists, subreports, images, rich text,
lookups and aggregates outside footers, more than one data set, group sections (`newSection`), signed or encrypted PDFs.
Grouped and sorted tables hold their rows in the sort unless `sorter` spills them to disk (the ReportWright server does).

`examples/stream-1m.mjs` streams a generated million-row ledger to a file and prints its peak memory:
`node node_modules/@reportwright/engine/examples/stream-1m.mjs 1000000 ledger.pdf` (`--grouped`, `--tagged`,
`--parallel=4`, `--plain`).

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
