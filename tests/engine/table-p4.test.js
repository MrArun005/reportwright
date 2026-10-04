import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const data = { rows: [{ id: 1, name: 'Asha', amt: 10 }, { id: 2, name: 'Ravi', amt: 20 }, { id: 3, name: 'Meera', amt: 30 }] };
const table = (extra) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }], header: [], detail: [], footer: [], ...extra });
const textAt = (page, s) => page.items.filter(i => i.t === 'text' && i.lines.some(l => l.text === s));

describe('merged cells across rows (rowSpan)', () => {
  it('paints one text and a background in every row, with no border between them', async () => {
    const def = report([table({ header: [
      { height: 20, cells: [{ value: 'Name', rowSpan: 2, style: { backgroundColor: '#eeeeee', border: '1 solid #000000' } }, { value: 'Amounts', colSpan: 2 }, null] },
      { height: 20, cells: [null, { value: 'Paid' }, { value: 'Due' }] },
    ] })], { data });
    const out = await render(def, { fontStore });
    const pg = out.pages[0];
    expect(texts(pg).filter(t => t === 'Name')).toHaveLength(1);
    const x0 = 36; // left margin
    const bg = pg.items.filter(i => i.t === 'rect' && i.fill === '#eeeeee');
    expect(bg.map(r => [r.x, r.y, r.h])).toEqual([[x0, 36, 20], [x0, 56, 20]]);
    const across = pg.items.filter(i => i.t === 'line' && i.y1 === i.y2 && i.x1 === x0 && i.x2 === x0 + 100).map(l => l.y1);
    expect(across).toEqual([36, 76]); // top of the first row and bottom of the second, nothing at 56
    expect(texts(pg)).toEqual(['Name', 'Amounts', 'Paid', 'Due']);
    // the data export knows the span
    expect(out.regions[0].rows[0].cells[0]).toMatchObject({ value: 'Name', rowSpan: 2, colIndex: 0 });
  });

  it('spans rows of one record in a detail band with several rows', async () => {
    const def = report([table({ detail: [
      { height: 16, cells: [{ value: '=Fields.name', rowSpan: 2 }, { value: '="#" & Fields.id' }, { value: '=Fields.amt' }] },
      { height: 16, cells: [null, { value: 'note' }, { value: '=Fields.amt * 2' }] },
    ] })], { data });
    const t = texts((await render(def, { fontStore })).pages[0]);
    expect(t).toEqual(['Asha', '#1', '10', 'note', '20', 'Ravi', '#2', '20', 'note', '40', 'Meera', '#3', '30', 'note', '60']);
  });

  it('a span never reaches into the next band', async () => {
    const def = report([table({ header: [{ height: 16, cells: [{ value: 'H', rowSpan: 5 }, { value: 'x' }, null] }], detail: [{ height: 16, cells: [{ value: '=Fields.name' }, null, null] }] })], { data });
    const t = texts((await render(def, { fontStore })).pages[0]);
    expect(t).toEqual(['H', 'x', 'Asha', 'Ravi', 'Meera']);
  });

  it('the last row grows when the merged text needs more room', async () => {
    const long = 'A long label that wraps onto several lines in a narrow merged cell';
    const def = report([table({ columns: [{ width: 60 }, { width: 100 }], header: [
      { height: 14, cells: [{ value: long, rowSpan: 2 }, { value: 'a' }] }, { height: 14, cells: [null, { value: 'b' }] }] })], { data });
    const pg = (await render(def, { fontStore })).pages[0];
    const label = pg.items.find(i => i.t === 'text' && i.lines[0].text.startsWith('A long'));
    const b = textAt(pg, 'b')[0];
    const bottom = label.lines[label.lines.length - 1].y;
    expect(b.clip.y + b.clip.h).toBeGreaterThan(bottom); // row 2 grew to hold the label
  });

  it('draws the merged text again at the top of the page its rows continue on', async () => {
    const body = Array.from({ length: 80 }, (_, i) => ({ row: { height: 16, cells: i === 0 ? [{ raw: 'Region North', rowSpan: 80 }, { raw: `r${i}` }] : [null, { raw: `r${i}` }] }, kind: 'detail' }));
    const def = report([{ ...table({ columns: [{ width: 120 }, { width: 120 }] }), dataSet: null, __body: body }]);
    const out = await render(def, { fontStore });
    expect(out.pages.length).toBe(2);
    const p2 = out.pages[1];
    const again = textAt(p2, 'Region North');
    expect(again).toHaveLength(1);
    const first = p2.items.find(i => i.t === 'text' && /^r\d+$/.test(i.lines[0].text));
    expect(Math.abs(again[0].lines[0].y - first.lines[0].y)).toBeLessThan(0.01); // same line as the first row on page 2
    expect(texts(out.pages[0]).filter(t => t === 'Region North')).toHaveLength(1);
  });
});

