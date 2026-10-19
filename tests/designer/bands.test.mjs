// G. Bands and structure: page header, body (one band or several body sections, each with its own page header and
// footer if wanted), page footer. Selecting a band by its label, the band's Inspector, resizing a band by its bottom
// edge, empty and 0 pt bands, adding and removing body sections.
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

/** Poll fn until it returns a truthy value (or throw after ms). */
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
/** The label above a band, by its exact text (the label also shows the height). */
const label = (d, text) =>
  d.page
    .locator('.band-label')
    .filter({ has: d.page.locator('span:first-child', { hasText: new RegExp(`^${text}$`) }) })
    .first();
const bandKeys = (d) => d.page.locator('.band[data-section]').evaluateAll((els) => els.map((e) => e.dataset.section));
const bodies = (def) => (Array.isArray(def.sections.body) ? def.sections.body : [def.sections.body]);
/** Drag a band's bottom edge by dy CSS px. */
async function dragBandEdge(d, key, dy) {
  const h = d.band(key).locator('.band-resize').first();
  await h.scrollIntoViewIfNeeded();
  let b = await h.boundingBox();
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, 40));
    const c = await h.boundingBox();
    if (c.x === b.x && c.y === b.y && c.width === b.width) break;
    b = c;
  }
  const vh = d.page.viewportSize().height;
  const y0 = b.y + b.height / 2;
  await d.drag(b.x + b.width / 2, y0, b.x + b.width / 2, Math.max(2, Math.min(vh - 2, y0 + dy)));
}
const sectionOf = (def, key) => {
  const [k, i, sub] = key.split(':');
  const s = def.sections[k];
  const b = Array.isArray(s) ? s[Number(i || 0)] : s;
  return sub ? b[sub] : b;
};

test('three bands in page order: page header, body, page footer; no report header or footer band', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'pageFooter']);
  const labels = await d.page.locator('.band-label > span:first-child').allTextContents();
  assert.deepEqual(labels, ['Page header', 'Body', 'Page footer']);
  d.expectClean();
});

test('a click on a band label selects the band: label marked, Inspector shows the band, status says so', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  await label(d, 'Page footer').click();
  await until(
    async () => (await label(d, 'Page footer').getAttribute('class')).includes('sel'),
    3000,
    'label selected',
  );
  await insp(d).getByText('Print on the first page').waitFor();
  const v = await insp(d).getByLabel('Height (pt)').inputValue();
  assert.equal(Number(v), 30);
  // the body's label: the body's own props (sections), no print-on-first-page
  await label(d, 'Body').click();
  await insp(d).locator('[data-testid="body-sections"]').waitFor();
  assert.equal(await insp(d).getByText('Print on the first page').count(), 0);
  assert.equal(await d.page.locator('.band-label.sel').count(), 1);
  d.expectClean();
});

test('a click on an empty spot of a band selects that band', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  const b = await d.band('pageHeader').boundingBox();
  await d.page.mouse.click(b.x + b.width - 20, b.y + b.height / 2);
  await until(
    async () => (await label(d, 'Page header').getAttribute('class')).includes('sel'),
    3000,
    'header selected',
  );
  d.expectClean();
});

test('band Inspector: the height field sets the band height', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  await label(d, 'Page header').click();
  const f = insp(d).getByLabel('Height (pt)');
  await f.fill('72');
  await until(async () => (await d.def()).sections.pageHeader.height === 72, 3000, 'height 72');
  // the label shows the new height
  await until(async () => /72 pt/.test(await label(d, 'Page header').innerText()), 3000, 'label 72 pt');
  await d.focusCanvas();
  await d.undo();
  await until(async () => (await d.def()).sections.pageHeader.height === 40, 3000, 'undo to 40');
  d.expectClean();
});

