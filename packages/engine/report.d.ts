// Types for a Pagewright report definition (pagewright/report@1), the JSON that render() takes.
// Hand-written: the engine is plain JavaScript and the definition is data, so its shape lives here.
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
  border?: string; borderTop?: string; borderRight?: string; borderBottom?: string; borderLeft?: string;
  format?: string;
  writingMode?: string;
  stroke?: string; strokeWidth?: number | string; strokeDash?: string; fill?: string; radius?: number | string;
  [key: string]: unknown;
}

/** What a click does: open a URL, drill to another report, jump to a bookmark, or set parameters and run again. */
export type Action =
  | { type: 'none' }
  | { type: 'url'; url: Expr<string> }
  | { type: 'report'; report: Expr<string>; params?: Record<string, Expr> }
  | { type: 'bookmark'; target: Expr<string> }
  | { type: 'params'; params: Record<string, Expr>; toggle?: boolean };

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
  canGrow?: boolean; canShrink?: boolean; shrinkToFit?: boolean; minFontSize?: number; shrinkStep?: number;
  rotate?: number;
  /** 1–6: listed by a table of contents with source "headings" */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | '1' | '2' | '3' | '4' | '5' | '6';
  dir?: 'ltr' | 'rtl' | 'auto';
}
export interface RichText extends ItemBase { type: 'richtext'; value?: string; htmlFromData?: boolean; canGrow?: boolean; canShrink?: boolean; listIndent?: number; paragraphSpacing?: number }
export interface Image extends ItemBase {
  type: 'image';
  /** URL, data URI, "embedded:name" (the report's images), or a field holding base64 text or bytes */
  src?: Expr<string>;
  fit?: 'contain' | 'cover' | 'fill' | 'clip';
  /** size the box to the image (96 dpi); data and embedded images only */
  autoSize?: boolean;
}
export interface Line extends ItemBase { type: 'line'; direction?: 'down' | 'up' }
export interface Shape extends ItemBase { type: 'shape'; shape?: 'rect' | 'ellipse' }

