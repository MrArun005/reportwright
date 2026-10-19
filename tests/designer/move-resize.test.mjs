// Designer canvas: moving and resizing items (mouse, arrows, handles), snapping, smart guides, align and distribute,
// z-order, units, band heights, moves between bands, cell mode, zoom. After each step the geometry stays sane.
// Run: node --test tests/designer/move-resize.test.mjs (BROWSER=firefox|webkit for the other engines).
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

const BW = 523.28; // A4 with 36 pt margins
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const box = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h });

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
/** Wait until a locator's box stops moving (fonts and live items settle the layout). */
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
async function sane(d) {
  assertSaneGeometry(await d.def());
}
async function snapOff(d) {
  const c = d.page.getByLabel('Snap to grid');
  await c.uncheck();
}
async function setZoom(d, z) {
  const before = await d.page.locator('[data-testid="paper"]').boundingBox();
  await d.page.locator('[data-testid="zoom"]').selectOption(String(z));
  await until(async () => (await d.page.locator('[data-testid="paper"]').boundingBox()).width !== before.width);
  await settled(d.page.locator('[data-testid="paper"]'));
}
/** Drag a resize handle of the (single) selected item by (dx, dy) pt. */
async function resize(d, name, dir, dxPt, dyPt, opts) {
  const s = await d.scale();
  const h = await d.item(name).locator('.handle').nth(HANDLES.indexOf(dir)).boundingBox();
  const x = h.x + h.width / 2,
    y = h.y + h.height / 2;
  await d.drag(x, y, x + dxPt * s, y + dyPt * s, opts);
}
/** Drag an item by (dx, dy) pt. */
async function move(d, name, dxPt, dyPt, opts) {
  const s = await d.scale();
  await d.dragItem(name, dxPt * s, dyPt * s, opts);
}

/* ------------------------------------------------------------------ mouse move */

test('drag moves an item; with Snap to grid on the place is whole grid steps', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  await settled(d.item('A'));
  await move(d, 'A', 40, 32);
  assert.deepEqual(box(await d.get('A')), { x: 140, y: 132, w: 100, h: 20 });
  // an uneven distance lands on the grid
  await move(d, 'A', 13.3, 6.6);
  const a = await d.get('A');
  assert.equal(a.x % 4, 0);
  assert.equal(a.y % 4, 0);
  await sane(d);
  // one undo step per drag
  await d.undo(2);
  assert.deepEqual(box(await d.get('A')), { x: 100, y: 100, w: 100, h: 20 });
  d.expectClean();
});

test('drag with Snap to grid off keeps fractions (two decimals)', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  await snapOff(d);
  await move(d, 'A', 13.3, 6.6);
  const a = await d.get('A');
  assert.ok(near(a.x, 113.3, 0.6) && near(a.y, 106.6, 0.6), JSON.stringify(a));
  assert.equal(Math.round(a.x * 100) / 100, a.x);
  await sane(d);
  d.expectClean();
});

test('the drag shows a badge with the place, and nothing changes until the mouse is released', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  const s = await d.scale();
  const b = await d.item('A').boundingBox();
  await d.page.mouse.move(b.x + 5, b.y + 5);
  await d.page.mouse.down();
  await d.page.mouse.move(b.x + 5 + 20 * s, b.y + 5 + 40 * s, { steps: 4 });
  assert.equal(await d.page.locator('.guide-badge').innerText(), '120, 140');
  assert.equal((await d.get('A')).x, 100);
  await d.page.mouse.up();
  assert.equal((await d.get('A')).x, 120);
  assert.equal(await d.page.locator('.guide-badge').count(), 0);
  d.expectClean();
});

test('a multiple selection moves together', async () => {
  const d = await open(report([tb('A', 100, 100), tb('B', 300, 200)]));
  await d.click('A');
  await d.click('B', ['Shift']);
  await move(d, 'A', 20, 20, { modifiers: [] });
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [120, 120]);
  assert.deepEqual([(await d.get('B')).x, (await d.get('B')).y], [320, 220]);
  await sane(d);
  d.expectClean();
});

