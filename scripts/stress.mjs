// Scale stress: render a grouped report over N rows, then export it to every format, timing each step and the memory peak.
//   node scripts/stress.mjs [rows=50000] [formats=pdf,xlsx,docx,html,csv]
import { render } from '../src/engine/index.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { exportXlsx } from '../src/exporters/xlsx.js';
import { exportDocx } from '../src/exporters/docx.js';
import { exportHtml } from '../src/exporters/html.js';
import { exportCsv } from '../src/exporters/csv.js';
import { fontStore } from '../tests/helpers.js';

const N = Number(process.argv[2] || 50000);
const formats = (process.argv[3] || 'pdf,xlsx,docx,html,csv').split(',');
const cities = ['Bengaluru', 'Pune', 'Delhi', 'Mumbai', 'Chennai', 'Kolkata', 'Jaipur', 'Patna'];
const rows = Array.from({ length: N }, (_, i) => ({ n: i + 1, city: cities[i % 8], product: ['Home', 'Gold', 'Personal'][i % 3], month: (i % 12) + 1, amt: ((i * 37) % 1000) + 0.5, npa: (i % 50) / 10 }));
const def = {
  $schema: 'pagewright/report@1', name: 'Stress', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'R', source: 's', path: '$.rows' }],
  sections: {
    pageHeader: { height: 20, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 300, h: 14, value: 'Stress report · {Globals.ReportName}' }] },
    body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 520, h: 54, dataSet: 'R', repeatHeader: true,
      columns: [{ width: 60 }, { width: 140 }, { width: 120 }, { width: 100 }, { width: 100 }],
      header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#1d4ed8', color: '#ffffff' }, cells: [{ value: '#' }, { value: 'City / product' }, { value: 'Trend' }, { value: 'Amount' }, { value: 'Running' }] }],
      groups: [
        { name: 'City', expr: '=Fields.city', sort: 'desc', sortBy: '=Sum(Fields.amt)', header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#eff6ff' }, cells: [{ value: '' }, { value: '=Fields.city', bookmark: '=Fields.city' }, { value: '', visual: { type: 'sparkline', category: '=Fields.month', value: '=Sum(Fields.amt)' } }, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }, { value: '=Sum(Fields.amt) / Sum(Fields.amt, "T")', style: { format: 'P1' } }] }], footer: [] },
        { name: 'Product', expr: '=Fields.product', sort: 'asc', header: [{ height: 16, cells: [{ value: '' }, { value: '=Fields.product' }, { value: '', visual: { type: 'databar', value: '=Sum(Fields.amt)', max: '=Sum(Fields.amt, "City")' } }, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }, { value: '' }] }], footer: [] },
      ],
      detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.product & " · " & MonthName(Fields.month, True)' }, { value: "=IIF(Fields.npa > 2.5, 'over cap', '')", style: { color: "=IIF(Fields.npa > 2.5, '#b91c1c', '#111827')" } }, { value: '=Fields.amt', style: { format: 'N2' } }, { value: '=RunningValue(Fields.amt, "Sum", "Product")', style: { format: 'N2' } }] }],
      footer: [{ height: 18, cells: [{ value: 'Total' }, null, null, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }, null] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 4, w: 200, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
};

const mb = () => Math.round(process.memoryUsage().rss / 1048576);
let peak = mb();
const tick = setInterval(() => { peak = Math.max(peak, mb()); }, 50);
const time = async (label, fn) => {
  const t0 = performance.now();
  const r = await fn();
  const size = r?.byteLength ?? r?.length;
  console.log(`${label.padEnd(8)} ${String(Math.round(performance.now() - t0)).padStart(7)} ms${size != null ? `  ${(size / 1048576).toFixed(1)} MB` : ''}  rss ${mb()} MB`);
  return r;
};

console.log(`${N} rows`);
const model = await time('render', () => render(def, { fontStore }));
console.log(`         ${model.pages.length} pages, ${model.pages.reduce((s, p) => s + p.items.length, 0)} page items, ${model.warnings.length} warnings`);
for (const f of formats) {
  try {
    if (f === 'pdf') await time('pdf', () => exportPdf(model, fontStore, { title: 'Stress' }));
    if (f === 'xlsx') await time('xlsx', async () => exportXlsx(model, (await import('exceljs')).default, { title: 'Stress' }));
    if (f === 'docx') await time('docx', () => exportDocx(model, { title: 'Stress' }));
    if (f === 'html') await time('html', () => exportHtml(model, fontStore, { title: 'Stress' }));
    if (f === 'csv') await time('csv', () => exportCsv(model, {}));
  } catch (e) { console.log(`${f.padEnd(8)} FAILED: ${e.message}`); }
}
clearInterval(tick);
console.log(`peak rss ${Math.max(peak, mb())} MB`);
