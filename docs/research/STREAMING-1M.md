# 1 million rows: streaming exports, a 300 MB RSS cap, and every core used

Status: phases 0–4 built (0.10.0, 8 Oct 2026): the memory harness (scripts/mem-stream.mjs), streamed responses with
back-pressure (src/server/stream-out.js), row-by-row sources (JSON, CSV, SQLite, PostgreSQL, MySQL; src/engine/data/stream.js,
src/server/sql.js runSqlRows), the spill sort (src/exporters/spill.js), the streaming data CSV and Excel writers
(src/engine/stream.js, src/exporters/csv.js writeCsvStream, src/exporters/xlsxstream.js), and §8's pool fixes (cores-sized,
admission by memory estimate, small heaps; sharing fonts and HarfBuzz was measured and saved nothing, so it is not in).
Measured: CSV 160 → 168 MB RSS from 100k to 300k rows (sorted: 179 → 191), grouped Excel 185 → 197 MB, for the whole
render process with a 192 MB heap; 1M projects at ~185–240 MB. PDF streaming (phase 5) and viewer paging (phase 6) are not
built. The rest of this doc is the design as written before the build.
Written 2026-10-08 against `main` @ 803f598 (Node 22.14, an 8-core / 8 GB laptop).

How the numbers were taken: the machine already had a load average of 3–6 from another agent, so treat
timings as ±20%. Every run used one process at a time, at 10k, 50k and 100k rows. The 1M figures are linear
projections from 100k, because every stage measured grows linearly. Nothing was run at 1M.
The measurement scripts live outside the repo (the session scratchpad: `m/measure.mjs`, `m/cpu.mjs`, `m/proto.mjs`).
They import `src/` directly and follow `scripts/mem-xlsx.mjs`. The report is a 6-column table
(id, name, city, qty, price, day), A4 paper, with a `Page N of M` footer, and the data is a JSON source.

Related: `docs/PDF-STREAMING-PLAN.md` (PDF streaming, not built, with the reasons why layout is the blocker).
This doc extends that plan to every format and to CPU use.

---

## 1. Summary

| Format | Today at 1M rows (projected) | Streaming design, peak RSS above process base | Feasible under 300 MB? |
|---|---|---|---|
| Data CSV (`dataOnly`) | ~1.9 GB peak, refused earlier by source caps | **+20–60 MB** (prototype measured flat at +16–21 MB with a capped heap) | **Yes** |
| XLSX | ~5.5 GB peak; also crashes on V8's string limit for wide sheets; no row-limit split | **+30–80 MB** (prototype: +24–32 MB) | **Yes** |
| PDF | ~3.4 GB peak, ~21k pages | +80–150 MB, for table-flow reports only | **Yes for table-flow reports. Everything else falls back to the model path, with an admission limit (~100k rows per GB)** |
| Viewer (browser) | the whole model is built in the browser: ~2.2 GB + structured-clone copy | server-side pages on demand: ~0 growth in the browser, server holds a page index (~2 MB) + spill file | **Yes, with server paging** |

The 300 MB budget, honestly: one warm render worker costs **~55–60 MB of RSS idle**: its own fonts, fontkit
and HarfBuzz (measured: 1 worker +81 MB, 2 +136 MB, 4 +253 MB over a 39 MB bare process). A bare Node process
with the engine loaded is ~100 MB. So "300 MB at all times" can mean either of two things:
- **a render's increment** (what the table gives). Streaming fits easily.
- **a whole server process**. Then it holds 1–2 streaming workers today, or 3–4 once fonts and the WASM module
  are shared between workers (Phase 1).

---

## 2. Today's pipeline

`renderTo()` (src/server/renderer.js:180-229) runs **inside the render worker** (src/server/render-worker.mjs:26-33).
Each stage holds everything the stage before it produced:

| # | Stage | Code | Holds in memory |
|---|---|---|---|
| 1 | fetch | `loadFetched` src/engine/data/index.js:229-270: `await res.text()` / `res.json()` | the whole body (capped: `PW_FETCH_MAX_MB` = 64 MB, safeFetch.js:17) |
| 1b | SQL | `runSql` src/server/sql.js:179-215; pg cursor `FETCH 500` but pushed into one `out` array (:510-518); mysql `execute` buffers the result (:567) | every row (capped: `PW_SQL_MAX_ROWS` = **100,000**, `PW_SQL_MAX_MB` = 64, sql.js:23) |
| 2 | parse | `JSON.parse` / `parseCsv(text)` (index.js:140-176, 207, 267) | raw text + parsed rows at the same time |
| 3 | data sets | `buildDataSets` index.js:394-480: typed rows, `applyFilters` (:520), `applySort` (:598, keys array + index sort) | all rows + sort keys |
| 4 | group | `groupRows` src/engine/items/pivot.js:15: first-seen buckets (Map) | all rows, re-bucketed |
| 5 | layout | `render()` src/engine/index.js:267-412: the whole body is laid out as one strip of units, then `paginate()` (:286) | every unit and its painted items |
| 6 | model | pages[] + `regions` (with `exportData`/`dataOnly`) index.js:459-484 | **~2.2 KB/row** (pages), +1.2 KB/row (regions) |
| 7 | export | pdf.js:49-389, xlsx.js:155-249 + xlsxwriter.js, csv.js:24-58 | the model **plus** the output |
| 8 | reply | worker transfers `bytes` (render-worker.mjs:21,31); route answers `new Response(r.bytes)` (app/api/v1/render/route.js:39) | the whole file, once (moved, not copied) |

The data CSV (`dataOnly`, renderer.js:203-216 → index.js:283/293/459) skips text layout and pages, but it still
builds `regions` (one object per cell) for every table. Then `exportCsv` builds an `out[]` array of lines and
`join`s it into one string (csv.js:45-49).

### Measurements (RSS above the process's start ≈ 100 MB; "live" = heap after a full GC)

