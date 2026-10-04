// Enterprise 5: a render time limit. A report whose expressions are quadratic in its rows (an aggregate over the whole
// data set repeated in every row) must stop at the limit with a clear error, not hold the server for minutes.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const N = 20000;
const rows = Array.from({ length: N }, (_, i) => ({ id: i, region: ['N', 'S', 'E', 'W'][i % 4], amount: (i * 7) % 1000 }));
// every row of a 20,000-row table sums all 20,000 rows of the data set: 400 million evaluations
const quadratic = () => ({
  ...report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40,
    columns: [{ width: 250 }, { width: 250 }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.amount / Sum(Fields.amount, "Rows")' }] }] }], { data: { rows } }),
});

describe('render time limit', () => {
  it('stops a quadratic report at the limit with a 504 and a clear message', async () => {
    const t0 = Date.now();
    const err = await render(quadratic(), { fontStore, timeoutMs: 500 }).then(() => null, e => e);
    const ms = Date.now() - t0;
    expect(err?.message).toMatch(/ran longer than 0\.5 s/);
    expect(err.status).toBe(504);
    expect(ms).toBeLessThan(5000); // the limit plus unwinding, not the minutes the full render would take
  });

  it('counts subreports against the same deadline', async () => {
    const child = quadratic();
    const parent = report([{ type: 'subreport', name: 'S', x: 0, y: 0, w: 500, h: 40, report: 'child' }]);
    const t0 = Date.now();
    const err = await render(parent, { fontStore, timeoutMs: 400, loadReport: async () => child }).then(() => null, e => e);
    expect(err?.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('leaves ordinary reports alone, and no limit means no limit', async () => {
    const small = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.amount / Sum(Fields.amount, "Rows")' }] }] }], { data: { rows: rows.slice(0, 200) } });
    const m = await render(small, { fontStore, timeoutMs: 5000 });
    expect(m.pages.length).toBeGreaterThan(0);
    expect(m.warnings).toEqual([]);
    expect((await render(small, { fontStore })).pages.length).toBe(m.pages.length);
  });
});

describe('server renders use PW_RENDER_TIMEOUT_MS', () => {
  it('renderTo passes the limit from the environment (default 60 s)', async () => {
    const { renderTimeoutMs } = await import('../../src/server/renderer.js');
    const keep = process.env.PW_RENDER_TIMEOUT_MS;
    try {
      delete process.env.PW_RENDER_TIMEOUT_MS;
      expect(renderTimeoutMs()).toBe(60000);
      process.env.PW_RENDER_TIMEOUT_MS = '1500';
      expect(renderTimeoutMs()).toBe(1500);
      process.env.PW_RENDER_TIMEOUT_MS = 'nope';
      expect(renderTimeoutMs()).toBe(60000);
      process.env.PW_RENDER_TIMEOUT_MS = '300';
      const { renderTo } = await import('../../src/server/renderer.js');
      await expect(renderTo(quadratic(), { format: 'json' })).rejects.toMatchObject({ status: 504 });
    } finally { if (keep === undefined) delete process.env.PW_RENDER_TIMEOUT_MS; else process.env.PW_RENDER_TIMEOUT_MS = keep; }
  });
});
