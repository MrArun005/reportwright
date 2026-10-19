// Every message validate() can give, each from the smallest report that gives it, word for word, and the same report
// one step from it that does not (so a changed condition or message fails here). Also the cache and bareSorts.
import { describe, it, expect } from 'vitest';
import {
  validate,
  validateCached,
  bareSorts,
  SCHEMA_ID,
  SCHEMA_ALIAS,
  didYouMean,
} from '../../src/engine/schema/validate.js';

const R = (extra = {}, items = []) => ({
  $schema: SCHEMA_ID,
  name: 'V',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [{ region: 'N', amount: 1 }] } }],
  dataSets: [{ name: 'D', source: 'src', path: '$.rows' }],
  sections: { pageHeader: { height: 20, items: [] }, body: { items }, pageFooter: { height: 20, items: [] } },
  ...extra,
});
const tb = (extra = {}) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: 'x', ...extra });
const errs = (d) => validate(d).errors;
const warns = (d) => validate(d).warnings;

/** [what, the report, the list (errors|warnings), the message, a report that does not give it] */
const CASES = [
  [
    'no $schema',
    () => {
      const d = R();
      delete d.$schema;
      return d;
    },
    'warnings',
    `The report has no "$schema", so an editor cannot check it; add "$schema": "${SCHEMA_ID}" at the top. It renders as before.`,
    () => R(),
  ],
  [
    'an unknown schema',
    () => R({ $schema: 'x/y@1' }),
    'warnings',
    `Unknown schema "x/y@1". Expected "${SCHEMA_ID}".`,
    () => R({ $schema: SCHEMA_ALIAS }),
  ],
  [
    'an unknown report property, a near miss',
    () => R({ dataSet: [] }),
    'warnings',
    'Unknown report property "dataSet" (did you mean "dataSets"?); it is ignored',
    () => R({ _dataSet: [] }),
  ],
  [
    'an unknown report property',
    () => R({ zzzzqq: 1 }),
    'warnings',
    'Unknown report property "zzzzqq"; it is ignored',
    () => R(),
  ],
  [
    'no body',
    () => R({ sections: { pageHeader: { items: [] } } }),
    'errors',
    'The report has no body section',
    () => R(),
  ],
  [
    'an empty body list',
    () => R({ sections: { body: [] } }),
    'errors',
    'The report has no body section',
    () => R({ sections: { body: [{ items: [] }] } }),
  ],
  [
    'an unknown page size, a near miss',
    () => R({ page: { size: 'A44' } }),
    'warnings',
    'Unknown page size "A44" (did you mean "A4"?); the page falls back to A4 unless width and height are set',
    () => R({ page: { size: 'a4' } }),
  ],
  [
    'an unknown page size',
    () => R({ page: { size: 'Huge' } }),
    'warnings',
    'Unknown page size "Huge"; the page falls back to A4 unless width and height are set',
    () => R({ page: { size: 'Letter' } }),
  ],
  [
    'export not an object',
    () => R({ export: 'x' }),
    'warnings',
    '"export" must be an object { html?, drillLinks? }; it is ignored',
    () => R({ export: {} }),
  ],
  [
    'an unknown export property',
    () => R({ export: { pdf: 1 } }),
    'warnings',
    'Unknown export property "pdf" (expected html or drillLinks); it is ignored',
    () => R({ export: { drillLinks: 'off' } }),
  ],
  [
    'an export value off its list',
    () => R({ export: { drillLinks: 'maybe' } }),
    'warnings',
    'export.drillLinks "maybe" is not one of inline, new-tab, off; the server\'s default is used',
    () => R({ export: { drillLinks: 'new-tab' } }),
  ],
  [
    'a body section not an object',
    () => R({ sections: { body: [{ items: [] }, 5] } }),
    'errors',
    'Body section 2 is not an object',
    () => R({ sections: { body: [{ items: [] }, { items: [] }] } }),
  ],
  [
    'a body section page not an object',
    () => R({ sections: { body: [{ items: [], page: 'A5' }] } }),
    'errors',
    'Body section 1: "page" must be an object',
    () => R({ sections: { body: [{ items: [], page: { size: 'A5' } }] } }),
  ],
  [
    'a hidden required parameter without a default',
    () => R({ parameters: [{ name: 'P', type: 'string', hidden: true, required: true }] }),
    'warnings',
    'Parameter "P" is hidden and required but has no default: only a URL, the API or a drill-through can set it',
    () => R({ parameters: [{ name: 'P', type: 'string', hidden: true, required: true, default: 'a' }] }),
  ],
  [
    'hidden required nullable',
    () => R({ parameters: [{ name: 'P', type: 'string', hidden: true, required: true, nullable: true }] }),
    'warnings',
    'Parameter "P" is required and nullable with no default: when no value is given it is null and the report can draw blank; give it a default, or drop "nullable" to require a value',
    () =>
      R({
        parameters: [{ name: 'P', type: 'string', hidden: true, required: true, nullable: true, default: '' + 'x' }],
      }),
  ],
  [
    'required, nullable, multi: fine',
    () => R({ parameters: [{ name: 'P', type: 'string', required: true, nullable: true, multi: true }] }),
    'warnings',
    null,
    null,
  ],
  [
    'nullable false, not required',
    () => R({ parameters: [{ name: 'P', type: 'string', nullable: false }] }),
    'warnings',
    'Parameter "P" is nullable: false but is not required and has no default, so when no value is given it is null; add "required": true or a default',
    () => R({ parameters: [{ name: 'P', type: 'string', nullable: false, required: true }] }),
  ],
  [
    'allowBlank false, not required',
    () => R({ parameters: [{ name: 'P', type: 'string', allowBlank: false }] }),
    'warnings',
    'Parameter "P" is allowBlank: false but is not required and has no default, so when no value is given it is null; add "required": true or a default',
    () => R({ parameters: [{ name: 'P', type: 'string', allowBlank: false, default: 'x' }] }),
  ],
  [
    'a date default not a date',
    () => R({ parameters: [{ name: 'P', type: 'date', default: '31/12/2026' }] }),
    'warnings',
    'Parameter "P": its default "31/12/2026" is not a date; write it as 2026-12-31 (year-month-day)',
    () => R({ parameters: [{ name: 'P', type: 'date', default: '2026-12-31' }] }),
  ],
  [
    'a date default that is an expression: fine',
    () => R({ parameters: [{ name: 'P', type: 'date', default: '=Today()' }] }),
    'warnings',
    null,
    null,
  ],
  [
    'a data source without a name',
    () => R({ dataSources: [{ type: 'json', data: [] }], dataSets: [] }),
    'errors',
    'A data source has no name',
    () => R({ dataSources: [{ name: 's', type: 'json', data: [] }], dataSets: [] }),
  ],
  [
    'two data sources of one name',
    () =>
      R({
        dataSources: [
          { name: 's', type: 'json', data: [] },
          { name: 's', type: 'json', data: [] },
        ],
        dataSets: [],
      }),
    'errors',
    'Two data sources have the name "s"',
    () =>
      R({
        dataSources: [
          { name: 's', type: 'json', data: [] },
          { name: 't', type: 'json', data: [] },
        ],
        dataSets: [],
      }),
  ],
  [
    'a data set without a name',
    () => R({ dataSets: [{ source: 'src' }] }),
    'errors',
    'A data set has no name',
    () => R(),
  ],
  [
    'two data sets of one name',
    () =>
      R({
        dataSets: [
          { name: 'D', source: 'src' },
          { name: 'D', source: 'src' },
        ],
      }),
    'errors',
    'Two data sets have the name "D"',
    () =>
      R({
        dataSets: [
          { name: 'D', source: 'src' },
          { name: 'E', source: 'src' },
        ],
      }),
  ],
  [
    'a data set of a missing source',
    () => R({ dataSets: [{ name: 'D', source: 'nope' }] }),
    'errors',
    'Data set "D" uses the source "nope", which does not exist',
    () => R(),
  ],
  [
    'a nested data set before its parent',
    () =>
      R({
        dataSets: [
          { name: 'C', relation: { parent: 'D', path: '$.x' } },
          { name: 'D', source: 'src' },
        ],
      }),
    'errors',
    'Data set "C": its parent "D" must be a data set declared above it',
    () =>
      R({
        dataSets: [
          { name: 'D', source: 'src' },
          { name: 'C', relation: { parent: 'D', path: '$.x' } },
        ],
      }),
  ],
  [
    'a relation path not text',
    () =>
      R({
        dataSets: [
          { name: 'D', source: 'src' },
          { name: 'C', relation: { parent: 'D', path: 5 } },
        ],
      }),
    'errors',
    'Data set "C": the relation path must be text, e.g. $.items[*]',
    () =>
      R({
        dataSets: [
          { name: 'D', source: 'src' },
          { name: 'C', relation: { parent: 'D' } },
        ],
      }),
  ],
  [
    'a sort entry without by',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ dir: 'asc' }] }] }),
    'warnings',
    'Data set "D", sort 1: a sort entry is {by, dir}, e.g. {"by": "=Fields.Name", "dir": "asc"}; this one has no "by" and is ignored',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region' }] }] }),
  ],
  [
    'a sort by a field name',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: 'Region' }] }] }),
    'warnings',
    'Data set "D", sort 1: "by" is "Region", the name of a field; it sorts by that field (did you mean "=Fields.region"?)',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region' }] }] }),
  ],
  [
    'a sort by a near miss',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: 'regoin' }] }] }),
    'warnings',
    'Data set "D", sort 1: "by" is the constant "regoin", so the rows are not sorted; (did you mean "=Fields.region"?)',
    () => R(),
  ],
  [
    'a sort with another key',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region', order: 'desc' }] }] }),
    'warnings',
    'Data set "D", sort 1: "order" is ignored; a sort entry is {by, dir} (did you mean "dir"?)',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region', _order: 1 }] }] }),
  ],
  [
    'a sort dir off its list',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region', dir: 'up' }] }] }),
    'warnings',
    'Data set "D", sort 1: "dir" is "up"; expected "asc" or "desc"',
    () => R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region', dir: 'desc' }] }] }),
  ],
  [
    'a filter key that is not one',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ field: '=Fields.region', op: '=', value: 'N' }] }] }),
    'warnings',
    'Data set "D", filter 1: "field" is ignored; a filter is {expr, op, value, value2, skipBlank} (did you mean "expr"?)',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.region', op: '=', value: 'N' }] }] }),
  ],
  [
    'a filter without expr',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ op: '=', value: 'N' }] }] }),
    'errors',
    "Data set \"D\", filter 1 has no expr; a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }",
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.region', value: 'N' }] }] }),
  ],
  [
    'a filter with neither op nor value',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.region = "N"' }] }] }),
    'errors',
    "Data set \"D\", filter 1 has no op; a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }",
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.region', op: '=', value: 'N' }] }] }),
  ],
  [
    'an unknown filter op',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.region', op: '==', value: 'N' }] }] }),
    'errors',
    'Data set "D", filter 1: the op "==" is not a filter operator (= <> > >= < <= in like contains between Between TopN BottomN TopPercent BottomPercent); a filter is {expr, op, value}, e.g. { expr: \'=Fields.a\', op: \'>=\', value: 2 }',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.amount', op: 'topn', value: 2 }] }] }),
  ],
  [
    'a filter op without value',
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.amount', op: '>' }] }] }),
    'errors',
    "Data set \"D\", filter 1 (>) has no value; a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }",
    () => R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.amount', op: '>', value: 0 }] }] }),
  ],
  [
    'a Between without an upper bound',
    () =>
      R({ dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.amount', op: 'Between', value: 1 }] }] }),
    'errors',
    "Data set \"D\", filter 1 (Between) has no value2, the upper bound (or give value as [low, high]); a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }",
    () =>
      R({
        dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fields.amount', op: 'between', value: [1, 2] }] }],
      }),
  ],
  [
    'an unknown item type',
    () => R({}, [{ type: 'gizmo', name: 'G', x: 0, y: 0, w: 1, h: 1 }]),
    'warnings',
    'Unknown item type "gizmo"',
    () => R({}, [tb()]),
  ],
  [
    'two items of one name',
    () => R({}, [tb(), tb({ y: 30 })]),
    'warnings',
    'Two items have the name "T"',
    () => R({}, [tb(), tb({ name: 'U', y: 30 })]),
  ],
  [
    'a coordinate not a number',
    () => R({}, [tb({ x: '0' })]),
    'errors',
    'T: "x" must be a number',
    () => R({}, [tb()]),
  ],
  ['NaN height', () => R({}, [tb({ h: NaN })]), 'errors', 'T: "h" must be a number', () => R({}, [tb()])],
  [
    'a link-coloured text with no action',
    () => R({}, [tb({ style: { textDecoration: 'underline', color: '#2563eb' } })]),
    'warnings',
    'T: its text looks like a link (underlined, in a link colour) but it has no action; give it one (Action) or a plain style',
    () =>
      R({}, [
        tb({
          style: { textDecoration: 'underline', color: '#2563eb' },
          action: { type: 'url', url: 'https://x.test' },
        }),
      ]),
  ],
  [
    'underlined but not blue',
    () => R({}, [tb({ style: { textDecoration: 'underline', color: '#dc2626' } })]),
    'warnings',
    null,
    null,
  ],
  [
    'an unknown style property',
    () => R({}, [tb({ style: { fontWieght: 'bold' } })]),
    'warnings',
    'T: unknown style property "fontWieght" (did you mean "fontWeight"?); it is ignored',
    () => R({}, [tb({ style: { fontWeight: 'bold' } })]),
  ],
  [
    'a colour name not drawn',
    () => R({}, [tb({ style: { color: 'purpel' } })]),
    'warnings',
    'T: "purpel" is not a colour name the report can draw; use a name such as "red" or a hex colour such as "#dc2626"',
    () => R({}, [tb({ style: { color: 'Red' } })]),
  ],
  [
    'a colour name near one',
    () => R({}, [tb({ style: { backgroundColor: 'grren' } })]),
    'warnings',
    'T: "grren" is not a colour name the report can draw (did you mean "green"?); use a name such as "red" or a hex colour such as "#dc2626"',
    () => R({}, [tb({ style: { backgroundColor: 'transparent' } })]),
  ],
  [
    'a format with a stray letter',
    () => R({}, [tb({ style: { format: 'N2x' } })]),
    'warnings',
    'T: the format "N2x" is not a format code (did you mean "N2"?)',
    () => R({}, [tb({ style: { format: 'N2' } })]),
  ],
  [
    'an item format with a stray letter',
    () => R({}, [tb({ format: 'C0k' })]),
    'warnings',
    'T: the format "C0k" is not a format code (did you mean "C0"?)',
    () => R({}, [tb({ format: '#,##0' })]),
  ],
  [
    'a named style missing',
    () => R({ styles: { named: { Head: {} } } }, [tb({ styleName: 'Haed' })]),
    'warnings',
    'T: there is no named style "Haed" (did you mean "Head"?); it is ignored',
    () => R({ styles: { named: { Head: {} } } }, [tb({ styleName: 'Head' })]),
  ],
  [
    'a named style with a stylesheet: not judged',
    () => R({ styles: { sheet: 'x' } }, [tb({ styleName: 'Nope' })]),
    'warnings',
    null,
    null,
  ],
  [
    'a style in a named style',
    () => R({ styles: { named: { Head: { color: 'blu' } } } }),
    'warnings',
    'Named style "Head": "blu" is not a colour name the report can draw (did you mean "blue"?); use a name such as "red" or a hex colour such as "#dc2626"',
    () => R({ styles: { named: { Head: { color: 'blue' } } } }),
  ],
  [
    'the base style',
    () => R({ styles: { base: { fontSzie: 9 } } }),
    'warnings',
    'Base style: unknown style property "fontSzie" (did you mean "fontSize"?); it is ignored',
    () => R({ styles: { base: { fontSize: 9 } } }),
  ],
  [
    'a group on a field name',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 18,
          columns: [{ width: 100 }],
          groups: [{ expr: 'region' }],
          detail: [{ height: 18, cells: [{ value: 'x' }] }],
        },
      ]),
    'warnings',
    'Tab, group 1: "expr" is "region", the name of a field, so every row is in one group; did you mean "=Fields.region"?',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 18,
          columns: [{ width: 100 }],
          groups: [{ expr: '=Fields.region' }],
          detail: [{ height: 18, cells: [{ value: 'x' }] }],
        },
      ]),
  ],
  [
    'a matrix row group on a field name',
    () =>
      R({}, [{ type: 'matrix', name: 'M', dataSet: 'D', x: 0, y: 0, w: 100, h: 18, rowGroups: [{ expr: 'region' }] }]),
    'warnings',
    'M rowGroups 1: "expr" is "region", the name of a field, so every row is in one group; did you mean "=Fields.region"?',
    () =>
      R({}, [
        { type: 'matrix', name: 'M', dataSet: 'D', x: 0, y: 0, w: 100, h: 18, rowGroups: [{ expr: '=Fields.region' }] },
      ]),
  ],
  [
    'a chart legend off its list',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'bar',
          series: [{ value: '=Sum(Fields.amount)' }],
          legend: 'right',
        },
      ]),
    'warnings',
    'C: "legend" is "right"; only "bottom" (show the legend) or "none" (hide it) is supported, and the legend is drawn at the bottom',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'bar',
          series: [{ value: '=Sum(Fields.amount)' }],
          legend: 'none',
        },
      ]),
  ],
  [
    'a chart legend object',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'bar',
          series: [{ value: '=1' }],
          legend: { position: 'top' },
        },
      ]),
    'warnings',
    'C: "legend" is an object ({"position":"top"}); only "bottom" (show the legend) or "none" (hide it) is supported, and the legend is drawn at the bottom',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'bar',
          series: [{ value: '=1' }],
          legend: 'bottom',
        },
      ]),
  ],
  [
    'a chart without series',
    () => R({}, [{ type: 'chart', name: 'C', dataSet: 'D', x: 0, y: 0, w: 100, h: 50, chartType: 'bar' }]),
    'warnings',
    'C: the chart has no series, so it plots a count of its rows; add one, e.g. series: [{ "name": "Value", "value": "=Sum(Fields.Amount)" }]',
    () => R({}, [{ type: 'chart', name: 'C', dataSet: 'D', x: 0, y: 0, w: 100, h: 50, chartType: 'gantt' }]),
  ],
  [
    'a polar chart without xValue',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'polar',
          series: [{ value: '=1' }],
        },
      ]),
    'warnings',
    'C: a polar chart needs xValue, the angle of each point in degrees (0 at the top, clockwise); without it no point is drawn',
    () =>
      R({}, [
        {
          type: 'chart',
          name: 'C',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          chartType: 'polar',
          series: [{ value: '=1' }],
          xValue: '=Fields.amount',
        },
      ]),
  ],
  [
    'an image from a local path',
    () => R({}, [{ type: 'image', name: 'I', x: 0, y: 0, w: 10, h: 10, src: 'C:\\logo.png' }]),
    'warnings',
    'I: "C:\\logo.png" is a local file path, which a browser cannot load; embed the image (images: { name: "data:image/png;base64,..." } and src: "embedded:name") or use an https:// address',
    () => R({}, [{ type: 'image', name: 'I', x: 0, y: 0, w: 10, h: 10, src: 'https://x.test/logo.png' }]),
  ],
  [
    'a bare image file name',
    () => R({}, [{ type: 'image', name: 'I', x: 0, y: 0, w: 10, h: 10, src: 'logo.jpeg' }]),
    'warnings',
    'I: "logo.jpeg" is a local file path, which a browser cannot load; embed the image (images: { name: "data:image/png;base64,..." } and src: "embedded:name") or use an https:// address',
    () => R({}, [{ type: 'image', name: 'I', x: 0, y: 0, w: 10, h: 10, src: '=Fields.logo' }]),
  ],
  [
    'a style that is not an object',
    () => R({}, [tb({ style: 'bold' })]),
    'warnings',
    'T: "style" must be an object of style properties, such as { "fontWeight": "bold" }; "bold" is ignored',
    () => R({}, [tb({ style: {} })]),
  ],
  [
    'a sparkline style is its kind',
    () => R({}, [{ type: 'sparkline', name: 'S', x: 0, y: 0, w: 10, h: 10, style: 'column' }]),
    'warnings',
    null,
    null,
  ],
  [
    'an unknown item property, a near miss',
    () => R({}, [tb({ vale: 'x' })]),
    'warnings',
    'T: unknown property "vale" (did you mean "value"?); it is ignored',
    () => R({}, [tb({ _vale: 'x' })]),
  ],
  [
    'a value off its enum',
    () => R({}, [tb({ dir: 'rtl2' })]),
    'warnings',
    'T: "dir" is "rtl2"; expected one of "ltr", "rtl", "auto"',
    () => R({}, [tb({ dir: 'rtl' })]),
  ],
  [
    'an expression that does not parse',
    () => R({}, [tb({ value: '=1 +' })]),
    'errors',
    null,
    () => R({}, [tb({ value: '=1 + 1' })]),
  ],
  [
    'a missing data set',
    () => R({}, [tb({ dataSet: 'Nope' })]),
    'warnings',
    'T: the data set "Nope" does not exist',
    () => R({}, [tb({ dataSet: 'D' })]),
  ],
  [
    'matrix groups not a list',
    () => R({}, [{ type: 'matrix', name: 'M', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, rowGroups: 'x' }]),
    'errors',
    'M: "rowGroups" must be a list',
    () => R({}, [{ type: 'matrix', name: 'M', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, rowGroups: [] }]),
  ],
  [
    'a matrix group not an object',
    () => R({}, [{ type: 'matrix', name: 'M', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, values: [3] }]),
    'errors',
    'M: values 1 is not an object',
    () =>
      R({}, [
        {
          type: 'matrix',
          name: 'M',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          values: [{ value: '=Sum(Fields.amount)' }],
        },
      ]),
  ],
  [
    'a table with no columns',
    () => R({}, [{ type: 'table', name: 'Tab', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, columns: [] }]),
    'errors',
    'Tab: the table has no columns',
    () => R({}, [{ type: 'table', name: 'Tab', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, columns: [{ width: 10 }] }]),
  ],
  [
    'a table in the page header',
    () =>
      R({
        sections: {
          pageHeader: {
            height: 40,
            items: [{ type: 'table', name: 'Tab', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, columns: [{ width: 10 }] }],
          },
          body: { items: [] },
        },
      }),
    'errors',
    'Tab: tables can only be in the body',
    () => R({}, [{ type: 'table', name: 'Tab', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, columns: [{ width: 10 }] }]),
  ],
  [
    'a row short of cells',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 20,
          h: 18,
          columns: [{ width: 10 }, { width: 10 }],
          detail: [{ height: 18, cells: [{ value: 'a' }] }],
        },
      ]),
    'warnings',
    'Tab detail row 1: the row has 1 of 2 cells and no colSpan covers the other 1; add the cells or a colSpan',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 20,
          h: 18,
          columns: [{ width: 10 }, { width: 10 }],
          detail: [{ height: 18, cells: [{ value: 'a', colSpan: 2 }] }],
        },
      ]),
  ],
  [
    'a group header row short of cells',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 20,
          h: 18,
          columns: [{ width: 10 }, { width: 10 }],
          groups: [{ expr: '=Fields.region', header: [{ height: 18, cells: [] }] }],
          detail: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
        },
      ]),
    'warnings',
    'Tab group 1 header row 1: the row has 0 of 2 cells and no colSpan covers the other 2; add the cells or a colSpan',
    () => R(),
  ],
  // the cells are counted as in the JSON list (from 0), as tests/engine/b5-colspan.test.js has it
  [
    'a cell covered by a colSpan',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 20,
          h: 18,
          columns: [{ width: 10 }, { width: 10 }],
          header: [{ height: 18, cells: [{ value: 'a', colSpan: 2 }, { value: 'b' }] }],
          detail: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
        },
      ]),
    'warnings',
    "Tab header row 1: cell 1 is covered by colSpan of cell 0, so it is not drawn (leave it null, or omit the spanned cells: a row with fewer cells than columns places each cell after the previous one's span)",
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 20,
          h: 18,
          columns: [{ width: 10 }, { width: 10 }],
          header: [{ height: 18, cells: [{ value: 'a', colSpan: 2 }, null] }],
          detail: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
        },
      ]),
  ],
  [
    'PageNumber in the body',
    () => R({}, [tb({ value: '=Globals.PageNumber' })]),
    'warnings',
    'T: PageNumber and TotalPages work only in the page header and footer',
    () =>
      R({
        sections: { pageHeader: { height: 20, items: [tb({ value: '=Globals.PageNumber' })] }, body: { items: [] } },
      }),
  ],
  [
    'TotalPages in a table cell',
    () =>
      R({}, [
        {
          type: 'table',
          name: 'Tab',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 10,
          h: 18,
          columns: [{ width: 10 }],
          detail: [{ height: 18, cells: [{ value: '=Globals!TotalPages' }] }],
        },
      ]),
    'warnings',
    'Tab cell: PageNumber and TotalPages work only in the page header and footer',
    () => R(),
  ],
  [
    'a zero width',
    () => R({}, [tb({ w: 0 })]),
    'warnings',
    'T: width is 0, so the item is not drawn; give it a positive width',
    () => R({}, [{ type: 'line', name: 'L', x: 0, y: 0, w: 100, h: 0 }]),
  ],
  [
    'a negative height',
    () => R({}, [tb({ h: -3 })]),
    'warnings',
    'T: height is -3, so the item is not drawn; give it a positive height',
    () => R({}, [tb({ h: 3 })]),
  ],
  [
    'an unknown field (inline data)',
    () => R({}, [tb({ value: '=Fields.regoin' })]),
    'warnings',
    'T: The field "regoin" does not exist; check the spelling, or the data set that has it',
    () => R({}, [tb({ value: '=Fields.region' })]),
  ],
  [
    'an unknown parameter',
    () => R({}, [tb({ value: '=Parameters.Zzz' })]),
    'warnings',
    null,
    () => R({ parameters: [{ name: 'Zzz', type: 'string' }] }, [tb({ value: '=Parameters.zzz' })]),
  ],
  [
    'a near miss of a parameter: an error',
    () => R({ parameters: [{ name: 'Region', type: 'string' }] }, [tb({ value: '=Parameters.Regoin' })]),
    'errors',
    null,
    () => R({ parameters: [{ name: 'Region', type: 'string' }] }, [tb({ value: '=Parameters.Region' })]),
  ],
  [
    'an unknown function',
    () => R({}, [tb({ value: '=Sume(1)' })]),
    'errors',
    null,
    () => R({}, [tb({ value: '=Sum(1)' })]),
  ],
  [
    'a barcode symbology',
    () => R({}, [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 10, h: 10, value: 'x', symbology: 'nope128' }]),
    'errors',
    null,
    () => R({}, [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 10, h: 10, value: 'x', symbology: 'code128' }]),
  ],
  [
    'an aggregate outside a region',
    () => R({}, [tb({ value: '=Sum(Fields.amount)' })]),
    'warnings',
    'T: Sum is outside a table or list and names no scope, so it uses the first data set; name one as the last argument, e.g. Sum(Fields.x, "DataSetName"), or give the item a dataSet',
    () => R({}, [tb({ value: '=Sum(Fields.amount)', dataSet: 'D' })]),
  ],
  ['an aggregate with a scope: fine', () => R({}, [tb({ value: '=Sum(Fields.amount, "D")' })]), 'warnings', null, null],
  [
    'a box taller than the page',
    () => R({}, [{ type: 'shape', name: 'S', x: 0, y: 0, w: 10, h: 900 }]),
    'warnings',
    'S: it is 900 pt tall, taller than the 730 pt the page has for the body (the page less its margins, page header and footer). Its lower part is cut at the page bottom; make it shorter.',
    () => R({}, [{ type: 'shape', name: 'S', x: 0, y: 0, w: 10, h: 700 }]),
  ],
  [
    'a text box taller than the page',
    () => R({}, [tb({ h: 900 })]),
    'warnings',
    'T: it is 900 pt tall, taller than the 730 pt the page has for the body (the page less its margins, page header and footer). Its text of more than one line continues on the next page; otherwise the lower part of the box is cut at the page bottom; make it shorter.',
    () => R({ page: { size: 'Pageless' } }, [tb({ h: 900 })]),
  ],
  [
    'an empty barcode',
    () => R({}, [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 10, h: 10, value: '  ' }]),
    'warnings',
    'B has no value: nothing is printed',
    () => R({}, [{ type: 'barcode', name: 'B', x: 0, y: 0, w: 10, h: 10, value: '=Fields.region', dataSet: 'D' }]),
  ],
  [
    'icon thresholds the wrong way round',
    () => R({}, [{ type: 'iconset', name: 'I', x: 0, y: 0, w: 10, h: 10, value: '=1', lower: '=80', upper: '20' }]),
    'warnings',
    'I: the high threshold (20) is below the low one (80), so the middle icon never shows',
    () => R({}, [{ type: 'iconset', name: 'I', x: 0, y: 0, w: 10, h: 10, value: '=1', lower: 20, upper: '=Fields.x' }]),
  ],
  [
    'a toc in the page footer',
    () =>
      R({
        sections: {
          pageFooter: { height: 40, items: [{ type: 'toc', name: 'Toc', x: 0, y: 0, w: 10, h: 10 }] },
          body: { items: [] },
        },
      }),
    'warnings',
    'Toc is in a page band: a table of contents lists entries only in the body',
    () => R({}, [{ type: 'toc', name: 'Toc', x: 0, y: 0, w: 10, h: 10 }]),
  ],
  [
    'a filter on an item',
    () =>
      R({}, [
        {
          type: 'list',
          name: 'L',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          items: [],
          filters: [{ expr: '=Fields.amount', op: 'BetweenX', value: 1 }],
        },
      ]),
    'errors',
    "L, filter 1: the op \"BetweenX\" is not a filter operator (= <> > >= < <= in like contains between Between TopN BottomN TopPercent BottomPercent); a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }",
    () =>
      R({}, [
        {
          type: 'list',
          name: 'L',
          dataSet: 'D',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          items: [],
          filters: [{ expr: '=Fields.amount', op: 'BETWEEN', value: 1, value2: 2 }],
        },
      ]),
  ],
  [
    'a sort on an item',
    () => R({}, [{ type: 'list', name: 'L', dataSet: 'D', x: 0, y: 0, w: 10, h: 10, items: [], sort: ['x'] }]),
    'warnings',
    'L, sort 1: a sort entry is {by, dir}, e.g. {"by": "=Fields.Name", "dir": "asc"}; this one has no "by" and is ignored',
    () => R(),
  ],
];