test('drag far outside the page: the item stays inside its band (left, top, right)', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  await move(d, 'A', -2000, -2000);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [0, 0]);
  await sane(d);
  await move(d, 'A', 3000, 0);
  assert.ok(near((await d.get('A')).x, BW - 100), String((await d.get('A')).x));
  await sane(d);
  d.expectClean();
});

test('drag far below the page: the item stays in the body, which grows to hold it', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  await move(d, 'A', 0, 900);
  const def = await d.def();
  const a = await d.get('A');
  assert.equal(a.band, 'body');
  assert.ok(def.sections.body.height >= a.y + a.h);
  await sane(d);
  d.expectClean();
});

/* ------------------------------------------------------------------ zoom */

for (const z of [0.5, 2]) {
  test(`at ${z * 100}% zoom a drag, a resize and a marquee use page points`, async () => {
    const d = await open(report([tb('A', 100, 100, 100, 20), tb('B', 300, 300, 40, 20)]));
    await setZoom(d, z);
    assert.ok(near(await d.scale(), (z * 96) / 72, 0.01));
    await d.item('A').scrollIntoViewIfNeeded();
    await move(d, 'A', 40, 20);
    assert.deepEqual(box(await d.get('A')), { x: 140, y: 120, w: 100, h: 20 });
    await resize(d, 'A', 'se', 20, 12);
    assert.deepEqual(box(await d.get('A')), { x: 140, y: 120, w: 120, h: 32 });
    await d.press('Shift+ArrowLeft');
    assert.equal((await d.get('A')).x, 100);
    // a marquee from (290, 290) to (350, 330) pt takes B only
    await d.item('B').scrollIntoViewIfNeeded();
    const band = await d.band('body').boundingBox();
    const s = await d.scale();
    await d.drag(band.x + 290 * s, band.y + 290 * s, band.x + 350 * s, band.y + 330 * s);
    assert.deepEqual(await d.selected(), ['B']);
    await sane(d);
    d.expectClean();
  });
}

/* ------------------------------------------------------------------ arrows */

test('arrows: 1 pt (Shift 10) with Snap to grid off, one grid step (Shift 10) with it on', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 20)]));
  await d.click('A');
  // Snap to grid is on by default: 4 pt
  await d.press(['ArrowRight', 'ArrowDown']);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [104, 104]);
  await d.press(['Shift+ArrowLeft', 'Shift+ArrowUp']);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [64, 64]);
  await snapOff(d);
  await d.click('A');
  await d.press(['ArrowRight', 'ArrowDown']);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [65, 65]);
  await d.press(['Shift+ArrowRight', 'Shift+ArrowDown']);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [75, 75]);
  // Alt+arrows never nudge
  await d.press('Alt+ArrowRight');
  assert.equal((await d.get('A')).x, 75);
  await sane(d);
  d.expectClean();
});

test('arrows in cell mode move one cell (Shift: ten)', async () => {
  const d = await open(report([tb('A', 24, 24, 48, 24)]));
  await d.page.locator('[data-testid="cell-mode"]').check();
  await d.click('A');
  await d.press('ArrowRight');
  assert.equal((await d.get('A')).x, 36);
  await d.press('Shift+ArrowDown');
  assert.equal((await d.get('A')).y, 144);
  await d.page.locator('[data-testid="cell-size"]').selectOption('24');
  await d.click('A');
  await d.press('ArrowLeft');
  assert.equal((await d.get('A')).x, 12);
  await sane(d);
  d.expectClean();
});

test('arrows at the band start: x and y never go below 0', async () => {
  const d = await open(report([tb('A', 0, 0, 100, 20), tb('B', 2, 3, 50, 20)]));
  await d.click('A');
  await d.press(['ArrowLeft', 'ArrowUp', 'Shift+ArrowLeft', 'Shift+ArrowUp']);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [0, 0]);
  await d.click('B');
  await d.press(['Shift+ArrowLeft', 'Shift+ArrowUp']);
  assert.deepEqual([(await d.get('B')).x, (await d.get('B')).y], [0, 0]);
  await sane(d);
  d.expectClean();
});

