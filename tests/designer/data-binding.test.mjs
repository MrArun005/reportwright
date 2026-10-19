// Data binding: data sources, data sets and parameters through their dialogs, fields dragged onto the page, into a
// list or container and into table cells, the table gallery, and what happens to expressions when a field, a data set
// or a parameter is renamed (updated, or flagged in the Issues list and under the field).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, Designer, assertSaneGeometry } from './harness.mjs';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

async function until(fn, ms = 3000) {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 40));
    v = await fn();
  }
  return v;
}
const ROWS = [
  { id: 1, region: 'North', amount: 10, when: '2026-01-05' },
  { id: 2, region: 'South', amount: -4, when: '2026-02-11' },
  { id: 3, region: 'North', amount: 7, when: '2026-03-02' },
];
const FIELDS = [
  { name: 'id', type: 'number' },
  { name: 'region', type: 'string' },
  { name: 'amount', type: 'number' },
  { name: 'when', type: 'date' },
];
/** A report with an inline JSON source and a data set "Sales" with its fields. */
const withData = (items = [], more = {}) =>
  report(items, {
    dataSources: [{ name: 'src', type: 'json', data: ROWS }],
    dataSets: [{ name: 'Sales', source: 'src', path: '$', fields: FIELDS }],
    ...more,
  });
const pane = (d, title) => d.page.locator('.pane', { has: d.page.locator(`h4:has-text("${title}")`) });
const dialog = (d) => d.page.getByRole('dialog');
/** A dialog field by its caption. */
const dctl = (d, label) =>
  dialog(d)
    .locator('label.field', { has: d.page.locator(`span:text-is(${JSON.stringify(label)})`) })
    .locator('input, select, textarea')
    .first();
const insp = (d) => d.page.getByTestId('inspector');
const ictl = (d, label) =>
  insp(d)
    .locator('label.field', { has: d.page.locator(`span:text-is(${JSON.stringify(label)})`) })
    .locator('input, select, textarea')
    .first();
/** The confirm and alert texts the page showed, answered with `answer` (true: OK). */
function dialogs(d, answer = true) {
  const seen = [];
  d.page.on('dialog', async (dl) => {
    seen.push(`${dl.type()}: ${dl.message()}`);
    if (answer) await dl.accept();
    else await dl.dismiss();
  });
  return seen;
}
/** The lines of the Issues list (opened to read them; `keepOpen` leaves it open for a click). */
async function issueLines(d, keepOpen = false) {
  if (await d.page.getByTestId('issues-none').count()) return [];
  if ((await d.page.getByTestId('issues-list').count()) === 0) await d.page.getByTestId('issues').click();
  const lines = await d.page.getByTestId('issues-list').locator('li').allInnerTexts();
  if (!keepOpen) await d.page.getByTestId('issues').click();
  return lines;
}
/**
 * HTML5 drag and drop as the browser fires it: dragstart on the source (it fills the DataTransfer), then dragenter,
 * dragover and drop on the target at a point inside it (fraction fx, fy of its box).
 */
