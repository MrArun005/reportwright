// K. Keyboard-only use and accessibility of the designer: a whole report built with the keyboard alone (the focus
// always visible), axe on the default view and on every dialog and panel state, names of the toolbar buttons, and how
// the modal dialogs handle the focus (WCAG 2.4.3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup, report, tb, root } from './harness.mjs';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

const DATA = {
  dataSources: [
    {
      name: 'orders',
      type: 'json',
      data: {
        rows: [
          { customer: 'Asha Rao', amount: 1200.5 },
          { customer: 'Ben Ode', amount: 80 },
        ],
      },
    },
  ],
  dataSets: [
    {
      name: 'Rows',
      source: 'orders',
      path: '$.rows',
      fields: [
        { name: 'customer', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
  ],
};
const TABLE = {
  type: 'table',
  name: 'T',
  x: 0,
  y: 120,
  w: 400,
  h: 32,
  dataSet: 'Rows',
  columns: [{ width: 200 }, { width: 200 }],
  header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
  detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount' }] }],
};
/** A report with data, a table and two overlapping text boxes (so the Issues button has something to list). */
const richDef = () => report([tb('A', 20, 20), tb('B', 40, 25), TABLE], DATA);
const IMPORT_FILE = path.join(root, 'tests/fixtures/jrxml/corpus/jr6-table-TableReport.jrxml');

/** Poll fn until it returns a truthy value. */
async function until(fn, { timeout = 5000, step = 25, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, step));
  }
}

/** What has the keyboard focus inside the designer, and whether a focus ring is drawn for it. */
function focusInfo(page) {
  return page.evaluate(() => {
    const sr = document.querySelector('#d').shadowRoot;
    let a = sr.activeElement;
    if (!a) return { none: true, outside: document.activeElement?.tagName || null };
    while (a.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    const cs = getComputedStyle(a);
    const clear = (c) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !clear(cs.outlineColor);
    const shadow = !!cs.boxShadow && cs.boxShadow !== 'none';
    return {
      tag: a.tagName,
      cls: String(a.className || ''),
      testid: a.dataset.testid || null,
      tool: a.dataset.tool || null,
      item: a.matches('[data-item-key]') ? a.dataset.item : null,
      row: a.matches('[data-opt]')
        ? a.closest('[data-outline]')?.dataset.outline ||
          `band:${a.closest('[data-outline-band]')?.dataset.outlineBand}`
        : null,
      label: a.getAttribute('aria-label'),
      field: a.closest('label')?.querySelector(':scope > span')?.textContent || null,
      text: (a.textContent || '').trim().slice(0, 40),
      inDialog: !!a.closest('.dialog'),
      focusVisible: a.matches(':focus-visible'),
      ring: outline || shadow,
    };
  });
}
const describe = (f) => JSON.stringify(f);
/** The focus is on a designer element, matches :focus-visible and draws an outline or a box shadow. */
function assertRing(f, where) {
  assert.ok(!f.none, `${where}: the focus left the designer (${describe(f)})`);
  assert.ok(f.focusVisible && f.ring, `${where}: the focus is not visible on ${describe(f)}`);
}
/** Tab (or Shift+Tab) until pred(focus) holds, checking the focus ring at every stop. */
async function tabTo(page, pred, { back = false, max = 200, what = 'target' } = {}) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const f = await focusInfo(page);
    assertRing(f, `Tab #${i + 1} towards ${what}`);
    if (pred(f)) return f;
  }
  throw new Error(`${what} not reached with ${max} ${back ? 'Shift+Tab' : 'Tab'} presses`);
}
/** Press keys and check the focus ring afterwards. */
async function key(page, k, where = k) {
  await page.keyboard.press(k);
  const f = await focusInfo(page);
  assertRing(f, `after ${where}`);
  return f;
}
const names = (list) => (list || []).map((i) => i.name);

