# Deep PDF benchmark

Our two products, `@reportwright/engine` (reports) and `@reportwright/pdf` (writing, reading, editing), against the
best open-source PDF libraries in seven languages and the standard command-line tools, on the same jobs, data, fonts
and runner. It runs **only on GitHub Actions** (`.github/workflows/bench-deep.yml`); nothing here is meant to run on a
laptop.

```sh
gh workflow run bench-deep.yml -f tier=quick   -f langs=all -f runs=5
gh workflow run bench-deep.yml -f tier=full    -f langs=all -f runs=5
gh workflow run bench-deep.yml -f tier=million -f langs=all
gh workflow run bench-deep.yml -f tier=quick   -f langs=ours,js        # a subset
```

The run's summary page shows `results.md`; the `bench-deep-results` artifact holds `results.json`, `results.md`,
`results.html` (open it in a browser: sortable tables, time and memory charts), every language's raw `*.jsonl` and
the runner's hardware.

## Contestants

Exact versions are pinned in each harness's manifest; the version each run actually loaded is recorded in the results.

| lang | contestant | pinned in | does |
|---|---|---|---|
| ours | `@reportwright/engine` 0.13.1 (+ `@reportwright/fonts`) | `ours/package.json` | create (JSON report definitions; `exportPdfStream` for reports) |
| ours | `@reportwright/pdf` 0.1.0-beta.5 (+ `harfbuzzjs` for Hindi/Arabic shaping) | `ours/package.json` | create, PDF/A, read, merge, split, AES-256, incremental save, forms, signing |
| js | pdf-lib 1.17.1, PDFKit 0.20.2, jsPDF 4.2.1, pdfmake 0.3.11, @react-pdf/renderer 4.9.0, pdf.js (pdfjs-dist) 6.4.299, Puppeteer 25.13.0 (Chrome) | `js/package.json` | |
| python | ReportLab 5.0.1, WeasyPrint 70.0, PyMuPDF 1.28.2, pikepdf 10.16.0, pypdf 6.20.0, pdfminer.six 20260107, pdfplumber 0.11.10 | `python/requirements.txt` | |
| java | Apache PDFBox 3.0.8, OpenPDF 2.2.2, iText 9.8.0 core (AGPL; private benchmarking), JasperReports 6.21.5 | `java/pom.xml`, `java/jasper/pom.xml` | |
| dotnet | QuestPDF 2026.9.1 (Community licence), PDFsharp 6.2.4, PdfPig 0.1.16 | `dotnet/Bench.csproj` | |
| go | go-pdf/fpdf 0.9.0, pdfcpu 0.15.0 | `go/go.mod` | |
| rust | printpdf 0.12.8, lopdf 0.45.0, pdf-extract 0.12.1 | `rust/Cargo.toml` | |
| cli | MuPDF `mutool`, `qpdf`, Poppler `pdftotext` (Ubuntu's packages), PDFium through pypdfium2 5.14.0 | apt, `cli/requirements.txt` | |

`contestants.json` says which jobs each one does and, for every other job, why it is "n/a" (the results show the
reason). No commercial libraries. Not included: **borb** (its v3 API could not be verified without installing it; add
it to `python/harness.py` when wanted), OpenPDF 3 (renamed packages; 2.2.2 is the last `com.lowagie` line),
JasperReports 7 (a new jrxml format; 6.21.5 reads the classic one).

## Jobs

Everything a job uses comes from the `fixtures` job (`fixtures/make.py`), made once and passed to every language as an
artifact: seeded data, fixed dates, the same bytes for everyone.

1. **plain** (10, 100; full: 1,000 pages): 60 pre-broken lines of 9 pt Inter a page, 12 pt apart. The lines are
   broken in advance so no library's line breaking is compared, only its text throughput.
2. **report** (100, 1k, 10k; full: 100k; million: 1M rows): the ledger of `bench/data.mjs` (7 columns, 4 region
   groups), the column header repeated on every page, a shaded group header, a "Region total" row (count and sum)
   after each group, a grand total and "Page N of M". Libraries with report features use them (ReportWright's groups
   and aggregates, JasperReports' groups and variables, QuestPDF's table header and page-number spans, pdfmake's
   `headerRows` and footer callback, @react-pdf's `fixed` views, CSS `<thead>` and `@page` counters for the browsers).
   Low-level writers get the groups computed once in plain code (the same code for each) and a page plan, then draw.
3. **invoice** and **invoice-warm**: one page, Inter Regular and Bold embedded, a PNG logo with alpha, a 12-line item
   table with a shaded header and totals. `invoice` is a new process (cold); `invoice-warm` makes it 50 times in one
   process and reports the median of the last 40.
4. **unicode**: Hindi (Noto Sans Devanagari), Arabic (Noto Sans Arabic, right to left) and Chinese (Noto Sans SC).
   The text is extracted again (Poppler and MuPDF) and must match. Shaping is what each library does by default:
   @reportwright/pdf (HarfBuzz), QuestPDF, the browsers and PDFKit/pdfmake (fontkit) shape; OpenPDF shapes Arabic.
   The extraction check does not judge glyph shapes.
5. **images**: a 6 MP RGBA PNG and a 24 MP JPEG, one a page, at the body width.
6. **pdfa**: the invoice as PDF/A-2b, for libraries with a PDF/A option, validated by veraPDF (the CLI image).
7. **read-big**: the text of a 1,200-page PDF; **read-mixed**: 11 files of different structure (uncompressed, Flate,
   object streams, linearized, AES-128 with an empty user password, rotated, two columns, an incremental update,
   broken xref offsets, QDF, kerned TJ arrays with hex strings). Scored as word recall against the known text
   (order-insensitive); 0.99 passes.
8. **edit**: merge 100 three-page files; split a 100-page file into pages; encrypt it with AES-256 (qpdf confirms
   the algorithm); change its title as an incremental update (the output must start with the input's bytes); fill a
   form (two text fields and a checkbox) and flatten it (no AcroForm fields left, the value in the page text); sign a
   file with a generated test certificate (`pdfsig` must say "Signature is Valid").
9. **robustness**: each reader parses 25 (full: 200) deterministically fuzzed PDFs and 6 hostile files (a 1 GiB
   decompression bomb, a page-tree cycle, 200,000 nested arrays, a 64 MB string, a self-referencing xref chain,
   absurd object and page counts), a new process each. Counted: ok, clean error, crash (signal, panic, uncaught
   exception, no result), hang (over 30 s), OOM.

## Metrics, for every cell

- **wall time** cold (process start to exit, measured by the driver) and in-process (the job alone: no runtime start,
  no imports, inputs already read); the median of the measured runs, with min and max;
- **CPU** user + system and **peak RSS**, from `wait4()`'s rusage (what `/usr/bin/time -v` reports) and, for
  multi-process contestants (Chrome), the process group's summed RSS sampled every 100 ms (the larger is kept);
- **time to first byte** of `out.pdf` (create jobs): shows which writers stream;
- **output size** and **page count** (`qpdf --show-npages`);
- **validity**: `qpdf --check`, MuPDF drawing the first and last page, pdf.js loading them and their text;
- **veraPDF** PDF/A-2b verdict (pdfa job);
- **text correctness** where it applies: "Page M of M", "Grand total" and the right grand total on the report's last
  page; invoice strings; the Unicode strings; read recall; form value; title; signature.

Runner CPU, core count, RAM, OS, tool versions and the date are recorded in each language's `meta` line.

## Fairness rules

- **The same inputs for everyone**: the same rows, text, images and font files (Inter, Noto), A4, 36 pt margins,
  9 pt text, the same coordinates for the absolutely placed jobs (`spec.json`). The browsers (Puppeteer, WeasyPrint)
  print the same HTML files, built once by the fixtures job.
- **Each library's documented defaults**, its documented API for the job (report features where it has them), its
  default compression, its default heap. Exceptions, stated: PyMuPDF saves with `deflate=True` (its own docs'
  recommendation; its default writes uncompressed streams).
- **"n/a" when a library cannot do a job**, with the reason; never a workaround through another library.
- **No winning with an invalid file**: a cell whose output fails a validity or correctness check is shown with ✗
  and is never ranked; timeouts, OOMs and crashes are results, not failures of the run.
- **The same runner type** (`ubuntu-latest`) for every language, one language a job, in parallel; numbers from
  different runs are not mixed.
- **Warm-up runs are discarded**: the first run of every cell is dropped. Exception: in `quick` the heavy cells
  (reports of 10k+ rows, the 1,200-page read) run once without a warm-up, and in `million` every cell runs once;
  those tiers are indicative, `full` is the reference.
- Setup that an application does once is outside the clock: JasperReports compiles its jrxml in setup (as an
  application loads a compiled `.jasper`); the browsers' HTML is prebuilt; Puppeteer's browser launch is in the
  first run's time but not in the warm runs.

## Tiers and limits

| tier | what runs | timeouts |
|---|---|---|
| quick | every job, small sizes, `min(runs, 3)` runs, 25 fuzzed files | 5 min a run, 40 min a language job |
| full | adds 100k rows, 1,000 pages, 200 fuzzed files, `runs` runs (3 for the heaviest cells) | 15 min a run, 150 min a job |
| million | only the 1,000,000-row report, only contestants that stream or might survive (`"million": true`) | 30 min a run, 330 min a job |

Every run has a memory cap (`MEM_CAP_MB`, default 6,000 MB, enforced on the process group's RSS by the driver; the
kernel's OOM killer is also counted as OOM).

## Layout

```
bench/deep/
  README.md            this file
  spec.json            the shared workload (page, fonts, layouts, strings, edit inputs)
  contestants.json     who does what, how to run it, why n/a
  drive.py             runs one language's cells, measures, validates; writes results/<lang>.jsonl
  merge.py             results.json, results.md, results.html
  fixtures/make.py     every input, deterministic
  tools/               pdf.js validity check
  common/              the Node frame and the shared create jobs (canvas-jobs.mjs)
  ours/ js/            Node harnesses
  python/ java/ dotnet/ go/ rust/ cli/   one harness a language
```

Every harness follows one contract: `<harness> <job> <size> <outdir>`, where `<harness>` is the contestant's `cmd`
in `contestants.json` (a language's program plus the library's name, e.g. `node bench/deep/js/harness.mjs pdfkit`),
prints one JSON line
(`{"ok":true,"ms":…,"warm_ms":…}` or `{"ok":false,"error":…}`), with `BENCH_FIXTURES`, `BENCH_SPEC`, and
`BENCH_INPUT` (robustness) and `REPS` (warm runs) in the environment. The create jobs of low-level writers are the same
drawing operations in every language (`common/canvas-jobs.mjs` and its ports), so they differ only in the library.

## Adding a contestant

Add its adapter to its language's harness, its exact version to that language's manifest, and an entry to
`contestants.json` (jobs, n/a reasons, `million` if it streams). Nothing else changes.
