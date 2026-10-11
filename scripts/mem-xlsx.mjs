// Peak memory of the Excel export: N rows × 6 columns (default 50,000), render with exportData, then exportXlsx.
//   node --expose-gc scripts/mem-xlsx.mjs [rows]     prints the RSS growth over the start, in MB, after each stage
import fs from 'node:fs';
import path from 'node:path';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
const root = path.join(import.meta.dirname, '..');
const N = Number(process.argv[2]) || 50000;
const OLD = process.argv.includes('--exceljs'); // the 0.7 writer, for comparison: git show 8d9289d:src/exporters/xlsx.js > src/exporters/xlsx-old-tmp.js
const fonts = new FontStore((k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));
const rows = Array.from({ length: N }, (_, i) => ({ id: i, name: `Customer ${i}`, city: ['Pune', 'Delhi', 'Kochi'][i % 3], qty: i % 17, price: (i % 100) * 1.25, day: `2024-0${1 + (i % 9)}-1${i % 9}` }));
const cols = ['id', 'name', 'city', 'qty', 'price', 'day'];
const def = { $schema: 'reportwright/report@1', name: 'Big', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: rows }], dataSets: [{ name: 'D', source: 's' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 520, h: 40, dataSet: 'D', columns: cols.map(() => ({ width: 86 })),
    header: [{ height: 14, cells: cols.map(c => ({ value: c })) }], detail: [{ height: 14, cells: cols.map(c => ({ value: `=Fields.${c}` })) }] }] } } };
const base = process.memoryUsage().rss;
let peak = base;
const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
const mb = (b) => Math.round((b - base) / 1048576);
let model = await render(def, { fontStore: fonts, exportData: true });
peak = Math.max(peak, process.memoryUsage().rss);
console.log(`render: +${mb(peak)} MB peak`);
const t = performance.now();
const bytes = OLD ? await (await import('../src/exporters/xlsx-old-tmp.js')).exportXlsx(model, (await import('exceljs')).default, { pictures: false })
  : await (await import('../src/exporters/xlsx.js')).exportXlsx(model, { pictures: false });
peak = Math.max(peak, process.memoryUsage().rss);
clearInterval(tick);
console.log(`${OLD ? 'exceljs' : 'own writer'}: ${N} rows → ${(bytes.length / 1048576).toFixed(1)} MB xlsx in ${Math.round(performance.now() - t)} ms; peak RSS +${mb(peak)} MB over start`);
