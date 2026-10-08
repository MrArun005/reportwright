# Changelog

All `@reportwright/*` packages (formerly `@pagewrightjs/*`) share one version. The versioning policy is in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-semver).

## Unreleased

### Fixed
- **CJK fonts survive upgrades (N10):** `@reportwright/fonts-cjk` downloads into a cache folder outside the package (`REPORTWRIGHT_FONTS_DIR`, else `$XDG_CACHE_HOME/reportwright/fonts-cjk`, else `%LOCALAPPDATA%\reportwright\fonts-cjk` on Windows or `~/.cache/reportwright/fonts-cjk`), so upgrading the package no longer deletes them; `defaultFontStore()` reads that folder, then the package's old `fonts/` folder, so existing installs keep working. New exports: `cacheDir()`, `fontPath(name)`.
- **The 14 standard PDF fonts (A1.2):** `fontFamily` `Helvetica`, `Times-Roman` and `Courier` (four faces each, PostScript names such as `Helvetica-BoldOblique`), `Symbol` and `ZapfDingbats` are named in the PDF and not embedded (Type1, WinAnsiEncoding, the Adobe AFM widths from `@pdf-lib/standard-fonts`); layout measures with the same widths. Aliases: Arial → Helvetica, Times New Roman → Times-Roman, Courier New → Courier. An invoice in Helvetica is about 1.6 KB. Characters WinAnsi lacks are drawn in Inter with a warning; PDF/A and PDF/UA embed Inter (JetBrains Mono for Courier) at the standard font's glyph positions, with a warning; `exportPdfStream` does the same. SVG/HTML name the font with a CSS fallback list, Word and PowerPoint name Arial, Times New Roman or Courier New. `@pdf-lib/standard-fonts` (already installed with pdf-lib) is now a declared dependency, kept external in the packages.
- **Unknown fonts (N39):** a `fontFamily` the engine does not have is no longer swapped silently: the render warns once per name (`Font "NoSuchFont" is not available; using Inter.`), and monospace names (Consolas, Menlo, Monaco…) use the shipped JetBrains Mono instead of Inter, so aligned columns stay aligned. Family names match in any case, a CSS list (`"Brand, Inter"`) uses its first available font, and the generic names `sans-serif` and `monospace` map to Inter and JetBrains Mono without a warning.
- **Streaming tickets, from the 0.12.1 retest (N23-N29):** `exportPdfStream` with `encrypt` or `prepare` and `sqlRows` no
  longer fails with "Save the report first" (the rows are gathered for the whole-model render); a misspelled option
  key (`encrpyt`, `windw`) warns with "Did you mean" in `render()`'s model warnings, `exportPdfStream`'s result and
  `exportPdf`'s `onWarning`, and a misspelling of `encrypt` or `prepare` throws so no file is written without its
  password or signature; `sqlRows` yielding single rows says "sqlRows must yield arrays of rows (got an object with
  keys …)" and sync iterables are accepted; `spill.dir` that does not exist says so; `pw render --base` on a private
  address names `--allow-internal`; README: the temp-file + rename pattern for a failed stream and a `pg` +
  `pg-cursor` `sqlRows` example; the `exportPdf` option docs (pdfa, prepare, save) say what the code does.
- **Data and form-field retest tickets (B9):**
  - A `number` (or `date`) field with text in it (N26) warns once per field with the first bad row and how many values
    are empty, in a render and in a streamed export. Numeric strings such as "12.34" stay silent.
  - A data set whose path matches an object that holds the rows (`data: { orders: { rows: [...] } }`) warns and names
    the array key (N8). An object of fields, such as `$.meta`, does not.
  - `validate()` warns on an aggregate with no scope outside a table, list or data-set item (it uses the first data
    set), and on `nullable: false` or `allowBlank: false` with no default on a parameter that is not required.
  - A form field has a `label` (falls back to `tooltip`); a tagged PDF uses it as the field's accessible name (`/TU`)
    and warns for each field without one (N30).
