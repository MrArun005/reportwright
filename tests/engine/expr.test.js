import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine/expr/parser.js';
import { evalValue, checkValue } from '../../src/engine/expr/evaluate.js';
import { formatValue } from '../../src/engine/expr/format.js';

const rows = [{ amt: 10, st: 'Paid' }, { amt: 20, st: 'Due' }, { amt: 30.5, st: 'Paid' }];
const ctx = (o = {}) => ({ fields: rows[0], aggRows: rows, params: { p: 5 }, globals: { PageNumber: 2, TotalPages: 9 }, dataSets: { Rows: rows }, locale: 'en-IN', currency: 'INR', ...o });

describe('parser', () => {
  it('respects precedence', () => expect(evalValue('=1 + 2 * 3', ctx())).toBe(7));
  it('handles unary minus and parentheses', () => expect(evalValue('=-(2 + 3) * 2', ctx())).toBe(-10));
  it('reports a useful error', () => expect(() => parse('1 +')).toThrow(/ends too early/));
  it('rejects unknown names', () => expect(() => evalValue('=foo', ctx())).toThrow(/Unknown name/));
  it('never evaluates JS', () => expect(() => evalValue('=constructor.constructor("return 1")()', ctx())).toThrow());
});

describe('values and templates', () => {
  it('reads fields, parameters and globals', () => {
    expect(evalValue('=Fields.amt', ctx())).toBe(10);
    expect(evalValue('=Parameters.p * 2', ctx())).toBe(10);
    expect(evalValue('Page {Globals.PageNumber} of {Globals.TotalPages}', ctx())).toBe('Page 2 of 9');
  });
  it('keeps literal braces', () => expect(evalValue('{{x}} {1+1}', ctx())).toBe('{x} 2'));
  it('throws for a missing field', () => expect(() => evalValue('=Fields.nope', ctx())).toThrow(/does not exist/));
  it('checks syntax without running', () => { expect(checkValue('=1 +')).toMatch(/ends too early/); expect(checkValue('ok {1}')).toBeNull(); });
});

describe('functions', () => {
  it('aggregates over the scope', () => {
    expect(evalValue('=Sum(Fields.amt)', ctx())).toBe(60.5);
    expect(evalValue('=Count(Fields.amt)', ctx())).toBe(3);
    expect(evalValue('=Avg(Fields.amt)', ctx())).toBeCloseTo(20.1667, 3);
    expect(evalValue('=Sum(IIF(Fields.st = "Paid", Fields.amt, 0))', ctx())).toBe(40.5);
    expect(evalValue('=CountDistinct(Fields.st)', ctx())).toBe(2);
    expect(evalValue('=Max(Fields.amt, "Rows")', ctx({ aggRows: [] }))).toBe(30.5);
  });
  it('computes running values and row numbers', () => {
    expect(evalValue('=RunningValue(Fields.amt, "Sum")', ctx({ fields: rows[1], rowNumber: 2, aggIndex: 1 }))).toBe(30);
    expect(evalValue('=RowNumber()', ctx({ rowNumber: 3 }))).toBe(3);
  });
  it('evaluates IIF lazily', () => expect(evalValue('=IIF(True, 1, Fields.nope)', ctx())).toBe(1));
  it('handles text and dates', () => {
    expect(evalValue('=Upper(Left("reportwright", 6))', ctx())).toBe('REPORT');
    expect(evalValue('=Mid("abcdef", 2, 3)', ctx())).toBe('bcd');
    expect(evalValue('=DateDiff("d", CDate("2026-01-01"), CDate("2026-03-01"))', ctx())).toBe(59);
    expect(evalValue('=Month(DateAdd("m", 1, CDate("2026-01-31")))', ctx())).toBe(2); // VB clamps to 28 Feb (JS setMonth rolled into March)
  });
  it('treats null safely', () => {
    // VB semantics by default: Nothing is 0 in arithmetic, x / 0 is Infinity; nullPropagation: true keeps SQL nulls
    expect(evalValue('=Fields.x + 1', ctx({ fields: { x: null } }))).toBe(1);
    expect(evalValue('=Fields.x + 1', ctx({ fields: { x: null }, nullPropagation: true }))).toBeNull();
    expect(evalValue('="a" & Fields.x & "b"', ctx({ fields: { x: null } }))).toBe('ab');
    expect(evalValue('=1 / 0', ctx())).toBe(Infinity);
    expect(evalValue('=1 / 0', ctx({ nullPropagation: true }))).toBeNull();
  });
});

describe('formats', () => {
  it('formats Indian currency and grouping', () => {
    const IN = { locale: 'en-IN' }; // the locale names the country, so "C" is in rupees
    expect(formatValue(1200000, 'C0', IN)).toBe('₹12,00,000');
    expect(formatValue(1234567.891, 'N2', IN)).toBe('12,34,567.89');
    expect(formatValue(0.1234, 'P1', IN)).toBe('12.3%');
    expect(formatValue(7, 'D3', IN)).toBe('007');
    expect(formatValue(1234.5, '#,##0.00', IN)).toBe('1,234.50');
  });
  it('assumes en-US and USD when nothing is set (1.0.1: as the designer shows and the README says)', () => {
    expect(formatValue(1234.5, 'C2')).toBe('$1,234.50');
    expect(formatValue(1234.5, 'C2', { locale: null })).toBe('$1,234.50');
    expect(formatValue(1234.5, 'C2', { currency: 'EUR' })).toBe('€1,234.50');
    expect(formatValue(1234567.891, 'N2')).toBe('1,234,567.89');
    expect(formatValue(1234.5, 'C2', { locale: 'en' })).toBe('1,234.50');
    expect(formatValue(1234.5, 'C2', { locale: 'de-DE' })).toMatch(/^1\.234,50\s€$/); // the culture's own currency
  });
  it('formats dates', () => {
    const d = new Date(2026, 9, 3, 14, 5);
    expect(formatValue(d, 'dd MMM yyyy')).toBe('03 Oct 2026');
    expect(formatValue(d, 'dddd, d MMMM yyyy hh:mm tt')).toBe('Saturday, 3 October 2026 02:05 PM');
  });
  it('uses another locale and currency', () => expect(formatValue(1234.5, 'C2', { locale: 'en-US', currency: 'USD' })).toBe('$1,234.50'));
});
