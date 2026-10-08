// Scatter and bubble points: a row with no x or y is not drawn (never at 0), and points outside an explicit axis
// range are marked and warned about instead of being pinned to the edge silently.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const draw = async (extra, rows) => {
  const item = { type: 'chart', name: 'C', x: 0, y: 0, w: 400, h: 260, dataSet: 'Rows', chartType: 'scatter', xValue: '=Fields.x', series: [{ name: 'Y', value: '=Fields.y' }], ...extra };
  const out = await render(report([item], { data: { rows } }), { exportData: true, fontStore });
  const items = out.pages[0].items;
  const texts = items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text));
  const nums = (labels) => labels.map(s => Number(s.replace(/,/g, ''))).filter(Number.isFinite);
  return { items, warnings: out.warnings, ticks: nums(texts), points: items.filter(i => i.t === 'ellipse' && i.fill !== 'none') };
};

describe('scatter: rows with no x or y are not drawn', () => {
  it('a null or blank x or y is skipped, not plotted at 0, and warned about once', async () => {
    const rows = [{ x: 1, y: 10 }, { x: 2, y: null }, { x: null, y: 30 }, { x: 4, y: '' }, { x: 5, y: 50 }];
    const { points, warnings } = await draw({}, rows);
    expect(points.length).toBe(2); // before the fix all five were drawn, three of them at 0
    expect(warnings.filter(w => /rows have no x or y value/.test(w))).toEqual(['C: 3 of 5 rows have no x or y value and are not drawn']);
  });

  it('a complete data set draws every point and warns nothing', async () => {
    const { points, warnings } = await draw({}, [{ x: 1, y: 10 }, { x: 2, y: 20 }]);
    expect(points.length).toBe(2);
    expect(warnings.some(w => /no x or y value/.test(w))).toBe(false);
  });
});