describe('validate: each message, and one step from it none', () => {
  for (const [what, make, list, msg, ok] of CASES) {
    it(what, () => {
      const v = validate(make());
      if (msg) expect(v[list]).toContain(msg);
      else if (ok) expect(v[list].length, `${what}: something in ${list}`).toBeGreaterThan(0);
      else expect(v[list].filter((w) => !w.startsWith('The report has no "$schema"'))).toEqual([]);
      if (ok) {
        const w = validate(ok());
        if (msg) expect(w[list]).not.toContain(msg);
        else expect(w[list], `${what}: the fixed report`).toEqual([]);
      }
    });
  }
  it('the base report has nothing to say', () => {
    expect(validate(R({}, [tb()]))).toEqual({
      errors: [],
      warnings: [],
      exprErrors: [],
      checkOnly: [],
      renderSays: [],
      hints: [],
    });
  });
  it('no report', () => {
    for (const d of [null, undefined, 5, 'x']) expect(validate(d).errors).toEqual(['The report definition is empty']);
  });
  it('an expression error is in errors and exprErrors; an unknown function in checkOnly too', () => {
    const v = validate(R({}, [tb({ value: '=1 +' })]));
    expect(v.exprErrors.length).toBe(1);
    expect(v.errors).toEqual(v.exprErrors);
    expect(v.checkOnly).toEqual([]);
    const f = validate(R({}, [tb({ value: '=Sume(1)' })]));
    expect(f.checkOnly.length).toBe(1);
    expect(f.checkOnly[0]).toMatch(/^T: /);
    expect(f.errors).toEqual(f.checkOnly);
    const p = validate(R({ parameters: [{ name: 'Region', type: 'string' }] }, [tb({ value: '=Parameters.Regoin' })]));
    expect(p.errors).toEqual(p.exprErrors);
    expect(p.errors[0]).toMatch(/^T: .*Regoin/);
  });
  it('an unknown function in a data set, a parameter and a custom function', () => {
    const v = validate(
      R({
        dataSets: [{ name: 'D', source: 'src', filters: [{ expr: '=Fooo(1)', op: '=', value: 1 }] }],
        parameters: [{ name: 'P', type: 'string', default: '=Barr()' }],
        functions: [{ name: 'f', body: '=Bazz(1)' }],
      }),
    );
    expect(v.errors.filter((e) => e.startsWith('Data set "D": '))).toHaveLength(1);
    expect(v.errors.filter((e) => e.startsWith('Parameter "P": '))).toHaveLength(1);
    expect(v.errors.filter((e) => e.startsWith('Function "f": '))).toHaveLength(1);
    expect(validate(R({ functions: [{ name: 'f', body: '=1' }] }, [tb({ value: '=f()' })])).errors).toEqual([]);
  });
  it("the body room counts a body section's own page and bands", () => {
    const d = R({
      sections: {
        pageHeader: { height: 100, items: [] },
        body: [
          { items: [{ type: 'shape', name: 'S', x: 0, y: 0, w: 10, h: 700 }], pageHeader: { hidden: true, items: [] } },
          { items: [{ type: 'shape', name: 'S2', x: 0, y: 0, w: 10, h: 700 }] },
        ],
        pageFooter: { height: 20, items: [] },
      },
    });
    const w = validate(d).warnings.filter((m) => m.includes('taller than'));
    expect(w).toEqual([expect.stringMatching(/^S2: it is 700 pt tall, taller than the 650 pt/)]);
    expect(validate(d).renderSays).toEqual(w);
  });
  it('a long message is cut at 1,000 characters, the same in every list', () => {
    const v = validate(R({}, [tb({ name: 'N'.repeat(3000), x: 'a' })]));
    expect(v.errors[0].length).toBe(1000);
    expect(v.errors[0].endsWith('…')).toBe(true);
  });
});

