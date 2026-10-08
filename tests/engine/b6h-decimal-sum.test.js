// Decimal sums stay exact above 2^49 (where a scaled integer no longer fits the fast path): near, past and across the limit.
import { describe, it, expect } from 'vitest';
import { decAdd } from '../../src/engine/expr/evaluate.js';

describe('decAdd is exact above 2^49', () => {
  it('a money total past the limit plus a cent', () => {
    expect(decAdd(6000000000035.65, 0.07)).toBe(6000000000035.72);
    expect(decAdd(-6000000000035.65, -0.07)).toBe(-6000000000035.72);
    expect(decAdd(6000000000035.65, -0.07)).toBe(6000000000035.58);
  });
  it('just below and just above 2^49', () => {
    expect(decAdd(562949953421311.5, 0.25)).toBe(562949953421311.75);
    expect(decAdd(562949953421312.1, 0.2)).toBe(562949953421312.3);
    expect(decAdd(-562949953421312.1, -0.2)).toBe(-562949953421312.3);
    expect(decAdd(562949953421312.1, -0.2)).toBe(562949953421311.9);
  });
  it('a sum of many cents past the limit lands on the decimal total', () => {
    let t = 6000000000000.01;
    for (let i = 0; i < 99; i++) t = decAdd(t, 0.01);
    expect(t).toBe(6000000000001);
  });
  it('small values are unchanged', () => {
    expect(decAdd(0.1, 0.2)).toBe(0.3);
    expect(decAdd(1.5, 2.25)).toBe(3.75);
  });
});
