// Builds the npm packages in packages/*: @pagewrightjs/engine (engine, exporters, pw CLI, fonts),
// @pagewrightjs/viewer (the embeddable viewer and designer as ES modules) and the framework wrappers
// @pagewrightjs/react, /vue, /svelte and /angular. Pack them with `npm pack packages/<name>`.
// Types: the engine's and the viewer's are generated from their JSDoc (tsc, no type check); the report
// schema (packages/engine/report.d.ts) and the wrappers' index.d.ts are written by hand.
// Public on npm under the @pagewrightjs scope (owner: arunmallik005).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = (names) => Object.fromEntries(names.map(n => [n, pkg.dependencies[n] || pkg.devDependencies?.[n]]).filter(([, v]) => v));
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true });
const tsc = (args) => execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--allowJs', '--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck',
  '--jsx', 'react-jsx', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', ...args], { cwd: root, stdio: 'inherit' });
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
  name: '@pagewrightjs/engine', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  description: 'Pagewright report engine: JSON report definitions to pages, PDF (incl. PDF/A), Word, Excel, PowerPoint, HTML and CSV. Node and browsers. Includes the pw CLI.',
  exports: { '.': { types: './index.d.ts', default: './dist/index.js' }, './report': { types: './report.d.ts' }, './package.json': './package.json' },
  types: './index.d.ts',
  bin: { pw: 'dist/pw.mjs' },
  files: ['dist', 'public', 'index.d.ts', 'report.d.ts', 'README.md', 'LICENSE'],
  engines: { node: '>=20.9' },
  dependencies: deps(['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'harfbuzzjs']),
  optionalDependencies: deps(['exceljs']),
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, E, 'LICENSE'));
// the API's types, from the JSDoc of everything entry.js exports (index.d.ts re-exports them with report.d.ts)
tsc([`${E}/entry.js`, '--rootDir', '.', '--outDir', `${E}/dist/types`]);

/* viewer */
const V = 'packages/viewer';
fs.rmSync(path.join(root, V, 'dist'), { recursive: true, force: true });
if (!fs.existsSync(path.join(root, 'public/embed/esm/viewer.js'))) throw new Error('Run npm run build:embed first');
copy('public/embed/esm', `${V}/dist`);
// types from the JSDoc of the two entries; their signatures use only their own typedefs, so no imports are followed
const T = path.join(root, V, 'dist/.types');
tsc(['src/embed/index.js', 'src/embed/designer.js', '--noResolve', '--outDir', path.relative(root, T)]);
fs.renameSync(path.join(T, 'index.d.ts'), path.join(root, V, 'dist/viewer.d.ts'));
fs.renameSync(path.join(T, 'designer.d.ts'), path.join(root, V, 'dist/designer.d.ts'));
fs.rmSync(T, { recursive: true, force: true });
write(`${V}/package.json`, {
  name: '@pagewrightjs/viewer', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  description: 'The Pagewright report viewer for any web app: parameters, paging, search, drill-down, exports. React is bundled inside.',
  exports: { '.': { types: './dist/viewer.d.ts', default: './dist/viewer.js' }, './designer': { types: './dist/designer.d.ts', default: './dist/designer.js' } },
  types: './dist/viewer.d.ts',
  files: ['dist', 'README.md', 'LICENSE'],
  sideEffects: true,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, V, 'LICENSE'));

/* framework wrappers: plain JavaScript, the framework and the viewer as peer dependencies (nothing bundled) */
const WRAPPERS = {
  react: { peers: { react: '>=18' }, description: 'The Pagewright report viewer and designer as React components.' },
  vue: { peers: { vue: '>=3.3' }, description: 'The Pagewright report viewer and designer as Vue 3 components.' },
  svelte: { peers: { svelte: '>=3' }, optional: ['svelte'], description: 'Svelte actions for the Pagewright report viewer and designer.' },
  angular: { peers: { '@angular/core': '>=14' }, optional: ['@angular/core'], description: 'Pagewright viewer and designer custom elements for Angular (CUSTOM_ELEMENTS_SCHEMA).' },
};
for (const [name, w] of Object.entries(WRAPPERS)) {
  const P = `packages/${name}`;
  fs.rmSync(path.join(root, P, 'dist'), { recursive: true, force: true });
  copy(`${P}/src`, `${P}/dist`);
  write(`${P}/package.json`, {
    name: `@pagewrightjs/${name}`, version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT', description: w.description,
    exports: { '.': { types: './index.d.ts', default: './dist/index.js' } },
    types: './index.d.ts',
    files: ['dist', 'index.d.ts', 'README.md', 'LICENSE'],
    sideEffects: false,
    peerDependencies: { ...w.peers, '@pagewrightjs/viewer': pkg.version },
    ...(w.optional ? { peerDependenciesMeta: Object.fromEntries(w.optional.map(n => [n, { optional: true }])) } : {}),
  });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, P, 'LICENSE'));
}
console.log(`packages: @pagewrightjs/engine, /viewer, ${Object.keys(WRAPPERS).map(n => '/' + n).join(', ')} built (npm pack packages/<name>)`);
