// R1-C (designer and viewer UX): matrix cell click actions in the engine and the importers.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { importRdlx } from '../../src/importers/rdlx.js';
import { fontStore, report } from '../helpers.js';

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
