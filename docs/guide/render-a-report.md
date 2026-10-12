# Render a report (PDF)

Render a saved report to a PDF with the same pages you see in the viewer. Use it to print statements, invoices or any fixed-layout document. You can render in the browser (viewer), on the server (a link or the API), or from the command line (`pw render`).

## In the UI

1. Open the home page (`/`). Find the report card.
2. Click **View** on the card. The viewer opens at `/viewer/<id>`.
3. Set the parameters in the **Parameters** panel. Press **Run**. (If **live parameters** is off, press **View report**.)
4. Click **PDF** in the **Export** group of the toolbar.

To render on the server instead (faster for large reports):

1. On the home page, click **Server PDF ↗** on the report card. The PDF opens in a new tab.

**Print** in the toolbar makes the same PDF and prints it.

## From the CLI

```bash
pw render reports/loan-statement.pw.json -p accountId=LN-2026-004417 -f pdf -o statement.pdf
```

- `pw render <report.pw.json>`: the report file to render.
- `-p accountId=…`: sets a report parameter. Repeat `-p` for more.
- `-f pdf`: the output format. `pdf` is the default.
- `-o statement.pdf`: the output file. Use `-o -` to write to stdout.

## Through the API

Needs an API key (`PW_API_KEYS` on the server).

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"},"fileName":"statement-LN-2025-001982"}' \
  -D headers.txt -o statement.pdf
```

Request body fields (from `docs/API.md`): `template`, `format`, `parameters`, `data`, `fileName`. The `template` is a saved report id (`"loan-statement"`), a saved version (`"loan-statement@3"`), or a full definition.

Response: the PDF bytes. Response headers: `x-reportwright-pages`, `x-reportwright-ms`, `x-reportwright-warnings`.

Errors are JSON `{ "error": "…" }`: 400 (bad request or missing parameters), 401 (bad key), 404 (unknown template), 429 or 503 (server busy, with `Retry-After`), 504 (render past the time limit).

## Notes

- A server render has a time limit: `PW_RENDER_TIMEOUT_MS` (default 60000). See [docs/CONFIG.md](../CONFIG.md).
- Renders run in a worker pool. Tune it with `PW_RENDER_WORKERS` and the `PW_RENDER_QUEUE*` settings.
- Relative data URLs resolve against `PW_BASE_URL`. Set it in production.
- `GET /api/reports/<id>/pdf?format=pdf&param=value` renders on the server too. It uses the app sign-in, not an API key.
- For PDF/A, accessible PDF, passwords and signatures, see the pages linked from the [guide index](README.md).