test('keyboard only: insert, select, nudge, edit, reorder, nest and save a report with the focus always visible', async () => {
  const d = await env.open(report([]));
  const { page } = d;
  // the Toolbox through its rail tab
  await tabTo(page, (f) => f.testid === 'rail-tools', { what: 'Toolbox rail tab' });
  await key(page, 'Enter', 'Enter on the Toolbox tab');
  // a container, then two text boxes (Escape between them: a selected container would take the next item)
  const toolPred = (type) => (f) => f.tool === type;
  const fromTab = await focusInfo(page);
  const back = fromTab.tool == null; // the rail tab may put the focus after the tools (older builds did; see the regression test below)
  await tabTo(page, toolPred('container'), { back, what: 'Container tool' });
  await key(page, 'Enter', 'Enter on the Container tool');
  await until(async () => (await d.def()).sections.body.items.length === 1, { what: 'the container' });
  await key(page, 'Escape');
  await tabTo(page, toolPred('textbox'), { back: true, what: 'Text box tool' });
  await key(page, 'Enter', 'Enter on the Text box tool');
  await key(page, 'Escape');
  await key(page, 'Enter', 'Enter on the Text box tool again');
  await key(page, 'Escape');
  let def = await d.def();
  const [cont, first, second] = def.sections.body.items;
  assert.deepEqual(
    def.sections.body.items.map((i) => i.type),
    ['container', 'textbox', 'textbox'],
  );

  // the first text box: Tab to it on the page, Enter selects it
  await tabTo(page, (f) => f.item === first.name, { what: `item ${first.name}` });
  await key(page, 'Enter', 'Enter on the item');
  assert.deepEqual(await d.selected(), [first.name]);
  // arrows move it: two steps right, one down, then one big (Shift) step right
  const x0 = first.x,
    y0 = first.y;
  await key(page, 'ArrowRight');
  await key(page, 'ArrowRight');
  await key(page, 'ArrowDown');
  const p1 = await d.get(first.name);
  const step = (p1.x - x0) / 2;
  assert.ok(step > 0, `ArrowRight moved the item (x ${x0} → ${p1.x})`);
  assert.equal(p1.y - y0, step, 'ArrowDown moves one step');
  await key(page, 'Shift+ArrowRight');
  assert.equal((await d.get(first.name)).x - p1.x, step * 10, 'Shift+ArrowRight moves ten steps');

  // the Inspector: the name and the value, typed
  await tabTo(page, (f) => f.label === 'Item name', { what: 'the Inspector name field' });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Title');
  await tabTo(page, (f) => f.field === 'Value' && f.tag === 'INPUT', { what: 'the Inspector value field' });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Sales by customer');
  def = await d.def();
  assert.equal(def.sections.body.items[1].name, 'Title');
  assert.equal(def.sections.body.items[1].value, 'Sales by customer');

  // the Outline through its rail tab: the focus lands on a row of the outline; Up/Down/Home/End move between rows
  await tabTo(page, (f) => f.testid === 'rail-outline', { back: true, what: 'Outline rail tab' });
  let f = await key(page, 'Enter', 'Enter on the Outline tab');
  assert.ok(f.row, `the Outline tab puts the focus on a row (${describe(f)})`);
  f = await key(page, 'Home');
  assert.equal(f.row, 'band:pageHeader', 'Home: the first row');
  f = await key(page, 'End');
  assert.equal(f.row, 'band:pageFooter', 'End: the last row');
  f = await key(page, 'ArrowUp');
  assert.equal(f.row, second.name, 'ArrowUp from the page footer: the last body item');
  f = await key(page, 'Home');
  f = await key(page, 'ArrowDown');
  assert.equal(f.row, 'band:body', 'ArrowDown: the body band');
  f = await key(page, 'ArrowDown');
  assert.equal(f.row, cont.name, 'ArrowDown: the first body item');
  f = await key(page, 'ArrowDown');
  assert.equal(f.row, 'Title');
  // Alt+Up: Title before the container
  f = await key(page, 'Alt+ArrowUp');
  assert.deepEqual(names((await d.def()).sections.body.items), ['Title', cont.name, second.name]);
  assert.equal(f.row, 'Title', 'the focus stays on the moved row');
  // the second text box: Alt+Right puts it into the container above it, Alt+Left takes it out, Alt+Right again
  f = await key(page, 'ArrowDown');
  f = await key(page, 'ArrowDown');
  assert.equal(f.row, second.name);
  await key(page, 'Alt+ArrowRight');
  def = await d.def();
  assert.deepEqual(names(def.sections.body.items), ['Title', cont.name]);
  assert.deepEqual(names(def.sections.body.items[1].items), [second.name], 'Alt+Right nests the item');
  f = await until(
    async () => {
      const g = await focusInfo(page);
      return g.row === second.name && g;
    },
    { what: 'focus on the nested row' },
  );
  assertRing(f, 'the nested row');
  await key(page, 'Alt+ArrowLeft');
  assert.deepEqual(
    names((await d.def()).sections.body.items),
    ['Title', cont.name, second.name],
    'Alt+Left takes it out',
  );
  await until(async () => (await focusInfo(page)).row === second.name, { what: 'focus on the moved row' });
  await key(page, 'Alt+ArrowRight');
  // Enter on a row selects that item
  await key(page, 'Enter', 'Enter on the outline row');
  assert.deepEqual(await d.selected(), [second.name]);

  // Ctrl+S: the host's onSave gets the report as it is now
  assert.equal(await d.dirty(), true);
  await page.keyboard.press('ControlOrMeta+s');
  const saved = await until(
    () => page.evaluate(() => window.__saved.length && window.__saved[window.__saved.length - 1]),
    { what: 'onSave' },
  );
  assert.deepEqual(names(saved.sections.body.items), ['Title', cont.name]);
  assert.deepEqual(names(saved.sections.body.items[1].items), [second.name]);
  assert.equal(saved.sections.body.items[0].value, 'Sales by customer');
  assert.equal(await page.evaluate(() => window.__saved.length), 1, 'one save');
  await until(async () => !(await d.dirty()), { what: 'saved state' });
  assertRing(await focusInfo(page), 'after Ctrl+S');
  d.expectClean();
});

