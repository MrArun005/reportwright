// Phase 2/3 viewer features on the sales sample: cascading multi-value params, drill-down,
// interactive sort, document map, search, exports. Plus designer groups and lists.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const texts = () => p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
const step = (s) => console.log('·', s);

step('viewer: grouped report');
await p.goto(`${BASE}/viewer/sales-by-region`);
await p.waitForSelector('.vpage');
let t = await texts();
assert.ok(t.includes('▶ Bengaluru'), 'cities start collapsed');
assert.ok(!t.some(s => s === 'Home loans'), 'products hidden');

step('drill-down toggle');
await p.locator('.pw-link').filter({ has: p.locator('title', { hasText: 'Show or hide details' }) }).first().click();
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(n => n.textContent === 'Home loans'));
t = await texts();
assert.ok(t.some(s => s.startsWith('▼ ')), 'one city open');

step('interactive sort');
await p.locator('.pw-link').filter({ has: p.locator('title', { hasText: 'Sort' }) }).first().click();
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(n => /↑|↓/.test(n.textContent)));

step('document map');
await p.getByRole('button', { name: 'Document map' }).click();
const map = await p.locator('.vside button').allInnerTexts();
assert.equal(map.length, 4);

step('search');
await p.getByLabel('Search').fill('Pune');
await p.waitForSelector('.hl');
assert.ok(await p.locator('.hl').count() >= 1);
await p.getByLabel('Search').fill('');

step('cascading multi-value parameter');
await p.getByRole('button', { name: 'Parameters' }).click();
await p.getByLabel('South').check();
await p.getByLabel('West').check();
await p.getByRole('button', { name: 'View report' }).click();
await p.waitForFunction(() => { const t = [...document.querySelectorAll('.vpage text')].map(n => n.textContent); return t.includes('South') && !t.includes('North'); });
await p.screenshot({ path: '/tmp/shots/sales-viewer.png' });

step('exports');
for (const f of ['xlsx', 'html', 'csv']) {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId(`export-${f}`).click()]);
  await dl.saveAs(`/tmp/sales.${f}`);
}

step('designer: group rows and a list');
await p.goto(`${BASE}/designer/sales-by-region`);
await p.waitForSelector('[data-testid=paper]');
assert.ok(await p.locator('.row-tag', { hasText: 'G3' }).count() === 1, 'third group row shown');
await p.dragAndDrop('[data-tool=list]', '[data-section=body]', { targetPosition: { x: 20, y: 300 } });
await p.waitForSelector('[data-item=List1]');
await p.locator('[data-testid=inspector]').getByLabel('Data set').selectOption('Regions');
await p.dragAndDrop('.field-chip:has(.nm:text-is("name"))', '[data-item=List1] .nest', { targetPosition: { x: 10, y: 10 } });
assert.equal(await p.locator('[data-item=List1] .nest [data-item]').count(), 1, 'field dropped into the list');
await p.screenshot({ path: '/tmp/shots/sales-designer.png' });
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
t = await texts();
for (const r of ['East', 'North', 'South', 'West']) assert.ok(t.filter(s => s === r).length >= 2, `list row for ${r}`);

await b.close();
console.log('errors:', errs.length ? errs : 'none');
assert.deepEqual(errs, []);
console.log('PASS phase 2');
