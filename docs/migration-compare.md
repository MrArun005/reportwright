# Prove a migrated report matches the original

When you move a report from SSRS, JasperReports or BIRT to ReportWright, `pw compare` checks the new report against a
PDF of the old one, page by page, and writes a page you can hand to the report's owner as evidence.

## 1. Export the original as PDF

Use the same parameters and the same data you will give ReportWright (a fixed date range, a snapshot of the data).

- **SSRS, Report Builder:** open the report, set the parameters, **Run**, then **Export → PDF**. From the web portal:
  run the report, **Export → PDF**. By URL: `https://server/ReportServer?/Folder/Report&rs:Format=PDF&Param=Value`.
- **JasperReports:** Jaspersoft Studio: **Preview**, then the export button → **Export as PDF**. JasperReports Server:
  run the report, **Export → PDF**. In code: `JasperExportManager.exportReportToPdfFile(print, "original.pdf")`.
- **BIRT:** Report Designer: **Run → View Report → As PDF**. The viewer: the **Export Report** button → PDF. The
  runtime: `genReport -f PDF -o original.pdf -p "Param=Value" report.rptdesign`.

Save the data it used as JSON (one array of rows per data source) so ReportWright renders the same rows.

## 2. Import and compare

```bash
npx pw import sales.rdl -o sales.pw.json
npx pw compare original.pdf sales.pw.json -d Sales=sales.json -p Year=2025 -o compare/
open compare/compare.html
```

Or compare two PDFs (the original and a PDF ReportWright made): `npx pw compare original.pdf converted.pdf`.
Install poppler-utils (`pdftotext`, `pdftoppm`) for word positions and the pixel overlay; without them the words are
compared in reading order.

## 3. Read the result

- **Verdict:** Matches, Minor differences (only positions or pixels), or Differences found.
- **Reconciliation** (top): how many numbers were compared and what % match exactly; every total (a label with total,
  sum, grand, subtotal…) on its own; then every other number that differs, with original, converted, delta and %.
  `1,234.50` and `1234.5` are equal; `1,234.504` → `1,234.50` is a rounding difference and is flagged.
- **Differences:** missing, extra, changed and moved words with page and position (points from the top left).
- **Pages:** the original, the converted page and an overlay (changed pixels red over the faded original), with the %
  of pixels that differ; or, without `pdftoppm`, page sketches with the differences boxed.

## 4. In CI

```bash
npx pw compare original.pdf sales.pw.json -d Sales=sales.json --threshold 0.5 -o compare/ || exit 1
```

Exit 1 when a number or a total differs, the page count differs, or the share of differing words or pixels passes
`--threshold` (%). `--numbers-only` gates on the numbers alone (fonts and layout may differ, the figures may not).
Publish `compare/compare.html` as a build artifact. The same check runs on a server: `POST /api/reports/compare`
(see [API.md](API.md#compare-with-the-original-pdf)).
