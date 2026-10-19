// Embedded designer, panels and smaller tools: the View group's panel toggles, the toolbar's Duplicate and Delete,
// Backspace, zoom (buttons and select), Layers, Report parts, the Report Inspector sections (images, HTML export,
// reuse and theme), data source templates, Instant visuals, Fonts, content and overflow placeholders, an image file
// dropped on a band, the SQL and OData source editors without a server, cell mode's Cell size, Load sample data.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, Designer } from './harness.mjs';
import { THEME_COLORS } from '../../src/engine/reuse.js';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

/** Poll fn until it returns a truthy value (or fail after ms). */
async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${last})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
// the harness has no server: what the designer asks of one (SQL schema and connections, fonts) fails to load
const NETWORK = [/Failed to load resource/, /net::ERR_/, /status of 404/];
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const insp = (d) => d.page.getByTestId('inspector');
const header = (d) => d.page.locator('header.dtop');
const dialog = (d, title) => d.page.locator(`.dialog[aria-label="${title}"]`);
/** Click an item until it is the selection (the canvas may still settle right after it opens). */
async function pick(d, name) {
  await until(
    async () => {
      await d.click(name);
      return (await d.selected()).join() === name;
    },
    8000,
    `${name} selected`,
  );
}
/** Select the report (Inspector shows the report's properties). */
async function pickReport(d) {
  await d.focusCanvas();
  await d.press('Escape');
  await insp(d).getByTestId('report-images').waitFor();
}
const bodyItems = async (d) => (await d.def()).sections.body.items;
/** A report with inline JSON data: source "src", data set "Sales" (fields declared). */
const withData = (more = {}) =>
  report([tb('A', 10, 10)], {
    dataSources: [
      {
        name: 'src',
        type: 'json',
        data: [
          { region: 'North', amount: 10 },
          { region: 'South', amount: 20 },
          { region: 'East', amount: 5 },
        ],
      },
    ],
    dataSets: [
      {
        name: 'Sales',
        source: 'src',
        fields: [
          { name: 'region', type: 'string' },
          { name: 'amount', type: 'number' },
        ],
      },
    ],
    ...more,
  });

describe('View group: panel toggles', () => {
  test('left and right panel buttons toggle aria-pressed, collapse the panel and make it inert', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    for (const [label, side, aside] of [
      ['Show or hide the side panel', 'left', 'aside.dleft'],
      ['Show or hide the Inspector', 'right', 'aside.dright'],
    ]) {
      const btn = header(d).getByRole('button', { name: label });
      const panel = d.page.locator(aside);
      assert.equal(await btn.getAttribute('aria-pressed'), 'true');
      assert.equal(await d.page.locator('.dmain').getAttribute(`data-${side}`), 'open');
      assert.equal(await panel.getAttribute('inert'), null);
      await btn.click();
      assert.equal(await btn.getAttribute('aria-pressed'), 'false');
      assert.equal(await d.page.locator('.dmain').getAttribute(`data-${side}`), 'closed');
      assert.notEqual(await panel.getAttribute('inert'), null, `${side} panel is inert`);
      await until(async () => ((await panel.boundingBox())?.width ?? 0) < 2, 5000, `${side} panel collapsed`);
      await btn.click();
      assert.equal(await btn.getAttribute('aria-pressed'), 'true');
      assert.equal(await panel.getAttribute('inert'), null);
      await until(async () => ((await panel.boundingBox())?.width ?? 0) > 100, 5000, `${side} panel back`);
    }
    // closed panels: the canvas still works (an item is selectable, the Inspector comes back with it)
    await header(d).getByRole('button', { name: 'Show or hide the Inspector' }).click();
    await pick(d, 'A');
    await header(d).getByRole('button', { name: 'Show or hide the Inspector' }).click();
    await until(
      async () => (await insp(d).locator('.insp-head input').first().inputValue()) === 'A',
      5000,
      'Inspector shows A',
    );
    d.expectClean();
  });
});

