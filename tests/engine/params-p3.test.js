import { describe, it, expect } from 'vitest';
import { resolveParameters } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { report } from '../helpers.js';

const res = (p, given = {}) => resolveParameters({ parameters: [p] }, given)[p.name];
const missing = (p, given = {}) => { try { resolveParameters({ parameters: [p] }, given); return false; } catch (e) { return e.missingParameters?.includes(p.name); } };

describe('parameter flags', () => {
  it('nullable: null is a value even when required; the default does not replace an explicit null', () => {
    expect(res({ name: 'p', type: 'number', required: true, nullable: true })).toBeNull();
    expect(res({ name: 'p', type: 'number', required: true, nullable: true, default: 5 }, { p: null })).toBeNull();
    expect(res({ name: 'p', type: 'number', nullable: true, default: 5 }, {})).toBe(5);
    expect(res({ name: 'p', type: 'number', nullable: true, default: 5 }, { p: '' })).toBe(5);
    expect(res({ name: 'p', type: 'string', required: true, nullable: true }, { p: '' })).toBeNull();
  });
  it('allowBlank: a blank text satisfies required', () => {
    expect(res({ name: 'p', type: 'string', required: true, allowBlank: true }, { p: '' })).toBe('');
    expect(missing({ name: 'p', type: 'string', required: true, allowBlank: true })).toBe(true); // nothing given is not a blank
    expect(res({ name: 'p', type: 'string', required: true, allowBlank: true, nullable: true }, { p: '' })).toBe('');
  });
  it('without the flags, required still refuses null and blank', () => {
    expect(missing({ name: 'p', type: 'string', required: true }, { p: '' })).toBe(true);
    expect(missing({ name: 'p', type: 'number', required: true }, { p: null })).toBe(true);
    expect(res({ name: 'p', type: 'string' }, { p: '' })).toBe('');
  });
  it('hidden parameters still take given values', () => expect(res({ name: 'p', type: 'number', hidden: true }, { p: '7' })).toBe(7));
  it('multi-value: nothing picked is an empty list (an "in" filter then keeps every row)', () => expect(res({ name: 'p', multi: true }, { p: '' })).toEqual([]));
  it('validate warns about a hidden required parameter with no default', () => {
    const w = validate(report([], { def: { parameters: [{ name: 'h', hidden: true, required: true }, { name: 'ok', hidden: true, required: true, default: 'x' }] } })).warnings;
    expect(w.filter(x => /hidden and required/.test(x))).toHaveLength(1);
  });
});
