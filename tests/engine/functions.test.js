import { describe, it, expect } from 'vitest';
import { evalValue, FUNCTION_NAMES } from '../../src/engine/expr/evaluate.js';

// Phase 3 function library: one row per case. NOW is Sunday 4 Oct 2026, 13:45:30; Fields.d is Saturday 28 Feb 2026, 09:05:07.
const NOW = new Date(2026, 9, 4, 13, 45, 30);
const ctx = { fields: { n: null, e: '', d: new Date(2026, 1, 28, 9, 5, 7) }, params: {}, globals: { ExecutionTime: NOW }, dataSets: {}, locale: 'en-IN' };
const ev = (s, o = {}) => evalValue(s, { ...ctx, ...o });

const CASES = [
  // text
  ['=StartsWith("Pagewright", "Page")', true], ['=StartsWith("Pagewright", "page")', false], ['=StartsWith(Fields.n, "a")', false], ['=EndsWith("abc", "bc")', true], ['=EndsWith(Fields.e, "")', true],
  ['=IndexOf("banana", "an")', 1], ['=IndexOf("banana", "an", 2)', 3], ['=IndexOf("banana", "x")', -1], ['=IndexOf(Fields.n, "x")', -1],
  ['=LastIndexOf("banana", "an")', 3], ['=LastIndexOf("banana", "an", 2)', 1],
  ['=Substring("abcdef", 2)', 'cdef'], ['=Substring("abcdef", 2, 3)', 'cde'], ['=Substring("abc", 5)', ''], ['=Substring(Fields.n, 1)', ''],
  ['=PadLeft("7", 3, "0")', '007'], ['=PadRight("ab", 4)', 'ab  '], ['=PadLeft("abcd", 2)', 'abcd'], ['=PadLeft(Fields.n, 2, "*")', '**'],
  ['=Join(Split("a;b;;c", ";"), "|")', 'a|b||c'], ['=Count(Split("a,b", ","))', 2], ['=Split(Fields.n, ",")', []], ['=Split("a,b", "")', ['a,b']],
  ['=Chr(65)', 'A'], ['=Chr(8377)', '₹'], ['=Chr(-1)', null], ['=Chr(Fields.n)', null], ['=Asc("A")', 65], ['=Asc("")', null], ['=Asc(Fields.n)', null],
  ['=TrimStart("  a ")', 'a '], ['=TrimEnd("  a ")', '  a'], ['=TrimEnd(Fields.n)', ''], ['=StrReverse("abc")', 'cba'], ['=StrReverse(Fields.n)', ''],
  ['=LCase("AB")', 'ab'], ['=UCase("ab")', 'AB'], ['=Space(3)', '   '],
  // math
  ['=Sign(-3)', -1], ['=Sign(0)', 0], ['=Sign(2.5)', 1], ['=Sign(Fields.n)', null],
  ['=Log(E())', 1], ['=Log(8, 2)', 3], ['=Log(0)', null], ['=Log(-1)', null], ['=Log10(1000)', 3], ['=Exp(0)', 1], ['=Exp(Fields.n)', null],
  ['=Truncate(-2.7)', -2], ['=Fix(2.7)', 2], ['=Truncate(Fields.n)', null],
  ['=Round(Sin(PI() / 2), 6)', 1], ['=Round(Cos(0), 6)', 1], ['=Round(Tan(0), 6)', 0], ['=Round(Asin(1), 4)', 1.5708], ['=Round(Acos(1), 4)', 0],
  ['=Round(Atan(1), 4)', 0.7854], ['=Round(Atan2(1, 1), 4)', 0.7854], ['=Asin(2)', null], ['=Round(PI, 4)', 3.1416], ['=Round(E, 4)', 2.7183],
  // dates
  ['=DatePart("yyyy", Fields.d)', 2026], ['=DatePart("q", Fields.d)', 1], ['=DatePart("m", Fields.d)', 2], ['=DatePart("y", Fields.d)', 59], ['=DatePart("d", Fields.d)', 28],
  ['=DatePart("w", Fields.d)', 7], ['=DatePart("ww", CDate("2026-01-03"))', 1], ['=DatePart("ww", CDate("2026-01-04"))', 2], ['=DatePart("h", Fields.d)', 9],
  ['=DatePart("n", Fields.d)', 5], ['=DatePart("s", Fields.d)', 7], ['=DatePart("day", Fields.n)', null],
  ['=Weekday(Fields.d)', 7], ['=Weekday(Fields.d, 2)', 6], ['=Weekday(Fields.n)', null], ['=WeekdayName(1)', 'Sunday'], ['=WeekdayName(2, True)', 'Mon'], ['=WeekdayName(1, False, 2)', 'Monday'], ['=WeekdayName(9)', null],
  ['=Quarter(CDate("2026-11-02"))', 4], ['=QuarterName(CDate("2026-11-02"))', 'Q4'], ['=Quarter("garbage")', null],
  ['=Hour(Fields.d)', 9], ['=Minute(Fields.d)', 5], ['=Second(Fields.d)', 7], ['=Hour(Fields.n)', null],
  ['=Day(AddMonths(CDate("2026-01-31"), 1))', 28], ['=Month(AddMonths(CDate("2026-01-31"), -2))', 11], ['=Year(AddYears(CDate("2024-02-29"), 1))', 2025], ['=Day(AddYears(CDate("2024-02-29"), 1))', 28],
  ['=Day(AddDays(CDate("2026-01-31"), 1))', 1], ['=Hour(AddDays(Fields.d, 0.5))', 21], ['=Hour(AddHours(Fields.d, 15))', 0], ['=Minute(AddMinutes(Fields.d, 60))', 5], ['=Second(AddSeconds(Fields.d, 3))', 10],
  ['=AddDays(Fields.n, 1)', null], ['=AddDays("garbage", 1)', null], ['=DateValue("garbage")', null], ['=Hour(DateValue("2026-03-01T10:00:00"))', 0], ['=Day(DateValue("2026-03-01"))', 1],
  ['=Format(TimeSerial(13, 5, 0), "HH:mm")', '13:05'], ['=Format(TimeSerial(25, 0, 0), "HH")', '01'], ['=Format(TimeSerial(0, -1, 0), "HH:mm")', '23:59'], ['=DateString()', '10-04-2026'],
  // inspection
  ['=IsNumeric("12.5")', true], ['=IsNumeric(" 7 ")', true], ['=IsNumeric(3)', true], ['=IsNumeric("")', false], ['=IsNumeric("1e3")', true], ['=IsNumeric("abc")', false],
  ['=IsNumeric(Fields.n)', false], ['=IsNumeric(Fields.d)', false], ['=IsNumeric(True)', false],
  ['=IsDate("2026-03-01")', true], ['=IsDate("1 March 2026")', true], ['=IsDate("1")', false], ['=IsDate("2026-02-30")', false], ['=IsDate(Fields.d)', true], ['=IsDate(Fields.n)', false], ['=IsDate(5)', false],
  ['=IsArray(Split("a", ","))', true], ['=IsArray("a")', false], ['=IsArray(Fields.n)', false],
  // program flow
  ['=Choose(2, "a", "b", "c")', 'b'], ['=Choose(4, "a", "b", "c")', null], ['=Choose(0, "a")', null], ['=Choose(Fields.n, "a")', null], ['=Choose(1, "a", Fields.nope)', 'a'],
  // conversion
  ['=ToString(5)', '5'], ['=ToString(0.5, "P0")', '50%'], ['=ToString(Fields.n)', ''], ['=ToInt32("2.5")', 2], ['=ToInt32(3.5)', 4], ['=ToInt32(-2.5)', -2], ['=ToInt32(Fields.n)', null], ['=ToInt32(True)', 1],
  ['=ToInt16("12")', 12], ['=ToInt64(1e15)', 1e15], ['=ToDouble("1,234.5")', 1234.5], ['=ToDouble(Fields.n)', null], ['=ToDecimal("2.50")', 2.5], ['=ToSingle("0.25")', 0.25],
  ['=ToBoolean("true")', true], ['=ToBoolean("False")', false], ['=ToBoolean(0)', false], ['=ToBoolean(2)', true], ['=ToBoolean(Fields.n)', null],
  ['=Year(ToDateTime("2026-03-01"))', 2026], ['=ToDateTime(Fields.n)', null],
];