| format | rows | JSON text | render peak | live after render | export peak | out | render ms | export ms | pages |
|---|---|---|---|---|---|---|---|---|---|
| csv data | 10k | 0.9 MB | +36 | 26 | +37 | 0.4 MB | 77 | 18 | 0 |
| csv data | 50k | 4.4 | +95 | 63 | +100 | 2.2 | 268 | 88 | 0 |
| csv data | 100k | 8.8 | +177 | 109 | +189 | 4.4 | 434 | 141 | 0 |
| csv layout | 100k | 8.8 | +458 | 347 | +458 | 4.4 | 1176 | 168 | 2084 |
| xlsx | 10k | 0.9 | +71 | 50 | +81 | 0.3 | 153 | 119 | 209 |
| xlsx | 50k | 4.4 | +263 | 182 | +332 | 1.5 | 585 | 537 | 1042 |
| xlsx | 100k | 8.8 | +417 | 347 | **+555** | 3.1 | 1264 | 1152 | 2084 |
| pdf | 10k | 0.9 | +56 | 38 | +62 | 0.3 | 136 | 160 | 209 |
| pdf | 50k | 4.4 | +173 | 123 | +173 | 1.5 | 690 | 492 | 1042 |
| pdf | 100k | 8.8 | +337 | 228 | +337 | 2.9 | 1066 | 899 | 2084 |
| xlsx grouped (3 groups, SUBTOTAL) | 50k | | +259 | 182 | +339 | 1.5 | 660 | 663 | 1042 |
| pdf grouped | 50k | | +205 | 123 | +205 | 1.4 | 589 | 432 | 1042 |

Per-row costs derived from the 100k runs (they match the known figures):
- source rows: ~0.15 KB/row live (parsed JSON), plus ~0.09 KB/row of JSON text while parsing.
- page model: **2.2 KB/row** live (pdf, 228 MB / 100k, source included).
- `exportData` regions: **+1.2 KB/row** (xlsx 347 MB live vs pdf 228 MB).
- data CSV model (rows + regions, no pages): **~0.85 KB/row** live.
- XLSX export: **+1.4 KB/row** peak on top of the model. The sheet's XML is **304 chars/row** (6 columns, ~50 per
  cell) and is held as row strings, then as one joined string, then as UTF-8 bytes.
- PDF export: +~0.3 KB/row RSS. Native memory stays bounded at ~80 MB, because only 4 zlib jobs run at a time (pdf.js:747-753).

**1M projection** (×10, linear), with the default limits lifted:

| format | peak RSS above base | time (this laptop) | also breaks because |
|---|---|---|---|
| csv data | ~1.9 GB | ~6 s | JSON body 88 MB > 64 MB fetch cap; SQL is refused at 100k rows |
| csv layout | ~4.6 GB | ~13 s | as above |
| xlsx | ~5.5 GB | ~24 s | sheet XML ≈ 290 M chars for 6 columns. At ≥ ~11 columns it passes V8's maximum string length (2^29−24 ≈ 512 M chars) in `toXml` (xlsxwriter.js:51) → `RangeError: Invalid string length`. Past 1,048,576 rows the file is invalid (no check anywhere in src/exporters) |
| pdf | ~3.4 GB | ~20 s, ~21k pages | |

A render worker's heap is limited to 1024 MB (pool.js:86; `PW_RENDER_WORKER_HEAP_MB`), and after an OOM it grows to at most 2048 MB.
So today **every 1M-row server render ends in a worker OOM** ("The render ran out of memory"). The process
survives, and the pool is designed to fail this way. The practical ceilings with a 1 GB heap are about 250k rows for
PDF, ~170k for XLSX and ~500k for the data CSV, and the source caps (100k SQL rows, 64 MB of fetched data) stop most
renders before that.

(Not a leak: in a quick check the CSV runs seemed to keep the model after export. That was the synchronous frame still
holding it. After one event-loop tick the heap returns to 15 MB.)

---

## 3. Bottlenecks, ranked

1. **Layout builds the whole report before anything is written** (index.js:267-412; PDF-STREAMING-PLAN.md
   "Engine memory and streaming layout"). The 2.2 KB/row model is most of every format's peak. Streaming any
   exporter alone saves at most its own share (xlsx +1.4 KB/row, pdf +0.3 KB/row).
2. **The data path is all in memory**: whole-body fetch, `JSON.parse`, the whole SQL result, sort by key array,
   first-seen grouping (pivot.js:15). The source caps (100k rows / 64 MB) exist because of this.
3. **The XLSX writer holds the sheet three times**: row strings (xlsxwriter.js:35), the joined XML (:51) and
   `strToU8` (:96). Then `zipSync` (:123) makes the whole zip. That is the V8 string-length crash, plus there is no sheet split.
4. **The output is buffered whole** from the worker to the response (render-worker.mjs:28-31, route.js:39): no
   time to first byte, and output memory is O(file).
5. **Per-worker fixed cost of ~55–60 MB** (fonts + HarfBuzz WASM loaded per worker). This decides how many workers fit in 300 MB.
6. **Pool sizing is memory-bound, not core-bound**, because it reserves 1024 + 96 MB per worker (pool.js:83-89). See §8.

---

## 4. CSV

### Correctness (csv.js)
- Quoting: a field containing `"`, `,`, `\n` or `\r` is quoted and `"` is doubled (csv.js:5). This is correct per RFC 4180.
- Separator: always `,`. There is no `;` option, which Excel needs in de-DE and fr-FR locales. Lines end in CRLF and
  there is no trailing newline.
- BOM: `﻿` on the data and layout outputs (:49, :56). **It is missing from the no-tables fallback (:29)**, so
  Excel reads that text as ANSI. This is a small fix.
- Formula injection: text starting with `= + - @ \t \r` gets a leading `'` (csv.js:7) on cells and header names.
  Numbers are written as numbers, so `-5` is not touched. This covers the OWASP list. Two gaps: (a) the full-width
  `＝`, which some spreadsheets also treat as a formula; (b) the `'` changes legitimate data such as `+91 98…`, which is
  the usual trade-off and should be documented.
- Values: numbers are rounded to the decimals their format shows (`shown`, :14). Dates are ISO in the report's time
  zone. Booleans are `true`/`false`.
- The output was checked with `=HYPERLINK("x")` → `"'=HYPERLINK(""x"")"`, and with an embedded `,"\n`, which was quoted correctly.

