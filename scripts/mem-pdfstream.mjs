// Memory of the streaming PDF writer (src/exporters/pdfstream.js): N table-like pages (48 rows × 6 cells of text plus
// row borders) to a sink that only counts bytes. Prints { pages, liveMB, peakRssMB, bytes, ms }: liveMB is the heap
// after a full GC with every page written (before finish), peakRssMB the process's peak RSS (sampled every 10 ms).
// Flat from 2,000 to 10,000 pages means pages leave memory once written.
//   node --expose-gc scripts/mem-pdfstream.mjs [pages=2000]
// Never run 1M-row sizes on a small laptop: 10,000 pages is enough to see the slope.
import fs from 'node:fs';
import path from 'node:path';
import { FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { createSubsetter } from '../src/exporters/subset.js';
import { createPdfStream } from '../src/exporters/pdfstream.js';

const ROOT = path.join(import.meta.dirname, '..');
const N = Number(process.argv[2]) || 2000;
const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', fontFile(k))));
await fontStore.load(['Inter-Regular', 'Inter-Bold']);
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
const CITIES = ['Pune', 'Delhi', 'Chennai', 'Mumbai', 'Kolkata', 'Bengaluru', 'Hyderabad'];

let bytes = 0, writes = 0;
const sink = { write: async (u8) => { bytes += u8.length; if (++writes % 8 === 0) await new Promise(r => setImmediate(r)); } };
const rss = () => process.memoryUsage.rss() / 1048576;
let peak = rss();
const t = setInterval(() => { peak = Math.max(peak, rss()); }, 10);
const t0 = Date.now();
const w = createPdfStream(sink, { fontStore, fonts: ['Inter-Regular', 'Inter-Bold'], subset });
const R = w.fontName('Inter-Regular'), B = w.fontName('Inter-Bold');
const total = w.totalPages({ font: 'Inter-Regular', size: 8, width: 40 });
for (let p = 0; p < N; p++) {
  let s = `BT /${B} 9 Tf 36 800 Td <${w.encode('Inter-Bold', 'Id  Name  City  Qty  Price  Day')}> Tj ET\nBT /${R} 8 Tf\n`;
  for (let r = 0; r < 48; r++) {
    const i = p * 48 + r;
    const cells = [String(i), `Customer ${i}`, CITIES[(i * 3) % 7], String((i * 37) % 11), ((i * 7.31) % 100).toFixed(2), `2026-0${1 + (i % 9)}-1${i % 10}`];
    cells.forEach((c, k) => { s += `1 0 0 1 ${36 + k * 85} ${780 - r * 15} Tm <${w.encode('Inter-Regular', c)}> Tj\n`; });
  }
  s += 'ET\n0.5 w q\n';
  for (let r = 0; r < 48; r++) s += `36 ${776 - r * 15} m 556 ${776 - r * 15} l S\n`;
  s += `Q\nBT /${R} 8 Tf 36 20 Td <${w.encode('Inter-Regular', `Page ${p + 1} of`)}> Tj ET q 1 0 0 1 80 20 cm /${total} Do Q\n`;
  await w.addPage({ width: 595, height: 842, content: s });
}
globalThis.gc?.(); globalThis.gc?.();
const live = process.memoryUsage().heapUsed / 1048576;
const res = await w.finish({ info: { title: 'mem' } });
clearInterval(t);
peak = Math.max(peak, rss());
console.log(JSON.stringify({ pages: res.pages, liveMB: Math.round(live * 10) / 10, peakRssMB: Math.round(peak), bytes, ms: Date.now() - t0 }));
