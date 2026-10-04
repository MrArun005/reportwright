// Phase 5 charts: the new chart types and options in the designer (live canvas, chart gallery, Inspector editors)
// and in the viewer (every chart draws, animations, tooltips), plus the PDF the server makes.
//   BASE=http://localhost:3500 node tests/e2e/charts-p5.mjs
// Screenshots go to /tmp/shots/charts-*.png and the PDF to /tmp/shots/charts-showcase.pdf. Nothing is saved.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const live = (name, sel) => p.locator(`[data-item=${name}] .live svg ${sel}`).count();

/* ---------------- designer ---------------- */
step('designer draws every new chart type live');
await p.goto(`${BASE}/designer/charts-showcase`);
await p.waitForSelector('[data-testid=paper]');
await p.waitForSelector('[data-item=Combo] .live svg rect', { timeout: 30000 });
assert.ok(await live('Combo', 'rect') >= 6, 'combo columns');
for (const [name, sel, min] of [['Radar', 'path', 3], ['Wind', 'ellipse', 8], ['Gauge', 'path', 4], ['Candles', 'rect', 8], ['Ohlc', 'line', 24], ['Funnel', 'path', 4], ['Bubbles', 'ellipse', 5], ['Percent', 'rect', 12]]) {
  await p.waitForFunction(([n, s, m]) => document.querySelectorAll(`[data-item=${n}] .live svg ${s}`).length >= m, [name, sel, min], { timeout: 15000 });
}
await p.screenshot({ path: '/tmp/shots/charts-designer.png' });

step('Inspector: combo series, secondary axis, overlays');
await p.locator('[data-item=Combo]').click({ position: { x: 20, y: 10 } });
const insp = p.locator('[data-testid=inspector]');
await insp.getByTestId('series-1').waitFor();
assert.equal(await insp.getByTestId('series-1').getByLabel('Series type').inputValue(), 'line');
assert.equal(await insp.getByTestId('series-1').getByLabel('Series axis').inputValue(), 'secondary');
await insp.getByTestId('axis-y2').waitFor();
assert.equal(await insp.getByLabel('Secondary value axis format').inputValue(), 'P0');
// turn the margin line into columns: the canvas redraws with more rects
const before = await live('Combo', 'rect');
await insp.getByTestId('series-1').getByLabel('Series type').selectOption('column');
await p.waitForFunction((n) => document.querySelectorAll('[data-item=Combo] .live svg rect').length > n, before);
// an overlay band on the Units chart
await p.locator('[data-item=Units]').click({ position: { x: 20, y: 10 } });
const lines = await live('Units', 'path');
await insp.getByTestId('add-overlay').click();
await p.waitForFunction((n) => document.querySelectorAll('[data-item=Units] .live svg path').length > n, lines);
await insp.getByTestId('overlay-2').getByLabel('Overlay type').selectOption('band');
await insp.getByTestId('overlay-2').locator('.field', { hasText: 'From' }).locator('input').fill('50');
await insp.getByTestId('overlay-2').locator('.field', { hasText: 'To' }).locator('input').fill('70');
// a band is drawn translucent (alpha 0x26 = 0.149)
await p.waitForFunction(() => [...document.querySelectorAll('[data-item=Units] .live svg rect')].some(r => /,0\.149/.test(r.getAttribute('fill') || '')));
// the OHLC chart becomes a candlestick chart: candle bodies appear
await p.locator('[data-item=Ohlc]').click({ position: { x: 20, y: 10 } });
await insp.getByLabel('Chart type').selectOption('candlestick');
await p.waitForFunction(() => document.querySelectorAll('[data-item=Ohlc] .live svg rect').length >= 8);
// stacking select
await p.locator('[data-item=Percent]').click({ position: { x: 20, y: 10 } });
assert.equal(await insp.getByLabel('Stacking').inputValue(), 'percent');

step('chart gallery: radar, funnel, gauge and bubble');
await p.dragAndDrop('[data-tool=chart]', '[data-section=body]', { targetPosition: { x: 400, y: 30 } });
await p.waitForSelector('.cw');
const side = p.locator('.cw-side');
// bubble: a number x axis plus a size field
await side.locator('.field', { hasText: 'Data set' }).locator('select').selectOption('Ads');
await side.locator('.field', { hasText: 'Category' }).locator('select').selectOption('spend');
await p.locator('[data-chart-type=bubble]').click();
await side.locator('.field', { hasText: 'Bubble size' }).locator('select').selectOption('customers');
await p.waitForFunction(() => document.querySelectorAll('.cw-big svg ellipse').length >= 5);
await side.locator('.field', { hasText: 'Data set' }).locator('select').selectOption('Skills');
await side.locator('.field', { hasText: 'Category' }).locator('select').selectOption('skill');
for (const ty of ['radar', 'funnel', 'gauge']) {
  await p.waitForSelector(`[data-chart-type=${ty}] .cw-thumb svg path`, { timeout: 20000 });
}
await p.locator('[data-chart-type=radar]').click();
await p.waitForFunction(() => [...document.querySelectorAll('.cw-big svg path')].some(x => /Z$/.test(x.getAttribute('d') || '')));
await p.screenshot({ path: '/tmp/shots/charts-gallery.png' });
await p.getByTestId('chart-wizard-apply').click();
await p.waitForSelector('[data-item=Chart1] .live svg path');
assert.equal(await insp.getByLabel('Chart type').inputValue(), 'radar');

step('preview animates the combo chart');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
await p.waitForSelector('.vpage svg g.pw-a-growY', { timeout: 30000 });

/* ---------------- viewer ---------------- */
step('viewer: every chart, labels, tooltips, animations');
await p.goto(`${BASE}/viewer/charts-showcase`);
await p.waitForSelector('.vpage svg', { timeout: 60000 });
await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'));
const texts = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
for (const s of ['Average 150', '60%', '40%', '80%', '20%', '31,000 ★', 'Leads: 1,000', 'Won: 120', '72', 'D8', '315°']) assert.ok(texts.includes(s), `viewer shows ${s}`);
assert.ok(await p.locator('.vpage svg g.pw-a-growY').count() >= 6, 'combo columns grow in');
const tips = await p.$$eval('.vpage title', ns => ns.map(n => n.textContent));
assert.ok(tips.includes('D1: open 100, high 106, low 98, close 104'), 'candle tooltip');
assert.ok(tips.some(t => t.startsWith('Jan · North: 60 (60%)')), '100% stack tooltip');
await p.waitForTimeout(900); // let the entrance animation finish before the screenshot
const pages = p.locator('.vpage');
for (let i = 0; i < await pages.count(); i++) { await pages.nth(i).scrollIntoViewIfNeeded(); await p.waitForTimeout(700); await pages.nth(i).screenshot({ path: `/tmp/shots/charts-viewer-${i + 1}.png` }); }

step('PDF from the server');
const res = await p.request.get(`${BASE}/api/reports/charts-showcase/pdf`);
assert.equal(res.status(), 200);
const pdf = await res.body();
assert.ok(pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 20000, 'a PDF');
fs.writeFileSync('/tmp/shots/charts-showcase.pdf', pdf);

await b.close();
console.log('errors:', errs.length ? errs : 'none');
assert.deepEqual(errs, []);
console.log('PASS charts p5');
