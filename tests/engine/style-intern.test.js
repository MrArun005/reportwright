// resolveStyle with expression layers (a zebra row: '=IIf(RowNumber() Mod 2 = 0, …)'): rows whose expressions give the
// same values share one frozen style, so a table of 100,000 such rows makes two styles, not 100,000 (and the cell styles
// built on them hit the static cache instead of a WeakMap entry per row).
import { describe, it, expect } from 'vitest';
import { resolveStyle, BASE_STYLE } from '../../src/engine/style.js';

describe('resolveStyle: expression layers', () => {
  const row = { backgroundColor: '=IIf(RowNumber() Mod 2 = 0, "#f3f4f6", "#ffffff")' };
  const cell = { format: 'N2' };
  it('rows with the same evaluated values share one frozen style; the cells built on it too', () => {
    const at = (n) => resolveStyle([BASE_STYLE, row], { rowNumber: n, fields: {} });
    const a = at(2), b = at(4), c = at(3);
    expect(a.backgroundColor).toBe('#f3f4f6');
    expect(c.backgroundColor).toBe('#ffffff');
    expect(b).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(resolveStyle([a, cell], {})).toBe(resolveStyle([b, cell], {}));
  });
  it('values that are not plain (a date, an object) or too many distinct ones are not kept', () => {
    const d = { dt: '=Fields.d' };
    const x = resolveStyle([BASE_STYLE, d], { fields: { d: new Date(0) } }), y = resolveStyle([BASE_STYLE, d], { fields: { d: new Date(0) } });
    expect(x).not.toBe(y);
    const per = { color: '=Fields.c' };
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(resolveStyle([BASE_STYLE, per], { fields: { c: `#${String(i).padStart(6, '0')}` } }));
    expect(seen.size).toBe(1000); // distinct values: distinct styles, the cache stays bounded
    const again = resolveStyle([BASE_STYLE, per], { fields: { c: '#000999' } });
    expect(again.color).toBe('#000999');
  });
});
