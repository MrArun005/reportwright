// format.js formats en-US N and F without Intl: the same text as Intl.NumberFormat for every value.
import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/engine/expr/format.js';

describe('en-US N and F without Intl', () => {
  it('match Intl.NumberFormat', () => {
    const vals = [0, -0, 0.005, -0.005, 0.015, 1.005, 2.675, -2.675, 999.995, 1234.5, -1234.5, 1e6, 123456789.125, -0.0049, 1e20, 9.99e20, 1e21, -1e22, 5e-324, 0.1 + 0.2, 1 / 3];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 20000; i++) vals.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 16), Math.round((rnd() - 0.5) * 1e7) / 1000 + 0.0005);
    for (const fmt of ['N', 'N0', 'N1', 'N2', 'N3', 'N7', 'F', 'F0', 'F2', 'F4']) {
      const d = fmt.length > 1 ? Number(fmt.slice(1)) : 2;
      const intl = new Intl.NumberFormat('en-US', { numberingSystem: 'latn', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: 'negative', useGrouping: fmt[0] === 'N' ? 'auto' : false });
      for (const v of vals) expect(formatValue(v, fmt, { locale: 'en-US' }), `${fmt} ${v}`).toBe(intl.format(v));
    }
  });
});
