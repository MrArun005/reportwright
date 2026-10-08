// The esbuild options of the embeddable viewer, designer and render worker: scripts/build-embed.mjs builds with them,
// tests/engine/b10-bundle-size.test.js builds the same in memory to hold the first load to its budget.
import fs from 'node:fs';
import path from 'node:path';
export const root = path.join(import.meta.dirname, '..');
// viewer styles, scoped to the shadow root
let css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  .replace(/@font-face\s*\{[^}]*\}/g, '')
  .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])') // dark theme: data-theme on the host element
  .replace(/:root\b/g, ':host')
  .replace(/html,\s*body\s*\{[^}]*\}/g, '')
  .replace(/(^|\n)body\s*\{/g, '$1.pw-embed{');
css += '\n.pw-embed{display:block;font:var(--fw-regular) var(--fs-base)/var(--lh) var(--ui);color:var(--ink);background:var(--desk);border:1px solid var(--line);border-radius:8px;overflow:hidden}\n';
export const common = {
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
export const readable = { minify: false, sourcemap: 'linked', sourcesContent: false, legalComments: 'inline', charset: 'utf8', lineLimit: 400 };
// the ES module builds: the viewer, the designer, and the render worker the viewer starts (src/worker)
export const ENTRIES = { viewer: path.join(root, 'src/embed/index.js'), designer: path.join(root, 'src/embed/designer.js') };
// the render worker is one file (no chunk imports; bwip-js is a file of its own, below), so copying it alone works (N18)
export const WORKER = path.join(root, 'src/worker/engine.worker.js');
// bwip-js (1.6 MB, a third of the worker) is a file of its own next to the worker, imported when a report has a barcode:
// the worker's import('bwip-js') becomes import('./engine.worker.bwip.js'). A worker copied alone still renders every
// report: a barcode report whose library is missing renders on the main thread (src/worker/engine.worker.js).
export const BWIP_FILE = 'engine.worker.bwip.js';
// the standard-14 font metrics (@pdf-lib/standard-fonts, ~100 KB gzipped) the same way: only a report that names
// Helvetica, Times or Courier loads them
export const STDFONTS_FILE = 'engine.worker.stdfonts.js';
/** each library kept out of the worker, and the file next to it that holds it */
export const APART = { 'bwip-js': BWIP_FILE, '@pdf-lib/standard-fonts': STDFONTS_FILE };
export const bwipApart = { name: 'libs-apart', setup: (b) => b.onResolve({ filter: /^(bwip-js|@pdf-lib\/standard-fonts)$/ }, (a) => ({ path: `./${APART[a.path]}`, external: true })) };
/**
 * The output files a page loads up front for an entry: the entry and the chunks it imports statically (import()
 * chunks load on demand). @param {import('esbuild').Metafile} meta @param {string} entry its output path in meta.outputs
 */
export function firstLoad(meta, entry) {
  const seen = new Set();
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); for (const i of meta.outputs[f].imports) if (i.kind === 'import-statement' && !i.external) walk(i.path); };
  walk(entry);
  return [...seen];
}
