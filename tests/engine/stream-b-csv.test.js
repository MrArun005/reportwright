// Streaming phase B (docs/research/STREAMING-1M.md §4, §7): the streaming data CSV writes the same bytes as the model
// path (render dataOnly + exportCsv) for every report it accepts, and refuses (falls back) the ones it cannot do.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { planStream } from '../../src/engine/stream.js';
import { exportCsv, writeCsvStream } from '../../src/exporters/csv.js';
import { jsonRows, csvRecords, csvRows } from '../../src/engine/data/stream.js';
import { parseCsv, csvChar } from '../../src/engine/data/index.js';
import { fontStore } from '../helpers.js';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: i % 7 === 0 ? `Ann, "the ${i}"` : `Name ${i}`, city: ['Pune', 'delhi', 'Delhi', 'Chennai', null][i % 5], qty: (i * 37) % 11, price: ((i * 7.31) % 100) - 20, day: `2026-0${1 + (i % 9)}-1${i % 10}`, ok: i % 3 === 0 }));
const report = (table, ds = {}, extra = {}) => ({
  $schema: 'reportwright/report@1', name: 'S', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: rows(523) } }],
  dataSets: [{ name: 'D', source: 'src', path: '$.rows', ...ds }],
  sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Title' }, { type: 'table', name: 'T', dataSet: 'D', x: 0, y: 24, w: 500, h: 40,
    columns: [{ width: 60 }, { width: 140 }, { width: 100 }, { width: 60 }, { width: 70 }, { width: 70 }],
    header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'City' }, { value: 'Qty' }, { value: 'Price' }, { value: 'Day' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.qty' }, { value: '=Fields.price', style: { format: 'N2' } }, { value: '=Fields.day', style: { format: 'd' } }] }],
    footer: [{ height: 14, cells: [{ value: 'Total' }, null, null, { value: '=Sum(Fields.qty)' }, { value: '=Sum(Fields.price)' }, null] }],
    ...table }] } },
  ...extra,
});
const modelCsv = async (def, o = {}) => exportCsv(await render(def, { fontStore, dataOnly: true, ...o }), { locale: def.locale, currency: def.currency });
async function streamCsv(def, o = {}) {
  const plan = await planStream(def, { format: 'csv', ...o });
  if (plan.why) return { why: plan.why };
  let s = '';
  await writeCsvStream(plan, (x) => { s += x; }, { locale: def.locale, currency: def.currency });
  return { csv: s };
}

const CASES = {
  plain: report({}),
  'row filters + sorts': report({ filters: [{ expr: '=Fields.qty', op: '>', value: '=2' }], sort: [{ by: '=Fields.city' }, { by: '=Fields.price', dir: 'desc' }] }, { filters: [{ expr: '=Fields.ok', op: '=', value: '=false' }], sort: [{ by: '=Fields.name' }] }),
  'groups, first seen': report({ groups: [{ name: 'G1', expr: '=Fields.city', header: [{ cells: [{ value: '=Fields.city' }] }], footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }] }] }, { name: 'G2', expr: '=Fields.qty Mod 3' }] }),
  'groups, sorted desc + table sort': report({ sort: [{ by: '=Fields.price' }], groups: [{ name: 'G1', expr: '=Fields.city', sort: 'desc' }] }),
  'calc fields + RowNumber + template': report({ detail: [{ cells: [{ value: '=RowNumber(Nothing)' }, { value: '{Fields.name} ({Fields.total})' }, { value: '=Fields.city & "!"' }, { value: '=Fields.total', style: { format: 'C2' } }, { value: '=Fields.ok' }, { value: '=CDate(Fields.day)' }] }] },
    { fields: [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'city', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'price', type: 'number' }, { name: 'day', type: 'date' }, { name: 'ok', type: 'boolean' }, { name: 'total', type: 'number', expr: '=Fields.qty * Fields.price' }] }, { currency: 'EUR', locale: 'de-DE' }),
  'no rows': report({ filters: [{ expr: '=Fields.qty', op: '>', value: '=100' }] }),
  'colSpan header': report({ header: [{ cells: [{ value: 'Who', colSpan: 2 }, null, { value: 'Where' }, { value: 'Qty' }, { value: 'Price' }, { value: 'Day' }] }, { cells: [{ value: 'Id' }, { value: 'Name' }, null, null, null, null] }] }),
  'csv source': { ...report({}), dataSources: [{ name: 'src', type: 'csv', data: 'id,name,city,qty,price,day\n1,"A, ""x""",Pune,3,1.5,2026-01-02\r\n2,B,Delhi,4,2.25,2026-02-03\n\n3,C,,5,-1,2026-03-04' }], dataSets: [{ name: 'D', source: 'src' }] },
};

