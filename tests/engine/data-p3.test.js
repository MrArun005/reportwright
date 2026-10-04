import { describe, it, expect } from 'vitest';
import { applyFilters, parseCsv, loadSources, buildDataSets, jsonPathRows } from '../../src/engine/data/index.js';
import { render, parameterOptions } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = [{ n: 'a', v: 5, d: '2026-01-05' }, { n: 'b', v: 9, d: '2026-02-01' }, { n: 'c', v: 9, d: '2026-03-01' }, { n: 'd', v: 1, d: '2026-01-31' }, { n: 'e', v: null, d: null }, { n: 'f', v: 7, d: '2026-02-28' }];
const base = { params: { k: 2 }, globals: {}, dataSets: {} };
const f = (filters) => applyFilters(rows, filters, base).map(r => r.n).join('');

describe('filter operators', () => {
  it('TopN keeps ties and row order; nulls drop out', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 1 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 2 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 3 }])).toBe('bcf');
    expect(f([{ expr: '=Fields.v', op: 'topn', value: '=Parameters.k' }])).toBe('bc');
  });
  it('BottomN', () => expect(f([{ expr: '=Fields.v', op: 'BottomN', value: 2 }])).toBe('ad'));
  it('TopPercent and BottomPercent round the count up', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 40 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 41 }])).toBe('bcf');
    expect(f([{ expr: '=Fields.v', op: 'BottomPercent', value: 20 }])).toBe('d');
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 500 }])).toBe('abcdf');
  });
  it('huge, zero and negative N', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 1e12 }])).toBe('abcdf');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 0 }])).toBe('');
    expect(f([{ expr: '=Fields.v', op: 'BottomN', value: -3 }])).toBe('');
    expect(() => f([{ expr: '=Fields.v', op: 'TopN', value: 'many' }])).toThrow(/needs a number/);
  });
  it('ranks dates and text', () => {
    expect(f([{ expr: '=CDate(Fields.d)', op: 'TopN', value: 2 }])).toBe('cf');
    expect(f([{ expr: '=Fields.n', op: 'BottomN', value: 2 }])).toBe('ab');
  });
  it('Between is inclusive, with value2 or a [low, high] array', () => {
    expect(f([{ expr: '=Fields.v', op: 'Between', value: 5, value2: 7 }])).toBe('af');
    expect(f([{ expr: '=Fields.v', op: 'between', value: '=Split("1,5", ",")' }])).toBe('ad');
    expect(f([{ expr: '=CDate(Fields.d)', op: 'Between', value: '=CDate("2026-02-01")', value2: '=CDate("2026-02-28")' }])).toBe('bf');
    expect(f([{ expr: '=Fields.v', op: 'Between', value: 5 }])).toBe('');
  });
  it('filters run in the order listed', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 3 }, { expr: '=Fields.v', op: '<', value: 9 }])).toBe('f');
    expect(f([{ expr: '=Fields.v', op: '<', value: 9 }, { expr: '=Fields.v', op: 'TopN', value: 3 }])).toBe('adf');
  });
  it('stays fast on many rows with a huge N', () => {
    const many = Array.from({ length: 200000 }, (_, i) => ({ v: (i * 7919) % 1000 }));
    const t0 = Date.now();
    expect(applyFilters(many, [{ expr: '=Fields.v', op: 'TopN', value: 1e9 }], base)).toHaveLength(200000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('CSV options', () => {
  it('separator, tab, quote, header row, start row', () => {
    expect(parseCsv('a;b\n1;"x;y"\n', { separator: ';' })).toEqual([{ a: '1', b: 'x;y' }]);
    expect(parseCsv('a\tb\r\n1\t2', { separator: 'tab' })).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a\tb\n1\t2', { separator: '\t' })).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv("a,b\n'1,2',3", { quote: "'" })).toEqual([{ a: '1,2', b: '3' }]);
    expect(parseCsv('1,2\n3,4,5', { headerRow: false })).toEqual([{ Column1: '1', Column2: '2', Column3: '' }, { Column1: '3', Column2: '4', Column3: '5' }]);
    expect(parseCsv('title\n\nname,v\nx,1', { startRow: 3 })).toEqual([{ name: 'x', v: '1' }]);
    expect(parseCsv('skip\n1|2', { startRow: 2, headerRow: false, separator: '|' })).toEqual([{ Column1: '1', Column2: '2' }]);
  });
  it('quoted fields: doubled quotes, separators and CR, LF, CRLF inside', () => {
    expect(parseCsv('a,b\r\n"x ""q""","l1\r\nl2"\r\n')).toEqual([{ a: 'x "q"', b: 'l1\r\nl2' }]);
    expect(parseCsv('a,b\r1,2\r')).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a,b\n,\n"",x\n')).toEqual([{ a: '', b: '' }, { a: '', b: 'x' }]);
  });
  it('a quote inside a bare field is data; text after a closing quote is kept', () => {
    expect(parseCsv('a\n5" pipe\n')).toEqual([{ a: '5" pipe' }]);
    expect(parseCsv('a,b\n"x"y,2')).toEqual([{ a: 'xy', b: '2' }]);
    expect(parseCsv('a\n"never closed, at all\nstill')).toEqual([{ a: 'never closed, at all\nstill' }]);
  });
  it('stays linear on hostile input', () => {
    const t0 = Date.now();
    parseCsv('"'.repeat(400001));
    parseCsv('a\n' + '"x"""'.repeat(100000) + ',\n'.repeat(100000));
    parseCsv('a,b\n' + 'x\n'.repeat(200000));
    expect(Date.now() - t0).toBeLessThan(2000);
    // a wide header over many short lines would build rows × columns cells: refused, quickly
    const t1 = Date.now();
    expect(() => parseCsv(','.repeat(9999) + '\n' + 'x\n'.repeat(200000))).toThrow(/5,000,000 cells/);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
  it('refuses bad options and too many columns', () => {
    expect(() => parseCsv('a', { separator: '::' })).toThrow(/one character/);
    expect(() => parseCsv('a', { separator: '\n' })).toThrow(/one character/);
    expect(() => parseCsv('a', { separator: '"' })).toThrow(/differ/);
    expect(() => parseCsv(','.repeat(10001))).toThrow(/10000 columns/);
  });
  it('a csv source passes its options', async () => {
    const out = await loadSources({ dataSources: [{ name: 's', type: 'csv', data: 'x;y\n1;2', separator: ';' }] }, { params: {} });
    expect(out.s).toEqual([{ x: '1', y: '2' }]);
  });
});

describe('nested data sets and Parent after a spread', () => {
  const orders = { orders: [
    { id: 1, cust: 'A', items: [{ sku: 'p', q: 2 }, { sku: 'q', q: 1 }] },
    { id: 2, cust: 'B', items: [{ sku: 'r', q: 5 }] },
    { id: 3, cust: 'C', items: [] },
  ] };
  const sets = [
    { name: 'Orders', source: 'src', path: '$.orders[*]', fields: [{ name: 'id', type: 'number' }, { name: 'cust', type: 'string' }] },
    { name: 'Items', relation: { parent: 'Orders', path: '$.items[*]' }, fields: [{ name: 'sku', type: 'string' }, { name: 'q', type: 'number' }, { name: 'cust', type: 'string', expr: '=Parent.cust' }] },
  ];
  const tb = (value, extra = {}) => ({ type: 'textbox', name: `t${Math.random()}`, x: 0, y: 0, w: 200, h: 14, value, ...extra });

  it('builds the children of every parent row, with Parent.* to the parent row', () => {
    const built = buildDataSets({ dataSets: sets }, { src: orders }, { params: {}, globals: {}, dataSets: {} });
    expect(built.Items.map(r => `${r.sku}/${r.cust}`)).toEqual(['p/A', 'q/A', 'r/B']);
  });
  it('a table bound to the child inside a list bound to the parent shows that row\'s children', async () => {
    const table = { type: 'table', name: 'T', x: 0, y: 14, w: 200, h: 14, dataSet: 'Items', columns: [{ width: 200 }], noRowsText: 'none',
      detail: [{ height: 14, cells: [{ value: '=Fields.sku & " " & Parent.id' }] }], footer: [{ height: 14, cells: [{ value: '="sum " & Sum(Fields.q)' }] }] };
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 42, dataSet: 'Orders', items: [tb('="#" & Fields.id'), table, tb('="n " & Count(Fields.sku)', { y: 28, dataSet: 'Items' })] };
    const r = await render(report([list], { data: orders, def: { dataSets: sets } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['#1', 'p 1', 'q 1', 'sum 3', 'n 2', '#2', 'r 2', 'sum 5', 'n 1', '#3', 'none', 'sum 0', 'n 0']);
  });
  it('at top level the child data set has every child, Parent.* still works', async () => {
    const table = { type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 14, dataSet: 'Items', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.sku & " " & Parent.cust' }] }] };
    const r = await render(report([table], { data: orders, def: { dataSets: sets } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['p A', 'q A', 'r B']);
  });
  it('a grouped list of the parent shows the children of every row in the group', async () => {
    const data = { orders: [{ id: 1, g: 'x', items: [{ sku: 'a' }] }, { id: 2, g: 'x', items: [{ sku: 'b' }] }, { id: 3, g: 'y', items: [{ sku: 'c' }] }] };
    const ds = [{ name: 'Orders', source: 'src', path: '$.orders[*]', fields: [{ name: 'id', type: 'number' }, { name: 'g', type: 'string' }] },
      { name: 'Items', relation: { parent: 'Orders', path: '$.items[*]' }, fields: [{ name: 'sku', type: 'string' }] }];
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 14, dataSet: 'Orders', groupBy: '=Fields.g', items: [tb('=Count(Fields.sku) & " " & First(Fields.sku) & "-" & Last(Fields.sku)', { dataSet: 'Items' })] };
    const r = await render(report([list], { data, def: { dataSets: ds } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['2 a-b', '1 c-c']);
  });
  it('children of filtered-out parents are not built; child filters and sorts apply', () => {
    const ds = [{ ...sets[0], filters: [{ expr: '=Fields.id', op: '<>', value: 1 }] }, { ...sets[1], sort: [{ by: '=Fields.q', dir: 'desc' }] }];
    const built = buildDataSets({ dataSets: ds }, { src: orders }, { params: {}, globals: {}, dataSets: {} });
    expect(built.Items.map(r => r.sku)).toEqual(['r']);
  });
  it('Parent.* after a [*] spread reaches the object that held the array', () => {
    const src = { portfolio: { books: [{ book: 'Rates', positions: [{ id: 1 }, { id: 2 }] }, { book: 'FX', positions: [{ id: 3 }] }] } };
    const ds = [{ name: 'P', source: 'src', path: '$.portfolio.books[*].positions[*]', fields: [{ name: 'id', type: 'number' }, { name: 'book', type: 'string', expr: '=Coalesce(Parent.book, "book?")' }] }];
    const built = buildDataSets({ dataSets: ds }, { src }, { params: {}, globals: {}, dataSets: {} });
    expect(built.P.map(r => `${r.id}${r.book}`)).toEqual(['1Rates', '2Rates', '3FX']);
    expect(jsonPathRows(src, '$.portfolio.books[*]').parents[0]).toBe(src.portfolio);
    expect(jsonPathRows(src, '$.portfolio').parents).toBeNull();
  });
  it('a list row still wins over the spread parent (tables in a list filter by Parent.id)', async () => {
    const data = { rows: [{ id: 1 }, { id: 2 }], kids: [{ pid: 1, n: 'a' }, { pid: 2, n: 'b' }, { pid: 1, n: 'c' }] };
    const ds = [{ name: 'Rows', source: 'src', path: '$.rows[*]' }, { name: 'Kids', source: 'src', path: '$.kids[*]' }];
    const table = { type: 'table', name: 'T', x: 0, y: 14, w: 200, h: 14, dataSet: 'Kids', columns: [{ width: 200 }], filters: [{ expr: '=Fields.pid', op: '=', value: '=Parent.id' }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] };
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 28, dataSet: 'Rows', items: [tb('=Fields.id'), table] };
    const r = await render(report([list], { data, def: { dataSets: ds } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['1', 'a', 'c', '2', 'b']);
  });
  it('validate: the parent must be declared above; a relation needs no source', () => {
    expect(validate(report([], { def: { dataSets: [sets[1], sets[0]] } })).errors.join()).toMatch(/must be a data set declared above/);
    expect(validate(report([], { def: { dataSets: sets } })).errors).toEqual([]);
  });
  it('parameter choices from a nested data set load its parent too', async () => {
    const def = report([], { data: orders, def: { dataSets: sets, parameters: [{ name: 's', optionsFrom: { dataSet: 'Items', value: '=Fields.sku' } }] } });
    expect((await parameterOptions(def)).s.map(o => o.value)).toEqual(['p', 'q', 'r']);
  });
});
