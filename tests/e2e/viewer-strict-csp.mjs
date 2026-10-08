// The embedded viewer under a strict Content-Security-Policy (style-src 'self', no 'unsafe-inline'): it must still be
// styled, lay out the report, and log no CSP violation. Playwright answers every request from disk and sends the CSP header.
// Run npm run build:embed first (it serves public/embed/esm).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://csp.test';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'";
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'pagewright/report@1', name: 'Strict CSP', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
    { type: 'barcode', name: 'B', x: 0, y: 60, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' }] } },
};
const data = { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] } };
const pages = {
  '/': `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><div id="r"></div><script type="module" src="/app.js"></script>`,
  '/app.js': `import { mountViewer } from '/pw/viewer.js';
mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: ${JSON.stringify(data)}, fontsUrl: '/pw-fonts/' });`,
};

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [], violations = [], missing = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) violations.push(m.text()); });
await page.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  const headers = { 'content-security-policy': CSP };
  if (pages[u.pathname]) return route.fulfill({ body: pages[u.pathname], contentType: TYPES[path.extname(u.pathname)] || 'text/html', headers });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = u.pathname === '/harfbuzz-subset.wasm' ? path.join(root, 'packages/fonts/public/harfbuzz-subset.wasm') // the PDF subsetter, beside the fonts folder
    : pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) { missing.push(u.pathname); return route.fulfill({ status: 404, body: 'not found', headers }); }
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream', headers });
});
page.on('console', m => { if (m.type() === 'error' && /Failed to load resource|404/.test(m.text())) missing.push(m.text()); });
await page.goto(`${ORIGIN}/`);
await page.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 60000 });

// styled: the viewer's own stylesheet applies (a border radius and a font the CSS sets), not the browser defaults
const styled = await page.evaluate(() => {
  const box = document.querySelector('#r').shadowRoot.querySelector('.pw-embed');
  const cs = getComputedStyle(box);
  return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, height: cs.height };
});
assert.equal(styled.radius, '8px', `viewer unstyled: ${JSON.stringify(styled)}`);
assert.equal(styled.border, '1px', `viewer unstyled: ${JSON.stringify(styled)}`);
assert.equal(styled.height, '720px', 'the height option is applied (set through CSSOM)');
const text = await page.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' '));
assert.match(text, /Asha Rao/);
// PDF export (a download from a blob: URL) under the same policy
if (!(await page.getByTestId('export-pdf').isVisible())) await page.getByTestId('export-menu').click();
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('export-pdf').click()]);
assert.match(fs.readFileSync(await dl.path()).subarray(0, 5).toString(), /%PDF-/);
assert.deepEqual(violations, [], `CSP violations:\n${violations.join('\n')}`);
assert.deepEqual(errors, []);
assert.deepEqual(missing, []);
await browser.close();
console.log('viewer-strict-csp: ok');
