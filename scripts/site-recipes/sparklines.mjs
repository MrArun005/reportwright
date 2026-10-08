// Recipe: a sparkline and a data bar in every row of a summary table.
// Drives the real designer; writes site/learn/sparklines.{pw.json,steps.json} and its screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'sparklines';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');
/** The cell's own Value is the first "Value" in the Inspector; the visual's is the second. */
const visualValue = () => insp.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: /^Value$/ }) }).nth(1).locator('input').first();
const cellValue = async (cell, v) => { await p.locator(`[data-cell="${cell}"]`).click(); await insp.locator('.expr-row input').first().fill(v); await p.keyboard.press('Tab'); };

step('Under **Data**, add a REST data source `sales` with URL `/api/sample/sales/2026`, then a data set `Sales` with path `$.rows`; **Detect fields** finds 432 rows.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');
await addDataSet(p, 'Sales', '$.rows');

step('Drag **Table** onto the Body. In the gallery untick everything but City and Disbursed, pick **Summary**, Group by `city`, and click **Insert table**: one row per city with its total.');
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 30, y: 30 } });
const dlg = p.getByRole('dialog');
for (const c of ['Year', 'Month', 'Region', 'Product', 'Loans', 'Npa']) await dlg.getByLabel(new RegExp(`^${c} ·`)).uncheck();
await dlg.getByText('Summary', { exact: true }).click();
await field(p, dlg, 'Group by').selectOption('city');
await dlg.getByRole('button', { name: 'Insert table' }).click();

step('Click the Disbursed cell of the city row and press **Column right** twice under Structure in the Inspector. Name the new header cells `Month by month` and `Loans`.');
await p.locator('[data-cell="g0h-0-1"]').click();
await insp.getByRole('button', { name: 'Column right', exact: true }).click();
await insp.getByRole('button', { name: 'Column right', exact: true }).click();
await cellValue('header-0-2', 'Month by month');
await cellValue('header-0-3', 'Loans');

step('Click the city row\'s new third cell. Under **Visual** set Cell shows to **Sparkline**, One point per `=Fields.month`, and Value `=Sum(Fields.disbursed)`.');
await p.locator('[data-cell="g0h-0-2"]').click();
await field(p, insp, 'Cell shows').selectOption('sparkline');
await field(p, insp, 'One point per').fill('=Fields.month');
await visualValue().fill('=Sum(Fields.disbursed)');
await p.keyboard.press('Tab');
await shot(p, p.locator('body'), `${NAME}-1-sparkline`);

step('Click the fourth cell. Set Cell shows to **Data bar**, Value `=Sum(Fields.loans)` and tick **Show the value**. Leave Maximum empty: each bar is then measured against the largest city.');
await p.locator('[data-cell="g0h-0-3"]').click();
await field(p, insp, 'Cell shows').selectOption('databar');
await visualValue().fill('=Sum(Fields.loans)');
await insp.getByLabel('Show the value').check();
await field(p, insp, 'Value format').fill('N0');
await p.keyboard.press('Tab');

step('The new columns made the table wider than the page. Select the table by its grip, set X to `0`, and under **Columns** set the widths #1 to #4 to `140`, `130`, `170` and `83` (523 pt, the width between the margins). Then click the **Body** label and set its Height to `120`.');
await p.locator('.tbl .grip').click();
await field(p, insp, 'X \\(pt\\)').fill('0');
await p.keyboard.press('Tab');
for (const [i, w] of [140, 130, 170, 83].entries()) await insp.getByLabel(`#${i + 1}`, { exact: true }).fill(String(w));
await p.keyboard.press('Tab');
await bandHeight(p, 'Body', 120);
await shot(p, p.locator('body'), `${NAME}-2-databar`);

step('Click **Preview**: twelve cities, each with its year as a line and its loans as a bar.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
await p.locator('.vpage text', { hasText: /^Pune$/ }).first().waitFor({ timeout: 20000 });
await result(p, NAME, 1, 0.42);

step('Type `Sparklines and data bars` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Sparklines and data bars');
await browser.close();
finish(NAME, errors);
