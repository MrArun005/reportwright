# @reportwright/cli

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fcli)](https://www.npmjs.com/package/@reportwright/cli) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/cli)](https://socket.dev/npm/package/@reportwright/cli) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

`pw`: render, test and diff ReportWright reports from the command line (no server). Fonts come from `@reportwright/fonts`.

```bash
npx -p @reportwright/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @reportwright/cli pw test reports        # snapshot tests for reports-as-code
npx -p @reportwright/cli pw import invoice.jrxml   # JasperReports, SSRS (.rdl) or BIRT → invoice.pw.json
```

## Snapshot tests: `pw test`

`pw test <folder>` renders every `<folder>/__tests__/*.test.json` and compares it with a snapshot beside it. Each test file says which report to render and which cases to run:

```json
{
  "report": "../loan-statement.pw.json",
  "cases": [
    { "name": "home-loan", "parameters": { "accountId": "LN-1" }, "data": { "loans": "loans.data.json" }, "now": "2026-01-01T09:00:00" },
    { "name": "shape", "layout": true }
  ]
}
```

- `report`: the report, relative to the `__tests__` folder.
- `cases[].name`: names the snapshot (`<file>.<name>.snap.txt`). Required.
- `cases[].parameters`: report parameters (`name → value`).
- `cases[].data`: JSON for a data source by name: a file path (relative to `__tests__`) or the JSON itself.
- `cases[].now`: the report's "now" (default `2026-01-01T09:00:00`), so dates in the output do not drift.
- `cases[].state`: drill-down toggles, e.g. `{ "toggles": { "Pivot|r0|/North": false } }`.
- `cases[].layout`: `true` compares this case by layout (see below).

A case without `layout` is compared by its words, page by page: `pw test` passes when the text is the same. A font size, a colour or a column width can change and still pass.

`pw test reports --layout` (or `"layout": true` on a case) compares the layout instead. Each page's snapshot lists every item's box (x, y, w, h in points, rounded to 0.5), a text's font size and colour, a shape's fill, and each table's column widths. Changing any of them fails the test and prints the lines that changed. Snapshots for layout cases are `<file>.<name>.layout.snap.txt`, so a case can be kept in both modes.

`pw test reports --update` writes the new snapshots: the words, or the layout for `--layout` runs and `layout: true` cases. Exit code 1 means a test failed.

The package is the report commands only (render, test, diff, import): no server code, no child processes, and it
reads no environment variables. `pw audit` and `pw migrate-storage` work on a ReportWright server's storage, so they run
from the app folder (`node bin/pw.mjs audit verify`).

MIT.
