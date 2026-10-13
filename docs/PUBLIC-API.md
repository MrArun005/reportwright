# Public API: what ReportWright 1.0 promises

From 1.0.0, ReportWright follows semantic versioning (see "Stability and versioning" in the README). This page is
the exact list of what that covers. Anything not listed here (internal modules, `src/**` of the app, files under
`dist/` reached by path, undocumented options, names marked `@internal`) may change in any release.

All `@reportwright/*` packages and `create-reportwright` share one version and are released together.

## Report file format

- The report JSON format `"$schema": "reportwright/report@1"`, as described by `@reportwright/engine/schema.json`
  (JSON Schema), `@reportwright/engine/report` (TypeScript types) and [SCHEMA.md](SCHEMA.md). A 1.x engine reads every
  file a 1.0 engine wrote. New optional properties may be added in minors; a property is never removed or given a new
  meaning outside a major.
- `"$schema": "pagewright/report@1"` (files saved before the rename) is still read: it is the same format, normalised
  to `reportwright/report@1` on load and saved under the new name.
- Report files keep the `.pw.json` extension; snapshot test cases are `__tests__/*.test.json`.

## `@reportwright/engine`

Entry `.` (types: `index.d.ts`):

| Export | |
|---|---|
| `render(def, options)` | report definition to page model |
| `exportPdf`, `exportXlsx`, `exportDocx`, `exportPptx`, `exportHtml`, `exportCsv` | `(model, { fonts, ...options })` |
| `exportPdfStream`, `exportDocxStream`, `exportXlsxStream` | `(def, options, sink)` streaming exports |
| `pageToSvg` | one page of a model as SVG |
| `validate`, `blankReport`, `blankDashboard` | schema check and starter definitions |
| `parameterOptions`, `resolveParameters`, `needsExportData` | parameters and export helpers |
| `tableFor`, `matrixFor` | a table / matrix item from a field list |
| `FontStore`, `defaultFontStore`, `fontFile`, `createSubsetter` | fonts |
| `ITEMS` | the item type names |

Subpaths: `./report` (types of the report format), `./schema.json`, `./pool` (`createPool`, render worker pool),
`./package.json`.

**Not public:** `__streamPaint` and `planPaged` (marked `@internal`; used by the engine's own workers and stream
exporters).

## `@reportwright/viewer`

`.` (`mountViewer`, `withData` and their option/handle types), `./designer` (`mountDesigner`), and the same two under
`./react-peer` and `./react-peer/designer` (React from the host app). The options, handle methods and events are the
ones in [API.md](API.md) "Viewer (embedding)" and "Designer (embedding)".
The script-tag build: `/embed/reportwright-viewer.js` with `window.ReportWright.mountViewer` / `mountDesigner` / `ready`.

## Framework wrappers

| Package | Exports |
|---|---|
| `@reportwright/react` | `ReportWrightViewer`, `ReportWrightDesigner`, `ReportWrightViewerProps`, `ReportWrightDesignerProps` |
| `@reportwright/vue` | `ReportWrightViewer`, `ReportWrightDesigner` |
| `@reportwright/svelte` | `reportWrightViewer`, `reportWrightDesigner` actions, `ReportWrightAction` |
| `@reportwright/angular` | `defineReportWrightElements()`; `<reportwright-viewer>`, `<reportwright-designer>` with `options`, attributes and the `pw-ready`, `pw-error`, `pw-save` events; `ReportWrightViewerElement`, `ReportWrightDesignerElement`, `ReportWrightReadyEvent` |

## `@reportwright/fonts`, `@reportwright/fonts-cjk`

- `@reportwright/fonts`: the bundled fonts, `harfbuzz-subset.wasm` and the sRGB ICC profile under `./public/*` (the
  engine finds them; the paths are public).
- `@reportwright/fonts-cjk`: the `reportwright-fonts-cjk` command; `CJK_FONTS`, `cacheDir`, `FONTS_DIR`, `fontPath`,
  `fetchCjkFonts`. `LEGACY_DIR` is `@internal`.

## `@reportwright/cli` (`pw`, `reportwright`)

Commands and flags as printed by `pw --help` and documented in the CLI README: `pw render` (`-p`, `-d`, `-f`, `-o`,
`--base`, `--allow-internal`, `--pdfa`, `--ua`, `--values`, `--html`, `--drill-links`, `--static`, `--layout`,
`--password`, `--owner-password`, `--deny`), `pw import` (single file and folder mode with its flags), `pw test`
(`--update`, `--layout`), `pw diff`, `pw --version`. Exit codes: 0 ok, 1 a test failed / pages differ / audit does not
check, 2 bad usage. The server-only `pw audit` and `pw migrate-storage` (app folder) are covered as documented there.

## `create-reportwright`

`npm create reportwright@latest <dir> [-- --template node|react|vue|svelte|angular --yes]`: the templates' file layout may change
in minors; the generated app pins `@reportwright/*` to the same version.

## Server (self-hosted app)

- REST routes in [API.md](API.md): `/api/v1/render`, `/api/v1/templates`, `/api/v1/batches*`, `/api/v1/schedules*`,
  `/api/v1/health`, `/api/v1/livez`, `/api/v1/readyz`, `/api/v1/metrics` (the `reportwright_*` families), the report
  storage, folder, audit, auth and admin routes listed there, their JSON bodies, status codes and the
  `x-reportwright-*` headers (including the webhook `x-reportwright-signature` and the proxy's
  `x-reportwright-proxy-secret`).
- `/api/v1/cron` is a host hook (Vercel Cron, `CRON_SECRET`), not part of the API.
- Settings: the `PW_*` environment variables in [CONFIG.md](CONFIG.md). Storage formats (files, SQLite, PostgreSQL)
  are upgraded in place by the server; their internal layout is not an API.

## Not covered

The app's React components and CSS, the Designer's look, the console message wording, warning text in
`model.warnings` (its presence is covered, its wording is not), performance numbers, and anything under `src/`.
