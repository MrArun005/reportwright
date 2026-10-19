// H. Data regions on the canvas: tables (cell menu, merge and split, header/footer/group rows, column resize, several
// cells), matrix (row and column groups, totals, the pivot wizard), list (group by, nested items), subreport (report
// picker, parameters), chart (gallery insert and edit, types, series and axes), barcode (every symbology the Inspector
// offers, empty and invalid values) and the table of contents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, Designer, assertSaneGeometry } from './harness.mjs';
import { SYMBOLOGIES } from '../../src/engine/items/barcode.js';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

async function until(fn, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
/** A designer page whose canvas has settled. */
async function open(def, opts) {
  const d = await env.open(def, opts);
  await settle(d.page.locator('[data-testid="paper"]'));
  return d;
}
/** Wait until an element stops moving (the fit zoom settles after the first paint). */
async function settle(loc) {
  let a = await loc.boundingBox();
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, 40));
    const b = await loc.boundingBox();
    if (b && a && b.x === a.x && b.y === a.y && b.width === a.width) return;
    a = b;
  }
}
/** Click an item once the canvas has settled (the fit zoom measures the window after the first paint), until it is selected. */
async function pick(d, name, modifiers = []) {
  for (let i = 0; i < 4; i++) {
    let a = await d.item(name).boundingBox();
    for (let k = 0; k < 20; k++) {
      await new Promise((r) => setTimeout(r, 40));
      const b = await d.item(name).boundingBox();
      if (b && a && b.x === a.x && b.y === a.y && b.width === a.width) break;
      a = b;
    }
    await d.click(name, modifiers);
    if ((await d.selected()).includes(name)) return;
  }
  throw new Error(`${name} not selected`);
}
const insp = (d) => d.page.locator('[data-testid="inspector"]');
const label = (d, text) =>
  d.page
    .locator('.band-label')
    .filter({ has: d.page.locator('span:first-child', { hasText: new RegExp(`^${text}$`) }) })
    .first();

