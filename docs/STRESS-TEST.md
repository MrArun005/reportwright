# Stress test: hard data and a report that uses everything

4 Oct 2026. Two files for testing the designer and the engine against data that is deliberately difficult.

| File | What |
|---|---|
| `src/sample/hard.js` → `GET /api/sample/hard?rows=N` | Seeded, fictional, nasty data. `rows` sets the transaction count (default 3,000, max 200,000). |
| `reports/stress-test.pw.json` | 58 items in 7 sections that use every item type, most functions, every interactivity feature and every awkward value in the data. 88 pages, about 3 s in Node, 5.7 s in the browser worker. |

Open **Stress test (every feature)** from the home page. In the designer every data set shows its row count (Regions 8, FX 4, Branches 41, Accounts 1,574, Transactions 3,000, Wide 60, Messy 14, Unicode 12, Positions 12, Empty 0, Single 1). In the viewer, drag the parameters, click a status bar in section 5, sort columns in section 4.

## What the data contains, on purpose

- **Nulls and empty strings** in names, cities, rates, dates, statuses, references.
- **Six scripts**: Latin with diacritics, Devanagari, Kannada, Tamil, Arabic and Hebrew (right-to-left), CJK; emoji with ZWJ sequences and skin tones; combining marks; ligatures; math and box-drawing symbols.
- **Text that breaks layout**: a 3,400-character note, a 272-character word with no spaces, multi-line text with tabs and Windows line endings, leading and trailing spaces, `<script>` and SQL-injection strings as names.
- **Numbers**: 0, 0.01, 99,999,999.99, negative balances, 1e21, −0, `NaN` (sent as null), numbers as strings (`'720'`), sentinels (`-1`, `'N/A'`).
- **Dates in one column in five formats**: ISO, ISO with time zone, `30/09/2026`, `09/30/2026`, epoch milliseconds, `'not a date'`, null, `''`.
- **Dirty categories**: `Active`, `active`, `ACTIVE`, `' Active '` and null as five different statuses.
- **Group sizes** from 0 (a ghost branch) and 1 (Islands) to 400 (one South branch), with duplicate branch names across regions.
- **Shapes**: nested objects (`kyc.address.pin`), arrays of strings (`tags`), arrays of objects (`collateral`), an array that mixes objects, strings, numbers, nulls and nested arrays (`messy`), deep nesting for JSONPath (`$.portfolio.books[*].positions[*]`), an empty array, a one-row array, a 40-column sparse table.
- **Exchange rates** (`fx`) for `Lookup()` across data sets.

## What the report exercises

1. Aggregates over nulls, zeros and negatives (six tiles).
2. 27 expression edge cases in one table: Trim/Lower on dirty text, Coalesce with nulls, Unicode in Left/Mid/Right, Upper on mixed scripts, Replace/InStr, CInt/CDbl on strings, CDate on a dd/MM date, DateDiff/DateAdd at month ends, Format on negative, tiny and huge numbers, Round at .5, guarded and unguarded division by zero, Join on an array field, nested fields, Lookup into another set, Switch with no match, case-sensitive compare, boolean coercion, an unknown field and an unknown function (both must warn, not crash).
3. Text layout: a 12-row Unicode table, a narrow box with a no-space word, a 6 pt box holding a 3,400-char note, multi-line text, an RTL paragraph right-aligned, canShrink without canGrow, a zero-size box, a box that runs off the right edge of the page.
4. Three-level nested groups (region › branch › status) with subtotals, a scoped share-of-book footer, Lookup into Branches for the branch name, a collapsible level, a 400-row group, running totals scoped to the branch, conditional colour and weight, row striping, a fraud flag that colours the row, interactive sort on six columns, drill-through on the account id, bookmarks per region.
5. A 10-column matrix with totals; five charts: column with click-to-filter over dirty categories, two-series line over mixed date formats, donut over strings + numbers + nulls, scatter with nulls, pie over an empty set; a 40-column table at 4.5 pt.
6. A list of containers, one per branch, each with two check boxes bound to expressions, three barcodes (Code 128 from an id, QR from a possibly-null name, EAN-13 from a non-numeric id, which must show an error), and a nested table filtered by `Parent.id` with its own header and footer.
7. Deep JSONPath through two `[*]`, a one-row set, an empty set (textbox and table), the mixed-shape `messy` array, an image from a URL that does not resolve, an image whose source is an expression returning `''`, a subreport with a parameter from an expression, and a table of contents.

