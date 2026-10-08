# PDF benchmarks

ReportWright's engine against four other ways to make a PDF in Node, on the same workloads. This folder has its own
`package.json` so none of the other libraries enters ReportWright's dependencies. The published numbers come from the
`bench` GitHub Actions workflow (`.github/workflows/bench.yml`, run by hand) on `ubuntu-latest`; the demo site's
benchmarks page (`site/bench.html`) reads `site/bench/results.json`.

## Contestants

Exact versions, pinned in `package.json` and `package-lock.json`:

| Library | Version | How it is used |
|---|---|---|
| `@reportwright/engine` (+ `@reportwright/fonts`) | 0.12.1 | A JSON report definition. Invoice: `render()` + `exportPdf()`. Table: `exportPdfStream()` (the README's way for large reports), rows passed as the array, `presorted: true`. |
| `pdfmake` | 0.3.11 | A document definition; table with `headerRows: 1`; `footer(currentPage, pageCount)`. |
| `@react-pdf/renderer` (+ `react` 19.3.0) | 4.9.0 | Components via `React.createElement` (no JSX build); a `fixed` header row; a `fixed` footer with a `render` prop; rows are flex-row `View`s with `wrap={false}`. |
| `pdfkit` | 0.20.2 | Manual layout: this code places every row, starts pages and redraws the header; page numbers with `bufferPages` + `switchToPage`. |
| `puppeteer` | 25.13.0 | HTML + CSS printed by headless Chrome (the Chrome version is recorded in the results). One browser a process, a new page a document; `<thead>` repeats; "Page N of M" is a CSS `@page` margin box. |

## Workloads

Everything below is shared code in `data.mjs`; each library only turns it into a PDF.

- **Page:** A4 portrait (595.28 × 841.89 pt), 36 pt margins on all sides. A page footer, where there is one, takes the
  last 18 pt above the bottom margin, so every library's body area is 523 × 751.89 pt.
- **Font:** Inter Regular and Inter Bold, the same `.ttf` files (from `@reportwright/fonts`) for every library,
  embedded and subset (each library's default). Text 9 pt.
- **Invoice** (`invoice`): one page. Seller and buyer blocks, invoice number and dates, a 12-line item table with a
  shaded header, subtotal, VAT and total, and a wrapping note. All amounts are computed once and printed as the same
  strings.
- **Warm invoice** (`invoice-warm`): the invoice 50 times in one process; the result is the median of the last 40.
  This is the cost a long-running server pays per document.
- **Table report** (`table`, 1,000 / 10,000 / 100,000 rows): a ledger of 7 columns (id, account, region, type, date,
  amount, reference) with fixed widths 50/62/50/62/62/70/167 pt, 14 pt rows with a 0.5 pt rule; a shaded column header
  repeated on every page; rows grouped by region (four groups) with a shaded group header and a "Region total" row
  (row count and amount sum); a grand total; "Page N of M" bottom right. Rows are generated deterministically and
  arrive already in group order (as `ORDER BY region` would give them). Amounts are formatted `1,234.50`, dates are
  ISO strings printed as they are.
- **Grouped subtotals:** ReportWright has groups and aggregates in the report definition. The other four have none:
  `groupsOf()` computes the groups and sums once, in plain JavaScript, the same way for all four, and each library
  only lays out the resulting rows. This is the documented way to do it with those libraries; the capability table
  says "computed in your code", not "supported".

## What is measured

Each run is a new `node child.mjs …` process; the first run of every cell is a warmup and is dropped; then 5 runs
(3 at 100,000 rows). Reported: the median and the min–max spread.

- **Render time:** inside the process, from the start of building the document to the PDF written to disk. The data
  is made before the clock starts; library import and setup (and Puppeteer's browser launch) are not in it.
- **Cold start:** the invoice's whole process, timed from the parent: spawn, Node start, import, setup (browser
  launch), render, write, exit.
- **Peak RSS:** the larger of Node's own `maxRSS` and the summed RSS of the process tree sampled every 100 ms with
  `ps` (so Chrome's processes count for Puppeteer).
- **Output size:** bytes of the PDF.
- **Install size:** `install-size.mjs` installs each library alone into an empty folder (`npm install --omit=dev`,
  peers included) and measures `node_modules`, plus the browser Puppeteer downloads.
- **PDF/A and PDF/UA:** `verapdf.mjs` makes the invoice and the 1,000-row table with each library's PDF/A option and
  with its tagging option (or its ordinary output when it has none), then validates them with veraPDF as PDF/A-2b and
  PDF/UA-1. The tool's version is recorded with the verdicts.
- A run that takes longer than the timeout (900 s) is stopped and recorded as "did not finish"; larger sizes for that
  library are then not run.

## Reproduce

```bash
cd bench
npm ci                      # Puppeteer downloads Chrome; PUPPETEER_SKIP_DOWNLOAD=1 to leave it out (and --libs without puppeteer)
node install-size.mjs       # out/install.json (downloads every package again, into temp folders)
node verapdf.mjs            # out/verapdf.json (needs veraPDF: brew install verapdf, or the verapdf/cli Docker image)
node run.mjs                # out/results.json, merging the two files above
node run.mjs --smoke --out=out/smoke.json   # a quick check: 100 rows, no browser, 3 runs
```

`run.mjs` takes `--libs=reportwright,pdfkit`, `--sizes=1000,10000`, `--runs=N` and `--timeout=SECONDS`. A full run
at 100,000 rows is heavy (several libraries hold the whole document in memory); run it on a machine you can spare.

## Known biases and open questions

- The harness is written by ReportWright's author. Each implementation follows its library's documentation, but the
  author knows ReportWright best. Pull requests that make a competitor faster are welcome and will be merged.
- Unsure of best practice: **react-pdf** at 10,000+ rows (one `Page` with many wrapping rows is the documented
  pattern; splitting into several `Page`s or `Document`s might be faster but changes "Page N of M"); **Puppeteer**
  (reusing one page instead of a new page a document is faster for small documents; `setContent` with a very large
  HTML string versus streaming it from a local server); **PDFKit** (0.20 also has `doc.table()`; manual layout was used
  as specified; drawing text with `lineBreak: false` and measuring right-aligned text ourselves skips the line
  wrapper).
- ReportWright streams the table (`exportPdfStream`); the others build the whole document in memory, which is how
  they work. PDFKit's `bufferPages` (needed for "Page N of M") keeps every page until the end.
- Each run is a fresh process, so even "render time" includes first-use costs (JIT, font parsing). The warm invoice
  shows the steady state; the table numbers do not separate it.
- Puppeteer's render time leaves out the browser launch (it is in cold start), and its memory is sampled every
  100 ms across Chrome's processes, which can miss short peaks.
- Layouts are close but not identical: line heights and paddings differ by library, so page counts can differ a
  little; the page count is reported next to every table result.
- ReportWright's "Page N of M" reads the rows twice (once to count pages); the others lay the whole document out
  once and fill the numbers in at the end.
- One machine, one OS (a shared GitHub runner, whose neighbours add noise; the spread shows how much).
