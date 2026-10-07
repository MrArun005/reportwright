// B5 item 5: @pagewrightjs/viewer on a static page with no Pagewright server: definition + data + fontsUrl.
// No HTTP server at all: Playwright answers every request from disk. The page's script is the package bundled the way an
// app bundles it (esbuild; pdf-lib, fontkit, bwip-js, fflate and bidi-js are the package's dependencies, not inside it).
// Run npm run build:packages first.
// Checks: the report renders, nothing asks for /api/*, nothing 404s, each font is fetched once, no IBM Plex UI fonts.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://static.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-static-'));
fs.mkdirSync(path.join(tmp, 'node_modules/@pagewrightjs'), { recursive: true });
fs.symlinkSync(path.join(root, 'packages/viewer'), path.join(tmp, 'node_modules/@pagewrightjs/viewer')); // resolved through its exports
fs.writeFileSync(path.join(tmp, 'viewer.js'), "export { mountViewer } from '@pagewrightjs/viewer';");
fs.writeFileSync(path.join(tmp, 'designer.js'), "export { mountDesigner } from '@pagewrightjs/viewer/designer';");
await build({ entryPoints: [path.join(tmp, 'viewer.js'), path.join(tmp, 'designer.js')], bundle: true, format: 'esm', splitting: true, outdir: path.join(tmp, 'out'),
  nodePaths: [path.join(tmp, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
const FILES = { '/pw/': path.join(tmp, 'out/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/'), '/pw-public/': path.join(root, 'packages/fonts/public/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.icc': 'application/octet-stream', '.map': 'application/json' };
const definition = {
  $schema: 'pagewright/report@1', name: 'Standalone', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
    { type: 'barcode', name: 'B', x: 0, y: 60, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' }] } },
};
const data = { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] } };
const html = `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module">
import { mountViewer } from '/pw/viewer.js';
mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: ${JSON.stringify(data)}, fontsUrl: '/pw-fonts/' });
</script>`;

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [], requests = [], missing = [];
p.on('pageerror', e => errs.push(e.message));
await p.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  requests.push(u.pathname);
  if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) { missing.push(u.pathname); return route.fulfill({ status: 404, body: 'not found' }); }
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
});
await p.goto(`${ORIGIN}/`);
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 30000 });
const text = await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' '));
assert.match(text, /Asha Rao/);
assert.match(text, /1,200\.50/);
assert.deepEqual(missing, [], `404s: ${missing}`);
assert.deepEqual(requests.filter(r => r.startsWith('/api/')), []);
assert.deepEqual(requests.filter(r => r.includes('/ui/')), []); // no IBM Plex interface fonts
const fonts = requests.filter(r => r.startsWith('/pw-fonts/'));
assert.ok(fonts.includes('/pw-fonts/Inter-Regular.ttf'), fonts.join());
assert.equal(fonts.length, new Set(fonts).size, `a font fetched twice: ${fonts}`);
// the exports run in the browser on the package's dependencies: PDF (pdf-lib, fontkit), Excel (fflate)
const download = async (testid) => {
  if (!(await p.getByTestId(`export-${testid}`).isVisible())) await p.getByTestId('export-menu').click();
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.getByTestId(`export-${testid}`).click()]);
  return fs.readFileSync(await d.path());
};
assert.equal((await download('pdf')).subarray(0, 5).toString(), '%PDF-');
assert.equal((await download('xlsx')).subarray(0, 2).toString(), 'PK');
assert.ok(await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage path')].some(e => (e.getAttribute('d') || '').length > 200)), 'the barcode (bwip-js) is drawn');
assert.deepEqual(errs, []);

// the designer, standalone: no /api calls, no Save button (no server, no onSave), Open… only with onOpen
requests.length = 0; missing.length = 0;
const designerHtml = `<!doctype html><meta charset="utf-8"><div id="d"></div><script type="module">
import { mountDesigner } from '/pw/designer.js';
mountDesigner('#d', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/' });
</script>`;
await p.route(`${ORIGIN}/designer`, (route) => route.fulfill({ body: designerHtml, contentType: 'text/html' }));
await p.goto(`${ORIGIN}/designer`);
await p.waitForFunction(() => document.querySelector('#d')?.shadowRoot?.querySelector('[data-rail]'), null, { timeout: 30000 });
await p.waitForTimeout(1500);
assert.equal(await p.evaluate(() => !!document.querySelector('#d').shadowRoot.querySelector('[data-testid="save"]')), false);
assert.deepEqual(requests.filter(r => r.startsWith('/api/')), []);
assert.deepEqual(missing, [], `designer 404s: ${missing}`);
assert.deepEqual(errs, []);
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`standalone viewer: OK (${requests.length} requests, ${fonts.length} fonts, no server)`);
