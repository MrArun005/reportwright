# Changelog

All `@reportwright/*` packages (formerly `@pagewrightjs/*`) share one version. The versioning policy is in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-semver).

## 0.10.0

Streaming exports and a pool that uses every core. No change to rendering, totals or page counts. Design and measurements:
[docs/research/STREAMING-1M.md](docs/research/STREAMING-1M.md).

### Added
- **Streaming data CSV and Excel.** A report with one table and row-by-row expressions (group and table footers may
  total with Sum, Count, Avg, Min, Max or CountRows) exports as it reads: rows come from the source a batch at a time
  (JSON arrays split from the byte stream, CSV, SQLite, PostgreSQL and MySQL cursors), are sorted and grouped through
  temporary files when needed, and are written to the response with back-pressure. Memory stays flat: 100k → 300k rows
  measured 160 → 168 MB for a CSV render, 185 → 197 MB for a grouped Excel one (the whole render process); 1M rows
  projects under 300 MB. Same bytes as before for CSV, same cells and formulas for Excel. Other reports take the page
  model as before. The answer has no `content-length`; a failure after the first bytes breaks the download off (CSV:
  a last line `#ERROR <reference>`). Settings: `PW_STREAM`, `PW_STREAM_MAX_ROWS`, `PW_STREAM_FETCH_MAX_MB`,
  `PW_STREAM_SQL_MAX_MB`, `PW_SPILL_MAX_MB`, `PW_SPILL_TOTAL_MB`, `PW_STREAM_STALL_MS`.
- Excel tables longer than 1,048,576 rows continue on a sheet "Name (2)" with their header rows again.
- `@reportwright/engine/pool`: `createPool({ heapMB, timeoutMs })`.

### Changed
- The server's render pool has a worker per core (less one, at most 16); memory decides what runs at once, by an
  estimate per template and caller, with small heaps for small and streaming renders (`PW_RENDER_SMALL_HEAP_MB`) and
  a cap on one caller's running renders (`PW_RENDER_RUNNING_PER_PRINCIPAL`). `UV_THREADPOOL_SIZE` follows the cores
  (Dockerfile, cluster.mjs).
- Excel: a plain cell no longer carries a duplicate style; the no-table CSV starts with a BOM like the others.

### Fixed
- SQLite sources: a reused query process failed every second query ("statement has been finalized").

## 0.9.0

Pagewright is now **ReportWright** (formerly Pagewright). No change to rendering, totals or page counts.

### Changed
- The npm packages moved to the `@reportwright` scope: `@reportwright/engine`, `/viewer`, `/fonts`, `/fonts-cjk`,
  `/cli`, `/react`, `/vue`, `/svelte`, `/angular`. The `@pagewrightjs/*` packages are deprecated and get no updates.
  Change the package names in your `package.json` and imports; nothing else.
- The brand in the app, the Designer, the viewer, mails, the 9 interface languages, the CLI, error messages and
  exports (the PDF Producer and Creator, HTML titles) reads ReportWright.
- The CLI installs as `reportwright` and still as `pw`; the CJK font downloader as `reportwright-fonts-cjk` (and
  `pagewright-fonts-cjk`).
- The repository is `github.com/MrArun005/reportwright` (the old URL redirects).

### Deprecated (removed in 1.0)
- `<pagewright-viewer>` and `<pagewright-designer>` (now `<reportwright-viewer>`, `<reportwright-designer>`; both are
  registered), `definePagewrightElements` (now `defineReportWrightElements`), `PagewrightViewer` and
  `PagewrightDesigner` in React and Vue (now `ReportWrightViewer`, `ReportWrightDesigner`), `pagewrightViewer` and
  `pagewrightDesigner` in Svelte (now `reportWrightViewer`, `reportWrightDesigner`), `window.Pagewright` (now
  `window.ReportWright`) and `/embed/pagewright-viewer.js` (now `/embed/reportwright-viewer.js`). Each old name is
  an alias of the new one.

### Kept (so deployments and stored data keep working)
- Settings keep the `PW_` prefix. The `x-pagewright-*` headers, the `pagewright_*` metrics, cookie and storage table
  names, the `.pw.json` extension and `"$schema": "pagewright/report@1"` are unchanged; `reportwright/report@1` is
  accepted as the same format.

## 0.8.1

Supply-chain hardening (what Socket.dev and similar scanners read). No change to rendering or exports.

