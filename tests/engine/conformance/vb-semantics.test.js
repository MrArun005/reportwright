// VB.NET / SSRS expression conformance.
//
// Each row is an SSRS (VB) expression, run the way an imported report runs it: translated by the RDL/ActiveReports
// importer (translateExpression), then evaluated by the ReportWright engine. The expected value is what SSRS gives,
// from the documented VB.NET runtime (Microsoft.VisualBasic.DateAndTime / Strings / Conversion, System.Math,
// .NET Framework format strings, which is what the SSRS report server runs).
//
// Row kinds:
//   ok(vb, want)                 ReportWright matches VB.
//   unsure(vb, want, why)        the expected value is our best reading of the docs, not verified against SSRS.
//   dev(vb, pw, vbValue, why)    a deliberate difference: ReportWright gives `pw`, VB gives `vbValue`. Listed in
//                                the report of the change that added this suite; each row says why.
// The locale is en-US with USD unless a row says otherwise (the default of an SSRS server in the US).
import { describe, it, expect } from 'vitest';
import { vb } from './vb.js';

const ok = (src, want) => ({ src, want });
const unsure = (src, want, why) => ({ src, want, unsure: why });
const dev = (src, pw, vbValue, why) => ({ src, want: pw, vbValue, why });
const ERR = Symbol('error'); // VB raises an exception: the SSRS cell shows #Error

/** Runs a table of rows; returns the rows for the size count. */
function table(name, rows, ctx) {
  describe(name, () => {
    for (const r of rows) {
      const label = `${r.src}${r.unsure ? '  [unsure]' : ''}${r.why ? '  [deviation]' : ''}`;
      it(label, () => {
        if (r.want === ERR) { expect(() => vb(r.src, ctx)).toThrow(); return; }
        const got = vb(r.src, ctx);
        if (typeof r.want === 'number' && typeof got === 'number' && !Number.isInteger(r.want)) expect(got).toBe(r.want);
        else expect(got).toEqual(r.want);
      });
    }
  });
  return rows;
}

const F = (e) => `=Format(${e}, "yyyy-MM-dd HH:mm:ss")`;

/* ----------------------------------------------------------------------------------------------- DateAdd
 * DateAndTime.DateAdd: Year/Quarter/Month go through Calendar.AddYears/AddMonths, which keep the day and clamp it to
 * the last day of the target month (31 Jan + 1 month = 28 Feb). "Number ... can contain a fractional part when
 * Interval specifies hours, minutes, or seconds. For other values of Interval, any fractional part of Number is
 * ignored." Day, DayOfYear ("y") and Weekday ("w") all add days; WeekOfYear ("ww") adds weeks. DateTime arithmetic
 * is wall-clock (a DateTime has no time zone), so adding a day across a DST change keeps the time of day.
 */
