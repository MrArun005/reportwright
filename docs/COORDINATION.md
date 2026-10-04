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
| Claude Code (designer + charts, batch 1) | Designer UI, viewer UI, chart/gauge/map items, i18n | src/designer/*, src/viewer/* (UI), src/engine/items/chart*.js, map.js, src/i18n/*, tests/e2e/outline-charts.mjs, tests/engine/charts-b1.test.js; importers: gauge mapping lines only | 2026-10-05 |

## Design decisions (shared)

- The design system lives in the "Pagewright" Design System artifact; the canvas "Pagewright UI" has the screen mockups.
- UI font: **IBM Plex Sans / Plex Mono** (the current code). The design system still says Inter and will be re-synced to Plex.
- Colours come only from CSS variables in `app/globals.css`. No hex literals in components — add a token instead.
- Two themes: `light` (default) and `dark`, set as `data-theme` on `<html>`. The report paper stays white in both (`--paper`, `--paper-ink`).
- Text colours meet 4.5:1 on `--panel` in both themes. `--faint` is `#64717e` (the old `#8e99a4` was 2.9:1).
- Control borders use `--line-strong` (3:1). `--line` is for dividers only.

## Requests

_(Write here if you need a change in a file someone else has claimed.)_

## Done

- **Claude Code (security), 2026-10-04 IST**: production with no sign-in fails closed (401; PW_PUBLIC_READONLY=1 opt-in; PW_AUTH=proxy needs PW_PROXY_SECRET); SQL and internal-host sources need a designer at save and are stamp-checked at run; self origin only from PW_BASE_URL; strictUrl one-parse; reportFetch guards every browser data call; six review rounds, the last clean. Commits 2494077…355a8a5. Claims released.

- **Claude Code (expression semantics), 2026-10-04 IST**: VB/SSRS semantics in src/engine/expr (DateAdd/DateDiff, banker's Round, decimal sums, .NET format strings, neutral currency default) and the importer's VB translation; conformance suite in tests/engine/conformance (vb-semantics, vb-aggregates, vb-dst). Committed on main. No claims left open.

- **Cowork (chart gallery), 2026-10-04 IST**: inserting a chart (toolbox click or drop) opens `src/designer/ChartWizard.jsx` when the report has data: it calls the APIs in Data sources, draws all 7 chart types live with that data, suggests the best fit, shows the first rows (click a column to chart it) and the raw API response, then inserts. "Chart gallery and data preview…" in the Inspector reopens it for an existing chart. New `insertItem()` in `store.js`; `paintItemSvg()` exported from `Canvas.jsx` (shared with the canvas live preview); `Dialog` takes `className` in `ui.jsx`. 116 Vitest green; clicked through in a browser in both themes. Not committed to git.

- **Cowork (interactive), 2026-10-04 IST**: new action `params` ("Filter this report": sets parameters, second click clears) for text boxes, table cells and chart points (`pointAction`, `pointColor`, hover `tooltip`/`tooltips`); pie/donut slices are clickable paths. Viewer: parameters apply live (`liveParameters: false` turns it off), drill-through stays in the same viewer with a breadcrumb + Back and no depth limit (Ctrl/⌘-click still opens a tab). HTML export is now **interactive**: `src/viewer/interactiveHtml.js` bundles the embed viewer, fonts, every reachable drill target and a data snapshot (current view + one level of drill links) into one file that works offline. Embed entry accepts `reports`, `fonts`, `fontCss`, `snapshot`. Rebuilt `public/embed/pagewright-viewer.js` (run `npm run build:embed` after viewer changes). Catalogue report rebuilt to use all of it. 116 Vitest green (+7 in `tests/engine/interactive.test.js`), engine boundary OK, clicked through in a browser incl. the exported file offline. Not committed to git.

- **Cowork (reports), 2026-10-04 IST**: two new report files only — `reports/product-catalogue.pw.json` (live DummyJSON API: multi-select + rating + low-stock parameters, KPI tiles, 3 charts, matrix, collapsible category groups, interactive sort, document map, drill-through) and `reports/product-detail.pw.json` (drill target, `?id=`). No code changes. Rendered with the engine against a DummyJSON-shaped mock (no warnings); the live API was not reachable from the cloud sandbox.

- **Cowork (theme), 2026-10-04 IST**: light + dark themes from one token set in `app/globals.css` (`:root[data-theme="dark"]`), contrast fixes (`--faint`, `--line-strong` on controls), colour literals → tokens, paper stays white. No-flash theme boot in `app/layout.js` + `src/theme/theme.js`; `src/theme/ThemeToggle.jsx` (system → light → dark) on the home header and designer top bar. Also small token swaps in `src/designer/Canvas.jsx` (ruler) and `src/designer/ExprCode.jsx` (editor colours, so it reads in dark). Checked in a browser: home, designer, viewer, expression editor in both themes. **Not committed** — left as working-tree changes on `fix/phase-a` for Arun to review. Not done: toggle in the viewer page (`src/viewer/ViewerShell.jsx`), embed viewer stays light. No claims left open.

- **Claude Code (Phase A hardening), 2026-10-04 IST**: engine dates/rounding/expression fixes, DST-safe cron, SSRF guard (`src/server/safeFetch.js`), optional `PW_BASIC_AUTH` (`proxy.js`), 109 Vitest + all e2e green. Four commits on branch **`fix/phase-a`**, which is now the checked-out branch of this folder, so new commits land there. No claims left open.