### Is it one big string? Yes.
`out.push(line)` collects every line, then `'﻿' + out.join('\r\n')`, then `Buffer.from` in renderer.js:224.
That is about 3× the file size at the peak, on top of the regions model (0.85 KB/row). The CSV text itself is small
(4.4 MB per 100k rows), so the model is the cost, not the string.

### Can a 1M-row data CSV stream with constant memory? Yes, for most reports.
The prototype (`m/proto.mjs`) builds rows lazily, formats each line, buffers 64 KB and writes to a stream with
`drain` back-pressure. With a 48 MB old-space cap it measured +16 MB at 100k and +21 MB at 300k
(13.6 MB of output). Without a heap cap it measured +23 → +41 MB, which is only V8 growing its heap lazily, not a
growing live set. 1M rows take ~0.9 s of formatting.

What blocks it, and the way around each blocker:

| Blocker | Today | Streaming answer |
|---|---|---|
| Whole source parsed first | `res.json()`, `parseCsv(text)` | row iterators (§7) |
| Data-set filters | row filters run in one `rows.filter` pass (index.js:530) | row filters stream as is. Set filters (TopN/BottomN/Top%) need every row, so they keep a bounded heap of N for TopN. Top% needs the count first (two passes, or a spill) |
| Data-set sort | key array + index sort (index.js:598-617) | **external merge sort**: runs of 64k rows sorted in memory, spilled with `v8.serialize` to a temp dir, k-way merge. Live memory is one run (≈15–40 MB) + k read buffers |
| Grouping (sets the detail row order even in the data CSV) | first-seen buckets (pivot.js:15) | `groupAdjacent` (already supported) streams as is. Otherwise give each row its group's first-seen ordinal (the Map holds one entry per distinct key, not per row), then run a stable external sort on (ordinal per level…, source index). A source already sorted by the group keys skips the sort |
| Aggregates in headers (`Sum` in a group header, `Count` in the table header) | the group's rows are in memory | not needed by the data CSV, which skips headers and totals. It matters for layout CSV, XLSX and PDF: §5/§6 |
| Picking "the main table" = most detail rows (csv.js:39-41) | needs every table's rows | decide from the plan instead: the table bound to the largest data set (one counting pass, or the only table). Reports where the choice is ambiguous fall back |
| Expressions that look at other rows (`Lookup`, `Previous`, `RunningValue`, `RowNumber`) | rows in memory | `Previous`/`RunningValue`/`RowNumber` stream (running state). `Lookup` into *another* data set needs that data set in memory or indexed. It is allowed only when that set is small (≤ 50k rows), otherwise the report falls back |

Eligibility check (`planStream(def)`): streaming is used when every data set feeding the main table is a
streaming source and no blocker is left. Otherwise the render takes today's path, behind the admission limit in §9.

---

## 5. XLSX

### Correctness today (xlsx.js, xlsxwriter.js)
- **Strings are inline strings** (`t="inlineStr"`, xlsxwriter.js:76), with no shared-strings table. This is already
  the right choice for streaming. Excel, LibreOffice and Numbers all read inline strings. The file is somewhat bigger
  before compression and about the same after deflate.
- Text is escaped (`esc`, xlsxchart.js:17). `=HYPERLINK(...)` data stays text inside an inlineStr, so there is no formula injection.
- Styles: a `cellXfs` per distinct (numFmt, bold, fill), with custom numFmt ids from 164 (xlsxwriter.js:59-66).
  **Small bug:** the map is seeded with `'||'` → 0 (:55), but the keys look like `'0|0|0'`. So a plain cell
  always gets a second, identical xf (`s="2"` on every detail cell, see the dump). The file is still valid, but
  every cell carries ~6 extra bytes. Fix: seed with `'0|0|0'`.
- SUBTOTAL: group and table footers become `SUBTOTAL(9|2|3|1|5|4, range)` when the shown value equals that
  aggregate within the format's precision (xlsx.js:103-148). A cached `<v>` is written and `fullCalcOnLoad` is set
  (:247). Verified output: `SUBTOTAL(9,D3:D6)` with `<v>12</v>`. Grand totals over more than 30 runs collapse to one range,
  and SUBTOTAL skips nested subtotals (:136-145). This is correct.
- Outline levels, frozen header and merges are fine. **There is no 1,048,576-row check**: row 1,048,577 is written and
  Excel reports the file as corrupt. There is no 16,384-column check either.
- The zip is `zipSync(level 6)`, made in one go (xlsxwriter.js:123).

### Streaming writer design (no new dependency: fflate 0.8.3 already has `Zip` + `ZipDeflate`)
- `new Zip(ondata)`, with each part as `new ZipDeflate(name, { level: 6 })`. `ondata` chunks go to the output sink, and
  their promise gives the back-pressure (the prototype awaits the sink between 64 KB pushes). Entries use data
  descriptors (general-purpose flag bit 3), so sizes and CRCs are not needed up front. Excel accepts this (the
  prototype's file passes `zipfile.testzip`).
- Order of parts: a part's position in the zip does not matter. So **the sheets go first, streamed row by row**,
  and `styles.xml`, `workbook.xml`, rels, `[Content_Types].xml` and drawings go **last**, once the style map, the
  sheet list (after splits) and the images are known.
- Sheet XML per row: `<row r=…>…</row>` built as today by `Book.cell()`, appended to a 64 KB string buffer, then
  `push(strToU8(buf))`. Header-dependent parts (`<sheetViews>` frozen pane, `<cols>` widths, `<sheetFormatPr outlineLevelRow>`) come
  **before** `<sheetData>`, so they must be known up front: widths come from the column definitions (they do today),
  the frozen rows from the header row count, and the outline depth from the group count in the definition (not
  from the data). `<mergeCells>` comes **after** `<sheetData>`, so merges are collected while streaming. They are
  per header or group row, so the list stays small. A per-row `colSpan` on detail rows is capped at 100k merges per sheet, with a warning.
- **SUBTOTAL while streaming**: keep for each open group level the sheet row where its details start, and for each
  footer column a running (sum, count, countA, min, max) from the detail values in that range. When the footer row
  comes, the function is chosen exactly as `totalFormula` does, but from the accumulators. This is O(columns × levels) state, not
  O(rows). The ">30 runs collapse to one range" rule becomes: emit `first:last` of the group's detail span (SUBTOTAL
  skips nested subtotals, so this is always valid when the group's non-detail rows are subtotals or blank, which can
  be tracked by flags).
