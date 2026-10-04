import { describe, it, expect } from 'vitest';
import { evalValue } from '../../src/engine/expr/evaluate.js';

const rows = [{ a: 2, k: 'x', f: 5 }, { a: 4, k: 'x', f: 5 }, { a: 4, k: 'y', f: 7 }, { a: null, k: 'z', f: 1 }, { a: 5, k: 'y', f: 7 }, { a: 7, k: 'w', f: 2 }, { a: 9, k: 'w', f: 2 }];
const ctx = (o = {}) => ({ fields: rows[0], aggRows: rows, params: {}, globals: {}, dataSets: { R: rows, Empty: [] }, ...o });
const ev = (s, o) => evalValue(s, ctx(o));

describe('aggregates', () => {
  it('Median and Mode', () => {
    expect(ev('=Median(Fields.a)')).toBe(4.5); // 2 4 4 5 7 9
    expect(ev('=Median(Fields.a)', { aggRows: rows.slice(0, 3) })).toBe(4);
    expect(ev('=Median(Fields.a, "Empty")')).toBeNull();
    expect(ev('=Mode(Fields.a)')).toBe(4);
    expect(ev('=Mode(Fields.k)')).toBe('x'); // x, y and w tie at 2: the first seen wins
    expect(ev('=Mode(Fields.a, "Empty")')).toBeNull();
  });
  it('variance and standard deviation, sample and population', () => {
    expect(ev('=VarP(Fields.a)')).toBeCloseTo(30.8333 / 6, 4);
    expect(ev('=Var(Fields.a)')).toBeCloseTo(30.8333 / 5, 4);
    expect(ev('=StDevP(Fields.a)')).toBeCloseTo(Math.sqrt(30.8333 / 6), 4);
    expect(ev('=StDev(Fields.a)')).toBeCloseTo(Math.sqrt(30.8333 / 5), 4);
    expect(ev('=StDev(Fields.a)', { aggRows: [rows[0]] })).toBeNull();
    expect(ev('=StDevP(Fields.a)', { aggRows: [rows[0]] })).toBe(0);
    expect(ev('=VarP(Fields.a)', { aggRows: [] })).toBeNull();
    expect(ev('=Var(Fields.k)')).toBeNull(); // text is not a number
  });
  it('DistinctSum sums the value once per distinct key', () => {
    expect(ev('=DistinctSum(Fields.k, Fields.f)')).toBe(15);
    expect(ev('=DistinctSum(Fields.k, Fields.f, "Empty")')).toBe(0);
    expect(() => ev('=DistinctSum(Fields.k)')).toThrow(/2 arguments/);
  });
  it('AggregateIf runs an aggregate over the rows that pass', () => {
    expect(ev('=AggregateIf(Fields.k = "y", "Sum", Fields.a)')).toBe(9);
    expect(ev('=AggregateIf(Fields.a > 4, "Count", Fields.a, "R")', { aggRows: [] })).toBe(3);
    expect(ev('=AggregateIf(Fields.a > 100, "Median", Fields.a)')).toBeNull();
    expect(() => ev('=AggregateIf(True, "Nope", Fields.a)')).toThrow(/unknown aggregate/);
  });
  it('every new aggregate takes a scope', () => {
    for (const f of ['Median', 'Mode', 'StDev', 'StDevP', 'Var', 'VarP']) expect(ev(`=${f}(Fields.a, "R")`, { aggRows: [] })).not.toBeNull();
    expect(() => ev('=Median(Fields.a, "Nope")')).toThrow(/does not exist/);
  });
  it('flattens arrays, so Sum and Count read a LookupSet', () => {
    expect(ev('=Sum(Fields.xs)', { aggRows: [{ xs: [1, 2] }, { xs: [3] }] })).toBe(6);
    expect(ev('=Count(Fields.xs)', { aggRows: [{ xs: [1, 2] }, { xs: null }] })).toBe(2);
  });
});
