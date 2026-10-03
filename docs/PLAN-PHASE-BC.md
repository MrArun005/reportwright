# Plan: Phase B (parity) and Phase C (ahead of ActiveReportsJS)

4 Oct 2026. Phase A (correctness + security) is done on `fix/phase-a`. This plan runs on the branch `feat/phase-bc` in the worktree `~/Documents/pagewright-bc`.

Each task is done test-first: a failing Vitest test, then the smallest code that passes. One commit per task (or per clear sub-step). Workers commit on their own branch in their own worktree. The lead verifies the tests again, reviews the diff and merges into `feat/phase-bc`.

## Conventions every task follows

- Plain JavaScript with `// @ts-check` and JSDoc, like the code around it. Short comments that say *why*.
- Messages that users see are plain English sentences, like the ones that exist ("The data set "X" does not exist").
- `src/engine` stays free of React, Next, the DOM and Node-only modules (`node scripts/check-engine-boundary.mjs`). It runs in a Web Worker and in Node.
- Prefer the platform and libraries already installed. A new dependency needs a reason in the commit message.
- Every outbound request from the server goes through `src/server/safeFetch.js` (`serverFetch(self)`). No raw `fetch()` on the server.
- Node 22+ is needed for Vitest: `PATH=/usr/local/bin:$PATH npx vitest run`.
- The full suite stays green: `npx vitest run`, `node scripts/check-engine-boundary.mjs`, and `npm run build` must succeed.
- Commits: no `Co-Authored-By` trailer. No pushes.
- Another agent edits UI files (theme work) in `~/Documents/pagewright`. Never edit that folder.

## Waves

| Wave | Tasks (in parallel, disjoint files) |
|---|---|
| 1 | B1 importer · C1 SQL data sources |
| 2 | B2 + C4 PDF features (one worker: both touch `pdf.js`) · B3 pageless + B4 maps |
| 3 | C2 users, roles, shared storage · C3 AI report authoring |
| 4 | C5 progressive viewer · UI integration (toolbox, import, AI box) · docs |

## B1. ActiveReportsJS importer (`.rdlx-json`)

Files: `src/importers/rdlx.js` (new, pure, no Node APIs), `app/api/reports/import/route.js` (new), `tests/engine/rdlx.test.js`, `tests/fixtures/rdlx/*` (our own files only: the MESCIUS samples have no licence).

- `importRdlx(json) → { definition, warnings }`. It handles both layouts: the older one with `Body`, `PageHeader` and `PageFooter`, and the newer one with `ReportSections[]` (Continuous) and `FixedPage`.
- Units ("1in", "2.5cm", "12mm", "10pt", "96px") become points.
- Map these:
  - Page size and margins.
  - `ReportParameters`.
  - `DataSources`: JSON with `ConnectString` `endpoint=` / `jsondata=`, and CSV.
  - `DataSets`: `Query.CommandText` `uri=…;jpath=…`, `Fields[].DataField`, `Filters`.
  - Items: textbox, image (embedded, URL), line, shape/rectangle (a container with children), table (header/details/footer rows, groups, column widths), tablix as a simple row-grouped table or matrix, list, bandedlist, chart (basic types and series), barcode, subreport, checkbox.
  - Styles: font, colour, border, padding, alignment, format.
  - Visibility.
- Expressions: `=Fields!x.Value` → `=Fields.x`, `Parameters!x.Value` → `Parameters.x`, `Globals!PageNumber` → `Globals.PageNumber`, `ReportItems!x.Value` → a warning. `&`, `IIF`, aggregates with a scope, `Format`, `Code.` → a warning, `Nothing` → `null`, and `Fields!x.Value` inside text.
- Anything not mapped: a warning naming the item and what was dropped. Never throw on unknown input.
- **Done when** the import works on all 9 sample reports in the lead's scratch corpus (`/private/tmp/claude-501/-Users-arunmallikarjun-HRMS/d37bac54-8dc7-42c4-aab2-cf27ec600a2a/scratchpad/rdlx/`, read-only, not committed):
  - It does not throw.
  - `validate()` reports no errors.
  - `render()` succeeds when the data sources are replaced by inline sample rows.
  - The warnings list exactly what was dropped.
- `POST /api/reports/import` (body = the rdlx JSON, ≤ 5 MB via `readDefinition`) saves a new report and returns `{ id, warnings }`.

## C1. SQL data sources

Files: `src/server/sql.js` (new), `app/api/data/sql/route.js` (new), `src/engine/data/index.js` (a `sql` source type), `src/viewer/engineClient.js` and `src/worker/engine.worker.js` (pass `reportId` only), `tests/engine/sql.test.js`.

- The source looks like `{ type: 'sql', connection: 'main', query: 'select … where id = @accountId and region in (@regions)' }`. `@name` binds a report parameter. An array expands to a list of placeholders. It is never string-interpolated.
- Connections come only from the environment: `PW_DB_<NAME>=sqlite:/path/file.db | postgres://… | mysql://…`. SQLite uses the built-in `node:sqlite`. `pg` and `mysql2` are optional dependencies, loaded with a dynamic import only when used.
- Every query runs read-only (SQLite opened read-only; `BEGIN READ ONLY` / `START TRANSACTION READ ONLY`), with a 30 s timeout and at most 100,000 rows.
- Server renders call the driver directly (`opts.sql` hook in `loadSources`). In the browser the engine POSTs `{ report, source, params }` to `/api/data/sql`. The server runs **the saved report's query**, never one from the request. The only exceptions:
  - With users on (C2), a designer may send `{ connection, query, params }` for an unsaved preview.
  - With users off, ad-hoc queries are allowed only outside production.
