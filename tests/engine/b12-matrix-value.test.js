// #8: the table wizard's matrix sums an amount, never an id or a code; with no such number it counts rows
import { describe, it, expect } from 'vitest';
import { sumFieldFor } from '../../src/designer/tableGen.js';

describe('matrix value field', () => {
  it('skips id and code fields for the first amount', () => {
    const fields = [
      { name: 'id', type: 'number' },
      { name: 'region', type: 'string' },
      { name: 'customerId', type: 'number' },
      { name: 'amount', type: 'number' },
    ];
    expect(sumFieldFor(fields, [])).toBe('amount');
  });
  it('skips rates and row numbers', () => {
    const fields = [
      { name: 'rate', type: 'number' },
      { name: 'lineNo', type: 'number' },
      { name: 'qty', type: 'number' },
    ];
    expect(sumFieldFor(fields, [])).toBe('qty');
  });
  it('no additive number: empty, so the matrix counts rows', () => {
    const fields = [
      { name: 'id', type: 'number' },
      { name: 'region', type: 'string' },
      { name: 'year', type: 'number' },
    ];
    expect(sumFieldFor(fields, [])).toBe('');
  });
  it('a column that counts up by one in the sample is a row number', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ n, v: n * 10.5 }));
    expect(
      sumFieldFor(
        [
          { name: 'n', type: 'number' },
          { name: 'v', type: 'number' },
        ],
        rows,
      ),
    ).toBe('v');
  });
});
