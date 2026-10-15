// #2: a table inserted in a list of another data set is offered a filter to the list's current row
import { describe, it, expect } from 'vitest';
import { relationGuess, parentFilter } from '../../src/designer/tableGen.js';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore } from '../helpers.js';

const ds = (name, ...fields) => ({ name, fields: fields.map((f) => (typeof f === 'string' ? { name: f, type: 'string' } : f)) });
const num = (name) => ({ name, type: 'number' });

describe('relationGuess', () => {
  it('orderId in the child, id in the parent (Orders)', () => {
    expect(relationGuess(ds('Orders', num('id'), 'customer'), ds('Lines', num('orderId'), 'product'))).toEqual({ child: 'orderId', parent: 'id' });
  });
  it('order_id and a plural ending in -ies', () => {
    expect(relationGuess(ds('Categories', num('id'), 'name'), ds('Products', num('category_id'), 'name'))).toEqual({ child: 'category_id', parent: 'id' });
  });
  it('the same key name on both sides', () => {
    expect(relationGuess(ds('Customers', num('customerId'), 'name'), ds('Invoices', num('invoiceId'), num('customerId')))).toEqual({ child: 'customerId', parent: 'customerId' });
  });
  it('a key named after the parent data set in both: orderId ↔ orderId', () => {
    expect(relationGuess(ds('Orders', num('orderId')), ds('Lines', num('lineId'), num('orderId')))).toEqual({ child: 'orderId', parent: 'orderId' });
  });
  it('an identical non-key name as a last resort', () => {
    expect(relationGuess(ds('Regions', 'region', num('target')), ds('Sales', 'region', num('amount')))).toEqual({ child: 'region', parent: 'region' });
  });
  it('nothing in common: null', () => {
    expect(relationGuess(ds('Orders', num('id')), ds('Rates', 'currency', num('rate')))).toBe(null);
  });
  it('a child id is not paired with a parent id (both are their own rows\' keys)', () => {
    expect(relationGuess(ds('Orders', num('id'), 'customer'), ds('Rates', num('id'), num('rate')))).toBe(null);
  });
});

describe('the filter it adds', () => {
  it('shows each order its own lines', async () => {
    const def = {
      $schema: 'reportwright/report@1', name: 'T', page: { size: 'A4', margins: [36, 36, 36, 36] },
      dataSources: [{ name: 'src', type: 'json', data: { orders: [{ id: 1 }, { id: 2 }], lines: [{ orderId: 1, p: 'A' }, { orderId: 2, p: 'B' }, { orderId: 2, p: 'C' }] } }],
      dataSets: [
        { name: 'Orders', source: 'src', path: '$.orders[*]', fields: [num('id')] },
        { name: 'Lines', source: 'src', path: '$.lines[*]', fields: [num('orderId'), { name: 'p', type: 'string' }] },
      ],
      sections: { body: { items: [{ type: 'list', name: 'L', dataSet: 'Orders', x: 0, y: 0, w: 300, h: 60, items: [
        { type: 'textbox', name: 'H', x: 0, y: 0, w: 100, h: 18, value: '="Order " & Fields.id' },
        { type: 'table', name: 'T', dataSet: 'Lines', x: 0, y: 20, w: 200, h: 18, columns: [{ width: 200 }], detail: [{ height: 18, cells: [{ value: '=Fields.p' }] }],
          filters: parentFilter({ child: 'orderId', parent: 'id' }) },
      ] }] } },
    };
    expect(validate(def).errors).toEqual([]);
    const m = await render(def, { fontStore });
    const t = m.pages[0].items.filter((i) => i.t === 'text').map((i) => i.lines.map((l) => l.text).join(' '));
    expect(t).toEqual(['Order 1', 'A', 'Order 2', 'B', 'C']);
  });
});