const DATEADD = table('DateAdd (DateAndTime.DateAdd)', [
  ok(F('DateAdd("m", 1, CDate("2025-01-31"))'), '2025-02-28 00:00:00'),
  ok(F('DateAdd("m", 1, CDate("2024-01-31"))'), '2024-02-29 00:00:00'),
  ok(F('DateAdd("m", -1, CDate("2025-03-31"))'), '2025-02-28 00:00:00'),
  ok(F('DateAdd("m", 13, CDate("2025-01-31"))'), '2026-02-28 00:00:00'),
  ok(F('DateAdd("m", 1, #1/31/2025 14:30:00#)'), '2025-02-28 14:30:00'),
  ok(F('DateAdd(DateInterval.Month, 2, CDate("2025-12-31"))'), '2026-02-28 00:00:00'),
  ok(F('DateAdd("q", 1, CDate("2025-11-30"))'), '2026-02-28 00:00:00'),
  ok(F('DateAdd("q", -1, CDate("2025-05-31"))'), '2025-02-28 00:00:00'),
  ok(F('DateAdd("yyyy", 1, CDate("2024-02-29"))'), '2025-02-28 00:00:00'),
  ok(F('DateAdd("yyyy", 4, CDate("2024-02-29"))'), '2028-02-29 00:00:00'),
  ok(F('DateAdd("yyyy", -1, CDate("2024-02-29"))'), '2023-02-28 00:00:00'),
  ok(F('DateAdd("m", 1.9, CDate("2025-01-15"))'), '2025-02-15 00:00:00'),
  ok(F('DateAdd("m", -1.9, CDate("2025-01-15"))'), '2024-12-15 00:00:00'),
  ok(F('DateAdd("d", 1, CDate("2025-12-31"))'), '2026-01-01 00:00:00'),
  ok(F('DateAdd("d", -0.9, CDate("2025-12-31"))'), '2025-12-31 00:00:00'),
  ok(F('DateAdd("y", 1, CDate("2025-12-31"))'), '2026-01-01 00:00:00'),
  ok(F('DateAdd("w", 1, CDate("2025-12-31"))'), '2026-01-01 00:00:00'),
  ok(F('DateAdd(DateInterval.Weekday, 3, CDate("2025-01-31"))'), '2025-02-03 00:00:00'),
  ok(F('DateAdd("ww", 1, CDate("2025-01-31"))'), '2025-02-07 00:00:00'),
  ok(F('DateAdd(DateInterval.WeekOfYear, -2, CDate("2025-01-31"))'), '2025-01-17 00:00:00'),
  ok(F('DateAdd("h", 1.5, #1/1/2025 23:00:00#)'), '2025-01-02 00:30:00'),
  ok(F('DateAdd("n", 90, #1/1/2025 23:00:00#)'), '2025-01-02 00:30:00'),
  ok(F('DateAdd("s", -1, CDate("2025-01-01"))'), '2024-12-31 23:59:59'),
  ok(F('DateAdd("s", 0.5, #1/1/2025 10:00:00#)'), '2025-01-01 10:00:00'),
  ok('=DateAdd("d", 1, Nothing)', null),
  ok(F('Fields!d.Value.AddMonths(1)'), '2025-02-28 14:05:09'),
]);

/* ---------------------------------------------------------------------------------------------- DateDiff
 * DateAndTime.DateDiff (.NET reference source): Year, Quarter and Month count calendar boundaries
 * ((Year2 - Year1) * 12 + Month2 - Month1); Day/DayOfYear, Hour, Minute and Second are Fix() of the elapsed
 * TimeSpan (whole units, truncated toward zero, not midnights crossed as in VB6); Weekday ("w") is Fix(days / 7);
 * WeekOfYear ("ww") counts first-days-of-week: "It counts the number of Sundays between Date1 and Date2. DateDiff
 * counts Date2 if it falls on a Sunday; but it doesn't count Date1, even if it does fall on a Sunday."
 * "When comparing December 31 to January 1 of the immediately succeeding year, DateDiff for Year returns 1."
 */
const DATEDIFF = table('DateDiff (DateAndTime.DateDiff)', [
  ok('=DateDiff("yyyy", CDate("2024-12-31"), CDate("2025-01-01"))', 1),
  ok('=DateDiff("yyyy", CDate("2025-01-01"), CDate("2025-12-31"))', 0),
  ok('=DateDiff("q", CDate("2025-03-31"), CDate("2025-04-01"))', 1),
  ok('=DateDiff("q", CDate("2024-11-15"), CDate("2025-02-15"))', 1),
  ok('=DateDiff(DateInterval.Quarter, CDate("2025-04-01"), CDate("2025-01-01"))', -1),
  ok('=DateDiff("m", CDate("2025-01-31"), CDate("2025-02-01"))', 1),
  ok('=DateDiff("m", CDate("2025-02-01"), CDate("2024-12-31"))', -2),
  ok('=DateDiff("d", CDate("2026-01-01"), CDate("2026-03-01"))', 59),
  ok('=DateDiff("d", #1/1/2025 23:00:00#, #1/2/2025 01:00:00#)', 0),
  ok('=DateDiff("d", #1/1/2025 01:00:00#, #1/2/2025 23:00:00#)', 1),
  ok('=DateDiff("d", #1/2/2025 01:00:00#, #1/1/2025 00:00:00#)', -1),
  ok('=DateDiff("y", CDate("2025-01-01"), CDate("2025-12-31"))', 364),
  ok('=DateDiff("w", CDate("2025-01-01"), CDate("2025-01-15"))', 2),
  ok('=DateDiff("w", CDate("2025-01-01"), CDate("2025-01-14"))', 1),
  ok('=DateDiff("ww", CDate("2025-01-04"), CDate("2025-01-05"))', 1), // Sat → Sun: one Sunday
  ok('=DateDiff("ww", CDate("2025-01-05"), CDate("2025-01-11"))', 0), // Date1's Sunday is not counted
  ok('=DateDiff("ww", CDate("2025-01-05"), CDate("2025-01-12"))', 1),
  ok('=DateDiff("ww", CDate("2025-01-12"), CDate("2025-01-04"))', -2),
  ok('=DateDiff("ww", CDate("2025-01-05"), CDate("2025-01-06"), FirstDayOfWeek.Monday)', 1),
  ok('=DateDiff("h", #1/1/2025 00:00:00#, #1/1/2025 01:59:00#)', 1),
  ok('=DateDiff("n", #1/1/2025 00:00:00#, #1/1/2025 01:59:59#)', 119),
  ok('=DateDiff("s", #1/1/2025 00:00:00#, #1/1/2025 00:01:00#)', 60),
  ok('=DateDiff(DateInterval.Day, Nothing, CDate("2025-01-01"))', null),
]);

