# PDF without Chromium: ReportWright vs Puppeteer

Puppeteer prints HTML to PDF by driving a headless Chromium. ReportWright lays pages out itself in JavaScript (HarfBuzz for shaping, its own PDF writer) and writes the PDF directly: no browser download, no browser process, and the same code runs in Node, a worker, or the browser.

## Numbers

GitHub run [38108358599](https://github.com/MrArun005/reportwright/actions/runs/38108358599) (create-engines job, ubuntu-latest, every contestant in the same job). Median warm time · median peak memory (RSS as the harness measured it). "ReportWright rc" is engine branch `engine-pdf12@091f9b6fa`; "0.13.1" is the npm release. Bold is the fastest.

Grouped report (rows):

| rows | ReportWright rc | ReportWright 0.13.1 | Puppeteer |
|---:|---|---|---|
| 100 | **145 ms · 93 MB** | 288 ms · 172 MB | 625 ms · 212 MB |
| 1,000 | **279 ms · 118 MB** | 532 ms · 208 MB | 1515 ms · 266 MB |
| 10,000 | **913 ms · 179 MB** | 1494 ms · 252 MB | 20.32 s · 305 MB |
| 100,000 | **6.64 s · 300 MB** | 8.94 s · 325 MB | **failed**: `Navigating frame was detached` |

Plain text (pages):

| pages | ReportWright rc | ReportWright 0.13.1 | Puppeteer |
|---:|---|---|---|
| 10 | **129 ms · 100 MB** | 231 ms · 178 MB | 540 ms · 211 MB |
| 100 | **413 ms · 144 MB** | 507 ms · 226 MB | 1532 ms · 259 MB |
| 1,000 | 1810 ms · 230 MB | **1699 ms · 320 MB** | 20.00 s · 296 MB |

Other jobs, same run:

| job | ReportWright rc | ReportWright 0.13.1 | Puppeteer |
|---|---|---|---|
| Invoice, single | **125 ms · 97 MB** | 308 ms · 112 MB | 440 ms · 208 MB |
| Invoice, warm (50 in one process) | 16.4 ms · 126 MB | **12.2 ms · 220 MB** | 118.9 ms · 218 MB |
| Unicode: Hindi, Arabic, CJK | **111 ms · 94 MB** | 306 ms · 179 MB | 556 ms · 206 MB |

## The 100,000-row failure

At 100,000 rows Puppeteer did not produce a file: the page building the 2,084-page document was detached from Chromium mid-render (`Error: Navigating frame was detached`). ReportWright streams pages to the PDF as they are laid out, so memory stays near 300 MB at 100,000 rows; at 1,000,000 rows (GitHub run [38108358497](https://github.com/MrArun005/reportwright/actions/runs/38108358497)) the rc wrote 20,834 pages in 53.3 s at 746 MB.

## Where Puppeteer is the right tool

- You already have the page as HTML/CSS and want it printed exactly as a browser draws it.
- Large images: the engine leaves out any image over its 10 MB per-image cap, so it was not measured on the 6 MP PNG + 24 MP JPEG job; Puppeteer did it in 1499 ms (same run).
