// Recipe: a combo chart, columns on the left axis and a line on a second axis on the right.
// Drives the real designer; writes site/learn/combo-chart.{pw.json,steps.json} and its screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'combo-chart';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');

step('Under **Data**, add a REST data source `sales` with URL `/api/sample/sales/2026`, then a data set `Sales` with path `$.rows`; **Detect fields** finds 432 rows.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');
await addDataSet(p, 'Sales', '$.rows');

step('Drag **Chart** onto the Body. In the chart gallery set Category to `month`, Value to **Sum** of `disbursed`, pick **Column** and click **Insert chart**. The designer shows months as Jan, Feb, … on its own.');
await p.dragAndDrop('[data-tool=chart]', '[data-section=body]', { targetPosition: { x: 10, y: 10 } });
const dlg = p.getByRole('dialog');
await field(p, dlg, 'Category \\(x axis or slices\\)').selectOption('month');
await field(p, dlg, 'Value').selectOption('Sum');
await field(p, dlg, 'of field').selectOption('disbursed');
await dlg.getByRole('radio', { name: 'Column', exact: true }).click();
await shot(p, dlg, `${NAME}-1-gallery`);
await dlg.getByTestId('chart-wizard-apply').click();

step('With the chart selected, set X to `0`, Width to `523` and Height to `300` under Position, and Title to `Disbursed and loans by month, 2026`.');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Width \\(pt\\)').fill('523');
await field(p, insp, 'Height \\(pt\\)').fill('300');
await field(p, insp, 'Title').first().fill('Disbursed and loans by month, 2026');
await p.keyboard.press('Tab');

step('Under **Chart**, click **Add series**. Name the new series `Loans`, give it the value `=Sum(Fields.loans)`, set Draw as **Line** and Axis **Secondary**.');
await insp.getByRole('button', { name: 'Add series' }).click();
const s1 = insp.getByTestId('series-1');
await s1.getByLabel('Series name').fill('Loans');
await s1.locator('input.mono').fill('=Sum(Fields.loans)');
await s1.getByLabel('Series type').selectOption('line');
await s1.getByLabel('Series axis').selectOption('secondary');
await p.keyboard.press('Tab');
await s1.scrollIntoViewIfNeeded();
await shot(p, p.locator('body'), `${NAME}-2-series`);

step('Under **Axes**, a Secondary value axis section has appeared. Give the value axis the title `Disbursed, ₹ million` (its format `#,##0,,"M"` was set by the gallery) and the secondary axis the title `Loans` with Number format `N0`.');
await insp.getByLabel('Value axis (y) title').fill('Disbursed, ₹ million');
const y2 = insp.getByTestId('axis-y2');
await y2.locator('label.field', { hasText: 'Title' }).locator('input').fill('Loans');
await y2.locator('label.field', { hasText: 'Number format' }).locator('input').fill('N0');
await p.keyboard.press('Tab');
await y2.scrollIntoViewIfNeeded();

step('Click the **Body** label and set its Height to `320` so the band fits the chart.');
await bandHeight(p, 'Body', 320);
await shot(p, p.locator('body'), `${NAME}-3-axes`);

step('Click **Preview**: twelve columns on the left axis and the loans line on its own scale on the right.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
await p.waitForTimeout(800);
await result(p, NAME, 1, 0.45);

step('Type `Combo chart on two axes` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Combo chart on two axes');
await browser.close();
finish(NAME, errors);
