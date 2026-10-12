# Batches

Render many reports in one job. Use it for "one statement per customer" runs, where each file goes to a zip, a merged PDF, a folder, or a presigned upload URL. The job runs in the background, and a webhook tells your system when it finishes.

## In the UI

Not available in the UI. Batches are created and read through the API. Scheduled batches have a UI: see [schedules-and-email](schedules-and-email.md).

## From the CLI

Not available in the CLI.

## Through the API

Needs an API key. Create a job with `POST /api/v1/batches`. It answers `202` with the job, and the job runs in the background:

```bash
curl -sS -X POST http://localhost:3000/api/v1/batches \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","fileName":"statement-{Parameters.accountId}","items":[{"parameters":{"accountId":"LN-2026-004417"}},{"parameters":{"accountId":"LN-2025-001982"}}],"output":{"type":"zip"},"webhook":"https://your-app/hooks/reportwright"}'
```

Check the job:

```bash
curl -sS http://localhost:3000/api/v1/batches/<id> -H "x-api-key: $PW_API_KEY"
```

Its status is one of `queued`, `running`, `completed`, `completed_with_errors`, `failed`. It has `done`, `failed`, `errors[]` and `results[]`.

Download the zip or merged PDF when it is done:

```bash
curl -sS http://localhost:3000/api/v1/batches/<id>/download -H "x-api-key: $PW_API_KEY" -o statements.zip
```

List the last 50 jobs with `GET /api/v1/batches`.

Webhook body when the job finishes:

```json
{ "event": "batch.finished", "job": { "id": "b_…", "status": "completed", "done": 2, "failed": 0 }, "downloadUrl": "https://…/api/v1/batches/b_…/download" }
```

## Notes

- The `items` list can also come from a URL: `itemsFrom: { url, path, map }`.
- `output`: `zip` (default), `merged` (one PDF), `folder` (`{ type: 'folder', folder }`), or `none`.
- `putUrl` on an item uploads that file with HTTP PUT (for example to a presigned S3 URL).
- One failed item does not stop the batch. Its error goes into `errors[]`.
- A batch holds at most 10,000 items. `PW_BATCH_CONCURRENCY` (default 2) sets how many render at once.
- A `folder` output writes to `data/outputs/<folder>/` on the server. A user's key writes to its own folder.
- Email on a batch needs `PW_SMTP_URL`, `PW_MAIL_FROM` and `PW_MAIL_ALLOWED_DOMAINS`.
- Signed webhooks: when `PW_WEBHOOK_SECRET` is set, check the header `x-reportwright-signature` (`sha256=<HMAC-SHA256 hex>` of the raw body).
- A batch's output must fit `PW_BATCH_MAX_OUTPUT_MB` (default 1024) for zip or merged output. Use a folder output for more.
- Batches stop when the key that made them is removed from `PW_API_KEYS`.