/* ---- data: an inline JSON source, so the sample loads without a server ---- */
const ROWS = [
  { region: 'North', product: 'Apples', amount: 120 },
  { region: 'North', product: 'Pears', amount: 80 },
  { region: 'South', product: 'Apples', amount: 60 },
  { region: 'South', product: 'Pears', amount: 140 },
  { region: 'East', product: 'Apples', amount: 95 },
];
const DATA = {
  dataSources: [{ name: 'src', type: 'json', data: ROWS }],
  dataSets: [
    {
      name: 'Sales',
      source: 'src',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'product', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
  ],
};
/** A 3-column table: a header row and a detail row of fields. */
const table = (name = 'T', more = {}) => ({
  type: 'table',
  name,
  x: 0,
  y: 0,
  w: 300,
  h: 36,
  dataSet: 'Sales',
  columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
  header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Product' }, { value: 'Amount' }] }],
  detail: [
    { height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.product' }, { value: '=Fields.amount' }] },
  ],
  ...more,
});
/** Load the sample data (Data panel → Load sample data): live items draw with the rows. */
async function loadData(d) {
  await d.page.locator('[data-testid="rail-data"]').click();
  const b = d.page.locator('[data-testid="load-sample"]');
  await b.click();
  await until(async () => (await b.textContent()) !== 'Loading…' && !(await b.isDisabled()), 8000, 'sample loaded');
}
const tableSelected = (d, t = 'T') =>
  d.page.locator(`.tbl[data-item="${t}"]`).evaluate((e) => e.classList.contains('sel'));
const cell = (d, key, t = 'T') => d.page.locator(`.tbl[data-item="${t}"] [data-cell="${key}"]`).first();
const tableOf = async (d, t = 'T') => Designer.find(await d.def(), t);
const vals = (row) =>
  row.cells.map((c) =>
    c == null ? null : c.value + (c.colSpan > 1 ? `/c${c.colSpan}` : '') + (c.rowSpan > 1 ? `/r${c.rowSpan}` : ''),
  );
async function menu(d, key, item, t = 'T') {
  await cell(d, key, t).click({ button: 'right' });
  const m = d.page.locator('[data-testid="cell-menu"]');
  await m.waitFor();
  await m.getByRole('menuitem', { name: item, exact: true }).click();
  await until(async () => (await m.count()) === 0, 3000, 'menu closed');
}
/** Every row of every part of a table has one cell (or null under a merge) per column; each column covered once. */
function consistent(t) {
  const n = t.columns.length,
    bad = [];
  const parts = [
    ['header', t.header],
    ...(t.groups || []).flatMap((g, i) => [
      [`g${i}h`, g.header],
      [`g${i}f`, g.footer],
    ]),
    ['detail', t.detail],
    ['footer', t.footer],
  ];
  for (const [p, rows] of parts) {
    const rs = rows || [];
    const cover = rs.map(() => new Array(n).fill(0));
    rs.forEach((row, r) => {
      if (row.cells.length !== n) bad.push(`${p}${r}: ${row.cells.length} cells for ${n} columns`);
      row.cells.forEach((c, k) => {
        if (!c) return;
        for (let i = 0; i < (c.rowSpan || 1); i++)
          for (let j = 0; j < (c.colSpan || 1); j++)
            if (cover[r + i] && k + j < n) cover[r + i][k + j]++;
            else bad.push(`${p}${r}c${k}: span out of the table`);
      });
    });
    cover.forEach((row, r) =>
      row.forEach((v, k) => {
        if (v !== 1) bad.push(`${p}${r}c${k} covered ${v}x`);
      }),
    );
  }
  return bad;
}

/* ================================================================ table */

test('table: right-click a cell opens its menu with every command; Escape closes it', async () => {
  const d = await open(report([table()], DATA));
  await cell(d, 'detail-0-1').click({ button: 'right' });
  const m = d.page.locator('[data-testid="cell-menu"]');
  await m.waitFor();
  const items = await m.getByRole('menuitem').allTextContents();
  for (const want of [
    'Row above',
    'Row below',
    'Column left',
    'Column right',
    'Group by product',
    'Merge right',
    'Delete row',
    'Delete column',
  ])
    assert.ok(items.includes(want), `menu has ${want}: ${items.join(' | ')}`);
  // the right-clicked cell is selected
  assert.equal(await cell(d, 'detail-0-1').evaluate((e) => e.classList.contains('sel')), true);
  await d.page.keyboard.press('Escape');
  await until(async () => (await m.count()) === 0, 3000, 'menu closed');
  d.expectClean();
});

test('table menu: rows above and below, columns left and right; width and height follow', async () => {
  const d = await open(report([table()], DATA));
  await menu(d, 'detail-0-0', 'Row above');
  await menu(d, 'detail-1-0', 'Row below');
  let t = await tableOf(d);
  assert.deepEqual(
    t.detail.map((r) => r.cells[0].value),
    ['', '=Fields.region', ''],
  );
  assert.equal(t.h, 18 * 4);
  await menu(d, 'header-0-1', 'Column left');
  await menu(d, 'header-0-3', 'Column right');
  t = await tableOf(d);
  assert.deepEqual(vals(t.header[0]), ['Region', '', 'Product', 'Amount', '']);
  assert.equal(t.w, 300 + 72 * 2);
  assert.deepEqual(consistent(t), []);
  d.expectClean();
});

test('table menu: delete a row and a column', async () => {
  const d = await open(
    report(
      [
        table('T', {
          footer: [{ height: 18, cells: [{ value: 'Total' }, { value: '' }, { value: '=Sum(Fields.amount)' }] }],
        }),
      ],
      DATA,
    ),
  );
  await menu(d, 'footer-0-0', 'Delete row');
  let t = await tableOf(d);
  assert.equal(t.footer.length, 0);
  await menu(d, 'detail-0-1', 'Delete column');
  t = await tableOf(d);
  assert.deepEqual(vals(t.header[0]), ['Region', 'Amount']);
  assert.equal(t.w, 200);
  assert.equal(await tableSelected(d), true, 'after a delete the table is selected');
  d.expectClean();
});

test("table menu: group by the column's field adds a group header and footer (G1/F1 rows)", async () => {
  const d = await open(report([table()], DATA));
  await menu(d, 'detail-0-0', 'Group by region');
  const t = await tableOf(d);
  assert.equal(t.groups.length, 1);
  assert.equal(t.groups[0].expr, '=Fields.region');
  assert.equal(t.groups[0].header[0].cells[0].value, '=Fields.region');
  assert.equal(t.detail[0].cells[0].value, '', 'the detail no longer prints the group field twice');
  const tags = await d.page.locator('.tbl[data-item="T"] .row-tag').allTextContents();
  assert.deepEqual(tags, ['H', 'G1', 'D', 'F1']);
  assert.equal(t.h, 18 * 4);
  assert.ok((await d.def()).sections.body.height >= t.y + t.h);
  // the Inspector's group card removes it again
  await d.page.locator('.tbl[data-item="T"] .grip').click();
  await insp(d).getByRole('button', { name: 'Remove', exact: true }).click();
  await until(async () => !(await tableOf(d)).groups?.length, 3000, 'group removed');
  assert.deepEqual(await d.page.locator('.tbl[data-item="T"] .row-tag').allTextContents(), ['H', 'D']);
  d.expectClean();
});

test('table menu: no "Group by" for a column that does not show a field', async () => {
  const d = await open(
    report(
      [
        table('T', {
          detail: [
            { height: 18, cells: [{ value: 'x' }, { value: '=Fields.product' }, { value: '=Fields.amount * 2' }] },
          ],
        }),
      ],
      DATA,
    ),
  );
  for (const c of ['detail-0-0', 'detail-0-2']) {
    await cell(d, c).click({ button: 'right' });
    const m = d.page.locator('[data-testid="cell-menu"]');
    await m.waitFor();
    assert.equal(await m.getByRole('menuitem', { name: /^Group by/ }).count(), 0, c);
    await d.page.keyboard.press('Escape');
  }
  d.expectClean();
});

test('table Inspector: add a group by field, with page break and keep together', async () => {
  const d = await open(report([table()], DATA));
  await d.page.locator('.tbl[data-item="T"] .grip').click();
  await insp(d).getByLabel('Field to group by').selectOption('product');
  await insp(d).getByRole('button', { name: 'Add group' }).click();
  await until(async () => (await tableOf(d)).groups?.length === 1, 3000, 'group added');
  const t = await tableOf(d);
  // the number column gets a subtotal
  assert.equal(t.groups[0].footer[0].cells[2].value, '=Sum(Fields.amount)');
  const card = insp(d).locator('.group-card').first();
  await card.getByLabel('Page break').selectOption('between');
  await card.getByLabel('Keep the group on one page').check();
  const g = (await tableOf(d)).groups[0];
  assert.equal(g.pageBreak, 'between');
  assert.equal(g.keepTogether, true);
  d.expectClean();
});

test('table Inspector: merge right, split, merge down, split rows; the canvas draws the spans', async () => {
  const d = await open(
    report(
      [
        table('T', {
          detail: [0, 1].map((r) => ({ height: 18, cells: [0, 1, 2].map((c) => ({ value: `d${r}${c}` })) })),
        }),
      ],
      DATA,
    ),
  );
  const s = await d.scale();
  await cell(d, 'detail-0-0').click();
  await insp(d).getByRole('button', { name: 'Merge right' }).click();
  let t = await tableOf(d);
  assert.deepEqual(vals(t.detail[0]), ['d00/c2', null, 'd02']);
  await until(
    async () => Math.abs((await cell(d, 'detail-0-0').boundingBox()).width - 200 * s) < 2,
    3000,
    'merged cell two columns wide',
  );
  assert.equal(await cell(d, 'detail-0-1').count(), 0, 'no cell drawn under the merge');
  await insp(d).getByRole('button', { name: 'Split', exact: true }).click();
  t = await tableOf(d);
  assert.deepEqual(vals(t.detail[0]), ['d00', '', 'd02']);
  await insp(d).getByRole('button', { name: 'Merge down' }).click();
  t = await tableOf(d);
  assert.deepEqual(vals(t.detail[0]), ['d00/r2', '', 'd02']);
  assert.deepEqual(vals(t.detail[1]), [null, 'd11', 'd12']);
  await until(
    async () => Math.abs((await cell(d, 'detail-0-0').boundingBox()).height - 36 * s) < 2,
    3000,
    'merged cell two rows high',
  );
  // merge down is disabled on the last row of the part
  assert.equal(await insp(d).getByRole('button', { name: 'Merge down' }).isDisabled(), true);
  await insp(d).getByRole('button', { name: 'Split rows' }).click();
  t = await tableOf(d);
  assert.deepEqual(vals(t.detail[1]), ['', 'd11', 'd12']);
  assert.deepEqual(consistent(t), []);
  d.expectClean();
});

test('table: a merge stays within its part (merge down on the last header row is disabled)', async () => {
  const d = await open(report([table()], DATA));
  await cell(d, 'header-0-0').click();
  assert.equal(await insp(d).getByRole('button', { name: 'Merge down' }).isDisabled(), true);
  assert.equal(await insp(d).getByRole('button', { name: 'Split', exact: true }).isDisabled(), true);
  assert.equal(await insp(d).getByRole('button', { name: 'Split rows' }).isDisabled(), true);
  d.expectClean();
});

test('table Inspector: header and footer rows are added per part; the table and band grow', async () => {
  const d = await open(report([table()], { ...DATA, sections: { body: { height: 40, items: [table()] } } }));
  await d.page.locator('.tbl[data-item="T"] .grip').click();
  const rowAdd = (part) =>
    insp(d)
      .locator('span', { hasText: new RegExp(`^${part} rows`) })
      .locator('xpath=..')
      .getByRole('button', { name: 'Add' });
  await rowAdd('Footer').click();
  await rowAdd('Header').click();
  const t = await tableOf(d);
  assert.equal(t.header.length, 2);
  assert.equal(t.footer.length, 1);
  assert.equal(t.h, 18 * 4);
  assert.ok((await d.def()).sections.body.height >= t.h, 'the body grew to the table');
  assert.deepEqual(await d.page.locator('.tbl[data-item="T"] .row-tag').allTextContents(), ['H', 'H', 'D', 'F']);
  assert.deepEqual(consistent(t), []);
  d.expectClean();
});

test('table: dragging a column edge resizes the column (12 pt at least); the table width follows; one undo', async () => {
  const d = await open(report([table()], DATA));
  const s = await d.scale();
  // the handle straddles the cell's right edge; the cell clips its outer half
  const h = cell(d, 'header-0-0').locator('.col-resize');
  let b = await h.boundingBox();
  await d.drag(b.x + 1.5, b.y + b.height / 2, b.x + 1.5 + 40 * s, b.y + b.height / 2);
  let t = await tableOf(d);
  assert.ok(Math.abs(t.columns[0].width - 140) <= 2, `width ${t.columns[0].width}`);
  assert.equal(
    t.w,
    t.columns.reduce((a, c) => a + c.width, 0),
  );
  b = await h.boundingBox();
  await d.drag(b.x + 1.5, b.y + b.height / 2, b.x + 1.5 - 300 * s, b.y + b.height / 2);
  t = await tableOf(d);
  assert.equal(t.columns[0].width, 12, 'never below 12 pt');
  await d.focusCanvas();
  await d.undo();
  await until(async () => Math.abs((await tableOf(d)).columns[0].width - 140) <= 2, 3000, 'undo one step');
  d.expectClean();
});

test('table: the Inspector column widths edit the columns too', async () => {
  const d = await open(report([table()], DATA));
  await d.page.locator('.tbl[data-item="T"] .grip').click();
  await insp(d).getByLabel('#2').fill('150');
  await until(async () => (await tableOf(d)).columns[1].width === 150, 3000, 'width 150');
  assert.equal((await tableOf(d)).w, 350);
  d.expectClean();
});

test('table: Shift-click selects a range, Ctrl/Cmd-click adds and removes a cell; the Inspector edits them together', async () => {
  const d = await open(
    report(
      [
        table('T', {
          detail: [0, 1].map((r) => ({ height: 18, cells: [0, 1, 2].map((c) => ({ value: `d${r}${c}` })) })),
        }),
      ],
      DATA,
    ),
  );
  const selCount = () => d.page.locator('.tbl[data-item="T"] .cell.sel').count();
  await cell(d, 'header-0-0').click();
  await cell(d, 'detail-1-1').click({ modifiers: ['Shift'] });
  assert.equal(await selCount(), 6, 'header row 0..detail row 1, columns 0..1');
  await insp(d).getByText('6 cells of T').waitFor();
  await cell(d, 'detail-0-2').click({ modifiers: ['ControlOrMeta'] });
  assert.equal(await selCount(), 7);
  await cell(d, 'detail-0-2').click({ modifiers: ['ControlOrMeta'] });
  assert.equal(await selCount(), 6);
  // a style for all of them at once
  await insp(d).locator('[data-prop="fontWeight"] select').selectOption('bold');
  const t = await tableOf(d);
  const bold = [t.header[0], ...t.detail].flatMap((r) => r.cells.map((c) => c.style?.fontWeight === 'bold'));
  assert.deepEqual(bold, [true, true, false, true, true, false, true, true, false]);
  d.expectClean();
});

test('table: a column handle selects the whole column, a row handle the whole row; Shift adds', async () => {
  const d = await open(
    report(
      [
        table('T', {
          footer: [{ height: 18, cells: [{ value: 'Total', colSpan: 2 }, null, { value: '=Sum(Fields.amount)' }] }],
        }),
      ],
      DATA,
    ),
  );
  const selected = () =>
    d.page.locator('.tbl[data-item="T"] .cell.sel').evaluateAll((es) => es.map((e) => e.dataset.cell));
  await d.page.locator('.tbl[data-item="T"] [data-col-handle="2"]').click();
  assert.deepEqual(await selected(), ['header-0-2', 'detail-0-2', 'footer-0-2']);
  await d.page.locator('.tbl[data-item="T"] [data-row-handle="detail-0"]').click();
  assert.deepEqual(await selected(), ['detail-0-0', 'detail-0-1', 'detail-0-2']);
  await d.page.locator('.tbl[data-item="T"] [data-row-handle="footer-0"]').click({ modifiers: ['Shift'] });
  assert.deepEqual(
    await selected(),
    ['detail-0-0', 'detail-0-1', 'detail-0-2', 'footer-0-0', 'footer-0-2'],
    'a merged cell counts once',
  );
  // column 1 lies under the footer's merge: the merged cell is not part of column 1's cells
  await d.page.locator('.tbl[data-item="T"] [data-col-handle="1"]').click();
  assert.deepEqual(await selected(), ['header-0-1', 'detail-0-1']);
  d.expectClean();
});

test('table: dragging across cells selects the rectangle', async () => {
  const d = await open(report([table()], DATA));
  await settle(cell(d, 'detail-0-1'));
  const a = await cell(d, 'header-0-0').boundingBox(),
    b = await cell(d, 'detail-0-1').boundingBox();
  await d.drag(a.x + 5, a.y + 5, b.x + b.width / 2, b.y + b.height / 2);
  const n = await d.page.locator('.tbl[data-item="T"] .cell.sel').count();
  assert.equal(n, 4);
  d.expectClean();
});

test('table: the last column and the last detail row are not deleted', async () => {
  const one = {
    type: 'table',
    name: 'T',
    x: 0,
    y: 0,
    w: 100,
    h: 18,
    dataSet: 'Sales',
    columns: [{ width: 100 }],
    detail: [{ height: 18, cells: [{ value: '=Fields.region' }] }],
  };
  const d = await open(report([one], DATA));
  await menu(d, 'detail-0-0', 'Delete column');
  let t = await tableOf(d);
  assert.equal(t.columns.length, 1);
  assert.equal(t.detail[0].cells.length, 1);
  await menu(d, 'detail-0-0', 'Delete row');
  t = await tableOf(d);
  assert.equal(t.detail.length, 1);
  assert.equal(await d.dirty(), false, 'nothing changed');
  d.expectClean();
});

test('table: deleting a row or column with a cell selected leaves no stale cell selection', async () => {
  const d = await open(report([table()], DATA));
  await cell(d, 'detail-0-2').click();
  await insp(d).getByRole('button', { name: 'Delete column' }).click();
  assert.equal(await tableSelected(d), true);
  assert.equal(await d.page.locator('.tbl[data-item="T"] .cell.sel').count(), 0);
  await d.focusCanvas();
  await d.undo();
  await until(async () => (await tableOf(d)).columns.length === 3, 3000, 'undo');
  d.expectClean();
});

test('regression: table menu "Merge right" on a cell a short row does not list throws', async () => {
  // a group header written as one merged cell over two of three columns (the third is not listed, as the padded rows
  // of store.js allow): the canvas draws an empty third cell, and its menu offers Merge right
  const t = table('T', {
    groups: [
      {
        name: 'Region',
        expr: '=Fields.region',
        header: [{ height: 18, cells: [{ value: '=Fields.region', colSpan: 2 }] }],
        footer: [],
      },
    ],
  });
  const d = await open(report([t], DATA));
  await cell(d, 'g0h-0-2').waitFor();
  await menu(d, 'g0h-0-2', 'Merge right');
  await d.page.waitForTimeout(100);
  d.expectClean();
});

test('regression: Inspector "Merge right" onto a merged neighbour keeps every column covered', async () => {
  const d = await open(
    report(
      [table('T', { detail: [{ height: 18, cells: [{ value: 'a' }, { value: 'bc', colSpan: 2 }, null] }] })],
      DATA,
    ),
  );
  await cell(d, 'detail-0-0').click();
  await insp(d).getByRole('button', { name: 'Merge right' }).click();
  const t = await tableOf(d);
  // expected: one cell over three columns (or no change); found: a cell over two, the third column empty and orphaned
  assert.deepEqual(consistent(t), [], JSON.stringify(vals(t.detail[0])));
  d.expectClean();
});

/* ================================================================ matrix */

test('matrix: the Inspector builds row and column groups, values and totals; the canvas draws them', async () => {
  const mx = { type: 'matrix', name: 'M', x: 0, y: 0, w: 300, h: 60, rowGroups: [], columnGroups: [], values: [] };
  const d = await open(report([mx], DATA));
  await loadData(d);
  await pick(d, 'M');
  await insp(d).getByLabel('Data set').first().selectOption('Sales');
  await insp(d).locator('[data-testid="pivot-pick-rowGroups"]').selectOption('region');
  await insp(d).locator('[data-testid="pivot-add-rowGroups"]').click();
  await insp(d).locator('[data-testid="pivot-pick-columnGroups"]').selectOption('product');
  await insp(d).locator('[data-testid="pivot-add-columnGroups"]').click();
  await insp(d).locator('[data-testid="pivot-pick-values"]').selectOption('amount');
  await insp(d).locator('[data-testid="pivot-add-values"]').click();
  let it = await d.get('M');
  assert.deepEqual(
    it.rowGroups.map((g) => g.expr),
    ['=Fields.region'],
  );
  assert.deepEqual(
    it.columnGroups.map((g) => g.expr),
    ['=Fields.product'],
  );
  assert.deepEqual(
    it.values.map((v) => v.value),
    ['=Sum(Fields.amount)'],
  );
  // totals after the rows and after the columns
  await insp(d).locator('[data-testid="pivot-rowGroups"] .group-card').last().getByLabel('Total').selectOption('after');
  await insp(d)
    .locator('[data-testid="pivot-columnGroups"] .group-card')
    .last()
    .getByLabel('Total')
    .selectOption('after');
  it = await d.get('M');
  assert.equal(it.rowGroups.at(-1).total, 'after');
  assert.equal(it.columnGroups.at(-1).total, 'after');
  // the canvas draws it with the data: a live SVG with the regions, the products and the grand total (495)
  await until(
    async () => {
      const t = await d.item('M').textContent();
      return /North/.test(t) && /Pears/.test(t) && /Total/.test(t) && /495/.test(t);
    },
    8000,
    'matrix drawn with data',
  );
  d.expectClean();
});

test('regression: an empty matrix from the toolbox: adding a row group in the Inspector gives that group only', async () => {
  const d = await open(report([], DATA));
  await d.page.locator('[data-testid="rail-tools"]').click();
  // the report has fields: the table gallery opens; take an empty matrix
  await d.page.locator('.tool[data-tool="matrix"]').click();
  await d.page.getByRole('button', { name: 'Insert an empty matrix' }).click();
  const m = await until(
    async () => (await d.def()).sections.body.items.find((i) => i.type === 'matrix'),
    3000,
    'matrix',
  );
  await insp(d).getByLabel('Data set').first().selectOption('Sales');
  await insp(d).locator('[data-testid="pivot-pick-rowGroups"]').selectOption('region');
  await insp(d).locator('[data-testid="pivot-add-rowGroups"]').click();
  const it = Designer.find(await d.def(), m.name);
  // found: the empty default's placeholder groups become real groups (="" row and column levels with totals)
  assert.deepEqual(
    { rows: it.rowGroups.map((g) => g.expr), columns: it.columnGroups.map((g) => g.expr) },
    { rows: ['=Fields.region'], columns: [] },
  );
  d.expectClean();
});

test('matrix: a column group can be moved and removed in the Inspector', async () => {
  const mx = {
    type: 'matrix',
    name: 'M',
    x: 0,
    y: 0,
    w: 300,
    h: 60,
    dataSet: 'Sales',
    rowGroups: [
      { name: 'Region', expr: '=Fields.region' },
      { name: 'Product', expr: '=Fields.product' },
    ],
    columnGroups: [],
    values: [{ value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([mx], DATA));
  await pick(d, 'M');
  const cards = insp(d).locator('[data-testid="pivot-rowGroups"] .group-card');
  await cards.nth(1).getByRole('button', { name: 'Move up' }).click();
  assert.deepEqual(
    (await d.get('M')).rowGroups.map((g) => g.name),
    ['Product', 'Region'],
  );
  await cards.nth(0).getByRole('button', { name: 'Remove' }).click();
  assert.deepEqual(
    (await d.get('M')).rowGroups.map((g) => g.name),
    ['Region'],
  );
  d.expectClean();
});

test('matrix: the pivot wizard (from the table gallery) inserts a matrix of the chosen fields', async () => {
  const d = await open(report([], DATA));
  await d.page.locator('[data-testid="rail-tools"]').click();
  await d.page.locator('.tool[data-tool="matrix"]').click();
  await d.page.locator('[data-testid="open-pivot-wizard"]').click();
  await d.page.locator('[data-testid="pv-rows-region"]').click();
  await d.page.locator('[data-testid="pv-columns-product"]').click();
  await d.page.locator('[data-testid="pv-values-amount"]').click();
  await until(async () => (await d.page.locator('[data-testid="pivot-preview"] svg').count()) > 0, 8000, 'preview');
  await d.page.locator('[data-testid="pivot-wizard-insert"]').click();
  const m = await until(
    async () => (await d.def()).sections.body.items.find((i) => i.type === 'matrix'),
    3000,
    'matrix inserted',
  );
  assert.equal(m.dataSet, 'Sales');
  assert.deepEqual(
    m.rowGroups.map((g) => g.expr),
    ['=Fields.region'],
  );
  assert.deepEqual(
    m.columnGroups.map((g) => g.expr),
    ['=Fields.product'],
  );
  assert.match(m.values[0].value, /Fields\.amount/);
  assertSaneGeometry(await d.def());
  d.expectClean();
});

/* ================================================================ list */

test('list: group by from the Inspector; the canvas tag says so; nested items go inside', async () => {
  const d = await open(
    report([{ type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 60, dataSet: 'Sales', items: [] }], DATA),
  );
  await pick(d, 'L');
  await insp(d)
    .locator('label.field')
    .filter({ has: d.page.locator('span', { hasText: /^Group by/ }) })
    .locator('input')
    .fill('=Fields.region');
  await until(async () => (await d.get('L')).groupBy === '=Fields.region', 3000, 'groupBy');
  await until(async () => /by region/.test(await d.item('L').locator('.nest-tag').textContent()), 3000, 'tag');
  // a selected list takes the new item
  await d.page.locator('[data-testid="quick-textbox"]').click();
  const def = await d.def();
  const l = def.sections.body.items.find((i) => i.name === 'L');
  assert.equal(l.items.length, 1, 'inside the list');
  assert.equal(def.sections.body.items.length, 1);
  // a container inside the list, and an item inside the container (L selected by its lower right corner: the text box is at its top left)
  const lb = await d.item('L').boundingBox();
  await d.page.mouse.click(lb.x + lb.width - 4, lb.y + lb.height - 4);
  assert.deepEqual(await d.selected(), ['L']);
  await d.page.locator('[data-testid="rail-tools"]').click();
  await d.page.locator('.tool[data-tool="container"]').click();
  const c = (await d.get('L')).items.find((i) => i.type === 'container');
  assert.ok(c, 'container in the list');
  await d.page.locator('[data-testid="quick-textbox"]').click();
  const c2 = Designer.find(await d.def(), c.name);
  assert.equal(c2.items.length, 1, 'text box in the container');
  assert.equal(c2.parent, 'L');
  assertSaneGeometry(await d.def());
  d.expectClean();
});

test('list: the outline shows nested items under their list', async () => {
  const d = await open(
    report(
      [{ type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 60, dataSet: 'Sales', items: [tb('Inner', 4, 4)] }],
      DATA,
    ),
  );
  await d.page.locator('[data-testid="rail-outline"]').click();
  const row = d.page.locator('[data-outline="Inner"]');
  await row.waitFor();
  await row.click();
  assert.deepEqual(await d.selected(), ['Inner']);
  d.expectClean();
});

/* ================================================================ subreport */

test('subreport: inserted into the body; the report picker and parameters are stored', async () => {
  const d = await open(report([], DATA));
  await label(d, 'Page header').click();
  await d.page.locator('[data-testid="rail-tools"]').click();
  await d.page.locator('.tool[data-tool="subreport"]').click();
  const def = await d.def();
  const sr = def.sections.body.items.find((i) => i.type === 'subreport');
  assert.ok(sr, 'a subreport for a page header goes to the body');
  assert.equal(def.sections.pageHeader.items.length, 0);
  await insp(d).locator('[data-testid="report-picker"]').fill('order-lines');
  await until(async () => (await d.get(sr.name)).report === 'order-lines', 3000, 'report');
  await until(async () => /Subreport · order-lines/.test(await d.item(sr.name).textContent()), 3000, 'canvas hint');
  // no server: the parameters of the target are unknown, names are free
  const pm = insp(d).locator('[data-testid="pmap-subreport"]');
  await pm
    .getByLabel('Other parameter', { exact: false })
    .fill('orderId')
    .catch(async () => {
      await pm.locator('input').last().fill('orderId');
    });
  await pm.getByRole('button', { name: 'Add' }).click();
  await pm.locator('[data-param="orderId"] input').fill('=Fields.region');
  await until(async () => (await d.get(sr.name)).params?.orderId === '=Fields.region', 3000, 'param mapped');
  await pm.locator('[data-param="orderId"]').getByRole('button').last().click();
  await until(async () => !(await d.get(sr.name)).params?.orderId, 3000, 'param removed');
  d.expectClean();
});

test('subreport without a report: the canvas asks for one; no crash', async () => {
  const d = await open(
    report([{ type: 'subreport', name: 'S', x: 0, y: 0, w: 300, h: 60, report: '', params: {} }], DATA),
  );
  await until(async () => /pick a report/.test(await d.item('S').textContent()), 3000, 'hint');
  d.expectClean();
});

/* ================================================================ chart */

test('chart: the gallery opens on insert, draws every type, and inserts the picked one', async () => {
  const d = await open(report([], DATA));
  await d.page.locator('[data-testid="quick-chart"]').click();
  const dlg = d.page.getByRole('dialog');
  await dlg.waitFor();
  await until(
    async () => (await dlg.locator('.cw-card[data-chart-type="column"] svg').count()) > 0,
    10000,
    'thumbnails',
  );
  await dlg.locator('.cw-card[data-chart-type="bar"]').click();
  assert.equal(await dlg.locator('.cw-card[data-chart-type="bar"]').getAttribute('aria-checked'), 'true');
  await d.page.locator('[data-testid="chart-wizard-apply"]').click();
  const ch = await until(
    async () => (await d.def()).sections.body.items.find((i) => i.type === 'chart'),
    3000,
    'chart inserted',
  );
  assert.equal(ch.chartType, 'bar');
  assert.equal(ch.dataSet, 'Sales');
  assert.match(ch.category, /^=Fields\./);
  assert.match(ch.series[0].value, /Fields\.amount|CountRows/);
  await until(async () => (await d.item(ch.name).locator('.box.live svg').count()) > 0, 8000, 'drawn on the canvas');
  d.expectClean();
});

test('chart: edit in the gallery switches the type and keeps the place and size', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 20,
    y: 30,
    w: 300,
    h: 180,
    chartType: 'column',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([ch], DATA));
  await pick(d, 'C');
  await insp(d).locator('[data-testid="open-chart-gallery"]').click();
  const dlg = d.page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.locator('.cw-card[data-chart-type="line"]').click();
  await d.page.locator('[data-testid="chart-wizard-apply"]').click();
  await until(async () => (await d.get('C')).chartType === 'line', 3000, 'line');
  const c = await d.get('C');
  assert.deepEqual([c.x, c.y, c.w, c.h], [20, 30, 300, 180]);
  d.expectClean();
});

test('chart: every chart type in the Inspector draws without a console error', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 0,
    y: 0,
    w: 300,
    h: 180,
    chartType: 'column',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([ch], DATA));
  await loadData(d);
  await pick(d, 'C');
  const sel = insp(d).getByLabel('Chart type');
  const types = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  assert.ok(types.length >= 16, types.join());
  for (const ty of types) {
    const before = await d.item('C').innerHTML();
    await sel.selectOption(ty);
    await until(async () => (await d.get('C')).chartType === ty, 3000, ty);
    // drawn again: a new SVG (or the item's own error text), never a page error
    await until(
      async () => {
        const h = await d.item('C').innerHTML();
        return h !== before && /<svg|class="err"/.test(h);
      },
      3000,
      `${ty} drawn`,
    ).catch(async () => assert.match(await d.item('C').innerHTML(), /<svg|class="err"/, `${ty} drawn`));
  }
  d.expectClean();
});

