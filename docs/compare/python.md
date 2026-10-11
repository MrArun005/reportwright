# JavaScript vs Python for PDFs

**The claim, precisely: at report scale (thousands of rows and up), ReportWright in JavaScript is faster than the pure-Python PDF libraries we measured, and its streaming writer uses less memory at a million rows. It is not faster everywhere.** C-backed Python libraries (PyMuPDF, pikepdf) win small edits, ReportLab wins tiny documents and uses less memory at every size up to 100,000 rows, and Python starts faster for one-page jobs.

All numbers are medians from GitHub Actions runs of this repository (ubuntu-latest, every contestant interleaved in the same job, 5 measured runs after a warm-up unless noted). Time is the harness's warm median (in-process); memory is peak RSS. Bold is the fastest of the libraries shown.

## Report engine vs WeasyPrint (HTML/CSS to PDF)

From [`bench/deep/RESULTS.md`](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md), GitHub runs 37982975209 + 38010821519; ours is engine `perf-startup@13fa2cb34`.

| job | ReportWright | WeasyPrint |
|---|---|---|
| Grouped report, 100 rows | **584 ms** · 154 MB | 1215 ms · **84 MB** |
| Grouped report, 1,000 rows | **741 ms · 178 MB** | 6493 ms · 236 MB |
| Grouped report, 10,000 rows | **1450 ms · 249 MB** | 66.28 s · 1772 MB |
| Grouped report, 100,000 rows | **8446 ms · 359 MB** | out of memory (4,000 MB cap) |
| Plain text, 10 pages | **708 ms** · 161 MB | 1976 ms · **84 MB** |
| Plain text, 1,000 pages | **3187 ms · 295 MB** | 112.84 s · 1685 MB |
| Invoice, cold (new process) | **599 ms** · 109 MB | 943 ms · **83 MB** |
| Invoice, warm | **17 ms** · 216 MB | 152 ms · **125 MB** |
| Unicode: Hindi, Arabic, CJK | **675 ms** · 158 MB | 1756 ms · **123 MB** |

WeasyPrint uses less memory on small documents. From 1,000 rows on it is 8.8× to 45.7× slower, and it ran out of memory at 100,000 rows.

## PDF writer: @reportwright/pdf vs ReportLab and PyMuPDF

