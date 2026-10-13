# ReportWright vs pdfmake, @react-pdf/renderer and jsPDF

All four are JavaScript. pdfmake and @react-pdf/renderer lay out a document from a description (like ReportWright's engine); jsPDF is a lower-level drawing API, so it is compared with ReportWright's own PDF writer, [`@reportwright/pdf`](https://www.npmjs.com/package/@reportwright/pdf).

Median wall time · peak memory (warm invoice: in-process median). Bold is the fastest. ReportWright is the 1.0 code (`main@944e09eb`); everything below is GitHub run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719) (ubuntu-latest, every contestant in the same job) unless noted.

## Report engines

| job | ReportWright | pdfmake 0.3 | @react-pdf/renderer |
|---|---|---|---|
| Grouped report, 100 rows | **271 ms · 94 MB** | 564 ms · 119 MB | 1236 ms · 162 MB |
| Grouped report, 1,000 rows | **399 ms · 118 MB** | 1439 ms · 141 MB | 10.14 s · 360 MB |
| Grouped report, 10,000 rows | **1132 ms · 192 MB** | 8150 ms · 330 MB | timeout |
| Plain text, 10 pages | **188 ms · 99 MB** | 432 ms · 119 MB | 1124 ms · 158 MB |
| Plain text, 100 pages | **354 ms · 142 MB** | 1111 ms · 159 MB | 6807 ms · 318 MB |
| Invoice, single (new process) | **188 ms · 97 MB** | 285 ms · 103 MB | 405 ms · 150 MB |
| Invoice, warm (50 in one process) | **9.0 ms** | 52 ms | 28 ms |
| Unicode: Hindi, Arabic, CJK | **186 ms** | 212 ms, **output failed the check** | 333 ms, **output failed the check** |
| PDF/A-2b invoice (veraPDF) | **187 ms · 97 MB** | 254 ms · 103 MB | no PDF/A option |
| Images: 6 MP PNG + 24 MP JPEG | not measured (over the engine's 10 MB per-image cap) | **899 ms** · 592 MB | 1741 ms · 954 MB |

Bulk, 1,000 files (GitHub run [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290), same code), files per second:

| job | ReportWright, pool | ReportWright, one process | pdfmake |
|---|---:|---:|---:|
| report | **158.9** | 128.5 | 6.3 |
| invoice | **136.8** | 83.2 | 11.1 |
| PDF/A invoice | **111.7** | 73.0 | 11.0 |
| plain | **87.3** | 60.0 | 3.4 |
| unicode | **399.6** | 327.8 | 18.0 (output failed the check) |

Where they win: pdfmake and @react-pdf/renderer both handle the large-image job the engine skips. On pdfmake's own showcase (30 orders with nested 5-line tables; run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719)) pdfmake took 261 ms against our 455 ms. The ReportWright worker pool uses about 3× the memory of one process (416 to 497 MB on the bulk jobs).

## jsPDF vs @reportwright/pdf (low-level writers)

Same run (create-writers job), `@reportwright/pdf` 0.1.0-beta.15 from npm (the build released as 1.0.0), jsPDF 4.2.

| job | @reportwright/pdf | jsPDF |
|---|---|---|
| Grouped report, 100 rows | **159 ms · 72 MB** | 335 ms · 106 MB |
| Grouped report, 1,000 rows | **240 ms · 79 MB** | 505 ms · 129 MB |
| Grouped report, 10,000 rows | **614 ms · 116 MB** | 1861 ms · 241 MB |
| Plain text, 100 pages | **420 ms · 110 MB** | 865 ms · 164 MB |
| Invoice, single | **188 ms · 73 MB** | 319 ms · 111 MB |
| Invoice, warm | **8.5 ms** | 55 ms |
| Unicode | **181 ms · 88 MB** | 407 ms · 161 MB |
| Images | **991 ms · 197 MB** | 4791 ms · 377 MB |

