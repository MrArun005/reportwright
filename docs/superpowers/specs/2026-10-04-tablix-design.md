# Tablix (pivot table) design — Phase 4

**Roadmap rows:** #14 pivot table (tablix), #15 recursive hierarchies, #16 merged cells / several detail rows / regions in cells, #17 banded and grid lists, #18 wide tables paginate sideways, #19 page numbers per section, #20 multi-section reports. Rows 15–20 share the machinery the tablix needs (row spans, a repeat mechanism at page breaks, column slicing), so they are designed here too.

**Status:** approved for build by the Phase 4 brief (4 Oct 2026). Where the roadmap left a product choice open, this spec takes the ActiveReportsJS (RDL tablix) behaviour and says so.

---

## 1. Goals and non-goals

Goals:
- The `matrix` item becomes a real tablix: nested row and column groups, several values, totals before or after any group, % of total / row / column, expand/collapse on row and column group instances, repeated column headers on every page and repeated row headers on every horizontal page and at vertical breaks inside a merged row header.
- Every existing report renders **byte-identical page models** (positions, text, regions, warnings). Checked by hashing the full model of every report in `reports/` before and after.
- A pivot over 50,000 rows stays inside the current performance envelope (the 50k-row table renders in ~1.6–2 s): linear passes only, no quadratic work on data sizes.
- Hard caps against blow-up: cell counts, leaf columns, group depth.

Non-goals (this phase):
- Recursive row groups inside the matrix (they ship for table groups, which is where ActiveReports users put them: an org chart or chart of accounts is a table with a recursive detail group).
- Arbitrary tablix "static member" trees from the RDL (labels between members, several static rows per member). The importer maps what fits and notes the rest, as today.
- Pixel compares in browsers (the gate stays text + PDF position checks).

## 2. Data model (report JSON)

The item type stays `matrix` (the toolbox, the table gallery and saved reports keep working). New keys are arrays; the old single-group keys still work.

```jsonc
{
  "type": "matrix", "name": "Pivot", "dataSet": "Sales", "x": 0, "y": 0, "w": 520, "h": 60,
  "rowGroups": [
    { "name": "Region", "expr": "=Fields.region", "label": "=Fields.region",   // label: optional, default = the key
      "sort": "asc", "sortBy": "=Sum(Fields.amount)",                        // sort: asc | desc | none; sortBy: optional expression in the instance scope
      "total": "after", "totalLabel": "Total",                               // total: none | before | after (default none)
      "collapsible": true, "initiallyCollapsed": false,
      "width": 90, "header": "Region", "style": { } },                       // width of its header column; header: text over the column; style: its cells
    { "name": "City", "expr": "=Fields.city", "total": "after" }
  ],
  "columnGroups": [
    { "name": "Year", "expr": "=Year(Fields.date)", "total": "after", "collapsible": true },
    { "name": "Quarter", "expr": "=Quarter(Fields.date)", "label": "=\"Q\" & Quarter(Fields.date)" }
  ],
  "values": [
    { "name": "Amount", "label": "₹", "value": "=Sum(Fields.amount)", "format": "N0" },
    { "name": "Share", "label": "% of row", "value": "=Sum(Fields.amount)", "show": "percentOfRow", "format": "P1" }
  ],
  "columnWidth": 64, "rowHeaderWidth": 110, "corner": "Region / city",
  "repeatHeader": true,          // column headers repeat on each page (default true)
  "overflow": "paginate",         // shrink | paginate. Default: paginate for the array form, shrink for the old form
  "pageOrder": "down",            // down (N: all rows of the first column set, then the next set) | across (Z)
  "headerStyle": {}, "cellStyle": {}, "totalStyle": {}
}
```

**Total placement (RDL "Add Total → Before/After").** `total` on group *g* adds, inside each instance of the group above *g* (or once for the whole matrix when *g* is the first group), a row (row groups) or column (column groups) that totals all instances of *g*. So `rowGroups[0].total` is the grand-total row, `rowGroups[1].total` gives one subtotal row per region, and the same for columns.

**Values.** Each value is an aggregate evaluated in the cell's scope (the rows that fall in that row instance and that column instance). With several values each leaf column holds one sub-column per value and the column header gets one more row with the value labels. `show`:
- `value` (default): the value.
- `percentOfTotal`: value ÷ the same expression over every row of the matrix.
- `percentOfRow`: value ÷ the same expression over the row instance (all columns).
- `percentOfColumn`: value ÷ the same expression over the column instance (all rows).
A null or zero denominator gives an empty cell. The format defaults to `P1` for the percentage modes.

**Scopes in value expressions.** `Sum(Fields.x, "Region")` reads the region instance of the cell, `Sum(Fields.x, "Year")` the column instance, `Sum(Fields.x, "<matrix name>")` every row — the RDL rule, so hand-written ratios keep working.

