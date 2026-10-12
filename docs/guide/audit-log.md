# Audit log

See who did what, and when. The log records sign-ins, report changes, sharing, renders, exports, API key use, batches and schedule runs. Use it to answer "who changed this report?" or "who exported that statement?". Parameter values and passwords are never stored.

## In the UI

1. Sign in as an admin. Open **Audit log** (`/admin/audit`).
2. Under **Filter the audit log**, set **From** and **To** (dates).
3. Press **Apply**. Events show newest first.
4. Press **Export CSV** to download the filtered events.

## From the CLI

Server only. Run in the app folder with the server's `PW_STORAGE` and keys:

```bash
node bin/pw.mjs audit verify
node bin/pw.mjs audit verify --from 2026-01-01 --to 2026-06-30 --json
node bin/pw.mjs audit checkpoint
```

- `audit verify`: checks the hash chain and the signed checkpoints.
  - `--from YYYY-MM-DD`, `--to YYYY-MM-DD`: the dates to check.
  - `--json`: print the result as JSON.
  - `--public-key file.pem`: check with a public key kept elsewhere.
- `audit checkpoint`: writes a signed checkpoint now.
- `audit rekey --old-secret S | --old-key file.pem`: after you change the audit key.
- Exit code `0` only when the log checks out (`ok`). Any other verdict exits `1`.

## Through the API

Admin session. The list:

```bash
curl -sS "http://localhost:3000/api/audit?from=2026-06-01&to=2026-06-30&type=report.&limit=100" \
  -b cookies.txt
curl -sS "http://localhost:3000/api/audit?type=report.&format=csv" -b cookies.txt -o audit.csv
```

Query fields: `from`, `to`, `type`, `actor`, `report`, `limit`, `before`, `format=csv`. A `type` that ends with `.` is a prefix (`report.`).

Verify the chain:

```bash
curl -sS "http://localhost:3000/api/audit/verify?from=2026-06-01&to=2026-06-30" -b cookies.txt
```

Its answer has `status`: `ok`, `unverified`, `tampered` or `error`. Only `ok` passes.

Write a signed checkpoint: `POST /api/audit/checkpoint` (admin, with an `Origin` header).

## Notes

- Events kept for `PW_AUDIT_RETENTION_DAYS` (default 365).
- Events are append-only, in the configured storage.
- Signed checkpoints every `PW_AUDIT_CHECKPOINT_MINUTES` (default 15). `PW_AUDIT_SIGNING_KEY` (an Ed25519 PEM key) signs them.
- Forward events to a SIEM with `PW_AUDIT_SIEM` (an HTTPS endpoint). The queue is in memory. Events waiting when a process stops are not sent (they stay in the log).
- The hash chain is beta. `docs/API.md` (Known limits) lists what it cannot prove. Keep the signing key on the server only.
