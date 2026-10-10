// Regression tests for the perf-startup code-review findings (M1, M2, L1, L3, L4, L2).
import { describe, it, expect } from 'vitest';
import { planPaged } from '../../src/engine/paged.js';
import { fontStore } from '../helpers.js';

const now = new Date('2026-01-02T03:04:05Z');
const ledger = () => ({
  $schema: 'reportwright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select id from t' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }] }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 100, h: 40, columns: [{ width: 100 }],
      header: [{ height: 14, cells: [{ value: 'Id' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});
const counted = (rows) => {
  const c = { read: 0 };
  c.sqlRows = () => (async function* () {
    for (let i = 0; i < rows; i += 100) { c.read += 100; yield Array.from({ length: 100 }, (_, k) => ({ id: i + k + 1 })); }
  })();
  return c;
};

describe('M1: an early worker error stops the counting pass', () => {
  it('a parallel "of M" report whose first job fails rejects without reading every row', async () => {
    const c = counted(200000);
    const plan = /** @type {any} */ (await planPaged(ledger(), { fontStore, now, window: 100, sqlRows: c.sqlRows }));
    expect(plan.why).toBeUndefined();
    const run = async () => { throw new Error('worker died'); };
    const e = await (async () => { for await (const _ of plan.pages({ run, parallel: 2 })) { /* drain */ } })().catch(x => x);
    expect(e?.message).toBe('worker died');
    expect(c.read).toBeLessThan(50000);
  });
});
