// #11: a data bar draws nothing for a null value (no bar, no "0"); as a cell item its bars compare across the column
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const rows = [{ n: 'a', v: 10 }, { n: 'b', v: null }, { n: 'c', v: 50 }, { n: 'd' }];
const table = (cell) => ({
  type: 'table',
  name: 'T',
  dataSet: 'Rows',
  x: 0,
  y: 0,
  w: 300,
  h: 18,
  columns: [{ width: 100 }, { width: 200 }],
  detail: [{ height: 18, cells: [{ value: '=Fields.n' }, cell] }],
});
const shapes = (m) =>
  m.pages[0].items.filter((i) => (i.t === 'rect' && i.x >= 100) || (i.t === 'text' && i.lines?.[0]?.x >= 100));

describe('data bar: a null value', () => {
  for (const [form, cell] of [
    ['visual', { value: '', visual: { type: 'databar', value: '=Fields.v' } }],
    ['item', { value: '', item: { type: 'databar', name: 'Bar', value: '=Fields.v' } }],
  ]) {
    it(`as a cell ${form}: two bars and two labels for two values, nothing for null and missing`, async () => {
      const m = await render(report([table(cell)], { data: { rows } }), { fontStore });
      const s = shapes(m);
      const bars = s.filter((i) => i.t === 'rect');
      const labels = s.filter((i) => i.t === 'text').map((i) => i.lines[0].text);
      expect(bars).toHaveLength(2);
      expect(labels).toEqual(['10', '50']);
    });
    it(`as a cell ${form}: the bars compare (10 is a fifth of 50)`, async () => {
      const m = await render(report([table(cell)], { data: { rows } }), { fontStore });
      const [a, c] = shapes(m).filter((i) => i.t === 'rect');
      expect(a.w / c.w).toBeCloseTo(0.2, 2);
    });
  }
  it('a data bar item outside a table with a null value draws nothing', async () => {
    const m = await render(
      report([{ type: 'databar', name: 'Bar', x: 100, y: 0, w: 100, h: 18, value: '=Fields.v', dataSet: 'Rows' }], {
        data: { rows: [{ v: null }] },
      }),
      { fontStore },
    );
    expect(shapes(m)).toEqual([]);
  });
});
