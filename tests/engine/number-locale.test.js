// Number formats follow Intl's grouping (CLDR: es-ES 1234,50, 12.345,50) unless the report forces it; an unformatted
// number uses the same Latin digits and a Latin decimal sign in every locale
import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/engine/expr/format.js';

describe('number locales', () => {
  it('follows CLDR grouping by default (es-ES groups only from 5 digits up)', () => {
    expect(formatValue(1234.5, 'N2', { locale: 'es-ES' })).toBe('1234,50');
    expect(formatValue(12345.5, 'N2', { locale: 'es-ES' })).toBe('12.345,50');
    expect(formatValue(1234.5, 'N2', { locale: 'en-US' })).toBe('1,234.50');
  });

  it('a report can force grouping always or never', () => {
    expect(formatValue(1234.5, 'N2', { locale: 'es-ES', grouping: 'always' })).toBe('1.234,50');
    expect(formatValue(1234.5, 'N2', { locale: 'en-US', grouping: 'never' })).toBe('1234.50');
  });

  it('an unformatted number has Latin digits with a Latin decimal sign in ar-SA', () => {
    expect(formatValue(1234.5, undefined, { locale: 'ar-SA' })).toBe('1234.5');
    expect(formatValue(1234.5, 'N2', { locale: 'ar-SA' })).not.toMatch(/٫/);
  });
});
