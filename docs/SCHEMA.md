# Report schema reference

GENERATED from `src/engine/schema/report.schema.js` by `node scripts/gen-docs.mjs`; the same schema is published as
`@reportwright/engine/schema.json` and is what `packages/engine/report.d.ts` and `validate()` are made from.
A value of type `Expr` may also be an expression: a string starting with `=` (`"=Sum(Fields.amount)"`).

## Style

Text and box style. Values may also be expressions. Unknown keys are allowed (newer engine versions add more).

| Property | Type | Required | Description |
|---|---|---|---|
| `fontFamily` | string |  |  |
| `fontSize` | number \| string |  |  |
| `fontWeight` | 'normal' \| 'bold' \| number \| string |  |  |
| `fontStyle` | 'normal' \| 'italic' \| string |  |  |
| `color` | string |  |  |
| `backgroundColor` | string |  |  |
| `backgroundImage` | string |  |  |
| `backgroundFit` | 'contain' \| 'cover' \| 'fill' \| string |  |  |
| `textAlign` | 'left' \| 'center' \| 'right' \| 'justify' \| 'auto' \| string |  |  |
| `verticalAlign` | 'top' \| 'middle' \| 'bottom' \| string |  |  |
| `textDecoration` | string |  |  |
| `lineHeight` | number \| string |  |  |
| `padding` | number \| [number, number, number, number] \| string |  |  |
| `border` | string |  |  |
| `borderTop` | string |  |  |
| `borderRight` | string |  |  |
| `borderBottom` | string |  |  |
| `borderLeft` | string |  |  |
| `format` | string |  |  |
| `writingMode` | string |  |  |
| `stroke` | string |  |  |
| `strokeWidth` | number \| string |  |  |
| `strokeDash` | string |  |  |
| `fill` | string |  |  |
| `radius` | number \| string |  |  |

## Action

What a click does: open a URL, drill to another report, jump to a bookmark, or set parameters and run again.

One of: { type }, { type, url }, { type, report, params }, { type, target }, { type, params, toggle }.

