// The embedded Designer under a strict Content-Security-Policy (style-src 'self', no 'unsafe-inline'): it must mount,
// draw its canvas and chart gallery, and log no CSP violation. Playwright answers every request from disk and sends
// the CSP header. Run npm run build:embed first (it serves public/embed/esm).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://csp-designer.test';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'";
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'reportwright/report@1', name: 'Strict CSP designer', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows', fields: [{ name: 'customer', type: 'string' }, { name: 'amount', type: 'number' }] }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }] } },
};
const pages = {
  '/': `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><div id="r"></div><script type="module" src="/app.js"></script>`,
  '/app.js': `import { mountDesigner } from '/pw/designer.js';
mountDesigner('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px' });`,
};
const TYPES_OF = (p) => TYPES[path.extname(p)] || 'application/octet-stream';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [], violations = [], missing = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', (m) => {
  if (/Content Security Policy|violates the following/i.test(m.text())) violations.push(m.text());
  if (m.type() === 'error' && /Failed to load resource|404/.test(m.text())) missing.push(m.text());
});
await page.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  const headers = { 'content-security-policy': CSP };
  if (pages[u.pathname]) return route.fulfill({ body: pages[u.pathname], contentType: u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html', headers });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) { missing.push(u.pathname); return route.fulfill({ status: 404, body: 'not found', headers }); }
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES_OF(f), headers });
});
await page.goto(`${ORIGIN}/`);
await page.waitForSelector('[data-tool="chart"]', { timeout: 90000 }); // the Designer has mounted
// the chart gallery draws its thumbnails (SVG with style attributes)
await page.locator('[data-tool="chart"]').click();
await page.waitForSelector('[data-chart-type] svg', { timeout: 90000 });
assert.deepEqual(violations, [], `CSP violations:\n${violations.join('\n')}`);
assert.deepEqual(errors, []);
assert.deepEqual(missing, []);
await browser.close();
console.log('b6k-designer-csp: ok');
