// Builds public/embed/: the viewer (and, in the ESM build, the designer) for other sites.
import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { root, common, readable, ENTRIES, WORKER, BWIP_FILE, bwipApart, firstLoad } from './embed-options.mjs';
const workerBuild = (o) => build({ ...common, entryPoints: [WORKER], format: 'esm', ...readable, splitting: false, ...o });
const workerWithBwip = async (dir, o = {}) => {
  const r = await workerBuild({ outfile: path.join(dir, 'engine.worker.js'), plugins: [...common.plugins, bwipApart], ...o });
  await build({ entryPoints: ['bwip-js'], absWorkingDir: root, bundle: true, format: 'esm', target: ['es2020'], logLevel: 'warning', ...readable, outfile: path.join(dir, BWIP_FILE) });
  return r;
};
// 1. Everything in one classic script: the interactive HTML export inlines this one (it must work offline).
await build({ ...common, format: 'iife', outfile: path.join(root, 'public/embed/reportwright-viewer.full.js') });
// 2. For other sites: ES modules split in chunks, so PDF export (pdf-lib) and barcodes (bwip-js) load only when used.
fs.rmSync(path.join(root, 'public/embed/esm'), { recursive: true, force: true });
//    The designer is a second entry: it shares React, the engine and the viewer with it.
const esmBuild = await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, metafile: true, outdir: path.join(root, 'public/embed/esm'), entryNames: '[name]', chunkNames: 'chunk-[hash]' });
await workerWithBwip(path.join(root, 'public/embed/esm'));
//    The same ES modules with React left to the host app (@reportwright/viewer/react-peer, used by @reportwright/react).
fs.rmSync(path.join(root, 'public/embed/esm-peer'), { recursive: true, force: true });
await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed/esm-peer'), entryNames: '[name]', chunkNames: 'chunk-[hash]', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
await workerWithBwip(path.join(root, 'public/embed/esm-peer'), { external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
//    What @reportwright/viewer publishes: the same two builds with the third-party libraries that carry data blobs
//    (pdf-lib's standard fonts, fontkit's brotli dictionary, bwip-js's barcode tables, bidi-js's Unicode data) and
//    fflate left as imports: they are the package's pinned dependencies, so the tarball holds only our code.
const PKG_EXTERNAL = ['pdf-lib', '@pdf-lib/fontkit', '@pdf-lib/standard-fonts', 'bwip-js', 'fflate', 'bidi-js'];
for (const [dir, ext] of [['esm-pkg', []], ['esm-pkg-peer', ['react', 'react-dom', 'react/*', 'react-dom/*']]]) {
  fs.rmSync(path.join(root, 'public/embed', dir), { recursive: true, force: true });
  await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed', dir), entryNames: '[name]', chunkNames: 'chunk-[hash]', external: [...ext, ...PKG_EXTERNAL] });
  await workerBuild({ outfile: path.join(root, 'public/embed', dir, 'engine.worker.js'), external: [...ext, ...PKG_EXTERNAL] });
}
// 3. The script tag people paste: a tiny loader that keeps the ReportWright.mountViewer(...) call working.
fs.writeFileSync(path.join(root, 'public/embed/reportwright-viewer.js'), `/* ReportWright viewer loader: the viewer itself is in esm/ */
(function () {
  var s = document.currentScript, base = s && s.src ? s.src.replace(/[^/]*$/, '') : '/embed/';
  var ready = import(base + 'esm/viewer.js'), designer = null;
  window.ReportWright = window.Pagewright = { // Pagewright: the old name, deprecated (0.9)
    mountViewer: function (t, o) { return ready.then(function (m) { return m.mountViewer(t, o); }); },
    // the designer loads only when a page asks for it
    mountDesigner: function (t, o) { designer = designer || import(base + 'esm/designer.js'); return designer.then(function (m) { return m.mountDesigner(t, o); }); },
    ready: ready
  };
})();
`);
// the old file names (embed snippets pasted before the rename) keep working; deprecated (0.9)
for (const f of ['viewer.js', 'viewer.full.js']) fs.copyFileSync(path.join(root, `public/embed/reportwright-${f}`), path.join(root, `public/embed/pagewright-${f}`));
fs.rmSync(path.join(root, 'public/embed/exceljs.min.js'), { force: true }); // the Excel export has its own writer now
// what a page loads up front: the entry and the chunks it imports statically
const dir = path.join(root, 'public/embed/esm');
const first = new Set(firstLoad(esmBuild.metafile, Object.keys(esmBuild.metafile.outputs).find(f => path.basename(f) === 'viewer.js')).map(f => path.basename(f)));
const size = (f) => fs.statSync(path.join(dir, f)).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const lazy = fs.readdirSync(dir).filter(f => !first.has(f) && !['designer.js', 'engine.worker.js'].includes(f) && f.endsWith('.js'));
console.log(`embed designer entry ${kb(size('designer.js'))} (+ shared chunks)`);
const gz = [...first].reduce((s, f) => s + zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length, 0);
const gzOf = (f) => zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length;
console.log(`embed: first load ${kb([...first].reduce((s, f) => s + size(f), 0))} (${kb(gz)} gzipped), then the render worker ${kb(size('engine.worker.js'))} (${kb(gzOf('engine.worker.js'))} gzipped); on demand ${lazy.map(f => kb(size(f))).join(', ')}; offline single file ${kb(fs.statSync(path.join(root, 'public/embed/reportwright-viewer.full.js')).size)}`);
