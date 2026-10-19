// M. Robustness and performance: a report of 1,000 text boxes (select all, a keyboard move and undo, each timed from
// the key press until the DOM shows it), rapid alternating undo/redo, the JS heap after opening and closing dialogs
// (Chromium only: CDP), and no console error anywhere in the run. Timings are printed as test diagnostics.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, BROWSER } from './harness.mjs';

let env;
const allErrors = []; // every console.error and page error of the whole file (expectClean forgets per test)
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

/** env.open, with the errors also collected for the whole run. */
async function open(def, opts) {
  const d = await env.open(def, opts);
  d.page.on('pageerror', (e) => allErrors.push(`pageerror: ${e.message}`));
  d.page.on('console', (m) => {
    if (m.type() === 'error') allErrors.push(`console.error: ${m.text()}`);
  });
  return d;
}

const N = 1000;
const BUDGET_MS = 200;
const COLS = 20;
/** N small text boxes in a grid on one body band. */
function bigDef(n = N) {
  const items = Array.from({ length: n }, (_, i) => tb(`T${i}`, (i % COLS) * 26, Math.floor(i / COLS) * 14, 24, 12));
  return report([], { sections: { body: { height: Math.ceil(n / COLS) * 14 + 20, items } } });
}
const LAST = `T${N - 1}`;

async function openBig() {
  const d = await open(bigDef());
  await d.page.locator(`.it[data-item="${LAST}"]`).waitFor({ timeout: 60000 });
  await d.focusCanvas();
  return d;
}

/**
 * Press a key and time it in the page: from the keydown (a capturing listener, before the designer's) until a DOM
 * mutation makes check(shadowRoot) true ("dom"), and the frame after it ("frame"). check is a function body.
 */
