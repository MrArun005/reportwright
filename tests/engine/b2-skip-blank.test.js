// B2 item 6: a filter can be skipped when its value (a parameter) is blank, without the IIF(Len(Coalesce(…))) trick.
import { describe, it, expect } from 'vitest';
import { applyFilters } from '../../src/engine/data/index.js';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = [{ n: 'a', city: 'Pune', v: 5 }, { n: 'b', city: 'Delhi', v: 9 }, { n: 'c', city: 'Pune', v: 1 }];
const run = (filters, params) => applyFilters(rows, filters, { params, globals: {}, dataSets: {} }).map(r => r.n).join('');
const city = { expr: '=Fields.city', op: '=', value: '=Parameters.City' };

describe('skipBlank filters', () => {
  it('a blank parameter: the filter is skipped (all rows); without skipBlank nothing matches', () => {
    for (const blank of ['', null, undefined]) {
      expect(run([{ ...city, skipBlank: true }], { City: blank })).toBe('abc');
      expect(run([city], { City: blank })).toBe('');
    }
  });
  it('a value: the filter applies as usual', () => {
    expect(run([{ ...city, skipBlank: true }], { City: 'Pune' })).toBe('ac');
  });
  it('Between skips when either bound is blank; an empty multi-value list is blank', () => {
    const btw = { expr: '=Fields.v', op: 'Between', value: '=Parameters.Lo', value2: '=Parameters.Hi', skipBlank: true };
    expect(run([btw], { Lo: 2, Hi: '' })).toBe('abc');
    expect(run([btw], { Lo: 2, Hi: 9 })).toBe('ab');
    expect(run([{ expr: '=Fields.city', op: 'in', value: '=Parameters.C', skipBlank: true }], { C: [] })).toBe('abc');
  });
  it('a report with a skipBlank filter validates and renders every row when the parameter is empty', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 300, dataSet: 'S', columns: [{ width: 300 }], h: 20, detail: [{ height: 16, cells: [{ value: '=Fields.n' }] }] }]);
    def.parameters = [{ name: 'City', type: 'string', nullable: true }];
    def.dataSources = [{ name: 'src', type: 'json', data: rows }];
    def.dataSets = [{ name: 'S', source: 'src', filters: [{ ...city, skipBlank: true }] }];
    expect(validate(def).errors || []).toEqual([]);
    const m = await render(def, { fontStore, params: { City: '' } });
    expect(texts(m.pages[0]).filter(t => /^[abc]$/.test(t))).toEqual(['a', 'b', 'c']);
  });
});
