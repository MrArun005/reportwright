import { describe, it, expect } from 'vitest';
import { applyFilters } from '../../src/engine/data/index.js';

const rows = [{ n: 'a', v: 5, d: '2026-01-05' }, { n: 'b', v: 9, d: '2026-02-01' }, { n: 'c', v: 9, d: '2026-03-01' }, { n: 'd', v: 1, d: '2026-01-31' }, { n: 'e', v: null, d: null }, { n: 'f', v: 7, d: '2026-02-28' }];
const base = { params: { k: 2 }, globals: {}, dataSets: {} };
const f = (filters) => applyFilters(rows, filters, base).map(r => r.n).join('');

describe('filter operators', () => {
  it('TopN keeps ties and row order; nulls drop out', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 1 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 2 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 3 }])).toBe('bcf');
    expect(f([{ expr: '=Fields.v', op: 'topn', value: '=Parameters.k' }])).toBe('bc');
  });
  it('BottomN', () => expect(f([{ expr: '=Fields.v', op: 'BottomN', value: 2 }])).toBe('ad'));
  it('TopPercent and BottomPercent round the count up', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 40 }])).toBe('bc');
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 41 }])).toBe('bcf');
    expect(f([{ expr: '=Fields.v', op: 'BottomPercent', value: 20 }])).toBe('d');
    expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 500 }])).toBe('abcdf');
  });
  it('huge, zero and negative N', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 1e12 }])).toBe('abcdf');
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 0 }])).toBe('');
    expect(f([{ expr: '=Fields.v', op: 'BottomN', value: -3 }])).toBe('');
    expect(() => f([{ expr: '=Fields.v', op: 'TopN', value: 'many' }])).toThrow(/needs a number/);
  });
  it('ranks dates and text', () => {
    expect(f([{ expr: '=CDate(Fields.d)', op: 'TopN', value: 2 }])).toBe('cf');
    expect(f([{ expr: '=Fields.n', op: 'BottomN', value: 2 }])).toBe('ab');
  });
  it('Between is inclusive, with value2 or a [low, high] array', () => {
    expect(f([{ expr: '=Fields.v', op: 'Between', value: 5, value2: 7 }])).toBe('af');
    expect(f([{ expr: '=Fields.v', op: 'between', value: '=Split("1,5", ",")' }])).toBe('ad');
    expect(f([{ expr: '=CDate(Fields.d)', op: 'Between', value: '=CDate("2026-02-01")', value2: '=CDate("2026-02-28")' }])).toBe('bf');
    expect(f([{ expr: '=Fields.v', op: 'Between', value: 5 }])).toBe('');
  });
  it('filters run in the order listed', () => {
    expect(f([{ expr: '=Fields.v', op: 'TopN', value: 3 }, { expr: '=Fields.v', op: '<', value: 9 }])).toBe('f');
    expect(f([{ expr: '=Fields.v', op: '<', value: 9 }, { expr: '=Fields.v', op: 'TopN', value: 3 }])).toBe('adf');
  });
  it('stays fast on many rows with a huge N', () => {
    const many = Array.from({ length: 200000 }, (_, i) => ({ v: (i * 7919) % 1000 }));
    const t0 = Date.now();
    expect(applyFilters(many, [{ expr: '=Fields.v', op: 'TopN', value: 1e9 }], base)).toHaveLength(200000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
