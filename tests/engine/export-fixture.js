// A report with one of everything the exports batch 2 handles: a page header (artifact), a heading, a paragraph,
// a chart with alt text, a picture, a barcode, a shape, a grouped table with subtotals, a grand total and in-cell
// sparklines, and rich text with a list. Shared by tests/engine/export-*.test.js.
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
export const rows = [
  { region: 'North', city: 'Delhi', amt: 130, qty: 3, trend: [1, 3, 2, 5] },
  { region: 'North', city: 'Pune', amt: 70, qty: 2, trend: [2, 2, 4, 3] },
  { region: 'South', city: 'Chennai', amt: 80, qty: 5, trend: [5, 4, 3, 6] },
  { region: 'South', city: 'Kochi', amt: 180.5, qty: 1, trend: [1, 1, 2, 2] },
];
const cell = (value, style = {}) => ({ value, style });
const bold = { fontWeight: 'bold', borderTop: '0.75 solid #94a3b8' };
export const table = {
  type: 'table', name: 'Sales', x: 0, y: 330, w: 420, h: 60, dataSet: 'Rows', repeatHeader: true,
  columns: [{ width: 120 }, { width: 100 }, { width: 100 }, { width: 100 }],
  header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#f1f5f9', borderBottom: '0.75 solid #94a3b8' }, cells: [cell('City'), cell('Amount', { textAlign: 'right' }), cell('Qty', { textAlign: 'right' }), cell('Trend')] }],
  groups: [{ name: 'ByRegion', expr: '=Fields.region', sort: 'asc',
    header: [{ height: 18, cells: [{ value: '=Fields.region', colSpan: 4, style: { fontWeight: 'bold' } }] }],
    footer: [{ height: 18, cells: [cell('Subtotal', bold), cell('=Sum(Fields.amt)', { ...bold, format: 'N2', textAlign: 'right' }), cell('=Count(Fields.city)', { ...bold, textAlign: 'right' }), cell('', bold)] }] }],
  detail: [{ height: 18, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [cell('=Fields.city'), cell('=Fields.amt', { format: 'N2', textAlign: 'right' }), cell('=Fields.qty', { textAlign: 'right' }), { value: '', visual: { type: 'sparkline', values: '=Fields.trend', color: '#2563eb' } }] }],
  footer: [{ height: 18, cells: [cell('Total', bold), cell('=Sum(Fields.amt)', { ...bold, format: 'N2', textAlign: 'right' }), cell('=Avg(Fields.qty)', { ...bold, format: 'N2', textAlign: 'right' }), cell('', bold)] }],
};
export const items = [
  { type: 'textbox', name: 'Title', x: 0, y: 0, w: 400, h: 24, value: 'Sales by region', headingLevel: 1, style: { fontSize: 16, fontWeight: 'bold' } },
  { type: 'textbox', name: 'Intro', x: 0, y: 30, w: 400, h: 16, value: 'Amounts in lakh, boxed.', style: { backgroundColor: '#fef3c7', border: '0.75 solid #f59e0b' } },
  { type: 'chart', name: 'Chart1', x: 0, y: 60, w: 260, h: 160, chartType: 'column', dataSet: 'Rows', category: '=Fields.city', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], alt: 'Column chart: Kochi has the highest amount', legend: 'none' },
  { type: 'image', name: 'Logo', x: 280, y: 60, w: 40, h: 40, src: PNG, fit: 'fill', alt: 'Company logo' },
  { type: 'barcode', name: 'Code', x: 280, y: 110, w: 120, h: 40, symbology: 'code128', value: 'PW-123' },
  { type: 'shape', name: 'Box', x: 280, y: 160, w: 80, h: 40, shape: 'rect', style: { fill: '#e0e7ff', stroke: '#4f46e5', strokeWidth: 1, radius: 6 } },
  { type: 'richtext', name: 'Notes', x: 0, y: 240, w: 400, h: 60, value: '<p>Notes</p><ul><li>First point</li><li>Second point</li></ul>' },
  table,
];
export const def = () => report(items, { data: { rows }, header: { height: 20, items: [{ type: 'textbox', name: 'Hdr', x: 0, y: 0, w: 300, h: 14, value: 'ACME quarterly' }] }, def: { locale: 'en-IN', currency: 'INR' } });
export const model = (opts = {}) => render(def(), { fontStore, ...opts });
export { fontStore };
