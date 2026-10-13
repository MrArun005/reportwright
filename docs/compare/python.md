# JavaScript vs Python for PDFs

**The claim, precisely: at report scale (thousands of rows and up), ReportWright in JavaScript is faster than the Python PDF libraries we measured. It is not better everywhere.** ReportLab uses the least memory at every size it ran, is within a few per cent of us on one-page documents, and pikepdf (qpdf underneath) is faster at merge, split and encryption.

All numbers are medians from GitHub Actions run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719) of this repository on the 1.0 code (ubuntu-latest, every contestant interleaved in the same job, 5 measured runs after a warm-up). Time is wall time from process start to exit, so every row includes the runtime's start-up (warm invoice: in-process median); memory is peak RSS. `@reportwright/pdf` is 0.1.0-beta.15 from npm (the same code as 1.0.0). Bold is the fastest of the libraries shown.

## Report engine vs WeasyPrint (HTML/CSS to PDF)

| job | ReportWright | WeasyPrint 70 |
|---|---|---|
| Grouped report, 100 rows | **271 ms** · 94 MB | 1424 ms · **84 MB** |
| Grouped report, 1,000 rows | **399 ms · 118 MB** | 7480 ms · 236 MB |
| Grouped report, 10,000 rows | **1132 ms · 192 MB** | 72.09 s · 1772 MB |
| Plain text, 10 pages | **188 ms** · 99 MB | 1002 ms · **84 MB** |
| Plain text, 100 pages | **354 ms · 142 MB** | 6151 ms · 226 MB |
| Invoice, cold (new process) | **188 ms** · 97 MB | 546 ms · **83 MB** |
| Invoice, warm | **9.0 ms** · 121 MB | 81 ms · 126 MB |
| Unicode: Hindi, Arabic, CJK | **186 ms · 94 MB** | 1105 ms · 123 MB |
| PDF/A-2b invoice | **187 ms** · 97 MB | 546 ms · **83 MB** |

WeasyPrint uses less memory on small documents. From 1,000 rows on it is 18.7× to 63.7× slower. On WeasyPrint's own showcase (a CSS paged-media brochure) ReportWright took 450 ms against 1222 ms, but as single-column rich text: it has no CSS multi-column flow or `@page` margin boxes.

## PDF writer: @reportwright/pdf vs ReportLab and PyMuPDF

| job | @reportwright/pdf | ReportLab 5.0 | PyMuPDF 1.28 |
|---|---|---|---|
| Grouped report, 100 rows | **159 ms** · 72 MB | 199 ms · **33 MB** | 372 ms · 59 MB |
| Grouped report, 1,000 rows | **240 ms** · 79 MB | 395 ms · **34 MB** | 1543 ms · 60 MB |
| Grouped report, 10,000 rows | **614 ms** · 116 MB | 2378 ms · **45 MB** | 13.17 s · 70 MB |
| Plain text, 10 pages | **189 ms** · 75 MB | 201 ms · **31 MB** | 327 ms · 59 MB |
| Plain text, 100 pages | **420 ms** · 110 MB | 587 ms · **33 MB** | 1337 ms · 61 MB |
| Invoice, single | **188 ms** · 73 MB | 199 ms · **34 MB** | 256 ms · 59 MB |
| Invoice, warm (50 in one process) | **8.5 ms** · 130 MB | 8.7 ms · **34 MB** | 54 ms · 60 MB |
| Unicode: Hindi, Arabic, CJK | **181 ms** · 88 MB | 224 ms · **70 MB** | 888 ms · 91 MB |
| Images: 6 MP PNG + 24 MP JPEG | **991 ms** · 197 MB | 9193 ms · 374 MB | 1118 ms · **123 MB** |

At 10,000 rows @reportwright/pdf is 3.9× faster than ReportLab, with 2.6× its memory. On one-page documents the three are within 5 to 35 per cent of each other, most of it start-up. At 1,000,000 rows (an earlier run, GitHub run [38108358497](https://github.com/MrArun005/reportwright/actions/runs/38108358497), `@reportwright/pdf` 0.1.0-beta.12; not repeated for 1.0) @reportwright/pdf took 29.07 s at 596 MB, ReportLab 215.17 s at 1292 MB and PyMuPDF 1358.32 s at 1279 MB.

## Reading text

Read-edit job, same run. "Failed the check" means the library returned, but its output did not match the expected text.

| job | @reportwright/pdf | PyMuPDF | pypdf | pdfminer.six | pdfplumber |
|---|---|---|---|---|---|
| Extract text, 1,200 pages | **1206 ms** · 120 MB | 1426 ms · 75 MB | 5424 ms · 78 MB | 43.11 s · **61 MB** | out of memory |
| Extract text, 11 mixed files | **208 ms**, passed | 229 ms, failed the check | 421 ms, passed | failed the check | failed the check |

## Editing: pikepdf wins merge, split and encrypt

Read-edit job, same run. Whole-process times: start-up is a large part of each row.

| job | @reportwright/pdf | PyMuPDF | pikepdf | pypdf |
|---|---|---|---|---|
| Merge 100 files | 182 ms | 198 ms | **153 ms** | 263 ms |
| Split 100 pages | 185 ms | 177 ms | **132 ms** | 198 ms |
| Encrypt AES-256 | 136 ms | 177 ms | **132 ms** | 197 ms |
| Edit metadata (incremental) | **137 ms** | 159 ms | — | 176 ms |
| Fill and flatten a form | **113 ms** | 154 ms | — | 175 ms |
| Sign | **111 ms** | — | — | — |

No Python library in the run signs PDFs (PyMuPDF and pypdf need pyHanko), so signing has no Python comparison.

## Robustness (fuzz)

Robustness job, same run: 25 mutated PDFs and 6 hostile ones (a decompression bomb, reference cycles, deep nesting, huge counts, a huge string, an xref loop). "Opened" means the file was read without error; the rest failed with a clean error. None of the libraries below crashed.

| | @reportwright/pdf | PyMuPDF | pikepdf | pypdf | pdfminer.six | pdfplumber |
|---|---|---|---|---|---|---|
| Fuzz: opened / clean error (of 25) | **22 / 3** | 20 / 5 | 18 / 7 | 1 / 24 | 7 / 18 | 6 / 19 |
| Hostile: hangs (of 6) | 0 | 0 | 0 | 0 | **2** | **2** |

## Why JavaScript wins at scale

- **V8 compiles the hot loop.** Laying out 100,000 rows runs the same few functions millions of times; V8's JIT turns them into machine code. CPython interprets every bytecode and boxes every number, so a pure-Python layout loop pays per-object overhead on each glyph, cell and coordinate.
- **Typed arrays instead of objects.** Glyph runs, widths and byte buffers live in `Uint8Array` / `Float64Array`, flat memory with no per-element object header.
- **A streaming writer.** Pages are written to the output as they are finished and then dropped, so memory follows the page, not the document: 596 MB at 1,000,000 rows in the earlier run, where ReportLab and PyMuPDF held about 1.3 GB.

## Why Python wins where it does

- **C underneath.** PyMuPDF (MuPDF) and pikepdf (qpdf) are C and C++ libraries with Python bindings. A merge, split, encrypt or metadata edit is mostly C, and a single small operation never gets far enough for a JIT to matter.
- **ReportLab on tiny files.** ReportLab is mostly Python with small C accelerators and writes a minimal document with little machinery: 199 ms for a one-page invoice as a whole process against our 188 ms, 8.7 ms against our 8.5 ms warm, and the lowest memory of the three on every report and plain-text row. A JIT needs a hot loop to pay off; a one-page invoice does not have one.
