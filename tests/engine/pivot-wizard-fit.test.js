// #9: the pivot wizard made a matrix wider than the page (110 pt row header + 64 pt per column, w set to the page).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { pivotFor, pivotDrawnWidth } from '../../src/designer/PivotWizard.jsx';
import { fontStore, report } from '../helpers.js';

const ds = {
  name: 'Rows',
  fields: [
    { name: 'region', type: 'string' },
    { name: 'month', type: 'string' },
    { name: 'amount', type: 'number' },
  ],
};
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
const rows = ['North', 'South', 'East'].flatMap((region) =>
  months.map((month, i) => ({ region, month, amount: 100 + i })),
);
const drawnRight = (page) => page.items.reduce((m, i) => Math.max(m, (Number(i.x) || 0) + (Number(i.w) || 0)), 0);

describe('pivot wizard: the matrix fits the page', () => {
  it('8 months + total: narrower columns, and the engine draws it within the page width', async () => {
    const m = pivotFor(ds, {
      rows: ['region'],
      columns: ['month'],
      values: [{ field: 'amount', agg: 'Sum' }],
      width: 523,
      sample: rows,
    });
    expect(pivotDrawnWidth(m, rows)).toBeLessThanOrEqual(523);
    expect(m.w).toBeLessThanOrEqual(523);
    const out = await render(report([{ ...m, name: 'P', x: 0, y: 0 }], { data: { rows } }), { fontStore });
    // the page's left margin is 36
    expect(drawnRight(out.pages[0])).toBeLessThanOrEqual(36 + 523 + 1);
    expect(out.pages.length).toBe(1);
  });
  it('a small pivot keeps the default widths', () => {
    const m = pivotFor(ds, {
      rows: ['month'],
      columns: ['region'],
      values: [{ field: 'amount', agg: 'Sum' }],
      width: 523,
      sample: rows,
    });
    expect(m.columnWidth).toBeUndefined();
    expect(m.rowHeaderWidth).toBeUndefined();
    expect(pivotDrawnWidth(m, rows)).toBe(110 + 4 * 64);
  });
  it('too many columns to fit: the estimate says how wide it draws', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ region: 'N', month: `M${i}`, amount: i }));
    const m = pivotFor(ds, {
      rows: ['region'],
      columns: ['month'],
      values: [{ field: 'amount', agg: 'Sum' }],
      width: 523,
      sample: many,
    });
    expect(pivotDrawnWidth(m, many)).toBeGreaterThan(523);
  });
});
