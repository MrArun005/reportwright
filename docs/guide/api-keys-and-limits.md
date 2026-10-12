# API keys and limits

Let your own systems call the automation API (`/api/v1`) with a key. Use keys for render, batch and schedule calls from a server. Keys are set on the server, not in the UI.

## In the UI

Not available in the UI. Keys are set by the server admin in `PW_API_KEYS`.

## From the CLI

Not available in the `pw` CLI.

## Through the API

Set the keys on the server (comma-separated):

```bash
PW_API_KEYS="key1,reports@acme.com|key2"
```

Send one key with each request, as a header. Either form works:

```bash
curl -sS http://localhost:3000/api/v1/templates -H "x-api-key: $PW_API_KEY"
curl -sS http://localhost:3000/api/v1/templates -H "Authorization: Bearer $PW_API_KEY"
```

Check that the server is up (no key needed):

```bash
curl -sS http://localhost:3000/api/v1/readyz
```

Render-pool details (service key or admin key):

```bash
curl -sS http://localhost:3000/api/v1/health -H "x-api-key: $PW_API_KEY"
```

## Notes

- A plain key is a service key. It may render, batch and schedule every report.
- A key written `email|key` acts as that user. It sees and renders only what that user may view. A disabled or deleted user's key stops working.
- In production the API refuses all requests with no keys set, unless `PW_ALLOW_KEYLESS=1`. Then it answers reads and renders of saved templates without a key. It gives no batches or schedules.
- Each call is in the audit log under the key's id (the first 8 hex characters of its SHA-256), never the key.
- Batches and schedules stop when their key leaves `PW_API_KEYS`.
- Limits:
  - A batch holds at most 10,000 items (`docs/API.md`).
  - `PW_BATCH_CONCURRENCY` (default 2): items of one batch at once.
  - `PW_RENDER_TIMEOUT_MS` (default 60000): a render past it answers `504`.
  - `PW_RENDER_QUEUE` (default 1000): renders that may wait. More answer `503`.
  - `PW_RENDER_QUEUE_PER_PRINCIPAL`: renders one caller may have waiting. More answer `429`.
  - `PW_RENDER_MAX_WAIT_MS` (default 30000): a longer estimated wait answers `503`.
  - Answers that are busy carry `Retry-After` (seconds). Wait that long before you retry.
  - Email attachments: `PW_MAIL_MAX_RECIPIENTS` (20), `PW_MAIL_MAX_ATTACHMENT_MB` (10).
- Sign-in limits are separate. See [sign-in-sso-and-2fa](sign-in-sso-and-2fa.md).
- Full list: [docs/CONFIG.md](../CONFIG.md).