- **Group headers with aggregates** (`=Sum(Fields.x)` shown in the *header*) need the group's values before its rows.
  There are two ways to get them. One is a pre-aggregation pass (one streaming pass over the sorted spill that computes per-group
  aggregates, keyed by group ordinal; the state is O(groups)). The other is to buffer one group at a time (bounded by the largest group, so it is
  refused when that group is above, e.g., 200k rows). Prefer the pre-pass when the data is spilled anyway.
- **Past 1,048,576 rows**: split into sheets `T`, `T (2)`, … Each continuation sheet repeats the header rows and the
  frozen pane. A group that crosses the split continues on the next sheet. Its SUBTOTAL range then
  cannot cross sheets, so when the group spans two sheets the footer's SUBTOTAL becomes `SUBTOTAL(9,'T'!D…:D1048576)+SUBTOTAL(9,'T (2)'!D2:D…)`,
  or simpler, the value is written as a number with a comment. The first is exact and cheap. Grand totals use the same sum
  of per-sheet SUBTOTALs. Sheet names go through the existing `sheetName()` (xlsx.js:177).
- **Zip64**: fflate's streaming `Zip` does not write Zip64. An uncompressed sheet part must stay under 4 GiB,
  which is about 14M rows at 6 columns or ~1.7M rows at 50 columns. A split every 1,048,576 rows keeps each part under that up to
  ~80 columns. Refuse wider sheets, or split at fewer rows.
- Charts and pictures: these are small parts and are written at the end as today (`addCharts` post-processes the zip, so it has to
  move to "add parts before `zip.end()`").

### RSS estimate (1M rows × 6 columns, streaming)
| | MB |
|---|---|
| row source batch (5k rows) + evaluated cells | 2–5 |
| 64 KB XML buffer + its UTF-8 copy | <1 |
| deflate state (one entry at a time) + fflate output chunks in flight | ~1 |
| style map, merges, SUBTOTAL accumulators, group ordinals | <5 |
| external sort, when needed (one 64k-row run) | 15–40 |
| V8 young-generation churn / old-space slack | 20–40 |
| **total above the worker's base** | **~30–80** |

Prototype (no engine, same writer shape): +24 MB at 100k and +32 MB at 300k with a 48 MB heap cap. That projects to 1M
at ~1.8 s × 3.3 ≈ **6 s and a ~28 MB file**.

---

## 6. PDF at 1M rows (~21k pages here; ~26k with larger rows)

### What exists
`exportPdf` already writes its own content-stream operators (the `Content` class, pdf.js:640-735) and compresses
each page as it goes (pdf.js:352-356, 4 zlib jobs in flight). pdf-lib 1.17.1 is used for the document object graph,
font embedding (`embedFont` with fontkit, `addGlyphs` for W/ToUnicode), images, annotations, outline, AcroForm,
PDF/A metadata and encryption, and **`doc.save()` serialises everything into one buffer** (pdf.js:386-389). pdf-lib has no
incremental or streaming writer: `PDFWriter` sizes the whole file, then copies into one `Uint8Array`. It *can*
serialise a single object (`PDFObject.sizeInBytes()` / `copyBytesInto()`), which a streaming writer can reuse.

So we need **our own streaming file writer**, but not our own content writer, which we already have.