describe('toolbar Duplicate and Delete, Backspace', () => {
  test('Duplicate and Delete are enabled only with an item selection, and act on it', async () => {
    const d = await env.open(report([tb('A', 10, 10), tb('B', 10, 60)]));
    const dup = header(d).getByRole('button', { name: 'Duplicate', exact: true });
    const del = header(d).getByRole('button', { name: 'Delete', exact: true });
    assert.equal(await dup.isDisabled(), true, 'report selected: Duplicate is off');
    assert.equal(await del.isDisabled(), true);
    // a band selected: still off
    await d.band('body').click({ position: { x: 300, y: 200 } });
    await until(async () => (await d.status()).includes('Body') || (await d.status()).length > 0, 3000, 'band status');
    assert.equal(await dup.isDisabled(), true, 'band selected: Duplicate is off');
    await pick(d, 'A');
    assert.equal(await dup.isEnabled(), true);
    assert.equal(await del.isEnabled(), true);
    await dup.click();
    let items = await bodyItems(d);
    assert.equal(items.length, 3, 'a copy');
    const copy = items.find((i) => !['A', 'B'].includes(i.name));
    assert.equal(copy.value, 'A');
    assert.deepEqual(await d.selected(), [copy.name], 'the copy is selected');
    await del.click();
    items = await bodyItems(d);
    assert.deepEqual(items.map((i) => i.name).sort(), ['A', 'B']);
    assert.equal(await del.isDisabled(), true, 'nothing selected after Delete');
    // two items at once
    await pick(d, 'A');
    await d.click('B', ['Shift']);
    assert.deepEqual((await d.selected()).sort(), ['A', 'B']);
    await del.click();
    assert.equal((await bodyItems(d)).length, 0);
    d.expectClean();
  });

  test('regression: in cell mode the toolbar Duplicate puts the copy off the cells and on top of the original', async () => {
    const d = await env.open(report([tb('A', 0, 0, 96, 24)]));
    await d.page.getByTestId('cell-mode').check();
    await d.page.getByTestId('cell-size').selectOption('24');
    await pick(d, 'A');
    await header(d).getByRole('button', { name: 'Duplicate', exact: true }).click();
    const items = await bodyItems(d);
    assert.equal(items.length, 2);
    const [a, c] = items;
    const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
    assert.deepEqual(
      { x: c.x % 24, y: c.y % 24, overlap },
      { x: 0, y: 0, overlap: false },
      `copy at ${c.x}, ${c.y}: whole cells, not on the original (as an insert or a move keeps it)`,
    );
    d.expectClean();
  });

  test('Backspace deletes the selected items like Delete; not while typing in a field', async () => {
    const d = await env.open(report([tb('A', 10, 10), tb('B', 10, 60), tb('C', 10, 110)]));
    await pick(d, 'A');
    await d.press('Backspace');
    assert.deepEqual(
      (await bodyItems(d)).map((i) => i.name),
      ['B', 'C'],
    );
    await pick(d, 'B');
    await d.press('Delete');
    assert.deepEqual(
      (await bodyItems(d)).map((i) => i.name),
      ['C'],
    );
    // typing in the Inspector: Backspace edits the text, the item stays
    await pick(d, 'C');
    const find = insp(d).getByTestId('find-property');
    await find.fill('ab');
    await find.press('Backspace');
    assert.equal(await find.inputValue(), 'a');
    assert.deepEqual(
      (await bodyItems(d)).map((i) => i.name),
      ['C'],
    );
    // undo brings the deleted ones back
    await d.focusCanvas();
    await d.undo(2);
    assert.deepEqual((await bodyItems(d)).map((i) => i.name).sort(), ['A', 'B', 'C']);
    d.expectClean();
  });
});

