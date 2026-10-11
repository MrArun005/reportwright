# Coming from JasperReports

ReportWright is a JavaScript report engine: no JVM, no compile step to `.jasper`, and the same JSON definition renders in Node and in the browser. `pw import` converts your `.jrxml` files.

## Migrate, step by step

1. Install the CLI: `npm i -D @reportwright/cli@next @reportwright/fonts@next`
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
| **Not converted** (noted) | crosstabs, table components, generic elements, multi-axis charts; `instanceof`, `new SimpleDateFormat(…)`, Groovy `${}` strings, `$R{}` resource bundles show as text with a note |

Tested on 49 JasperReports demo samples (`tests/fixtures/jrxml/corpus`): all import, validate and render; 1,492 elements: 1,368 mapped, 121 approximated, 3 dropped.

The file is treated as untrusted: no DTD internal subsets, no external entities, size and nesting caps, and no Java is ever run.

## Numbers

Grouped report, 100 to 100,000 rows. Median time · peak memory, from [`bench/deep/RESULTS.md`](https://github.com/MrArun005/reportwright/blob/bench-deep/bench/deep/RESULTS.md) (GitHub runs 37982975209 + 38010821519, ubuntu-latest; ours is engine `perf-startup@13fa2cb34`). Bold is the fastest.

| rows | ReportWright | JasperReports | QuestPDF (.NET) |
|---:|---|---|---|
| 100 | 584 ms · 154 MB | 2638 ms · 194 MB | **361 ms · 141 MB** |
| 1,000 | 741 ms · 178 MB | 3370 ms · 196 MB | **562 ms · 156 MB** |
| 10,000 | **1450 ms · 249 MB** | 6274 ms · 274 MB | 2502 ms · 284 MB |
| 100,000 | **8446 ms · 359 MB** | 14.47 s · 699 MB | 19.70 s · 1386 MB |

ReportWright is 1.7× to 4.5× faster than JasperReports on every row. QuestPDF is faster than both up to 1,000 rows.

Bulk: 1,000 separate grouped-report files of 3 pages (GitHub run [38114383349](https://github.com/MrArun005/reportwright/actions/runs/38114383349), engine branch `engine-pdf12@9118d0f93`):

| | total | files/s | memory |
|---|---:|---:|---:|
| ReportWright, worker pool | 8008 ms | 124.9 | 446 MB |
| ReportWright, one process | 10856 ms | 92.1 | 166 MB |
| QuestPDF | 25873 ms | 38.7 | 168 MB |
| JasperReports | 33296 ms | 30.0 | 223 MB |

The pool trades memory for speed: 446 MB against Jasper's 223 MB.
