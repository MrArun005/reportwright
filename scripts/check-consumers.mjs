// The packages as their users get them: npm pack engine, fonts, viewer and react (and the packages/* they depend on),
// then install only those tarballs, with the framework from the registry, in four new projects and use them:
//   node  plain Node ESM: render a table and a barcode with @reportwright/engine + @reportwright/fonts, export a PDF
//   ts    TypeScript strict (skipLibCheck false, module nodenext) over engine, viewer and react: tsc --noEmit with 0
//         errors, then tsc and run the output (a PDF)
//   vite  Vite + React (@reportwright/react): vite build, the built app in Chromium shows a page and exports a PDF
//   next  Next.js app router: next build, next start, the client viewer shows a page and exports a PDF, and a route
//         handler (app/api/pdf) renders a PDF on the server with the engine
// node scripts/check-consumers.mjs [--only=node,ts,vite,next] [--node=/path/to/node[,...]] [--keep]
// --node also runs the node and ts projects with each of those binaries (the engines field says >=20.16), e.g.
// --node=$(nvm which 20.16.0). Run npm run build:packages first. Needs the registry.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const ALL = ['node', 'ts', 'vite', 'next'];
const only = args.only ? String(args.only).split(',') : ALL;
const bad = only.filter(n => !ALL.includes(n));
if (bad.length) { console.error(`unknown consumer: ${bad.join(', ')} (one of ${ALL.join(', ')})`); process.exit(2); }
const extraNodes = args.node ? String(args.node).split(',').filter(Boolean) : [];
// the framework versions: the ones this repository's tests run against, and Next's latest 16
const ver = (n) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version;
const V = { react: ver('react'), 'react-dom': ver('react-dom'), typescript: ver('typescript'), vite: ver('vite'), next: '16',
  '@types/react': '19', '@types/react-dom': '19', '@types/node': '22', '@vitejs/plugin-react': '6' };
const dep = (...names) => names.map(n => `${n}@${V[n]}`);

