# Validation and warnings

Find problems in a report before a reader does. A report can run but still warn: a field that does not exist, a text that does not fit, or an item cut off the page. Warnings tell you what to fix. Validation checks the report's definition itself.

## In the UI

Viewer:

1. Open the report in the viewer. If the render has warnings, the viewer shows the count, as "N warning(s)".
2. Open the warnings. Clipped items (cut off by the page edge or a fixed width) are listed there.

Designer: the designer also checks the report as you edit it (`src/designer/issues.js`). The exact place it shows issues is not covered in this guide.

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json -f pdf -o orders.pdf
# pw: wrote orders.pdf (1 pages, streamed, 2 warnings)

pw render orders.pw.json -d orders=orders.json -f txt -o orders.txt
```

- `pw render` prints the number of warnings after it writes the file.
- `-f txt` writes the page text, then a `--- warnings` section with each warning.
- `pw test` fails when the warnings change (`the warnings changed`).

## Through the API

Needs an API key. Each render's warnings come back in the `x-reportwright-warnings` response header. Check it after a render:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"}}' \
  -D headers.txt -o statement.pdf
grep -i x-reportwright-warnings headers.txt
```

The header's format is not given in `docs/API.md`. Read it as text.

## Code

Check a definition before you render it:

```js
import { validate } from '@reportwright/engine';
const { errors, warnings } = validate(def);   // { errors, warnings, exprErrors, checkOnly }
```

## Notes

- Warnings do not stop a render. A missing parameter does: the API answers `400` with `missingParameters`.
- Clipping: an item past the page edge, or a table wider than its page, appears in the model's `clipped` list. The viewer opens its warnings to show it.
- A table wider than the page continues on the next page by default. `overflow: "clip"` or `"shrink"` changes that, and each case warns unless the author chose `"paginate"`.
- Limits in the render (for example 250,000 cells in a pivot) also warn when they cut content.
