import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const sales = { rows: [
  { region: 'South', city: 'Bengaluru', amt: 100, paid: true },
  { region: 'North', city: 'Delhi', amt: 50, paid: false },
  { region: 'South', city: 'Chennai', amt: 200, paid: true },
  { region: 'North', city: 'Jaipur', amt: 25, paid: true },
  { region: 'South', city: 'Bengaluru', amt: 300, paid: false },
] };
const grouped = (extra = {}) => ({
  type: 'table', name: 'Sales', x: 0, y: 0, w: 300, h: 80, dataSet: 'Rows',
  columns: [{ width: 150 }, { width: 150 }],
  header: [{ height: 18, cells: [{ value: 'City' }, { value: 'Amount' }] }],
  groups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc',
    header: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Count(Fields.amt) & " rows"' }] }],
    footer: [{ height: 18, cells: [{ value: 'Subtotal {Fields.region}' }, { value: '=Sum(Fields.amt)' }] }], ...extra }],
  detail: [{ height: 18, cells: [{ value: '={RowNumber("Region")}. {Fields.city}'.replace('={', '{') }, { value: '=Fields.amt' }] }],
  footer: [{ height: 18, cells: [{ value: 'Total' }, { value: '=Sum(Fields.amt)' }] }],
});

describe('table groups', () => {
  it('groups, sorts groups and computes subtotals by scope', async () => {
    const out = await render(report([grouped()], { data: sales }), { fontStore });
    const t = texts(out.pages[0]);
    expect(t.indexOf('North')).toBeLessThan(t.indexOf('South'));          // sorted asc
    expect(t).toContain('2 rows');
    expect(t).toContain('3 rows');
    expect(t).toContain('Subtotal North');
    expect(t[t.indexOf('Subtotal North') + 1]).toBe('75');
    expect(t[t.indexOf('Subtotal South') + 1]).toBe('600');
    expect(t[t.indexOf('Total') + 1]).toBe('675');
    expect(t).toContain('1. Delhi');                                      // RowNumber restarts per group
    expect(t).toContain('3. Bengaluru');
  });

  it('can start each group on a new page', async () => {
    const out = await render(report([grouped({ pageBreak: 'between' })], { data: sales }), { fontStore });
    expect(out.pages.length).toBe(2);
    expect(texts(out.pages[1])).toContain('Subtotal South');
    expect(texts(out.pages[1])[0]).toBe('City');                         // header repeats
  });

  it('keeps a group together when it fits', async () => {
    const spacer = { type: 'shape', name: 'S', shape: 'rect', x: 0, y: 0, w: 10, h: 640 };
    const out = await render(report([spacer, { ...grouped({ keepTogether: true }), y: 640 }], { data: sales }), { fontStore });
    // North (4 rows of 18pt) fits on page 1, South does not and moves whole to page 2
    const p2 = texts(out.pages[1]);
    expect(p2).toContain('South');
    expect(p2).toContain('Subtotal South');
    expect(texts(out.pages[0])).not.toContain('Chennai');
  });

  it('collapses groups and offers a toggle', async () => {
    const def = report([grouped({ collapsible: true, initiallyCollapsed: true })], { data: sales });
    let out = await render(def, { fontStore });
    expect(texts(out.pages[0])).not.toContain('1. Delhi');
    const toggles = out.pages[0].items.filter(i => i.t === 'link' && i.action.type === 'toggle');
    expect(toggles.length).toBe(2);
    out = await render(def, { fontStore, state: { toggles: { [toggles[0].action.key]: true } } });
    expect(texts(out.pages[0])).toContain('1. Delhi');
    expect(texts(out.pages[0])).not.toContain('1. Bengaluru');
  });
});

