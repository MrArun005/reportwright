// Where a large report's memory goes, per data row: node --expose-gc scripts/mem-rows.mjs [rows]
// Prints the heap held (after GC) by the source rows and by the page model render() returns (with and without
// exportData), and what the model's pages are made of.
import fs from 'node:fs';
import path from 'node:path';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
const root = path.join(import.meta.dirname, '..');
const N = Number(process.argv[2]) || 50000;
if (!global.gc) { console.error('run with node --expose-gc'); process.exit(1); }
const fonts = new FontStore((k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));
const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
const per = (b) => `${(b / N / 1024).toFixed(2)} KB/row`;
const cols = ['id', 'name', 'city', 'qty', 'price', 'day'];
const def = (data) => ({ $schema: 'reportwright/report@1', name: 'Big', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data }], dataSets: [{ name: 'D', source: 's' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 520, h: 40, dataSet: 'D', columns: cols.map(() => ({ width: 86 })),
    header: [{ height: 14, cells: cols.map(c => ({ value: c })) }], detail: [{ height: 14, cells: cols.map(c => ({ value: `=Fields.${c}` })) }] }] } } });
await render(def([{ id: 1 }]), { fontStore: fonts }); // fonts loaded, code warm
const h0 = heap();
let rows = Array.from({ length: N }, (_, i) => ({ id: i, name: `Customer ${i}`, city: ['Pune', 'Delhi', 'Kochi'][i % 3], qty: i % 17, price: (i % 100) * 1.25, day: `2024-0${1 + (i % 9)}-1${i % 9}` }));
const h1 = heap();
console.log(`source rows: ${per(h1 - h0)}`);
const ref = new WeakRef(rows);
for (const exportData of [false, true]) {
  let model = await render(def(ref.deref()), { fontStore: fonts, exportData });
  const h2 = heap();
  console.log(`model + source (exportData ${exportData}): ${per(h2 - h0)}; ${model.pages.length} pages`);
  model = null;
}
let model = await render(def(ref.deref()), { fontStore: fonts });
const keys = {};
for (const pg of model.pages) for (const it of pg.items) keys[it.t] = (keys[it.t] || 0) + 1;
console.log('page items:', JSON.stringify(keys), `(${((Object.values(keys).reduce((a, b) => a + b, 0)) / N).toFixed(1)} per row)`);
console.log('model keys:', Object.keys(model).join(', '));
