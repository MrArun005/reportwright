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
few pages (measured: peak RSS flat from 20,000 to 300,000 rows, about 250 MB for the whole Node process; most of it is
garbage V8 has not collected yet, not rows: it does not shrink with a smaller `window`, and
`node --max-old-space-size=128` holds a 300,000-row export to about 180 MB). The file reads as
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
`window` (rows laid out at once, 1,000), `maxRows` (rows read, 5,000,000), `presorted`, `spill` and `parallel`. Rows come
from the report's source a batch at a time: CSV and REST (JSON) sources are read as streams, JSON given as text is read
row by row, an array given in the definition (or in `sources`) is read where it is, never copied or sorted, and
`sqlRows(source, params)`, an async iterable of row batches, stands in for a database cursor. An array you pass is yours
and stays in memory for the export: the export's own memory stays flat beside it (measured: the array plus about
150 MB), but V8 lets garbage grow with a large live heap, so pass a cursor (`sqlRows`) or JSON text when the rows are
many.

- **Sorts and groups.** A table sort or groups put the rows in order first. In Node the sort spills to the system temp
  folder (`spill: { dir, maxMB }`; 2 GB at most), so memory stays flat; `spill: false`, and in a
  browser, it is in memory (all the rows: measured about 1.3 KB a row, so keep browser exports under about 100,000 sorted or
  grouped rows). When the source already gives the rows in the report's order (`order by region, type` for groups by
  region then type), pass `presorted: true`: nothing is sorted or held, each row is checked against the one before as it
  passes, and a row out of order stops the export with an error.
- **parallel: N** (Node, off by default) lays out and paints with N worker threads; the file is byte for byte the same.
  Each thread loads the engine and fonts and lays out its own windows: about 150–300 MB a thread (measured: 260 MB
  serial, 590 MB with 2, 890 MB with 4, for 100,000 rows). It helps only with idle cores and a report whose layout, not
  its source, is the slow part: 15% faster with 2 threads on a 2-core machine. Leave it off unless you have measured.
- **Time limit and cancelling.** `timeoutMs` bounds the whole export, including waits for a sink that stops reading
  (an HTTP client gone quiet, a `Writable` that never drains): past it the export rejects with status 504 and
  `code: 'ETIMEDOUT'`. `signal` (an `AbortSignal`) stops it at its next wait (a batch of rows, the sink, a sort, a
  page) and rejects with the signal's reason (an `AbortError`). `sqlRows(source, params, { signal })` gets the signal
  too, so a database cursor can cancel its query. Either way the rows' cursors are closed and a sort's temporary
  files removed.
- **Tagged files.** A tagged (PDF/UA) table has a structure element a cell: a million-row ledger has some 8 million,
  about 200 MB of file. Readers open it; tools that load every object (qpdf, pikepdf) may need gigabytes. Past a
  million elements the result warns; `tagged: { lang, maxElements }` caps it (the export stops with an error).

**What streams:** a body that is one table (with items above or below it), its rows' expressions row by row (fields,
parameters, functions of the row, `RowNumber()`), groups with headers that repeat, subtotals (`Sum`, `Count`, `Avg`,
`Min`, `Max` of a row expression, `CountRows()`), keep-together and page breaks, filters and sorts, page headers and
footers without aggregates ("Page N of M" included: the pages are counted first, so the source is read twice), PDF/A-2b,
and accessible PDFs (PDF/UA-1, PDF/A-2a; validated with veraPDF). A data set without declared `fields` streams too: its fields are
detected from its first 50 rows, as the whole render detects them (declare them when a column first appears later).

**What is written whole** (`exportPdf`; the result says why, in `why` and in its first warning, since its memory grows
with its pages): matrices, charts, lists, subreports, images, rich text,
lookups and aggregates outside footers, more than one data set, group sections (`newSection`), signed or encrypted PDFs.
Grouped and sorted tables sort through a disk spill in Node (above), in memory in a browser.

`examples/stream-1m.mjs` streams a generated million-row ledger to a file and prints its peak memory:
`node node_modules/@reportwright/engine/examples/stream-1m.mjs 1000000 ledger.pdf` (`--grouped`, `--presorted`,
`--tagged`, `--plain`, `--array`, `--array=text`; serial unless `--parallel=N`).

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
