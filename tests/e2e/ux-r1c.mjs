// R1-C: designer and viewer UX fixes (docs/COORDINATION.md). One section per fix; ONLY=u1,u3 runs some of them.
//   BASE=http://localhost:3700 node tests/e2e/ux-r1c.mjs
// Screenshots go to /tmp/shots/r1c-*.png. The reports it makes are deleted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });
const shot = (p, n) => p.screenshot({ path: `/tmp/shots/r1c-${n}.png` });

const rows = [
  { id: 1, region: 'North', city: 'Pune', year: 2025, month: 1, amount: 1250.5, qty: 3 },
  { id: 2, region: 'North', city: 'Delhi', year: 2026, month: 2, amount: 98000, qty: 12 },
  { id: 3, region: 'South', city: 'Kochi', year: 2025, month: 3, amount: 4200, qty: 7 },
  { id: 4, region: 'East', city: 'Patna', year: 2026, month: 4, amount: 2730135, qty: 1 },
];
const SALES = { name: 'Sales', source: 'src', path: '$.rows[*]', fields: [
  { name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'year', type: 'number' },
  { name: 'month', type: 'number' }, { name: 'amount', type: 'number' }, { name: 'qty', type: 'number' }] };
const base = (name, items = [], extra = {}) => ({
  $schema: 'pagewright/report@1', name, page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows, regions: [{ name: 'North' }, { name: 'South' }, { name: 'East' }] } }],
  dataSets: [SALES, { name: 'Regions', source: 'src', path: '$.regions[*]', fields: [{ name: 'name', type: 'string' }] }],
  sections: { body: { height: 400, items } },
  ...extra,
});
const ids = [];
const create = async (definition) => {
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: definition.name, definition }) });
  const { id } = await r.json();
  ids.push(id);
  return id;
};
const read = async (id) => { const r = await (await fetch(`${BASE}/api/reports/${id}`, { headers: H })).json(); return r.definition || r; };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
if (process.env.SLOW) p.setDefaultTimeout(180000); // a dev server compiles each page on first use
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
const open = async (id) => { await p.goto(`${BASE}/designer/${id}`); await p.waitForSelector('[data-testid=paper]'); };
const save = async () => { await p.keyboard.press('Control+s'); await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor(); };
const field = (scope, text) => scope.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).locator('select, input, textarea').first();
const insp = () => p.getByTestId('inspector');

