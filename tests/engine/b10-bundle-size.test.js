// B10 A1.6: the embeddable viewer's first load stays small. The engine (layout, charts, maps, barcodes), the Office
// exporters and HarfBuzz load on first use; the render worker loads bwip-js only for a report with a barcode.
// Builds what scripts/build-embed.mjs builds (scripts/embed-options.mjs), in memory, and holds it to a budget.
import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import zlib from 'node:zlib';
import path from 'node:path';
import { splitContinuations } from '../../scripts/line-continuations.mjs';
import { root, common, readable, workerMin, ENTRIES, WORKER, bwipApart, firstLoad } from '../../scripts/embed-options.mjs';

// gzip -9 KB of the readable (unminified) ES modules, as build-embed.mjs prints them. A ratchet: lower it when the
// first load shrinks, never raise it. 652 KB on b10-bundle alone; fontkit (1.1 MB, in the first load only because
// src/engine/text/fonts.js imports it at its top) going lazy (b10-perf) takes it to about 262 KB: lower this then.
const FIRST_LOAD_KB = 270; // 262 KB with pdf-lib and fontkit lazy (was 827 KB)
// 510: 505.7 KB at 0.13.2; +1.9 KB from 95dd62ba (the Vite line-continuation rewrite, which this test now measures
// after), +~2 KB from the 0.14 perf work (b37bfedf, 170a41f6, f3b2f317, the zebra frozen-style change); 509.4 KB with
// the sfnt.js stub (scripts/embed-options.mjs). Owner-approved; lower it when the worker shrinks, never raise it.
// 511: +0.7 KB from the shape check of a definition before the render walks it (src/engine/schema/shape.js: a hostile
// file is refused with a message instead of a stack overflow or a TypeError; tests/engine/hostile-designer.test.js).
const WORKER_KB = 511; // was 510, 507, 594 before that

const OUT = path.join(root, 'public/embed/esm');
let viewer, worker;
beforeAll(async () => {
  const r = await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, sourcemap: false, splitting: true, metafile: true, write: false, outdir: OUT, entryNames: '[name]', chunkNames: 'chunk-[hash]' });
  const text = new Map(r.outputFiles.map(f => [path.relative(root, f.path), f.contents]));
  const files = firstLoad(r.metafile, Object.keys(r.metafile.outputs).find(f => path.basename(f) === 'viewer.js'));
  viewer = {
    gz: files.reduce((s, f) => s + zlib.gzipSync(text.get(f), { level: 9 }).length, 0) / 1024,
    inputs: files.flatMap(f => Object.keys(r.metafile.outputs[f].inputs)),
  };
  const w = await build({ ...common, entryPoints: [WORKER], format: 'esm', ...workerMin, sourcemap: false, splitting: false, metafile: true, write: false, outfile: path.join(OUT, 'engine.worker.js'), plugins: [...common.plugins, bwipApart] });
  const wtext = splitContinuations(w.outputFiles[0].text); // as build-embed.mjs writes it
  worker = { gz: zlib.gzipSync(wtext, { level: 9 }).length / 1024, inputs: Object.keys(Object.values(w.metafile.outputs)[0].inputs), text: wtext };
}, 120000);

describe('B10 A1.6 viewer bundle size', () => {
  it(`the first load is at most ${FIRST_LOAD_KB} KB gzipped`, () => {
    console.log(`viewer first load ${viewer.gz.toFixed(0)} KB gzipped; render worker ${worker.gz.toFixed(0)} KB gzipped`);
    expect(viewer.gz).toBeLessThanOrEqual(FIRST_LOAD_KB);
  });

  // HarfBuzz: its wasm is fetched when text is shaped; shaper.js (3 KB of glue) comes with fonts.js
  it('the first load has no engine layout, charts, maps, barcodes, Office or PDF exporters, pdf-lib or bwip-js', () => {
    const lazy = /src\/engine\/(index|layout|items\/|paginate\/|expr\/|schema\/)|src\/engine\/text\/measure\.js|src\/exporters\/(xlsx|docx|pptx|pdf|html|csv)|node_modules\/(pdf-lib|bwip-js)\//;
    expect(viewer.inputs.filter(f => lazy.test(f))).toEqual([]);
  });

  it(`the render worker is at most ${WORKER_KB} KB gzipped and imports bwip-js from its own file, on demand`, () => {
    expect(worker.gz).toBeLessThanOrEqual(WORKER_KB);
    expect(worker.inputs.filter(f => f.includes('node_modules/bwip-js/'))).toEqual([]);
    expect(worker.text).toMatch(/import\("\.\/engine\.worker\.bwip\.js"\)/);
    expect(worker.text).not.toMatch(/from\s*["']\.\/chunk-/); // still one file (N18)
  });
});
