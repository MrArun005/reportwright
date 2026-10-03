# Pagewright

A report designer, report engine, report viewer and report automation server for the web. Next.js app, JavaScript.

The plan is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). All four phases are done. Status and gaps: [`docs/STATUS.md`](docs/STATUS.md). Automation API: [`docs/API.md`](docs/API.md).

## Run it

```bash
npm install
npm run dev                 # http://localhost:3000
# or, for production:
npm run build               # also builds the embed bundle
PW_API_KEYS=change-me npm start
```

Open the home page. Three sample reports are there: **Loan statement**, **Sales by region** (groups, drill-down, cascading parameters) and **Sales dashboard** (charts, matrix, QR code, sparklines).

| Page / route | What it does |
|---|---|
| `/` | Report list. Create a report. |
| `/designer/<id>` | Designer: toolbox, inspector, data panel, Preview tab, ⌘S to save, `?` for shortcuts |
| `/viewer/<id>?param=value&lang=hi` | Viewer: parameters, paging, zoom, search, document map, drill-down, exports |
| `/api/reports/<id>/pdf?format=pdf\|xlsx\|html\|csv` | The report rendered **on the server** |
| `/api/v1/*` | Automation API: render, batches, schedules (needs an API key) |
| `/embed/pagewright-viewer.js` | Script to put the viewer in another web app |

Reports are JSON files in `reports/*.pw.json`. Commit them with your code. Each save keeps a version in `reports/.history/` (last 50).

## Put the viewer in another app

```html
<div id="report"></div>
<script src="https://reports.example.com/embed/pagewright-viewer.js"></script>
<script>
  Pagewright.mountViewer('#report', {
    server: 'https://reports.example.com',
    report: 'loan-statement',
    params: { accountId: 'LN-2025-001982' },
    lang: 'en',
  });
</script>
```

The viewer runs in a Shadow DOM, so the host page styles do not change it. Set `PW_EMBED_ORIGINS` **before `npm run build`** to let the host origin read reports and sample data.

## Settings (environment variables)

