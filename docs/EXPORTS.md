# Exports

Every format is written from the laid-out page model (`render()`), in the browser (viewer toolbar) and on the server
(`/api/v1/render`, `pw render`). The viewer's ⚙ **Export options** menu holds the choices below; they are kept in the
browser. JSON is unchanged.

| Format | What you get | Options |
|---|---|---|
| PDF | The exact pages. Subset fonts, links, outline, form fields. | **Accessible PDF (PDF/UA)**, **PDF/A**, passwords (API), signing (API) |
| Word (.docx) | Text and tables as editable Word content; charts, pictures, maps, barcodes, shapes and in-cell visuals as pictures | — |
| PowerPoint (.pptx) | One slide per page: text boxes, shapes and lines native and editable; charts, pictures and barcodes as pictures | — |
| Excel (.xlsx) | One sheet per table, typed cells (full-precision values, dates on the report's clock), number formats, outline, frozen header, **live totals**; **native, editable charts** (a sheet each, bound to their data); a Charts sheet of pictures for the rest | **Live formulas for totals** (on) |
| CSV | The data: one header row and the detail rows of the main table (the one with the most rows), numbers without symbols, ISO dates; no group lines, totals or other tables | The printed layout instead (every table, group lines, totals): `?csv=layout` on the server link, `csv: 'layout'` in `/api/v1/render`, `pw render --layout` |
| HTML | Interactive viewer (default in the viewer), **pages and sortable tables**, or static pages | **HTML file** |

## Pictures in Word, PowerPoint and Excel

The engine tags the items each chart, picture, map, barcode, shape, line and visual draws (`tag: { k, id, alt, h }`,
`src/engine/layout.js`). `src/exporters/figures.js` cuts each one out as an SVG of those items, with its text turned
into glyph outlines (Office has no copy of the report's fonts), and a PNG of it at 2 px per point: a canvas in the
browser, `sharp` in Node (pass `rasterize` to use your own). Word and PowerPoint get the SVG with the PNG as fallback
(`asvg:svgBlip`, Office 2016+); Excel gets the PNG. A picture item keeps its own PNG/JPEG bytes. Sparklines, data bars
and icons that a table cell draws go into that Word cell. The **Alternative text** property (Inspector, Accessibility;
on pictures, charts, maps, barcodes, shapes, lines and visuals) becomes the picture's description.

Word also keeps a text box's background and borders (paragraph shading and borders), cell borders and fills, rounded
shapes (as pictures), text boxes side by side (one row of a borderless layout table), and a box shape under text (the
cell's fill). A new report page starts with "page break before", so a full page gets no blank page after it.

## Excel charts

Column, bar, line, area (clustered, stacked, 100%), pie, doughnut, scatter, bubble and radar charts export as real
Excel charts (DrawingML, `src/exporters/xlsxchart.js`): each gets a sheet with its categories and series at A1 and a
chart bound to that range, with cached values so readers that do not recalculate still draw it. Series of another kind
(a line over columns) and series on the secondary axis make a combination chart with a second value axis. Treemap,
histogram, box plot, waterfall, Gantt, funnel, gauge, polar and stock charts stay pictures (`charts: false` makes every
chart a picture). Checked by opening the file in LibreOffice and converting it to PDF.

## Excel totals

A group footer or table footer cell becomes `SUBTOTAL(fn, rows it covers)` when the value it shows is the sum (9),
count (2, or 3 with text), average (1), minimum (5) or maximum (4) of the detail rows above it, checked to the cell
format's decimals (average, minimum and maximum only when those rows differ). The shown value is cached and the
workbook asks Excel to recalculate on open. Anything else (a ratio, a running value, an expression) stays a value.
`SUBTOTAL` skips the subtotals inside a range, so a grand total never counts a group twice.

## Accessible PDF (PDF/UA-1)

`exportPdf(model, fonts, { tagged: { lang } })`, `?ua=1`, `"ua": true`, `pw render --ua`. Adds, from the page model:

- a structure tree in reading order (the engine's layout order): `H1`–`H6` from a text box's heading level or a
  bookmark at the text, `P`, `L`/`LI`/`Lbl`/`LBody` for rich-text lists, `Table`/`TR`/`TH` (Scope Column)/`TD` with
  ColSpan/RowSpan (one Table across pages, its repeated header an artifact, rows filled to a regular grid),
  `Figure` with Alt and BBox (charts, pictures, maps, barcodes, in-cell visuals inside their TD), `Link` and `Form`
  with their annotations (`Contents`, `TU`);
- marked content for everything drawn: an MCID, or an artifact (page header and footer as Pagination; backgrounds,
  borders and shapes without alt text as Layout);
- `MarkInfo`, `Lang` (the report's locale), `DisplayDocTitle`, `StructParents`, `Tabs /S`, XMP `pdfuaid:part 1`;
- every glyph in ToUnicode (a conjunct's half form maps to U+200D, the run's ActualText has the text), and no
  `.notdef`: a character the font lacks is left out (its width kept).

With **PDF/A** on as well the file is PDF/A-2a + PDF/UA-1. veraPDF's `ua1` and `2a` profiles pass on every sample
report (`tests/engine/export-pdfua.test.js` runs veraPDF when `VERAPDF_BIN` is set). Without the option the PDF is
exactly what it was (same objects, same size and speed).

## HTML: pages and sortable tables

Unless static, an HTML file whose report has tables carries them as JSON plus one inline script, allowed by the file's
own `Content-Security-Policy` (its sha256; `default-src 'none'`, no network, no eval, no inline handlers). A
Pages / Tables bar switches to the tables as HTML: click a column the report sorts interactively to re-sort (detail
rows within their group), ▼/▶ to close or open a group, and pick a value to filter rows. Over 20,000 rows the file is
pages only. If a host blocks the script, the pages still work.

## Table data on demand

The Excel/CSV regions and Word cell tags (about a third of a 50,000-row model's memory) are kept only when a render
asks for them: `render(def, { exportData: true })`. `needsExportData(format, { ua })` (exporters/regions.js, also
exported by @pagewrightjs/engine) says which formats need them: Excel, CSV, Word, PowerPoint, interactive HTML, the
model as JSON and the accessible PDF. The viewer's screen render and a plain PDF go without; an export that needs the
table data renders again with it. CSV, Excel, Word, interactive HTML and the accessible PDF refuse a model rendered
without it (static HTML does not need it). Until 2026-10-05 the default was the other way round (`exportData: false`
left it out).

## Known limits

- Word is a flow document: positions are approximate (paragraphs, inline pictures, layout rows). Page headers and
  footers are body text on each report page, not Word headers. An empty cell's own borders are not seen (the page
  model has no text item for it).
- PowerPoint has one slide size per file (the first page's). Text boxes use the report's font name; without the font
  installed PowerPoint substitutes it. Rich text fragments are separate text boxes.
- Pictures need a rasteriser for their PNG (canvas or `sharp`); without one Word and PowerPoint get the SVG only
  (Office 2016+), and Excel's Charts sheet is left out.
- The accessible PDF's reading order is the layout order; alt text defaults to "Chart", "Picture" … when the report
  gives none (valid, but tell authors to fill it in). In-cell visuals are described as "Chart in a table cell".
- The HTML Tables view sorts and filters the rows the render produced; groups the report had closed have no detail
  rows to open.