/* ---------------------------------------------------------------- axe: 0 serious or critical */
/** Ways to reach each state of the designer that axe checks. */
const STATES = {
  'default view': async () => {},
  'an item selected': async (d) => {
    await d.click('A');
  },
  'a table cell selected': async (d) => {
    await d.page.locator('.tbl[data-item="T"] [data-cell="detail-0-0"]').click();
    await until(async () => /T/.test(await d.status()) && (await d.status()) !== 'Report', { what: 'cell selection' });
  },
  'shortcuts dialog (?)': async (d) => {
    await d.focusCanvas();
    await d.page.keyboard.press('?');
  },
  'chart gallery': async (d) => {
    await d.page.locator('.tool[data-tool="chart"]').click();
    await d.page.locator('[data-chart-type]').first().waitFor();
  },
  'table wizard': async (d) => {
    await d.page.locator('.tool[data-tool="table"]').click();
  },
  'data source dialog': async (d) => {
    await d.page.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(1).click();
  },
  'data set dialog': async (d) => {
    await d.page.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(2).click();
  },
  'parameter dialog': async (d) => {
    await d.page.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(0).click();
  },
  'expression editor': async (d) => {
    await d.click('A');
    await d.page.locator('[data-testid="inspector"] button.fx').first().click();
    await d.page.locator('.dialog .cm-content').waitFor();
  },
  'conditional format dialog': async (d) => {
    await d.click('A');
    await d.page.getByRole('button', { name: 'Conditional formatting…' }).click();
  },
  'import result dialog': async (d) => {
    await d.page.locator('[data-testid="import-file"]').setInputFiles(IMPORT_FILE);
    await d.page.locator('[data-testid="import-result"]').waitFor({ timeout: 30000 });
  },
  'issues list open': async (d) => {
    await d.page.locator('[data-testid="issues"]').click();
    await d.page.locator('[data-testid="issues-list"]').waitFor();
  },
  'preview tab': async (d) => {
    await d.page.locator('[data-testid="tab-preview"]').click();
    await d.page.locator('.dpreview .vpage').first().waitFor({ timeout: 30000 });
  },
};
const DIALOG_STATES = new Set([
  'shortcuts dialog (?)',
  'chart gallery',
  'table wizard',
  'data source dialog',
  'data set dialog',
  'parameter dialog',
  'expression editor',
  'conditional format dialog',
  'import result dialog',
]);

// the selected gallery card's hint is #64717e on #e0f2f7: 4.33:1 (axe color-contrast, serious)
const KNOWN_AXE = new Set(['chart gallery', 'table wizard']);
for (const [name, reach] of Object.entries(STATES)) {
  test(`${KNOWN_AXE.has(name) ? 'regression: ' : ''}axe: no serious or critical violations: ${name}`, async () => {
    const d = await env.open(richDef());
    await reach(d);
    if (DIALOG_STATES.has(name)) await d.page.locator('.dialog').waitFor();
    const v = await d.axe();
    assert.deepEqual(v, [], `${name}: ${JSON.stringify(v, null, 1)}`);
    d.expectClean();
  });
}