**Expand/collapse (ActiveReports drill-down).** A collapsible instance shows a ▼/▶ toggle in its header cell. A collapsed row instance becomes one row: its header cell spans the inner header columns and its values aggregate the whole instance (the totals of its inner groups are not shown). A collapsed column instance becomes one column (× values) the same way. The state rides in `state.toggles` like table groups, under the keys `"<name>|r<level>|<path>"` and `"<name>|c<level>|<path>"`.

**Old form → new form** (`normalizeMatrix()`, used by the engine, the designer and the importer):
| Old key | New |
|---|---|
| `rowGroup`, `rowSort` | `rowGroups: [{ expr, sort, total: columnTotals !== false ? 'after' : 'none', width: rowHeaderWidth }]` |
| `columnGroup`, `columnSort` | `columnGroups: [{ expr, sort, total: rowTotals !== false ? 'after' : 'none' }]` |
| `value`, `valueFormat` | `values: [{ value, format }]` |
| (no `overflow`) | `overflow: 'shrink'`: the old fit-to-page rule (narrow columns down to 28 pt, then drop the columns that still do not fit, with a warning) |

When an item has any of `rowGroups`, `columnGroups` or `values` as an array, the arrays win and the old keys are ignored. The designer writes the array form on the first structural edit.

## 3. Engine

### 3.1 Pivot build (`src/engine/items/pivot.js`, pure, no layout)