test('band Inspector: a height below the lowest item stops at the item bottom', async () => {
  const d = await open(report([], { sections: { pageHeader: { height: 60, items: [tb('H', 0, 10, 100, 30)] } } }));
  await label(d, 'Page header').click();
  const f = insp(d).getByLabel('Height (pt)');
  await f.fill('5');
  await until(async () => (await d.def()).sections.pageHeader.height === 40, 3000, 'clamped to 40');
  d.expectClean();
});

test("regression: typing a height in a band's Inspector, key by key, gives the typed number", async () => {
  // the lowest item ends at 40: each key press stores max(40, typed) and the field shows that, so the next key appends to it
  const d = await open(report([], { sections: { pageHeader: { height: 60, items: [tb('H', 0, 10, 100, 30)] } } }));
  await label(d, 'Page header').click();
  const f = insp(d).getByLabel('Height (pt)');
  await f.click();
  await f.press('ControlOrMeta+a');
  await f.pressSequentially('120', { delay: 30 });
  await d.page.waitForTimeout(150);
  assert.equal((await d.def()).sections.pageHeader.height, 120, `typed 120, field reads ${await f.inputValue()}`);
  d.expectClean();
});

test('band resize: dragging the bottom edge down grows the band (snapped to the grid)', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  const s = await d.scale();
  await dragBandEdge(d, 'pageHeader', 40 * s);
  const h = (await d.def()).sections.pageHeader.height;
  assert.ok(Math.abs(h - 80) <= 4, `header height ${h}, expected about 80`);
  assert.equal(h % 4, 0, 'snapped to the 4 pt grid');
  // one undo step
  await d.focusCanvas();
  await d.undo();
  await until(async () => (await d.def()).sections.pageHeader.height === 40, 3000, 'undo');
  d.expectClean();
});

test('band resize: a band cannot be dragged shorter than its lowest item', async () => {
  const d = await open(report([tb('A', 10, 100, 100, 50)]), { viewport: { width: 1600, height: 2000 } });
  const s = await d.scale();
  await dragBandEdge(d, 'body', -380 * s);
  assert.equal((await d.def()).sections.body.height, 150);
  // the item is untouched
  const a = await d.get('A');
  assert.deepEqual([a.x, a.y, a.w, a.h], [10, 100, 100, 50]);
  d.expectClean();
});

test('band resize: an empty band drags down to 0 pt, never below', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  const s = await d.scale();
  await dragBandEdge(d, 'pageFooter', -200 * s);
  assert.equal((await d.def()).sections.pageFooter.height, 0);
  await until(
    async () => /^0 pt$/.test((await label(d, 'Page footer').locator('.h').innerText()).trim()),
    3000,
    '0 pt label',
  );
  d.expectClean();
});

test('a 0 pt page header: drawn, its label selectable, its edge drags it open again', async () => {
  const d = await open(report([tb('A', 10, 10)], { sections: { pageHeader: { height: 0, items: [] } } }));
  assert.equal(await d.band('pageHeader').count(), 1);
  await label(d, 'Page header').click();
  assert.equal(Number(await insp(d).getByLabel('Height (pt)').inputValue()), 0);
  const s = await d.scale();
  await dragBandEdge(d, 'pageHeader', 24 * s);
  const h = (await d.def()).sections.pageHeader.height;
  assert.ok(h >= 20 && h <= 28, `height ${h}`);
  d.expectClean();
});

test('a 0 pt page header takes an inserted item and grows to fit it', async () => {
  const d = await open(report([tb('A', 10, 10)], { sections: { pageHeader: { height: 0, items: [] } } }));
  await label(d, 'Page header').click();
  await d.page.locator('[data-testid="quick-textbox"]').click();
  const def = await until(
    async () => {
      const x = await d.def();
      return x.sections.pageHeader.items.length ? x : null;
    },
    3000,
    'item in header',
  );
  const it = def.sections.pageHeader.items[0];
  assert.ok(
    def.sections.pageHeader.height >= it.y + it.h,
    `header ${def.sections.pageHeader.height} < item bottom ${it.y + it.h}`,
  );
  assertSaneGeometry(def);
  d.expectClean();
});

