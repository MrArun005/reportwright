// CPU use of the server's render pool (docs/research/STREAMING-1M.md §8): N small renders on 1, 2 and 4 workers;
// wall time, CPU time (process.cpuUsage covers the worker threads) and the cores that kept busy, and each worker's
// idle cost (RSS).  node scripts/bench-cpu.mjs [renders=32] [rows=2000] [format=pdf]   (a quiet machine reads truer)
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const src = pathToFileURL(path.join(import.meta.dirname, '..', 'src') + '/').href;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(s, c, next) { return next(s.startsWith('@/') ? ${JSON.stringify(src)} + s.slice(2) : s, c); }`)}`);
process.env.PW_MEMORY_LIMIT_MB ||= '8192';
const N = Number(process.argv[2]) || 32, ROWS = Number(process.argv[3]) || 2000, FORMAT = process.argv[4] || 'pdf';
const { renderInPool, stopPool, poolStats } = await import('../src/server/pool.js');
const { OPEN } = await import('../src/server/perms.js');
const def = {
  $schema: 'pagewright/report@1', name: 'bench', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: Array.from({ length: ROWS }, (_, i) => ({ id: i, name: `Customer ${i}`, city: ['Pune', 'Delhi', 'Chennai'][i % 3], qty: i % 17, price: (i * 7.31) % 100 })) }],
  dataSets: [{ name: 'D', source: 's' }],
  sections: { pageFooter: { height: 20, items: [{ type: 'textbox', x: 0, y: 4, w: 200, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] }, body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 60 }, { width: 160 }, { width: 100 }, { width: 80 }, { width: 100 }],
    header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'City' }, { value: 'Qty' }, { value: 'Price' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.qty' }, { value: '=Fields.price', style: { format: 'N2' } }] }] }] } },
};
const settle = () => new Promise(r => setTimeout(r, 400));
const mb = () => process.memoryUsage.rss() / 1048576;
const rows = [];
for (const w of [1, 2, 4]) {
  process.env.PW_RENDER_WORKERS = String(w);
  await stopPool(); await settle();
  const base = mb();
  // warm every worker (engine, fonts) with one render each, at once
  await Promise.all(Array.from({ length: w }, () => renderInPool({ def, opt: { format: FORMAT, principal: OPEN } }, { background: true })));
  await settle();
  const idle = mb() - base;
  const c0 = process.cpuUsage(), t0 = performance.now();
  await Promise.all(Array.from({ length: N }, () => renderInPool({ def, opt: { format: FORMAT, principal: OPEN } }, { background: true })));
  const ms = performance.now() - t0, c = process.cpuUsage(c0), cpuMs = (c.user + c.system) / 1000;
  rows.push({ w, idlePerWorkerMB: Math.round(idle / w), renders: N, wallMs: Math.round(ms), perSec: +(N / ms * 1000).toFixed(2), cpuMs: Math.round(cpuMs), cores: +(cpuMs / ms).toFixed(2), alive: poolStats().workers.alive });
}
await stopPool();
console.table(rows);
const one = rows[0], more = rows.slice(1);
for (const r of more) console.log(`${r.w} workers: ${(r.perSec / one.perSec).toFixed(2)}× the throughput of 1, ${r.cores} cores busy (1 worker: ${one.cores})`);
process.exit(0);
