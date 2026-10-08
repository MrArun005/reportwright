// Recipe: a pivot table (matrix) with nested row groups, a column group, totals and expand/collapse.
// Drives the real designer; writes site/learn/pivot-table.{pw.json,steps.json} and its screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'pivot-table';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');
/** The n-th labelled control of that name in scope (one per value card). */
const nth = (scope, text, n) => scope.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).nth(n).locator('select, input, textarea').first();

step('Under **Data**, add a REST data source `sales` with URL `/api/sample/sales/2026`, then a data set `Sales` with path `$.rows`; **Detect fields** finds 432 rows.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');
await addDataSet(p, 'Sales', '$.rows');

step('Drag **Matrix** onto the Body and click **Pivot wizard…** at the bottom of the gallery.');
await p.dragAndDrop('[data-tool=matrix]', '[data-section=body]', { targetPosition: { x: 10, y: 10 } });
const dlg = p.getByRole('dialog');
await dlg.getByTestId('open-pivot-wizard').click();

step('In the wizard press **Rows** next to Region, then next to City; **Cols** next to Product; **Values** next to Disbursed. Keep **Totals** ticked and click **Insert pivot**.');
for (const id of ['pv-rows-region', 'pv-rows-city', 'pv-columns-product', 'pv-values-disbursed']) await dlg.getByTestId(id).click();
await p.waitForTimeout(400);
await shot(p, dlg, `${NAME}-1-wizard`);
await dlg.getByTestId('pivot-wizard-insert').click();

step('With the matrix selected, set X to `0`, Row header width to `90` and Column width to `70`. Under **Rows**, in 1. Region tick **Drill-down: show a toggle**.');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Row header width').fill('90');
await field(p, insp, 'Column width').fill('70');
await p.keyboard.press('Tab');
const rows = insp.getByTestId('pivot-rowGroups');
await rows.getByLabel('Drill-down: show a toggle').first().check();

step('Under **Values**, set the Disbursed value\'s Format to `N0`. Pick `disbursed` again in Field to add and click **Add**; on the new value set Label `Share`, Show **% of row** and Format `P1` (the added value starts with `N0`, which would print a share as 0 or 1).');
const vals = insp.getByTestId('pivot-values');
await field(p, vals, 'Format').first().fill('N0');
await p.keyboard.press('Tab');
await insp.getByTestId('pivot-pick-values').selectOption('disbursed');
await insp.getByTestId('pivot-add-values').click();
await nth(vals, 'Label', 1).fill('Share');
await nth(vals, 'Show', 1).selectOption({ label: '% of row' });
await nth(vals, 'Format', 1).fill('P1');
await p.keyboard.press('Tab');
await vals.scrollIntoViewIfNeeded();
await shot(p, p.locator('body'), `${NAME}-2-values`);
step('Two values under three products and a total make eight columns. Click the empty grey canvas around the page: the Inspector shows the report\'s own properties. Set Orientation to **Landscape** under Page.');
const cs = p.locator('.cscroll');
const csb = await cs.boundingBox();
await cs.click({ position: { x: 12, y: csb.height - 12 } }); // empty grey canvas, away from the page
await field(p, insp, 'Orientation').selectOption('landscape');

step('Click **Preview**. Each region shows its cities and a total row; click ▼ next to North to close it to one line. Share is each product\'s part of the row\'s total.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
const toggle = p.locator('.vlink.hit[title*="Show or hide"]');
await toggle.first().waitFor({ timeout: 20000 });
await p.locator('.vpage text', { hasText: /^Delhi$/ }).first().waitFor();
await toggle.nth(1).click(); // North closes
await p.locator('.vpage text', { hasText: /^Delhi$/ }).first().waitFor({ state: 'detached' });
await result(p, NAME, 1, 0.6);

step('Type `Pivot table` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Pivot table');
await browser.close();
finish(NAME, errors);
