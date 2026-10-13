# Changelog

All `@reportwright/*` packages (formerly `@pagewrightjs/*`) share one version. The versioning policy is in [CONTRIBUTING.md](CONTRIBUTING.md#versioning-semver).

## 1.0.1 — unreleased

Fixes from an early tester's report on 1.0.0. Thank you.

### Changed
- **HTML export subsets fonts by default** (`@reportwright/engine`'s `exportHtml`), as `exportPdf` and the CLI already
  did: a 3-row report's file goes from ~904 KB to ~15 KB. `subset: false` embeds fonts in full as before; when
  `@reportwright/fonts`' `harfbuzz-subset.wasm` cannot be loaded, fonts embed in full with a warning.
- **A misconfigured subsetter throws** instead of silently embedding full fonts: `createSubsetter()` without a loader
  is a `TypeError`, and a subsetter whose wasm does not load (or is not WebAssembly) makes `exportHtml`, `exportPdf`
  and `exportPdfStream` reject with `harfbuzz-subset.wasm did not load (…)`. The engine's default subsetter and the
  viewer's stay lenient (fonts in full, with a warning).
- **`C` formats with no locale are en-US dollars** (`$1,234.50`), as the designer shows and the README says; 1.0.0
  printed the number with no symbol. A report's `locale` or `currency` still wins; a locale with no country (`fr`)
  still has no currency. Excel export follows.
- **Node 20.16 or later** for every package (`engines`): `@reportwright/pdf` needs it; 1.0.0 said 20.9.

### Fixed
- `@reportwright/engine`'s type declarations no longer name `pdf-lib` (not a dependency): a project with
  `skipLibCheck: false` got 13 TS2307 errors. CI now packs the packages, installs them in a new project and runs
  `tsc --noEmit` with `skipLibCheck: false` over every typed entry (`scripts/check-package-types.mjs`).
- `"use client"` is only in `@reportwright/react`'s entry, no longer in a shared viewer chunk (Vue, Svelte and Angular
  builds warned about it).
- The CLI says `1 page`, not `1 pages`, and no page count for CSV, Excel and JSON (`wrote x.csv (0 pages)`).
- Docs: the README and ARCHITECTURE no longer say the PDF exporter uses pdf-lib; the viewer README says
  `engine.worker.js` dynamically imports `engine.worker.bwip.js` (copy both), and gives measured bundle sizes (the
  designer and the barcode library were already lazy chunks; see "Size").

### Known (post-1.0, docs/ROADMAP.md)
- PowerPoint export draws tables as separate text boxes, not native tables.

## 1.0.0 — unreleased

The first stable release. From here on ReportWright follows semantic versioning; what is covered is listed in
[docs/PUBLIC-API.md](docs/PUBLIC-API.md) and the policy is in the README ("Stability and versioning").

### Summary since 0.13.1 (the 0.13.2 and 0.14.0 release candidates)
- **PDFs are written by `@reportwright/pdf`** (pinned `1.0.0`): every report (text, pictures, SVG paths, rounded
  boxes, form fields, PDF/A-2b, encryption, signing, batch merges) goes through it, checked by the tiered writer
  parity gate (pixel-identical pages, same text, qpdf, veraPDF). pdf-lib is no longer a runtime dependency; it is
  loaded from the caller's own install only for `pdfWriter: 'legacy'` and the deprecated `prepare`/`save` options.
- **HTML export is configurable at every level** (`html: interactive | tables | static`, `drillLinks`), from the
  viewer prop down to `PW_HTML_EXPORT`; the default is `interactive`.
- **The rename to ReportWright is finished** (0.13.2): new schema name, headers and metrics; the old names are removed
  in this release (below).
- `pw import <folder>` bulk import, `pw --version`, the viewer's `showWarnings`, typed `@reportwright/fonts-cjk`,
  a minified render worker, publish-then-verify releases, memory fixes for zebra tables and large sorts, and the
  release-gate fixes listed in the rc sections below.

- **Benchmarks on the 1.0 code** (GitHub runs [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719), [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290), [38312329287](https://github.com/MrArun005/reportwright/actions/runs/38312329287)): first among report engines on grouped reports (271 ms at 100 rows, 1,132 ms at 10,000; QuestPDF 397 / 3,111 ms, JasperReports 2,278 / 5,372 ms), 6.1× to 7.9× faster than SSRS's LocalReport on Windows, 1,000,000 rows streamed in 52.4 s at 718 MB (0.13.1: 74.4 s). Losses: QuestPDF is faster on a warm one-page invoice (4.6 ms vs 9.0 ms) and on 1,000 separate invoices (162.7 vs 136.8 files/s); Go and Rust writers are 2× to 3× faster on small files.

### Breaking changes
| Removed | Use instead |
|---|---|
| `exportPdf(model, fontStore, options)`, `exportHtml(model, fontStore, options)` (0.7 positional form; now a `TypeError`) | `exportPdf(model, { fonts: fontStore, ...options })`, same for `exportHtml` |
| `exportXlsx(model, ExcelJS, options)` (now a `TypeError`) | `exportXlsx(model, options)` |
| `PagewrightViewer`, `PagewrightDesigner`, `PagewrightViewerProps`, `PagewrightDesignerProps` (`@reportwright/react`, `@reportwright/vue`) | `ReportWrightViewer`, `ReportWrightDesigner`, `ReportWrightViewerProps`, `ReportWrightDesignerProps` |
| `pagewrightViewer`, `pagewrightDesigner`, `PagewrightAction` (`@reportwright/svelte`) | `reportWrightViewer`, `reportWrightDesigner`, `ReportWrightAction` |
| `definePagewrightElements`, `<pagewright-viewer>`, `<pagewright-designer>`, `PagewrightViewerElement`, `PagewrightDesignerElement`, `PagewrightReadyEvent` (`@reportwright/angular`) | `defineReportWrightElements`, `<reportwright-viewer>`, `<reportwright-designer>`, `ReportWright*Element`, `ReportWrightReadyEvent` |
| `window.Pagewright` | `window.ReportWright` |
| `/embed/pagewright-viewer.js`, `/embed/pagewright-viewer.full.js` | `/embed/reportwright-viewer.js`, `/embed/reportwright-viewer.full.js` |
| Answer headers `x-pagewright-pages`, `-ms`, `-warnings`, `-snapshot`, `-pending` | `x-reportwright-*` (same values) |
| Webhook and audit-SIEM header `x-pagewright-signature`; mail header `x-pagewright-idempotency-key` | `x-reportwright-signature`, `x-reportwright-idempotency-key` |
| Proxy secret header `x-pagewright-proxy-secret` (no longer read: a request with only it gets 401) | `x-reportwright-proxy-secret` |
| Prometheus families `pagewright_*` on `/api/v1/metrics`; `scripts/uptime-check.mjs` reading them | `reportwright_*` |

Kept on purpose: `"$schema": "pagewright/report@1"` is still read as the same format and normalised to
`reportwright/report@1` (documented in docs/PUBLIC-API.md); the designer clipboard kind `pagewright/items@1` and
the TOTP-key and audit-checkpoint salts (changing them would break pasting between tabs and stored data).

### Changed
- `__streamPaint` and `planPaged` (engine) and `LEGACY_DIR` (fonts-cjk) are marked `@internal`: exported for the
  packages' own workers, not part of the public API.

### Upgrading from 0.12 / 0.13
- Install without `@next`: `npm i @reportwright/engine @reportwright/fonts` (`latest` is 1.0.0). Keep every
  `@reportwright/*` package on the same version.
- Replace the removed Pagewright names, headers and metrics with the table above (move dashboards and alerts to
  `reportwright_*`; make the reverse proxy send `x-reportwright-proxy-secret`; read `x-reportwright-signature` in
  webhook receivers).
- Replace the positional export forms with the options object.
- Single sign-on (SAML, OIDC): set `PW_BASE_URL` to the public origin outside development; the sign-in and logout
  addresses are built from it.
- The HTML export default is `interactive` (the viewer in one file). For the 0.13 behaviour set `html: 'tables'`
  (report, admin setting, or `PW_HTML_EXPORT=tables`); the CLI defaults to `tables`.
- A check box's value read back through `@reportwright/pdf` (`doc.fields`) is `true`/`false`; its on-state name is
  `onValue`.
- `render()` keeps table data only with `{ exportData: true }` (since 0.12); re-save SQL reports once in the Designer
  if you skipped 0.12.
- `pdfWriter: 'legacy'` and the `prepare`/`save` options still work (pdf-lib from your own install) and remain
  deprecated.

### Also in 1.0 (merged to main as 0.14.0-rc.7, never published separately)
- **Admission control and PKCS#12 (PR #11).** Render admission counts a request from arrival, before its body, auth or template is read (`bfca0bf9`). A caller over its share gets 429 and the rest 503, each with `Retry-After`. `/api/v1/health` reports `render.arriving`. Signing reads `.p12` files with `node:crypto`; `node-forge` and `@signpdf/signer-p12` are out of production. PKCS#12 parsing is bounded and needs a MAC, with a fuzz test.
- **API keys:** a key seen in the last 30 s skips the credential check's storage leases; a changed `PW_API_KEYS` revokes it at once.
- **PDF/A and parity (PR #10).** PDF/A-2b no longer draws `.notdef` for a character the font lacks. Parity fixes: a tool that cannot run fails its row by name; CRLF checkout and Windows fixes in the build and bench.
- **QA suites (PRs #7, #8).** `qa-load` (admission spike and fairness), a security suite (PDF reader fuzz, SSRF, expression injection, oversized inputs, auth, npm audit, semgrep), a rival-best suite and an engines suite. Benchmarks measure the current releases.
- **Docs.** `docs/compare/` pages for Jasper, SSRS, Puppeteer, pdfmake and Python.
- **Self-host.** `deploy/compose` (docker compose, optional Caddy HTTPS through `PW_DOMAIN`) and `self-host.yml`.
- **Security.** The assess route's upload limits are hardened (PR #29).
- **Security.** The data proxy stops reading an upstream response once it passes its 5 MB limit (PR #30).
- **Security.** Every request body the API reads is size-capped while it is read; `PW_MAX_BODY_KB` (default 1024) sets the limit for control routes (PR #31).
- **`create-reportwright`** scaffolds a sample app (node, react, vue, svelte, angular). Not yet on npm.

## 0.14.0-rc.6 — 2026-10-11 (release candidate)

### Summary
- **`@reportwright/pdf` 0.1.0-beta.14** (was beta.12; beta.13 changed only its README): a check box's `doc.fields` value is `true`/`false` (its on-state name is `onValue`), the Factur-X example passes the EN 16931 XSD (checked in its CI), `Page` and `__bulkWorker` are declared in its types.
- **`@reportwright/fonts-cjk`** ships TypeScript types and installs only the `reportwright-fonts-cjk` command (the old `pagewright-fonts-cjk` name is gone); `scan:packages` fails on any `pagewright` command name or a package without types.


### HTML export is configurable at every level
- **Modes.** `html`: `interactive` (the viewer in one file: groups open and drill-through runs in place) | `tables` (pages and sortable tables) | `static` (pages only, for print). `drillLinks`: `inline` (in place / same tab) | `new-tab` | `off` (shown disabled). Defaults: `interactive`, `inline` — a report sent to a client drills down in place and never opens a tab to a server it cannot reach.
- **Precedence**, most specific first: the viewer's `exportOptions` prop (also a `mountViewer` option) > the report's `export: { html, drillLinks }` (schema-checked; designer **Report properties → HTML export**) > the admin **Settings → HTML export** (saved and audited like the other settings) > `PW_HTML_EXPORT` / `PW_HTML_DRILL_LINKS` > the default. The choice in the viewer's Export options menu applies to that page's exports only and is no longer kept in browser storage.
- **Viewer Export menu:** two entries, **HTML (interactive)** and **HTML (print)**; the one the config makes the default is marked.
- **No silent fallback.** When the interactive file cannot be made (no viewer bundle, or any other failure) the viewer says why and makes the print file only when asked. `npm run dev` builds `public/embed` once when it is missing (`scripts/ensure-embed.mjs`).
- **Static HTML drill-through** links only to a public server: with no `drillBase`/`PW_BASE_URL`, or a localhost / 127.x one, drill-through is shown disabled with a tooltip. With a public one, `inline` links in the same tab (was always a new tab), `new-tab` opens one.
- **CLI:** `pw render -f html --html tables|static` and `--drill-links inline|new-tab|off`; `--static` stays as an alias of `--html static`; `--html interactive` is refused with a clear message (it needs the viewer).
- `exportHtml(model, { drillLinks })` is the engine option for the drill-through mode.

## 0.14.0-rc.5 — 2026-10-11 (release candidate)

### Summary
- **`@reportwright/pdf` 0.1.0-beta.12.** Its build no longer keeps function names (esbuild `keepNames` wrapped every closure in an `Object.defineProperty` call): writing is ~35% faster. Deep benchmark (GitHub, 4 cores): a 100,000-row report through the engine 6.6 s (0.13.1: 8.9 s); a 1,000,000-row report 53 s (0.13.1: 79 s); the library writes the 100,000-row report within 1.82× of Go's fpdf (beta.11: 2.79×). Otherwise the same as rc.4.
- **Known, for 0.14.1:** a warm re-export of the same invoice is ~16 ms (0.13.1: ~12 ms, pdf-lib's cached image path); 1,000 plain pages ~6% slower than 0.13.1; `parallel: 'auto'` on 4 cores was not faster for 1M rows and used twice the memory.
- The `stress-test` tier-1 parity baseline is corrected (owner-accepted): its Zalgo line now extracts as its real combining marks.

## 0.14.0-rc.4 — 2026-10-11 (release candidate)

### Summary
- **Phase B: every report is written by `@reportwright/pdf`.** All 85 gate reports (every repository report, plain and tagged) go through the library; none takes pdf-lib's path. pdf-lib is no longer a runtime dependency of `@reportwright/engine`, `@reportwright/cli` or `@reportwright/viewer`: it is loaded lazily, from the caller's own install (`npm i pdf-lib@1.17.1`), only for `pdfWriter: 'legacy'` and the deprecated `prepare`/`save` (a 501 names the install otherwise). Measured: 500 one-page invoices merge in 1.5 s / 274 MB RSS into 0.44 MB (was 3.9 s / 784 MB / 193 MB); a 600×300 alpha logo exports cold in ~100 ms (was ~270 ms) into 187 KB (was 606 KB); a warm re-export of the same PNG is ~13 ms slower than pdf-lib's cached path.
- **Tiered writer parity gate** (`node scripts/writer-parity.mjs --baseline pdflib --corpus scripts/parity-corpus.mjs`, `scripts/parity-tiers.mjs`, `scripts/parity-tolerance.json`): tier 1 exact (words and boxes to 0.01 pt, structure tree, canonical drawing commands), tier 2 150 dpi greyscale tolerance, tier 3 600 dpi colour tie-breaker, with a pinned rasteriser. Building it found real bugs: a FAIL in the middle of a row was not counted (it hid veraPDF failures), a failed render counted as "not rendered", and three tagged repository reports failed veraPDF (missing ToUnicode) — all fixed. Tagged streamed pages now carry pdf-lib's exact structure (each item its own marked content; ledger-500 tagged 75 → 88 KB).
- **Silent wrong reports now fail or warn.** A half-written filter (no expression, op or value, an unknown op) is a validation error; a sort by a bare field name sorts by that field with a did-you-mean warning, and a constant sort or a group on a bare name warns; a near-miss parameter reference is a validation error with a did-you-mean (parameter names match in any case, as the render does); a misspelt style property warns. **Parameter strictness (`strictParameters`):** a value for an undeclared parameter, or not of its type or options, warns in `render()`, is a 400 on `/api/v1/render` and an error in `pw render`. **Grouping case:** comparisons stay case-insensitive by default (as SSRS); a data set's `caseSensitive` holds in the regions over it, RDL's `CaseSensitivity` True imports as `caseSensitive: true`, and the engine README and FEATURES document both. Valid reports' PDFs are byte-identical.
- **rc.3 CI fixes and the real bugs they found.** CI builds the npm packages before the browser suites and fetches the optional CJK and emoji fonts. Real bugs fixed: the home page offered New report by edit rights on the top folder instead of `canCreateIn` (as the API); the interactive HTML export did not escape `<!--` and `<script` in the inlined viewer bundle; Turbopack left pdf-lib's bindings undefined, so the viewer's accessible and PDF/A exports failed; the designer's browser data requests ignored `PW_INTERNAL_HOSTS`; a SQL query gave up on a pooled connection before its deadline; MySQL storage id-prefix lookups used an invalid `ESCAPE`; pages asked for optional CJK and emoji fonts the server did not have. The e2e suites were brought up to the secure defaults (permissions, users, replicas, sso, tablix, designer-gaps).
- **Font subsets:** the smaller subsets of `@reportwright/pdf`'s own subsetter do not change engine PDFs in this release; the engine's subsets (HarfBuzz, glyph IDs kept) are unchanged and as large as in rc.3. Renumbering them on the engine side is a follow-up.
- The render worker bundles the report schema without its prose (510.6 → 507.2 KB gzipped, `validate()` unchanged).

### Test fixes
- **The "truncated 20,000-row streamed PDF" CI flake was the tests, not the engine.** The tests' `pdftotext` helpers (4 test files) used Node's default 1 MiB `spawnSync` buffer, which cut a 438-page text at page 285 without an error. They now read the whole output (`maxBuffer` 1 GiB) and fail on an error, and the streamed-PDF test checks every page's footer up to the last.
- The lazy-load test expects the engine bundle to import pdf-lib by its non-literal specifier (B4 made it an optional install); the examples name 0.14.0-rc.4.

### Changed
- **`@reportwright/pdf` 0.1.0-beta.11** (was beta.9), now on npm and in `package-lock.json`; pdf-lib and `@signpdf/placeholder-pdf-lib` are devDependencies.
- **`exportPdf` of reports whose pages differ in size, or whose page numbering restarts (`newSection`), no longer loads pdf-lib.** The paged writer writes each page's own height into the outline's places and the links' jumps, and the page labels from the sections. Gate: `node scripts/writer-parity.mjs --baseline pdflib --corpus scripts/parity-corpus.mjs` (pixel-identical, same labels, outline and text).
- **A batch's merged PDF is made by `@reportwright/pdf`** (`loadPdf` + `mergePdfs`; was pdf-lib's `copyPages`). The pages are pixel- and text-identical; the items' outlines and form fields now come along (pdf-lib dropped the AcroForm, so merged fields were dead; fields keep their names, so the same field in two items is one name twice). Shared fonts and images are written once: 500 one-page invoices merge in 1.5 s and 274 MB RSS into 0.44 MB, against 3.9 s, 784 MB and 193 MB.
- **`exportPdf` of reports with PNG and JPEG pictures (data URIs) no longer loads pdf-lib.** Pictures are embedded by `@reportwright/pdf` (`embedImage` + `core.imageResource`) behind the engine's own checks (size limits, `pngProblem`, PNG and JPEG only; `IMAGE_LIMITS.pixels` at 8-bit RGBA as `maxDecodedBytes`), with the same warnings when one is left out. 8- and 16-bit, alpha and JPEG pictures are pixel-identical. **A JPEG with an EXIF orientation is now drawn upright** (pdf-lib ignored it). Smaller files (a 600×300 alpha logo: 606 KB → 187 KB) and faster cold exports (~270 → ~100 ms); a warm re-export of the same alpha PNG is ~13 ms slower than pdf-lib's path with its per-process PNG cache (which stays, on that path). SVG and URL pictures stay on pdf-lib for now.
- **Rounded boxes, SVG path items (charts' lines, areas, pies) and SVG pictures no longer need pdf-lib.** `src/exporters/svgpath.js` is a faithful port of pdf-lib 1.17.1's SVG path code (arcs to Béziers included) that writes the very operators pdf-lib wrote (tested operator for operator), so these pages are pixel-identical; `svgimage.js` has `svgOps`, the operator-text twin of `drawSvg`. Only URL pictures, form fields, PDF/A, tagged, encrypted and signed files stay on pdf-lib's whole-model path now.
- **`exportPdf` with `pdfa: { icc }` (PDF/A-2b, not tagged) goes through `@reportwright/pdf`**, written as `exportPdfStream` writes PDF/A (XMP, output intent, standard fonts in their embedded stand-ins): pixel-identical to pdf-lib's file, veraPDF 2b passes (alpha pictures included). Tagged (PDF/UA, PDF/A-2a) files and PDF/A without a profile stay on pdf-lib.
- **Encrypted PDFs (`encrypt`) are written by `@reportwright/pdf`** (AES-256, R6, metadata encrypted), not pdf-lib plus `encrypt.js`: the same `/P` for every permission set (`PERMISSION_BITS` → the library's `permissions`), the same 400s (unknown permission, a password over 127 bytes, PDF/A), pixel-identical after decryption, and no title, URI or text readable in the raw file. Passwords are prepared with SASLprep (the PDF 2.0 rule) instead of NFKC alone; they differ only for passwords with unusual Unicode spaces or ignorable characters. Encrypted files with form fields, tagged or signed stay on pdf-lib for now; `exportPdfStream` still renders encrypted reports whole.
- **Form fields (text, multiline, check box, drop-down) are made by `@reportwright/pdf`** with appearances drawn exactly as pdf-lib's default providers drew them (`src/exporters/pdffields.js`: the 0.75 pt border, white fill, 1 pt padding, check mark, text placement; shaped values such as Arabic and Devanagari keep the engine's glyphs). Pages are pixel-identical at 72, 150 and 300 dpi; the fields keep their names, values, required and read-only flags, and fill in pdf-lib, pypdf and PyMuPDF (the field font is in the form's /DR now, so pypdf no longer falls back to Helvetica). Field fonts are embedded whole, as before.
- **Signing goes through `@reportwright/pdf`.** `exportPdf` takes `sign: { signer, reason, location, contactInfo, name }` (a `cmsSigner`/`nodeSigner` signer; the server builds one from `PW_SIGN_P12` with `p12Signer` in `src/server/sign.js`) and signs as the file is written: an invisible field, `adbe.pkcs7.detached` over the whole file, as `@signpdf` signed. A report that still takes pdf-lib's path (tagged) is signed by the library in an incremental update. pdfsig: valid, whole document signed; PDF/A signed files pass veraPDF 2b. The server passes `sign` instead of `prepare`/`save`. **Deprecated:** `prepare` and `save` keep working with a one-time `DeprecationWarning` and go in 0.15. `sign` with `encrypt` or with `prepare` is a 400.
- **Jumps to a bookmark by name and URL pictures no longer need pdf-lib.** A name resolves to the first bookmark of that name (a missing one makes no link), as before; a URL picture is fetched with `fetchImage` and checked as data URIs are. Every repository report now goes through `@reportwright/pdf`. One text difference: the stress test's Zalgo line extracts its combining marks as themselves; pdf-lib's file extracted them as "贷" (a wrong ToUnicode entry). Pixels identical.
- **Signing setup is checked and cached.** The `.p12` is opened (its PKCS#12 decrypted) once per process and again only when the file, its size or `PW_SIGN_PASSWORD` changes; the deprecated `@signpdf` signer is made only when its `sign()` is used. A certificate that is expired or not yet valid is refused when it is loaded (a 500 naming `PW_SIGN_P12`).

## 0.14.0-rc.3 — 2026-10-10 (release candidate)

### Fixed (from the rc.2 tester gate)
- **A cut or damaged font subset no longer reaches the PDF.** `exportPdf` on pdf-lib (images, `pdfWriter: 'legacy'`…) checked a subset only by reading it with fontkit, which reads past a short buffer without complaint, so a truncated subset was embedded as is; the streamed writer's check missed a cut within its 16 bytes of padding. Every path (`exportPdf` on pdf-lib and on `@reportwright/pdf`, `exportPdfStream`, TrueType and CFF fonts) now checks the subset's bytes first: the table directory and every table inside the file, each glyph's `loca` range in order and inside `glyf`, a CFF table's header and Name/Top DICT INDEXes in bounds. A subset that fails, or that cannot be made, embeds the full font with a warning ("The font … is embedded whole: its subset could not be used (…)", `onWarning` / the result's `warnings`). Normal reports are byte-identical.
- **`import '@reportwright/fonts'` works.** The package had only subpath exports; its root now exports `fontsUrl`, `subsetWasmUrl` and `iccUrl` (with types). `@reportwright/fonts/public/*` is unchanged.

## 0.14.0-rc.2 — 2026-10-10 (release candidate)

### Fixed (from the rc.1 release gate)
- **Memory of a zebra table in `exportPdfStream`.** A detail row whose style reads `RowNumber()` (`backgroundColor: '=IIf(RowNumber() Mod 2 = 0, "#f3f4f6", "#ffffff")'`) was refused by the streaming planner ("detail expressions", in `r.why`) and rendered whole, so every page stayed in memory: ~3.5–8 KB a row, 558 MB–1 GB at 100,000 rows. It now streams (row styles may read `RowNumber()`, as row values could), and its pages are the whole render's (pixels, text). Peak RSS at 100,000 rows, probe `scripts/eng-probe.mjs`: plain 270 MB, zebra 1,056 → 287 MB, zebra with expression borders and formats 1,261 → 300 MB.
- **Expression styles that give the same values share one style.** Each row's evaluated style was a new object, and the cell styles built on it a new cache entry per row (garbage V8 collected late: about 2× the peak RSS of a plain table and 2.5× its time). Rows whose expressions give the same plain values now share one frozen style (at most 64 per style), so a zebra table renders at about the plain table's speed (100,000 rows: 5.8 s → 2.1 s; plain 1.6 s). Reports without expression styles are byte-identical; the zebra reports' bytes change only because they now stream (same pages, pixels and text).
- The zebra PDF stays larger than the plain one (100,000 rows: 7.4 MB against 3.5 MB): each cell's fill is drawn as a rectangle with its colour (`rg … re f`), as the whole render always drew it; there is no resource per row.

### Docs
- The engine README says when a streamed PDF's memory stays flat, and what "Page N of M" costs (a counting pass: about 1.5–1.8× the time, +10–60 MB at 50,000 rows).

## 0.14.0-rc.1 — 2026-10-10 (release candidate)

### Changed
- **PDFs are written by `@reportwright/pdf`** (pinned `0.1.0-beta.9`, no dependencies of its own), the streaming PDF writer extracted from the engine. `exportPdfStream` (plain, PDF/A, PDF/UA-tagged, `parallel` workers) and `exportPdf` for reports of text (any font, shaped scripts), boxes, ellipses, lines and links go through it. Images, SVG paths, rounded boxes, form fields, encryption, signing (`prepare`), `save` options, and whole-model PDF/A and tagged files stay on pdf-lib for now.
- **The bytes change; the content does not.** `scripts/writer-parity.mjs` exports every report of the gate corpus (the repository's reports, the streaming ledgers, the 54-report tester corpus) with both writers and requires pixel-identical pages (pdftoppm, 72 dpi, zero differing pixels), the same text per page, `qpdf --check` and veraPDF (PDF/A-2b, 2a, PDF/UA-1) passing, the same fonts (embedded, subset), links, outline, structure elements, form fields, attachments, metadata and page labels, and the same bytes on two runs. One accepted difference: right-to-left locale formats (ar-SA, he-IL) no longer carry their invisible bidi marks (U+200F…) in the extracted text, so a viewer copies "Page 1 of 1" instead of "1 of 1 Page"; the words and pixels are the same.
- **`exportPdf` of a plain report no longer loads pdf-lib.** A report in embedded fonts (Inter, Noto) exports about twice as fast (one 300-row grouped table: ~110 ms → ~50 ms cold) and with 5–10 MB less memory; its file is about 5% larger (the font subset keeps glyph IDs, as the streaming writer always did).
- The file ID of a streamed PDF without `id` is now a hash of its content (it was random): the same report and `creationDate` give the same bytes.

### Added
- **`pdfWriter: 'legacy'`** (`exportPdf`, `exportPdfStream`) writes with the engine's old writer exactly as 0.13 did. It is kept for one release as an escape hatch and will be removed in 0.15. Any other value than `'pdf'` (the default) or `'legacy'` is a 400.

## 0.13.2-rc.2 — 2026-10-09 (release candidate)

### Fixed (from the rc.1 release gate)
- **E11 Viewer accessibility:** the scrolling page area (`div.vpages`) is keyboard-focusable (`tabindex="0"`), a named `region`, with a visible inset focus ring; the arrow keys scroll it (axe `scrollable-region-focusable`).
- **E12 Designer arrow keys on pages with margins:** Arrow and Shift+Arrow move the selection by the whole step (1/10 pt, or 1/10 grid steps with Snap to grid). The step used to be clamped to the band's leftover width, so an item as wide as an A4 body with 36 pt margins (523.28 pt) moved 0.28 pt and then not at all. A keyboard nudge still stops at the band's start; overflow past its end shows in the Issues panel. Dragging still keeps items inside the band.
- **E10 webpack and Next.js builds:** `@reportwright/viewer` (`dist/`, `dist/peer/`) and `@reportwright/cli` ship `pdfstreamworker.js` next to the bundles that name it with `new URL('./pdfstreamworker.js', import.meta.url)`, so bundlers resolve it. The parallel PDF paint worker itself is `@reportwright/engine`'s (Node only); the stand-ins answer that `exportPdfStream` with `parallel` needs the engine.
- **E13 missing HarfBuzz subset WASM:** when `harfbuzz-subset.wasm` cannot be loaded (fonts then embed in full, PDFs many times larger), `exportPdf` and `exportPdfStream` warn once on the console and add a warning to the result (the model's `warnings`, the stream result's `warnings`), naming the expected path (`@reportwright/fonts/public/harfbuzz-subset.wasm`) and the fix: install `@reportwright/fonts`, or pass `subset: createSubsetter(() => wasmBytes)`.
- **E09 importer:**
  - files are read in their own encoding: a UTF-16 LE/BE or UTF-8 byte-order mark, else the XML declaration's `encoding` (ISO-8859-1, Latin-1, windows-1252, …), else UTF-8. `Straße` and `Grüße` survive. Applies to `pw import`, `pw import <folder>` and `POST /api/reports/import`.
  - a compiled `.jasper` file gets "This is a compiled JasperReports file; import the .jrxml source instead."
  - `pw import` prints each error once (it printed it twice, the second time cut short).
- **E07 SQL connection pool:** a PostgreSQL or MySQL query that cannot get a pooled connection within `PW_DB_ACQUIRE_MS` (default 5000) fails with 503 and `Retry-After` instead of a 500; a connection that frees later goes back to the pool. A streaming query whose reader aborts frees its connection at once (the backend is terminated and the connection discarded) instead of holding it until the deadline. PostgreSQL queries run under `statement_timeout` from their first statement.

## 0.13.2-rc.1 — 2026-10-09 (release candidate)

### Changed
- **The rename to ReportWright is finished; every old Pagewright name keeps working until 1.0.** New names, with the old one kept as a deprecated alias:
  - report schema: `reportwright/report@1` is now what new and saved reports carry; `pagewright/report@1` is read as the same format (a server before 0.9 cannot open a report saved by 0.13.2).
  - HTTP headers: `x-reportwright-pages`, `-ms`, `-warnings`, `-snapshot`, `-pending`, `-signature` (webhooks and the audit SIEM webhook) and `-idempotency-key` (mail) are sent together with the old `x-pagewright-*` header; the proxy secret is read from `x-reportwright-proxy-secret`, else `x-pagewright-proxy-secret`.
  - Prometheus metrics: `/api/v1/metrics` emits every family as `reportwright_*` and again as `pagewright_*` (the old ones go in 1.0: move dashboards and alerts). `scripts/uptime-check.mjs` reads either.
  - one console warning per page for `definePagewrightElements`, the `<pagewright-viewer>` / `<pagewright-designer>` tags, the Svelte `pagewrightViewer` / `pagewrightDesigner` actions, `window.Pagewright` and `/embed/pagewright-viewer.js` (and `-viewer.full.js`). The React and Vue `PagewrightViewer` / `PagewrightDesigner` stay the same components, without a warning; all are typed `@deprecated`.
  - the live demo moved to https://mrarun005.github.io/reportwright-demo/ (the site build's default base is `/reportwright-demo/`).
  - kept as they are, since changing them would break stored data: the `.pw.json` extension, the designer clipboard format `pagewright/items@1`, and the salts of the TOTP secret key and the audit checkpoint chain.
- **The render worker is minified.** `engine.worker.js` (and `engine.worker.bwip.js`) in `@reportwright/viewer` and the embed builds are minified, still one file with no chunk imports, with a linked source map (`engine.worker.js.map`) beside it so worker stack traces stay readable. `engine.worker.js` 2,195,290 → 1,218,659 bytes (608 → 503 KB gzipped); `engine.worker.bwip.js` 1,651,602 → 973,261 bytes (315 → 267 KB gzipped). The size budget in tests/engine/b10-bundle-size.test.js is now 504 KB gzipped (was 600).
- **Publishing verifies before `latest` moves.** The publish workflow publishes to the `next` dist-tag, installs all nine packages from the registry and smoke-tests them (imports, PDF/XLSX/DOCX export, `qpdf --check`, `pw render`, the viewer's files, the wrappers' peer), and only then moves `latest`.

### Performance
- **Trade-off made by 0.13.1: less memory, about 10–14% slower.** The 0.13.1 fixes for grouped sorts (N44: sort runs spill to disk in smaller runs, about 8 MB) and for streamed tagged PDFs (N44: tagged structure flushed per page) cost time for the memory they save: about 10–14% slower on the tester's 2 vCPU machine (not measured here). Memory: a 200,000-row grouped ledger peaks at 232 MB instead of 280 MB, and the same with 50 runs (1,000,000 rows' run count) 240 MB instead of 296 MB; a tagged streamed PDF at 50k/100k/200k rows holds 6.7/7.3/9.3 MB off-heap instead of 16.8/29.1/36.6 MB. `spillSorter({ runMB, mergeMB })` sets the sort's run size if speed matters more than memory.
### Added
- **`pw import <folder>`: bulk import.** Every `.rdl`, `.rdlc`, `.jrxml`, `.rptdesign` and `.rdlx-json` report in a folder (`--recursive` for subfolders) is imported into `-o <outDir>`, which mirrors the folder.
  - One bad file never stops the batch. Exit 0 means all were imported, 2 some failed, 1 none.
  - Subreports, SSRS shared data sources (`.rds`), JasperReports style templates (`.jrtx`) and images are resolved across the batch. Images are copied once per content. Unresolved references are listed per file.
  - `import-report.json` and a standalone, escaped `import-report.html` give for each file the mapped, approximated and dropped counts, each item's reason, and every expression that was not translated with its line and column.
  - `.pw-import.json` holds the hash of each written file, and a re-run skips an output the user edited unless `--force`.
  - `--verify` renders each report with its embedded or sample data and compares it with the output it replaced.
  - Paths from the folder are untrusted. Links that point outside it are refused, outputs stay in `outDir`, and `--max-files` and `--max-bytes` cap the input.
  - The importers now return structured `items` (each item's notes, untranslated expressions and source position) and take a `resolve` option for shared data sources and style templates.
  - Docs: the CLI README, "Bulk import". Test: tests/engine/c132-import-batch.test.js.
- **`pw --version` / `pw -v`** prints the CLI version (from its package.json) and the version of the engine it carries.
- **`showWarnings`** (viewer option, default `false`): shows the render's warnings under the pages; the designer's Preview always shows them. Documented in the viewer README and typed in `ViewerOptions`.
- **ⓘ help tooltips in the designer.** Long help paragraphs (the Outline, Layers and Parts panels, field hints over 90 characters) sit behind an ⓘ button that opens on hover, keyboard focus or click and closes with Esc; the button is described by the text (`aria-describedby`).
### Fixed
- **An unchecked check box has no tick on the designer canvas.** The canvas drew ✓ in every check box; it now follows the value as the renderer does (`false`, `=False`, a missing value: empty), and dims the tick of a value only the data decides.
- **Selecting an item no longer moves the canvas.** The canvas toolbar grew a second row (24 px) when the align buttons of a selection appeared; it now has one fixed height (it scrolls sideways when narrow) and its hint moved to the status bar.
- **Keyboard nudge steps.** Arrow moves the selection 1 pt, or one grid step with Snap to grid on (a cell in cell mode); Shift+Arrow moves ten of them (it was 4 grid steps); positions stay rounded to 2 decimals.
- **Render warnings in the viewer read as words.** The count says "8 warnings" or "1 warning", not "warning(s)".
- **The Data panel lists a data set's fields when it declares none.** It said "No fields" next to 300 rows; it now detects them from inline JSON or the first rows of fetched data with the engine's own detection (`detectFields`, the one streaming uses) and marks them as detected.
- **No cut-off text in the Inspector and the Outline.** The Regional "Division by zero" choice gets the full width ("Infinity (as SSRS)" was cut); a long name in the Outline wraps inside the panel, with the full name as its tooltip, and the item type and buttons move under it together.
- **The parameter dialog's help matches the viewer.** The live-parameters option no longer says that turning it off adds a View report button (the button is always there), and the panel-columns help says the grid applies on a wide screen.
- **Export options icon.** The sun-like gear is a sliders icon; the button keeps its name, Export options.

## 0.13.1 — 2026-10-09

### Fixed
- **N10: the CJK fonts are named Regular in the PDF.** `@reportwright/fonts-cjk` downloads variable TrueType fonts whose default instance is Thin; 0.13.0 cut and renamed the subset at Regular, but `exportPdf` and `exportPdfStream` built the BaseFont from the full font's PostScript name, so pdffonts showed `NotoSansJP-Thin` / `NotoSansKR-Thin`. Both now take the name from the subset they embed (`NotoSansJP-Regular`). Test: tests/engine/b11-cjk-names.test.js (the downloaded fonts are tested when present).
- **N44: a streamed tagged PDF's memory stays flat.** The writer kept where each object is in arrays of 7 bytes an object that doubled; a tagged million-row ledger has 8–11 million objects (an element per cell), most of tagging's ~125 MB at 1M rows. They are now blocks of 16,384 entries, each deflated (~2 KB) once the numbers are two blocks past; the tagger lets go of a page's elements when it ends. Same file byte for byte (but its ID): veraPDF UA-1 and A-2a pass, same `pdfinfo -struct` tree. Off-heap peak at 50k/100k/200k rows: 16.8/29.1/36.6 MB before, 6.7/7.3/9.3 MB after (RSS ~205 MB either way). Test: tests/engine/b11-n44-tagged-memory.test.js.
- **N45: `pw render` stopped by a signal leaves no temporary file.** SIGTERM (Docker, Kubernetes, CI), SIGINT (Ctrl+C) and SIGHUP remove `<file>.<pid>.part`, keep an older PDF at the path as it was, and exit 143, 130 or 129. Before, every one of them left the `.part` file. Test: tests/engine/b10-perf-cli.test.js.
- **N41: a copied worker starts.** The npm package's `engine.worker.js` bundles its libraries (bidi-js, fontkit) instead of importing them by name, so an esbuild app that copies it next to its bundle renders in the worker (it crashed with "Failed to resolve module specifier bidi-js" and fell back to the main thread). Barcodes and the standard-font metrics are files next to it (`engine.worker.bwip.js`, `engine.worker.stdfonts.js`), as in the browser build; the README says to copy `engine.worker*.js`. Test: tests/e2e/b11-esbuild-worker.mjs.
- **N40: `fonts` is optional.** `render()`, `exportPdf()`, `exportPdfStream()` and the Word, Excel and PowerPoint exports use one default store over `@reportwright/fonts` when given none, and an export loads the fonts the model uses into whatever store it gets, so render and export need not share a store (it failed with "this.loader is not a function" or 'Font "Helvetica" is not loaded'). A report in the standard PDF fonts needs no store and no fonts package (a bold title in a Helvetica report no longer loads Inter-Bold); a font that cannot load says "Install @reportwright/fonts, or pass { fontStore }". Test: tests/engine/b11-fonts-n40.test.js, and the packed packages in all four combinations (packages.test.js).
- **N19: one warning prefix.** The engine package's console warnings and deprecations start with `[reportwright]`, as the rest do (they said `[@reportwright/engine]`).
- **N43: the standard-font metrics are a table.** Helvetica, Times, Courier, Symbol and ZapfDingbats widths and font-wide metrics are generated once from the Adobe AFM data (`scripts/gen-standard-metrics.mjs` → `src/engine/text/standard-metrics.js`, 22 KB, 5 KB gzipped) instead of decompressed with pako from `@pdf-lib/standard-fonts` at every cold start; that package is no longer a dependency of `@reportwright/engine` or `@reportwright/viewer` (pdf-lib still installs it for itself), and the viewer's `engine.worker.stdfonts.js` is gone (the table is in the worker: 588 → 594 KB gzipped, about 100 KB gzipped less in all). PDFs are byte-identical. A new process making a 1-page Helvetica invoice: median of 10, 115 → 94 ms on an M2 (Node 20). Test: tests/engine/b11-fonts-n43.test.js.
- **N42: the designer Outline passes axe.** It was a `listbox` whose rows also hold their move buttons (a listbox may hold only options: aria-required-children, critical). The rows are now toggle buttons (`aria-pressed`) in a labelled group, with the same keyboard: one Tab stop, Up/Down/Home/End, Enter or Space selects.
- **N44: a large sort's memory stays flat.** The disk spill behind grouped and sorted streamed reports held a 1,000-row batch from every sorted run while merging (50 runs at 1,000,000 rows), so its memory grew with the rows. Runs are now about 8 MB (at most 10,000 rows), batches 200 rows, and the merge holds about 4 MB: past that many runs, groups of runs are merged on disk first. A 200,000-row grouped ledger: 280 → 232 MB peak; the same with 50 runs (the run count of 1,000,000 rows): 296 → 240 MB. `spillSorter({ runMB, mergeMB })` sets them. The engine README recommends `presorted: true` with ORDER BY at the source for big grouped reports. Test: tests/engine/b11-mem-spill.test.js.
- **SILENT-6: an item taller than the page warns in `validate()`.** A body item taller than the room the page has for the body (the page less its margins, page header and footer, a body section's own page and bands counted) warns with both heights and what the render does: its lower part is cut at the page bottom (a text box's text of more than one line continues on the next page). Tables, matrices, lists and subreports, which split by their rows, and pageless pages are quiet. `render()` keeps its own warning where it cuts (with the page number) and does not repeat validate's. Test: tests/engine/b11-mem-silent6-tall.test.js.
- **N37: repeated copies cascade.** Ctrl+D (Duplicate) and Paste put a copy 12 pt right and down, and 12 more while an item already sits there, so copying the same item again and again fans the copies out instead of stacking them on the first copy. A pasted coordinate that is not a finite number starts at 0, and the steps are bounded, so a paste of hostile JSON (`1e309`, 2^60) cannot hang the tab. Test: tests/engine/b11-mem-designer-cascade.test.js.

## 0.13.0 — 2026-10-09

A minor release: new options (`largeReportRows`, `signal`, `warnOnLeave`, `onDirtyChange`), the 14 standard PDF fonts, streamed Excel and Word exports, and warnings where mistakes used to be silent. The tester's 0.12.1 tickets are fixed except where noted; fonts are still TTF (WOFF2 is not done).

### Fixed
- **Cold Helvetica invoice (A1.1):** a report that names only the standard PDF fonts loads no font file and no fontkit (Inter loads in a second layout pass only when some text needs it, such as a character WinAnsi lacks), and `exportPdf` writes such a model (standard-font text, boxes, lines, links) with the engine's own PDF writer instead of pdf-lib. A new process making a 1-page Helvetica invoice PDF: about 115 ms instead of 224 ms on an M2, with the same text, fonts and page content. Embedded fonts, images, form fields, PDF/A, tagged, encrypted and signed files still go through pdf-lib.
- **Cold start (A1.1):** pdf-lib and fontkit load on first use (in Node through `require`, elsewhere `import()`), not
  when the engine is imported: `import('@reportwright/engine')` takes about 42 ms instead of 175 ms on an M2, a render
  loads only fontkit, and the streaming PDF writer never loads pdf-lib. A new process making a 1-page invoice PDF:
  about 318 ms instead of 364 ms (most of what is left is compiling harfbuzz-subset.wasm, about 150 ms).
- **Large classic renders (A1.4, A1.5):** `render()` past 100,000 rows warns once (`Large report (N rows):
  exportPdfStream writes it in about 320 MB; render + exportPdf holds it all in memory`), in the model's warnings and
  once per process on the console. The threshold is the render option `largeReportRows` (100000; `0` or `false`: off). `exportPdf` takes a rendered model, so it cannot switch to streaming itself; the
  engine README shows `exportPdfStream` with a sink that keeps the bytes.
- **Excel streams; Word is written page by page (A1.9):** `exportXlsxStream` keeps memory flat; `exportDocxStream` lowers it, but a Word export's memory still grows slowly with the rows, so it is not yet a flat stream. `exportDocxStream` and `exportXlsxStream` (engine package and `src/exporters/officestream.js`) write a report's Word or Excel file to a sink as its pages or rows are made, with `exportPdfStream`'s sink, `timeoutMs` and `signal`; a report that cannot stream is written whole (`why`). `exportDocx` writes the document XML into the zip page by page instead of holding it. Peak RSS of a Word export, 20k / 50k rows: 329 / 499 MB before (render + exportDocx), 259 / 286 MB streamed with a flat live heap (17.5 / 17.3 MB after GC); Excel 251 / 432 MB before, 125 / 126 MB streamed (`scripts/mem-office.mjs`).
- **Viewer first load (A1.6):** the embedded viewer no longer loads the engine (layout, expressions, charts, maps, barcodes) on the main thread up front: the worker renders, and the engine loads on the main thread on the first export, parameter list or main-thread render. First load 827 → 652 KB gzipped (about 262 KB once fontkit loads lazily); the render worker 908 → 579 KB, with bwip-js in `engine.worker.bwip.js` beside it, imported for a report with a barcode (a worker copied alone renders such a report on the main thread). `tests/engine/b10-bundle-size.test.js` holds both to a budget.
- **`pw render -f pdf` streams (A1.4):** into a file, a flowing report is written by `exportPdfStream` (the message says
  `streamed`; the text is the whole-model PDF's), through a temporary file renamed on success, so a failed run leaves
  no damaged PDF. Encrypted files, reports that cannot stream and `-o -` render the whole model as before. A streamed
  grouped report no longer warns that the group totals' internal fields (`__g0_0`) are missing.
- **First PDF of a cold process (Node):** harfbuzz-subset.wasm is compiled synchronously, which V8 does lazily; the async compile also optimized the whole module in the background, and the first export waited for it. A cold 1-page invoice in Inter: export 215 ms → 40 ms, whole process 498 ms → 305 ms (median of 10, M2). Browsers keep the async compile. A PDF in the standard fonts never loads the subsetter.
- **CJK fonts survive upgrades (N10):** `@reportwright/fonts-cjk` downloads into a cache folder outside the package (`REPORTWRIGHT_FONTS_DIR`, else `$XDG_CACHE_HOME/reportwright/fonts-cjk`, else `%LOCALAPPDATA%\reportwright\fonts-cjk` on Windows or `~/.cache/reportwright/fonts-cjk`), so upgrading the package no longer deletes them; `defaultFontStore()` reads that folder, then the package's old `fonts/` folder, so existing installs keep working. New exports: `cacheDir()`, `fontPath(name)`.
- **The 14 standard PDF fonts (A1.2):** `fontFamily` `Helvetica`, `Times-Roman` and `Courier` (four faces each, PostScript names such as `Helvetica-BoldOblique`), `Symbol` and `ZapfDingbats` are named in the PDF and not embedded (Type1, WinAnsiEncoding, the Adobe AFM widths from `@pdf-lib/standard-fonts`); layout measures with the same widths. Aliases: Arial → Helvetica, Times New Roman → Times-Roman, Courier New → Courier. An invoice in Helvetica is about 1.6 KB. Characters WinAnsi lacks are drawn in Inter with a warning; PDF/A and PDF/UA embed Inter (JetBrains Mono for Courier) at the standard font's glyph positions, with a warning; `exportPdfStream` does the same. SVG/HTML name the font with a CSS fallback list, Word and PowerPoint name Arial, Times New Roman or Courier New. `@pdf-lib/standard-fonts` (already installed with pdf-lib) is now a declared dependency, kept external in the packages.
- **Unknown fonts (N39):** a `fontFamily` the engine does not have is no longer swapped silently: the render warns once per name (`Font "NoSuchFont" is not available; using Inter.`), and monospace names (Consolas, Menlo, Monaco…) use the shipped JetBrains Mono instead of Inter, so aligned columns stay aligned. Family names match in any case, a CSS list (`"Brand, Inter"`) uses its first available font, and the generic names `sans-serif` and `monospace` map to Inter and JetBrains Mono without a warning.
- **Streaming tickets, from the 0.12.1 retest (N23-N29):** `exportPdfStream` with `encrypt` or `prepare` and `sqlRows` no
  longer fails with "Save the report first" (the rows are gathered for the whole-model render); a misspelled option
  key (`encrpyt`, `windw`) warns with "Did you mean" in `render()`'s model warnings, `exportPdfStream`'s result and
  `exportPdf`'s `onWarning`, and a misspelling of `encrypt` or `prepare` throws so no file is written without its
  password or signature; `sqlRows` yielding single rows says "sqlRows must yield arrays of rows (got an object with
  keys …)" and sync iterables are accepted; `spill.dir` that does not exist says so; `pw render --base` on a private
  address names `--allow-internal`; README: the temp-file + rename pattern for a failed stream and a `pg` +
  `pg-cursor` `sqlRows` example; the `exportPdf` option docs (pdfa, prepare, save) say what the code does.
- **Data and form-field retest tickets (B9):**
  - A `number` (or `date`) field with text in it (N26) warns once per field with the first bad row and how many values
    are empty, in a render and in a streamed export. Numeric strings such as "12.34" stay silent.
  - A data set whose path matches an object that holds the rows (`data: { orders: { rows: [...] } }`) warns and names
    the array key (N8). An object of fields, such as `$.meta`, does not.
  - `validate()` warns on an aggregate with no scope outside a table, list or data-set item (it uses the first data
    set), and on `nullable: false` or `allowBlank: false` with no default on a parameter that is not required.
  - A form field has a `label` (falls back to `tooltip`); a tagged PDF uses it as the field's accessible name (`/TU`)
    and warns for each field without one (N30).
- **Tagged PDF table of contents (N32):** a TOC is tagged `TOC > TOCI > Reference > Link`, with the entry text, its page number and the link annotation inside one Link (it was plain `P` elements with a Link around the number only), and its title is an `H1`. veraPDF PDF/UA-1: compliant. The streaming PDF's tagging is unchanged.
- **Cascading parameters in the viewer:** when a parent parameter changes, a dependent value its list no longer offers is replaced (by the default if still offered, else the first choice) in the state the run uses, and the report re-runs with it. Before, the panel dropped the value but the run kept the old one ("Delhi, South region" with no rows).
- **Viewer page thumbnails (A11Y-3):** `.vthumb` no longer has an `aria-label` that differs from its visible number (axe `label-content-name-mismatch`); its name "Page 1" comes from hidden text beside the visible 1.
- **Viewer worker fallback (N1):** when the render worker cannot load (Vite 7 without `worker: { format: 'es' }`, or esbuild not following `new Worker(new URL(...))`), the viewer logs once `[reportwright] worker did not load (<reason>); rendering on the main thread`, and `handle.usesWorker` says which one you got. The viewer README now starts with the bundler setup. No Vite plugin: the setting is one line.
- **Worker file (N18):** `engine.worker.js` is one self-contained file (no `chunk-*.js` imports), so copying it alone next to a page works.
- **Viewer fonts (N31):** the viewer fetches a font face only when the layout first needs it, not all seven up front. A report in Inter Regular and Bold now downloads 670 KB (two files) instead of 4.9 MB. Serve `fontsUrl` with `Cache-Control: public, max-age=31536000, immutable` (in the viewer README). WOFF2 for the browser is not done yet.
- **Streaming PDF (`exportPdfStream`) failures, from the 0.12.1 retest:**
  - A sink that stops reading no longer hangs the export: `timeoutMs` covers the waits for drain (504, `code:
    'ETIMEDOUT'`), a sink's `error` or `close` ends the wait, and the new `signal` option (an `AbortSignal`) stops the
    export at its next wait (rows, sink, sort, page) with an `AbortError`. `sqlRows` gets `{ signal }` as its third
    argument. On timeout or abort the rows' cursors are closed and spill files removed.
- **Polar chart without `xValue`** (the angle) says so in validate() and the render ("a polar chart needs xValue"), instead of
  "N of N rows have no x or y value". A valid polar chart gets no warnings.
- **Variable font subsets say their weight:** a variable font cut at Regular is named Regular (family, subfamily, full and PostScript names) with usWeightClass 400, and its variation tables are dropped, in the PDF and HTML subsets.
- **Deprecation messages** all say "will be removed in 1.0" (exportHtml's said 0.9). A test greps the source for a deprecation string that names 0.9.
- **Rich text warnings** say "Rich text:" once (an unnamed item was named "Rich text" and the parser repeated it). The legend warning says what is accepted: a chart's legend is "bottom" or "none", and it is drawn at the bottom.

- **Designer (b9):**
  - Embedded designer: `mountDesigner` asks before the page is left with unsaved changes (`warnOnLeave`, default
    true; false leaves it to the host), and the handle has `isDirty()` and an `onDirtyChange(dirty)` option. The guard is
    removed on save and on `unmount()` (N34). A blank report is named "Untitled report" (it was "New report").
  - Keyboard: the outline rows are a listbox with one Tab stop (Up/Down/Home/End move, Enter or Space selects, Shift
    adds; then Delete and the arrows act on the selection); the left rail's tabs take the focus to their section;
    canvas items are Tab stops named "Text box T1, x 10, y 10" that Enter selects (N35).
  - Paste uses the paste event's clipboard (no clipboard-read permission), else the copy made in this tab, and says
    when there is nothing to paste (N36).
  - Width and height are at least 1 pt (a line may be 0 one way) (N33). Ctrl+D offsets the copy by 12 pt, as a paste
    does (N37).
  - Opening a report gives an item without an `id` a stable one (a hash of its band, place and name), so the same
    file always reads back the same; the other normalisation (names, band heights, a table's size) is unchanged (N38).
  - Embedded designer (shadow root): the table cell menu acts again, and Esc and Ctrl+S work after a click on a band
    label, a matrix or a drill-through in Preview.
  - A table that gets taller (Add group) grows its band; a drop into a 0 pt band grows it. A number field dropped on a
    group header cell gives `=Sum(...)`, as on a footer. A matrix value shown as a percentage gets the format P1 while
    its format is still the default N0. The matrix's drill-down toggle starts closed, as the table's.
  - Accessibility: the fx button is named "fx: Open the expression editor"; table row tags have 4.85:1 contrast.

## 0.12.1 — 2026-10-08

### Fixed
- **Word export: long reports.** The document XML goes to the zip in pieces instead of one string: a 500k-row report
  hit V8's string limit (RangeError: Invalid string length). A report with no tables exports without `exportData`.
- **`exportHtml(model, { fonts, ...options })`** takes the options object like the other exporters; the 0.7 form
  `exportHtml(model, fontStore, options)` still works with a deprecation warning. It threw before ("reading 'get'").
- **Charts: scatter and bubble axes** no longer pad past zero the data does not stay above (0-100 data gives 0 to 120,
  not -50 to 150). Warnings: a row one series leaves blank is drawn by the others, so it is not reported as not drawn;
  a gantt chart has no series by design and gets no "has no series" warning.
- **Variable CJK fonts** are cut at Regular (wght 400), not their default Thin instance, in the PDF and HTML subsets.
- **Data fetch:** gzip, deflate and br bodies are decoded (the byte cap counts decoded bytes); `file:` and `data:` URLs
  are refused with the scheme named, not "its host is made by a parameter".
- **Format characters** (RLM, LRE/LRI, ZWJ/ZWNJ, soft hyphen) need no glyph: no "No font has these characters" warning,
  and no notdef box in the PDF.
- **Warnings:** an unnamed item is named by its type (no "undefined:"), and a sub-report warning that validate and the
  render both say is said once.
- **`parameterOptions()`** lists a parameter's fixed options first, then the fetched ones, each value once (as the viewer does).
- **HTML Tables: date sort keys** use the wall clock, so the same report gives the same keys in every host time zone.

- **Streaming PDF (`exportPdfStream`), from an independent 1M-row verification:**
  - Rows given as an array are read where they are (never copied whole or sorted, tested); JSON given as text is read
    row by row instead of parsed whole (a 300,000-row text source: 910 → 500 MB peak). The README says why a large array
    still shows a large RSS (it is the caller's, and V8 lets garbage grow beside it) and to pass a cursor or text.
  - Grouped and sorted tables: in Node the engine package sorts through a disk spill by default (`spill: { dir, maxMB }`,
    `spill: false`), so a grouped export's memory is flat (300,000 rows: 300 MB, was 670 MB and growing); `presorted:
    true` reads rows that come in the report's order without sorting, checking each against the one before (a row out of
    order stops the export with an error).
  - A data set without declared `fields` streams: its fields are detected from the first 50 rows, as the whole render
    detects them. A report written whole now says why in its first warning, not only in `why`.
  - The window that reaches the last rows is the last one: a table whose footer keeps with its rows could stop with
    "The data changed while the PDF was written".
  - Tagged PDFs are about 27% smaller (a page's borders are one artifact and its cells' text one text object; plain cells
    carry no attributes; the xref stream is predicted). Past a million structure elements the result warns that tools
    which load every object (qpdf, pikepdf) may run out of memory; `tagged.maxElements` caps it.
  - `parallel: N` is documented with its memory (150–300 MB a thread) and when it helps; the example runs serial.
  - The comments of `exportPdfStream` said tagged and PDF/A files do not stream; they do.
  - Note: the non-streaming `exportPdf` still uses pdf-lib, which stays a dependency.
- **BIRT import: SUM and other aggregates total their column.** A bound column with `aggregateFunction` (SUM, AVE,
  MIN, MAX, FIRST, LAST…) had no listed argument, so it fell back to a row count: `Sum(1, …)` showed 3 for a total of
  250.75. The column's own expression is now the argument. An aggregate with no expression is counted as approximated.
  The Jasper and SSRS importers were checked: they already take the expression.
- **Docs: no npm provenance badge.** The repository is private, so npm provenance cannot be generated. The badges and
  the claims are removed from the package READMEs and `docs/RELEASING.md`; the publish workflow stays, and its notes say
  provenance needs a public repository.
- **Docs: the viewer's `data` example** says which shape matches the data set's path: `{ orders: { rows: [...] } }` for
  `"path": "$.rows"`, `{ orders: [...] }` for a data set with no path. A mismatch gives empty tables, silently.
- **Docs: a missing font** stops the viewer's run with a message naming the font and a Retry button; the README said the
  report draws in a fallback font, which it does not.
- **Docs: the engine README** says `pw` is in `@reportwright/cli`, and its quick start has a `statement.pw.json` to save.
- **CLI help** marks `pw audit` and `pw migrate-storage` as server only; the npm CLI does not include them.
- **Engine text:** the CJK font warning names `npx reportwright-fonts-cjk` first (the app's `npm run fonts:cjk` second),
  and the deprecated positional export forms say they are removed in 1.0.

## 0.12.0 — 2026-10-08

Streaming PDF: very large reports are written page by page, with flat memory.

### Added
- **`exportPdfStream(definition, options, sink)`** in `@reportwright/engine`: a report whose body is a flowing table
  (plain or grouped: repeating group headers, subtotals, `RowNumber()`, widow control, keep-together, page breaks) is laid
  out a window of rows at a time and each finished page goes straight to the sink. Peak memory stays flat: about 260 MB
  for the whole render process from 20,000 to 100,000 rows (projected about 250–275 MB at 1,000,000).
  "Page N of M" and footer totals work (a counting pass first). PDF/A-2b, PDF/UA-1 and PDF/A-2a + PDF/UA-1 stream too
  (veraPDF passes). Anything else (images, charts, matrices, rich text, subreports, signing, encryption) falls back to
  `exportPdf`, with the same output.
- **The server streams large PDFs** (`/api/reports/<id>/pdf`, `/api/v1/render`) with the same row caps, deadline, stall
  timeout and abort handling as the CSV/Excel streaming; the viewer's large-report button gets the streamed file.
- **`parallel: N`** (Node, opt-in): page ranges painted on worker threads, byte-identical to the serial file. Measure on
  your hardware before relying on it; each worker costs about 150 MB.
- `examples/stream-1m.mjs` in the engine package: streams a generated million-row ledger to a file and prints peak memory.
- `planPaged` exported for custom pipelines.

### Changed
- The PDF painter is shared between `exportPdf` and the streaming writer; `exportPdf` output is byte-for-byte unchanged.
- The engine package ships its readable bundle without a source map (1.3 MB unpacked).

### Known limits
- In the npm engine, grouped reports sort rows in memory (the server spills them to disk), so a 1M-row grouped report is
  not flat outside the server yet.

## 0.11.0 — 2026-10-08

Everything since 0.10.0. Items marked **Behaviour change** alter output that a pixel-locked layout or a locale-sensitive
export may depend on: check them before you upgrade.

### Behaviour changes
- **Numbers and dates shrink instead of wrapping.** An amount inside a text box shrinks like a number, a short code or a
  header word shrinks before it breaks inside (`Amou|nt`, `m0|2`), and a short text shrinks before it is cut with `…`
  or wraps alone in a one-line box. Reports that relied on the old wrap need a wider box or `shrinkToFit: false`.
- **Widow control is on by default** for every group: a heading or a lone row no longer ends a page. `widowControl: false`
  turns it off. Page counts can change for reports that break inside groups.
- **A group taller than a page splits** with at least two rows on each side of the break, so no lone row sits at a page
  foot or head. A keep-together block no longer leaves a blank page.
- **Sideways tables spread their column sets evenly** over the pages they need (a balanced split, not a long last page).
- **Number grouping follows Intl by default** (es-ES shows `1234,50`). The report option `grouping` is `always` or
  `never`. Unformatted numbers use a Latin decimal sign with Latin digits (ar-SA).
- **Page size names are forgiving.** `"a4 "` and `"letter"` resolve to A4 and Letter. An unknown size (`"A44"`) still
  falls back to A4 with a warning and a suggestion.
- **Data bars:** a value label sits after the bar when it fits, else inside it, right-aligned, in a contrasting ink.
  Negative values draw from a zero line in `negativeColor` (default red); positive-only columns are unchanged.
- **Charts:** column category labels turn (-45) when they do not fit flat, instead of dropping every other label. Scatter
  and bubble axes pad the automatic range so the largest point is not on the frame. `outliers: clip | none` decides what
  happens to points past an explicit axis min or max; clipped points get a ring and a warning. A scatter or bubble row
  with no x or y is no longer drawn at 0 (one warning counts them).
- **Fetched CSV, XML and JSON** read the response charset (ISO-8859-1, windows-1252, ...); UTF-8 is the default and a BOM
  is stripped.
- **Fetch is SSRF-guarded by default:** http(s) only, private and local addresses refused in every spelling, DNS checked
  in Node, each redirect re-checked, parameters fill the path and query only. `allowHosts` and `unsafeFetch` opt out.
- **Expressions read own members only:** `constructor`, `__proto__` and other inherited names give `#Error`.
- **Data fetch errors** name the cause (DNS, refused, reset, TLS, timeout) and redact the URL (query shown as `?…`, no
  userinfo, no keys or tokens).
- **Charts and barcodes get generated alt text** (type, title, series, categories; symbology and value) when the author
  sets none. The author's alt text always wins.
- **Subreport report ids** may use capitals and underscores (still no `/`, `\`, `.` or `..`).
- **Deterministic output:** structure tag ids come from the render's counter, so two renders give one model.
  `exportPdf` takes `creationDate`, or `SOURCE_DATE_EPOCH`; then the dates are UTC and the document ID derives from the
  content.
- **PDF images that cannot be embedded** (GIF, WebP, undecodable, a URL with no `fetchImage`, too large) are left out
  with a warning that names the picture and the reason. A cut or damaged PNG is checked and left out instead of hanging.

### Added
- **Vercel hosting.** `GET /api/v1/cron` runs the schedule tick and the batch queue when `CRON_SECRET` (16+ characters) is set, with `Authorization: Bearer $CRON_SECRET`; without it the route answers 404. `vercel.json` runs it daily. On Vercel, a queued batch runs after its response.
- `PW_STORAGE` falls back to `DATABASE_URL` when unset, on Vercel or with `PW_STORAGE_FROM_DATABASE_URL=1` only (documented in docs/CONFIG.md).
- **Designer: Import report** (File group) reads `.jrxml`, `.rdl`, `.rdlc`, `.rptdesign` and `.json` definitions through
  the importers, and shows the importer's warnings. The CLI (`pw import`) does the same.
- **ViewerHandle:** `setParameters`, `setDefinition`, `goToPage`, `getPageCount`, `print`, `export` (Blob), and `on(ready |
  error | page | parameters)`. The React ref gets the handle. Documented in the viewer README.
- **validate()** warns about unknown format codes (`N2x`), colour names (`redd`), named styles, sort entries not shaped
  `{by, dir}`, date defaults that are not dates, charts with no series, local image paths, and unknown or padded page
  sizes. Each warning has a did-you-mean where one exists.
- **Word export:** heading items are Heading 1 to 6 paragraphs, and the document language is the report locale by default
  (`lang` still wins).
- **Tagged PDF:** link annotations say the link's visible text, else its tooltip, else its URL.
- **PDF drill-through links** open the viewer with their parameters (a URI when the base URL is known). URIs are ASCII,
  the outline holds headings and nests group bookmarks, and every PDF has page labels.
- **Types:** `render()` takes a `RenderOptions` type. Sort entries are `{by, dir}` (`SortSpec`) on data sets, tables and
  lists. `report.d.ts` is regenerated.
- **Strict CSP:** the viewer and the Designer run under `style-src 'self'` with no style element and no style attribute
  written by the engine. See the viewer README.
- **Fonts:** `defaultFontStore({ fontsUrl })` reads a copied fonts folder in bundled apps. A font that does not load is named
  on screen and `onReady` reports it. Faces load lazily, only those a report uses; a face that fails to load falls back to a
  bundled face with a warning.

### Changed
- **Designer accessibility:** Inspector section headings are real buttons (Enter and Space toggle them). Chart gallery
  choices are named by the chart type alone. The Designer's embedded font rules go through a constructable stylesheet.
- **Viewer export menu:** each format is named by its format ("PDF document"), with the badge hidden from screen readers.
- **Toolbar:** `toolbar.hide` takes group keys (`export`, `search`, `zoom`, `navigation`), `sidebar`, and every format id.
  No Export gear when no format is left.
- **Optional CJK and emoji faces** do not add a font warning; their own `NO_CJK_FONTS` warning covers them.

### Fixed
- Subreport ids and render warnings: a render's warning list holds each message once, and a barcode warning names an
  unnamed item by place instead of `undefined`.
- Text with objects, arrays or large numbers from data prints as data, not `[object Object]` or `1e+21`.
- Decimal sums stay exact above 2^49.
- Designer seq fields format as codes (no decimals, no grouping).
- Tables take column widths from the content (`fitColumns`, and columns with no width).
- Styles that are not objects (`"bold"`) are ignored with a validate() warning instead of crashing the render.
- Expression and render guards: a traversal subreport id or a parameter value like `../x` is refused before `loadReport`.
- Server renders: image URLs never reach internal hosts, dev mode included.
- Vite bundles no longer warn 'cannot be analyzed' for the Node-only sharp import.

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
