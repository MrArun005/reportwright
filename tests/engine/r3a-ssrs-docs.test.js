// R3-A: SSRS semantics, DOC-BASED (no SSRS here: there is no Windows machine). Each rule is from Microsoft's
// documentation for VB.NET / SSRS expressions (cited), checked over many generated variants, not one repro.
import { describe, it, expect } from 'vitest';
import { evaluate, compile } from '../../src/engine/expr/evaluate.js';
import { formatValue } from '../../src/engine/expr/format.js';
import { rng } from '../diff/gen.mjs';

const ev = (src, extra = {}) => evaluate(compile(src), { params: {}, globals: {}, dataSets: {}, fields: {}, locale: 'en-US', ...extra });
const R = rng(424242);
const ints = (n, lo = -50, hi = 50) => Array.from({ length: n }, () => R.int(lo, hi));
const halfEven = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f; };

describe('doc-based: VB operators (learn.microsoft.com/dotnet/visual-basic/language-reference/operators)', () => {
  const pairs = ints(120).map((a, i) => [a, ints(1, -9, 9)[0] || 7]);
  it.each(pairs)('Mod Operator: %i Mod %i has the sign of the dividend, a - b * Fix(a / b)', (a, b) => expect(ev(`${a} Mod ${b}`)).toBe(a - b * Math.trunc(a / b) + 0));
  const fr = Array.from({ length: 80 }, () => [R.int(-200, 200) / 4, (R.int(1, 40) / 4) * (R.chance(0.3) ? -1 : 1)]);
  it.each(fr)('\\ Operator: %d \\ %d rounds both operands to Long (banker\'s) and truncates', (a, b) => {
    const y = halfEven(b);
    if (y === 0) return expect(() => ev(`${a} \\ ${b}`)).toThrow();
    expect(ev(`${a} \\ ${b}`)).toBe(Math.trunc(halfEven(a) / y) + 0);
  });
  it.each(ints(40, -6, 6).map(a => [a, R.int(0, 4)]))('^ Operator: %i ^ %i, and -x ^ y is -(x ^ y)', (a, b) => {
    expect(ev(`(${a}) ^ ${b}`)).toBe(a ** b);
    expect(ev(`-${Math.abs(a)} ^ ${b}`)).toBe(-(Math.abs(a) ** b));
  });
  it.each(ints(30).map(a => [a]))('Is Nothing: %i Is Nothing is False, Nothing Is Nothing is True', (a) => { expect(ev(`${a} Is Nothing`)).toBe(false); expect(ev('Nothing Is Nothing')).toBe(true); });
});

describe('doc-based: type conversion (CInt, Round: "rounds to the nearest even number")', () => {
  const xs = Array.from({ length: 100 }, () => R.int(-400, 400) / 2);
  it.each(xs.map(x => [x]))('CInt(%d) rounds half to even', (x) => expect(ev(`CInt(${x})`)).toBe(halfEven(x) + 0));
  it.each(xs.map(x => [x]))('Round(%d) is half to even; MidpointRounding.AwayFromZero is away', (x) => {
    expect(ev(`Round(${x})`)).toBe(halfEven(x) + 0);
    expect(ev(`RoundHalfAway(${x})`)).toBe(Math.sign(x) * Math.round(Math.abs(x)) + 0);
  });
});

describe('doc-based: Nothing (VB: Nothing is the default value of the type)', () => {
  it.each(ints(40).map(a => [a]))('%i + Nothing = %i; Nothing = 0; "" = Nothing', (a) => {
    expect(ev(`${a} + Nothing`)).toBe(a);
    expect(ev('Nothing = 0')).toBe(true);
    expect(ev('"" = Nothing')).toBe(true);
  });
});

describe('doc-based: string functions (Microsoft.VisualBasic.Strings)', () => {
  const words = Array.from({ length: 40 }, () => 'abcdefghij'.slice(0, R.int(0, 10)));
  it.each(words.map(w => [w, R.int(0, 12)]))('Left/Right("%s", %i) clamp to the length; Len counts characters', (w, n) => {
    expect(ev(`Left("${w}", ${n})`)).toBe(w.slice(0, n));
    expect(ev(`Right("${w}", ${n})`)).toBe(n ? w.slice(-n) : '');
    expect(ev(`Len("${w}")`)).toBe(w.length);
  });
  it.each(words.map(w => [w, R.int(1, 12)]))('Mid("%s", %i) from a 1-based start; a start of 0 is an ArgumentException', (w, n) => {
    expect(ev(`Mid("${w}", ${n})`)).toBe(w.slice(n - 1));
    expect(() => ev(`Mid("${w}", 0)`)).toThrow();
  });
  it.each(words.map(w => [w]))('InStr is 1-based (0: not found); InStrRev finds the last; StrReverse reverses: "%s"', (w) => {
    const c = w[R.int(0, Math.max(0, w.length - 1))] || 'z';
    expect(ev(`InStr("${w}", "${c}")`)).toBe(w.indexOf(c) + 1);
    expect(ev(`InStrRev("${w}", "${c}")`)).toBe(w.lastIndexOf(c) + 1);
    expect(ev(`StrReverse("${w}")`)).toBe([...w].reverse().join(''));
  });
  it.each(['Hello', 'WORLD', 'mIxEd'].flatMap(s => ['ell', 'ELL', 'or', 'OR', 'x'].map(t => [s, t])))('String.Contains is ordinal (case-sensitive): "%s".Contains("%s")', (s, t) => expect(ev(`"${s}".Contains("${t}")`)).toBe(s.includes(t)));
  it.each(ints(20, 0, 8).map(i => [i]))('Choose(%i, …) out of range is Nothing', (i) => expect(ev(`Choose(${i}, "a", "b", "c")`)).toBe(i >= 1 && i <= 3 ? 'abc'[i - 1] : null));
});

describe('doc-based: dates (DateTime.AddMonths: "the day is the last valid day of the resulting month")', () => {
  const days = Array.from({ length: 40 }, () => [R.int(2020, 2030), R.int(1, 12), R.int(28, 31)]);
  it.each(days)('DateAdd("m", 1, %i-%i-%i) clamps to the end of the next month', (y, m, d) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(d, last);
    const r = ev(`DateAdd("m", 1, DateSerial(${y}, ${m}, ${day}))`, { timeZone: 'UTC' });
    const nlast = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    expect(r.getUTCDate()).toBe(Math.min(day, nlast));
  });
});

describe('doc-based: standard numeric formats (en-US: N, P, F, D, X)', () => {
  const vals = Array.from({ length: 60 }, () => R.int(-2_000_000, 2_000_000) / 100);
  it.each(vals.map(v => [v]))('%d', (v) => {
    const f = (x, fmt) => formatValue(x, fmt, { locale: 'en-US' });
    expect(f(v, 'N2')).toBe((v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    // .NET Framework rounds the 15-digit decimal form half away from zero: -9245.55 is -9245.6 (toFixed's binary gives .5)
    const away = (x, d) => { const k = 10 ** d, r = Math.sign(x) * Math.round(Number((Math.abs(x) * k).toPrecision(15))) / k; return (r === 0 ? 0 : r).toFixed(d); };
    expect(f(v, 'F1')).toBe(away(v, 1));
    expect(f(Math.trunc(v), 'D8')).toBe((Math.trunc(v) < 0 ? '-' : '') + String(Math.abs(Math.trunc(v))).padStart(8, '0'));
  });
});
