// Phase 8 proof: a theme, a part library (that is also a stylesheet), a master and a content report, each made in
// the Designer UI only: new reports from the home page, then clicks, drags, typing and selects. No JSON is written
// and nothing is posted to the API (the only API calls delete earlier copies and read the saved result).
// PROOF=1 builds the canonical reuse-theme / reuse-parts / reuse-master / reuse-showcase in reports/ and keeps them.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const PROOF = !!process.env.PROOF;
const pre = PROOF ? '' : 'E2E ';
const name = (n) => `${pre}Reuse ${n}`;
const idOf = (n) => name(n).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const ID = { theme: idOf('theme'), parts: idOf('parts'), master: idOf('master'), show: idOf('showcase') };
const step = (s) => console.log('·', s);
const t0 = Date.now();

for (const id of Object.values(ID)) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: { origin: BASE } });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
if (process.env.DEBUG) p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 300)); });
if (process.env.DEBUG) p.on('pageerror', e => console.log('  [pageerror]', e.message));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const insp = () => p.getByTestId('inspector');
/** The input or select of an inspector field, by its label. */
const field = (label, root = insp()) => root.locator('label.field').filter({ has: p.locator(`xpath=./span[normalize-space()=${JSON.stringify(label)}]`) }).locator('input:not([type=color]), select, textarea').first();
const selectReport = async () => { await p.locator('.cscroll').click({ position: { x: 4, y: 4 } }); await insp().getByText('Report', { exact: true }).first().waitFor(); };
const save = async () => { await p.keyboard.press(`${mod}+s`); await p.getByTestId('save-state').filter({ hasText: 'Saved' }).waitFor(); };
const newReport = async (n, id) => {
  await p.goto(BASE);
  // next dev hydrates late: a name typed before that is reset, and the report gets a default name
  await p.waitForFunction(() => { const i = document.querySelector('[aria-label="New report name"]'); return i && Object.keys(i).some(k => k.startsWith('__reactProps')); });
  await p.getByLabel('New report name').fill(n);
  await p.getByRole('button', { name: 'New report' }).click();
  await p.waitForURL(new RegExp(`/designer/${id}`), { timeout: 120000 });
  await p.waitForSelector('[data-testid=paper]');
};
/** Click a tool: the item goes under the body's last item and is selected. */
const addTool = async (tool) => { await p.locator(`[data-tool=${tool}]`).click(); };
const setValue = async (v) => { await insp().locator('.expr-row input').first().fill(v); };
const rename = async (n) => { await p.getByLabel('Item name').fill(n); };
const preview = async () => {
  await p.getByTestId('tab-preview').click();
  await p.waitForSelector('.vpage svg');
  await p.waitForFunction(() => !document.querySelector('[data-testid=viewer] .spinner, .vstatus.running'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);
  return p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
};
const design = async () => { await p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Design' }).click(); await p.waitForSelector('[data-testid=paper]'); };

/* ---------------------------------------------------------------- 1. a theme report */
step('theme report: colours, fonts and a constant');
await newReport(name('theme'), ID.theme);
await selectReport();
const theme = p.getByTestId('theme');
await field('Accent1', theme).fill('#0f766e');
await field('Accent2', theme).fill('#b45309');
await p.getByTestId('theme-font-major').locator('input[type=number]').fill('15');
await p.getByTestId('theme-const-name').fill('Company');
await p.getByTestId('theme-const-add').click();
await p.getByTestId('theme-constants').getByLabel('Company').fill('Asha Traders Pvt Ltd');
await save();

/* ---------------------------------------------------------------- 2. a part library (also the stylesheet) */
step('library: inline sales data');
await newReport(name('parts'), ID.parts);
const regions = ['North', 'South', 'East', 'West'], products = ['Paper', 'Scanner', 'Printer'];
const sales = { rows: Array.from({ length: 24 }, (_, i) => ({ region: regions[i % 4], product: products[i % 3], amount: 1000 + ((i * 377) % 2900) })) };
await p.getByRole('button', { name: '+ Add' }).nth(1).click();
let dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('sales');
await dlg.getByLabel('Type').selectOption('json');
await dlg.getByLabel('JSON data').fill(JSON.stringify(sales));
await dlg.getByRole('button', { name: 'Save' }).click();
await p.getByRole('button', { name: '+ Add' }).nth(2).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('Sales');
await dlg.getByRole('button', { name: 'Explore the response' }).click();
await dlg.getByRole('listitem').filter({ hasText: '$.rows' }).getByRole('button', { name: 'Use' }).click();
await dlg.getByText('Found 24 rows.').waitFor();
await dlg.getByRole('button', { name: 'Save' }).click();

step('library: named styles, one based on another');
await selectReport();
for (const s of ['Brand', 'BrandSmall']) { await insp().getByLabel('New style name').fill(s); await insp().getByRole('button', { name: 'Add', exact: true }).click(); }
await insp().getByLabel('Brand size').fill('14');
await insp().locator('.style-card:has(b:text-is("Brand")) select').first().selectOption('bold');
await insp().getByLabel('Brand colour').fill('#7c2d12');
await p.getByTestId('style-parent-BrandSmall').selectOption('Brand');
await insp().getByLabel('BrandSmall size').fill('9');

step('library: a KPI card published as a part with two properties');
await addTool('container');
await rename('KpiCard');
await p.dragAndDrop('[data-tool=textbox]', '[data-item=KpiCard] .nest', { targetPosition: { x: 8, y: 6 } });
await rename('KpiTitle');
await setValue('=PartProperties.Title');
await field('Named style').selectOption('BrandSmall');
await p.dragAndDrop('[data-tool=textbox]', '[data-item=KpiCard] .nest', { targetPosition: { x: 8, y: 34 } });
await rename('KpiValue');
await setValue('=Format(Sum(Fields.amount) * PartProperties.Factor, "N0")');
await field('Data set').selectOption('Sales');
await field('Named style').selectOption('Brand');
await p.locator('[data-item=KpiCard]').click({ position: { x: 300, y: 100 } });
await p.waitForFunction(() => document.querySelector('[aria-label="Item name"]')?.value === 'KpiCard');
await insp().getByLabel('Publish as a report part').check();
await p.getByTestId('part-name').fill('Kpi');
await p.getByTestId('part-label').fill('KPI card');
for (const prop of ['Title', 'Factor']) { await p.getByTestId('part-prop-new').fill(prop); await p.getByTestId('part-prop-add').click(); }
const props = p.getByTestId('part-properties').locator('.group-card');
await props.nth(0).getByLabel('Default').fill('Total sales');
await props.nth(1).getByLabel('Type').selectOption('number');
await props.nth(1).getByLabel('Default').fill('1');
await save();

/* ---------------------------------------------------------------- 3. a master report */
step('master: themed header, a content placeholder, a closing line');
await newReport(name('master'), ID.master);
await p.locator('[data-item=ReportTitle]').click();
await setValue('=Theme.Constants.Company');
await field('Color').fill('=Theme.Colors.Accent1');
await p.dragAndDrop('[data-tool=textbox]', '[data-section=body]', { targetPosition: { x: 4, y: 6 } });
await rename('MasterIntro');
await setValue('Quarterly sales pack');
await field('Color').fill('=Theme.Colors.Accent2');
await p.dragAndDrop('[data-tool=placeholder]', '[data-section=body]', { targetPosition: { x: 4, y: 34 } });
await rename('Content');
await field('Height (pt)').fill('200');
await p.dragAndDrop('[data-tool=textbox]', '[data-section=body]', { targetPosition: { x: 4, y: 420 } });
await rename('MasterOutro');
await setValue('End of the pack');
await selectReport();
await insp().getByText('This report has a content placeholder').waitFor();
await save();

/* ---------------------------------------------------------------- 4. the content report */
step('showcase: master, stylesheet, theme by parameter');
await newReport(name('showcase'), ID.show);
await p.getByRole('button', { name: '+ Add' }).nth(0).click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Name').fill('ThemeId');
await dlg.getByLabel('Default').fill(ID.theme);
await dlg.getByRole('button', { name: 'Save' }).click();
await selectReport();
await p.getByTestId('master-picker').selectOption(ID.master);
await p.getByTestId('sheet-picker').selectOption(ID.parts);
await p.getByTestId('theme-source').selectOption('expr');
await p.getByTestId('theme-expr').fill('=Parameters.ThemeId');
await p.locator(`[data-master=${ID.master}] [data-master-item=MasterOutro]`).first().waitFor(); // the master shows, locked

step('showcase: report parts, linked and copied');
await p.getByTestId('library-picker').selectOption(ID.parts);
await p.getByTestId('library-add').click();
await p.getByTestId('part-insert-Kpi').click();
await p.locator('[data-item=Reportpart1]').waitFor();
await rename('KpiTotal');
await p.getByTestId('part-insert-Kpi').click();
await p.locator('[data-item=Reportpart1]').waitFor();
await rename('KpiWithTax');
await field('Title', p.getByTestId('part-instance')).fill('With tax');
await field('Factor', p.getByTestId('part-instance')).fill('1.18');
await p.getByTestId('part-copy-Kpi').click();
await p.locator('[data-item=Container1]').waitFor();
await rename('KpiCopy');
await field('Title', p.getByTestId('part-values')).fill('Copied card');

step('showcase: a pivot from the pivot wizard, a chart from instant visuals');
await p.getByTestId('pivot-wizard-Sales').click();
dlg = p.getByRole('dialog');
await dlg.getByTestId('pv-rows-region').click();
await dlg.getByTestId('pv-columns-product').click();
await dlg.getByTestId('pv-values-amount').click();
await dlg.getByTestId('pv-values-amount').click();
await dlg.getByTestId('pv-show-1').selectOption('percentOfTotal');
await dlg.getByTestId('pivot-preview').locator('svg').waitFor();
await dlg.getByTestId('pivot-wizard-insert').click();
await p.getByTestId('instant-Sales').click();
dlg = p.getByRole('dialog');
await dlg.getByLabel('Product · string').uncheck();
await dlg.getByLabel('Amount · number').check();
await dlg.locator('[data-visual=chart] svg').waitFor();
await dlg.locator('[data-visual=chart]').click();

step('showcase: a style from the stylesheet');
await addTool('textbox');
await rename('Styled');
await setValue('Styled from the sheet');
await field('Named style').selectOption('BrandSmall');

step('showcase: layers (screen only, designer only)');
for (const [n, target] of [['ScreenOnly', 'screen'], ['Notes', 'design']]) {
  await p.getByTestId('layer-new').fill(n);
  await p.getByTestId('layer-add').click();
  await p.getByTestId(`layer-target-${n}`).selectOption(target);
}
await addTool('textbox');
await rename('OnScreen');
await setValue('Shown on screen only');
await p.getByTestId('item-layer').selectOption('ScreenOnly');
await addTool('textbox');
await rename('DesignNote');
await setValue('Design note');
await p.getByTestId('item-layer').selectOption('Notes');

step('showcase: cell mode refuses an overlap');
await p.getByTestId('cell-mode').check();
await addTool('textbox');
await rename('InCells');
await setValue('Placed in cell mode');
await p.locator('[data-item=OnScreen]').scrollIntoViewIfNeeded();
await p.locator('[data-item=InCells]').scrollIntoViewIfNeeded();
const before = await p.locator('[data-item=InCells]').boundingBox();
const target = await p.locator('[data-item=OnScreen]').boundingBox();
await p.mouse.move(before.x + 5, before.y + 5);
await p.mouse.down();
await p.mouse.move(target.x + 8, target.y + 6, { steps: 6 });
await p.mouse.up();
await p.getByText('Those cells are taken').first().waitFor();
const after = await p.locator('[data-item=InCells]').boundingBox();
assert.equal(Math.round(after.y), Math.round(before.y), 'the overlapping move was refused');
await p.getByTestId('cell-mode').uncheck();

step('showcase: a second page (body section) with an overflow placeholder for a fixed table frame');
await p.locator('.band-label').filter({ hasText: /^Body/ }).first().click();
await p.getByTestId('add-body-section').click();
await p.dragAndDrop('[data-tool=overflow]', '[data-section="body:1"]', { targetPosition: { x: 4, y: 10 } });
await rename('MoreRows');
await field('Height (pt)').fill('180');
const bodyBox = await p.locator('[data-section=body]').boundingBox();
await p.dragAndDrop('.trow .nm:has(b:text-is("Sales"))', '[data-section=body]', { targetPosition: { x: 0, y: bodyBox.height - 12 } });
await p.waitForSelector('.tbl');
await p.locator('.tbl').last().locator('.grip').click();
await rename('Lines');
await p.getByTestId('overflow-target').selectOption('MoreRows');
await save();

step('preview: everything together');
let t = await preview();
for (const s of ['Asha Traders Pvt Ltd', 'Quarterly sales pack', 'End of the pack', 'Total sales', 'With tax', 'Copied card', 'Shown on screen only', 'Styled from the sheet', 'Region', 'Amount']) assert.ok(t.includes(s), `preview shows "${s}" (got ${t.slice(0, 80).join(' | ')})`);
assert.ok(!t.includes('Design note'), 'a designer-only layer is not rendered');
assert.ok(t.some(x => /%$/.test(x)), 'the pivot shows % of total');
const total = sales.rows.reduce((a, r) => a + r.amount, 0);
const nf = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
assert.ok(t.includes(nf(total)) && t.includes(nf(total * 1.18)) , 'KPI values from the part (total and with tax)');
const perPage = await p.$$eval('.vpage', ps => ps.map(pg => [...pg.querySelectorAll('text')].map(n => n.textContent)));
// section 1's table frame shows its first rows; the rest continue in the overflow placeholder of section 2, which
// repeats page after page with the header each time
const firstRow = (pg) => (pg.indexOf('Amount') >= 0 ? pg.slice(pg.indexOf('Amount') + 1, pg.indexOf('Amount') + 3).join('|') : null); // region and product: a region alone repeats
const cont = perPage.slice(1).filter(pg => pg.includes('Region') && pg.includes('Product'));
assert.ok(cont.length >= 3 && new Set(cont.map(firstRow)).size === cont.length, `the overflow placeholder continues the table on the next pages, header repeated (${cont.length} pages)`);
await design();

step('the library changes: every linked instance follows');
await p.goto(`${BASE}/designer/${ID.parts}`);
await p.waitForSelector('[data-testid=paper]');
await p.locator('[data-item=KpiTitle]').click();
await setValue('=UCase(PartProperties.Title)');
await save();
await p.goto(`${BASE}/designer/${ID.show}`);
await p.waitForSelector('[data-testid=paper]');
t = await preview();
assert.ok(t.includes('WITH TAX') && t.includes('TOTAL SALES'), 'linked parts show the library change');
assert.ok(t.includes('Copied card'), 'the copy keeps its own items');

const saved = await (await fetch(`${BASE}/api/reports/${ID.show}`)).json();
assert.equal(saved.master, ID.master);
assert.equal(saved.styles.sheet, ID.parts);
assert.deepEqual(saved.layers.map(l => [l.name, l.target]), [['ScreenOnly', 'screen'], ['Notes', 'design']]);
assert.ok(Array.isArray(saved.sections.body) && saved.sections.body[1].items.some(i => i.type === 'overflow'));
assert.ok(saved.sections.body[0].items.filter(i => i.type === 'part').length === 2);
await b.close();
if (!PROOF) for (const id of Object.values(ID)) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: { origin: BASE } });
assert.deepEqual(errs, []);
console.log(`PASS reuse (theme, library + stylesheet, master, content report with parts, pivot wizard, instant visuals, layers, cell mode, overflow; built in the Designer in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
