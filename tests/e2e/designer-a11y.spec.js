// axe-core (WCAG 2.1 A and AA rules) on the designer and the viewer, in several states: no serious or critical
// violation that is not in tests/e2e/a11y-baseline.json. A violation that is fixed must leave the baseline too (the
// test says so), so the list only shrinks. A11Y_UPDATE=1 writes the baseline from what axe finds now.
import { test, expect, bands, serve } from './designer-fixture.js';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE = path.join(import.meta.dirname, 'a11y-baseline.json');
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const found = {};
// axe reads the DOM and the computed styles, the same in every engine: one browser keeps one baseline
test.skip(({ browserName }) => browserName !== 'chromium', 'axe runs in Chromium');

/** Serious and critical violations: "rule: target" for each node. */
async function scan(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.flat(Infinity).join(' >> ')}`))
    .sort();
}
function check(name, got, browserName) {
  const key = `${browserName}: ${name}`;
  found[key] = got;
  if (process.env.A11Y_UPDATE === '1') return;
  const known = new Set(baseline[key] || []);
  expect(
    got.filter((v) => !known.has(v)),
    `${key}: new serious or critical violations`,
  ).toEqual([]);
  expect(
    [...known].filter((v) => !got.includes(v)),
    `${key}: fixed, take them out of a11y-baseline.json`,
  ).toEqual([]);
}
test.afterAll(() => {
  if (process.env.A11Y_UPDATE !== '1') return;
  const all = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(Object.fromEntries(Object.entries({ ...all, ...found }).sort()), null, 2) + '\n',
  );
});

test('designer: as opened', async ({ designer, browserName }) => {
  await designer.open();
  check('designer as opened', await scan(designer.page), browserName);
});
test('designer: an item selected, the inspector showing it', async ({ designer, browserName }) => {
  await designer.open();
  await designer.select('T1');
  check('designer with a selection', await scan(designer.page), browserName);
});
test('designer: the Issues list open', async ({ designer, browserName }) => {
  await designer.open();
  await designer.selectBand('body');
  await designer.insert('barcode');
  await designer.issues();
  check('designer with the issues list', await scan(designer.page), browserName);
});
test('designer: a data set dialog', async ({ designer, browserName }) => {
  await designer.open();
  await designer.root.locator('[data-testid=rail-data]').click();
  await designer.root.getByRole('button', { name: 'Edit D', exact: true }).click();
  await expect(designer.root.locator('.dialog[role=dialog]')).toBeVisible();
  check('designer with a dialog', await scan(designer.page), browserName);
});
test('viewer: a rendered report', async ({ page, browserName }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await serve(page, { definition: bands(), viewer: true });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  await expect(page.locator('#d .vpage').first()).toBeVisible();
  check('viewer', await scan(page), browserName);
  expect(errors).toEqual([]);
});
