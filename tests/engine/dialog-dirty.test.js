// #5: a data source or data set dialog with changes asks before Escape or a click outside discards them.
// sameValue decides "changed": key order and keys set to undefined do not count, values do.
import { describe, it, expect } from 'vitest';
import { sameValue } from '../../src/designer/ui.jsx';

describe('sameValue (dialog dirty check)', () => {
  it('an untouched form is the same', () => {
    const a = { name: '', type: 'rest', fields: [{ name: 'x', type: 'number' }], sort: [] };
    expect(sameValue(a, JSON.parse(JSON.stringify(a)))).toBe(true);
  });
  it('a typed value is a change', () => {
    expect(sameValue({ name: '', url: '' }, { name: 'Sales', url: '' })).toBe(false);
    expect(sameValue({ fields: [{ name: 'a' }] }, { fields: [{ name: 'a' }, { name: 'b' }] })).toBe(false);
    expect(sameValue({ n: 1 }, { n: '1' })).toBe(false);
  });
  it('key order and undefined keys are not changes', () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, relation: undefined })).toBe(true);
    expect(sameValue({ a: null }, { a: undefined })).toBe(false);
  });
});
