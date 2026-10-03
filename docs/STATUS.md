# Status — all phases

4 Oct 2026. Everything below runs and is covered by tests unless the line says otherwise. Phase 1 detail: [`PHASE1.md`](PHASE1.md).

## Test results at this commit

| Check | Result |
|---|---|
| Vitest (engine unit + golden + security) | 11 files, **109 tests pass**; dates checked in 4 time zones |
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

## Roadmap increments

| Week | Increment | State |
|---|---|---|
| 2 | Response explorer | Done. "Explore the response" in the data set dialog lists every list in the response with its path, row count and fields, suggests the likely rows, and fills the path and fields on one click. Proof: `tests/e2e/data-setup.mjs` builds a data set from the loan API with no JSONPath typed. |
| 3 | SQL on the server + connection test | Done (SQL sources were Phase C1). The data panel has a SQL source type, a connection picker (names only) and a Test button; unsaved queries preview for designers (accounts on) or behind `PW_BASIC_AUTH`. |
| 4 | Table and matrix gallery; drag a data set → table | Done. Inserting a table or matrix opens a gallery (list, grouped with subtotals, summary per group, matrix) drawn live with the report's rows; dragging a data set onto the page makes a table with labels, formats and totals (only for fields that add up). Proof: `reports/invoice-gallery.pw.json`, built from blank by `tests/e2e/galleries.mjs`. |
| 9 | CLI `pw render / test / diff` + GitHub Action | Done. Proof: `reports/__tests__/loan-statement.test.json`; changing one instalment fails `pw test` and shows the moved total on page 8. The Action and CI workflow are checked for syntax only (not run on GitHub yet). |
| 11 | AI builder: describe → preview → insert | Done. Home page: "Describe a report (AI)" drafts, saves and opens a new report. Designer: "Ask AI" sends the report and its loaded data, shows what changes and a rendered page 1, and applies as one undoable step. Every draft passes validate() and a trial render first (3 tries). Proof: `tests/e2e/ai.mjs` runs both flows through the real SDK against a local mock of the Messages API; no live API call has been made. |
| 12a | First page fast | Done. The viewer's worker first lays out only enough rows for 2 pages (no totals, "Page 1 of …", "2+" pages in the toolbar), shows them, then the whole report. 50,000 rows: page 1 after 464–768 ms (was 1.7–2.1 s), measured with Playwright (`ROWS=50000 node tests/e2e/progressive.mjs`). |
| 12b | Word export | Done. `.docx` from the page model: text as paragraphs in reading order, tables as real Word tables (cell text is tagged with its table, row and column) with the header row repeating and the cells' fills; page size and breaks as in the report. Charts, images and shapes are left out (use PDF for an exact copy). In the viewer (Word button), `?format=docx`, `/api/v1/render`, batches and `pw render -f docx`. Checked by reading it back with macOS `textutil`; not opened in Microsoft Word here. PDF/A was Phase C4. |

## Honest gaps

1. **Accounts and roles, but no SSO and no per-report permissions.** With `PW_AUTH=users` people sign in with their own email and password and get a role: viewer, designer or admin (`src/server/access.js` has the table; `proxy.js` enforces it, `/api/users` and ad-hoc SQL check again in the route). Passwords are scrypt hashes; sessions are HMAC-signed cookies that are checked against the user on every request; sign-ins are rate-limited; writes need a same-site `Origin`. Still missing: SSO (SAML, OIDC; put the app behind your SSO proxy if you need it), permissions per report or folder (every viewer sees every report, including its data source settings), password reset by email, two-factor sign-in, an audit log. The sign-in limit is counted in memory per process, so several servers each allow their own 10/50. Accounts are off by default: then the app has only the optional shared `PW_BASIC_AUTH` password, as before. `/api/v1` keeps its API keys either way. Server-side fetches refuse private addresses unless listed in `PW_INTERNAL_HOSTS`.
2. **Shared storage for records, not for output files.** `PW_STORAGE=sqlite:… | postgres://… | mysql://…` keeps reports, versions, schedules, job records and users in one database, so several servers can share them (checked on SQLite and Postgres; MySQL is written but not run against a server). The default is still files on one server (`reports/`, `data/`). Batch output files (zip, merged PDF, folders) always go to `data/` on the server that ran the batch: several servers need a shared volume for them. The scheduler should still run on one server only (`PW_SCHEDULER=off` on the others). Switching storage does not copy existing reports.
3. **Batch queue is in the process.** A restart loses queued and running jobs (finished jobs stay on disk). For heavy load, move the queue to Redis / a job service.
4. **No ActiveReports (.rdlx) or SSRS (.rdl) importer.** Reports must be made again in the designer.
5. **Embed bundle is 2.6 MB** (plus 0.9 MB ExcelJS, loaded only on Excel export). Fonts and the HarfBuzz WASM load from the server. Code splitting can make this smaller.
6. **No fillable PDF forms, no digital signatures, no PDF/A.** Not planned yet.
7. **No first-page streaming.** The viewer shows pages after the full render. 50k rows take about 1.6 s, so this is acceptable for most reports.
8. **OData** works as a REST source with query parameters. There is no OData-specific editor.
9. **No visual regression tests in the browser.** The PDF is checked against the page model; the SVG viewer is checked by e2e text assertions, not pixel compares.
10. **Some sample reports were made by scripts** (`scripts/make-*.mjs`), not by hand in the designer. All features they use are in the designer, and the e2e tests build reports through the UI.
