// Designer gaps (Part 2): controls for properties that had none, and the Designer bugs found while building reports in it.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);

const rows = [
  { id: 2785, region: 'North', month: '2026-03-01', amount: 120.5, score: 4 },
  { id: 2786, region: 'South', month: '2026-01-01', amount: 98, score: 9 },
  { id: 2787, region: 'North', month: '2026-02-01', amount: 130, score: 7 },
  { id: 2788, region: 'East', month: '2026-01-01', amount: 77.25, score: 2 },
];
const base = (items = [], extra = {}) => ({
  $schema: 'pagewright/report@1', name: 'e2e designer gaps', page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows } }],
  dataSets: [{ name: 'Sales', source: 'src', path: '$.rows[*]', fields: [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'month', type: 'date' }, { name: 'amount', type: 'number' }, { name: 'score', type: 'number' }] }],
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
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const open = async (id) => { await p.goto(`${BASE}/designer/${id}`); await p.waitForSelector('[data-testid=paper]'); };
const save = async () => { await p.keyboard.press('Control+s'); await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor(); };
/** The control of a labelled field (its accessible name includes a select's options, so match the label text). */
const field = (scope, text) => scope.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).locator('select, input, textarea').first();
const editParam = (name) => p.locator('.trow', { has: p.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).getByRole('button', { name: 'Edit' }).click();

try {
  step('Parameter dialog: plain-string choices show as themselves and survive a save');
  let id = await create(base([], {
    parameters: [{ name: 'region', type: 'string', options: ['North', 'South'] }],
    dataSets: [{ ...base().dataSets[0], filters: [{ expr: '=Fields.score', op: '>=', value: '=Parameters.min' }] }],
  }));
  await open(id);
  // the data set filter reads a parameter that does not exist yet
  await p.locator('.err', { hasText: 'The parameter "min" does not exist' }).waitFor();
  await editParam('region');
  let dlg = p.getByRole('dialog');
  assert.equal(await dlg.getByTestId('param-choices').inputValue(), 'North\nSouth');
  await dlg.getByRole('button', { name: 'Save' }).click();

  step('Parameter dialog: adding the missing parameter clears the stale data panel error');
  await p.getByRole('button', { name: '+ Add' }).first().click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('min');
  await field(dlg, 'Type').selectOption('number');
  await field(dlg, 'Default').fill('0');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await p.locator('.err', { hasText: 'does not exist' }).waitFor({ state: 'detached' });

  step('Parameter dialog: label field for choices from a data set, and the live toggle');
  await editParam('region');
  dlg = p.getByRole('dialog');
  await dlg.getByTestId('param-choices').fill('');
  await field(dlg, 'Or choices from a data set').selectOption('Sales');
  await dlg.getByTestId('param-value-field').selectOption('region');
  await dlg.getByTestId('param-label-field').selectOption('=Fields.amount');
  await dlg.getByLabel(/Apply parameters as the reader changes them/).uncheck();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await save();
  let def = await read(id);
  assert.deepEqual(def.parameters[0].optionsFrom, { dataSet: 'Sales', value: '=Fields.region', label: '=Fields.amount' });
  assert.equal(def.parameters[0].options, undefined);
  assert.equal(def.liveParameters, false);

  step('Chart: filter, sort and "show at most N" from a parameter');
  id = await create(base([
    { type: 'chart', id: 'c1', name: 'Chart1', x: 0, y: 0, w: 320, h: 180, chartType: 'column', dataSet: 'Sales', category: '=Fields.region', series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }] },
    { type: 'matrix', id: 'm1', name: 'Matrix1', x: 0, y: 200, w: 320, h: 60, dataSet: 'Sales', rowGroups: [{ name: 'Region', expr: '=Fields.region' }], columnGroups: [], values: [{ label: 'Amount', value: '=Sum(Fields.amount)' }] },
  ], { parameters: [{ name: 'top', type: 'number', default: 2 }] }));
  await open(id);
  await p.locator('[data-item=Chart1]').click();
  const insp = p.getByTestId('inspector');
  await field(insp, 'Show at most N categories \\(a number or =Parameters.top\\)').fill('=Parameters.top');
  await insp.getByTestId('sort-filter').getByLabel('Sort by').selectOption('amount');
  await insp.getByTestId('sort-filter').getByLabel('Direction').selectOption('desc');
  await insp.getByTestId('add-filter').click();
  await insp.getByTestId('sort-filter').getByLabel('Filter value').fill('80');
  await insp.getByTestId('sort-filter').getByLabel('Operator').selectOption('>');
  await p.locator('[data-item=Matrix1]').click();
  await insp.getByTestId('sort-filter').getByLabel('Sort by').waitFor({ state: 'detached' }); // a matrix sorts by its groups
  await insp.getByTestId('add-filter').click();
  await save();
  def = await read(id);
  const ch = def.sections.body.items.find(i => i.name === 'Chart1');
  assert.equal(ch.maxCategories, '=Parameters.top');
  assert.deepEqual(ch.sort, [{ by: '=Fields.amount', dir: 'desc' }]);
  assert.deepEqual(ch.filters, [{ expr: '=Fields.id', op: '>', value: '80' }]);
  assert.equal(def.sections.body.items.find(i => i.name === 'Matrix1').filters.length, 1);

  step('Outline: select a covered item, change the drawing order, move an item out of its container');
  id = await create(base([
    { type: 'textbox', id: 'under', name: 'Under', x: 20, y: 20, w: 120, h: 20, value: 'under', style: { backgroundColor: '#fef3c7', backgroundImage: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } },
    { type: 'shape', id: 'cover', name: 'Cover', x: 0, y: 0, w: 200, h: 60, shape: 'rect' },
    { type: 'container', id: 'box', name: 'Box', x: 0, y: 100, w: 300, h: 80, items: [{ type: 'textbox', id: 'inner', name: 'Inner', x: 10, y: 12, w: 100, h: 16, value: 'inner' }] },
  ]));
  const oldH = 240; // the band's bottom stays in view for the drop below it
  await fetch(`${BASE}/api/reports/${id}`, { method: 'PUT', headers: H, body: JSON.stringify((d => { d.sections.body.height = oldH; return d; })(await read(id))) });
  await open(id);
  const outline = p.getByTestId('outline');
  await outline.getByRole('button', { name: 'Under', exact: true }).click();
  assert.equal(await p.getByLabel('Item name').inputValue(), 'Under');
  await outline.getByRole('button', { name: 'Draw later (in front): Under' }).click();
  await outline.getByRole('button', { name: 'Move out of Box: Inner' }).click();

  step('Shortcuts work again after typing in the Inspector (a canvas click takes the focus back)');
  await p.getByLabel('Item name').click();
  await p.locator('[data-item=Under]').click({ position: { x: 5, y: 5 } }); // now drawn on top of Cover
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowDown');

  step('Canvas styles: a background colour with a background image raises no React style warning');
  await field(p.getByTestId('inspector'), 'Background').fill('#dcfce7');

  step('A tool dropped below the band\'s height lands there, and the band grows');
  const band = p.locator('[data-section=body]');
  const bb = await band.boundingBox();
  await p.locator('[data-tool=textbox]').scrollIntoViewIfNeeded();
  const tool = await p.locator('[data-tool=textbox]').boundingBox();
  await p.mouse.move(tool.x + 10, tool.y + 8);
  await p.mouse.down();
  await p.mouse.move(bb.x + 60, bb.y + bb.height - 10, { steps: 8 });
  await p.mouse.move(bb.x + 60, bb.y + bb.height + 60, { steps: 8 }); // the band shows room below while dragging
  await p.mouse.up();
  await save();
  def = await read(id);
  const items = def.sections.body.items;
  assert.deepEqual(items.slice(0, 4).map(i => i.name), ['Cover', 'Under', 'Box', 'Inner'], 'Under drawn after Cover; Inner right after Box');
  const under = items.find(i => i.name === 'Under');
  assert.deepEqual([under.x, under.y], [21, 21], 'arrow keys moved the item');
  assert.equal(under.style.backgroundColor, '#dcfce7');
  const inner = items.find(i => i.name === 'Inner');
  assert.deepEqual([inner.x, inner.y], [10, 112], 'same place on the page');
  assert.equal(items.find(i => i.name === 'Box').items.length, 0);
  const dropped = items.find(i => i.type === 'textbox' && !['Under', 'Inner'].includes(i.name));
  assert.ok(dropped, `the dropped text box exists: ${JSON.stringify(items.map(i => [i.name, i.type, i.y]))} band ${def.sections.body.height}`);
  assert.ok(dropped.y >= oldH && def.sections.body.height >= dropped.y + dropped.h, `dropped below the old height (y ${dropped.y}, band ${def.sections.body.height})`);

  assert.deepEqual(errs, []);
  console.log('PASS designer gaps');
} finally {
  await b.close();
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
}
