# Coming from SSRS and Report Builder

ReportWright reads SSRS / Report Builder `.rdl` and `.rdlc` (RDL 2008, 2010 and 2016) and renders them with a JavaScript engine: no SQL Server Reporting Services instance, no Windows host, and the same definition renders in Node and in the browser. The expression language is already SSRS style (`=Fields.amount`, `=Sum(Fields.amount)`, `Globals.PageNumber`), so most expressions read the same after import.

## Migrate, step by step

1. Install the CLI: `npm i -D @reportwright/cli @reportwright/fonts`
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
| Maps | map items: embedded shapes, ESRI shapefile layers (the .shp/.dbf in the imported folder), SQL Server spatial data |
| Custom code | simple `<Code>` functions (a `Function` with `ByVal` parameters whose body is one `Return` expression) become report functions; the rest is kept as text with a note, never run |
| **Not supported** | custom report items, RDL 2005 Table/Matrix/List/Chart (upgrade in Report Builder first) |

Tested on 32 Microsoft sample reports (`tests/fixtures/rdl/corpus`): all import, validate and render; 762 report items, none dropped.

The file is treated as untrusted: no `<!DOCTYPE>` or `<!ENTITY>`, size, nesting and output caps, linear-time parsing.

## Numbers

SSRS is measured as the ReportViewer LocalReport control (15.0, the SSRS rendering engine without a Report Server) on a GitHub `windows-latest` runner, same grouped report, both interleaved in one job (GitHub run [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290); ReportWright is the 1.0 code, `main@944e09eb`). Median time · peak memory; bold is the fastest. Not comparable with the Linux tables elsewhere.

| rows | ReportWright | SSRS (LocalReport) |
|---:|---|---|
| 100 | **250 ms · 69 MB** | 1810 ms · 75 MB |
| 1,000 | **394 ms · 86 MB** | 2413 ms · 76 MB |
| 10,000 | **878 ms · 159 MB** | 6521 ms · 95 MB |
| 100,000 | **6347 ms · 279 MB** | 50.12 s · 440 MB |

ReportWright is 6.1× to 7.9× faster; SSRS uses less memory up to 10,000 rows.

On Linux against the other engines (GitHub run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719), ubuntu-latest):

| rows | ReportWright | JasperReports | QuestPDF (.NET) | WeasyPrint |
|---:|---|---|---|---|
| 100 | **271 ms · 94 MB** | 2278 ms · 222 MB | 397 ms · 144 MB | 1424 ms · 84 MB |
| 1,000 | **399 ms · 118 MB** | 2921 ms · 228 MB | 698 ms · 156 MB | 7480 ms · 236 MB |
| 10,000 | **1132 ms · 192 MB** | 5372 ms · 284 MB | 3111 ms · 283 MB | 72.09 s · 1772 MB |

Bulk, 1,000 report files (GitHub run [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290)): ReportWright 158.9 files/s with a worker pool, 128.5 files/s in one process; QuestPDF 41.5; JasperReports 30.3. On 1,000 single-page invoices QuestPDF wins: 162.7 files/s against our 136.8 (pool) and 83.2 (one process).
