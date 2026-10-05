// R3-A: "java:" and "icu:" formats (expr/javafmt.js). Expected values are what JDK 23 (java.text) and BIRT 4.25
// (ICU4J) printed for the same pattern, value and locale in tests/diff's ground truth, or by a one-line JDK program.
import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/engine/expr/format.js';
import { javaFormatString, javaDouble } from '../../src/engine/expr/javafmt.js';

const f = (v, fmt, locale = 'en-US') => formatValue(v, fmt, { locale, timeZone: 'UTC' });
const d = new Date('2026-01-01T00:05:00Z'), d2 = new Date('2026-07-14T09:07:03Z');

describe('java: DecimalFormat', () => {
  it.each([
    [1234567.891, '#,##0.00', 'en-US', '1,234,567.89'], [2.675, '#,##0.00', 'en-US', '2.67'], [0.125, '#.##', 'en-US', '0.12'],
    [0.5, '#.##', 'en-US', '0.5'], [-0.001, '#,##0', 'en-IN', '-0'], [12345678.9, '#,##0.###', 'en-IN', '12,345,678.9'],
    [0.5, '0.0‰', 'en-US', '500.0‰'], [-1234.567, '-0.00', 'en-US', '--1234.57'], [-5, '0.00', 'ar-SA', '؜-٥٫٠٠'],
    [1234567.891, '0.###E0', 'en-US', '1.235E6'], [1234567.891, '##0.##E0', 'en-US', '1.2346E6'], [0.5, '##0.##E0', 'en-US', '500E-3'],
    [2.5, '0.00E00', 'en-US', '2.50E00'], [100, '¤#,##0.00', 'ja-JP', '￥100.00'], [-5, '¤#,##0.00', 'en-IN', '-₹5.00'],
    [2.5, '¤#,##0.00', 'de-DE', '€2,50'], [-1234.567, '#,##0.00;(#,##0.00)', 'en-US', '(1,234.57)'], [0.5, '0%', 'ar-SA', '٥٠٪؜'],
  ])('%s with %s in %s is %s', (v, p, l, want) => expect(f(v, `java:${p}`, l)).toBe(want));
});

describe('icu: (BIRT)', () => {
  it.each([
    [1.005, '#,##0.00{RoundingMode=HALF_UP}', 'en-US', '1.01'], [100, '¤#,##0.00', 'ja-JP', '￥100'], [-5, '¤#,##0.00', 'ja-JP', '-￥5'],
    [100, '¤#,##0.00', 'ar-SA', 'ر.س.‏ ١٠٠٫٠٠'], [1234567.891, '', 'en-US', '1234567.891'], [12345678.9, '', 'ar-SA', '1٫23456789E7'],
    [-5, '', 'en-US', '-5'],
  ])('%s with "%s" in %s is %s', (v, p, l, want) => expect(f(v, `icu:${p}`, l).replace(/ /g, ' ')).toBe(want));
  it('named date styles and the unformatted date', () => {
    expect(f(d2, 'icu:@date=short')).toBe('7/14/26');
    expect(f(d2, 'icu:@date=long;time=long')).toBe('July 14, 2026 at 9:07:03 AM UTC');
    expect(f(d, 'icu:kk:mm')).toBe('24:05'); // BIRT's Short Time
    expect(f(d, 'icu:')).toBe('Jan 1, 2026 12:05 AM');
    expect(f(new Date('2025-12-31T23:59:00Z'), 'icu:', 'de-DE')).toBe('31.12.2025, 23:59');
  });
});

describe('java: SimpleDateFormat', () => {
  it.each([
    ['EEE, d MMM yyyy', 'de-DE', 'Do., 1 Jan. 2026'], ['u', 'en-US', '4'], ['D', 'en-US', '1'], ['k', 'en-US', '24'], ['K', 'en-US', '0'],
    ['h:mm a', 'en-IN', '12:05 am'], ['h:mm a', 'ja-JP', '12:05 午前'], ['dd/MM/yyyy', 'ar-SA', '٠١/٠١/٢٠٢٦'], ['MMM', 'ja-JP', '1月'],
  ])('%s in %s is %s', (p, l, want) => expect(f(d, `java:${p}`, l)).toBe(want));
  it('genitive month names with a day, stand-alone with L', () => {
    expect(f(new Date('2026-03-05T12:00:00Z'), 'java:d MMMM', 'ru-RU')).toBe('5 марта');
    expect(f(new Date('2026-03-05T12:00:00Z'), 'java:LLLL', 'ru-RU')).toBe('март');
  });
});

describe('String.valueOf and String.format', () => {
  it('Double.toString', () => {
    expect([2, 1e7, 9.004999999999999, 0.0001, -0, 1 / 3].map(javaDouble)).toEqual(['2.0', '1.0E7', '9.004999999999999', '1.0E-4', '-0.0', '0.3333333333333333']);
    expect(f(true, 'java:')).toBe('true');
    expect(f(d, 'java:')).toBe('Thu Jan 01 00:05:00 UTC 2026');
  });
  it('java.util.Formatter', () => {
    expect(javaFormatString('%05d|%.2f|%.2f|%,d|%s', [-1, 2.5, 1.005, 1234567, null])).toBe('-0001|2.50|1.01|1,234,567|null');
    expect(javaFormatString('%-6s|%8.3f|%x|%+d|%(d|%2$s', ['ab', 3.14159, 255, 5, -7])).toBe('ab    |   3.142|ff|+5|(7)|3.14159');
  });
});
