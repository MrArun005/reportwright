// Accessibility names in the embedded Designer and viewer (#15, #39): section headings of the Inspector are real
// buttons (Enter toggles them), chart-gallery radios are named by the chart type only, and the viewer's export items
// are named by the format ("PDF document"), with the format badge hidden from screen readers.
// Run npm run build:embed first (it serves public/embed/esm).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://a11y.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'pagewright/report@1', name: 'A11y', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows', fields: [{ name: 'customer', type: 'string' }, { name: 'amount', type: 'number' }] }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }] } },
};
const pages = {
  '/designer': `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/designer.js"></script>`,
  '/designer.js': `import { mountDesigner } from '/pw/designer.js';
mountDesigner('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px' });`,
  '/viewer': `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module" src="/viewer.js"></script>`,
  '/viewer.js': `import { mountViewer } from '/pw/viewer.js';
mountViewer('#r', { definition: ${JSON.stringify(definition)}, data: { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }, fontsUrl: '/pw-fonts/' });`,
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  if (pages[u.pathname]) return route.fulfill({ body: pages[u.pathname], contentType: TYPES[path.extname(u.pathname)] || 'text/html' });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
});

console.log('· designer');
// 1. Inspector headings: each is a button in an h5 (no role on the heading), Enter collapses the section
await page.goto(`${ORIGIN}/designer`);
await page.waitForSelector('.cat > h5', { timeout: 60000 }); // pierces the shadow root
const heads = await page.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.cat > h5')].map(h => ({ role: h.getAttribute('role'), button: !!h.querySelector(':scope > button') })));
assert.ok(heads.length > 0, 'the Inspector shows section headings');
assert.deepEqual(heads.filter(h => h.role || !h.button), [], `headings without a button, or with a role: ${JSON.stringify(heads)}`);
const first = page.locator('.cat > h5 > button').first();
const sectionName = await first.textContent();
await first.focus();
await page.keyboard.press('Enter');
const collapsed = await first.evaluate(b => b.closest('.cat').hasAttribute('data-collapsed'));
assert.equal(collapsed, true, `Enter collapses "${sectionName}"`);
assert.equal(await first.getAttribute('aria-expanded'), 'false');
await page.keyboard.press('Enter');
assert.equal(await first.evaluate(b => b.closest('.cat').hasAttribute('data-collapsed')), false, 'Enter opens it again');

console.log('· chart gallery');
// 2. Chart gallery radios are named by the chart type only
await page.locator('[data-tool="chart"]').click();
await page.waitForSelector('[data-chart-type]', { timeout: 60000 }); // pierces the shadow root
const radios = await page.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('[data-chart-type]')].map(b => ({
  type: b.dataset.chartType, label: b.getAttribute('aria-label'), name: b.querySelector('.cw-name')?.childNodes[0]?.textContent.trim(),
})));
assert.ok(radios.length > 3, 'the gallery lists chart types');
for (const r of radios) assert.equal(r.label, r.name, `radio ${r.type} is named "${r.name}", got ${r.label}`);
await page.keyboard.press('Escape');

console.log('· viewer');
// 3. Viewer export items: the format name, the badge hidden
await page.goto(`${ORIGIN}/viewer`);
await page.waitForSelector('#r', { timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage'), null, { timeout: 60000 }).catch(async (e) => { console.log('viewer:', (await page.evaluate(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vmsg, .err, [class*=status]')?.textContent)), errors); throw e; });
if (!(await page.getByTestId('export-pdf').isVisible().catch(() => false))) await page.getByTestId('export-menu').click();
const pdf = await page.getByTestId('export-pdf').evaluate(b => ({ label: b.getAttribute('aria-label'), badgeHidden: b.querySelector('.fmt-badge')?.getAttribute('aria-hidden') }));
assert.deepEqual(pdf, { label: 'PDF document', badgeHidden: 'true' });
assert.deepEqual(errors, []);
await browser.close();
console.log('b6k-designer-a11y: ok');
