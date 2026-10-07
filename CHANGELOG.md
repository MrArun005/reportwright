# Changelog

All `@pagewrightjs/*` packages share one version. The versioning policy is in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-semver).

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
