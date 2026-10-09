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
  $schema: 'reportwright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
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

describe('grouped rows', () => {
  // in group order already: region, then type (as a source sorted by region, type gives them)
  const ordered = () => rowsOf(1500).sort((a, b) => a.region.localeCompare(b.region) || a.type.localeCompare(b.type) || a.id - b.id);
  const noSort = () => { throw new Error('sorted'); };
  it('presorted: never sorted, the same pages as the sorted path', async () => {
    const def = ledger(ordered(), { groups: [{}, {}] });
    expect(await pagesOf(def, { presorted: true, sorter: noSort })).toEqual(await pagesOf(def));
    // with the groups in key order (sort: asc) and a sort by the table: checked the same way
    const sortedDef = ledger(ordered().sort((a, b) => a.region.localeCompare(b.region) || a.type.localeCompare(b.type) || b.amount - a.amount || a.id - b.id), { groups: [{ sort: 'asc' }, { sort: 'asc' }] });
    sortedDef.sections.body.items[0].sort = [{ by: '=Fields.amount', dir: 'desc' }];
    expect(await pagesOf(sortedDef, { presorted: true, sorter: noSort })).toEqual(await pagesOf(sortedDef));
  });
  it('presorted rows out of order stop the export, saying so', async () => {
    const rows = ordered();
    rows.push(rows.splice(10, 1)[0]); // a North row at the end, after West's
    await expect(pagesOf(ledger(rows, { groups: [{}, {}] }), { presorted: true })).rejects.toThrow(/not in the report's order \(row 1500/);
    const desc = ledger(ordered(), { groups: [{ sort: 'desc' }, {}] }); // the rows ascend: out of order for desc
    await expect(pagesOf(desc, { presorted: true })).rejects.toThrow(/presorted/);
  });
  it('presorted: Excel and CSV subtotals are the sorted path\'s', async () => {
    const { planStream } = await import('../../src/engine/stream.js');
    const rowsOfPlan = async (o) => { const p = /** @type {any} */ (await planStream(ledger(ordered(), { groups: [{}, {}] }), { format: 'xlsx', now, ...o })); const out = []; for await (const r of p.rows()) out.push(r); return out; };
    const a = await rowsOfPlan({ presorted: true, sorter: noSort });
    expect(a.filter(r => r.kind === 'groupFooter').length).toBe(16); // 4 regions, 12 types in them
    expect(a).toEqual(await rowsOfPlan({}));
  });
});

describe('the engine package (Node)', () => {
  it('a grouped report\'s sort spills to disk by default, and its folder goes when the export ends', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const { exportPdfStream } = await import('../../packages/engine/entry.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwe-'));
    try {
      let spilled = 0;
      const sink = { write: async () => { spilled = Math.max(spilled, fs.readdirSync(dir).filter(n => n.startsWith('pw-spill-')).length); } };
      const def = ledger(rowsOf(20500), { groups: [{}, {}] }); // past one run of 20,000 rows
      def.sections.pageFooter.items[0].value = 'Page {Globals.PageNumber}';
      const r = await exportPdfStream(def, { fonts: fontStore, subset: false, now, spill: { dir } }, sink);
      expect(r.streamed).toBe(true);
      expect(spilled).toBe(1);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});

describe('a data set without declared fields', () => {
  it('streams: its fields are detected from the first rows, as the whole render detects them', async () => {
    const def = ledger(rowsOf(1200), { fields: null });
    expect(await pagesOf(def)).toEqual(await wholeOf(def));
    const grouped = ledger(rowsOf(1200), { fields: null, groups: [{}, {}] });
    expect(await pagesOf(grouped)).toEqual(await wholeOf(grouped));
  });
  it('with no rows to detect them from it is written whole, and the result says so in its warnings', async () => {
    const { exportPdfStream } = await import('../../src/exporters/pdfstream.js');
    const r = await exportPdfStream(ledger([], { fields: null }), { fontStore, now }, { write: async () => {} });
    expect(r).toMatchObject({ streamed: false, why: 'undeclared fields (no rows to detect them from)' });
    expect(r.warnings[0]).toMatch(/^The PDF was not streamed \(undeclared fields/);
  });
});

describe('a large tagged PDF', () => {
  it('tagged.maxElements stops the export past that many structure elements', async () => {
    const { exportPdfStream } = await import('../../src/exporters/pdfstream.js');
    const run = (maxElements) => exportPdfStream(ledger(rowsOf(600)), { fontStore, now, tagged: { lang: 'en', maxElements } }, { write: async () => {} });
    await expect(run(1000)).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/more than 1,000 structure elements \(tagged.maxElements\)/) });
    expect((await run(100000)).streamed).toBe(true);
  });
});
