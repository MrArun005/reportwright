// R1-C (designer and viewer UX): matrix cell click actions in the engine and the importers.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { importRdlx } from '../../src/importers/rdlx.js';
import { fontStore, report } from '../helpers.js';
import { pathBox, pageLinks, readingText } from '../../src/viewer/logic.js';

const rows = [
  { region: 'North', city: 'Pune', year: 2025, amt: 50 }, { region: 'North', city: 'Delhi', year: 2026, amt: 70 },
  { region: 'South', city: 'Kochi', year: 2025, amt: 30 }, { region: 'South', city: 'Kochi', year: 2026, amt: 20 },
];
const matrix = (extra = {}) => ({
  type: 'matrix', name: 'M', x: 0, y: 0, w: 400, h: 60, dataSet: 'Rows',
  rowGroups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', total: 'after', action: { type: 'report', report: 'dash', params: { region: '=Fields.region' } }, totalAction: { type: 'url', url: '="https://example.com/all"' } }],
  columnGroups: [{ name: 'Year', expr: '=Fields.year', sort: 'asc', total: 'after', action: { type: 'params', params: { year: '=Fields.year' } } }],
  values: [{ value: '=Sum(Fields.amt)', action: { type: 'report', report: 'detail', params: { region: '=Fields.region', year: '=Fields.year' } }, bookmark: '="cell-" & Fields.region' }],
  ...extra,
});
const links = (out) => out.pages.flatMap(p => p.items.filter(i => i.t === 'link' && i.action)).map(i => i.action);

describe('matrix cell actions (U-1)', () => {
  it('row headers, column headers, totals and value cells click in their own scope', async () => {
    const out = await render(report([matrix()], { data: { rows } }), { fontStore });
    expect(out.warnings).toEqual([]);
    const acts = links(out);
    // a row header drills through with its own region
    expect(acts).toContainEqual({ type: 'drill', report: 'dash', params: { region: 'North' } });
    expect(acts).toContainEqual({ type: 'drill', report: 'dash', params: { region: 'South' } });
    // a column header filters by its year
    expect(acts).toContainEqual({ type: 'params', params: { year: 2025 }, toggle: true });
    expect(acts).toContainEqual({ type: 'params', params: { year: 2026 }, toggle: true });
    // a value cell: its row × column intersection
    expect(acts).toContainEqual({ type: 'drill', report: 'detail', params: { region: 'South', year: 2026 } });
    expect(acts).toContainEqual({ type: 'drill', report: 'detail', params: { region: 'North', year: 2025 } });
    // the row total label's own action
    expect(acts).toContainEqual({ type: 'url', href: 'https://example.com/all' });
    // bookmarks on value cells
    expect(out.bookmarks.map(b => b.label)).toContain('cell-North');
  });

  it('a matrix without actions has no links (and no scope copies)', async () => {
    const m = matrix();
    delete m.rowGroups[0].action; delete m.rowGroups[0].totalAction; delete m.columnGroups[0].action; delete m.values[0].action; delete m.values[0].bookmark;
    const out = await render(report([m], { data: { rows } }), { fontStore });
    expect(links(out)).toEqual([]);
  });

  it('a drill-down toggle on a header with an action keeps both', async () => {
    const m = matrix({ rowGroups: [{ ...matrix().rowGroups[0], collapsible: true }, { name: 'City', expr: '=Fields.city' }] });
    const acts = links(await render(report([m], { data: { rows } }), { fontStore }));
    expect(acts.some(a => a.type === 'toggle')).toBe(true);
    expect(acts).toContainEqual({ type: 'drill', report: 'dash', params: { region: 'North' } });
  });
});