describe('list, container, checkbox', () => {
  it('repeats a list row per group with nested aggregates and keep-together blocks', async () => {
    const list = { type: 'list', name: 'Regions', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', groupBy: '=Fields.region', items: [
      { type: 'textbox', name: 'R', x: 0, y: 0, w: 200, h: 14, value: '=Fields.region' },
      { type: 'textbox', name: 'T', x: 200, y: 0, w: 200, h: 14, value: '=Sum(Fields.amt)' },
    ] };
    const out = await render(report([list], { data: sales }), { fontStore });
    const t = texts(out.pages[0]);
    expect(t).toEqual(expect.arrayContaining(['South', '600', 'North', '75']));
  });

  it('nests a table in a list filtered by Parent', async () => {
    const data = { rows: [{ id: 1, name: 'Acme' }, { id: 2, name: 'Zeta' }], lines: [{ cid: 1, item: 'Bolt' }, { cid: 2, item: 'Nut' }, { cid: 1, item: 'Gear' }] };
    const def = report([{ type: 'list', name: 'Customers', x: 0, y: 0, w: 400, h: 60, dataSet: 'Rows', items: [
      { type: 'textbox', name: 'N', x: 0, y: 0, w: 200, h: 14, value: '=Fields.name' },
      { type: 'table', name: 'Lines', x: 20, y: 20, w: 200, h: 36, dataSet: 'Lines', filters: [{ expr: '=Fields.cid', op: '=', value: '=Parent.id' }],
        columns: [{ width: 200 }], header: [{ height: 18, cells: [{ value: 'Item' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.item' }] }] },
    ] }], { data });
    def.dataSets.push({ name: 'Lines', source: 'src', path: '$.lines' });
    const out = await render(def, { fontStore });
    const t = texts(out.pages[0]);
    expect(t.join('|')).toBe('Acme|Item|Bolt|Gear|Zeta|Item|Nut');
  });

  it('draws a container frame and a checkbox', async () => {
    const out = await render(report([
      { type: 'container', name: 'Box', x: 0, y: 0, w: 200, h: 40, style: { border: '1 solid #000' }, items: [
        { type: 'checkbox', name: 'C', x: 4, y: 4, w: 150, h: 14, value: '=First(Fields.paid)', text: 'Paid', dataSet: 'Rows' } ] },
    ], { data: sales }), { fontStore });
    const items = out.pages[0].items;
    expect(items.filter(i => i.t === 'line').length).toBe(4);           // container border
    expect(items.some(i => i.t === 'path')).toBe(true);                   // check mark
    expect(texts(out.pages[0])).toContain('Paid');
  });
});

describe('parameters', () => {
  it('filters with a multi-value parameter', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 36, dataSet: 'Rows', columns: [{ width: 200 }],
      detail: [{ height: 18, cells: [{ value: '=Fields.city' }] }] }], { data: sales, def: { parameters: [{ name: 'regions', type: 'string', multi: true }] } });
    def.dataSets[0].filters = [{ expr: '=Fields.region', op: 'in', value: '=Parameters.regions' }];
    const out = await render(def, { fontStore, parameters: { regions: 'North' } });
    expect(texts(out.pages[0]).sort()).toEqual(['Delhi', 'Jaipur']);
  });
  it('joins a multi-value parameter and looks up another data set', async () => {
    const def = report([{ type: 'textbox', name: 'J', x: 0, y: 0, w: 300, h: 14, value: '={Join(Parameters.r, " + ")} / {Lookup("Chennai", Fields.city, Fields.amt, "Rows")}'.slice(1) }],
      { data: sales, def: { parameters: [{ name: 'r', type: 'string', multi: true }] } });
    const out = await render(def, { fontStore, parameters: { r: ['A', 'B'] } });
    expect(texts(out.pages[0])).toContain('A + B / 200');
  });
});

describe('links and bookmarks', () => {
  it('emits hyperlinks and bookmarks', async () => {
    const def = report([{ type: 'textbox', name: 'L', x: 0, y: 0, w: 200, h: 14, value: 'Docs', bookmark: 'Intro', action: { type: 'url', url: 'https://example.com/{Fields.city}' }, dataSet: 'Rows' }], { data: sales });
    const out = await render(def, { fontStore });
    const link = out.pages[0].items.find(i => i.t === 'link');
    expect(link.action).toEqual({ type: 'url', href: 'https://example.com/Bengaluru' });
    expect(out.bookmarks).toEqual([expect.objectContaining({ label: 'Intro', page: 1 })]);
  });
});
