// A column chart draws one bar per category, and every category gets its label when the labels can be turned to fit.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const names = ['Active', 'Overdue', 'Settled', 'Legal', 'Written off', 'Restructured', 'Closed early', 'Pending KYC', 'Disputed'];
const rows = names.map((n, i) => ({ status: n, amt: (i + 1) * 100 }));
const draw = async (extra) => {
  const item = { type: 'chart', name: 'C', x: 0, y: 0, w: 255, h: 160, dataSet: 'Rows', chartType: 'column', category: '=Fields.status', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], ...extra };
  const out = await render(report([item], { data: { rows } }), { exportData: true, fontStore });
  const items = out.pages[0].items;
  return { bars: items.filter(i => i.t === 'rect' && i.fill === '#2563eb'), texts: items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text)), warnings: out.warnings };
};

describe('column chart: bars and category labels', () => {
  it('one bar per category, and every category label is drawn', async () => {
    const { bars, texts, warnings } = await draw({});
    expect(bars.length).toBe(names.length);
    for (const n of names) expect(texts).toContain(n);
    expect(warnings).toEqual([]);
  });

  it('a label that cannot fit flat is turned; a flat angle set by the author is kept, with a warning for the labels that are dropped', async () => {
    const { texts, warnings } = await draw({ axes: { x: { labelAngle: 0 } } });
    expect(names.filter(n => texts.includes(n)).length).toBeLessThan(names.length);
    expect(warnings.join(' ')).toMatch(/category labels do not fit, so they are not shown/);
  });
});
