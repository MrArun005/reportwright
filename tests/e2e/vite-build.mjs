// N1: a Vite app that imports @reportwright/viewer builds with no Vite config, and the built app renders a report in the
// viewer's Web Worker. The package comes from `npm pack` (what npm users install), its dependencies from this repo's
// node_modules (no network). Run npm run build:packages first.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-vite-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

// the tarball, unpacked where npm would put it
const tgz = run('npm', ['pack', path.join(root, 'packages/viewer'), '--pack-destination', tmp, '--silent'], root).trim().split('\n').pop();
const nm = path.join(tmp, 'node_modules');
fs.mkdirSync(path.join(nm, '@reportwright/viewer'), { recursive: true });
run('tar', ['xzf', path.join(tmp, tgz), '-C', path.join(nm, '@reportwright/viewer'), '--strip-components=1'], tmp);
const pkg = JSON.parse(fs.readFileSync(path.join(nm, '@reportwright/viewer/package.json'), 'utf8'));
for (const d of [...Object.keys(pkg.dependencies || {}), 'vite']) {
  fs.mkdirSync(path.dirname(path.join(nm, d)), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules', d), path.join(nm, d));
}
assert.ok(fs.existsSync(path.join(nm, '@reportwright/viewer/dist/engine.worker.js')), 'the package ships the worker');

const definition = {
  $schema: 'pagewright/report@1', name: 'Vite', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
    { type: 'barcode', name: 'B', x: 0, y: 60, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' }] } },
};
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'vite-app', private: true, type: 'module' }));
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/main.js"></script>');
fs.writeFileSync(path.join(tmp, 'main.js'), `import { mountViewer } from '@reportwright/viewer';
mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }, fontsUrl: '/pw-fonts/' });
`);

// no vite.config.*: the defaults
let out;
try { out = run(process.execPath, [path.join(nm, 'vite/bin/vite.js'), 'build', '--logLevel', 'warn'], tmp); } catch (e) { console.error(e.stdout, e.stderr); throw new Error('vite build failed'); }
const assets = fs.readdirSync(path.join(tmp, 'dist/assets'));
const worker = assets.find(f => /^engine\.worker.*\.js$/.test(f));
assert.ok(worker, `the worker is emitted: ${assets.join(', ')}`);
console.log(`vite build OK (no config): ${assets.length} assets, worker ${worker}${out.trim() ? `\n${out.trim()}` : ''}`);

// the built app renders, in the worker
const ORIGIN = 'http://vite.test';
const FILES = { '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/'), '/': path.join(tmp, 'dist/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.css': 'text/css' };
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [], workers = [], missing = [];
p.on('pageerror', e => errs.push(e.message));
p.on('worker', w => workers.push(w.url()));
await p.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = path.join(FILES[pre], u.pathname === '/' ? 'index.html' : u.pathname.slice(pre.length));
  if (!fs.existsSync(f)) { missing.push(u.pathname); return route.fulfill({ status: 404, body: 'not found' }); }
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
});
await p.goto(`${ORIGIN}/`);
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 30000 });
const text = await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' '));
assert.match(text, /Asha Rao/);
assert.match(text, /1,200\.50/);
assert.ok(await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage path')].some(e => (e.getAttribute('d') || '').length > 200)), 'the barcode (bwip-js, imported on demand in the worker) is drawn');
assert.ok(workers.some(u => u.includes('engine.worker')), `rendered in the worker: ${workers}`);
assert.deepEqual(missing, []);
assert.deepEqual(errs, []);
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('vite app: the report renders in the viewer\'s worker');