describe('zoom', () => {
  test('zoom select 50..200 % and the in/out buttons step through it, disabled at the ends', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    const zoom = d.page.getByTestId('zoom');
    const zin = d.page.locator('.dstatus').getByRole('button', { name: 'Zoom in' });
    const zout = d.page.locator('.dstatus').getByRole('button', { name: 'Zoom out' });
    const opts = await zoom.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
    assert.deepEqual(opts, [
      ['fit', opts[0][1]],
      ['0.5', '50%'],
      ['0.75', '75%'],
      ['1', '100%'],
      ['1.25', '125%'],
      ['1.5', '150%'],
      ['2', '200%'],
    ]);
    assert.equal(await zoom.inputValue(), 'fit');
    assert.equal(await zin.isEnabled(), true);
    assert.equal(await zout.isEnabled(), true);
    const paperW = async () => (await d.page.getByTestId('paper').boundingBox()).width;
    await zoom.selectOption('0.5');
    assert.equal(await zout.isDisabled(), true, '50 %: zoom out is off');
    assert.equal(await zin.isEnabled(), true);
    const w50 = await until(paperW, 3000, 'paper');
    for (const z of ['0.75', '1', '1.25', '1.5', '2']) {
      await zin.click();
      assert.equal(await zoom.inputValue(), z);
    }
    assert.equal(await zin.isDisabled(), true, '200 %: zoom in is off');
    assert.equal(await zout.isEnabled(), true);
    const w200 = await until(
      async () => {
        const w = await paperW();
        return Math.abs(w / w50 - 4) < 0.05 && w;
      },
      3000,
      'paper 4× wider at 200 % than at 50 %',
    );
    assert.ok(w200 > w50);
    for (const z of ['1.5', '1.25', '1', '0.75', '0.5']) {
      await zout.click();
      assert.equal(await zoom.inputValue(), z);
    }
    assert.equal(await zout.isDisabled(), true);
    // from "fit", a step goes from 100 %
    await zoom.selectOption('fit');
    await zin.click();
    assert.equal(await zoom.inputValue(), '1.25');
    d.expectClean();
  });
});

describe('Layers panel', () => {
  test('add a layer, put an item on it (Inspector), lock it (not clickable), hide it (not drawn)', async () => {
    const d = await env.open(report([tb('A', 10, 10), tb('B', 200, 10)]));
    const layers = d.page.getByTestId('layers');
    const add = layers.getByTestId('layer-add');
    assert.equal(await add.isDisabled(), true, 'no name: Add is off');
    await layers.getByTestId('layer-new').fill('Back');
    await add.click();
    assert.deepEqual((await d.def()).layers, [{ name: 'Back' }]);
    assert.equal(await layers.getByTestId('layer-new').inputValue(), '');
    // the same name again: Add is off
    await layers.getByTestId('layer-new').fill('Back');
    assert.equal(await add.isDisabled(), true);
    await layers.getByTestId('layer-new').fill('');

    await pick(d, 'A');
    const sel = insp(d).getByTestId('item-layer');
    await sel.selectOption('Back');
    assert.equal((await d.get('A')).layer, 'Back');

    const row = layers.locator('.layer-row[data-layer="Back"]');
    await row.getByLabel('Locked').check();
    assert.equal((await d.def()).layers[0].locked, true);
    await d.page.locator('[data-locked="A"]').waitFor({ state: 'attached' });
    await d.focusCanvas();
    await d.press('Escape');
    // a click on the locked item does not select it
    const box = await d.item('A').boundingBox();
    await d.page.mouse.click(box.x + 6, box.y + 6);
    assert.deepEqual(await d.selected(), [], 'the locked item is not selected');
    assert.equal(await d.item('A').getAttribute('aria-disabled'), 'true');
    // the other item still is
    await pick(d, 'B');

    await row.getByLabel('Locked').uncheck();
    await row.getByLabel('Visible').uncheck();
    assert.equal((await d.def()).layers[0].visible, false);
    await until(async () => (await d.page.locator('.it[data-item="A"]').count()) === 0, 3000, 'A not drawn');
    assert.ok(await d.get('A'), 'A is still in the report');
    await row.getByLabel('Visible').check();
    await d.item('A').waitFor();
    // removing the layer takes it off the item
    await row.getByRole('button', { name: /Back$/ }).click();
    const def = await d.def();
    assert.equal(def.layers, undefined);
    assert.equal(Designer.find(def, 'A').layer, undefined);
    d.expectClean();
  });
});