describe('function library', () => {
  it.each(CASES)('%s', (src, want) => expect(ev(src)).toEqual(want));
  it('conversions that cannot convert are errors', () => {
    for (const s of ['=ToInt32("abc")', '=ToInt32(3000000000)', '=ToInt16(40000)', '=ToDouble("x")', '=ToDouble("")', '=ToBoolean("maybe")', '=ToDateTime("nope")']) expect(() => ev(s), s).toThrow();
  });
  it('rejects unknown DatePart intervals', () => expect(() => ev('=DatePart("fortnight", Fields.d)')).toThrow(/interval/));
  it('caps generated strings at 1,000,000 characters', () => {
    for (const s of ['=PadLeft("a", 2000000)', '=PadRight("a", 1e9, "x")', '=Space(2000000)']) expect(() => ev(s), s).toThrow(/1,000,000/);
    expect(() => ev('=StrReverse(Fields.big)', { fields: { big: 'x'.repeat(1_000_001) } })).toThrow(/1,000,000/);
  });
  it('a pad character is one character', () => expect(ev('=PadLeft("1", 3, "ab")')).toBe('aa1'));
  it('WeekdayName follows the report locale', () => expect(ev('=WeekdayName(1)', { locale: 'fr-FR' })).toBe('dimanche'));
  it('lists the new names for the designer', () => {
    for (const n of ['StartsWith', 'PadLeft', 'Atan2', 'PI', 'DatePart', 'AddMonths', 'IsNumeric', 'Choose', 'ToInt32', 'Median', 'AggregateIf']) expect(FUNCTION_NAMES).toContain(n);
  });
});
