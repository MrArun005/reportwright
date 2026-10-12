# @reportwright/cli

`pw`: render, snapshot-test, diff and import ReportWright reports from the command line, with no server.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fcli)](https://www.npmjs.com/package/@reportwright/cli) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/cli)](https://socket.dev/npm/package/@reportwright/cli)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo). [Switch to ReportWright](https://mrarun005.github.io/reportwright-demo/switch.html) runs the same importers as `pw import` in your browser: drop a `.jrxml`, `.rdl` or `.rptdesign` and see what carries over.

The CLI carries [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine); fonts come from [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts).

## Screenshots

`pw render` output, page 1 (reports from the repository's `reports/`):

<img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/sales-by-region.png" alt="Grouped table" width="32%"> <img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/loan-statement.png" alt="Loan statement" width="32%"> <img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/tablix-showcase.png" alt="Pivot tables" width="32%">

## Install

```bash
npm i -D @reportwright/cli @reportwright/fonts     # then: npx pw …
# or one-off, without installing:
npx -p @reportwright/cli pw --version
```

## Quick start (30 seconds)

`orders.pw.json` is the report from the [engine's examples](https://github.com/MrArun005/reportwright/tree/main/packages/engine#examples) (a table of customers and amounts with a
total); `orders.json` is its data:

```json
{ "rows": [{ "customer": "Asha Rao", "amount": 1200.5 }, { "customer": "Ben Ode", "amount": 80 }] }
```

```bash
npx pw render orders.pw.json -d orders=orders.json -f pdf -o orders.pdf
# pw: wrote orders.pdf (1 pages, streamed)
```

`-d orders=orders.json` replaces the data source named `orders` with the file's JSON.

## Examples

Each was run against this version.

**Render to every format.** `-f` is `pdf`, `xlsx`, `docx`, `pptx`, `html`, `csv`, `json` or `txt`; `-o -` writes to stdout.

```bash
npx pw render orders.pw.json -d orders=orders.json -f xlsx -o orders.xlsx
npx pw render orders.pw.json -d orders=orders.json -f csv -o orders.csv      # Customer,Amount / Asha Rao,1200.5 / Ben Ode,80
npx pw render statement.pw.json -p accountId=LN-1 -f pdf -o statement.pdf     # -p sets a report parameter
```

**Archival, accessible or protected PDF.**

```bash
npx pw render orders.pw.json -d orders=orders.json --pdfa --ua -o orders.pdf  # PDF/A-2a + PDF/UA-1
npx pw render orders.pw.json -d orders=orders.json --password s3cret --deny copy -o locked.pdf
```

**Bulk import a folder of legacy reports.** One bad file does not stop the batch; the exit code says how it went.

```bash
npx pw import legacy -o imported --recursive
# pw: finance/Kitchen Sink.rdl → finance/kitchen-sink.pw.json: written, 2 unresolved
# pw: truncated.rdl: FAILED: The file is not readable XML: Text outside the root element (character 27503)
# pw: 1 of 2 reports imported, 1 failed, 2 unresolved references; report: imported/import-report.html
echo $?   # 2: some failed
```

**Snapshot-test reports as code.** With `reports/__tests__/orders.test.json`:

```json
{ "report": "../orders.pw.json", "cases": [{ "name": "two-orders", "data": { "orders": "orders.json" } }] }
```

```bash
npx pw test reports --update   # 1 passed, 0 failed, 1 snapshot written
npx pw test reports            # 1 passed, 0 failed (exit 1 when a case changes)
```

**Diff two versions of a report** (the words, page by page; exit 1 when they differ):

```bash
npx pw diff orders.pw.json orders-v2.pw.json -d orders=orders.json
# orders-v2.pw.json: page 1 changed
# - Orders
# + All orders
```

## Commands and options

| Command | Options |
|---|---|
| `pw render <report.pw.json>` | `-p name=value` (repeat), `-d source=data.json` (repeat), `-f` format (default `pdf`), `-o file\|-`, `--base URL` (where relative data URLs go), `--allow-internal`, `--pdfa`, `--ua`, `--values` (Excel totals as values), `--html tables\|static` (the HTML file; unset: the report's `export.html`, then `PW_HTML_EXPORT`; interactive needs the viewer), `--drill-links inline\|new-tab\|off` (drill-through needs a public `--base`), `--static` (alias of `--html static`), `--layout` (CSV of the printed layout), `--password`, `--owner-password`, `--deny print\|modify\|copy\|annotate\|fillForms\|accessibility\|assemble\|printHighQuality` |
| `pw import <file>` | `-o out.pw.json` |
| `pw assess <folder>` | `-o dir`, `--recursive`, `--usage file`, `--retire-days N` (180), `--hours simple=…,medium=…,complex=…`, `--fail-under pct`, `--max-files N` (500), `--max-bytes N` (8 MB) |
| `pw import <folder>` | `-o outDir`, `--recursive`, `--force`, `--verify`, `--report path`, `--max-files N` (2000), `--max-bytes N` (16 MB) |
| `pw test [folder]` | `--update`, `--layout` |
| `pw diff <old> <new>` | `-p`, `-d`, `--base` |
| `pw --version` | prints the CLI and engine versions |

Exit codes: 0 ok; 1 a test failed or the pages differ; 2 bad usage (`pw import <folder>`: 2 some failed, 1 none imported).

## Supported formats

| Direction | Formats |
|---|---|
| Output (`-f`) | `pdf` (also `--pdfa`, `--ua`, encrypted), `xlsx`, `docx`, `pptx`, `html`, `csv`, `json`, `txt` |
| Import | SSRS `.rdl` / `.rdlc` (+ shared data sources `.rds`), JasperReports `.jrxml` (+ style templates `.jrtx`), BIRT `.rptdesign`, ActiveReports `.rdlx-json`, referenced images |

## Requirements and limits

- Node 20.9 or later. Install `@reportwright/fonts` next to the CLI.
- `pw render -f pdf -o file` streams a flowing table, so memory stays flat on large reports (see the engine's
  [streaming notes](https://github.com/MrArun005/reportwright/tree/main/packages/engine#streaming-pdf-for-large-reports)); other formats render the whole model in memory.
- Bulk import reads at most `--max-files` files (2000) of at most `--max-bytes` each (16 MB). BIRT libraries
  (`.rptlibrary`) are listed but not read.

## Related packages

[`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine) (the same rendering from code), [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts),
[`@reportwright/fonts-cjk`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts-cjk), [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) (view and design in the browser).

## Notes on `pw render`

`pw render -f pdf -o file` streams a flowing table into the file as it is laid out (`exportPdfStream`; the message says
`streamed`), so a large report's memory stays flat; other reports, `--password` and `-o -` render the whole model first.
It writes to a temporary file beside the target and renames it when the export succeeded: a failed run leaves no
damaged PDF, and an older file at the path stays as it was.

## Assess a folder first

`pw assess <folder>` answers "should we migrate, and how much work is it?" without writing a single converted report.
It runs the bulk importer in dry-run mode and writes only `assessment.html` and `assessment.json` (to `-o`, default `.`).

```sh
npx pw assess legacy -o assessment --usage runs.csv --retire-days 180 --hours simple=0.25,medium=2,complex=8 --fail-under 60
```

- The summary leads with "X reports can be retired, Y migrate automatically, Z need work", then the status counts,
  readiness, the effort estimate, the top blockers (grouped, with the reports each affects), the untranslated expressions
  by function, and the server settings to configure (`PW_DB_<NAME>`).
- **Status:** `full` converts as it is; `small` has approximated items, report notes or missing files; `manual` has dropped
  items or untranslated expressions; `failed` does not parse. Configuring data sources and fonts is not a fix.
- **Tiers:** Retire (only with `--usage`: no run in `--retire-days`, default 180); Simple (effort Low); Medium; Complex
  (effort High, or failed). Effort: Low up to 3 issues in a small report, Medium above that; High for manual work with more than 3.
- **Hours:** per report, Simple 0.25 h, Medium 2 h, Complex 8 h, Retire 0 h. Override with `--hours simple=…,medium=…,complex=…`.
  These are planning numbers, not measurements.
- **Usage:** a CSV or JSON table. The SSRS execution log (one row per run) is exported from the report server database with:
  `SELECT ItemPath, TimeStart, UserName, Format, Status FROM ExecutionLog3 WHERE ItemType = 'Report' AND TimeStart >= DATEADD(day, -365, GETDATE())`.
  A generic table has a report name (`name`, `report` or `reportpath`), `runs` and `lastrun` (or `last run date`). Rows
  join to reports by file name without the extension. A report with no row has no runs.
- **Exit codes:** 0 always, or 1 when the readiness is below `--fail-under <pct>`; 2 bad usage.
- Limits: 500 files, 8 MB per file, 256 MB in all (`--max-files`, `--max-bytes`).

## Bulk import

```bash
pw import legacy-reports -o imported --recursive [--force] [--verify] [--report path] [--max-files 2000] [--max-bytes 16777216]
```

`pw import <folder>` imports every SSRS (`.rdl`, `.rdlc`), JasperReports (`.jrxml`), BIRT (`.rptdesign`) and
ActiveReports (`.rdlx-json`) report in the folder (and its subfolders with `--recursive`) into `<outDir>`, which mirrors
the folder. Each report becomes `<its folder>/<report id>.pw.json` (the id is the file name in lower case with dashes,
e.g. `Sales Report.rdl` → `sales-report.pw.json`), because `pw render` and the server find subreports by that id.

- **One bad file never stops the batch.** Its error goes into the report and the rest go on.
  Exit code: **0** every report was imported, **2** some failed, **1** none was imported (or the folder has none).
- **References are resolved across the batch.** These are found among the folder's files: by their path relative to
  the report, else by their file name, nearest first.
  - subreports by their id;
  - SSRS shared data sources (`.rds`, named by a `DataSourceReference`): the provider comes from the `.rds`, but the
    connection string does not (set `PW_DB_<NAME>` on the server, as for any SQL source);
  - JasperReports style templates (`.jrtx`, nested ones too): the report's own style of the same name wins;
  - images named by a relative path: copied next to the report once per content (the same picture referenced from two
    folders is one file) and the report's `src` rewritten to the copy.

  An unresolved reference is listed for its file and does not stop the import. BIRT libraries (`.rptlibrary`) are
  listed, but the BIRT importer does not read them, so their items are missing.
- **The migration report** is `import-report.json` and `import-report.html` in `<outDir>`. With
  `--report file.json` it goes there with the `.html` beside it, and with `--report folder` it goes into that folder.
  For each file it gives the status, the counts of items mapped, approximated and dropped, and every item approximated
  or dropped with the reason. It also lists every expression that was not translated with its item and its line and
  column, and the references with what each resolved to. The rest of the importer's notes are listed under the report.
  Every importer warning is in the report once. The HTML page stands alone and escapes file names and expressions.
  Line and column are where the item's element starts in the XML file. ActiveReports `.rdlx-json` is JSON and gives
  none. A data set's or a filter's expression is reported in that report's notes, not with a line.
- **Edited outputs are kept.** `<outDir>/.pw-import.json` holds the hash of each file as written. On a re-run, a
  target whose hash differs (you edited it, or it was there before and is not from an import) is skipped with a message.
  `--force` overwrites it. Unchanged targets are refreshed, and new ones are written.
- **`--verify`** renders each imported report with its embedded data, or with `<id>.data.json` beside the output
  (`{ "<data source>": [rows] }`). A report with neither is skipped with a note. When the run replaced an earlier output,
  the two are compared with `pw diff`'s comparison (the words, page by page), and the changed lines go into the report.
  Otherwise the check confirms that it renders. A verify makes no network requests.
- **The folder is untrusted.** A report never opens a file by the path it names. Only files found by walking the
  folder are read, so `../` and absolute paths cannot reach outside it. Symbolic links that point out of the folder,
  or to folders, are refused and listed. Every output path is checked to stay in `<outDir>`, and nothing is written
  through a link. `--max-files` and `--max-bytes` cap the file count and each file's size. Nothing in an imported file
  is run: custom code and scriptlets stay text.

`pw --version` (or `-v`) prints the CLI's version and the version of the engine it carries.

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
