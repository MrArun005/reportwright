// 0.12.1: what the 1M-row verification found. Rows given as an array are read where they are (no copy, no sort); JSON
// given as text is read row by row; grouped rows that come in order are not sorted (presorted, checked as they pass);
// a data set without declared fields still streams.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '../../src/engine/index.js';
import { planPaged } from '../../src/engine/paged.js';
import { fontStore } from '../helpers.js';

const now = new Date('2026-01-02T03:04:05Z');
const REGIONS = ['North', 'South', 'East', 'West'], TYPES = ['Deposit', 'Fee', 'Interest'];
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, region: REGIONS[i % 4], type: TYPES[i % 3], amount: Math.round(((i * 7919) % 2000) - 1000) / 10 }));
const FIELDS = [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'type', type: 'string' }, { name: 'amount', type: 'number' }];
const total = (label) => [{ height: 15, cells: [{ value: label }, { value: '=CountRows()' }, null, { value: '=Sum(Fields.amount)', style: { format: 'N1' } }] }];
/** a ledger over data (an array, or JSON text) at path; groups: by region, then type */
const ledger = (data, { path, fields = FIELDS, groups } = {}) => ({
  $schema: 'pagewright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data }],
  dataSets: [{ name: 'T', source: 's', ...(path ? { path } : {}), ...(fields ? { fields } : {}) }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'T', x: 0, y: 0, w: 400, h: 40, columns: [{ width: 100 }, { width: 100 }, { width: 100 }, { width: 100 }],
      header: [{ height: 16, cells: ['Id', 'Region', 'Type', 'Amount'].map(value => ({ value })) }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.region' }, { value: '=Fields.type' }, { value: '=Fields.amount', style: { format: 'N1' } }] }],
      footer: total('Total'),
      ...(groups ? { groups: [
        { name: 'R', expr: '=Fields.region', header: [{ height: 16, cells: [{ value: '=Fields.region' }] }], footer: total('Region'), ...groups[0] },
        { name: 'Y', expr: '=Fields.type', header: [{ height: 15, cells: [null, { value: '=Fields.type' }] }], footer: total('Type'), ...groups[1] },
      ] } : {}) }] },
    pageFooter: { height: 18, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 400, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});
const pagesOf = async (def, opts = {}) => {
  const plan = await planPaged(def, { fontStore, now, window: 150, ...opts });
  expect(plan.why).toBeUndefined();
  const out = [];
  for await (const p of /** @type {any} */ (plan).pages()) out.push(JSON.stringify(p.items));
  return out;
};
const wholeOf = async (def) => (await render(def, { fontStore, now })).pages.map(p => JSON.stringify(p.items));

afterEach(() => vi.restoreAllMocks());

describe('rows given in memory', () => {
  it('an array is read where it is: never sorted, copied whole or changed (frozen, behind a proxy that counts)', async () => {
    const rows = rowsOf(1200).map(Object.freeze);
    const seen = { sort: 0, map: 0, filter: 0, concat: 0, longest: 0 };
    const proxy = new Proxy(Object.freeze(rows), {
      get(t, k, r) {
        if (k in seen && k !== 'longest') seen[k]++;
        if (k === 'slice') return (a, b) => { const s = t.slice(a, b); seen.longest = Math.max(seen.longest, s.length); return s; };
        return Reflect.get(t, k, r);
      },
    });
    const got = await pagesOf(ledger(proxy));
    expect(seen).toMatchObject({ sort: 0, map: 0, filter: 0, concat: 0 });
    expect(seen.longest).toBeLessThanOrEqual(1000); // a batch at a time, never the whole array
    expect(got).toEqual(await wholeOf(ledger(rowsOf(1200))));
  });

  it('JSON given as text is read row by row: never parsed whole, the same pages as the parsed array', async () => {
    const rows = rowsOf(3000), text = JSON.stringify({ rows });
    const parse = vi.spyOn(JSON, 'parse');
    const got = await pagesOf(ledger(text, { path: '$.rows' }));
    expect(Math.max(...parse.mock.calls.map(c => String(c[0]).length))).toBeLessThan(text.length / 2); // a batch of 1,000 rows at most
    parse.mockRestore();
    expect(got).toEqual(await wholeOf(ledger(rows)));
  });
});
