// The three-level drill-down (sales-explorer → sales-city → sales-month → sales-city) in the viewer:
// chart click-to-focus and clear, expand/collapse, sorting groups by totals, drill-through, breadcrumbs, Back and exports.
//   BASE=http://localhost:3200 node tests/e2e/drilldown.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const texts = () => p.evaluate(() => [...document.querySelectorAll('.vpage text')].map(n => n.textContent));
const hasText = (re) => p.waitForFunction((src) => [...document.querySelectorAll('.vpage text')].some(n => new RegExp(src).test(n.textContent)), re.source, { timeout: 20000 });
// a box-shaped spot is clicked on its accessible control (title = the tooltip); a pie slice on the drawing
const links = (title) => p.locator(`.vlink.hit[title*=${JSON.stringify(title)}]`).or(p.locator('svg path.pw-link').filter({ has: p.locator('title', { hasText: title }) }));
const link = (title) => links(title).first();
const crumbs = () => p.locator('nav.vcrumbs li').allTextContents();
// regions in table order: the region names after the table header
const regionOrder = async () => { const t = await texts(); return t.slice(t.indexOf('Ticket ₹ L')).map(s => s.replace(/^[▼▶]\s*/, '')).filter(s => ['North', 'South', 'East', 'West'].includes(s)); };

step('level 1 renders with KPIs, charts, heat map and the grouped table');
await p.goto(`${BASE}/viewer/sales-explorer`);
await p.waitForSelector('.vpage');
await hasText(/^Cum\. share$/);
assert.deepEqual(await regionOrder(), ['North', 'East', 'South', 'West'], 'regions start ordered by total, largest first');
assert.ok(!(await texts()).some(t => /Clear focus/.test(t)), 'no clear link without a focus');

step('click a bar to focus a region, a slice to focus a product, then clear');
await link('South').click();
await hasText(/focus: South/);
assert.deepEqual(await regionOrder(), ['South']);
await link('Home loans').dispatchEvent('click'); // a donut slice's box centre is in the hole
await hasText(/product: Home loans/);
await link('Show every region and product again').click();
await hasText(/focus: none · product: all/);
assert.equal((await regionOrder()).length, 4);

step('expand a city to its products');
const gold = async () => (await texts()).filter(t => t === 'Gold loans').length;
const before = await gold();
await links('Show or hide details').nth(1).click(); // [0] is North, [1] its top city
await p.waitForFunction((n) => [...document.querySelectorAll('.vpage text')].filter(t => t.textContent === 'Gold loans').length > n, before);

step('sort by ₹ crore: the regions reorder by their totals');
await links('Sort').nth(3).click();
await hasText(/₹ crore ↑/);
assert.deepEqual(await regionOrder(), ['West', 'South', 'East', 'North']);
await links('Sort').nth(3).click();
await hasText(/₹ crore ↓/);
assert.deepEqual(await regionOrder(), ['North', 'East', 'South', 'West']);

step('drill through to a city');
await link('Open Jaipur month by month').click();
await hasText(/^Jaipur$/);
await hasText(/North region · all products · all months/);
assert.deepEqual(await crumbs(), ['Sales explorer', 'City detail · Jaipur']);

step('level 2: click a month column to filter the table, then clear it');
await link('Mar').dispatchEvent('click'); // stacked: the column's own link sits over its segments, same action
await hasText(/· March ·/);
await link('Filter the report').click(); // the "All months" link
await hasText(/all months/);

step('drill through a month to every city, then into another city');
await link('How every city did in January').click();
await hasText(/January 2026: every city/);
await hasText(/Jaipur highlighted/);
await link('Open Pune').click();
await p.locator('nav.vcrumbs li', { hasText: 'City detail · Pune' }).waitFor();
await hasText(/West region/);
assert.deepEqual(await crumbs(), ['Sales explorer', 'City detail · Jaipur', 'Month ranking · 1', 'City detail · Pune']);

step('Back through the breadcrumb keeps the sort and the expanded city');
await p.locator('nav.vcrumbs button', { hasText: 'Sales explorer' }).click();
await hasText(/₹ crore ↓/);
assert.ok((await gold()) > before, 'the expanded city is still open');

step('exports of the current view');
for (const f of ['pdf', 'docx', 'xlsx']) {
  if (!(await p.getByTestId(`export-${f}`).isVisible())) await p.getByTestId('export-menu').click(); // the formats are in the Export menu
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId(`export-${f}`).click()]);
  const file = `/tmp/drilldown.${f}`;
  await dl.saveAs(file);
  const head = (await import('node:fs')).readFileSync(file).subarray(0, 4).toString('latin1');
  assert.ok(f === 'pdf' ? head === '%PDF' : head.startsWith('PK'), `${f} is a real file`);
}
await p.screenshot({ path: '/tmp/drilldown.png', fullPage: false });

await b.close();
assert.deepEqual(errs, []);
console.log('PASS drilldown');
