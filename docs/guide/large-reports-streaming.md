# Large reports and streaming

Export a report with millions of rows without running out of memory. Streaming reads the rows in batches and writes the file as it goes. Use it for big CSV, Excel, PDF or Word exports.

## In the UI

1. Open the report in the viewer (`/viewer/<id>`).
2. For a large report, click **Server PDF**. The server makes the PDF (much faster than the browser). It opens in a new tab.
3. For a CSV or Excel export of a large table, the server streams it when the report allows it (see Notes).

The viewer shows the note "A large report: the server makes this PDF (much faster than the browser)."

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json -f pdf -o orders.pdf
# pw: wrote orders.pdf (1 pages, streamed)
```

`pw render -f pdf -o file` streams a flowing table into the file as it is laid out. The message says `streamed`. Other formats, `--password` and `-o -` render the whole report in memory first.

## Through the API

Needs an API key. A CSV (`format: "csv"`, not `csv: 'layout'`) or Excel (`format: "xlsx"`) export of a report with one table streams:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"csv","parameters":{"accountId":"LN-2025-001982"}}' \
  -D headers.txt -o ledger.csv
```

A streamed answer has no `content-length` and `x-reportwright-pages: 0`. If the render fails after the first bytes, the CSV ends with a last line `#ERROR <reference>` and the connection is cut. A failed download is never a short file that looks whole.

## Notes

- Streaming works for one table with row-by-row expressions. Group and table footers may total with `Sum`, `Count`, `Avg`, `Min`, `Max` or `CountRows`.
- Not streamed (usual path, under the usual caps): aggregates in detail rows, `Lookup`, nested data sets, TopN filters, and several tables.
- Excel: a table over 1,048,576 rows continues on "Name (2)".
- Sources that stream: JSON arrays, CSV, SQLite, PostgreSQL and MySQL cursors.
- Limits and switches (`docs/CONFIG.md`): `PW_STREAM` (set `0` to turn streaming off), `PW_STREAM_MAX_ROWS` (5,000,000), `PW_STREAM_FETCH_MAX_MB` (4096), `PW_STREAM_SQL_MAX_MB` (4096), `PW_SPILL_MAX_MB` (2048, temporary disk for sorting), `PW_STREAM_STALL_MS` (30000).
- Design notes: `docs/research/STREAMING-1M.md` (`docs/API.md`).