describe('streaming data CSV: same bytes as the model path', () => {
  for (const [name, def] of Object.entries(CASES)) {
    it(name, async () => {
      const want = await modelCsv(def);
      const got = await streamCsv(def);
      expect(got.why).toBeUndefined();
      expect(got.csv).toBe(want);
    });
  }
  it('pushed sources and parameters', async () => {
    const def = report({ filters: [{ expr: '=Fields.city', op: '=', value: '=Parameters.c' }] }, {}, { parameters: [{ name: 'c', type: 'string', default: 'Pune' }] });
    const sources = { src: { rows: rows(50) } };
    expect((await streamCsv(def, { sources, parameters: { c: 'Delhi' } })).csv).toBe(await modelCsv(def, { sources, parameters: { c: 'Delhi' } }));
  });
  it('falls back for what it cannot stream', async () => {
    const why = async (def) => (await planStream(def, { format: 'csv' })).why;
    expect(await why(report({ detail: [{ cells: [{ value: '=Fields.qty / Sum(Fields.qty)' }] }] }))).toMatch(/detail/);
    expect(await why(report({ filters: [{ expr: '=Fields.qty', op: 'TopN', value: '=3' }] }))).toMatch(/filters/);
    expect(await why(report({ detail: [{ cells: [{ value: '=Previous(Fields.qty)' }] }] }))).toMatch(/detail/);
    expect(await why(report({ groups: [{ expr: '=Fields.city', sortBy: '=Sum(Fields.qty)' }] }))).toMatch(/group/);
    const two = report({}); two.sections.body.items.push({ ...two.sections.body.items[1], name: 'T2' });
    expect(await why(two)).toMatch(/one table/);
  });
});