GitHub run [38108358558](https://github.com/MrArun005/reportwright/actions/runs/38108358558) (create-writers job, AMD EPYC 9V45, 4 cores), `@reportwright/pdf` 0.1.0-beta.12 from npm; the 1,000,000-row row is GitHub run [38108358497](https://github.com/MrArun005/reportwright/actions/runs/38108358497).

| job | @reportwright/pdf | ReportLab | PyMuPDF |
|---|---|---|---|
| Grouped report, 100 rows | 38.9 ms · 72 MB | **24.6 ms · 33 MB** | 96.5 ms · 59 MB |
| Grouped report, 1,000 rows | **88.6 ms** · 80 MB | 112.3 ms · **34 MB** | 710.6 ms · 60 MB |
| Grouped report, 10,000 rows | **306 ms** · 117 MB | 999 ms · **45 MB** | 6557 ms · 70 MB |
| Grouped report, 100,000 rows | **1991 ms** · 179 MB | 10.54 s · **158 MB** | 67.75 s · 179 MB |
| Grouped report, 1,000,000 rows | **29.07 s · 596 MB** | 215.17 s · 1292 MB | 1358.32 s · 1279 MB |
| Plain text, 10 pages | 54.5 ms · 75 MB | **27.9 ms · 31 MB** | 70.5 ms · 59 MB |
| Plain text, 100 pages | **199 ms** · 100 MB | 223 ms · **33 MB** | 574 ms · 62 MB |
| Plain text, 1,000 pages | **1230 ms** · 121 MB | 2098 ms · **52 MB** | 5607 ms · 89 MB |
| Invoice, single | 49.6 ms · 73 MB | **20.7 ms · 34 MB** | 38.4 ms · 59 MB |
| Invoice, warm (50 in one process) | 5.36 ms · 128 MB | **5.11 ms · 34 MB** | 35.8 ms · 60 MB |
| Unicode: Hindi, Arabic, CJK | **48.8 ms** · 87 MB | 49.6 ms · **70 MB** | 514.5 ms · 91 MB |
| Images: 6 MP PNG + 24 MP JPEG | **633 ms** · 197 MB | 5524 ms · 375 MB | 687 ms · **124 MB** |

At 1,000,000 rows @reportwright/pdf is 7.4× faster than ReportLab with 46% of its memory. ReportLab wins the 100-row report, the 10-page document and both invoices.

## Reading text

Same run, read-edit job. "Failed the check" means the library returned, but its output did not match the expected text.

| job | @reportwright/pdf | PyMuPDF | pypdf | pdfminer.six | pdfplumber |
|---|---|---|---|---|---|
| Extract text, 1,200 pages | **1084 ms** · 121 MB | 1370 ms · 75 MB | 5676 ms · 78 MB | 45.10 s · **60 MB** | out of memory (4,009 MB) |
| Extract text, 11 mixed files | 119 ms, passed | 64 ms, failed the check | 276 ms, passed | failed the check | failed the check |

## Editing: Python wins

Same run, read-edit job. These are single small operations, where per-call cost dominates.

| job | @reportwright/pdf | PyMuPDF | pikepdf | pypdf |
|---|---|---|---|---|
| Merge 100 files | 93.0 ms | **42.3 ms** | 50.7 ms | not measured |
| Split 100 pages | 105.9 ms | 29.3 ms | **24.7 ms** | 52.5 ms |
| Encrypt | 60.5 ms | **11.3 ms** | 19.4 ms | not measured |
| Edit metadata | 31.9 ms | **1.7 ms** | — | 13.1 ms |
| Fill a form | 31.3 ms | 3.4 ms | — | **3.2 ms** |
| Sign | **21.0 ms** | — | — | — |

No Python library in the run signs PDFs, so signing has no Python comparison.

## Robustness (fuzz)

Same run, robustness job: 200 mutated PDFs and 6 hostile ones (a decompression bomb, reference cycles, deep nesting, huge counts, a huge string, an xref loop). "Opened" means the file was read without error; the rest failed with a clean error. None of the libraries below crashed.

| | @reportwright/pdf | PyMuPDF | pikepdf | pypdf | pdfminer.six | pdfplumber |
|---|---|---|---|---|---|---|
| Fuzz: opened / clean error (of 200) | 182 / 18 | **186 / 14** | 158 / 42 | 12 / 188 | 55 / 145 | 54 / 146 |
| Hostile: hangs (of 6) | 0 | 0 | 0 | 0 | **2** | **2** |

## Why JavaScript wins at scale

- **V8 compiles the hot loop.** Laying out 100,000 rows runs the same few functions millions of times; V8's JIT turns them into machine code. CPython interprets every bytecode and boxes every number, so a pure-Python layout loop pays per-object overhead on each glyph, cell and coordinate.
- **Typed arrays instead of objects.** Glyph runs, widths and byte buffers live in `Uint8Array` / `Float64Array`, flat memory with no per-element object header.
- **A streaming writer.** Pages are written to the output as they are finished and then dropped, so memory follows the page, not the document: 596 MB at 1,000,000 rows, where ReportLab and PyMuPDF held about 1.3 GB.

## Why Python wins where it does

- **C underneath.** PyMuPDF (MuPDF) and pikepdf (qpdf) are C and C++ libraries with Python bindings. A merge, split, encrypt or metadata edit is mostly C, and a single small operation never gets far enough for a JIT to matter.
- **ReportLab on tiny files.** ReportLab is mostly Python with small C accelerators and writes a minimal document with little machinery: 20.7 ms for a one-page invoice against our 49.6 ms, and the lowest memory of the three on every report and plain-text row up to 100,000 rows. A JIT needs a hot loop to pay off; a one-page invoice does not have one.
- **Start-up is close to a tie.** Measured as a whole new process (cold median, same run), the one-page invoice took 117.5 ms with @reportwright/pdf, 115.0 ms with ReportLab and 188.2 ms with PyMuPDF. ReportLab's start-up edge over Node is 2.4 ms here.