### Design: two passes, constant memory in pages
1. **Pass 1, measure** (layout without painting): stream rows (already in order: sorted or grouped through the spill
   in §4), compute each row's height and the page breaks, group headers/footers, keep-together, repeated headers,
   and the per-group aggregates (for header aggregates). Output, all small:
   - the page count M (and per-section counts for `Globals.TotalPages`, index.js:330),
   - a **checkpoint per page**: the row index where it starts plus the running state (open groups, running values,
     `RowNumber`, page-header state). That is ~100 bytes × 21k pages ≈ 2 MB,
   - TOC entries with their pages, bookmarks (one per group: capped, e.g. 100k entries),
   - the characters used per font key (`Set<codepoint>`, small).
   The text measuring already exists (`measure.js`); what is missing is a **paged layout** that keeps table state
   between steps instead of one strip (PDF-STREAMING-PLAN.md, "Real streaming needs layout itself to run in
   page-sized steps").
2. **Pass 2, paint and write**: re-read the rows from the spill (or re-run the cursor if the source is
   repeatable), and for each page: paint its items (≈48 rows × 2.2 KB ≈ 100 KB), write its content stream with the
   existing `Content` → deflate, then write `n 0 obj` for the page dict and the stream, record the offsets, and **drop the page**.
   Keep only: the xref offsets (8 bytes × ~2 objects per page → <1 MB), the page refs for the page tree, links
   *of this page* (annotations are written with the page), and the glyph usage per font.
3. **Fonts last, subset at the end**: today the font is subset *before* the pages are encoded because the glyph IDs
   change. Use HarfBuzz's `HB_SUBSET_FLAGS_RETAIN_GIDS`, which is already used when there are shaped glyphs
   (subset.js:42-45). The GIDs then stay the original font's, so pages can be encoded with the full font's GIDs before the
   subset exists. Reserve the font refs (`/F1` …) up front (the keys are known from the definition and the character
   scan in pass 1), and write the subset font, `W` and `ToUnicode` at the end, built with pdf-lib's embedder objects
   serialised one at a time. The cost is a slightly larger `loca`/`hmtx` with retained GIDs (KBs).
4. **"Page X of Y"**: pass 1 gives M exactly, so the text is final in pass 2, with right alignment and no placeholder. For
   single-pass sources (a non-repeatable stream that is too big to spill), use **forward references**: draw
   "of Y" as a shared Form XObject `/TotalPages Do`, whose stream (the glyphs of the number, right-aligned in a
   box sized for `ceil(log10(estimated M))+1` digits) is written at the end. Jasper does the same with an
   evaluation time of "Report", which keeps those elements open. Grand totals and summary bands come at the end anyway. Totals in a
   **report header** need pass 1 (or the same XObject trick per value).
5. **Page tree, outline, AcroForm, Info, xref and trailer** at the end. Use a classic xref table, or an xref stream
   without object streams (object streams would need buffering; they can be added later in fixed batches of 100 objects).

### Scope and fallbacks
- Streaming PDF covers **table-flow reports**: page header/footer bands plus a body with tables, lists, text and
  images that flow down. Matrices with dynamic column groups, charts over all the rows, pivot, TOC with dotted leaders and
  subreports per row use the model path. They keep the current ceiling (~250k rows per 1 GB heap) and admission control.
- Signing (`opt.prepare`/`sign`): the signer needs the final bytes. Stream to a temp file, sign by byte ranges, then
  stream the file out. That needs no memory, only disk.
- Encryption: per-object AES as objects are written (key per object: object number + generation). This needs a streaming
  path in encrypt.js. Until then, encrypted PDFs fall back.
- PDF/A, PDF/UA: metadata, OutputIntent and file ID are written at the end. The UA structure tree (pdfua.js tagger)
  is O(items), so tagged PDFs fall back at first, then use a spilled structure tree later.

### RSS estimate (streaming, 1M rows)
| | MB |
|---|---|
| fonts loaded (full faces, per worker; already in the base) | (base) |
| one page: painted items + content string + deflate (4 in flight, ~260 KB zlib state each) | 2–5 |
| pass-1 checkpoints + xref + page refs + bookmarks (capped) | 5–15 |
| row batch from the spill + 64 KB output buffer | 2–5 |
| external sort or spill (only when sorting is needed) | 15–40 |
| V8 slack | 30–60 |
| **total above the worker's base** | **~60–130** |

Throughput: about the same CPU as today for pass 2 (≈ render + export ≈ 20 s at 1M on this laptop), and +30–40% for
pass 1 (layout without painting). The PDF is ~30 MB.

---

## 7. Input streaming

There is **no streaming JSON parser among the dependencies** (package.json: fflate, pdf-lib, fontkit, harfbuzzjs, …). Do not add one.
- **JSON, the array splitter (hand-rolled, ~150 lines)**: a byte scanner over the response's `ReadableStream`. It
  tracks depth and in-string/escape state, finds the array that the source's row path points to (`$`, `$.data`,
  `$.value[*]`: the common shapes; any other path falls back), and hands each element's bytes to the native
  `JSON.parse` in batches (for example, join 1,000 elements into `[…]` and parse once). Native parse speed stays, and memory is one
  batch. The response-size cap becomes a **per-element** cap (e.g. 1 MB) plus a row cap that only applies in streaming mode.
  OData (`loadOData`, index.js:286) already pages, so it can yield page by page.
- **CSV**: make `parseCsv` (index.js:140) incremental. Its state machine is per character already. It keeps quote
  state across chunk boundaries and yields rows. The header row and delimiter detection use the first chunk.
- **SQL**:
  - Postgres: the cursor loop already does `FETCH 500` (sql.js:510-518). It becomes an async iterator that yields each
    batch instead of `out.push`. `onWire` byte counting stays. The deadline stays per render, not per query.
  - MySQL: `c.execute()` buffers. Use `c.connection.query(text, values).stream({ highWaterMark: 500 })`
    (mysql2 text protocol with client-side escaping) or a server-side cursor. `sql_select_limit` (:564) moves to the
    streaming row cap.
  - MSSQL: `streamRows` (sql.js:831) already streams with `r.stream = true`; it should yield instead of collecting.
  - SQLite: it runs in a child process (sql/sqlite.js). Have the child `iterate()` (node:sqlite `StatementSync.iterate()`)
    and `process.send` batches of 1,000 rows, with an ack for back-pressure.
  - Oracle, Snowflake and BigQuery: result-set streams exist in their drivers (`queryStream`, `streamRows`,
    `createQueryStream`). Wire them later.
- **Caps**: keep `PW_SQL_MAX_ROWS`/`PW_FETCH_MAX_MB` for the model path. Add `PW_STREAM_MAX_ROWS` (default 5M) and
  a per-render temp-disk cap `PW_SPILL_MAX_MB` (default 2 GB) for streaming renders.
- **Data-set features**: computed fields (`calc`, index.js:447-470) are per row and stream. Row filters stream. Sorts, set
  filters and groups use the spill and external sort in §4. Relations (`relation.parent`, nested data sets) need the
  child set indexed by its key. That is allowed when the child is small, otherwise the render falls back.
- **Spill format**: `v8.serialize` of 1–5k-row batches into `os.tmpdir()/pw-<render id>/` (Dates and numbers survive,
  and it is fast). It is deleted in `finally` and on worker exit. A run of 64k rows is sorted in memory with the same comparator
  (`sortCompare`, collation-aware), then a k-way merge uses a small binary heap.

---

## 8. CPU and concurrency