test('chart Inspector: series are added, renamed and removed', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 0,
    y: 0,
    w: 300,
    h: 180,
    chartType: 'column',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([ch], DATA));
  await pick(d, 'C');
  await insp(d).getByRole('button', { name: 'Add series' }).click();
  await until(async () => (await d.get('C')).series.length === 2, 3000, 'two series');
  const s1 = insp(d).locator('[data-testid="series-1"]');
  await s1.getByLabel('Series name').fill('Count');
  await s1.locator('.expr-row input.mono').fill('=Count(Fields.amount)');
  await s1
    .getByLabel('Axis', { exact: false })
    .last()
    .selectOption('secondary')
    .catch(() => {});
  let c = await d.get('C');
  assert.equal(c.series[1].name, 'Count');
  assert.equal(c.series[1].value, '=Count(Fields.amount)');
  await s1.getByRole('button', { name: 'Remove series' }).click();
  c = await d.get('C');
  assert.equal(c.series.length, 1);
  d.expectClean();
});

test('chart Inspector: axis title, minimum and maximum', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 0,
    y: 0,
    w: 300,
    h: 180,
    chartType: 'column',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([ch], DATA));
  await pick(d, 'C');
  const y = insp(d).locator('[data-testid="axis-y"]');
  await y.getByLabel(/title$/).fill('Euros');
  await y.getByLabel(/minimum$/).fill('0');
  await y.getByLabel(/maximum$/).fill('200');
  const c = await d.get('C');
  assert.deepEqual([c.axes.y.title, c.axes.y.min, c.axes.y.max], ['Euros', 0, 200]);
  await until(async () => /Euros/.test(await d.item('C').textContent()), 8000, 'axis title drawn');
  d.expectClean();
});

