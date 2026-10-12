# ReportWright

**Live demo: [gallery, designer and viewer](https://mrarun005.github.io/reportwright-demo/) · [Playground](https://mrarun005.github.io/reportwright-demo/play.html) · [Compare with Jasper, SSRS, Puppeteer, pdfmake and Python](#compare)**

**Paged reports for the web: a drag-and-drop designer, an embeddable viewer and a JavaScript engine that writes PDF, Excel, Word, PowerPoint, HTML and CSV. No Chromium. MIT licensed.**

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fengine?label=%40reportwright%2Fengine)](https://www.npmjs.com/package/@reportwright/engine) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![node](https://img.shields.io/badge/node-22.x-339933)](package.json) [![live demo](https://img.shields.io/badge/demo-live-c0392b)](https://mrarun005.github.io/reportwright-demo)

<p>
  <a href="https://mrarun005.github.io/reportwright-demo/"><img src="docs/screenshots/ui-designer.jpg" alt="The ReportWright designer: toolbox, page with a grouped invoice table, and the report properties panel" width="64%"></a>
  <a href="https://mrarun005.github.io/reportwright-demo/#gallery"><img src="docs/screenshots/sales-dashboard.png" alt="A rendered sales dashboard: stacked columns, donut, line chart, matrix and sparklines" width="34%"></a>
</p>

## Quickstart: JSON definition to PDF

```bash
mkdir pw-hello && cd pw-hello && npm init -y >/dev/null && npm pkg set type=module
npm i @reportwright/engine@next @reportwright/fonts@next
```

Save as `report.mjs` and run `node report.mjs`:

```js
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
import fs from 'node:fs';

const report = {
  $schema: 'reportwright/report@1', name: 'Invoice', page: { size: 'A4', margins: [48, 48, 48, 48] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [{ item: 'Design', amount: 1200 }, { item: 'Hosting', amount: 99.5 }, { item: 'Support', amount: 450 }] } }],
  dataSets: [{ name: 'Lines', source: 'src', path: '$.rows' }],
  sections: { body: { items: [
    { type: 'textbox', name: 'Title', x: 0, y: 0, w: 400, h: 28, value: 'Invoice #1042', style: { fontSize: 20, fontWeight: 'bold' } },
    { type: 'table', name: 'Lines', x: 0, y: 44, w: 400, h: 60, dataSet: 'Lines', columns: [{ width: 280 }, { width: 120 }],
      header: [{ height: 20, cells: [{ value: 'Item', style: { fontWeight: 'bold' } }, { value: 'Amount', style: { fontWeight: 'bold', textAlign: 'right' } }] }],
      detail: [{ height: 20, cells: [{ value: '=Fields.item' }, { value: '=Fields.amount', style: { format: 'C2', textAlign: 'right' } }] }],
      footer: [{ height: 20, cells: [{ value: 'Total', style: { fontWeight: 'bold' } }, { value: '=Sum(Fields.amount)', style: { format: 'C2', textAlign: 'right', fontWeight: 'bold' } }] }] },
  ] } },
};

const fonts = defaultFontStore();
fs.writeFileSync('invoice.pdf', await exportPdf(await render(report, { fontStore: fonts }), { fonts }));
```

`invoice.pdf`, page 1 (top), exactly as this script wrote it with `@reportwright/engine@0.14.0-rc.5`:

![The invoice rendered by the quickstart](docs/img/quickstart-invoice.png)

The same definition opens in the designer, renders in the browser viewer, and exports to Excel, Word, PowerPoint, HTML and CSV.

## Compare

Measured on GitHub Actions runners, every output checked; losses included.

- [Coming from JasperReports](docs/compare/jasperreports.md): `pw import` for `.jrxml`, what carries over, numbers
- [Coming from SSRS / Report Builder](docs/compare/ssrs.md): `pw import` for `.rdl` / `.rdlc`
- [PDF without Chromium: vs Puppeteer](docs/compare/puppeteer.md)
- [vs pdfmake, @react-pdf/renderer and jsPDF](docs/compare/pdfmake-react-pdf.md)
- [JavaScript vs Python for PDFs](docs/compare/python.md): WeasyPrint, ReportLab, PyMuPDF, pypdf, pdfplumber

## Install

Start a new app with a sample report (Node, React, Vue, Svelte or Angular):

_Not on npm yet: `npm create reportwright` returns 404 until the first release._

```bash
npm create reportwright@latest my-app
```

Or use the packages in your own app (no server needed):

```bash
npm i @reportwright/engine@next @reportwright/fonts@next      # render and export in Node or the browser
npm i @reportwright/viewer@next @reportwright/fonts@next      # the viewer and designer in a web page
npm i -D @reportwright/cli@next @reportwright/fonts@next      # `pw` on the command line
```

Or run the full self-hosted server (designer, report storage, users, schedules, API) from this repository: see [Run it](#run-it).

| Package | What it is |
|---|---|
| [`@reportwright/engine`](packages/engine) | definition + data → pages → PDF, PDF/A, PDF/UA, XLSX, DOCX, PPTX, HTML, CSV |
| [`@reportwright/viewer`](packages/viewer) | embeddable viewer and designer (shadow root, Web Worker rendering) |
| [`@reportwright/cli`](packages/cli) | `pw render`, `pw test`, `pw diff`, `pw import` |
| [`@reportwright/fonts`](packages/fonts) / [`fonts-cjk`](packages/fonts-cjk) | bundled fonts, HarfBuzz shaper and subsetter; CJK and emoji |
| [`react`](packages/react) · [`vue`](packages/vue) · [`svelte`](packages/svelte) · [`angular`](packages/angular) | framework wrappers for the viewer and designer |

## 30-second example

```bash
npm i -D @reportwright/cli@next @reportwright/fonts@next
npx pw render reports/charts-showcase.pw.json -o charts.pdf     # in a clone of this repository: any report in reports/ with inline data
```

In code (the full minimal report definition is in the [engine README](packages/engine#quick-start-30-seconds)):

```js
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
import fs from 'node:fs';

const fonts = defaultFontStore();
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts });
fs.writeFileSync('statement.pdf', await exportPdf(model, { fonts, title: 'Statement' }));
```

## Screenshots

Page 1 of reports in [`reports/`](reports), rendered to PDF by this engine with `pw render`, then rasterised with `pdftoppm`.

| | | |
|---|---|---|
| ![Sales dashboard](docs/screenshots/sales-dashboard.png)<br>**Sales dashboard**: stacked columns, donut, line, matrix, sparklines, data bars, QR code | ![Charts showcase](docs/screenshots/charts-showcase.png)<br>**Charts**: combo with a second axis, 100% stacked, range band, step line, log scale, bubble | ![Disbursements by region](docs/screenshots/sales-by-region.png)<br>**Grouped table** with drill-down toggles and subtotals |
| ![Loan statement](docs/screenshots/loan-statement.png)<br>**Loan statement**: a repayment schedule over 8 pages | ![Loan statement in Hindi](docs/screenshots/loan-statement-hindi.png)<br>**The same statement in Hindi**: Devanagari shaped with HarfBuzz | ![Tablix showcase](docs/screenshots/tablix-showcase.png)<br>**Pivots**: row and column groups, recursive hierarchy, merged cells |
| ![Invoice](docs/screenshots/invoice-gallery.png)<br>**Invoice**: one table plain, one grouped with subtotals | ![Designer](docs/screenshots/ui-designer.jpg)<br>**Designer** (live demo) | ![Viewer](docs/screenshots/ui-viewer.jpg)<br>**Viewer** (live demo gallery) |

## Features

| Area | What you get |
|---|---|
| Design | Drag-and-drop designer with toolbox, data panel, inspector, outline, live preview, undo; master reports, part libraries and themes |
| Layout | Page header and footer, bands, tables with groups, subtotals, keep-together and page breaks; matrices (pivot); lists; subreports |
| Items | Text and rich text, images, lines and shapes, charts, sparklines, data bars, bullets, barcodes and QR codes, maps, form fields |
| Data | Inline JSON, REST, GraphQL, SOAP, OData, CSV, XML; SQL through your own callback (server: see [docs/DATA-SQL.md](docs/DATA-SQL.md)) |
| Text | HarfBuzz shaping (Arabic, Hebrew, Indic, Thai), bidi, font subsetting; CJK and emoji with `@reportwright/fonts-cjk` |
| Output | PDF, PDF/A-2b and 2a, PDF/UA-1 (checked with veraPDF), AES-256 passwords; Excel, Word, PowerPoint, HTML, CSV, SVG |
| Viewer | Paging, thumbnails, document map, search, zoom, parameters, interactive sort, drill-down and drill-through, export, print |
| Import | JasperReports `.jrxml`, SSRS `.rdl`/`.rdlc`, BIRT `.rptdesign`, ActiveReports `.rdlx-json` (`pw import`) |
| Scale | Streaming PDF, Word and Excel export; disk-spilling sort; worker pool |
| Testing | `pw test` snapshot tests and `pw diff` between two versions of a report |

The full list, with what is not done yet, is in [docs/FEATURES.md](docs/FEATURES.md) and [docs/STATUS.md](docs/STATUS.md).

## How it works

- A report is a JSON file (`*.pw.json`, schema `reportwright/report@1`): page setup, parameters, data sources, data sets and the items in each band.
- `render()` fetches and binds the data, evaluates the `=Fields.x` / `=Sum(...)` expressions and paginates into a page model: positioned text runs, boxes, lines and images.
- The text layer shapes every run with HarfBuzz (WebAssembly) and measures it with the real font, so the page breaks are the same in Node and the browser.
- Exporters turn the page model into files: PDF through [`@reportwright/pdf`](https://www.npmjs.com/package/@reportwright/pdf) with subset fonts, and XLSX, DOCX, PPTX, HTML and CSV from the same model.
- The viewer and designer run the same engine in a Web Worker inside a shadow root; the optional Next.js server adds storage, versions, users and roles, schedules and an automation API ([docs/API.md](docs/API.md)).

## Benchmarks (honest summary)

The deep benchmark runs on GitHub's `ubuntu-latest` runners against other PDF libraries and report engines, with every output checked (qpdf, MuPDF, pdf.js, veraPDF). Full tables, including every row where we lose: [`bench/deep/RESULTS.md` on the `bench-deep` branch](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md) (run of 10 Oct 2026, engine `perf-startup@13fa2cb34`).

- **Where we win.** Among report engines (which lay pages out from a definition), ReportWright is first in 4 of 8 grouped-report rows and 2 of 6 plain-text rows (time or size). pdfmake, @react-pdf/renderer and Puppeteer were 1.4× to 11.8× slower than ReportWright in the earlier run and were not re-measured. As a PDF writer, `@reportwright/pdf` is first on PDF/A-2b, incremental metadata edits, form fill-and-flatten and signing.
- **Where we lose.** QuestPDF (.NET) is faster on most report-engine rows: 1.1× to 2.0× on plain text, grouped reports at 100 to 1,000 rows, invoices and Unicode text. pdfmake is 1.05× faster on the PDF/A invoice. As a low-level writer, `@reportwright/pdf` is 2× to 6× slower than fpdf on raw drawing, and pdfcpu and pdfium are faster at merge, split, encrypt and text extraction.
- **This release vs 0.13.1**, same machine: grouped reports 0.70× to 0.94× the time, Hindi/Arabic/CJK 0.70×, cold invoice 0.89×; warm invoice unchanged.

## Run it

```bash
npm install
npm run dev                 # http://localhost:3000
# or, for production:
npm run build               # also builds the embed bundle
PW_BASIC_AUTH=admin:change-me PW_API_KEYS=change-me npm start
```

**Production needs a sign-in.** With `NODE_ENV=production` (`npm start`, the Docker image) and no sign-in set up, the server fails closed: it logs a warning at start and answers 401, with how to fix it, to every page and API except static files and `/api/v1` (which has its own keys). Pick one:

| Setting | Who gets in |
|---|---|
| `PW_AUTH=users` (+ `PW_SESSION_SECRET`) | People with their own accounts and roles, or single sign-on (OIDC, SAML). See [Users and roles](#users-and-roles). |
| `PW_BASIC_AUTH=user:password` | Everyone who has the shared password. They can do everything, SQL included. |
| `PW_AUTH=proxy` | Everyone who reaches the app. Only behind a reverse proxy that signs people in (oauth2-proxy, Cloudflare Access, your SSO gateway) and that nothing can bypass. **`PW_PROXY_SECRET` is required in production** (16+ random characters; the server refuses to start without it): the proxy sends it as `x-pagewright-proxy-secret`, and a request that reaches the app port around the proxy is refused (401). ReportWright reads no identity header from the proxy: whoever comes through it is one trusted operator, as with `PW_BASIC_AUTH`. |
| `PW_PUBLIC_READONLY=1` (with none of the above) | Anyone may open and render the saved reports, **including the rows their saved queries return**; nobody can change anything, run SQL of their own, or open the designer. |

With `PW_EMBED_ORIGINS` and `PW_BASIC_AUTH`, report definitions (`GET /api/reports/<id>`, which hold SQL text and data-source headers) and sample data are readable without the password, for embedded viewers: keep secrets out of definitions, or use accounts (then only reports shared with `group:public` are). With `PW_AUTH=proxy` they need the proxy secret like everything else.

In every mode, a change (POST, PUT, PATCH, DELETE outside `/api/v1`) must come from a ReportWright page: the `Origin` (or `Referer`) header must name this server, so another site cannot post to it. A report's SQL, and its data sources that may reach a host in `PW_INTERNAL_HOSTS`, run only as a designer (or a service API key) saved them: the server records a fingerprint of those sources at each save, and a definition changed any other way (a file edited on disk, a storage row, a report saved while an older version of the server was open) refuses to run them until a designer saves it again. After upgrading, open and save each report that uses SQL once.

`PW_BASIC_AUTH` must be `user:password` with both parts set; any other value is ignored (with a warning at start), so the server stays closed.

Set **`PW_BASE_URL`** (this server's public URL) in production. The server never takes its own address from a request (Host, X-Forwarded-Host): relative data URLs (`/api/...`) in server renders, thumbnails, batches and schedules resolve against `PW_BASE_URL`, and without it they fail with a message naming it. A report's data sources in the browser (viewer, designer preview) may only read data from this server too: sample data, the data proxy, saved SQL, and paths that are not ReportWright's own; never another ReportWright API with the viewer's cookie. A viewer's API key cannot aim batches or schedules (`itemsFrom`, `putUrl`, `webhook`, `baseUrl`) at `PW_INTERNAL_HOSTS`. A data source may only read (GET) from this server; the server's own credentials (the `PW_BASIC_AUTH` password, a one-request viewer pass with accounts on) go to this server only, never to another host, and a report's own `Origin`, `Cookie` and `Authorization` headers are dropped on those calls. Those credentials go only to `PW_BASE_URL`'s exact origin (scheme, host and port), never across a redirect to another origin; a URL with a user name or password in it is refused. Every URL the server fetches (data sources, images, the data proxy, batch lists, uploads, webhooks, redirects) is parsed once, and that same parsed URL is checked and fetched, connecting to the address the check resolved; a host the parser would rewrite (`0x7f.1`, `2130706433`, `[::ffff:127.0.0.1]`, percent-encoding, backslashes, a trailing dot) is refused (400). In the browser, a report's data requests send cookies only to this server's own data routes, follow no redirect on this server, and send nothing to other sites (an embedding page included). An API that your reverse proxy serves on the same host gets no cookies from a report either, and may not redirect: give it its own host, or a token in the data source's headers. A REST source cannot post SQL of its own to `/api/data/sql`; only a report's saved SQL runs. The data proxy (`/api/data/proxy`) follows redirects only to `PW_PROXY_ALLOW` hosts and answers JSON, CSV or text, anything else as bytes. A redirect from a public host cannot lead into this server or a `PW_INTERNAL_HOSTS` host.

**Hosts in data URLs are fixed in production** (`PW_FIXED_FETCH_HOSTS`, default `1` in production and `0` in development): a data source the server fetches must write its host out. Parameters and expressions may fill the path and the query (`https://api.example.com/loans/{Parameters.id}?from={Parameters.from}`), not the host (`={Parameters.url}`, `http://{Parameters.host}/x`); such a report answers 403 in server renders. Image URLs then do not reach `PW_INTERNAL_HOSTS` either. Set `PW_FIXED_FETCH_HOSTS=0` to allow dynamic hosts (they still pass the SSRF guard).

Schedules and batches belong to the API key that made them: once the key is out of `PW_API_KEYS` they stop, in every mode. In production, ones made without a key (keyless API) are no one's and stop too: recreate them with a key.

`npm run dev` (development) stays open to whoever reaches it, writes from this site only, and answers only to a local host name (`localhost`, `127.0.0.1`, `::1`, the `PW_BASE_URL` host, and `PW_DEV_HOSTS`), so a web page cannot reach it by DNS rebinding. That check reads the Host header, which a client on your network can set: do not expose a dev server to a network. `next dev` listens on every interface, so run it as `npx next dev -H 127.0.0.1`, or set `PW_BASIC_AUTH`.

Open the home page. Three sample reports are there: **Loan statement**, **Sales by region** (groups, drill-down, cascading parameters) and **Sales dashboard** (charts, matrix, QR code, sparklines).

| Page / route | What it does |
|---|---|
| `/` | Report list. Create a report. |
| `/designer/<id>` | Designer: toolbox, inspector, data panel, Preview tab, ⌘S to save, `?` for shortcuts |
| `/viewer/<id>?param=value&lang=hi` | Viewer: parameters, paging, zoom, search, document map, drill-down, exports |
| `/api/reports/<id>/pdf?format=pdf\|xlsx\|docx\|html\|csv` | The report rendered **on the server** |
| `/api/v1/*` | Automation API: render, batches, schedules (needs an API key) |
| `/embed/reportwright-viewer.js` | Script to put the viewer in another web app |
| `/login`, `/admin/users` | Sign-in and user management, when accounts are on (`PW_AUTH=users`, see [Users and roles](#users-and-roles)) |

Reports are JSON files in `reports/*.pw.json`. Commit them with your code. Each save keeps a version in `reports/.history/` (last 50). With `PW_STORAGE` set to a database, reports, versions, schedules, job records and users live there instead (see below).

## Docker

**Self-host for free:** one-command install on a $5–10 VPS with HTTPS, backups and upgrades: [deploy/compose/README.md](deploy/compose/README.md).

```bash
docker build -t reportwright .                     # add --build-arg PW_EMBED_ORIGINS=https://your.site for embeds
docker run -p 3000:3000 -e PW_BASIC_AUTH=admin:change-me \
  -v pw-data:/app/data -v pw-reports:/app/reports reportwright
```

The image runs Next's standalone server as the `node` user, keeps run-time state in `/app/data` and reports in `/app/reports` (or set `PW_STORAGE` for a database), and has a health check. Every setting in the table below is an environment variable.

## Put the viewer in another app

```html
<div id="report"></div>
<script src="https://reports.example.com/embed/reportwright-viewer.js"></script>
<script>
  ReportWright.mountViewer('#report', {
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
| `PW_ALLOW_KEYLESS` | run time | `1` lets `/api/v1` answer without a key in production, read-only: `GET`s and `POST /api/v1/render` of a saved template, with no definition or data in the request, no signing, no batches or schedules. Anyone can then render every report. In development the API answers without a key, and refuses a keyless write that carries another site's `Origin`. |
| `PW_WEBHOOK_SECRET` | run time | Signs webhook bodies: header `x-reportwright-signature: sha256=<HMAC-SHA256 hex>` (also sent as the deprecated `x-pagewright-signature`) |
| `PW_BASE_URL` | run time | Public URL of this server. Relative data URLs in server renders, thumbnails, batches and schedules resolve against it, and the server's calls to itself go there. **Required in production** for reports with relative data URLs: the server never takes its own address from a request. In development the address Next listens on. |
| `PW_FIXED_FETCH_HOSTS` | run time | `1` (default in production): a server-side data fetch must write its host out; parameters and expressions fill only the path and query. `0` (default in development) allows hosts made by expressions. |
| `PW_PROXY_SECRET` | run time | With `PW_AUTH=proxy`: a secret (16+ characters) the reverse proxy sends as `x-reportwright-proxy-secret` (the deprecated `x-pagewright-proxy-secret` is still read). Requests without it are refused, so nothing can go around the proxy. Required in production. The server's own calls to itself send it too. |
| `PW_DEV_HOSTS` | run time | Development only: more host names (comma-separated) a `next dev` server with no sign-in answers to, besides `localhost`, `127.0.0.1` and `::1`. |
| `PW_BATCH_CONCURRENCY` | run time | Reports rendered at the same time in a batch (default 2) |
| `PW_RENDER_WORKERS` | run time | Worker threads that do every server render and export (API, report links, batches, schedules, thumbnails). Default: CPU cores minus one, at most 8. `0` renders on the request thread (no pool). Each worker loads fonts and HarfBuzz once, and opens its own SQL connection pools. |
| `PW_RENDER_TIMEOUT_MS` | run time | The render time limit (default 60000): template read, data fetch, layout and export. A render past it is stopped by terminating its worker (504); the worker is replaced. |
| `PW_RENDER_QUEUE`, `PW_RENDER_QUEUE_PER_PRINCIPAL`, `PW_RENDER_MAX_WAIT_MS` | run time | Admission control: renders that may wait (default 1000; more get 503), of those per user or API key (default 8 per worker, at least 16; more get 429), and the longest estimated wait accepted (default 30000; longer gets 503). Answers carry `Retry-After`. Interactive renders go before batch items and thumbnails; users take turns. A user with nothing queued or running is always let in, up to twice the queue. |
| `PW_RENDER_WORKER_MAX_RENDERS`, `PW_RENDER_WORKER_RECYCLE_MB`, `PW_RENDER_WORKER_HEAP_MB` | run time | A worker is replaced after this many renders (default 500) or when its heap is above this after a render (default 512 MB). The hard heap limit per worker (default 2048 MB): a render past it fails with 500 and only that worker is replaced. |
| `PW_SCHEDULER` | run time | `off` stops the built-in scheduler (for example on extra replicas) |
| `PW_AUTH` | run time | `users` turns on user accounts with roles ([Users and roles](#users-and-roles)). `proxy`: no accounts, the app trusts every request that reaches it, because a reverse proxy in front signs people in ([Production needs a sign-in](#run-it)). Any other value makes the server refuse every request (500), so a typo cannot leave the app open. |
| `PW_PUBLIC_READONLY` | run time | `1`, in production with no sign-in: anyone may open the report list and the viewer, render on the server and run the queries saved in reports. Nothing can be changed. Without it such a server answers 401 to everything. |
| `PW_SESSION_SECRET` | run time | Signs the session cookie (HMAC-SHA256). At least 32 random characters (`openssl rand -hex 32`). **Required with `PW_AUTH=users` in production**: without it the server logs why and refuses every request (500). In development a random secret is made per process (sessions end on restart). The same secret on every server. |
| `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` | run time | The first admin. Used once, at the first sign-in, when there are no users yet. You can remove them after that. |
| `PW_STORAGE` | run time | Where reports, versions, schedules, job records and users live. `file` (default): `reports/` and `data/` in the app folder. `sqlite:/abs/path.db`, `postgres://user:pass@host/db`, `mysql://user:pass@host/db` or `mssql://user:pass@host:1433/db` (or `sql:<name>` for the URL in `PW_DB_<NAME>`): tables `pw_reports`, `pw_report_versions`, `pw_schedules`, `pw_jobs`, `pw_users`, made on first use. This connection writes, so give it a user that may (not the read-only one for data sources). Batch output files (zip, merged PDF, folders) stay in `data/`: several servers need a shared volume for it. Switching does not copy existing reports: PUT them to `/api/reports/<id>` once. |
| `PW_BASIC_AUTH` | run time | `user:password` for the whole app (designer, viewer, report storage, server renders). `/api/v1` keeps its API keys; the embed script and fonts stay open. In production one of this, `PW_AUTH=users` or `PW_AUTH=proxy` is required (see [Run it](#run-it)). Ignored (with a warning at start) when `PW_AUTH=users`. |
| `PW_INTERNAL_HOSTS` | run time | Host names that server-side fetches may reach on a private network (internal data APIs, a webhook receiver on your LAN). Comma-separated. Every other private or local address is refused (SSRF guard). |
| `PW_SIGN_P12`, `PW_SIGN_PASSWORD` | run time | A .p12 certificate and its password. With them, `/api/v1/render`, batches and schedules can sign PDFs (`"sign": true`; a detached PKCS#7 signature over the whole file). Only API-key routes sign. |
| `ANTHROPIC_API_KEY`, `PW_AI_MODEL` | run time | Turns on AI drafting (`/api/ai/report`). The model defaults to `claude-opus-5`. |
| `PW_PROXY_ALLOW` | run time | Hosts that `/api/data/proxy` may call (comma-separated). Private network addresses are always blocked. |
| `PW_DB_<NAME>` | run time | A database for SQL data sources. `connection: 'main'` in a report reads `PW_DB_MAIN` (any case): `sqlite:/path/file.db`, `postgres://…` (`pg`), `mysql://…` (`mysql2`), `mssql://…` (`mssql`), `oracle://user:pass@host:1521/SERVICE` (`oracledb`, thin mode), `snowflake://user:pass@ACCOUNT/DB/SCHEMA?warehouse=WH&role=READER` (`snowflake-sdk`) or `bigquery://PROJECT?keyFile=/key.json&maxBytes=…` (`@google-cloud/bigquery`); the drivers are optional dependencies. Give each a user that can only read: SQL Server and Oracle logins are checked and refused if they could do more. `PW_DB_<NAME>_PROCS=a,b` allows those stored procedures on the connection. Details, guards and what is live-tested: [docs/DATA-SQL.md](docs/DATA-SQL.md). |
| `PW_EMBED_ORIGINS` | **build time** | Origin allowed to read `/api/reports` and `/api/sample` from another site (CORS). With accounts on, set it at run time too: then report definitions (`GET /api/reports/<id>`) and `/api/sample/*` stay open without sign-in, for the embedded viewer. |

## Users and roles

Set `PW_AUTH=users` and `PW_SESSION_SECRET`, and people sign in at `/login` with their own email and password. Admins manage users at `/admin/users`.

| Role | Can |
|---|---|
| `viewer` | Open the report list and the viewer, export, server PDF (`/api/reports/<id>/pdf`), read report definitions and their versions, run the SQL saved in a report, the data proxy and sample data |
| `designer` | Everything a viewer can, plus the designer: create, save, delete, restore and import reports (only designers and admins can save a report with SQL or internal data sources), preview SQL typed in the designer (also in production), test connections, upload fonts, AI authoring |
| `admin` | Everything, plus `/admin/users` and `/api/users` |

- **The first admin**: set `PW_ADMIN_EMAIL` and `PW_ADMIN_PASSWORD`; the first sign-in creates that admin when there are no users. Or run `node scripts/user.mjs add you@example.com admin` in the app folder (with the same `PW_STORAGE`); it asks for the password, or reads `PW_NEW_PASSWORD`.
- **Passwords**: at least 10 characters, stored as scrypt hashes with a random salt. No API ever returns a hash.
- **Sessions**: an HttpOnly, SameSite=Lax cookie (`Secure` over https), signed with `PW_SESSION_SECRET`, good for 12 hours. Every request reads the user again, so a role change, a disabled or a deleted user counts at once (other servers see it within 10 s). Signing out, a new password and disabling end all of that user's sessions.
- **Sign-in limit** (across servers): 10 failed tries in 15 minutes per source and email, or 100 per source for all emails, then 429 for that source only; after 5, each try from that source waits 1 s. Failures for one account from everywhere never lock it: past 50 in 15 minutes each try waits `PW_LOGIN_SLOW_MS` (2 s) first, and the right password (plus the second factor, when the account has one) still signs in. An admin can clear an account's counts (`PATCH /api/users/<email> { unlockSignIn: true }`). The source is the socket's address; `X-Forwarded-For` is believed only from `PW_TRUSTED_PROXIES` (IPs or CIDRs, e.g. `10.0.0.0/8,127.0.0.1`): list your reverse proxy there and let it append the client address (nginx: `proxy_add_x_forwarded_for`).
- **Cross-site requests**: a write (POST, PUT, PATCH, DELETE) must carry an `Origin` (or `Referer`) of this site. Scripts that call the app with a session cookie must send one; `/api/v1` uses API keys and is not affected.
- **Always open**: `/login`, static files, the embed script, and `/api/v1` (API keys). Every other path needs a role; a path the table does not list is for admins only. The table is `RULES` in `src/server/access.js`, enforced in `proxy.js`.
- **Server renders** that load data from this server (relative URLs such as `/api/sample/...`) send a viewer pass that is good for that one request only.
- Not included: SSO (SAML, OIDC), per-report permissions, password reset by email, two-factor sign-in.

## Test it

```bash
npm test                                   # unit, golden and security tests (Vitest), 254 tests; needs Node 22+ (PW_TEST_PG=postgres://… adds Postgres tests and PW_TEST_MSSQL=mssql://… SQL Server tests: SQL sources and storage)
./scripts/restart.sh                       # build and start on :3000 with test keys (PORT=3100 ./scripts/restart.sh for another port)
npm run test:e2e                           # all the browser suites against it (BASE=http://localhost:3100 for another port)
node tests/e2e/build-from-scratch.mjs      # Phase 1 exit test: build a report in the designer
node tests/e2e/smoke.mjs                   # viewer smoke test
node tests/e2e/expr-editor.mjs             # CodeMirror expression editor
node tests/e2e/phase2.mjs                  # groups, drill-down, sort, map, search, cascading params, exports
node tests/e2e/phase3.mjs                  # charts, matrix, barcodes, subreports in the designer and viewer
node tests/e2e/phase4.mjs                  # smart guides, shortcuts, themes, history, columns, TOC, embed
node tests/e2e/api.mjs                     # render API, auth, batches, webhooks, schedules
node tests/e2e/users.mjs                   # accounts and roles: start the server as its header says (PW_AUTH=users …)
node scripts/check-pdf-matches-model.mjs   # every page-model line is in the PDF at the same place
node scripts/check-engine-boundary.mjs     # src/engine has no React, Next or DOM
npm run perf                               # 50,000 rows → 1,112 pages
```

The e2e suites need a server that lets them in. `scripts/restart.sh` is the one documented way: a production build with `PW_AUTH=proxy`, behind `scripts/e2e-proxy.mjs` (a stand-in for the signing-in reverse proxy that adds `PW_PROXY_SECRET`), with `PW_BASE_URL`, `PW_API_KEYS=test-key`, `PW_WEBHOOK_SECRET=testsecret`, `PW_INTERNAL_HOSTS=localhost,127.0.0.1` and `PW_EMBED_ORIGINS=http://localhost:4000` (set at build time too). `npm run dev` with the same `PW_API_KEYS`, `PW_WEBHOOK_SECRET`, `PW_INTERNAL_HOSTS` and `PW_EMBED_ORIGINS` also works (no sign-in in development; the suites use `localhost`).

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

## Data setup in the designer

- **Explore the response** (data set dialog): every list in the source's response with its path, row count and fields; the likely rows are marked *suggested*; **Use** fills the path and detects the fields. Nested lists get `[*]` paths (`$.orders[*].lines[*]`).
- **SQL sources**: pick a connection set up on the server (`PW_DB_<NAME>`; the designer sees names only), press **Test** (a read-only `select 1`), write a `SELECT` with `@parameter` placeholders. Unsaved queries preview for designers when accounts are on, behind `PW_BASIC_AUTH` or `PW_AUTH=proxy`, and in development; a production server where nobody signs in runs none (with `PW_PUBLIC_READONLY=1`, only the queries saved in reports).

## Command line: render, test and diff

`bin/pw.mjs` (`npm run pw -- …`, or `pw` once the package is installed) uses the same engine with no server:

```bash
pw render reports/loan-statement.pw.json -p accountId=LN-2026-004417 -d loans=data.json -f pdf -o statement.pdf [--pdfa]
pw test reports            # render every reports/__tests__/<id>.test.json case; compare with <id>.<case>.snap.txt
pw test reports --update   # accept the new pages
pw diff old.pw.json new.pw.json -d loans=data.json   # what changed on the pages
```

A test case names the report, its parameters, pushed data (`-d`-style JSON files) and a fixed `now`. Snapshots are plain text, one line per text run and a marker per page, so a pull request shows exactly which totals moved. `pw test` exits 1 when a page changes; the GitHub Action in `action.yml` runs it in CI (`.github/workflows/ci.yml` does so for this repo).

## Draft a report with AI

`POST /api/ai/report` with `{ "prompt": "Monthly sales by region with a chart", "sample": [ …rows… ], "url"?: "https://…", "base"?: "<report id to change>" }` returns `{ definition, warnings, tries }`. Nothing is saved: review the draft, then `POST /api/reports` with `{ name, definition }`.

- Claude (`claude-opus-5`, override with `PW_AI_MODEL`) writes the definition from a description of the format built from the engine's own item list. ReportWright checks it with `validate()` and a trial render on your sample rows (which never fetches anything), and sends any problems back, 3 tries in all. Refusals come back as a clear 422; the request opts in to the API's server-side fallback model.
- Needs `ANTHROPIC_API_KEY`. In production it also needs a sign-in (`PW_AUTH=users` with the designer role, `PW_BASIC_AUTH` or `PW_AUTH=proxy`), because every draft costs money.
- Your sample rows are sent to the Anthropic API. Send a few representative rows, not personal data you may not share.

## Import from ActiveReports

On the home page, **Import ActiveReports file** takes an ActiveReportsJS `.rdlx-json` file, saves it as a new report and lists every note. From code: `POST /api/reports/import?name=<report name>` with the file's JSON as the body (at most 5 MB) returns `{ id, warnings, stats }` (201). The converter is `importRdlx()` in `src/importers/rdlx.js`; it is pure JavaScript and never throws.

- **What maps:** both file layouts (`Body`/`PageHeader`/`PageFooter`, and `ReportSections` with continuous and fixed pages), page size and margins, parameters (types, defaults, multi-value, value lists, lists from a data set), JSON data (endpoint and URI, embedded `jsondata`, headers, GraphQL bodies), CSV, nested `$dataset:` sets, fields (paths, type hints, calculated), filters and sorts; text boxes, images (embedded, URL), lines, rectangles, shapes, check boxes, barcodes, subreports, tables (groups, drill-down, column spans, sort links, document map), tablix (row groups → table, pivot → matrix), lists, banded lists, charts (both chart formats), styles, colour names and links.
- **Expressions:** `Fields!x.Value`, `Parameters!x.Value`, `Globals!…`, `&`, `IIF`, `Switch`, `Choose`, `Is Nothing`, `Mod`, `Like`, aggregates with their scopes, `RunningValue`, `Lookup`, `Format`/`FormatNumber`/`FormatCurrency`, dates, conversions, `.ToString()` and other methods, interpolated strings.
- **What becomes a note:** `ReportItems!`, custom `Code.` and functions ReportWright lacks (`Previous`, `StDev`, `Weekday`…) stay visible as text. Also noted: group headers that repeat on new pages, sort links outside the table header, groups sorted by an aggregate, row spans, rounded corners, chart plots that do not share the first plot's category, fonts that are not bundled (Inter or JetBrains Mono is used), hidden parameters, SQL connections (set `PW_DB_<NAME>`), nested data sets (flattened). Tables whose cells hold images, barcodes or other tables become banded lists.
- **Drill-through and subreports** point at the report id made from the target's file name, so import those files too.
- **Conversion rate:** the 9 MESCIUS sample reports (10 files) and 30 public `.rdlx-json` files from GitHub all import, validate and render. All 40 keep every item (mapped or approximated); none is dropped. `stats` counts each report item as mapped, approximated (a note says what changed) or dropped. Proof: `tests/fixtures/rdlx/regional-sales.rdlx-json` → `reports/imported-regional-sales.pw.json`.
- Not yet: the XML form of ActiveReports (`.rdlx`); only the JSON form imports here. SSRS (`.rdl`), JasperReports and BIRT files import with `pw import` and with the Designer's Import report action.

## PDF/A and signatures

- **PDF/A-2b**: add `"pdfa": true` to `/api/v1/render` or a batch, or `?pdfa=1` to `/api/reports/<id>/pdf`. The file gets XMP metadata, the sRGB output intent (`public/icc`), a file id and printable annotations. The sample loan statement passes veraPDF 1.30 (PDF/A-2B profile), signed and unsigned.
- **Signatures**: add `"sign": true` to `/api/v1/render`, a batch or a schedule, with `PW_SIGN_P12` and `PW_SIGN_PASSWORD` set. The signature is `adbe.pkcs7.detached` over the whole file (Poppler `pdfsig`: "Signature is Valid"). It is not a PAdES baseline signature (no signing-certificate attribute, no timestamp).

## Data sources

- **REST** (GET/POST, headers): a relative URL calls this app; `{Parameters.x}` fills values. Set `useProxy: true` to call another host through `/api/data/proxy`.
- **GraphQL**: query and variables, with `{Parameters.x}` templating.
- **Inline JSON** and **CSV** (inline or by URL).
- **XML** (inline or by URL, through the same guarded fetch and proxy as REST): `{ type: 'xml', url, namespaces: { o: 'urn:orders' } }`. A data set's `path` is an XPath to the row elements: `/a/b`, `//b`, `.`, `..`, `*`, `o:name`, `@attr`, `text()`, `[n]`, `[last()]`, `[@x='v']`, `[name='v']`; `$` takes the most repeated element. Fields come from the row's attributes and child elements, or a `path` XPath relative to the row (`../@id`, `Address/City`). A name without a prefix matches any namespace. The document is read without DTDs (no XXE, no entity expansion), with caps of 16 M characters, 128 levels and 250,000 elements.
- **SOAP**: `{ type: 'soap', url, soapAction, soapVersion: '1.1' | '1.2', envelope }`. `{Parameters.x}` in the envelope is XML-escaped; the first element in the response Body is the data (an XML source); a fault is an error with its message. Not through the proxy (it only reads).
- **OData**: `{ type: 'odata', url: '<service root>', entitySet, select, filters: [{ field, op, value, type }], orderby: [{ field, dir }], top, skip, expand, maxPages, types }`. Names must be identifiers and values become OData literals, so a parameter cannot change the query; an empty value leaves its filter out, a list is an OR. `@odata.nextLink` (and v2 `__next`) is followed on the same origin only, up to `maxPages` (default 10, at most 100). In the Designer, "Read $metadata" lists the entity sets and their properties.
- **SQL** (SQLite and MySQL released; PostgreSQL, SQL Server, Oracle, Snowflake and BigQuery built, not released; see [docs/DATA-SQL.md](docs/DATA-SQL.md)): `{ type: 'sql', connection: 'main', query: 'select … where id = @accountId and region in (@regions)' }`. The connection comes from `PW_DB_MAIN`; a report never holds a host or a password. `@name` binds the report parameter `name` through the driver, so a value is never pasted into the SQL. A multi-value parameter becomes a list (`in (@regions)`); an empty list matches nothing (it becomes `NULL`, so `not in (@regions)` matches nothing too). Only one `SELECT` (or `WITH … SELECT`) statement runs, in a read-only transaction (SQLite: the file opened read-only), for at most 30 s and 100,000 rows. Server renders query the database directly. In the browser the viewer sends only the report id, the source name and the parameters to `/api/data/sql`, and the server runs **the query saved in that report**. A query sent with the request (a preview of unsaved work) runs only for a designer: one with accounts on, anyone behind `PW_BASIC_AUTH` or `PW_AUTH=proxy`, anyone in development; never on a production server where nobody signs in. The saved query runs only as a designer saved it (see [Run it](#run-it)). SQLite queries run on the server's main thread, so the 30 s limit does not stop them: keep SQLite for small local files.
- **Pushed data**: the render API and batches can send the data in the request. It replaces the source with the same name.

The sample endpoints `/api/sample/loans`, `/api/sample/loans/<account>` and `/api/sample/sales/<year>` serve fictional data.

## Documentation

The plan is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). All four phases are done. Status and gaps: [`docs/STATUS.md`](docs/STATUS.md). Automation API: [`docs/API.md`](docs/API.md).

## Status (5 Oct 2026)

Earlier numbers from a local harness (`~/pw-bench`, not in this repository, so not reproducible from here); the GitHub-run benchmark above is the reference.

**Measured against other engines** (same reports, same data, same Apple M2 laptop; harness in `~/pw-bench`, numbers indicative, not a published benchmark):

| 50,000-row report | ReportWright (Node) | JasperReports | BIRT |
|---|---|---|---|
| PDF end to end | ~1.0–1.2 s | ~2.2–2.4 s | ~2.3–2.9 s |
| Pagination only | ~0.45–0.56 s | ~0.51–0.60 s | – |
| PDF size (962 pages) | 2.28 MB | 3.70 MB | 3.47 MB |
| Peak memory (after the memory work) | ~0.76–0.83 GB | ~0.8–0.95 GB | ~0.57–0.69 GB |

ActiveReportsJS did not finish the 50,000-row reports within 10 minutes; ReportWright renders its charts report ~60× faster and invoices ~25× faster. Telerik, DevExpress, Bold Reports and Stimulsoft were not tested: their licences forbid benchmarking by a competitor.

**Independent code-only review (5 Oct):** 6.7 / 10 on features, 6.3 overall (no outside users yet). Strong: speed, PDF output, embedding, deny-by-default security. The ranked fix list from five specialist reviews (security, engine correctness, architecture, UX) is being worked through.

**In progress on `main`:** server stability (SQLite isolation, login throttling, safe default report permissions, memory-aware render pool, logging and health checks), 21 silent wrong-result fixes against SSRS semantics, Designer and viewer accessibility and usability, a conditional formatting wizard, a visual SQL query builder and native Excel charts.

**Not released:** SQL Server, PostgreSQL, Oracle, Snowflake and BigQuery data sources and stored procedures (Oracle, Snowflake and BigQuery are also not live-tested; see `docs/DATA-SQL.md`); the audit log's hash chain is beta. **Deferred:** running SSRS custom VB `Code`, and page-at-a-time streaming layout for millions of rows.

**Breaking change:** `render()` keeps table data for Excel, CSV, Word, interactive HTML and accessible PDF only with `render(def, { exportData: true })`; the built-in server, CLI and viewer pass it. After upgrading, re-save SQL reports once in the Designer.

## Renamed from Pagewright

**Renamed from Pagewright** in 0.9.0 (the npm packages moved from `@pagewrightjs/*` to `@reportwright/*`; the old
packages are deprecated), finished in 0.13.2. What did not change, so deployments and stored data keep working:

- settings keep the `PW_` prefix (`PW_AUTH`, `PW_BASE_URL`, …), and the CLI is still `pw` (`reportwright` works too);
- cookie names and storage table names, and report files keep the `.pw.json` extension.

Deprecated, still working, removed in 1.0 (each is an alias of its ReportWright name):

- `<pagewright-viewer>` / `<pagewright-designer>`, `PagewrightViewer`, `PagewrightDesigner`, `pagewrightViewer`,
  `pagewrightDesigner`, `definePagewrightElements`, `window.Pagewright` and the `/embed/pagewright-viewer.js` loader
  (each warns once in the console, except the React and Vue components, which are the same objects);
- `"$schema": "pagewright/report@1"`, read as `reportwright/report@1`;
- the `x-pagewright-*` HTTP headers, sent next to their `x-reportwright-*` names (the proxy secret is read under
  either name), and the `pagewright_*` metrics, emitted next to the `reportwright_*` ones.