### What the code does
- **Pool size** (pool.js:83-90, 100-106): `workers = min(8, cores − 1, byMem)` with `byMem = floor((mem × 0.7 − 512) / (heap + 96))`
  and heap = 1024 MB by default. Cores = `PW_CPUS` or `min(os.availableParallelism(), cgroupCpus())`; the cgroup quota
  is read from v2 `cpu.max` or v1 `cfs_quota/period`, rounded up (:66-72). This is correct. **But memory decides first**:

  | box | workers | cores idle at full load |
  |---|---|---|
  | 2 cores / 2 GB | 1 | 1 (the request thread's core) |
  | 4 cores / 4 GB | **2** | ~1–2 |
  | 8 cores / 8 GB | **4** | ~2–3 |
  | 16 cores / 16 GB | 8 | ~4–7 |

  On the usual 1 GB-per-core boxes, half the cores sit idle under render load because each worker reserves a 1 GB
  heap it rarely needs (most renders are far below 100 MB). After any OOM, `grownMB` doubles the heap (:229) and the pool
  shrinks further for 30 minutes.
  Docs drift: docs/SERVER-LOAD.md:7 says the default heap is 2048. The code (pool.js:86) uses 1024, growing to 2048.
- **Where the work runs**: everything for a render (template read, perms, fetch, SQL drivers, parse, layout, export,
  deflate) runs inside the worker (`renderTo` in render-worker.mjs:30). SQLite queries run in a separate child process. The
  request thread only authorises, queues and answers with transferred bytes (route.js:39). Thumbnails and batch "pack"
  jobs also go to the pool. **Exceptions**: `PW_RENDER_WORKERS=0` (Vercel) and `giveUp()` (pool.js:191) render on the
  request thread (`runInline`, :311).
- **libuv thread pool**: PDF page deflate (level 9) and `fs` share libuv's **process-wide** pool (default 4
  threads, pdf.js:747-756 `zslots.free = 4` per worker). With 4–8 workers, every PDF's compression queues on the same 4
  threads. Set `UV_THREADPOOL_SIZE = cores` at startup (cluster.mjs / the Dockerfile `ENV`). It must be set before the
  first libuv use, so set it in the env, not in code.
- **`@pagewrightjs/engine/pool`** (packages/engine/pool/index.js): `cores − 1` workers, **no `resourceLimits`**
  (one big render can take the whole process down), no timeout, and `bytes.slice()` copies when the buffer isn't owned
  (worker.js:21). Fine for a library, but it should accept `{ heapMB, timeoutMs }`.
- **cluster.mjs**: processes = max(2, cores/4). Each gets `PW_CPUS = floor(cores/n)` and an equal share of memory, and
  each process's pool then takes `cpus − 1` workers. With 8 cores: 2 processes × 3 workers + 2 request threads = 8. That is reasonable.

### Measured (2 workers, 10k-row PDF renders, `process.cpuUsage()` over wall time; `ps %cpu` samples)

| run | wall | CPU time | avg cores | ps samples |
|---|---|---|---|---|
| 2 jobs sequential, 1 worker | 422 ms | 906 ms | 2.15 | 142%, 174% |
| 2 jobs, 2 workers | 309 ms | 1258 ms | 4.07 | 314% |
| 8 jobs, 1 worker | 1455 ms | 2751 ms | **1.89** | 158–238% |
| 8 jobs, 2 workers | 930 ms | 3667 ms | **3.94** | 328–416% |
| 8 jobs, 1 worker, `--single-threaded-gc` | 1597 ms | 2570 ms | 1.61 | |
| 8 jobs, 2 workers, `--single-threaded-gc` | 993 ms | 3411 ms | 3.43 | |
| xlsx: 2 jobs, 1 → 2 workers | 507 → 312 ms | 864 → 1096 ms | 1.71 → 3.51 | |

Findings:
- **The workers really run in parallel.** Two workers give a 1.56× throughput gain on PDFs and 1.6× on XLSX. The
  machine had a background load of 3–6, so the clean number is likely ~1.8×.
- **One render uses ~1.9 cores, not 1**: ~0.3 is V8's parallel or concurrent GC, and ~0.3 is zlib on the libuv pool.
  So "N workers on N cores" already oversubscribes. `cores − 1` workers is about right for PDFs, and pure CSV/XLSX
  (fflate deflates in JS on the worker thread) can use `cores`.
- CPU time per job rises ~33% with 2 in parallel (2751 → 3667 ms). That is shared-cache, memory-bandwidth and GC-helper
  contention plus the background load. Expect sub-linear scaling, not N×.

### Fixes
1. **Size the pool by cores and admit by memory.** Default `workers = cores − 1` (cap 16, not 8). Replace the
   1 GB-per-worker reservation with a per-render **memory estimate** (rows × KB/row per format from §2, or
   ~100 MB for a streaming render) checked at admission against the remaining budget (the RSS-based `memoryFull()` hold
   stays as a backstop). The heap limit then stops a render that is wrong, without reserving memory for every worker.
2. **Two heap classes**: streaming renders run in workers with `resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 16 }`.
   Model-path renders use today's 1–2 GB heap, at most 1–2 of them at a time (a "big" semaphore).
3. **Share fixed costs between workers**: compile the HarfBuzz WASM once (`WebAssembly.Module` can be posted to
   workers) and pass the font bytes as `SharedArrayBuffer`s. This saves part of the ~55 MB per worker. Measure it; fontkit's parsed tables stay per worker.
4. **`UV_THREADPOOL_SIZE = cores`**. Measure PDF deflate at level 6 against level 9: with 4 jobs in flight per worker, level 9 is
   a large part of that 0.3 core.
