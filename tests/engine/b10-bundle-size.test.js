// B10 A1.6: the embeddable viewer's first load stays small. The engine (layout, charts, maps, barcodes), the Office
// exporters and HarfBuzz load on first use; the render worker loads bwip-js only for a report with a barcode.
// Builds what scripts/build-embed.mjs builds (scripts/embed-options.mjs), in memory, and holds it to a budget.
import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import zlib from 'node:zlib';
import path from 'node:path';
import { root, common, readable, ENTRIES, WORKER, bwipApart, firstLoad } from '../../scripts/embed-options.mjs';

// gzip -9 KB of the readable (unminified) ES modules, as build-embed.mjs prints them. A ratchet: lower it when the
// first load shrinks, never raise it. 652 KB on b10-bundle alone; fontkit (1.1 MB, in the first load only because
// src/engine/text/fonts.js imports it at its top) going lazy (b10-perf) takes it to about 262 KB: lower this then.
const FIRST_LOAD_KB = 270; // 262 KB with pdf-lib and fontkit lazy (was 827 KB)
const WORKER_KB = 600; // the render worker without bwip-js (was 908 KB); since N43 it holds the standard-font metrics (+6 KB; the ~100 KB side file is gone)

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
  const w = await build({ ...common, entryPoints: [WORKER], format: 'esm', ...readable, sourcemap: false, splitting: false, metafile: true, write: false, outfile: path.join(OUT, 'engine.worker.js'), plugins: [...common.plugins, bwipApart] });
  worker = { gz: zlib.gzipSync(w.outputFiles[0].contents, { level: 9 }).length / 1024, inputs: Object.keys(Object.values(w.metafile.outputs)[0].inputs), text: w.outputFiles[0].text };
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
