// Recipe: cascading parameters. Region lists the regions; City lists only the chosen region's cities; the table shows
// that city. Drives the real designer; writes site/learn/cascading-parameters.{pw.json,steps.json} and screenshots.
import { open, result, save, shot, step, finish, field, addRestSource, addDataSet, bandHeight } from './_harness.mjs';

const NAME = 'cascading-parameters';
const { browser, page: p, errors } = await open();
const insp = p.getByTestId('inspector');
const filter = (expr, value) => async (dlg) => {
  await dlg.getByRole('button', { name: 'Add filter' }).click();
  await dlg.getByLabel('Filter field').last().fill(expr);
  await dlg.getByLabel('Filter value').last().fill(value);
};
const addParam = async (name, prompt, def, dataSet, valueField) => {
  await p.getByRole('button', { name: '+ Add' }).nth(0).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('Prompt').fill(prompt);
  await dlg.getByLabel('Default').fill(def);
  await field(p, dlg, 'Or choices from a data set').selectOption(dataSet);
  await dlg.getByTestId('param-value-field').selectOption(valueField);
  return dlg;
};

step('Under **Data**, add a REST data source `sales` with URL `/api/sample/sales/2026`.');
await addRestSource(p, 'sales', '/api/sample/sales/2026');

step('Add a data set `Regions` with path `$.regions` and click **Detect fields** (4 rows, one per region). This is the list for the first parameter.');
await addDataSet(p, 'Regions', '$.regions');

step('Click **+ Add** next to Parameters. Name `region`, Prompt `Region`, Default `North`. Under **Or choices from a data set** pick `Regions`, and `name` as the value field. Save.');
let dlg = await addParam('region', 'Region', 'North', 'Regions', 'name');
await shot(p, dlg, `${NAME}-1-parameter`);
await dlg.getByRole('button', { name: 'Save' }).click();

step('Add a data set `Cities` with path `$.rows`, **Detect fields**, then **Add filter**: field `=Fields.region`, operator `=`, value `=Parameters.region`. Save. This list now holds only the chosen region\'s rows.');
await addDataSet(p, 'Cities', '$.rows', { before: filter('=Fields.region', '=Parameters.region') });

step('Add a parameter `city`, Prompt `City`, Default `Delhi`, choices from the data set `Cities` with `city` as the value field. The designer notes that the list cascades. Save.');
dlg = await addParam('city', 'City', 'Delhi', 'Cities', 'city');
await shot(p, dlg, `${NAME}-2-cascade`);
await dlg.getByRole('button', { name: 'Save' }).click();

step('Add a data set `Sales` with path `$.rows`, **Detect fields**, and two filters: `=Fields.region` = `=Parameters.region`, and `=Fields.city` = `=Parameters.city`.');
await addDataSet(p, 'Sales', '$.rows', { before: async (d) => { await filter('=Fields.region', '=Parameters.region')(d); await filter('=Fields.city', '=Parameters.city')(d); } });

step('Drag **Table** onto the Body. In the gallery pick the `Sales` data set, untick Year, Region, City and Npa, keep **List**, and click **Insert table**. Select it by its grip and set X to `0`.');
await p.dragAndDrop('[data-tool=table]', '[data-section=body]', { targetPosition: { x: 30, y: 40 } });
dlg = p.getByRole('dialog');
await field(p, dlg, 'Data set').selectOption('Sales');
for (const c of ['Year', 'Region', 'City', 'Npa']) await dlg.getByLabel(new RegExp(`^${c} ·`)).uncheck();
await dlg.getByRole('button', { name: 'Insert table' }).click();
await p.locator('.tbl .grip').click();
await field(p, insp, 'X \\(pt\\)').fill('0');
await p.keyboard.press('Tab');

step('Click the **Page header** label, set Height to `32`, drag a **Text box** into it with the Value `{Parameters.city}, {Parameters.region} region: 2026`, X `0`, Width `523`, Size `14`, Weight Bold.');
await bandHeight(p, 'Page header', 32);
await p.dragAndDrop('[data-tool=textbox]', '[data-section=pageHeader]', { targetPosition: { x: 20, y: 6 } });
await insp.locator('.expr-row input').first().fill('{Parameters.city}, {Parameters.region} region: 2026');
await field(p, insp, 'X \\(pt\\)').fill('0');
await field(p, insp, 'Width \\(pt\\)').fill('523');
await field(p, insp, 'Size').fill('14');
await field(p, insp, 'Weight').selectOption('bold');
await p.keyboard.press('Tab');
await shot(p, p.locator('body'), `${NAME}-3-design`);

step('Click **Preview**. Region shows North and City offers Delhi, Jaipur and Lucknow. Pick South: City now offers only the southern cities.');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
await p.locator('.vpage text', { hasText: /^Delhi, North region: 2026$/ }).first().waitFor({ timeout: 20000 });
await p.getByRole('button', { name: 'Parameters' }).click();
await p.waitForTimeout(500);
const cityOpts = () => p.getByLabel('City', { exact: true }).evaluate(n => [...n.options].map(o => o.value).filter(Boolean).join(','));
console.log('North:', await cityOpts());
await p.getByLabel('Region', { exact: true }).selectOption('South');
await p.waitForTimeout(1500);
const south = await cityOpts();
if (south !== 'Bengaluru,Chennai,Hyderabad') throw new Error(`City did not cascade: ${south}`);

step('Pick Chennai under City. The table and the title follow both choices.');
await p.getByLabel('City', { exact: true }).selectOption('Chennai');
await p.locator('.vpage text', { hasText: /^Chennai, South region: 2026$/ }).first().waitFor({ timeout: 20000 });
await p.waitForTimeout(500);
await shot(p, p.locator('body'), `${NAME}-4-preview`);
await result(p, NAME, 1, 0.62);

step('Type `Cascading parameters` over *New report* at the top left and press **Save**.');
await save(p, NAME, 'Cascading parameters');
await browser.close();
finish(NAME, errors);
