// B2 item 8: the table wizard totals amounts, not ids, instalment numbers or other running sequences;
// the pivot's Sum value is headed by the field ("Amount"), short enough not to wrap.
import { describe, it, expect } from 'vitest';
import { tableFor } from '../../src/designer/tableGen.js';
import { pivotFor } from '../../src/designer/PivotWizard.jsx';

const ds = { name: 'S', fields: [{ name: 'installment', type: 'number' }, { name: 'loanId', type: 'number' }, { name: 'line', type: 'number' }, { name: 'emi', type: 'number' }, { name: 'k', type: 'number' }, { name: 'units', type: 'number' }] };
const rows = [1, 2, 3, 4, 5, 6].map(i => ({ installment: i, loanId: 900 + i * 7, line: i, emi: 1000.5, k: 10 + i, units: [3, 1, 4, 1, 5, 9][i - 1] }));
const footer = (t) => t.footer[0].cells.map(c => c.value);

describe('table wizard totals', () => {
  it('skips ids, sequence names and running integer sequences; totals amounts and counts', () => {
    const t = tableFor(ds, { rows });
    expect(footer(t)).toEqual(['Total', '', '', '=Sum(Fields.emi)', '', '=Sum(Fields.units)']);
  });
  it('without sample rows the names still decide', () => {
    expect(footer(tableFor(ds, {}))).toEqual(['Total', '', '', '=Sum(Fields.emi)', '=Sum(Fields.k)', '=Sum(Fields.units)']);
  });
  it('a pivot Sum is headed by the field; other aggregates say what they are', () => {
    const m = pivotFor(ds, { rows: [], columns: [], values: [{ field: 'emi', agg: 'Sum' }, { field: 'emi', agg: 'Avg' }] });
    expect(m.values.map(v => v.label)).toEqual(['Emi', 'Avg of Emi']);
  });
});
