// A batch item on a remote store (10 ms a round trip): the font list once per batch, item bytes and audit row at once,
// cleanup and packing in parallel. Was 93 ms an item here, 40 font-list reads for 40 items.
import { it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
it('a batch item costs few storage round trips', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-prof-')); const cwd = process.cwd();
  fs.symlinkSync(path.join(cwd, 'public'), path.join(dir, 'public')); process.chdir(dir);
  process.env.PW_STORAGE = `sqlite:${path.join(dir, 'store.db')}`; process.env.PW_RENDER_WORKERS = '0'; process.env.PW_BATCH_CONCURRENCY = '6';
  const { store } = await import('../../src/server/storage/index.js');
  const { blobs } = await import('../../src/server/blobs.js');
  const jobs = await import('../../src/server/jobs.js');
  const { writeReport } = await import('../../src/server/reports.js');
  const counts = {}; const LAT = 10;
  for (const [name, o] of [['store', store()], ['blobs', blobs()]]) for (const k of Object.keys(o)) if (typeof o[k] === 'function') { const f = o[k]; o[k] = async (...a) => { const c = `${name}.${k}:${typeof a[0] === 'string' ? a[0].split(/[/:]/)[0] : ''}`; counts[c] = (counts[c] || 0) + 1; await new Promise(r => setTimeout(r, LAT)); return f.apply(o, a); }; }
  const def = { $schema: 'reportwright/report@1', name: 'B', page: { size: 'A4', margins: [36, 36, 36, 36] }, parameters: [{ name: 'n', type: 'string' }], dataSources: [{ name: 's', type: 'json', data: [{ a: 1 }] }], dataSets: [{ name: 'd', source: 's', fields: [{ name: 'a', type: 'number' }] }],
    sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Item {Parameters.n}' }] } } };
  const N = 40;
  await writeReport('bench', def); // a saved template: each item's access check read it again
  const job = await jobs.createBatch({ template: 'bench', items: Array.from({ length: N }, (_, i) => ({ parameters: { n: String(i) } })), format: 'pdf' }, null);
  for (const k of Object.keys(counts)) delete counts[k];
  const t = Date.now();
  await jobs.workOnce('me');
  const perItem = (Date.now() - t) / N;
  process.chdir(cwd);
  delete process.env.PW_STORAGE; delete process.env.PW_RENDER_WORKERS; delete process.env.PW_BATCH_CONCURRENCY;
  fs.rmSync(dir, { recursive: true, force: true });
  expect(counts['store.ids:fonts'] || 0).toBeLessThanOrEqual(2);
  expect(perItem).toBeLessThan(50);
  expect(perItem, 'ms an item').toBeLessThan(Number(process.env.B1_MAX ?? 40)); // the access check's reads overlap the render
}, 120000);
