// Performance check: N rows through the loan table layout and paginator.
import { render } from '../src/engine/index.js';
import { fontStore } from '../tests/helpers.js';
const N = Number(process.argv[2] || 50000);
const rows = Array.from({ length: N }, (_, i) => ({ n: i + 1, name: `Customer ${i + 1}`, city: ['Bengaluru', 'Pune', 'Delhi'][i % 3], amt: (i * 37) % 1000 + 0.5 }));
const def = {
  $schema: 'pagewright/report@1', name: 'Perf', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'R', source: 's', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 500, h: 54, dataSet: 'R', columns: [{ width: 60 }, { width: 200 }, { width: 140 }, { width: 100 }],
    header: [{ height: 18, cells: [{ value: '#' }, { value: 'Name' }, { value: 'City' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
    footer: [{ height: 18, cells: [{ value: 'Total' }, null, null, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 4, w: 200, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] } },
};
const t0 = Date.now();
const out = await render(def, { fontStore });
console.log(`${N} rows → ${out.pages.length} pages in ${Date.now() - t0} ms (engine stats ${out.stats.ms} ms)`);
