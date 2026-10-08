// Types for a ReportWright report definition (pagewright/report@1), the JSON that render() takes.
// GENERATED from src/engine/schema/report.schema.js by scripts/gen-report-types.mjs: do not edit by hand.
// The same schema is published as @reportwright/engine/schema.json, and validate() checks against it.
// Any value marked Expr may be a literal or an expression string starting with "=" (e.g. "=Fields.amount").

/** A literal value or an expression ("=Sum(Fields.amount)"). */
export type Expr<T = string | number | boolean> = T | `=${string}`;
/** Text and box style. Values may also be expressions. Unknown keys are allowed (newer engine versions add more). */
export interface Style {
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: 'normal' | 'bold' | number | string;
  fontStyle?: 'normal' | 'italic' | string;
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundFit?: 'contain' | 'cover' | 'fill' | string;
  textAlign?: 'left' | 'center' | 'right' | 'justify' | 'auto' | string;
  verticalAlign?: 'top' | 'middle' | 'bottom' | string;
  textDecoration?: string;
  lineHeight?: number | string;
  padding?: number | [number, number, number, number] | string;
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  format?: string;
  writingMode?: string;
  stroke?: string;
  strokeWidth?: number | string;
  strokeDash?: string;
  fill?: string;
  radius?: number | string;
  [key: string]: unknown;
}
/** What a click does: open a URL, drill to another report, jump to a bookmark, or set parameters and run again. */
export type Action = {
  type: 'none';
} | {
  type: 'url';
  url: Expr<string>;
} | {
  type: 'report';
  report: Expr<string>;
  params?: Record<string, Expr>;
} | {
  type: 'bookmark';
  target: Expr<string>;
} | {
  type: 'params';
  params: Record<string, Expr>;
  toggle?: boolean;
};
interface ItemBase {
  id?: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style?: Style;
  styleName?: string;
  hidden?: Expr<boolean>;
  dataSet?: string | null;
  /** alternative text for screen readers (accessible PDF, Word, HTML) */
  alt?: string;
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  bookmark?: Expr<string>;
  tooltip?: Expr<string>;
  action?: Action;
}
export interface TextBox extends ItemBase {
  type: 'textbox';
  value?: Expr;
  canGrow?: boolean;
  canShrink?: boolean;
  shrinkToFit?: boolean;
  minFontSize?: number;
  shrinkStep?: number;
  rotate?: number;
  /** 1–6: listed by a table of contents with source "headings" */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | '1' | '2' | '3' | '4' | '5' | '6';
  /** text direction: auto (default) from the first strong character */
  dir?: 'ltr' | 'rtl' | 'auto';
}
export interface RichText extends ItemBase {
  type: 'richtext';
  value?: string;
  htmlFromData?: boolean;
  canGrow?: boolean;
  canShrink?: boolean;
  listIndent?: number;
  paragraphSpacing?: number;
}
export interface Image extends ItemBase {
  type: 'image';
  /** URL, data URI, "embedded:name" (the report's images), or a field holding base64 text or bytes */
  src?: Expr<string>;
  fit?: 'contain' | 'cover' | 'fill' | 'clip';
  /** size the box to the image (96 dpi); data and embedded images only */
  autoSize?: boolean;
}
export interface Line extends ItemBase {
  type: 'line';
  direction?: 'down' | 'up';
}
export interface Shape extends ItemBase {
  type: 'shape';
  shape?: 'rect' | 'ellipse';
}
export interface TableCell {
  value?: Expr;
  style?: Style;
  /** columns this cell spans. Either list one entry per column (null under the span), or omit the spanned cells (RDL/HTML style: a row with fewer cells than columns) */
  colSpan?: number;
  /** merged down over this many rows of the same band (header, a group's rows, one record's detail rows, footer) */
  rowSpan?: number;
  /** an item laid out inside the cell, scoped to the row (a related data set gets that row's children) */
  item?: Item;
  action?: Action;
  [key: string]: unknown;
}
export interface TableRow {
  cells: (TableCell | null)[];
  height?: number;
  style?: Style;
  [key: string]: unknown;
}
export interface TableGroup {
  expr: string;
  name?: string;
  header?: TableRow[];
  footer?: TableRow[];
  sort?: unknown;
  pageBreak?: string;
  collapsible?: boolean;
  initiallyCollapsed?: boolean;
  /** recursive hierarchy: the parent's id; expr is the node's id. Level() is the depth. */
  parent?: Expr;
  indent?: number;
  expandLevels?: number;
  /** each instance starts on a new page and restarts Globals.PageNumber / TotalPages */
  newSection?: boolean;
  [key: string]: unknown;
}
export interface Table extends ItemBase {
  type: 'table';
  columns: {
    width: number;
    [key: string]: unknown;
  }[];
  header?: TableRow[];
  groups?: TableGroup[];
  detail?: TableRow[];
  footer?: TableRow[];
  repeatHeader?: boolean;
  /** Default true: a group of four or more rows never leaves one of its rows alone at a page foot or head, and a group of two or three rows that fits a page moves whole to the next page. false lets a break fall anywhere inside a group. */
  widowControl?: boolean;
  /** Column widths from the content: the header, the first 50 rows and the footer, in proportion, filling the table's width. Columns without a width are measured anyway. */
  fitColumns?: boolean;
  noRowsText?: string;
  sortBy?: unknown;
  filters?: unknown[];
  /** the footer at the bottom of the page the table ends on */
  printAtBottom?: boolean;
  /** wider than the page: continue on the next page set, repeating the first repeatColumns columns */
  overflow?: 'clip' | 'paginate' | 'shrink';
  repeatColumns?: number;
  pageOrder?: 'down' | 'across';
  /** fixed frame: continue rows in */
  overflowTo?: string;
}
export interface Container extends ItemBase {
  type: 'container';
  items: Item[];
}
export interface List extends ItemBase {
  type: 'list';
  items: Item[];
  groupBy?: Expr<string>;
  pageBreakBetween?: boolean;
  sortBy?: unknown;
  filters?: unknown[];
  /** records across (a grid list) */
  columns?: number;
  columnGap?: number;
  newSection?: boolean;
  /** a new group at every change (not sorted) */
  groupAdjacent?: boolean;
  /** rows of the enclosing list row */
  inheritRows?: boolean;
}
export interface CheckBox extends ItemBase {
  type: 'checkbox';
  value?: Expr<boolean>;
  text?: Expr<string>;
}
export interface ChartAxis {
  title?: string;
  format?: string;
  min?: number;
  max?: number;
  log?: boolean;
  gridlines?: boolean;
  /** category axis only: turn the labels, e.g. -45 */
  labelAngle?: number;
  reversed?: boolean;
}
export interface ChartSeries {
  name?: string;
  value?: Expr;
  color?: string;
  /** combo charts: draw this series as columns, a line or an area */
  type?: 'column' | 'bar' | 'line' | 'area';
  axis?: 'primary' | 'secondary';
  /** a range series (low + high), or with open + close a candlestick / OHLC series */
  low?: Expr;
  high?: Expr;
  open?: Expr;
  close?: Expr;
  /** bubble size, per row */
  size?: Expr;
  line?: 'straight' | 'smooth' | 'step';
  [key: string]: unknown;
}
export type ChartOverlay = {
  type: 'trend';
  kind?: 'linear' | 'exp' | 'poly';
  order?: number;
  series?: number;
  color?: string;
  label?: string;
} | {
  type: 'movingAverage';
  period?: number;
  series?: number;
  color?: string;
  label?: string;
} | {
  type: 'line';
  value: number | Expr;
  axis?: 'primary' | 'secondary';
  color?: string;
  label?: string;
  showValue?: boolean;
} | {
  type: 'band';
  from: number | Expr;
  to: number | Expr;
  axis?: 'primary' | 'secondary';
  color?: string;
  label?: string;
};
export type ChartPalette = 'default' | 'office' | 'colorblind' | 'vivid' | 'pastel' | 'ocean' | 'sunset' | 'forest' | 'berry' | 'earth' | 'grayscale' | 'highContrast';
export interface Chart extends ItemBase {
  type: 'chart';
  chartType?: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'bubble' | 'radar' | 'polar' | 'candlestick' | 'ohlc' | 'gauge' | 'funnel' | 'treemap' | 'histogram' | 'boxplot' | 'waterfall' | 'gantt';
  title?: Expr<string>;
  category?: Expr<string>;
  categorySort?: 'asc' | 'desc';
  categoryFormat?: string;
  series?: ChartSeries[];
  seriesGroup?: Expr<string>;
  stacked?: boolean | 'percent';
  showValues?: boolean;
  valueFormat?: string;
  legend?: 'bottom' | 'none';
  xValue?: Expr;
  pointAction?: Action;
  pointColor?: Expr<string>;
  tooltips?: boolean;
  xTitle?: string;
  fontSize?: number;
  background?: string;
  maxCategories?: number;
  /** Scatter and bubble. clip: the axes stop at the 1st and 99th percentiles; points beyond are drawn at the edge with a ring and a warning. none: the full range. Unset: clip when 20 or more points have an extreme spread (full range over 5x the 1st-99th percentile range), else none */
  outliers?: 'clip' | 'none';
  line?: 'straight' | 'smooth' | 'step';
  axes?: {
    x?: ChartAxis;
    y?: ChartAxis;
    y2?: ChartAxis;
  };
  overlays?: ChartOverlay[];
  /** {value} {category} {series} {percent}, or an =expression in the point's scope */
  labelTemplate?: string;
  labelPosition?: 'outside' | 'inside' | 'center';
  palette?: ChartPalette | string[];
  /** opt-in: each category (pie, donut, funnel slices; seriesGroup series) keeps one colour in every chart of the report that sets it; off: colours by position */
  colorByCategory?: boolean;
  /** viewer only; exports stay static */
  animation?: 'none' | 'grow' | 'fade';
  upColor?: string;
  downColor?: string;
  /** number of bins (empty: automatic) */
  binCount?: number;
  /** bin width (instead of a number of bins) */
  binWidth?: number;
  /** mark the mean */
  showMean?: boolean;
  /** subtotal bar when (e.g. =Fields.isTotal) */
  waterfallTotals?: Expr;
  /** total bar at the end */
  showTotal?: boolean;
  /** total bar label */
  totalLabel?: string;
  /** total colour */
  totalColor?: string;
  /** bar start (date or number) */
  ganttStart?: Expr;
  /** bar end (date or number) */
  ganttEnd?: Expr;
  /** today line */
  ganttToday?: boolean;
  /** today line colour */
  todayColor?: string;
  /** gauge shape */
  gaugeShape?: 'half' | 'threeQuarter' | 'full';
  /** value shown by */
  gaugeIndicator?: 'needle' | 'pointer' | 'bar';
  /** needle or pointer colour */
  pointerColor?: string;
  /** tick marks and values */
  gaugeTicks?: boolean;
}
export interface FormField extends ItemBase {
  type: 'field';
  kind?: 'text' | 'multiline' | 'checkbox' | 'choice';
  fieldName?: Expr<string>;
  value?: Expr;
  options?: Expr;
  required?: boolean;
  readOnly?: boolean;
}
export interface MapItem extends ItemBase {
  type: 'map';
  geojson?: string;
  geometry?: Expr;
  shapeKey?: Expr<string>;
  valueDataSet?: string;
  valueKey?: Expr<string>;
  value?: Expr<number>;
  valueFormat?: string;
  colorLow?: string;
  colorHigh?: string;
  legend?: 'bottom' | 'none';
  pointDataSet?: string;
  lat?: Expr<number>;
  lon?: Expr<number>;
  pointSize?: Expr<number>;
  pointLabel?: Expr<string>;
  pointColor?: string;
  /** colour scale */
  colorScale?: 'continuous' | 'classes';
  /** number of classes (2–9) */
  classes?: number;
  /** lines: colour (LineString shapes) */
  lineColor?: string;
  /** lines: width (pt) */
  lineWidth?: number;
  /** click on a region */
  regionAction?: Action;
  /** tooltips on hover */
  tooltips?: boolean;
}
export interface Sparkline extends ItemBase {
  type: 'sparkline';
  category?: Expr;
  value?: Expr<number>;
  color?: string;
  style?: 'line' | 'column' | 'area' | 'winloss';
  bandLow?: Expr<number>;
  bandHigh?: Expr<number>;
  bandColor?: string;
  negColor?: string;
}
export interface DataBar extends ItemBase {
  type: 'databar';
  value?: Expr<number>;
  max?: Expr<number>;
  color?: string;
}
export interface Bullet extends ItemBase {
  type: 'bullet';
  value?: Expr<number>;
  max?: Expr<number>;
  target?: Expr<number>;
  color?: string;
}
export interface IconSet extends ItemBase {
  type: 'iconset';
  value?: Expr<number>;
  iconSet?: 'trafficLights' | 'arrows' | 'symbols' | 'flags' | 'ratings';
  lower?: Expr<number>;
  upper?: Expr<number>;
  /** reverse order (higher is worse) */
  reverse?: boolean;
}
export interface RangeBar extends ItemBase {
  type: 'rangebar';
  low?: Expr<number>;
  high?: Expr<number>;
  min?: Expr<number>;
  max?: Expr<number>;
  color?: string;
}
export interface Barcode extends ItemBase {
  type: 'barcode';
  /** a bwip-js id: code128, qrcode, datamatrix, pdf417, ean13, gs1-128, … */
  symbology?: string;
  value?: Expr<string>;
  showText?: boolean;
  captionPosition?: 'below' | 'above';
  /** points of white around the code */
  quietZone?: number;
  rotate?: 0 | 90 | 180 | 270 | '0' | '90' | '180' | '270';
  qrErrorLevel?: 'L' | 'M' | 'Q' | 'H';
  qrVersion?: number;
  qrMask?: number;
  dmShape?: 'square' | 'rectangle';
  dmSize?: string;
  pdfColumns?: number;
  pdfRows?: number;
  pdfErrorLevel?: number;
  pdfCompact?: boolean;
  aztecLayers?: number;
  aztecErrorPercent?: number;
  maxiMode?: number;
  checkDigit?: boolean;
  barRatio?: number;
}
export interface PivotGroup {
  expr: Expr;
  name?: string;
  label?: Expr<string>;
  format?: string;
  sort?: 'asc' | 'desc' | 'none';
  sortBy?: Expr;
  /** a total of this group's instances inside the group above (the first group's total is the grand total) */
  total?: 'none' | 'before' | 'after';
  totalLabel?: string;
  collapsible?: boolean;
  initiallyCollapsed?: boolean;
  /** row groups: the header column's width and title */
  width?: number;
  header?: string;
  style?: Style;
}
export interface PivotValue {
  value: Expr;
  name?: string;
  label?: string;
  format?: string;
  show?: 'value' | 'percentOfTotal' | 'percentOfRow' | 'percentOfColumn';
  width?: number;
  style?: Style;
}
export interface Matrix extends ItemBase {
  type: 'matrix';
  /** the tablix form: nested row and column groups, several values */
  rowGroups?: PivotGroup[];
  columnGroups?: PivotGroup[];
  values?: PivotValue[];
  overflow?: 'paginate' | 'shrink' | 'clip';
  pageOrder?: 'down' | 'across';
  /** the older single-group form (still read when the arrays are absent) */
  rowGroup?: Expr<string>;
  columnGroup?: Expr<string>;
  value?: Expr;
  valueFormat?: string;
  rowSort?: 'asc' | 'desc' | 'none';
  columnSort?: 'asc' | 'desc' | 'none';
  rowTotals?: boolean;
  columnTotals?: boolean;
  corner?: string;
  rowHeaderWidth?: number;
  columnWidth?: number;
  repeatHeader?: boolean;
  headerStyle?: Style;
  cellStyle?: Style;
  totalStyle?: Style;
}
export interface Subreport extends ItemBase {
  type: 'subreport';
  report: string;
  params?: Record<string, Expr>;
}
export interface TableOfContents extends ItemBase {
  type: 'toc';
  title?: string;
  levels?: number;
  /** bookmarks (default) or text boxes with a headingLevel */
  source?: 'bookmarks' | 'headings';
  /** decimal, roman or alpha; one per level as an array or "roman,alpha" (the last repeats) */
  numbering?: string | ('decimal' | 'roman' | 'alpha')[];
}
export type Item = TextBox | RichText | Image | Line | Shape | Table | Container | List | CheckBox | Chart | FormField | MapItem | Sparkline | DataBar | Bullet | IconSet | RangeBar | Barcode | Matrix | Subreport | TableOfContents;
export type ItemType = Item['type'];
export interface Band {
  height?: number;
  items: Item[];
  printOnFirstPage?: boolean;
  printOnLastPage?: boolean;
  columns?: {
    count: number;
    gap?: number;
  };
}
/** A body section with its own page settings (missing keys come from the report's page). */
export interface BodySection extends Band {
  name?: string;
  page?: Report['page'];
}
export interface Field {
  name: string;
  /** 'string' keeps text as text: an ISO date string in it is not turned into a date */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime';
  path?: string;
  expr?: string;
}
export interface Parameter {
  name: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime';
  prompt?: string;
  default?: unknown;
  required?: boolean;
  multi?: boolean;
  hidden?: boolean;
  options?: (string | number | { value: unknown; label?: string })[];
  optionsFrom?: {
    dataSet: string;
    value: string;
    label?: string;
  };
  editor?: string;
  [key: string]: unknown;
}
export type DataSource = {
  name: string;
  type: 'json';
  data: unknown;
} | {
  name: string;
  type: 'csv';
  data?: string;
  url?: string;
  [key: string]: unknown;
} | {
  name: string;
  type: 'rest' | 'graphql';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  query?: string;
  [key: string]: unknown;
} | {
  name: string;
  type: 'sql';
  connection: string;
  query: string;
  [key: string]: unknown;
};
export interface DataSet {
  name: string;
  source: string;
  path?: string;
  /** false: strings that look like ISO dates stay text (default true: they become dates when fields are detected) */
  detectDates?: boolean;
  /** the fields, typed; none: detected from the rows */
  fields?: Field[];
  filters?: unknown[];
  sort?: unknown;
  [key: string]: unknown;
}
/** A ReportWright report definition (pagewright/report@1).
 * @example
 * {"$schema":"pagewright/report@1","name":"Invoice","page":{"size":"A4","margins":[36,36,36,36]},"dataSources":[{"name":"orders","type":"json","data":{"rows":[{"customer":"Asha Rao","amount":1200.5}]}}],"dataSets":[{"name":"Rows","source":"orders","path":"$.rows"}],"sections":{"body":{"items":[{"type":"textbox","name":"Title","x":0,"y":0,"w":300,"h":24,"value":"Invoice","style":{"fontSize":18,"fontWeight":"bold"}},{"type":"table","name":"Lines","x":0,"y":40,"w":400,"h":40,"dataSet":"Rows","columns":[{"width":250},{"width":150}],"header":[{"height":18,"cells":[{"value":"Customer","colSpan":1},{"value":"Amount"}]}],"detail":[{"height":18,"cells":[{"value":"=Fields.customer"},{"value":"=Fields.amount","style":{"format":"C2"}}]}],"footer":[{"height":18,"cells":[{"value":"Total","colSpan":2}]}]}]}}}
 */
export interface Report {
  /** pagewright/report@1; reportwright/report@1 is the same format under the new name. */
  $schema: 'pagewright/report@1' | 'reportwright/report@1';
  name?: string;
  description?: string;
  locale?: string;
  /** ISO 4217 code for C formats; none: the locale's own currency (en-IN: INR) */
  currency?: string;
  /** how Infinity and NaN (1/0, 0/0) print: as SSRS (default), blank, or #Error */
  nonFinite?: 'blank' | 'error';
  page?: {
    size?: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Pageless' | string | [number, number];
    orientation?: 'portrait' | 'landscape';
    /** top, right, bottom, left in points */
    margins?: [number, number, number, number] | number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  };
  parameters?: Parameter[];
  parameterLayout?: unknown;
  liveParameters?: boolean;
  dataSources?: DataSource[];
  dataSets?: DataSet[];
  styles?: {
    base?: Style;
    named?: Record<string, Style>;
  };
  /** images the report carries, by name, as data:image/… URIs; an image's src "embedded:<name>" uses one */
  images?: Record<string, `data:image/${string}`>;
  sections: {
    pageHeader?: Band;
    body: Band | BodySection[];
    pageFooter?: Band;
  };
}
