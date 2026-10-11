import { describe, it, expect } from 'vitest';
import { resolvePage, PAGE_SIZES } from '../../src/engine/units.js';
import { validate } from '../../src/engine/schema/validate.js';

describe('page size names are forgiving', () => {
  it('trims whitespace and ignores case', () => {
    expect(resolvePage({ size: 'A4 ' }).width).toBeCloseTo(PAGE_SIZES.A4[0]);
    expect(resolvePage({ size: 'letter' }).width).toBeCloseTo(PAGE_SIZES.Letter[0]);
    expect(resolvePage({ size: ' legal\n' }).height).toBeCloseTo(PAGE_SIZES.Legal[1]);
    expect(resolvePage({ size: 'a3' }).width).toBeCloseTo(PAGE_SIZES.A3[0]);
    expect(resolvePage({ size: 'pageless' }).pageless).toBe(true);
  });
  it('an unknown size keeps the A4 fallback', () => {
    const p = resolvePage({ size: 'A44' });
    expect(p.width).toBeCloseTo(PAGE_SIZES.A4[0]);
    expect(p.height).toBeCloseTo(PAGE_SIZES.A4[1]);
  });
  it('validate does not warn about a name that now resolves', () => {
    const def = { $schema: 'reportwright/report@1', name: 'x', page: { size: 'A4 ' }, sections: { body: { items: [] } } };
    const warnings = validate(def).warnings ?? [];
    expect(warnings.filter(w => /page size/i.test(w))).toEqual([]);
  });
});
