# Pagewright: feature list

Version 0.6.0+ (`main`, 4 Oct 2026). Everything below is built and covered by tests unless it is marked otherwise.

> **Built, not yet released:** items marked **[not released]** are committed on the local `main` only. SQL Server has open security findings (time and memory caps, the read-only check across databases) and must not be pushed or used in production until those are fixed.
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
- Data set dialog with a response explorer: lists every array in an API response with its path, row count and fields, and fills them in with one click. Nested data sets (rows from each row of a parent), any number of sort keys; saving keeps every property.
- Outline panel: every band and item as a tree; select any item (also one hidden under another), change the drawing order, move an item out of its container.
- Controls for: table row visibility and row style; font size, weight and style as expressions; matrix header/cell/total styles and total labels; chart filter, sort and "show at most N" (from a parameter or expression), per-series line type, overlay axis, custom palettes; cell visuals (list values, band colour, data-bar value and format); table bookmarks; report images (upload) with an embedded-image picker; "repeat group header on each page"; "show or hide another item"; drill-through and subreport targets picked from the report list.
- Parameter dialog: label field for choices from a data set, live-parameters toggle; plain choices keep their values.
- Download the definition as `.pw.json` (unsaved changes included).
- AI builder: "Describe a report" drafts and opens a new report; "Ask AI" in the designer proposes changes with a rendered preview and applies them as one undoable step. Every draft is validated and test-rendered first. (Tested against a mock of the API; no live API call made yet.)
- Embeddable designer (`mountDesigner`) with `onSave`/`onOpen`, read-only mode, toolbox and panel options, data source templates.
- UI in 9 languages for the new strings. Older inspector labels are English only.

## 1a. Reuse and authoring (Phase 8)