test('many nudges right move the item past the band edge on purpose; the Issues list flags it', async () => {
  const d = await open(report([tb('A', 400, 10, 100, 20)]));
  await d.click('A');
  for (let i = 0; i < 5; i++) await d.press('Shift+ArrowRight');
  const a = await d.get('A');
  assert.equal(a.x, 600); // the whole step (E12), never clamped
  assert.ok(Number.isFinite(a.x) && a.w === 100);
  const issues = d.page.locator('[data-testid="issues"]');
  await issues.waitFor();
  await issues.click();
  assert.match(await d.page.locator('[data-testid="issues-list"]').innerText(), /A/);
  // a mouse drag brings it back inside
  await d.page.keyboard.press('Escape');
  await d.page.locator('[data-testid="zoom"]').selectOption('0.5');
  await settled(d.item('A'));
  await move(d, 'A', -10, 0);
  assert.ok((await d.get('A')).x + 100 <= BW + 0.01);
  await sane(d);
  d.expectClean();
});

/* ------------------------------------------------------------------ resize */

const EXPECT = {
  nw: { x: 120, y: 120, w: 80, h: 20 },
  n: { x: 100, y: 120, w: 100, h: 20 },
  ne: { x: 100, y: 120, w: 120, h: 20 },
  e: { x: 100, y: 100, w: 120, h: 40 },
  se: { x: 100, y: 100, w: 120, h: 60 },
  s: { x: 100, y: 100, w: 100, h: 60 },
  sw: { x: 120, y: 100, w: 80, h: 60 },
  w: { x: 120, y: 100, w: 80, h: 40 },
};
test('resize from each of the 8 handles by (+20, +20) pt', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 40)]));
  for (const dir of HANDLES) {
    await d.click('A');
    await resize(d, 'A', dir, 20, 20);
    assert.deepEqual(box(await d.get('A')), EXPECT[dir], dir);
    await sane(d);
    await d.undo();
    assert.deepEqual(box(await d.get('A')), { x: 100, y: 100, w: 100, h: 40 }, `undo ${dir}`);
  }
  d.expectClean();
});

test('resize shows the size badge while dragging', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 40)]));
  await d.click('A');
  const s = await d.scale();
  const h = await d.item('A').locator('.handle').nth(4).boundingBox();
  await d.page.mouse.move(h.x + 4, h.y + 4);
  await d.page.mouse.down();
  await d.page.mouse.move(h.x + 4 + 20 * s, h.y + 4 + 8 * s, { steps: 4 });
  assert.equal(await d.page.locator('.guide-badge').innerText(), '120 × 48');
  await d.page.mouse.up();
  d.expectClean();
});

test('resize to zero stops at 4 pt from every side', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 40)]));
  for (const [dir, dx, dy, want] of [
    ['e', -500, 0, { x: 100, y: 100, w: 4, h: 40 }],
    ['s', 0, -500, { x: 100, y: 100, w: 100, h: 4 }],
    ['se', -500, -500, { x: 100, y: 100, w: 4, h: 4 }],
    ['nw', 500, 500, { x: 196, y: 136, w: 4, h: 4 }],
    ['w', 500, 0, { x: 196, y: 100, w: 4, h: 40 }],
    ['n', 0, 500, { x: 100, y: 136, w: 100, h: 4 }],
  ]) {
    await d.click('A');
    await resize(d, 'A', dir, dx, dy);
    assert.deepEqual(box(await d.get('A')), want, dir);
    await sane(d);
    await d.undo();
  }
  d.expectClean();
});

test('the Inspector takes a width or height of 0 as 1 pt', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 40)]));
  await d.click('A');
  const w = d.page.getByLabel('Width (pt)');
  await w.fill('0');
  assert.equal((await d.get('A')).w, 1);
  const h = d.page.getByLabel('Height (pt)');
  await h.fill('-5');
  assert.equal((await d.get('A')).h, 1);
  await sane(d);
  d.expectClean();
});

