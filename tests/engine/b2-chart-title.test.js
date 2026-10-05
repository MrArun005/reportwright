// B2 item 9: a chart title longer than the chart shrinks, then wraps; it is not cut to "click a ba…".
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const chart = (title, w) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w, h: 200, chartType: 'column', title, category: '=Fields.k', series: [{ value: '=Sum(Fields.v)' }], dataSet: 'S' }]);
const withData = (d) => ({ ...d, dataSources: [{ name: 'src', type: 'json', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] }], dataSets: [{ name: 'S', source: 'src', fields: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }] }] });

describe('chart titles fit', () => {
  it('a short title is drawn as before, whole', async () => {
    const t = texts((await render(withData(chart('Sales', 300)), { fontStore })).pages[0]);
    expect(t).toContain('Sales');
  });
  it('a long title wraps onto two lines with every word kept', async () => {
    const title = 'Click a bar to filter the table below by that month';
    const t = texts((await render(withData(chart(title, 180)), { fontStore })).pages[0]);
    expect(t.some(s => s.includes('…'))).toBe(false);
    const words = title.split(' ');
    const joined = t.join(' ');
    for (const w of words) expect(joined).toContain(w);
  });
});
