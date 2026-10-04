// Designer gaps found by rebuilding the Torture Test in the Designer (after Phase 8).
import { describe, it, expect } from 'vitest';
import { detectFields, coerce } from '../../src/engine/data/index.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

describe('list fields (#1)', () => {
  it('detection: an array of values is a list; an array of objects is not a field', () => {
    const f = detectFields([{ id: 1, history: [3, 5, 2], items: [{ a: 1 }], name: 'x' }]);
    expect(f).toEqual([{ name: 'id', type: 'number' }, { name: 'history', type: 'list' }, { name: 'name', type: 'string' }]);
  });
  it('a list field: arrays as they are, text split at commas', () => {
    expect(coerce([1, 2], 'list')).toEqual([1, 2]);
    expect(coerce('3, 5;2.5,x', 'list')).toEqual([3, 5, 2.5, 'x']);
    expect(coerce(7, 'list')).toEqual([7]);
  });
  it('a sparkline over a list field needs no Split()', async () => {
    const def = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 36, columns: [{ width: 200 }],
      detail: [{ height: 18, cells: [{ visual: { type: 'sparkline', values: '=Fields.trend' } }] }] }],
    { data: { rows: [{ trend: '1,4,2,8' }] }, def: { dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', fields: [{ name: 'trend', type: 'list' }] }] } });
    const m = await render(def, { fontStore });
    expect(m.warnings).toEqual([]);
    expect(m.pages[0].items.some(i => i.t === 'path' || i.t === 'polyline' || (i.t === 'line'))).toBe(true);
  });
});
