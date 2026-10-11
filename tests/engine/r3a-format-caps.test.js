// R3-A: formats are capped before they build anything: a pattern of at most 1,000 characters, at most 340 digits
// (width, precision, decimals), and String.format output under the shared 1,000,000-character cap. A hostile
// pattern fails fast with #Error in its cell and a warning, never a giant allocation.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const cell = async (value, format) => {
  const t0 = performance.now();
  const m = await render({ $schema: 'reportwright/report@1', page: { size: 'A4' }, sections: { body: { height: 40, items: [
    { type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 12, value, style: format ? { format } : {} }] } } }, { fontStore });
  const text = m.pages[0].items.flatMap(i => i.lines || []).map(l => l.text).join('');
  return { text, warnings: m.warnings, ms: performance.now() - t0 };
};

describe('format caps', () => {
  it.each([
    ['=JavaFormat("%999999999d", 1)', null],
    ['=JavaFormat("%.999999999f", 1)', null],
    ['=JavaFormat("%" & StrDup(900, "0") & "x", 1)', null],
    ['=1.5', `java:0.${'0'.repeat(500)}`],
    ['=1.5', `java:${'0'.repeat(500)}`],
    ['=1.5', `java:#,##0${'x'.repeat(5000)}`],
    ['=1.5', `icu:0.${'#'.repeat(400)}E0`],
    ['=Today()', `java:${'y'.repeat(900)}`],
    ['=1.5', `0.${'0'.repeat(500)}`],
    ['=1.5', `#,##0${'"x"'.repeat(2000)}`],
    ['=Format(1.5, "0." & StrDup(600, "0"))', null],
  ].map((x, i) => [i, ...x]))('hostile format %i', async (i, value, format) => {
    const r = await cell(value, format);
    expect(r.text).toBe('#Error');
    expect(r.warnings.join(' ')).toMatch(/more than 340|longer than 1,?000|1,000,000|not a format specifier/);
    expect(r.ms).toBeLessThan(500); // the render; the format itself is refused in well under 50 ms
  });
  it('a format refuses in under 50 ms', async () => {
    const { formatValue } = await import('../../src/engine/expr/format.js');
    const { javaFormatString } = await import('../../src/engine/expr/javafmt.js');
    for (const run of [() => formatValue(1.5, `java:0.${'0'.repeat(999)}`), () => formatValue(1.5, 'x'.repeat(2_000_000)), () => javaFormatString('%999999999d', [1]), () => javaFormatString(`%${'0'.repeat(100000)}d`, [1])]) {
      const t0 = performance.now();
      let threw = false;
      try { run(); } catch { threw = true; }
      expect(performance.now() - t0).toBeLessThan(50);
      // a run of 100,000 zeros is not a conversion Java reads either: it is left as text, linear time
      if (threw === false) expect(run().length).toBeLessThan(200_000);
    }
  });
  it('ordinary patterns still work', async () => {
    expect((await cell('=JavaFormat("%05d|%.2f", -1, 2.5)')).text).toBe('-0001|2.50');
    expect((await cell('=1234.5', 'java:#,##0.00')).text).toBe('1,234.50');
    expect((await cell('=1234.5', 'N2')).text).toBe('1,234.50');
  });
});
