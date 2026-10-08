// Builds public/embed/: the viewer (and, in the ESM build, the designer) for other sites.
import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
// viewer styles, scoped to the shadow root
let css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  .replace(/@font-face\s*\{[^}]*\}/g, '')
  .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])') // dark theme: data-theme on the host element
  .replace(/:root\b/g, ':host')
  .replace(/html,\s*body\s*\{[^}]*\}/g, '')
  .replace(/(^|\n)body\s*\{/g, '$1.pw-embed{');
css += '\n.pw-embed{display:block;font:var(--fw-regular) var(--fs-base)/var(--lh) var(--ui);color:var(--ink);background:var(--desk);border:1px solid var(--line);border-radius:8px;overflow:hidden}\n';
const common = {
  entryPoints: [path.join(root, 'src/embed/index.js')],
  bundle: true, minify: true, target: ['es2020'],
  alias: { '@': path.join(root, 'src'), 'next/link': path.join(root, 'src/embed/link.js') },
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __PW_CSS__: JSON.stringify(css) },
  logLevel: 'warning',
  // English strings in the first load, other languages on demand (src/i18n/embed.js)
  plugins: [{ name: 'i18n-embed', setup: (b) => b.onResolve({ filter: /(^|\/)i18n\/index\.js$/ }, () => ({ path: path.join(root, 'src/i18n/embed.js') })) },
    // the render worker is built as its own entry (engine.worker.js) next to the chunks: point the viewer at it there,
    // as new Worker(new URL('./engine.worker.js', import.meta.url)), which Vite, webpack and Next bundle from the package
    { name: 'worker-url', setup: (b) => b.onLoad({ filter: /src[\\/]viewer[\\/]engineClient\.js$/ }, (a) => {
      const src = fs.readFileSync(a.path, 'utf8');
      if (!src.includes("'../worker/engine.worker.js'")) throw new Error('engineClient.js: the worker URL changed; update build-embed.mjs');
      return { contents: src.replace("'../worker/engine.worker.js'", "'./engine.worker.js'"), loader: 'js' };
    }) }],
  logOverride: { 'empty-import-meta': 'silent', 'unsupported-dynamic-import': 'silent' },
};
// The ES modules are what @reportwright/viewer publishes: readable (not minified, names kept) with source maps, so a
// reviewer (or Socket's scanner) reads the same code we wrote. The single-file IIFE below stays minified.
// lineLimit and utf8: no line over a few hundred characters (long lines read as obfuscated to a scanner; \u escapes
// made translated strings six times longer)
const readable = { minify: false, sourcemap: 'linked', sourcesContent: false, legalComments: 'inline', charset: 'utf8', lineLimit: 400 };
// the ES module builds: the viewer, the designer, and the render worker the viewer starts (src/worker)
const ENTRIES = { viewer: path.join(root, 'src/embed/index.js'), designer: path.join(root, 'src/embed/designer.js'), 'engine.worker': path.join(root, 'src/worker/engine.worker.js') };
// 1. Everything in one classic script: the interactive HTML export inlines this one (it must work offline).
await build({ ...common, format: 'iife', outfile: path.join(root, 'public/embed/reportwright-viewer.full.js') });
// 2. For other sites: ES modules split in chunks, so PDF export (pdf-lib) and barcodes (bwip-js) load only when used.
fs.rmSync(path.join(root, 'public/embed/esm'), { recursive: true, force: true });
//    The designer is a second entry: it shares React, the engine and the viewer with it.
await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed/esm'), entryNames: '[name]', chunkNames: 'chunk-[hash]' });
//    The same ES modules with React left to the host app (@reportwright/viewer/react-peer, used by @reportwright/react).
fs.rmSync(path.join(root, 'public/embed/esm-peer'), { recursive: true, force: true });
await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed/esm-peer'), entryNames: '[name]', chunkNames: 'chunk-[hash]', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
//    What @reportwright/viewer publishes: the same two builds with the third-party libraries that carry data blobs
//    (pdf-lib's standard fonts, fontkit's brotli dictionary, bwip-js's barcode tables, bidi-js's Unicode data) and
//    fflate left as imports: they are the package's pinned dependencies, so the tarball holds only our code.
const PKG_EXTERNAL = ['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'bidi-js'];
for (const [dir, ext] of [['esm-pkg', []], ['esm-pkg-peer', ['react', 'react-dom', 'react/*', 'react-dom/*']]]) {
  fs.rmSync(path.join(root, 'public/embed', dir), { recursive: true, force: true });
  await build({ ...common, entryPoints: ENTRIES, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed', dir), entryNames: '[name]', chunkNames: 'chunk-[hash]', external: [...ext, ...PKG_EXTERNAL] });
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
const first = new Set();
const walk = (f) => { if (first.has(f)) return; first.add(f); for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/import\s*(?:[\w{},*\s$]+from\s*)?"\.\/(chunk-[\w-]+\.js)"/g)) walk(m[1]); };
walk('viewer.js');
const size = (f) => fs.statSync(path.join(dir, f)).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const lazy = fs.readdirSync(dir).filter(f => !first.has(f) && f !== 'designer.js' && f.endsWith('.js'));
console.log(`embed designer entry ${kb(size('designer.js'))} (+ shared chunks)`);
const gz = [...first].reduce((s, f) => s + zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length, 0);
console.log(`embed: first load ${kb([...first].reduce((s, f) => s + size(f), 0))} (${kb(gz)} gzipped); on demand ${lazy.map(f => kb(size(f))).join(', ')}; offline single file ${kb(fs.statSync(path.join(root, 'public/embed/reportwright-viewer.full.js')).size)}`);
