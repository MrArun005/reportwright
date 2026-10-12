# @reportwright/engine

Turn a JSON report definition and your data into paged PDF, Excel, Word, PowerPoint, HTML or CSV, in Node or the browser, with no Chromium.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fengine)](https://www.npmjs.com/package/@reportwright/engine) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/engine)](https://socket.dev/npm/package/@reportwright/engine)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) (the [live gallery](https://mrarun005.github.io/reportwright-demo/#gallery) renders real definitions with this engine; [benchmarks](https://mrarun005.github.io/reportwright-demo/bench.html) compares it with pdfmake, react-pdf, PDFKit and Puppeteer on the same reports).

The engine lays out pages from a definition (bands, tables with groups, matrices, charts, barcodes, subreports) and the exporters write the files. The command line is [`@reportwright/cli`](https://github.com/MrArun005/reportwright/tree/main/packages/cli) (`pw`); the in-browser viewer and designer are [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer).

## Screenshots

Page 1 of three reports from the repository's `reports/`, rendered to PDF by this engine:

<img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/sales-dashboard.png" alt="Sales dashboard" width="32%"> <img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/charts-showcase.png" alt="Charts showcase" width="32%"> <img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/loan-statement-hindi.png" alt="Loan statement in Hindi" width="32%">

More in the [repository README](https://github.com/MrArun005/reportwright#screenshots).

## How it works

- A report is a JSON definition (`reportwright/report@1`): page setup, parameters, data sources, data sets and the items in each band.
- `render()` binds the data, evaluates expressions and paginates into a page model (positioned text runs, boxes, lines, images).
- Text is shaped with HarfBuzz and measured with the real font, so pages break the same in Node and the browser.
- `exportPdf` writes through [`@reportwright/pdf`](https://www.npmjs.com/package/@reportwright/pdf) with subset fonts; `exportXlsx`, `exportDocx`, `exportPptx`, `exportHtml` and `exportCsv` read the same model.
- Large reports stream (`exportPdfStream`) and many reports run in a worker pool.

## Benchmarks

Measured 2026-10-11 on GitHub `ubuntu-latest` (4 vCPU), median of 5 warm runs, every output checked (qpdf, MuPDF, pdf.js, text). 0.14.0-rc.5 against JasperReports 6.21 and QuestPDF (.NET) (both from the same day's earlier run on the same runner type) and 0.13.1:

| Grouped report | 0.14 | JasperReports | QuestPDF | 0.13.1 |
|---|---|---|---|---|
| 100 rows | **145 ms** | 641 ms | 227 ms | 288 ms |
| 1,000 rows | **280 ms** | 1,286 ms | 499 ms | 532 ms |
| 10,000 rows | **913 ms** | 3,885 ms | 2,736 ms | 1,494 ms |
| 100,000 rows | **6.6 s** · 300 MB | 11.8 s | 24.1 s | 8.9 s |
| 1,000,000 rows (streamed) | **53 s** · 746 MB | — | — | 79 s |

The JavaScript engines are further behind: pdfmake 2.7× to 11× slower, @react-pdf/renderer and Puppeteer 4× to 700× slower or failing at 100,000 rows. First among report engines on the invoice, Unicode (Hindi, Arabic, CJK), PDF/A and plain-page jobs too. Losses: one invoice re-rendered in a warm process (16 ms; QuestPDF 7.4 ms), and 1,000 plain pages are ~6% slower than 0.13.1. All numbers, wins and losses: [bench/deep/RESULTS.md](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md).

## Install

```bash
npm i @reportwright/engine@next @reportwright/fonts@next
```

`@reportwright/fonts` is a peer dependency: it holds the fonts, the HarfBuzz text shaper, the PDF font subsetter and the PDF/A colour profile.

## Quick start (30 seconds)

Save this as `statement.pw.json` (a minimal report; the repository's `examples/` has more):

```json
{
  "$schema": "reportwright/report@1",
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
// render.mjs: node render.mjs
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

## Examples

Every example below was run against this version in Node 20. They use this report, `orders.pw.json`: a title and a
table of customers and amounts with a total (it is `examples/report.pw.json` in the repository):

```json
{
  "$schema": "reportwright/report@1",
  "name": "Orders",
  "page": { "size": "A4", "margins": [36, 36, 36, 36] },
  "dataSources": [{ "name": "orders", "type": "json", "data": { "rows": [] } }],
  "dataSets": [{ "name": "Lines", "source": "orders", "path": "$.rows" }],
  "sections": { "body": { "items": [
    { "type": "textbox", "name": "Title", "x": 0, "y": 0, "w": 300, "h": 24, "value": "Orders", "style": { "fontSize": 18, "fontWeight": "bold" } },
    { "type": "table", "name": "Table", "x": 0, "y": 40, "w": 400, "h": 60, "dataSet": "Lines",
      "columns": [{ "width": 250 }, { "width": 150 }],
      "header": [{ "height": 18, "cells": [{ "value": "Customer" }, { "value": "Amount", "style": { "textAlign": "right" } }] }],
      "detail": [{ "height": 18, "cells": [{ "value": "=Fields.customer" }, { "value": "=Fields.amount", "style": { "format": "C2", "textAlign": "right" } }] }],
      "footer": [{ "height": 18, "cells": [{ "value": "Total" }, { "value": "=Sum(Fields.amount)", "style": { "format": "C2", "textAlign": "right", "fontWeight": "bold" } }] }] }
  ] } }
}
```

### 1. Bind your own data, then write PDF, Excel, Word, PowerPoint, HTML and CSV

`sources` replaces a data source's data by name. The data set reads `$.rows`, so the JSON has a `rows` array; a
mismatch gives an empty table, not an error.

```js
import fs from 'node:fs';
import { render, defaultFontStore, validate, exportPdf, exportXlsx, exportDocx, exportPptx, exportHtml, exportCsv } from '@reportwright/engine';

const def = JSON.parse(fs.readFileSync('orders.pw.json', 'utf8'));
const orders = { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] };

const { errors } = validate(def);                 // { errors, warnings, exprErrors, checkOnly }
if (errors.length) throw new Error(errors.join('\n'));

const fonts = defaultFontStore();
const model = await render(def, { fontStore: fonts, sources: { orders }, exportData: true });
fs.writeFileSync('orders.pdf', await exportPdf(model, { fonts, title: 'Orders' }));
fs.writeFileSync('orders.xlsx', await exportXlsx(model, { fonts }));
fs.writeFileSync('orders.docx', await exportDocx(model, { fonts }));
fs.writeFileSync('orders.pptx', await exportPptx(model, { fonts }));
fs.writeFileSync('orders.html', await exportHtml(model, { fonts, title: 'Orders' }));
fs.writeFileSync('orders.csv', exportCsv(model));  // Customer,Amount / Asha Rao,1200.5 / Ben Ode,80
```

### 2. Parameters and a filter

```js
def.parameters = [{ name: 'minAmount', type: 'float', default: 0 }];
def.dataSets[0].filters = [{ expr: '=Fields.amount', op: '>=', value: '=Parameters.minAmount' }];
def.sections.body.items[0].value = '="Orders over " & Parameters.minAmount';

const model = await render(def, { fontStore: fonts, sources: { orders }, parameters: { minAmount: 100 } });
// one row (Asha Rao) under the title "Orders over 100"
```

### 3. Archival and accessible PDF

```js
const model = await render(def, { fontStore: fonts, sources: { orders }, exportData: true });
fs.writeFileSync('orders-pdfa.pdf', await exportPdf(model, { fonts, pdfa: true })); // PDF/A-2b, sRGB profile from @reportwright/fonts
```

From the command line, `pw render orders.pw.json --pdfa --ua` writes PDF/A-2a with PDF/UA-1 tagging.

### 4. Stream a large report to a file

```js
import { exportPdfStream } from '@reportwright/engine';
const out = fs.createWriteStream('orders.pdf');
const r = await exportPdfStream(def, { sources: { orders }, title: 'Orders' }, out);
out.end();
console.log(r.streamed, r.pages);                  // true 1
```

Details, memory figures and what streams are under [Streaming PDF for large reports](#streaming-pdf-for-large-reports).

### 5. Many reports in parallel (Node worker pool)

```js
import { createPool } from '@reportwright/engine/pool';
const pool = createPool({ workers: 2 });
const pdf = await pool.render(def, { format: 'pdf' }); // Uint8Array
await pool.close();
```

## Features

| Area | What the engine does |
|---|---|
| Layout | Page header and footer, body bands, absolutely placed items; tables with groups, subtotals, keep-together and page breaks; matrices (pivot); lists; subreports (nested up to 3 levels) |
| Items | Text and rich text, images, lines and shapes, charts (incl. sparklines and data bars), barcodes, maps |
| Expressions | `=Fields.x`, `=Parameters.x`, aggregates (`Sum`, `Count`, `Avg`, `Min`, `Max`, `CountRows()`), `RowNumber()`, lookups; an expression that does not parse draws `#Error` with a warning |
| Data | Inline JSON, `sources` passed to `render()`, REST, GraphQL, SOAP, OData, CSV, XML; SQL through your own `sql` / `sqlRows` callback |
| Text | HarfBuzz shaping (Arabic, Hebrew, Indic, Thai), bidi; CJK and emoji with [`@reportwright/fonts-cjk`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts-cjk) |
| PDF | Font subsetting, PDF/A-2b, PDF/A-2a and PDF/UA-1 (validated with veraPDF), AES-256 passwords and permissions |
| Scale | Streaming PDF, Word and Excel export; disk-spilling sort; worker pool and opt-in worker threads |
| Safety | SSRF guard on data fetches, per-fetch time and size limits, render `timeoutMs`, misspelled options reported |

## Supported formats

| Direction | Formats |
|---|---|
| Export | PDF (`exportPdf`, `exportPdfStream`), PDF/A-2b and PDF/A-2a, PDF/UA-1, Excel `.xlsx` (`exportXlsx`, `exportXlsxStream`), Word `.docx` (`exportDocx`, `exportDocxStream`), PowerPoint `.pptx` (`exportPptx`), HTML (`exportHtml`, with a sortable Tables view unless `static`), CSV (`exportCsv`), SVG per page (`pageToSvg`) |
| Import | JasperReports `.jrxml`, SSRS `.rdl` / `.rdlc`, BIRT `.rptdesign`, ActiveReports `.rdlx-json`: with `pw import` in [`@reportwright/cli`](https://github.com/MrArun005/reportwright/tree/main/packages/cli) |

## Options reference

From the package's types (`index.d.ts`); the JSDoc in `dist/` has every option.

**`render(definition, options)`** → page model

| Option | Meaning |
|---|---|
| `fontStore` | the `FontStore`; share one across renders |
| `parameters` | report parameter values by name (invariant form: `1234.5`, `2026-03-05`) |
| `sources` | data already loaded, by data source name (skips loading them) |
| `exportData` | keep the table data Excel, CSV, Word, interactive HTML and accessible PDF need |
| `now`, `timeZone` | the render's clock and the zone dates show in |
| `fetch`, `baseUrl`, `allowHosts`, `unsafeFetch` | how data requests are made (see the network notes below) |
| `fetchTimeoutMs`, `maxFetchBytes` | per-fetch limits (30 s, 64 MB) |
| `sql`, `loadReport` | callbacks for SQL sources and for subreports / masters by id |
| `timeoutMs`, `deadline` | stop with status 504 when the render runs longer |
| `largeReportRows` | rows past which a data set warns (100,000; `0` or `false` turns it off) |

**`exportPdf(model, options)`** → `Uint8Array`: `fonts`, `title`, `subset` (`false` embeds full fonts), `pdfa`
(`true` or `{ icc }`), `tagged`, `encrypt`, `onWarning`, `timeoutMs`.

**`exportXlsx` / `exportDocx` / `exportPptx(model, options)`** → `Promise<Uint8Array>`: `fonts`, plus `currency` and
`formulas` for Excel.

**`exportHtml(model, options)`**: `fonts`, `title`, `static`, `drillBase`, `drillLinks`, `locale`, `currency`, `lang`, `timeoutMs`. `drillLinks`: `inline` (default: a drill-through link opens in the same tab), `new-tab`, or `off` (shown disabled). A drill-through links only when `drillBase` is a public http(s) URL; unset, localhost or 127.x shows it disabled with a tooltip. `resolveHtmlExport(...layers)` (from `src/engine/htmlExport.js`) resolves a report's `export: { html, drillLinks }` against other layers, most specific first.
**`exportCsv(model, options)`**: `all`, `layout` (the printed layout instead of the data), `locale`, `currency`.

**`exportPdfStream` / `exportDocxStream` / `exportXlsxStream(definition, options, sink)`**: `render()`'s and
`exportPdf`'s options plus `window`, `maxRows`, `presorted`, `spill`, `parallel`, `signal`, `sqlRows`.

Other exports: `validate`, `blankReport`, `blankDashboard`, `FontStore`, `fontFile`, `defaultFontStore`,
`needsExportData`, `parameterOptions`, `resolveParameters`, `createSubsetter`, `pageToSvg`. Types for the definition
format: `import type { Report } from '@reportwright/engine/report'`; JSON Schema: `@reportwright/engine/schema.json`.

## Runtime support

- **Node** 20.9 or later (`engines`). The SSRF guard pins the checked address on Node 20.16+ / 22.3+.
- **Browsers**: the package is ES modules built for ES2022, for modern evergreen browsers through a bundler. In a
  browser, pass `defaultFontStore({ fontsUrl })` (see the quick start). Sorted or grouped exports hold their rows in
  memory there (keep them under about 100,000 rows).

## Limits

| Limit | Default | Option |
|---|---|---|
| Rows read by a streamed export | 5,000,000 | `maxRows` |
| Time per data fetch | 30 s | `fetchTimeoutMs` |
| Size per data fetch (decoded) | 64 MB | `maxFetchBytes` |
| Redirects per fetch | 5 | none |
| Subreport nesting | 3 levels | none |
| Disk used by a spilled sort | 2 GB | `spill: { maxMB }` |
| Warning threshold for a large data set | 100,000 rows | `largeReportRows` |

## Related packages

| Package | What it is |
|---|---|
| [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts) | fonts, shaper, subsetter and colour profile (required) |
| [`@reportwright/fonts-cjk`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts-cjk) | optional Chinese, Japanese, Korean and emoji fonts |
| [`@reportwright/cli`](https://github.com/MrArun005/reportwright/tree/main/packages/cli) | `pw`: render, test, diff and import reports from the command line |
| [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) | the in-browser viewer and designer |
| [`@reportwright/react`](https://github.com/MrArun005/reportwright/tree/main/packages/react), [`/vue`](https://github.com/MrArun005/reportwright/tree/main/packages/vue), [`/svelte`](https://github.com/MrArun005/reportwright/tree/main/packages/svelte), [`/angular`](https://github.com/MrArun005/reportwright/tree/main/packages/angular) | framework wrappers for the viewer and designer |

## Implicit behaviour, and how to switch it

- **ISO dates.** When a data set has no `fields`, they are detected from the rows, and a string that looks like an ISO
  date (`2024-01-31`, `2024-01-31T10:00:00Z`) becomes a date. Keep such strings as text with `detectDates: false` on
  the data set, or declare the fields and give that one `type: 'string'`.
- **Case in grouping, sorting and comparing text.** As SSRS on its default (case-insensitive) collation: table and
  matrix groups, list `groupBy` and every sort compare text ignoring case, so "North" and "north" are one group, shown
  with the first value met in the data's order. Chart categories, filters with `=`, `<>` and `in`, `CountDistinct`,
  `Lookup` and `LookupSet` compare exactly (case counts); `contains` and `like` ignore case. Set `caseSensitive: true`
  on the report, or on one data set (it then holds for the regions over that set), to group and sort upper and lower
  case apart. An imported RDL data set with `CaseSensitivity` True gets `caseSensitive: true`.
- **Filters, sorts and parameters fail loudly.** A filter with no `expr`, an unknown `op`, no `op` and no `value`, no
  `value` or a Between with no `value2` is a validation error (`{ expr, value }` with no `op` is `=`). A sort `by` a bare
  field name (`'region'`) sorts by that field with a warning (did you mean `=Fields.region`?); another constant warns
  that it does not sort. `Parameters.x` that is a near miss of a declared name is an error; a value passed in
  `parameters` for an undeclared name, or not of its parameter's type or options, is a warning, and an error (a
  `ReportError` with `status: 400`) with `render(def, { strictParameters: true })`, as on the server API and `pw render`.
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

**When memory stays flat.** Only when the report streams: check `r.streamed` (or `r.why`, which says why it did not;
a report written whole holds every page, about 3–10 KB a row). It then holds when the rows' expressions are row-local
(styles included: a zebra row, `=IIf(RowNumber() Mod 2 = 0, "#f3f4f6", "#ffffff")`, streams and stays flat, measured
287 MB against a plain table's 270 MB at 100,000 rows), when an expression style gives a handful of distinct values (up
to 64 per style are shared; a colour per row works but each row's style is then garbage V8 collects later), and when the
rows come from a source read in batches (REST, CSV, SQL `sqlRows`) rather than an array you pass in, which stays in
memory beside the export.

**"Page N of M" costs a counting pass.** With `Globals.TotalPages` in the page bands the rows are read and laid out
twice (a first pass counts the pages; past ~10,000 rows of a ledger it keeps nothing): about 1.5–1.8× the time and
+10–60 MB peak at 50,000 rows (measured 0.92 s → 1.42 s, 218 → 230 MB on a 6-column table; the 0.14 release gate
measured ≈1.8× and +~60 MB). Use "Page N" alone when the time matters.

```js
import fs from 'node:fs';
import { exportPdfStream } from '@reportwright/engine';

const out = fs.createWriteStream('ledger.pdf');
const r = await exportPdfStream(definition, { parameters: { year: 2026 }, title: 'Ledger' }, out);
out.end();
console.log(r.streamed ? `${r.pages} pages, streamed` : `written whole: ${r.why}`);
```

**Bytes in memory instead of a file.** `exportPdf(model)` takes a page model that `render()` has already built, so it
cannot stream: render + exportPdf holds every page (measured on a flowing 4-column table: 435 MB peak RSS at 100,000
rows, against 273 MB streamed with the rows themselves in the definition). For a large report that you want as bytes, give
`exportPdfStream` a sink that keeps the chunks; it renders the report whole itself when it cannot stream (`r.why`).
`render()` warns once per render when a data set has more rows than its `largeReportRows` option (default 100,000; `0`
or `false` turns it off): `Large report (N rows): …` in `model.warnings`, and on the console once per process.

```js
const parts = [];
const r = await exportPdfStream(definition, { title: 'Ledger' }, { write: (b) => { parts.push(b); } });
const bytes = Buffer.concat(parts); // the same pages as render + exportPdf
```

**A failed export leaves a damaged file.** The PDF is written as it goes, so an error, a timeout or an abort halfway
leaves a partial file at the path. Write to a temporary name and rename it when the export has succeeded:

```js
import fs from 'node:fs';
import { finished } from 'node:stream/promises';

const tmp = `${file}.part`;
const out = fs.createWriteStream(tmp);
try {
  await exportPdfStream(def, opts, out);
  await finished(out.end());
  await fs.promises.rename(tmp, file);
} catch (e) {
  out.destroy();
  await fs.promises.rm(tmp, { force: true });
  throw e;
}
```

**Rows from a database (`sqlRows`).** `sqlRows(source, params, { signal })` returns an async (or sync) iterable of
arrays of rows, a batch at a time; a single row is an error. This one reads a PostgreSQL cursor with `pg` and
`pg-cursor`, releases the client when the export ends or stops, and checks `signal` between batches:

```js
import pg from 'pg';
import Cursor from 'pg-cursor';

const pool = new pg.Pool();
const sqlRows = async function* (source, params, { signal }) {
  const client = await pool.connect();
  const cursor = client.query(new Cursor(source.query, Object.values(params)));
  try {
    for (;;) {
      signal?.throwIfAborted(); // stop between batches when the export is cancelled or times out
      const rows = await cursor.read(1000); // one batch of up to 1,000 rows
      if (!rows.length) break;
      yield rows;
    }
  } finally {
    await cursor.close().catch(() => {});
    client.release();
  }
};
await exportPdfStream(def, { sqlRows, timeoutMs: 120_000 }, out);
```

**Word and Excel, streamed.** `exportDocxStream(definition, options, sink)` and `exportXlsxStream(definition, options,
sink)` take the same sink, `timeoutMs`, `signal`, `sqlRows`, `maxRows` and `spill`: Word lays out a window of rows at a
time and writes each page's XML into the zip as it comes, Excel writes the sheet row by row, so neither holds the rows,
the pages or the XML (measured: live heap 17 MB after 20,000 and after 50,000 rows; a 50,000-row Word export runs in
`node --max-old-space-size=48`). A report that cannot stream is rendered whole and written in one piece (`streamed:
false`, and `why`). `exportDocx` and `exportXlsx` still take a rendered model.

Options that are not options are reported: a misspelled key (`{ windw: 500 }`) is ignored with a warning in the
result's `warnings` (`render()`: in the model's; `exportPdf`: through `onWarning`) naming the nearest option, and a
misspelling of `encrypt` or `prepare` throws, so a file is never written without the password or signature you asked
for. `encrypt`, `prepare`, `save` and PDF/A without a profile need the whole model, `sqlRows` included: the rows are
gathered, and the result says `streamed: false`.

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
  folder (`spill: { dir, maxMB, runMB, mergeMB }`; 2 GB of disk at most; `runMB` (default 8) and `mergeMB` (default 4) set the memory), so memory stays flat: the sort holds about 8 MB of rows while reading
  and 4 MB while merging, whatever the row count (past that many sorted runs, groups of them are merged on disk first).
  `spill: false`, and in a browser, it is in memory (all the rows: measured about 1.3 KB a row, so keep browser exports
  under about 100,000 sorted or grouped rows).
- **Big grouped reports: sort at the source.** When the source already gives the rows in the report's order (`ORDER BY
  region, type` for groups by region then type), pass `presorted: true`: nothing is sorted or held, each row is checked
  against the one before as it passes, and a row out of order stops the export with an error. It is the cheapest way to
  a large grouped report: a tester's 1,000,000-row grouped ledger (0.13.0, Node 22, 2 vCPU Linux) peaked at 293 MB
  presorted and 386 MB sorted by the engine; the engine's sort holds less since 0.13.1, but it still reads and writes
  every row to disk once more.
- **parallel: N | 'auto'** (Node, off by default) lays out and paints with N worker threads; the file is byte for byte
  the same as without them (tested: held, past the hold, `'auto'`, without "of M", not holdable). The counting pass
  runs here and hands each window it has counted to a worker at once, so layout and paint run while the pages are
  still being counted; with "of M" each worker holds its windows (25,000 rows a worker at most, then a second pass lays
  out the rest) until the count is known and then lays out only their page bands again. Compression runs in the
  workers (and, without them, on libuv's zlib threads). `'auto'` uses the cores but one (4 at most, none below 3) and
  starts them only once the report is big: past the held pass's cap (~10,000 rows of a ledger) with "of M", past
  10,000 rows without; a smaller report never starts a worker. Measured on an Apple M2 (4 performance + 4
  efficiency cores, 8 GB, a busy laptop), Node 22, the 7-column grouped "Page N of M" ledger, warm runs, peak RSS of
  the process with its workers:

  | rows | workers | ms | peak RSS MB |
  |---|---|---|---|
  | 10,000 | off | 200–240 | 295 |
  | 10,000 | 2 | 350–420 | 390 |
  | 10,000 | 4 | 390–440 | 495 |
  | 10,000 | 'auto' (none started) | 195–270 | 300 |
  | 100,000 | off | 2,400–2,550 | 390 |
  | 100,000 | 2 | 1,960–2,700 | 750–950 |
  | 100,000 | 4 | 1,800–2,060 | 970–1,090 |
  | 100,000 | 'auto' (4) | 1,800–2,100 | 1,080–1,120 |

  About 25% faster at 100,000 rows, for 2.5 times the memory; slower below ~20,000 rows (use `'auto'`). The counting
  pass is the floor: it stays on one thread. Off by default: turn it on (or `'auto'`) for big reports on idle cores.
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
