// The pdfmake nested-table case: an orders table whose third cell holds a table over that order's lines
// (a relation data set: each order row gets its own children, docs/API.md "item on a cell").
import { report, renderDef } from '../lib/rw.mjs';
import { orders } from './data.mjs';

const inner = { type: 'table', name: 'Inner', dataSet: 'Lines', x: 0, y: 0, w: 335, h: 60, columns: [{ width: 235 }, { width: 40 }, { width: 60 }],
  header: [{ height: 14, style: { fontWeight: 'bold', fontSize: 9 }, cells: ['SKU', 'Qty', 'Price'].map((value) => ({ value })) }],
  detail: [{ height: 14, style: { fontSize: 9, borderBottom: '0.5 solid #BBBBBB' }, cells: [{ value: '=Fields.sku' }, { value: '=Fields.qty' }, { value: '=Fields.price', style: { format: 'N2' } }] }] };
const def = report('Orders', [
  { type: 'textbox', name: 'Title', x: 0, y: 0, w: 515, h: 24, value: 'Orders', style: { fontSize: 18, fontWeight: 'bold' } },
  { type: 'table', name: 'Outer', dataSet: 'Orders', x: 0, y: 30, w: 515, h: 40, repeatHeader: true, columns: [{ width: 70 }, { width: 110 }, { width: 335 }],
    header: [{ height: 14, style: { fontWeight: 'bold', fontSize: 9, border: '0.5 solid #000000' }, cells: ['Order', 'Customer', 'Lines'].map((value) => ({ value })) }],
    detail: [{ height: 90, canGrow: true, style: { fontSize: 9, border: '0.5 solid #000000' }, cells: [{ value: '=Fields.id' }, { value: '=Fields.customer' }, { item: inner }] }] },
], { dataSources: [{ name: 'src', type: 'json', data: orders }],
  dataSets: [{ name: 'Orders', source: 'src', fields: [{ name: 'id', type: 'string' }, { name: 'customer', type: 'string' }] },
    { name: 'Lines', source: 'src', relation: { parent: 'Orders', path: '$.lines' }, fields: [{ name: 'sku', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'price', type: 'number' }] }] });
await renderDef(def);
