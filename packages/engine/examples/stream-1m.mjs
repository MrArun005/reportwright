#!/usr/bin/env node
// A million-row ledger streamed to a PDF file, with the process's peak memory: the proof that a large report's PDF
// is written with flat memory. The rows are made as they are read (an async generator standing in for a database
// cursor), so nothing holds them all.
//
//   npm i @reportwright/engine @reportwright/fonts
//   node node_modules/@reportwright/engine/examples/stream-1m.mjs [rows=1000000] [out=ledger.pdf] [--plain] [--grouped] [--presorted] [--tagged] [--array[=text]] [--parallel=N]
//
// Prints one JSON line: { rows, pages, streamed, peakRssMB, ms, bytes, ... }. "Page N of M" is in the page footer
// (the rows are read twice: once to count the pages); --plain leaves M out (one pass). --grouped adds two group levels
// with subtotals (sorted through a disk spill; --presorted: the rows come in group order and are only checked); --tagged
// makes an accessible PDF/A (PDF/UA-1 + PDF/A-2a); --array: the rows as one array in the definition (--array=text: as
// JSON text); --parallel=N lays out and paints with N worker threads (serial by default: each thread costs 150-300 MB).
// RW_ENGINE: import the engine from another path (a checkout: packages/engine/entry.js); RW_PUBLIC: a folder with fonts/
// and harfbuzz-subset.wasm instead of @reportwright/fonts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (f) => args.includes(`--${f}`);
const opt = (f) => args.find(a => a.startsWith(`--${f}=`))?.split('=')[1];
const pos = args.filter(a => !a.startsWith('--'));
const N = Number(pos[0]) || 1_000_000;
const file = pos[1] || 'ledger.pdf';
const engine = await import(process.env.RW_ENGINE ? pathToFileURL(path.resolve(process.env.RW_ENGINE)).href : '@reportwright/engine');
const { exportPdfStream, FontStore, fontFile, createSubsetter } = engine;

// fonts: @reportwright/fonts (the engine finds it), or a folder of them
let fonts, subset, icc;
if (process.env.RW_PUBLIC) {
  const dir = path.resolve(process.env.RW_PUBLIC);
  fonts = new FontStore(async (k) => fs.promises.readFile(path.join(dir, 'fonts', fontFile(k))));
  subset = createSubsetter(() => fs.promises.readFile(path.join(dir, 'harfbuzz-subset.wasm')));
  icc = fs.readFileSync(path.join(dir, 'icc', 'sRGB-v2-magic.icc'));
}