test('regression: chart axis minimum typed key by key: a negative number', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 0,
    y: 0,
    w: 300,
    h: 180,
    chartType: 'line',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }],
  };
  const d = await open(report([ch], DATA));
  await pick(d, 'C');
  const f = insp(d)
    .locator('[data-testid="axis-y"]')
    .getByLabel(/minimum$/);
  await f.click();
  await f.pressSequentially('-50', { delay: 30 });
  assert.equal((await d.get('C')).axes?.y?.min, -50, `field reads "${await f.inputValue()}"`);
  d.expectClean();
});

test('regression: chart axis maximum typed key by key: a decimal number', async () => {
  const ch = {
    type: 'chart',
    name: 'C',
    x: 0,
    y: 0,
    w: 300,
    h: 180,
    chartType: 'line',
    dataSet: 'Sales',
    category: '=Fields.region',
    series: [{ name: 'Share', value: '=Avg(Fields.amount) / 1000' }],
  };
  const d = await open(report([ch], DATA));
  await pick(d, 'C');
  const f = insp(d)
    .locator('[data-testid="axis-y"]')
    .getByLabel(/maximum$/);
  await f.click();
  await f.pressSequentially('0.25', { delay: 30 });
  assert.equal((await d.get('C')).axes?.y?.max, 0.25, `field reads "${await f.inputValue()}"`);
  d.expectClean();
});