async function timeKey(d, keyName, check) {
  await d.page.evaluate((src) => {
    const sr = document.querySelector('#d').shadowRoot;
    const ok = new Function('root', src);
    window.__timing = new Promise((resolve, reject) => {
      let start = null;
      const t = setTimeout(() => {
        mo.disconnect();
        reject(new Error(`no DOM change for: ${src}`));
      }, 20000);
      window.addEventListener(
        'keydown',
        () => {
          start = performance.now();
        },
        { capture: true, once: true },
      );
      const mo = new MutationObserver(() => {
        if (start == null || !ok(sr)) return;
        const dom = performance.now() - start;
        mo.disconnect();
        clearTimeout(t);
        requestAnimationFrame(() => resolve({ dom: Math.round(dom), frame: Math.round(performance.now() - start) }));
      });
      mo.observe(sr, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  }, check);
  await d.page.keyboard.press(keyName);
  return d.page.evaluate(() => window.__timing);
}
const leftOf = (d, name) =>
  d.page.evaluate(
    (n) => document.querySelector('#d').shadowRoot.querySelector(`.it[data-item="${n}"]`).style.left,
    name,
  );
const selAll = `return root.querySelectorAll('.it.sel').length === ${N}`;
const selNone = "return root.querySelectorAll('.it.sel').length === 0";
const leftIs = (name, v, same) =>
  `return (root.querySelector('.it[data-item="${name}"]').style.left === ${JSON.stringify(v)}) === ${same}`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** One round: Ctrl+A, ArrowRight, Ctrl+Z, Escape, each timed. */
async function round(d) {
  const a = await timeKey(d, 'ControlOrMeta+a', selAll);
  const left0 = await leftOf(d, LAST);
  const move = await timeKey(d, 'ArrowRight', leftIs(LAST, left0, false));
  const undo = await timeKey(d, 'ControlOrMeta+z', leftIs(LAST, left0, true));
  await timeKey(d, 'Escape', selNone);
  return { selectAll: a.frame, move: move.frame, undo: undo.frame };
}
/** A warm-up round, then three measured ones: the median of each action. */
async function measure(t) {
  const d = await openBig();
  await round(d);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await round(d));
  const m = {
    selectAll: median(runs.map((r) => r.selectAll)),
    move: median(runs.map((r) => r.move)),
    undo: median(runs.map((r) => r.undo)),
  };
  t.diagnostic(
    `${N} text boxes, ms to the frame after the DOM change (3 runs): ${JSON.stringify(runs)}; median ${JSON.stringify(m)}`,
  );
  // the model agrees with the page: all back where they were
  const def = await d.def();
  assert.equal(def.sections.body.items.length, N);
  assert.deepEqual(
    def.sections.body.items.slice(-1).map((i) => [i.x, i.y]),
    [[((N - 1) % COLS) * 26, Math.floor((N - 1) / COLS) * 14]],
  );
  d.expectClean();
  await d.ctx.close();
  return m;
}

let timings = null;
const timed = async (t) => {
  timings ||= await measure(t);
  return timings;
};

test(`regression: ${N} text boxes: Ctrl+A shows all selected within ${BUDGET_MS} ms`, async (t) => {
  const m = await timed(t);
  assert.ok(m.selectAll < BUDGET_MS, `Ctrl+A took ${m.selectAll} ms (median of 3)`);
});
test(`regression: ${N} text boxes: an arrow-key move of all of them shows within ${BUDGET_MS} ms`, async (t) => {
  const m = await timed(t);
  assert.ok(m.move < BUDGET_MS, `ArrowRight took ${m.move} ms (median of 3)`);
});
test(`regression: ${N} text boxes: undo of that move shows within ${BUDGET_MS} ms`, async (t) => {
  const m = await timed(t);
  assert.ok(m.undo < BUDGET_MS, `Ctrl+Z took ${m.undo} ms (median of 3)`);
});

test(`${N} text boxes: 50 rapid alternating undo/redo end on the right state, page and model agreeing`, async (t) => {
  const d = await openBig();
  const before = await d.def();
  await d.press(['ControlOrMeta+a', 'ArrowRight', 'ArrowDown', 'Escape']);
  await d.page.locator('.it.sel').first().waitFor({ state: 'detached', timeout: 20000 });
  const moved = await d.def();
  const last = (def) => def.sections.body.items[N - 1];
  assert.notDeepEqual([last(moved).x, last(moved).y], [last(before).x, last(before).y], 'the keys moved the items');
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    await d.page.keyboard.press('ControlOrMeta+z');
    await d.page.keyboard.press('ControlOrMeta+Shift+z');
  }
  const ms = Date.now() - t0;
  t.diagnostic(`50 undo/redo pairs on ${N} text boxes: ${ms} ms (${Math.round(ms / 100)} ms a key)`);
  const after = await d.def();
  assert.deepEqual(after.sections, moved.sections, 'after the pairs: the moved state');
  // the page shows the model: the last item's left edge matches a fresh render of the same x
  const shown = await leftOf(d, LAST);
  await d.undo(2);
  assert.deepEqual((await d.def()).sections, before.sections, 'two undos: back to the start');
  await d.redo(2);
  await d.page.waitForFunction(
    ([n, v]) => document.querySelector('#d').shadowRoot.querySelector(`.it[data-item="${n}"]`).style.left === v,
    [LAST, shown],
    { timeout: 20000 },
  );
  assert.deepEqual((await d.def()).sections, moved.sections, 'two redos: the moved state again');
  d.expectClean();
});

test('undo and redo past the ends of the history change nothing and throw nothing', async () => {
  const d = await open(report([tb('A', 20, 20)]));
  await d.click('A');
  await d.press(['ArrowRight', 'ArrowRight', 'ArrowDown']);
  const end = await d.def();
  for (let i = 0; i < 25; i++) await d.press(['ControlOrMeta+z', 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']);
  await d.undo(10);
  const start = await d.get('A');
  assert.deepEqual([start.x, start.y], [20, 20], 'undo past the start: the first state');
  await d.redo(20);
  assert.deepEqual((await d.def()).sections, end.sections, 'redo past the end: the last state');
  d.expectClean();
});

/* ---------------------------------------------------------------- dialogs and the heap */
const DATA = {
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }],
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
/** Open one dialog with the keyboard; each returns once the dialog is there. */
const DIALOGS = [
  [
    'shortcuts',
    async (d) => {
      await d.focusCanvas();
      await d.page.keyboard.press('?');
    },
  ],
  [
    'chart gallery',
    async (d) => {
      await d.page.locator('.tool[data-tool="chart"]').focus();
      await d.page.keyboard.press('Enter');
    },
  ],
  [
    'table wizard',
    async (d) => {
      await d.page.locator('.tool[data-tool="table"]').focus();
      await d.page.keyboard.press('Enter');
    },
  ],
  [
    'parameter',
    async (d) => {
      await d.page.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(0).focus();
      await d.page.keyboard.press('Enter');
    },
  ],
  [
    'data set',
    async (d) => {
      await d.page.locator('[data-rail="data"] h4 button', { hasText: '+ Add' }).nth(2).focus();
      await d.page.keyboard.press('Enter');
    },
  ],
  [
    'expression editor',
    async (d) => {
      await d.item('A').focus();
      await d.page.keyboard.press('Enter');
      await d.page.locator('[data-testid="inspector"] button.fx').first().focus();
      await d.page.keyboard.press('Enter');
    },
  ],
  [
    'conditional format',
    async (d) => {
      await d.item('A').focus();
      await d.page.keyboard.press('Enter');
      await d.page.getByRole('button', { name: 'Conditional formatting…' }).focus();
      await d.page.keyboard.press('Enter');
    },
  ],
];
async function cycle(d, n) {
  for (let i = 0; i < n; i++) {
    const [name, openIt] = DIALOGS[i % DIALOGS.length];
    await openIt(d);
    await d.page.locator('.dialog').waitFor({ timeout: 10000 });
    await d.page.keyboard.press('Escape');
    await d.page
      .locator('.dialog')
      .waitFor({ state: 'detached', timeout: 10000 })
      .catch(() => {
        throw new Error(`${name} did not close on Escape`);
      });
  }
}
async function heap(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}

test('opening and closing 20 dialogs leaves no more than 5 MB of JS heap behind', async (t) => {
  const d = await open(report([tb('A', 20, 20)], DATA));
  await cycle(d, DIALOGS.length); // warm-up: every dialog once (code, caches)
  const chromium = BROWSER === 'chromium';
  const cdp = chromium ? await d.ctx.newCDPSession(d.page) : null;
  if (cdp) {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Runtime.enable');
  }
  const h0 = cdp ? await heap(cdp) : 0;
  await cycle(d, 20);
  if (cdp) {
    const h1 = await heap(cdp);
    const mb = (h1 - h0) / 1048576;
    t.diagnostic(
      `JS heap after GC: ${(h0 / 1048576).toFixed(1)} MB before, ${(h1 / 1048576).toFixed(1)} MB after 20 dialogs (${mb >= 0 ? '+' : ''}${mb.toFixed(2)} MB)`,
    );
    assert.ok(mb <= 5, `heap grew ${mb.toFixed(2)} MB`);
  } else t.diagnostic(`heap check skipped on ${BROWSER} (no CDP)`);
  assert.equal(await d.page.locator('.dialog').count(), 0);
  assert.equal(await d.dirty(), false, 'opening and cancelling dialogs changes nothing');
  d.expectClean();
});

test('no console error or page error in the whole run', () => {
  assert.deepEqual(allErrors, []);
});