describe('validateCached', () => {
  it('the same report: the same result object; an edit: a new one', () => {
    const d = R({}, [tb()]);
    const a = validateCached(d);
    expect(validateCached(JSON.parse(JSON.stringify(d)))).toBe(a);
    const e = R({}, [tb({ x: 'q' })]);
    expect(validateCached(e)).not.toBe(a);
    expect(validateCached(e).errors).toEqual(['T: "x" must be a number']);
    expect(validateCached(null).errors).toEqual(['The report definition is empty']);
    const cyc = R();
    cyc.self = cyc;
    expect(validateCached(cyc).warnings).toContain('Unknown report property "self"; it is ignored');
  });
  it('rows past 200 do not change the signature', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ region: 'N', amount: i }));
    const a = R({ dataSources: [{ name: 'src', type: 'json', data: { rows } }] });
    const b = R({
      dataSources: [
        {
          name: 'src',
          type: 'json',
          data: { rows: [...rows.slice(0, 200), ...rows.slice(200).map((r) => ({ ...r, amount: -1 }))] },
        },
      ],
    });
    expect(validateCached(b)).toBe(validateCached(a));
  });
});

describe('bareSorts', () => {
  it('a sort by a bare field name sorts by the field; nothing to change: the same object', () => {
    const d = R({ dataSets: [{ name: 'D', source: 'src', path: '$.rows', sort: [{ by: ' Region ' }] }] }, [
      {
        type: 'list',
        name: 'L',
        dataSet: 'D',
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        items: [],
        sort: [{ by: 'amount', dir: 'desc' }],
      },
    ]);
    const out = bareSorts(d);
    expect(out).not.toBe(d);
    expect(out.dataSets[0].sort).toEqual([{ by: '=Fields.Region' }]);
    expect(out.sections.body.items[0].sort).toEqual([{ by: '=Fields.amount', dir: 'desc' }]);
    expect(d.dataSets[0].sort).toEqual([{ by: ' Region ' }]); // the original kept
    const fine = R({ dataSets: [{ name: 'D', source: 'src', sort: [{ by: '=Fields.region' }, { by: 'notAField' }] }] });
    expect(bareSorts(fine)).toBe(fine);
    expect(bareSorts(null)).toBe(null);
  });
  it("didYouMean is the expression module's", () => {
    expect(didYouMean('regoin', ['region', 'amount'])).toBe('region');
  });
});
