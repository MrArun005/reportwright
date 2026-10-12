# HTML export settings

Choose what the HTML file looks like: an interactive file with a viewer, a file with sortable tables, or plain printable pages. Set the default once for the server, or per report, and let each viewer pick at export time.

## In the UI

Viewer (per export):

1. Open the report in the viewer (`/viewer/<id>`).
2. Click the **Export options** button (⚙).
3. Under **HTML file**, pick **Interactive viewer**, **Pages and sortable tables**, or **Static pages**.
4. Click **HTML (interactive)** or **HTML (print)** in the **Export** group. The viewer's own choice applies to that export.

Designer (per report):

1. Open **Report properties** in the designer. Find the **HTML export** section.
2. Choose the default kind and drill-through links for this report.

Server (all reports):

1. Open **Settings** (admin only). Find the **HTML export** section.

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json -f html --html static -o orders-print.html
pw render orders.pw.json -d orders=orders.json -f html --html tables --drill-links off -o orders.html
pw render orders.pw.json -d orders=orders.json -f html --static -o orders-print.html
```

- `--html tables|static`: the HTML file. `tables` is pages plus sortable tables. `static` is pages only.
- `--static`: same as `--html static`.
- `--drill-links inline|new-tab|off`: drill-through in HTML. Links need a public `--base`, else they are disabled.
- `interactive` is not available from the CLI. Export it from the viewer.

When neither the flag nor the report sets a kind, the CLI uses the report's `export.html`, then `PW_HTML_EXPORT`, then `tables`.

## Through the API

Needs an API key. The API has one switch: `static`.

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"html","parameters":{"accountId":"LN-2025-001982"},"static":true}' \
  -o statement.html
```

- `static: true`: an HTML file without its Tables view.

## Notes

- Precedence, most specific first (`docs/CONFIG.md`): the viewer's `exportOptions` prop, then the report's `export: { html, drillLinks }`, then the server's Settings page, then `PW_HTML_EXPORT` and `PW_HTML_DRILL_LINKS`, then the built-in default (interactive on the server).
- `PW_HTML_EXPORT`: `interactive`, `tables` or `static`.
- `PW_HTML_DRILL_LINKS`: `inline`, `new-tab` or `off`.
- The interactive file is one file with the viewer built in. Groups and drill-through open in place.
- A static HTML export keeps the state it was made in. It cannot re-sort or filter.
- Server-rendered HTML shows drill-through disabled until the renderer gets its base URL (`drillBase`).
