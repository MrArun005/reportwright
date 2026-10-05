// REVIEW-ENGINE A11: value axis labels for fractional ticks; daily date categories.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const chart = (extra) => ({ type: 'chart', name: 'C', x: 0, y: 0, w: 320, h: 200, dataSet: 'Rows', chartType: 'column', category: '=Fields.c', series: [{ name: 'V', value: '=Sum(Fields.v)' }], ...extra });
describe('chart labels', () => {
  it('fractional ticks get the decimals the step needs', async () => {
    const r = await render(report([chart()], { data: { rows: [{ c: 'a', v: 0.15 }, { c: 'b', v: 0.35 }, { c: 'c', v: 0.8 }] } }), { fontStore });
    const t = texts(r.pages[0]);
    expect(t).toEqual(expect.arrayContaining(['0.0', '0.2', '0.4', '0.6', '0.8']));
    expect(t.filter(x => x === '0').length).toBe(0);
  });
  it('daily dates read as days, not all "Mar 2026"', async () => {
    const r = await render(report([chart({ category: '=Fields.d' })], { data: { rows: [{ d: '2026-03-01', v: 1 }, { d: '2026-03-02', v: 2 }, { d: '2026-03-03', v: 3 }] } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(expect.arrayContaining(['1 Mar', '2 Mar', '3 Mar']));
  });
  it('a format given keeps it', async () => {
    const r = await render(report([chart({ valueFormat: 'N0' })], { data: { rows: [{ c: 'a', v: 0.15 }, { c: 'c', v: 0.8 }] } }), { fontStore });
    expect(texts(r.pages[0])).toContain('1');
  });
});