describe('Report parts panel', () => {
  test('renders; without a server the library picker lists nothing and Add is off', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    const parts = d.page.getByTestId('parts-panel');
    await parts.waitFor();
    const picker = parts.getByTestId('library-picker');
    assert.deepEqual(
      await picker.locator('option').evaluateAll((os) => os.map((o) => o.value)),
      [''],
      'no saved reports to pick',
    );
    assert.equal(await parts.getByTestId('library-add').isDisabled(), true);
    d.expectClean();
  });
});

describe('Report Inspector sections', () => {
  test('images: upload a PNG (listed as embedded:name); a non-image file is refused with a message', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await pickReport(d);
    const sec = insp(d).getByTestId('report-images');
    await sec.getByTestId('image-upload').setInputFiles(png('logo.png'));
    await sec.getByText('embedded:logo').waitFor();
    const def = await d.def();
    assert.match(def.images.logo, /^data:image\/png;base64,/);
    // the same name again: logo2
    await sec.getByTestId('image-upload').setInputFiles(png('logo.png'));
    await sec.getByText('embedded:logo2').waitFor();
    await sec
      .getByTestId('image-upload')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await sec.locator('.err').waitFor();
    assert.deepEqual(Object.keys((await d.def()).images).sort(), ['logo', 'logo2']);
    // remove one
    await sec.getByRole('button', { name: /logo2/ }).click();
    assert.deepEqual(Object.keys((await d.def()).images), ['logo']);
    d.expectClean();
  });

  test('an image item: item-image-upload embeds the file (src embedded:name) and the canvas draws it', async () => {
    const d = await env.open(report([]));
    await header(d).getByTestId('quick-image').click();
    const [name] = await until(
      async () => {
        const s = await d.selected();
        return s.length === 1 && s;
      },
      5000,
      'the new image selected',
    );
    await insp(d).getByTestId('item-image-upload').setInputFiles(png('photo.png'));
    await until(async () => (await d.get(name))?.src === 'embedded:photo', 5000, 'src embedded:photo');
    assert.match((await d.def()).images.photo, /^data:image\/png/);
    await until(
      async () => /^data:image\/png/.test(await d.item(name).locator('img').first().getAttribute('src')),
      5000,
      'image drawn',
    );
    // the picker shows it as the current one
    assert.equal(await insp(d).getByTestId('embedded-picker').inputValue(), 'photo');
    d.expectClean();
  });

  test('HTML export section writes def.export (html, drillLinks); "server default" removes the key', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await pickReport(d);
    const sec = insp(d).getByTestId('report-html-export');
    const [mode, drill] = [sec.locator('select').nth(0), sec.locator('select').nth(1)];
    await mode.selectOption('interactive');
    assert.deepEqual((await d.def()).export, { html: 'interactive' });
    await drill.selectOption('new-tab');
    assert.deepEqual((await d.def()).export, { html: 'interactive', drillLinks: 'new-tab' });
    await mode.selectOption('static');
    assert.equal((await d.def()).export.html, 'static');
    await mode.selectOption('');
    assert.deepEqual((await d.def()).export, { drillLinks: 'new-tab' });
    await drill.selectOption('');
    assert.equal((await d.def()).export, undefined, 'no empty export object');
    d.expectClean();
  });

  test('theme: colours, fonts, constants and an expression source write def.themeDef / def.theme', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await pickReport(d);
    const sec = insp(d).getByTestId('theme');
    const k = THEME_COLORS[0];
    await sec.getByTestId('theme-colors').locator('input.mono').first().fill('#123456');
    assert.equal((await d.def()).themeDef.colors[k], '#123456');
    await sec.getByTestId('theme-font-major').locator('input').first().fill('20');
    await sec.getByTestId('theme-font-major').locator('input').first().press('Tab');
    assert.equal((await d.def()).themeDef.fonts.major.size, 20);
    await sec.getByTestId('theme-const-name').fill('Brand name!');
    assert.equal(await sec.getByTestId('theme-const-name').inputValue(), 'Brandname', 'only word characters');
    await sec.getByTestId('theme-const-add').click();
    assert.equal((await d.def()).themeDef.constants.Brandname, '');
    await sec.getByLabel('Brandname', { exact: true }).fill('ACME');
    assert.equal((await d.def()).themeDef.constants.Brandname, 'ACME');
    await sec.getByTestId('theme-const-name').fill('Brandname');
    assert.equal(await sec.getByTestId('theme-const-add').isDisabled(), true, 'a constant of that name exists');
    await sec.getByTestId('theme-source').selectOption('expr');
    await sec.getByTestId('theme-expr').fill('IIf(true, "dark", "light")');
    assert.equal((await d.def()).theme, '=IIf(true, "dark", "light")');
    await sec.getByTestId('theme-source').selectOption('own');
    assert.equal((await d.def()).theme, undefined);
    d.expectClean();
  });

  test('reuse: without a server the master and stylesheet pickers are empty; a content placeholder makes it a master', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await pickReport(d);
    const sec = insp(d).getByTestId('reuse');
    for (const id of ['master-picker', 'sheet-picker'])
      assert.deepEqual(
        await sec
          .getByTestId(id)
          .locator('option')
          .evaluateAll((os) => os.map((o) => o.value)),
        [''],
      );
    await sec.getByText('To make this a master, add a content placeholder from Insert.').waitFor();
    await d.page.locator('.tool[data-tool="placeholder"]').click();
    const ph = (await bodyItems(d)).find((i) => i.type === 'placeholder');
    assert.ok(ph, 'a placeholder item');
    await d.page.locator(`.it[data-item="${ph.name}"] .reuse-box[data-kind="placeholder"]`).waitFor();
    await pickReport(d);
    await insp(d)
      .getByTestId('reuse')
      .getByText('This report has a content placeholder: other reports can use it as their master.')
      .waitFor();
    d.expectClean();
  });
});

