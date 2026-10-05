// An explicit Indian grouping pattern groups 3 then 2s in any locale (as an explicit group size does), not the locale's threes.
import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/engine/expr/format.js';

describe('lakh pattern #,##,##0.00', () => {
  it.each([
    ['en-US', 123456789, '12,34,56,789.00'],
    ['en-IN', 123456789, '12,34,56,789.00'],
    ['en-GB', -1234567.5, '-12,34,567.50'],
    ['de-DE', 123456789, '12.34.56.789,00'],
    ['en-US', 999, '999.00'],
    ['en-US', 12345, '12,345.00'],
  ])('%s %s', (locale, v, want) => expect(formatValue(v, '#,##,##0.00', { locale })).toBe(want));
  it('plain #,##0 keeps the locale grouping', () => expect(formatValue(123456789, '#,##0', { locale: 'en-US' })).toBe('123,456,789'));
});
