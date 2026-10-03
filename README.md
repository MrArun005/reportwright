# Pagewright

A report designer, report engine and report viewer for the web. Next.js app, JavaScript.

Phase 1 of the plan in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Status: [`docs/PHASE1.md`](docs/PHASE1.md).

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Open the home page, then **Loan statement → Design**.

| Page | What it does |
|---|---|
| `/` | Report list. Create a report. |
| `/designer/<id>` | Designer: drag tools and fields, edit in the inspector, Preview tab, ⌘S to save |
| `/viewer/<id>?param=value` | Viewer: parameters, paging, zoom, PDF export in the browser |
| `/api/reports/<id>/pdf?param=value` | The same report rendered to PDF **on the server** |

Reports are JSON files in `reports/*.pw.json`. Commit them with your code.

## Test it

```bash
npm test                              # engine unit + golden tests (Vitest)
npm run build && npm start &          # then, with the server on :3000:
npm run test:e2e                      # builds a report in the designer from scratch, then checks the viewer
node scripts/check-pdf-matches-model.mjs   # every page-model line is in the PDF at the same place
node scripts/check-engine-boundary.mjs     # src/engine has no React, Next or DOM
```

## Layout

```
src/engine/      pure JS engine: expressions, data, text, items, paginator   (no React, no DOM)
src/exporters/   page model → PDF (pdf-lib) and SVG
src/viewer/      React viewer + Web Worker client
src/designer/    React designer (Zustand + immer)
src/worker/      engine Web Worker
app/             Next.js pages and API routes
public/fonts/    bundled OFL fonts (Inter, JetBrains Mono)
reports/         report definitions
tests/           unit, golden and end-to-end tests
```

## Data sources

- **REST**: a relative URL calls this app; `{Parameters.x}` fills values. Set `useProxy: true` to call another host through `/api/data/proxy`. That host must be listed in `PW_PROXY_ALLOW` (comma-separated). Private network addresses are always blocked.
- **Inline JSON** and **CSV** (inline or by URL).

The sample REST endpoint `/api/sample/loans/<account>` serves fictional loan data for `LN-2026-004417` and `LN-2025-001982`.
