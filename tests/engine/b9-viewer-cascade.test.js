import { describe, it, expect } from 'vitest';
import { clearStaleParams } from '../../src/viewer/logic.js';

const def = { parameters: [
  { name: 'region', options: ['North', 'South'] },
  { name: 'city', default: 'Delhi', optionsFrom: { dataSet: 'Cities', value: '=Fields.city' } },
  { name: 'tags', multi: true, optionsFrom: { dataSet: 'T', value: '=Fields.t' } },
] };
const offered = (...v) => v.map(value => ({ value, label: value }));

describe('cascading parameters in the viewer (the value the run uses)', () => {
  it('a city the new region no longer offers is replaced, not kept', () => {
    const p = { region: 'South', city: 'Delhi' };
    const out = clearStaleParams(def, p, { city: offered('Chennai', 'Kochi') });
    expect(out.city).toBe('Chennai'); // not the stale default "Delhi" the engine would fill in for an empty value
    expect(out.region).toBe('South');
  });
  it('keeps a value that is still offered, and returns the same object', () => {
    const p = { region: 'North', city: 'Jaipur' };
    expect(clearStaleParams(def, p, { city: offered('Delhi', 'Jaipur') })).toBe(p);
  });
  it('the default comes back when it is offered again', () => {
    expect(clearStaleParams(def, { city: 'Kochi' }, { city: offered('Jaipur', 'Delhi') }).city).toBe('Delhi');
  });
  it('multi-value keeps the offered items; empty or not-yet-loaded lists leave values alone', () => {
    expect(clearStaleParams(def, { tags: 'a,b,c' }, { tags: offered('b', 'c') }).tags).toBe('b,c');
    const p = { city: 'Delhi' };
    expect(clearStaleParams(def, p, {})).toBe(p);
    expect(clearStaleParams(def, { city: '' }, { city: offered('x') }).city).toBe('');
  });
});
