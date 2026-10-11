# ReportWright vs pdfmake, @react-pdf/renderer and jsPDF

All four are JavaScript. pdfmake and @react-pdf/renderer lay out a document from a description (like ReportWright's engine); jsPDF is a lower-level drawing API, so it is compared with ReportWright's own PDF writer, [`@reportwright/pdf`](https://www.npmjs.com/package/@reportwright/pdf).

Median warm time · median peak memory. Bold is the fastest. "ReportWright rc" is engine branch `engine-pdf12@091f9b6fa`; "0.13.1" is the npm release.

## Report engines

GitHub run [38108358599](https://github.com/MrArun005/reportwright/actions/runs/38108358599) (create-engines job, ubuntu-latest).

Grouped report (rows):

| rows | ReportWright rc | ReportWright 0.13.1 | pdfmake | @react-pdf/renderer |
|---:|---|---|---|---|
| 100 | **145 ms · 93 MB** | 288 ms · 172 MB | 388 ms · 118 MB | 967 ms · 165 MB |
| 1,000 | **279 ms · 118 MB** | 532 ms · 208 MB | 1307 ms · 142 MB | 10.02 s · 357 MB |
| 10,000 | **913 ms · 179 MB** | 1494 ms · 252 MB | 8.14 s · 333 MB | 644.77 s · 1584 MB |
| 100,000 | **6.64 s · 300 MB** | 8.94 s · 325 MB | 73.20 s · 1951 MB | **crashed** (V8 out of memory at 2152 MB) |

Plain text (pages):

| pages | ReportWright rc | ReportWright 0.13.1 | pdfmake | @react-pdf/renderer |
|---:|---|---|---|---|
| 10 | **129 ms · 100 MB** | 231 ms · 178 MB | 463 ms · 121 MB | 1398 ms · 165 MB |
| 100 | **413 ms · 144 MB** | 507 ms · 226 MB | 1464 ms · 158 MB | 11.28 s · 319 MB |
| 1,000 | 1810 ms · 230 MB | **1699 ms · 320 MB** | 10.87 s · 489 MB | 115.88 s · 1830 MB |

Other jobs, same run:

| job | ReportWright rc | ReportWright 0.13.1 | pdfmake | @react-pdf/renderer |
|---|---|---|---|---|
| Invoice, warm (50 in one process) | 16.4 ms | **12.2 ms** | 81.1 ms | 46.0 ms |
| Unicode: Hindi, Arabic, CJK | **111 ms** | 306 ms | 123 ms, **output failed the check** | 208 ms, **output failed the check** |
| Images: 6 MP PNG + 24 MP JPEG | not measured (over the engine's 10 MB per-image cap) | — | 1266 ms · 591 MB | 2476 ms · 981 MB |

Bulk, 1,000 files (GitHub run [38114383349](https://github.com/MrArun005/reportwright/actions/runs/38114383349), engine `engine-pdf12@9118d0f93`), files per second:

| job | ReportWright, pool | ReportWright, one process | pdfmake |
|---|---:|---:|---:|
| report | **124.9** | 92.1 | 6.2 |
| invoice | **89.2** | 58.1 | 11.1 |
| plain | **82.4** | 55.1 | 3.6 |
| unicode | **277.8** | 180.4 | 18.4 (output failed the check) |

Where they win: pdfmake was 1.05× faster than ReportWright on the PDF/A invoice in the run published in [`bench/deep/RESULTS.md`](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md) (runs 37982975209 + 38010821519), and pdfmake and @react-pdf/renderer both handle the large-image job the engine currently skips. The ReportWright worker pool uses 2.4× to 3.7× the memory of one process (348 to 541 MB on the bulk jobs).

## jsPDF vs @reportwright/pdf (low-level writers)

GitHub run [38108358558](https://github.com/MrArun005/reportwright/actions/runs/38108358558) (create-writers job), `@reportwright/pdf` 0.1.0-beta.12 from npm.

| job | @reportwright/pdf | jsPDF |
|---|---|---|
| Grouped report, 100 rows | **38.9 ms · 72 MB** | 96.0 ms · 103 MB |
| Grouped report, 10,000 rows | **306 ms · 117 MB** | 903 ms · 233 MB |
| Grouped report, 100,000 rows | **1991 ms · 179 MB** | 8244 ms · 983 MB |
| Plain text, 1,000 pages | **1230 ms · 121 MB** | 2916 ms · 402 MB |
| Invoice, single | **49.6 ms · 73 MB** | 106.3 ms · 109 MB |
| Invoice, warm | **5.4 ms** | 36.9 ms |
| Unicode | **48.8 ms · 87 MB** | 146.3 ms · 160 MB |
| Images | **633 ms · 197 MB** | 2872 ms · 377 MB |