describe('importers map tablix cell actions onto the matrix (U-1)', () => {
  const tb = (name, Value, extra = {}) => ({ Item: { Type: 'textbox', Name: name, Value, ...extra } });
  const drill = (p) => ({ Drillthrough: { ReportName: 'Detail', Parameters: [{ ParameterName: 'region', Value: p }] } });
  const ds = { DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=[]' } }],
    DataSets: [{ Name: 'Sales', Query: { DataSourceName: 'S', CommandText: '$.[*]' }, Fields: ['region', 'year', 'amount'].map(n => ({ Name: n, DataField: n })) }] };
  const tablix = {
    Type: 'tablix', Name: 'Pivot', DataSetName: 'Sales', Width: '6in', Height: '1in',
    RowHierarchy: { Members: [
      { Header: tb('HRegion', '=Fields!region.Value', { Action: drill('=Fields!region.Value') }), Group: { Name: 'Region', GroupExpressions: ['=Fields!region.Value'] } },
      { Header: tb('HTotal', 'Total', { Action: { Hyperlink: 'https://example.com' } }) },
    ] },
    ColumnHierarchy: { Members: [{ Header: tb('HYear', '=Fields!year.Value', { Action: { BookmarkLink: 'top' } }), Group: { Name: 'Year', GroupExpressions: ['=Fields!year.Value'] } }] },
    Body: { Columns: ['0.8in'], Rows: [
      { Height: '0.25in', Cells: [tb('V', '=Sum(Fields!amount.Value)', { Action: drill('=Fields!region.Value') })] },
      { Height: '0.25in', Cells: [tb('VT', '=Sum(Fields!amount.Value)')] },
    ] },
  };
  it('header, total and value actions', () => {
    const r = importRdlx({ Name: 'R', ...ds, Page: { PageWidth: '8.5in', PageHeight: '11in' }, Body: { ReportItems: [tablix], Height: '3in' } });
    const m = r.definition.sections.body.items.find(i => i.name === 'Pivot');
    expect(m.rowGroups[0].action).toEqual({ type: 'report', report: 'detail', params: { region: '=Fields.region' } });
    expect(m.rowGroups[0].totalAction).toEqual({ type: 'url', url: 'https://example.com' });
    expect(m.columnGroups[0].action).toEqual({ type: 'bookmark', target: 'top' });
    expect(m.values[0].action).toEqual({ type: 'report', report: 'detail', params: { region: '=Fields.region' } });
  });
});