5. **Splitting one big render** (after Phase 5):
   - CSV: once the data is in order (spill), row ranges can be formatted in K workers and concatenated. CSV is
     ~0.9 s for 1M rows, so this is not worth the complexity.
   - PDF: pass 1 yields page checkpoints, so **page ranges [a, b) can be painted and compressed in K workers in parallel**,
     each with an object-number range assigned up front, writing its own segment. The coordinator concatenates the
     segments, fixes the xref offsets and writes fonts last (glyph sets are a union of the workers' sets). This is the one split worth doing:
     pass 2 is ~80% of PDF time.
   - XLSX: one sheet is one deflate stream. Splitting needs sync-flushed deflate chunks plus a CRC-32 combine (pigz-style).
     Alternatively, sheets split at 1,048,576 rows can be produced by different workers. This is low priority.
   - Font subsetting: it is per font, ~ms, so there is nothing to gain.
6. Vercel and other inline modes: a streaming render on the request thread blocks the event loop. Keep `dataOnly` CSV
   streaming allowed there, yield every batch (`await setImmediate`), and refuse PDF/XLSX streams above a row threshold.

---

## 9. The 300 MB cap

| Format | Realistic? | Notes |
|---|---|---|
| (a) data CSV | **Yes**: +20–60 MB per render, file size not a factor | Unsorted or adjacent-grouped data is constant. Sorting or non-adjacent grouping adds a 64k-row run (≤40 MB) plus disk |
| (b) XLSX | **Yes**: +30–80 MB | needs the streaming row generator from the engine (Phase 4), not the paginated model |
| (c) PDF | **Yes for table-flow reports** (+60–130 MB). **No for the model path** (2.2 KB/row: ~100k rows fit in a ~300 MB increment) | complex layouts keep a stated limit of ~100k rows in 300 MB, ~400k per 1 GB worker |
| (d) viewer | **Yes, with server paging** | today the browser holds the whole model in its worker *and* a structured-clone copy on the main thread (src/worker/engine.worker.js:20-24 → postMessage). The DOM is virtualised (ReportViewer.jsx:31), but memory isn't |

Viewer design: for reports above a row threshold, the viewer asks the server for `pages?from=&to=`. The server runs
pass 1 once per (report, parameters, principal), keeps the page checkpoints and spill for N minutes (on disk,
LRU-evicted, `PW_SPILL_MAX_MB`), and paints the requested pages from their checkpoints (pass 2 for a range). The
viewer's virtual list needs only M and page sizes. Search becomes a server call. Exports reuse the same spill.

Enforcement:
- **Per-worker heap limits** (`resourceLimits`) per class, as in §8 fix 2. A breach kills only that render (this already works, pool.js:220-238).
- **Back-pressure from end to end**: the HTTP response `ReadableStream` (`pull`) gives the worker credit over a
  `MessagePort` (≤ 4 × 64 KB chunks in flight, transferred, not copied). The worker awaits credit before
  producing more, and the source iterator awaits the worker. A client that is slow beyond `PW_STREAM_STALL_MS` makes the worker
  spill the rest of its output to a temp file, then free itself. The request thread streams the file, so a slow
  client cannot hold a render worker.
- **Errors after the headers**: after the 200 is sent, a failure can only abort the stream. Write the CSV/XLSX
  to the spill first when the render is "small" (time to first byte doesn't matter), and for streams add a
  trailing error marker for CSV (a last line `#ERROR …`) and an aborted connection for zip and PDF (clients see a truncated
  file). Document `Content-Length` as absent.
- **Admission**: estimate memory before starting (format × rows × KB/row, with rows from `COUNT(*)` for SQL, or `Content-Length`
  for fetch, or unknown → assume the streaming class). Queue (do not start) when the estimate exceeds the free budget, and
  refuse (413 with a message suggesting CSV, XLSX or a filter) when the model path alone exceeds the worker heap.

---

## 10. Other engines

| Product | How it handles million-row exports | Limits and guidance |
|---|---|---|
| JasperReports | fills a `JasperPrint` page list. **Virtualizers** (`JRFileVirtualizer`, `JRSwapFileVirtualizer`: one shared, growing swap file; `JRGzipVirtualizer`: compressed in memory) page filled pages out to disk and back. Exporters then walk the pages. "Report" evaluation time keeps elements open until the end (Page X of Y) | memory is bounded by the virtualizer's max pages in RAM, but the swap file grows with the report. Slower ("the difference between getting a report or an out-of-memory error") |
| BIRT | the data engine has a result-set memory buffer (`ResultBufferSize`, MB) and spills to a DiskCache. Emitters stream, but users report large heaps anyway. The community Excel emitter (Spudsoft) offers SXSSF (streaming XLSX) | known DiskCache slowness on huge sets; large exports often need a big heap |
| Stimulsoft | `ReportCacheMode` (On/Auto) caches rendered pages to the file system during rendering | no published row limit; guidance is to turn on caching for big reports |
| ActiveReports | `Document.CacheToDisk` (+ `CacheToDiskLocation`) caches pages to disk | **only the PDF export benefits**; other exports "may run out of memory with very large reports" |
| SSRS / Power BI Report Server | renders the whole report through the rendering extension in memory. XLSX (EXCELOPENXML) is limited to 1,048,576 rows per sheet: past it the export **fails** ("number of rows exceeds the maximum possible rows per sheet"); it does not split | big exports hit memory or timeouts; Microsoft's advice is to page with groups, page breaks or CSV |
| Power BI paginated (service) | same engine as SSRS. No fixed row cap for paginated exports; limited by capacity memory and a 60-minute export timeout | visual exports are capped (30k CSV / 150k xlsx); paginated reports are the documented way to export large data |

What this means for us: the incumbents mostly **spill pages to disk** (Jasper, Stimulsoft, ActiveReports) rather than
stream. This design streams *rows* and keeps pages short-lived, which is lighter. The checkpoint/spill design for the
viewer is the same idea as their page caches. Splitting XLSX at 1,048,576 rows would be ahead of SSRS, which fails there.

Sources: [Jasper virtualizer sample](https://jasperreports.sourceforge.net/sample.reference/virtualizer/README.html),
[JRSwapFileVirtualizer API](https://jasperreports.sourceforge.net/6.21.3/api/net/sf/jasperreports/engine/fill/JRSwapFileVirtualizer.html),
[PTC: memory-intensive Jasper reports](https://support.ptc.com/help/windchill/r13.0.0.0/en/Windchill_Help_Center/reportmgmt/ReportMgmtJasperVirtualizer.html),
[BIRT memory footprint (OpenText forum)](https://forums.opentext.com/forums/developer/discussion/49170/need-help-reducing-memory-footprint-of-reports),
[BIRT native Excel emitter performance](https://forums.opentext.com/forums/developer/discussion/51191/birt-native-excel-emitter-performance-issue),
[Stimulsoft cache mode (forum)](https://forum.stimulsoft.com/viewtopic.php?p=174639),
[ActiveReports: optimize section reports](https://developer.mescius.com/activereportsnet/docs/latest/online/optimize-section-reports.html),
[SSRS Excel row-limit error (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/1692450/excel-rendering-extension-number-of-rows-exceeds-t),
[Power BI paginated report limits (AlphaBOLD)](https://www.alphabold.com/limitations-in-power-bi-paginated-reports-and-their-workarounds/),
[PBRS export limits](https://go.christiansteven.com/knowledge/pbrs-for-power-bi/using-pbrs/what-are-the-limitations-when-exporting-power-bi-to-excel-or-csv-using-pbrs).
Third-party pages were used for the Power BI row figures; check them against Microsoft's own docs before quoting them to customers.

---

## 11. Phased plan

Effort is in engineer-days for one person who knows the codebase. Each phase ships behind an option
(`stream: true` / automatic when `planStream(def)` says yes) and leaves the model path as the default fallback.

| Phase | Work | Effort | Proof (tests and benchmarks) |
|---|---|---|---|
| **0. Harness** | `scripts/mem-stream.mjs`: one process per (format, rows); samples RSS every 10 ms, live heap after GC, ms; runs at 10k/100k/1M (1M only on CI or a big box) with a lazy row generator, no 1M JSON in memory. A "flat-line" assertion: peak(1M) − peak(100k) < 30 MB | 1–2 | the harness itself; baselines from §2 recorded |
| **1. Plumbing** | output sink abstraction (`write(u8)`, `end()`, credit-based back-pressure); a worker→request-thread `MessagePort` stream; `new Response(ReadableStream)` in `/api/v1/render` and the report routes; stall → spill to file; error-after-headers handling; `UV_THREADPOOL_SIZE`; shared WASM module + `SharedArrayBuffer` fonts | 4–5 | a stream test with a slow reader (worker paused at ≤ 4 chunks); a client abort cancels the render; per-worker idle RSS before/after sharing |
| **2. Sources** | row iterators: JSON array splitter, incremental CSV, pg cursor yield, mysql2 `.stream()`, mssql yield, sqlite child `iterate()` + batched ack; `PW_STREAM_MAX_ROWS`; spill + external merge sort; first-seen group ordinals | 6–8 | unit tests: split JSON across chunk boundaries (strings with `]`, escapes, unicode); CSV quotes across chunks; sort stability and collation equal to `applySort` on 10k random rows; real-DB tests for pg and mysql streams; a 1M-row sort with RSS < 150 MB |
| **3. Data CSV streaming** | `planStream` eligibility; detail cells evaluated per row (same `cell()`/`shown()`/`text()` as csv.js); BOM fix for the no-table path; optional `;` separator | 3–4 | byte-identical output to today's `exportCsv` on the regress corpus (scripts/regress-all.mjs) where eligible; **1M rows: peak RSS < 300 MB for the whole process (1 worker), < 80 MB above base** |
| **4. XLSX streaming** | engine **table-row generator** (header, groupHeader, detail, groupFooter and footer rows with evaluated cells, without paint); streaming `Book`/`Sheet` on fflate `Zip`; styles/workbook last; streaming SUBTOTAL; group-header aggregates via pre-pass; split at 1,048,576 rows with repeated headers and cross-sheet SUBTOTAL; Zip64 refusal; `'0|0|0'` style seed fix | 8–12 | cell-by-cell equality (values, styles, formulas, outline, merges) with today's writer on the regress corpus; open in LibreOffice headless (`soffice --convert-to csv`) to validate; a 1,048,577-row case makes 2 sheets; **1M × 6: peak RSS < 300 MB, ~10 s** |
| **5. PDF streaming** | paged layout with table state between pages (pass 1 measure + checkpoints, pass 2 paint); a streaming PDF writer (objects, offsets, xref, trailer) reusing `Content` and pdf-lib single-object serialisation; RETAIN_GIDS subsetting at the end; exact TotalPages via pass 1, XObject forward reference for one-pass sources; sign via temp file; encrypt/UA/forms fall back | 20–30 | `scripts/check-pdf-matches-model.mjs` (text positions identical to the model path at 10k); `qpdf --check`; veraPDF for PDF/A; **1M-row table report: peak RSS < 300 MB**; a stated fallback limit (~100k rows per 300 MB) enforced by admission |
| **6. Viewer paging** | server page API from checkpoints and spill; viewer virtual list over M pages with on-demand fetch; server-side search | 8–12 | 1M-row report in the browser: tab memory < 300 MB (Chrome task manager / `performance.measureUserAgentSpecificMemory`), first page < 2 s after pass 1 |
| **7. CPU and pool** | cores-based sizing + memory-estimate admission; heap classes; `engine/pool` `resourceLimits` + timeout; PDF page-range parallelism (after 5); deflate level 6 vs 9 measured | 4–6 (+5–8 for parallel PDF) | load test on an N-core box (not the laptop): N concurrent small renders → `process.cpuUsage()` ≈ N × 100% (±15%) for a sustained 60 s; one 1M-row PDF on K workers: wall time ≤ 1/(0.6 K) of a single worker |

The order follows the payoff: 0 → 1 → 2 → 3 gives a constant-memory 1M-row data CSV in ~15–19 days, and XLSX follows
in another ~10 days. PDF streaming is the big-ticket item (~1 month) and should start with the paged-layout spike from
PDF-STREAMING-PLAN.md.

Pass marks:
- **CSV**: 1M rows, peak RSS < 300 MB (process with one worker), flat between 100k and 1M within 30 MB.
- **XLSX**: as for CSV, plus a valid file at 1,048,577 rows (2 sheets) and the same SUBTOTAL values.
- **PDF**: 1M-row table-flow report under 300 MB. Every other layout declares the ~100k rows per 300 MB limit and is refused or queued above it.
- **CPU**: N cores busy at ≈ N × 100% under sustained load. Today a single render already uses ~1.9 cores, so the gate is
  on throughput per core, not on worker count.

## 12. Small fixes found along the way (independent of streaming)
- csv.js:29: the no-table fallback has no BOM.
- xlsxwriter.js:55: the style map is seeded with `'||'` instead of `'0|0|0'`, which adds a redundant xf on every plain cell.
- XLSX: no 1,048,576-row or 16,384-column guard. Refuse with a clear message until the split lands.
- xlsxwriter.js:51: build the sheet as chunks (`Uint8Array[]` per ~1 MB) instead of one `join`, so wide sheets do not hit V8's string limit.
  This is a 10-line change that removes the crash even before streaming.
- docs/SERVER-LOAD.md:7: it says the default worker heap is 2048, but the code (pool.js:86) uses 1024.
- packages/engine/pool: add `resourceLimits` and a timeout.