test('an empty body shows the drop hint; with an item, no hint', async () => {
  const d = await open(report([]));
  await d.page.locator('[data-testid="band-empty"]').waitFor();
  await d.page.locator('[data-testid="quick-textbox"]').click();
  await until(async () => (await d.page.locator('[data-testid="band-empty"]').count()) === 0, 3000, 'hint gone');
  d.expectClean();
});

test('page header Inspector: print on the first and last page', async () => {
  const d = await open(report([]));
  await label(d, 'Page header').click();
  await insp(d).getByLabel('Print on the first page').uncheck();
  await insp(d).getByLabel('Print on the last page').uncheck();
  let def = await d.def();
  assert.equal(def.sections.pageHeader.printOnFirstPage, false);
  assert.equal(def.sections.pageHeader.printOnLastPage, false);
  await insp(d).getByLabel('Print on the first page').check();
  def = await d.def();
  assert.equal('printOnFirstPage' in def.sections.pageHeader, false, 'checked again: the key goes');
  d.expectClean();
});

test('body Inspector: newspaper columns draw column guides', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  await label(d, 'Body').click();
  const f = insp(d)
    .locator('label.field')
    .filter({ has: d.page.locator('span', { hasText: /^Columns$/ }) })
    .locator('input');
  await f.fill('3');
  await until(async () => (await d.def()).sections.body.columns?.count === 3, 3000, '3 columns');
  assert.equal(await d.band('body').locator('.col-guide').count(), 2);
  await f.fill('1');
  await until(async () => !(await d.def()).sections.body.columns, 3000, 'columns removed');
  d.expectClean();
});

test('add a body section: the body becomes a list, the new band is selected and drawn after the first', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  await label(d, 'Body').click();
  await insp(d).locator('[data-testid="add-body-section"]').click();
  const def = await until(
    async () => {
      const x = await d.def();
      return Array.isArray(x.sections.body) && x.sections.body.length === 2 ? x : null;
    },
    3000,
    'two sections',
  );
  assert.equal(def.sections.body[0].name, 'Section1');
  assert.equal(def.sections.body[1].name, 'Section2');
  assert.equal(def.sections.body[0].items[0].name, 'A', 'the first section keeps the items');
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'body:1', 'pageFooter']);
  assert.match(await d.page.locator('.band-label.sel').textContent(), /Section2/);
  // a third
  await insp(d).locator('[data-testid="add-body-section"]').click();
  await until(async () => (await d.def()).sections.body.length === 3, 3000, 'three sections');
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'body:1', 'body:2', 'pageFooter']);
  d.expectClean();
});

test('rename a body section: its label follows', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'Intro', height: 100, items: [] },
          { name: 'Detail', height: 100, items: [] },
        ],
      },
    }),
  );
  await label(d, 'Detail').click();
  await insp(d).getByLabel('Section name').fill('Appendix');
  await label(d, 'Appendix').waitFor();
  assert.equal((await d.def()).sections.body[1].name, 'Appendix');
  d.expectClean();
});

test('remove a body section: its items go, the others stay; one left is a single body again; undo brings it back', async () => {
  const two = {
    sections: {
      body: [
        { name: 'S1', height: 100, items: [tb('A', 0, 0)] },
        { name: 'S2', height: 100, items: [tb('B', 0, 0)] },
      ],
    },
  };
  const d = await open(report([], two));
  await label(d, 'S1').click();
  await insp(d).getByRole('button', { name: 'Remove this section' }).click();
  const def = await until(
    async () => {
      const x = await d.def();
      return !Array.isArray(x.sections.body) ? x : null;
    },
    3000,
    'single body',
  );
  assert.deepEqual(
    def.sections.body.items.map((i) => i.name),
    ['B'],
  );
  assert.equal('name' in def.sections.body, false, 'a single body has no section name');
  assert.equal(Designer.find(def, 'A'), null);
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'pageFooter']);
  await d.focusCanvas();
  await d.undo();
  const back = await until(
    async () => {
      const x = await d.def();
      return Array.isArray(x.sections.body) ? x : null;
    },
    3000,
    'undo',
  );
  assert.deepEqual(
    back.sections.body.map((s) => s.items[0].name),
    ['A', 'B'],
  );
  d.expectClean();
});

