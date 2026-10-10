// Phase 4: build a pivot (nested rows, columns, a value, totals) in the designer, then drill down in the viewer,
// and add a landscape body section.
//   BASE=http://localhost:3400 node tests/e2e/tablix.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
const showcase = JSON.parse(fs.readFileSync(new URL('../../reports/tablix-showcase.pw.json', import.meta.url), 'utf8'));

const create = async (name, definition) => {
  const res = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ name, definition }) });
  assert.ok(res.ok, `create ${name}`);
  return (await res.json()).id;
};
// a blank report with the showcase's sales data
const blank = { ...showcase, name: 'e2e pivot', dataSets: showcase.dataSets.slice(0, 1), sections: { pageHeader: { height: 0, items: [] }, body: { height: 300, items: [] }, pageFooter: { height: 0, items: [] } } };
const designId = await create('e2e pivot', blank);
const viewId = await create('e2e tablix showcase', showcase);

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

step('designer: insert a matrix and build Region › City × Year with totals');
await p.goto(`${BASE}/designer/${designId}`);
await p.waitForSelector('[data-testid=paper]');
await p.locator('[data-tool=matrix]').click();
await p.getByRole('button', { name: 'Insert an empty matrix' }).click();
await p.waitForSelector('[data-item=Matrix1]');
const insp = p.locator('[data-testid=inspector]');
await insp.getByLabel('Data set').selectOption('Sales');
for (const [list, field] of [['rowGroups', 'region'], ['rowGroups', 'city'], ['columnGroups', 'year'], ['values', 'amount']]) {
  await p.getByTestId(`pivot-pick-${list}`).selectOption(field);
  await p.getByTestId(`pivot-add-${list}`).click();
}
// the old single-group defaults became the first entries: remove them, keep ours
for (const list of ['pivot-rowGroups', 'pivot-columnGroups', 'pivot-values']) await p.getByTestId(list).locator('.group-card').first().getByRole('button', { name: 'Remove' }).click();
const regionCard = p.getByTestId('pivot-rowGroups').locator('.group-card').first();
await regionCard.getByLabel('Total').selectOption('after');
await regionCard.getByText('Drill-down: show a toggle').click();
await p.getByTestId('pivot-columnGroups').locator('.group-card').first().getByLabel('Total').selectOption('after');
await p.waitForFunction(() => {
  const t = [...document.querySelectorAll('[data-item=Matrix1] .live svg text')].map(n => n.textContent);
  return t.includes('Delhi') && t.includes('1,000') && t.includes('▼ North');
}, null, { timeout: 20000 }).catch(async (e) => { // what the matrix drew instead, for the CI artifact
  fs.mkdirSync('/tmp/shots', { recursive: true });
  await p.screenshot({ path: '/tmp/shots/tablix-fail.png', fullPage: true });
  console.log('matrix text:', await p.evaluate(() => [...document.querySelectorAll('[data-item=Matrix1] .live svg text')].map(n => n.textContent)), 'errors:', errs);
  throw e;
});

step('designer preview shows the pivot with its totals');
await p.getByTestId('tab-preview').click();
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(n => n.textContent === '1,000'), null, { timeout: 20000 });

step('designer: add a landscape body section');
await p.getByRole('button', { name: 'Design', exact: true }).click();
await p.waitForSelector('[data-testid=paper]');
await p.locator('.band-label', { hasText: 'Body' }).click();
await p.getByTestId('add-body-section').click();
await p.waitForSelector('[data-section="body:1"]');
await insp.getByLabel('Orientation of this section').selectOption('landscape');
const wide = await p.locator('[data-section="body:1"]').boundingBox(), narrow = await p.locator('[data-section=body]').boundingBox();
assert.ok(wide.width > narrow.width * 1.3, `the landscape band is wider (${wide.width} vs ${narrow.width})`);

step('viewer: collapse a region of the showcase pivot');
const texts = () => p.evaluate(() => [...document.querySelectorAll('.vpage text')].map(n => n.textContent));
await p.goto(`${BASE}/viewer/${viewId}`);
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(n => n.textContent === '▼ North'), null, { timeout: 20000 });
const delhi = (t) => t.filter(x => x === 'Delhi').length; // Delhi is also a branch in the officers table
const before = delhi(await texts());
await p.locator('.vlink.hit[title*="Show or hide details"]').first().click();
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(n => n.textContent === '▶ North'), null, { timeout: 20000 });
const t = await texts();
assert.equal(delhi(t), before - 1, 'North collapsed: its cities are hidden');
const i = t.indexOf('▶ North');
assert.deepEqual(t.slice(i, i + 3), ['▶ North', '200', '46.5%']);
assert.ok(t.includes('Chennai'), 'South stays open');
assert.ok(t.includes('Jan 25') && t.includes('Region'), 'the wide pivot is drawn');
await b.close();
console.log('errors:', errs.length ? errs : 'none');
assert.deepEqual(errs, []);
console.log('PASS tablix');