describe('viewer accessible layer (U-2)', () => {
  it('a path box from absolute commands, arcs by their end point', () => {
    expect(pathBox('M 10 10 L 30 10 A 5 5 0 0 1 30 40 Z')).toEqual({ x: 10, y: 10, w: 20, h: 30 });
    expect(pathBox('M0,0H20V5')).toEqual({ x: 0, y: 0, w: 20, h: 5 });
    expect(pathBox('')).toBe(null);
  });
  it('links in reading order, named by the text under them; the text in reading order', async () => {
    const def = report([
      { type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 60, dataSet: 'Rows', columns: [{ width: 150 }, { width: 150 }],
        header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount', sortBy: '=Fields.amt' }] }],
        groups: [{ name: 'G', expr: '=Fields.region', sort: 'asc', collapsible: true, initiallyCollapsed: true, header: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Sum(Fields.amt)' }] }] }],
        detail: [{ height: 18, cells: [{ value: '=Fields.city' }, { value: '=Fields.amt' }] }] },
    ], { data: { rows } });
    const out = await render(def, { fontStore });
    const ls = pageLinks(out.pages[0]);
    expect(ls[0]).toMatchObject({ action: { type: 'sort' }, text: 'Amount' });
    const toggles = ls.filter(l => l.action.type === 'toggle');
    expect(toggles.map(l => l.text)).toEqual(['North', 'South']); // the toggle is the group's first cell
    expect(toggles[0].action.open).toBe(false);
    const lines = readingText(out.pages[0]);
    expect(lines[0]).toBe('Region Amount');
    expect(lines).toContain('▶ North 120');
  });
});

import { sanitizeDraft, mergeDraft, writeDraft, readDraft, clearDrafts, draftKey, DRAFT_TTL } from '../../src/designer/draft.js';
describe('autosave drafts keep no secrets and stay with their user (U-4)', () => {
  const mem = () => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const def = {
    name: 'R',
    dataSources: [
      { name: 'api', type: 'rest', url: 'https://api.example.com/v1/sales?region=North&api_key=SECRETKEY1&token=TOK2', headers: { Authorization: 'Bearer HEADERTOKEN3' }, body: '{"pw":"BODY4"}' },
      { name: 'db', type: 'sql', connection: 'main', query: 'select * from salaries where ssn = 5' },
      { name: 'inline', type: 'json', data: { rows: [{ salary: 'ROW5' }] } },
    ],
    parameters: [{ name: 'apiToken', type: 'string', default: 'PARAM6' }, { name: 'year', type: 'number', default: 2026 }],
    sections: { body: { items: [{ type: 'image', name: 'Logo', src: 'https://cdn.example.com/logo.png?sig=SIG7&w=200', authorization: 'X8' }, { type: 'textbox', name: 'T', value: 'Hello' }] } },
  };
  it('a draft holds the layout, never a header value, token, key, body, SQL, inline row or parameter default', () => {
    const s = mem();
    writeDraft(s, 'a@x.test', 'r1', def);
    const raw = [...s.m.values()].join('');
    for (const secret of ['SECRETKEY1', 'TOK2', 'HEADERTOKEN3', 'BODY4', 'salaries', 'ROW5', 'PARAM6', 'SIG7', 'X8']) expect(raw).not.toContain(secret);
    expect(raw).toContain('Hello');
    expect(raw).toContain('logo.png?sig=&w=200');
    const back = mergeDraft(readDraft(s, 'a@x.test', 'r1').def, def);
    expect(back.dataSources).toEqual(def.dataSources); // restored from the saved report
    expect(back.parameters.map(p => p.default)).toEqual(['PARAM6', 2026]);
    expect(sanitizeDraft(def).dataSources).toEqual([{ name: 'api', type: 'rest' }, { name: 'db', type: 'sql' }, { name: 'inline', type: 'json' }]);
  });
  it('another user cannot see it; their designer removes it; sign-out removes all; old drafts expire', () => {
    const s = mem();
    writeDraft(s, 'a@x.test', 'r1', def);
    expect(readDraft(s, 'b@x.test', 'r1')).toBe(null);
    expect(draftKey('a@x.test', 'r1')).not.toContain('a@x.test');
    clearDrafts(s, 'b@x.test'); // b opens the designer in the same browser
    expect(readDraft(s, 'a@x.test', 'r1')).toBe(null);
    writeDraft(s, 'a@x.test', 'r1', def); writeDraft(s, 'a@x.test', 'r2', def);
    clearDrafts(s); // sign-out
    expect(s.length).toBe(0);
    writeDraft(s, 'a@x.test', 'r1', def, Date.now() - DRAFT_TTL - 1);
    expect(readDraft(s, 'a@x.test', 'r1')).toBe(null);
  });
});

import { formatFor, compactFormat, tableFor } from '../../src/designer/tableGen.js';
import { chartFromConfig } from '../../src/designer/ChartWizard.jsx';
import { formatValue } from '../../src/engine/expr/format.js';
describe('wizard number formats are per field and consistent (U-6)', () => {
  it('ids, years and month numbers plain; counts N0; money N2 or C2 with a report currency', () => {
    for (const name of ['id', 'year', 'month', 'fiscalYear', 'quarter']) expect(formatFor({ name, type: 'number' }, [{ [name]: 3 }]), name).toBe('0');
    for (const name of ['loans', 'count', 'qty', 'orders']) expect(formatFor({ name, type: 'number' }, [{ [name]: 440.5 }]), name).toBe('N0');
    for (const name of ['amount', 'rate', 'disbursed', 'tax']) {
      expect(formatFor({ name, type: 'number' }, [{ [name]: 8400 }]), name).toBe('N2');
      expect(formatFor({ name, type: 'number' }, [{ [name]: 8400 }], { currency: 'INR' }), name).toBe('C2');
    }
  });
  it('a table: detail, subtotal and total of a column share its format', () => {
    const ds = { name: 'S', fields: [{ name: 'category', type: 'string' }, { name: 'rate', type: 'number' }, { name: 'amount', type: 'number' }, { name: 'loans', type: 'number' }] };
    const t = tableFor(ds, { layout: 'grouped', groupBy: 'category', rows: [{ rate: 4200, amount: 8400, loans: 2 }] });
    const fmts = (row) => row.cells.map(c => c.style?.format);
    expect(fmts(t.detail[0])).toEqual(['N2', 'N2', 'N0']);
    expect(fmts(t.groups[0].footer[0])).toEqual([undefined, 'N2', 'N0']); // rate is not summed
    expect(fmts(t.footer[0])).toEqual([undefined, 'N2', 'N0']);
  });
  it('compact axes for big values; month numbers as names in calendar order', () => {
    expect(compactFormat(15000)).toBe(null);
    expect(formatValue(300000000, compactFormat(300000000))).toBe('300M');
    expect(formatValue(2730135125, compactFormat(2730135125))).toBe('2,730M');
    expect(formatValue(50000, compactFormat(50000))).toBe('50K');
    const c = { chartType: 'column', dataSet: 'S', category: 'month', value: 'amount', agg: 'Sum', monthNames: true, compact: '#,##0,,"M"' };
    const ch = chartFromConfig(c, { w: 300, h: 200 });
    expect(ch).toMatchObject({ category: '=DateSerial(2000, Fields.month, 1)', categoryFormat: 'MMM', categorySort: 'asc', axes: { y: { format: '#,##0,,"M"' } } });
    expect(chartFromConfig({ ...c, chartType: 'donut' }, { w: 300, h: 200 }).valueFormat).toBe('#,##0,,"M"');
  });
});

import { fieldIssues, nestedFields, exprParts } from '../../src/designer/fieldCheck.js';
describe('field references are checked at design time; nested objects become dotted fields (U-7)', () => {
  const sets = [
    { name: 'Lines', fields: [{ name: 'amount', type: 'number' }, { name: 'category', type: 'string' }, { name: 'customer', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'address.city', type: 'string' }] }] },
    { name: 'Regions', fields: [{ name: 'region', type: 'string' }] },
    { name: 'Empty', fields: [] },
  ];
  it('flags a misspelt or unknown field with a suggestion, at its place in the text', () => {
    const v = '=Sum(Fields.amont) + Fields.Amount';
    const is = fieldIssues(v, sets, 'Lines');
    expect(is).toEqual([{ from: 12, to: 17, name: 'amont', suggest: 'amount' }]);
    expect(v.slice(is[0].from, is[0].to)).toBe('amont');
    expect(fieldIssues('Bill to {Fields.custmer.name} and {Fields.category}', sets, 'Lines')).toMatchObject([{ name: 'custmer', suggest: 'customer' }]);
  });
  it('dotted members of a nested object; strings, other data sets and undetected fields are not flagged', () => {
    expect(fieldIssues('=Fields.customer.name & Fields.customer.address.city', sets, 'Lines')).toEqual([]);
    expect(fieldIssues('=Fields.customer.nmae', sets, 'Lines')).toMatchObject([{ name: 'customer.nmae', suggest: 'customer.name' }]);
    expect(fieldIssues('="Fields.nope"', sets, 'Lines')).toEqual([]);
    expect(fieldIssues('=Max(Fields.region, "Regions")', sets, 'Lines')).toEqual([]);
    expect(fieldIssues('=Fields.anything', sets, 'Empty')).toEqual([]);
    expect(fieldIssues('Plain Fields.x text', sets, 'Lines')).toEqual([]);
    expect(exprParts('a {x} b {y}')).toEqual([{ text: 'x', at: 3 }, { text: 'y', at: 9 }]);
  });
  it('nested objects in rows: object fields with dotted children', () => {
    const rows = [{ no: 1, customer: { name: 'Acme', address: { city: 'Pune', pin: 411001 } }, lines: [{ a: 1 }] }];
    expect(nestedFields(rows)).toEqual([{ name: 'customer', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'address.city', type: 'string' }, { name: 'address.pin', type: 'number' }] }]);
  });
  it('an object field reads Fields.customer.name in a render', async () => {
    const def = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 20, dataSet: 'Rows', value: '="Bill to " & First(Fields.customer.name) & ", " & First(Fields.customer.address.city)' }],
      { data: { rows: [{ customer: { name: 'Acme', address: { city: 'Pune' } } }] } });
    def.dataSets[0].fields = [{ name: 'customer', type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'address.city', type: 'string' }] }];
    const out = await render(def, { fontStore });
    expect(out.warnings).toEqual([]);
    expect(out.pages[0].items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text)).join(' ')).toContain('Bill to Acme, Pune');
  });
});

