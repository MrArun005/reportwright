# Coming from JasperReports

ReportWright is a JavaScript report engine: no JVM, no compile step to `.jasper`, and the same JSON definition renders in Node and in the browser. `pw import` converts your `.jrxml` files.

## Migrate, step by step

1. Install the CLI: `npm i -D @reportwright/cli @reportwright/fonts`
2. Convert: `npx pw import invoice.jrxml -o invoice.pw.json` (JasperReports 3 to 6 `<textField><reportElement/>` designs and the 7.x `<element kind="…">` format). The import prints a note for everything it could not map, and counts of mapped, approximated and dropped elements.
3. Point the data at your rows. Jasper usually receives rows from Java code; in ReportWright a data set reads JSON, CSV, XML, REST, GraphQL, or SQL on the server (`PW_DB_<NAME>`, see [DATA-SQL.md](../DATA-SQL.md)).
4. Render and compare: `npx pw render invoice.pw.json -d main=rows.json -f pdf -o invoice.pdf`
5. Fix what the notes list (typically: fonts not bundled, relative image paths to URLs, `jr:table` components to rebuild as tables), then open the file in the designer.
6. Lock it in: `pw test` snapshots the output, `pw diff` compares two versions of a report.

Concepts side by side (bands, groups, variables, `$F{}` / `$P{}` / `$V{}`) are in [FROM-JASPER.md](../FROM-JASPER.md).

## What carries over

From [API.md, JasperReports import](../API.md#jasperreports-import):

| Area | Carries over |
|---|---|
| Elements | text fields (pattern to format, stretch to can-grow, hyperlinks, anchors, tooltips), static text, images, lines, rectangles, ellipses, frames, subreports with parameters, page breaks, `jr:list`, barcodes (Barbecue, Barcode4J) |
| Charts | pie, bar/column (horizontal, stacked), line, area, XY and time series, scatter, bubble, meter and thermometer, candlestick, high-low, Gantt; 3D drawn flat |
| Expressions | Java and Groovy: `$F{}`, `$P{}`, `$V{}`, string concatenation, arithmetic, comparisons, ternary and `?:`, casts and boxing, common `String`/`Math`/`Date` methods, `msg(…)`, the JasperReports functions (`UPPER`, `IF`, `DATEFORMAT`, `ROUND`…) |
| Crosstabs | become matrices (row and column groups, totals) |
| **Not converted** (noted) | table components, generic elements, multi-axis charts; `instanceof`, `new SimpleDateFormat(…)`, Groovy `${}` strings, `$R{}` resource bundles show as text with a note |

Tested on 49 JasperReports demo samples (`tests/fixtures/jrxml/corpus`): all import, validate and render; 1,492 elements: 1,368 mapped, 121 approximated, 3 dropped.

The file is treated as untrusted: no DTD internal subsets, no external entities, size and nesting caps, and no Java is ever run.

## Numbers

Grouped report, 100 to 10,000 rows. Median time · peak memory, GitHub run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719) (ubuntu-latest, every contestant in the same job; ReportWright is the 1.0 code, `main@944e09eb`). Bold is the fastest.

| rows | ReportWright | JasperReports 6.21 | QuestPDF (.NET) |
|---:|---|---|---|
| 100 | **271 ms · 94 MB** | 2278 ms · 222 MB | 397 ms · 144 MB |
| 1,000 | **399 ms · 118 MB** | 2921 ms · 228 MB | 698 ms · 156 MB |
| 10,000 | **1132 ms · 192 MB** | 5372 ms · 284 MB | 3111 ms · 283 MB |

ReportWright is 4.7× to 8.4× faster than JasperReports on these rows. The 100,000-row rivals were not re-run for 1.0.

Bulk: 1,000 separate grouped-report files of 3 pages (GitHub run [38312325290](https://github.com/MrArun005/reportwright/actions/runs/38312325290), same code):

| | total | files/s | memory |
|---|---:|---:|---:|
| ReportWright, worker pool | 6.29 s | 158.9 | 416 MB |
| ReportWright, one process | 7.78 s | 128.5 | 155 MB |
| QuestPDF | 24.08 s | 41.5 | 168 MB |
| JasperReports | 33.03 s | 30.3 | 216 MB |

The pool trades memory for speed: 416 MB against Jasper's 216 MB. On Jasper's own showcase (a 12 × 4 crosstab over 5,000 rows) ReportWright took 341 ms against Jasper's 962 ms (run [38317309719](https://github.com/MrArun005/reportwright/actions/runs/38317309719); the subreport half of that showcase is not in the case yet).
