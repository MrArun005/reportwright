// REVIEW-ENGINE B2 and C2, C4, C7 (legend order), C8: small display fixes.
import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/engine/expr/format.js';
import { javaPattern } from '../../src/importers/java.js';
import { buildPivot } from '../../src/engine/items/pivot.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

describe('display details', () => {
  it('ja-JP currency uses ¥ (U+00A5), which the fonts have', () => {
    expect(formatValue(1234, 'C0', { locale: 'ja-JP' })).toBe('¥1,234');
  });
  it('a date with a time of day shows the time when no format is given', () => {
    expect(formatValue(new Date(Date.UTC(2026, 2, 5, 14, 30)), null, { timeZone: 'UTC' })).toBe('05 Mar 2026 2:30 PM');
    expect(formatValue(new Date(Date.UTC(2026, 2, 5)), null, { timeZone: 'UTC' })).toBe('05 Mar 2026');
    expect(formatValue(new Date(Date.UTC(2026, 2, 5, 2)), 'HH:mm zzz', { timeZone: 'Asia/Kolkata' })).toBe('07:30 +05:30');
  });
  it('an empty matrix intersection counts 0; a sum stays blank', () => {
    const p = buildPivot({ type: 'matrix', name: 'M', rowGroups: [{ expr: '=Fields.r', total: 'none' }], columnGroups: [{ expr: '=Fields.c', total: 'none' }], values: [{ value: '=Count(Fields.v)' }, { value: '=Sum(Fields.v)' }] },
      [{ r: 'a', c: 'x', v: 1 }, { r: 'b', c: 'y', v: 2 }], { params: {}, globals: {}, dataSets: {}, fields: null }, { warn: () => {}, state: {} });
    expect(p.body[0].cells.filter(c => c.role === 'value').map(c => c.raw)).toEqual([1, 1, 0, null]);
  });
  it('series groups in the legend sort naturally (1, 2, 10)', async () => {
    const rows = [10, 2, 1].map(s => ({ c: 'a', s, v: 1 }));
    const r = await render(report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 320, h: 200, dataSet: 'Rows', chartType: 'column', category: '=Fields.c', seriesGroup: '=Fields.s', series: [{ name: 'V', value: '=Sum(Fields.v)' }] }], { data: { rows } }), { fontStore });
    const t = texts(r.pages[0]);
    expect(t.indexOf('1') < t.indexOf('2') && t.indexOf('2') < t.indexOf('10')).toBe(true);
  });
  it('JRXML date letters k, K, Z and u no longer map to the wrong field', () => {
    expect(javaPattern('kk:mm', 'date')).toBe('HH:mm');
    expect(javaPattern('KK:mm a', 'date')).toBe('hh:mm tt');
    expect(javaPattern('HH:mm Z', 'date')).toBe('HH:mm zzz');
    expect(javaPattern('u', 'date')).toBe('ddd');
  });
});
