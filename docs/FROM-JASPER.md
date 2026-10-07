# Coming from JasperReports

ReportWright is a JavaScript report engine: no JVM, no compile step, the same definition renders in Node and in the
browser. A report is JSON (`*.pw.json`) instead of JRXML, and expressions are SSRS/VB style instead of Java.

## Convert a report

```bash
npx -p @reportwright/cli@0.8.0 pw import invoice.jrxml -o invoice.pw.json   # also .rdl (SSRS) and .rptdesign (BIRT)
npx -p @reportwright/cli@0.8.0 pw render invoice.pw.json -d main=rows.json -f pdf -o invoice.pdf
```

The import prints what it could not map (a warning each), and how many elements were mapped, approximated or dropped.
Typical follow-ups: point the data source at your data (Jasper gets rows from Java code), replace relative image paths
with URLs, and rebuild `jr:table` components as ReportWright tables.

## Concepts side by side

| JasperReports | ReportWright |
|---|---|
| JRXML, compiled to `.jasper` | JSON definition, rendered as is (`@reportwright/engine/schema.json`) |
| `JasperFillManager.fillReport(report, params, dataSource)` | `render(def, { parameters, fontStore })`; data in `dataSources` (JSON, CSV, XML, REST, GraphQL, or SQL on the server) |
| `JasperExportManager.exportReportToPdf` | `exportPdf(model, { fonts })`; also `exportXlsx`, `exportDocx`, `exportPptx`, `exportHtml`, `exportCsv` |
| Bands: title, page header, column header, detail, column footer, page footer, summary | `sections.pageHeader` / `body` / `pageFooter`; tables with `header`, `groups`, `detail`, `footer` |
| Groups (`<group>`) | table `groups` with `header`/`footer`, `pageBreak`, `newSection` |
| Subreports | `subreport` items (`report` + `params`) |
| Crosstab | `matrix` (row and column groups, totals) |
| Variables (`$V{total}`, calculation Sum) | aggregates in expressions: `=Sum(Fields.amount)`, `=RunningValue(Fields.x, "Sum")` |
| `$F{amount}`, `$P{id}` | `Fields.amount`, `Parameters.id` |
| `$V{PAGE_NUMBER}` | `Globals.PageNumber`, `Globals.TotalPages` (page header and footer) |
| Java expressions `$F{qty} > 10 ? "bulk" : "single"` | `=IIF(Fields.qty > 10, "bulk", "single")` ([FUNCTIONS.md](FUNCTIONS.md)) |
| Java number patterns `#,##0.00` | the same patterns, or .NET ones (`N2`, `C2`, `P1`); `java:` prefix keeps Java semantics |
| Font extensions | `@reportwright/fonts` (Inter, Noto scripts), `@reportwright/fonts-cjk`, or your own `FontStore` |
| PDF/A, encryption | `exportPdf(model, { pdfa: true })`, `{ encrypt: { userPassword, ownerPassword, permissions } }` |
| JasperReports Server | the self-hosted ReportWright server (this repository, Docker): saved reports, SQL, schedules, users |
| Many reports in parallel (thread pool) | `createPool({ workers })` from `@reportwright/engine/pool` |

Arithmetic follows SSRS (decimal) by default; an imported Jasper report gets `"arithmetic": "double"` and Java's null
ordering and collation, so totals and sort order match what Jasper printed.