export interface TableCell { value?: Expr; style?: Style; colSpan?: number; action?: Action; [key: string]: unknown }
export interface TableRow { cells: TableCell[]; height?: number; style?: Style; [key: string]: unknown }
export interface TableGroup { expr: string; header?: TableRow[]; footer?: TableRow[]; sort?: unknown; pageBreak?: string; collapsible?: boolean; initiallyCollapsed?: boolean; [key: string]: unknown }
export interface Table extends ItemBase {
  type: 'table';
  columns: { width: number; [key: string]: unknown }[];
  header?: TableRow[]; groups?: TableGroup[]; detail?: TableRow[]; footer?: TableRow[];
  repeatHeader?: boolean; noRowsText?: string; sortBy?: unknown; filters?: unknown[];
}
export interface Container extends ItemBase { type: 'container'; items: Item[] }
export interface List extends ItemBase { type: 'list'; items: Item[]; groupBy?: Expr<string>; pageBreakBetween?: boolean; sortBy?: unknown; filters?: unknown[] }
export interface CheckBox extends ItemBase { type: 'checkbox'; value?: Expr<boolean>; text?: Expr<string> }
export interface Chart extends ItemBase {
  type: 'chart';
  chartType?: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
  title?: Expr<string>; category?: Expr<string>; categorySort?: 'asc' | 'desc'; categoryFormat?: string;
  series?: { name?: string; value: Expr; color?: string; [key: string]: unknown }[];
  seriesGroup?: Expr<string>; stacked?: boolean; showValues?: boolean; valueFormat?: string; legend?: 'bottom' | 'none';
  xValue?: Expr; pointAction?: Action; pointColor?: Expr<string>; tooltips?: boolean; xTitle?: string; fontSize?: number; background?: string;
  maxCategories?: number;
}
export interface FormField extends ItemBase { type: 'field'; kind?: 'text' | 'multiline' | 'checkbox' | 'choice'; fieldName?: Expr<string>; value?: Expr; options?: Expr; required?: boolean; readOnly?: boolean }
export interface MapItem extends ItemBase {
  type: 'map';
  geojson?: string; geometry?: Expr; shapeKey?: Expr<string>; valueDataSet?: string; valueKey?: Expr<string>; value?: Expr<number>; valueFormat?: string;
  colorLow?: string; colorHigh?: string; legend?: 'bottom' | 'none';
  pointDataSet?: string; lat?: Expr<number>; lon?: Expr<number>; pointSize?: Expr<number>; pointLabel?: Expr<string>; pointColor?: string;
}
export interface Sparkline extends ItemBase { type: 'sparkline'; category?: Expr; value?: Expr<number>; color?: string }
export interface DataBar extends ItemBase { type: 'databar'; value?: Expr<number>; max?: Expr<number>; color?: string }
export interface Bullet extends ItemBase { type: 'bullet'; value?: Expr<number>; max?: Expr<number>; target?: Expr<number>; color?: string }
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
  qrErrorLevel?: 'L' | 'M' | 'Q' | 'H'; qrVersion?: number; qrMask?: number;
  dmShape?: 'square' | 'rectangle'; dmSize?: string;
  pdfColumns?: number; pdfRows?: number; pdfErrorLevel?: number; pdfCompact?: boolean;
  aztecLayers?: number; aztecErrorPercent?: number; maxiMode?: number;
  checkDigit?: boolean; barRatio?: number;
}
export interface Matrix extends ItemBase {
  type: 'matrix';
  rowGroup?: Expr<string>; columnGroup?: Expr<string>; value?: Expr; valueFormat?: string; corner?: string;
  rowSort?: 'asc' | 'desc'; columnSort?: 'asc' | 'desc'; rowTotals?: boolean; columnTotals?: boolean;
  rowHeaderWidth?: number; columnWidth?: number; repeatHeader?: boolean; headerStyle?: Style; cellStyle?: Style; totalStyle?: Style;
}
export interface Subreport extends ItemBase { type: 'subreport'; report: string; params?: Record<string, Expr> }
export interface TableOfContents extends ItemBase {
  type: 'toc';
  title?: string;
  levels?: number;
  /** bookmarks (default) or text boxes with a headingLevel */
  source?: 'bookmarks' | 'headings';
  /** decimal, roman or alpha; one per level as an array or "roman,alpha" (the last repeats) */
  numbering?: string | ('decimal' | 'roman' | 'alpha')[];
}

export type Item = TextBox | RichText | Image | Line | Shape | Table | Container | List | CheckBox | Chart | FormField | MapItem
  | Sparkline | DataBar | Bullet | Barcode | Matrix | Subreport | TableOfContents;
export type ItemType = Item['type'];

export interface Band { height?: number; items: Item[]; printOnFirstPage?: boolean; printOnLastPage?: boolean }

export interface Parameter {
  name: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime';
  prompt?: string;
  default?: unknown;
  required?: boolean;
  multi?: boolean;
  hidden?: boolean;
  options?: (string | number | { value: unknown; label?: string })[];
  optionsFrom?: { dataSet: string; value: string; label?: string };
  editor?: string;
  [key: string]: unknown;
}

export type DataSource =
  | { name: string; type: 'json'; data: unknown }
  | { name: string; type: 'csv'; data?: string; url?: string; [key: string]: unknown }
  | { name: string; type: 'rest' | 'graphql'; url: string; method?: string; headers?: Record<string, string>; query?: string; [key: string]: unknown }
  | { name: string; type: 'sql'; connection: string; query: string; [key: string]: unknown };

export interface DataSet {
  name: string;
  source: string;
  path?: string;
  fields?: { name: string; type?: string; path?: string; expr?: string }[];
  filters?: unknown[];
  sort?: unknown;
  [key: string]: unknown;
}

export interface Report {
  $schema: 'pagewright/report@1';
  name?: string;
  description?: string;
  locale?: string;
  currency?: string;
  page?: {
    size?: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | string | [number, number];
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
  styles?: { base?: Style; named?: Record<string, Style> };
  /** images the report carries, by name, as data:image/… URIs; an image's src "embedded:<name>" uses one */
  images?: Record<string, `data:image/${string}`>;
  sections: { pageHeader?: Band; body: Band; pageFooter?: Band };
}
