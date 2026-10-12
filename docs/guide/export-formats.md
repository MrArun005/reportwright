# Export formats (Excel, Word, PowerPoint, HTML, CSV, JSON)

Export one report to the format your users need. The same report produces PDF, Excel (`.xlsx`), Word (`.docx`), PowerPoint (`.pptx`), HTML, CSV and JSON. Use CSV or Excel for data, Word or PowerPoint for editing, and HTML for sharing a report in a browser.

## In the UI

1. Open the report in the viewer (`/viewer/<id>`).
2. In the toolbar, in the **Export** group, click one of:
   - **PDF**
   - **Excel**
   - **Word**
   - **PowerPoint**
   - **HTML (interactive)**: one file with a viewer. Groups and drill-through work in the file.
   - **HTML (print)**: pages only, no viewer.
   - **CSV**
   - **JSON**: the laid-out pages, the same as the API's `json` format.
3. For HTML and Excel options, click the **Export options** button (⚙, labelled "Export options"). Options are remembered in this browser.

Word leaves out charts and images (see Notes). Hover over **Word** or **PowerPoint** to see the tooltip: "Text and tables, to edit in Word" and "One slide per page, to edit in PowerPoint".

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json -f xlsx -o orders.xlsx
pw render orders.pw.json -d orders=orders.json -f csv -o orders.csv
pw render orders.pw.json -d orders=orders.json -f docx -o orders.docx
pw render orders.pw.json -d orders=orders.json -f pptx -o orders.pptx
pw render orders.pw.json -d orders=orders.json -f html --html static -o orders.html
pw render orders.pw.json -d orders=orders.json -f json -o pages.json
```

- `-f`: `pdf` (default), `xlsx`, `docx`, `pptx`, `html`, `csv`, `json` or `txt`.
- `-d orders=orders.json`: replaces the data source named `orders` with the file's JSON.
- `--values`: Excel totals as values instead of live formulas.
- `--layout`: CSV of the printed layout (every table, group line and total), not just the data.
- `--html tables|static` (or `--static`): the HTML file. `interactive` is not available from the CLI. Export it from the viewer.
- `-o -`: write to stdout.

## Through the API

Needs an API key. Use `format` in the body of `POST /api/v1/render`: `pdf`, `xlsx`, `docx`, `pptx`, `html`, `csv` or `json` (from `docs/API.md`).

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"xlsx","parameters":{"accountId":"LN-2025-001982"},"formulas":false,"fileName":"sales"}' \
  -D headers.txt -o sales.xlsx
```

- `formulas: false`: Excel totals as values instead of live `SUBTOTAL` formulas.
- `static: true`: an HTML file without its Tables view. The API has no other HTML mode switch.

Response: the file bytes, with the `x-reportwright-*` headers.

## Notes

- Excel, CSV, Word and interactive HTML need table data. The CLI and server pass it for you. In code, call `render(def, { exportData: true })`.
- A CSV or Excel export of a report with one table and row-by-row expressions streams. Memory stays flat. See [large-reports-streaming](large-reports-streaming.md).
- Excel tables over 1,048,576 rows continue on a sheet named "Name (2)".
- Word export: charts and images are left out (`docs/FEATURES.md`, "Word `.docx` (real tables, section page sizes; charts and images are left out)").
- Excel and Word draw no rounded corners.
- The HTML "interactive" mode needs the viewer bundle. The CLI writes an error and tells you to use `--html tables` or `--html static`.
- Default HTML mode: `PW_HTML_EXPORT` (see [html-export-settings](html-export-settings.md)).
