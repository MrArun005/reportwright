// Phase 7: the npm packages build, the framework wrappers keep the framework and the viewer external,
// and the published types type-check a consumer (tests/fixtures/types/consumer.ts, with @ts-expect-error lines).
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.join(import.meta.dirname, '..', '..');
const node = (...args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

describe('npm packages', () => {
  beforeAll(() => { node('scripts/build-embed.mjs'); node('scripts/build-packages.mjs'); }, 240000);

  it.each([['react', ['react']], ['vue', ['vue']], ['svelte', []], ['angular', []]])('@reportwright/%s imports the framework and the viewer, bundles neither', (name, frameworks) => {
    const src = fs.readFileSync(path.join(root, `packages/${name}/dist/index.js`), 'utf8');
    expect(src.length).toBeLessThan(8000); // a thin wrapper, not a bundle
    expect(src).toMatch(/import\('@reportwright\/viewer(\/react-peer)?'\)/);
    for (const f of frameworks) expect(src).toMatch(new RegExp(`from '${f}'`));
    const pkg = json(`packages/${name}/package.json`);
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining(['@reportwright/viewer', ...frameworks]));
    expect(fs.existsSync(path.join(root, `packages/${name}`, pkg.types))).toBe(true);
  });

  it('the viewer package has the designer entry and generated types; the engine has its API and report types', () => {
    const v = json('packages/viewer/package.json');
    expect(v.exports['./designer'].default).toBe('./dist/designer.js');
    expect(fs.readFileSync(path.join(root, 'packages/viewer/dist/designer.d.ts'), 'utf8')).toMatch(/export function mountDesigner\(target: string \| HTMLElement, opts\?: DesignerOptions\): DesignerHandle/);
    expect(fs.readFileSync(path.join(root, 'packages/viewer/dist/viewer.d.ts'), 'utf8')).toMatch(/export type ViewerOptions/);
    expect(fs.existsSync(path.join(root, 'packages/engine/dist/types/src/exporters/pdf.d.ts'))).toBe(true);
    expect(json('packages/engine/package.json').files).toEqual(expect.arrayContaining(['index.d.ts', 'report.d.ts']));
  });

  it('the engine subsets fonts (harfbuzz-subset.wasm from @reportwright/fonts); subset: false embeds them whole', async () => {
    const m = await import(path.join(root, 'packages/engine/dist/index.js'));
    const fonts = new m.FontStore((key) => fs.readFileSync(path.join(root, 'packages/fonts/public/fonts', m.fontFile(key))));
    const model = await m.render(m.blankReport(), { fontStore: fonts });
    const small = await m.exportPdf(model, { fonts, subset: m.createSubsetter(() => fs.promises.readFile(path.join(root, 'packages/fonts/public/harfbuzz-subset.wasm'))) });
    const full = await m.exportPdf(model, { fonts, subset: false });
    expect(small.length * 4).toBeLessThan(full.length);
  }, 60000);

  it('the engine exports PowerPoint (exportPptx) with its types', async () => {
    const m = await import(path.join(root, 'packages/engine/dist/index.js'));
    const fonts = new m.FontStore((key) => fs.readFileSync(path.join(root, 'packages/fonts/public/fonts', m.fontFile(key))));
    const pptx = await m.exportPptx(await m.render(m.blankReport(), { fontStore: fonts }));
    expect(String.fromCharCode(pptx[0], pptx[1])).toBe('PK');
    expect(fs.readFileSync(path.join(root, 'packages/engine/dist/types/packages/engine/entry.d.ts'), 'utf8')).toMatch(/exportPptx/);
  }, 60000);

  it('the engine packs under 2 MB unpacked (fonts and the CLI are their own packages); a clean install runs the README quick start', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-pack-'));
    const pack = (p) => JSON.parse(execFileSync('npm', ['pack', path.join(root, p), '--json', '--pack-destination', tmp], { encoding: 'utf8' }))[0];
    const eng = pack('packages/engine'), fonts = pack('packages/fonts'), cli = pack('packages/cli');
    expect(eng.unpackedSize).toBeLessThan(2 * 1024 * 1024); // the tester's pass mark; the bundle ships readable, without a source map
    expect(eng.files.some(f => /\.(ttf|wasm)$/.test(f.path))).toBe(false);
    expect(fonts.files.some(f => f.path === 'public/harfbuzz-subset.wasm')).toBe(true);
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module","private":true}');
    execFileSync('npm', ['i', '--prefer-offline', '--no-audit', '--no-fund', ...[eng, fonts, cli].map(p => './' + p.filename)], { cwd: tmp, stdio: 'pipe' });
    fs.copyFileSync(path.join(root, 'reports/charts-showcase.pw.json'), path.join(tmp, 'statement.pw.json'));
    const readme = fs.readFileSync(path.join(root, 'packages/engine/README.md'), 'utf8');
    const js = readme.match(/```js\n([\s\S]*?)```/)[1].replace("{ accountId: 'LN-1' }", '{}');
    fs.writeFileSync(path.join(tmp, 'quick.mjs'), js);
    execFileSync(process.execPath, ['quick.mjs'], { cwd: tmp, stdio: 'pipe' });
    const pdf = fs.readFileSync(path.join(tmp, 'statement.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeLessThan(400000); // subset: harfbuzz-subset.wasm came from @reportwright/fonts
    // pdfa: true finds the sRGB profile in @reportwright/fonts by itself (B5 item 10)
    fs.writeFileSync(path.join(tmp, 'pdfa.mjs'), "import { render, defaultFontStore, exportPdf, blankReport } from '@reportwright/engine'; import fs from 'node:fs'; const fonts = defaultFontStore(); fs.writeFileSync('a.pdf', await exportPdf(await render(blankReport(), { fontStore: fonts }), { fonts, pdfa: true }));");
    execFileSync(process.execPath, ['pdfa.mjs'], { cwd: tmp, stdio: 'pipe' });
    expect(fs.readFileSync(path.join(tmp, 'a.pdf')).toString('latin1')).toMatch(/<pdfaid:part>2<\/pdfaid:part>/); // no icc passed: without the profile exportPdf throws
    // N40: no store, one on render only, one on export only (a different one), or both: each makes the PDF
    fs.writeFileSync(path.join(tmp, 'n40.mjs'), `import { render, defaultFontStore, exportPdf, blankReport } from '@reportwright/engine';
      const out = [];
      for (const family of ['Helvetica', 'Inter']) for (const [r, e] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const def = blankReport(); def.styles.base.fontFamily = family;
        const fonts = defaultFontStore();
        const pdf = await exportPdf(await render(def, r ? { fontStore: fonts } : {}), e ? { fonts: r ? fonts : defaultFontStore() } : {});
        out.push(family + r + e + ':' + pdf.length);
      }
      console.log(out.join(' '));`);
    expect(execFileSync(process.execPath, ['n40.mjs'], { cwd: tmp, encoding: 'utf8' }).trim().split(' ')).toHaveLength(8);
    // examples/node runs as it is against the packed packages
    fs.mkdirSync(path.join(tmp, 'ex/node'), { recursive: true });
    for (const f of ['report.pw.json', 'data.json']) fs.copyFileSync(path.join(root, 'examples', f), path.join(tmp, 'ex', f));
    fs.copyFileSync(path.join(root, 'examples/node/render.js'), path.join(tmp, 'ex/node/render.mjs'));
    execFileSync(process.execPath, [path.join(tmp, 'ex/node/render.mjs')], { cwd: tmp, stdio: 'pipe' });
    expect(fs.readFileSync(path.join(tmp, 'orders.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    execFileSync(path.join(tmp, 'node_modules/.bin/pw'), ['render', 'statement.pw.json', '-f', 'pdf', '-o', 'cli.pdf'], { cwd: tmp, stdio: 'pipe' });
    expect(fs.readFileSync(path.join(tmp, 'cli.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    let out = ''; // the server commands are not in the package, and say where they are
    try { execFileSync(path.join(tmp, 'node_modules/.bin/pw'), ['audit', 'verify'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = e.stderr; }
    expect(out).toMatch(/server command: run it with node bin\/pw\.mjs/);
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 240000);

  it('@reportwright/react uses the viewer build that takes React as a peer: an app bundle has one React (the host app\'s)', async () => {
    const { build } = await import('esbuild');
    const nm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-nm-')), 'node_modules');
    fs.mkdirSync(path.join(nm, '@reportwright'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages/viewer'), path.join(nm, '@reportwright/viewer')); // resolved through its package.json exports
    const out = await build({
      stdin: { contents: "import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/react'; console.log(ReportWrightViewer, ReportWrightDesigner);", resolveDir: root },
      bundle: true, format: 'esm', write: false, splitting: true, outdir: '/out', logLevel: 'silent',
      alias: { '@reportwright/react': path.join(root, 'packages/react/dist/index.js') },
      nodePaths: [nm],
      external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'scheduler', 'exceljs', 'sharp'],
    });
    const js = out.outputFiles.map(f => f.text).join('\n');
    expect(js.length).toBeGreaterThan(500000); // the viewer is in the bundle…
    expect(js).not.toMatch(/react\.transitional\.element|__CLIENT_INTERNALS_DO_NOT_USE|__DOM_INTERNALS_DO_NOT_USE/); // …React is not
    expect(js).toMatch(/from ["']react-dom\/client["']/);
    // the default entry stays self-contained for plain JS pages
    expect(fs.readdirSync(path.join(root, 'packages/viewer/dist')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, 'packages/viewer/dist', f), 'utf8')).join('')).toMatch(/react\.transitional\.element/);
    expect(json('packages/viewer/package.json').exports['./react-peer'].default).toBe('./dist/peer/viewer.js');
  }, 120000);

  it.each(['engine', 'fonts', 'cli', 'viewer', 'react', 'vue', 'svelte', 'angular'])('@reportwright/%s has the metadata npm and Socket read', (name) => {
    const p = json(`packages/${name}/package.json`);
    expect(p.repository).toEqual({ type: 'git', url: 'git+https://github.com/MrArun005/reportwright.git', directory: `packages/${name}` });
    for (const k of ['homepage', 'bugs', 'keywords', 'author', 'license', 'sideEffects', 'files']) expect(p[k], k).toBeDefined();
    if (name !== 'fonts') expect(p.engines.node).toBeDefined();
    if (p.exports && name !== 'fonts') expect(Object.values(p.exports)[0].types).toBeDefined();
    expect(p.files).toContain('CHANGELOG.md');
    expect(fs.existsSync(path.join(root, `packages/${name}/CHANGELOG.md`))).toBe(true);
    expect(fs.readFileSync(path.join(root, `packages/${name}/README.md`), 'utf8')).toMatch(/socket\.dev\/api\/badge/);
    for (const v of Object.values(p.dependencies || {})) expect(v).toMatch(/^\d+\.\d+\.\d+$|^0\.\d+\.\d+$/); // pinned
  });

  it('the viewer\'s first load is under 860 KB gzipped (other languages, exporters, PDF and barcodes load on demand)', async () => {
    const zlib = await import('node:zlib');
    const dir = path.join(root, 'packages/viewer/dist');
    const first = new Set();
    const walk = (f) => { if (first.has(f)) return; first.add(f); for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/import\s*(?:[\w{},*\s$]+from\s*)?"\.\/(chunk-[\w-]+\.js)"/g)) walk(m[1]); };
    walk('viewer.js');
    const gz = [...first].reduce((n, f) => n + zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length, 0);
    expect(gz).toBeLessThan(860 * 1024);
    const all = [...first].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(all).not.toMatch(/SUBTOTAL\(/); // the Excel writer is not in it
  });

  it('every package ships readable code (not minified); all but the engine also ship source maps', () => {
    // the engine ships its readable bundle without a map: the map was ~0.8 MB and pushed the package past its 2 MB mark
    const MAPLESS = new Set(['engine/dist/index.js']);
    for (const f of ['engine/dist/index.js', 'cli/dist/pw.mjs', 'viewer/dist/viewer.js', 'viewer/dist/designer.js', 'viewer/dist/peer/viewer.js']) {
      const src = fs.readFileSync(path.join(root, 'packages', f), 'utf8');
      const lines = src.split('\n');
      expect(src.length / lines.length, f).toBeLessThan(120); // minified code is a few very long lines
      if (MAPLESS.has(f)) { expect(src, f).not.toMatch(/sourceMappingURL/); continue; } // no dangling map link either
      expect(src, f).toMatch(/\/\/# sourceMappingURL=\S+\.map/);
      expect(fs.existsSync(path.join(root, 'packages', f + '.map')), f).toBe(true);
    }
  });

  it('the viewer imports pdf-lib, fontkit, bwip-js, fflate and bidi-js (pinned dependencies) instead of bundling their data blobs', () => {
    const LIBS = ['pdf-lib', '@pdf-lib/fontkit', '@pdf-lib/standard-fonts', 'bwip-js', 'fflate', 'bidi-js'];
    const v = json('packages/viewer/package.json');
    expect(Object.keys(v.dependencies).sort()).toEqual([...LIBS].sort());
    for (const n of LIBS) expect(v.dependencies[n]).toBe(json(`node_modules/${n}/package.json`).version);
    const dir = path.join(root, 'packages/viewer/dist');
    const all_ = fs.readdirSync(dir, { recursive: true }).filter(f => /\.(js|css)$/.test(f));
    // the render worker and its two side files bundle their libraries (N41: a copied engine.worker.js must start
    // without a bundler); everything else imports them by name
    const worker = all_.filter(f => /(^|\/)engine\.worker[^/]*\.js$/.test(f));
    const files = all_.filter(f => !worker.includes(f));
    for (const f of worker.filter(f => /engine\.worker\.js$/.test(f))) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/(from\s*|import\()["'][a-z@][^"'./]*["']/);
    const all = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(all).not.toMatch(/code49_patterns|dictionary_bin|Helvetica\w*_compressed/);
    for (const n of LIBS) expect(all).toMatch(new RegExp(`(from |import\\()"${n.replace('/', '\\/')}"`));
    for (const f of files) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) expect(l.length, f).toBeLessThanOrEqual(1000);
  });

  it('the CLI is render, test, diff and import only: no server modules, no shell access, only its own PW_* options', () => {
    const src = fs.readFileSync(path.join(root, 'packages/cli/dist/pw.mjs'), 'utf8');
    expect(src).not.toMatch(/^\/\/ src\/server\//m); // esbuild marks every bundled file with its path
    expect(src).not.toMatch(/child_process/);
    const env = [...src.matchAll(/process\.env(?:\.(\w+)|\[\s*['"](\w+)['"]\s*\])?/g)].map(m => m[1] || m[2] || '(dynamic)');
    expect(env.filter(n => !/^PW_/.test(n))).toEqual([]);
  });

  it('the rename keeps the Pagewright names as deprecated aliases (0.9); the CLI answers to reportwright and pw', async () => {
    const src = (n) => fs.readFileSync(path.join(root, `packages/${n}/dist/index.js`), 'utf8');
    expect(src('react')).toMatch(/ReportWrightViewer as PagewrightViewer/);
    expect(src('vue')).toMatch(/ReportWrightViewer as PagewrightViewer/);
    expect(src('svelte')).toMatch(/reportWrightViewer as pagewrightViewer/);
    // the Angular elements: both tag names registered, each its own class
    const defined = new Map();
    globalThis.HTMLElement ??= class {};
    const prev = globalThis.customElements;
    globalThis.customElements = { get: (t) => defined.get(t), define: (t, c) => { if ([...defined.values()].includes(c)) throw new Error('class reused'); defined.set(t, c); } };
    try {
      const m = await import(path.join(root, 'packages/angular/dist/index.js'));
      expect(m.definePagewrightElements).toBe(m.defineReportWrightElements);
      m.definePagewrightElements();
      expect([...defined.keys()].sort()).toEqual(['pagewright-designer', 'pagewright-viewer', 'reportwright-designer', 'reportwright-viewer']);
    } finally { globalThis.customElements = prev; }
    expect(json('packages/cli/package.json').bin).toEqual({ reportwright: 'dist/pw.mjs', pw: 'dist/pw.mjs' });
    expect(Object.keys(json('packages/fonts-cjk/package.json').bin)).toEqual(['reportwright-fonts-cjk', 'pagewright-fonts-cjk']);
    for (const n of ['engine', 'viewer', 'react']) expect(json(`packages/${n}/package.json`).repository.url).toBe('git+https://github.com/MrArun005/reportwright.git');
  });

  it('every package passes the Socket-style scan (scripts/scan-packages.mjs packs each one)', () => {
    let out = '', code = 0;
    try { out = node('scripts/scan-packages.mjs'); } catch (e) { out = String(e.stdout) + String(e.stderr); code = e.status; }
    expect(out).toMatch(/scan: all packages pass/);
    expect(code).toBe(0);
  }, 240000);

  it('a TypeScript consumer type-checks, and every wrong case fails', () => {
    let out = '';
    try { node('node_modules/typescript/bin/tsc', '-p', 'tests/fixtures/types'); } catch (e) { out = String(e.stdout) + String(e.stderr); }
    expect(out).toBe('');
  }, 120000);
});
