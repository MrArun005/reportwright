# Differential testing against the real engines

Pagewright imports JasperReports (.jrxml) and BIRT (.rptdesign) designs. To stop the "fix one repro, a variant breaks"
cycle, the importers and the engine are compared with **the real JasperReports 7.0.8 and BIRT 4.25** on hundreds of
generated designs, cell by cell.

## Pieces

| File | What it does |
|---|---|
| `tests/diff/gen.mjs` | Seeded generator: 280 JRXML and 265 BIRT designs with data and a locale. Families: aggregates (group nesting, Sum/Count/Average/Lowest/Highest/DistinctCount/First, resetType, incrementType, evaluationTime Now/Report/Group/Auto; BIRT aggregateOn, Total.*, running), expressions (int/double division, casts, Math, strings, null and boolean concatenation, BigDecimal, String.format; BIRT JS, BirtStr/BirtMath, parseInt, toFixed), formats (number and date patterns × en-US, de-DE, en-IN, ar-SA, ja-JP; BIRT categories), sorting (case, digits, nulls), pages (page numbers, page-reset sums, pageBreakInterval), unsorted groups. Every compared value is one line: a label `@<band><n>` and its value. |
| `tests/diff/jvm/DiffJasper.java`, `DiffBirt.java` | One JVM per engine runs the whole batch: PDF, plus the engine's exact strings (Jasper's filled print objects, BIRT's HTML of the same run), because pdftotext cannot read glyphs the PDF font lacks (Arabic-Indic digits, Japanese). Pages and order come from the PDF. |
| `scripts/diff-engines.mjs` | `--capture` records the ground truth in `tests/diff/truth/<engine>.json`; without it, compares Pagewright's import + render and writes the mismatch corpus `tests/diff/mismatches/<engine>.json`. `--pdf` also reads Pagewright's own PDF back (it agreed with the page model in every case checked). Needs `~/pw-bench` (jvm/jasper/lib, jvm/birt/runtime, JDK 23) only for `--capture`. |
| `tests/diff/diff.test.js` | `npm run test:diff`: replays the truth without Java. A ratchet: a case that matched and now differs fails; a corpus case that now matches fails until the corpus is rewritten; a corpus case may not get worse. |

## Results

| | before (R3-A start) | after |
|---|---|---|
| JasperReports 7.0.8 | 251/280 cases differ (89.6%), 2410/8447 cells (28.5%) | 23/280 (8.2%), 50/8447 cells (0.6%) |
| BIRT 4.25 | 238/265 cases differ (89.8%), 2216/8085 cells (27.4%) | 13/265 (4.9%), 29/8085 cells (0.4%) |

Root causes fixed (not per repro): Java/ICU patterns formatted natively (`java:` / `icu:` formats, expr/javafmt.js);
String.valueOf and JavaScript string conversion; null printing; IEEE arithmetic for imports; typed string fields;
JasperReports variable semantics (`JasperValue`); BIRT Total.* scopes, header/footer rows, FIRST/LAST, inner-group
scopes, row heights, pageBreakInterval; null order and collation per engine; groups that break on every change.

Known remaining differences (in the corpus): Jasper page and column footers that sum the rows on their page (no
page totals over data rows in Pagewright); incrementType on a few calculations; BIRT negative infinity printed as
"Infinity" and a few float display edge cases; two BIRT layouts paginate a group header differently.

SSRS cannot run here (no Windows). Its semantics are tested from Microsoft's documentation as properties over
generated variants, labelled "doc-based" (`tests/engine/r3a-ssrs-docs.test.js`, 765 variants).
