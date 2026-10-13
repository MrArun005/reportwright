# Parameters

Let the reader (or the caller) choose inputs before the report runs: an account number, a date range, a region. Parameters fill the report's expressions and its data queries.

## In the UI

Viewer:

1. Open the report in the viewer (`/viewer/<id>`).
2. Use the **Parameters** panel. Each parameter has its own control (box, date picker, drop-down, slider, and so on).
3. Press **Run**. If **live parameters** is off, press **View report**. With live parameters on, changes apply as you pick them.

Designer:

1. Open the report in the designer (`/designer/<id>`).
2. Add a parameter with **New parameter**. The dialog is titled "Parameter {name}".
3. Fill in **Name**, **Type**, **Prompt**, **Default** (a value or an `=expression`, such as `=Today()`) and the options: **Required**, **Allow null**, **Allow blank text**, **Hidden (set only by URL, API or drill-through)**, and **Allow several values**.
4. Pick the choices: **Fixed choices** (one per line, `value` or `value=label`), or **Or choices from a data set** with a **Value field**.
5. Pick **Editor in the viewer**: Slider, Number range, Date range, Radio buttons, List box or Switch.

## From the CLI

```bash
pw render reports/loan-statement.pw.json -p accountId=LN-2026-004417 -f pdf -o statement.pdf
pw render orders.pw.json -p region=South -f csv -o orders.csv
```

- `-p name=value`: sets one parameter. Repeat `-p` for each one.
- An unknown name is an error and exits with code 1. The CLI checks parameter names strictly.

## Through the API

Needs an API key. Send a `parameters` object in the body of `POST /api/v1/render`:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"}}' \
  -o statement.pdf
```

Batch items take their own `parameters` (see [batches](batches.md)).

Viewer URL: `/viewer/<id>?accountId=LN-2025-001982&lang=en` sets parameters from the address bar.

## Notes

- A multi-value parameter goes in an `in` filter, for example `{ "expr": "=Fields.region", "op": "in", "value": "=Parameters.regions" }`. An empty list matches nothing.
- A range parameter (editor `range` or `dateRange`) holds two values: `Parameters.x[0]` and `Parameters.x[1]`.
- Cascading: a data set can filter on other parameters (`=Parameters.x`). The viewer reloads the choices when those change.
- Editors: `slider` (min, max, step), `range` and `dateRange` (min, max), `radio`, `list` (with `multi`), `toggle` (true/false). Source: `reports/parameter-editors.pw.json` (`docs/API.md`).
- `"parameterLayout": { "columns": 3 }` on the report puts the parameter panel in a grid above the pages.
- Hidden parameters are set only by URL, API or drill-through.