import { designIssues } from '../../src/designer/issues.js';
describe('design-time layout issues (U-8)', () => {
  const def = { dataSets: [{ name: 'S', fields: [{ name: 'amount', type: 'number' }] }] };
  it('partial overlaps, wider than the page (drawn width), unknown fields; layering inside a box is fine', () => {
    const items = [
      { id: 'a', name: 'A', type: 'textbox', x: 0, y: 0, w: 100, h: 20, value: 'x' },
      { id: 'b', name: 'B', type: 'textbox', x: 50, y: 10, w: 100, h: 20, value: '=Fields.amont' },
      { id: 't', name: 'Tile', type: 'shape', x: 200, y: 0, w: 100, h: 60 },
      { id: 'k', name: 'Kpi', type: 'textbox', x: 210, y: 10, w: 50, h: 20, value: 'k' },
      { id: 'm', name: 'M', type: 'matrix', x: 0, y: 100, w: 300, h: 40 },
      { id: 'l', name: 'Rule', type: 'line', x: 0, y: 15, w: 500, h: 0 },
    ];
    const is = designIssues(def, [{ key: 'body', items, width: 500 }], { m: { w: 640 } });
    expect(is.map(i => [i.kind, i.name])).toEqual([['field', 'B'], ['wide', 'M'], ['overlap', 'B']]);
    expect(is[1]).toMatchObject({ width: 640, room: 500 });
    expect(is[0]).toMatchObject({ field: 'amont', suggest: 'amount' });
  });
});

