// One measured run, in its own process: node child.mjs <lib> <invoice|invoice-warm|table> <rows> <out.pdf> [--pdfa] [--ua]
// Prints one JSON line. Data is made before the clock starts; the clock covers building the document and writing the file.
//   loadMs    process start -> library imported and set up (Puppeteer: browser launched)
//   renderMs  build + lay out + write the PDF (invoice-warm: the median of the last 40 of 50 invoices in this process)
//   maxRssMB  this Node process's peak RSS (the parent also samples the whole process tree, for browsers)
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tableRows } from './data.mjs';

const [lib, workload, n, out] = process.argv.slice(2);
const o = { pdfa: process.argv.includes('--pdfa'), ua: process.argv.includes('--ua') };
const impl = await import(`./libs/${lib}.mjs`);
await impl.setup();
const loadMs = performance.now(); // performance's origin is the process start
const rows = workload === 'table' ? tableRows(Number(n)) : null;

let renderMs, pages;
if (workload === 'invoice-warm') {
  const times = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    ({ pages } = await impl.invoice(out, o));
    times.push(performance.now() - t);
  }
  const warm = times.slice(10).sort((a, b) => a - b);
  renderMs = warm[warm.length >> 1];
} else {
  const t = performance.now();
  ({ pages } = workload === 'table' ? await impl.table(rows, out, o) : await impl.invoice(out, o));
  renderMs = performance.now() - t;
}
await impl.teardown();
console.log(JSON.stringify({ loadMs, renderMs, pages, bytes: fs.statSync(out).size, maxRssMB: process.resourceUsage().maxRSS / 1024 }));
