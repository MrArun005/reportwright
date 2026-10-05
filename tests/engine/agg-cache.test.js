// Aggregates over a scope asked in every detail row are computed once per scope instance (not once per row).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, g: `G${i % 4}`, amt: (i % 13) - 6 })) });
const table = (detail, groups) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 54, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }, { width: 100 }],
  header: [{ height: 18, cells: [{ value: 'n' }, { value: 'a' }, { value: 'b' }, { value: 'c' }] }], groups,
  detail: [{ height: 14, cells: detail }] });

describe('aggregate cache', () => {
  it('scope aggregates in detail rows: right values, linear time', async () => {
    const def = report([table([{ value: '=Fields.n' }, { value: '=Max(Abs(Fields.amt), "T")' }, { value: '=Fields.amt / Sum(Abs(Fields.amt), "T")', style: { format: 'P2' } },
      { value: '=RunningValue(Fields.amt, "Sum", "T")' }])], { data: rows(20000) });
    const t0 = performance.now();
    const out = await render(def, { fontStore });
    // per row, uncached: 2 × 20,000 evaluations × 20,000 rows; cached it is a fraction of a second
    expect(performance.now() - t0).toBeLessThan(8000);
    const total = rows(20000).rows.reduce((s, r) => s + Math.abs(r.amt), 0);
    const t = texts(out.pages[0]);
    expect(t.slice(4, 8)).toEqual(['1', '6', `${(-6 / total * 100).toFixed(2)}%`, '-6']);
  });

  it('group totals in detail rows are each group\'s own, also after sort and drill state changes', async () => {
    const group = [{ name: 'G', expr: '=Fields.g', collapsible: true, header: [{ height: 16, cells: [{ value: '=Fields.g' }, { value: '=Sum(Fields.amt)' }, null, null] }] }];
    const def = report([table([{ value: '=Fields.n' }, { value: '=Sum(Fields.amt, "G")' }, { value: '=Count(Fields.n, "G")' }, { value: '=RunningValue(Fields.amt, "Sum", "G")' }], group)], { data: rows(40) });
    const sums = {};
    for (const r of rows(40).rows) sums[r.g] = (sums[r.g] || 0) + r.amt;
    const at = (t, g) => t.findIndex(s => s.endsWith(` ${g}`)); // the header shows "▼ G1"
    const out = await render(def, { fontStore });
    const t = texts(out.pages[0]);
    expect(t[at(t, 'G1') + 1]).toBe(String(sums.G1));
    expect(t[at(t, 'G1') + 3]).toBe(String(sums.G1)); // the first detail row of G1 shows its group's total
    expect(t[at(t, 'G1') + 4]).toBe('10'); // Count over the group: 10 rows
    const collapsed = await render(def, { fontStore, state: { toggles: { 'T|0|/G0': false } } });
    const c = texts(collapsed.pages[0]);
    expect(c[at(c, 'G0') + 2]).toMatch(/G1$/); // G0 collapsed: no detail rows
    expect(c[at(c, 'G2') + 3]).toBe(String(sums.G2));
    const sorted = await render(def, { fontStore, state: { sort: { T: [{ by: '=Fields.amt', dir: 'desc' }] } } });
    expect(texts(sorted.pages[0])).toContain(String(sums.G3));
  });
});
