// Table gallery and data set → table (ROADMAP week 4). Proof: an invoice with line items from a blank report.
// PROOF_OUT=reports/invoice.pw.json saves the result as the proof report.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
const invoice = {
  number: 'INV-2026-0147', date: '2026-10-04', customer: { name: 'Asha Traders', city: 'Pune' },
  lines: [
    { item: 'Thermal paper roll', category: 'Supplies', qty: 12, rate: 85.5, amount: 1026 },
    { item: 'Barcode scanner', category: 'Hardware', qty: 2, rate: 4200, amount: 8400 },
    { item: 'Label printer', category: 'Hardware', qty: 1, rate: 11800, amount: 11800 },
    { item: 'Setup and training', category: 'Services', qty: 3, rate: 1500, amount: 4500 },
  ],
};

const t0 = Date.now();
const res = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ name: 'Invoice' }) });
const { id } = await res.json();
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(`${BASE}/designer/${id}`);
await p.waitForSelector('[data-testid=paper]');

step('inline JSON source, rows picked in the explorer');
await p.getByRole('button', { name: '+ Add' }).nth(1).click();
let dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('invoice');
await dlg.getByLabel('Type').selectOption('json');
await dlg.getByLabel('JSON data').fill(JSON.stringify(invoice));
await dlg.getByRole('button', { name: 'Save' }).click();
await p.getByRole('button', { name: '+ Add' }).nth(2).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('Lines');
await dlg.getByRole('button', { name: 'Explore the response' }).click();
await dlg.getByRole('listitem').filter({ hasText: '$.lines' }).getByRole('button', { name: 'Use' }).click();
await dlg.getByText('Found 4 rows.').waitFor();
await dlg.getByRole('button', { name: 'Save' }).click();

step('drag the data set onto the page: a table with totals');
await p.dragAndDrop('.trow .nm:has-text("Lines")', '[data-section=body]', { targetPosition: { x: 0, y: 40 } });
await p.waitForSelector('.tbl');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
let t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(['Item', 'Category', 'Qty', 'Rate', 'Amount'].every(h => t.includes(h)), 'header labels');
assert.ok(t.includes('25,726.00') || t.includes('25,726'), `invoice total, got ${t.join(' | ').slice(0, 300)}`);

step('table gallery: grouped by category with subtotals');
await p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Design' }).click();
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 0, y: 200 } });
dlg = p.getByRole('dialog');
await dlg.locator('[data-layout=grouped]').click();
await dlg.getByLabel('Group by').selectOption('category');
await dlg.getByTestId('table-wizard-apply').click();
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('Hardware') && t.includes('Subtotal'), 'grouped table with subtotals');
assert.ok(t.includes('20,200.00') || t.includes('20,200'), 'Hardware subtotal');
const ms = Date.now() - t0;

await p.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
await p.waitForTimeout(500);
const saved = await (await fetch(`${BASE}/api/reports/${id}`)).json();
assert.ok(saved.sections.body.items.some(i => i.type === 'table' && i.groups?.length), 'saved with the grouped table');
if (process.env.PROOF_OUT) fs.writeFileSync(process.env.PROOF_OUT, JSON.stringify({ ...saved, name: 'Invoice (built with the table gallery)' }, null, 2) + '\n');
await b.close();
await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: { origin: BASE } });
assert.deepEqual(errs, []);
console.log(`PASS galleries (blank → invoice with line items and a grouped table in ${(ms / 1000).toFixed(1)} s, automated)`);
