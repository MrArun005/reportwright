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

  assert.deepEqual(errs, []);
  console.log('PASS designer gaps');
} finally {
  await b.close();
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
}
