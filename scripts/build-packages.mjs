// Builds the npm packages in packages/*: @reportwright/engine (engine, exporters), /fonts, /cli (pw),
// @reportwright/viewer (the embeddable viewer and designer as ES modules) and the framework wrappers
// @reportwright/react, /vue, /svelte and /angular. Pack them with `npm pack packages/<name>`.
// Types: the engine's and the viewer's are generated from their JSDoc (tsc, no type check); the report
// schema (packages/engine/report.d.ts) and the wrappers' index.d.ts are written by hand.
// Public on npm under the @reportwright scope (owner: arunmallik005).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// runtime dependencies are pinned to the exact version installed here (the one the tests ran against)
const deps = (names) => Object.fromEntries(names.map(n => [n, JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version]));
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true });
const tsc = (args) => execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--allowJs', '--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck',
  '--jsx', 'react-jsx', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', ...args], { cwd: root, stdio: 'inherit' });
const REPO = 'https://github.com/MrArun005/reportwright';
/** The fields every package.json carries (Socket and npm read them): repository with its folder, homepage, bugs… */
const meta = (dir, keywords) => ({
  author: 'Arun Mallikarjun', homepage: `${REPO}/tree/main/${dir}#readme`, bugs: { url: `${REPO}/issues` },
  repository: { type: 'git', url: `git+${REPO}.git`, directory: dir },
  keywords: ['reportwright', 'report', 'reporting', ...keywords],
});
/** README.md stays the package's own; CHANGELOG.md is the repository's (one version for all packages). */
const docs = (dir) => fs.copyFileSync(path.join(root, 'CHANGELOG.md'), path.join(root, dir, 'CHANGELOG.md'));
const write = (f, s) => fs.writeFileSync(path.join(root, f), typeof s === 'string' ? s : JSON.stringify(s, null, 2) + '\n');

