// Data setup in the designer (ROADMAP weeks 2–3): pick rows from the response explorer; SQL source with a
// connection test. For the SQL part, start the server and this test with the same PW_DB_MAIN=sqlite:/abs/file.db
// (this test creates the file).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// the formats are in the viewer's Export menu: open it first
const openExport = async (pg) => { if (!(await pg.getByTestId('export-pdf').isVisible())) await pg.getByTestId('export-menu').click(); };

const BASE = process.env.BASE || 'http://localhost:3000';
// BASIC=user:password when the server runs with PW_BASIC_AUTH (needed in production for SQL previews)
const [user, pass] = (process.env.BASIC || '').split(':');
const AUTH = user ? { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {};
const step = (s) => console.log('·', s);

const SQLITE = /^sqlite:(.+)$/.exec(process.env.PW_DB_MAIN || '')?.[1];
if (SQLITE) {
  fs.rmSync(SQLITE, { force: true });
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(SQLITE);
  db.exec("create table sales (region text, month int, amount real); insert into sales values ('North', 1, 120.5), ('South', 1, 98), ('North', 2, 130), ('East', 2, 77.25)");
  db.close();
}

const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...AUTH }, body: JSON.stringify({ name: 'e2e data setup' }) });
const { id } = await r.json();
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, ...(user ? { httpCredentials: { username: user, password: pass } } : {}) })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(`${BASE}/designer/${id}`);
await p.waitForSelector('[data-testid=paper]');

step('REST source, then rows picked in the response explorer (no JSONPath typed)');
await p.getByRole('button', { name: '+ Add' }).nth(1).click();
let dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('loans');
await dlg.getByLabel('URL').fill('/api/sample/loans/LN-2025-001982');
await dlg.getByRole('button', { name: 'Save' }).click();
await p.getByRole('button', { name: '+ Add' }).nth(2).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('Payments');
await dlg.getByRole('button', { name: 'Explore the response' }).click();
const row = dlg.getByRole('listitem').filter({ hasText: '$.schedule' });
await row.getByText('suggested').waitFor();
await row.getByRole('button', { name: 'Use' }).click();
await dlg.getByText('Found 36 rows.').waitFor();
assert.equal(await dlg.getByLabel('Path to the rows').inputValue(), '$.schedule');
await dlg.getByRole('button', { name: 'Save' }).click();
await p.locator('.field-chip', { hasText: 'installment' }).waitFor();

if (SQLITE) {
  step('SQL source: pick the connection, test it, preview the query');
  await p.getByRole('button', { name: '+ Add' }).nth(1).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('db');
  await dlg.getByLabel('Type').selectOption('sql');
  await dlg.getByLabel('Connection').selectOption('main');
  await dlg.getByRole('button', { name: 'Test' }).click();
  await dlg.getByText(/Connected in \d+ ms/).waitFor();
  await dlg.getByRole('textbox', { name: /^Query/ }).fill('select region, month, amount from sales order by month, region');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await p.getByRole('button', { name: '+ Add' }).nth(2).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Sales');
  await dlg.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: /^Source$/ }) }).locator('select').selectOption('db'); // "Rows from" lists "From a data source" too
  await dlg.getByRole('button', { name: 'Explore the response' }).click();
  await dlg.getByRole('listitem').filter({ hasText: '4 rows' }).getByRole('button', { name: 'Use' }).click();
  await dlg.getByText('Found 4 rows.').waitFor();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await p.locator('.field-chip', { hasText: 'region' }).waitFor();
} else console.log('  (SQL part skipped: set PW_DB_MAIN=sqlite:/abs/file.db for the server and this test)');

step('Saving every data set unchanged keeps its nested relation and every sort key');
const def = JSON.parse(fs.readFileSync(new URL('../../reports/expressions-showcase.pw.json', import.meta.url), 'utf8'));
def.dataSets.find(x => x.name === 'Orders').sort = [{ by: '=Fields.customer', dir: 'desc' }, { by: '=Fields.date', dir: 'asc' }];
const before = JSON.parse(JSON.stringify(def.dataSets));
const { id: id2 } = await (await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...AUTH }, body: JSON.stringify({ name: 'e2e data set round trip', definition: def }) })).json();
await p.goto(`${BASE}/designer/${id2}`);
await p.waitForSelector('[data-testid=paper]');
for (const { name } of before) {
  await p.locator('.trow').filter({ has: p.locator('b', { hasText: new RegExp(`^${name}$`) }) }).getByRole('button', { name: 'Edit' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
}
await p.keyboard.press('Control+s');
await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
const saved = await (await fetch(`${BASE}/api/reports/${id2}`, { headers: { origin: BASE, ...AUTH } })).json();
// the dialog writes the default path "$" and drops an empty sort; anything else must come back as it was
const norm = (sets) => sets.map(x => ({ ...x, ...(x.relation ? { relation: { ...x.relation, path: x.relation.path || '$' } } : { path: x.path || '$' }), sort: x.sort || [] }));
assert.deepEqual(norm((saved.definition || saved).dataSets), norm(before));

step('Designer: Download gives the definition, unsaved changes included');
await p.getByLabel('Report name').fill('Round trip, renamed');
const [defDl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('download-def').click()]);
assert.equal(defDl.suggestedFilename(), 'Round-trip-renamed.pw.json');
const downloaded = JSON.parse(fs.readFileSync(await defDl.path(), 'utf8'));
assert.equal(downloaded.name, 'Round trip, renamed');
assert.deepEqual(downloaded.dataSets, (saved.definition || saved).dataSets);
await p.keyboard.press('Control+s'); // saved, so leaving the page does not ask
await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();

step('Viewer: JSON export gives the laid-out pages');
await p.goto(`${BASE}/viewer/${id2}`);
await p.waitForSelector('.vpage');
const [jsonDl] = await Promise.all([p.waitForEvent('download'), openExport(p).then(() => p.getByTestId('export-json').click())]);
assert.match(jsonDl.suggestedFilename(), /\.json$/);
const laid = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
assert.ok(Array.isArray(laid.pages) && laid.pages.length > 0, 'pages in the JSON export');

await b.close();
await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: { origin: BASE, ...AUTH } });
await fetch(`${BASE}/api/reports/${id2}`, { method: 'DELETE', headers: { origin: BASE, ...AUTH } });
assert.deepEqual(errs, []);
console.log('PASS data setup');