const presorted = flag('presorted');
const REGIONS = ['North', 'South', 'East', 'West'], TYPES = ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest'];
/** the rows, a thousand at a time, made as they are asked for */
async function* rows() {
  for (let i = 0; i < N; i += 1000) {
    const batch = [];
    for (let j = i; j < Math.min(N, i + 1000); j++) {
      // --presorted: the rows come in group order (as a query ordered by region, type gives them)
      const region = presorted ? REGIONS[Math.floor(j * 4 / N)] : REGIONS[(j >> 9) % 4], type = presorted ? TYPES[Math.floor(j * 20 / N) % 5] : TYPES[(j >> 6) % 5];
      batch.push({ id: j + 1, account: `AC${String(10000 + (j * 7) % 9000)}`, region, type,
        date: new Date(Date.UTC(2025, j % 12, 1 + (j % 28))), amount: Math.round(((j * 7919) % 200000 - 100000) * 1.37) / 100,
        reference: j % 37 === 0 ? `Reversal of an earlier transfer between linked accounts, batch ${j}` : `REF-${j * 31}` });
    }
    yield batch;
  }
}
const grouped = flag('grouped');
const total = (label) => [{ height: 15, style: { fontWeight: 'bold' }, cells: [{ value: label }, { value: '=CountRows()' }, null, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, null] }];
const def = {
  $schema: 'pagewright/report@1', name: 'Ledger', locale: 'en-IN', page: { size: 'A4', margins: [36, 36, 36, 36] },
  // the rows come from opts.sqlRows below (a cursor); the query text is not run
  dataSources: [{ name: 'db', type: 'sql', connection: 'ledger', query: 'select * from transactions order by id' }],
  dataSets: [{ name: 'Tx', source: 'db', fields: [{ name: 'id', type: 'number' }, { name: 'account', type: 'string' }, { name: 'region', type: 'string' }, { name: 'type', type: 'string' },
    { name: 'date', type: 'date' }, { name: 'amount', type: 'number' }, { name: 'reference', type: 'string' }] }],
  sections: {
    pageHeader: { height: 22, items: [{ type: 'textbox', name: 'Title', x: 0, y: 0, w: 300, h: 18, value: 'Transactions ledger', style: { fontWeight: 'bold', fontSize: 12 } }] },
    body: { items: [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: 523, h: 40,
      columns: [{ width: 50 }, { width: 62 }, { width: 50 }, { width: 62 }, { width: 62 }, { width: 70 }, { width: 167 }],
      header: [{ height: 16, style: { fontWeight: 'bold', backgroundColor: '#eef2f7' }, cells: ['Id', 'Account', 'Region', 'Type', 'Date', 'Amount', 'Reference'].map(value => ({ value })) }],
      detail: [{ height: 14, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [{ value: '=Fields.id' }, { value: '=Fields.account' }, { value: '=Fields.region' }, { value: '=Fields.type' },
        { value: '=Fields.date', style: { format: 'd' } }, { value: '=Fields.amount', style: { format: 'N2', textAlign: 'right' } }, { value: '=Fields.reference', style: { fontSize: 8 } }] }],
      footer: total('Total'),
      ...(grouped ? { groups: [
        { name: 'Region', expr: '=Fields.region', repeatHeader: true, header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#dbeafe' }, cells: [{ value: '="Region " & Fields.region', colSpan: 3 }, null, null] }], footer: total('Region total') },
        { name: 'Type', expr: '=Fields.type', header: [{ height: 15, cells: [null, { value: '=Fields.type' }] }], footer: total('Type total') },
      ] } : {}) }] },
    pageFooter: { height: 18, items: [{ type: 'textbox', name: 'Page', x: 0, y: 2, w: 523, h: 14, style: { textAlign: 'right' },
      value: flag('plain') ? 'Page {Globals.PageNumber}' : 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
};

let peak = 0;
const rss = () => { const m = process.memoryUsage.rss() / 1048576; if (m > peak) peak = m; };
rss();
const base = peak;
const timer = setInterval(rss, 20);
const t0 = Date.now();
const out = fs.createWriteStream(file);
// --array: the rows made first, one array in the report's JSON source (how a library caller often has them)
let arrayRssMB;
if (flag('array') || opt('array')) {
  const all = [];
  for await (const b of rows()) for (const x of b) all.push(x);
  def.dataSources = [{ name: 'db', type: 'json', data: opt('array') === 'text' ? JSON.stringify(all) : all }];
  rss(); arrayRssMB = Math.round(process.memoryUsage.rss() / 1048576);
}
const r = await exportPdfStream(def, { fonts, subset, title: 'Ledger', window: Number(opt('window')) || undefined, presorted, ...(flag('memsort') ? { spill: false } : {}), sqlRows: () => rows(), maxRows: Math.max(N, 5_000_000), timeoutMs: 24 * 3600e3,
  ...(flag('tagged') ? { tagged: { lang: 'en-IN' }, pdfa: icc ? { icc } : true } : {}), ...(opt('parallel') ? { parallel: Number(opt('parallel')) } : {}) }, out);
await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
clearInterval(timer);
rss();
console.log(JSON.stringify({ rows: N, pages: r.pages, streamed: r.streamed, ...(r.why ? { why: r.why } : {}), peakRssMB: Math.round(peak), startRssMB: Math.round(base), ...(arrayRssMB ? { arrayRssMB } : {}), ms: Date.now() - t0,
  bytes: fs.statSync(file).size, file, node: process.version, grouped, presorted, tagged: flag('tagged'), parallel: Number(opt('parallel')) || 1 }));