describe('data source templates (mountDesigner dataSourceTemplates)', () => {
  test('no templates: no select; with templates: picking one adds the source (unique names)', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    assert.equal(await d.page.getByTestId('source-templates').count(), 0);
    // the host page mounts the designer again, now with templates
    await d.page.evaluate(async () => {
      window.h.unmount();
      const { mountDesigner } = await import('/pw/designer.js');
      window.h = mountDesigner('#d', {
        definition: window.__RW.def,
        fontsUrl: '/pw-fonts/',
        height: '100vh',
        warnOnLeave: false,
        onSave: () => {},
        dataSourceTemplates: [
          { label: 'Orders (inline)', source: { name: 'orders', type: 'json', data: [{ id: 1, total: 5 }] } },
          { label: 'People', source: { name: 'people', type: 'csv', data: 'name\nAsha' } },
        ],
      });
    });
    const sel = d.page.getByTestId('source-templates');
    await sel.waitFor();
    assert.deepEqual(await sel.locator('option').evaluateAll((os) => os.map((o) => o.textContent)), [
      '+ Add from a template…',
      'Orders (inline)',
      'People',
    ]);
    await sel.selectOption({ label: 'Orders (inline)' });
    assert.deepEqual((await d.def()).dataSources, [{ name: 'orders', type: 'json', data: [{ id: 1, total: 5 }] }]);
    await sel.selectOption({ label: 'Orders (inline)' });
    assert.deepEqual(
      (await d.def()).dataSources.map((s) => s.name),
      ['orders', 'orders2'],
    );
    await sel.selectOption({ label: 'People' });
    assert.deepEqual(
      (await d.def()).dataSources.map((s) => s.name),
      ['orders', 'orders2', 'people'],
    );
    assert.equal(await sel.inputValue(), '', 'the select goes back to its prompt');
    d.expectClean();
  });
});

