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
| `PW_PROXY_ALLOW` | run time | Hosts that `/api/data/proxy` may call (comma-separated). Private network addresses are always blocked. |
| `PW_EMBED_ORIGINS` | **build time** | Origin allowed to read `/api/reports` and `/api/sample` from another site (CORS) |

## Test it

```bash
npm test                                   # unit, golden and security tests (Vitest), 109 tests; needs Node 22+
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

## Data sources

- **REST** (GET/POST, headers): a relative URL calls this app; `{Parameters.x}` fills values. Set `useProxy: true` to call another host through `/api/data/proxy`.
- **GraphQL**: query and variables, with `{Parameters.x}` templating.
- **Inline JSON** and **CSV** (inline or by URL).
- **Pushed data**: the render API and batches can send the data in the request. It replaces the source with the same name.

The sample endpoints `/api/sample/loans`, `/api/sample/loans/<account>` and `/api/sample/sales/<year>` serve fictional data.