- **Tagged PDF table of contents (N32):** a TOC is tagged `TOC > TOCI > Reference > Link`, with the entry text, its page number and the link annotation inside one Link (it was plain `P` elements with a Link around the number only), and its title is an `H1`. veraPDF PDF/UA-1: compliant. The streaming PDF's tagging is unchanged.
- **Cascading parameters in the viewer:** when a parent parameter changes, a dependent value its list no longer offers is replaced (by the default if still offered, else the first choice) in the state the run uses, and the report re-runs with it. Before, the panel dropped the value but the run kept the old one ("Delhi, South region" with no rows).
- **Viewer page thumbnails (A11Y-3):** `.vthumb` no longer has an `aria-label` that differs from its visible number (axe `label-content-name-mismatch`); its name "Page 1" comes from hidden text beside the visible 1.
- **Viewer worker fallback (N1):** when the render worker cannot load (Vite 7 without `worker: { format: 'es' }`, or esbuild not following `new Worker(new URL(...))`), the viewer logs once `[reportwright] worker did not load (<reason>); rendering on the main thread`, and `handle.usesWorker` says which one you got. The viewer README now starts with the bundler setup. No Vite plugin: the setting is one line.
- **Worker file (N18):** `engine.worker.js` is one self-contained file (no `chunk-*.js` imports), so copying it alone next to a page works.
- **Viewer fonts (N31):** the viewer fetches a font face only when the layout first needs it, not all seven up front. A report in Inter Regular and Bold now downloads 670 KB (two files) instead of 4.9 MB. Serve `fontsUrl` with `Cache-Control: public, max-age=31536000, immutable` (in the viewer README). WOFF2 for the browser is not done yet.
- **Streaming PDF (`exportPdfStream`) failures, from the 0.12.1 retest:**
  - A sink that stops reading no longer hangs the export: `timeoutMs` covers the waits for drain (504, `code:
    'ETIMEDOUT'`), a sink's `error` or `close` ends the wait, and the new `signal` option (an `AbortSignal`) stops the
    export at its next wait (rows, sink, sort, page) with an `AbortError`. `sqlRows` gets `{ signal }` as its third
    argument. On timeout or abort the rows' cursors are closed and spill files removed.
- **Polar chart without `xValue`** (the angle) says so in validate() and the render ("a polar chart needs xValue"), instead of
  "N of N rows have no x or y value". A valid polar chart gets no warnings.
