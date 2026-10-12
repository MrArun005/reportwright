# Expressions and functions

Calculate values in a report: a total, a date, a label that changes with the data. Every value in the report that starts with `=` is an expression. Use it for totals, formats, conditions and parameters.

## In the UI

Designer (`/designer/<id>`):

1. Select an item and open its value field in the **Inspector**.
2. Type `=` and an expression. The expression editor (CodeMirror) completes names and functions as you type.
3. Open the **Functions** list in the editor to browse functions. Each has a live preview.

## From the CLI

Expressions are part of the report JSON. `pw render` evaluates them:

```bash
pw render orders.pw.json -d orders=orders.json -f pdf -o orders.pdf
```

## Through the API

Expressions are part of the report. `POST /api/v1/render` evaluates them. The API has no separate expression route.

## Notes

Common forms (`docs/FEATURES.md`, `docs/API.md`):

- `=Fields.amount`: a field in the current row.
- `=Parameters.accountId`: a report parameter.
- `=Globals.PageNumber`, `=Globals.TotalPages`, `=Globals.OverallPageNumber`: page numbers.
- `=Sum(Fields.amount)`, `=Avg(...)`, `=Count(...)`, `=Min(...)`, `=Max(...)`, `=Median(...)`, `=StDev(...)`: aggregates. Scope them with a group name: `Sum(Fields.x, "Region")`.
- `=Today()`, `=DateAdd(...)`, `=DatePart(...)`: dates. Times use the report's `timeZone`.
- `=Rank(expr[, scope[, descending]])`: a row's place among the scope's rows. Ties share a rank.
- `=Level()`: depth in a recursive hierarchy.
- `=Theme.Colors.Accent1`: a theme colour.

Behaviour to know:

- `Round` rounds half to even (`Round(2.5)` is 2). `RoundHalfAway` rounds half away from zero (`RoundHalfAway(2.5)` is 3).
- Decimal arithmetic is exact for short decimals: `0.1 + 0.2` is `0.3`.
- `IIf` evaluates only the chosen branch.
- Nothing is 0 in arithmetic and "" next to text.

The full function list is in `docs/FUNCTIONS.md`.