test('resize past the right edge stops at the band width; past the bottom grows the band', async () => {
  const d = await open(report([tb('A', 400, 360, 100, 32)]));
  await d.page.locator('[data-testid="zoom"]').selectOption('0.5');
  await settled(d.item('A'));
  await d.click('A');
  await resize(d, 'A', 'e', 600, 0);
  assert.ok(near((await d.get('A')).w, BW - 400), String((await d.get('A')).w));
  await sane(d);
  await d.click('A');
  await resize(d, 'A', 'se', 300, 100);
  const def = await d.def();
  const a = await d.get('A');
  assert.ok(near(a.x + a.w, BW));
  assert.equal(a.h, 132); // 392 + 100 on the 4 pt grid
  assert.ok(def.sections.body.height >= a.y + a.h);
  await sane(d);
  d.expectClean();
});

test('resize with Snap to grid off follows the mouse to two decimals', async () => {
  const d = await open(report([tb('A', 100, 100, 100, 40)]));
  await snapOff(d);
  await d.click('A');
  await resize(d, 'A', 'se', 7.3, 5.1);
  const a = await d.get('A');
  assert.ok(near(a.w, 107.3, 0.6) && near(a.h, 45.1, 0.6), JSON.stringify(a));
  d.expectClean();
});

/* ------------------------------------------------------------------ smart guides */

test("smart guides: a drag near another item's edge snaps to it and draws a guide; Alt turns them off", async () => {
  // A's left is not on the grid: the grid alone would give 100 or 104
  const def = report([tb('A', 102, 20, 100, 20), tb('B', 300, 100, 100, 20)]);
  for (const alt of [false, true]) {
    const d = await open(def);
    const s = await d.scale();
    const b = await d.item('B').boundingBox();
    const x0 = b.x + 5,
      y0 = b.y + 5;
    await d.page.mouse.move(x0, y0);
    if (alt) await d.page.keyboard.down('Alt');
    await d.page.mouse.down();
    await d.page.mouse.move(x0 - 199 * s, y0, { steps: 6 }); // B's left at 101: 1 pt from A's
    await until(() => d.page.locator('.guide-badge').count()); // the drag is drawn
    const guides = alt
      ? await d.page.locator('.guide.v').count()
      : await until(() => d.page.locator('.guide.v').count());
    await d.page.mouse.up();
    if (alt) await d.page.keyboard.up('Alt');
    const bx = (await d.get('B')).x;
    if (alt) {
      assert.equal(guides, 0);
      assert.equal(bx % 4, 0, `grid ${bx}`);
    } else {
      assert.ok(guides >= 1);
      assert.equal(bx, 102);
    }
    await sane(d);
    d.expectClean();
  }
});

test("smart guides: an item's centre snaps to the page centre and to another item's centre", async () => {
  const d = await open(report([tb('A', 20, 20, 60, 20), tb('B', 300, 100, 100, 20)]));
  const s = await d.scale();
  // B's centre to 262 (page centre 261.64)
  await move(d, 'B', 262 - 350, 0);
  assert.ok(near((await d.get('B')).x, BW / 2 - 50), String((await d.get('B')).x));
  // B's centre to A's centre (50): B.x = 0
  await move(d, 'B', (await d.get('B')).x * -1 + 1, 0); // B.x about 1 → its left snaps to the band start 0
  assert.equal((await d.get('B')).x, 0);
  // vertical: B's top to A's bottom (40)
  await move(d, 'B', 0, 41 - (await d.get('B')).y);
  assert.equal((await d.get('B')).y, 40);
  assert.ok(s > 0);
  await sane(d);
  d.expectClean();
});

/* ------------------------------------------------------------------ align, distribute, size */

