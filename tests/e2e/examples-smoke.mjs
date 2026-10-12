// Smoke test for the Migration examples page, run in CI on the built site (dist-site/):
//   node tests/e2e/examples-smoke.mjs          (DIST=dist-site by default)
// Serves dist-site over HTTP, then checks the page against site/examples/index.json, the same file the page reads.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DIST = path.resolve(process.env.DIST || 'dist-site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '') || '/index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const index = JSON.parse(fs.readFileSync(path.join(DIST, 'examples', 'index.json'), 'utf8'));
const total = index.examples.length;
const countText = (n, m) => `${n} of ${m} reports shown.`;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

// 1. the page, the coverage table and the card count
await p.goto(`${BASE}/examples.html`);
await p.locator('#cards > li.card').first().waitFor({ timeout: 20000 });
assert.equal(await p.locator('#cards > li.card').count(), total, 'card count equals index.json');
assert.equal(await p.locator('#count').innerText(), countText(total, total));
const rows = await p.locator('#coverage tbody tr').count();
assert.equal(rows, index.categories.filter(c => c.id !== 'drill').length, 'one coverage row per category');
const firstCell = await p.locator('#coverage tbody tr').first().locator('td.cov').first().innerText();
const expectSym = index.coverage[index.categories[0].id].ssrs.symbol;
assert.ok(firstCell.includes(expectSym), `first coverage cell shows ${expectSym}`);
console.log(`· coverage: ${rows} rows, ${total} cards`);

// 2. a source filter changes the cards to that tool's examples
const ssrs = index.examples.filter(e => e.slug === 'ssrs').length;
await p.locator('#f-tool button', { hasText: 'SSRS' }).click();
await p.waitForFunction((t) => document.querySelector('#count').textContent.startsWith(`${t} of`), total);
assert.equal(await p.locator('#cards > li.card').count(), ssrs, 'SSRS filter count');
assert.equal(await p.locator('#count').innerText(), countText(ssrs, total));
await p.locator('#f-tool button', { hasText: 'All' }).click();

// 3. a category filter, then both at once
const chartsCat = index.categories.find(c => c.id === 'charts');
const chartsExpected = index.examples.filter(e => e.categories.some(c => c.id === 'charts')).length;
await p.locator('#f-cat button', { hasText: chartsCat.label }).click();
assert.equal(await p.locator('#cards > li.card').count(), chartsExpected, 'Charts filter count');
const jrCharts = index.examples.filter(e => e.slug === 'jasperreports' && e.categories.some(c => c.id === 'charts')).length;
await p.locator('#f-tool button', { hasText: 'JasperReports' }).click();
assert.equal(await p.locator('#cards > li.card').count(), jrCharts, 'JasperReports + Charts count');
await p.locator('#f-tool button', { hasText: 'All' }).click();
await p.locator('#f-cat button', { hasText: 'All' }).click();
assert.equal(await p.locator('#cards > li.card').count(), total);

// 4. the LGPL notice is on every JasperReports card
const jr = p.locator('#cards > li.card', { has: p.locator('.tool', { hasText: 'JasperReports' }) });
const jrCount = await jr.count();
assert.ok(jrCount > 0);
for (let i = 0; i < jrCount; i++) assert.match(await jr.nth(i).innerText(), /LGPL-3\.0/, 'Jasper card carries the LGPL notice');

// 5. a rendered example opens in the viewer and renders its pages, with no console errors
const rendered = index.examples.find(e => e.render === 'rendered');
const rc = p.locator('#cards > li.card', { has: p.locator('h3', { hasText: rendered.title }) }).first();
await rc.getByRole('button', { name: 'Open in viewer' }).click();
await p.locator('#viewer-dlg[open]').waitFor({ timeout: 20000 });
await p.waitForFunction(() => (window.__viewer?.getPageCount?.() || 0) > 0, null, { timeout: 60000 });
const pages = await p.evaluate(() => window.__viewer.getPageCount());
assert.ok(pages >= 1, `viewer renders pages (${pages})`);
console.log(`· viewer: ${rendered.title} renders ${pages} page(s)`);
await p.locator('#viewer-close').click();

// 6. Open in designer loads the definition
const dc = p.locator('#cards > li.card', { has: p.locator('h3', { hasText: index.examples[0].title }) }).first();
await dc.getByRole('button', { name: 'Open in designer' }).click();
await p.waitForURL(/play\.html#r=/, { timeout: 20000 });
await p.waitForFunction(() => !!window.__designer, null, { timeout: 60000 });
const designerName = await p.evaluate(() => window.__designer.getDefinition().name);
assert.equal(designerName, index.examples[0].title, 'the designer has the definition');
console.log(`· designer loaded: ${designerName}`);
await p.goto(`${BASE}/examples.html`);
await p.locator('#cards > li.card').first().waitFor({ timeout: 20000 });

// 7. every "Download .pw.json" link resolves
const hrefs = await p.locator('#cards a[download]').evaluateAll(as => as.map(a => a.getAttribute('href')));
const shown = hrefs.filter(Boolean);
for (const h of shown) {
  const r = await fetch(new URL(h, `${BASE}/examples.html`));
  assert.equal(r.status, 200, `download ${h}`);
}
console.log(`· downloads: ${shown.length} links resolve`);

// no console errors anywhere on the path
assert.deepEqual(errors, [], 'no console or page errors');
await b.close();
server.close();
console.log('examples smoke OK');
