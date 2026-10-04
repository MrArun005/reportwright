# Pagewright: feature list

Version 0.6.0+ (`main` at `bea2841`, 4 Oct 2026). Everything below is built, merged and covered by tests unless it is marked otherwise.
Live demo: https://mrarun005.github.io/pagewright-demo/

Gate at this commit: 981 unit tests pass (4 skipped), 14/14 report snapshots, 0 PDF-vs-screen mismatches, production build OK.

---

## 1. Report designer (browser)

- Banded designer with page header, body and page footer; drag-and-drop toolbox; properties inspector; undo/redo.
- Smart guides while dragging (Alt turns them off), rulers, align and distribute, keyboard shortcuts dialog (`?`).
- Themes and named styles; copy/paste; nesting of lists and containers.
- Version history with restore.
- Expression editor (CodeMirror) with autocomplete, a Functions list and live previews.
- Groups editor, sort/filter editor, action (link/drill) editor, series editor for charts.
- Table and matrix gallery: insert a table and pick list, grouped with subtotals, summary per group or matrix, drawn live with the report's own rows.
- Drag a data set onto the page to get a table with labels, formats and totals.
- Pivot editor (rows, columns, values), recursive-group and section options, merge down / split rows, add and remove body sections.
- Chart editors for axes, overlays and per-series type, axis, range, size and open/high/low/close.
- Data set dialog with a response explorer: lists every array in an API response with its path, row count and fields, and fills them in with one click.
- AI builder: "Describe a report" drafts and opens a new report; "Ask AI" in the designer proposes changes with a rendered preview and applies them as one undoable step. Every draft is validated and test-rendered first. (Tested against a mock of the API; no live API call made yet.)
- Embeddable designer (`mountDesigner`) with `onSave`/`onOpen`, read-only mode, toolbox and panel options, data source templates.
- UI in 9 languages for the new strings. Older inspector labels are English only.

## 2. Report items

- Text box, image, line, shape, check box, container, list, table, matrix/pivot, chart, barcode, subreport, rich text, table of contents.
- Sparkline (line, area, win/loss, range bands), data bar, bullet, icon sets and range bars, in table cells or on their own.

## 3. Text and styling

- Fonts: any uploaded TTF/OTF/WOFF/WOFF2; HarfBuzz shaping and Unicode bidi.
- Hindi, Arabic and Hebrew bundled (Noto fallbacks); CJK through an uploaded font. Viewer and PDF match within 1 px on the Hindi proof report.
- Underline, strike-through, justify, background images on any box.
- Shrink-to-fit, rotation at any angle, condensed text.
- Vertical text (`tb-rl`) for CJK labels.
- Locale-aware month and day names.
- Rich text: an HTML subset (paragraphs, spans, bold/italic/underline/strike, sup/sub, lists, links, headings) with inline CSS and `{Fields.x}` interpolation.

## 4. Tables, groups and pagination