/* ---------------------------------------------------------------- names */
/** The accessible name of every button in the top bar (approximation of accname: labelledby, label, content, title). */
function headerButtonNames(page) {
  return page.evaluate(() => {
    const sr = document.querySelector('#d').shadowRoot;
    const bar = sr.querySelector('header.dtop');
    const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    return [...bar.querySelectorAll('button, a.tb-btn, .tb-btn, [role="button"]')]
      .filter((b) => b.offsetParent)
      .map((b) => {
        const by = b.getAttribute('aria-labelledby');
        const name =
          (by &&
            by
              .split(/\s+/)
              .map((id) => text(sr.getElementById(id) || document.createElement('i')))
              .join(' ')
              .trim()) ||
          (b.getAttribute('aria-label') || '').trim() ||
          text(b) ||
          (b.getAttribute('title') || '').trim();
        return { cls: b.className, testid: b.dataset.testid || null, name };
      });
  });
}
test('every toolbar and header button has an accessible name (nothing selected, an item selected, preview)', async () => {
  const d = await env.open(richDef());
  const check = async (where, least) => {
    const list = await headerButtonNames(d.page);
    assert.ok(
      list.filter((b) => /\btb-btn\b/.test(b.cls)).length >= least,
      `${where}: toolbar buttons found (${list.length})`,
    );
    const bad = list.filter((b) => !b.name);
    assert.deepEqual(bad, [], `${where}: buttons without a name`);
  };
  await check('nothing selected', 8);
  await d.click('A');
  await check('an item selected', 8);
  await d.page.locator('[data-testid="tab-preview"]').click();
  await check('preview', 3);
  d.expectClean();
});

