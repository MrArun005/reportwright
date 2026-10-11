# Coming from SSRS and Report Builder

ReportWright reads SSRS / Report Builder `.rdl` and `.rdlc` (RDL 2008, 2010 and 2016) and renders them with a JavaScript engine: no SQL Server Reporting Services instance, no Windows host, and the same definition renders in Node and in the browser. The expression language is already SSRS style (`=Fields.amount`, `=Sum(Fields.amount)`, `Globals.PageNumber`), so most expressions read the same after import.

## Migrate, step by step

1. Install the CLI: `npm i -D @reportwright/cli@next @reportwright/fonts@next`
2. Convert: `npx pw import Sales.rdl -o sales.pw.json` (or `.rdlc`). Or use **Import file** on the server home page, or `POST /api/reports/import` with `content-type: application/xml` ([API.md](../API.md#ssrs-import)).
3. Set the connection: SQL Server data sources become `sql` sources but the connection string is not imported; set `PW_DB_<NAME>` on the server ([DATA-SQL.md](../DATA-SQL.md)). Query parameters bind to the report parameter they name.
4. Import subreport and drill-through targets too; they are found by file name.
5. Render: `npx pw render sales.pw.json -f pdf -o sales.pdf`, then open it in the designer.
6. Lock it in with `pw test` (snapshots) and `pw diff`.

## What carries over

From [API.md, SSRS import](../API.md#ssrs-import):

| Area | Carries over |
|---|---|
| Data | SQL Server and other SQL providers (connection string set on the server), shared data source references, "Enter Data" data sets (rows embedded), typed fields, calculated fields, data set filters. Shared data sets, XML, SharePoint and MDX sources: no rows, with a note |
| Parameters | types, prompts, defaults, valid values (lists or cascading data sets), multi-value, nullable, hidden |
| Page | size, margins, page header and footer (first/last page), several report sections |
| Tablix | tables with row groups, nested groups, drill-down toggles, sorting, filters, `RepeatOnNewPage`, `KeepTogether`, page breaks; column groups become matrices |
| Charts | column, bar, line, area, pie, doughnut, funnel, pyramid, scatter, bubble, range, stock, polar, radar; stacked; secondary axis |
| Gauges | **approximated**: radial and linear gauges become a half-circle gauge; state indicators become icon sets |
| Expressions | `Fields!x.Value`, `Parameters!p.Value`, `Globals!PageNumber` / `TotalPages`, scoped aggregates (`Sum(x, "Group")`, `RunningValue`, `RowNumber`, `CountRows`…) |
| Other items | lines, rectangles, images (embedded, external, database), subreports and their parameters |
| Actions | hyperlinks, drill-through with parameters, bookmarks, document map labels |
| **Not supported** | maps (left out with a note), custom report items, RDL 2005 Table/Matrix/List (upgrade in Report Builder first); `<Code>` is kept as text and never run |

Tested on 32 Microsoft sample reports (`tests/fixtures/rdl/corpus`): all import, validate and render; 762 report items, none dropped.

The file is treated as untrusted: no `<!DOCTYPE>` or `<!ENTITY>`, size, nesting and output caps, linear-time parsing.

## Numbers

SSRS itself is not in the benchmark (it needs a Report Server). The numbers below are ReportWright against the engines that are, on the same grouped report, 100 to 100,000 rows. Median time · peak memory, from [`bench/deep/RESULTS.md`](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md) (GitHub runs 37982975209 + 38010821519; ours is engine `perf-startup@13fa2cb34`). Bold is the fastest.

| rows | ReportWright | JasperReports | QuestPDF (.NET) | WeasyPrint |
|---:|---|---|---|---|
| 100 | 584 ms · 154 MB | 2638 ms · 194 MB | **361 ms · 141 MB** | 1215 ms · 84 MB |
| 1,000 | 741 ms · 178 MB | 3370 ms · 196 MB | **562 ms · 156 MB** | 6493 ms · 236 MB |
| 10,000 | **1450 ms · 249 MB** | 6274 ms · 274 MB | 2502 ms · 284 MB | 66.28 s · 1772 MB |
| 100,000 | **8446 ms · 359 MB** | 14.47 s · 699 MB | 19.70 s · 1386 MB | out of memory |

Bulk, 1,000 report files (GitHub run [38114383349](https://github.com/MrArun005/reportwright/actions/runs/38114383349)): ReportWright 124.9 files/s with a worker pool, 92.1 files/s in one process; QuestPDF 38.7; JasperReports 30.0. On 1,000 single-page invoices QuestPDF wins: 163.8 files/s against our 89.2 (pool) and 58.1 (one process).
