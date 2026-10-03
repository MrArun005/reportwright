// Builds the npm packages in packages/*: @pagewright/engine (engine, exporters, pw CLI, fonts) and
// @pagewright/viewer (the embeddable viewer as ES modules). Pack them with `npm pack packages/<name>`.
// They stay "private": publishing is a decision for the owner of the @pagewright scope.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = (names) => Object.fromEntries(names.map(n => [n, pkg.dependencies[n] || pkg.devDependencies?.[n]]).filter(([, v]) => v));
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true });
const write = (f, s) => fs.writeFileSync(path.join(root, f), typeof s === 'string' ? s : JSON.stringify(s, null, 2) + '\n');

/* engine */
const E = 'packages/engine';
const external = ['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'harfbuzzjs', 'exceljs'];
fs.rmSync(path.join(root, E, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(root, E, 'public'), { recursive: true, force: true });
await build({ entryPoints: [path.join(root, E, 'entry.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: path.join(root, E, 'dist/index.js'), external, logLevel: 'warning', mainFields: ['module', 'main'] });
await build({ entryPoints: [path.join(root, 'bin/pw.mjs')], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: path.join(root, E, 'dist/pw.mjs'), external, logLevel: 'warning' }); // esbuild keeps bin/pw.mjs's #! line
fs.chmodSync(path.join(root, E, 'dist/pw.mjs'), 0o755);
// the CLI finds fonts and the colour profile at ../public, as in the repo
copy('public/fonts', `${E}/public/fonts`);
copy('public/icc', `${E}/public/icc`);
fs.copyFileSync(path.join(root, 'public/harfbuzz-subset.wasm'), path.join(root, E, 'public/harfbuzz-subset.wasm'));
fs.rmSync(path.join(root, E, 'public/fonts/ui'), { recursive: true, force: true }); // UI fonts are for the app only
write(`${E}/package.json`, {
  name: '@pagewright/engine', version: pkg.version, private: true, type: 'module', license: 'MIT',
  description: 'Pagewright report engine: JSON report definitions to pages, PDF (incl. PDF/A), Word, Excel, HTML and CSV. Node and browsers. Includes the pw CLI.',
  exports: { '.': './dist/index.js', './package.json': './package.json' },
  bin: { pw: 'dist/pw.mjs' },
  files: ['dist', 'public', 'README.md', 'LICENSE'],
  engines: { node: '>=20.9' },
  dependencies: deps(['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'harfbuzzjs']),
  optionalDependencies: deps(['exceljs']),
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, E, 'LICENSE'));

/* viewer */
const V = 'packages/viewer';
fs.rmSync(path.join(root, V, 'dist'), { recursive: true, force: true });
if (!fs.existsSync(path.join(root, 'public/embed/esm/viewer.js'))) throw new Error('Run npm run build:embed first');
copy('public/embed/esm', `${V}/dist`);
write(`${V}/dist/viewer.d.ts`, `/** Mount the Pagewright viewer in an element. Fonts and report definitions load from \`server\`. */
export function mountViewer(target: string | HTMLElement, options: {
  server?: string; report?: string; definition?: object; params?: Record<string, string>; lang?: string; height?: string; title?: string;
  onDrill?: (report: string, params: Record<string, unknown>) => void;
}): void;
`);
write(`${V}/package.json`, {
  name: '@pagewright/viewer', version: pkg.version, private: true, type: 'module', license: 'MIT',
  description: 'The Pagewright report viewer for any web app: parameters, paging, search, drill-down, exports. React is bundled inside.',
  exports: { '.': { types: './dist/viewer.d.ts', default: './dist/viewer.js' } },
  files: ['dist', 'README.md', 'LICENSE'],
  sideEffects: true,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, V, 'LICENSE'));
console.log('packages: @pagewright/engine, @pagewright/viewer built (npm pack packages/engine packages/viewer)');