/* ---------------------------------------------------------------- dialogs and the focus (WCAG 2.4.3) */
/** Keyboard ways to open each modal dialog: focus a control, press Enter (the import has no keyboard file picker here). */
const OPENERS = {
  shortcuts: async (p) => {
    await p.locator('.tb-btn[aria-label="Keyboard shortcuts (?)"]').focus();
    await p.keyboard.press('Enter');
  },
  'chart gallery': async (p) => {
    await p.locator('.tool[data-tool="chart"]').focus();
    await p.keyboard.press('Enter');
  },
  'table wizard': async (p) => {
    await p.locator('.tool[data-tool="table"]').focus();
    await p.keyboard.press('Enter');
  },
  parameter: async (p) => {
    await p.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(0).focus();
    await p.keyboard.press('Enter');
  },
  'data source': async (p) => {
    await p.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(1).focus();
    await p.keyboard.press('Enter');
  },
  'data set': async (p) => {
    await p.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(2).focus();
    await p.keyboard.press('Enter');
  },
  'expression editor': async (p, d) => {
    await d.item('A').focus();
    await p.keyboard.press('Enter');
    await p.locator('[data-testid="inspector"] button.fx').first().focus();
    await p.keyboard.press('Enter');
  },
  'conditional format': async (p, d) => {
    await d.item('A').focus();
    await p.keyboard.press('Enter');
    await p.getByRole('button', { name: 'Conditional formatting…' }).focus();
    await p.keyboard.press('Enter');
  },
};
async function openDialog(name) {
  const d = await env.open(richDef());
  await OPENERS[name](d.page, d);
  await d.page.locator('.dialog').waitFor();
  return d;
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('regression: a modal dialog takes the keyboard focus when it opens', async () => {
  const fails = [];
  for (const name of Object.keys(OPENERS)) {
    const d = await openDialog(name);
    await settle(d.page);
    const f = await focusInfo(d.page);
    if (!f.inDialog) fails.push(`${name}: focus stays on ${f.label || f.text || f.tag}`);
    d.expectClean();
    await d.ctx.close();
  }
  assert.deepEqual(fails, [], 'dialogs that leave the focus behind them');
});

test('regression: Tab stays inside an open modal dialog (aria-modal)', async () => {
  const fails = [];
  for (const name of Object.keys(OPENERS)) {
    const d = await openDialog(name);
    // into the dialog first (its first control), then 40 Tabs: none may reach the page behind the scrim
    await d.page.locator('.dialog').locator('button, input, select, textarea, [tabindex="0"]').first().focus();
    let out = null;
    for (let i = 0; i < 40 && !out; i++) {
      await d.page.keyboard.press('Tab');
      const f = await focusInfo(d.page);
      if (!f.inDialog) out = `${name}: Tab #${i + 1} reached ${f.label || f.text || f.tag || 'outside the designer'}`;
    }
    if (out) fails.push(out);
    d.expectClean();
    await d.ctx.close();
  }
  assert.deepEqual(fails, [], 'dialogs that let Tab out');
});

test('regression: closing a dialog puts the focus back on the control that opened it', async () => {
  const fails = [];
  for (const name of Object.keys(OPENERS)) {
    const d = await env.open(richDef());
    // remember the control that has the focus when Enter is pressed (the last Enter is the one that opens the dialog)
    await d.page.evaluate(() =>
      window.addEventListener(
        'keydown',
        (e) => {
          if (e.key !== 'Enter') return;
          const a = document.querySelector('#d').shadowRoot.activeElement;
          window.__opener = a && (a.getAttribute('aria-label') || a.dataset.tool || a.textContent.trim().slice(0, 40));
        },
        true,
      ),
    );
    await OPENERS[name](d.page, d);
    await d.page.locator('.dialog').waitFor();
    const opener = await d.page.evaluate(() => window.__opener);
    await d.page.keyboard.press('Escape');
    await until(async () => (await d.page.locator('.dialog').count()) === 0, { what: `${name} closed` });
    await settle(d.page);
    const now = await d.page.evaluate(() => {
      const a = document.querySelector('#d').shadowRoot.activeElement;
      return a
        ? a.getAttribute('aria-label') || a.dataset.tool || a.textContent.trim().slice(0, 40)
        : `nothing (${document.activeElement?.tagName})`;
    });
    if (now !== opener) fails.push(`${name}: opened from "${opener}", focus after Escape on ${now}`);
    d.expectClean();
    await d.ctx.close();
  }
  assert.deepEqual(fails, [], 'dialogs that do not give the focus back');
});

/* ---------------------------------------------------------------- smaller keyboard gaps */
test('regression: the Toolbox rail tab moves the keyboard to the first tool', async () => {
  const d = await env.open(report([tb('A', 20, 20)]));
  await d.page.locator('[data-testid="rail-tools"]').focus();
  await d.page.keyboard.press('Enter');
  const f = await focusInfo(d.page);
  assertRing(f, 'after Enter on the Toolbox tab');
  // the Data and Outline tabs take the keyboard to their first control (Designer.jsx go()); the Toolbox's tools are
  // div[role=button], which that query misses, so the focus lands on the report-parts help button after all 23 tools
  assert.equal(f.tool, 'textbox', `the focus went to ${describe(f)}`);
  d.expectClean();
});

test('regression: the Outline rail tab takes the keyboard to the selected row after the outline was tabbed through', async () => {
  const d = await env.open(report([tb('A', 20, 20), tb('B', 20, 60)]));
  const { page } = d;
  // Tab through the outline once with nothing selected (its Tab stop is then the first row)
  await page.locator('[data-testid="rail-outline"]').focus();
  await tabTo(page, (f) => !!f.row, { what: 'the outline' });
  await tabTo(page, (f) => !f.row, { what: 'past the outline' });
  // select B with the keyboard on the page, then go to the Outline by its rail tab
  await d.item('B').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await d.selected(), ['B']);
  await page.locator('[data-testid="rail-outline"]').focus();
  await page.keyboard.press('Enter');
  const f = await focusInfo(page);
  assertRing(f, 'after Enter on the Outline tab');
  // a tree takes the focus to its selected node (WAI-ARIA tree pattern); the outline keeps the row Tab passed last
  assert.equal(f.row, 'B', `the focus went to ${describe(f)}`);
  d.expectClean();
});

test('regression: a table column handle selects its column with Enter and Space', async () => {
  const d = await env.open(richDef());
  const h = d.page.locator('.tbl[data-item="T"] [data-col-handle="1"]');
  assert.equal(await h.evaluate((b) => b.tagName), 'BUTTON', 'the handle is a focusable button');
  await h.focus();
  assertRing(await focusInfo(d.page), 'the column handle');
  await d.page.keyboard.press('Enter');
  const afterEnter = await d.status();
  await d.page.keyboard.press('Space');
  const afterSpace = await d.status();
  // a click selects the column's cells ("Cell in T"); the keyboard must reach the same
  assert.match(afterEnter, /\bT\b/, `Enter on the column handle: status "${afterEnter}"`);
  assert.match(afterSpace, /\bT\b/, `Space on the column handle: status "${afterSpace}"`);
  d.expectClean();
});