try {
  if (want('u1')) {
    step('U-1: matrix header and value cells get click actions in the Inspector, with the target report\'s parameters listed');
    const dash = await create(base('ux r1c dash', [{ type: 'textbox', name: 'Who', x: 0, y: 0, w: 300, h: 20, value: '="Region: " & Parameters.region' }], {
      parameters: [{ name: 'region', type: 'string', required: true }, { name: 'year', type: 'number' }] }));
    const id = await create(base('ux r1c pivot', [{ type: 'matrix', name: 'M', x: 0, y: 0, w: 400, h: 60, dataSet: 'Sales',
      rowGroups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', total: 'after' }],
      columnGroups: [{ name: 'Year', expr: '=Fields.year', sort: 'asc', total: 'after' }],
      values: [{ value: '=Sum(Fields.amount)', format: 'N0' }] }]));
    await open(id);
    await p.locator('[data-item=M]').click();
    // property search finds the matrix's actions
    await insp().getByTestId('find-property').fill('drill');
    await insp().getByTestId('pivot-rowGroups0-action').waitFor();
    await insp().getByTestId('find-property').fill('');
    const ra = insp().getByTestId('pivot-rowGroups0-action');
    await field(ra, 'Action on a header click').selectOption('report');
    await ra.getByTestId('report-picker').fill(dash);
    const pm = ra.getByTestId('pmap-report');
    await pm.locator('[data-param=region]').waitFor(); // the target report's parameters, listed
    await pm.locator('[data-param=year]').waitFor();
    assert.match(await pm.locator('[data-param=region] .err').innerText(), /Required/);
    await pm.locator('[data-param=region] input').fill('=Fields.region');
    await pm.locator('[data-param=region] .err').waitFor({ state: 'detached' });
    const va = insp().getByTestId('pivot-values0-action');
    await field(va, 'Action on a cell click').selectOption('params');
    await va.getByTestId('pmap-params').waitFor();
    await shot(p, 'u1-inspector');
    await save();
    const def = await read(id);
    const m = def.sections.body.items.find(i => i.name === 'M');
    assert.deepEqual(m.rowGroups[0].action, { type: 'report', report: dash, params: { region: '=Fields.region' } });
    assert.equal(m.values[0].action.type, 'params');

    step('U-1: a row header click in the viewer drills through with that row\'s region');
    await p.goto(`${BASE}/viewer/${id}`);
    await p.locator('.vpage svg').first().waitFor();
    const link = p.locator('.pw-link').filter({ has: p.locator('title', { hasText: `Open ${dash}` }) }).first();
    await link.click();
    await p.getByTestId('drill-back').waitFor();
    await p.locator('.vpage svg text', { hasText: /Region: (East|North|South)/ }).first().waitFor();
  }

  if (want('u2')) {
    step('U-2: the viewer\'s interactive spots are focusable, named controls; pages are labelled regions with a text alternative');
    const target = await create(base('ux r1c target', [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 20, value: 'Target report' }]));
    const id = await create(base('ux r1c a11y', [
      { type: 'table', name: 'Tbl', x: 0, y: 0, w: 400, h: 60, dataSet: 'Sales', columns: [{ width: 200 }, { width: 200 }],
        header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount', sortBy: '=Fields.amount' }] }],
        groups: [{ name: 'G', expr: '=Fields.region', sort: 'asc', collapsible: true, initiallyCollapsed: true, header: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Sum(Fields.amount)', style: { format: 'N0' } }] }] }],
        detail: [{ height: 18, cells: [{ value: '=Fields.city', action: { type: 'report', report: target, params: { city: '=Fields.city' } } }, { value: '=Fields.amount' }] }] },
      { type: 'chart', name: 'C', x: 0, y: 150, w: 300, h: 160, dataSet: 'Sales', chartType: 'column', category: '=Fields.region', series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }], pointAction: { type: 'params', params: { region: '=Fields.region' } } },
    ], { parameters: [{ name: 'region', type: 'string', nullable: true }] }));
    await p.goto(`${BASE}/viewer/${id}`);
    await p.locator('.vpage svg').first().waitFor();
    // toolbar buttons have real names (not the triangle characters)
    for (const n of ['First page', 'Previous page', 'Next page', 'Last page']) await p.getByRole('button', { name: n, exact: true }).waitFor();
    const page1 = p.getByRole('region', { name: 'Page 1 of 1' });
    await page1.waitFor();
    assert.match(await page1.locator('.sr-only').innerText(), /Region Amount/);
    const aria = await page1.ariaSnapshot();
    await page1.getByRole('button', { name: 'East', exact: true, expanded: false }).waitFor();
    assert.match(aria, /button "East"/);
    assert.match(aria, /button "Sort by Amount, ascending"/);
    assert.match(aria, /button "Filter by North/);
    // keyboard only: Tab from the page number box reaches the controls on the page
    await p.getByRole('textbox', { name: 'Page' }).focus();
    const names = [];
    for (let k = 0; k < 40 && names.length < 3; k++) {
      await p.keyboard.press('Tab');
      const n = await p.evaluate(() => (document.activeElement?.classList.contains('vlink') ? document.activeElement.textContent : null));
      if (n) names.push(n);
    }
    assert.deepEqual(names.slice(0, 2), ['Sort by Amount, ascending', 'East']);
    const outline = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.equal(outline, 'solid'); // a visible focus
    await shot(p, 'u2-focus');
    step('U-2: Enter expands a group and the focus stays on it; Space sorts');
    const east = page1.getByRole('button', { name: 'East', exact: true });
    await east.focus();
    await p.keyboard.press('Enter');
    await page1.getByRole('button', { name: 'East', expanded: true }).waitFor();
    assert.equal(await p.evaluate(() => document.activeElement?.textContent), 'East');
    await page1.getByRole('link', { name: /Patna: open the report/ }).waitFor(); // the drill-through in the expanded rows
    await page1.getByRole('button', { name: 'Sort by Amount, ascending' }).focus();
    await p.keyboard.press(' ');
    await page1.getByRole('button', { name: 'Sort by Amount, descending' }).waitFor();
    step('U-2: a drill-through link opens by keyboard');
    await page1.getByRole('link', { name: /Patna: open the report/ }).focus();
    await p.keyboard.press('Enter');
    await p.getByTestId('drill-back').waitFor();
    await p.getByTestId('drill-back').click();
    await page1.getByRole('button', { name: /^Filter by South/ }).waitFor();
    step('U-2: a chart point by keyboard filters the report (the parameter panel follows)');
    await page1.getByRole('button', { name: /^Filter by South/ }).focus();
    await p.keyboard.press('Enter');
    await p.getByRole('button', { name: 'Parameters' }).click();
    await p.waitForFunction(() => [...document.querySelectorAll('.vparams input')].some(i => i.value === 'South'));
  }

  if (want('u3')) {
    step('U-3: choosing a data set for a parameter\'s choices stores the value field it shows');
    const id = await create(base('ux r1c params', [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 20, value: '=Join(Parameters.region, ", ")' }], {
      parameters: [{ name: 'broken', type: 'string', optionsFrom: { dataSet: 'Regions', value: '' } }] }));
    await open(id);
    await p.getByTestId('param-warn-broken').waitFor(); // an existing empty value field is flagged in the data panel
    await p.getByRole('button', { name: '+ Add' }).first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Name').fill('region');
    await dlg.getByLabel(/^Allow several values/).check();
    await dlg.getByTestId('param-choices-from').selectOption('Regions');
    assert.equal(await dlg.getByTestId('param-value-field').inputValue(), 'name');
    await dlg.getByTestId('param-choice-preview').filter({ hasText: '3 choices: North, South, East' }).waitFor();
    // a placeholder, not a silent first option: Save waits for a field
    await dlg.getByTestId('param-value-field').selectOption('');
    assert.equal(await dlg.getByRole('button', { name: 'Save' }).isDisabled(), true);
    await dlg.getByText('Pick the value field for the choices from the data set.').waitFor();
    await dlg.getByTestId('param-value-field').selectOption('name');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await save();
    const def = await read(id);
    assert.deepEqual(def.parameters.find(x => x.name === 'region').optionsFrom, { dataSet: 'Regions', value: '=Fields.name' });
    step('U-3: the viewer lists the choices with labels');
    await p.goto(`${BASE}/viewer/${id}`);
    await p.getByRole('button', { name: 'Parameters' }).click();
    await p.locator('.vparams').getByText('South', { exact: true }).waitFor();
  }
  assert.deepEqual(errs, [], `page errors: ${errs.join(' | ')}`);
  console.log('ux-r1c: all passed');
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
  await b.close();
}
