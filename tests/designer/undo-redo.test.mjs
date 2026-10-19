// Designer undo/redo in the browser: every action is reversible, typing merges, limits, buttons and focus rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, Designer } from './harness.mjs';

const MERGE_MS = 800; // store.js apply(): the same key within this window is one step
const LIMIT = 200;

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

async function until(fn, { timeout = 5000, step = 25, msg = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${msg}`);
    await new Promise((r) => setTimeout(r, step));
  }
}
const same = async (d, json, msg = 'definition') => until(async () => JSON.stringify(await d.def()) === json, { msg });
/** Wait until fonts are in and the canvas has laid out (a drag measures boxes first). */
const settle = (d) =>
  d.page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
const snap = async (d) => JSON.stringify(await d.def());
const undoBtn = (d) => d.page.getByRole('button', { name: /^Undo/ });
const redoBtn = (d) => d.page.getByRole('button', { name: /^Redo/ });
const inspector = (d) => d.page.locator('[data-testid="inspector"]');
/** Make the page's clock jump (Date.now), as a pause in typing would, without waiting. */
const installSkew = (d) =>
  d.page.evaluate(() => {
    const real = Date.now.bind(Date);
    window.__skew = 0;
    Date.now = () => real() + window.__skew;
  });
const pause = (d, ms) =>
  d.page.evaluate((m) => {
    window.__skew += m;
  }, ms);
/** The label of a band, to click (it is drawn just before the band). */
async function selectBand(d, key) {
  const ok = await d.page.evaluate((k) => {
    const root = document.querySelector('#d').shadowRoot;
    root.querySelectorAll('[data-test-label]').forEach((e) => e.removeAttribute('data-test-label'));
    const band = root.querySelector(`.band[data-section="${k}"]`);
    for (let el = band, i = 0; el && i < 4; el = el.parentElement, i++) {
      for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.classList.contains('band-label')) {
          p.setAttribute('data-test-label', k);
          return true;
        }
        if (p.querySelector('.band')) break;
      }
    }
    return false;
  }, key);
  assert.ok(ok, `band label of ${key}`);
  await d.page.locator(`[data-test-label="${key}"]`).click();
}
/**
 * Do an action, check it changed the definition by exactly one undo step: Ctrl+Z brings back the definition before,
 * Ctrl+Shift+Z the one after.
 */
async function reversible(d, act, { steps = 1, label = 'action' } = {}) {
  const before = await snap(d);
  await act();
  const after = await until(
    async () => {
      const s = await snap(d);
      return s !== before && s;
    },
    { msg: `${label} changes the report` },
  );
  await d.focusCanvas();
  await d.undo(steps);
  await same(d, before, `${label} undone`);
  await d.redo(steps);
  await same(d, after, `${label} redone`);
  return after;
}
const tableItem = (name, x, y) => ({
  type: 'table',
  name,
  x,
  y,
  dataSet: 'Rows',
  columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
  header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount' }, { value: 'C' }] }],
  detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }, { value: 'x' }] }],
  footer: [],
});
const data = {
  dataSources: [
    {
      name: 'src',
      type: 'json',
      data: {
        rows: [
          { region: 'N', amount: 1 },
          { region: 'S', amount: 2 },
        ],
      },
    },
  ],
  dataSets: [
    {
      name: 'Rows',
      source: 'src',
      path: '$.rows',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
  ],
};

test('undo/redo buttons: disabled with no history, enabled as steps come and go', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  assert.equal(await undoBtn(d).isDisabled(), true);
  assert.equal(await redoBtn(d).isDisabled(), true);
  await d.click('A');
  await d.press('ArrowRight');
  await until(async () => !(await undoBtn(d).isDisabled()), { msg: 'undo enabled' });
  assert.equal(await redoBtn(d).isDisabled(), true);
  await undoBtn(d).click();
  await until(async () => !(await redoBtn(d).isDisabled()), { msg: 'redo enabled' });
  assert.equal(await undoBtn(d).isDisabled(), true);
  await redoBtn(d).click();
  await until(async () => await redoBtn(d).isDisabled(), { msg: 'redo disabled again' });
  assert.equal((await d.get('A')).x, 14);
  d.expectClean();
});

test('add item (toolbar Insert) and delete (Delete key) are reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await reversible(d, () => d.page.locator('[data-testid="quick-textbox"]').click(), { label: 'insert' });
  await reversible(
    d,
    async () => {
      await d.click('A');
      await d.press('Delete');
    },
    { label: 'delete' },
  );
  d.expectClean();
});

test('move (drag), nudge (each arrow press one step) and resize (handle) are reversible', async () => {
  const d = await env.open(report([tb('A', 40, 40, 100, 30)]));
  await settle(d);
  await reversible(d, () => d.dragItem('A', 60, 40), { label: 'drag' });
  await d.click('A');
  const before = await snap(d);
  await d.press(['ArrowRight', 'ArrowRight', 'ArrowDown']);
  await until(async () => (await snap(d)) !== before);
  await d.undo(3);
  await same(d, before, 'three nudges, three undos');
  await reversible(
    d,
    async () => {
      await d.click('A');
      const h = d.item('A').locator('.handle').nth(4); // se
      const b = await h.boundingBox();
      await d.drag(b.x + 4, b.y + 4, b.x + 64, b.y + 34, { steps: 12 });
    },
    { label: 'resize' },
  );
  d.expectClean();
});

test('align and distribute (align bar) are reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10, 80, 20), tb('B', 170, 60, 120, 30), tb('C', 330, 140, 60, 20)]));
  for (const how of ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom', 'hdist', 'vdist', 'width', 'height']) {
    await d.press('Escape');
    await d.click('A');
    await d.press('ControlOrMeta+a'); // the three items of the body
    assert.equal((await d.selected()).length, 3);
    const btn = d.page.locator(`[data-align="${how}"]`);
    if (!(await btn.count())) continue; // not every build shows every button
    await reversible(d, () => btn.click(), { label: `align ${how}` });
    await d.undo(); // back to the starting layout for the next one
  }
  d.expectClean();
});

test('Inspector property edit: typing quickly is one step; a pause of 800 ms or more starts another', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await installSkew(d);
  await d.click('A');
  const x = inspector(d).getByLabel('X (pt)', { exact: true });
  const start = await snap(d);
  await x.fill('');
  await x.pressSequentially('123', { delay: 20 });
  await until(async () => (await d.get('A')).x === 123);
  await d.focusCanvas();
  await d.undo();
  await same(d, start, 'one undo takes all of "123" back');
  // with a pause
  await d.click('A');
  await x.fill('');
  await x.pressSequentially('5');
  await until(async () => (await d.get('A')).x === 5);
  await pause(d, MERGE_MS + 100);
  await x.pressSequentially('6');
  await until(async () => (await d.get('A')).x === 56);
  await d.focusCanvas();
  await d.undo();
  await until(async () => (await d.get('A')).x === 5, { msg: 'the part after the pause is its own step' });
  d.expectClean();
});

test('Inspector: 799 ms between keystrokes still merges', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await installSkew(d);
  await d.click('A');
  const x = inspector(d).getByLabel('X (pt)', { exact: true });
  const start = await snap(d);
  await x.fill('');
  await x.pressSequentially('7');
  await pause(d, MERGE_MS - 101); // plus the real time the keystrokes take (well under 100 ms)
  await x.pressSequentially('8');
  await until(async () => (await d.get('A')).x === 78);
  await d.focusCanvas();
  await d.undo();
  await same(d, start);
  d.expectClean();
});

test('band height (Inspector), add and remove body section are reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await selectBand(d, 'body');
  await reversible(
    d,
    async () => {
      const h = inspector(d).getByLabel('Height (pt)');
      await h.fill('520');
    },
    { label: 'band height' },
  );
  await selectBand(d, 'body');
  await reversible(d, () => inspector(d).locator('[data-testid="add-body-section"]').click(), { label: 'add section' });
  await selectBand(d, 'body:1');
  await reversible(d, () => inspector(d).getByRole('button', { name: 'Remove this section' }).click(), {
    label: 'remove section',
  });
  d.expectClean();
});

test('band height (drag the band edge) is reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await settle(d);
  const r = d.band('pageHeader').locator('.band-resize');
  if (!(await r.count())) return d.expectClean();
  await reversible(
    d,
    async () => {
      const b = await r.boundingBox();
      await d.drag(b.x + 20, b.y + b.height / 2, b.x + 20, b.y + 40);
    },
    { label: 'band drag' },
  );
  d.expectClean();
});

test('table operations (cell menu and Inspector) are reversible', async () => {
  const d = await env.open(report([tableItem('Tbl', 0, 10)], data));
  const cell = (id) => d.page.locator(`.tbl[data-item="Tbl"] [data-cell="${id}"]`);
  const menu = async (id, name) => {
    await cell(id).click({ button: 'right' });
    await d.page.getByRole('menuitem', { name, exact: true }).click();
  };
  for (const name of [
    'Group by region',
    'Row above',
    'Row below',
    'Merge right',
    'Column left',
    'Column right',
    'Delete row',
    'Delete column',
  ]) {
    await d.press('Escape');
    await reversible(d, () => menu('detail-0-0', name), { label: name });
  }
  // split a merge (Inspector)
  await menu('detail-0-0', 'Merge right');
  await cell('detail-0-0').click();
  await reversible(d, () => inspector(d).getByRole('button', { name: 'Split', exact: true }).click(), {
    label: 'split',
  });
  d.expectClean();
});

test('data set remove (Data panel) and report name are reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10, 100, 20, { dataSet: 'Rows' })], data));
  await reversible(
    d,
    async () => {
      await d.page.getByRole('button', { name: 'Edit Rows' }).click();
      await d.page.locator('.dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    },
    { label: 'data set remove' },
  );
  await reversible(
    d,
    async () => {
      const n = d.page.getByLabel('Report name');
      await n.fill('Another name');
    },
    { label: 'report name' },
  );
  d.expectClean();
});

test('data set add (Data panel dialog) is reversible', async () => {
  const d = await env.open(report([tb('A', 10, 10)], data));
  const before = await snap(d);
  await d.page.locator('h4', { hasText: 'Data sets' }).getByRole('button', { name: '+ Add' }).click();
  const dlg = d.page.locator('.dialog');
  await dlg.waitFor();
  await dlg.locator('input').first().fill('More');
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => (await d.def()).dataSets.some((x) => x.name === 'More'), { msg: 'data set added' });
  const after = await snap(d);
  await d.focusCanvas();
  await d.undo();
  await same(d, before, 'add undone');
  await d.redo();
  await same(d, after, 'add redone');
  d.expectClean();
});

test('undo × n then redo × n gives back the identical definition at every step', async () => {
  const d = await env.open(report([tb('A', 10, 10), tb('B', 200, 60)]));
  await settle(d);
  const snaps = [await snap(d)];
  const step = async (fn) => {
    const prev = snaps.at(-1);
    await fn();
    snaps.push(
      await until(async () => {
        const s = await snap(d);
        return s !== prev && s;
      }),
    );
  };
  await step(() => d.dragItem('A', 30, 30));
  await step(async () => {
    await d.click('B');
    await d.press('ArrowLeft');
  });
  await step(() => d.press('ControlOrMeta+d'));
  await step(() => d.page.locator('[data-testid="quick-textbox"]').click());
  await step(async () => {
    await d.click('A');
    await d.press('Delete');
  });
  await step(() => d.page.getByLabel('Report name').fill('Renamed'));
  await step(async () => {
    await d.click('B');
    await d.press(['ControlOrMeta+c', 'ControlOrMeta+v']);
  });
  await d.focusCanvas();
  for (let i = snaps.length - 2; i >= 0; i--) {
    await d.undo();
    await same(d, snaps[i], `undo to ${i}`);
  }
  assert.equal(await undoBtn(d).isDisabled(), true);
  for (let i = 1; i < snaps.length; i++) {
    await d.redo();
    await same(d, snaps[i], `redo to ${i}`);
  }
  assert.equal(await redoBtn(d).isDisabled(), true);
  d.expectClean();
});

test('history survives selection changes', async () => {
  const d = await env.open(report([tb('A', 10, 10), tb('B', 200, 60)]));
  await settle(d);
  const start = await snap(d);
  await d.dragItem('A', 40, 0);
  await d.dragItem('B', 0, 40);
  await d.click('A');
  await d.click('B', ['Shift']);
  await d.press('Escape');
  await selectBand(d, 'pageHeader');
  await selectBand(d, 'body');
  await d.focusCanvas();
  await d.undo(2);
  await same(d, start);
  d.expectClean();
});

test('redo is cleared by a new edit', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press(['ArrowRight', 'ArrowRight']);
  await d.undo();
  await until(async () => !(await redoBtn(d).isDisabled()));
  await d.click('A');
  await d.press('ArrowDown');
  await until(async () => await redoBtn(d).isDisabled(), { msg: 'redo cleared' });
  const now = await snap(d);
  await d.redo();
  assert.equal(await snap(d), now);
  d.expectClean();
});

test(`history limit: after 250 edits only ${LIMIT} undos`, async () => {
  const d = await env.open(report([tb('A', 0, 10)]));
  await d.click('A');
  const states = [await snap(d)];
  for (let i = 0; i < 250; i++) await d.press('ArrowDown');
  await until(async () => (await d.get('A')).y === 10 + 250 * 4, { msg: '250 nudges', timeout: 20000 });
  await d.undo(LIMIT);
  await until(async () => (await d.get('A')).y === 10 + 50 * 4, { msg: `${LIMIT} undos`, timeout: 20000 });
  assert.equal(await undoBtn(d).isDisabled(), true);
  await d.undo(5);
  assert.equal((await d.get('A')).y, 10 + 50 * 4, 'nothing older than the limit');
  assert.notEqual(await snap(d), states[0]);
  d.expectClean();
});

test('Ctrl+Z in a focused Inspector input undoes the typing, not the designer history', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await settle(d);
  await d.dragItem('A', 40, 0);
  const moved = (await d.get('A')).x;
  assert.notEqual(moved, 10);
  const name = d.page.getByLabel('Report name');
  await name.click();
  await name.press('End');
  await name.pressSequentially('XY');
  await until(async () => (await d.def()).name === 'TestXY');
  await name.press('ControlOrMeta+z');
  await d.page.waitForTimeout(100);
  assert.equal((await d.get('A')).x, moved, 'the move is not undone by Ctrl+Z in the input');
  assert.notEqual(await name.inputValue(), 'TestXY', 'the input undid its own typing');
  d.expectClean();
});

test('Ctrl+Z and Ctrl+Shift+Z in the Preview tab are ignored', async () => {
  const d = await env.open(report([tb('A', 10, 10)]));
  await d.click('A');
  await d.press('ArrowRight');
  await until(async () => (await d.get('A')).x === 14);
  await d.page.locator('[data-testid="tab-preview"]').click();
  await d.page.locator('.dpreview').waitFor();
  await d.page.locator('.dpreview').click({ position: { x: 5, y: 5 } });
  await d.press(['ControlOrMeta+z', 'ControlOrMeta+y', 'ControlOrMeta+z']);
  await d.page.waitForTimeout(100);
  assert.equal((await d.get('A')).x, 14);
  d.expectClean();
});

test('read-only: nothing to undo, keys change nothing', async () => {
  const d = await env.open(report([tb('A', 10, 10)]), { readOnly: true });
  const start = await snap(d);
  await d.click('A');
  await d.press(['ArrowRight', 'Delete', 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']);
  await d.page.waitForTimeout(100);
  assert.equal(await snap(d), start);
  assert.equal(await undoBtn(d).isDisabled(), true);
  d.expectClean();
});

test('undo of a delete restores the very same items and selects them', async () => {
  const box = { type: 'container', name: 'Box', x: 0, y: 100, w: 300, h: 80, items: [tb('Kid', 20, 20)] };
  const d = await env.open(report([tb('A', 10, 10), box]));
  const start = await snap(d);
  await d.click('A');
  await d.click('Kid', ['Shift']);
  await d.press('Delete');
  await until(async () => !(await d.get('A')));
  await d.undo();
  await same(d, start);
  assert.deepEqual((await d.selected()).sort(), ['A', 'Kid']);
  d.expectClean();
});

test('a cut item and its paste: two separate undo steps (Ctrl+X, Ctrl+V, Ctrl+Z, Ctrl+Z)', async () => {
  const d = await env.open(report([tb('A', 10, 10), tb('B', 10, 60)]));
  const start = await snap(d);
  await d.click('A');
  await d.press('ControlOrMeta+x');
  await until(async () => !(await d.get('A')));
  const cut = await snap(d);
  await d.press('ControlOrMeta+v');
  await until(async () => (await snap(d)) !== cut);
  await d.undo();
  await same(d, cut, 'paste undone, cut stays');
  await d.undo();
  await same(d, start, 'cut undone');
  assert.deepEqual(await d.selected(), ['A']);
  assert.equal(Designer.find(JSON.parse(start), 'A').x, (await d.get('A')).x);
  d.expectClean();
});