- **Done when** SQLite tests pass for: binding (including injection attempts staying data), arrays, the read-only guard (an INSERT fails), the row cap, an unknown connection (clear message), and saved-query mode ignoring a query sent by the client.

## B2. Fillable PDF fields

Files: `src/engine/items/fields.js` (new; registered from `items/index.js`), `src/exporters/pdf.js`, `src/exporters/svg.js`, `src/exporters/html.js`, `tests/engine/fields.test.js`.

- The new item is `{ type: 'field', kind: 'text' | 'multiline' | 'checkbox' | 'choice', fieldName, value (expr), options[], readOnly, required }`. In the page model it is `{ t: 'field', … }`.
- PDF: a real AcroForm field, using the pdf-lib form API, with the evaluated default value. Field names stay unique when a field repeats per row (`name_1`, `name_2`, …).
- SVG and HTML draw the box and its value.
- **Done when** a test reads the PDF back with pdf-lib and finds every field with the right type, name and value.

## C4. PDF/A-2b and digital signatures

Files: `src/exporters/pdf.js`, `src/exporters/pdfa.js` (new), `src/exporters/sign.js` (new, server only), `public/icc/` (an sRGB profile with a CC0 or public-domain licence, credited), and the render options in `src/server/renderer.js` and `/api/v1/render` (`pdfa: true`, `sign: true`).

- PDF/A-2b: XMP metadata, the PDF/A identification, an OutputIntent with the sRGB ICC profile, fonts embedded (they already are), no encryption.
- Signatures: a detached PKCS#7 signature (CAdES-compatible) over the ByteRange. The certificate comes from `PW_SIGN_P12` (a path) and `PW_SIGN_PASSWORD`. Use `@signpdf/*` (do not write the cryptography by hand).
- **Done when** tests check that the signature verifies (the CMS digest equals the hash of the ByteRange), that a changed byte breaks it, and that the PDF/A metadata is present. Validate with veraPDF if it can be installed; if not, write "PDF/A not checked by a validator" in STATUS.

## B3. Pageless and dashboard layouts

Files: `src/engine/index.js`, `src/engine/units.js`, `src/engine/schema/template.js` (a `blankDashboard()`), `tests/engine/pageless.test.js`.

- `page.size: 'Pageless'` gives one page as tall as the content (with a minimum height), a width from `page.width` (default 1024), and the page header and footer once.
- The dashboard is a template: a pageless report with a grid of charts and number tiles.
- Every exporter handles the tall page. PDF has a 200-inch page limit; past it, fall back to splitting with a warning.

## B4. Maps

Files: `src/engine/items/map.js` (new; registered from `items/index.js`), `tests/engine/map.test.js`.

- The item is `{ type: 'map', geo: <data set or inline GeoJSON>, joinBy, dataSet, valueExpr, palette, points: { latExpr, lonExpr, sizeExpr } }`. It draws polygons (a choropleth) and point markers with `path` and `ellipse` items, using a Mercator projection fitted to the bounds, plus a legend.
- No map data ships in the repo; the sample uses a small inline GeoJSON.

## C2. Users, roles, shared storage

Files: `src/server/users.js`, `src/server/session.js`, `src/server/storage/*` (new), `proxy.js`, `app/login/page.js`, `app/admin/users/page.js`, `app/api/auth/*`, `app/api/users/*`, and the storage call sites in `src/server/reports.js`, `schedules.js` and `jobs.js`.

- **Accounts:** turned on with `PW_AUTH=users`. Users live in storage, with passwords hashed by scrypt (`node:crypto`). The first admin comes from `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD` on first boot.
- **Sessions:** a cookie that is HMAC-signed with `PW_SESSION_SECRET` (required when accounts are on in production), HttpOnly, SameSite=Lax, with expiry. Logins are rate-limited.
- **Roles:** `viewer` (view and export, saved-query SQL), `designer` (adds editing reports and ad-hoc SQL preview), `admin` (adds users). `proxy.js` enforces them. `PW_BASIC_AUTH` still works when accounts are off.
- **Shared storage:** `PW_STORAGE=file` (default, today's behaviour) or `sql:<connection>`, which keeps reports, versions, schedules and job records in one table set on a C1 connection. Batch output files stay in `data/` (a shared volume if you have several servers; written in STATUS).

## C3. AI report authoring

Files: `src/server/ai.js` (new), `app/api/ai/report/route.js` (new), `tests/engine/ai.test.js`.

- `POST { prompt, sample?: rows, dataSource?: { url | report+source }, base?: reportId }` returns `{ definition, warnings }`.
- It calls the Claude API (key in `ANTHROPIC_API_KEY`; a clear 501 when unset) with the report schema, the item list, a few lines of real data, and the prompt.
- It checks the answer with `validate()` and a trial `render()`, and sends any errors back to the model up to 2 times.
- It is designer-only when users are on. Tests use an injected fetch; there are no live API calls in tests.

## C5. Progressive viewer

Files: `src/viewer/ReportViewer.jsx` (after the theme agent has finished with it), `src/worker/engine.worker.js`.

- Only the visible pages turn into SVG (windowed). The first page shows as soon as the model is ready, and the rest render on scroll.
- **Done when** a 1,112-page report shows page 1 quickly and scrolling stays smooth, checked by Playwright timing in an e2e test.

## Integration (lead)

- Toolbox entries for Field and Map; a Pageless option in page setup.
- Home page: an "Import ActiveReports report" button and a "Describe a report" (AI) box.
- Login page; a users admin page.
- Docs: STATUS, README settings, and the parity map in ARCHITECTURE.
