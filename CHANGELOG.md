# Changelog

All `@pagewrightjs/*` packages share one version. The versioning policy is in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-semver).

## 0.8.0

### Breaking (with a deprecation period)
- One export signature: `exportPdf(model, { fonts, ... })`, `exportXlsx(model, { fonts, ... })`, `exportDocx(model, { fonts, ... })`.
  The 0.7 positional forms (`exportPdf(model, fontStore, opt)`, `exportXlsx(model, ExcelJS, opt)`) still work in 0.8
  and print a deprecation warning once; they are removed in 0.9. A wrong argument gives a clear `TypeError`.

### Changed
- The Excel export has its own writer: no ExcelJS (and none of its deprecated dependencies, `uuid` among them).
  Lower memory on large sheets.
- Runtime dependencies are pinned to exact versions; the unused `harfbuzzjs` dependency is gone. `npm audit`: 0.
- Every package ships readable (not minified) ES modules with source maps.
- Package metadata: repository, homepage, bugs, keywords, engines, `sideEffects`, typed `exports`; README badges;
  this changelog in every package. Releases are built by a GitHub workflow with npm provenance.

### Added and fixed
- The viewer works without a server (`definition` + `data` + `fontsUrl`); each font is fetched once.
- See the README of each package for what works standalone and what needs the self-hosted server.

## 0.7.3
- Firefox and WebKit smoke tests in CI; settings table entries for monitoring. No API change.

## 0.7.2, 0.7.1
- Fixes to the package builds and README quick starts.

## 0.7.0
- First public release under the `@pagewrightjs` scope: engine, fonts, cli, viewer, react, vue, svelte, angular.
