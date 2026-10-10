// The tester's release-gate probe: a flat detail table through exportPdfStream, plain or with expression styles, to a
// sink that only counts bytes. Prints { shape, rows, ms, peakRssMB, bytes }. One process per run.
//   node --expose-gc scripts/eng-probe.mjs [plain|zebra|zebra3] [rows=100000]
import fs from 'node:fs';
import path from 'node:path';
import { FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { createSubsetter } from '../src/exporters/subset.js';
import { exportPdfStream } from '../src/exporters/pdfstream.js';
import { memReport } from './mem-stream.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const shape = process.argv[2] || 'zebra', N = Number(process.argv[3]) || 100000;
const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', fontFile(k))));
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
const CITIES = ['Pune', 'Delhi', 'Chennai', 'Mumbai', 'Kolkata', 'Bengaluru', 'Hyderabad'];
function* rows() { for (let i = 0; i < N; i++) yield { id: i, name: `Customer ${i}`, city: CITIES[(i * 3) % 7], qty: (i * 37) % 11, price: Number(((i * 7.31) % 100).toFixed(2)), day: `2026-0${1 + (i % 9)}-1${i % 10}` }; }
const def = memReport('http://unused/rows', shape, 'pdf');
let bytes = 0;
const sink = { write: async (u8) => { bytes += u8.length; } };
const rss = () => process.memoryUsage.rss() / 1048576;
let peak = rss();
const t = setInterval(() => { peak = Math.max(peak, rss()); }, 10);
const t0 = Date.now();
const r = await exportPdfStream(def, { fontStore, subset, sources: { s: { rows: [...rows()] } }, creationDate: new Date(0), id: '0123456789abcdef0123456789abcdef' }, sink);
clearInterval(t);
console.log(JSON.stringify({ shape, rows: N, streamed: r.streamed, why: r.why, pages: r.pages, ms: Date.now() - t0, peakRssMB: Math.round(Math.max(peak, rss())), bytes }));
