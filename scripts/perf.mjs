// Performance check: N rows through the loan table layout and paginator.
import { render } from '../src/engine/index.js';
import { fontStore } from '../tests/helpers.js';
const N = Number(process.argv[2] || 50000);
const rows = Array.from({ length: N }, (_, i) => ({ n: i + 1, name: `Customer ${i + 1}`, city: ['Bengaluru', 'Pune', 'Delhi'][i % 3], amt: (i * 37) % 1000 + 0.5 }));
const def = {
  $schema: 'reportwright/report@1', name: 'Perf', page: { size: 'A4', margins: [36, 36, 36, 36] },
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

// A pivot over the same rows: 2 row levels × 2 column levels, 2 values, totals at every level.
const prow = rows.map((r, i) => ({ ...r, branch: `B${i % 20}`, year: 2022 + (i % 4), q: 1 + (i % 3) }));
const pdef = { ...def, dataSources: [{ name: 's', type: 'json', data: { rows: prow } }],
  sections: { ...def.sections, body: { items: [{ type: 'matrix', name: 'P', x: 0, y: 0, w: 520, h: 60, dataSet: 'R', columnWidth: 34, rowHeaderWidth: 60,
    rowGroups: [{ expr: '=Fields.city', total: 'after' }, { expr: '=Fields.branch', total: 'after' }],
    columnGroups: [{ expr: '=Fields.year', total: 'after' }, { expr: '=Fields.q', total: 'after' }],
    values: [{ value: '=Sum(Fields.amt)', format: 'N0' }, { value: '=Count(Fields)' }] }] } } };
const t1 = Date.now();
const pout = await render(pdef, { fontStore });
console.log(`${N} rows → pivot of ${pout.regions[0].rows.length} rows × ${pout.regions[0].columns.length} columns, ${pout.pages.length} pages in ${Date.now() - t1} ms`);

// The stress ledger (built in the Designer): scope aggregates in every detail row, a table of contents, 5,000 rows.
const { sampleHard } = await import('../src/sample/hard.js');
const fs = await import('node:fs');
const ledger = JSON.parse(fs.readFileSync(new URL('../reports/stress-ledger.pw.json', import.meta.url), 'utf8'));
const hard = sampleHard(5000);
const lsrc = Object.fromEntries(ledger.dataSources.map(s => [s.name, hard]));
const t2 = Date.now();
const lpart = await render(ledger, { fontStore, sources: lsrc, firstPages: 2 });
const t3 = Date.now();
const lout = await render(ledger, { fontStore, sources: lsrc });
console.log(`stress ledger: first ${lpart.pages.length} pages in ${t3 - t2} ms, all ${lout.pages.length} pages in ${Date.now() - t3} ms`);