/* ------------------------------------------------------------------------- DatePart, Weekday, names, DateSerial
 * DatePart / Weekday: FirstDayOfWeek defaults to Sunday (vbSunday = 1); Weekday gives 1..7 counted from it.
 * DatePart("ww") with FirstWeekOfYear.Jan1 (the default): the week holding 1 January is week 1.
 * WeekdayName(n, abbreviate, firstDayOfWeek): day n counted from firstDayOfWeek.
 * DateSerial: out-of-range months and days roll over ("DateSerial(2025, 13, 1)" is 1 Jan 2026; day 0 is the last day
 * of the month before). A 2-digit year 0–29 means 2000–2029 and 30–99 means 1930–1999 (the Windows default
 * TwoDigitYearMax of 2029).
 */
const DATEPART = table('DatePart, Weekday, WeekdayName, MonthName, DateSerial', [
  ok('=DatePart("yyyy", CDate("2025-05-01"))', 2025),
  ok('=DatePart("q", CDate("2025-05-01"))', 2),
  ok('=DatePart(DateInterval.Quarter, CDate("2025-12-31"))', 4),
  ok('=DatePart("m", CDate("2025-05-01"))', 5),
  ok('=DatePart("y", CDate("2025-03-01"))', 60),
  ok('=DatePart("y", CDate("2024-03-01"))', 61),
  ok('=DatePart("d", CDate("2025-05-17"))', 17),
  ok('=DatePart("w", CDate("2025-01-05"))', 1),
  ok('=DatePart("w", CDate("2025-01-05"), FirstDayOfWeek.Monday)', 7),
  ok('=DatePart("ww", CDate("2025-01-01"))', 1),
  ok('=DatePart("ww", CDate("2025-01-04"))', 1),
  ok('=DatePart("ww", CDate("2025-01-05"))', 2),
  ok('=DatePart("ww", CDate("2025-12-31"))', 53),
  ok('=DatePart("ww", CDate("2025-01-06"), FirstDayOfWeek.Monday)', 2),
  ok('=DatePart("h", #1/31/2025 14:05:09#)', 14),
  ok('=DatePart("n", #1/31/2025 14:05:09#)', 5),
  ok('=DatePart("s", #1/31/2025 14:05:09#)', 9),
  ok('=Weekday(CDate("2025-01-06"))', 2),
  ok('=Weekday(CDate("2025-01-06"), vbMonday)', 1),
  ok('=Weekday(CDate("2025-01-05"), FirstDayOfWeek.Saturday)', 2),
  ok('=WeekdayName(1)', 'Sunday'),
  ok('=WeekdayName(1, True)', 'Sun'),
  ok('=WeekdayName(1, False, FirstDayOfWeek.Monday)', 'Monday'),
  ok('=WeekdayName(7, False, vbMonday)', 'Sunday'),
  ok('=WeekdayName(Weekday(CDate("2025-01-31")))', 'Friday'),
  ok('=MonthName(2)', 'February'),
  ok('=MonthName(2, True)', 'Feb'),
  ok('=Year(CDate("2025-01-31")) & "-" & Month(CDate("2025-01-31")) & "-" & Day(CDate("2025-01-31"))', '2025-1-31'),
  ok(F('DateSerial(2025, 2, 30)'), '2025-03-02 00:00:00'),
  ok(F('DateSerial(2025, 13, 1)'), '2026-01-01 00:00:00'),
  ok(F('DateSerial(2025, 1, 0)'), '2024-12-31 00:00:00'),
  ok(F('DateSerial(2025, 0, 1)'), '2024-12-01 00:00:00'),
  unsure(F('DateSerial(25, 1, 1)'), '2025-01-01 00:00:00', 'depends on the server calendar\'s TwoDigitYearMax (2029 by default)'),
  unsure(F('DateSerial(30, 1, 1)'), '1930-01-01 00:00:00', 'depends on the server calendar\'s TwoDigitYearMax (2029 by default)'),
]);

