// Builds public/embed/pagewright-viewer.js: React + viewer + engine in one script for other sites.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
// viewer styles, scoped to the shadow root
let css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  .replace(/@font-face\s*\{[^}]*\}/g, '')
  .replace(/:root\b/g, ':host')
  .replace(/html,\s*body\s*\{[^}]*\}/g, '')
  .replace(/(^|\n)body\s*\{/g, '$1.pw-embed{');
css += '\n.pw-embed{display:block;font:var(--fw-regular) var(--fs-base)/var(--lh) var(--ui);color:var(--ink);background:var(--desk);border:1px solid var(--line);border-radius:8px;overflow:hidden}\n';
await build({
  entryPoints: [path.join(root, 'src/embed/index.js')],
  bundle: true, minify: true, format: 'iife', target: ['es2020'],
  outfile: path.join(root, 'public/embed/pagewright-viewer.js'),
  alias: { '@': path.join(root, 'src') },
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __PW_CSS__: JSON.stringify(css), __PW_EMBED__: 'true' },
  external: ['exceljs'],
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent', 'unsupported-dynamic-import': 'silent' },
});
fs.copyFileSync(path.join(root, 'node_modules/exceljs/dist/exceljs.min.js'), path.join(root, 'public/embed/exceljs.min.js'));
const kb = (fs.statSync(path.join(root, 'public/embed/pagewright-viewer.js')).size / 1024).toFixed(0);
console.log(`public/embed/pagewright-viewer.js ${kb} KB`);