describe('cells', () => {
  it('a toggle on any cell, and raw values that are never evaluated', async () => {
    const def = report([table({ dataSet: null, __body: [{ row: { height: 16, cells: [{ raw: '=1+1' }, { raw: '{Fields.x}', toggle: { key: 'k1', open: false } }, { raw: 5 }] }, kind: 'detail' }] })]);
    const pg = (await render(def, { fontStore })).pages[0];
    expect(texts(pg)).toEqual(['=1+1', '▶ {Fields.x}', '5']);
    const link = pg.items.find(i => i.t === 'link');
    expect(link).toMatchObject({ x: 136, w: 100, action: { type: 'toggle', key: 'k1', open: false } });
  });
});

describe('wide tables paginate sideways (horizontal pagination)', () => {
  const wide = (n, extra) => {
    const rows = Array.from({ length: 6 }, (_, i) => Object.fromEntries([['name', `Row ${i + 1}`], ...Array.from({ length: n }, (_, c) => [`c${c}`, (i + 1) * 100 + c])]));
    const t = table({ columns: [{ width: 80 }, ...Array.from({ length: n }, () => ({ width: 50 }))],
      header: [{ height: 16, cells: [{ value: 'Name' }, ...Array.from({ length: n }, (_, c) => ({ value: `C${c}` }))] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.name' }, ...Array.from({ length: n }, (_, c) => ({ value: `=Fields.c${c}` }))] }],
      overflow: 'paginate', repeatColumns: 1, ...extra });
    return { def: report([t], { data: { rows } }), rows };
  };
  it('down, then across: every row with the first column set, then the next set, row headers repeated', async () => {
    const { def } = wide(20);
    const out = await render(def, { fontStore });
    // body 523 pt: 80 for Name leaves 443 → 8 columns of 50 per set: C0–C7, C8–C15, C16–C19
    expect(out.pages.length).toBe(3);
    const p = out.pages.map(texts);
    expect(p[0].slice(0, 10)).toEqual(['Name', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'Row 1']);
    expect(p[1].slice(0, 10)).toEqual(['Name', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'Row 1']);
    expect(p[2].slice(0, 6)).toEqual(['Name', 'C16', 'C17', 'C18', 'C19', 'Row 1']);
    const c8 = out.pages[1].items.find(i => i.t === 'text' && i.lines[0].text === 'C8');
    expect(c8.clip.x).toBe(36 + 80); // right after the repeated column
    expect(out.regions[0].columns.length).toBe(21); // the data export keeps every column
    expect(c8.cell).toMatchObject({ col: 1, cols: [80, 50, 50, 50, 50, 50, 50, 50, 50] });
  });
  it('across, then down: each block of rows on every column set before the next rows', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ name: `Row ${i + 1}`, ...Object.fromEntries(Array.from({ length: 12 }, (_, c) => [`c${c}`, c])) }));
    const { def } = wide(12, { pageOrder: 'across' });
    def.dataSources[0].data = { rows };
    const out = await render(def, { fontStore });
    const firstRow = out.pages.map(p => texts(p)[texts(p).findIndex(t => t.startsWith('Row '))]);
    const firstCol = out.pages.map(p => texts(p)[1]);
    expect(firstCol.slice(0, 4)).toEqual(['C0', 'C8', 'C0', 'C8']);
    expect(firstRow[0]).toBe('Row 1');
    expect(firstRow[1]).toBe('Row 1');
    expect(firstRow[2]).toBe(firstRow[3]);
    expect(firstRow[2]).not.toBe('Row 1');
  });
  it('a pivot paginates sideways with its row headers repeated', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ r: i % 2 ? 'B' : 'A', m: `M${String(i).padStart(2, '0')}`, v: i }));
    const def = report([{ type: 'matrix', name: 'P', x: 0, y: 0, w: 500, h: 40, dataSet: 'Rows', rowGroups: [{ expr: '=Fields.r', width: 60, total: 'after' }], columnGroups: [{ expr: '=Fields.m', sort: 'asc', total: 'after' }], values: [{ value: '=Sum(Fields.v)' }], columnWidth: 40 }], { data: { rows } });
    const out = await render(def, { fontStore });
    expect(out.pages.length).toBe(4); // 41 value columns, 11 per set
    for (const p of out.pages) expect(texts(p)).toEqual(expect.arrayContaining(['A', 'B', 'Total']));
    expect(texts(out.pages[3])).toContain('380'); // the total column, last set: 0+2+…+38
  });
});