const trio = () => report([tb('A', 20, 20, 100, 20), tb('B', 200, 60, 60, 30), tb('C', 300, 120, 40, 10)]);
const ALIGNED = {
  left: { A: [20, 20], B: [20, 60], C: [20, 120] },
  right: { A: [240, 20], B: [280, 60], C: [300, 120] },
  hcenter: { A: [130, 20], B: [150, 60], C: [160, 120] },
  top: { A: [20, 20], B: [200, 20], C: [300, 20] },
  bottom: { A: [20, 110], B: [200, 100], C: [300, 120] },
  vmiddle: { A: [20, 65], B: [200, 60], C: [300, 70] },
  hdist: { A: [20, 20], B: [180, 60], C: [300, 120] },
  vdist: { A: [20, 20], B: [200, 65], C: [300, 120] },
};
test('align and distribute three items to each other', async () => {
  const d = await open(trio());
  for (const [how, want] of Object.entries(ALIGNED)) {
    await d.focusCanvas();
    await d.press('ControlOrMeta+a');
    await d.page.locator(`[data-align="${how}"]`).click();
    for (const n of ['A', 'B', 'C']) {
      const it = await d.get(n);
      assert.deepEqual([it.x, it.y], want[n], `${how} ${n}`);
    }
    await sane(d);
    await d.undo();
  }
  d.expectClean();
});

test('same width and same height take the largest', async () => {
  const d = await open(trio());
  await d.focusCanvas();
  await d.press('ControlOrMeta+a');
  await d.page.locator('[data-align="width"]').click();
  await d.page.locator('[data-align="height"]').click();
  for (const n of ['A', 'B', 'C']) {
    const it = await d.get(n);
    assert.deepEqual([it.w, it.h], [100, 30], n);
  }
  await sane(d);
  d.expectClean();
});

test('distribute needs three items, same size two; one item aligns to its band', async () => {
  const d = await open(trio());
  await d.click('A');
  for (const k of ['hdist', 'vdist', 'width', 'height'])
    assert.equal(await d.page.locator(`[data-align="${k}"]`).isDisabled(), true, k);
  assert.equal(await d.page.locator('[data-testid="align-to-page"]').count(), 0);
  await d.page.locator('[data-align="right"]').click();
  assert.ok(near((await d.get('A')).x, BW - 100));
  await d.page.locator('[data-align="vmiddle"]').click();
  assert.equal((await d.get('A')).y, 190); // (400 - 20) / 2
  await d.page.locator('[data-align="hcenter"]').click();
  assert.ok(near((await d.get('A')).x, BW / 2 - 50));
  await d.page.locator('[data-align="bottom"]').click();
  assert.equal((await d.get('A')).y, 380);
  await sane(d);
  await d.click('B', ['Shift']);
  for (const k of ['hdist', 'vdist']) assert.equal(await d.page.locator(`[data-align="${k}"]`).isDisabled(), true, k);
  for (const k of ['width', 'height']) assert.equal(await d.page.locator(`[data-align="${k}"]`).isDisabled(), false, k);
  d.expectClean();
});

test('"To page" aligns several items to the band', async () => {
  const d = await open(trio());
  await d.focusCanvas();
  await d.press('ControlOrMeta+a');
  await d.page.locator('[data-testid="align-to-page"]').check();
  await d.page.locator('[data-align="left"]').click();
  for (const n of ['A', 'B', 'C']) assert.equal((await d.get(n)).x, 0, n);
  await d.page.locator('[data-align="right"]').click();
  for (const [n, w] of [
    ['A', 100],
    ['B', 60],
    ['C', 40],
  ])
    assert.ok(near((await d.get(n)).x, BW - w), n);
  await d.page.locator('[data-align="bottom"]').click();
  for (const [n, h] of [
    ['A', 20],
    ['B', 30],
    ['C', 10],
  ])
    assert.equal((await d.get(n)).y, 400 - h, n);
  await d.page.locator('[data-align="top"]').click();
  for (const n of ['A', 'B', 'C']) assert.equal((await d.get(n)).y, 0, n);
  await sane(d);
  d.expectClean();
});

test('distribute with mixed sizes and overlaps keeps every item inside the band', async () => {
  const d = await open(
    report([tb('W', 0, 0, 400, 20), tb('N1', 100, 30, 20, 20), tb('N2', 380, 60, 140, 20), tb('N3', 500, 90, 20, 200)]),
  );
  await d.focusCanvas();
  await d.press('ControlOrMeta+a');
  await d.page.locator('[data-align="hdist"]').click();
  await sane(d);
  await d.page.locator('[data-align="vdist"]').click();
  await sane(d);
  await d.page.locator('[data-align="width"]').click();
  await sane(d);
  d.expectClean();
});