describe('row-by-row sources', () => {
  const chunks = (s, n) => (async function* () { const b = new TextEncoder().encode(s); for (let i = 0; i < b.length; i += n) yield b.subarray(i, i + n); })();
  const all = async (it) => { const out = []; for await (const b of it) out.push(...b); return out; };
  it('JSON: rows at a path, split across any chunk boundary (strings with ], escapes, unicode)', async () => {
    const data = { meta: { x: [1, 2], s: 'a]b' }, data: { rows: [{ a: 'x]y,"z"\\', b: 'é😀', c: [1, { d: '}' }] }, { a: null, b: -1.5e3 }, 7, 'str', { k: '\\u00e9' }] }, after: [9] };
    const text = JSON.stringify(data);
    for (const n of [1, 2, 3, 7, 64, 10000]) {
      expect(await all(jsonRows(chunks(text, n), '$.data.rows'))).toEqual(data.data.rows);
      expect(await all(jsonRows(chunks(text, n), '$.data.rows[*]'))).toEqual(data.data.rows);
    }
    expect(await all(jsonRows(chunks(JSON.stringify([{ a: 1 }, { a: 2 }]), 5), '$'))).toEqual([{ a: 1 }, { a: 2 }]);
    expect(await all(jsonRows(chunks('[]', 1), '$'))).toEqual([]);
    // shapes the splitter does not follow are read whole, as jsonPathRows reads them
    expect(await all(jsonRows(chunks(JSON.stringify({ a: 1 }), 3), '$'))).toEqual([{ a: 1 }]);
    expect(await all(jsonRows(chunks(JSON.stringify({ data: { x: { a: 1 } } }), 3), '$.data.x'))).toEqual([{ a: 1 }]);
    expect(await all(jsonRows(chunks(JSON.stringify({ data: [[1], [2]] }), 3), '$.data[0]'))).toEqual([1]);
    expect(await all(jsonRows(chunks(JSON.stringify({ other: [] }), 3), '$.data'))).toEqual([]);
    await expect(all(jsonRows(chunks(JSON.stringify([{ a: 'x'.repeat(5000) }]), 100), '$', { maxElementBytes: 1000 }))).rejects.toThrow(/larger than/);
  });
  it('CSV: the same records as parseCsv, across any chunk boundary', async () => {
    const texts = ['a,b\n1,2', 'a,b\r\n"x,""y""\nz",2\r\n\r\n3,\n', 'h\n"unclosed,\nrest', 'h;k\n"q"tail;2\r3;4\r', '', 'a\n\n\n', 'x,"",y\n"a""b",c'];
    for (const t of texts) for (const n of [1, 2, 5, 1000]) for (const startRow of [1, 2]) {
      const src = { separator: t.includes(';') ? ';' : ',', startRow };
      expect(await all(csvRows(chunks(t, n), src, csvChar)), JSON.stringify([t, n])).toEqual(parseCsv(t, src));
    }
    expect(await all(csvRecords(chunks('a,b\n1,2\n', 1), { sep: ',', quote: '"' }))).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('source caps (review)', () => {
  const chunks = (s, n) => (async function* () { const b = new TextEncoder().encode(s); for (let i = 0; i < b.length; i += n) yield b.subarray(i, i + n); })();
  it('CSV: an unclosed quote cannot take the whole stream into one field', async () => {
    const t = 'a,b\n"' + 'x'.repeat(5000);
    await expect((async () => { for await (const _ of csvRows(chunks(t, 100), {}, csvChar, 1000)) { /* read */ } })()).rejects.toMatchObject({ status: 413 });
  });
  it('rows: maxRows stops the read', async () => {
    const plan = await planStream(CASES.plain, { format: 'csv', maxRows: 100 });
    await expect((async () => { for await (const _ of plan.rows()) { /* read */ } })()).rejects.toMatchObject({ status: 413 });
  });
});

describe('source caps count what is read (review 2)', () => {
  const chunks = (s, n) => (async function* () { const b = new TextEncoder().encode(s); for (let i = 0; i < b.length; i += n) yield b.subarray(i, i + n); })();
  const read = (it) => (async () => { for await (const _ of it) { /* read */ } })();
  it('JSON: one huge string in a row, a row that never ends, deep nesting, a huge prefix before the rows', async () => {
    await expect(read(jsonRows(chunks(`[{"a":"${'x'.repeat(50000)}"}]`, 4096), '$', { maxElementBytes: 10000 }))).rejects.toMatchObject({ status: 413 });
    await expect(read(jsonRows(chunks(`[{"a":[${'1,'.repeat(50000)}`, 4096), '$', { maxElementBytes: 10000 }))).rejects.toMatchObject({ status: 413 });
    await expect(read(jsonRows(chunks(`[${'['.repeat(2000)}`, 4096), '$', { maxDepth: 512 }))).rejects.toMatchObject({ status: 413 });
    await expect(read(jsonRows(chunks(`{"meta":"${'x'.repeat(50000)}","rows":[1]}`, 4096), '$.rows', { maxWholeBytes: 10000 }))).rejects.toMatchObject({ status: 413 });
    await expect(read(jsonRows(chunks(`${'['.repeat(2000)}`, 4096), '$.rows', { maxDepth: 512 }))).rejects.toMatchObject({ status: 413 });
  });
  it('CSV: a line that never ends (many fields, or one) is capped', async () => {
    await expect(read(csvRows(chunks(`a\n${'x,'.repeat(5000)}`, 100), {}, csvChar, 1000))).rejects.toMatchObject({ status: 413 });
    await expect(read(csvRows(chunks(`a\n${'x'.repeat(5000)}`, 100), {}, csvChar, 1000))).rejects.toMatchObject({ status: 413 });
  });
});
