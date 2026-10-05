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
  if (want('u4')) {
    step('U-4: unsaved changes are kept as a draft and offered back when the report opens again');
    const secretSrc = { name: 'secret', type: 'rest', url: '/api/sample/none?api_key=E2ESECRETKEY', headers: { Authorization: 'Bearer E2EHEADERTOKEN' } };
    const id = await create(base('ux r1c autosave', [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 20, value: 'Hello' }], { dataSources: [...base('x').dataSources, secretSrc] }));
    const drafts = () => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('pw.draft.')).map(k => localStorage.getItem(k)));
    await open(id);
    await p.getByLabel('Report name').fill('ux r1c autosave edited');
    await p.getByTestId('save-state').filter({ hasText: 'Unsaved changes' }).waitFor();
    await p.waitForTimeout(11000); // the autosave interval
    const kept = await drafts();
    assert.equal(kept.length, 1);
    assert.ok(kept[0].includes('ux r1c autosave edited'));
    for (const secret of ['E2ESECRETKEY', 'E2EHEADERTOKEN', '"rows"']) assert.ok(!kept[0].includes(secret), `the draft holds ${secret}`);
    await open(id); // as after a crash, an expired session or a closed laptop
    await p.getByTestId('draft-offer').waitFor();
    await shot(p, 'u4-draft');
    await p.getByTestId('draft-restore').click();
    assert.equal(await p.getByLabel('Report name').inputValue(), 'ux r1c autosave edited');
    await save();
    assert.equal((await read(id)).name, 'ux r1c autosave edited');
    assert.deepEqual(await drafts(), []); // saved: no draft left
    assert.deepEqual((await read(id)).dataSources.find(x => x.name === 'secret'), secretSrc); // restored sources come from the saved report
    await open(id);
    await p.waitForTimeout(500);
    assert.equal(await p.getByTestId('draft-offer').count(), 0);

    step('U-4: Cmd/Ctrl+S with a dialog open saves the dialog first');
    await p.getByRole('button', { name: '+ Add' }).first().click();
    let dlg = p.getByRole('dialog');
    await p.keyboard.press('Control+s'); // no name yet: nothing is saved, and the reason shows
    await p.getByText('Not saved: the open dialog has an error.').waitFor();
    await dlg.getByLabel('Name').fill('fromDialog');
    await p.keyboard.press('Control+s');
    await dlg.waitFor({ state: 'detached' });
    await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
    assert.ok((await read(id)).parameters?.some(x => x.name === 'fromDialog'));
  }
  if (want('u5')) {
    step('U-5: Shift/Cmd-click, drag, column and row handles select several table cells; one format sets them all');
    const id = await create(base('ux r1c cells', [{ type: 'table', name: 'Tbl', x: 0, y: 0, w: 360, h: 54, dataSet: 'Sales', columns: [{ width: 120 }, { width: 120 }, { width: 120 }],
      header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount' }, { value: 'Qty' }] }],
      detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }, { value: '=Fields.qty' }] }],
      footer: [{ height: 18, cells: [{ value: 'Total' }, { value: '=Sum(Fields.amount)' }, { value: '=Sum(Fields.qty)' }] }] }]));
    await open(id);
    const cell = (part, r, c) => p.locator(`[data-cell="${part}-${r}-${c}"]`);
    await cell('detail', 0, 1).click();
    await cell('footer', 0, 1).click({ modifiers: ['Shift'] });
    await cell('header', 0, 1).click({ modifiers: ['ControlOrMeta'] });
    await insp().getByText('3 cells of Tbl').waitFor();
    assert.equal(await p.evaluate(() => getSelection().toString()), ''); // no text selection across the cells
    await field(insp(), 'Format \\(C2, N0, dd MMM yyyy\\)').fill('N2');
    await shot(p, 'u5-cells');
    await save();
    let t = (await read(id)).sections.body.items[0];
    assert.deepEqual([t.header[0].cells[1], t.detail[0].cells[1], t.footer[0].cells[1]].map(c => c.style?.format), ['N2', 'N2', 'N2']);
    assert.equal(t.detail[0].cells[2].style?.format, undefined);
    // the column handle selects the whole column; a blank field shows where the cells differ
    await p.locator('[data-col-handle="2"]').click();
    await insp().getByText('3 cells of Tbl').waitFor();
    assert.equal(await field(insp(), 'Format \\(C2, N0, dd MMM yyyy\\)').inputValue(), '');
    // the row tag selects the row; a drag selects the rectangle
    await p.locator('[data-row-handle="detail-0"]').click();
    await insp().getByText('3 cells of Tbl').waitFor();
    const a = await cell('header', 0, 0).boundingBox(), z = await cell('detail', 0, 1).boundingBox();
    await p.mouse.move(a.x + 5, a.y + 5); await p.mouse.down();
    await p.mouse.move(z.x + 10, z.y + 8, { steps: 6 }); await p.mouse.up();
    await insp().getByText('4 cells of Tbl').waitFor();
    step('U-5: the right-click menu inserts rows and columns, groups by a field, and goes to the format');
    await cell('detail', 0, 0).click({ button: 'right' });
    await p.getByTestId('cell-menu').getByRole('menuitem', { name: 'Group by region' }).waitFor();
    await p.getByTestId('cell-menu').getByRole('menuitem', { name: 'Row below' }).click();
    await cell('detail', 1, 0).waitFor();
    await cell('detail', 0, 1).click({ button: 'right' });
    await p.getByTestId('cell-menu').getByRole('menuitem', { name: 'Number format…' }).click();
    await p.waitForFunction(() => document.activeElement?.closest('[data-prop=format]'));
    await save();
    t = (await read(id)).sections.body.items[0];
    assert.equal(t.detail.length, 2);
  }
  if (want('u6')) {
    step('U-6: the table gallery gives each field one format; a count subtotal stays whole; ids and years are plain');
    const id = await create(base('ux r1c formats', []));
    await open(id);
    await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 0, y: 10 } });
    let dlg = p.getByRole('dialog');
    await dlg.locator('[data-layout=grouped]').click();
    await dlg.getByLabel('Group by').selectOption('region');
    await dlg.getByTestId('table-wizard-apply').click();
    await save();
    const t = (await read(id)).sections.body.items.find(i => i.type === 'table');
    const fmtOf = (row, name) => row.cells.find(c => new RegExp(`Fields\\.${name}\\b`).test(c?.value || ''))?.style?.format;
    for (const [n, f] of [['id', '0'], ['year', '0'], ['month', '0'], ['amount', 'N2'], ['qty', 'N0']]) assert.equal(fmtOf(t.detail[0], n), f, n);
    assert.equal(fmtOf(t.groups[0].footer[0], 'amount'), 'N2');
    assert.equal(fmtOf(t.groups[0].footer[0], 'qty'), 'N0');
    step('U-6: the chart gallery: years plain in its grid, month numbers as names, a compact axis for big values');
    await p.dragAndDrop('[data-tool=chart]', '[data-section=body]', { targetPosition: { x: 0, y: 220 } });
    dlg = p.getByRole('dialog');
    await dlg.locator('.cw-table td', { hasText: /^2026$/ }).first().waitFor();
    assert.equal(await dlg.locator('.cw-table td', { hasText: '2,026' }).count(), 0);
    await field(dlg, 'Category \\(x axis or slices\\)').selectOption('month');
    await dlg.locator('[data-chart-type=column]').click();
    await dlg.getByLabel(/Show month numbers as names/).waitFor();
    await dlg.getByTestId('cw-compact').waitFor();
    await shot(p, 'u6-chart-gallery');
    await dlg.getByTestId('chart-wizard-apply').click();
    await save();
    const ch = (await read(id)).sections.body.items.find(i => i.type === 'chart');
    assert.equal(ch.category, '=DateSerial(2000, Fields.month, 1)');
    assert.equal(ch.categoryFormat, 'MMM');
    assert.match(ch.axes.y.format, /"[KMB]"$/);
    await p.getByTestId('tab-preview').click();
    await p.locator('.vpage svg text', { hasText: /^Feb$/ }).first().waitFor();
    await p.locator('.vpage svg text', { hasText: /^\d[\d,]*[KM]$/ }).first().waitFor();
  }
  if (want('u7')) {
    step('U-7: a nested JSON object becomes dotted fields, and Fields.customer.name renders');
    const invoice = { no: 'INV-7', customer: { name: 'Acme Traders', address: { city: 'Pune' } }, lines: [{ item: 'Pen', amount: 10 }, { item: 'Ink', amount: 15 }] };
    const id = await create({ ...base('ux r1c nested', []), dataSources: [{ name: 'inv', type: 'json', data: invoice }],
      dataSets: [{ name: 'Head', source: 'inv', path: '$', fields: [] }, { name: 'Lines', source: 'inv', path: '$.lines[*]', fields: [{ name: 'item', type: 'string' }, { name: 'amount', type: 'number' }] }] });
    await open(id);
    await p.locator('.trow').filter({ has: p.locator('b', { hasText: /^Head$/ }) }).getByRole('button', { name: 'Edit' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Detect fields' }).click();
    await dlg.getByTestId('ds-object-customer').filter({ hasText: 'customer.name, customer.address.city' }).waitFor();
    await dlg.getByRole('button', { name: 'Save' }).click();
    const chip = p.locator('[data-field="customer.name"]');
    await chip.waitFor();
    await chip.dragTo(p.locator('[data-section=body]'), { targetPosition: { x: 20, y: 20 } });
    await save();
    let def = await read(id);
    assert.equal(def.sections.body.items[0].value, '=Fields.customer.name');
    await p.getByTestId('tab-preview').click();
    await p.locator('.vpage svg text', { hasText: 'Acme Traders' }).first().waitFor();
    await p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Design' }).click();

    step('U-7: an unknown field is flagged in the Inspector and the expression editor, with a suggestion');
    await p.locator('[data-tool=textbox]').click();
    await field(insp(), 'Data set').selectOption('Lines');
    await field(insp(), 'Value').fill('=Sum(Fields.amont)');
    await insp().getByTestId('field-warning').filter({ hasText: 'The data set has no field "amont". Did you mean "amount"?' }).waitFor();
    assert.match(await field(insp(), 'Value').getAttribute('class'), /squiggle/);
    await insp().locator('[data-prop], label.field').filter({ has: p.locator(':scope > span', { hasText: /^Value$/ }) }).getByRole('button', { name: /expression editor/i }).first().click();
    const ed = p.getByRole('dialog');
    await ed.getByTestId('expr-issues').filter({ hasText: 'Did you mean "amount"?' }).waitFor();
    await ed.locator('.cm-unknown-field', { hasText: 'amont' }).waitFor();
    await ed.getByRole('button', { name: 'amount' }).waitFor(); // the field list
    await shot(p, 'u7-expr-editor');
    await ed.getByRole('button', { name: 'Cancel' }).click();
    await field(insp(), 'Value').fill('=Sum(Fields.amount)');
    await insp().getByTestId('field-warning').waitFor({ state: 'detached' });
  }
  if (want('u8')) {
    step('U-8: Detect fields on an object with a list takes the list; Add group can start collapsed');
    const inv = { no: 'INV-8', lines: [{ item: 'Pen', amount: 10 }, { item: 'Ink', amount: 15 }, { item: 'Pad', amount: 5 }] };
    let id = await create({ ...base('ux r1c u8', [{ type: 'textbox', name: 'A', x: 0, y: 0, w: 120, h: 20, value: 'A' }, { type: 'textbox', name: 'B', x: 60, y: 10, w: 120, h: 20, value: 'B' }]),
      dataSources: [...base('x').dataSources, { name: 'inv', type: 'json', data: inv }] });
    await open(id);
    assert.equal(await p.getByTestId('zoom').inputValue(), 'fit'); // the page fits the canvas
    await p.getByTestId('issues').filter({ hasText: '1 to check' }).waitFor(); // A and B overlap
    await p.getByTestId('issues').click();
    await p.getByTestId('issues-list').getByText('B overlaps A.').waitFor();
    assert.equal(await p.locator('[data-item=B].issue').count(), 1);
    step('U-8: the align toolbar aligns the selection');
    const outline = p.getByTestId('outline');
    await outline.getByRole('button', { name: 'A', exact: true }).click();
    await outline.getByRole('button', { name: 'B', exact: true }).click({ modifiers: ['Shift'] });
    await p.getByTestId('align-bar').getByRole('button', { name: 'Align top edges' }).click();
    await p.getByTestId('align-bar').getByRole('button', { name: 'Align left edges' }).click();
    await save();
    let def = await read(id);
    assert.deepEqual(def.sections.body.items.map(i => [i.x, i.y]), [[0, 0], [0, 0]]);
    await p.getByTestId('issues-none').waitFor(); // B is now inside A's box? no: same box, layered on purpose
    // a new data set over the object: Detect takes $.lines
    await p.getByRole('button', { name: '+ Add' }).nth(2).click();
    let dlg = p.getByRole('dialog');
    await dlg.getByLabel('Name').fill('Lines');
    await field(dlg, 'Source').selectOption('inv');
    await dlg.getByRole('button', { name: 'Detect fields' }).click();
    await dlg.getByText(/Found 3 rows\. Rows from \$\.lines/).waitFor();
    assert.equal(await dlg.getByTestId('ds-path').inputValue(), '$.lines');
    await dlg.getByRole('button', { name: 'Save' }).click();
    // a table and a drill-down group
    await p.evaluate(() => 0);
    id = await create(base('ux r1c u8 group', [{ type: 'table', name: 'Tbl', x: 0, y: 40, w: 360, h: 36, dataSet: 'Sales', columns: [{ width: 180 }, { width: 180 }],
      header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] },
      { type: 'image', name: 'Logo', x: 0, y: 0, w: 80, h: 30 }]));
    await open(id);
    await p.locator('.tbl .grip').click();
    const ga = insp().getByTestId('group-add');
    await ga.getByLabel('Field to group by').selectOption('region');
    await ga.getByLabel(/Drill-down: the group starts collapsed/).check();
    await ga.getByRole('button', { name: 'Add group' }).click();
    step('U-8: the image item uploads its own image and the canvas shows it');
    await p.locator('[data-item=Logo]').click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await insp().getByTestId('item-image-upload').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await p.locator('[data-item=Logo] img[src^="data:image/png"]').waitFor();
    await save();
    def = await read(id);
    const tb = def.sections.body.items.find(i => i.name === 'Tbl');
    assert.equal(tb.groups[0].collapsible, true);
    assert.equal(tb.groups[0].initiallyCollapsed, true);
    assert.equal(tb.detail[0].cells[0].value, ''); // the group header shows the region; the detail does not repeat it
    assert.equal(def.sections.body.items.find(i => i.name === 'Logo').src, 'embedded:logo');
    step('U-8: the preview opens at whole page; the parameter panel says what its button does');
    await p.getByTestId('tab-preview').click();
    await p.getByTestId('fit-page').and(p.locator('[aria-pressed=true]')).waitFor();

    step('U-8: drill-through levels are in the address: browser Back and Forward walk them');
    const dash = await create(base('ux r1c u8 dash', [{ type: 'textbox', name: 'W', x: 0, y: 0, w: 300, h: 20, value: '="Region: " & Parameters.region' }], { parameters: [{ name: 'region', type: 'string' }] }));
    const src = await create(base('ux r1c u8 src', [{ type: 'textbox', name: 'Go', x: 0, y: 0, w: 200, h: 20, value: 'Open North', action: { type: 'report', report: dash, params: { region: '="North"' } } }]));
    await p.goto(`${BASE}/viewer/${src}`);
    await p.locator('.vpage svg').first().waitFor();
    await p.getByRole('link', { name: /Open North: open the report/ }).focus();
    await p.keyboard.press('Enter');
    await p.getByTestId('drill-back').waitFor();
    assert.match(decodeURIComponent(p.url()), new RegExp(`_drill=\\[\\{"id":"${dash}"`));
    await p.goBack();
    await p.getByTestId('drill-back').waitFor({ state: 'detached' });
    await p.goForward();
    await p.locator('.vpage svg text', { hasText: 'Region: North' }).waitFor();
    await p.reload(); // a drilled address opens drilled
    await p.locator('.vpage svg text', { hasText: 'Region: North' }).waitFor();
    await p.getByTestId('drill-back').click();
    await p.getByTestId('drill-back').waitFor({ state: 'detached' });
    assert.ok(!p.url().includes('_drill'));

    step('U-8: "New report" asks for a name instead of making untitled-report');
    await p.goto(BASE);
    await p.waitForFunction(() => Object.keys(document.querySelector('form.newrep') || {}).some(k => k.startsWith('__react'))); // hydrated
    await p.getByRole('button', { name: 'New report', exact: true }).click();
    await p.getByText('Give the report a name first.').waitFor();
    assert.ok(!p.url().includes('/designer/'));

    step('U-8: at 390 px the designer has no sideways scroll and says designing needs a wider screen');
    const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await m.goto(`${BASE}/designer/${id}`);
    await m.waitForSelector('[data-testid=paper]', { timeout: process.env.SLOW ? 180000 : 30000 });
    await m.getByText(/Designing needs a wider screen/).waitFor();
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'no sideways scroll');
    await m.screenshot({ path: '/tmp/shots/r1c-u8-mobile.png' });
    await m.close();
  }
  assert.deepEqual(errs, [], `page errors: ${errs.join(' | ')}`);
  console.log('ux-r1c: all passed');
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
  await b.close();
}
