// Designer canvas: selecting items with the mouse and the keyboard, in every band, nested items, table cells and
// layers. Run: node --test tests/designer/canvas-selection.test.mjs (BROWSER=firefox|webkit for the other engines).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, assertSaneGeometry } from './harness.mjs';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

/** Poll fn until it returns a truthy value (or time out with the last value). */
async function until(fn, { timeout = 3000, every = 25 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return v;
}
const sorted = (a) => [...a].sort();
/** Wait until a locator's box stops moving (fonts settle the layout). */
async function settled(loc) {
  let prev = null;
  return until(
    async () => {
      const b = await loc.boundingBox();
      const same = prev && b && JSON.stringify(b) === JSON.stringify(prev);
      prev = b;
      return same ? b : null;
    },
    { every: 60 },
  );
}
/** A designer whose page has its final size ("fit" zoom measures the canvas after the first paint). */
async function open(def, opts) {
  const d = await env.open(def, opts);
  await settled(d.page.locator('[data-testid="paper"]'));
  return d;
}

/** A page point (pt in a band) as client px. */
async function at(d, section, x, y) {
  const b = await d.band(section).boundingBox();
  const s = await d.scale();
  return { x: b.x + x * s, y: b.y + y * s };
}
/** Drag on the empty band area from one pt point to another (a marquee). */
async function marquee(d, section, x0, y0, x1, y1, modifiers = []) {
  const p = await at(d, section, x0, y0),
    q = await at(d, section, x1, y1);
  await d.drag(p.x, p.y, q.x, q.y, { modifiers });
}
const three = () => report([tb('A', 20, 20), tb('B', 200, 20), tb('C', 20, 200)]);

const table = (name, x, y) => ({
  type: 'table',
  name,
  x,
  y,
  columns: [{ width: 80 }, { width: 80 }, { width: 80 }],
  header: [{ height: 18, cells: [{ value: 'H1' }, { value: 'H2' }, { value: 'H3' }] }],
  detail: [{ height: 18, cells: [{ value: 'D1' }, { value: 'D2' }, { value: 'D3' }] }],
  footer: [{ height: 18, cells: [{ value: 'F1' }, { value: 'F2' }, { value: 'F3' }] }],
});
const cell = (d, name, part, row, col) =>
  d.page.locator(`.tbl[data-item="${name}"] [data-cell="${part}-${row}-${col}"]`);
const selCells = (d, name) =>
  d.page.locator(`.tbl[data-item="${name}"] .cell.sel`).evaluateAll((els) => els.map((e) => e.dataset.cell));

/* ------------------------------------------------------------------ click */

test('click selects one item; the status bar and the Inspector name it', async () => {
  const d = await open(three());
  await d.click('A');
  assert.deepEqual(await d.selected(), ['A']);
  assert.equal(await d.status(), 'A · Text box · 20, 20 · 100 × 20 pt');
  assert.equal(await d.page.locator('[data-testid="inspector"] .insp-head input').inputValue(), 'A');
  // eight resize handles on a single selection
  assert.equal(await d.item('A').locator('.handle').count(), 8);
  await d.click('B');
  assert.deepEqual(await d.selected(), ['B']);
  assert.equal(await d.item('A').locator('.handle').count(), 0);
  assertSaneGeometry(await d.def());
  d.expectClean();
});

test('Shift-click adds and removes items; no handles on a multiple selection', async () => {
  const d = await open(three());
  await d.click('A');
  await d.click('B', ['Shift']);
  assert.deepEqual(sorted(await d.selected()), ['A', 'B']);
  assert.equal(await d.status(), '2 items selected');
  assert.equal(await d.page.locator('.it .handle').count(), 0);
  await d.click('C', ['Shift']);
  assert.equal(await d.status(), '3 items selected');
  await d.click('B', ['Shift']);
  assert.deepEqual(sorted(await d.selected()), ['A', 'C']);
  await d.click('A', ['Shift']);
  await d.click('C', ['Shift']);
  // the last one removed: the report is selected
  assert.deepEqual(await d.selected(), []);
  assert.equal(await d.status(), 'Report');
  // Shift-click with nothing selected starts a selection
  await d.click('B', ['Shift']);
  assert.deepEqual(await d.selected(), ['B']);
  assertSaneGeometry(await d.def());
  d.expectClean();
});

test('Ctrl/Cmd-click on an item replaces the selection (only Shift-click toggles, as the shortcuts list says)', async () => {
  const d = await open(three());
  await d.click('A');
  await d.click('B', ['ControlOrMeta']);
  assert.deepEqual(await d.selected(), ['B']);
  // the shortcuts dialog promises Shift-click only
  await d.page.keyboard.press('?');
  const grid = d.page.locator('.kbd-grid');
  await grid.waitFor();
  const text = await grid.innerText();
  assert.match(text, /⇧ Click/);
  assert.doesNotMatch(text, /Ctrl Click|⌘ Click/);
  await d.page.keyboard.press('Escape');
  d.expectClean();
});

test('Shift-click on an item already in a selection removes it without moving anything', async () => {
  const d = await open(three());
  const before = await d.def();
  await d.click('A');
  await d.click('B', ['Shift']);
  // a Shift drag toggles: it is not a move
  await d.dragItem('B', 60, 60, { modifiers: ['Shift'] });
  assert.deepEqual(await d.selected(), ['A']);
  assert.deepEqual((await d.get('B')).x, before.sections.body.items[1].x);
  assert.deepEqual((await d.get('B')).y, before.sections.body.items[1].y);
  d.expectClean();
});

/* ------------------------------------------------------------------ marquee */

test('marquee on empty band space selects the items it touches; a click there selects the band', async () => {
  const d = await open(three());
  // from (10,10) to (210,30): touches A fully and B partly, not C
  await marquee(d, 'body', 10, 10, 210, 30);
  assert.deepEqual(sorted(await d.selected()), ['A', 'B']);
  assert.equal(await d.status(), '2 items selected');
  // dragged up and left (from bottom right to top left) gives the same rectangle
  await marquee(d, 'body', 130, 230, 10, 190);
  assert.deepEqual(await d.selected(), ['C']);
  // a click (no drag) on empty space: the band
  const p = await at(d, 'body', 400, 300);
  await d.page.mouse.click(p.x, p.y);
  assert.deepEqual(await d.selected(), []);
  assert.equal(await d.status(), 'Band: Body');
  // a marquee over nothing: the band
  await marquee(d, 'body', 300, 300, 400, 380);
  assert.equal(await d.status(), 'Band: Body');
  d.expectClean();
});

test('Shift-marquee adds to the selection; a plain marquee replaces it', async () => {
  const d = await open(three());
  await d.click('C');
  await marquee(d, 'body', 10, 10, 130, 30, ['Shift']);
  assert.deepEqual(sorted(await d.selected()), ['A', 'C']);
  // Shift-marquee over an item already selected keeps it (adds, never toggles)
  await marquee(d, 'body', 10, 10, 330, 30, ['Shift']);
  assert.deepEqual(sorted(await d.selected()), ['A', 'B', 'C']);
  await marquee(d, 'body', 190, 10, 330, 30);
  assert.deepEqual(await d.selected(), ['B']);
  // a Shift click on empty space keeps the selection
  const p = await at(d, 'body', 400, 300);
  await d.page.keyboard.down('Shift');
  await d.page.mouse.click(p.x, p.y);
  await d.page.keyboard.up('Shift');
  assert.deepEqual(await d.selected(), ['B']);
  d.expectClean();
});

test('marquee stays in its band: a drag from the body into the footer selects body items only', async () => {
  const def = report([tb('A', 20, 360)], {
    sections: {
      pageFooter: { height: 30, items: [tb('F', 20, 5)] },
      pageHeader: { height: 40, items: [tb('H', 20, 10)] },
    },
  });
  const d = await open(def);
  const p = await at(d, 'body', 10, 350);
  const q = await at(d, 'pageFooter', 200, 25);
  await d.drag(p.x, p.y, q.x, q.y);
  assert.deepEqual(await d.selected(), ['A']);
  // a marquee in the page header
  await marquee(d, 'pageHeader', 5, 2, 300, 38);
  assert.deepEqual(await d.selected(), ['H']);
  assert.equal(await d.status(), 'H · Text box · 20, 10 · 100 × 20 pt');
  d.expectClean();
});

test('marquee selects top-level items: a container, not the children inside it', async () => {
  const box = { type: 'container', name: 'Box', x: 20, y: 20, w: 200, h: 80, items: [tb('Kid', 10, 10, 80, 20)] };
  const d = await open(report([box, tb('A', 300, 20)]));
  await marquee(d, 'body', 10, 10, 250, 120);
  assert.deepEqual(await d.selected(), ['Box']);
  d.expectClean();
});

/* ------------------------------------------------------------------ keyboard */

test('Ctrl+A selects every item of the band in use; Escape clears', async () => {
  const def = report([tb('A', 20, 20), tb('B', 200, 20)], {
    sections: {
      pageHeader: { height: 40, items: [tb('H1', 0, 5), tb('H2', 200, 5)] },
      pageFooter: { height: 30, items: [tb('F1', 0, 5)] },
    },
  });
  const d = await open(def);
  await d.focusCanvas();
  // nothing selected: the body
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.deepEqual(sorted(await d.selected()), ['A', 'B']);
  // an item of the header selected: the header's items
  await d.click('H1');
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.deepEqual(sorted(await d.selected()), ['H1', 'H2']);
  // a band selected by its label: that band
  await d.page.locator('.band-label', { hasText: 'Page footer' }).click();
  assert.equal(await d.status(), 'Band: Page footer');
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.deepEqual(await d.selected(), ['F1']);
  await d.page.keyboard.press('Escape');
  assert.deepEqual(await d.selected(), []);
  assert.equal(await d.status(), 'Report');
  d.expectClean();
});

test('Ctrl+A in an empty band keeps the band selected', async () => {
  const d = await open(report([tb('A', 20, 20)]));
  await d.page.locator('.band-label', { hasText: 'Page header' }).click();
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.equal(await d.status(), 'Band: Page header');
  assert.deepEqual(await d.selected(), []);
  d.expectClean();
});

test('Tab walks the items; Enter and Space select, Shift+Enter toggles, Shift+Tab goes back', async () => {
  const d = await open(three());
  const name = (n) => d.page.locator(`.it[data-item="${n}"]`);
  // the items are Tab stops, named with their type, name and place
  assert.equal(await name('A').getAttribute('tabindex'), '0');
  assert.equal(await name('A').getAttribute('aria-label'), 'Text box A, x 20, y 20');
  await name('A').focus();
  await d.page.keyboard.press('Enter');
  assert.deepEqual(await d.selected(), ['A']);
  await d.page.keyboard.press('Tab');
  const focused = () =>
    d.page.evaluate(() => document.querySelector('#d').shadowRoot.activeElement?.dataset?.item || null);
  assert.equal(await focused(), 'B');
  await d.page.keyboard.press('Shift+Enter');
  assert.deepEqual(sorted(await d.selected()), ['A', 'B']);
  await d.page.keyboard.press('Shift+Enter');
  assert.deepEqual(await d.selected(), ['A']);
  await d.page.keyboard.press('Tab');
  assert.equal(await focused(), 'C');
  await d.page.keyboard.press(' ');
  assert.deepEqual(await d.selected(), ['C']);
  await d.page.keyboard.press('Shift+Tab');
  assert.equal(await focused(), 'B');
  // Shift+Enter on the only selected item clears the selection
  await name('C').focus();
  await d.page.keyboard.press('Shift+Enter');
  assert.deepEqual(await d.selected(), []);
  assert.equal(await d.status(), 'Report');
  // the selected item takes the arrows as after a click
  await name('A').focus();
  await d.page.keyboard.press('Enter');
  await d.page.keyboard.press('ArrowRight');
  assert.equal((await d.get('A')).x, 24); // snap to grid is on by default: one grid step
  d.expectClean();
});

/* ------------------------------------------------------------------ bands */

test('items in every band and in each body section are selected and named in the status bar', async () => {
  const def = report([], {
    sections: {
      pageHeader: { height: 40, items: [tb('H', 10, 10)] },
      body: [
        { name: 'Intro', height: 120, items: [tb('S1', 10, 10)] },
        { name: 'Detail', height: 120, items: [tb('S2', 30, 40)] },
      ],
      pageFooter: { height: 30, items: [tb('F', 10, 5)] },
    },
  });
  const d = await open(def);
  const where = () => d.page.locator('[data-testid="inspector"] .cat .hint').first().innerText();
  for (const [n, band, label] of [
    ['H', 'pageHeader', 'Page header'],
    ['S1', 'body', 'Intro'],
    ['S2', 'body:1', 'Detail'],
    ['F', 'pageFooter', 'Page footer'],
  ]) {
    await d.click(n);
    assert.deepEqual(await d.selected(), [n], n);
    assert.match(await d.status(), new RegExp(`^${n} · Text box`));
    assert.equal((await d.get(n)).band, band.startsWith('body') ? (band === 'body' ? 'body' : 'body:1') : band);
    assert.match(await where(), new RegExp(label));
  }
  // a marquee in the second section selects only its items
  await marquee(d, 'body:1', 5, 5, 300, 100);
  assert.deepEqual(await d.selected(), ['S2']);
  // Ctrl+A with the item of the second section selected: that section's items
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.deepEqual(await d.selected(), ['S2']);
  // a click on the band label selects the section
  await d.page.locator('.band-label', { hasText: 'Detail' }).click();
  assert.equal(await d.status(), 'Band: Detail');
  d.expectClean();
});

/* ------------------------------------------------------------------ nesting */

test('a click inside a container selects the child; the container is selected by its own area', async () => {
  const box = { type: 'container', name: 'Box', x: 20, y: 20, w: 200, h: 80, items: [tb('Kid', 100, 40, 80, 20)] };
  const list = { type: 'list', name: 'Lst', x: 260, y: 20, w: 200, h: 80, items: [tb('Row', 10, 10, 80, 20)] };
  const d = await open(report([box, list]));
  await d.click('Kid');
  assert.deepEqual(await d.selected(), ['Kid']);
  assert.match(await d.status(), /^Kid · Text box · 100, 40 ·/);
  assert.match(await d.page.locator('[data-testid="inspector"] .cat .hint').first().innerText(), /Box/);
  await d.click('Box');
  assert.deepEqual(await d.selected(), ['Box']);
  await d.click('Row', ['Shift']);
  assert.deepEqual(sorted(await d.selected()), ['Box', 'Row']);
  await d.click('Lst');
  assert.deepEqual(await d.selected(), ['Lst']);
  // Ctrl+A with a child selected: the band's top-level items (not the children)
  await d.click('Kid');
  await d.page.keyboard.press('ControlOrMeta+a');
  assert.deepEqual(sorted(await d.selected()), ['Box', 'Lst']);
  d.expectClean();
});

test('table: a cell click selects a cell, Shift a range, Ctrl/Cmd adds and removes; the grip selects the table', async () => {
  const d = await open(report([table('T1', 10, 40)]));
  await cell(d, 'T1', 'header', 0, 0).click();
  assert.deepEqual(await selCells(d, 'T1'), ['header-0-0']);
  assert.equal(await d.status(), 'Cell in T1');
  // Shift: the rectangle from the first cell to this one
  await cell(d, 'T1', 'detail', 0, 1).click({ modifiers: ['Shift'] });
  assert.deepEqual(sorted(await selCells(d, 'T1')), ['detail-0-0', 'detail-0-1', 'header-0-0', 'header-0-1']);
  // Ctrl/Cmd: add one, then take it away again
  await cell(d, 'T1', 'footer', 0, 2).click({ modifiers: ['ControlOrMeta'] });
  assert.equal((await selCells(d, 'T1')).length, 5);
  await cell(d, 'T1', 'footer', 0, 2).click({ modifiers: ['ControlOrMeta'] });
  assert.equal((await selCells(d, 'T1')).length, 4);
  await cell(d, 'T1', 'header', 0, 0).click({ modifiers: ['ControlOrMeta'] });
  assert.deepEqual(sorted(await selCells(d, 'T1')), ['detail-0-0', 'detail-0-1', 'header-0-1']);
  // a column handle selects the column; a row tag the row
  await d.page.locator('.tbl[data-item="T1"] [data-col-handle="2"]').click();
  assert.deepEqual(sorted(await selCells(d, 'T1')), ['detail-0-2', 'footer-0-2', 'header-0-2']);
  await d.page.locator('.tbl[data-item="T1"] [data-row-handle="footer-0"]').click();
  assert.deepEqual(sorted(await selCells(d, 'T1')), ['footer-0-0', 'footer-0-1', 'footer-0-2']);
  // the grip: the table as an item
  await d.page.locator('.tbl[data-item="T1"] .grip').click();
  assert.deepEqual(await d.page.locator('.tbl.sel').evaluateAll((els) => els.map((e) => e.dataset.item)), ['T1']);
  assert.match(await d.status(), /^T1 · Table · 10, 40 · 240 × 54 pt$/);
  assert.deepEqual(await selCells(d, 'T1'), []);
  // Escape: nothing
  await d.page.keyboard.press('Escape');
  assert.equal(await d.status(), 'Report');
  d.expectClean();
});

test('table: a drag across cells selects the rectangle it covers', async () => {
  const d = await open(report([table('T1', 10, 40)]));
  await settled(d.page.locator('.tbl[data-item="T1"]'));
  const a = await cell(d, 'T1', 'header', 0, 0).boundingBox();
  const b = await cell(d, 'T1', 'detail', 0, 2).boundingBox();
  await d.drag(a.x + 5, a.y + 5, b.x + 5, b.y + 5);
  assert.equal((await selCells(d, 'T1')).length, 6);
  assert.deepEqual((await d.get('T1')).x, 10); // a drag on cells never moves the table
  d.expectClean();
});

/* ------------------------------------------------------------------ layers */

const layered = (layer) =>
  report([tb('Free', 20, 20), tb('L1', 200, 20, 100, 40, { layer: 'Back' })], { layers: [{ name: 'Back', ...layer }] });

test('locked layer: its items are drawn but a click, a marquee or a drag never takes them', async () => {
  const d = await open(layered({ locked: true }));
  assert.equal(await d.page.locator('[data-locked="L1"]').count(), 1);
  await d.click('L1');
  assert.deepEqual(await d.selected(), []);
  assert.equal(await d.status(), 'Band: Body'); // the click goes through to the band
  await marquee(d, 'body', 10, 10, 400, 100);
  assert.deepEqual(await d.selected(), ['Free']);
  const before = await d.get('L1');
  await d.dragItem('L1', 80, 80);
  const after = await d.get('L1');
  assert.deepEqual([after.x, after.y], [before.x, before.y]);
  // Delete with the free item selected leaves the locked one
  await d.click('Free');
  await d.page.keyboard.press('Delete');
  assert.ok(await d.get('L1'));
  assert.equal(await d.get('Free'), null);
  d.expectClean();
});

test('regression: a locked layer item is selected, moved and deleted from the keyboard (Tab, Enter, arrows, Delete)', async () => {
  const d = await open(layered({ locked: true }));
  await d.page.locator('.it[data-item="L1"]').focus();
  await d.page.keyboard.press('Enter');
  await d.page.keyboard.press('ArrowRight');
  await d.page.keyboard.press('Delete');
  const l1 = await d.get('L1');
  // a locked item cannot be taken with the mouse: the keyboard must not take it either
  assert.ok(l1, 'the locked item was deleted');
  assert.equal(l1.x, 200, 'the locked item was moved');
  d.expectClean();
});

test('hidden layer: its items are not drawn and a marquee does not take them', async () => {
  const d = await open(layered({ visible: false }));
  assert.equal(await d.page.locator('.it[data-item="L1"]').count(), 0);
  await marquee(d, 'body', 10, 10, 400, 100);
  assert.deepEqual(await d.selected(), ['Free']);
  // still in the definition
  assert.ok(await d.get('L1'));
  d.expectClean();
});

/* ------------------------------------------------------------------ status bar */

test('status bar: report, band, item, items, cell, and the page size in the chosen unit', async () => {
  const d = await open(report([tb('A', 20.4, 19.6, 100.4, 20), table('T1', 10, 60)]));
  const page = () => d.page.locator('.dstatus-page').innerText();
  assert.equal(await d.status(), 'Report');
  assert.equal(await page(), 'Page A4 · 595 × 842 pt');
  await d.click('A');
  assert.equal(await d.status(), 'A · Text box · 20, 20 · 100 × 20 pt'); // rounded
  await d.page.locator('.tbl[data-item="T1"] .grip').click({ modifiers: ['Shift'] });
  assert.equal(await d.status(), '2 items selected');
  await cell(d, 'T1', 'detail', 0, 1).click();
  assert.equal(await d.status(), 'Cell in T1');
  await d.page.getByLabel('Units').selectOption('mm');
  assert.equal(await page(), 'Page A4 · 210 × 297 mm');
  await d.page.getByLabel('Units').selectOption('in');
  assert.equal(await page(), 'Page A4 · 8.3 × 11.7 in');
  d.expectClean();
});

test('readOnly: items are still selectable and named, but nothing moves', async () => {
  const d = await open(three(), { readOnly: true });
  await d.click('A');
  assert.deepEqual(await d.selected(), ['A']);
  await d.dragItem('A', 60, 60);
  await d.page.keyboard.press('ArrowRight');
  const a = await d.get('A');
  assert.deepEqual([a.x, a.y], [20, 20]);
  assert.equal(await d.dirty(), false);
  d.expectClean();
});
