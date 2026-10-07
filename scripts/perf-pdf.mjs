// PDF export profile on the benchmark scenarios (render vs exportPdf time, bytes).
// usage: node scripts/perf-pdf.mjs [s1|s2|s3|s4] [rows file] [runs]   (PW_BENCH: the pw-bench checkout, default ~/pw-bench)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { createSubsetter } from '../src/exporters/subset.js';

const ROOT = path.join(import.meta.dirname, '..');
const BENCH = process.env.PW_BENCH || path.join(os.homedir(), 'pw-bench');
const defs = await import(path.join(BENCH, 'lib/defs.mjs'));
const [scenario = 's2', file = 'rows-50000.json', runs = '2'] = process.argv.slice(2);
const raw = fs.readFileSync(path.join(BENCH, 'data', file), 'utf8');
const fontStore = new FontStore(async (k) => fs.readFileSync(path.join(ROOT, 'public/fonts', fontFile(k))));
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
const docs = scenario === 's4' ? JSON.parse(raw) : [JSON.parse(raw)];
for (let r = 0; r < Number(runs); r++) {
  let tr = 0, te = 0, bytes;
  for (const d of docs) {
    const t0 = performance.now();
    const model = await render(defs.reportwright(scenario, d), { fontStore });
    const t1 = performance.now();
    bytes = await exportPdf(model, fontStore, { subset });
    te += performance.now() - t1; tr += t1 - t0;
  }
  console.log(`${scenario} run ${r}: render ${tr.toFixed(0)} ms, exportPdf ${te.toFixed(0)} ms, total ${(tr + te).toFixed(0)} ms, ${(bytes.length / 1e6).toFixed(2)} MB (last doc)`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, bytes);
}
