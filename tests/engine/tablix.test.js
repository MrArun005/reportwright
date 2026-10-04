import { describe, it, expect } from 'vitest';
import { buildPivot, normalizeMatrix, PIVOT_LIMITS } from '../../src/engine/items/pivot.js';

// region, city, year, quarter, amount. Hand totals: North 430, South 570, all 1000; 2025 = 460, 2026 = 540;
// North/2025 = 200, North/Pune/2025 = 70.
const DATA = [
  ['North', 'Pune', 2025, 1, 50], ['North', 'Pune', 2025, 2, 20], ['North', 'Pune', 2026, 1, 60],
  ['North', 'Delhi', 2025, 1, 100], ['North', 'Delhi', 2025, 3, 30], ['North', 'Delhi', 2026, 2, 170],
  ['South', 'Chennai', 2025, 1, 80], ['South', 'Chennai', 2026, 1, 120], ['South', 'Chennai', 2026, 2, 40],
  ['South', 'Kochi', 2025, 2, 180], ['South', 'Kochi', 2026, 1, 90], ['South', 'Kochi', 2026, 3, 60],
].map(([region, city, year, q, amt]) => ({ region, city, year, q, amt }));

const warnings = [];
const lc = (state) => ({ warn: (m) => warnings.push(m), state: state || {} });
const ctx = { params: {}, globals: {}, dataSets: {}, fields: null, locale: 'en-IN', currency: 'INR' };
const pivot = (extra, state, rows = DATA) => buildPivot({ type: 'matrix', name: 'P', ...extra }, rows, ctx, lc(state));

const two = {
  rowGroups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', total: 'after' }, { name: 'City', expr: '=Fields.city', sort: 'asc', total: 'after' }],
  columnGroups: [{ name: 'Year', expr: '=Fields.year', sort: 'asc', total: 'after' }],
  values: [{ value: '=Sum(Fields.amt)' }],
};
/** body as rows of [header texts..., values...] */
const grid = (p) => p.body.map(r => r.cells.map(c => (c.role === 'value' ? c.raw : c.text)));