| Variable | When read | What it does |
|---|---|---|
| `PW_API_KEYS` | run time | Comma-separated keys for `/api/v1`. Send `Authorization: Bearer <key>` or `x-api-key`. **Required in production.** |
| `PW_ALLOW_KEYLESS` | run time | `1` lets `/api/v1` answer without a key in production. Do not use this on a public server. |
| `PW_WEBHOOK_SECRET` | run time | Signs webhook bodies: header `x-pagewright-signature: sha256=<HMAC-SHA256 hex>` |
| `PW_BASE_URL` | run time | Public URL of this server, used for relative data URLs in batches and schedules |
| `PW_BATCH_CONCURRENCY` | run time | Reports rendered at the same time in a batch (default 2) |
| `PW_SCHEDULER` | run time | `off` stops the built-in scheduler (for example on extra replicas) |
| `PW_BASIC_AUTH` | run time | `user:password` for the whole app (designer, viewer, report storage, server renders). `/api/v1` keeps its API keys; the embed script and fonts stay open. **Set this, or put the app behind your SSO proxy, before you expose it.** |
| `PW_INTERNAL_HOSTS` | run time | Host names that server-side fetches may reach on a private network (internal data APIs, a webhook receiver on your LAN). Comma-separated. Every other private or local address is refused (SSRF guard). |
| `PW_SIGN_P12`, `PW_SIGN_PASSWORD` | run time | A .p12 certificate and its password. With them, `/api/v1/render`, batches and schedules can sign PDFs (`"sign": true`; a detached PKCS#7 signature over the whole file). Only API-key routes sign. |
| `ANTHROPIC_API_KEY`, `PW_AI_MODEL` | run time | Turns on AI drafting (`/api/ai/report`). The model defaults to `claude-opus-5`. |
| `PW_PROXY_ALLOW` | run time | Hosts that `/api/data/proxy` may call (comma-separated). Private network addresses are always blocked. |
| `PW_DB_<NAME>` | run time | A database for SQL data sources. `connection: 'main'` in a report reads `PW_DB_MAIN` (any case). `sqlite:/path/file.db` (built into Node 22), `postgres://user:pass@host/db` (needs `npm install pg`) or `mysql://user:pass@host/db` (needs `npm install mysql2`). Give it a database user that can only read. |
| `PW_EMBED_ORIGINS` | **build time** | Origin allowed to read `/api/reports` and `/api/sample` from another site (CORS) |

## Test it

```bash
npm test                                   # unit, golden and security tests (Vitest), 130 tests; needs Node 22+ (PW_TEST_PG=postgres://… adds 3 Postgres tests)
./scripts/restart.sh                       # build and start on :3000 with test keys (PORT=3100 ./scripts/restart.sh for another port)
node tests/e2e/build-from-scratch.mjs      # Phase 1 exit test: build a report in the designer
node tests/e2e/smoke.mjs                   # viewer smoke test
node tests/e2e/expr-editor.mjs             # CodeMirror expression editor
node tests/e2e/phase2.mjs                  # groups, drill-down, sort, map, search, cascading params, exports
node tests/e2e/phase3.mjs                  # charts, matrix, barcodes, subreports in the designer and viewer
node tests/e2e/phase4.mjs                  # smart guides, shortcuts, themes, history, columns, TOC, embed
node tests/e2e/api.mjs                     # render API, auth, batches, webhooks, schedules
node scripts/check-pdf-matches-model.mjs   # every page-model line is in the PDF at the same place
node scripts/check-engine-boundary.mjs     # src/engine has no React, Next or DOM
npm run perf                               # 50,000 rows → 1,112 pages
```

## Layout

```
src/engine/      pure JS engine: expressions, data, text, items, paginator   (no React, no DOM)
src/exporters/   page model → PDF (pdf-lib + HarfBuzz subsetting), SVG, Excel, HTML, CSV
src/viewer/      React viewer + Web Worker client
src/designer/    React designer (Zustand + immer)
src/embed/       entry for the embeddable viewer bundle
src/server/      report storage, versions, renderer, auth, batch jobs, cron, schedules
src/worker/      engine Web Worker
app/             Next.js pages and API routes
public/fonts/    bundled OFL fonts (Inter, JetBrains Mono)
reports/         report definitions (+ .history versions)
data/            run-time state: jobs, schedules, folder outputs (not in git)
tests/           unit, golden and end-to-end tests
```

## Draft a report with AI

`POST /api/ai/report` with `{ "prompt": "Monthly sales by region with a chart", "sample": [ …rows… ], "url"?: "https://…", "base"?: "<report id to change>" }` returns `{ definition, warnings, tries }`. Nothing is saved: review the draft, then `POST /api/reports` with `{ name, definition }`.

- Claude (`claude-opus-5`, override with `PW_AI_MODEL`) writes the definition from a description of the format built from the engine's own item list. Pagewright checks it with `validate()` and a trial render on your sample rows (which never fetches anything), and sends any problems back, 3 tries in all. Refusals come back as a clear 422; the request opts in to the API's server-side fallback model.
- Needs `ANTHROPIC_API_KEY`. In production it also needs accounts (`PW_AUTH=users`, designer role) or `PW_BASIC_AUTH`, because every draft costs money.
- Your sample rows are sent to the Anthropic API. Send a few representative rows, not personal data you may not share.

## PDF/A and signatures

- **PDF/A-2b**: add `"pdfa": true` to `/api/v1/render` or a batch, or `?pdfa=1` to `/api/reports/<id>/pdf`. The file gets XMP metadata, the sRGB output intent (`public/icc`), a file id and printable annotations. The sample loan statement passes veraPDF 1.30 (PDF/A-2B profile), signed and unsigned.
- **Signatures**: add `"sign": true` to `/api/v1/render`, a batch or a schedule, with `PW_SIGN_P12` and `PW_SIGN_PASSWORD` set. The signature is `adbe.pkcs7.detached` over the whole file (Poppler `pdfsig`: "Signature is Valid"). It is not a PAdES baseline signature (no signing-certificate attribute, no timestamp).

## Data sources

- **REST** (GET/POST, headers): a relative URL calls this app; `{Parameters.x}` fills values. Set `useProxy: true` to call another host through `/api/data/proxy`.
- **GraphQL**: query and variables, with `{Parameters.x}` templating.
- **Inline JSON** and **CSV** (inline or by URL).
- **SQL** (SQLite, Postgres, MySQL): `{ type: 'sql', connection: 'main', query: 'select … where id = @accountId and region in (@regions)' }`. The connection comes from `PW_DB_MAIN`; a report never holds a host or a password. `@name` binds the report parameter `name` through the driver, so a value is never pasted into the SQL. A multi-value parameter becomes a list (`in (@regions)`); an empty list matches nothing (it becomes `NULL`, so `not in (@regions)` matches nothing too). Only one `SELECT` (or `WITH … SELECT`) statement runs, in a read-only transaction (SQLite: the file opened read-only), for at most 30 s and 100,000 rows. Server renders query the database directly. In the browser the viewer sends only the report id, the source name and the parameters to `/api/data/sql`, and the server runs **the query saved in that report**. A query sent with the request (a preview of unsaved work) runs only outside production. SQLite queries run on the server's main thread, so the 30 s limit does not stop them: keep SQLite for small local files.
- **Pushed data**: the render API and batches can send the data in the request. It replaces the source with the same name.

The sample endpoints `/api/sample/loans`, `/api/sample/loans/<account>` and `/api/sample/sales/<year>` serve fictional data.
