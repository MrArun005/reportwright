# Automation API (`/api/v1`)

Use this API to make reports from other systems: one report on request, many reports in a batch, or batches on a schedule.

## Authentication

Set `PW_API_KEYS="key1,key2"` on the server. Send one key with each request:

```
Authorization: Bearer key1        (or)        x-api-key: key1
```

In production the API refuses all requests when `PW_API_KEYS` is empty. In `next dev` it answers without a key.

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
