# Status — all phases

4 Oct 2026. Everything below runs and is covered by tests unless the line says otherwise. Phase 1 detail: [`PHASE1.md`](PHASE1.md).

## Test results at this commit

| Check | Result |
|---|---|
| Vitest (engine unit + golden) | 9 files, **65 tests pass** |
| e2e: build-from-scratch, smoke, expr-editor, phase2, phase3, phase4, api | **all pass**, 0 console errors |
| PDF matches page model (300-row sample) | 2,237 lines on 8 pages, **0 mismatches**, 260 KB |
| Engine boundary | no React, Next or DOM in `src/engine` |
| Performance | **50,000 rows → 1,112 pages in 1.6 s** (one Node process) |

## Phase 1 — foundations

Engine, expressions, data sources, text box / image / line / shape / table, paginator, page bands, viewer, designer, PDF export, server PDF route. See `PHASE1.md`.

## Phase 2 — real-world reports

| Area | Delivered |
|---|---|
| Groups | Nested table groups with group header / footer rows, subtotals by scope, sort groups, page break between groups, keep together, keep with next |
| Drill-down | Collapsible groups with ▼/▶ toggles; the state goes back to the engine, so pages and totals stay correct |
| Interactive sort | Click a header to sort detail rows |
| List, container, check box | List repeats per record or per group; tables in a list filter by `Parent` |
| Parameters | Options lists, options from a data set, multi-value (check boxes), cascading parameters |
| Links | Hyperlinks, bookmarks, drill-through to another report; links and an outline in the PDF |
| Viewer | Document map, search with highlights, Excel / HTML / CSV export, Hindi UI (`?lang=hi`) |
| Data | GraphQL source; filters with `in` for multi-value parameters |
| Designer | Groups editor, sort / filter editor, action editor, list and container nesting, copy / paste |

## Phase 3 — visual and advanced items

| Area | Delivered |
|---|---|
| Charts | Column, bar, line, area, pie, donut, scatter; series editor; nice axis scales; live preview in the designer |
| Matrix | Pivot rows × columns with totals |
| Barcodes | Code 128, QR, EAN-13 and others via bwip-js, drawn as vector paths (sharp in PDF) |
| Data visuals | Sparkline, data bar and bullet in table cells, with colour expressions |
| Subreports | Child report per row with parameters; guard against loops and deep nesting |
| Server | Render to every format on the server (`/api/reports/<id>/pdf?format=`) |

## Phase 4 — polish, scale, automation

| Area | Delivered |
|---|---|
| Designer | Smart guides while dragging (Alt turns them off), rulers, align / distribute, shortcuts dialog (`?`), themes and named styles, version history with restore |
| Layout | Multi-column body (newspaper columns), table of contents with final page numbers |
| Embedding | `pagewright-viewer.js`: one script and one call; Shadow DOM, so host styles do not leak in; CORS by `PW_EMBED_ORIGINS` |
| Performance | Style cache and windowed paginator: 50k rows in 1.6 s |
| Automation API | Render API with pushed data; batches (zip / merged PDF / folder / PUT upload); data list from a URL; signed webhooks; cron schedules with time zones; API keys. See [`API.md`](API.md) |

## Honest gaps

1. **No users and no permissions.** `/api/v1` has API keys. The designer and `/api/reports` have **no login**. Put the app behind your own login (SSO proxy, VPN) before you expose it.
2. **Storage is files on one server.** Reports in `reports/`, jobs and schedules in `data/`. More than one server needs shared storage or a database (planned interface: `src/server/reports.js`, `jobs.js`, `schedules.js`).
3. **Batch queue is in the process.** A restart loses queued and running jobs (finished jobs stay on disk). For heavy load, move the queue to Redis / a job service.
4. **No ActiveReports (.rdlx) or SSRS (.rdl) importer.** Reports must be made again in the designer.
5. **Embed bundle is 2.6 MB** (plus 0.9 MB ExcelJS, loaded only on Excel export). Fonts and the HarfBuzz WASM load from the server. Code splitting can make this smaller.
6. **No fillable PDF forms, no digital signatures, no PDF/A.** Not planned yet.
7. **No first-page streaming.** The viewer shows pages after the full render. 50k rows take about 1.6 s, so this is acceptable for most reports.
8. **OData** works as a REST source with query parameters. There is no OData-specific editor.
9. **No visual regression tests in the browser.** The PDF is checked against the page model; the SVG viewer is checked by e2e text assertions, not pixel compares.
10. **Some sample reports were made by scripts** (`scripts/make-*.mjs`), not by hand in the designer. All features they use are in the designer, and the e2e tests build reports through the UI.
