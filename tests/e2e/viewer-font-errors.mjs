// The embedded viewer when its fonts cannot be loaded: a visible message (not a blank page), and onReady reports the error.
// A page with the fonts at the right place: onReady(null) and the report draws. Run npm run build:embed first.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://fonts.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'reportwright/report@1', name: 'Fonts', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount' }] }] }] } },
};
const data = { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } };
const page = (fontsUrl) => `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/app-${fontsUrl === '/pw-fonts/' ? 'ok' : 'bad'}.js"></script>`;
const app = (fontsUrl) => `import { mountViewer } from '/pw/viewer.js';
const reported = new Promise((resolve) => mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: ${JSON.stringify(data)}, fontsUrl: '${fontsUrl}', onReady: (error) => resolve(error ? error.message : null) }));
window.ready = Promise.race([reported, new Promise((resolve) => setTimeout(() => resolve('onReady never called'), 30000))]);`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const pagesSeen = [];
await ctx.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  const send = (body, contentType, status = 200) => route.fulfill({ status, body, contentType });
  if (u.pathname === '/ok') return send(page('/pw-fonts/'), 'text/html');
  if (u.pathname === '/bad') return send(page('/no-fonts-here/'), 'text/html');
  if (u.pathname === '/app-ok.js') return send(app('/pw-fonts/'), 'text/javascript');
  if (u.pathname === '/app-bad.js') return send(app('/no-fonts-here/'), 'text/javascript');
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = u.pathname === '/harfbuzz-subset.wasm' ? path.join(root, 'packages/fonts/public/harfbuzz-subset.wasm') : pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) return send('not found', 'text/plain', 404);
  return send(fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
});

// fonts reachable: the report draws, onReady(null)
let p = await ctx.newPage();
await p.goto(`${ORIGIN}/ok`);
assert.equal(await p.evaluate(() => window.ready), null, 'onReady with no error');
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 60000 });
await p.close();

// fonts not reachable: onReady reports the error, and the viewer shows the message (not an empty page)
p = await ctx.newPage();
await p.goto(`${ORIGIN}/bad`);
const reported = await p.evaluate(() => window.ready);
assert.match(String(reported), /did not load/, `onReady should report the font error, got ${reported}`);
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vmsg.error'), null, { timeout: 60000 });
const msg = await p.evaluate(() => document.querySelector('#r').shadowRoot.querySelector('.vmsg.error').textContent);
assert.match(msg, /font/i, `the visible message names the fonts: ${msg}`);
await browser.close();
console.log('viewer-font-errors: ok');
