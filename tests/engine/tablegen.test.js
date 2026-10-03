// Table and matrix galleries (ROADMAP week 4): the items the gallery and "drag a data set" insert.
import { describe, it, expect } from 'vitest';
import { tableFor, matrixFor, labelOf } from '../../src/designer/tableGen.js';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const ds = { name: 'Rows', fields: [{ name: 'region', type: 'string' }, { name: 'dueDate', type: 'date' }, { name: 'qty', type: 'number' }, { name: 'amount', type: 'number' }] };
const rows = [
  { region: 'North', dueDate: '2026-01-05', qty: 2, amount: 10.5 },
  { region: 'South', dueDate: '2026-01-06', qty: 1, amount: 20 },
  { region: 'North', dueDate: '2026-02-01', qty: 3, amount: 30 },
];
const draw = async (item) => {
  const def = report([{ name: 'X', x: 0, y: 0, ...item }], { data: { rows } });
  expect(validate(def).errors).toEqual([]);
  return render(def, { fontStore });
};

describe('table gallery', () => {
  it('labels fields the way people read them', () => {
    expect(labelOf('dueDate')).toBe('Due date');
    expect(labelOf('customer_name')).toBe('Customer name');
    expect(labelOf('ID')).toBe('ID');
  });

  it('a list: one column per field, formats by type, totals for numbers, fits the width', async () => {
    const t = tableFor(ds, { layout: 'list', width: 500, rows });
    expect(t.type).toBe('table');
    expect(t.columns.reduce((s, c) => s + c.width, 0)).toBeCloseTo(500, 5);
    const out = await draw(t);
    const tx = texts(out.pages[0]);
    expect(tx.slice(0, 4)).toEqual(['Region', 'Due date', 'Qty', 'Amount']);
    expect(tx).toContain('05 Jan 2026');
    expect(tx).toContain('60.50'); // total of amount
    expect(tx).toContain('6');     // total of qty
  });

  it('totals only add up what can be added (not rates, prices, percentages, ids or years)', async () => {
    const d = { name: 'Rows', fields: [{ name: 'item', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'unitPrice', type: 'number' }, { name: 'taxRate', type: 'number' }, { name: 'amount', type: 'number' }, { name: 'year', type: 'number' }] };
    const t = tableFor(d, { layout: 'list', width: 500 });
    expect(t.footer[0].cells.map(c => c.value)).toEqual(['Total', '=Sum(Fields.qty)', '', '', '=Sum(Fields.amount)', '']);
  });

  it('grouped: a header per group and subtotals', async () => {
    const out = await draw(tableFor(ds, { layout: 'grouped', groupBy: 'region', width: 500, rows }));
    const tx = texts(out.pages[0]);
    expect(tx.filter(s => s === 'North')).toHaveLength(1); // the group header, not repeated in the rows
    expect(tx).toContain('40.50'); // North subtotal
    expect(tx).toContain('60.50'); // grand total
  });

  it('summary: one row per group with the totals', async () => {
    const out = await draw(tableFor(ds, { layout: 'summary', groupBy: 'region', width: 500, rows }));
    const tx = texts(out.pages[0]);
    expect(tx).toEqual(expect.arrayContaining(['North', 'South', '40.50', '20.00', '60.50']));
    expect(tx).not.toContain('05 Jan 2026'); // no detail rows
  });

  it('a matrix: rows × columns of an aggregate', async () => {
    const out = await draw(matrixFor(ds, { rows: 'region', columns: 'qty', value: 'amount', width: 500, sample: rows }));
    expect(texts(out.pages[0])).toEqual(expect.arrayContaining(['North', 'South', '10.50', '30.00', 'Total']));
  });
});