/* ------------------------------------------------------------------------------------------------ strings
 * Microsoft.VisualBasic.Strings: positions are 1-based; Left/Right/Mid take as many characters as there are;
 * a Nothing string is "" (Len(Nothing) = 0). InStr: 0 when not found, Start when the searched-for string is "";
 * InStr(start, s, find) starts at a 1-based position. Comparisons are Option Compare Binary (ordinal, case-sensitive),
 * the default. Replace with an empty Find returns the string unchanged. LTrim/RTrim trim one end. & converts both
 * sides to text (Nothing is ""); + of two strings concatenates, + of a number and a numeric string adds (Option
 * Strict Off converts the string to Double).
 */
const STRINGS = table('String functions (Strings.*)', [
  ok('=Left("abc", 2)', 'ab'),
  ok('=Left("abc", 5)', 'abc'),
  ok('=Left("abc", 0)', ''),
  ok('=Right("abc", 2)', 'bc'),
  ok('=Right("abc", 9)', 'abc'),
  ok('=Mid("abcdef", 2, 3)', 'bcd'),
  ok('=Mid("abcdef", 3)', 'cdef'),
  ok('=Mid("abc", 5)', ''),
  ok('=Mid("abc", 2, 10)', 'bc'),
  ok('=Len("abc")', 3),
  ok('=Len(Nothing)', 0),
  ok('=Len(Fields!n.Value)', 0),
  ok('=InStr("abcabc", "c")', 3),
  ok('=InStr("abc", "z")', 0),
  ok('=InStr("abc", "")', 1),
  ok('=InStr("ABC", "b")', 0),
  ok('=InStr(Nothing, "a")', 0),
  ok('=InStr(1, "abcabc", "c")', 3),
  ok('=InStr(4, "abcabc", "c")', 6),
  ok('=InStr(5, "abcabc", "b")', 5),
  ok('=InStr(6, "abcabc", "b")', 0),
  ok('=InStrRev("abcabc", "c")', 6),
  ok('=Replace("aaa", "a", "b")', 'bbb'),
  ok('=Replace("a.b.c", ".", "")', 'abc'),
  ok('=Replace("abc", "", "x")', 'abc'),
  ok('=UCase("abc")', 'ABC'),
  ok('=LCase("ABC")', 'abc'),
  ok('=LCase(Nothing)', ''),
  ok('=Trim("  a b  ")', 'a b'),
  ok('=LTrim("  a  ")', 'a  '),
  ok('=RTrim("  a  ")', '  a'),
  ok('=StrReverse("abc")', 'cba'),
  ok('=Space(3) & "|"', '   |'),
  ok('=Chr(65) & Asc("A")', 'A65'),
  ok('="a" & 1', 'a1'),
  ok('=1 & 2', '12'),
  ok('="a" & Nothing', 'a'),
  ok('="1" + "2"', '12'),
  ok('=1 + "2"', 3),
  ok('="2" + 1', 3),
  ok('="a" = "A"', false),
  ok('="a" < "b"', true),
  ok('="B" < "a"', true),
  ok('="abc".ToUpper()', 'ABC'),
  ok('="abcdef".Substring(1, 3)', 'bcd'),
  ok('="abc".IndexOf("c")', 2),
  ok('="abc".Length', 3),
]);

