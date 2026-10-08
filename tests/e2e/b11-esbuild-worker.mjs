// N41: an esbuild app that copies engine.worker.js next to its bundle (the README's setup) renders in the worker.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://b11.test';
// N18: no chunk imports in the worker file
for (const d of ['packages/viewer/dist', 'packages/viewer/dist/peer']) {
  const f = path.join(root, d, 'engine.worker.js');
  if (fs.existsSync(f)) assert.equal(/from\s*["']\.\/chunk-/.test(fs.readFileSync(f, 'utf8')), false, `${d}/engine.worker.js imports a chunk`);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b11-'));
fs.mkdirSync(path.join(tmp, 'node_modules/@reportwright'), { recursive: true });
fs.symlinkSync(path.join(root, 'packages/viewer'), path.join(tmp, 'node_modules/@reportwright/viewer'));
fs.writeFileSync(path.join(tmp, 'viewer.js'), "export { mountViewer } from '@reportwright/viewer';");
await build({ entryPoints: [path.join(tmp, 'viewer.js')], bundle: true, format: 'esm', splitting: true, outdir: path.join(tmp, 'out'),
  nodePaths: [path.join(tmp, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
const FONTS = path.join(root, 'packages/fonts/public/fonts/');
const definition = {
  $schema: 'pagewright/report@1', name: 'B9', page: { size: 'A4', margins: [36, 36, 36, 36] },
  parameters: [{ name: 'region', type: 'string', default: 'North', options: ['North', 'South'] },
    { name: 'city', type: 'string', default: 'Delhi', optionsFrom: { dataSet: 'Cities', value: '=Fields.city' } }],
  dataSources: [{ name: 'c', type: 'json', data: { rows: [{ region: 'North', city: 'Delhi' }, { region: 'North', city: 'Jaipur' }, { region: 'South', city: 'Chennai' }, { region: 'South', city: 'Kochi' }] } }],
  dataSets: [{ name: 'Cities', source: 'c', path: '$.rows', filters: [{ expr: '=Fields.region', op: '=', value: '=Parameters.region' }] }],
  sections: { body: { items: [
    { type: 'textbox', name: 'H', x: 0, y: 60, w: 300, h: 20, value: 'Helvetica line', style: { fontFamily: 'Helvetica' } },
    { type: 'barcode', name: 'Q', x: 0, y: 90, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' },
    { type: 'textbox', name: 'A', x: 0, y: 0, w: 300, h: 20, value: '="R:" & Parameters.region' },
    { type: 'textbox', name: 'B', x: 0, y: 30, w: 300, h: 20, value: '="C:" & Parameters.city', style: { fontWeight: 'bold' } }] } },
};
const html = `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module">
import { mountViewer } from '/pw/viewer.js';
window.h = mountViewer('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/' });
</script>`;
// N41: the README's esbuild setup: bundle the app, copy engine.worker.js (and its side files) next to the bundle
for (const f of fs.readdirSync(path.join(root, 'packages/viewer/dist'))) if (/^engine\.worker.*\.js$/.test(f)) fs.copyFileSync(path.join(root, 'packages/viewer/dist', f), path.join(tmp, 'out', f));
const b = await chromium.launch();
try {
  const p = await (await b.newContext()).newPage();
  const errors = [], warns = [], asked = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  p.on('pageerror', e => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url()); asked.push(u.pathname);
    if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    const f = u.pathname.startsWith('/pw/') ? path.join(tmp, 'out', u.pathname.slice(4)) : u.pathname.startsWith('/pw-fonts/') ? path.join(FONTS, u.pathname.slice(10)) : null;
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  });
  await p.goto(`${ORIGIN}/`);
  await p.waitForFunction(() => /Helvetica line/.test([...(document.querySelector('#r')?.shadowRoot?.querySelectorAll('.vpage text') || [])].map(n => n.textContent).join(' ')), null, { timeout: 30000 });
  assert.equal(await p.evaluate(() => window.h.usesWorker), true, `the copied worker must start: ${warns.join(' | ')} ${errors.join(' | ')}`);
  assert.ok(!warns.some(w => /worker did not load/.test(w)), warns.join(' | '));
  assert.ok(!errors.some(e => /Failed to resolve module specifier/.test(e)), errors.join(' | '));
  assert.ok(asked.includes('/pw/engine.worker.bwip.js') && asked.includes('/pw/engine.worker.stdfonts.js'), 'barcode and standard-font files load next to the worker');
} finally { await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('b11-esbuild-worker: ok (a copied engine.worker.js starts; barcode and Helvetica drawn in the worker)');
