# Grouping and drill-down

Group rows by a field (region, then city), show a subtotal for each group, and let the reader open and close groups. Use it for reports with sections, such as sales by region with the cities under each region.

## In the UI

Designer (`/designer/<id>`):

1. Select a table (or a pivot, a matrix).
2. In the **Inspector**, open the group settings and set the group expression (for example `=Fields.region`).
3. Add a footer row for the subtotal, with `=Sum(Fields.amount)` in it.
4. Turn on **Drill-down: show a toggle** for the group. Readers then see a ▼ or ▶ on each group.
5. To order the groups, use **Sort groups**. The field **Sort groups by (empty: the group value)** takes an expression such as `=Sum(Fields.amount)`.

Viewer (`/viewer/<id>`):

1. Click the ▼ or ▶ on a group to close or open it.
2. Totals and page numbers follow the groups that are open.

## From the CLI

Groups and drill-down are part of the report file. `pw render` shows the report as saved, with all groups open.

To render a closed group in a snapshot test, set its toggle state in the test case:

```json
{ "name": "north-closed", "state": { "toggles": { "Pivot|r0|/North": false } } }
```

Run the tests with `pw test reports`. Test case fields are in `packages/cli/README.md`.

## Through the API

Not available as a separate option. A server render runs the saved report with its groups open. Drill state is a viewer action.

## Notes

- A group can repeat its header on each page it continues on, and can keep rows together. Set these in the group's options in the Inspector.
- Table groups support nested groups, subtotals per scope, group sort, and a page break between groups.
- Pivot groups collapse with `collapsible` and `initiallyCollapsed` in the report JSON. A collapsed group is one row with its values.
- Recursive hierarchies use `parent` and `Level()` (Pivot section of `docs/API.md`). Cycles are broken, and depth stops at 64.
- Drill state goes back to the engine, so page count and totals stay correct.
- Drill-through (opening another report) is a different feature. See [subreports-and-drill-through](subreports-and-drill-through.md).