/* ------------------------------------------------------------------------------------------------- Format
 * Strings.Format(number, fmt) is Double.ToString(fmt) / Decimal.ToString(fmt) for the report culture.
 * Standard numeric formats: C (currency), N (number, grouped), F (fixed), P (×100 with %), D (integer, zero-padded,
 * sign kept in front), E (scientific: mantissa, "E", sign, at least 3 exponent digits), X (hexadecimal),
 * G (general: 15 significant digits on .NET Framework, scientific when the exponent is < -5 or ≥ the precision,
 * exponent with at least 2 digits), R (round-trip). Format strings round half away from zero (unlike Math.Round).
 * Custom: 0 (digit or zero), # (digit if any), . , (grouping; a "," right before the point or at the end divides by
 * 1,000), % (×100), 'text' and \c literals, up to 3 sections "positive;negative;zero" (the negative section shows
 * no minus sign of its own). Digits fill literal positions right to left ("000-00-0000").
 * Dates: custom yyyy yy MMMM MMM MM M dddd ddd dd d HH H hh h mm m ss s fff ff f tt; standard en-US d D t T f F g G
 * M Y s u.
 */
const D = '#1/31/2025 14:05:09#';
const FORMAT = table('Format (.NET format strings, en-US)', [
  ok('=Format(1234.5, "N2")', '1,234.50'),
  ok('=Format(1234.5, "N0")', '1,235'),
  ok('=Format(1233.5, "N0")', '1,234'),
  ok('=Format(-1234.567, "N")', '-1,234.57'),
  ok('=Format(1234.5, "C2")', '$1,234.50'),
  ok('=Format(1234.5, "C0")', '$1,235'),
  ok('=FormatCurrency(1234.5)', '$1,234.50'),
  dev('=Format(-1234.5, "C2")', '-$1,234.50', '($1,234.50)', 'en-US CurrencyNegativePattern on .NET Framework is "($n)"; ReportWright writes the minus sign (as .NET 5+ does)'),
  ok('=Format(0.1234, "P1")', '12.3%'),
  dev('=Format(0.1234, "P")', '12.34%', '12.34 %', '.NET Framework en-US PercentPositivePattern puts a space before %; ReportWright follows CLDR (as .NET 5+ does)'),
  ok('=FormatPercent(0.5, 0)', '50%'),
  ok('=FormatNumber(1234.567, 1)', '1,234.6'),
  ok('=Format(2.675, "F2")', '2.68'),
  ok('=Format(1.005, "F2")', '1.01'),
  ok('=Format(2.5, "F0")', '3'),
  ok('=Format(-2.5, "F0")', '-3'),
  ok('=Format(1234.5, "F")', '1234.50'),
  ok('=Format(42, "D5")', '00042'),
  ok('=Format(-5, "D3")', '-005'),
  ok('=Format(42, "D")', '42'),
  ok('=Format(1234.5, "E2")', '1.23E+003'),
  ok('=Format(1234.5, "e")', '1.234500e+003'),
  ok('=Format(0.00012, "E1")', '1.2E-004'),
  ok('=Format(255, "X")', 'FF'),
  ok('=Format(255, "x4")', '00ff'),
  ok('=Format(0.1 + 0.2, "G")', '0.3'),
  ok('=Format(1234.5, "G")', '1234.5'),
  ok('=Format(1234.5, "G3")', '1.23E+03'),
  ok('=Format(0.00001234, "G")', '1.234E-05'),
  ok('=Format(0.0001234, "G")', '0.0001234'),
  ok('=Format(1234.5, "#,##0.00")', '1,234.50'),
  ok('=Format(1234567, "#,##0")', '1,234,567'),
  ok('=Format(0.5, "0.00")', '0.50'),
  ok('=Format(0.5, "#.##")', '.5'),
  ok('=Format(0, "#")', ''),
  ok('=Format(0, "0")', '0'),
  ok('=Format(1.5, "0.0#")', '1.5'),
  ok('=Format(1.567, "0.0#")', '1.57'),
  ok('=Format(7, "000")', '007'),
  ok('=Format(0.256, "0%")', '26%'),
  ok('=Format(0.256, "0.0%")', '25.6%'),
  ok('=Format(1234.5, "$#,##0.00")', '$1,234.50'),
  ok('=Format(-1234.5, "#,##0.00;(#,##0.00)")', '(1,234.50)'),
  ok('=Format(1234.5, "#,##0.00;(#,##0.00)")', '1,234.50'),
  ok('=Format(0, "#,##0;(#,##0);-")', '-'),
  ok('=Format(-3, "0;minus 0;zero")', 'minus 3'),
  ok('=Format(-3, "0.00")', '-3.00'),
  ok('=Format(-0.001, "0.00")', '0.00'),
  ok('=Format(123456789, "000-00-0000")', '123-45-6789'),
  ok('=Format(1234567, "#,##0,")', '1,235'),
  ok('=Format(1234567890, "#,##0,,")', '1,235'),
  ok('=Format(1.5, "0.00 \'units\'")', '1.50 units'),
  ok('=Format(1.5, "\\#0.0")', '#1.5'),
  ok('=Format(5, "Item 0")', 'Item 5'),
  ok(`=Format(${D}, "yyyy-MM-dd HH:mm:ss")`, '2025-01-31 14:05:09'),
  ok(`=Format(${D}, "dd/MM/yy")`, '31/01/25'),
  ok(`=Format(${D}, "MMM d, yyyy")`, 'Jan 31, 2025'),
  ok(`=Format(${D}, "dddd, MMMM d")`, 'Friday, January 31'),
  ok(`=Format(${D}, "hh:mm tt")`, '02:05 PM'),
  ok(`=Format(${D}, "h:m:s")`, '2:5:9'),
  ok(`=Format(${D}, "H \\h m \\m")`, '14 h 5 m'),
  ok(`=Format(${D}, "yyyy'Q'")`, '2025Q'),
  ok(`=Format(${D}, "d")`, '1/31/2025'),
  ok(`=Format(${D}, "D")`, 'Friday, January 31, 2025'),
  ok(`=Format(${D}, "t")`, '2:05 PM'),
  ok(`=Format(${D}, "T")`, '2:05:09 PM'),
  ok(`=Format(${D}, "g")`, '1/31/2025 2:05 PM'),
  ok(`=Format(${D}, "G")`, '1/31/2025 2:05:09 PM'),
  ok(`=Format(${D}, "f")`, 'Friday, January 31, 2025 2:05 PM'),
  ok(`=Format(${D}, "M")`, 'January 31'),
  ok(`=Format(${D}, "Y")`, 'January 2025'),
  ok(`=Format(${D}, "s")`, '2025-01-31T14:05:09'),
  ok('=Format(Fields!d.Value, "HH:mm:ss.fff")', '14:05:09.123'),
  ok('=FormatDateTime(#1/31/2025#, DateFormat.ShortDate)', '1/31/2025'),
  ok('=Format(Nothing, "N2")', ''),
]);

