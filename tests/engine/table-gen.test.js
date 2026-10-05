// Galleries: number formats from the field, also before sample data has loaded.
import { describe, it, expect } from 'vitest';
import { formatFor, tableFor } from '../../src/designer/tableGen.js';

describe('gallery number formats', () => {
  it('ids, codes and years are plain, before and after the sample loads', () => {
    for (const name of ['id', 'loanId', 'customer_id', 'year', 'pinCode']) {
      expect(formatFor({ name, type: 'number' }, []), name).toBe('0');
      expect(formatFor({ name, type: 'number' }, [{ [name]: 2785 }]), name).toBe('0');
    }
  });
  it('one format per field: counts whole, money with decimals whatever the sample holds; other numbers by their values', () => {
    expect(formatFor({ name: 'qty', type: 'number' }, undefined)).toBe('N0');
    expect(formatFor({ name: 'amount', type: 'number' }, [])).toBe('N2');
    // R1-C (U-6): money is N2 even when the sample happens to be whole, so Rate 4,200.00 and Amount 8,400.00 match
    expect(formatFor({ name: 'amount', type: 'number' }, [{ amount: 12 }, { amount: 30 }])).toBe('N2');
    expect(formatFor({ name: 'score', type: 'number' }, [{ score: 12 }, { score: 30 }])).toBe('N0');
    expect(formatFor({ name: 'date', type: 'date' }, [])).toBe('dd MMM yyyy');
  });
  it('a table made before the data loads shows an id as 2785, not 2,785.00', () => {
    const t = tableFor({ name: 'S', fields: [{ name: 'id', type: 'number' }, { name: 'amount', type: 'number' }] }, { rows: [] });
    expect(t.detail[0].cells.map(c => c.style.format)).toEqual(['0', 'N2']);
    expect(t.footer[0].cells[0].value).toBe('Total'); // an id is never summed
  });
});