import { cfExpressions, applyCf, customProps, condition } from '../../src/designer/cfRules.js';
describe('conditional formatting rules write style expressions (CF wizard)', () => {
  const rows2 = [{ region: 'North', amount: 50 }, { region: 'South', amount: 500 }, { region: 'East', amount: 0 }, { region: 'West', amount: 120 }];
  const at = { subject: 'Fields.amount', scope: 'Rows' };
  const cf = { mode: 'first', rules: [
    { op: 'gt', value: '100', format: { color: '#067647', fontWeight: 'bold' } },
    { op: 'empty', format: { backgroundColor: '#fee4e2' } },
    { op: 'eq', value: '0', format: { color: '#b42318' } },
    { field: 'region', op: 'startsWith', value: 'W', format: { fontStyle: 'italic' } },
  ] };
  const cellOf = (out, text) => out.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === text);
  it('first match wins; stack mixes the formats of every matching rule', async () => {
    const cell = { value: '=Fields.amount' };
    applyCf(cell, cf, at, { visuals: true });
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 18, dataSet: 'Rows', columns: [{ width: 200 }], detail: [{ height: 18, cells: [cell] }] }], { data: { rows: rows2 } });
    let out = await render(def, { fontStore });
    expect(out.warnings).toEqual([]);
    expect(cellOf(out, '500').color).toBe('#067647');
    expect(cellOf(out, '500').font).toMatch(/Bold/);
    expect(cellOf(out, '0').color).toBe('#b42318');
    expect(cellOf(out, '50').color).toBe('#000');
    // West (120) matches rule 1 first: italic does not mix in
    expect(cellOf(out, '120').font).toMatch(/Bold$/);
    applyCf(cell, { ...cf, mode: 'stack' }, at, { visuals: true });
    out = await render(def, { fontStore });
    expect(cellOf(out, '120').font).toMatch(/BoldItalic/);
    expect(cell.cf.mode).toBe('stack');
  });
  it('averages over the data set, between, contains; rules reopen and hand edits show as custom', () => {
    expect(condition({ op: 'aboveAvg' }, at)).toBe('(Fields.amount) > Avg((Fields.amount), "Rows")');
    expect(condition({ op: 'between', value: '1', value2: '=Parameters.max' }, at)).toBe('(Fields.amount) >= 1 And (Fields.amount) <= (Parameters.max)');
    expect(condition({ field: 'region', op: 'contains', value: 'or"th' }, at)).toBe('InStr(CStr(Fields.region), "or""th") > 0');
    const t = { value: '=Fields.amount', style: { textAlign: 'right' } };
    applyCf(t, cf, at);
    expect(customProps(t, at)).toEqual([]);
    t.style.color = '=IIf(Fields.amount < 0, "red", Nothing)';
    expect(customProps(t, at)).toEqual(['color']);
    applyCf(t, { mode: 'first', rules: [] }, at); // all rules removed: only the hand-written colour stays
    expect(t.cf).toBeUndefined();
    expect(t.style).toEqual({ textAlign: 'right', color: '=IIf(Fields.amount < 0, "red", Nothing)' });
    expect(cfExpressions({ rules: [{ op: 'gt', value: 1, format: { icon: 'good' } }] }, at).icon).toBe('=IIf((Fields.amount) > 1, 3, Nothing)');
  });
});