/* -------------------------------------------------------------------------------------- coercion and Nothing
 * Conversions (Option Strict Off): CInt/CLng/CShort round half to even ("CInt(2.5) = 2"); CDbl/CDec read culture
 * grouping ("1,234.5"); CBool reads "True"/"False" or a number (0 is False); a string that does not convert raises
 * InvalidCastException (#Error). Val reads the leading number, skipping blanks, and gives 0 for none; it does not
 * read grouping commas and does read &H hex. IsNothing is True only for Nothing (not for ""). Comparisons convert a
 * numeric string to a number when the other side is a number.
 * Nothing in arithmetic and comparisons: VB treats Nothing as 0 / "" there. ReportWright keeps it as null (see dev rows).
 */
const COERCION = table('Type coercion and Nothing', [
  ok('=CStr(1.5)', '1.5'),
  ok('=CStr(True)', 'True'),
  ok('=CStr(Nothing)', ''),
  ok('=CDbl("1,234.5")', 1234.5),
  ok('=CDbl("12")', 12),
  ok('=CDbl("abc")', ERR),
  ok('=CDec("0.1") + CDec("0.2")', 0.3),
  ok('=CInt(2.5)', 2),
  ok('=CInt(3.5)', 4),
  ok('=CInt(-2.5)', -2),
  ok('=CInt(2.51)', 3),
  ok('=CInt("12")', 12),
  ok('=CInt("x")', ERR),
  ok('=CLng(2.5)', 2),
  ok('=CLng(3000000000.4)', 3000000000),
  ok('=CShort(1.5)', 2),
  ok('=CBool("True")', true),
  ok('=CBool("false")', false),
  ok('=CBool(0)', false),
  ok('=CBool(-1)', true),
  ok('=CBool("0")', false),
  ok('=CBool("abc")', ERR),
  ok('=Val("12abc")', 12),
  ok('=Val("  1 2 ")', 12),
  ok('=Val("abc")', 0),
  ok('=Val("1.5e2")', 150),
  ok('=Val("-3.5x")', -3.5),
  ok('=Val("1,234")', 1),
  ok('=Val("&HFF")', 255),
  ok('=Convert.ToInt32(2.5)', 2),
  ok('=Convert.ToInt32(3.5)', 4),
  ok('=IsNothing(Nothing)', true),
  ok('=IsNothing("")', false),
  ok('=IsNothing(Fields!n.Value)', true),
  ok('=Fields!n.Value Is Nothing', true),
  ok('=IsNumeric("12.5")', true),
  ok('=IsNumeric("abc")', false),
  ok('=IsNumeric("1,234")', true),
  ok('=IsNumeric("$5")', true),
  ok('=IsNumeric("(1,234.50)")', true),
  ok('=IsNumeric("1,2,3")', false),
  ok('=UCase("straße")', 'STRAßE'),
  ok('="a" + 5', ERR),
  ok('=CStr(1 / 3)', '0.333333333333333'),
  ok('=CDate("2026-02-30")', ERR),
  ok('=IsDate("2026-02-30")', false),
  ok('=IsDate("2025-01-31")', true),
  ok('="10" > 9', true),
  ok('=10 = "10"', true),
  ok('=Nothing = Nothing', true),
  // Nothing widens to the other operand's type default (VB semantics, the default; a report with nullPropagation: true
  // keeps SQL nulls instead, see tests/engine/r1b-null.test.js)
  ok('=Nothing + 1', 1),
  ok('=Fields!n.Value * 5', 0),
  ok('=Fields!n.Value = 0', true),
  ok('="" = Nothing', true),
  ok('=Fields!n.Value & "x"', 'x'),
  ok('=CInt(Nothing)', 0),
  ok('=CInt(True)', -1),
  ok('=True + 1', 0),
  dev('="abc" > 9', false, ERR, 'VB raises InvalidCastException converting "abc" to Double; ReportWright compares as text'),
]);

