# Agent coordination

More than one AI agent is editing this repo at the same time. Read this file before you edit, and update your row when you start or finish.

## Rules

1. Claim files in the table below before you edit them. Do not edit a file another agent has claimed — leave a note under "Requests" instead.
2. Re-read a file right before you write it. Never write a copy that is older than the file on disk.
3. Keep changes small and scoped. No repo-wide reformatting while another agent is active.
4. When you finish, move your row to "Done" with a one-line summary.

## Active claims

| Agent | Area | Files | Since |
|---|---|---|---|
| Claude Code (text + import, batch 6) | Complex-script line breaking, fallback fonts, PDF text extraction/form-field shaping, JRXML/BIRT/ActiveReports-parts importers, paginator tall-overlap fix, chart gallery i18n | src/engine/text/*, src/engine/paginate/* (+ small paginator lines in src/engine/index.js / layout.js), src/importers/*, src/designer/ChartWizard.jsx (strings only), src/i18n/* (chart gallery strings), small text-run lines in src/exporters/pdf* (ToUnicode/ActualText, form-field appearance — coordinated with exports), tests/engine/text-*.test.js, import-*.test.js, tests/fixtures/import/*, tests/e2e/import-b6.mjs, docs/TEXT.md, docs/IMPORT.md | 2026-10-05 |
| Claude Code (exports, batch 2) | Exporters, viewer export options, lazy regions/cell tags | src/exporters/*, src/viewer/exports.js, src/viewer/ReportViewer.jsx (export group only), src/i18n/* (export strings), bin/pw.mjs (export flags), tests/engine/export-*.test.js, docs/EXPORTS.md; ONE-LINE additive tags in src/engine/layout.js (layoutItems: `tag`) and src/engine/index.js (band: header/footer `art`), `alt` prop in src/engine/items/index.js props; lazy `exportData` flag in src/engine/items/index.js table region/cell-tag lines (small, additive) | 2026-10-05 |

## Design decisions (shared)

- The design system lives in the "Pagewright" Design System artifact; the canvas "Pagewright UI" has the screen mockups.
- UI font: **IBM Plex Sans / Plex Mono** (the current code). The design system still says Inter and will be re-synced to Plex.
- Colours come only from CSS variables in `app/globals.css`. No hex literals in components — add a token instead.
- Two themes: `light` (default) and `dark`, set as `data-theme` on `<html>`. The report paper stays white in both (`--paper`, `--paper-ink`).
- Text colours meet 4.5:1 on `--panel` in both themes. `--faint` is `#64717e` (the old `#8e99a4` was 2.9:1).
- Control borders use `--line-strong` (3:1). `--line` is for dividers only.

## Requests

_(Write here if you need a change in a file someone else has claimed.)_

- **layout + charts (batch 4) → exports**: commit 27f80cd rewrote `band()` in src/engine/index.js (band cache + item budget) and carries your `d.art = 1` tag line, now set once per laid-out band (cached copies keep it). Nothing for you to redo.

## Done

- **Claude Code (layout + charts, batch 4), 2026-10-05 IST**: per-section page header/footer (own / shared / none) with a band item budget and cache (security review fix 27f80cd); named master placeholders (`sections.content`); recursive innermost row group in the pivot; items in table cells split across pages with their header repeated; treemap, histogram, box plot, waterfall, Gantt (engine-drawn, gallery + Inspector, importer mapping lines); map region drill, heat/graduated legends, line layers, caps; Ask AI ids. Tests: tests/engine/layout-b4.test.js, charts-b4.test.js, tests/e2e/layout-charts-b4.mjs (in test:e2e). Claims released.
- **Claude Code (designer + charts, batch 1), 2026-10-05 IST**: outside pie/donut labels with leader lines, overlays in the legend, three-quarter/full gauges with needle/pointer/bar and ticks (viewer, PDF, HTML), importers map gauge sweep + pointer; outline drag and drop + Alt+arrow moves (`moveItemTo`); every Inspector label/option/category in the i18n tables (9 languages); polish: zoom Fit width, empty-body hint, Find a property, toolbox tiles, undo/redo icons. New tests: tests/engine/charts-b1.test.js, outline-move.test.js, tests/e2e/outline-charts.mjs (in test:e2e). Claims released.

- **Claude Code (security), 2026-10-04 IST**: production with no sign-in fails closed (401; PW_PUBLIC_READONLY=1 opt-in; PW_AUTH=proxy needs PW_PROXY_SECRET); SQL and internal-host sources need a designer at save and are stamp-checked at run; self origin only from PW_BASE_URL; strictUrl one-parse; reportFetch guards every browser data call; six review rounds, the last clean. Commits 2494077…355a8a5. Claims released.

- **Claude Code (expression semantics), 2026-10-04 IST**: VB/SSRS semantics in src/engine/expr (DateAdd/DateDiff, banker's Round, decimal sums, .NET format strings, neutral currency default) and the importer's VB translation; conformance suite in tests/engine/conformance (vb-semantics, vb-aggregates, vb-dst). Committed on main. No claims left open.

- **Cowork (chart gallery), 2026-10-04 IST**: inserting a chart (toolbox click or drop) opens `src/designer/ChartWizard.jsx` when the report has data: it calls the APIs in Data sources, draws all 7 chart types live with that data, suggests the best fit, shows the first rows (click a column to chart it) and the raw API response, then inserts. "Chart gallery and data preview…" in the Inspector reopens it for an existing chart. New `insertItem()` in `store.js`; `paintItemSvg()` exported from `Canvas.jsx` (shared with the canvas live preview); `Dialog` takes `className` in `ui.jsx`. 116 Vitest green; clicked through in a browser in both themes. Not committed to git.

- **Cowork (interactive), 2026-10-04 IST**: new action `params` ("Filter this report": sets parameters, second click clears) for text boxes, table cells and chart points (`pointAction`, `pointColor`, hover `tooltip`/`tooltips`); pie/donut slices are clickable paths. Viewer: parameters apply live (`liveParameters: false` turns it off), drill-through stays in the same viewer with a breadcrumb + Back and no depth limit (Ctrl/⌘-click still opens a tab). HTML export is now **interactive**: `src/viewer/interactiveHtml.js` bundles the embed viewer, fonts, every reachable drill target and a data snapshot (current view + one level of drill links) into one file that works offline. Embed entry accepts `reports`, `fonts`, `fontCss`, `snapshot`. Rebuilt `public/embed/pagewright-viewer.js` (run `npm run build:embed` after viewer changes). Catalogue report rebuilt to use all of it. 116 Vitest green (+7 in `tests/engine/interactive.test.js`), engine boundary OK, clicked through in a browser incl. the exported file offline. Not committed to git.

- **Cowork (reports), 2026-10-04 IST**: two new report files only — `reports/product-catalogue.pw.json` (live DummyJSON API: multi-select + rating + low-stock parameters, KPI tiles, 3 charts, matrix, collapsible category groups, interactive sort, document map, drill-through) and `reports/product-detail.pw.json` (drill target, `?id=`). No code changes. Rendered with the engine against a DummyJSON-shaped mock (no warnings); the live API was not reachable from the cloud sandbox.

- **Cowork (theme), 2026-10-04 IST**: light + dark themes from one token set in `app/globals.css` (`:root[data-theme="dark"]`), contrast fixes (`--faint`, `--line-strong` on controls), colour literals → tokens, paper stays white. No-flash theme boot in `app/layout.js` + `src/theme/theme.js`; `src/theme/ThemeToggle.jsx` (system → light → dark) on the home header and designer top bar. Also small token swaps in `src/designer/Canvas.jsx` (ruler) and `src/designer/ExprCode.jsx` (editor colours, so it reads in dark). Checked in a browser: home, designer, viewer, expression editor in both themes. **Not committed** — left as working-tree changes on `fix/phase-a` for Arun to review. Not done: toggle in the viewer page (`src/viewer/ViewerShell.jsx`), embed viewer stays light. No claims left open.

- **Claude Code (Phase A hardening), 2026-10-04 IST**: engine dates/rounding/expression fixes, DST-safe cron, SSRF guard (`src/server/safeFetch.js`), optional `PW_BASIC_AUTH` (`proxy.js`), 109 Vitest + all e2e green. Four commits on branch **`fix/phase-a`**, which is now the checked-out branch of this folder, so new commits land there. No claims left open.
