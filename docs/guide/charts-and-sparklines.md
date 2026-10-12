# Charts and sparklines

Draw charts (columns, lines, pies, and more) and small trend lines inside a table cell. Use charts for summaries a reader scans. Use sparklines for a trend next to a number.

## In the UI

Designer (`/designer/<id>`):

1. Open the **Insert** menu (the **Insert** group in the toolbar). Drag **Chart** onto the page, or click it to add it to the body.
2. Set the chart type, the data set, the category field and the value series in the chart editor. Set axes, labels and legend in the **Inspector**.
3. For a small trend in a table cell, insert **Sparkline** (line, area, win/loss, range bands).
4. Add a **Data bar** for an in-cell bar.

The chart editors also cover axis min and max, log scale, per-series type (combo charts), a second Y axis, data labels, trend lines and palettes.

## From the CLI

Charts are part of the report. `pw render` draws them:

```bash
pw render reports/charts-showcase.pw.json -f pdf -o charts.pdf
```

Same flags as [render-a-report](render-a-report.md).

## Through the API

Charts are drawn when a report renders. Use the render route:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"}}' \
  -o charts.pdf
```

Use a report whose template has a chart. There is no separate chart route.

## Notes

- Chart types: column, bar, line, area, pie, donut, scatter, bubble, radar, polar, candlestick, OHLC, gauge, funnel, treemap, histogram, box plot, waterfall, Gantt (`docs/FEATURES.md`).
- Limits on untrusted data: 10,000 points or bars, 1,000 categories, 50 series, 500 histogram bins.
- Word export leaves charts out. See [export-formats](export-formats.md).
- Gauges are half-circle only. Imported SSRS gauges are approximated.
- Charts are drawn by the engine, so the viewer, PDF and HTML show the same chart.
