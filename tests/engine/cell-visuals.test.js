// Cell visuals sit on their row's first text line; numbers that round to zero have no minus sign.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { formatValue } from '../../src/engine/expr/format.js';
import { fontStore, report } from '../helpers.js';

const data = { rows: [{ n: 'A long name that wraps onto three lines in this narrow column', v: 40 }, { n: 'B', v: -0.00001 }] };
const table = (visual) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 260, h: 34, dataSet: 'Rows', columns: [{ width: 60 }, { width: 80 }, { width: 120 }],
  header: [{ height: 18, cells: [{ value: 'Name' }, { value: 'Value' }, { value: 'Visual' }] }],
  detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.v' }, { value: '', visual }] }] });

describe('cell visuals', () => {
  it('an icon set fits the text line, not the cell width or a tall row', async () => {
    const out = await render(report([table({ type: 'iconset', value: '=Fields.v', iconSet: 'arrows' })], { data }), { fontStore });
    const arrow = out.pages[0].items.find(i => i.t === 'path' && i.fill === '#f59e0b'); // 40: between 33 and 67
    const ys = arrow.d.match(/[\d.]+ ([\d.]+)/g).map(p => Number(p.split(' ')[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(9 * 1.25); // one line of 9 pt text
  });

  it('a data bar\'s value sits on the same baseline as its neighbours', async () => {
    const out = await render(report([table({ type: 'databar', value: '=Fields.v', max: '=100' })], { data }), { fontStore });
    const t = out.pages[0].items.filter(i => i.t === 'text');
    const name = t.find(i => i.lines[0].text.startsWith('A long'));
    const col = t.find(i => i.lines[0].text === 'Visual').lines[0].x - 4; // the visual column's left edge (padding 2)
    const value = t.find(i => i.lines[0].text === '40' && i.lines[0].x > col);
    expect(value.lines[0].y).toBeCloseTo(name.lines[0].y, 1);
  });

  it('-0.0% is 0.0%', () => {
    expect(formatValue(-0.00001, 'P1')).toBe('0.0%');
    expect(formatValue(-0.0001, 'N2')).toBe('0.00');
    expect(formatValue(-0.0004, '0.0%')).toBe('0.0%');
    expect(formatValue(-0.5, 'P1')).toBe('-50.0%');
  });
});

describe('data bar labels', () => {
  // the visual column is 120 wide; a label after the bar end when it fits in the cell, else inside the bar, right-aligned
  const bars = (vals, visual = {}) => {
    const rows = vals.map((v, i) => ({ n: 'R' + i, v }));
    return render(report([table({ type: 'databar', value: '=Fields.v', max: '=100', ...visual })], { data: { rows } }), { fontStore }).then(out => {
      const t = out.pages[0].items.filter(i => i.t === 'text');
      const col = t.find(i => i.lines[0].text === 'Visual').lines[0].x - 4;
      const bar = out.pages[0].items.filter(i => i.t === 'rect' && i.fill.endsWith('cc'));
      return { col, bar, label: (s) => t.find(i => i.lines[0].text === s && i.lines[0].x > col).lines[0] };
    });
  };

  it('a label that fits after a short bar sits after it in the normal text colour', async () => {
    const { bar, label, col } = await bars([40]);
    const l = label('40');
    expect(l.x).toBeCloseTo(bar[0].x + bar[0].w + 3, 1);
    expect(l.x + l.w).toBeLessThanOrEqual(col + 120);
  });

  it('a wide label on a half bar is shrunk to sit inside it, ending 3 before the bar end (it used to overlap the tail)', async () => {
    const { bar, label, col } = await bars([1234567.89], { max: '=2469135.78', format: 'N2' });
    const l = label('1,234,567.89');
    const end = bar[0].x + bar[0].w;
    expect(l.x + l.w).toBeLessThanOrEqual(end - 3 + 0.01);
    expect(l.x).toBeGreaterThanOrEqual(bar[0].x);
    expect(l.x + l.w).toBeLessThanOrEqual(col + 120);
  });
});
