// Member and method lookup read own properties only: no inherited member (constructor, __proto__) is ever returned or called
import { describe, it, expect } from 'vitest';
import { evalValue } from '../../src/engine/expr/evaluate.js';

const ev = (v) => {
  try { return evalValue(v, { fields: { s: 'x' }, params: {}, globals: {} }); } catch (e) { return e; }
};

describe('expressions and inherited members', () => {
  it('does not return an inherited member of a value', () => {
    const c = ev('=Split("a,b", ",").constructor');
    expect(c).toBeInstanceOf(Error);
    expect(c.message).toMatch(/has no member constructor/);
    expect(ev('=Fields.s.__proto__')).toBeInstanceOf(Error);
  });

  it('a method call on an inherited name is a clear error, not a crash', () => {
    const r = ev('="x".constructor()');
    expect(r).toBeInstanceOf(Error);
    expect(r.message).toMatch(/has no member constructor/);
    expect(r.message).not.toMatch(/is not a function/);
  });

  it('a bare call of an Object.prototype name is not a report function', () => {
    expect(ev('=constructor(1)')).toBeInstanceOf(Error);
  });

  it('own members and .NET methods still work', () => {
    expect(ev('="ab".ToUpper()')).toBe('AB');
    expect(ev('=Split("a,b", ",")')).toEqual(['a', 'b']);
  });
});