/* ------------------------------------------------------------------------------------------------ operators
 * VB precedence, high to low: ^, unary -, * /, \, Mod, + -, &, comparisons, Not, And/AndAlso, Or/OrElse, Xor.
 * ^ is left-associative and binds tighter than unary minus (-2^2 = -4). \ rounds both operands to Long (half to even)
 * and truncates the quotient. Mod keeps the sign of the dividend and works on fractions. / always gives a Double.
 * AndAlso/OrElse short-circuit. And/Or evaluate both sides and are bitwise on integers. IIf is a function: both
 * branches are evaluated before it is called.
 */
const OPERATORS = table('Operators and precedence', [
  ok('=7 \\ 2', 3),
  ok('=-7 \\ 2', -3),
  ok('=7.5 \\ 2', 4),
  ok('=6.5 \\ 2', 3),
  ok('=7 \\ 2.5', 3),
  ok('=7 Mod 3', 1),
  ok('=-7 Mod 3', -1),
  ok('=7 Mod -3', 1),
  ok('=5.5 Mod 2', 1.5),
  ok('=2 ^ 3 ^ 2', 64),
  ok('=-2 ^ 2', -4),
  ok('=2 ^ -1', 0.5),
  ok('=2 * 3 ^ 2', 18),
  ok('=1 + 2 * 3', 7),
  ok('=(1 + 2) * 3', 9),
  ok('=10 / 4', 2.5),
  ok('=7 \\ 2 * 2', 1),
  ok('=10 Mod 4 \\ 2', 0),
  ok('=10 - 4 Mod 3', 9),
  ok('="a" & 1 + 2', 'a3'),
  ok('=1 + 2 & "a"', '3a'),
  ok('=1 < 2 = True', true),
  ok('=Not 1 = 2', true),
  ok('=Not True Or True', true),
  ok('=True Or False And False', true),
  ok('=True Xor True', false),
  ok('=True Xor False', true),
  ok('=IsNothing(Fields!n.Value) OrElse Fields!n.Value > 5', true),
  ok('=Not IsNothing(Fields!n.Value) AndAlso Fields!n.Value > 5', false),
  ok('=IIf(True, 1, 2)', 1),
  ok('=IIf(1 > 2, "a", "b")', 'b'),
  ok('=IIf(Fields!zero.Value = 0, 0, 10 / Fields!zero.Value)', 0),
  ok('=Choose(2, "a", "b", "c")', 'b'),
  ok('=Switch(1 > 2, "a", 2 > 1, "b")', 'b'),
  dev('=IIf(True, 1, CInt("x"))', 1, ERR, 'ReportWright evaluates only the chosen IIf branch; VB evaluates both, so an error in the unused one shows #Error'),
  dev('=False And CInt("x") = 1', false, ERR, 'ReportWright And/Or short-circuit like AndAlso/OrElse; VB And evaluates both sides'),
  dev('=5 And 3', true, 1, 'VB And/Or/Xor on integers are bitwise; ReportWright treats them as logical'),
  ok('=1 / 0', Infinity),
]);