// temp dirs and servers go on exit, also on a failure or ^C
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-consumers-'));
const procs = new Set();
let browser;
process.on('exit', () => {
  for (const c of procs) try { process.kill(-c.pid, 'SIGKILL'); } catch {}
  if (args.keep) console.log(`kept ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));

const tail = (s, n = 40) => String(s || '').trim().split('\n').slice(-n).join('\n');
const run = (cmd, argv, cwd, opts = {}) => {
  try {
    return execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, timeout: 900000,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...opts.env } });
  } catch (e) { throw new Error(`${path.basename(cmd)} ${argv.join(' ')} failed in ${cwd}\n${tail(e.stdout)}\n${tail(e.stderr)}`); }
};
const npm = (argv, cwd) => run('npm', argv, cwd);
const write = (dir, files) => {
  for (const [f, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof s === 'string' ? s : JSON.stringify(s, null, 2));
  }
};
const project = (name, files) => {
  const dir = path.join(tmp, name);
  write(dir, { 'package.json': { name: `rw-consumer-${name}`, private: true, type: 'module' }, ...files });
  return dir;
};
const install = (dir, pkgs, extra) => npm(['install', '--no-audit', '--no-fund', '--loglevel=error', ...pkgs.map(p => tgz[p]), ...extra], dir);
const copyFonts = (dir) => fs.cpSync(path.join(dir, 'node_modules/@reportwright/fonts/public'), path.join(dir, 'public/pw'), { recursive: true });
const isPdf = (u8) => String.fromCharCode(...u8.subarray(0, 5)) === '%PDF-';
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

// 1. the tarballs: the four packages and every packages/* they name as a dependency or peer
const local = Object.fromEntries(fs.readdirSync(path.join(root, 'packages')).map(d => [d, path.join(root, 'packages', d, 'package.json')])
  .filter(([, f]) => fs.existsSync(f)).map(([d, f]) => [JSON.parse(fs.readFileSync(f, 'utf8')).name, path.join(root, 'packages', d)]));
const tgz = {};
const packDir = path.join(tmp, 'pack');
fs.mkdirSync(packDir);
const pack = (name) => {
  if (tgz[name]) return;
  const dir = local[name];
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert(fs.existsSync(path.join(dir, pj.exports?.['.']?.default || pj.main || 'dist')), `${name} is not built: run npm run build:packages`);
  tgz[name] = path.join(packDir, npm(['pack', dir, '--pack-destination', packDir, '--silent'], root).trim().split('\n').pop());
  for (const d of Object.keys({ ...pj.dependencies, ...pj.peerDependencies })) if (local[d]) pack(d);
};
for (const n of ['engine', 'fonts', 'viewer', 'react']) pack(`@reportwright/${n}`);

// the report: a barcode and a table of 80 rows (two A4 pages)
const definition = {
  $schema: 'reportwright/report@1', name: 'Consumer', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Lines', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [
    { type: 'barcode', name: 'B', x: 0, y: 0, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' },
    { type: 'table', name: 'T', x: 0, y: 60, w: 400, h: 40, dataSet: 'Lines', columns: [{ width: 250 }, { width: 150 }],
      header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount', style: { textAlign: 'right' } }] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2', textAlign: 'right' } }] }] },
  ] } },
};
const orders = { rows: Array.from({ length: 80 }, (_, i) => ({ customer: i ? `Customer ${i}` : 'Asha Rao', amount: i ? i * 10.25 : 1200.5 })) };
const DEF = JSON.stringify(definition), DATA = JSON.stringify(orders);

// the viewer in Chromium: a page is drawn (text in .vpage, as tests/e2e/react-wrapper.mjs checks), no page errors, and
// the handle (window.__rw, from onReady) exports a PDF
async function inBrowser(url) {
  browser ??= await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' || /\[reportwright\]/.test(m.text())) errs.push(`console.${m.type()}: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  try {
    await p.goto(url);
    await p.waitForFunction(() => window.__rw?.getPageCount() > 0 && [...document.querySelectorAll('#v *')].some(e => e.shadowRoot?.querySelector('.vpage text')),
      null, { timeout: 90000 }).catch((e) => { throw new Error(`no page in the viewer: ${e.message.split('\n')[0]}\n${errs.join('\n')}`); });
    const r = await p.evaluate(async () => {
      const text = [...document.querySelectorAll('#v *')].map(e => e.shadowRoot?.textContent || '').join(' ');
      const u = new Uint8Array(await (await window.__rw.export('pdf')).arrayBuffer());
      return { text, head: String.fromCharCode(...u.subarray(0, 5)), bytes: u.length, pages: window.__rw.getPageCount(), worker: window.__rw.usesWorker };
    });
    assert(/Asha Rao/.test(r.text), `the page does not show the data: ${r.text.slice(0, 200)}`);
    assert(r.head === '%PDF-', `the viewer's export is not a PDF: ${JSON.stringify(r.head)}`);
    assert(r.worker, 'the viewer rendered on the main thread, not in its worker');
    assert(!errs.length, `errors in the page:\n${errs.join('\n')}`);
    return `${r.pages} pages, PDF ${r.bytes} bytes`;
  } finally { await ctx.close(); }
}

// node: plain ESM
const NODE_APP = `import fs from 'node:fs';
import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
const def = JSON.parse(fs.readFileSync(new URL('./report.pw.json', import.meta.url), 'utf8'));
const fonts = defaultFontStore();
const model = await render(def, { fontStore: fonts, sources: { orders: ${DATA} } });
const pdf = await exportPdf(model, { fonts, title: 'Consumer' });
if (String.fromCharCode(...pdf.subarray(0, 5)) !== '%PDF-') throw new Error('not a PDF');
fs.writeFileSync('out.pdf', pdf);
console.log(JSON.stringify({ pages: model.pages.length, bytes: pdf.length }));
`;
const checkPdfRun = (out, dir) => {
  const r = JSON.parse(out.trim().split('\n').pop());
  assert(r.pages >= 1, `no pages: ${out}`);
  assert(isPdf(fs.readFileSync(path.join(dir, 'out.pdf'))), 'out.pdf is not a PDF');
  return `${r.pages} pages, PDF ${r.bytes} bytes`;
};
const consumers = {};
consumers.node = () => {
  const dir = project('node', { 'report.pw.json': DEF, 'index.mjs': NODE_APP });
  install(dir, ['@reportwright/engine', '@reportwright/fonts'], []);
  return (node) => checkPdfRun(run(node, ['index.mjs'], dir), dir);
};

// ts: strict, skipLibCheck false, nodenext; the viewer and react types are checked against values that use them, and
// @ts-expect-error proves they are not any
const TS_APP = `import fs from 'node:fs';
import { render, defaultFontStore, exportPdf, FontStore, type PdfOptions, type Report } from '@reportwright/engine';
import type { ViewerHandle, ViewerOptions, ViewerFormat } from '@reportwright/viewer';
import type { ReportWrightViewerProps } from '@reportwright/react';

const def: Report = ${DEF};
const orders: { rows: { customer: string; amount: number }[] } = ${DATA};
const fonts: FontStore = defaultFontStore();
const options: PdfOptions = { fonts, title: 'Consumer' };
const model = await render(def, { fontStore: fonts, sources: { orders } });
const pdf: Uint8Array = await exportPdf(model, options);
if (String.fromCharCode(...pdf.subarray(0, 5)) !== '%PDF-') throw new Error('not a PDF');
fs.writeFileSync('out.pdf', pdf);

const viewer: ViewerOptions = { definition: def, data: { orders }, fontsUrl: '/pw/fonts/', viewMode: 'continuous' };
const props: ReportWrightViewerProps = { ...viewer, style: { height: 600 }, onReady: (h: ViewerHandle) => { void h.getPageCount(); }, onError: () => {} };
const exportAs = (h: ViewerHandle, f: ViewerFormat): Promise<Blob> => h.export(f);
// @ts-expect-error not a format
const notAFormat = (h: ViewerHandle) => h.export('gif');
// @ts-expect-error not a view mode
const notAMode: ViewerOptions = { viewMode: 'grid' };
void [props, exportAs, notAFormat, notAMode];
console.log(JSON.stringify({ pages: model.pages.length, bytes: pdf.length }));
`;
consumers.ts = () => {
  const dir = project('ts', {
    'index.ts': TS_APP,
    'tsconfig.json': { compilerOptions: { strict: true, skipLibCheck: false, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022',
      lib: ['es2022', 'dom'], types: ['node'], outDir: 'dist', noEmitOnError: true }, files: ['index.ts'] },
  });
  install(dir, ['@reportwright/engine', '@reportwright/fonts', '@reportwright/viewer', '@reportwright/react'],
    dep('typescript', '@types/node', '@types/react', '@types/react-dom', 'react', 'react-dom'));
  const tsc = path.join(dir, 'node_modules/typescript/bin/tsc');
  return (node) => {
    try { execFileSync(node, [tsc, '--noEmit', '-p', '.'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); } catch (e) {
      const out = String(e.stdout || '') + String(e.stderr || '');
      throw new Error(`tsc --noEmit: ${(out.match(/error TS\d+/g) || []).length} errors\n${tail(out.split(dir).join('<project>'), 60)}`);
    }
    run(node, [tsc, '-p', '.'], dir);
    return checkPdfRun(run(node, ['dist/index.js'], dir), dir);
  };
};

// vite: Vite + @vitejs/plugin-react, the README's setup; the build served by a static server
const REACT_APP = (extra = '') => `${extra}import { ReportWrightViewer } from '@reportwright/react';
const definition = ${DEF};
const orders = ${DATA};
export default function Report() {
  return (
    <div id="v">
      <ReportWrightViewer definition={definition} data={{ orders }} fontsUrl="/pw/fonts/" style={{ height: 600 }}
        onReady={(h) => { window.__rw = h; }} onError={(e) => { console.error('onError', e); }} />
    </div>
  );
}
`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.icc': 'application/octet-stream' };
const serve = (dist) => new Promise((res) => {
  const s = http.createServer((req, rs) => {
    let f = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(dist)) return rs.writeHead(403).end();
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return rs.writeHead(404).end('not found');
    rs.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  }).listen(0, '127.0.0.1', () => res(s));
});
consumers.vite = () => {
  const dir = project('vite', {
    'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>vite consumer</title></head><body><div id="app"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n",
    'src/Report.jsx': REACT_APP(),
    'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport Report from './Report.jsx';\ncreateRoot(document.getElementById('app')).render(<Report />);\n",
  });
  install(dir, ['@reportwright/react', '@reportwright/viewer', '@reportwright/fonts'], dep('react', 'react-dom', 'vite', '@vitejs/plugin-react'));
  copyFonts(dir);
  return async () => {
    run(process.execPath, [path.join(dir, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], dir);
    const s = await serve(path.join(dir, 'dist'));
    try { return await inBrowser(`http://127.0.0.1:${s.address().port}/`); } finally { s.close(); }
  };
};

// next: app router; the viewer in a client component, the engine in a route handler
const startServer = async (cmd, argv, cwd, url) => {
  const c = spawn(cmd, argv, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  procs.add(c);
  let log = '';
  c.stdout.on('data', d => { log += d; });
  c.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  for (;;) {
    if (c.exitCode !== null) throw new Error(`${argv.join(' ')} exited ${c.exitCode}\n${tail(log)}`);
    if (Date.now() - t0 > 90000) throw new Error(`${argv.join(' ')} did not answer in 90 s\n${tail(log)}`);
    if (await fetch(url).then(r => r.ok, () => false)) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return { log: () => log, stop: () => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} procs.delete(c); } };
};
const ROUTE = `import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
const definition = ${DEF};
const orders = ${DATA};
export async function GET() {
  const fonts = defaultFontStore();
  const model = await render(definition, { fontStore: fonts, sources: { orders } });
  const pdf = await exportPdf(model, { fonts, title: 'Consumer' });
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'x-pages': String(model.pages.length) } });
}
`;
consumers.next = () => {
  const dir = project('next', {
    'next.config.mjs': 'export default {};\n',
    'app/layout.js': "export const metadata = { title: 'next consumer' };\nexport default function Layout({ children }) { return <html lang=\"en\"><body>{children}</body></html>; }\n",
    'app/page.js': "import Report from './Report';\nexport default function Page() { return <main><h1>Report</h1><Report /></main>; }\n",
    'app/Report.js': REACT_APP("'use client';\n"),
    'app/api/pdf/route.js': ROUTE,
  });
  install(dir, ['@reportwright/react', '@reportwright/viewer', '@reportwright/fonts', '@reportwright/engine'], dep('next', 'react', 'react-dom'));
  copyFonts(dir);
  return async () => {
    const next = path.join(dir, 'node_modules/next/dist/bin/next');
    run(process.execPath, [next, 'build'], dir);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const srv = await startServer(process.execPath, [next, 'start', '-p', String(port), '-H', '127.0.0.1'], dir, `${base}/`);
    try {
      const r = await fetch(`${base}/api/pdf`);
      const body = new Uint8Array(await r.arrayBuffer());
      assert(r.ok && isPdf(body), `GET /api/pdf: ${r.status} ${r.headers.get('content-type')} ${Buffer.from(body.subarray(0, 300)).toString()}\n${tail(srv.log())}`);
      const page = await inBrowser(`${base}/`).catch((e) => { throw new Error(`${e.message}\n${tail(srv.log())}`); });
      return `${page}; /api/pdf ${r.headers.get('x-pages')} pages, ${body.length} bytes`;
    } finally { srv.stop(); }
  };
};

for (const n of extraNodes) assert(fs.existsSync(n), `--node: ${n} does not exist`);
const alt = extraNodes.map(n => ({ bin: n, v: run(n, ['-v'], root).trim() }));
const secs = (t) => ((performance.now() - t) / 1000).toFixed(1);
for (const name of only) {
  const t = performance.now();
  try {
    const check = await consumers[name]();
    const info = await check(process.execPath);
    console.log(`ok ${name} (${secs(t)}s)  [${process.version}: ${info}]`);
    if (name === 'node' || name === 'ts') for (const a of alt) {
      const t2 = performance.now();
      try { const r = check(a.bin); console.log(`ok ${name}@${a.v} (${secs(t2)}s)  [${r}]`); } catch (e) { console.log(`FAIL ${name}@${a.v} (${secs(t2)}s): ${e.message}`); process.exitCode = 1; }
    }
  } catch (e) { console.log(`FAIL ${name} (${secs(t)}s): ${e.message}`); process.exitCode = 1; }
}
await browser?.close();
