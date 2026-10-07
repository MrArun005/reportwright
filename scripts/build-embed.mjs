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
  define: { 'process.env.NODE_ENV': '"production"', __PW_CSS__: JSON.stringify(css), __PW_EMBED__: 'true' },
  logLevel: 'warning',
  // English strings in the first load, other languages on demand (src/i18n/embed.js)
  plugins: [{ name: 'i18n-embed', setup: (b) => b.onResolve({ filter: /(^|\/)i18n\/index\.js$/ }, () => ({ path: path.join(root, 'src/i18n/embed.js') })) }],
  logOverride: { 'empty-import-meta': 'silent', 'unsupported-dynamic-import': 'silent' },
};
// The ES modules are what @pagewrightjs/viewer publishes: readable (not minified, names kept) with source maps, so a
// reviewer (or Socket's scanner) reads the same code we wrote. The single-file IIFE below stays minified.
const readable = { minify: false, sourcemap: 'linked', sourcesContent: false, legalComments: 'inline' };
// 1. Everything in one classic script: the interactive HTML export inlines this one (it must work offline).
await build({ ...common, format: 'iife', outfile: path.join(root, 'public/embed/pagewright-viewer.full.js') });
// 2. For other sites: ES modules split in chunks, so PDF export (pdf-lib) and barcodes (bwip-js) load only when used.
fs.rmSync(path.join(root, 'public/embed/esm'), { recursive: true, force: true });
//    The designer is a second entry: it shares React, the engine and the viewer with it.
await build({ ...common, entryPoints: { viewer: path.join(root, 'src/embed/index.js'), designer: path.join(root, 'src/embed/designer.js') }, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed/esm'), entryNames: '[name]', chunkNames: 'chunk-[hash]' });
//    The same ES modules with React left to the host app (@pagewrightjs/viewer/react-peer, used by @pagewrightjs/react).
fs.rmSync(path.join(root, 'public/embed/esm-peer'), { recursive: true, force: true });
await build({ ...common, entryPoints: { viewer: path.join(root, 'src/embed/index.js'), designer: path.join(root, 'src/embed/designer.js') }, format: 'esm', ...readable, splitting: true, outdir: path.join(root, 'public/embed/esm-peer'), entryNames: '[name]', chunkNames: 'chunk-[hash]', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
// 3. The script tag people paste: a tiny loader that keeps the Pagewright.mountViewer(...) call working.
fs.writeFileSync(path.join(root, 'public/embed/pagewright-viewer.js'), `/* Pagewright viewer loader: the viewer itself is in esm/ */
(function () {
  var s = document.currentScript, base = s && s.src ? s.src.replace(/[^/]*$/, '') : '/embed/';
  var ready = import(base + 'esm/viewer.js'), designer = null;
  window.Pagewright = {
    mountViewer: function (t, o) { return ready.then(function (m) { return m.mountViewer(t, o); }); },
    // the designer loads only when a page asks for it
    mountDesigner: function (t, o) { designer = designer || import(base + 'esm/designer.js'); return designer.then(function (m) { return m.mountDesigner(t, o); }); },
    ready: ready
  };
})();
`);
fs.rmSync(path.join(root, 'public/embed/exceljs.min.js'), { force: true }); // the Excel export has its own writer now
// what a page loads up front: the entry and the chunks it imports statically
const dir = path.join(root, 'public/embed/esm');
const first = new Set();
const walk = (f) => { if (first.has(f)) return; first.add(f); for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/import\s*(?:[\w{},*\s$]+from\s*)?"\.\/(chunk-[\w-]+\.js)"/g)) walk(m[1]); };
walk('viewer.js');
const size = (f) => fs.statSync(path.join(dir, f)).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const lazy = fs.readdirSync(dir).filter(f => !first.has(f) && f !== 'designer.js');
console.log(`embed designer entry ${kb(size('designer.js'))} (+ shared chunks)`);
const gz = [...first].reduce((s, f) => s + zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length, 0);
console.log(`embed: first load ${kb([...first].reduce((s, f) => s + size(f), 0))} (${kb(gz)} gzipped); on demand ${lazy.map(f => kb(size(f))).join(', ')}; offline single file ${kb(fs.statSync(path.join(root, 'public/embed/pagewright-viewer.full.js')).size)}`);