/* engine */
const E = 'packages/engine';
// third-party libraries stay imports (pinned dependencies), never bundled: our tarballs hold only our code
const external = ['pdf-lib', '@pdf-lib/fontkit', 'bwip-js', 'fflate', 'bidi-js'];
fs.rmSync(path.join(root, E, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(root, E, 'public'), { recursive: true, force: true }); // fonts moved to @reportwright/fonts
await build({ entryPoints: [path.join(root, E, 'entry.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: false, sourcemap: 'linked', sourcesContent: false, charset: 'utf8', lineLimit: 400, outfile: path.join(root, E, 'dist/index.js'), external, logLevel: 'warning', mainFields: ['module', 'main'] });
// the streaming PDF's paint worker (exportPdfStream with parallel): its own file next to dist/index.js, which starts it;
// it imports the engine from that bundle (one copy of the engine in the package)
{
  const w = fs.readFileSync(path.join(root, 'src/exporters/pdfstreamworker.js'), 'utf8')
    .replace("import { render, FontStore } from '../engine/index.js';", "import { render, FontStore, __streamPaint } from './index.js';")
    .replace("import { createPdfStream, paintPage, paintEnv } from './pdfstream.js';", 'const { createPdfStream, paintPage, paintEnv, latin1 } = __streamPaint;')
    .replace("import { latin1 } from './pdfpaint.js';\n", '');
  if (/from '\.\.?\/(engine|pdf)/.test(w)) throw new Error('pdfstreamworker.js: its imports changed; update build-packages.mjs');
  write(`${E}/dist/pdfstreamworker.js`, w);
}
write(`${E}/package.json`, {
  name: '@reportwright/engine', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  ...meta(E, ['pdf', 'pdf-a', 'excel', 'xlsx', 'docx', 'pptx', 'report-engine', 'jasperreports', 'ssrs', 'rdl']),
  description: 'ReportWright report engine: JSON report definitions to pages, PDF (incl. PDF/A), Word, Excel, PowerPoint, HTML and CSV. Node and browsers. Fonts: @reportwright/fonts; CLI: @reportwright/cli.',
  exports: { '.': { types: './index.d.ts', default: './dist/index.js' }, './report': { types: './report.d.ts' }, './schema.json': './schema.json', './pool': { types: './pool/index.d.ts', default: './pool/index.js' }, './package.json': './package.json' },
  types: './index.d.ts',
  files: ['dist', 'pool', 'examples', 'index.d.ts', 'report.d.ts', 'schema.json', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  engines: { node: '>=20.9' },
  sideEffects: false,
  dependencies: deps(external),
  peerDependencies: { '@reportwright/fonts': pkg.version },
  peerDependenciesMeta: { '@reportwright/fonts': { optional: true } },
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, E, 'LICENSE')); docs(E);
// the report JSON Schema (report.d.ts is generated from it: scripts/gen-report-types.mjs)
write(`${E}/schema.json`, (await import('../src/engine/schema/report.schema.js')).REPORT_SCHEMA);

/* fonts: the bundled fonts, the shaper, harfbuzz-subset.wasm and the PDF/A colour profile (the engine resolves them) */
const F = 'packages/fonts';
fs.rmSync(path.join(root, F, 'public'), { recursive: true, force: true });
copy('public/fonts', `${F}/public/fonts`);
copy('public/icc', `${F}/public/icc`);
fs.copyFileSync(path.join(root, 'public/harfbuzz-subset.wasm'), path.join(root, F, 'public/harfbuzz-subset.wasm'));
fs.rmSync(path.join(root, F, 'public/fonts/ui'), { recursive: true, force: true }); // UI fonts are for the app only
fs.rmSync(path.join(root, F, 'public/fonts/cjk'), { recursive: true, force: true }); // @reportwright/fonts-cjk
write(`${F}/package.json`, {
  name: '@reportwright/fonts', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'OFL-1.1 AND MIT',
  ...meta(F, ['fonts', 'harfbuzz', 'noto', 'inter', 'pdf-a', 'icc']),
  description: 'Fonts (Inter, JetBrains Mono, Noto), the HarfBuzz shaper and subsetter for @reportwright/engine.',
  exports: { './public/*': './public/*', './package.json': './package.json' },
  files: ['public', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  sideEffects: false,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, F, 'LICENSE')); docs(F); // MIT; each font's OFL is in public/fonts

/* fonts-cjk: a downloader for the CJK and emoji fonts (pinned commit, SHA-256 checked); the fonts are not in the tarball */
const K = 'packages/fonts-cjk';
write(`${K}/package.json`, {
  name: '@reportwright/fonts-cjk', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT AND OFL-1.1',
  description: 'Chinese, Japanese, Korean and emoji fonts (Noto, OFL) for @reportwright/engine, downloaded on demand: npx reportwright-fonts-cjk.',
  ...meta(K, ['fonts', 'cjk', 'noto', 'japanese', 'chinese', 'korean', 'emoji']),
  bin: { 'reportwright-fonts-cjk': 'src/index.mjs', 'pagewright-fonts-cjk': 'src/index.mjs' }, // old name kept for 0.9
  exports: { '.': './src/index.mjs', './fonts/*': './fonts/*', './package.json': './package.json' },
  files: ['src', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  engines: { node: '>=20.9' },
  sideEffects: false,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, K, 'LICENSE')); docs(K);

/* cli: the pw command (bundled engine), fonts from @reportwright/fonts */
const C = 'packages/cli';
fs.rmSync(path.join(root, C, 'dist'), { recursive: true, force: true });
// pw audit and pw migrate-storage work on a server's storage: they stay in the app's bin/pw.mjs, and the package
// gets a stub, so no server module (storage drivers, config, child processes) is in the CLI
const serverStub = { name: 'server-stub', setup: (b) => {
  b.onResolve({ filter: /\/src\/server\// }, (a) => ({ path: a.path, namespace: 'server-stub' }));
  b.onLoad({ filter: /.*/, namespace: 'server-stub' }, () => ({ contents: "throw new Error('this is a server command: run it with node bin/pw.mjs in the ReportWright app folder');" }));
} };
await build({ entryPoints: [path.join(root, 'bin/pw.mjs')], bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: false, sourcemap: 'linked', sourcesContent: false, charset: 'utf8', lineLimit: 400, outfile: path.join(root, C, 'dist/pw.mjs'), external: [...external, '@reportwright/fonts'], plugins: [serverStub], logLevel: 'warning' }); // esbuild keeps bin/pw.mjs's #! line
fs.chmodSync(path.join(root, C, 'dist/pw.mjs'), 0o755);
write(`${C}/package.json`, {
  name: '@reportwright/cli', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  ...meta(C, ['cli', 'pdf', 'snapshot-testing', 'reports-as-code']),
  description: 'pw: render, test and diff ReportWright reports from the command line.',
  bin: { reportwright: 'dist/pw.mjs', pw: 'dist/pw.mjs' },
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  sideEffects: false,
  engines: { node: '>=20.9' },
  dependencies: { ...deps(external), '@reportwright/fonts': pkg.version },
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, C, 'LICENSE')); docs(C);

// the API's types, from the JSDoc of everything entry.js exports (index.d.ts re-exports them with report.d.ts)
tsc([`${E}/entry.js`, '--rootDir', '.', '--outDir', `${E}/dist/types`]);

/* viewer */
const V = 'packages/viewer';
fs.rmSync(path.join(root, V, 'dist'), { recursive: true, force: true });
if (!fs.existsSync(path.join(root, 'public/embed/esm-pkg/viewer.js'))) throw new Error('Run npm run build:embed first');
// the builds that import the third-party libraries (scripts/build-embed.mjs): the same `external` list as the engine
copy('public/embed/esm-pkg', `${V}/dist`);
copy('public/embed/esm-pkg-peer', `${V}/dist/peer`);
// the two builds share every chunk that has no React in it (same content, same hashed name): keep one copy, and let
// the peer build import it from ../ (half the unpacked size)
{
  const D = path.join(root, V, 'dist'), P = path.join(D, 'peer');
  const same = new Set(fs.readdirSync(P).filter(f => /^chunk-.*\.js$/.test(f) && fs.existsSync(path.join(D, f)) && fs.readFileSync(path.join(D, f)).equals(fs.readFileSync(path.join(P, f)))));
  for (const f of same) { fs.rmSync(path.join(P, f)); fs.rmSync(path.join(P, `${f}.map`), { force: true }); }
  for (const f of fs.readdirSync(P).filter(f => f.endsWith('.js'))) {
    const file = path.join(P, f);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(["'])\.\/(chunk-[\w-]+\.js)\1/g, (m, q, c) => (same.has(c) ? `${q}../${c}${q}` : m)));
  }
}
// types from the JSDoc of the two entries; their signatures use only their own typedefs, so no imports are followed
const T = path.join(root, V, 'dist/.types');
tsc(['src/embed/index.js', 'src/embed/designer.js', '--noResolve', '--outDir', path.relative(root, T)]);
fs.renameSync(path.join(T, 'index.d.ts'), path.join(root, V, 'dist/viewer.d.ts'));
fs.renameSync(path.join(T, 'designer.d.ts'), path.join(root, V, 'dist/designer.d.ts'));
fs.rmSync(T, { recursive: true, force: true });
write(`${V}/package.json`, {
  name: '@reportwright/viewer', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  ...meta(V, ['viewer', 'report-viewer', 'report-designer', 'web-component', 'pdf']),
  description: 'The ReportWright report viewer for any web app: parameters, paging, search, drill-down, exports. React is bundled inside.',
  dependencies: deps(external),
  exports: {
    '.': { types: './dist/viewer.d.ts', default: './dist/viewer.js' }, './designer': { types: './dist/designer.d.ts', default: './dist/designer.js' },
    // the same, with React from the host app (one React in the page): what @reportwright/react imports
    './react-peer': { types: './dist/viewer.d.ts', default: './dist/peer/viewer.js' }, './react-peer/designer': { types: './dist/designer.d.ts', default: './dist/peer/designer.js' },
  },
  types: './dist/viewer.d.ts',
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  engines: { node: '>=20.9' },
  peerDependencies: { react: '>=18', 'react-dom': '>=18' },
  peerDependenciesMeta: { react: { optional: true }, 'react-dom': { optional: true } },
  sideEffects: true,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, V, 'LICENSE')); docs(V);

/* framework wrappers: plain JavaScript, the framework and the viewer as peer dependencies (nothing bundled) */
const WRAPPERS = {
  react: { peers: { react: '>=18', 'react-dom': '>=18' }, description: 'The ReportWright report viewer and designer as React components.' },
  vue: { peers: { vue: '>=3.3' }, description: 'The ReportWright report viewer and designer as Vue 3 components.' },
  svelte: { peers: { svelte: '>=3' }, optional: ['svelte'], description: 'Svelte actions for the ReportWright report viewer and designer.' },
  angular: { peers: { '@angular/core': '>=14' }, optional: ['@angular/core'], description: 'ReportWright viewer and designer custom elements for Angular (CUSTOM_ELEMENTS_SCHEMA).' },
};
for (const [name, w] of Object.entries(WRAPPERS)) {
  const P = `packages/${name}`;
  fs.rmSync(path.join(root, P, 'dist'), { recursive: true, force: true });
  copy(`${P}/src`, `${P}/dist`);
  write(`${P}/package.json`, {
    name: `@reportwright/${name}`, version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT', description: w.description,
    ...meta(P, [name, 'report-viewer', 'report-designer']),
    exports: { '.': { types: './index.d.ts', default: './dist/index.js' } },
    types: './index.d.ts',
    files: ['dist', 'index.d.ts', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    engines: { node: '>=20.9' },
    sideEffects: false,
    peerDependencies: { ...w.peers, '@reportwright/viewer': pkg.version },
    ...(w.optional ? { peerDependenciesMeta: Object.fromEntries(w.optional.map(n => [n, { optional: true }])) } : {}),
  });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, P, 'LICENSE')); docs(P);
}
console.log(`packages: @reportwright/engine, /fonts, /fonts-cjk, /cli, /viewer, ${Object.keys(WRAPPERS).map(n => '/' + n).join(', ')} built (npm pack packages/<name>)`);
