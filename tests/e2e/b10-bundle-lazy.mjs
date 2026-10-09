// B10 A1.6: the embedded viewer loads the engine, charts, barcodes and the Office exporters on first use. Each lazily
// loaded feature works the first time it is used: a chart and a barcode drawn by the render worker (bwip-js from
// engine.worker.bwip.js, next to the worker), PDF, Excel, Word and PowerPoint exports (the engine loads on the main
// thread then), and a worker copied without its bwip-js file (the report renders on the main thread instead).
// Playwright answers every request from disk. Run node scripts/build-embed.mjs first (it serves public/embed/esm).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://lazy.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'reportwright/report@1', name: 'Lazy', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
    { type: 'textbox', name: 'H', x: 200, y: 60, w: 200, h: 20, value: 'Helvetica line', style: { fontFamily: 'Helvetica' } },
    { type: 'barcode', name: 'B', x: 0, y: 60, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' },
    { type: 'chart', name: 'C', x: 0, y: 130, w: 300, h: 180, dataSet: 'Rows', chartType: 'bar', category: '=Fields.customer', series: [{ value: '=Fields.amount', name: 'Amount' }] }] } },
};
const data = { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] } };
const app = `import { mountViewer } from '/pw/viewer.js';
window.v = mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: ${JSON.stringify(data)}, fontsUrl: '/pw-fonts/' });`;

const browser = await chromium.launch();
/** @param {{ hideBwip?: boolean }} o */
async function run({ hideBwip = false } = {}) {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const errors = [], asked = [], warnings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    asked.push(u.pathname);
    if (u.pathname === '/') return route.fulfill({ body: '<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/app.js"></script>', contentType: 'text/html' });
    if (u.pathname === '/app.js') return route.fulfill({ body: app, contentType: 'text/javascript' });
    const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
    const f = u.pathname === '/harfbuzz-subset.wasm' ? path.join(root, 'packages/fonts/public/harfbuzz-subset.wasm') : pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f) || (hideBwip && u.pathname.endsWith('engine.worker.bwip.js'))) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 60000 });
  const drawn = await page.evaluate(() => {
    const svg = document.querySelector('#r').shadowRoot.querySelector('.vpage svg');
    return { text: svg.textContent, longest: Math.max(0, ...[...svg.querySelectorAll('path')].map(p => (p.getAttribute('d') || '').length)) };
  });
  assert.match(drawn.text, /Asha Rao: 1,201/, 'the chart draws (its data labels)');
  assert.match(drawn.text, /Helvetica line/, 'a standard-14 font draws in the worker');
  assert.ok(drawn.longest > 300, `the barcode draws (its bars, one long path): ${JSON.stringify(drawn)}`);
  // nothing of the engine on the main thread yet: only the viewer and its static chunks, the worker and the fonts
  const lazyBefore = asked.filter(p => p.startsWith('/pw/chunk-')).length;
  const exports = await page.evaluate(async () => {
    const out = {};
    for (const f of ['pdf', 'xlsx', 'docx', 'pptx']) { const b = await window.v.export(f); out[f] = new TextDecoder().decode(new Uint8Array(await b.slice(0, 4).arrayBuffer())); }
    return out;
  });
  assert.equal(exports.pdf, '%PDF');
  for (const f of ['xlsx', 'docx', 'pptx']) assert.equal(exports[f], 'PK\u0003\u0004', `${f} is a zip`);
  assert.ok(asked.filter(p => p.startsWith('/pw/chunk-')).length > lazyBefore, 'the exporters loaded on demand');
  assert.deepEqual(errors, []);
  const usesWorker = await page.evaluate(() => window.v.usesWorker);
  await page.close();
  return { asked, usesWorker, warnings };
}

const normal = await run();
assert.ok(normal.asked.includes('/pw/engine.worker.js'));
assert.ok(normal.asked.includes('/pw/engine.worker.bwip.js'), 'the worker imported bwip-js for the barcode');
assert.equal(normal.usesWorker, true);
assert.ok(!normal.asked.some(u => u.includes('stdfonts')), 'the standard-font metrics are in the worker (N43), not a file of their own');
assert.ok(!normal.warnings.some(w => /not available/.test(w)), `no font substitution warning: ${normal.warnings}`);
const alone = await run({ hideBwip: true });
assert.ok(alone.warnings.some(w => /rendering on the main thread/.test(w)), `a warning says so: ${alone.warnings}`);
await browser.close();
console.log('b10-bundle-lazy: ok (worker + bwip file; worker without it renders on the main thread; 4 exports)');
