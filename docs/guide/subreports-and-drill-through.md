# Subreports and drill-through

Put one report inside another (a subreport), or open another report from a row (drill-through). Use a subreport for a detail table under a header. Use drill-through to go from a summary to the detail report for one item.

## In the UI

Subreport:

1. In the designer, drag **Subreport** onto the page.
2. In the **Inspector**, pick **Report** (the report to embed), and set its parameters.

Drill-through:

1. Select a table row, a text box, or a barcode.
2. In the **Inspector**, open the action editor. Pick **Open another report (drill-through)**, then the target report from the list.
3. Or pick **Filter this report (set parameters)** to set parameters of the same report.

In the viewer, drill-through opens the target. A **Drill-through path** shows where you are. Use the back button to return.

## From the CLI

The target report must sit next to the report that uses it, with the id as its file name:

```
reports/
  orders.pw.json           # uses the subreport or drill-through
  order-detail.pw.json     # the target, id "order-detail"
```

`pw render reports/orders.pw.json -f pdf -o orders.pdf` loads `order-detail.pw.json` from the same folder. Masters, parts, stylesheets and themes load the same way.

Drill-through in HTML needs a public base URL: `pw render … --base https://reports.example.com --drill-links inline`. Without it, the links are disabled.

## Through the API

Subreports and drill-through targets are resolved on the server when a report renders. Use `POST /api/v1/render`. The server applies the same permission rules: a subreport the caller cannot view is not found (404).

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"<report-id>","format":"pdf","parameters":{"year":"2026"}}' \
  -o orders.pdf
```

## Notes

- Subreports and drill-through targets are looked up by id. Import the target file too when you migrate (see [import-ssrs-jasper-birt-activereports](import-ssrs-jasper-birt-activereports.md)).
- Subreports count toward the render's evaluation budget. A report with many subreports can hit `PW_RENDER_TIMEOUT_MS`.
- A subreport loaded from the server runs with the caller's access (see [users-roles-and-permissions](users-roles-and-permissions.md)).