describe('recursive hierarchies', () => {
  // CEO(1) → Ana(2), Bo(3); Ana → Cy(4), Di(5); Cy → Ed(6); Bo → Fay(7); Gil(8) has a parent that does not exist → a root
  const org = { rows: [
    { id: 1, boss: null, name: 'CEO', cost: 100 }, { id: 2, boss: 1, name: 'Ana', cost: 50 }, { id: 3, boss: 1, name: 'Bo', cost: 40 },
    { id: 4, boss: 2, name: 'Cy', cost: 20 }, { id: 5, boss: 2, name: 'Di', cost: 15 }, { id: 6, boss: 4, name: 'Ed', cost: 5 },
    { id: 7, boss: 3, name: 'Fay', cost: 10 }, { id: 8, boss: 99, name: 'Gil', cost: 1 },
  ] };
  const orgTable = (g = {}) => table({ columns: [{ width: 160 }, { width: 60 }, { width: 60 }, { width: 60 }],
    groups: [{ name: 'Org', expr: '=Fields.id', parent: '=Fields.boss', indent: 12, header: [{ height: 16, cells: [
      { value: '=Fields.name' }, { value: '=Level()' }, { value: '=Sum(Fields.cost)' }, { value: '=Sum(Fields.cost, "Org", "Recursive")' }] }], ...g }] });
  const rowsOf = (out) => out.regions[0].rows.map(r => r.cells.map(c => c.value));

  it('lists the tree depth first with Level(), own and Recursive totals', async () => {
    const out = await render(report([orgTable()], { data: org }), { fontStore });
    expect(rowsOf(out)).toEqual([
      ['CEO', 0, 100, 240], ['Ana', 1, 50, 90], ['Cy', 2, 20, 25], ['Ed', 3, 5, 5], ['Di', 2, 15, 15], ['Bo', 1, 40, 50], ['Fay', 2, 10, 10], ['Gil', 0, 1, 1],
    ]);
    expect(out.warnings).toEqual([]);
  });
  it('indents the first cell by level', async () => {
    const pg = (await render(report([orgTable()], { data: org }), { fontStore })).pages[0];
    const x = (s) => textAt(pg, s)[0].lines[0].x;
    expect(x('Ana') - x('CEO')).toBeCloseTo(12, 5);
    expect(x('Ed') - x('CEO')).toBeCloseTo(36, 5);
  });
  it('breaks cycles and lists each node once', async () => {
    const rows = [{ id: 1, boss: 2, name: 'A', cost: 1 }, { id: 2, boss: 1, name: 'B', cost: 2 }, { id: 3, boss: null, name: 'C', cost: 3 }];
    const out = await render(report([orgTable()], { data: { rows } }), { fontStore });
    expect(rowsOf(out).map(r => r[0])).toEqual(['C', 'A', 'B']);
    expect(out.warnings.join()).toMatch(/no root/);
  });
  it('drill-down by level: expandLevels opens the first levels, toggles open the rest', async () => {
    const def = report([orgTable({ collapsible: true, expandLevels: 1 })], { data: org });
    const out = await render(def, { fontStore });
    expect(rowsOf(out).map(r => r[0])).toEqual(['▼ CEO', '▶ Ana', '▶ Bo', '▼ Gil'].map(s => s.slice(2)));
    expect(texts(out.pages[0]).filter(t => /^[▼▶]/.test(t))).toEqual(['▼ CEO', '▶ Ana', '▶ Bo', '▼ Gil']);
    const key = out.pages[0].items.find(i => i.t === 'link' && i.action.key.endsWith('/1/2')).action.key;
    const more = await render(def, { fontStore, state: { toggles: { [key]: true } } });
    expect(rowsOf(more).map(r => r[0])).toEqual(['CEO', 'Ana', 'Cy', 'Di', 'Bo', 'Gil']);
  });
});