- **Master reports:** a report picks a master (Report → Reuse). The master's page setup, page header and footer, styles, data sources, data sets, parameters, functions, images and layers wrap it; its body goes in the master's **content placeholder** (and grows, splits across pages and pushes the master's items below it down). Masters can have masters (4 levels). Changes to a master show on the next run. The designer draws the master's items locked and the content inside the placeholder.
- **Report part libraries:** any item of a report can be published as a part (Inspector → Report part) with typed properties that its expressions read as `=PartProperties.Name`. Other reports add the library (Report parts panel) and insert parts **linked** (they follow the library) or as an **independent copy**; a linked part can be detached. A part brings the data sources, data sets, parameters and named styles it needs.
- **Stylesheets and style inheritance:** a named style can be based on another (`parent`); a report can use another report's named styles as its stylesheet.
- **Themes:** colours (Accent1–6, Dark/Light 1–2, Hyperlink), major and minor fonts, and constants, read as `=Theme.Colors.Accent1`, `=Theme.Fonts.MajorFont.Family`, `=Theme.Constants.Name`. A report has its own theme or uses a theme report, chosen by an expression at run time if wanted (e.g. from a parameter); a default (Office) theme otherwise.
- **Layers:** named layers with visible, locked and a target: everywhere, screen only, print only, export only or designer only. The viewer shows screen layers and prints or exports with the others.
- **Fixed-page forms:** a table can be a fixed frame whose extra rows continue in an **overflow placeholder** on the next body section, with the header repeated; placeholders chain, and the last one repeats its page until the rows run out.
- **Cell-based design mode:** items snap to whole cells and cannot overlap (stored as plain positions).
- **Pivot wizard** (fields to rows, columns and values, aggregate and % of total / row / column, live preview) and **instant visuals** (tick fields: a suggested chart, table and pivot, drawn with the data).
- Untrusted input: each reused report is loaded once per render, at most 50 per render and 20,000 items each; nesting is capped at 4 levels; a master or part that includes itself is skipped with a warning; report parts are priced before they are drawn (at most 20,000 items per render, shared with subreports), so a part of parts of parts is refused, not expanded.

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
- Footers printed at the bottom of the page; a group header never ends a page; a group header can repeat on each page its group continues on.
- Row visibility: a hidden expression per row (per record in detail rows); a hidden row takes no space.
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
- 2D codes (QR, Data Matrix, Aztec, Han Xin) keep their aspect ratio and are centred in the box, so a QR code is always square and scannable.
- A barcode can carry an action (web link, bookmark jump, drill-through), clickable in the viewer and the PDF.
- Images: URLs, data URIs, embedded images (`embedded:name`), base64 or byte fields; SVG drawn as vector paths in PDF; auto-size, clip, fit.
- Size limits: 10 MB per image, 50 MB per report, 40 megapixels per PNG.

## 8. Expressions, data and parameters

- Expression language close to ActiveReportsJS, with its function names: text, math, dates, inspection, choice and conversion functions; `Globals`, `Parameters` and `Fields`.
- Aggregates: Sum, Avg, Count, Min, Max, Median, Mode, StDev, StDevP, Var, VarP, DistinctSum, AggregateIf, with scopes.
- `Previous`, `GroupIndex`, `Level`, `Lookup`, `LookupSet`.
- Filters: equals, `in` (multi-value), TopN, BottomN, TopPercent, BottomPercent, Between; filters run in order.
- Data sources: JSON, REST, GraphQL, CSV (separator, quote, header row, start row), OData (as REST), inline data, pushed data via the API.
- **[not released]** SQL on the server: PostgreSQL, MySQL, SQLite, SQL Server (`mssql://`). Read-only, single statement, time and row limits, parameters bound through the driver. Connections are set by the admin only. SQL Server: a connection is refused unless its login can only read (the server is asked for every right of the login, its roles and public); then no statement words outside strings and comments (a T-SQL scanner with nested comments and `]]`), then the server compiles the exact text that will run (`SHOWPLAN_XML`, parameters declared) and the plan must be exactly one SELECT; it then runs in a transaction that is always rolled back, with `SET ROWCOUNT` as the row cap. Tested against a real SQL Server (Azure SQL Edge in Docker).
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

- PDF: text as text, embedded and subset fonts.
- PDF links: web links, plus internal links that jump to the right page and position (table-of-contents entries, bookmark jumps, drill-through to a section, "back" links).
- PDF outline (bookmarks panel) nested by level; a bookmarked heading takes its heading level.
- PDF/A-2b, digital signatures, fillable PDF form fields.
- PDF passwords (AES-256, user and owner passwords, permissions).
- Excel (merged cells), Word `.docx` (real tables, section page sizes; charts and images are left out), HTML (incl. a single-file offline interactive version), CSV, SVG, JSON (the laid-out pages, in the viewer and the API), print.
- Static HTML links: web links, bookmark jumps and table-of-contents entries (anchors at the target page and height), drill-through opening the Pagewright viewer.

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
- Folders and permissions per report and per folder: grants to users and groups (view, edit, manage), inherited from the folder chain (inheritance can be turned off), a top-level default, the role as a ceiling, admins see everything. Enforced on every path: the home page (folders, search, only the controls the user can use), viewer, designer, `/api/reports*`, server renders and exports, thumbnails, saved SQL, subreports and drill-through, `/api/v1` (API keys can act as a user: `email|key`), batches and schedules (owned by the user and the API key that made them; the owner is re-checked before every item, and a revoked key or a deleted, disabled or demoted owner stops them; delivery URLs are checked when saved and when used). Every permission check and the write it allows run under one storage lease, renewed while held and fencing every write. Thumbnails render in a worker thread and are never served from a drawing made under other permissions. A report one may not view is not found. Works on every storage backend; tested on files, SQLite, Postgres, MySQL and SQL Server.
- Audit log: sign-ins and failures, sign-outs, single sign-on, report create/update/delete/restore/import/view/render/export, permission and folder changes, user changes, API key use (by key id), batches and schedule runs; who, what, format, a keyed hash of the parameters, when, from where. Append-only, in the configured storage, retention `PW_AUDIT_RETENTION_DAYS` (365). Admin page with filters and CSV export. Never passwords, keys, tokens or parameter values.
- Single sign-on: OpenID Connect (authorization code + PKCE, state, nonce, ID token signature and iss/aud/azp/exp checks, cached JWKS) and SAML 2.0 (signed assertions required, audience, recipient, destination, time and InResponseTo checks, each assertion used once across servers, the response bound to the browser that began the sign-in). IdP groups map to roles and to permission groups; accounts are made on first sign-in. Password sign-in can be turned off. Tested against a mock OIDC provider and a test SAML IdP, in a browser too.
- Render time limit on the server (`PW_RENDER_TIMEOUT_MS`, default 60 s): an evaluation budget in the engine, shared with subreports; a report quadratic in its rows stops with a 504 instead of holding the server.
- Shared storage in SQLite, PostgreSQL, MySQL or SQL Server for reports, versions, schedules, jobs and users, so several servers can share it.
- Queue and scheduler that work across several servers (database leases).
- Server-side fetches refuse private addresses unless allowed.
- Docker image (written and checked as a standalone server; the image itself not built here).
- Performance: 50,000 rows → about 1,100 pages in about 0.7–1.6 s on the server.

## 13. Migration

- ActiveReportsJS importer (`.rdlx-json`): both layouts, FixedPage, tablix (incl. nested), banded lists, charts (incl. the Phase 5 types), expressions, recursive groups, row spans, sections. 40 real files imported, validated and rendered with no item dropped; what changed is listed as notes.
- SSRS / Report Builder importer (`.rdl`, `.rdlc`; RDL 2008, 2010, 2016): data sources and sets (SQL with @parameters, "Enter Data" rows), parameters (cascading, multi-value, hidden), text runs and rich text, tablix as table / matrix / list / banded list, charts (combos, secondary axis, data bars, sparklines), gauges and indicators (approximated), images, subreports, actions, document map, Variables / ReportItems / Me.Value, VB expressions. A safe XML reader (no DTDs, size and depth caps, linear). Maps and custom code are not converted (noted; code kept as text). 32 Microsoft sample reports imported, validated and rendered, no item dropped. See API.md, "SSRS import".

## 14. Report library (`reports/`)

| Report | Shows | How it was made |
|---|---|---|
| **Stress ledger** | 5,000 nasty rows, 6 data sets, 7 parameters (cascading, ranges, slider, switch, chart-click), 3-level drill-down ledger with in-cell visuals and sort, pivot, 5 charts, TOC, barcodes, subreport; 337 pages | **Designer only** |
| **Account detail** | Drill-through target for Stress ledger | **Designer only** |
| Invoice gallery | Tables from the gallery, totals | Designer, by an automated UI test from a blank page |
| **Reuse showcase** (+ Reuse master, Reuse parts, Reuse theme) | A content report on a master, linked and copied report parts, a stylesheet, a theme picked by parameter, a pivot from the pivot wizard, a chart from instant visuals, screen-only and designer-only layers, a fixed table frame continued in an overflow placeholder; 5 pages | **Designer only**, by an automated UI test (`tests/e2e/reuse.mjs`, `PROOF=1`) |
| Pagewright Torture Test | 180-loan portfolio: KPIs, pivot, combo chart, grouped register with sparklines, 6 drill-through pages, QR, watermark; 18 pages | Script (to be rebuilt in the Designer) |
| Stress test | 58 items on deliberately broken data; 88 pages | Script |
| Sales dashboard, Sales explorer → city → month | Charts, matrix, 3-level drill-through | Script |
| Loan statement (+ Hindi) | 8-page amortisation; HarfBuzz Devanagari | Script |
| Charts, Tablix, Expressions, Rich text, Platform, Style showcases | One per phase | Script |
| Product catalogue / detail, Parameter editors, Imported regional sales | Filters, parameter editors, an imported ActiveReports file | Script / importer |

Sample data APIs (stand-ins for customer data): `/api/sample/hard?rows=N` (nasty data, up to 200,000 rows), `/api/sample/torture`, sales, loans and stress sets.

## 15. Live demo

- https://mrarun005.github.io/pagewright-demo/: a static site (public repo `pagewright-demo`, built files only; source stays private) running 18 reports, a 5k–100k-row browser scale test, the embedded designer and embed code for 6 frameworks, with no server.
- `npm run build:site` now adds the charts and pivot showcases, Stress ledger (+ Account detail), Torture Test (Designer), Reuse showcase and the SSRS-imported transcript; the published copy updates when it is republished.

---

## Not built yet

| Area | Gap |
|---|---|
| SSRS | Maps, custom report items and RDL 2005 Table/Matrix/List are not imported; custom code is kept as text, not converted; gauges are approximated. |
| SQL | No Oracle, Snowflake or BigQuery connector. |
| Identity | No two-factor sign-in, no password reset by email; no SAML single logout. |
| Governance | Permissions are not applied with accounts off (the shared `PW_BASIC_AUTH` password is all or nothing). The audit log takes the browser's word for exports made in the viewer; it has no tamper-evidence (hash chain) and is not shipped to a SIEM. |
| Reuse | One content placeholder per master (ActiveReports allows several). The ActiveReports importer does not map master reports, report parts or layers yet. Themes use `Theme.Colors.Accent1`, not ActiveReports' `!` syntax. Word and Excel exports draw no rounded corners (no borders as lines there either). |
| Tools | Phase 9 deferred: desktop designer, VS Code extension. |
| Charts | Word export leaves charts out; no leader lines on outside pie labels; overlays not in the legend; half-circle gauges only. |
| Tables | Recursive groups in tables only, not inside a pivot; body sections share one header and footer; an item inside a cell does not split across pages. |
| Engine | A `pageBreakBefore` on an item already moved to a new page leaves a blank page. |
| Scale | Batch output files go to one server's disk; the embed viewer has no Web Worker (100k rows block the page for about 5 s). |
| Fonts | Thai, Khmer and other Indic scripts need an uploaded font; no dictionary line breaking. |
| Publishing | npm packages and the GitHub Action not published or run; Docker image not built. |
| Security | SQL Server (**[not released]**): an automated review still reports a resource-cap bypass (value types TEXTSIZE does not limit, very wide rows, message floods, the per-database probe without a time bound). Use a read-only login; do not offer SQL Server sources to untrusted report authors until this is closed. |
| Speed | Fixed: scope aggregates are computed once per render (stress ledger 38 s → ~2 s), and a table of contents keeps the fast first page (page numbers fill in after). Open: the home-page thumbnail now draws in a worker thread (security track) and has not been re-measured. |
| Designer | The Oct 2026 gap list is closed (outline, filters, row visibility and style, expression styles, matrix styles, palettes, images, galleries, data set and parameter dialogs, focus, merged-cell columns). Still open: older inspector labels are English only; the outline reorders with buttons, not drag and drop, and cannot move an item into a container; "show or hide another item" works in the viewer and the interactive HTML; a static export keeps the state it was exported in. |
| Export | Static HTML cannot re-sort, open/close or filter (the interactive HTML can). HTML rendered on the server shows drill-through disabled until the renderer passes its base URL (`drillBase`). |
