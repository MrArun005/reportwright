// R3-A: VB operators and functions SSRS reports use, natively and through the RDL import (conformance rows).
import { describe, it, expect } from 'vitest';
import { evaluate, compile } from '../../src/engine/expr/evaluate.js';
import { translateExpression as T } from '../../src/importers/rdlx.js';

const ctx = { params: {}, globals: {}, dataSets: {}, fields: { a: null, e: '', s: 'a,b,c', n: 7, x: -7.5 }, locale: 'en-US' };
const ev = (src) => evaluate(compile(src), ctx);
const rdl = (src) => { const t = T(`=${src}`); if (!t.ok) throw new Error(t.notes.join('; ')); return ev(t.value.slice(1)); };

const ROWS = [
  ['7 Mod 3', 1], ['-7 Mod 3', -1], ['7.5 Mod 2', 1.5], ['2 ^ 10', 1024], ['2 ^ 3 ^ 2', 64], ['-2 ^ 2', -4], ['2 * 3 ^ 2', 18],
  ['7 \\ 2', 3], ['-7 \\ 2', -3], ['7.5 \\ 2', 4], ['6.5 \\ 2', 3], ['10 Mod 3 * 2', 4],
  ['Fields!a.Value Is Nothing', true], ['Fields!e.Value Is Nothing', false], ['Fields!n.Value IsNot Nothing', true], ['Nothing Is Nothing', true],
  ['Split(Fields!s.Value, ",")(1)', 'b'], ['Split("x-y-z", "-")(2)', 'z'], ['Fields!s.Value.Split(",")(0)', 'a'],
  ['String.Format("{0:N2} x {1}", 1234.5, "y")', '1,234.50 x y'], ['String.Format("[{0,5}][{0,-5}]", "ab")', '[   ab][ab   ]'], ['String.Format("{{{0}}}", 3)', '{3}'],
  ['String.Format("{0:yyyy-MM-dd}", CDate("2026-03-05"))', '2026-03-05'], ['String.Format("{0:P0}", 0.25)', '25%'],
  ['"7".PadLeft(3, "0")', '007'], ['"ab".PadRight(4, ".")', 'ab..'], ['Hex(255)', 'FF'], ['Hex(-1)', 'FFFFFFFF'], ['Oct(8)', '10'], ['Hex(2.5)', '2'],
  ['InStrRev("abcabc", "b")', 5], ['InStrRev("abcabc", "b", 4)', 2], ['InStrRev("abc", "z")', 0], ['StrReverse("abc")', 'cba'], ['Space(3)', '   '],
  ['Choose(2, "a", "b", "c")', 'b'], ['Choose(9, "a")', null], ['Switch(False, 1, True, 2)', 2], ['IIF(1 > 2, "y", "n")', 'n'],
  ['FormatPercent(0.1234, 1)', '12.3%'], ['FormatNumber(1234.567, 1)', '1,234.6'], ['FormatCurrency(-5)', '-$5.00'],
  ['LSet("ab", 4)', 'ab  '], ['RSet("ab", 4)', '  ab'], ['LSet("abcdef", 3)', 'abc'], ['StrDup(3, "xy")', 'xxx'],
  ['True Xor False', true], ['True Xor True', false], ['Not 1 > 2 AndAlso True', true],
];
describe('VB conformance: native expressions', () => {
  it.each(ROWS.map(([src, want]) => [src.replace(/Fields!(\w+)\.Value/g, 'Fields.$1'), want]))('%s', (src, want) => expect(ev(src)).toEqual(want));
});
describe('VB conformance: through the RDL import', () => {
  it.each(ROWS.filter(([src]) => !/^Nothing Is/.test(src)))('%s', (src, want) => expect(rdl(src)).toEqual(want));
});
describe('errors', () => {
  it('\\ by zero and a bad placeholder raise', () => {
    expect(() => ev('1 \\ 0')).toThrow(/by zero/);
    expect(() => ev('String.Format("{3}", 1)')).toThrow(/no argument/);
    expect(() => ev('String.Format("{0", 1)')).toThrow(/without/);
  });
});
