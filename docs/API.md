# Automation API (`/api/v1`)

Use this API to make reports from other systems: one report on request, many reports in a batch, or batches on a schedule.

## Authentication

Set `PW_API_KEYS="key1,key2"` on the server. Send one key with each request:

```
Authorization: Bearer key1        (or)        x-api-key: key1
```

In production the API refuses all requests when `PW_API_KEYS` is empty, unless `PW_ALLOW_KEYLESS=1`: then it answers without a key **read-only** (list templates, render a saved template; no definition or `data` in the request, no `sign`, no batches or schedules: those answer 401 or 403). In `next dev` it answers without a key, but refuses a keyless write that carries another site's `Origin` (a page elsewhere cannot use your local server).

A plain key is a **service key**: it may render, batch and schedule every report. With accounts on (`PW_AUTH=users`) a key written `email|key` (for example `PW_API_KEYS="svc-key,reports@acme.com|k2"`) acts as that user: it sees, renders and schedules only what that user may view (permissions below), renders a definition sent in the request only when the user is a designer, and sees only the batches and schedules made with that same key. A disabled or deleted user's key stops working. Batches and schedules remember the key that made them: once a key is out of `PW_API_KEYS` (a service key or a user's), what it scheduled or queued no longer runs. Every call is in the audit log under the key's id (the first 8 hex of its SHA-256), never the key.

## Rich text and data

A `richtext` item's `value` is an HTML subset (p, div, span, br, b/strong, i/em, u, s/strike/del, sup, sub, ul/ol/li, a[href], h1–h6, inline `style` with color, font-size, font-weight, font-style, text-decoration, background-color, text-align).

- Only the markup the report author typed is HTML. Everything that comes from evaluation is escaped and shows as text: each `{Fields.x}` part of a template, and the result of a value that is one `=expression`. Mix markup with data with a template: `<b>Total</b> {Fields.total}`. A quote or `;` in a field cannot leave the attribute or CSS value it sits in.
- `htmlFromData: true` on the item (designer: "Field values are HTML (trusted data only)") parses evaluated values as markup too. Set it only when the data is trusted. It still goes through the same allow-list: unknown tags are dropped, links must be `http:`, `https:`, `mailto:` or start with `/`, and the size limits apply.
- Limits: 100,000 characters of markup after interpolation, 32 levels of nesting, 20,000 styled pieces, 5,000 paragraphs and 5,000 line breaks per item. Past a limit the rest is cut and the render warns.

## Templates

`GET /api/v1/templates` gives the list of reports (`id`, `name`, parameters).

A `template` value in a request can be:

- `"loan-statement"`: the current saved version
- `"loan-statement@3"`: a saved version from `reports/.history/`
- `{ ...definition }`: a full report definition in the request

## Render one report

`POST /api/v1/render`

```js
const res = await fetch('https://reports.example.com/api/v1/render', {
  method: 'POST',
  headers: { authorization: 'Bearer key1', 'content-type': 'application/json' },
  body: JSON.stringify({
    template: 'loan-statement',
    format: 'pdf',                       // pdf | xlsx | docx | pptx | html | csv | json (the page model)
    parameters: { accountId: 'LN-2025-001982' },
    data: { loan: { /* your JSON */ } },  // optional: replaces the data source named "loan"
    fileName: 'statement-LN-2025-001982',
  }),
});
const pdf = await res.arrayBuffer();
```

Response headers: `x-pagewright-pages`, `x-pagewright-ms`, `x-pagewright-warnings`.

Export options in the body (see [EXPORTS.md](EXPORTS.md)): `ua: true` an accessible PDF (PDF/UA-1; with `pdfa: true` it is PDF/A-2a), `formulas: false` Excel totals as values instead of live `SUBTOTAL` formulas, `static: true` an HTML file without its Tables view. The server link `GET /api/reports/:id/pdf` takes `?ua=1` (and `?pdfa=1`, `?format=`).

Errors are JSON `{ error, missingParameters? }`: 400 for a bad request or missing parameters, 401 for a bad key, 404 for an unknown template.

Renders run in a pool of worker threads, never on the thread that answers requests. When the server is full the answer comes at once, with a `Retry-After` header (seconds): **429** when too many of your own renders are waiting, **503** when the queue is full or the wait would be longer than `PW_RENDER_MAX_WAIT_MS`. **504** when a render ran past the time limit (`PW_RENDER_TIMEOUT_MS`, which covers reading the template, fetching data, layout and export). Wait `Retry-After` seconds before you try again.

### Health