import { pointAverage } from '../../src/designer/cfRules.js';
describe('a chart point above the average of the points (CF wizard)', () => {
  it('colours the categories whose total is above the mean of the category totals', async () => {
    const rows3 = [{ region: 'N', amount: 10 }, { region: 'S', amount: 100 }, { region: 'S', amount: 20 }, { region: 'E', amount: 5 }];
    const avg = pointAverage('Sum(Fields.amount)', '=Fields.region', 'Rows');
    const cf = { rules: [{ op: 'aboveAvg', format: { backgroundColor: '#dc2626' } }] };
    const color = cfExpressions(cf, { subject: 'Sum(Fields.amount)', scope: 'Rows', avg }).style.backgroundColor;
    const def = report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 160, dataSet: 'Rows', chartType: 'column', category: '=Fields.region', series: [{ name: 'A', value: '=Sum(Fields.amount)' }], pointColor: color }], { data: { rows: rows3 } });
    const out = await render(def, { fontStore });
    expect(out.warnings).toEqual([]);
    expect(out.pages[0].items.filter(i => i.fill === '#dc2626').length).toBe(1); // only S (120 > 135/3)
  });
});

import { buildSql, suggestJoins, aliasFor, quoteId } from '../../src/designer/sqlBuild.js';
import { assertOneRead } from '../../src/server/sql.js';
describe('visual SQL query builder: the SELECT it writes', () => {
  const b = {
    tables: [{ name: 'orders', alias: 'o' }, { name: 'customers', alias: 'c' }],
    columns: [{ t: 'o', c: 'id' }, { t: 'c', c: 'name' }, { t: 'c', c: 'id' }, { t: 'o', c: 'amount' }],
    joins: [{ type: 'left', from: { t: 'o', c: 'customer_id' }, to: { t: 'c', c: 'id' } }],
    filters: [{ t: 'o', c: 'region', op: '=', param: 'region' }, { t: 'o', c: 'amount', op: '>', value: '100' }, { t: 'c', c: 'name', op: 'like', value: "O'B%" }],
    sort: [{ t: 'o', c: 'amount', dir: 'desc' }], limit: 50,
  };
  it('joins, bound parameters, quoted literals, sort and limit per dialect', () => {
    expect(buildSql(b, 'sqlite')).toBe([
      'SELECT o."id" AS "o_id", c."name", c."id" AS "c_id", o."amount"',
      'FROM "orders" o',
      'LEFT JOIN "customers" c ON o."customer_id" = c."id"',
      'WHERE o."region" = @region',
      '  AND o."amount" > 100',
      '  AND c."name" LIKE \'O\'\'B%\'',
      'ORDER BY o."amount" DESC',
      'LIMIT 50'].join('\n'));
    expect(buildSql(b, 'mssql')).toMatch(/^SELECT TOP 50 o\.\[id\]/);
    expect(buildSql(b, 'mysql')).toContain('FROM `orders` o');
    expect(buildSql(b, 'oracle')).toMatch(/FETCH FIRST 50 ROWS ONLY$/);
    expect(buildSql({ tables: [] })).toBe('');
    for (const d of ['sqlite', 'postgres', 'mysql', 'mssql', 'oracle']) expect(() => assertOneRead(buildSql(b, d).replace(/@\w+/g, '1'), d), d).not.toThrow();
    expect(quoteId('dbo.Sales', 'mssql')).toBe('[dbo].[Sales]');
    expect(aliasFor('order_items', new Set(['oi']))).toBe('oi2');
  });
  it('foreign keys suggest the join of a table being added', () => {
    const schema = [{ name: 'orders', foreignKeys: [{ columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }] }, { name: 'customers' }];
    expect(suggestJoins({ tables: b.tables }, schema, 'c')).toEqual([{ type: 'inner', from: { t: 'o', c: 'customer_id' }, to: { t: 'c', c: 'id' } }]);
  });
});
