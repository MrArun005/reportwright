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
| `/api/reports/<id>/pdf?format=pdf\|xlsx\|docx\|html\|csv` | The report rendered **on the server** |
| `/api/v1/*` | Automation API: render, batches, schedules (needs an API key) |
| `/embed/pagewright-viewer.js` | Script to put the viewer in another web app |
| `/login`, `/admin/users` | Sign-in and user management, when accounts are on (`PW_AUTH=users`, see [Users and roles](#users-and-roles)) |

Reports are JSON files in `reports/*.pw.json`. Commit them with your code. Each save keeps a version in `reports/.history/` (last 50). With `PW_STORAGE` set to a database, reports, versions, schedules, job records and users live there instead (see below).

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
| `PW_AUTH` | run time | `users` turns on user accounts with roles ([Users and roles](#users-and-roles)). Any other value makes the server refuse every request (500), so a typo cannot leave the app open. |
| `PW_SESSION_SECRET` | run time | Signs the session cookie (HMAC-SHA256). At least 32 random characters (`openssl rand -hex 32`). **Required with `PW_AUTH=users` in production**: without it the server logs why and refuses every request (500). In development a random secret is made per process (sessions end on restart). The same secret on every server. |
| `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` | run time | The first admin. Used once, at the first sign-in, when there are no users yet. You can remove them after that. |
| `PW_STORAGE` | run time | Where reports, versions, schedules, job records and users live. `file` (default): `reports/` and `data/` in the app folder. `sqlite:/abs/path.db`, `postgres://user:pass@host/db` or `mysql://user:pass@host/db` (or `sql:<name>` for the URL in `PW_DB_<NAME>`): tables `pw_reports`, `pw_report_versions`, `pw_schedules`, `pw_jobs`, `pw_users`, made on first use. This connection writes, so give it a user that may (not the read-only one for data sources). Batch output files (zip, merged PDF, folders) stay in `data/`: several servers need a shared volume for it. Switching does not copy existing reports: PUT them to `/api/reports/<id>` once. |
| `PW_BASIC_AUTH` | run time | `user:password` for the whole app (designer, viewer, report storage, server renders). `/api/v1` keeps its API keys; the embed script and fonts stay open. **Set this, `PW_AUTH=users`, or put the app behind your SSO proxy, before you expose it.** Ignored (with a warning at start) when `PW_AUTH=users`. |
| `PW_INTERNAL_HOSTS` | run time | Host names that server-side fetches may reach on a private network (internal data APIs, a webhook receiver on your LAN). Comma-separated. Every other private or local address is refused (SSRF guard). |
| `PW_SIGN_P12`, `PW_SIGN_PASSWORD` | run time | A .p12 certificate and its password. With them, `/api/v1/render`, batches and schedules can sign PDFs (`"sign": true`; a detached PKCS#7 signature over the whole file). Only API-key routes sign. |
| `ANTHROPIC_API_KEY`, `PW_AI_MODEL` | run time | Turns on AI drafting (`/api/ai/report`). The model defaults to `claude-opus-5`. |
| `PW_PROXY_ALLOW` | run time | Hosts that `/api/data/proxy` may call (comma-separated). Private network addresses are always blocked. |
| `PW_DB_<NAME>` | run time | A database for SQL data sources. `connection: 'main'` in a report reads `PW_DB_MAIN` (any case). `sqlite:/path/file.db` (built into Node 22), `postgres://user:pass@host/db` (needs `npm install pg`) or `mysql://user:pass@host/db` (needs `npm install mysql2`). Give it a database user that can only read. |
| `PW_EMBED_ORIGINS` | **build time** | Origin allowed to read `/api/reports` and `/api/sample` from another site (CORS). With accounts on, set it at run time too: then report definitions (`GET /api/reports/<id>`) and `/api/sample/*` stay open without sign-in, for the embedded viewer. |

## Users and roles

Set `PW_AUTH=users` and `PW_SESSION_SECRET`, and people sign in at `/login` with their own email and password. Admins manage users at `/admin/users`.

| Role | Can |
|---|---|
| `viewer` | Open the report list and the viewer, export, server PDF (`/api/reports/<id>/pdf`), read report definitions and their versions, run the SQL saved in a report, the data proxy and sample data |
| `designer` | Everything a viewer can, plus the designer: create, save, delete, restore and import reports, preview SQL typed in the designer (also in production), AI authoring |
| `admin` | Everything, plus `/admin/users` and `/api/users` |

- **The first admin**: set `PW_ADMIN_EMAIL` and `PW_ADMIN_PASSWORD`; the first sign-in creates that admin when there are no users. Or run `node scripts/user.mjs add you@example.com admin` in the app folder (with the same `PW_STORAGE`); it asks for the password, or reads `PW_NEW_PASSWORD`.
- **Passwords**: at least 10 characters, stored as scrypt hashes with a random salt. No API ever returns a hash.
- **Sessions**: an HttpOnly, SameSite=Lax cookie (`Secure` over https), signed with `PW_SESSION_SECRET`, good for 12 hours. Every request reads the user again, so a role change, a disabled or a deleted user counts at once (other servers see it within 10 s). Signing out, a new password and disabling end all of that user's sessions.
- **Sign-in limit**: 10 failed tries in 15 minutes per address and email, and 50 per email from all addresses, then 429. Counted in memory, per server process. Behind a reverse proxy, let it append the client address to `X-Forwarded-For` (nginx: `proxy_add_x_forwarded_for`).
- **Cross-site requests**: a write (POST, PUT, PATCH, DELETE) must carry an `Origin` (or `Referer`) of this site. Scripts that call the app with a session cookie must send one; `/api/v1` uses API keys and is not affected.
- **Always open**: `/login`, static files, the embed script, and `/api/v1` (API keys). Every other path needs a role; a path the table does not list is for admins only. The table is `RULES` in `src/server/access.js`, enforced in `proxy.js`.
- **Server renders** that load data from this server (relative URLs such as `/api/sample/...`) send a viewer pass that is good for that one request only.
- Not included: SSO (SAML, OIDC), per-report permissions, password reset by email, two-factor sign-in.

## Test it

```bash
npm test                                   # unit, golden and security tests (Vitest), 254 tests; needs Node 22+ (PW_TEST_PG=postgres://… adds 9 Postgres tests: SQL sources and storage)
./scripts/restart.sh                       # build and start on :3000 with test keys (PORT=3100 ./scripts/restart.sh for another port)
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
- **SQL sources**: pick a connection set up on the server (`PW_DB_<NAME>`; the designer sees names only), press **Test** (a read-only `select 1`), write a `SELECT` with `@parameter` placeholders. Unsaved queries preview for designers when accounts are on, or behind `PW_BASIC_AUTH`; on a production server where nobody signs in, only saved queries run.

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
