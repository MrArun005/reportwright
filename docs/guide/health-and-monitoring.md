# Health and monitoring

Know whether the server is up, and how busy the render pool is. Use it to point an uptime monitor at the server, or to scrape metrics into Prometheus or Grafana.

## In the UI

Not available in the UI.

## From the CLI

Not available in the `pw` CLI.

## Through the API

Ready check (no key). Use this for an uptime monitor. It answers `200` when storage answers and a render worker is ready:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/readyz
```

Pool details (a service key, or an admin's key):

```bash
curl -sS http://localhost:3000/api/v1/health -H "x-api-key: $PW_API_KEY"
```

Health gives the render workers (`size`, `alive`, `ready`, `busy`), the queue depth by class (`interactive`, `background`), the estimated wait in ms, and totals since start (`done`, `failed`, `rejected`, `timedOut`, `crashed`, `recycled`, `dropped`).

Metrics (a service key, or an admin's key):

```bash
curl -sS http://localhost:3000/api/v1/metrics -H "x-api-key: $PW_API_KEY"
```

`reportwright_http_requests_total` counts answers by status class. Scrape it into Prometheus, or Grafana Cloud.

## Notes

- Free hosted monitors (UptimeRobot, Better Stack) can check `/api/v1/readyz` every 5 minutes and alert on a non-200 answer (`docs/OPS.md`).
- An alert on 5xx answers: keep them under 5 % (`PW_MAX_5XX`, `scripts/uptime-check.mjs`, `docs/OPS.md`).
- The server logs one JSON line per request to stdout. Turn it off with `PW_REQUEST_LOG=0`. Metrics are kept either way.
- `docs/OPS.md` has the full operations guide.
