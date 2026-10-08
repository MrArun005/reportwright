// Recipe: a grouped table with subtotals at two levels, a grand total, and "Page N of M" in the page footer.
// Drives the real designer; writes site/learn/grouped-table.{pw.json,steps.json} and its screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'grouped-table';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');

step('Under **Data**, click **+ Add** next to Data sources. Name it `sales`, URL `/api/sample/sales/2026`, Save.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');
step('Click **+ Add** next to Data sets. Name it `Sales`, path to the rows `$.rows`, click **Detect fields** (it finds 432 rows), Save.');
await addDataSet(p, 'Sales', '$.rows');

step('Drag **Table** from the toolbox onto the Body. In the table gallery untick Year, Region, City and Npa, pick **Grouped**, set Group by to `region`, and click **Insert table**.');
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 30, y: 30 } });
let dlg = p.getByRole('dialog');
for (const c of ['Year', 'Region', 'City', 'Npa']) await dlg.getByLabel(new RegExp(`^${c} ·`)).uncheck();
await dlg.getByText('Grouped', { exact: true }).click();
await field(p, dlg, 'Group by').selectOption('region');
await shot(p, dlg, `${NAME}-1-gallery`);
await dlg.getByRole('button', { name: 'Insert table' }).click();

step('Click the table\'s grip (top-left corner) to select it and set X to `0` in the Inspector. Scroll the Inspector to **Groups**, choose `city` under Field to group by and click **Add group**. The city group gets its own header and a subtotal row.');
await p.locator('.tbl .grip').click();
await field(p, insp, 'X \\(pt\\)').fill('0');
await p.keyboard.press('Tab');
await field(p, insp, 'Field to group by').selectOption('city');
await insp.getByRole('button', { name: 'Add group' }).click();

step('In group 1 (ByRegion) tick **Repeat the group header on each page it continues on**.');
await insp.getByLabel('Repeat the group header on each page it continues on').first().check();

step('Click the ByRegion footer cell that says Subtotal and change its value in the Inspector to `Total {Fields.region}`.');
await p.locator('[data-cell="g0f-0-0"]').click();
await insp.locator('.expr-row input').first().fill('Total {Fields.region}');
await p.keyboard.press('Tab');

step('The two new group rows make the table taller than the Body. Click the **Body** label above the band and set Height to `200`.');
await bandHeight(p, 'Body', 200);
await shot(p, p.locator('.canvas, [data-testid=paper]').first(), `${NAME}-2-groups`);

step('Click the **Page header** label, set Height to `32`. Drag a **Text box** into it, type `Disbursements by region and city, 2026` as its Value, set Width to `523`, Size `14`, Weight Bold.');
await bandHeight(p, 'Page header', 32);
await p.dragAndDrop('[data-tool=textbox]', '[data-section=pageHeader]', { targetPosition: { x: 20, y: 6 } });
await insp.locator('.expr-row input').first().fill('Disbursements by region and city, 2026');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Width \\(pt\\)').fill('523');
await field(p, insp, 'Size').fill('14');
await field(p, insp, 'Weight').selectOption('bold');
await p.keyboard.press('Tab');

step('Click the **Page footer** label, set Height to `24`. Drag a **Text box** into it and give it the Value `Page {Globals.PageNumber} of {Globals.TotalPages}`. Set X `0`, Width `523`, Align Right.');
await bandHeight(p, 'Page footer', 24);
await p.dragAndDrop('[data-tool=textbox]', '[data-section=pageFooter]', { targetPosition: { x: 300, y: 6 } });
await insp.locator('.expr-row input').first().fill('Page {Globals.PageNumber} of {Globals.TotalPages}');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Width \\(pt\\)').fill('523');
await field(p, insp, 'Align').selectOption('right');
await p.keyboard.press('Tab');
await shot(p, p.locator('body'), `${NAME}-3-footer`);

step('Click **Preview**. Each city closes with its subtotal, each region with its total, the last page with the grand total, and every page footer reads Page N of M.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
await p.locator('.vpage text', { hasText: /^Page 1 of \d+$/ }).first().waitFor({ timeout: 20000 })
  .catch(async () => { console.log(await p.locator('.vpage text').allTextContents()); throw new Error('no page footer'); });
await result(p, NAME, 2);

step('Type `Grouped table with subtotals` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Grouped table with subtotals');
await browser.close();
finish(NAME, errors);