describe('dialogs reachable from the panels', () => {
  test('Instant visuals opens from a data set with fields; a card inserts its item', async () => {
    const d = await env.open(withData());
    await d.page.getByTestId('instant-Sales').click();
    const dlg = dialog(d, 'Instant visuals');
    await dlg.waitFor();
    const cards = dlg.locator('[data-testid="instant-visuals"] .cw-card');
    await until(async () => (await cards.count()) > 0, 5000, 'suggestions');
    const before = (await bodyItems(d)).length;
    await cards.first().click();
    await dlg.waitFor({ state: 'detached' });
    assert.equal((await bodyItems(d)).length, before + 1);
    d.expectClean();
  });

  test('Fonts dialog opens from the report Inspector ("Upload a font…"); Upload is off without a file', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await pickReport(d);
    await insp(d).getByRole('button', { name: 'Upload a font…' }).click();
    const dlg = dialog(d, 'Fonts');
    await dlg.waitFor();
    assert.equal(await dlg.getByRole('button', { name: 'Upload font' }).isDisabled(), true);
    await dlg.locator('footer').getByRole('button', { name: 'Close' }).click();
    await dlg.waitFor({ state: 'detached' });
    d.expectClean(NETWORK);
  });
});

describe('placeholders', () => {
  test('an overflow placeholder: a table picks it as its overflow target (overflowTo)', async () => {
    const d = await env.open(
      report([
        {
          type: 'table',
          name: 'T',
          x: 0,
          y: 0,
          w: 300,
          h: 60,
          columns: [{ width: 300 }],
          header: [{ height: 20, cells: [{ value: 'H' }] }],
          detail: [{ height: 20, cells: [{ value: 'D' }] }],
        },
      ]),
    );
    await d.page.locator('.tool[data-tool="overflow"]').click();
    const ov = (await bodyItems(d)).find((i) => i.type === 'overflow');
    assert.ok(ov, 'an overflow item');
    await d.page.locator(`.it[data-item="${ov.name}"] .reuse-box[data-kind="overflow"]`).waitFor();
    await d.focusCanvas();
    await d.press('Escape');
    // select the table with its grip (a click on it would land in a cell)
    await d.page.locator('.tbl[data-item="T"] .grip').click();
    await until(async () => (await d.status()).startsWith('T ·'), 5000, 'table selected');
    const target = insp(d).getByTestId('overflow-target');
    assert.deepEqual(await target.locator('option').evaluateAll((os) => os.map((o) => o.value)), ['', ov.name]);
    await target.selectOption(ov.name);
    assert.equal((await d.get('T')).overflowTo, ov.name);
    d.expectClean();
  });
});