/* ------------------------------------------------------------------------------------------------- rounding
 * Math.Round(x) and Math.Round(x, digits) round half to even (MidpointRounding.ToEven, "banker's rounding"):
 * Round(2.5) = 2, Round(3.5) = 4, Round(-2.5) = -2. Math.Round(x, d, MidpointRounding.AwayFromZero) rounds halves
 * away from zero. VB Int is floor (Int(-2.5) = -3); Fix and Math.Truncate truncate toward zero.
 * ReportWright rounds the decimal value it shows (2.675 is the decimal 2.675), as Math.Round(Decimal) does for money
 * fields; Math.Round(Double) would see 2.67499999… and give 2.67.
 */
const ROUNDING = table('Round, Int, Fix', [
  ok('=Round(2.5)', 2),
  ok('=Round(3.5)', 4),
  ok('=Round(-2.5)', -2),
  ok('=Round(0.5)', 0),
  ok('=Round(1.5)', 2),
  ok('=Round(2.4)', 2),
  ok('=Round(2.6)', 3),
  ok('=Math.Round(2.665, 2)', 2.66),
  ok('=Math.Round(0.125, 2)', 0.12),
  ok('=Math.Round(0.135, 2)', 0.14),
  ok('=Round(1234.5678, 2)', 1234.57),
  unsure('=Round(2.675, 2)', 2.68, 'Math.Round(Decimal) gives 2.68; Math.Round(Double) gives 2.67 (binary 2.67499…). ReportWright rounds the decimal value'),
  unsure('=Round(1.005, 2)', 1, 'Decimal: 1.005 is a midpoint, to even gives 1.00; Double gives 1 too (binary 1.00499…)'),
  ok('=Math.Round(2.5, MidpointRounding.AwayFromZero)', 3),
  ok('=Math.Round(-2.5, MidpointRounding.AwayFromZero)', -3),
  ok('=Math.Round(2.345, 2, MidpointRounding.AwayFromZero)', 2.35),
  ok('=Math.Round(2.345, 2, MidpointRounding.ToEven)', 2.34),
  ok('=Round(Nothing)', null),
  ok('=Int(2.5)', 2),
  ok('=Int(-2.5)', -3),
  ok('=Fix(-2.5)', -2),
  ok('=Math.Truncate(-2.7)', -2),
  ok('=Math.Floor(-2.5)', -3),
  ok('=Math.Ceiling(-2.5)', -2),
  ok('=Math.Abs(-2.5)', 2.5),
  ok('=Math.Max(2, 3)', 3),
  ok('=Sqrt(16)', 4),
]);

/* -------------------------------------------------------------------------------------------- decimal arithmetic
 * SSRS reads SQL decimal/money columns as System.Decimal, so 0.1 + 0.2 = 0.3 exactly and ten 0.1s sum to 1.
 * ReportWright treats a number as its shortest decimal form and adds, subtracts and multiplies on that form exactly
 * (while it fits 15 significant digits), so money arithmetic shows no binary-float artefacts.
 */
const DECIMALS = table('Decimal arithmetic', [
  ok('=0.1 + 0.2', 0.3),
  ok('=0.1 + 0.2 = 0.3', true),
  ok('=0.3 - 0.1', 0.2),
  ok('=1.1 * 1.1', 1.21),
  ok('=19.99 * 3', 59.97),
  ok('=1.15 * 100', 115),
  ok('=CStr(0.1 + 0.2)', '0.3'),
  ok('=Format(0.1 + 0.7, "G")', '0.8'),
]);

// keeps the size of the scalar suite visible in the summary
describe('scalar suite size', () => {
  it('has the expected number of rows', () => {
    const all = [DATEADD, DATEDIFF, DATEPART, STRINGS, FORMAT, COERCION, OPERATORS, ROUNDING, DECIMALS].flat();
    expect(all.length).toBeGreaterThan(250);
  });
});