describe('pivot build', () => {
  it('nests row groups with subtotals and a grand total', () => {
    const p = pivot(two);
    expect(p.R).toBe(2);
    expect(p.cols.map(c => c.kind)).toEqual(['leaf', 'leaf', 'total']);
    expect(grid(p)).toEqual([
      ['North', 'Delhi', 130, 170, 300],
      ['Pune', 70, 60, 130],
      ['Total', 200, 230, 430],
      ['South', 'Chennai', 80, 160, 240],
      ['Kochi', 180, 150, 330],
      ['Total', 260, 310, 570],
      ['Total', 460, 540, 1000],
    ]);
    const north = p.body[0].cells[0];
    expect(north.rowSpan).toBe(3); // Delhi, Pune, North's total
    const grand = p.body[6].cells[0];
    expect([grand.c, grand.colSpan]).toEqual([0, 2]);
    expect(p.body.map(r => r.kind)).toEqual(['leaf', 'leaf', 'total', 'leaf', 'leaf', 'total', 'total']);
  });

  it('puts totals before the instances', () => {
    const p = pivot({ ...two, rowGroups: [two.rowGroups[0], { ...two.rowGroups[1], total: 'before' }] });
    expect(grid(p).slice(0, 3)).toEqual([['North', 'Total', 200, 230, 430], ['Delhi', 130, 170, 300], ['Pune', 70, 60, 130]]);
  });

  it('nests column groups: header rows with spans', () => {
    const p = pivot({ ...two, columnGroups: [two.columnGroups[0], { name: 'Q', expr: '=Fields.q', sort: 'asc', label: '="Q" & Fields.q', total: 'none' }] });
    expect(p.header.length).toBe(2);
    expect(p.header[0].map(c => [c.text, c.colSpan, c.rowSpan])).toEqual([['', 2, 2], ['2025', 3, 1], ['2026', 3, 1], ['Total', 1, 2]]);
    expect(p.header[1].map(c => c.text)).toEqual(['Q1', 'Q2', 'Q3', 'Q1', 'Q2', 'Q3']);
    // North / Pune: 2025 Q1 50, Q2 20, Q3 –; 2026 Q1 60
    expect(grid(p)[1]).toEqual(['Pune', 50, 20, null, 60, null, null, 130]);
  });

  it('several values: one sub-column each and a value-label row', () => {
    const p = pivot({ ...two, rowGroups: [two.rowGroups[0]], values: [{ label: 'Amount', value: '=Sum(Fields.amt)' }, { label: 'Orders', value: '=Count(Fields)' }] });
    expect(p.header.length).toBe(2);
    expect(p.header[1].map(c => c.text)).toEqual(['Amount', 'Orders', 'Amount', 'Orders', 'Amount', 'Orders']);
    expect(grid(p)[0]).toEqual(['North', 200, 4, 230, 2, 430, 6]);
  });

  it('percent of total, row and column', () => {
    const p = pivot({ ...two, rowGroups: [two.rowGroups[0]], values: [
      { value: '=Sum(Fields.amt)', show: 'percentOfTotal' }, { value: '=Sum(Fields.amt)', show: 'percentOfRow' }, { value: '=Sum(Fields.amt)', show: 'percentOfColumn' }] });
    const [, t, r, c] = grid(p)[0]; // North / 2025
    expect(t).toBeCloseTo(0.2, 10);
    expect(r).toBeCloseTo(200 / 430, 10);
    expect(c).toBeCloseTo(200 / 460, 10);
    expect(grid(p)[2].slice(-3)).toEqual([1, 1, 1]); // grand total
  });

  it('collapses a row instance into one aggregated row, and a column instance into one column', () => {
    const p = pivot({ ...two, rowGroups: [{ ...two.rowGroups[0], collapsible: true }, two.rowGroups[1]] }, { toggles: { 'P|r0|/North': false } });
    expect(grid(p)[0]).toEqual(['North', 200, 230, 430]);
    expect(p.body[0].cells[0].colSpan).toBe(2);
    expect(p.body[0].cells[0].toggle).toEqual({ key: 'P|r0|/North', open: false });
    expect(p.body[1].cells[0].toggle).toEqual({ key: 'P|r0|/South', open: true });

    const q = pivot({ ...two, rowGroups: [two.rowGroups[0]], columnGroups: [{ ...two.columnGroups[0], collapsible: true, initiallyCollapsed: true }, { name: 'Q', expr: '=Fields.q', sort: 'asc' }] });
    expect(q.header[0].map(c => [c.text, c.rowSpan])).toEqual([['', 2], ['2025', 2], ['2026', 2], ['Total', 2]]);
    expect(grid(q)[0]).toEqual(['North', 200, 230, 430]);
  });

  it('labels are data, never expressions or templates', () => {
    const p = pivot({ ...two, rowGroups: [{ expr: '=Fields.k' }], columnGroups: [] }, null, [{ k: '=1+1', amt: 1 }, { k: '{Fields.amt}', amt: 2 }]);
    expect(p.body.map(r => r.cells[0].text)).toEqual(['=1+1', '{Fields.amt}']);
  });

  it('scopes: a group scope is that instance across the other axis (RDL)', () => {
    const p = pivot({ ...two, values: [{ value: '=Sum(Fields.amt) / Sum(Fields.amt, "Region")' }] });
    expect(grid(p)[1][1]).toBeCloseTo(70 / 430, 10); // Pune 2025 over all of North
  });

  it('caps leaf columns and cells', () => {
    warnings.length = 0;
    const rows = Array.from({ length: 2000 }, (_, i) => ({ k: i, r: i % 3, amt: 1 }));
    const p = pivot({ rowGroups: [{ expr: '=Fields.r' }], columnGroups: [{ expr: '=Fields.k' }], values: [{ value: '=Sum(Fields.amt)' }] }, null, rows);
    expect(p.cols.length).toBe(PIVOT_LIMITS.columns);
    expect(warnings.some(w => /value columns is more than 1000/.test(w))).toBe(true);
    warnings.length = 0;
    const many = Array.from({ length: 1000 }, (_, i) => ({ r: i, c: i % 400, amt: 1 }));
    const q = pivot({ rowGroups: [{ expr: '=Fields.r' }], columnGroups: [{ expr: '=Fields.c' }], values: [{ value: '=Sum(Fields.amt)' }] }, null, many);
    expect(q.body.length * q.cols.length).toBeLessThanOrEqual(PIVOT_LIMITS.cells);
    expect(warnings.some(w => /cells is more than/.test(w))).toBe(true);
  });

  it('normalizes the old single-group form', () => {
    expect(normalizeMatrix({ rowGroup: '=Fields.a', columnGroup: '=Fields.b', value: '=Sum(Fields.x)', valueFormat: 'N0', columnTotals: false, rowSort: 'desc' })).toMatchObject({
      legacy: true, overflow: 'shrink',
      rowGroups: [{ expr: '=Fields.a', sort: 'desc', total: 'none' }], columnGroups: [{ expr: '=Fields.b', total: 'after' }], values: [{ value: '=Sum(Fields.x)', format: 'N0' }],
    });
    expect(normalizeMatrix({ rowGroups: [] }).overflow).toBe('paginate');
  });

  it('is linear: 50,000 rows pivot fast', () => {
    const rows = Array.from({ length: 50000 }, (_, i) => ({ region: `R${i % 6}`, city: `C${i % 60}`, year: 2020 + (i % 5), q: 1 + (i % 4), amt: i % 97 }));
    const t0 = Date.now();
    const p = pivot({ rowGroups: [{ expr: '=Fields.region', total: 'after' }, { expr: '=Fields.city', total: 'after' }], columnGroups: [{ expr: '=Fields.year', total: 'after' }, { expr: '=Fields.q', total: 'after' }], values: [{ value: '=Sum(Fields.amt)' }, { value: '=Count(Fields)' }] }, null, rows);
    const ms = Date.now() - t0;
    expect(p.body.length).toBe(60 + 6 + 1);
    expect(ms).toBeLessThan(3000);
  });
});