/* ================================================================ barcode */

const barcodeReport = (more = {}) =>
  report([
    {
      type: 'barcode',
      name: 'B',
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      symbology: 'code128',
      value: 'ABC-123',
      showText: true,
      style: { fontSize: 8, textAlign: 'center' },
      ...more,
    },
  ]);
/** The barcode's drawing once it changed from `before`. */
async function redrawn(d, before, what) {
  return until(
    async () => {
      const h = await d.item('B').innerHTML();
      return h !== before && /<svg/.test(h) ? h : null;
    },
    10000,
    what,
  );
}

test('barcode: the Inspector offers every symbology of barcode.js', async () => {
  const d = await open(barcodeReport());
  await pick(d, 'B');
  await insp(d).getByLabel('Symbology').waitFor();
  const opts = await insp(d)
    .getByLabel('Symbology')
    .locator('option')
    .evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  assert.deepEqual(
    opts,
    SYMBOLOGIES.map((s) => s.id),
  );
  d.expectClean();
});

test('barcode: every symbology with its sample value draws bars, with no error and no console error', async () => {
  const d = await open(barcodeReport());
  await pick(d, 'B');
  await redrawn(d, '', 'first drawing');
  const bad = [];
  for (const s of SYMBOLOGIES) {
    const before = await d.item('B').innerHTML();
    await insp(d).getByLabel('Symbology').selectOption(s.id);
    await insp(d)
      .locator('label.field')
      .filter({ has: d.page.locator('span', { hasText: /^Value$/ }) })
      .locator('input')
      .fill(s.sample);
    let h = await redrawn(d, before, s.id);
    const def = await d.get('B');
    if (def.symbology !== s.id || def.value !== s.sample) bad.push(`${s.id}: stored ${def.symbology} ${def.value}`);
    // the symbology change draws once with the previous value (an error is right then); the drawing for the sample
    // value comes after the fill: wait for it before judging
    for (let t = Date.now(); (/Barcode error/.test(h) || !/<path/.test(h)) && Date.now() - t < 5000; ) {
      await d.page.waitForTimeout(100);
      h = await d.item('B').innerHTML();
    }
    if (/Barcode error/.test(h) || !/<path/.test(h))
      bad.push(`${s.id}: ${(await d.item('B').textContent()).slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
  d.expectClean();
});

test('barcode: an empty value draws nothing and no error text; the report check warns', async () => {
  const d = await open(barcodeReport({ value: '' }));
  await until(async () => /<svg/.test(await d.item('B').innerHTML()), 8000, 'drawn');
  const h = await d.item('B').innerHTML();
  assert.equal(/<path/.test(h), false, 'no bars');
  assert.equal(/Barcode error/.test(h), false);
  const warn = await d.page
    .evaluate(async () => (await import('/pw/designer.js')).validate?.(window.h.getDefinition())?.warnings ?? null)
    .catch(() => null);
  if (warn)
    assert.ok(
      warn.some((w) => /has no value/.test(w)),
      warn.join('\n'),
    );
  d.expectClean();
});

for (const [name, sym, value, why] of [
  ['letters in an EAN-13', 'ean13', 'ABCDEFGHIJKLM', /Barcode error/],
  ['an EAN-13 of the wrong length', 'ean13', '12345', /Barcode error/],
  ['an EAN-13 with a wrong check digit', 'ean13', '9520123456789', /Barcode error/],
  ['a value longer than the symbology takes', 'ean8', '1234567890123', /too long/],
  ['letters in a UPC-A', 'upca', 'HELLO', /Barcode error/],
  ['letters in an Interleaved 2 of 5', 'interleaved2of5', 'ABCD', /Barcode error/],
]) {
  test(`barcode: ${name} shows a visible error on the canvas, no crash`, async () => {
    const d = await open(barcodeReport({ symbology: sym, value }));
    await until(async () => why.test(await d.item('B').textContent()), 8000, 'error text');
    // the designer stays usable: the value can be fixed
    await pick(d, 'B');
    const ok = SYMBOLOGIES.find((s) => s.id === sym).sample;
    await insp(d)
      .locator('label.field')
      .filter({ has: d.page.locator('span', { hasText: /^Value$/ }) })
      .locator('input')
      .fill(ok);
    await until(
      async () => {
        const h = await d.item('B').innerHTML();
        return /<path/.test(h) && !/Barcode error/.test(h);
      },
      8000,
      'fixed',
    );
    d.expectClean();
  });
}

test('barcode: an unknown symbology in the definition is listed in the Issues', async () => {
  const d = await open(barcodeReport({ symbology: 'qr' }));
  await d.page.locator('[data-testid="issues"]').click();
  const list = d.page.locator('[data-testid="issues-list"]');
  await list.waitFor();
  assert.match(await list.textContent(), /"qr" is not a barcode symbology \(did you mean "qrcode"\?\)/);
  d.expectClean();
});

test('barcode: 2D options appear only for their symbology', async () => {
  const d = await open(barcodeReport({ symbology: 'qrcode', value: 'hello' }));
  await pick(d, 'B');
  await insp(d).getByLabel('Error correction').selectOption('H');
  assert.equal((await d.get('B')).qrErrorLevel, 'H');
  assert.equal(await insp(d).getByLabel('Show the text').count(), 0, 'no caption for a 2D code');
  await insp(d).getByLabel('Symbology').selectOption('code39');
  assert.equal(await insp(d).getByLabel('Error correction').count(), 0);
  await insp(d).getByLabel('Add a check digit').check();
  assert.equal((await d.get('B')).checkDigit, true);
  d.expectClean();
});

/* ================================================================ table of contents */

test('TOC: inserted into the body from the toolbox, drawn with its title and hint', async () => {
  const d = await open(report([]));
  await d.page.locator('[data-testid="rail-tools"]').click();
  await d.page.locator('.tool[data-tool="toc"]').click();
  const toc = (await d.def()).sections.body.items.find((i) => i.type === 'toc');
  assert.ok(toc);
  await until(async () => /Contents/.test(await d.item(toc.name).textContent()), 3000, 'title');
  await pick(d, toc.name);
  await insp(d)
    .locator('label.field')
    .filter({ has: d.page.locator('span', { hasText: /^Title$/ }) })
    .locator('input')
    .fill('Index');
  await until(async () => /Index/.test(await d.item(toc.name).textContent()), 3000, 'new title');
  d.expectClean();
});

test('TOC in a page header: the designer allows it and lists no issue (the report check only warns)', async () => {
  const d = await open(report([]));
  await label(d, 'Page header').click();
  await d.page.locator('[data-testid="rail-tools"]').click();
  await d.page.locator('.tool[data-tool="toc"]').click();
  const def = await d.def();
  assert.equal(def.sections.pageHeader.items[0]?.type, 'toc', 'the toc goes into the page header');
  // the designer's Issues list shows validate()'s errors only: this warning is not among them
  assert.equal(
    (await d.page.locator('[data-testid="issues-none"]').count()) +
      (await d.page.locator('[data-testid="issues"]').count()),
    1,
  );
  d.expectClean();
});
