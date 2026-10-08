// Recipe: drill-down (each region opens to its cities) and drill-through (a city opens the city report with its
// parameters filled in). Drives the real designer; writes site/learn/drill-through.{pw.json,steps.json} and screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'drill-through';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');
const setCell = async (cell, value, format) => {
  await p.locator(`[data-cell="${cell}"]`).click();
  await insp.locator('.expr-row input').first().fill(value);
  if (format) await field(p, insp, 'Format \\(C2, N0, dd MMM yyyy\\)').fill(format);
  await p.keyboard.press('Tab');
};

step('Under **Data**, add a REST data source `sales` with URL `/api/sample/sales/2026`, then a data set `Sales` with path `$.rows`; **Detect fields** finds 432 rows.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');
await addDataSet(p, 'Sales', '$.rows');

step('Drag **Table** onto the Body. In the gallery untick Year, Month, Product and Npa, pick **Summary**, set Group by to `region`, and click **Insert table**. You get one row per region with its totals.');
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 30, y: 30 } });
const dlg = p.getByRole('dialog');
for (const c of ['Year', 'Month', 'Product', 'Npa']) await dlg.getByLabel(new RegExp(`^${c} ·`)).uncheck();
await dlg.getByText('Summary', { exact: true }).click();
await field(p, dlg, 'Group by').selectOption('region');
await dlg.getByRole('button', { name: 'Insert table' }).click();

step('Select the table by its grip, set X to `0`, then under **Groups** choose `city` in Field to group by and click **Add group**.');
await p.locator('.tbl .grip').click();
await field(p, insp, 'X \\(pt\\)').fill('0');
await p.keyboard.press('Tab');
await field(p, insp, 'Field to group by').selectOption('city');
await insp.getByRole('button', { name: 'Add group' }).click();

step('Give each city its totals: click the empty Loans cell of the City header row and set Value `=Sum(Fields.loans)`, Format `N0`; the Disbursed cell gets `=Sum(Fields.disbursed)`, Format `N2`, as in the region row.');
await setCell('g1h-0-1', '=Sum(Fields.loans)', 'N0');
await setCell('g1h-0-2', '=Sum(Fields.disbursed)', 'N2');

step('A city needs no footer here: click the `Subtotal {Fields.city}` cell and press **Delete row** under Structure in the Inspector.');
await p.locator('[data-cell="g1f-0-0"]').click();
await insp.getByRole('button', { name: 'Delete row', exact: true }).click();

step('Drill-down: select the table again and, in group 1 (ByRegion), tick **Drill-down: show a toggle**. Each region now starts closed behind a ▶.');
await p.locator('.tbl .grip').click();
await insp.getByLabel('Drill-down: show a toggle').first().check();
await shot(p, p.locator('body'), `${NAME}-1-drilldown`);

step('Drill-through: click the `=Fields.city` cell. Under Interactivity set **Action on click** to *Open another report (drill-through)* and type `sales-city` as the Report. Its parameters are listed: set city to `=Fields.city` and year to `2026`. Set the cell\'s Color to `#1d4ed8` so it reads as a link.');
await p.locator('[data-cell="g1h-0-0"]').click();
await field(p, insp, 'Action on click').selectOption('report');
await insp.getByTestId('report-picker').fill('sales-city');
await p.keyboard.press('Tab');
const pmap = insp.getByTestId('pmap-report');
await pmap.locator('[data-param=city] input').fill('=Fields.city');
await pmap.locator('[data-param=year] input').fill('2026');
await p.keyboard.press('Tab');
await insp.locator('label.field', { hasText: /^Color/ }).nth(1).locator('input.mono').fill('#1d4ed8'); // the cell's Text colour (the first is the row's)
await p.keyboard.press('Tab');
await pmap.scrollIntoViewIfNeeded();
await shot(p, p.locator('body'), `${NAME}-2-action`);

step('Click the **Page header** label, set Height to `32`, drag a **Text box** into it with the Value `Disbursed by region, 2026: open a region, click a city`, X `0`, Width `523`, Size `13`, Weight Bold.');
await bandHeight(p, 'Page header', 32);
await p.dragAndDrop('[data-tool=textbox]', '[data-section=pageHeader]', { targetPosition: { x: 20, y: 6 } });
await insp.locator('.expr-row input').first().fill('Disbursed by region, 2026: open a region, click a city');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Width \\(pt\\)').fill('523');
await field(p, insp, 'Size').fill('13');
await field(p, insp, 'Weight').selectOption('bold');
await p.keyboard.press('Tab');

step('Click **Preview**. The four regions show closed; ▶ opens one to its cities, with each city\'s totals.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
const toggle = p.locator('.vlink.hit[title*="Show or hide"]');
await toggle.first().waitFor({ timeout: 20000 });
await toggle.nth(1).click(); // North
await p.locator('.vpage text', { hasText: /^Delhi$/ }).first().waitFor();
await result(p, NAME, 1, 0.32);

step('Click a blue city name: the city report opens in the same viewer with that city and year, and the breadcrumb leads back.');
await p.locator('.vlink.hit[title="Open sales-city"]').first().click();
await p.locator('nav.vcrumbs li').nth(1).waitFor({ timeout: 20000 });
await p.locator('.vpage text', { hasText: /^Delhi$/ }).first().waitFor({ timeout: 20000 });
await p.waitForTimeout(800);
await shot(p, p.locator('body'), `${NAME}-3-drilled`);
console.log('crumbs:', await p.locator('nav.vcrumbs li').allTextContents());

step('Type `Drill-down and drill-through` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Drill-down and drill-through');
await browser.close();
finish(NAME, errors);
