// Scatter and bubble axes: the automatic range fits the data with padding, so no point sits on the frame.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const draw = async (extra, rows) => {
  const item = { type: 'chart', name: 'C', x: 0, y: 0, w: 400, h: 260, dataSet: 'Rows', chartType: 'scatter', xValue: '=Fields.x', series: [{ name: 'Y', value: '=Fields.y' }], ...extra };
  const out = await render(report([item], { data: { rows } }), { exportData: true, fontStore });
  const items = out.pages[0].items;
  const texts = items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text));
  const nums = (labels) => labels.map(s => Number(s.replace(/,/g, ''))).filter(Number.isFinite);
  return { items, warnings: out.warnings, ticks: nums(texts), points: items.filter(i => i.t === 'ellipse') };
};

describe('scatter: the automatic axis fits the data', () => {
  it('the top of the y axis is above the largest value (not on it)', async () => {
    // 100 lands on a nice boundary; before the fix the axis stopped at exactly 100, so the point sat on the frame
    const { ticks, warnings } = await draw({}, [{ x: 1, y: 10 }, { x: 2, y: 50 }, { x: 3, y: 100 }]);
    expect(warnings).toEqual([]);
    expect(Math.max(...ticks.filter(t => t <= 1000))).toBeGreaterThan(100);
  });

  it('a point at the largest x sits inside the plot, not on the right edge', async () => {
    const { ticks, points } = await draw({}, [{ x: 0, y: 1 }, { x: 50, y: 2 }, { x: 100, y: 3 }]);
    const xs = points.map(p => p.cx);
    // the right-most point is strictly left of the right-most tick's position (the axis extends past the data)
    expect(Math.max(...ticks.filter(t => t >= 100 && t <= 1000))).toBeGreaterThan(100);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });

  it('bubbles keep the same padded range', async () => {
    const { ticks } = await draw({ chartType: 'bubble', series: [{ name: 'B', value: '=Fields.y', size: '=Fields.x' }] }, [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 100 }]);
    expect(Math.max(...ticks.filter(t => t <= 1000))).toBeGreaterThan(100);
  });

  it('an explicit axis max is honoured as given', async () => {
    const { ticks } = await draw({ axes: { y: { min: 0, max: 100 } } }, [{ x: 1, y: 10 }, { x: 2, y: 50 }]);
    expect(Math.max(...ticks.filter(t => t <= 1000))).toBe(100);
  });
});
