// Phase 3: charts, matrix, barcode and visuals in the designer (live preview) and the viewer.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(`${BASE}/designer/sales-dashboard`);
await p.waitForSelector('[data-testid=paper]');
await p.waitForSelector('[data-item=ByMonth] .live svg rect', { timeout: 20000 });
assert.ok(await p.locator('[data-item=ByMonth] .live svg rect').count() > 20, 'column chart drawn live');
assert.ok(await p.locator('[data-item=Pivot] .live svg text').count() > 10, 'matrix drawn live');
await p.screenshot({ path: '/tmp/shots/dash-designer.png' });

// add a pie chart from the toolbox and bind it
await p.dragAndDrop('[data-tool=chart]', '[data-section=body]', { targetPosition: { x: 300, y: 20 } });
// a report with data opens the chart gallery first; this test sets the chart up by hand
await p.getByRole('button', { name: 'Insert an empty chart' }).click();
await p.waitForSelector('[data-item=Chart1]');
const insp = p.locator('[data-testid=inspector]');
await insp.getByLabel('Chart type').selectOption('pie');
await insp.getByLabel('Data set').selectOption('Sales');
await insp.locator('.field', { hasText: 'Category (x axis / slices)' }).locator('input').fill('=Fields.region');
await insp.locator('.group-card input.mono').first().fill('=Sum(Fields.crore)');
await p.waitForFunction(() => document.querySelectorAll('[data-item=Chart1] .live svg path').length >= 4);

await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
const t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('Disbursed by month and region'));
assert.ok(t.includes('Home loans'));
await p.screenshot({ path: '/tmp/shots/dash-preview.png' });
await b.close();
console.log('errors:', errs.length ? errs : 'none');
assert.deepEqual(errs, []);
console.log('PASS phase 3');
