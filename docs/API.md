# Automation API (`/api/v1`)

Use this API to make reports from other systems: one report on request, many reports in a batch, or batches on a schedule.

## Authentication

Set `PW_API_KEYS="key1,key2"` on the server. Send one key with each request:

```
Authorization: Bearer key1        (or)        x-api-key: key1
```

In production the API refuses all requests when `PW_API_KEYS` is empty. In `next dev` it answers without a key.

A plain key is a **service key**: it may render, batch and schedule every report. With accounts on (`PW_AUTH=users`) a key written `email|key` (for example `PW_API_KEYS="svc-key,reports@acme.com|k2"`) acts as that user: it sees, renders and schedules only what that user may view (permissions below), renders a definition sent in the request only when the user is a designer, and sees only its own batches and schedules. A disabled or deleted user's key stops working. Every call is in the audit log under the key's id (the first 8 hex of its SHA-256), never the key.

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
| `GET /api/reports/<id>/thumb` | Page 1 as SVG with default parameters (home page cards); cached per report content and viewer |
| `GET / PUT /api/reports/<id>/access` | Its folder, inheritance and grants; `PUT { folder?, inherit?, grants? }` moves or shares it (manage) |
| `GET / POST /api/folders` | Folders the caller may see (and its level on each), `{ root: { access }, folders }`; `POST { name, parent? }` adds one (manage on the parent) |
| `GET / PATCH / DELETE /api/folders/<id>` | A folder with its grants; `PATCH { name?, parent?, inherit?, grants? }`; `DELETE` an empty folder. `<id>` = `root`: the top-level grants (admins) |
| `GET /api/audit?from&to&type&actor&report&limit&before[&format=csv]` | The audit log, newest first (admins). `type` ending in `.` is a prefix (`report.`) |
| `POST /api/audit/export` | `{ report, format }`: the viewer reports an export it made in the browser (logged as `client: true`) |

These routes use the app's sign-in (`PW_AUTH=users`, or the shared `PW_BASIC_AUTH`), not API keys.

### Permissions

With accounts on, each report has a level for each user: `view` (open, run, export, run its saved SQL), `edit` (also save, restore, version history) or `manage` (also share, move, delete). A grant is `{ "to": "user:ann@acme.com" | "group:finance", "level": "view" | "edit" | "manage" }`. A report gets the highest grant on itself, then on its folder and the folders above while `inherit` is true, then the top-level grants (default `group:everyone` manage, i.e. as before permissions). The role is a ceiling: viewers view at most, admins manage everything. `group:everyone` is every signed-in user; `group:public` also anonymous viewers embedded from `PW_EMBED_ORIGINS`. A report a user may not view is **not found** (404) on every route, the viewer, the designer, thumbnails, exports, `/api/v1`, saved SQL, and as a subreport. A new report's creator manages it. Old versions (`id@version`) need edit.

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
