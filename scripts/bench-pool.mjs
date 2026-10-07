// A light benchmark of @pagewrightjs/engine/pool (run npm run build:packages first): N small reports (charts-showcase) as PDFs,
// one after another on the main thread, then on a pool of 1 and of 4 workers.  node scripts/bench-pool.mjs [N]
import path from 'node:path';
import fs from 'node:fs';
const root = path.join(import.meta.dirname, '..');
const { createPool } = await import(path.join(root, 'packages/engine/pool/index.js'));
const N = Number(process.argv[2]) || 40;
const fontsDir = path.join(root, 'public/fonts');
const def = JSON.parse(fs.readFileSync(path.join(root, 'reports/charts-showcase.pw.json'), 'utf8'));
for (const workers of [1, 4]) {
  const pool = createPool({ workers, fontsDir });
  await Promise.all(Array.from({ length: workers }, () => pool.render(def))); // warm up: engine and fonts loaded in each worker
  const t = performance.now();
  const out = await Promise.all(Array.from({ length: N }, () => pool.render(def)));
  const ms = performance.now() - t;
  console.log(`${workers} worker${workers > 1 ? 's' : ' '}: ${N} PDFs in ${Math.round(ms)} ms (${(N / ms * 1000).toFixed(1)}/s, ${Math.round(out.reduce((s, b) => s + b.length, 0) / N / 1024)} KB each)`);
  await pool.close();
}