describe('regions inside cells', () => {
  const orders = { orders: [
    { id: 1, cust: 'A', items: [{ sku: 'p', q: 2 }, { sku: 'q', q: 1 }] },
    { id: 2, cust: 'B', items: [{ sku: 'r', q: 5 }] },
  ] };
  const sets = [
    { name: 'Orders', source: 'src', path: '$.orders[*]', fields: [{ name: 'id', type: 'number' }, { name: 'cust', type: 'string' }] },
    { name: 'Items', relation: { parent: 'Orders', path: '$.items[*]' }, fields: [{ name: 'sku', type: 'string' }, { name: 'q', type: 'number' }] },
  ];
  const inner = { type: 'table', dataSet: 'Items', columns: [{ width: 60 }, { width: 40 }], detail: [{ height: 14, cells: [{ value: '=Fields.sku' }, { value: '=Fields.q' }] }], footer: [{ height: 14, cells: [{ value: 'sum' }, { value: '=Sum(Fields.q)' }] }] };
  it('a table in a cell lists that row\'s children, and the row grows to fit', async () => {
    const t = table({ dataSet: 'Orders', columns: [{ width: 80 }, { width: 120 }], detail: [{ height: 16, cells: [{ value: '=Fields.cust' }, { value: '', item: inner }] }] });
    const out = await render(report([t], { data: orders, def: { dataSets: sets } }), { fontStore });
    expect(texts(out.pages[0])).toEqual(['A', 'p', '2', 'q', '1', 'sum', '3', 'B', 'r', '5', 'sum', '5']);
    const a = textAt(out.pages[0], 'A')[0], b = textAt(out.pages[0], 'B')[0];
    expect(b.clip.y - a.clip.y).toBeGreaterThanOrEqual(42); // 3 inner rows of 14
    expect(out.regions.map(r => r.name)).toEqual(['T']); // the inner table stays out of the data export
  });
  it('a sparkline in a group header charts the group\'s rows', async () => {
    const rows = [{ g: 'x', m: 1, v: 3 }, { g: 'x', m: 2, v: 5 }, { g: 'y', m: 1, v: 1 }];
    const t = table({ groups: [{ expr: '=Fields.g', header: [{ height: 20, cells: [{ value: '=Fields.g' }, { value: '', item: { type: 'sparkline', value: '=Fields.v' } }, null] }] }] });
    const out = await render(report([t], { data: { rows } }), { fontStore });
    expect(out.warnings).toEqual([]);
    expect(out.pages[0].items.filter(i => i.t === 'path').length).toBeGreaterThanOrEqual(1);
  });
});

