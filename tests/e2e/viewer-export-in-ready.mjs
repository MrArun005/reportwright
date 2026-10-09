// viewer.export() called synchronously inside a 'ready' listener (and inside onReady) exports the run that just
// finished: it used to reject with "the report has not run yet". Run npm run build:embed first.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://ready.test';
const definition = {
  $schema: 'reportwright/report@1', name: 'Ready', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount' }] }] }] } },
};
const app = `import { mountViewer } from '/pw/viewer.js';
const settle = (pr) => pr.then(b => b.text()).then(t => 'ok ' + t, e => 'error ' + e.message);
let fromOnReady;
const v = mountViewer('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', onReady: () => { fromOnReady = settle(v.export('csv')); } });
window.result = new Promise((resolve) => v.on('ready', () => { const e = settle(v.export('csv')); Promise.all([e, fromOnReady]).then(resolve); }));`;
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/') return route.fulfill({ body: '<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/app.js"></script>', contentType: 'text/html' });
  if (u.pathname === '/app.js') return route.fulfill({ body: app, contentType: 'text/javascript' });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
});
const p = await ctx.newPage();
await p.goto(`${ORIGIN}/`);
const [inListener, inOnReady] = await p.evaluate(() => window.result);
assert.match(inListener, /^ok .*Asha Rao/s, `export() inside the 'ready' listener: ${inListener}`);
assert.match(inOnReady, /^ok .*Asha Rao/s, `export() inside onReady: ${inOnReady}`);
await browser.close();
console.log('viewer-export-in-ready: ok');
