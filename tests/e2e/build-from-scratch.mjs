// Phase 1 exit test: build a statement in the designer without touching JSON, then preview and export.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const step = (s) => console.log('·', s);

await fetch(`${BASE}/api/reports/e2e-statement`, { method: 'DELETE' });
step('create report');
await p.goto(BASE);
await p.getByLabel('New report name').fill('E2E statement');
await p.getByRole('button', { name: 'New report' }).click();
await p.waitForURL(/\/designer\/e2e-statement/);
await p.waitForSelector('[data-testid=paper]');

step('add parameter');
await p.getByRole('button', { name: '+ Add' }).nth(0).click();
let dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('accountId');
await dlg.getByLabel('Default').fill('LN-2025-001982');
await dlg.getByLabel('Required').check();
await dlg.getByRole('button', { name: 'Save' }).click();

step('add REST source');
await p.getByRole('button', { name: '+ Add' }).nth(1).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('loans');
await dlg.getByLabel('URL').fill('/api/sample/loans/{Parameters.accountId}');
await dlg.getByRole('button', { name: 'Save' }).click();

step('add data set and detect fields');
await p.getByRole('button', { name: '+ Add' }).nth(2).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('Payments');
await dlg.getByLabel('Path to the rows').fill('$.schedule');
await dlg.getByRole('button', { name: 'Detect fields' }).click();
await dlg.getByText('Found 36 rows.').waitFor();
await dlg.getByRole('button', { name: 'Save' }).click();
await p.locator('.field-chip', { hasText: 'installment' }).waitFor();

step('drop a table and bind fields');
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 30, y: 60 } });
await p.waitForSelector('.tbl');
for (const [field, col] of [['installment', 0], ['dueDate', 1], ['emi', 2]]) {
  await p.dragAndDrop(`.field-chip:has(.nm:text-is("${field}"))`, `[data-cell="detail-0-${col}"]`);
}
step('add a footer row with a total');
await p.locator('.tbl .grip').click();
await p.locator('[data-testid=inspector] div:has(> span:has-text("Footer rows")) button').click();
await p.dragAndDrop('.field-chip:has(.nm:text-is("emi"))', '[data-cell="footer-0-2"]');
await p.locator('[data-cell="footer-0-0"]').click();
await p.locator('[data-testid=inspector] .expr-row input').first().fill('Total');

step('drop a field as a text box in the header');
await p.dragAndDrop('.field-chip:has(.nm:text-is("status"))', '[data-section=pageHeader]', { targetPosition: { x: 400, y: 6 } });

step('move the title with the mouse');
const title = p.locator('[data-item=ReportTitle]');
const box = await title.boundingBox();
await p.mouse.move(box.x + 10, box.y + 5);
await p.mouse.down();
await p.mouse.move(box.x + 60, box.y + 5, { steps: 6 });
await p.mouse.up();
await p.waitForFunction(() => Number(document.querySelector('[data-testid=inspector] input[type=number]')?.value) > 20, null, { timeout: 3000 })
  .catch(async () => assert.fail(`title did not move (x=${await p.locator('[data-testid=inspector] input[type=number]').first().inputValue()})`));

step('delete and undo');
await p.locator('.tbl .grip').click();
await p.keyboard.press('Delete');
assert.equal(await p.locator('.tbl').count(), 0);
await p.keyboard.press('Control+z');
assert.equal(await p.locator('.tbl').count(), 1);

step('save');
await p.keyboard.press('Control+s');
await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
const saved = await (await fetch(`${BASE}/api/reports/e2e-statement`)).json();
const t = saved.sections.body.items.find(i => i.type === 'table');
assert.equal(t.dataSet, 'Payments');
assert.equal(t.detail[0].cells[1].value, '=Fields.dueDate');
assert.equal(t.footer[0].cells[2].value, '=Sum(Fields.emi)');
assert.equal(t.header[0].cells[0].value, 'Installment');
await p.screenshot({ path: '/tmp/shots/scratch-designer.png' });

step('preview');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
const svgText = await p.locator('.vpage').first().innerText().catch(() => '');
const allText = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(allText.includes('Total'), 'total row shown');
assert.ok(allText.some(s => /^Page 1 of \d+$/.test(s)), 'page numbers shown');
assert.ok(allText.includes('36'), 'last installment shown');
await p.screenshot({ path: '/tmp/shots/scratch-preview.png' });

step('export PDF');
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('export-pdf').click()]);
await dl.saveAs('/tmp/scratch.pdf');

console.log('errors:', errs.length ? errs : 'none');
await b.close();
assert.equal(errs.length, 0);
console.log('PASS');