test('align inside a container uses the container, not the band', async () => {
  const c = {
    type: 'container',
    name: 'Box',
    x: 100,
    y: 50,
    w: 200,
    h: 100,
    items: [tb('K1', 10, 10, 50, 20), tb('K2', 80, 40, 30, 20)],
  };
  const d = await open(report([c]));
  await d.click('K1');
  await d.page.locator('[data-align="right"]').click();
  assert.equal((await d.get('K1')).x, 150);
  await d.page.locator('[data-align="bottom"]').click();
  assert.equal((await d.get('K1')).y, 80);
  await sane(d);
  d.expectClean();
});

test('regression: align of a container child with a band item mixes their coordinates and squeezes the band item into the container width', async () => {
  const c = { type: 'container', name: 'Box', x: 20, y: 50, w: 200, h: 100, items: [tb('Kid', 10, 10, 50, 20)] };
  const d = await open(report([c, tb('A', 400, 300, 100, 20)]));
  await d.click('Kid');
  await d.click('A', ['Shift']);
  assert.deepEqual((await d.selected()).sort(), ['A', 'Kid']);
  await d.page.locator('[data-align="right"]').click();
  await sane(d);
  // A is the rightmost item: aligning right must not move it 300 pt to the left
  assert.equal((await d.get('A')).x, 400);
  d.expectClean();
});

/* ------------------------------------------------------------------ z-order */

test('z-order: the Outline moves an item one place earlier or later (drawn on top)', async () => {
  const d = await open(report([tb('A', 20, 20), tb('B', 40, 30), tb('C', 60, 40)]));
  await d.page.locator('[data-testid="rail-outline"]').click();
  const order = async () => (await d.def()).sections.body.items.map((i) => i.name);
  await d.page.locator('[data-outline="A"]').hover();
  await d.page.getByRole('button', { name: /: A$/ }).last().click(); // Forward (↓)
  assert.deepEqual(await order(), ['B', 'A', 'C']);
  // later in the list is drawn later (on top)
  assert.deepEqual(
    await d.page.locator('.band[data-section="body"] > .it').evaluateAll((e) => e.map((x) => x.dataset.item)),
    ['B', 'A', 'C'],
  );
  await d.page.locator('[data-outline="C"]').hover();
  await d.page.getByRole('button', { name: /: C$/ }).first().click(); // Backward (↑)
  assert.deepEqual(await order(), ['B', 'C', 'A']);
  // first and last: the arrows that would go nowhere are off
  assert.equal(await d.page.locator('[data-outline="B"] .act button').first().isDisabled(), true);
  assert.equal(await d.page.locator('[data-outline="A"] .act button').nth(1).isDisabled(), true);
  // Alt+Up on a name moves it earlier
  await d.page.locator('[data-outline="A"] .nm').focus();
  await d.press('Alt+ArrowUp');
  assert.deepEqual(await order(), ['B', 'A', 'C']);
  await sane(d);
  d.expectClean();
});

/* ------------------------------------------------------------------ units */

test('units: the Inspector converts, the rulers relabel, the page size follows', async () => {
  const d = await open(report([tb('A', 20, 36, 72, 20)]));
  const firstLabel = () => d.page.locator('svg.ruler:not(.v) text').first().textContent();
  assert.equal(await firstLabel(), '72');
  await d.click('A');
  await d.page.getByLabel('Units').selectOption('mm');
  assert.equal(Number(await d.page.getByLabel('X (mm)').inputValue()).toFixed(2), '7.06');
  assert.equal(await d.page.getByLabel('Width (mm)').inputValue(), '25.4');
  assert.equal(await firstLabel(), '10');
  await d.page.getByLabel('X (mm)').fill('10');
  assert.equal((await d.get('A')).x, 28.35);
  await d.page.getByLabel('Units').selectOption('in');
  assert.equal(await d.page.getByLabel('Width (in)').inputValue(), '1');
  assert.equal(await d.page.getByLabel('Y (in)').inputValue(), '0.5');
  assert.equal(await firstLabel(), '1');
  await d.page.getByLabel('Units').selectOption('cm');
  assert.equal(await d.page.getByLabel('Width (cm)').inputValue(), '2.54');
  assert.match(await d.page.locator('.dstatus-page').innerText(), /21 × 29\.7 cm/);
  await sane(d);
  d.expectClean();
});