test('the last body section has no Remove button', async () => {
  const d = await open(report([]));
  await label(d, 'Body').click();
  await insp(d).locator('[data-testid="body-sections"]').waitFor();
  assert.equal(await insp(d).getByRole('button', { name: 'Remove this section' }).count(), 0);
  d.expectClean();
});

test('a body section with its own page keeps the list form when the other section is removed', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [] },
          { name: 'Wide', height: 100, items: [], page: { orientation: 'landscape' } },
        ],
      },
    }),
  );
  await label(d, 'S1').click();
  await insp(d).getByRole('button', { name: 'Remove this section' }).click();
  const def = await until(
    async () => {
      const x = await d.def();
      return x.sections.body.length === 1 ? x : null;
    },
    3000,
    'one left',
  );
  assert.ok(Array.isArray(def.sections.body));
  assert.equal(def.sections.body[0].page.orientation, 'landscape');
  d.expectClean();
});

test('a landscape body section draws a wider band', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [] },
          { name: 'S2', height: 100, items: [] },
        ],
      },
    }),
  );
  await label(d, 'S2').click();
  await insp(d)
    .locator('[data-testid="body-sections"]')
    .getByLabel(/orientation/i)
    .selectOption('landscape');
  await until(async () => (await d.def()).sections.body[1].page?.orientation === 'landscape', 3000, 'landscape');
  const w1 = (await d.band('body').boundingBox()).width,
    w2 = (await d.band('body:1').boundingBox()).width;
  assert.ok(w2 > w1 * 1.3, `landscape band ${w2} vs portrait ${w1}`);
  d.expectClean();
});

test('own page header: a copy of the shared one (new names) drawn above its section; none hides it; shared removes it', async () => {
  const d = await open(
    report([], {
      sections: {
        pageHeader: { height: 40, items: [tb('Logo', 0, 0)] },
        body: [
          { name: 'S1', height: 100, items: [] },
          { name: 'S2', height: 100, items: [] },
        ],
      },
    }),
  );
  await label(d, 'S2').click();
  await insp(d).locator('[data-testid="sec-header-mode"]').selectOption('own');
  let def = await until(
    async () => {
      const x = await d.def();
      return x.sections.body[1].pageHeader ? x : null;
    },
    3000,
    'own header',
  );
  const own = def.sections.body[1].pageHeader;
  assert.equal(own.height, 40);
  assert.equal(own.items.length, 1);
  assert.notEqual(own.items[0].name, 'Logo', 'a copy has a new name');
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'body:1:pageHeader', 'body:1', 'pageFooter']);
  await label(d, 'S2 · page header').waitFor();
  // its own band is a real band: select it by its label and resize it
  await label(d, 'S2 · page header').click();
  await insp(d).getByLabel('Height (pt)').fill('64');
  await until(async () => (await d.def()).sections.body[1].pageHeader.height === 64, 3000, 'own header 64');
  assert.equal((await d.def()).sections.pageHeader.height, 40, 'the shared header is not changed');
  // none
  await label(d, 'S2').click();
  await insp(d).locator('[data-testid="sec-header-mode"]').selectOption('none');
  def = await until(
    async () => {
      const x = await d.def();
      return x.sections.body[1].pageHeader?.hidden ? x : null;
    },
    3000,
    'none',
  );
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'body:1', 'pageFooter']);
  // shared
  await insp(d).locator('[data-testid="sec-header-mode"]').selectOption('shared');
  def = await until(
    async () => {
      const x = await d.def();
      return !('pageHeader' in x.sections.body[1]) ? x : null;
    },
    3000,
    'shared',
  );
  d.expectClean();
});