async function dragDrop(d, source, target, fx = 0.3, fy = 0.3) {
  const box = await target.boundingBox();
  const x = box.x + box.width * fx,
    y = box.y + box.height * fy;
  const src = await source.elementHandle(),
    dst = await target.elementHandle();
  await d.page.evaluate(
    ([s, t, cx, cy]) => {
      const dt = new DataTransfer();
      const opts = { dataTransfer: dt, bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
      s.dispatchEvent(new DragEvent('dragstart', opts));
      // the innermost element under the point, as the browser targets it
      const root = t.getRootNode();
      const at = (root.elementFromPoint ? root.elementFromPoint(cx, cy) : null) || t;
      const hit = t.contains(at) ? at : t;
      hit.dispatchEvent(new DragEvent('dragenter', opts));
      hit.dispatchEvent(new DragEvent('dragover', opts));
      hit.dispatchEvent(new DragEvent('drop', opts));
      s.dispatchEvent(new DragEvent('dragend', opts));
    },
    [src, dst, x, y],
  );
}
const chip = (d, ds, f) => d.page.getByTestId(`fields-${ds}`).locator(`li.field-chip[data-field="${f}"]`);
/** Click an item and wait until it is the selection (try again when a click lands while the page lays out). */
async function select(d, name) {
  for (let k = 0; k < 3; k++) {
    await d.click(name);
    if (await until(async () => (await d.selected()).includes(name), 1500)) return;
  }
  assert.fail(`${name} could not be selected`);
}

/* ------------------------------------------------------------------ data sources */

test('add an inline JSON data source: name and JSON are checked, Save writes it', async () => {
  const d = await env.open(report([]));
  assert.equal(await d.page.getByTestId('no-source').count(), 1, 'says there is no source');
  await pane(d, 'Data sources').getByRole('button', { name: '+ Add' }).click();
  await dialog(d).waitFor();
  const save = dialog(d).getByRole('button', { name: 'Save', exact: true });
  assert.equal(await save.isDisabled(), true, 'no name yet');
  await dctl(d, 'Name').fill('1bad');
  await dialog(d).locator('.err').waitFor();
  await dctl(d, 'Name').fill('orders');
  await dctl(d, 'Type').selectOption('json');
  await dctl(d, 'JSON data').fill('[{"id": 1, "total": 5}');
  assert.match(await dialog(d).locator('.err').innerText(), /JSON is not valid/);
  assert.equal(await save.isDisabled(), true);
  await dctl(d, 'JSON data').fill('[{"id": 1, "total": 5}, {"id": 2, "total": 7.5}]');
  assert.equal(await save.isDisabled(), false);
  await save.click();
  await dialog(d).waitFor({ state: 'detached' });
  const def = await d.def();
  assert.deepEqual(def.dataSources, [
    {
      name: 'orders',
      type: 'json',
      data: [
        { id: 1, total: 5 },
        { id: 2, total: 7.5 },
      ],
    },
  ]);
  assert.equal(await d.page.getByTestId('no-source').count(), 0);
  // a second source with the same name is refused
  await pane(d, 'Data sources').getByRole('button', { name: '+ Add' }).click();
  await dctl(d, 'Name').fill('orders');
  assert.match(await dialog(d).locator('.err').innerText(), /Another source has this name/);
  await dialog(d).getByRole('button', { name: 'Cancel' }).click();
  d.expectClean();
});

test('a data source dialog with changes asks before Escape drops them; without changes Escape just closes', async () => {
  const d = await env.open(withData());
  const seen = dialogs(d, false); // first answer: keep editing
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit src' }).click();
  await dialog(d).waitFor();
  await d.page.keyboard.press('Escape');
  await dialog(d).waitFor({ state: 'detached' });
  assert.deepEqual(seen, [], 'no question without changes');
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit src' }).click();
  await dctl(d, 'Name').fill('src2');
  await d.page.keyboard.press('Escape');
  await until(async () => seen.length === 1);
  assert.match(seen[0], /^confirm: Discard your changes\?/);
  assert.equal(await dialog(d).count(), 1, 'dismissed: the dialog stays');
  d.page.removeAllListeners('dialog');
  const seen2 = dialogs(d, true);
  await d.page.keyboard.press('Escape');
  await dialog(d).waitFor({ state: 'detached' });
  assert.equal(seen2.length, 1);
  assert.equal((await d.def()).dataSources[0].name, 'src', 'discarded');
  // a click outside asks too
  d.page.removeAllListeners('dialog');
  const seen3 = dialogs(d, false);
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit src' }).click();
  await dctl(d, 'Name').fill('src3');
  await d.page.locator('.scrim').click({ position: { x: 5, y: 5 } });
  await until(async () => seen3.length === 1);
  assert.equal(await dialog(d).count(), 1);
  await dialog(d).getByRole('button', { name: 'Cancel' }).click(); // the footer's Cancel does not ask
  assert.equal(seen3.length, 1);
  d.expectClean();
});

test('renaming a data source: its data sets follow; deleting a source in use is refused, an unused one goes', async () => {
  const d = await env.open(
    withData([], {
      dataSources: [
        { name: 'src', type: 'json', data: ROWS },
        { name: 'spare', type: 'json', data: [] },
      ],
    }),
  );
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit src' }).click();
  await dctl(d, 'Name').fill('orders');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  let def = await d.def();
  assert.equal(def.dataSources[0].name, 'orders');
  assert.equal(def.dataSets[0].source, 'orders', 'the data set follows the rename');
  const seen = dialogs(d, true);
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit orders' }).click();
  await dialog(d).getByRole('button', { name: 'Delete' }).click();
  await until(async () => seen.length === 1);
  assert.match(seen[0], /^alert: A data set still uses this source/);
  def = await d.def();
  assert.equal(def.dataSources.length, 2, 'not deleted');
  await dialog(d).getByRole('button', { name: 'Cancel' }).click();
  await pane(d, 'Data sources').getByRole('button', { name: 'Edit spare' }).click();
  await dialog(d).getByRole('button', { name: 'Delete' }).click();
  def = await d.def();
  assert.deepEqual(
    def.dataSources.map((s) => s.name),
    ['orders'],
  );
  d.expectClean();
});

/* ------------------------------------------------------------------ data sets */

test('add a data set, detect its fields, the field list shows them; edit and remove a field', async () => {
  const d = await env.open(withData([], { dataSets: [] }));
  await pane(d, 'Data sets').getByRole('button', { name: '+ Add' }).click();
  await dialog(d).waitFor();
  await dctl(d, 'Name').fill('Orders');
  await dialog(d).getByRole('button', { name: 'Detect fields' }).click();
  await dialog(d).getByText('Found 3 rows.').waitFor();
  const names = await dialog(d)
    .getByLabel('Field name')
    .evaluateAll((es) => es.map((e) => e.value));
  assert.deepEqual(names, ['id', 'region', 'amount', 'when']);
  // a calculated field, and one removed
  await dialog(d).getByRole('button', { name: 'Add field' }).click();
  await dialog(d).getByLabel('Field name').last().fill('double');
  await dialog(d)
    .locator('input[placeholder]')
    .last()
    .fill('=Fields.amount * 2')
    .catch(() => {});
  await dialog(d).getByRole('button', { name: 'Remove field' }).nth(0).click();
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const ds = (await d.def()).dataSets[0];
  assert.equal(ds.name, 'Orders');
  assert.equal(ds.source, 'src');
  assert.deepEqual(
    ds.fields.map((f) => f.name),
    ['region', 'amount', 'when', 'double'],
  );
  assert.equal(ds.fields.find((f) => f.name === 'amount').type, 'number');
  await d.page.getByTestId('fields-Orders').waitFor();
  const chips = await d.page
    .getByTestId('fields-Orders')
    .locator('li.field-chip')
    .evaluateAll((es) => es.map((e) => e.dataset.field));
  assert.deepEqual(chips, ['region', 'amount', 'when', 'double']);
  // a data set with the same name is refused
  await pane(d, 'Data sets').getByRole('button', { name: '+ Add' }).click();
  await dctl(d, 'Name').fill('Orders');
  assert.match(await dialog(d).locator('.err').innerText(), /Another data set has this name/);
  await dialog(d).getByRole('button', { name: 'Cancel' }).click();
  d.expectClean();
});

test('a data set with no declared fields: the field list shows the ones read from the inline rows', async () => {
  const d = await env.open(withData([], { dataSets: [{ name: 'Sales', source: 'src', path: '$' }] }));
  await d.page.getByTestId('detected-Sales').waitFor();
  const chips = await d.page
    .getByTestId('fields-Sales')
    .locator('li.field-chip')
    .evaluateAll((es) => es.map((e) => e.dataset.field));
  assert.deepEqual(chips.sort(), ['amount', 'id', 'region', 'when']);
  d.expectClean();
});

test('a data set dialog with changes asks before Escape drops them', async () => {
  const d = await env.open(withData());
  const seen = dialogs(d, true);
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dialog(d).getByLabel('Field name').first().fill('ident');
  await d.page.keyboard.press('Escape');
  await until(async () => seen.length === 1);
  await dialog(d).waitFor({ state: 'detached' });
  assert.equal((await d.def()).dataSets[0].fields[0].name, 'id', 'the change was dropped');
  d.expectClean();
});

test('deleting a data set: the items bound to it lose the binding, the data set goes', async () => {
  const d = await env.open(withData([tb('A', 10, 10, 100, 20, { value: '=Fields.region', dataSet: 'Sales' })]));
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dialog(d).getByRole('button', { name: 'Delete' }).click();
  const def = await d.def();
  assert.deepEqual(def.dataSets, []);
  assert.equal(Designer.find(def, 'A').dataSet, undefined);
  d.expectClean();
});

/* ------------------------------------------------------------------ drag fields */

test('drag a field onto the page: a text box bound to the field and its data set, where it was dropped', async () => {
  const d = await env.open(withData([]));
  await dragDrop(d, chip(d, 'Sales', 'amount'), d.band('body'), 0.4, 0.3);
  await until(async () => (await d.def()).sections.body.items.length === 1);
  const it = (await d.def()).sections.body.items[0];
  assert.equal(it.type, 'textbox');
  assert.equal(it.value, '=Fields.amount');
  assert.equal(it.dataSet, 'Sales');
  const s = await d.scale();
  const bw = 523.28;
  assert.ok(Math.abs(it.x - bw * 0.4) < 12 / s + 12, `x ${it.x}`);
  assert.ok(it.style?.format || it.style?.textAlign, 'a number field gets a number look');
  assert.deepEqual(await d.selected(), [it.name]);
  assertSaneGeometry(await d.def());
  // a date field gets a date format
  await dragDrop(d, chip(d, 'Sales', 'when'), d.band('body'), 0.1, 0.7);
  const w = (await d.def()).sections.body.items.find((x) => x.value === '=Fields.when');
  assert.ok(w?.style?.format, `date format ${JSON.stringify(w?.style)}`);
  d.expectClean();
});

test('drag a field into a list and a container: the text box goes inside; inside a list of the same data set it has no own data set', async () => {
  const list = { type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 80, dataSet: 'Sales', items: [] };
  const box = { type: 'container', name: 'C', x: 0, y: 150, w: 300, h: 80, items: [] };
  const d = await env.open(withData([list, box]));
  await dragDrop(d, chip(d, 'Sales', 'region'), d.item('L').locator('.nest').first(), 0.5, 0.5);
  await dragDrop(d, chip(d, 'Sales', 'amount'), d.item('C').locator('.nest').first(), 0.2, 0.2);
  const def = await d.def();
  const L = Designer.find(def, 'L'),
    C = Designer.find(def, 'C');
  assert.equal(def.sections.body.items.length, 2, 'nothing dropped onto the band itself');
  assert.equal(L.items.length, 1);
  assert.equal(L.items[0].value, '=Fields.region');
  assert.equal(L.items[0].dataSet, undefined, 'reads the list row');
  assert.equal(C.items.length, 1);
  assert.equal(C.items[0].value, '=Fields.amount');
  assert.equal(C.items[0].dataSet, 'Sales');
  assertSaneGeometry(def);
  d.expectClean();
});

const table = (more = {}) => ({
  type: 'table',
  name: 'T',
  x: 0,
  y: 0,
  w: 300,
  h: 54,
  columns: [{ width: 150 }, { width: 150 }],
  header: [{ height: 18, cells: [{ value: 'Column 1' }, { value: 'Column 2' }] }],
  detail: [{ height: 18, cells: [{ value: '' }, { value: '' }] }],
  footer: [{ height: 18, cells: [{ value: '' }, { value: '' }] }],
  ...more,
});

test('drag fields into table cells: detail reads the field and names the header, a number in the footer sums it', async () => {
  const d = await env.open(withData([table()]));
  const T = d.page.locator('[data-item="T"]');
  await dragDrop(d, chip(d, 'Sales', 'region'), T.locator('[data-cell="detail-0-0"]'), 0.5, 0.5);
  await dragDrop(d, chip(d, 'Sales', 'amount'), T.locator('[data-cell="detail-0-1"]'), 0.5, 0.5);
  await dragDrop(d, chip(d, 'Sales', 'amount'), T.locator('[data-cell="footer-0-1"]'), 0.5, 0.5);
  const t = Designer.find(await d.def(), 'T');
  assert.equal(t.dataSet, 'Sales', 'the first field binds the table');
  assert.equal(t.detail[0].cells[0].value, '=Fields.region');
  assert.equal(t.header[0].cells[0].value, 'Region');
  assert.equal(t.detail[0].cells[1].value, '=Fields.amount');
  assert.equal(t.header[0].cells[1].value, 'Amount');
  assert.equal(t.header[0].cells[1].style?.textAlign, 'right');
  assert.equal(t.footer[0].cells[1].value, '=Sum(Fields.amount)');
  assert.equal(t.columns.length, 2);
  // the drop selects the cell
  assert.match(await insp(d).locator('.insp-head').innerText(), /T/);
  d.expectClean();
});

test('drag a data set onto the page: a table of its rows', async () => {
  const d = await env.open(withData([]));
  const nm = pane(d, 'Data sets').locator('span.nm[draggable]', { hasText: 'Sales' });
  await dragDrop(d, nm, d.band('body'), 0.05, 0.1);
  await until(async () => (await d.def()).sections.body.items.length === 1);
  const t = (await d.def()).sections.body.items[0];
  assert.equal(t.type, 'table');
  assert.equal(t.dataSet, 'Sales');
  assert.deepEqual(
    t.detail[0].cells.map((c) => c.value),
    FIELDS.map((f) => `=Fields.${f.name}`),
  );
  assertSaneGeometry(await d.def());
  d.expectClean();
});

test('the table gallery: the table tool with data opens it, Insert adds a table bound to the data set', async () => {
  const d = await env.open(withData([]));
  await d.page.locator('.tool[data-tool="table"]').click();
  const apply = d.page.getByTestId('table-wizard-apply');
  await apply.waitFor();
  await until(async () => !(await apply.isDisabled()));
  await dialog(d).locator('[data-layout="grouped"]').click();
  await apply.click();
  await dialog(d).waitFor({ state: 'detached' });
  const t = (await d.def()).sections.body.items.find((x) => x.type === 'table');
  assert.ok(t, 'a table');
  assert.equal(t.dataSet, 'Sales');
  assert.ok((t.groups || []).length >= 1, 'grouped');
  assertSaneGeometry(await d.def());
  d.expectClean();
});

/* ------------------------------------------------------------------ parameters */

test('parameters: create with a default, required and choices; the name is checked; edit; delete', async () => {
  const d = await env.open(withData());
  await pane(d, 'Parameters').getByRole('button', { name: '+ Add' }).click();
  await dialog(d).waitFor();
  const save = dialog(d).getByRole('button', { name: 'Save', exact: true });
  assert.equal(await save.isDisabled(), true);
  await dctl(d, 'Name').fill('2x');
  assert.match(await dialog(d).locator('.err').innerText(), /must start with a letter/);
  await dctl(d, 'Name').fill('region');
  await dctl(d, 'Prompt').fill('Region');
  await dctl(d, 'Default').fill('North');
  await dialog(d).getByLabel('Required').check();
  await dialog(d).getByTestId('param-choices').fill('North\nSouth=Southern region\n');
  await save.click();
  await dialog(d).waitFor({ state: 'detached' });
  let p = (await d.def()).parameters;
  assert.deepEqual(p, [
    {
      name: 'region',
      type: 'string',
      prompt: 'Region',
      default: 'North',
      required: true,
      options: ['North', { value: 'South', label: 'Southern region' }],
    },
  ]);
  // number choices are numbers; a taken name is refused
  await pane(d, 'Parameters').getByRole('button', { name: '+ Add' }).click();
  await dctl(d, 'Name').fill('region');
  assert.match(await dialog(d).locator('.err').innerText(), /Another parameter has this name/);
  await dctl(d, 'Name').fill('top');
  await dctl(d, 'Type').selectOption('number');
  await dialog(d).getByTestId('param-choices').fill('5\n10=Ten');
  await save.click();
  p = (await d.def()).parameters;
  assert.deepEqual(p[1].options, [5, { value: 10, label: 'Ten' }]);
  // choices from a data set: the value field is picked
  await pane(d, 'Parameters').getByRole('button', { name: 'Edit top' }).click();
  await dialog(d).getByTestId('param-choices-from').selectOption('Sales');
  assert.equal(await dialog(d).getByTestId('param-value-field').inputValue(), 'id');
  await dialog(d).getByTestId('param-value-field').selectOption('amount');
  await save.click();
  p = (await d.def()).parameters;
  assert.deepEqual(p[1].optionsFrom, { dataSet: 'Sales', value: '=Fields.amount' });
  // delete
  await pane(d, 'Parameters').getByRole('button', { name: 'Edit top' }).click();
  await dialog(d).getByRole('button', { name: 'Delete' }).click();
  assert.deepEqual(
    (await d.def()).parameters.map((x) => x.name),
    ['region'],
  );
  d.expectClean();
});

test('regression: the parameter dialog drops typed changes on Escape without asking (the source and data set dialogs ask)', async () => {
  const d = await env.open(withData([], { parameters: [{ name: 'region', type: 'string' }] }));
  const seen = dialogs(d, false);
  await pane(d, 'Parameters').getByRole('button', { name: 'Edit region' }).click();
  await dctl(d, 'Default').fill('North');
  await d.page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(seen.length, 1, 'asked before dropping the change');
  d.expectClean();
});

/* ------------------------------------------------------------------ renames and missing fields */

test('a missing field: the Issues list names the item and the field, a click selects it, the Value field warns', async () => {
  const d = await env.open(
    withData([
      tb('A', 10, 10, 100, 20, { value: '=Fields.amont', dataSet: 'Sales' }),
      tb('B', 10, 60, 100, 20, { value: 'Total {Fields.regin}' }),
    ]),
  );
  const lines = await issueLines(d, true);
  assert.ok(
    lines.some((l) => /^A reads the field "amont".*amount/.test(l)),
    lines.join('\n'),
  );
  assert.ok(
    lines.some((l) => /^B reads the field "regin".*region/.test(l)),
    lines.join('\n'),
  );
  const i = lines.findIndex((l) => l.startsWith('B '));
  await d.page.getByTestId('issues-list').locator('li').nth(i).locator('button').click();
  assert.deepEqual(await d.selected(), ['B']);
  await insp(d).getByTestId('field-warning').waitFor();
  // the canvas marks the item too
  assert.match(await d.item('B').getAttribute('class'), /\bissue\b/);
  d.expectClean();
});

test('renaming a field in the data set dialog: expressions that read it are flagged in the Issues list and in the Inspector', async () => {
  const d = await env.open(
    withData([
      tb('A', 10, 100, 100, 20, { value: '=Fields.amount', dataSet: 'Sales' }),
      table({
        dataSet: 'Sales',
        detail: [{ height: 18, cells: [{ value: '=Fields.amount' }, { value: '=Fields.region' }] }],
      }),
    ]),
  );
  assert.deepEqual(await issueLines(d), []);
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dialog(d).getByLabel('Field name').nth(2).fill('total');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const def = await d.def();
  assert.equal(Designer.find(def, 'A').value, '=Fields.amount', 'expressions are not rewritten');
  const lines = await issueLines(d);
  assert.ok(
    lines.some((l) => /^A reads the field "amount"/.test(l)),
    lines.join('\n'),
  );
  assert.ok(
    lines.some((l) => /^T reads the field "amount"/.test(l)),
    lines.join('\n'),
  );
  await select(d, 'A');
  await insp(d).getByTestId('field-warning').waitFor();
  d.expectClean();
});

test('renaming a data set: items, nested data sets and their bindings follow', async () => {
  const d = await env.open(
    withData([tb('A', 10, 100, 100, 20, { value: '=Fields.amount', dataSet: 'Sales' }), table({ dataSet: 'Sales' })], {
      dataSets: [
        { name: 'Sales', source: 'src', path: '$', fields: FIELDS },
        { name: 'Lines', relation: { parent: 'Sales', path: '$.lines' }, fields: [{ name: 'sku', type: 'string' }] },
      ],
    }),
  );
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dctl(d, 'Name').fill('Orders');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const def = await d.def();
  assert.deepEqual(
    def.dataSets.map((x) => x.name),
    ['Orders', 'Lines'],
  );
  assert.equal(Designer.find(def, 'A').dataSet, 'Orders');
  assert.equal(Designer.find(def, 'T').dataSet, 'Orders');
  assert.equal(def.dataSets[1].relation.parent, 'Orders');
  assert.deepEqual(await issueLines(d), []);
  d.expectClean();
});

test('regression: renaming a data set leaves aggregates scoped to the old name ("Sales") unchanged and unflagged', async () => {
  const d = await env.open(withData([tb('Total', 10, 10, 120, 20, { value: '=Sum(Fields.amount, "Sales")' })]));
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dctl(d, 'Name').fill('Orders');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const v = Designer.find(await d.def(), 'Total').value;
  const lines = await issueLines(d);
  assert.ok(
    v.includes('"Orders"') || lines.some((l) => /^Total\b/.test(l)),
    `value ${v}; issues: ${JSON.stringify(lines)}`,
  );
  d.expectClean();
});

test('regression: renaming a data set does not update a parameter whose choices come from it (its choices go empty)', async () => {
  const d = await env.open(
    withData([], {
      parameters: [{ name: 'region', type: 'string', optionsFrom: { dataSet: 'Sales', value: '=Fields.region' } }],
    }),
  );
  await pane(d, 'Data sets').getByRole('button', { name: 'Edit Sales' }).click();
  await dctl(d, 'Name').fill('Orders');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const def = await d.def();
  const lines = await issueLines(d);
  assert.ok(
    def.parameters[0].optionsFrom.dataSet === 'Orders' || lines.some((l) => /region/.test(l)),
    `optionsFrom.dataSet is ${def.parameters[0].optionsFrom.dataSet}; issues: ${JSON.stringify(lines)}`,
  );
  d.expectClean();
});

test('regression: renaming a parameter leaves Parameters.<old name> in expressions with no update and no flag', async () => {
  const d = await env.open(
    withData([tb('A', 10, 10, 120, 20, { value: '=Parameters.region' })], {
      parameters: [{ name: 'region', type: 'string', default: 'North' }],
    }),
  );
  await pane(d, 'Parameters').getByRole('button', { name: 'Edit region' }).click();
  await dctl(d, 'Name').fill('area');
  await dialog(d).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(d).waitFor({ state: 'detached' });
  const v = Designer.find(await d.def(), 'A').value;
  const lines = await issueLines(d);
  assert.ok(
    v === '=Parameters.area' || lines.some((l) => /^A\b/.test(l)),
    `value ${v}; issues: ${JSON.stringify(lines)}`,
  );
  d.expectClean();
});

test('a near-miss parameter name is flagged in the Issues list (a reference typed wrong, not one a rename updates)', async () => {
  // a parameter rename rewrites Parameters.<old> (see the rename test above); a reference typed wrong is still flagged
  const d = await env.open(
    withData([tb('A', 10, 10, 120, 20, { value: '=Parameters.regoin' })], {
      parameters: [{ name: 'region', type: 'string', default: 'North' }],
    }),
  );
  const lines = await issueLines(d);
  assert.ok(
    lines.some((l) => /^A\b.*regoin/.test(l)),
    JSON.stringify(lines),
  );
  d.expectClean();
});

test('binding an item to a data set in the Inspector scopes its field checks to that data set', async () => {
  const d = await env.open(
    withData([tb('A', 10, 10, 120, 20, { value: '=Fields.sku' })], {
      dataSets: [
        { name: 'Sales', source: 'src', path: '$', fields: FIELDS },
        { name: 'Stock', source: 'src', path: '$', fields: [{ name: 'sku', type: 'string' }] },
      ],
    }),
  );
  let lines = await issueLines(d);
  assert.ok(
    lines.some((l) => /^A reads the field "sku"/.test(l)),
    'the first data set has no sku',
  );
  await select(d, 'A');
  await ictl(d, 'Data set').selectOption('Stock');
  assert.equal((await d.get('A')).dataSet, 'Stock');
  await until(async () => (await d.page.getByTestId('issues-none').count()) === 1);
  lines = await issueLines(d);
  assert.deepEqual(lines, []);
  assert.equal(await insp(d).getByTestId('field-warning').count(), 0);
  d.expectClean();
});