1. Rows of the data set → `related()` (nested data sets) → item filters.
2. **Row tree.** One pass per level: each node's rows are bucketed by the level's key (`groupRows`, a `Map` by key text, insertion order). Children are sorted (`sort` / `sortBy`). Each node records its rows, its key, label, path text and depth. The root is the whole matrix.
3. **Column tree**, the same. Each data row gets the ordinal of its full-depth column leaf (`Int32Array`, indexed by the row's position in the matrix rows).
4. **Visible rows and columns.** A depth-first walk of each tree, honouring collapsed instances and total placement, gives the ordered list of visible row nodes (with their kind: instance, collapsed instance, total of a level) and the same for columns (× values).
5. **Cells.** For each visible row node: its rows are bucketed once by column-leaf ordinal (`Map<ordinal, rows[]>`). A column node with one leaf takes the bucket; a column total (a range of leaves) filters the row node's rows by ordinal range, which keeps the data order (First/Last stay right). Work: O(rows × row depth) for buckets plus O(row-node rows × column totals) for totals — linear in the data for a fixed shape, never rows × rows.
6. Each value is evaluated once per cell with `{ fields: first row, aggRows: cell rows, scopes }`. Percent denominators are computed once per row node, once per column node and once for the matrix, and cached.

**Caps** (each one a warning, never an exception):
- Group depth: 8 row levels and 8 column levels; deeper levels are ignored.
- Leaf columns: 1,000 instances × values (a pivot that wide is a data export, not a page); the rest is cut with a warning that names the count.
- Cells: 250,000 value cells; rows beyond the cap are cut with a warning.
- Labels and keys are data, never templates: they go into cells as raw values (no `=` or `{}` evaluation), as the old matrix did with `lit()`.

### 3.2 Lowering to the table grid

The matrix still lowers to the `table` item's layout, now with explicit rows instead of a detail template (`table.__body`: the already-built rows, each `{ row, ctx, kind, level, toggle }`). The table layout gains, for everyone:
- `cell.rowSpan` (merged cells, #16). A merged cell paints its background and side borders in every row it covers (top border on the first, bottom border on the last), and its text once, in its first row, across the full merged height. If the text needs more height than the rows give, the last covered row grows.
- **Repeated row headers at a vertical break**: the 2nd…nth rows under a merged cell carry `cont` items (the label drawn at that row's top). The page assembler draws a unit's `cont` items only when that unit is the first on its page. This is how a region label that spans 40 rows is shown again at the top of page 2 (ActiveReports repeats the header text of a split member).
- `cell.toggle` (a toggle on any cell, not only the first column).
- `cell.raw` (a value already computed; no expression evaluation) and `cell.ctx` (a cell's own scope, for conditional styles on value cells).

Grid shape for R row levels, C column levels and V values:
- Columns: R header columns (`rowGroups[i].width ?? rowHeaderWidth`), then one per visible column node × V.
- Header rows: C rows of column-group labels (+1 row of value labels when V > 1). An instance label spans its visible leaves × V (`colSpan`). A total column's label sits at its group's row and spans down to the last header row (`rowSpan`). The corner spans the R header columns and every header row, unless a row group has a `header`: then the last header row shows the `header` texts over each row-header column and the corner spans the rows above (when there are any).
- Body rows: an instance row has, for each level whose instance starts on this row, a header cell spanning that instance's visible rows (`rowSpan`). A total row has its label at its level, spanning to the last header column (`colSpan`). A collapsed instance has its label spanning to the last header column.
- Row kinds for data exports: header rows `header`, instance rows `detail` (with `level` = depth, so Excel outlines them), total rows of inner levels `groupFooter` / `groupHeader` (after / before), the grand-total row `footer`.

The **old form** builds exactly the rows the old code built (header row 18 pt in `headerStyle`, detail rows 16 pt in `cellStyle` or a light bottom border, the bold total column, the total row in `totalStyle`), so its page model does not change.

### 3.3 Wide tables: horizontal pagination (#18)

`overflow: 'paginate'` on a table or a matrix whose columns are wider than the body. ActiveReports pages wide tablixes sideways and repeats the row headers; we do the same.

1. Lay out the whole grid once at full width (every row gets one height, the tallest cell across all columns, so the row sets line up on every horizontal page).
2. Split the columns after the repeated ones (the R row-header columns of a matrix, `repeatColumns` of a table, default 0) into column sets that fit `bodyWidth − x − repeated width` (greedy; a column wider than a page gets a set of its own and is clipped, with a warning).
3. Slice each unit's items by column set: an item belongs to the set its left edge falls in; repeated columns are copied into every set; x moves left to close the gap. A merged cell that crosses a set edge is clipped to the set. Cell tags for the Word export are re-indexed to the set's columns.
4. Order:
   - `down` (N, the RDL default): all rows with the first column set, then all rows with the next set (each set starts on a new page and repeats its own header).
   - `across` (Z): the rows are cut into page-high row blocks (greedy by unit height, the column header repeated on top of each block); each block is emitted once per column set, each on its own page. The table starts on a new page in this mode, because the row blocks are measured from a page top.
5. Data exports (Excel, CSV) read the region, which keeps the full width: a spreadsheet does not need page sets.

### 3.4 Recursive hierarchies (#15)

A table group with `parent: "=Fields.managerId"` is recursive (`expr` is the node id). Instances are the distinct ids; a node whose parent id is null, empty, itself, or not found is a root. Order: depth-first, siblings in the group's sort order. Each node emits its group header, the content below it (inner groups or detail), its children (recursively), then its footer. Cycles are broken (a node is visited once) and depth is capped at 64, each with a warning.
- `Level()` / `Level("Group")`: 0-based depth of the current node (0 outside a recursive group, as in RDL).
- `indent: 12` on the group: points added to the first cell's left padding per level.
- `Sum(Fields.x, "Group", "Recursive")`: the node and all its descendants (RDL's `Recursive` keyword; the importer writes it as the string). Without it, a group aggregate is the node's own rows, as in RDL.
- Drill-down by level: `collapsible` hides a node's content and children behind its toggle; `expandLevels: n` starts nodes above level n open and the rest closed (`initiallyCollapsed` alone still closes all).

### 3.5 Several detail rows, merged cells, regions in cells (#16)

- Several detail rows already loop per record; the designer gets "Row below" in detail (it existed) and the importer stops merging them.
- `rowSpan` as in 3.2 inside any one row band (header rows, a group's header rows, the detail rows of one record, the footer rows). A span never crosses from one band into the next.
- `cell.item`: an item (table, list, chart, sparkline, barcode, image, text box…) laid out inside the cell, sized to the cell's inner box, with the row as its scope: `Fields` is the row (or the group's first row), aggregates read the row's scope, and a data set related to the table's data set (`relation`) gets that row's children. The row grows to fit the nested item. A nested region keeps its own rows on the page as one block (it does not split across pages) and stays out of the Excel/CSV regions.

### 3.6 Banded and grid lists (#17)

- `list.columns: n` (+ `columnGap`, default 6 pt): records go left to right, n per row (ActiveReports' grid list); a row of the grid is one unit and keeps together.
- `printAtBottom: true` on a table footer: the footer is drawn at the bottom of the page the table ends on, and what follows the table starts on the next page (ActiveReports' table footer `PrintAtBottom`).
- Orphaned headers: table headers and group headers already keep with the next row; a header row is never the last thing on a page. Tests pin it down; nothing new in the schema.

### 3.7 Page numbers per section (#19)

`newSection: true` on a table group or a list (with or without `groupBy`): each instance starts on a new page and starts a numbering section. In every band, `Globals.PageNumber` / `TotalPages` count inside the section; `Globals.OverallPageNumber` / `OverallTotalPages` count the whole report (RDL names). A section is found from the units that start one: the first page of each such unit (after the first) opens a section.

### 3.8 Multi-section reports (#20)

`sections.body` may be an array: `[{ name, page?, items, columns?, height? }, …]`. Each body section is laid out and paginated with its own page (size, orientation, margins; missing keys come from the report's `page`), and its pages follow the previous section's. The page header and footer are shared and drawn on every page at that page's width. Page numbers continue across sections (a group `newSection` still restarts them). A page whose size differs from the first section's carries its own `width` / `height`; every exporter and the viewer read `page.width ?? model.width`.

## 4. Exporters

| Exporter | Tablix (#14) | Wide tables (#18) | Multi-section (#20) |
|---|---|---|---|
| PDF | page model: lines, rects, text; nothing new | page model | `addPage([w, h])` per page |
| SVG viewer | page model; toggles are links | page model; frozen headers per column set | each page its own size; the scroll windows use cumulative offsets |
| HTML (interactive and static) | page model | page model | each page its own size; print CSS uses the first section's size (browsers allow one `@page` size per named page; noted) |
| Excel | region: header rows, outline levels by row depth, merged header cells (`span`), totals bold | full width, one sheet | — |
| CSV | region rows | full width | — |
| Word | cell tags: `span` and the new `rowSpan` (`w:vMerge`) | each column set is its own table | a section break when the page size changes |

## 5. Designer

- **Matrix inspector** (replaces the single-group fields when the item is a matrix): three lists — *Rows*, *Columns*, *Values* — each entry an expression with a field picker, plus per-entry options: rows/columns: sort, total (none/before/after), collapsible, start collapsed, width (rows); values: label, format, show (value / % of total / % of row / % of column). Add / remove / move up / move down. Matrix-wide: corner text, column width, repeat header, overflow, page order.
- The canvas preview is the engine's layout (already live for matrices), so every edit shows the real pivot with the report's sample data.
- **Table cells:** "Merge down" / split also undo `rowSpan`; the groups editor gains *Parent (recursive)*, *Indent per level*, *Expand levels*, *New section (restart page numbers)*.
- **List:** `columns`, `columnGap` are ordinary item props.
- **Sections:** a section bar above the body: one tab per body section, "Add section" and "Remove"; the selected section's page size, orientation and margins in the section inspector. A single-section report keeps the object form; adding a section converts it to the array form.
- Every new string goes through `t()` and is translated in en, hi, es, fr, de, ja, zh, pt-BR and ar.

## 6. ActiveReportsJS importer

- `Tablix` with column groups → matrix in the **array form**: every dynamic member of the row hierarchy becomes a `rowGroups` entry (outer → inner), every dynamic column member a `columnGroups` entry; a static member next to a dynamic one becomes that group's `total` (before or after by position); each body cell in the dynamic row × dynamic column intersection becomes a value (several value columns when the innermost column member has several static children); `Visibility.ToggleItem` → `collapsible` (+ `initiallyCollapsed` from `Hidden`); `RepeatRowHeaders` → `overflow: 'paginate'`; `LevelSizes` → widths.
- `Group.Parent` → `parent` (recursive table group); `Level()` passes through; `Recursive` in an aggregate → `"Recursive"`.
- Cell `RowSpan` → `rowSpan`.
- `PageBreak.ResetPageNumber` → `newSection`.
- `ReportSections` (several) → `sections.body` array, each with its page.
- What does not fit is a note, as now.

## 7. Performance and memory

- Pivot build is linear for a fixed shape (see 3.1). Measured target: a 2 × 2 group pivot over 50,000 rows (≈ 60 visible rows × 30 columns) under 1 s on one Node process, and the 50k-row table perf unchanged (± 5%).
- No `Array.prototype.includes` / `indexOf` inside the cell loop; sets and ordinals only.
- The caps in 3.1 bound memory by output size, not input size. Recursive trees: depth 64, each node visited once. Horizontal slicing is linear in items.

## 8. Testing

- `tests/engine/tablix.test.js`: nested groups, totals before/after, several values, % modes with hand-computed numbers, collapse (rows and columns), caps, labels never evaluated, old form unchanged.
- `tests/engine/table-p4.test.js`: rowSpan painting and `cont`, cell items, recursive groups + `Level()` + `Recursive`, grid lists, `printAtBottom`, horizontal pagination (down and across), `newSection`, multi-section.
- Exporter tests for Excel spans/outline, Word vMerge and per-page sizes, PDF page sizes.
- `reports/tablix-showcase.pw.json` with a snapshot and hand-checked numbers, also in `scripts/check-pdf-matches-model.mjs`.
- e2e `tests/e2e/tablix.mjs`: build a pivot in the designer, toggle a group in the viewer.
- Model-hash check: every report in `reports/` renders the same page model as `main`.
