// Memory of the Word and Excel exports: an N-row × 6-column table report (default 20,000), either rendered whole and
// exported (model: render + exportDocx / exportXlsx) or streamed (stream: exportDocxStream / exportXlsxStream to a file).
//   /usr/bin/time -l node scripts/mem-office.mjs docx|xlsx model|stream [rows] [out]
// Measure peak RSS with /usr/bin/time -l (one process per run). Streamed, it is flat: the same at 20,000 and 50,000 rows.
// Never run 500k-row sizes on a small laptop. out: the file written (default: a temp file, deleted).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';

const root = path.join(import.meta.dirname, '..');
const [fmt = 'docx', mode = 'model', n = '20000', outArg] = process.argv.slice(2);
const N = Number(n);
const out = outArg || path.join(os.tmpdir(), `pw-mem-office-${process.pid}.${fmt}`);
const fontStore = new FontStore((k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));
const row = (i) => ({ id: i, name: `Customer ${i}`, city: ['Pune', 'Delhi', 'Kochi'][i % 3], qty: i % 17, price: (i % 100) * 1.25, day: `2024-0${1 + (i % 9)}-1${i % 9}` });
// a SQL source: the model path reads its rows whole (sql), the stream path a batch at a time (sqlRows), so the rows
// are made as they are read and the script itself holds none
const sql = async () => Array.from({ length: N }, (_, i) => row(i));
async function* sqlRows() { for (let i = 0; i < N; i += 1000) yield Array.from({ length: Math.min(1000, N - i) }, (_, k) => row(i + k)); }
const cols = ['id', 'name', 'city', 'qty', 'price', 'day'];
const def = { $schema: 'reportwright/report@1', name: 'Big', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select * from t' }],
  dataSets: [{ name: 'D', source: 's', fields: cols.map(c => ({ name: c, type: ['id', 'qty', 'price'].includes(c) ? 'number' : 'string' })) }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 516, h: 40, dataSet: 'D', columns: cols.map(() => ({ width: 86 })),
    header: [{ height: 14, cells: cols.map(c => ({ value: c })) }], detail: [{ height: 14, cells: cols.map(c => ({ value: `=Fields.${c}` })) }] }] } } };
const t0 = performance.now();
let r = {};
if (mode === 'model') {
  const model = await render(def, { fontStore, exportData: true, sql });
  const { exportDocx } = await import('../src/exporters/docx.js');
  const { exportXlsx } = await import('../src/exporters/xlsx.js');
  const bytes = fmt === 'docx' ? await exportDocx(model, { fontStore }) : await exportXlsx(model, { fontStore });
  fs.writeFileSync(out, bytes);
  r = { pages: model.pages.length };
} else {
  const { exportDocxStream, exportXlsxStream } = await import('../src/exporters/officestream.js');
  const sink = fs.createWriteStream(out);
  r = await (fmt === 'docx' ? exportDocxStream : exportXlsxStream)(def, { fontStore, sqlRows }, sink);
  await new Promise((ok, fail) => sink.end((e) => (e ? fail(e) : ok())));
}
console.log(JSON.stringify({ fmt, mode, rows: N, streamed: r.streamed, pages: r.pages, why: r.why, MB: +(fs.statSync(out).size / 1048576).toFixed(1), ms: Math.round(performance.now() - t0), out }));
if (!outArg) fs.rmSync(out);