`GET /api/v1/health` (a service key, or an admin's key with accounts on): the render pool's workers (`size`, `alive`, `ready`, `busy`), queue depth by class (`interactive`, `background`), the estimated wait in ms, and totals since start (`done`, `failed`, `rejected`, `timedOut`, `crashed`, `recycled`, `dropped`).

### PDF passwords and permissions

```js
body: JSON.stringify({
  template: 'loan-statement', format: 'pdf', parameters: { accountId: 'LN-2025-001982' },
  pdf: {
    userPassword: 'to open it',            // '' or left out: anyone can open it, the permissions still apply
    ownerPassword: 'to change the rules',  // left out: a random one nobody knows
    permissions: { copy: false, modify: false },  // each one allowed unless set to false
  },
}),
```

Permissions: `print`, `printHighQuality`, `modify`, `copy`, `annotate`, `fillForms`, `accessibility`, `assemble`. The file is AES-256 (the PDF 2.0 standard security handler, revision 6), which Acrobat X and later, pdf.js, poppler and macOS Preview open. Passwords are Unicode (NFKC-normalised) and at most 127 bytes in UTF-8; longer is refused, not cut. A password is never in an error message. A password cannot go with `pdfa` (PDF/A forbids encryption) or `sign`: both are refused with 400.

CLI: `pw render report.pw.json --password 'to open it' --owner-password 'boss' --deny copy --deny modify -o out.pdf`. In code: `exportPdf(model, fonts, { encrypt: { userPassword, ownerPassword, permissions } })`.

## Batches

`POST /api/v1/batches` → `202` with the job. The job runs in the background.

```js
{
  template: 'loan-statement',
  format: 'pdf',
  fileName: 'statement-{Parameters.accountId}',     // expression template for each file name
  // either a list of items ...
  items: [
    { parameters: { accountId: 'LN-2026-004417' } },
    { parameters: { accountId: 'LN-2025-001982' }, data: { /* pushed data */ }, putUrl: 'https://bucket/presigned' },
  ],
  // ... or a URL that gives the list
  itemsFrom: { url: '/api/sample/loans', path: '$[*]', map: { accountId: '$.id' }, headers: {} },
  output: { type: 'zip' },        // zip (default) | merged (one PDF) | folder ({ type, folder }) | none
  webhook: 'https://your-app/hooks/pagewright',
}
```

| Route | What it does |
|---|---|
| `GET /api/v1/batches` | Last 50 jobs |
| `GET /api/v1/batches/<id>` | Job status: `queued`, `running`, `completed`, `completed_with_errors`, `failed`; `done`, `failed`, `errors[]`, `results[]` |
| `GET /api/v1/batches/<id>/download` | The zip or merged PDF |

- One failed item does not stop the batch. Its error goes into `errors[]`.
- `folder` output writes the files to `data/outputs/<folder>/` on the server for service keys; a user's key writes to `data/outputs/users/<id>/<folder>/` (its own folder), so one user can never overwrite files another batch delivers. Pushed `data` (render and batch items) needs a designer or a service key.
- `putUrl` uploads each file with HTTP PUT (for example to a pre-signed S3 or Azure URL).
- A batch can hold at most 10,000 items. `PW_BATCH_CONCURRENCY` sets how many render at the same time.

### Webhook

When the job finishes, the server sends `POST` to `webhook` with this body:

```json
{ "event": "batch.finished", "job": { "id": "b_…", "status": "completed", "done": 2, "failed": 0 }, "downloadUrl": "https://…/api/v1/batches/b_…/download" }
```

When `PW_WEBHOOK_SECRET` is set, check the signature before you trust the body:

```js
import crypto from 'node:crypto';
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.PW_WEBHOOK_SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-pagewright-signature'] || ''));
```

## Schedules

A schedule runs a batch on a cron expression in a time zone.

```js
// POST /api/v1/schedules → 201
{
  name: 'Monthly statements',
  template: 'loan-statement',
  cron: '0 7 1 * *',               // minute hour day-of-month month day-of-week (0 or 7 = Sunday)
  timezone: 'Asia/Kolkata',
  itemsFrom: { url: '/api/sample/loans', path: '$[*]', map: { accountId: '$.id' } },
  output: { type: 'folder', folder: 'monthly' },
  fileName: '{Parameters.accountId}',
  webhook: 'https://your-app/hooks/pagewright',
  enabled: true,
}
```

| Route | What it does |
|---|---|
| `GET /api/v1/schedules` | All schedules, each with `nextRunAt` |
| `GET / PUT / DELETE /api/v1/schedules/<id>` | Read, change, remove |
| `POST /api/v1/schedules/<id>/run` | Run now; gives the batch job |

A batch or schedule may carry `email: { to: ['a@example.com'], subject?, body?, attach?: true }` (needs `PW_SMTP_URL`,
`PW_MAIL_FROM` and `PW_MAIL_ALLOWED_DOMAINS`), and `fromSnapshot: true` to reuse a fresh snapshot (see
[GOVERNANCE.md](GOVERNANCE.md)). `GET /api/v1/batches/<id>/download?exp=…&sig=…` is the signed link a scheduled email
carries. Batch output is stored where every server reads it (`data/blobs`, the database, or `PW_BLOBS=s3://…`).

Cron supports `*`, lists `1,15`, ranges `1-5` and steps `*/15`. Names such as `MON` are not supported; use numbers. The scheduler checks every 30 seconds in the server process. Schedules are in `data/schedules.json`. Set `PW_SCHEDULER=off` on all servers but one when you run more than one.

## Report storage (used by the designer)

| Route | What it does |
|---|---|
| `GET / POST /api/reports` | List, create |
| `GET / PUT / DELETE /api/reports/<id>` | Read, save (keeps a version), remove |
| `GET /api/reports/<id>/versions` | Saved versions |
| `POST /api/reports/<id>/versions` | `{ version }`: restore that version |
| `GET /api/reports/<id>/pdf?format=…&param=value` | Render on the server |
| `GET /api/reports/<id>/thumb` | Page 1 as SVG with default parameters (home page cards); cached per report content and viewer |
| `GET / PUT /api/reports/<id>/access` | Its folder, inheritance and grants; `PUT { folder?, inherit?, grants? }` moves or shares it (manage) |
| `GET / POST /api/folders` | Folders the caller may see (and its level on each), `{ root: { access }, folders }`; `POST { name, parent? }` adds one (manage on the parent) |
| `GET / PATCH / DELETE /api/folders/<id>` | A folder with its grants; `PATCH { name?, parent?, inherit?, grants? }`; `DELETE` an empty folder. `<id>` = `root`: the top-level grants (admins) |
| `GET /api/audit?from&to&type&actor&report&limit&before[&format=csv]` | The audit log, newest first (admins). `type` ending in `.` is a prefix (`report.`) |
| `POST /api/reports/import?name=…&folder=…` | Import a report file (at most 5 MB): ActiveReportsJS `.rdlx-json` as JSON, or an SSRS `.rdl` / `.rdlc` sent as `application/xml`. `201 { id, warnings, stats }`; `400 { error }` when the file is not a report |
| `POST /api/audit/export` | `{ report, format }`: the viewer reports an export it made in the browser (logged as `client: true`) |

These routes use the app's sign-in (`PW_AUTH=users`, the shared `PW_BASIC_AUTH`, or `PW_AUTH=proxy` with `PW_PROXY_SECRET` behind a reverse proxy that signs people in), not API keys. In production with none of them they answer **401** with how to set one up, or, with `PW_PUBLIC_READONLY=1`, allow only what a viewer does (read and render saved reports, run their saved queries). Every write must come from a Pagewright page in every mode: an `Origin` (or `Referer`) naming this server, else **403**.

Server-side fetches: relative data URLs resolve against `PW_BASE_URL` (required in production; the server never takes its own address from a request header). A data source may only GET from this server, and only this server receives its credentials. With a user's key, batches and schedules reach public hosts only (`itemsFrom`, `putUrl`, `webhook`; `baseUrl` is ignored) unless the user is a designer. In production a data source's host must be written out: parameters and expressions may fill only the path and query (`PW_FIXED_FETCH_HOSTS`, 403 otherwise). Redirects from public hosts cannot reach this server or `PW_INTERNAL_HOSTS`.

Saving, creating, importing or restoring a report whose data sources include SQL, or a fetch that may reach a host in `PW_INTERNAL_HOSTS`, needs a designer (or admin) in every mode; others get **403**. The server records a fingerprint of those sources with each such save. When a report runs on the server (`/api/data/sql` with `{ report, source }`, `/pdf`, `/thumb`, `/api/v1/render`, batches, schedules, subreports), its SQL and internal fetches run only if their fingerprint was recorded: a definition changed outside Pagewright answers **403** (`… no designer saved on this server. A designer must open it and save it again.`) until a designer saves it.

| Route | Who may call it with accounts off |
|---|---|
| `POST /api/data/sql` `{ connection, query }` (unsaved SQL) | Development, `PW_BASIC_AUTH`, `PW_AUTH=proxy`. Never in production with no sign-in. With accounts on: designers and admins. |
| `POST /api/data/sql/test`, `GET /api/data/sql/connections`, `POST /api/fonts`, `DELETE /api/fonts/<id>`, `POST /api/ai/report` | The same (designers with accounts on). |

### Permissions

With accounts on, each report has a level for each user: `view` (open, run, export, run its saved SQL), `edit` (also save, restore, version history) or `manage` (also share, move, delete). A grant is `{ "to": "user:ann@acme.com" | "group:finance", "level": "view" | "edit" | "manage" }`. A report gets the highest grant on itself, then on its folder and the folders above while `inherit` is true, then the top-level grants (default `group:everyone` manage, i.e. as before permissions). The role is a ceiling: viewers view at most, admins manage everything. `group:everyone` is every signed-in user; `group:public` also anonymous viewers embedded from `PW_EMBED_ORIGINS`. A report a user may not view is **not found** (404) on every route, the viewer, the designer, thumbnails, exports, `/api/v1`, saved SQL, and as a subreport. A new report's creator manages it. Old versions (`id@version`) need edit.

### SSRS import

`POST /api/reports/import` with `content-type: application/xml` (the home page's **Import file** does this for `.rdl` and `.rdlc`) converts a Microsoft SQL Server Reporting Services or Report Builder report, RDL 2008, 2010 or 2016, into a Pagewright report. In code: `importRdl(xmlText, { name })` from `src/importers/rdl.js` returns `{ definition, warnings, stats, error? }` and never throws. RDLX-JSON (ActiveReportsJS) is RDL written as JSON, so the SSRS importer rewrites the XML into that shape and reuses the ActiveReports mapping and expression translator.

**The file is untrusted.** The XML reader (`src/importers/xml.js`) refuses `<!DOCTYPE` and `<!ENTITY` (no XXE, no entity expansion), knows only the five XML entities and character references, caps the size (16 M characters; the route allows 5 MB), nesting (128), elements (250,000) and attributes per element (64), and runs in linear time. Expressions longer than 20,000 characters are left out; the expression translator and every pattern applied to the file are linear. Custom code (`<Code>`) is never run. The output is budgeted too, so a small file cannot become a huge report: `Variables!` and `ReportItems!` expansions are worked out once and capped (20,000 characters each, 16 M in all), tables are capped at 250,000 cells each and 1,000,000 in all (checked before cells are converted), data regions nest at most 8 deep, embedded images are stored once (`images`, referenced as `embedded:name`), and the finished definition is capped at 16 M characters. Going over a total refuses the import with `400 { error }`.

`stats` counts report items: **mapped** (behaves the same), **approximated** (in the report, something changed: a warning says what), **dropped** (left out: a warning says why). Each warning starts with the item's name.

| SSRS | In Pagewright |
|---|---|
| Data sources and data sets | SQL Server (and other SQL providers): a `sql` source; the connection string is not imported, set `PW_DB_<NAME>` on the server. A shared data source (`DataSourceReference`) is treated as SQL Server, with a note. "Enter Data" data sets become rows embedded in the report. Query parameters bind to the report parameter they name (`@Region` = `Parameters!Region.Value`). Fields keep their type (`rd:TypeName`); calculated fields and data set filters are mapped. Shared data sets, XML, SharePoint and cube (MDX) sources: no rows, with a note. |
| Report parameters | Types, prompts, defaults (literal; from an "Enter Data" data set), valid values (a list, or a data set: cascading parameters re-query it), multi-value, nullable / allow blank, hidden. A default from a SQL data set: a note. |
| Page, header, footer | Page size and margins, page header and footer (with backgrounds, first/last page), several report sections. A body wider than its page widens the page (SSRS prints the overflow on extra pages). |
| Text boxes | One text run: a text box with its style. Several runs with the same style: one value (`"Page " & Globals!PageNumber & …` becomes a template). Runs formatted differently: rich text (bold, italic, colours, sizes, fonts, underline, bullets and numbering; expression runs become fields). In a table cell, runs keep the first run's style (a note). |
| Tablix | No column groups: a table (row groups with headers and footers, nested groups, several detail rows per record, static rows, spans, sorting, filters, drill-down from `Visibility/ToggleItem`, `RepeatOnNewPage`, `KeepTogether`, page breaks, document map labels, user sort). Column groups: a matrix (row and column groups, totals). One cell holding a rectangle: a list. One column of rectangles (letters, invoices): a banded list. Images, charts, sub-tables and indicators in cells are laid out inside the cell. |
| Charts | Column, bar, line (smooth, stepped), area, pie, doughnut, funnel, pyramid, scatter, bubble, range, stock and candlestick, polar, radar; stacked and 100 % stacked; combinations of series types and a secondary axis; category and series groups; titles, legend, axis titles, formats, min/max, log scale, gridlines, label angle; data labels (`#PERCENT`, `#VALY`… keywords); palettes and custom palettes; drill-through on points. Data bars and sparklines (Report Builder's charts in cells) become Pagewright's data bar and sparkline. |
| Gauges | **Approximated**: a radial or linear gauge becomes a half-circle gauge with the first pointer's value and the scale's minimum and maximum (ranges, ticks and frame are left out). A state indicator becomes an icon set (arrows, flags, symbols, ratings, traffic lights) with its state thresholds. |
| Other items | Line, rectangle (container), image (embedded, external URL, database field as base64), subreport (and its parameters; import the target report too, it is found by its file name). **Not supported**: maps (left out, with a note), custom report items, RDL 2005 Table/Matrix/List (upgrade the file in Report Builder first). |
| Actions | Hyperlinks, drill-through (to the imported report with that file name, with parameters), bookmark links, bookmarks and document map labels. |
| Expressions | `Fields!x.Value`, `Parameters!p.Value` (`.Label` gives the value, with a note), `Globals!PageNumber` / `TotalPages` / `ExecutionTime` / `ReportName`, aggregates with a scope (`Sum(x, "Group")`, `RunningValue`, `RowNumber`, `CountRows`, `StDev`, `Previous`, `Lookup`), `IIf` / `Switch` / `Choose`, `Format` / `FormatNumber` / `FormatCurrency` / `FormatPercent` / `FormatDateTime`, string, date and math functions (`Math.`, `Convert.`, `Microsoft.VisualBasic.` prefixes), `&`, `Mod`, `And`, `Or`, `Not`, `Is Nothing`, `Like`. `Variables!x` and `Me.Value` are replaced by their expressions; `ReportItems!x` too when that text box is outside a data region or in the same one. What cannot be translated (custom `Code.` calls, `InScope`, `User!`, `ReportItems!` of another region, unknown functions) stays visible as text, and a warning names it. |
| Custom code | Kept in the report's `customCode` property as text, never run; rewrite what is needed as report functions (`functions`). |

Tested on 32 Microsoft sample reports (`tests/fixtures/rdl/corpus`, MIT): all import, validate and render; 762 report items, none dropped.

### JasperReports import

`POST /api/reports/import` with `content-type: application/xml` (the home page's **Import file** does this for `.jrxml`) converts a JasperReports design, JasperReports 3 to 6 (`<textField><reportElement …/>`) or the 7.x format (`<element kind="…">`). XML imports are told apart by their root element (`src/importers/index.js`, `importXmlReport`). In code: `importJrxml(xmlText, { name })` from `src/importers/jrxml.js`, `{ definition, warnings, stats, error? }`, never throws. Like the SSRS importer it rewrites the design into the RDLX-JSON shape and reuses the ActiveReports mapping, notes and stats; the file is untrusted in the same way (the safe XML reader; the only DOCTYPE dropped is a bare reference to the JasperReports DTD, one with an internal subset is refused; expressions capped at 20,000 characters; variables inlined at most 16 deep; the output budget).

| JasperReports | In Pagewright |
|---|---|
| Bands | Title, then the page header and column header on page 1 (later pages: the page header band, column header included); the detail and the groups as a banded list (group header and footer bands, several bands per section stacked, a band's `printWhenExpression` kept); summary; column footer above the page footer. Several detail columns (`columnCount`): body columns. Background, no-data and last-page-footer bands: a note. Book reports (`sectionType="Part"`): each part a subreport on its own pages. |
| Elements | Text fields (pattern → format, stretch → can grow, hyperlinks, anchors, tooltips), static text, images (a field: database image; a path: needs a URL), lines, rectangles (rounded), ellipses, frames, subreports (and their parameters; import the target too), page breaks. Lists (`jr:list`) become lists, barcodes (Barbecue, Barcode4J) barcodes. Charts become Pagewright charts: pie, bar/column (horizontal, stacked), line, area, XY and time series, scatter, bubble, meter and thermometer (gauge), candlestick, high-low, Gantt; 3D charts are drawn flat. **Not converted** (noted): crosstabs, table components, generic elements, multi-axis charts. |
| Styles | Named styles with parents, the default style, conditional styles (colours, bold, italic as `IIF`), boxes (pens per side, padding), fonts, alignment. Markup (HTML, styled text) shows as plain text; rotated text is not rotated. |
| Data | The main query: SQL with `$P{x}` → `@x` (a `sql` source; set `PW_DB_<NAME>`); `$P!{…}` and `$X{…}` are noted. No query (a Java data source) or xPath/JSON/CSV queries: a JSON source to point at the data. Sub-datasets become data sets; fields keep their type; `filterExpression` and `sortField` map. Parameters keep their type, description, `isForPrompting`, literal and expression defaults; parameters holding Java objects (images, connections, maps) are left out. |
| Variables | Inlined where used as aggregates with their reset scope: `calculation="Sum"` with `resetType="Group"` is `Sum(…, "Group")`; report totals use the whole data set; in the detail band the running value Jasper prints there (a report-wide running total restarts per group, noted). Count, DistinctCount, Average, Lowest, Highest, StandardDeviation, Variance, First. `PAGE_NUMBER` (and with `evaluationTime="Report"` the page count), `REPORT_COUNT`, `<group>_COUNT`. Page and column totals add up over their band's rows (noted); `PAGE_COUNT`, `COLUMN_*` and scriptlet-set (`System`) variables show as text. |
| Expressions | Java and Groovy (`src/importers/java.js`): `$F{}`, `$P{}`, `$V{}`, `+` as concatenation when a side is a String (by field class), arithmetic, `%`, comparisons, `==`/`!=` with `null`, `&&`, `||`, `!`, the ternary and Groovy's `?:`, casts and boxing (`new Double(…)`, `.intValue()`), `String`/`Math`/`Date` methods (`substring`, `toUpperCase`, `trim`, `length`, `startsWith`, `equals`…), `String.valueOf`, `Integer.parseInt`, `msg("…{0,number,0.00}…", …)`, and the JasperReports functions (`UPPER`, `IF`, `CONCATENATE`, `DATEFORMAT`, `ROUND`…). What is not translated (`instanceof`, `new SimpleDateFormat(…)`, Groovy `${}` strings, resource bundles `$R{}`, unknown methods) is shown as text with a note. |

Tested on 49 JasperReports demo samples (`tests/fixtures/jrxml/corpus`, LGPL-3.0; 39 in the 6.x format, 10 in the 7.x format): all import, validate and render; 1,492 elements: 1,368 mapped, 121 approximated, 3 dropped (99.8% kept). Most frequent notes: fonts not bundled (49), SQL connection to set (28), rows from Java code (25), style templates not in the file (25), two-column detail (14), column header in the page header (14), page/column totals (24), `PAGE_COUNT`/`COLUMN_COUNT` (24).

### BIRT import

`.rptdesign` files go through the same route (the home page's **Import file**). In code: `importBirt(xmlText, { name })` from `src/importers/birt.js`. Same front-end design and the same untrusted-file rules (no DTDs, caps, bound columns resolved at most 12 deep, the output budget).

| BIRT | In Pagewright |
|---|---|
| Layout | BIRT flows items top to bottom: they are stacked with their height, or one estimated from the text. Master page: size (`us-letter`, `a4`, `a5`, `a3`, `us-legal`, custom), orientation, margins, page header and footer. Several master pages: the first. |
| Items | Tables (column widths, header, groups with header and footer rows, detail, footer, spans, the `table-header`/`table-detail`… selectors, highlight rules as `IIF` colours, sorts, filters, group sort and page breaks), grids (each cell's items at its column and row), lists (banded list with groups), labels, data (bound columns, number and date formats), text (HTML reduced to text, `<value-of>` as expressions), dynamic text, auto text (page number, total pages), images (embedded, URL, data), drill-through, hyperlinks, bookmarks, visibility. **Not converted** (noted): charts, crosstabs, items from libraries, event scripts. |
| Data | JDBC data sources: `sql` sources (set `PW_DB_<NAME>`); flat-file, XML and scripted sources: a JSON source to point at the data. Data sets: the result set (typed fields), computed columns, filters, the query with each `?` bound to the report parameter its data set parameter links to. Joint and scripted data sets: a note. |
| Parameters | Types, prompt text, defaults, required/null/blank, hidden, multi-value, static choices, choices from a data set (`row["X"]` value and label). |
| Expressions | BIRT's JavaScript: `row["X"]` (bound columns, resolved; their aggregates `SUM`, `COUNT`, `COUNTDISTINCT`, `AVE`, `MIN`, `MAX`, `FIRST`, `LAST`, `RUNNINGSUM` with `aggregateOn` as the group scope), `dataSetRow["X"]`, `params["P"].value`, `row.__rownum`, `Total.sum(…)` and friends, `BirtStr`, `BirtMath`, `BirtDateTime`, `BirtComp`, `Formatter.format`, string methods, and the Java forms above. Statements (`;`, `var`), `reportContext`, `vars`, filtered aggregates and ranks show as text with a note. |

Tested on 29 BIRT sample reports (`tests/fixtures/birt/corpus`, EPL-2.0): all import, validate and render; 649 items: 615 mapped, 31 approximated, 3 dropped (99.5% kept). Most frequent notes: SQL connection to set (22), fonts not bundled (12), HTML values shown as text (10), event scripts (7), table rows with more than text (7).

### ActiveReports masters, parts and layers

`Layers` become report `layers` (`TargetDevice` Screen/Paper/Export/None → `screen`/`print`/`export`/`design`, `Visible: false` → hidden) and each item's `LayerName` its `layer`. A library's `ReportParts` become `parts` (`ReportItemName` → `item`, `Properties` → `properties` with their defaults); `reportpart` items become part items (`Library` → the report id that file gets when imported, `ReportPart`, `Properties` as values); `PartProperties!x.Value` reads them. `MasterReport` becomes `master` (the report id of that file); `ContentPlaceHolder` items in a master become placeholders. The notes say which id to import each library and master under.

## Single sign-on

| Setting | |
|---|---|
| `PW_OIDC_ISSUER`, `PW_OIDC_CLIENT_ID`, `PW_OIDC_CLIENT_SECRET` | OpenID Connect (authorization code + PKCE). Register `https://<PW_BASE_URL>/api/auth/oidc/callback` as the redirect URI. `PW_OIDC_SCOPES` (default `openid email profile`), `PW_OIDC_GROUPS_CLAIM` (default `groups`), `PW_OIDC_NAME` (button label). The ID token must carry `email_verified: true` |
| `PW_SAML_ENTRY_POINT`, `PW_SAML_IDP_CERT` (PEM or base64, or `PW_SAML_IDP_CERT_FILE`), `PW_SAML_IDP_ISSUER` (all three required) | SAML 2.0 (HTTP-Redirect request, HTTP-POST response, signed assertions required). SP metadata: `/api/auth/saml/metadata`; ACS: `/api/auth/saml/acs`. `PW_SAML_ISSUER` (SP entity id), `PW_SAML_EMAIL_ATTR`, `PW_SAML_GROUPS_ATTR` (default `groups`), `PW_SAML_NAME` |
| `PW_SSO_ROLE_MAP` | `idp-admins=admin,idp-designers=designer`: an IdP group or role value → Pagewright role (the highest wins) |
| `PW_SSO_DEFAULT_ROLE` | Role without a mapped value: `viewer` (default), `designer`, `admin`, or `none` to refuse the sign-in |
| `PW_PASSWORD_LOGIN=off` | No password sign-in while SSO is set up |
| `PW_SSO_ALLOWED_DOMAINS` | `acme.com,acme.co.uk`: only these email domains may sign in with SSO |
| `PW_BASE_URL` | Set it: the redirect URI, ACS and audience come from it |

An account made by single sign-on is bound to the IdP identity (OIDC issuer and `sub`; SAML issuer and NameID), not to the email: the same identity is the same account even if its email changes, and another identity with the same email is refused. SSO never takes over an existing password account by itself: an admin first presses **Allow SSO** on the user (`PATCH /api/users/<email> { allowSso: true }`), and the next single sign-on with that email binds it (the password stays). Emails must be ASCII. Accounts are made on first sign-in and their role and groups follow the IdP at every sign-in. Every valid group name the IdP sends becomes a group for permissions.


## Governance routes

Details and settings: [GOVERNANCE.md](GOVERNANCE.md).

| Route | What it does |
|---|---|
| `POST /api/auth/login` | `{ email, password }` → a session, or `{ mfa: 'totp' \| 'enrol' }` and the `pw_mfa` cookie |
| `POST /api/auth/mfa` | `{ code }` or `{ recoveryCode }`: the second step (enrolling: the answer has `recoveryCodes`) |
| `POST /api/auth/mfa/setup` | while enrolling at sign-in: `{ secret, uri, qr }` |
| `GET /api/account`, `POST /api/account/2fa` | one's own account; `{ action: 'setup' \| 'enable' \| 'recovery' \| 'disable', code? }` |
| `POST /api/auth/reset/request`, `POST /api/auth/reset/confirm` | `{ email }` (always 202); `{ token, password }` |
| `POST /api/auth/logout` | `{ ok, redirect? }`: after an SSO session, the IdP's logout address |
| `GET\|POST /api/auth/saml/slo` | SAML single logout (signed messages only) |
| `GET\|PATCH /api/admin/settings` | `{ require2fa, snapshotTtl, snapshotMaxMb }` and what the environment sets up (admins) |
| `GET\|DELETE /api/admin/snapshots` | snapshot cache size; clear it (admins) |
| `GET /api/audit/verify?from&to`, `POST /api/audit/checkpoint` | `{ status: 'ok' \| 'unverified' \| 'tampered' \| 'error', … }`; only `ok` passes (admins) |
| `GET\|POST /api/schedules`, `PATCH\|DELETE /api/schedules/<id>`, `POST /api/schedules/<id>/run` | the Schedules page (designers, own schedules) |

### Known limits

- **Audit hash chain (beta).** It shows changed, removed or inserted events, removed streams, a cut tail before the
  newest signed checkpoint, and unsigned or foreign-signed records. It cannot show: the newest events (after the last
  signed checkpoint, up to two checkpoint intervals) removed together with everything after them; a made-up stream
  younger than two intervals (counted as pending, never as proven); anything done by someone holding both write access
  to the storage and the signing key (keep `PW_AUDIT_SIGNING_KEY` on the server only, verify with the public key kept
  elsewhere, and ship to a SIEM for a copy out of reach). A key derived from `PW_SESSION_SECRET` is held by every server.
  An automated review reported an "audit-integrity" finding that was not resolved in detail; treat the chain as beta.
- Admin changes (users, access, settings) are stored before their audit event; if that event cannot be written the
  request answers 503, but the change stays.
- The SIEM queue is in memory: events waiting when a process stops are not shipped (they are in the log).
- Password sign-in's rate limit is per process (two-factor codes and reset requests are limited across servers).
- Uploaded fonts do not start a new snapshot generation: clear the snapshot cache after changing fonts.

## Viewer (embedding)

The viewer is one component: the `/viewer/<id>` page, the designer's Preview tab, `mountViewer()` on other sites and the interactive HTML export all use it.

```html
<script src="https://reports.example.com/embed/pagewright-viewer.js"></script>
<script>
  Pagewright.mountViewer('#report', {
    server: 'https://reports.example.com',
    report: 'loan-statement',
    params: { accountId: 'LN-2025-001982' },
    lang: 'hi',                 // UI language, see below
    viewMode: 'continuous',     // 'single' | 'continuous' | 'galley'
    toolbar: {
      hide: ['excel', 'word'],
      add: [{ id: 'email', label: 'Email', title: 'Email this statement', after: 'print', onClick: (api) => sendMail(api.page) }],
    },
  });
</script>
```

In React: `<ReportViewer definition={def} reportId="loan-statement" lang="hi" viewMode="single" toolbar={{ hide: ['csv'] }} />` (`src/viewer/ReportViewer.jsx`).

### Toolbar

Every built-in item has a stable id. `toolbar.hide` removes items by id; `toolbar.add` adds buttons `{ id, label, title?, after?, onClick? }`. A new button goes right after the item named by `after` (in the same group), or at the end of the toolbar. An `add` id that is a built-in id is ignored: hide the built-in and add your own to replace it.

| Group | Ids |
|---|---|
| panels | `parameters`, `documentMap`, `run` |
| paging | `firstPage`, `previousPage`, `pageNumber`, `nextPage`, `lastPage` |
| zoom | `zoomOut`, `zoomValue`, `zoomIn`, `fitWidth` |
| view | `viewMode`, `fullScreen` |
| info | `stats` |
| search | `search` (box, match case, whole word, previous/next, list of matches) |
| export | `print`, `pdf`, `excel`, `word`, `html`, `csv`, `json` |

`parameters` and `documentMap` show only when the report has parameters or bookmarks; `fullScreen` only where the browser allows it. In the page each item is wrapped in an element with `data-toolbar-id="<id>"`.

`onClick` gets `api`: `{ page, pages, goTo(n), run(), print(), exportAs('pdf' | 'xlsx' | 'docx' | 'pptx' | 'html' | 'csv' | 'json') }`. Built-in export ids: `pdf`, `excel`, `word`, `powerpoint`, `html`, `csv`, `json`, `exportOptions` (the ⚙ menu: accessible PDF, PDF/A, Excel formulas, kind of HTML file; kept in the browser). `json` is the laid-out pages, the same as the API's `json` format.

Narrower than 640 px (the viewer's own width, so an embed in a sidebar counts), the toolbar keeps `parameters`, `previousPage`, `pageNumber`, `nextPage` and `search` and puts the rest in a "More" menu (custom items too). Side panels open as bottom sheets, and a swipe left or right turns the page.

### View modes, print, full screen

- `single`: one page at a time. `continuous` (default): every page in one scroll. `galley`: the report laid out as one long page as wide as its paper (the engine's pageless layout); page breaks do not apply.
- In continuous and galley view, the header row of a table whose header repeats on each page (`repeatHeader`, the default) stays at the top while that table scrolls.
- **Print** makes the same PDF as the PDF button and prints it from a hidden frame; where the browser blocks that, the PDF opens in a new tab. Print and the exports are always of the paged report, also in galley view.
- **Full screen** uses the browser's Fullscreen API on the viewer element.

### Search

Search ignores case unless **Match case** (`Aa`) is on; **Whole word** (`ab`) matches only whole words, in any script (Devanagari vowel signs count as part of a word). The list button shows every match with its page number; click one to go there. A justified line is matched as one line, not word by word.

### Parameter editors

A parameter's `editor` picks its control in the parameter panel. Without it, the control follows the type and the choices, as before.

| `editor` | For | Options | Value |
|---|---|---|---|
| `slider` | number | `min` (0), `max` (100), `step` (1) | the number |
| `range` | number, `multi: true` | `min`, `max`, `step` | two numbers, `Parameters.x[0]` and `Parameters.x[1]` |
| `dateRange` | date, `multi: true` | `min`, `max` (yyyy-mm-dd) | two dates, `Parameters.x[0]` and `Parameters.x[1]` |
| `radio` | any, with choices | | the picked value |
| `list` | any, with choices | `multi` for more than one | the picked value(s) |
| `toggle` | boolean | | `true` / `false` |

A range with one bound filled takes the other from `min`/`max`. Filter with both bounds, for example `{ "expr": "=Fields.amount", "op": ">=", "value": "=Coalesce(Parameters.amount[0], 0)" }`. `reports/parameter-editors.pw.json` uses every editor.

`"parameterLayout": { "columns": 3 }` on the report puts the parameter panel above the pages as a grid of 3 columns (on a phone it is still one column, in a sheet). The designer's parameter dialog sets both.

### UI languages

`?lang=` on any page (`/`, `/viewer/<id>`, `/designer/<id>`, `/admin/users`, `/login`) or the `lang` option: `en`, `hi`, `es`, `fr`, `de`, `ja`, `zh`, `pt-BR`, `ar`. Arabic turns the interface right-to-left; report pages are never mirrored. Links from the home page keep the language. Strings live in `src/i18n/<lang>.js`; a unit test checks that every language has every key. The translations other than English are machine quality and need a native speaker's review. The designer's property inspector, data dialogs and wizards are still English.

## Designer (embedding)

The designer embeds like the viewer. It loads only on pages that ask for it (the viewer's script stays the same size), and it renders in a shadow root so the host page's styles do not leak in.

```html
<script src="https://reports.example.com/embed/pagewright-viewer.js"></script>
<script>
  const designer = await Pagewright.mountDesigner('#designer', {
    server: 'https://reports.example.com',
    definition,                              // or report: 'id' to load it from the server
    onSave: (def) => saveToMyApp(def),       // without onSave, Save writes to the Pagewright server (PUT /api/reports/<report>)
    onOpen: () => pickAReport(),             // adds an Open… button; return a definition (or a promise of one)
    readOnly: false,                         // true: no Save, no toolbox, nothing can be changed
    toolbox: { hide: ['map', 'chart'] },     // tool ids: textbox, richtext, table, image, line, shape, list, container, chart,
                                             // matrix, barcode, sparkline, databar, bullet, subreport, toc, field, map, checkbox
    panels: { data: true, inspector: true }, // false hides the data panel or the property inspector
    dataSourceTemplates: [{ label: 'Orders API', source: { name: 'orders', type: 'rest', url: 'https://api.example.com/orders' } }],
    height: '760px',
  });
  designer.getDefinition();                  // the definition as it is now
  designer.save();
</script>
```

Keyboard shortcuts work only for keys typed in the designer, never in the host page; typing in the designer's own inputs is never a shortcut (Backspace in a field does not delete the selected item). One designer per page. As an ES module: `import { mountDesigner } from '@pagewright/viewer/designer'`.

## Framework packages and types

| Package | Use |
|---|---|
| `@pagewright/viewer` | `mountViewer`, and `mountDesigner` from `@pagewright/viewer/designer` |
| `@pagewright/react` | `<PagewrightViewer server report params style />`, `<PagewrightDesigner server definition onSave />` |
| `@pagewright/vue` | `<PagewrightViewer :options="{ server, report }" />`, `<PagewrightDesigner :options="…" @ready="…" />` |
| `@pagewright/svelte` | `<div use:pagewrightViewer={{ server, report }}>`, `use:pagewrightDesigner` (actions: no compiler step) |
| `@pagewright/angular` | `definePagewrightElements()`, then `<pagewright-viewer [options]="…">` and `<pagewright-designer (pw-save)="…">` with `CUSTOM_ELEMENTS_SCHEMA` |
| `@pagewright/engine` | `render`, the exporters, the `pw` CLI |

The wrappers are thin: the framework and `@pagewright/viewer` are peer dependencies, nothing is bundled, and the viewer loads on mount, so server rendering (Next.js, Nuxt, SvelteKit, Angular SSR) never touches `window`. A viewer remounts when what it shows changes; a designer only for another `report` or a new `definition` object, so it keeps its edits. In React, a `style.height` on the component makes the viewer fill it.

Types: every package ships `.d.ts`. The engine's API and the viewer's options are generated from their JSDoc; the report definition has hand-written types:

```ts
import type { Report, Item } from '@pagewright/engine';
const report: Report = { $schema: 'pagewright/report@1', sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: '=Fields.name' }] } } };
```

Build them with `npm run build:packages`; `tests/fixtures/types/consumer.ts` is type-checked by the unit tests.

## Report features

### Table of contents: headings and numbering

A text box with `headingLevel` (1–6) is a heading. A table of contents with `"source": "headings"` lists the headings (the PDF's bookmarks panel keeps the bookmarks only); without it, it lists bookmarks as before. `numbering` numbers the lines: `"decimal"` (1, 1.1, 1.2), `"roman"` (I, II), `"alpha"` (A, B), or one per level, `["roman", "alpha"]` or `"roman,alpha"` (the last repeats for deeper levels). A level that is skipped counts as 1. In the viewer, clicking a line goes to its heading.

### Barcodes

49 symbologies in the designer with their usual names (Code 128, GS1-128, EAN-13, UPC-A, ITF-14, Codabar, Intelligent Mail, QR Code, Data Matrix, PDF417, Aztec, MaxiCode, …); any other bwip-js id still works in the JSON. Options:

| Key | For | Values |
|---|---|---|
| `captionPosition` | linear codes | `below` (default), `above`; `showText: false` hides it |
| `quietZone` | all | points of white inside the box, on every side |
| `rotate` | all | `0`, `90`, `180`, `270` |
| `qrErrorLevel`, `qrVersion`, `qrMask` | QR codes | `L`/`M`/`Q`/`H`, 1–40, 1–8 |
| `dmShape`, `dmSize` | Data Matrix | `square`/`rectangle`, `"24x24"` |
| `pdfColumns`, `pdfRows`, `pdfErrorLevel`, `pdfCompact` | PDF417 | 1–30, 3–90, 0–8, true |
| `aztecLayers`, `aztecErrorPercent` | Aztec | 1–32, 5–95 |
| `maxiMode` | MaxiCode | 2–6 |
| `checkDigit`, `barRatio` | Code 39, Code 93, Interleaved 2 of 5, Codabar, Code 11, MSI | true, 2–3 |

Every option is checked against its list or range before it reaches bwip-js; anything else is ignored. A value longer than the symbology can hold is refused at once with an error on the page (QR: 7,089 characters; most linear codes: 128).

### Images

An image's `src` can be a URL, a data URI, `embedded:<name>` for an image the report carries in `"images": { "<name>": "data:image/png;base64,…" }` (also in `backgroundImage`), or a data field that holds base64 text (with or without a `data:` prefix) or bytes (a database BLOB). PNG, JPEG, GIF, WebP and SVG are recognised from their first bytes.

`fit`: `contain` (default), `cover`, `fill`, or `clip` (the image at its natural size from the top-left corner, cut to the box). `autoSize: true` sizes the box to the image. Natural size is 96 dpi (one pixel is 0.75 pt), and is known for data, embedded and base64 images; a URL image's size is not known before it loads, so it is fitted inside the box with a warning.

In the PDF, SVG images are drawn as vector paths: path, rect, circle, ellipse, line, polyline, polygon, groups, transforms, fill, stroke and opacity. Text, gradients, patterns, clip paths, masks, filters and `<use>` are not drawn there (the viewer and the HTML export show SVG fully). Limits: 10 MB per image and 50 MB of images per report (each distinct image once); larger ones are left out with a warning. In the PDF, an SVG over 2 MB or 10,000 shapes, and a PNG over 40 megapixels or animated, are left out.


### Pivot tables (matrix / tablix)

A `matrix` with `rowGroups`, `columnGroups` and `values` arrays is a pivot table (the older `rowGroup` / `columnGroup` / `value` keys still work and render as before). Design: `docs/superpowers/specs/2026-10-04-tablix-design.md`.

```json
{ "type": "matrix", "name": "Pivot", "dataSet": "Sales", "x": 0, "y": 0, "w": 520, "h": 60,
  "rowGroups": [{ "name": "Region", "expr": "=Fields.region", "sort": "asc", "total": "after", "collapsible": true, "width": 80, "header": "Region" },
                { "name": "City", "expr": "=Fields.city", "total": "after" }],
  "columnGroups": [{ "name": "Year", "expr": "=Fields.year", "total": "after" }, { "expr": "=Fields.q", "label": "=\"Q\" & Fields.q" }],
  "values": [{ "label": "Amount", "value": "=Sum(Fields.amount)", "format": "N0" }, { "label": "Share", "value": "=Sum(Fields.amount)", "show": "percentOfRow" }],
  "overflow": "paginate", "pageOrder": "down" }
```

| Key | Meaning |
|---|---|
| group `expr`, `label`, `format`, `sort`, `sortBy` | the key; the text shown (default: the key); `asc`/`desc`; an expression in the instance's scope to sort by (`=Sum(Fields.amount)`) |
| group `total`, `totalLabel` | `before` / `after`: a total of this group's instances inside the group above; on the first group it is the grand total |
| group `collapsible`, `initiallyCollapsed` | a ▼/▶ toggle on each instance; a collapsed instance is one row (or column) with the instance's values |
| row group `width`, `header` | the header column's width and the title over it |
| value `show` | `value`, `percentOfTotal`, `percentOfRow`, `percentOfColumn` (format `P1` unless given) |
| `overflow` | `paginate` (default for the array form): columns that do not fit continue on the next pages, the row headers repeated; `shrink`: the older narrow-then-cut rule |
| `pageOrder` | `down` (all rows for the first columns, then the next columns) or `across` (each block of rows on every column set first; starts on a new page) |

A group's `name` is a scope in value expressions: `Sum(Fields.x, "Region")` is the region instance across all columns. Limits: 8 levels of groups per axis, 50 values, 1,000 value columns, 250,000 cells (more is cut with a warning). Keys and labels are data: they are never evaluated as expressions.

### Tables: merged cells, items in cells, wide tables, recursive groups

- `rowSpan` on a cell merges it down over the next rows of the same band (the header rows, one group's rows, one record's detail rows, the footer rows). If its rows break across pages, the text is drawn again at the top of the next page. Word gets `vMerge`, Excel merged cells.
- `item` on a cell lays out an item (table, list, chart, sparkline…) in the cell. The table's data set means the cell's rows; a `relation` data set gets that row's children. One render lays out at most 100,000 rows of items in cells.
- `overflow: "paginate"` on a table wider than the page continues the columns on the next pages; `repeatColumns: n` repeats the first n columns on each page set; `pageOrder` as for pivots. Excel and CSV keep every column.
- `printAtBottom: true` puts the table footer at the bottom of the page the table ends on.
- A group with `parent` (e.g. `=Fields.managerId`; `expr` is the row's id) is a recursive hierarchy: depth first, `Level()` is the depth (0 at the top), `indent` adds points of left padding per level, `Sum(Fields.cost, "Group", "Recursive")` adds the node and everything under it, `collapsible` with `expandLevels: n` opens the first n levels. Cycles are broken and depth stops at 64, with a warning.

### Lists, sections and page numbers

- `columns: n` on a list puts n records across (a grid list), `columnGap` points apart.
- `newSection: true` on a table group or a list: each instance starts on a new page and `Globals.PageNumber` / `TotalPages` count inside it (one PDF of many invoices, each "Page 1 of 2"). `Globals.OverallPageNumber` / `OverallTotalPages` count the whole report.
- `sections.body` can be an array of body sections, `{ name, page, items, height, columns }`, each with its own page (`page` keys override the report's). Page numbers continue across sections; the page header and footer are shared. Pages of another size carry `width` / `height` in the page model; PDF, HTML, Word and the viewer use them.
