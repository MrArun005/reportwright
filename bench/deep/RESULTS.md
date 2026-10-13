# Deep PDF benchmark

> Older run (10 Oct 2026, pre-1.0 code). The 1.0 numbers are GitHub runs [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719) (comparisons), [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290) (Windows SSRS, bulk) and [38312329287](https://github.com/MrArun005/reportwright/actions/runs/38312329287) (1,000,000 rows); see the README.

Run 2026-10-10T00:55:55Z, tier `full`, 5 measured runs a cell after one warm-up (fewer for the biggest sizes, see README). Memory cap 4000 MB a run. Same-machine layout: each job group (create-writers, create-engines, read-edit, robustness) ran every contestant in one job, interleaved run by run; the line above each table names the runner hardware (CPU model) of the columns in it. Rankings and "where we lose" compare ours with the best other library, never one build of ours with another.

Cells: median wall time from process start to exit (warm invoice: in-process median) · peak RSS. ✗ = the output failed a check (qpdf, MuPDF, pdf.js, or the job's own text check) and is not ranked. **Bold** = fastest valid. Create jobs are ranked within a league: **report engines** lay pages out themselves from a report/table definition; **PDF writers** execute the same pre-laid-out draw ops. Read and edit jobs are one league. Full numbers (CPU, min–max, time to first byte, sizes, checks) are in results.json and results.html.

## Headline (GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group)

- Report engines: Create, plain text (pages): @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 2 of 6 (size, build) rows; behind QuestPDF (1.10–2.09×; 4 rows)
- PDF writers: Create, plain text (pages): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 6 (size, build) rows; behind fpdf (5.19–5.94×; 6 rows)
- Report engines: Create, grouped report (rows): @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 4 of 8 (size, build) rows; behind QuestPDF (1.32–1.99×; 4 rows)
- PDF writers: Create, grouped report (rows): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 8 (size, build) rows; behind fpdf (2.19–5.19×; 8 rows)
- Report engines: Invoice, cold (new process): @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 0 of 2 (size, build) rows; behind QuestPDF (1.52–1.71×; 2 rows)
- PDF writers: Invoice, cold (new process): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind fpdf (4.64–4.79×; 2 rows)
- Report engines: Invoice, warm (median of the last 40 of 50 in one process): @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 0 of 2 (size, build) rows; behind QuestPDF (1.95–2.01×; 2 rows)
- PDF writers: Invoice, warm (median of the last 40 of 50 in one process): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind PDFsharp (1.71–2.09×; 2 rows)
- Report engines: Unicode: Hindi, Arabic, CJK: @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 0 of 2 (size, build) rows; behind QuestPDF (1.98–2.83×; 2 rows)
- PDF writers: Unicode: Hindi, Arabic, CJK: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind fpdf (2.81–3.13×; 2 rows)
- PDF writers: Images: 6 MP RGBA PNG + 24 MP JPEG: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind printpdf (3.30–3.32×; 2 rows)
- Report engines: PDF/A-2b invoice (veraPDF): @reportwright/engine (branch perf-startup@13fa2cb34), @reportwright/engine 0.13.1 (npm) #1 in 0 of 2 (size, build) rows; behind pdfmake (1.05–1.24×; 2 rows)
- PDF writers: PDF/A-2b invoice (veraPDF): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 2 of 2 (size, build) rows
- Read & edit: Read: text of a 1,200-page PDF: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind pdftotext (1.54–1.72×; 2 rows)
- Read & edit: Read: 11 mixed real-world-style files: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind pdfium (1.70–1.71×; 2 rows)
- Read & edit: Merge 100 files: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind pdfcpu (4.34–4.75×; 2 rows)
- Read & edit: Split 100 pages: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind pdfcpu (3.02–3.46×; 2 rows)
- Read & edit: Encrypt AES-256: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind pdfcpu (3.16–3.79×; 2 rows)
- Read & edit: Incremental metadata change: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 2 of 2 (size, build) rows
- Read & edit: Fill and flatten a form: @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 2 of 2 (size, build) rows
- Read & edit: Sign (PAdES/CMS, test certificate): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 2 of 2 (size, build) rows

## Old vs new, ours on the same machine (GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group)

- Report engines: Create, plain text (pages) at 10: @reportwright/engine (branch perf-startup@13fa2cb34) 708 ms · 161 MB vs @reportwright/engine 0.13.1 (npm) 874 ms · 177 MB = 0.81× time, 0.91× RSS
- Report engines: Create, plain text (pages) at 100: @reportwright/engine (branch perf-startup@13fa2cb34) 1233 ms · 205 MB vs @reportwright/engine 0.13.1 (npm) 1350 ms · 225 MB = 0.91× time, 0.91× RSS
- Report engines: Create, plain text (pages) at 1,000: @reportwright/engine (branch perf-startup@13fa2cb34) 3187 ms · 295 MB vs @reportwright/engine 0.13.1 (npm) 3274 ms · 312 MB = 0.97× time, 0.94× RSS
- PDF writers: Create, plain text (pages) at 10: @reportwright/pdf (branch pdf-lib-own@df15eb949) 297 ms · 77 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 298 ms · 79 MB = 1.00× time, 0.98× RSS
- PDF writers: Create, plain text (pages) at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 645 ms · 92 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 640 ms · 97 MB = 1.01× time, 0.95× RSS
- PDF writers: Create, plain text (pages) at 1,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3051 ms · 135 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 2965 ms · 132 MB = 1.03× time, 1.02× RSS
- Report engines: Create, grouped report (rows) at 100: @reportwright/engine (branch perf-startup@13fa2cb34) 584 ms · 154 MB vs @reportwright/engine 0.13.1 (npm) 720 ms · 171 MB = 0.81× time, 0.90× RSS
- Report engines: Create, grouped report (rows) at 1,000: @reportwright/engine (branch perf-startup@13fa2cb34) 741 ms · 178 MB vs @reportwright/engine 0.13.1 (npm) 1006 ms · 213 MB = 0.74× time, 0.83× RSS
- Report engines: Create, grouped report (rows) at 10,000: @reportwright/engine (branch perf-startup@13fa2cb34) 1450 ms · 249 MB vs @reportwright/engine 0.13.1 (npm) 2080 ms · 252 MB = 0.70× time, 0.99× RSS
- Report engines: Create, grouped report (rows) at 100,000: @reportwright/engine (branch perf-startup@13fa2cb34) 8446 ms · 359 MB vs @reportwright/engine 0.13.1 (npm) 8962 ms · 330 MB = 0.94× time, 1.09× RSS
- PDF writers: Create, grouped report (rows) at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 229 ms · 73 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 243 ms · 75 MB = 0.94× time, 0.97× RSS
- PDF writers: Create, grouped report (rows) at 1,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 405 ms · 80 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 419 ms · 84 MB = 0.97× time, 0.96× RSS
- PDF writers: Create, grouped report (rows) at 10,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 936 ms · 116 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 948 ms · 119 MB = 0.99× time, 0.97× RSS
- PDF writers: Create, grouped report (rows) at 100,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 4801 ms · 177 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 4804 ms · 189 MB = 1.00× time, 0.94× RSS
- Report engines: Invoice, cold (new process) at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 599 ms · 109 MB vs @reportwright/engine 0.13.1 (npm) 674 ms · 112 MB = 0.89× time, 0.97× RSS
- PDF writers: Invoice, cold (new process) at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 256 ms · 75 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 248 ms · 76 MB = 1.03× time, 0.99× RSS
- Report engines: Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/engine (branch perf-startup@13fa2cb34) 17 ms · 216 MB vs @reportwright/engine 0.13.1 (npm) 17 ms · 206 MB = 0.97× time, 1.05× RSS
- PDF writers: Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/pdf (branch pdf-lib-own@df15eb949) 11 ms · 134 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 13 ms · 128 MB = 0.82× time, 1.05× RSS
- Report engines: Unicode: Hindi, Arabic, CJK at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 675 ms · 158 MB vs @reportwright/engine 0.13.1 (npm) 966 ms · 180 MB = 0.70× time, 0.88× RSS
- PDF writers: Unicode: Hindi, Arabic, CJK at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 249 ms · 88 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 223 ms · 90 MB = 1.11× time, 0.98× RSS
- PDF writers: Images: 6 MP RGBA PNG + 24 MP JPEG at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 1220 ms · 199 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 1227 ms · 200 MB = 0.99× time, 1.00× RSS
- Report engines: PDF/A-2b invoice (veraPDF) at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 600 ms · 109 MB vs @reportwright/engine 0.13.1 (npm) 708 ms · 112 MB = 0.85× time, 0.98× RSS
- PDF writers: PDF/A-2b invoice (veraPDF) at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 255 ms · 75 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 254 ms · 77 MB = 1.00× time, 0.98× RSS
- Read & edit: Read: text of a 1,200-page PDF at 1,200: @reportwright/pdf (branch pdf-lib-own@df15eb949) 1002 ms · 139 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 1119 ms · 139 MB = 0.90× time, 1.00× RSS
- Read & edit: Read: 11 mixed real-world-style files at 11: @reportwright/pdf (branch pdf-lib-own@df15eb949) 235 ms · 79 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 233 ms · 81 MB = 1.01× time, 0.98× RSS
- Read & edit: Merge 100 files at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 204 ms · 81 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 224 ms · 85 MB = 0.91× time, 0.95× RSS
- Read & edit: Split 100 pages at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 217 ms · 85 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 249 ms · 89 MB = 0.87× time, 0.96× RSS
- Read & edit: Encrypt AES-256 at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 147 ms · 76 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 176 ms · 79 MB = 0.83× time, 0.97× RSS
- Read & edit: Incremental metadata change at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 125 ms · 72 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 100 ms · 72 MB = 1.25× time, 1.00× RSS
- Read & edit: Fill and flatten a form at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 100 ms · 71 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 122 ms · 71 MB = 0.82× time, 1.00× RSS
- Read & edit: Sign (PAdES/CMS, test certificate) at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 99 ms · 71 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 96 ms · 71 MB = 1.02× time, 1.00× RSS
- Read & edit: Robustness: fuzzed PDFs at 200: @reportwright/pdf (branch pdf-lib-own@df15eb949) ok vs @reportwright/pdf 0.1.0-beta.5 (npm) ok
- Read & edit: Robustness: hostile files at 6: @reportwright/pdf (branch pdf-lib-own@df15eb949) ok vs @reportwright/pdf 0.1.0-beta.5 (npm) ok

## Not re-measured (more than 20% slower than ReportWright in run 37978876448)

- Create, plain text (pages) (Report engines): pdfmake 1.44× ours at 100
- Create, plain text (pages) (Report engines): @react-pdf/renderer 8.58× ours at 100
- Create, plain text (pages) (Report engines): puppeteer 1.80× ours at 100
- Invoice, cold (new process) (Report engines): puppeteer 1.59× ours at 1
- Invoice, warm (median of the last 40 of 50 in one process) (Report engines): pdfmake 4.62× ours at 50
- Invoice, warm (median of the last 40 of 50 in one process) (Report engines): @react-pdf/renderer 2.69× ours at 50
- Invoice, warm (median of the last 40 of 50 in one process) (Report engines): puppeteer 10.70× ours at 50
- Unicode: Hindi, Arabic, CJK (Report engines): puppeteer 1.66× ours at 1
- Create, grouped report (rows) (Report engines): pdfmake 3.34× ours at 10,000
- Create, grouped report (rows) (Report engines): @react-pdf/renderer 9.12× ours at 1,000
- Create, grouped report (rows) (Report engines): puppeteer 11.82× ours at 10,000

## Where we lose (GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group)

**Report engines**

- Create, plain text (pages) at 10: @reportwright/engine (branch perf-startup@13fa2cb34) 1.69× QuestPDF
- Create, plain text (pages) at 10: @reportwright/engine 0.13.1 (npm) 2.09× QuestPDF
- Create, plain text (pages) at 100: @reportwright/engine (branch perf-startup@13fa2cb34) 1.10× QuestPDF
- Create, plain text (pages) at 100: @reportwright/engine 0.13.1 (npm) 1.21× QuestPDF
- Create, grouped report (rows) at 100: @reportwright/engine (branch perf-startup@13fa2cb34) 1.62× QuestPDF
- Create, grouped report (rows) at 100: @reportwright/engine 0.13.1 (npm) 1.99× QuestPDF
- Create, grouped report (rows) at 1,000: @reportwright/engine (branch perf-startup@13fa2cb34) 1.32× QuestPDF
- Create, grouped report (rows) at 1,000: @reportwright/engine 0.13.1 (npm) 1.79× QuestPDF
- Invoice, cold (new process) at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 1.52× QuestPDF
- Invoice, cold (new process) at 1: @reportwright/engine 0.13.1 (npm) 1.71× QuestPDF
- Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/engine (branch perf-startup@13fa2cb34) 1.95× QuestPDF
- Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/engine 0.13.1 (npm) 2.01× QuestPDF
- Unicode: Hindi, Arabic, CJK at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 1.98× QuestPDF
- Unicode: Hindi, Arabic, CJK at 1: @reportwright/engine 0.13.1 (npm) 2.83× QuestPDF
- PDF/A-2b invoice (veraPDF) at 1: @reportwright/engine (branch perf-startup@13fa2cb34) 1.05× pdfmake
- PDF/A-2b invoice (veraPDF) at 1: @reportwright/engine 0.13.1 (npm) 1.24× pdfmake

**PDF writers**

- Create, plain text (pages) at 10: @reportwright/pdf (branch pdf-lib-own@df15eb949) 5.52× fpdf
- Create, plain text (pages) at 10: @reportwright/pdf 0.1.0-beta.5 (npm) 5.54× fpdf
- Create, plain text (pages) at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 5.94× fpdf
- Create, plain text (pages) at 100: @reportwright/pdf 0.1.0-beta.5 (npm) 5.89× fpdf
- Create, plain text (pages) at 1,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 5.34× fpdf
- Create, plain text (pages) at 1,000: @reportwright/pdf 0.1.0-beta.5 (npm) 5.19× fpdf
- Create, grouped report (rows) at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 4.22× fpdf
- Create, grouped report (rows) at 100: @reportwright/pdf 0.1.0-beta.5 (npm) 4.48× fpdf
- Create, grouped report (rows) at 1,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 5.02× fpdf
- Create, grouped report (rows) at 1,000: @reportwright/pdf 0.1.0-beta.5 (npm) 5.19× fpdf
- Create, grouped report (rows) at 10,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3.12× fpdf
- Create, grouped report (rows) at 10,000: @reportwright/pdf 0.1.0-beta.5 (npm) 3.16× fpdf
- Create, grouped report (rows) at 100,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 2.19× fpdf
- Create, grouped report (rows) at 100,000: @reportwright/pdf 0.1.0-beta.5 (npm) 2.19× fpdf
- Invoice, cold (new process) at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 4.79× fpdf
- Invoice, cold (new process) at 1: @reportwright/pdf 0.1.0-beta.5 (npm) 4.64× fpdf
- Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/pdf (branch pdf-lib-own@df15eb949) 1.71× PDFsharp
- Invoice, warm (median of the last 40 of 50 in one process) at 50: @reportwright/pdf 0.1.0-beta.5 (npm) 2.09× PDFsharp
- Unicode: Hindi, Arabic, CJK at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3.13× fpdf
- Unicode: Hindi, Arabic, CJK at 1: @reportwright/pdf 0.1.0-beta.5 (npm) 2.81× fpdf
- Images: 6 MP RGBA PNG + 24 MP JPEG at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3.30× printpdf
- Images: 6 MP RGBA PNG + 24 MP JPEG at 1: @reportwright/pdf 0.1.0-beta.5 (npm) 3.32× printpdf

**Read & edit**

- Read: text of a 1,200-page PDF at 1,200: @reportwright/pdf (branch pdf-lib-own@df15eb949) 1.54× pdftotext
- Read: text of a 1,200-page PDF at 1,200: @reportwright/pdf 0.1.0-beta.5 (npm) 1.72× pdftotext
- Read: 11 mixed real-world-style files at 11: @reportwright/pdf (branch pdf-lib-own@df15eb949) 1.71× pdfium
- Read: 11 mixed real-world-style files at 11: @reportwright/pdf 0.1.0-beta.5 (npm) 1.70× pdfium
- Merge 100 files at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 4.34× pdfcpu
- Merge 100 files at 100: @reportwright/pdf 0.1.0-beta.5 (npm) 4.75× pdfcpu
- Split 100 pages at 100: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3.02× pdfcpu
- Split 100 pages at 100: @reportwright/pdf 0.1.0-beta.5 (npm) 3.46× pdfcpu
- Encrypt AES-256 at 1: @reportwright/pdf (branch pdf-lib-own@df15eb949) 3.16× pdfcpu
- Encrypt AES-256 at 1: @reportwright/pdf 0.1.0-beta.5 (npm) 3.79× pdfcpu

## Capabilities

Not measured: what each library documents. ✅ yes, ❌ no, partial (see note), ? not verified.

| library | layout engine | tables | bidi (UBA) | complex-script shaping | streams pages | PDF/A | PDF/UA | forms (create/fill) | signing | encryption | read/extract text | merge/split | runtime deps | license |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| @reportwright/engine | ✅ | ✅ | ✅ [1] | ✅ [2] | ✅ [3] | ✅ [4] | ✅ [5] | ❌ | ❌ | ✅ [6] | ❌ | ❌ | 0.13.1: pdf-lib, @pdf-lib/fontkit, bwip-js, fflate, bidi-js (+ optional peer @reportwright/fonts); perf-startup: fflate replaced by @reportwright/pdf [7] | MIT |
| pdfmake | ✅ | ✅ | ❌ | ❌ | ❌ | ? [8] | ? | ❌ | ❌ | ✅ [9] | ❌ | ❌ | pdfkit (fontkit), xmldoc | MIT |
| @react-pdf/renderer | ✅ [10] | partial [11] | ❌ | ? | ❌ | ❌ | ❌ | ? | ❌ | ? | ❌ | ❌ | @react-pdf/* (a PDFKit fork, yoga-layout, fontkit); react as a peer | MIT |
| jasperreports | ✅ | ✅ | partial [12] | partial [13] | partial [14] | ✅ | ✅ [15] | ? | ? | ✅ | ❌ | ❌ | many: OpenPDF, commons-*, Jackson, ... | LGPL-3.0 |
| QuestPDF | ✅ | ✅ | ✅ [16] | ✅ [17] | ❌ | ? | ? | ❌ | ❌ | ? | ❌ | ? | SkiaSharp-based native renderer (bundled) | Community licence (free under $1M revenue), else commercial |
| weasyprint | ✅ | ✅ | ✅ [18] | ✅ [19] | ❌ | ✅ [20] | ✅ [21] | ✅ [22] | ❌ | ❌ | ❌ | ❌ | Pango (native), pydyf, tinycss2, cssselect2, fontTools, Pillow | BSD-3-Clause |
| puppeteer | ✅ | ✅ | ✅ | ✅ | ❌ [23] | ❌ | partial [24] | ❌ | ❌ | ❌ | ❌ | ❌ | a full Chrome (~170 MB download) | Apache-2.0 (Chrome: BSD-3-Clause and others) |
| @reportwright/pdf | ❌ | ❌ | ❌ | ✅ [25] | ✅ | ✅ [26] | ? | ✅ | ✅ | ✅ | ✅ | ✅ | 0 | MIT |
| mupdf.js (WASM) | ❌ | ❌ | ? | ? | ❌ | ❌ | ❌ | ✅ [27] | ? | ✅ [28] | ✅ [29] | ✅ [30] | none (MuPDF compiled to WebAssembly, bundled) | AGPL-3.0 or commercial |
| pdf-lib | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ [31] | ❌ | ❌ [32] | ✅ | @pdf-lib/standard-fonts, @pdf-lib/upng, pako, tslib | MIT |
| pdfkit | partial [33] | partial [34] | ❌ | partial [35] | ✅ [36] | ✅ [37] | partial [38] | ✅ | ❌ | ✅ | ❌ | ❌ | fontkit, crypto-js, linebreak, png-js, jpeg-exif | MIT |
| jspdf | ❌ | partial [39] | partial [40] | partial [41] | ❌ | ❌ | ❌ | ✅ | ❌ | partial [42] | ❌ | ❌ | fflate, @babel/runtime (+ optional html2canvas, canvg, dompurify) | MIT |
| reportlab | ✅ [43] | ✅ | partial [44] | partial [45] | ❌ | ? | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | Pillow, charset-normalizer | BSD-3-Clause |
| PyMuPDF | partial [46] | partial [47] | partial [48] | partial [49] | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | bundled MuPDF (native) | AGPL-3.0 or commercial |
| pdfbox | ❌ | ❌ | ❌ | ❌ | partial [50] | partial [51] | partial [52] | ✅ | ✅ | ✅ | ✅ | ✅ | fontbox, pdfbox-io, commons-logging | Apache-2.0 |
| openpdf | partial [53] | ✅ | partial [54] | partial [55] | ✅ [56] | partial [57] | ❌ | ✅ | ✅ | ✅ | partial [58] | ✅ | none required (BouncyCastle optional, for signing/encryption) | LGPL-2.1 / MPL-2.0 |
| itext | ✅ [59] | ✅ | partial [60] | partial [61] | ✅ [62] | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | bouncy-castle-adapter, slf4j (core) | AGPL-3.0 or commercial |
| PDFsharp | ❌ [63] | ❌ | ❌ | ❌ | ❌ | partial [64] | ? | partial [65] | ✅ [66] | ✅ | ❌ | ✅ | none (managed) | MIT |
| fpdf | partial [67] | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | partial [68] | ❌ | ❌ | none | MIT |
| printpdf | ? [69] | ? | ❌ | ? | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ? | ❌ | lopdf, allsorts, image, ... | MIT |

1. @reportwright/engine, bidi (UBA): bidi-js (src/engine/text/measure.js runs the Unicode bidi algorithm on the complex path)
2. @reportwright/engine, complex-script shaping: HarfBuzz wasm called directly (src/engine/text/shaper.js)
3. @reportwright/engine, streams pages: exportPdfStream (packages/engine/README.md, 'Streaming PDF for large reports')
4. @reportwright/engine, PDF/A: PDF/A-2b and 2a, veraPDF-validated (packages/engine/README.md)
5. @reportwright/engine, PDF/UA: PDF/UA-1 tagging, `pw render --pdfa --ua` (packages/engine/README.md)
6. @reportwright/engine, encryption: AES-256 passwords and permissions (packages/engine/README.md)
7. @reportwright/engine, runtime deps: scripts/build-packages.mjs `external` on main vs perf-startup
8. pdfmake, PDF/A: PDFKit has a PDF/A subset option; whether pdfmake 0.3 exposes it is unverified
9. pdfmake, encryption: through PDFKit's userPassword/ownerPassword
10. @react-pdf/renderer, layout engine: Yoga flexbox
11. @react-pdf/renderer, tables: no table primitive: rows and cells are built from flex Views
12. jasperreports, bidi (UBA): run direction from Java's text layout; PDF export through OpenPDF has known gaps with RTL
13. jasperreports, complex-script shaping: depends on the PDF exporter's font handling (OpenPDF): Indic shaping is not reliable
14. jasperreports, streams pages: virtualizers swap filled pages to disk; the print is still built before export
15. jasperreports, PDF/UA: tagged PDF export with accessibility properties
16. QuestPDF, bidi (UBA): ContentDirection RTL, text through Skia + HarfBuzz
17. QuestPDF, complex-script shaping: HarfBuzz through Skia
18. weasyprint, bidi (UBA): Pango
19. weasyprint, complex-script shaping: Pango + HarfBuzz
20. weasyprint, PDF/A: --pdf-variant pdf/a-*
21. weasyprint, PDF/UA: --pdf-variant pdf/ua-1
22. weasyprint, forms (create/fill): creates AcroForm fields from HTML inputs (--pdf-forms); no filling of existing PDFs
23. puppeteer, streams pages: printToPDF can return a stream, but the whole document is laid out first
24. puppeteer, PDF/UA: Chrome writes tagged PDF (tagged: true), not claimed PDF/UA conformance
25. @reportwright/pdf, complex-script shaping: through a HarfBuzz hook (the bench passes harfbuzzjs)
26. @reportwright/pdf, PDF/A: PDF/A-2b, veraPDF in this bench's pdfa job
27. mupdf.js (WASM), forms (create/fill): PDFWidget fill (mupdf.d.ts); not exercised by this harness
28. mupdf.js (WASM), encryption: saveToBuffer encrypt= options; not exercised by this harness
29. mupdf.js (WASM), read/extract text: StructuredText.asText
30. mupdf.js (WASM), merge/split: PDFDocument.graftPage
31. pdf-lib, signing: needs @signpdf/* on top
32. pdf-lib, read/extract text: parses and edits, no text extraction
33. pdfkit, layout engine: text flow, wrapping and columns; no page layout from a definition
34. pdfkit, tables: doc.table() since 0.17
35. pdfkit, complex-script shaping: fontkit applies OpenType features (Arabic works, Indic is weak)
36. pdfkit, streams pages: a Node stream; pages are flushed unless bufferPages
37. pdfkit, PDF/A: subset: 'PDF/A-1b'..'PDF/A-3a' option
38. pdfkit, PDF/UA: tagged structure + pdfVersion/subset 'PDF/UA'; conformance is up to the caller
39. jspdf, tables: basic table(); jspdf-autotable plugin for real tables
40. jspdf, bidi (UBA): bundled bidi engine plugin
41. jspdf, complex-script shaping: Arabic plugin only
42. jspdf, encryption: RC4 128-bit only
43. reportlab, layout engine: Platypus flowables, though the bench drives its canvas with pre-laid-out ops
44. reportlab, bidi (UBA): optional (python-bidi) in 4.x+
45. reportlab, complex-script shaping: optional uharfbuzz in 4.x+
46. PyMuPDF, layout engine: Story / insert_htmlbox (HTML subset)
47. PyMuPDF, tables: through Story HTML tables
48. PyMuPDF, bidi (UBA): in insert_htmlbox only
49. PyMuPDF, complex-script shaping: HarfBuzz in insert_htmlbox only
50. pdfbox, streams pages: scratch-file memory settings; pages stay in the document until save
51. pdfbox, PDF/A: possible by hand (XMP, OutputIntent); Preflight validates
52. pdfbox, PDF/UA: structure tree API, all by hand
53. openpdf, layout engine: Document/ColumnText flow (iText 2 lineage)
54. openpdf, bidi (UBA): RUN_DIRECTION_RTL in ColumnText/PdfPTable
55. openpdf, complex-script shaping: Arabic only
56. openpdf, streams pages: pages are written as they close
57. openpdf, PDF/A: PDF/A-1 conformance flags
58. openpdf, read/extract text: basic PdfTextExtractor
59. itext, layout engine: the layout module, though the bench drives it with pre-laid-out ops
60. itext, bidi (UBA): pdfCalligraph add-on (commercial)
61. itext, complex-script shaping: pdfCalligraph add-on (commercial)
62. itext, streams pages: flushes closed pages
63. PDFsharp, layout engine: MigraDoc (separate package) does layout
64. PDFsharp, PDF/A: PDF/A support added in 6.x
65. PDFsharp, forms (create/fill): fills existing AcroForm fields
66. PDFsharp, signing: digital signatures in 6.x
67. fpdf, layout engine: MultiCell wrapping only
68. fpdf, encryption: RC4 (SetProtection)
69. printpdf, layout engine: 0.8+ added an HTML-to-PDF path (azul); not used in the bench

To verify: pdfmake: PDF/A; pdfmake: PDF/UA; @react-pdf/renderer: complex-script shaping; @react-pdf/renderer: forms (create/fill); @react-pdf/renderer: encryption; jasperreports: forms (create/fill); jasperreports: signing; QuestPDF: PDF/A; QuestPDF: PDF/UA; QuestPDF: encryption; QuestPDF: merge/split; @reportwright/pdf: PDF/UA; mupdf.js (WASM): bidi (UBA); mupdf.js (WASM): complex-script shaping; mupdf.js (WASM): signing; reportlab: PDF/A; PDFsharp: PDF/UA; fpdf: bidi (UBA); printpdf: layout engine; printpdf: tables; printpdf: complex-script shaping; printpdf: PDF/A; printpdf: read/extract text.

## Report engines: Create, plain text (pages)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | QuestPDF | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|---|---|
| 10 | 708 ms · 161 MB | 874 ms · 177 MB | **419 ms · 140 MB** | — | — | — | 1976 ms · 84 MB |
| 100 | 1233 ms · 205 MB | 1350 ms · 225 MB | **1117 ms · 156 MB** | — | — | — | 11.67 s · 225 MB |
| 1,000 | **3187 ms · 295 MB** | 3274 ms · 312 MB | 5932 ms · 301 MB | — | — | — | 112.84 s · 1685 MB |

n/a: jasperreports (a report generator: only the report job)

## PDF writers: Create, plain text (pages)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | itext | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 297 ms · 77 MB | 298 ms · 79 MB | 295 ms · 49 MB | **54 ms · 21 MB** | 1493 ms · 159 MB | 1121 ms · 91 MB | 4665 ms · 342 MB | 416 ms · 100 MB | 297 ms · 98 MB | 2940 ms · 128 MB | 734 ms · 103 MB | 352 ms · 59 MB | 224 ms · 31 MB | 79 ms · 18 MB |
| 100 | 645 ms · 92 MB | 640 ms · 97 MB | 646 ms · 60 MB | **109 ms · 29 MB** | 1806 ms · 174 MB | 1370 ms · 121 MB | 26.50 s · 334 MB | 988 ms · 168 MB | 703 ms · 110 MB | 21.57 s · 167 MB | 1216 ms · 121 MB | 1451 ms · 61 MB | 655 ms · 33 MB | 309 ms · 18 MB |
| 1,000 | 3051 ms · 135 MB | 2965 ms · 132 MB | 3058 ms · 100 MB | **571 ms · 80 MB** | 3042 ms · 313 MB | 2360 ms · 198 MB | 238.34 s · 309 MB | 5757 ms · 399 MB | 4307 ms · 206 MB | 214.57 s · 346 MB | 4549 ms · 154 MB | 11.49 s · 89 MB | 4562 ms · 52 MB | 2608 ms · 103 MB |

## Report engines: Create, grouped report (rows)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | QuestPDF | jasperreports | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|---|---|---|
| 100 | 584 ms · 154 MB | 720 ms · 171 MB | **361 ms · 141 MB** | 2638 ms · 194 MB | — | — | — | 1215 ms · 84 MB |
| 1,000 | 741 ms · 178 MB | 1006 ms · 213 MB | **562 ms · 156 MB** | 3370 ms · 196 MB | — | — | — | 6493 ms · 236 MB |
| 10,000 | **1450 ms · 249 MB** | 2080 ms · 252 MB | 2502 ms · 284 MB | 6274 ms · 274 MB | — | — | — | 66.28 s · 1772 MB |
| 100,000 | **8446 ms · 359 MB** | 8962 ms · 330 MB | 19.70 s · 1386 MB | 14.47 s · 699 MB | — | — | — | OOM |

## PDF writers: Create, grouped report (rows)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | itext | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 229 ms · 73 MB | 243 ms · 75 MB | 282 ms · 44 MB | **54 ms · 23 MB** | 1598 ms · 206 MB | 1121 ms · 89 MB | 1930 ms · 195 MB | 399 ms · 102 MB | 274 ms · 100 MB | 1247 ms · 131 MB | 719 ms · 121 MB | 432 ms · 59 MB | 220 ms · 33 MB | 80 ms · 18 MB |
| 1,000 | 405 ms · 80 MB | 419 ms · 84 MB | 354 ms · 56 MB | **81 ms · 27 MB** | 1789 ms · 197 MB | 1254 ms · 96 MB | 4597 ms · 246 MB | 665 ms · 128 MB | 407 ms · 102 MB | 3631 ms · 156 MB | 1575 ms · 133 MB | 1774 ms · 60 MB | 444 ms · 34 MB | 106 ms · 18 MB |
| 10,000 | 936 ms · 116 MB | 948 ms · 119 MB | 1114 ms · 76 MB | **300 ms · 55 MB** | 2266 ms · 248 MB | 1718 ms · 156 MB | 23.50 s · 234 MB | 2091 ms · 240 MB | 1119 ms · 128 MB | 25.54 s · 361 MB | 7401 ms · 204 MB | 13.90 s · 70 MB | 2536 ms · 45 MB | 497 ms · 86 MB |
| 100,000 | 4801 ms · 177 MB | 4804 ms · 189 MB | 4384 ms · 153 MB | **2196 ms · 351 MB** | 5240 ms · 419 MB | 4262 ms · 372 MB | 226.39 s · 404 MB | 15.90 s · 965 MB | 7309 ms · 324 MB | 287.76 s · 2027 MB | 60.35 s · 1343 MB | 137.04 s · 179 MB | 22.93 s · 158 MB | 4295 ms · 778 MB |

## Report engines: Invoice, cold (new process)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | QuestPDF | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|---|---|
| 1 | 599 ms · 109 MB | 674 ms · 112 MB | **394 ms · 139 MB** | 979 ms · 150 MB | 560 ms · 104 MB | — | 943 ms · 83 MB |

n/a: jasperreports (a report generator: only the report job)

## PDF writers: Invoice, cold (new process)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | itext | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 256 ms · 75 MB | 248 ms · 76 MB | 288 ms · 49 MB | **53 ms · 23 MB** | 1587 ms · 206 MB | 1127 ms · 92 MB | 1477 ms · 140 MB | 411 ms · 105 MB | 233 ms · 97 MB | 837 ms · 129 MB | 557 ms · 105 MB | 270 ms · 59 MB | 192 ms · 34 MB | 80 ms · 18 MB |

## Report engines: Invoice, warm (median of the last 40 of 50 in one process)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | QuestPDF | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|---|---|
| 50 | 17 ms · 216 MB | 17 ms · 206 MB | **8.5 ms · 147 MB** | — | — | — | 152 ms · 125 MB |

n/a: jasperreports (a report generator: only the report job)

## PDF writers: Invoice, warm (median of the last 40 of 50 in one process)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | itext | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 11 ms · 134 MB | 13 ms · 128 MB | **6.4 ms · 69 MB** | 14 ms · 29 MB | 17 ms · 245 MB | 34 ms · 152 MB | 91 ms · 343 MB | 58 ms · 229 MB | 22 ms · 209 MB | 124 ms · 223 MB | 96 ms · 197 MB | 56 ms · 60 MB | 9.7 ms · 34 MB | 55 ms · 18 MB |

## Report engines: Unicode: Hindi, Arabic, CJK

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | QuestPDF | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|---|---|
| 1 | 675 ms · 158 MB | 966 ms · 180 MB | **342 ms · 138 MB** | 789 ms · 151 MB ✗ | 446 ms · 110 MB ✗ | — | 1756 ms · 123 MB |

n/a: jasperreports (a report generator: only the report job)

## PDF writers: Unicode: Hindi, Arabic, CJK

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 249 ms · 88 MB | 223 ms · 90 MB | 285 ms · 62 MB | **79 ms · 52 MB** | 1244 ms · 123 MB | 1256 ms · 151 MB ✗ | 498 ms · 160 MB | 345 ms · 142 MB | 730 ms · 143 MB ✗ | 438 ms · 114 MB ✗ | 939 ms · 91 MB | 244 ms · 70 MB | 1010 ms · 111 MB |

n/a: itext (iText 9.8 throws reading a fixture font's GPOS table (IndexOutOfBoundsException in GposLookupType1))

## Report engines: Images: 6 MP RGBA PNG + 24 MP JPEG

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | QuestPDF | @react-pdf/renderer | pdfmake | puppeteer | weasyprint |
|---:|---|---|---|---|---|
| 1 | 1874 ms · 301 MB | 2816 ms · 840 MB | **1430 ms · 761 MB** | 2773 ms · 285 MB | 2824 ms · 142 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a fixture image is over the engine's 10 MB per-image cap, so the engine leaves it out); @reportwright/engine 0.13.1 (npm) (a fixture image is over the engine's 10 MB per-image cap, so the engine leaves it out); jasperreports (a report generator: only the report job)

## PDF writers: Images: 6 MP RGBA PNG + 24 MP JPEG

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | PDFsharp | fpdf | itext | openpdf | pdfbox | jspdf | mupdf.js (WASM) | pdf-lib | pdfkit | PyMuPDF | reportlab | printpdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1220 ms · 199 MB | 1227 ms · 200 MB | 1433 ms · 187 MB | 651 ms · 178 MB | 2219 ms · 393 MB | 2666 ms · 296 MB | 3374 ms · 229 MB | 5070 ms · 358 MB | 1649 ms · 250 MB | 2398 ms · 217 MB | 1447 ms · 690 MB | 1227 ms · 124 MB | 9542 ms · 375 MB | **369 ms · 190 MB** |

## Report engines: PDF/A-2b invoice (veraPDF)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; one job (create-engines): AMD EPYC 9V74 80-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34) | @reportwright/engine 0.13.1 (npm) | pdfmake | weasyprint |
|---:|---|---|---|---|
| 1 | 600 ms · 109 MB | 708 ms · 112 MB | **572 ms · 103 MB** | 971 ms · 83 MB |

n/a: QuestPDF (not attempted); jasperreports (a report generator: only the report job); @react-pdf/renderer (no PDF/A option); puppeteer (Chrome prints no PDF/A)

## PDF writers: PDF/A-2b invoice (veraPDF)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (create-writers): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | pdfkit |
|---:|---|---|---|
| 1 | 255 ms · 75 MB | **254 ms · 77 MB** | 543 ms · 103 MB |

n/a: PDFsharp (not attempted); fpdf (no PDF/A option); itext (not attempted (needs an ICC profile file)); openpdf (not attempted); pdfbox (PDF/A by hand only (XMP + output intent), not attempted); jspdf (no PDF/A option); mupdf.js (WASM) (no PDF/A output); pdf-lib (no PDF/A option); PyMuPDF (no PDF/A writer); reportlab (PDF/A is in the commercial ReportLab PLUS); printpdf (no PDF/A option)

## Read & edit: Read: text of a 1,200-page PDF

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | pdftotext | PdfPig | itext | openpdf | pdfbox | mupdf.js (WASM) | pdfjs-dist | pdfminer.six | pdfplumber | PyMuPDF | pypdf | pdf-extract |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,200 | 1002 ms · 139 MB | 1119 ms · 139 MB | 1224 ms · 18 MB | 1516 ms · 60 MB | **649 ms · 21 MB** | 2164 ms · 124 MB | 1772 ms · 373 MB | 1538 ms · 385 MB | 3868 ms · 437 MB | 2051 ms · 490 MB | 2767 ms · 262 MB | 33.43 s · 60 MB | OOM | 1206 ms · 75 MB | 4311 ms · 77 MB | 683 ms · 19 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: reading is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: reading is @reportwright/pdf's job); qpdf (no text extraction); PDFsharp (no text extraction); QuestPDF (a writer: it does not read PDFs); fpdf (a writer: it does not read PDFs); pdfcpu (no text extraction); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not read PDFs); jspdf (a writer: it does not read PDFs); pdf-lib (no text extraction); pdfkit (a writer: it does not read PDFs); pdfmake (a writer: it does not read PDFs); puppeteer (a writer: it does not read PDFs); pikepdf (no text extraction); reportlab (a writer: it does not read PDFs); weasyprint (a writer: it does not read PDFs); lopdf (pdf-extract is the reader); printpdf (a writer: it does not read PDFs)

## Read & edit: Read: 11 mixed real-world-style files

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | pdftotext | PdfPig | itext | openpdf | pdfbox | mupdf.js (WASM) | pdfjs-dist | pdfminer.six | pdfplumber | PyMuPDF | pypdf | pdf-extract |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 235 ms · 79 MB | 233 ms · 81 MB | 161 ms · 71 MB ✗ | **137 ms · 71 MB** | 183 ms · 71 MB ✗ | 649 ms · 86 MB | 1008 ms · 163 MB | 719 ms · 149 MB | 1234 ms · 217 MB ✗ | 260 ms · 113 MB ✗ | 448 ms · 148 MB ✗ | 25.49 s · 271 MB ✗ | 3690 ms · 88 MB ✗ | 185 ms · 71 MB ✗ | 343 ms · 71 MB | error |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: reading is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: reading is @reportwright/pdf's job); qpdf (no text extraction); PDFsharp (no text extraction); QuestPDF (a writer: it does not read PDFs); fpdf (a writer: it does not read PDFs); pdfcpu (no text extraction); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not read PDFs); jspdf (a writer: it does not read PDFs); pdf-lib (no text extraction); pdfkit (a writer: it does not read PDFs); pdfmake (a writer: it does not read PDFs); puppeteer (a writer: it does not read PDFs); pikepdf (no text extraction); reportlab (a writer: it does not read PDFs); weasyprint (a writer: it does not read PDFs); lopdf (pdf-extract is the reader); printpdf (a writer: it does not read PDFs)

## Read & edit: Merge 100 files

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | qpdf | PdfPig | PDFsharp | pdfcpu | itext | openpdf | pdfbox | mupdf.js (WASM) | pdf-lib | pikepdf | PyMuPDF | pypdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 204 ms · 81 MB | 224 ms · 85 MB | 92 ms · 71 MB | 92 ms · 71 MB | 114 ms · 71 MB | 1117 ms · 83 MB | 140 ms · 71 MB | **47 ms · 71 MB** | 844 ms · 112 MB | 635 ms · 99 MB | 649 ms · 100 MB | 140 ms · 99 MB | 396 ms · 106 MB | 139 ms · 71 MB | 162 ms · 71 MB | 230 ms · 71 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); pdftotext (a text extractor); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); lopdf (needs ~80 lines of object renumbering; not attempted); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Split 100 pages

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | qpdf | PDFsharp | pdfcpu | itext | openpdf | pdfbox | mupdf.js (WASM) | pdf-lib | pikepdf | PyMuPDF | pypdf | lopdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 217 ms · 85 MB | 249 ms · 89 MB | 394 ms · 71 MB | 92 ms · 71 MB | 92 ms · 71 MB | 141 ms · 71 MB | **72 ms · 71 MB** | 818 ms · 109 MB | 846 ms · 166 MB | 598 ms · 93 MB | 111 ms · 99 MB | 360 ms · 128 MB | 115 ms · 71 MB | 139 ms · 71 MB | 182 ms · 71 MB | 114 ms · 71 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); pdftotext (a text extractor); PdfPig (not attempted); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Encrypt AES-256

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | qpdf | PDFsharp | pdfcpu | itext | pdfbox | pikepdf | PyMuPDF | pypdf |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 147 ms · 76 MB | 176 ms · 79 MB | 94 ms · 71 MB | 94 ms · 71 MB | 165 ms · 71 MB | **46 ms · 71 MB** | 875 ms · 128 MB | 636 ms · 92 MB | 116 ms · 71 MB | 140 ms · 71 MB | 162 ms · 71 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); pdfium (cannot encrypt); pdftotext (a text extractor); PdfPig (cannot encrypt); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); jasperreports (a report generator); openpdf (no AES-256 in OpenPDF 2.2); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); mupdf.js (WASM) (not wired in this harness yet (saveToBuffer has encrypt options)); pdf-lib (cannot encrypt); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); lopdf (not attempted); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Incremental metadata change

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | itext | openpdf | pdfbox | PyMuPDF | pypdf |
|---:|---|---|---|---|---|---|---|
| 1 | 125 ms · 72 MB | **100 ms · 72 MB** | 733 ms · 104 MB | 545 ms · 87 MB | 463 ms · 83 MB | 139 ms · 71 MB | 139 ms · 71 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); mutool (not attempted); pdfium (not attempted); pdftotext (a text extractor); qpdf (rewrites only); PdfPig (not supported); PDFsharp (no incremental save); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); pdfcpu (no incremental save); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); mupdf.js (WASM) (not wired in this harness yet); pdf-lib (no incremental save); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); pikepdf (qpdf rewrites; no incremental save); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); lopdf (not attempted); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Fill and flatten a form

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | itext | openpdf | pdfbox | pdf-lib | PyMuPDF | pypdf |
|---:|---|---|---|---|---|---|---|---|
| 1 | **100 ms · 71 MB** | 122 ms · 71 MB | 861 ms · 119 MB | 619 ms · 91 MB | 669 ms · 105 MB | 296 ms · 98 MB | 139 ms · 71 MB | 139 ms · 71 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); mutool (not attempted); pdfium (not attempted); pdftotext (a text extractor); qpdf (cannot fill); PdfPig (not supported); PDFsharp (no flattening); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); pdfcpu (not attempted); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); mupdf.js (WASM) (not wired in this harness yet); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); pikepdf (not attempted); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); lopdf (not attempted); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Sign (PAdES/CMS, test certificate)

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (read-edit): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | itext | openpdf | pdfbox |
|---:|---|---|---|---|---|
| 1 | 99 ms · 71 MB | **96 ms · 71 MB** | 1113 ms · 153 MB | 760 ms · 101 MB | 705 ms · 96 MB |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); mutool (no signing); pdfium (no signing); pdftotext (a text extractor); qpdf (no signing); PdfPig (not supported); PDFsharp (not attempted); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); pdfcpu (no signing); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); mupdf.js (WASM) (not wired in this harness yet); pdf-lib (no signing); pdfjs-dist (a reader and renderer); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); pdfminer.six (a text extractor); pdfplumber (a text extractor); pikepdf (no signing); PyMuPDF (no signing (needs pyHanko)); pypdf (no signing (needs pyHanko)); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); lopdf (no signing); pdf-extract (a text extractor); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Robustness: fuzzed PDFs

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (robustness): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | pdftotext | qpdf | PdfPig | PDFsharp | pdfcpu | itext | openpdf | pdfbox | mupdf.js (WASM) | pdf-lib | pdfjs-dist | pdfminer.six | pdfplumber | pikepdf | PyMuPDF | pypdf | lopdf | pdf-extract |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 200 | ok 182 clean-error 18 | ok 182 clean-error 18 | ok 63 clean-error 137 | ok 45 clean-error 155 | ok 52 clean-error 148 | ok 30 clean-error 170 | ok 51 clean-error 149 | ok 1 clean-error 199 | ok 41 clean-error 159 | ok 6 clean-error 194 | ok 8 clean-error 192 | ok 176 clean-error 24 | ok 142 clean-error 58 | ok 52 clean-error 148 | ok 43 clean-error 157 | ok 55 clean-error 145 | ok 54 clean-error 146 | ok 158 clean-error 42 | ok 186 clean-error 14 | ok 12 clean-error 188 | ok 67 clean-error 133 | ok 1 clean-error 199 |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); printpdf (a writer: it does not open existing PDFs)

## Read & edit: Robustness: hostile files

_GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group, one job (robustness): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | mutool | pdfium | pdftotext | qpdf | PdfPig | PDFsharp | pdfcpu | itext | openpdf | pdfbox | mupdf.js (WASM) | pdf-lib | pdfjs-dist | pdfminer.six | pdfplumber | pikepdf | PyMuPDF | pypdf | lopdf | pdf-extract |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | ok 4 clean-error 2 | ok 4 clean-error 2 | ok 4 clean-error 2 | ok 5 clean-error 1 | ok 5 clean-error 1 | ok 5 clean-error 1 | ok 5 clean-error 1 | ok 3 crash 2 hang 1 | ok 1 clean-error 5 | ok 1 clean-error 5 | ok 2 clean-error 3 oom 1 | ok 5 oom 1 | ok 3 clean-error 3 | ok 5 clean-error 1 | ok 4 clean-error 2 | ok 3 clean-error 1 hang 2 | ok 3 clean-error 1 hang 2 | ok 5 clean-error 1 | ok 4 clean-error 2 | ok 5 clean-error 1 | ok 6 | ok 5 crash 1 |

n/a: @reportwright/engine (branch perf-startup@13fa2cb34) (a report engine: editing is @reportwright/pdf's job); @reportwright/engine 0.13.1 (npm) (a report engine: editing is @reportwright/pdf's job); QuestPDF (a writer: it does not open existing PDFs); fpdf (a writer: it does not open existing PDFs); jasperreports (a report generator); @react-pdf/renderer (a writer: it does not open existing PDFs); jspdf (a writer: it does not open existing PDFs); pdfkit (a writer: it does not open existing PDFs); pdfmake (a writer: it does not open existing PDFs); puppeteer (a writer: it does not open existing PDFs); reportlab (a writer: it does not open existing PDFs); weasyprint (a writer: it does not open existing PDFs); printpdf (a writer: it does not open existing PDFs)

## Per library (GitHub runs 37982975209 + 38010821519, ubuntu-latest, same code refs (engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949), one run per job group)

| library | lang | league | version | cells | ok | invalid | failed | fastest | n/a tables |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| @reportwright/engine (branch perf-startup@13fa2cb34) | ours | Report engines | 0.13.2-rc.2 (fonts 0.13.2-rc.2) | 11 | 11 | 0 | 0 | 3 | 18 |
| @reportwright/engine 0.13.1 (npm) | ours | Report engines | 0.13.1 (fonts 0.13.1) | 11 | 11 | 0 | 0 | 0 | 18 |
| @reportwright/pdf (branch pdf-lib-own@df15eb949) | ours | PDF writers | 0.1.0-beta.7 (harfbuzzjs 1.6.3) | 22 | 22 | 0 | 0 | 1 | 7 |
| @reportwright/pdf 0.1.0-beta.5 (npm) | ours | PDF writers | 0.1.0-beta.5 (harfbuzzjs 1.6.3) | 22 | 22 | 0 | 0 | 3 | 7 |
| mutool | cli | Read & edit | mutool version 1.23.10 | 7 | 6 | 1 | 0 | 0 | 17 |
| pdfium | cli | Read & edit | 5.14.0 (pdfium 8076) | 6 | 6 | 0 | 0 | 1 | 18 |
| pdftotext | cli | Read & edit | pdftotext version 24.02.0 | 4 | 3 | 1 | 0 | 1 | 20 |
| qpdf | cli | Read & edit | qpdf version 11.9.0 | 5 | 5 | 0 | 0 | 0 | 19 |
| PdfPig | dotnet | Read & edit | 0.1.16 | 5 | 5 | 0 | 0 | 0 | 19 |
| PDFsharp | dotnet | PDF writers | 6.2.4 | 16 | 16 | 0 | 0 | 1 | 13 |
| QuestPDF | dotnet | Report engines | 2026.9.1 | 11 | 11 | 0 | 0 | 7 | 18 |
| fpdf | go | PDF writers | v0.9.0 | 11 | 11 | 0 | 0 | 9 | 18 |
| pdfcpu | go | Read & edit | v0.15.0 | 5 | 5 | 0 | 0 | 3 | 19 |
| itext | java | PDF writers | 9.8.0 | 20 | 20 | 0 | 0 | 0 | 9 |
| jasperreports | java | Report engines | 6.21.5 | 4 | 4 | 0 | 0 | 0 | 23 |
| openpdf | java | PDF writers | 2.2.2 | 20 | 20 | 0 | 0 | 0 | 9 |
| pdfbox | java | PDF writers | 3.0.8 | 21 | 19 | 2 | 0 | 0 | 8 |
| @react-pdf/renderer | js | Report engines | 4.9.0 | 3 | 2 | 1 | 0 | 0 | 18 |
| jspdf | js | PDF writers | 4.2.1 | 11 | 11 | 0 | 0 | 0 | 18 |
| mupdf.js (WASM) | js | PDF writers | 1.28.1 | 17 | 16 | 1 | 0 | 0 | 12 |
| pdf-lib | js | PDF writers | 1.17.1 | 16 | 15 | 1 | 0 | 0 | 13 |
| pdfjs-dist | js | Read & edit | 6.4.299 | 4 | 3 | 1 | 0 | 0 | 20 |
| pdfkit | js | PDF writers | 0.20.2 | 12 | 11 | 1 | 0 | 0 | 17 |
| pdfmake | js | Report engines | 0.3.11 | 4 | 3 | 1 | 0 | 2 | 17 |
| puppeteer | js | Report engines | 25.13.0 (Chrome/155.0.8059.39) | 1 | 1 | 0 | 0 | 0 | 18 |
| pdfminer.six | python | Read & edit | 20260107 | 4 | 3 | 1 | 0 | 0 | 20 |
| pdfplumber | python | Read & edit | 0.11.10 | 4 | 2 | 1 | 1 | 0 | 20 |
| pikepdf | python | Read & edit | 10.16.0 | 5 | 5 | 0 | 0 | 0 | 19 |
| PyMuPDF | python | PDF writers | 1.28.2 | 20 | 19 | 1 | 0 | 0 | 9 |
| pypdf | python | Read & edit | 6.20.0 | 9 | 9 | 0 | 0 | 0 | 15 |
| reportlab | python | PDF writers | 5.0.1 | 11 | 11 | 0 | 0 | 0 | 18 |
| weasyprint | python | Report engines | 70.0 | 12 | 11 | 0 | 1 | 0 | 17 |
| lopdf | rust | Read & edit | 0.45.0 | 3 | 3 | 0 | 0 | 0 | 21 |
| pdf-extract | rust | Read & edit | 0.12.1 | 4 | 3 | 0 | 1 | 0 | 20 |
| printpdf | rust | PDF writers | 0.12.8 | 11 | 11 | 0 | 0 | 1 | 18 |


---

# Million-row tier (run 38015964690)


Run 2026-10-10T02:15:53Z, tier `million`, 5 measured runs a cell after one warm-up (fewer for the biggest sizes, see README). Memory cap 4000 MB a run. Same-machine layout: each job group (create-writers, create-engines, read-edit, robustness) ran every contestant in one job, interleaved run by run; the line above each table names the runner hardware (CPU model) of the columns in it. Rankings and "where we lose" compare ours with the best other library, never one build of ours with another.

Cells: median wall time from process start to exit (warm invoice: in-process median) · peak RSS. ✗ = the output failed a check (qpdf, MuPDF, pdf.js, or the job's own text check) and is not ranked. **Bold** = fastest valid. Create jobs are ranked within a league: **report engines** lay pages out themselves from a report/table definition; **PDF writers** execute the same pre-laid-out draw ops. Read and edit jobs are one league. Full numbers (CPU, min–max, time to first byte, sizes, checks) are in results.json and results.html.

## Headline (GitHub run 38015964690, ubuntu-latest)

- PDF writers: Create, grouped report (rows): @reportwright/pdf (branch pdf-lib-own@df15eb949), @reportwright/pdf 0.1.0-beta.5 (npm) #1 in 0 of 2 (size, build) rows; behind openpdf (2.35–2.53×; 2 rows)

## Old vs new, ours on the same machine (GitHub run 38015964690, ubuntu-latest)

- Report engines: Create, grouped report (rows) at 1,000,000: @reportwright/engine (branch perf-startup@13fa2cb34, parallel 'auto') 67.45 s · 782 MB vs @reportwright/engine 0.13.1 (npm) 93.91 s · 791 MB = 0.72× time, 0.99× RSS
- Report engines: Create, grouped report (rows) at 1,000,000: @reportwright/engine (branch perf-startup@13fa2cb34, parallel off) 64.10 s · 782 MB vs @reportwright/engine 0.13.1 (npm) 93.91 s · 791 MB = 0.68× time, 0.99× RSS
- PDF writers: Create, grouped report (rows) at 1,000,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 27.10 s · 682 MB vs @reportwright/pdf 0.1.0-beta.5 (npm) 25.19 s · 643 MB = 1.08× time, 1.06× RSS

## Not re-measured (more than 20% slower than ReportWright in run 37982975209)

- Create, grouped report (rows) (PDF writers): pdfkit 12.57× ours at 100,000
- Create, grouped report (rows) (PDF writers): reportlab 4.77× ours at 100,000
- Create, grouped report (rows) (PDF writers): PyMuPDF 28.54× ours at 100,000
- Create, grouped report (rows) (PDF writers): pdfbox 47.15× ours at 100,000

## Where we lose (GitHub run 38015964690, ubuntu-latest)

**PDF writers**

- Create, grouped report (rows) at 1,000,000: @reportwright/pdf (branch pdf-lib-own@df15eb949) 2.53× openpdf
- Create, grouped report (rows) at 1,000,000: @reportwright/pdf 0.1.0-beta.5 (npm) 2.35× openpdf

## Capabilities

Not measured: what each library documents. ✅ yes, ❌ no, partial (see note), ? not verified.

| library | layout engine | tables | bidi (UBA) | complex-script shaping | streams pages | PDF/A | PDF/UA | forms (create/fill) | signing | encryption | read/extract text | merge/split | runtime deps | license |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| @reportwright/engine | ✅ | ✅ | ✅ [1] | ✅ [2] | ✅ [3] | ✅ [4] | ✅ [5] | ❌ | ❌ | ✅ [6] | ❌ | ❌ | 0.13.1: pdf-lib, @pdf-lib/fontkit, bwip-js, fflate, bidi-js (+ optional peer @reportwright/fonts); perf-startup: fflate replaced by @reportwright/pdf [7] | MIT |
| pdfmake | ✅ | ✅ | ❌ | ❌ | ❌ | ? [8] | ? | ❌ | ❌ | ✅ [9] | ❌ | ❌ | pdfkit (fontkit), xmldoc | MIT |
| @react-pdf/renderer | ✅ [10] | partial [11] | ❌ | ? | ❌ | ❌ | ❌ | ? | ❌ | ? | ❌ | ❌ | @react-pdf/* (a PDFKit fork, yoga-layout, fontkit); react as a peer | MIT |
| jasperreports | ✅ | ✅ | partial [12] | partial [13] | partial [14] | ✅ | ✅ [15] | ? | ? | ✅ | ❌ | ❌ | many: OpenPDF, commons-*, Jackson, ... | LGPL-3.0 |
| QuestPDF | ✅ | ✅ | ✅ [16] | ✅ [17] | ❌ | ? | ? | ❌ | ❌ | ? | ❌ | ? | SkiaSharp-based native renderer (bundled) | Community licence (free under $1M revenue), else commercial |
| weasyprint | ✅ | ✅ | ✅ [18] | ✅ [19] | ❌ | ✅ [20] | ✅ [21] | ✅ [22] | ❌ | ❌ | ❌ | ❌ | Pango (native), pydyf, tinycss2, cssselect2, fontTools, Pillow | BSD-3-Clause |
| puppeteer | ✅ | ✅ | ✅ | ✅ | ❌ [23] | ❌ | partial [24] | ❌ | ❌ | ❌ | ❌ | ❌ | a full Chrome (~170 MB download) | Apache-2.0 (Chrome: BSD-3-Clause and others) |
| @reportwright/pdf | ❌ | ❌ | ❌ | ✅ [25] | ✅ | ✅ [26] | ? | ✅ | ✅ | ✅ | ✅ | ✅ | 0 | MIT |
| mupdf.js (WASM) | ❌ | ❌ | ? | ? | ❌ | ❌ | ❌ | ✅ [27] | ? | ✅ [28] | ✅ [29] | ✅ [30] | none (MuPDF compiled to WebAssembly, bundled) | AGPL-3.0 or commercial |
| pdf-lib | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ [31] | ❌ | ❌ [32] | ✅ | @pdf-lib/standard-fonts, @pdf-lib/upng, pako, tslib | MIT |
| pdfkit | partial [33] | partial [34] | ❌ | partial [35] | ✅ [36] | ✅ [37] | partial [38] | ✅ | ❌ | ✅ | ❌ | ❌ | fontkit, crypto-js, linebreak, png-js, jpeg-exif | MIT |
| jspdf | ❌ | partial [39] | partial [40] | partial [41] | ❌ | ❌ | ❌ | ✅ | ❌ | partial [42] | ❌ | ❌ | fflate, @babel/runtime (+ optional html2canvas, canvg, dompurify) | MIT |
| reportlab | ✅ [43] | ✅ | partial [44] | partial [45] | ❌ | ? | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | Pillow, charset-normalizer | BSD-3-Clause |
| PyMuPDF | partial [46] | partial [47] | partial [48] | partial [49] | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | bundled MuPDF (native) | AGPL-3.0 or commercial |
| pdfbox | ❌ | ❌ | ❌ | ❌ | partial [50] | partial [51] | partial [52] | ✅ | ✅ | ✅ | ✅ | ✅ | fontbox, pdfbox-io, commons-logging | Apache-2.0 |
| openpdf | partial [53] | ✅ | partial [54] | partial [55] | ✅ [56] | partial [57] | ❌ | ✅ | ✅ | ✅ | partial [58] | ✅ | none required (BouncyCastle optional, for signing/encryption) | LGPL-2.1 / MPL-2.0 |
| itext | ✅ [59] | ✅ | partial [60] | partial [61] | ✅ [62] | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | bouncy-castle-adapter, slf4j (core) | AGPL-3.0 or commercial |
| PDFsharp | ❌ [63] | ❌ | ❌ | ❌ | ❌ | partial [64] | ? | partial [65] | ✅ [66] | ✅ | ❌ | ✅ | none (managed) | MIT |
| fpdf | partial [67] | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | partial [68] | ❌ | ❌ | none | MIT |
| printpdf | ? [69] | ? | ❌ | ? | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ? | ❌ | lopdf, allsorts, image, ... | MIT |

1. @reportwright/engine, bidi (UBA): bidi-js (src/engine/text/measure.js runs the Unicode bidi algorithm on the complex path)
2. @reportwright/engine, complex-script shaping: HarfBuzz wasm called directly (src/engine/text/shaper.js)
3. @reportwright/engine, streams pages: exportPdfStream (packages/engine/README.md, 'Streaming PDF for large reports')
4. @reportwright/engine, PDF/A: PDF/A-2b and 2a, veraPDF-validated (packages/engine/README.md)
5. @reportwright/engine, PDF/UA: PDF/UA-1 tagging, `pw render --pdfa --ua` (packages/engine/README.md)
6. @reportwright/engine, encryption: AES-256 passwords and permissions (packages/engine/README.md)
7. @reportwright/engine, runtime deps: scripts/build-packages.mjs `external` on main vs perf-startup
8. pdfmake, PDF/A: PDFKit has a PDF/A subset option; whether pdfmake 0.3 exposes it is unverified
9. pdfmake, encryption: through PDFKit's userPassword/ownerPassword
10. @react-pdf/renderer, layout engine: Yoga flexbox
11. @react-pdf/renderer, tables: no table primitive: rows and cells are built from flex Views
12. jasperreports, bidi (UBA): run direction from Java's text layout; PDF export through OpenPDF has known gaps with RTL
13. jasperreports, complex-script shaping: depends on the PDF exporter's font handling (OpenPDF): Indic shaping is not reliable
14. jasperreports, streams pages: virtualizers swap filled pages to disk; the print is still built before export
15. jasperreports, PDF/UA: tagged PDF export with accessibility properties
16. QuestPDF, bidi (UBA): ContentDirection RTL, text through Skia + HarfBuzz
17. QuestPDF, complex-script shaping: HarfBuzz through Skia
18. weasyprint, bidi (UBA): Pango
19. weasyprint, complex-script shaping: Pango + HarfBuzz
20. weasyprint, PDF/A: --pdf-variant pdf/a-*
21. weasyprint, PDF/UA: --pdf-variant pdf/ua-1
22. weasyprint, forms (create/fill): creates AcroForm fields from HTML inputs (--pdf-forms); no filling of existing PDFs
23. puppeteer, streams pages: printToPDF can return a stream, but the whole document is laid out first
24. puppeteer, PDF/UA: Chrome writes tagged PDF (tagged: true), not claimed PDF/UA conformance
25. @reportwright/pdf, complex-script shaping: through a HarfBuzz hook (the bench passes harfbuzzjs)
26. @reportwright/pdf, PDF/A: PDF/A-2b, veraPDF in this bench's pdfa job
27. mupdf.js (WASM), forms (create/fill): PDFWidget fill (mupdf.d.ts); not exercised by this harness
28. mupdf.js (WASM), encryption: saveToBuffer encrypt= options; not exercised by this harness
29. mupdf.js (WASM), read/extract text: StructuredText.asText
30. mupdf.js (WASM), merge/split: PDFDocument.graftPage
31. pdf-lib, signing: needs @signpdf/* on top
32. pdf-lib, read/extract text: parses and edits, no text extraction
33. pdfkit, layout engine: text flow, wrapping and columns; no page layout from a definition
34. pdfkit, tables: doc.table() since 0.17
35. pdfkit, complex-script shaping: fontkit applies OpenType features (Arabic works, Indic is weak)
36. pdfkit, streams pages: a Node stream; pages are flushed unless bufferPages
37. pdfkit, PDF/A: subset: 'PDF/A-1b'..'PDF/A-3a' option
38. pdfkit, PDF/UA: tagged structure + pdfVersion/subset 'PDF/UA'; conformance is up to the caller
39. jspdf, tables: basic table(); jspdf-autotable plugin for real tables
40. jspdf, bidi (UBA): bundled bidi engine plugin
41. jspdf, complex-script shaping: Arabic plugin only
42. jspdf, encryption: RC4 128-bit only
43. reportlab, layout engine: Platypus flowables, though the bench drives its canvas with pre-laid-out ops
44. reportlab, bidi (UBA): optional (python-bidi) in 4.x+
45. reportlab, complex-script shaping: optional uharfbuzz in 4.x+
46. PyMuPDF, layout engine: Story / insert_htmlbox (HTML subset)
47. PyMuPDF, tables: through Story HTML tables
48. PyMuPDF, bidi (UBA): in insert_htmlbox only
49. PyMuPDF, complex-script shaping: HarfBuzz in insert_htmlbox only
50. pdfbox, streams pages: scratch-file memory settings; pages stay in the document until save
51. pdfbox, PDF/A: possible by hand (XMP, OutputIntent); Preflight validates
52. pdfbox, PDF/UA: structure tree API, all by hand
53. openpdf, layout engine: Document/ColumnText flow (iText 2 lineage)
54. openpdf, bidi (UBA): RUN_DIRECTION_RTL in ColumnText/PdfPTable
55. openpdf, complex-script shaping: Arabic only
56. openpdf, streams pages: pages are written as they close
57. openpdf, PDF/A: PDF/A-1 conformance flags
58. openpdf, read/extract text: basic PdfTextExtractor
59. itext, layout engine: the layout module, though the bench drives it with pre-laid-out ops
60. itext, bidi (UBA): pdfCalligraph add-on (commercial)
61. itext, complex-script shaping: pdfCalligraph add-on (commercial)
62. itext, streams pages: flushes closed pages
63. PDFsharp, layout engine: MigraDoc (separate package) does layout
64. PDFsharp, PDF/A: PDF/A support added in 6.x
65. PDFsharp, forms (create/fill): fills existing AcroForm fields
66. PDFsharp, signing: digital signatures in 6.x
67. fpdf, layout engine: MultiCell wrapping only
68. fpdf, encryption: RC4 (SetProtection)
69. printpdf, layout engine: 0.8+ added an HTML-to-PDF path (azul); not used in the bench

To verify: pdfmake: PDF/A; pdfmake: PDF/UA; @react-pdf/renderer: complex-script shaping; @react-pdf/renderer: forms (create/fill); @react-pdf/renderer: encryption; jasperreports: forms (create/fill); jasperreports: signing; QuestPDF: PDF/A; QuestPDF: PDF/UA; QuestPDF: encryption; QuestPDF: merge/split; @reportwright/pdf: PDF/UA; mupdf.js (WASM): bidi (UBA); mupdf.js (WASM): complex-script shaping; mupdf.js (WASM): signing; reportlab: PDF/A; PDFsharp: PDF/UA; fpdf: bidi (UBA); printpdf: layout engine; printpdf: tables; printpdf: complex-script shaping; printpdf: PDF/A; printpdf: read/extract text.

## Report engines: Create, grouped report (rows)

_GitHub run 38015964690, ubuntu-latest, one job (create-engines): AMD EPYC 7763 64-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/engine (branch perf-startup@13fa2cb34, parallel 'auto') | @reportwright/engine (branch perf-startup@13fa2cb34, parallel off) | @reportwright/engine 0.13.1 (npm) |
|---:|---|---|---|
| 1,000,000 | 67.45 s · 782 MB | **64.10 s · 782 MB** | 93.91 s · 791 MB |

## PDF writers: Create, grouped report (rows)

_GitHub run 38015964690, ubuntu-latest, one job (create-writers): AMD EPYC 9V45 96-Core Processor × 2 vCPU, 7.8 GB RAM, contestants interleaved run by run; ours built from engine perf-startup@13fa2cb34,pdf pdf-lib-own@df15eb949_

| size | @reportwright/pdf (branch pdf-lib-own@df15eb949) | @reportwright/pdf 0.1.0-beta.5 (npm) | itext | openpdf |
|---:|---|---|---|---|
| 1,000,000 | 27.10 s · 682 MB | 25.19 s · 643 MB | OOM | **10.72 s · 675 MB** |

## Per library (GitHub run 38015964690, ubuntu-latest)

| library | lang | league | version | cells | ok | invalid | failed | fastest | n/a tables |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| @reportwright/engine (branch perf-startup@13fa2cb34, parallel 'auto') | ours | Report engines | 0.13.2-rc.2 (fonts 0.13.2-rc.2) | 1 | 1 | 0 | 0 | 0 | 1 |
| @reportwright/engine (branch perf-startup@13fa2cb34, parallel off) | ours | Report engines | 0.13.2-rc.2 (fonts 0.13.2-rc.2) | 1 | 1 | 0 | 0 | 1 | 1 |
| @reportwright/engine 0.13.1 (npm) | ours | Report engines | 0.13.1 (fonts 0.13.1) | 1 | 1 | 0 | 0 | 0 | 1 |
| @reportwright/pdf (branch pdf-lib-own@df15eb949) | ours | PDF writers | 0.1.0-beta.7 (harfbuzzjs 1.6.3) | 1 | 1 | 0 | 0 | 0 | 1 |
| @reportwright/pdf 0.1.0-beta.5 (npm) | ours | PDF writers | 0.1.0-beta.5 (harfbuzzjs 1.6.3) | 1 | 1 | 0 | 0 | 0 | 1 |
| itext | java | PDF writers | 9.8.0 | 1 | 0 | 0 | 1 | 0 | 1 |
| openpdf | java | PDF writers | 2.2.2 | 1 | 1 | 0 | 0 | 1 | 1 |
