# PDF without Chromium: ReportWright vs Puppeteer

Puppeteer prints HTML to PDF by driving a headless Chromium. ReportWright lays pages out itself in JavaScript (HarfBuzz for shaping, its own PDF writer) and writes the PDF directly: no browser download, no browser process, and the same code runs in Node, a worker, or the browser.

## Numbers

GitHub run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719) (create-engines job, ubuntu-latest, every contestant in the same job). Median wall time · peak memory. ReportWright is the 1.0 code (`main@944e09eb`); Puppeteer 25.13 with Chrome 155. Bold is the fastest.

| job | ReportWright | Puppeteer |
|---|---|---|
| Grouped report, 100 rows | **271 ms · 94 MB** | 911 ms · 213 MB |
| Grouped report, 1,000 rows | **399 ms · 118 MB** | 1861 ms · 268 MB |
| Grouped report, 10,000 rows | **1132 ms · 192 MB** | 20.31 s · 305 MB |
| Plain text, 10 pages | **188 ms · 99 MB** | 618 ms · 210 MB |
| Plain text, 100 pages | **354 ms · 142 MB** | 1428 ms · 259 MB |
| Invoice, single (new process) | **188 ms · 97 MB** | 583 ms · 208 MB |
| Invoice, warm (50 in one process) | **9.0 ms · 121 MB** | 102 ms · 218 MB |
| Unicode: Hindi, Arabic, CJK | **186 ms · 94 MB** | 668 ms · 208 MB |
| Images: 6 MP PNG + 24 MP JPEG | not measured (over the engine's 10 MB per-image cap) | 1331 ms · 286 MB |

## The 100,000-row failure

In an earlier run (GitHub run [38108358599](https://github.com/MrArun005/reportwright/actions/runs/38108358599), 10 Oct 2026; not repeated for 1.0) Puppeteer did not produce the 100,000-row file: the page building the 2,084-page document was detached from Chromium mid-render (`Error: Navigating frame was detached`). ReportWright streams pages to the PDF as they are laid out; on the 1.0 code it wrote the grouped report at 1,000,000 rows in 52.4 s at 718 MB, or 48.0 s at 1,560 MB with parallel paint (GitHub run [38312329287](https://github.com/MrArun005/reportwright/actions/runs/38312329287)).

## Where Puppeteer wins

- HTML/CSS input. ReportWright has no HTML/CSS layout: on Puppeteer's own showcase (gradient header, flexbox card grid, rounded corners, shadows; run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719)) there is nothing to compare, because linear-gradient, flexbox and box-shadow cannot be expressed in a report (rich text is an HTML subset of paragraphs, spans and lists).

## Where Puppeteer is the right tool

- You already have the page as HTML/CSS and want it printed exactly as a browser draws it.
- Large images: the engine leaves out any image over its 10 MB per-image cap, so it was not measured on the 6 MP PNG + 24 MP JPEG job; Puppeteer did it in 1331 ms (run 38317309719).