## ItemBase

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | string |  |  |
| `name` | string |  |  |
| `x` | number | yes |  |
| `y` | number | yes |  |
| `w` | number | yes |  |
| `h` | number | yes |  |
| `style` | [Style](#style) |  |  |
| `styleName` | string |  |  |
| `hidden` | Expr<boolean> |  |  |
| `dataSet` | string \| null |  |  |
| `alt` | string |  | alternative text for screen readers (accessible PDF, Word, HTML) |
| `keepTogether` | boolean |  |  |
| `pageBreakBefore` | boolean |  |  |
| `pageBreakAfter` | boolean |  |  |
| `bookmark` | Expr<string> |  |  |
| `tooltip` | Expr<string> |  |  |
| `action` | [Action](#action) |  |  |

## TextBox

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "textbox" | yes |  |
| `value` | Expr |  |  |
| `canGrow` | boolean |  |  |
| `canShrink` | boolean |  |  |
| `shrinkToFit` | boolean |  |  |
| `minFontSize` | number |  |  |
| `shrinkStep` | number |  |  |
| `rotate` | number |  |  |
| `headingLevel` | 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| '1' \| '2' \| '3' \| '4' \| '5' \| '6' |  | 1–6: listed by a table of contents with source "headings" |
| `dir` | "ltr" \\| "rtl" \\| "auto" |  | text direction: auto (default) from the first strong character |

## RichText

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "richtext" | yes |  |
| `value` | string |  |  |
| `htmlFromData` | boolean |  |  |
| `canGrow` | boolean |  |  |
| `canShrink` | boolean |  |  |
| `listIndent` | number |  |  |
| `paragraphSpacing` | number |  |  |

## Image

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "image" | yes |  |
| `src` | Expr<string> |  | URL, data URI, "embedded:name" (the report's images), or a field holding base64 text or bytes |
| `fit` | "contain" \\| "cover" \\| "fill" \\| "clip" |  |  |
| `autoSize` | boolean |  | size the box to the image (96 dpi); data and embedded images only |

## Line

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "line" | yes |  |
| `direction` | "down" \\| "up" |  |  |

## Shape

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "shape" | yes |  |
| `shape` | "rect" \\| "ellipse" |  |  |

## TableCell

| Property | Type | Required | Description |
|---|---|---|---|
| `value` | Expr |  |  |
| `style` | [Style](#style) |  |  |
| `colSpan` | number |  | columns this cell spans. Either list one entry per column (null under the span), or omit the spanned cells (RDL/HTML style: a row with fewer cells than columns) |
| `rowSpan` | number |  | merged down over this many rows of the same band (header, a group's rows, one record's detail rows, footer) |
| `item` | [Item](#item) |  | an item laid out inside the cell, scoped to the row (a related data set gets that row's children) |
| `action` | [Action](#action) |  |  |

## TableRow

| Property | Type | Required | Description |
|---|---|---|---|
| `cells` | TableCell \| null[] | yes |  |
| `height` | number |  |  |
| `style` | [Style](#style) |  |  |

## TableGroup

| Property | Type | Required | Description |
|---|---|---|---|
| `expr` | string | yes |  |
| `name` | string |  |  |
| `header` | [TableRow](#tablerow)[] |  |  |
| `footer` | [TableRow](#tablerow)[] |  |  |
| `sort` | any |  |  |
| `pageBreak` | string |  |  |
| `collapsible` | boolean |  |  |
| `initiallyCollapsed` | boolean |  |  |
| `parent` | Expr |  | recursive hierarchy: the parent's id; expr is the node's id. Level() is the depth. |
| `indent` | number |  |  |
| `expandLevels` | number |  |  |
| `newSection` | boolean |  | each instance starts on a new page and restarts Globals.PageNumber / TotalPages |

## Table

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "table" | yes |  |
| `columns` | { width }[] | yes |  |
| `header` | [TableRow](#tablerow)[] |  |  |
| `groups` | [TableGroup](#tablegroup)[] |  |  |
| `detail` | [TableRow](#tablerow)[] |  |  |
| `footer` | [TableRow](#tablerow)[] |  |  |
| `repeatHeader` | boolean |  |  |
| `noRowsText` | string |  |  |
| `sortBy` | any |  |  |
| `filters` | any[] |  |  |
| `printAtBottom` | boolean |  | the footer at the bottom of the page the table ends on |
| `overflow` | "clip" \\| "paginate" \\| "shrink" |  | wider than the page: continue on the next page set, repeating the first repeatColumns columns |
| `repeatColumns` | number |  |  |
| `pageOrder` | "down" \\| "across" |  |  |
| `overflowTo` | string |  | fixed frame: continue rows in |

## Container

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "container" | yes |  |
| `items` | [Item](#item)[] | yes |  |

## List

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "list" | yes |  |
| `items` | [Item](#item)[] | yes |  |
| `groupBy` | Expr<string> |  |  |
| `pageBreakBetween` | boolean |  |  |
| `sortBy` | any |  |  |
| `filters` | any[] |  |  |
| `columns` | number |  | records across (a grid list) |
| `columnGap` | number |  |  |
| `newSection` | boolean |  |  |
| `groupAdjacent` | boolean |  | a new group at every change (not sorted) |
| `inheritRows` | boolean |  | rows of the enclosing list row |

## CheckBox

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "checkbox" | yes |  |
| `value` | Expr<boolean> |  |  |
| `text` | Expr<string> |  |  |

## ChartAxis

| Property | Type | Required | Description |
|---|---|---|---|
| `title` | string |  |  |
| `format` | string |  |  |
| `min` | number |  |  |
| `max` | number |  |  |
| `log` | boolean |  |  |
| `gridlines` | boolean |  |  |
| `labelAngle` | number |  | category axis only: turn the labels, e.g. -45 |
| `reversed` | boolean |  |  |

## ChartSeries

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string |  |  |
| `value` | Expr |  |  |
| `color` | string |  |  |
| `type` | "column" \\| "bar" \\| "line" \\| "area" |  | combo charts: draw this series as columns, a line or an area |
| `axis` | "primary" \\| "secondary" |  |  |
| `low` | Expr |  | a range series (low + high), or with open + close a candlestick / OHLC series |
| `high` | Expr |  |  |
| `open` | Expr |  |  |
| `close` | Expr |  |  |
| `size` | Expr |  | bubble size, per row |
| `line` | "straight" \\| "smooth" \\| "step" |  |  |

## ChartOverlay

One of: { type, kind, order, series, color, label }, { type, period, series, color, label }, { type, value, axis, color, label, showValue }, { type, from, to, axis, color, label }.

## ChartPalette

Type: "default" \| "office" \| "colorblind" \| "vivid" \| "pastel" \| "ocean" \| "sunset" \| "forest" \| "berry" \| "earth" \| "grayscale" \| "highContrast"

## Chart

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "chart" | yes |  |
| `chartType` | "column" \\| "bar" \\| "line" \\| "area" \\| "pie" \\| "donut" \\| "scatter" \\| "bubble" \\| "radar" \\| "polar" \\| "candlestick" \\| "ohlc" \\| "gauge" \\| "funnel" \\| "treemap" \\| "histogram" \\| "boxplot" \\| "waterfall" \\| "gantt" |  |  |
| `title` | Expr<string> |  |  |
| `category` | Expr<string> |  |  |
| `categorySort` | "asc" \\| "desc" |  |  |
| `categoryFormat` | string |  |  |
| `series` | [ChartSeries](#chartseries)[] |  |  |
| `seriesGroup` | Expr<string> |  |  |
| `stacked` | boolean \| 'percent' |  |  |
| `showValues` | boolean |  |  |
| `valueFormat` | string |  |  |
| `legend` | "bottom" \\| "none" |  |  |
| `xValue` | Expr |  |  |
| `pointAction` | [Action](#action) |  |  |
| `pointColor` | Expr<string> |  |  |
| `tooltips` | boolean |  |  |
| `xTitle` | string |  |  |
| `fontSize` | number |  |  |
| `background` | string |  |  |
| `maxCategories` | number |  |  |
| `line` | "straight" \\| "smooth" \\| "step" |  |  |
| `axes` | { x, y, y2 } |  |  |
| `overlays` | [ChartOverlay](#chartoverlay)[] |  |  |
| `labelTemplate` | string |  | {value} {category} {series} {percent}, or an =expression in the point's scope |
| `labelPosition` | "outside" \\| "inside" \\| "center" |  |  |
| `palette` | ChartPalette \| string[] |  |  |
| `colorByCategory` | boolean |  | opt-in: each category (pie, donut, funnel slices; seriesGroup series) keeps one colour in every chart of the report that sets it; off: colours by position |
| `animation` | "none" \\| "grow" \\| "fade" |  | viewer only; exports stay static |
| `upColor` | string |  |  |
| `downColor` | string |  |  |
| `binCount` | number |  | number of bins (empty: automatic) |
| `binWidth` | number |  | bin width (instead of a number of bins) |
| `showMean` | boolean |  | mark the mean |
| `waterfallTotals` | Expr |  | subtotal bar when (e.g. =Fields.isTotal) |
| `showTotal` | boolean |  | total bar at the end |
| `totalLabel` | string |  | total bar label |
| `totalColor` | string |  | total colour |
| `ganttStart` | Expr |  | bar start (date or number) |
| `ganttEnd` | Expr |  | bar end (date or number) |
| `ganttToday` | boolean |  | today line |
| `todayColor` | string |  | today line colour |
| `gaugeShape` | "half" \\| "threeQuarter" \\| "full" |  | gauge shape |
| `gaugeIndicator` | "needle" \\| "pointer" \\| "bar" |  | value shown by |
| `pointerColor` | string |  | needle or pointer colour |
| `gaugeTicks` | boolean |  | tick marks and values |

## FormField

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "field" | yes |  |
| `kind` | "text" \\| "multiline" \\| "checkbox" \\| "choice" |  |  |
| `fieldName` | Expr<string> |  |  |
| `value` | Expr |  |  |
| `options` | Expr |  |  |
| `required` | boolean |  |  |
| `readOnly` | boolean |  |  |

## MapItem

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "map" | yes |  |
| `geojson` | string |  |  |
| `geometry` | Expr |  |  |
| `shapeKey` | Expr<string> |  |  |
| `valueDataSet` | string |  |  |
| `valueKey` | Expr<string> |  |  |
| `value` | Expr<number> |  |  |
| `valueFormat` | string |  |  |
| `colorLow` | string |  |  |
| `colorHigh` | string |  |  |
| `legend` | "bottom" \\| "none" |  |  |
| `pointDataSet` | string |  |  |
| `lat` | Expr<number> |  |  |
| `lon` | Expr<number> |  |  |
| `pointSize` | Expr<number> |  |  |
| `pointLabel` | Expr<string> |  |  |
| `pointColor` | string |  |  |
| `colorScale` | "continuous" \\| "classes" |  | colour scale |
| `classes` | number |  | number of classes (2–9) |
| `lineColor` | string |  | lines: colour (LineString shapes) |
| `lineWidth` | number |  | lines: width (pt) |
| `regionAction` | [Action](#action) |  | click on a region |
| `tooltips` | boolean |  | tooltips on hover |

## Sparkline

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "sparkline" | yes |  |
| `category` | Expr |  |  |
| `value` | Expr<number> |  |  |
| `color` | string |  |  |
| `style` | 'line' \| 'column' \| 'area' \| 'winloss' |  |  |
| `bandLow` | Expr<number> |  |  |
| `bandHigh` | Expr<number> |  |  |
| `bandColor` | string |  |  |
| `negColor` | string |  |  |

## DataBar

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "databar" | yes |  |
| `value` | Expr<number> |  |  |
| `max` | Expr<number> |  |  |
| `color` | string |  |  |

## Bullet

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "bullet" | yes |  |
| `value` | Expr<number> |  |  |
| `max` | Expr<number> |  |  |
| `target` | Expr<number> |  |  |
| `color` | string |  |  |

## IconSet

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "iconset" | yes |  |
| `value` | Expr<number> |  |  |
| `iconSet` | "trafficLights" \\| "arrows" \\| "symbols" \\| "flags" \\| "ratings" |  |  |
| `lower` | Expr<number> |  |  |
| `upper` | Expr<number> |  |  |
| `reverse` | boolean |  | reverse order (higher is worse) |

## RangeBar

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "rangebar" | yes |  |
| `low` | Expr<number> |  |  |
| `high` | Expr<number> |  |  |
| `min` | Expr<number> |  |  |
| `max` | Expr<number> |  |  |
| `color` | string |  |  |

## Barcode

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "barcode" | yes |  |
| `symbology` | string |  | a bwip-js id: code128, qrcode, datamatrix, pdf417, ean13, gs1-128, … |
| `value` | Expr<string> |  |  |
| `showText` | boolean |  |  |
| `captionPosition` | "below" \\| "above" |  |  |
| `quietZone` | number |  | points of white around the code |
| `rotate` | 0 \| 90 \| 180 \| 270 \| '0' \| '90' \| '180' \| '270' |  |  |
| `qrErrorLevel` | "L" \\| "M" \\| "Q" \\| "H" |  |  |
| `qrVersion` | number |  |  |
| `qrMask` | number |  |  |
| `dmShape` | "square" \\| "rectangle" |  |  |
| `dmSize` | string |  |  |
| `pdfColumns` | number |  |  |
| `pdfRows` | number |  |  |
| `pdfErrorLevel` | number |  |  |
| `pdfCompact` | boolean |  |  |
| `aztecLayers` | number |  |  |
| `aztecErrorPercent` | number |  |  |
| `maxiMode` | number |  |  |
| `checkDigit` | boolean |  |  |
| `barRatio` | number |  |  |

## PivotGroup

| Property | Type | Required | Description |
|---|---|---|---|
| `expr` | Expr | yes |  |
| `name` | string |  |  |
| `label` | Expr<string> |  |  |
| `format` | string |  |  |
| `sort` | "asc" \\| "desc" \\| "none" |  |  |
| `sortBy` | Expr |  |  |
| `total` | "none" \\| "before" \\| "after" |  | a total of this group's instances inside the group above (the first group's total is the grand total) |
| `totalLabel` | string |  |  |
| `collapsible` | boolean |  |  |
| `initiallyCollapsed` | boolean |  |  |
| `width` | number |  | row groups: the header column's width and title |
| `header` | string |  |  |
| `style` | [Style](#style) |  |  |

## PivotValue

| Property | Type | Required | Description |
|---|---|---|---|
| `value` | Expr | yes |  |
| `name` | string |  |  |
| `label` | string |  |  |
| `format` | string |  |  |
| `show` | "value" \\| "percentOfTotal" \\| "percentOfRow" \\| "percentOfColumn" |  |  |
| `width` | number |  |  |
| `style` | [Style](#style) |  |  |

## Matrix

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "matrix" | yes |  |
| `rowGroups` | [PivotGroup](#pivotgroup)[] |  | the tablix form: nested row and column groups, several values |
| `columnGroups` | [PivotGroup](#pivotgroup)[] |  |  |
| `values` | [PivotValue](#pivotvalue)[] |  |  |
| `overflow` | "paginate" \\| "shrink" \\| "clip" |  |  |
| `pageOrder` | "down" \\| "across" |  |  |
| `rowGroup` | Expr<string> |  | the older single-group form (still read when the arrays are absent) |
| `columnGroup` | Expr<string> |  |  |
| `value` | Expr |  |  |
| `valueFormat` | string |  |  |
| `rowSort` | "asc" \\| "desc" \\| "none" |  |  |
| `columnSort` | "asc" \\| "desc" \\| "none" |  |  |
| `rowTotals` | boolean |  |  |
| `columnTotals` | boolean |  |  |
| `corner` | string |  |  |
| `rowHeaderWidth` | number |  |  |
| `columnWidth` | number |  |  |
| `repeatHeader` | boolean |  |  |
| `headerStyle` | [Style](#style) |  |  |
| `cellStyle` | [Style](#style) |  |  |
| `totalStyle` | [Style](#style) |  |  |

## Subreport

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "subreport" | yes |  |
| `report` | string | yes |  |
| `params` | Record<string, Expr> |  |  |

## TableOfContents

Also has every property of [ItemBase](#itembase).

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | "toc" | yes |  |
| `title` | string |  |  |
| `levels` | number |  |  |
| `source` | "bookmarks" \\| "headings" |  | bookmarks (default) or text boxes with a headingLevel |
| `numbering` | string \| ('decimal' \| 'roman' \| 'alpha')[] |  | decimal, roman or alpha; one per level as an array or "roman,alpha" (the last repeats) |

## Item

One of: [TextBox](#textbox), [RichText](#richtext), [Image](#image), [Line](#line), [Shape](#shape), [Table](#table), [Container](#container), [List](#list), [CheckBox](#checkbox), [Chart](#chart), [FormField](#formfield), [MapItem](#mapitem), [Sparkline](#sparkline), [DataBar](#databar), [Bullet](#bullet), [IconSet](#iconset), [RangeBar](#rangebar), [Barcode](#barcode), [Matrix](#matrix), [Subreport](#subreport), [TableOfContents](#tableofcontents).

## Band

| Property | Type | Required | Description |
|---|---|---|---|
| `height` | number |  |  |
| `items` | [Item](#item)[] | yes |  |
| `printOnFirstPage` | boolean |  |  |
| `printOnLastPage` | boolean |  |  |
| `columns` | { count, gap } |  |  |

## BodySection

A body section with its own page settings (missing keys come from the report's page).

Also has every property of [Band](#band).

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string |  |  |
| `page` | Report['page'] |  |  |

## Field

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `type` | "string" \\| "number" \\| "integer" \\| "boolean" \\| "date" \\| "datetime" |  | 'string' keeps text as text: an ISO date string in it is not turned into a date |
| `path` | string |  |  |
| `expr` | string |  |  |

## Parameter

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `type` | "string" \\| "number" \\| "integer" \\| "boolean" \\| "date" \\| "datetime" |  |  |
| `prompt` | string |  |  |
| `default` | any |  |  |
| `required` | boolean |  |  |
| `multi` | boolean |  |  |
| `hidden` | boolean |  |  |
| `options` | string \| number \| { value: unknown; label?: string }[] |  |  |
| `optionsFrom` | { dataSet, value, label } |  |  |
| `editor` | string |  |  |

## DataSource

One of: { name, type, data }, { name, type, data, url }, { name, type, url, method, headers, query }, { name, type, connection, query }.

## DataSet

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes |  |
| `source` | string | yes |  |
| `path` | string |  |  |
| `detectDates` | boolean |  | false: strings that look like ISO dates stay text (default true: they become dates when fields are detected) |
| `fields` | [Field](#field)[] |  | the fields, typed; none: detected from the rows |
| `filters` | any[] |  |  |
| `sort` | any |  |  |

## Report

A ReportWright report definition (pagewright/report@1).

| Property | Type | Required | Description |
|---|---|---|---|
| `$schema` | "pagewright/report@1" \\| "reportwright/report@1" | yes | pagewright/report@1; reportwright/report@1 is the same format under the new name. |
| `name` | string |  |  |
| `description` | string |  |  |
| `locale` | string |  |  |
| `currency` | string |  | ISO 4217 code for C formats; none: the locale's own currency (en-IN: INR) |
| `nonFinite` | "blank" \\| "error" |  | how Infinity and NaN (1/0, 0/0) print: as SSRS (default), blank, or #Error |
| `page` | { size, orientation, margins, width, height } |  |  |
| `parameters` | [Parameter](#parameter)[] |  |  |
| `parameterLayout` | any |  |  |
| `liveParameters` | boolean |  |  |
| `dataSources` | [DataSource](#datasource)[] |  |  |
| `dataSets` | [DataSet](#dataset)[] |  |  |
| `styles` | { base, named } |  |  |
| `images` | Record<string, `data:image/${string}`> |  | images the report carries, by name, as data:image/… URIs; an image's src "embedded:<name>" uses one |
| `sections` | { pageHeader, body, pageFooter } | yes |  |