test('own page footer: drawn below its section; items can be inserted into it', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [] },
          { name: 'S2', height: 100, items: [] },
        ],
      },
    }),
  );
  await label(d, 'S1').click();
  await insp(d).locator('[data-testid="sec-footer-mode"]').selectOption('own');
  await until(async () => (await bandKeys(d)).includes('body:0:pageFooter'), 3000, 'own footer band');
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'body:0:pageFooter', 'body:1', 'pageFooter']);
  // the shared footer was 30 pt with no items: the own one starts at 30
  assert.equal((await d.def()).sections.body[0].pageFooter.height, 30);
  await label(d, 'S1 · page footer').click();
  await d.page.locator('[data-testid="quick-textbox"]').click();
  const def = await until(
    async () => {
      const x = await d.def();
      return x.sections.body[0].pageFooter.items.length ? x : null;
    },
    3000,
    'item in own footer',
  );
  assert.equal(def.sections.pageFooter.items.length, 0, 'not in the shared footer');
  d.expectClean();
});

test('a table can not go into an own page header: the toolbox puts it in the body section', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [], pageHeader: { height: 30, items: [] } },
          { name: 'S2', height: 100, items: [] },
        ],
      },
    }),
  );
  await label(d, 'S1 · page header').click();
  await d.page.locator('[data-testid="quick-table"]').click();
  const def = await until(
    async () => {
      const x = await d.def();
      return x.sections.body[0].items.length ? x : null;
    },
    3000,
    'table inserted',
  );
  assert.equal(def.sections.body[0].items[0].type, 'table');
  assert.equal(def.sections.body[0].pageHeader.items.length, 0);
  d.expectClean();
});

test('resizing one body section does not change another', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [] },
          { name: 'S2', height: 120, items: [] },
        ],
      },
    }),
  );
  const s = await d.scale();
  await dragBandEdge(d, 'body:1', 40 * s);
  const def = await d.def();
  assert.equal(def.sections.body[0].height, 100);
  assert.ok(Math.abs(def.sections.body[1].height - 160) <= 4, `S2 ${def.sections.body[1].height}`);
  d.expectClean();
});

test('band resize while a band item is selected keeps the selection and the item', async () => {
  const d = await open(report([tb('A', 10, 10)]));
  await pick(d, 'A');
  const s = await d.scale();
  await dragBandEdge(d, 'body', 20 * s);
  assert.deepEqual(await d.selected(), ['A']);
  const a = await d.get('A');
  assert.deepEqual([a.x, a.y], [10, 10]);
  d.expectClean();
});

test('reading the bands with a report whose body list is empty: one body band', async () => {
  const d = await open(report([], { sections: { body: [] } }));
  assert.deepEqual(await bandKeys(d), ['pageHeader', 'body', 'pageFooter']);
  d.expectClean();
});

test('outline lists every band, own bands too, and selects a band', async () => {
  const d = await open(
    report([], {
      sections: {
        body: [
          { name: 'S1', height: 100, items: [], pageFooter: { height: 20, items: [] } },
          { name: 'S2', height: 100, items: [] },
        ],
      },
    }),
  );
  await d.page.locator('[data-testid="rail-outline"]').click();
  const bands = d.page.locator('.outline-band');
  await bands.first().waitFor();
  const names = await bands.allInnerTexts();
  assert.deepEqual(names, ['Page header', 'S1', 'S1 · page footer', 'S2', 'Page footer']);
  await bands.nth(2).click();
  await until(
    async () => (await label(d, 'S1 · page footer').getAttribute('class')).includes('sel'),
    3000,
    'own footer selected',
  );
  d.expectClean();
});
