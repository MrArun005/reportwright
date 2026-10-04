// A chart's "Show at most N" (maxCategories) can be a number, a parameter or an expression; filters and sort apply first.
import { describe, it, expect } from 'vitest';
import { chartData } from '../../src/engine/items/chart.js';

const rows = [{ r: 'A', v: 5 }, { r: 'B', v: 9 }, { r: 'C', v: 1 }, { r: 'D', v: 7 }];
const lc = { dataSets: { S: rows }, warn: () => {} };
const ctx = { params: { top: 2 }, globals: {}, dataSets: { S: rows }, fields: null };
const chart = (extra) => ({ type: 'chart', name: 'C', dataSet: 'S', category: '=Fields.r', series: [{ name: 'v', value: '=Sum(Fields.v)' }], ...extra });

describe('chart: show at most N', () => {
  it('takes a number, a parameter or an expression', () => {
    expect(chartData(chart({ maxCategories: 3 }), ctx, lc).categories).toEqual(['A', 'B', 'C']);
    expect(chartData(chart({ maxCategories: '=Parameters.top' }), ctx, lc).categories).toEqual(['A', 'B']);
    expect(chartData(chart({ maxCategories: '=Parameters.top + 1' }), ctx, lc).categories).toEqual(['A', 'B', 'C']);
    expect(chartData(chart({ maxCategories: '=0' }), ctx, lc).categories).toHaveLength(4); // 0 or empty: all
  });
  it('the top N by value: sort the rows, then show at most N', () => {
    const d = chartData(chart({ sort: [{ by: '=Fields.v', dir: 'desc' }], maxCategories: '=Parameters.top' }), ctx, lc);
    expect(d.categories).toEqual(['B', 'D']);
  });
  it('filters run first', () => {
    const d = chartData(chart({ filters: [{ expr: '=Fields.v', op: '>', value: '4' }] }), ctx, lc);
    expect(d.categories).toEqual(['A', 'B', 'D']);
  });
});
