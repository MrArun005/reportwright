// The data CSV skips pagination (render option dataOnly): the same file as the CSV of the full render, much faster.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { sampleTorture } from '../../src/sample/torture.js';
import { sampleHard } from '../../src/sample/hard.js';
import { fontStore } from '../helpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const testsDir = path.join(root, 'reports/__tests__');
const cases = [];
for (const f of fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json')).sort()) {
  const spec = read(path.join(testsDir, f));
  const file = path.resolve(testsDir, spec.report);
  for (const c of spec.cases || [{ name: 'default' }]) {
    const data = Object.fromEntries(Object.entries(c.data || {}).map(([k, v]) => [k, typeof v === 'string' ? read(path.resolve(testsDir, v)) : v]));
    const def = read(file);
    cases.push([`${f} › ${c.name}`, { ...def, dataSources: (def.dataSources || []).map(s => (s.name in data ? { name: s.name, type: 'json', data: data[s.name] } : s)) },
      { parameters: c.parameters, now: new Date(c.now || '2026-01-01T09:00:00'), state: c.state, loadReport: async (id) => read(path.join(path.dirname(file), `${id}.pw.json`)) }]);
  }
}
const json = (o) => async () => new Response(JSON.stringify(o));
cases.push(['torture-test', read(path.join(root, 'reports/torture-test.pw.json')), { fetch: json(sampleTorture()), now: new Date('2026-01-01T09:00:00') }]);
const hard = { ...read(path.join(root, 'reports/torture-test.pw.json')), dataSources: [{ name: 'big', type: 'json', data: sampleHard(3000) }] };
hard.dataSets = [{ name: 'Tx', source: 'big', path: '$.transactions[*]', fields: ['id', 'accountId', 'date', 'amount', 'ok'].map(name => ({ name, type: name === 'amount' || name === 'id' ? 'number' : name === 'date' ? 'date' : 'string' })) }];
hard.sections = { body: { height: 100, items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Tx', columns: [80, 80, 80, 80, 80].map(width => ({ width })),
  header: [{ height: 18, cells: ['Id', 'Account', 'Date', 'Amount', 'Ok'].map(value => ({ value })) }],
  groups: [{ name: 'G', expr: '=Fields.accountId', header: [{ height: 18, cells: [{ value: '=Fields.accountId' }, {}, {}, { value: '=Sum(Fields.amount)' }, {}] }] }],
  detail: [{ height: 18, cells: [{ value: '=Fields.id', style: { format: '0' } }, { value: '=Fields.accountId' }, { value: '=Fields.date', style: { format: 'dd MMM yyyy' } }, { value: '=Fields.amount', style: { format: 'N2' } }, { value: '=Fields.ok' }] }],
  footer: [{ height: 18, cells: [{ value: 'Total' }, {}, {}, { value: '=Sum(Fields.amount)', style: { format: 'N2' } }, {}] }] }] } };
cases.push(['hard 3000 rows, grouped', hard, {}]);

describe('data CSV without pagination', () => {
  it.each(cases)('%s: identical to the CSV of the full render', async (_, def, o) => {
    let full;
    try { full = await render(def, { fontStore, exportData: true, ...o }); } catch { return; } // needs a server for its data
    const direct = await render(def, { fontStore, ...o, dataOnly: true });
    expect(direct.pages).toEqual([]);
    const csv = exportCsv(full, { locale: def.locale, currency: def.currency });
    if (!direct.regions.length) { expect(full.regions).toEqual([]); return; } // no table: the CSV is the page text, from a full render
    expect(exportCsv(direct, { locale: def.locale, currency: def.currency })).toBe(csv);
    expect(csv.length).toBeGreaterThan(0);
  }, 60000);
});
