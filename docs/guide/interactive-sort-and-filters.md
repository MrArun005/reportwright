# Interactive sort and filters

Let readers sort a table by clicking a column header, and filter the rows a data set returns. Use sorting for lists readers scan. Use filters to fix which rows a report shows.

## In the UI

Readers (viewer):

1. Open the report in the viewer.
2. Click a column header in a table that has interactive sort. The table re-sorts. Click again to reverse.

Designer:

1. Select the table. In the **Inspector**, set **Interactive sort: sort by** to the column readers may sort on. The hint says: "Readers click the header to sort."
2. For a data set filter, open the data set. Under **Filters (all must match)**, press **Add filter**. Set **Filter field**, the operator, and **Filter value** (a value, or `=Parameters.x`).
3. For data set sort keys, under **Sort by (first key first, then the next on ties)**, press **Add sort key**. Pick the key and the direction.
4. For one item only, the **Sort and filter (this item only)** dialog on a table, list or chart.

HTML exports can also sort and filter: their table view has **Sort ascending**, **Sort descending** and **Filter**.

## From the CLI

Not available as a separate option. Sort and filter are part of the report definition, and `pw render` applies them.

## Through the API

Not available as a separate option. The API renders the saved report, and its sort and filter rules apply. Filters can be set in a definition sent in the request (`template: { ...definition }`), by a designer.

## Notes

- Filter operators: equals, `in` (multi-value), `TopN`, `BottomN`, `TopPercent`, `BottomPercent`, `Between`. Filters run in order (`docs/FEATURES.md`).
- `TopN` keeps the N highest values, ties included. The `Rank()` function keeps ties at the cut.
- Filter values can be `=Parameters.x`, so the reader's parameter drives the filter.
- A static HTML export cannot sort or filter. The interactive HTML export can (`docs/FEATURES.md`, Export).
- Sorting is case-insensitive by default. Set `caseSensitive: true` on the report or the data set to compare case apart.
