// #12: the viewer renders in a Web Worker, so a big report does not freeze the page. Renders a 100,000-row table with the
// embed build (public/embed/esm: run npm run build:embed first) twice, in the worker and on the main thread (a `fetch`
// option keeps it there), records the main thread's long tasks (PerformanceObserver 'longtask') while it renders, and
// checks both give the same pages. CPU=4 node tests/e2e/viewer-worker-perf.mjs slows the CPU 4× (DevTools throttling).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ROWS = Number(process.env.ROWS || 100000), CPU = Number(process.env.CPU || 1);
const ORIGIN = 'http://perf.test';
const FILES = { '/embed/': path.join(root, 'public/embed/'), '/fonts/': path.join(root, 'public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const definition = {
  $schema: 'pagewright/report@1', name: 'Perf', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'rows', type: 'json', data: [] }],
  dataSets: [{ name: 'Rows', source: 'rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 500, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 250 }, { width: 150 }],
    header: [{ height: 16, cells: [{ value: 'No' }, { value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }] } },
};
const page = (mode) => `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module">
import { mountViewer } from '/embed/esm/viewer.js';
const rows = Array.from({ length: ${ROWS} }, (_, i) => ({ n: i + 1, customer: 'Customer ' + (i % 997), amount: (i * 37) % 10000 / 7 }));
await new Promise(r => setTimeout(r, 100)); // the data is made before the measured part starts
window.__long = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask' });
const t0 = performance.now();
let h;
window.__done = new Promise((res) => { h = mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: { rows }, fontsUrl: '/fonts/', height: '600px',
  ${mode === 'main' ? 'fetch: (...a) => fetch(...a),' : ''} onReady: (e) => res({ error: e && e.message, ms: performance.now() - t0, pages: h.getPageCount() }) }); });
window.__h = () => h;
</script>`;

async function run(mode) {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const workers = [], errs = [];
  p.on('worker', w => workers.push(w.url()));
  p.on('pageerror', e => errs.push(e.message));
  if (CPU > 1) await (await p.context().newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await p.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: page(mode), contentType: 'text/html' });
    const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
    const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await p.goto(`${ORIGIN}/`);
  await p.waitForFunction(() => window.__done);
  const done = await p.evaluate(() => window.__done);
  // the pages settle (the first pages show first, the rest follow): wait for the page count to stop changing
  let pages = 0;
  for (let same = 0; same < 3;) { await p.waitForTimeout(500); const n = await p.evaluate(() => window.__h().getPageCount()); same = n === pages ? same + 1 : 0; pages = n; }
  const long = await p.evaluate(() => window.__long);
  const first = await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join('|'));
  await p.evaluate(() => window.__h().goToPage(window.__h().getPageCount()));
  await p.waitForTimeout(800);
  const last = await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join('|'));
  await b.close();
  assert.equal(done.error, null);
  assert.deepEqual(errs, []);
  return { mode, inWorker: workers.some(u => u.includes('engine.worker')), pages, ms: Math.round(done.ms), longTasks: long.length, longest: Math.round(Math.max(0, ...long)), blocked: Math.round(long.reduce((s, d) => s + d, 0)), first, last };
}

const main = await run('main');
const worker = await run('worker');
for (const r of [main, worker]) console.log(`${r.mode.padEnd(6)} cpu ${CPU}x  worker=${r.inWorker}  pages ${r.pages}  ready ${r.ms} ms  long tasks ${r.longTasks}, longest ${r.longest} ms, total ${r.blocked} ms`);
assert.equal(main.inWorker, false);
assert.equal(worker.inWorker, true);
assert.equal(worker.pages, main.pages, 'same page count');
assert.equal(worker.first, main.first, 'same first page');
assert.equal(worker.last, main.last, 'same last page');
assert.ok(worker.longest < main.longest / 2, `the worker keeps the main thread free (longest task ${worker.longest} ms vs ${main.longest} ms)`);
console.log('viewer-worker-perf: OK (identical pages; main thread free while the worker renders)');