describe('dropping an image file on a band', () => {
  test('a PNG dropped on the body becomes an image item with an embedded src where it was dropped', async () => {
    const d = await env.open(report([]));
    // the canvas fits its width right after it opens: wait until the scale holds still
    let last = 0;
    await until(
      async () => {
        const s = await d.scale();
        const same = Math.abs(s - last) < 1e-6;
        last = s;
        await new Promise((r) => setTimeout(r, 100));
        return same;
      },
      5000,
      'a steady zoom',
    );
    const at = await d.page.evaluate(() => {
      const root = document.querySelector('#d').shadowRoot;
      const r = root.querySelector('.band[data-section="body"]').getBoundingClientRect();
      const scale = root.querySelector('[data-testid="paper"]').getBoundingClientRect().width / 523.28;
      return { x: r.left + 100 * scale, y: r.top + 80 * scale };
    });
    await d.page.evaluate(
      ({ at, bytes }) => {
        const band = document.querySelector('#d').shadowRoot.querySelector('.band[data-section="body"]');
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
        const o = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, dataTransfer: dt };
        band.dispatchEvent(new DragEvent('dragenter', o));
        band.dispatchEvent(new DragEvent('dragover', o));
        band.dispatchEvent(new DragEvent('drop', o));
      },
      { at, bytes: [...PNG] },
    );
    const img = await until(async () => (await bodyItems(d)).find((i) => i.type === 'image'), 5000, 'an image item');
    assert.equal(img.src, 'embedded:dropped');
    assert.match((await d.def()).images.dropped, /^data:image\/png/);
    assert.ok(Math.abs(img.x - 100) <= 4 && Math.abs(img.y - 80) <= 4, `placed at the drop point (${img.x}, ${img.y})`);
    // a text file dropped: nothing is added
    await d.page.evaluate(
      ({ at }) => {
        const band = document.querySelector('#d').shadowRoot.querySelector('.band[data-section="body"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
        const o = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: at.x,
          clientY: at.y + 100,
          dataTransfer: dt,
        };
        band.dispatchEvent(new DragEvent('dragover', o));
        band.dispatchEvent(new DragEvent('drop', o));
      },
      { at },
    );
    await d.page.waitForTimeout(200);
    assert.equal((await bodyItems(d)).length, 1);
    d.expectClean();
  });
});

