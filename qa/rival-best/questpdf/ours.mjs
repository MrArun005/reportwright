// The QuestPDF invoice as a ReportWright definition: header band, table with header row, total, page footer.
import { report, renderDef } from '../lib/rw.mjs';

const lines = Array.from({ length: 40 }, (_, k) => { const i = k + 1; return { n: i, name: `Item ${i}`, qty: (i * 7) % 13 + 1, price: ((i * 37) % 500) / 10 + 5 }; });
const tb = (name, x, y, w, h, value, style = {}) => ({ type: 'textbox', name, x, y, w, h, value, style: { fontSize: 10, ...style } });
const W = 515, cols = [30, 194, 97, 97, 97], cell = { padding: 4, borderBottom: '0.5 solid #BDBDBD' };
const def = report('Invoice', [
  { type: 'table', name: 'Lines', dataSet: 'L', x: 0, y: 0, w: W, h: 60, repeatHeader: true, columns: cols.map((width) => ({ width })),
    header: [{ height: 20, style: { fontWeight: 'bold', backgroundColor: '#E0E0E0', padding: 4 }, cells: ['#', 'Product', 'Price', 'Qty', 'Total'].map((value) => ({ value })) }],
    detail: [{ height: 20, style: cell, cells: [{ value: '=Fields.n' }, { value: '=Fields.name' }, { value: '=Fields.price', style: { format: 'N2', textAlign: 'right' } },
      { value: '=Fields.qty', style: { textAlign: 'right' } }, { value: '=Fields.qty * Fields.price', style: { format: 'N2', textAlign: 'right' } }] }],
    footer: [{ height: 30, cells: [{ value: '="Grand total: " & Format(Sum(Fields.qty * Fields.price), "N2")', colSpan: 5, style: { fontSize: 14, fontWeight: 'bold', textAlign: 'right', paddingTop: 10 } }, null, null, null, null] }] },
], {
  dataSources: [{ name: 'src', type: 'json', data: lines }],
  dataSets: [{ name: 'L', source: 'src', fields: [{ name: 'n', type: 'number' }, { name: 'name', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'price', type: 'number' }] }],
  sections: {
    pageHeader: { height: 70, items: [
      tb('Title', 0, 0, 260, 26, 'Invoice #2026-0042', { fontSize: 20, fontWeight: 'bold', color: '#1565C0' }),
      tb('Issue', 0, 28, 260, 14, 'Issue date: 2026-10-01'), tb('Due', 0, 42, 260, 14, 'Due date: 2026-10-31'),
      tb('Co', 255, 0, 260, 14, 'Acme Supplies Ltd', { fontWeight: 'bold', textAlign: 'right' }),
      tb('Addr1', 255, 14, 260, 14, '12 Market Street', { textAlign: 'right' }), tb('Addr2', 255, 28, 260, 14, 'Bengaluru 560001', { textAlign: 'right' })] },
    pageFooter: { height: 20, items: [tb('Pg', 0, 4, W, 14, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { textAlign: 'center' })] },
  },
});
await renderDef(def);