### Changed
- `@pagewrightjs/viewer` no longer bundles pdf-lib, @pdf-lib/fontkit, bwip-js, fflate or bidi-js: they are
  dependencies pinned to exact versions, as in the engine. Import the viewer through a bundler (Vite, webpack,
  esbuild, Rollup…). Unpacked size 14.8 MB to 10.1 MB.
- The engine and the CLI import bidi-js too (a pinned dependency) instead of bundling its Unicode tables.
- `@pagewrightjs/cli` holds the report commands only (render, test, diff, import): no server modules, no
  `child_process`, no environment reads. `pw audit` and `pw migrate-storage` run from the app (`node bin/pw.mjs`).
- No line over 1,000 characters in any package (source maps aside).
- `render(def, { fetch })` is the documented way to give the engine its network access; `globalThis.fetch` is only
  the fallback, and the error without either says so.
- `@pagewrightjs/fonts` ships a LICENSE file.

### Added
- `npm run scan:packages` (`scripts/scan-packages.mjs`): a Socket-style scan of every packed package, run in CI and
  before publishing. Release steps: [docs/RELEASING.md](docs/RELEASING.md).

## 0.8.0

### Breaking (with a deprecation period)
- One export signature: `exportPdf(model, { fonts, ... })`, `exportXlsx(model, { fonts, ... })`,
  `exportDocx(model, { fonts, ... })`, `exportPptx(model, { fonts, ... })`. The 0.7 positional forms
  (`exportPdf(model, fontStore, opt)`, `exportXlsx(model, ExcelJS, opt)`) still work in 0.8 and print one deprecation
  warning; they are removed in 0.9. A wrong argument gives a `TypeError` that says what was expected.
- A table cell under another cell's `colSpan` is no longer drawn on top of it (validate() warns about it).

### Added
- The viewer works without a server: `mountViewer(el, { definition, data, fontsUrl })` (also in the React, Vue,
  Svelte and Angular wrappers). The README says what works standalone and what needs the self-hosted server.
- `colSpan` in RDL/HTML style: a row with fewer cells than columns omits the spanned cells.
- The report JSON Schema, published as `@pagewrightjs/engine/schema.json`; `report.d.ts` is generated from it and
  `validate()` checks properties and choices against it (the hand-written types and the validator had drifted apart: `dir`, `alt` and about 30 engine properties were missing from one or the other).
- `pdfa: true` finds the sRGB colour profile in `@pagewrightjs/fonts` by itself.
- `@pagewrightjs/fonts-cjk`: Chinese, Japanese, Korean and emoji fonts, downloaded on demand
  (`npx pagewright-fonts-cjk`), pinned and checked by SHA-256.
- `createPool({ workers })` in `@pagewrightjs/engine/pool`: renders on worker threads (4 workers: 2.8× one).
- `detectDates: false` on a data set; `colorByCategory: true` on charts (one colour per category across charts).
- `pw import report.jrxml` (also .rdl and .rptdesign) in `@pagewrightjs/cli`.
- Docs: docs/QUICKSTART.md, docs/SCHEMA.md and docs/FUNCTIONS.md (generated), docs/FROM-JASPER.md; `examples/`.

### Changed
- The Excel export has its own writer: no ExcelJS (and none of its deprecated dependencies, `uuid` among them);
  50,000 rows: export memory +124 MB (was +409 MB), 3× faster.
- Runtime dependencies are pinned to exact versions; the unused `harfbuzzjs` dependency is gone. `npm audit`: 0.
- Every package ships readable (not minified) ES modules with source maps.
- The viewer loads other interface languages and the Excel, HTML and CSV exporters on demand: first load 847 KB
  gzipped (was 877 KB minified).
- React, Vue, Svelte, Angular wrappers: a failed import shows its error in the element (`onError`); options are
  compared by content, so an inline `definition` object does not remount the designer.
- Package metadata (repository, homepage, bugs, keywords, engines, `sideEffects`, typed `exports`), README badges,
  this changelog in every package, SECURITY.md, a semver policy, and a GitHub workflow that publishes with npm
  provenance.

## 0.7.3
- Firefox and WebKit smoke tests in CI; settings table entries for monitoring. No API change.

## 0.7.2, 0.7.1
- Fixes to the package builds and README quick starts.

## 0.7.0
- First public release under the `@pagewrightjs` scope: engine, fonts, cli, viewer, react, vue, svelte, angular.