- Nested groups with header and footer rows, subtotals by scope, group sort, page break between groups, keep together, keep with next.
- Drill-down: collapsible groups whose state goes back to the engine, so pages and totals stay correct.
- Interactive sort: click a header to sort.
- Merged cells (`rowSpan`); the label repeats after a page break.
- Items inside table cells (a table, list or chart per row, seeing only that row's data).
- Recursive hierarchies: `parent` grouping, `Level()`, indentation by level, `Recursive` aggregates, drill-down by level.
- Footers printed at the bottom of the page; a group header never ends a page.
- Grid lists (several records across), multi-column body (newspaper columns).
- Wide tables continue sideways onto further pages (down-then-across or across-then-down) with repeated row headers.
- Page numbers restart per group or list row (`newSection`); overall page number and total pages.
- Several body sections, each with its own page size and orientation.
- Table of contents with final page numbers; decimal, roman and alpha numbering per level; headings as a TOC source.

## 5. Pivot tables (tablix)

- Nested row and column groups, several value columns.
- Totals before or after any group; grand totals.
- % of total, % of row, % of column.
- Expand/collapse on row and column groups.
- Repeated row and column headers across pages.
- Older matrices render exactly as before.
- 50k-row pivot (2 × 2 groups, 2 values) renders in about 170 ms.

## 6. Charts

- Column, bar, line, area, pie, donut, scatter, bubble, radar, polar, candlestick, OHLC, gauge, funnel.
- Combo charts: each series picks its own type and value axis (second Y axis).
- 100% stacked, range series (low/high), smooth lines (no overshoot), step lines.
- Axes: min, max, log scale, title, format, grid lines, label angle, reversed.
- Trend lines (linear, exponential, polynomial), moving averages, reference lines and bands (values can be expressions such as `=Avg(...)`).
- Data labels: templates (`{value}`, `{category}`, `{series}`, `{percent}` or an expression), positions, collision avoidance, automatic contrast.
- 12 palettes or custom colours; opt-in animations in the viewer (respects reduced motion).
- Drawn by the engine, so the viewer, PDF and HTML show the same chart.

## 7. Barcodes and images

- 49 barcode symbologies (Code 128, QR, Data Matrix, PDF417, EAN-13 and more), drawn as vectors; caption above or below, quiet zone, rotation, per-symbology options.
- Images: URLs, data URIs, embedded images (`embedded:name`), base64 or byte fields; SVG drawn as vector paths in PDF; auto-size, clip, fit.
- Size limits: 10 MB per image, 50 MB per report, 40 megapixels per PNG.

## 8. Expressions, data and parameters

- Expression language close to ActiveReportsJS, with its function names: text, math, dates, inspection, choice and conversion functions; `Globals`, `Parameters` and `Fields`.
- Aggregates: Sum, Avg, Count, Min, Max, Median, Mode, StDev, StDevP, Var, VarP, DistinctSum, AggregateIf, with scopes.
- `Previous`, `GroupIndex`, `Level`, `Lookup`, `LookupSet`.
- Filters: equals, `in` (multi-value), TopN, BottomN, TopPercent, BottomPercent, Between; filters run in order.
- Data sources: JSON, REST, GraphQL, CSV (separator, quote, header row, start row), OData (as REST), inline data, pushed data via the API.
- SQL on the server: PostgreSQL, MySQL, SQLite, SQL Server (`mssql://`). Read-only, single statement, time and row limits, parameters bound through the driver. Connections are set by the admin only. SQL Server: a connection is refused unless its login can only read (the server is asked for every right of the login, its roles and public); then no statement words outside strings and comments (a T-SQL scanner with nested comments and `]]`), then the server compiles the exact text that will run (`SHOWPLAN_XML`, parameters declared) and the plan must be exactly one SELECT; it then runs in a transaction that is always rolled back, with `SET ROWCOUNT` as the row cap. Tested against a real SQL Server (Azure SQL Edge in Docker).
- Nested data sets: a child data set filtered to the current parent row; `Parent.*` access.
- Parameters: option lists, options from a data set, multi-value, cascading, hidden, nullable, allow-blank, select-all; custom editors (slider, range, date range, radio, list, toggle).

## 9. Viewer

- Paging, zoom, fit width; single, continuous and galley views; full screen; print.
- Search with highlights, match case, whole word and a results list.
- Document map (outline), bookmarks, hyperlinks, drill-through with breadcrumb.
- Parameter panel.
- Frozen header rows and columns while scrolling.
- Mobile layout: compact toolbar, swipe between pages, panels as sheets.
- Toolbar customisation API.
- Fast first page: page 1 of a 50k-row report shows in about 0.5–0.8 s, then the rest follows.
- Viewer UI in 9 languages, including Hindi and Arabic (RTL).

## 10. Export formats

- PDF: text as text, links and outline, embedded and subset fonts.
- PDF/A-2b, digital signatures, fillable PDF form fields.
- PDF passwords (AES-256, user and owner passwords, permissions).
- Excel (merged cells), Word `.docx` (real tables, section page sizes; charts and images are left out), HTML (incl. a single-file offline interactive version), CSV, SVG, print.

## 11. Embedding and developer platform

- Script tag or ES module; Shadow DOM so host styles do not leak in; CORS by `PW_EMBED_ORIGINS`.
- Framework wrappers: `@pagewright/react`, `/vue`, `/svelte`, `/angular` (built, not published to npm yet).
- TypeScript types (`.d.ts`) for the engine, viewer and report format.
- `@pagewright/engine` and `@pagewright/viewer` npm packages (built and packed, not published).
- CLI: `pw render`, `pw test`, `pw diff`, PDF password options; a GitHub Action for report regression tests (syntax-checked only, not run on GitHub yet).

## 12. Server, automation and operations

- Render any report to any format on the server.
- Automation API (`/api/v1`): render with pushed data; batches (zip, merged PDF, folder, PUT upload); data list from a URL; signed webhooks; cron schedules with time zones; API keys.
- Accounts and roles (viewer, designer, admin) with scrypt passwords, signed session cookies, rate-limited sign-in, same-site origin checks. Off by default (an optional shared password instead).
- Shared storage in SQLite, PostgreSQL, MySQL or SQL Server for reports, versions, schedules, jobs and users, so several servers can share it.
- Queue and scheduler that work across several servers (database leases).
- Server-side fetches refuse private addresses unless allowed.
- Docker image (written and checked as a standalone server; the image itself not built here).
- Performance: 50,000 rows → about 1,100 pages in about 0.7–1.6 s on the server.

## 13. Migration

- ActiveReportsJS importer (`.rdlx-json`): both layouts, FixedPage, tablix (incl. nested), banded lists, charts (incl. the Phase 5 types), expressions, recursive groups, row spans, sections. 40 real files imported, validated and rendered with no item dropped; what changed is listed as notes.

---

## Not built yet

| Area | Gap |
|---|---|
| SSRS | No `.rdl` / `.rdlx` XML importer. |
| SQL | No Oracle, Snowflake or BigQuery connector. |
| Identity | No SSO (SAML / OIDC), no two-factor sign-in, no password reset by email. |
| Governance | No per-report or per-folder permissions (every viewer sees every report); no audit log. |
| Reuse | Phase 8 not started: master reports, part libraries, layers. |
| Tools | Phase 9 deferred: desktop designer, VS Code extension. |
| Charts | Word export leaves charts out; no leader lines on outside pie labels; overlays not in the legend; half-circle gauges only. |
| Tables | Recursive groups in tables only, not inside a pivot; body sections share one header and footer; an item inside a cell does not split across pages. |
| Engine | A `pageBreakBefore` on an item already moved to a new page leaves a blank page. |
| Scale | Batch output files go to one server's disk; the embed viewer has no Web Worker (100k rows block the page for about 5 s). |
| Fonts | Thai, Khmer and other Indic scripts need an uploaded font; no dictionary line breaking. |
| Publishing | npm packages and the GitHub Action not published or run; Docker image not built. |
| Security | Two possible size-limit bypasses reported by an automated review are being fixed. |