test('regression: the Inspector shows a converted length with float noise (7.055599999999999 mm), not two decimals', async () => {
  const d = await open(report([tb('A', 20, 36, 72, 20)]));
  await d.page.getByLabel('Units').selectOption('mm');
  await d.click('A');
  assert.equal(await d.page.getByLabel('X (mm)').inputValue(), '7.06');
  d.expectClean();
});

test("regression: the status bar gives the selected item's place and size in pt whatever the units", async () => {
  const d = await open(report([tb('A', 72, 72, 144, 36)]));
  await d.page.getByLabel('Units').selectOption('in');
  await d.click('A');
  // the page info beside it and the Inspector say inches; the item says "72, 72 · 144 × 36 pt"
  assert.match(await d.page.locator('.dstatus-page').innerText(), / in$/);
  assert.equal(await d.page.getByLabel('X (in)').inputValue(), '1');
  assert.equal(await d.status(), 'A · Text box · 1, 1 · 2 × 0.5 in');
  d.expectClean();
});

/* ------------------------------------------------------------------ bands */

test('band height: drag the band edge; never above its lowest item', async () => {
  const d = await open(report([tb('A', 20, 100, 100, 50)]));
  const grip = d.page.locator('.band[data-section="body"] > .band-resize');
  const s = await d.scale();
  await grip.scrollIntoViewIfNeeded();
  const g = await grip.boundingBox();
  await d.drag(g.x + 50, g.y + g.height / 2, g.x + 50, g.y + g.height / 2 + 40 * s);
  assert.equal((await d.def()).sections.body.height, 440);
  assert.match(await d.page.locator('.band-label', { hasText: 'Body' }).innerText(), /440 pt/);
  await grip.scrollIntoViewIfNeeded();
  const g2 = await grip.boundingBox();
  await d.drag(g2.x + 50, g2.y + g2.height / 2, g2.x + 50, g2.y + g2.height / 2 - 1000 * s);
  assert.equal((await d.def()).sections.body.height, 150);
  // the page header (40) grows, then goes to 0 when empty
  const hg = d.page.locator('.band[data-section="pageHeader"] > .band-resize');
  await hg.scrollIntoViewIfNeeded();
  const h1 = await hg.boundingBox();
  await d.drag(h1.x + 50, h1.y + h1.height / 2, h1.x + 50, h1.y + h1.height / 2 + 20 * s);
  assert.equal((await d.def()).sections.pageHeader.height, 60);
  await hg.scrollIntoViewIfNeeded();
  const h2 = await hg.boundingBox();
  await d.drag(h2.x + 50, h2.y + h2.height / 2, h2.x + 50, h2.y + h2.height / 2 - 500 * s);
  assert.equal((await d.def()).sections.pageHeader.height, 0);
  await d.undo(4);
  assert.equal((await d.def()).sections.body.height, 400);
  await sane(d);
  d.expectClean();
});

test('a drag that ends over another band moves the item into it', async () => {
  const d = await open(report([tb('A', 48, 20, 100, 20)]));
  await setZoom(d, 0.5); // every band in view
  const a = await d.item('A').boundingBox();
  const f = await d.band('pageFooter').boundingBox();
  await d.drag(a.x + 5, a.y + 5, a.x + 5, f.y + 8);
  const it = await d.get('A');
  assert.equal(it.band, 'pageFooter');
  assert.equal(it.x, 48);
  const def = await d.def();
  assert.ok(it.y >= 0 && def.sections.pageFooter.height >= it.y + it.h);
  // and up into the page header
  const a2 = await d.item('A').boundingBox();
  const h = await d.band('pageHeader').boundingBox();
  await d.drag(a2.x + 5, a2.y + 5, a2.x + 5, h.y + 6);
  assert.equal((await d.get('A')).band, 'pageHeader');
  await sane(d);
  await d.undo();
  assert.equal((await d.get('A')).band, 'pageFooter');
  d.expectClean();
});