- **Variable font subsets say their weight:** a variable font cut at Regular is named Regular (family, subfamily, full and PostScript names) with usWeightClass 400, and its variation tables are dropped, in the PDF and HTML subsets.
- **Deprecation messages** all say "will be removed in 1.0" (exportHtml's said 0.9). A test greps the source for a deprecation string that names 0.9.
- **Rich text warnings** say "Rich text:" once (an unnamed item was named "Rich text" and the parser repeated it). The legend warning says what is accepted: a chart's legend is "bottom" or "none", and it is drawn at the bottom.

- **Designer (b9):**
  - Embedded designer: `mountDesigner` asks before the page is left with unsaved changes (`warnOnLeave`, default
    true; false leaves it to the host), and the handle has `isDirty()` and an `onDirtyChange(dirty)` option. The guard is
    removed on save and on `unmount()` (N34). A blank report is named "Untitled report" (it was "New report").
  - Keyboard: the outline rows are a listbox with one Tab stop (Up/Down/Home/End move, Enter or Space selects, Shift
    adds; then Delete and the arrows act on the selection); the left rail's tabs take the focus to their section;
    canvas items are Tab stops named "Text box T1, x 10, y 10" that Enter selects (N35).
  - Paste uses the paste event's clipboard (no clipboard-read permission), else the copy made in this tab, and says
    when there is nothing to paste (N36).
  - Width and height are at least 1 pt (a line may be 0 one way) (N33). Ctrl+D offsets the copy by 12 pt, as a paste
    does (N37).
  - Opening a report gives an item without an `id` a stable one (a hash of its band, place and name), so the same
    file always reads back the same; the other normalisation (names, band heights, a table's size) is unchanged (N38).
  - Embedded designer (shadow root): the table cell menu acts again, and Esc and Ctrl+S work after a click on a band
    label, a matrix or a drill-through in Preview.
  - A table that gets taller (Add group) grows its band; a drop into a 0 pt band grows it. A number field dropped on a
    group header cell gives `=Sum(...)`, as on a footer. A matrix value shown as a percentage gets the format P1 while
    its format is still the default N0. The matrix's drill-down toggle starts closed, as the table's.
  - Accessibility: the fx button is named "fx: Open the expression editor"; table row tags have 4.85:1 contrast.

## 0.12.1 — 2026-10-08

### Fixed
- **Word export: long reports.** The document XML goes to the zip in pieces instead of one string: a 500k-row report
  hit V8's string limit (RangeError: Invalid string length). A report with no tables exports without `exportData`.
- **`exportHtml(model, { fonts, ...options })`** takes the options object like the other exporters; the 0.7 form
  `exportHtml(model, fontStore, options)` still works with a deprecation warning. It threw before ("reading 'get'").
- **Charts: scatter and bubble axes** no longer pad past zero the data does not stay above (0-100 data gives 0 to 120,
  not -50 to 150). Warnings: a row one series leaves blank is drawn by the others, so it is not reported as not drawn;
  a gantt chart has no series by design and gets no "has no series" warning.
- **Variable CJK fonts** are cut at Regular (wght 400), not their default Thin instance, in the PDF and HTML subsets.
- **Data fetch:** gzip, deflate and br bodies are decoded (the byte cap counts decoded bytes); `file:` and `data:` URLs
  are refused with the scheme named, not "its host is made by a parameter".
- **Format characters** (RLM, LRE/LRI, ZWJ/ZWNJ, soft hyphen) need no glyph: no "No font has these characters" warning,
  and no notdef box in the PDF.
- **Warnings:** an unnamed item is named by its type (no "undefined:"), and a sub-report warning that validate and the
  render both say is said once.
- **`parameterOptions()`** lists a parameter's fixed options first, then the fetched ones, each value once (as the viewer does).
- **HTML Tables: date sort keys** use the wall clock, so the same report gives the same keys in every host time zone.

- **Streaming PDF (`exportPdfStream`), from an independent 1M-row verification:**
  - Rows given as an array are read where they are (never copied whole or sorted, tested); JSON given as text is read
    row by row instead of parsed whole (a 300,000-row text source: 910 → 500 MB peak). The README says why a large array
    still shows a large RSS (it is the caller's, and V8 lets garbage grow beside it) and to pass a cursor or text.
  - Grouped and sorted tables: in Node the engine package sorts through a disk spill by default (`spill: { dir, maxMB }`,
    `spill: false`), so a grouped export's memory is flat (300,000 rows: 300 MB, was 670 MB and growing); `presorted:
    true` reads rows that come in the report's order without sorting, checking each against the one before (a row out of
    order stops the export with an error).
  - A data set without declared `fields` streams: its fields are detected from the first 50 rows, as the whole render
    detects them. A report written whole now says why in its first warning, not only in `why`.
  - The window that reaches the last rows is the last one: a table whose footer keeps with its rows could stop with
    "The data changed while the PDF was written".
  - Tagged PDFs are about 27% smaller (a page's borders are one artifact and its cells' text one text object; plain cells
    carry no attributes; the xref stream is predicted). Past a million structure elements the result warns that tools
    which load every object (qpdf, pikepdf) may run out of memory; `tagged.maxElements` caps it.
  - `parallel: N` is documented with its memory (150–300 MB a thread) and when it helps; the example runs serial.
  - The comments of `exportPdfStream` said tagged and PDF/A files do not stream; they do.
  - Note: the non-streaming `exportPdf` still uses pdf-lib, which stays a dependency.
- **BIRT import: SUM and other aggregates total their column.** A bound column with `aggregateFunction` (SUM, AVE,
  MIN, MAX, FIRST, LAST…) had no listed argument, so it fell back to a row count: `Sum(1, …)` showed 3 for a total of
  250.75. The column's own expression is now the argument. An aggregate with no expression is counted as approximated.
  The Jasper and SSRS importers were checked: they already take the expression.
- **Docs: no npm provenance badge.** The repository is private, so npm provenance cannot be generated. The badges and
  the claims are removed from the package READMEs and `docs/RELEASING.md`; the publish workflow stays, and its notes say
  provenance needs a public repository.
- **Docs: the viewer's `data` example** says which shape matches the data set's path: `{ orders: { rows: [...] } }` for
  `"path": "$.rows"`, `{ orders: [...] }` for a data set with no path. A mismatch gives empty tables, silently.
- **Docs: a missing font** stops the viewer's run with a message naming the font and a Retry button; the README said the
  report draws in a fallback font, which it does not.
- **Docs: the engine README** says `pw` is in `@reportwright/cli`, and its quick start has a `statement.pw.json` to save.
- **CLI help** marks `pw audit` and `pw migrate-storage` as server only; the npm CLI does not include them.
- **Engine text:** the CJK font warning names `npx reportwright-fonts-cjk` first (the app's `npm run fonts:cjk` second),
  and the deprecated positional export forms say they are removed in 1.0.

## 0.12.0 — 2026-10-08

Streaming PDF: very large reports are written page by page, with flat memory.

### Added
- **`exportPdfStream(definition, options, sink)`** in `@reportwright/engine`: a report whose body is a flowing table
  (plain or grouped: repeating group headers, subtotals, `RowNumber()`, widow control, keep-together, page breaks) is laid
  out a window of rows at a time and each finished page goes straight to the sink. Peak memory stays flat: about 260 MB
  for the whole render process from 20,000 to 100,000 rows (projected about 250–275 MB at 1,000,000).
  "Page N of M" and footer totals work (a counting pass first). PDF/A-2b, PDF/UA-1 and PDF/A-2a + PDF/UA-1 stream too
  (veraPDF passes). Anything else (images, charts, matrices, rich text, subreports, signing, encryption) falls back to
  `exportPdf`, with the same output.
- **The server streams large PDFs** (`/api/reports/<id>/pdf`, `/api/v1/render`) with the same row caps, deadline, stall
  timeout and abort handling as the CSV/Excel streaming; the viewer's large-report button gets the streamed file.
- **`parallel: N`** (Node, opt-in): page ranges painted on worker threads, byte-identical to the serial file. Measure on
  your hardware before relying on it; each worker costs about 150 MB.
- `examples/stream-1m.mjs` in the engine package: streams a generated million-row ledger to a file and prints peak memory.
- `planPaged` exported for custom pipelines.

### Changed
- The PDF painter is shared between `exportPdf` and the streaming writer; `exportPdf` output is byte-for-byte unchanged.
- The engine package ships its readable bundle without a source map (1.3 MB unpacked).

### Known limits
- In the npm engine, grouped reports sort rows in memory (the server spills them to disk), so a 1M-row grouped report is
  not flat outside the server yet.

## 0.11.0 — 2026-10-08

Everything since 0.10.0. Items marked **Behaviour change** alter output that a pixel-locked layout or a locale-sensitive
export may depend on: check them before you upgrade.

### Behaviour changes
- **Numbers and dates shrink instead of wrapping.** An amount inside a text box shrinks like a number, a short code or a
  header word shrinks before it breaks inside (`Amou|nt`, `m0|2`), and a short text shrinks before it is cut with `…`
  or wraps alone in a one-line box. Reports that relied on the old wrap need a wider box or `shrinkToFit: false`.
- **Widow control is on by default** for every group: a heading or a lone row no longer ends a page. `widowControl: false`
  turns it off. Page counts can change for reports that break inside groups.
- **A group taller than a page splits** with at least two rows on each side of the break, so no lone row sits at a page
  foot or head. A keep-together block no longer leaves a blank page.
- **Sideways tables spread their column sets evenly** over the pages they need (a balanced split, not a long last page).
- **Number grouping follows Intl by default** (es-ES shows `1234,50`). The report option `grouping` is `always` or
  `never`. Unformatted numbers use a Latin decimal sign with Latin digits (ar-SA).
- **Page size names are forgiving.** `"a4 "` and `"letter"` resolve to A4 and Letter. An unknown size (`"A44"`) still
  falls back to A4 with a warning and a suggestion.
- **Data bars:** a value label sits after the bar when it fits, else inside it, right-aligned, in a contrasting ink.
  Negative values draw from a zero line in `negativeColor` (default red); positive-only columns are unchanged.
- **Charts:** column category labels turn (-45) when they do not fit flat, instead of dropping every other label. Scatter
  and bubble axes pad the automatic range so the largest point is not on the frame. `outliers: clip | none` decides what
  happens to points past an explicit axis min or max; clipped points get a ring and a warning. A scatter or bubble row
  with no x or y is no longer drawn at 0 (one warning counts them).
- **Fetched CSV, XML and JSON** read the response charset (ISO-8859-1, windows-1252, ...); UTF-8 is the default and a BOM
  is stripped.
- **Fetch is SSRF-guarded by default:** http(s) only, private and local addresses refused in every spelling, DNS checked
  in Node, each redirect re-checked, parameters fill the path and query only. `allowHosts` and `unsafeFetch` opt out.
- **Expressions read own members only:** `constructor`, `__proto__` and other inherited names give `#Error`.
- **Data fetch errors** name the cause (DNS, refused, reset, TLS, timeout) and redact the URL (query shown as `?…`, no
  userinfo, no keys or tokens).
- **Charts and barcodes get generated alt text** (type, title, series, categories; symbology and value) when the author
  sets none. The author's alt text always wins.
- **Subreport report ids** may use capitals and underscores (still no `/`, `\`, `.` or `..`).
- **Deterministic output:** structure tag ids come from the render's counter, so two renders give one model.
  `exportPdf` takes `creationDate`, or `SOURCE_DATE_EPOCH`; then the dates are UTC and the document ID derives from the
  content.
- **PDF images that cannot be embedded** (GIF, WebP, undecodable, a URL with no `fetchImage`, too large) are left out
  with a warning that names the picture and the reason. A cut or damaged PNG is checked and left out instead of hanging.

### Added
- **Vercel hosting.** `GET /api/v1/cron` runs the schedule tick and the batch queue when `CRON_SECRET` (16+ characters) is set, with `Authorization: Bearer $CRON_SECRET`; without it the route answers 404. `vercel.json` runs it daily. On Vercel, a queued batch runs after its response.
- `PW_STORAGE` falls back to `DATABASE_URL` when unset, on Vercel or with `PW_STORAGE_FROM_DATABASE_URL=1` only (documented in docs/CONFIG.md).
- **Designer: Import report** (File group) reads `.jrxml`, `.rdl`, `.rdlc`, `.rptdesign` and `.json` definitions through
  the importers, and shows the importer's warnings. The CLI (`pw import`) does the same.
- **ViewerHandle:** `setParameters`, `setDefinition`, `goToPage`, `getPageCount`, `print`, `export` (Blob), and `on(ready |
  error | page | parameters)`. The React ref gets the handle. Documented in the viewer README.
- **validate()** warns about unknown format codes (`N2x`), colour names (`redd`), named styles, sort entries not shaped
  `{by, dir}`, date defaults that are not dates, charts with no series, local image paths, and unknown or padded page
  sizes. Each warning has a did-you-mean where one exists.
- **Word export:** heading items are Heading 1 to 6 paragraphs, and the document language is the report locale by default
  (`lang` still wins).
- **Tagged PDF:** link annotations say the link's visible text, else its tooltip, else its URL.
- **PDF drill-through links** open the viewer with their parameters (a URI when the base URL is known). URIs are ASCII,
  the outline holds headings and nests group bookmarks, and every PDF has page labels.
- **Types:** `render()` takes a `RenderOptions` type. Sort entries are `{by, dir}` (`SortSpec`) on data sets, tables and
  lists. `report.d.ts` is regenerated.
- **Strict CSP:** the viewer and the Designer run under `style-src 'self'` with no style element and no style attribute
  written by the engine. See the viewer README.
- **Fonts:** `defaultFontStore({ fontsUrl })` reads a copied fonts folder in bundled apps. A font that does not load is named
  on screen and `onReady` reports it. Faces load lazily, only those a report uses; a face that fails to load falls back to a
  bundled face with a warning.

### Changed
- **Designer accessibility:** Inspector section headings are real buttons (Enter and Space toggle them). Chart gallery
  choices are named by the chart type alone. The Designer's embedded font rules go through a constructable stylesheet.
- **Viewer export menu:** each format is named by its format ("PDF document"), with the badge hidden from screen readers.
- **Toolbar:** `toolbar.hide` takes group keys (`export`, `search`, `zoom`, `navigation`), `sidebar`, and every format id.
  No Export gear when no format is left.
- **Optional CJK and emoji faces** do not add a font warning; their own `NO_CJK_FONTS` warning covers them.

### Fixed
- Subreport ids and render warnings: a render's warning list holds each message once, and a barcode warning names an
  unnamed item by place instead of `undefined`.
- Text with objects, arrays or large numbers from data prints as data, not `[object Object]` or `1e+21`.
- Decimal sums stay exact above 2^49.
- Designer seq fields format as codes (no decimals, no grouping).
- Tables take column widths from the content (`fitColumns`, and columns with no width).
- Styles that are not objects (`"bold"`) are ignored with a validate() warning instead of crashing the render.
- Expression and render guards: a traversal subreport id or a parameter value like `../x` is refused before `loadReport`.
- Server renders: image URLs never reach internal hosts, dev mode included.
- Vite bundles no longer warn 'cannot be analyzed' for the Node-only sharp import.

## 0.10.0

Streaming exports and a pool that uses every core. No change to rendering, totals or page counts. Design and measurements:
[docs/research/STREAMING-1M.md](docs/research/STREAMING-1M.md).

### Added
- **Streaming data CSV and Excel.** A report with one table and row-by-row expressions (group and table footers may
  total with Sum, Count, Avg, Min, Max or CountRows) exports as it reads: rows come from the source a batch at a time
  (JSON arrays split from the byte stream, CSV, SQLite, PostgreSQL and MySQL cursors), are sorted and grouped through
  temporary files when needed, and are written to the response with back-pressure. Memory stays flat: 100k → 300k rows
  measured 160 → 168 MB for a CSV render, 185 → 197 MB for a grouped Excel one (the whole render process); 1M rows
  projects under 300 MB. Same bytes as before for CSV, same cells and formulas for Excel. Other reports take the page
  model as before. The answer has no `content-length`; a failure after the first bytes breaks the download off (CSV:
  a last line `#ERROR <reference>`). Settings: `PW_STREAM`, `PW_STREAM_MAX_ROWS`, `PW_STREAM_FETCH_MAX_MB`,
  `PW_STREAM_SQL_MAX_MB`, `PW_SPILL_MAX_MB`, `PW_SPILL_TOTAL_MB`, `PW_STREAM_STALL_MS`.
- Excel tables longer than 1,048,576 rows continue on a sheet "Name (2)" with their header rows again.
- `@reportwright/engine/pool`: `createPool({ heapMB, timeoutMs })`.

### Changed
- The server's render pool has a worker per core (less one, at most 16); memory decides what runs at once, by an
  estimate per template and caller, with small heaps for small and streaming renders (`PW_RENDER_SMALL_HEAP_MB`) and
  a cap on one caller's running renders (`PW_RENDER_RUNNING_PER_PRINCIPAL`). `UV_THREADPOOL_SIZE` follows the cores
  (Dockerfile, cluster.mjs).
- Excel: a plain cell no longer carries a duplicate style; the no-table CSV starts with a BOM like the others.

### Fixed
- SQLite sources: a reused query process failed every second query ("statement has been finalized").

## 0.9.0

Pagewright is now **ReportWright** (formerly Pagewright). No change to rendering, totals or page counts.

### Changed
- The npm packages moved to the `@reportwright` scope: `@reportwright/engine`, `/viewer`, `/fonts`, `/fonts-cjk`,
  `/cli`, `/react`, `/vue`, `/svelte`, `/angular`. The `@pagewrightjs/*` packages are deprecated and get no updates.
  Change the package names in your `package.json` and imports; nothing else.
- The brand in the app, the Designer, the viewer, mails, the 9 interface languages, the CLI, error messages and
  exports (the PDF Producer and Creator, HTML titles) reads ReportWright.
- The CLI installs as `reportwright` and still as `pw`; the CJK font downloader as `reportwright-fonts-cjk` (and
  `pagewright-fonts-cjk`).
- The repository is `github.com/MrArun005/reportwright` (the old URL redirects).

### Deprecated (removed in 1.0)
- `<pagewright-viewer>` and `<pagewright-designer>` (now `<reportwright-viewer>`, `<reportwright-designer>`; both are
  registered), `definePagewrightElements` (now `defineReportWrightElements`), `PagewrightViewer` and
  `PagewrightDesigner` in React and Vue (now `ReportWrightViewer`, `ReportWrightDesigner`), `pagewrightViewer` and
  `pagewrightDesigner` in Svelte (now `reportWrightViewer`, `reportWrightDesigner`), `window.Pagewright` (now
  `window.ReportWright`) and `/embed/pagewright-viewer.js` (now `/embed/reportwright-viewer.js`). Each old name is
  an alias of the new one.

### Kept (so deployments and stored data keep working)
- Settings keep the `PW_` prefix. The `x-pagewright-*` headers, the `pagewright_*` metrics, cookie and storage table
  names, the `.pw.json` extension and `"$schema": "pagewright/report@1"` are unchanged; `reportwright/report@1` is
  accepted as the same format.

## 0.8.1

Supply-chain hardening (what Socket.dev and similar scanners read). No change to rendering or exports.

### Changed
- `@pagewrightjs/viewer` no longer bundles pdf-lib, @pdf-lib/fontkit, bwip-js, fflate or bidi-js: they are
  dependencies pinned to exact versions, as in the engine. Import the viewer through a bundler (Vite, webpack,
  esbuild, Rollup…). Unpacked size 14.8 MB to 10.1 MB.
- The engine and the CLI import bidi-js too (a pinned dependency) instead of bundling its Unicode tables.
- `@pagewrightjs/cli` holds the report commands only (render, test, diff, import): no server modules, no
  `child_process`, no environment reads. `pw audit` and `pw migrate-storage` run from the app (`node bin/pw.mjs`).
- No line over 1,000 characters in any package (source maps aside).
- `render(def, { fetch })` is the documented way to give the engine its network access; `globalThis.fetch` is only
  the fallback, and the error without either says so.
- `@pagewrightjs/fonts` ships a LICENSE file.

### Added
- `npm run scan:packages` (`scripts/scan-packages.mjs`): a Socket-style scan of every packed package, run in CI and
  before publishing. Release steps: [docs/RELEASING.md](docs/RELEASING.md).

## 0.8.0

### Breaking (with a deprecation period)
- One export signature: `exportPdf(model, { fonts, ... })`, `exportXlsx(model, { fonts, ... })`,
  `exportDocx(model, { fonts, ... })`, `exportPptx(model, { fonts, ... })`. The 0.7 positional forms
  (`exportPdf(model, fontStore, opt)`, `exportXlsx(model, ExcelJS, opt)`) still work in 0.8 and print one deprecation
  warning; they are removed in 0.9. A wrong argument gives a `TypeError` that says what was expected.
- A table cell under another cell's `colSpan` is no longer drawn on top of it (validate() warns about it).

### Added
- The viewer works without a server: `mountViewer(el, { definition, data, fontsUrl })` (also in the React, Vue,
  Svelte and Angular wrappers). The README says what works standalone and what needs the self-hosted server.
- `colSpan` in RDL/HTML style: a row with fewer cells than columns omits the spanned cells.
- The report JSON Schema, published as `@pagewrightjs/engine/schema.json`; `report.d.ts` is generated from it and
  `validate()` checks properties and choices against it (the hand-written types and the validator had drifted apart: `dir`, `alt` and about 30 engine properties were missing from one or the other).
- `pdfa: true` finds the sRGB colour profile in `@pagewrightjs/fonts` by itself.
- `@pagewrightjs/fonts-cjk`: Chinese, Japanese, Korean and emoji fonts, downloaded on demand
  (`npx pagewright-fonts-cjk`), pinned and checked by SHA-256.
- `createPool({ workers })` in `@pagewrightjs/engine/pool`: renders on worker threads (4 workers: 2.8× one).
- `detectDates: false` on a data set; `colorByCategory: true` on charts (one colour per category across charts).
- `pw import report.jrxml` (also .rdl and .rptdesign) in `@pagewrightjs/cli`.
- Docs: docs/QUICKSTART.md, docs/SCHEMA.md and docs/FUNCTIONS.md (generated), docs/FROM-JASPER.md; `examples/`.

### Changed
- The Excel export has its own writer: no ExcelJS (and none of its deprecated dependencies, `uuid` among them);
  50,000 rows: export memory +124 MB (was +409 MB), 3× faster.
- Runtime dependencies are pinned to exact versions; the unused `harfbuzzjs` dependency is gone. `npm audit`: 0.
- Every package ships readable (not minified) ES modules with source maps.
- The viewer loads other interface languages and the Excel, HTML and CSV exporters on demand: first load 847 KB
  gzipped (was 877 KB minified).
- React, Vue, Svelte, Angular wrappers: a failed import shows its error in the element (`onError`); options are
  compared by content, so an inline `definition` object does not remount the designer.
- Package metadata (repository, homepage, bugs, keywords, engines, `sideEffects`, typed `exports`), README badges,
  this changelog in every package, SECURITY.md, a semver policy, and a GitHub workflow that publishes with npm
  provenance.

## 0.7.3
- Firefox and WebKit smoke tests in CI; settings table entries for monitoring. No API change.

## 0.7.2, 0.7.1
- Fixes to the package builds and README quick starts.

## 0.7.0
- First public release under the `@pagewrightjs` scope: engine, fonts, cli, viewer, react, vue, svelte, angular.
