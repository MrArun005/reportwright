// R3-A: Excel number formats (REVIEW-ENGINE-2 N6, N7, N21, N22).
import { describe, it, expect } from 'vitest';
import { excelFormat, currencySymbol } from '../../src/exporters/xlsx.js';
import { chartXml } from '../../src/exporters/xlsxchart.js';

const date = new Date('2026-03-05T14:30:00Z');
describe('N6: standard date letters on a date cell', () => {
  it.each([['d', 'm/d/yyyy'], ['D', 'dddd, mmmm d, yyyy'], ['t', 'h:mm AM/PM'], ['T', 'h:mm:ss AM/PM'], ['g', 'm/d/yyyy h:mm AM/PM'], ['G', 'm/d/yyyy h:mm:ss AM/PM'], ['M', 'mmmm d'], ['Y', 'mmmm yyyy']])('%s → %s', (f, want) => expect(excelFormat(f, '', 'en-US', date)).toBe(want));
  it('other cultures use their own short date', () => { expect(excelFormat('d', '', 'de-DE', date)).toBe('dd.mm.yyyy'); expect(excelFormat('t', '', 'de-DE', date)).toBe('hh:mm'); });
  it('a number keeps the number reading of d / D', () => expect(excelFormat('D5', '', 'en-US', 7)).toBe('00000'));
});
describe('N7: the currency symbol the page shows', () => {
  it.each([['USD', 'en-US', '$'], ['INR', 'en-IN', '₹'], ['EUR', 'de-DE', '€'], ['JPY', 'ja-JP', '￥']])('%s in %s', (c, l, s) => expect(currencySymbol(c, l)).toBe(s));
  it('C2 carries it', () => expect(excelFormat('C2', '₹', 'en-US', 5)).toBe('"₹"#,##0.00'));
});
describe('N22: en-IN lakh grouping per value, negatives too', () => {
  it.each([[-1234567, '##\\,##\\,##0.00'], [1234567, '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00'], [-123456789, '##\\,##\\,##\\,##0.00'], [-1234, '##,##0.00']])('%s', (v, want) => expect(excelFormat('N2', '', 'en-IN', v)).toBe(want));
});
describe('N21: native chart axes get Excel codes', () => {
  it.each([['P0', '0%'], ['N0', '#,##0'], ['F1', '0.0'], ['#,##0.00', '#,##0.00']])('%s → %s', (f, want) => {
    const xml = chartXml({ type: 'line', format: f, categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }, 'Data');
    expect(xml).toContain(`<c:formatCode>${want}</c:formatCode>`);
  });
});
describe('java: and icu: formats in Excel', () => {
  it.each([['java:#,##0.00', 5, '#,##0.00'], ['java:¤#,##0.00', 5, '"$"#,##0.00'], ['java:0.0‰', 5, null], ['java:dd/MM/yyyy', date, 'dd/mm/yyyy'], ['icu:@date=long', date, 'm/d/yyyy'], ['java:', 2, null]])('%s', (f, v, want) => expect(excelFormat(f, '$', 'en-US', v)).toBe(want));
});