## Findings so far

Fixed in this pass:

- **Calculated fields could not `Lookup()` into another data set**, and the failure stopped the whole report. They were evaluated with an empty data-set context. Now they see every set built before them, and a failing field gives null plus one warning. (`src/engine/data/index.js`, test in `tests/engine/interactive.test.js`.)

Open: engine

- *(Fixed 2026-10-05, 91ee618: the cell shows `#Error` with a warning; `validate()` still lists it.)* **A syntax error in one cell blocks the whole report** at `validate()` ("A string has no closing quote"). Decide: keep failing fast (the designer shows the error) or render `#Error` in that cell with a warning, like unknown fields and functions already do. Leaning towards the second for the viewer and the first for the designer.
- *(Fixed 2026-10-05, def930d.)* **An empty page appears** when an item with `pageBreakBefore` sits a little below the last item that fit on the previous page (page 2 of the stress test is blank). The gap before the forced break is paginated as its own page. Reproduce: a table that ends at y≈580 and a heading at y=600 with `pageBreakBefore: true`.
- **The table of contents renders at the wrong place.** It is the last item in the body (y = 5,490) but appears on page 3, right after the Unicode table. The TOC item seems to be laid out out of order.
- **`Parent.*` is not available in a calculated field after a `[*]` spread.** `$.portfolio.books[*].positions[*]` loses `book`; the calculated field `=Coalesce(Parent.book, 'book?')` gives `book?` for every row, so the group has one bucket. Needed: either carry ancestor objects through `jsonPath` spreads, or support `path` on a field that walks up (`$..book`).
- **An image whose `src` expression returns `''` still draws a (broken) image box** in the SVG viewer. It should draw nothing.
- **An item may start inside the page and end outside it** (x = 500, w = 120 on a 523 pt body). The engine renders it and the text runs past the right edge. The designer should clamp or warn; the engine should warn.
- **`CStr()` of an object gives `[object Object]`.** Prefer JSON text or a warning.
- **`Format(1e21, 'N0')`** prints `1,00,00,00,00,00,00,00,00,00,00,000` (en-IN grouping of a float that has lost precision). Fine for a float, but consider BigInt-safe formatting or a warning above 2^53.

Open: data / designer

- The designer handles 73 items and 11 data sets without lag, but the **Exprs table** shows every expression three times (case, expression, result) and is hard to read at 125 %. A "show results only" toggle would help a tester.
- A table bound to a 1,574-row set with 27 detail rows renders 42,000 rows (1,111 pages) when the author meant 27 rows once. Not a bug, but a **"this table repeats N × M rows" hint** in the designer would save people from the mistake I made.
- With `keepTogether` on a list item whose nested table has 400 rows, each card takes a page and the engine warns once per page (36 pages of "taller than the page"). Correct, but the warning should be one line: "Card for BR-005 is taller than a page (it has 400 rows); keepTogether was ignored."

## How to use it

- **Testing a change to the engine:** `node -e` the render as `tests/` do, or add a case to `tests/engine/interactive.test.js`; the data generator is deterministic, so snapshots are stable.
- **Testing the designer:** open the report, pick any section, change a value, watch the live preview. Try the chart gallery on `Accounts` (dirty categories) and on `Empty`.
- **Testing exports:** every format from the viewer. The PDF must match the page model (`scripts/check-pdf-matches-model.mjs`); Excel must survive the 40-column sheet and the Unicode table.
- **Testing scale:** `/api/sample/hard?rows=200000` and bind a table to `Transactions`.

## Memory per row (0.8, `node --expose-gc scripts/mem-rows.mjs 50000`)

A 50,000-row, 6-column table (1,021 A4 pages), heap held after GC:

| | per row |
|---|---|
| the source rows (JSON) | 0.18 KB |
| page model, `exportData: false` (the default; a view, a PDF) | 2.12 KB |
| page model, `exportData: true` (Excel, CSV, Word, HTML, accessible PDF) | 3.33 KB |

The model is 6.1 text operations per row (one per cell, about 350 bytes each: position, font, clip box, the text).
`exportData` adds 1.2 KB/row of table data, so it stays off unless the format needs it (`needsExportData(format)`;
the pool and the viewer ask only then). The model keeps no reference to the data sets. A disk-backed page store
(pages written out as they are laid out) would cut the remaining 2 KB/row; not done (large change).
