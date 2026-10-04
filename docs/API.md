# Automation API (`/api/v1`)

Use this API to make reports from other systems: one report on request, many reports in a batch, or batches on a schedule.

## Authentication

Set `PW_API_KEYS="key1,key2"` on the server. Send one key with each request:

```
Authorization: Bearer key1        (or)        x-api-key: key1
```

In production the API refuses all requests when `PW_API_KEYS` is empty. In `next dev` it answers without a key.

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
    format: 'pdf',                       // pdf | xlsx | html | csv | json (the page model)
    parameters: { accountId: 'LN-2025-001982' },
    data: { loan: { /* your JSON */ } },  // optional: replaces the data source named "loan"
    fileName: 'statement-LN-2025-001982',
  }),
});
const pdf = await res.arrayBuffer();
```

Response headers: `x-pagewright-pages`, `x-pagewright-ms`, `x-pagewright-warnings`.

Errors are JSON `{ error, missingParameters? }`: 400 for a bad request or missing parameters, 401 for a bad key, 404 for an unknown template.

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
- `folder` output writes the files to `data/outputs/<folder>/` on the server.
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

Cron supports `*`, lists `1,15`, ranges `1-5` and steps `*/15`. Names such as `MON` are not supported; use numbers. The scheduler checks every 30 seconds in the server process. Schedules are in `data/schedules.json`. Set `PW_SCHEDULER=off` on all servers but one when you run more than one.

## Report storage (used by the designer)

| Route | What it does |
|---|---|
| `GET / POST /api/reports` | List, create |
| `GET / PUT / DELETE /api/reports/<id>` | Read, save (keeps a version), remove |
| `GET /api/reports/<id>/versions` | Saved versions |
| `POST /api/reports/<id>/versions` | `{ version }`: restore that version |
| `GET /api/reports/<id>/pdf?format=…&param=value` | Render on the server |
| `GET /api/reports/<id>/thumb` | Page 1 as SVG with default parameters (home page cards); cached until the file changes |

These routes have no API key check. Put them behind your own login when the server is public (see `STATUS.md`, gap 1).

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
| export | `print`, `pdf`, `excel`, `word`, `html`, `csv` |

`parameters` and `documentMap` show only when the report has parameters or bookmarks; `fullScreen` only where the browser allows it. In the page each item is wrapped in an element with `data-toolbar-id="<id>"`.

`onClick` gets `api`: `{ page, pages, goTo(n), run(), print(), exportAs('pdf' | 'xlsx' | 'docx' | 'html' | 'csv') }`.

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
