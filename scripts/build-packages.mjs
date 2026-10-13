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
import { splitContinuations, findContinuations } from './line-continuations.mjs';
const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// runtime dependencies are pinned to the exact version installed here (the one the tests ran against)
const deps = (names) => Object.fromEntries(names.map(n => [n, JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version]));
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true });
const tsc = (args) => execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--allowJs', '--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck',
  '--jsx', 'react-jsx', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', ...args], { cwd: root, stdio: 'inherit' });
/** esbuild, then each .js written with its lineLimit line continuations already joined (scripts/line-continuations.mjs:
 * an AST rewrite of esbuild's in-memory output, before anything is on disk) */
async function bundle(opts) {
  const r = await build({ ...opts, write: false });
  for (const f of r.outputFiles) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, /\.m?js$/.test(f.path) ? splitContinuations(f.text) : f.contents);
  }
  return r;
}
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
// third-party libraries stay imports (pinned dependencies), never bundled: our tarballs hold only our code. fflate is
// @reportwright/pdf's (src imports '@reportwright/pdf/fflate'): one copy for the PDF writer and the Office exporters
// pdf-lib is no dependency (B4): only pdfWriter 'legacy' and the deprecated prepare/save take it, installed by the caller
const external = ['@pdf-lib/fontkit', 'bwip-js', 'bidi-js', '@reportwright/pdf'];
fs.rmSync(path.join(root, E, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(root, E, 'public'), { recursive: true, force: true }); // fonts moved to @reportwright/fonts
// no source map: the bundle is readable (not minified), and the map was ~0.8 MB of a 2 MB package
await bundle({ entryPoints: [path.join(root, E, 'entry.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: false, sourcemap: false, charset: 'utf8', lineLimit: 400, outfile: path.join(root, E, 'dist/index.js'), external, logLevel: 'warning', mainFields: ['module', 'main'] });
// the streaming PDF's paint worker (exportPdfStream with parallel): its own file next to dist/index.js, which starts it.
// Its one engine import (src/exporters/streampaint.js) is external and resolves to ./index.js, so the package holds one
// copy of the engine and the worker paints with the bundle's painter
const streamPaint = path.join(root, 'src/exporters/streampaint.js');
await bundle({ entryPoints: [path.join(root, 'src/exporters/pdfstreamworker.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: false, sourcemap: false, charset: 'utf8', lineLimit: 400, outfile: path.join(root, E, 'dist/pdfstreamworker.js'), external, logLevel: 'warning',
  plugins: [{ name: 'engine-entry', setup: (b) => b.onResolve({ filter: /\/streampaint\.js$/ }, (a) => (path.join(a.resolveDir, a.path) === streamPaint ? { path: './index.js', external: true } : undefined)) }] });
write(`${E}/package.json`, {
  name: '@reportwright/engine', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  ...meta(E, ['pdf', 'pdf-a', 'excel', 'xlsx', 'docx', 'pptx', 'report-engine', 'jasperreports', 'ssrs', 'rdl']),
  description: 'ReportWright report engine: JSON report definitions to pages, PDF (incl. PDF/A), Word, Excel, PowerPoint, HTML and CSV. Node and browsers. Fonts: @reportwright/fonts; CLI: @reportwright/cli.',
  exports: { '.': { types: './index.d.ts', default: './dist/index.js' }, './report': { types: './report.d.ts' }, './schema.json': './schema.json', './pool': { types: './pool/index.d.ts', default: './pool/index.js' }, './package.json': './package.json' },
  types: './index.d.ts',
  files: ['dist', 'pool', 'examples', 'index.d.ts', 'report.d.ts', 'schema.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  engines: { node: '>=20.16' },
  sideEffects: false,
  dependencies: deps(external),
  peerDependencies: { '@reportwright/fonts': pkg.version },
  peerDependenciesMeta: { '@reportwright/fonts': { optional: true } },
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, E, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, E, 'THIRD-PARTY-NOTICES.md')); docs(E);
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
  main: './index.mjs', types: './index.d.ts',
  exports: { '.': { types: './index.d.ts', default: './index.mjs' }, './public/*': './public/*', './package.json': './package.json' },
  files: ['index.mjs', 'index.d.ts', 'public', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  sideEffects: false,
});
// the root import: where the files are, as URLs (Node: fileURLToPath; a bundler resolves new URL(…, import.meta.url))
write(`${F}/index.mjs`, `/** The folder of fonts (fontsUrl / defaultFontStore), the PDF font subsetter and the PDF/A sRGB profile, as URLs. */
export const fontsUrl = new URL('./public/fonts/', import.meta.url).href;
export const subsetWasmUrl = new URL('./public/harfbuzz-subset.wasm', import.meta.url).href;
export const iccUrl = new URL('./public/icc/sRGB-v2-magic.icc', import.meta.url).href;
`);
write(`${F}/index.d.ts`, 'export declare const fontsUrl: string;\nexport declare const subsetWasmUrl: string;\nexport declare const iccUrl: string;\n');
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, F, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, F, 'THIRD-PARTY-NOTICES.md')); docs(F); // MIT; each font's OFL is in public/fonts

/* fonts-cjk: a downloader for the CJK and emoji fonts (pinned commit, SHA-256 checked); the fonts are not in the tarball */
const K = 'packages/fonts-cjk';
write(`${K}/package.json`, {
  name: '@reportwright/fonts-cjk', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT AND OFL-1.1',
  description: 'Chinese, Japanese, Korean and emoji fonts (Noto, OFL) for @reportwright/engine, downloaded on demand: npx reportwright-fonts-cjk.',
  ...meta(K, ['fonts', 'cjk', 'noto', 'japanese', 'chinese', 'korean', 'emoji']),
  bin: { 'reportwright-fonts-cjk': 'src/index.mjs' },
  types: './src/index.d.ts',
  exports: { '.': { types: './src/index.d.ts', default: './src/index.mjs' }, './fonts/*': './fonts/*', './package.json': './package.json' },
  files: ['src', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  engines: { node: '>=20.16' },
  sideEffects: false,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, K, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, K, 'THIRD-PARTY-NOTICES.md')); docs(K);

/* cli: the pw command (bundled engine), fonts from @reportwright/fonts */
const C = 'packages/cli';
fs.rmSync(path.join(root, C, 'dist'), { recursive: true, force: true });
// pw audit and pw migrate-storage work on a server's storage: they stay in the app's bin/pw.mjs, and the package
// gets a stub, so no server module (storage drivers, config, child processes) is in the CLI
const serverStub = { name: 'server-stub', setup: (b) => {
  b.onResolve({ filter: /\/src\/server\// }, (a) => ({ path: a.path, namespace: 'server-stub' }));
  b.onLoad({ filter: /.*/, namespace: 'server-stub' }, () => ({ contents: "throw new Error('this is a server command: run it with node bin/pw.mjs in the ReportWright app folder');" }));
} };
await bundle({ entryPoints: [path.join(root, 'bin/pw.mjs')], bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: false, sourcemap: 'linked', sourcesContent: false, charset: 'utf8', lineLimit: 400, outfile: path.join(root, C, 'dist/cli.mjs'), external: [...external, '@reportwright/fonts'], plugins: [serverStub], logLevel: 'warning' });
// pw.mjs turns on Node's compile cache before it loads the bundle, so a second run skips compiling it (about 10 ms of
// a cold start): in a folder only this user can read (packages/engine/pool/compile-cache.js), never the shared temp folder
{
  const dirFn = fs.readFileSync(path.join(root, 'packages/engine/pool/compile-cache.js'), 'utf8').replace(/^export function/m, 'function');
  write(`${C}/dist/pw.mjs`, `#!/usr/bin/env node\n// pw: the ReportWright CLI (cli.mjs), with Node's compile cache in a private folder\nimport module from 'node:module';\n${dirFn.replace(/^\/\/.*\n/gm, '')}\ntry { const dir = compileCacheDir(); if (dir) module.enableCompileCache?.(dir); } catch { /* no cache */ }\nawait import('./cli.mjs');\n`);
}
fs.chmodSync(path.join(root, C, 'dist/pw.mjs'), 0o755);
write(`${C}/package.json`, {
  name: '@reportwright/cli', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
  ...meta(C, ['cli', 'pdf', 'snapshot-testing', 'reports-as-code']),
  description: 'pw: render, test and diff ReportWright reports from the command line.',
  bin: { reportwright: 'dist/pw.mjs', pw: 'dist/pw.mjs' },
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  sideEffects: false,
  engines: { node: '>=20.16' },
  dependencies: { ...deps(external), '@reportwright/fonts': pkg.version },
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, C, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, C, 'THIRD-PARTY-NOTICES.md')); docs(C);

// the API's types, from the JSDoc of everything entry.js exports (index.d.ts re-exports them with report.d.ts)
tsc([`${E}/entry.js`, '--rootDir', '.', '--outDir', `${E}/dist/types`]);
// pdf-lib is no dependency (only pdfWriter 'legacy' loads it, installed by the caller): its types in the JSDoc become
// `any` in the published declarations, or a project with skipLibCheck false gets TS2307 (1.0.0 shipped 13 of them).
// scripts/check-package-types.mjs (CI) type-checks the packed packages
for (const f of fs.readdirSync(path.join(root, E, 'dist/types'), { recursive: true }).filter(f => f.endsWith('.d.ts'))) {
  const file = path.join(root, E, 'dist/types', f);
  const src = fs.readFileSync(file, 'utf8').replace(/(typeof )?import\(["']pdf-lib["']\)(\.\w+)?/g, 'any');
  if (/["']pdf-lib["']/.test(src)) throw new Error(`${E}/dist/types/${f}: still names the module pdf-lib`);
  fs.writeFileSync(file, src);
}

/* viewer */
const V = 'packages/viewer';
fs.rmSync(path.join(root, V, 'dist'), { recursive: true, force: true });
if (!fs.existsSync(path.join(root, 'public/embed/esm-pkg/viewer.js'))) throw new Error('Run npm run build:embed first');
// the builds that import the third-party libraries (scripts/build-embed.mjs): the same `external` list as the engine
copy('public/embed/esm-pkg', `${V}/dist`);
copy('public/embed/esm-pkg-peer', `${V}/dist/peer`);
// no "use client" in the viewer's chunks (esbuild hoists it from a source module into a shared chunk, and Vue, Svelte
// and Angular builds warn about it): @reportwright/react's entry carries it, the one React Server Components reads
for (const d of [`${V}/dist`, `${V}/dist/peer`]) for (const f of fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js'))) {
  const file = path.join(root, d, f), src = fs.readFileSync(file, 'utf8');
  // a comment in its place keeps the line numbers the source maps point at
  if (/^["']use client["'];?\n/.test(src)) fs.writeFileSync(file, src.replace(/^["']use client["'];?/, '// "use client" is @reportwright/react\'s'));
}
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
// types from the JSDoc of the two entries (packages/viewer/tsconfig.types.json: onSave's report type resolves to the engine's)
const T = path.join(root, V, 'dist/.types');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, V, 'tsconfig.types.json')], { cwd: root, stdio: 'inherit' });
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
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  engines: { node: '>=20.16' },
  peerDependencies: { react: '>=18', 'react-dom': '>=18' },
  peerDependenciesMeta: { react: { optional: true }, 'react-dom': { optional: true } },
  sideEffects: true,
});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, V, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, V, 'THIRD-PARTY-NOTICES.md')); docs(V);

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
    files: ['dist', 'index.d.ts', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
    engines: { node: '>=20.16' },
    sideEffects: false,
    peerDependencies: { ...w.peers, '@reportwright/viewer': pkg.version },
    ...(w.optional ? { peerDependenciesMeta: Object.fromEntries(w.optional.map(n => [n, { optional: true }])) } : {}),
  });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, P, 'LICENSE')); fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, P, 'THIRD-PARTY-NOTICES.md')); docs(P);
}
// E10: the CLI and viewer bundles hold the engine, so they name ./pdfstreamworker.js too; webpack and Next.js resolve
// every new URL('./x', import.meta.url) at build time and fail when the file is missing. The parallel paint worker
// is the engine package's (Node only, never started in a browser), so these bundles ship a stand-in that says so.
{
  const stub = "// The streaming PDF's parallel paint worker is @reportwright/engine's (dist/pdfstreamworker.js). This stand-in ships so\n"
    + "// bundlers resolve new URL('./pdfstreamworker.js', import.meta.url) in this package.\n"
    + "const { parentPort } = globalThis.process.getBuiltinModule('node:worker_threads');\n"
    + "parentPort.on('message', (job) => parentPort.postMessage({ id: job.id, error: { message: 'exportPdfStream with parallel needs @reportwright/engine' } }));\n";
  for (const d of ['packages/cli/dist', 'packages/viewer/dist', 'packages/viewer/dist/peer']) {
    const dir = path.join(root, d);
    if (fs.readdirSync(dir).some(f => /\.m?js$/.test(f) && fs.readFileSync(path.join(dir, f), 'utf8').includes('./pdfstreamworker.js'))) fs.writeFileSync(path.join(dir, 'pdfstreamworker.js'), stub);
  }
}
// no backslash line continuation in a string in what npm publishes (bundle() and build-embed.mjs join them): a check, nothing is rewritten
for (const P of ['packages/engine/dist', 'packages/cli/dist', 'packages/viewer/dist']) {
  for (const f of fs.readdirSync(path.join(root, P), { recursive: true }).filter(f => /\.m?js$/.test(f))) {
    const left = findContinuations(fs.readFileSync(path.join(root, P, f), 'utf8'));
    if (left.length) throw new Error(`${P}/${f}: a backslash line continuation in a string at ${left.join(', ')}`);
  }
}
/* create-reportwright: `npm create reportwright`, zero dependencies; its templates are examples/<name> with the shared
   report.pw.json and data.json copied in (the imports that read them one folder up are rewritten to the app's own copy) */
{
  const CR = 'packages/create-reportwright';
  const T = path.join(root, CR, 'templates');
  fs.rmSync(T, { recursive: true, force: true });
  for (const name of ['node', 'react', 'vue', 'svelte', 'angular']) {
    const dir = path.join(T, name);
    fs.cpSync(path.join(root, 'examples', name), dir, { recursive: true, filter: (f) => !/node_modules|[/\\](dist|public)$/.test(f) });
    for (const f of ['report.pw.json', 'data.json']) fs.copyFileSync(path.join(root, 'examples', f), path.join(dir, f));
    for (const f of fs.readdirSync(dir, { recursive: true }).filter(f => /\.(m?js|jsx|vue|svelte)$/.test(f))) {
      const file = path.join(dir, f);
      const src = fs.readFileSync(file, 'utf8')
        .replace(/(['"])\.\.\/\.\.\/(report\.pw\.json|data\.json)\1/g, '$1../$2$1') // src/x -> ../report.pw.json
        .replace(/(['"])\.\.\/(report\.pw\.json|data\.json)\1(?=, import\.meta\.url)/g, '$1./$2$1') // node/render.js
        .replace(/,? server: \{ fs: \{ allow: \['\.\.'\] \} \}/, '').replace(/ \/\/ the shared report\.pw\.json.*$/m, '');
      if (/\.\.\/\.\.\/|allow: \['\.\.'\]/.test(src)) throw new Error(`${CR}: ${name}/${f} still reads outside the app; update build-packages.mjs`);
      fs.writeFileSync(file, src);
    }
  }
  write(`${CR}/package.json`, {
    name: 'create-reportwright', version: pkg.version, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
    ...meta(CR, ['create', 'starter', 'template', 'scaffold']),
    description: 'npm create reportwright: a working ReportWright app (Node, React, Vue, Svelte or Angular) with a sample report, in one command.',
    bin: { 'create-reportwright': 'src/bin.mjs' },
    files: ['src', 'templates', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    engines: { node: '>=20.16' },
  });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, CR, 'LICENSE')); docs(CR);
}
console.log(`packages: @reportwright/engine, /fonts, /fonts-cjk, /cli, /viewer, ${Object.keys(WRAPPERS).map(n => '/' + n).join(', ')}, create-reportwright built (npm pack packages/<name>)`);
