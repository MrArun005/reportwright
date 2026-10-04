// Pagination profile on the benchmark scenarios: render (JSON text → page model) time and peak RSS, as pw-bench measures it.
// usage: node [--cpu-prof] scripts/perf-paginate.mjs [s1|s2|s3] [rows file] [runs]   (PW_BENCH: the pw-bench checkout, default ~/pw-bench)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';

const ROOT = path.join(import.meta.dirname, '..');
const BENCH = process.env.PW_BENCH || path.join(os.homedir(), 'pw-bench');
const defs = await import(path.join(BENCH, 'lib/defs.mjs'));
const [scenario = 's1', file = 'rows-50000.json', runs = '3'] = process.argv.slice(2);
const raw = fs.readFileSync(path.join(BENCH, 'data', file), 'utf8');
const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(ROOT, 'public/fonts', fontFile(k))));
const times = [], cpus = [];
for (let r = 0; r < Number(runs); r++) {
  const t0 = performance.now(), c0 = process.threadCpuUsage?.() ?? process.cpuUsage();
  const model = await render(defs.pagewright(scenario, JSON.parse(raw)), { fontStore });
  times.push(performance.now() - t0);
  const c1 = process.threadCpuUsage?.(c0) ?? process.cpuUsage(c0);
  cpus.push((c1.user + c1.system) / 1000); // CPU time of this thread: steadier than wall time on a busy machine
  console.log(`${scenario} run ${r}: ${times.at(-1).toFixed(0)} ms (main-thread CPU ${cpus.at(-1).toFixed(0)} ms), ${model.pages.length} pages, ${model.pages.reduce((n, p) => n + p.items.length, 0)} items, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
  if (process.env.OUT && r === 0) fs.writeFileSync(process.env.OUT, JSON.stringify(model));
}
const sorted = [...times].sort((a, b) => a - b);
const cs = [...cpus].sort((a, b) => a - b);
console.log(`${scenario}: median ${sorted[sorted.length >> 1].toFixed(0)} ms (CPU ${cs[cs.length >> 1].toFixed(0)} ms), min ${sorted[0].toFixed(0)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