test('a table dragged over the page header stays in the body', async () => {
  const t = {
    type: 'table',
    name: 'T1',
    x: 10,
    y: 60,
    columns: [{ width: 80 }, { width: 80 }],
    header: [{ height: 18, cells: [{ value: 'a' }, { value: 'b' }] }],
    detail: [{ height: 18, cells: [{ value: 'c' }, { value: 'd' }] }],
  };
  const d = await open(report([t]));
  const g = await d.page.locator('.tbl[data-item="T1"] .grip').boundingBox();
  const h = await d.band('pageHeader').boundingBox();
  await d.drag(g.x + g.width / 2, g.y + g.height / 2, g.x + g.width / 2, h.y + 10);
  assert.equal((await d.get('T1')).band, 'body');
  await sane(d);
  d.expectClean();
});

/* ------------------------------------------------------------------ cell mode */

const cellDef = () => report([tb('A', 12, 12, 48, 24), tb('B', 72, 12, 96, 24), tb('C', 12, 72, 48, 24)]);
test('cell mode: a drag, a nudge or a resize onto another item is refused with a message', async () => {
  const d = await open(cellDef());
  await d.page.locator('[data-testid="cell-mode"]').check();
  const msg = d.page.getByText('Those cells are taken');
  // drag A onto B
  await move(d, 'A', 72, 0);
  assert.deepEqual([(await d.get('A')).x, (await d.get('A')).y], [12, 12]);
  await msg.waitFor();
  // nudge: one cell is free, the next is taken
  await d.click('A');
  await d.press('ArrowRight');
  assert.equal((await d.get('A')).x, 24);
  await d.press('ArrowRight');
  assert.equal((await d.get('A')).x, 24);
  // resize C's top edge up into A
  await d.click('C');
  await resize(d, 'C', 'n', 0, -48);
  assert.deepEqual(box(await d.get('C')), { x: 12, y: 72, w: 48, h: 24 });
  // a free move lands on whole cells
  await move(d, 'C', 30, 40);
  const c = await d.get('C');
  assert.equal(c.x % 12, 0);
  assert.equal(c.y % 12, 0);
  await sane(d);
  d.expectClean();
});

test('regression: cell mode: align puts items on top of each other', async () => {
  const d = await open(cellDef());
  await d.page.locator('[data-testid="cell-mode"]').check();
  await d.click('A');
  await d.click('B', ['Shift']);
  await d.page.locator('[data-align="left"]').click();
  const a = await d.get('A'),
    b = await d.get('B');
  const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.equal(overlap, false, `A ${JSON.stringify(box(a))} and B ${JSON.stringify(box(b))} overlap in cell mode`);
  d.expectClean();
});

test('regression: cell mode: a resize to the smallest size leaves a 4 pt item, not one whole cell', async () => {
  const d = await open(cellDef());
  await d.page.locator('[data-testid="cell-mode"]').check();
  await d.click('A');
  await resize(d, 'A', 'e', -200, 0);
  const a = await d.get('A');
  assert.equal(a.w % 12, 0, `width ${a.w} is not whole cells`);
  d.expectClean();
});

/* ------------------------------------------------------------------ nested */

test('a child moves and resizes inside its container, kept within its width', async () => {
  const c = { type: 'container', name: 'Box', x: 100, y: 50, w: 200, h: 100, items: [tb('K1', 10, 10, 50, 20)] };
  const d = await open(report([c]));
  await move(d, 'K1', 400, 0);
  assert.equal((await d.get('K1')).x, 150); // 200 - 50
  assert.equal((await d.get('K1')).parent, 'Box');
  await move(d, 'K1', -400, -400);
  assert.deepEqual([(await d.get('K1')).x, (await d.get('K1')).y], [0, 0]);
  await d.click('K1');
  await resize(d, 'K1', 'e', 400, 0);
  assert.equal((await d.get('K1')).w, 200);
  await sane(d);
  d.expectClean();
});