describe('data source editors without a server', () => {
  test('SQL source in builder mode: the query builder shows its error; Edit SQL switches to the query text', async () => {
    const d = await env.open(
      report([tb('A', 10, 10)], {
        dataSources: [
          {
            name: 'db',
            type: 'sql',
            connection: 'MAIN',
            query: 'select region from sales',
            builder: {
              tables: [{ name: 'sales', alias: 's' }],
              columns: [{ table: 's', column: 'region' }],
              joins: [],
              filters: [],
              sort: [],
            },
          },
        ],
      }),
    );
    await d.page.getByRole('button', { name: 'Edit db' }).click();
    const dlg = dialog(d, 'Data source db');
    await dlg.waitFor();
    assert.equal(await dlg.getByTestId('qb-mode-build').getAttribute('aria-pressed'), 'true');
    const err = dlg.getByTestId('qb-error');
    await err.waitFor();
    assert.match(await err.innerText(), /404/);
    await err.getByRole('button').click();
    await err.waitFor({ state: 'detached' });
    assert.equal(await dlg.getByTestId('qb-mode-sql').getAttribute('aria-pressed'), 'true');
    const q = dlg.locator('textarea').last();
    assert.match(await q.inputValue(), /^select\b[\s\S]*\bfrom\s+"?sales"?/i, "the builder's SELECT, as text");
    await q.fill('select 1 as one');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await dlg.waitFor({ state: 'detached' });
    const src = (await d.def()).dataSources[0];
    assert.equal(src.query, 'select 1 as one');
    assert.equal(src.builder, undefined, 'the builder model is dropped with Edit SQL');
    d.expectClean(NETWORK);
  });

  test('OData source: the OData editor renders; Read metadata lists the entity sets; Save writes entitySet and $select', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    const META = `<?xml version="1.0"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>
<Schema Namespace="Demo" xmlns="http://docs.oasis-open.org/odata/ns/edm"><EntityType Name="Order"><Key><PropertyRef Name="Id"/></Key>
<Property Name="Id" Type="Edm.Int32"/><Property Name="Customer" Type="Edm.String"/><Property Name="Total" Type="Edm.Decimal"/></EntityType>
<EntityContainer Name="C"><EntitySet Name="Orders" EntityType="Demo.Order"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
    await d.ctx.route('https://odata.example.com/**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/xml',
        headers: { 'access-control-allow-origin': '*' },
        body: META,
      }),
    );
    await d.page.locator('.pane h4', { hasText: 'Data sources' }).getByRole('button', { name: '+ Add' }).click();
    const dlg = dialog(d, 'New data source');
    await dlg.waitFor();
    await dlg.getByLabel('Name').fill('od');
    await dlg.locator('.field', { hasText: 'Type' }).locator('select').first().selectOption('odata');
    const ed = dlg.getByTestId('odata-editor');
    await ed.waitFor();
    const read = ed.getByRole('button', { name: /metadata/i });
    assert.equal(await read.isDisabled(), true, 'no URL: Read metadata is off');
    await dlg.locator('.field', { hasText: 'URL' }).locator('input').fill('https://odata.example.com/svc');
    await read.click();
    await until(
      async () =>
        (
          await ed
            .locator('select')
            .first()
            .locator('option')
            .evaluateAll((os) => os.map((o) => o.value))
        ).includes('Orders'),
      8000,
      'entity sets read',
    );
    await ed.locator('select').first().selectOption('Orders');
    await ed.getByLabel('Customer', { exact: true }).check();
    await ed.getByLabel('Total', { exact: true }).check();
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await dlg.waitFor({ state: 'detached' });
    const src = (await d.def()).dataSources.find((s) => s.name === 'od');
    assert.equal(src.type, 'odata');
    assert.equal(src.url, 'https://odata.example.com/svc');
    assert.equal(src.entitySet, 'Orders');
    assert.deepEqual(src.select, ['Customer', 'Total']);
    // the sample load after Save fetches the entity set itself (not routed): a failed request is expected
    d.expectClean([...NETWORK, /odata/i]);
  });
});

describe('cell mode and sample data', () => {
  test('Cell size select appears with cell mode; it sets the grid the band draws and the nudge step', async () => {
    const d = await env.open(report([tb('A', 0, 0, 96, 24)]));
    assert.equal(await d.page.getByTestId('cell-size').count(), 0);
    await d.page.getByTestId('cell-mode').check();
    const size = d.page.getByTestId('cell-size');
    await size.waitFor();
    assert.deepEqual(await size.locator('option').evaluateAll((os) => os.map((o) => o.value)), [
      '6',
      '8',
      '12',
      '16',
      '18',
      '24',
      '36',
    ]);
    assert.equal(await size.inputValue(), '12');
    await size.selectOption('24');
    // the band's cell grid and the canvas scale, read at the same moment (the zoom may still settle after opening)
    const { bg, scale } = await d
      .band('body')
      .evaluate((el) => ({
        bg: el.style.backgroundSize,
        scale: el.closest('[data-testid="paper"]').getBoundingClientRect().width / 523.28,
      }));
    const px = parseFloat(bg);
    assert.ok(Math.abs(px - 24 * scale) < 0.5, `cells of 24 pt (${bg}, scale ${scale})`);
    await pick(d, 'A');
    await d.press('ArrowRight');
    assert.equal((await d.get('A')).x, 24, 'a nudge moves one cell');
    await d.page.getByTestId('cell-mode').uncheck();
    assert.equal(await size.count(), 0);
    d.expectClean();
  });

  test('"Load sample data" is off without a data source; with one it loads the rows (row count shown)', async () => {
    let d = await env.open(report([tb('A', 10, 10)]));
    assert.equal(await d.page.getByTestId('load-sample').isDisabled(), true);
    await d.page.getByTestId('no-source').first().waitFor();
    d.expectClean();

    d = await env.open(withData());
    const btn = d.page.getByTestId('load-sample');
    await until(() => btn.isEnabled(), 5000, 'Load sample data on');
    const count = d.page.locator('.trow', { hasText: 'Sales' }).locator('.ty');
    await until(async () => (await count.innerText()) === '3 rows', 5000, '3 rows (loaded on open)');
    // change the data, then load again
    // the inline data is in the definition: edit it through the source dialog
    await d.page.getByRole('button', { name: 'Edit src' }).click();
    const dlg = dialog(d, 'Data source src');
    await dlg.locator('textarea').last().fill('[{"region":"North","amount":1}]');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await dlg.waitFor({ state: 'detached' });
    await btn.click();
    await until(async () => (await count.innerText()) === '1 rows', 5000, '1 row after Load sample data');
    d.expectClean();
  });
});