describe('grid lists, footers at the bottom, orphaned headers', () => {
  it('a list with columns: 3 puts three records side by side', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ n: `Card ${i + 1}` }));
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 150, h: 40, dataSet: 'Rows', columns: 3, columnGap: 10, items: [{ type: 'textbox', name: 'tb', x: 0, y: 0, w: 150, h: 40, value: '=Fields.n' }] };
    const pg = (await render(report([list], { data: { rows } }), { fontStore })).pages[0];
    const at = (s) => { const t = textAt(pg, s)[0]; return [t.clip.x, t.clip.y]; };
    expect(at('Card 1')).toEqual([36, 36]);
    expect(at('Card 2')).toEqual([196, 36]);
    expect(at('Card 3')).toEqual([356, 36]);
    expect(at('Card 4')).toEqual([36, 76]);
    expect(at('Card 7')).toEqual([36, 116]);
  });
  it('printAtBottom: the footer sits at the bottom of the page, what follows starts on the next', async () => {
    const t = table({ printAtBottom: true, detail: [{ height: 16, cells: [{ value: '=Fields.name' }, null, null] }], footer: [{ height: 16, cells: [{ value: 'Signed' }, null, null] }] });
    const after = { type: 'textbox', name: 'after', x: 0, y: 60, w: 200, h: 14, value: 'Next' };
    const out = await render(report([t, after], { data }), { fontStore });
    const signed = textAt(out.pages[0], 'Signed')[0];
    expect(signed.clip.y + signed.clip.h).toBeCloseTo(841.89 - 36, 2); // A4 height less the bottom margin
    expect(texts(out.pages[1])).toEqual(['Next']);
  });
  it('a group header never ends a page', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ g: `G${Math.floor(i / 7)}`, name: `n${i}` }));
    const t = table({ groups: [{ expr: '=Fields.g', header: [{ height: 16, cells: [{ value: '=Fields.g' }, null, null] }] }], detail: [{ height: 16, cells: [{ value: '=Fields.name' }, null, null] }] });
    const out = await render(report([t], { data: { rows } }), { fontStore });
    for (const p of out.pages) expect(texts(p).at(-1)).toMatch(/^n/);
  });
});

describe('caps on untrusted sizes (phase 4)', () => {
  it('items in cells share one budget: an unrelated data set in every row stops at the cap', async () => {
    const outer = Array.from({ length: 400 }, (_, i) => ({ id: i }));
    const inner = Array.from({ length: 300 }, (_, i) => ({ k: i }));
    const sets = [{ name: 'Rows', source: 'src', path: '$.rows' }, { name: 'Other', source: 'src', path: '$.other' }];
    const t = table({ columns: [{ width: 100 }, { width: 100 }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '', item: { type: 'table', dataSet: 'Other', columns: [{ width: 90 }], detail: [{ height: 12, cells: [{ value: '=Fields.k' }] }] } }] }] });
    const t0 = Date.now();
    const out = await render(report([t], { data: { rows: outer, other: inner }, def: { dataSets: sets } }), { fontStore });
    expect(out.warnings.join()).toMatch(/more than 100000 rows of items inside cells/);
    expect(Date.now() - t0).toBeLessThan(30000);
  }, 60000);
  it('a pivot with thousands of values keeps the first 50', async () => {
    const { buildPivot } = await import('../../src/engine/items/pivot.js');
    const w = [];
    const p = buildPivot({ name: 'P', rowGroups: [], columnGroups: [], values: Array.from({ length: 5000 }, () => ({ value: '=Count(Fields)' })) }, [{ a: 1 }], { params: {}, globals: {}, dataSets: {} }, { warn: (m) => w.push(m), state: {} });
    expect(p.cols.length).toBe(50);
    expect(w.join()).toMatch(/more than 50 values/);
  });
  it('a band of merged cells over many columns stays linear', async () => {
    const n = 300;
    const t = table({ columns: Array.from({ length: n }, () => ({ width: 2 })), detail: [
      { height: 10, cells: Array.from({ length: n }, () => ({ value: 'x', rowSpan: 2 })) }, { height: 10, cells: Array.from({ length: n }, () => null) }] });
    const rows = Array.from({ length: 300 }, (_, i) => ({ i }));
    const t0 = Date.now();
    await render(report([t], { data: { rows } }), { fontStore });
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 60000);
});
