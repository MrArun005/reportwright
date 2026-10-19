// Designer Preview tab and the issues panel: switching Design ↔ Preview keeps the selection and the unsaved changes
// (and leaks no DOM or heap), Preview with inline JSON data and with none, and the issues list: every kind of issue
// (src/designer/issues.js and Canvas issueLine) listed, each line selecting its item, Escape closing the list.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, report, tb, BROWSER } from './harness.mjs';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

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
const designBtn = (d) => d.page.locator('.seg button').filter({ hasText: /^Design$/ });
const previewBtn = (d) => d.page.getByTestId('tab-preview');
async function toPreview(d) {
  await previewBtn(d).click();
  await d.page.locator('.dpreview .vpage, .dpreview .vmsg.error').first().waitFor({ timeout: 30000 });
}
async function toDesign(d) {
  await designBtn(d).click();
  await d.page.locator('[data-testid="paper"]').waitFor();
}
/** Names of everything selected on the canvas (items and tables). */
const selectedAny = (d) =>
  d.page.locator('.paper .sel[data-item]').evaluateAll((els) => els.map((e) => e.dataset.item));
const domCount = (d) =>
  d.page.evaluate(
    () => document.querySelectorAll('*').length + document.querySelector('#d').shadowRoot.querySelectorAll('*').length,
  );

const SALES_FIELDS = [
  { name: 'region', type: 'string' },
  { name: 'amount', type: 'number' },
];
/** A report with a table over inline JSON rows (data: the source's data, an object or a JSON string). */
const tableReport = (data, path = '$.rows') =>
  report(
    [
      {
        type: 'table',
        name: 'T',
        x: 0,
        y: 0,
        w: 300,
        h: 40,
        dataSet: 'Sales',
        noRowsText: 'No rows here',
        columns: [{ width: 150 }, { width: 150 }],
        header: [{ height: 20, cells: [{ value: 'Region' }, { value: 'Amount' }] }],
        detail: [{ height: 20, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }] }],
      },
      tb('A', 0, 100),
      tb('B', 150, 100),
    ],
    {
      dataSources: [{ name: 'sales', type: 'json', data }],
      dataSets: [{ name: 'Sales', source: 'sales', path, fields: SALES_FIELDS }],
    },
  );

describe('Design ↔ Preview', () => {
  test(
    '20 round trips keep the selection and the unsaved changes; no console errors; DOM and heap do not grow',
    { timeout: 180000 },
    async () => {
      const d = await env.open(
        tableReport({
          rows: [
            { region: 'Northwind', amount: 42 },
            { region: 'Southpaw', amount: 7 },
          ],
        }),
      );
      await d.click('A');
      await d.click('B', ['Shift']);
      await d.press('ArrowDown');
      const def = await d.def();
      const sel = await d.selected();
      assert.deepEqual(sel, ['A', 'B']);
      const status = await d.status();
      const cdp = BROWSER === 'chromium' ? await d.ctx.newCDPSession(d.page) : null;
      const heap = async () => {
        if (!cdp) return null;
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const doms = [],
        heaps = [];
      for (let i = 0; i < 20; i++) {
        await toPreview(d);
        assert.equal(await previewBtn(d).getAttribute('aria-pressed'), 'true');
        assert.equal(await d.page.locator('[data-testid="paper"]').count(), 0, 'the canvas is gone in Preview');
        await toDesign(d);
        assert.equal(await designBtn(d).getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await d.selected(), sel, `selection after round trip ${i + 1}`);
        assert.equal(await d.status(), status);
        assert.equal(await d.dirty(), true);
        assert.equal(await d.page.getByTestId('save-state').innerText(), 'Unsaved changes');
        assert.deepEqual(await d.def(), def, `definition after round trip ${i + 1}`);
        doms.push(await domCount(d));
        heaps.push(await heap());
        d.expectClean();
      }
      // the first rounds warm caches up: compare round 5 with round 20
      assert.ok(doms[19] <= doms[4] * 1.02 + 5, `DOM nodes grew: ${doms.join(', ')}`);
      if (cdp)
        assert.ok(
          heaps[19] - heaps[4] < 1.5 * 1024 * 1024,
          `JS heap grew by ${Math.round((heaps[19] - heaps[4]) / 1024)} KB: ${heaps.map((h) => Math.round(h / 1024)).join(', ')}`,
        );
      // the history survived: undo takes the nudge back
      await d.undo();
      assert.equal((await d.get('A')).y, 100);
      d.expectClean();
    },
  );

  test('in Preview, editing keys do nothing to the design (undo, delete, nudge, select all)', async () => {
    const d = await env.open(tableReport({ rows: [{ region: 'N', amount: 1 }] }));
    await d.click('A');
    await d.press('ArrowRight');
    const def = await d.def();
    await toPreview(d);
    await d.page.locator('.vpages').click({ position: { x: 5, y: 5 } });
    await d.press(['ControlOrMeta+z', 'Delete', 'ArrowLeft', 'ControlOrMeta+d', 'ControlOrMeta+a']);
    await d.pasteText(
      JSON.stringify({
        kind: 'pagewright/items@1',
        items: [{ type: 'textbox', name: 'Pasted', x: 0, y: 0, w: 10, h: 10 }],
      }),
    );
    assert.deepEqual(await d.def(), def);
    await toDesign(d);
    assert.deepEqual(await d.selected(), ['A']);
    d.expectClean();
  });

  test('a change made in Design shows in the next Preview', async () => {
    const d = await env.open(tableReport({ rows: [{ region: 'N', amount: 1 }] }));
    await toPreview(d);
    assert.doesNotMatch(await d.page.locator('.dpreview .vpage').first().innerText(), /Renamed text/);
    await toDesign(d);
    await d.focusCanvas();
    await d.pasteText(
      JSON.stringify({
        kind: 'pagewright/items@1',
        items: [{ type: 'textbox', name: 'New', x: 0, y: 200, w: 200, h: 20, value: 'Renamed text' }],
      }),
    );
    await until(
      async () => JSON.stringify((await d.def()).sections.body.items).includes('Renamed text'),
      5000,
      'pasted item',
    ); // pasted under a fresh name
    await toPreview(d);
    await until(
      async () => /Renamed text/.test(await d.page.locator('.dpreview .vpage').first().innerText()),
      10000,
      'new text in preview',
    );
    d.expectClean();
  });
});

describe('Preview data', () => {
  test('inline JSON rows show in the table', async () => {
    const d = await env.open(
      tableReport({
        rows: [
          { region: 'Northwind', amount: 42 },
          { region: 'Southpaw', amount: 7 },
        ],
      }),
    );
    await toPreview(d);
    const page = await d.page.locator('.dpreview .vpage').first().innerText();
    for (const s of ['Region', 'Amount', 'Northwind', '42', 'Southpaw', '7'])
      assert.ok(page.includes(s), `"${s}" in ${page}`);
    assert.doesNotMatch(page, /No rows here/);
    assert.match(await d.page.locator('.dpreview').innerText(), /2 rows/);
    d.expectClean();
  });

  test('inline JSON given as a string is parsed', async () => {
    const d = await env.open(tableReport(JSON.stringify({ rows: [{ region: 'Stringland', amount: 5 }] })));
    await toPreview(d);
    assert.match(await d.page.locator('.dpreview .vpage').first().innerText(), /Stringland/);
    d.expectClean();
  });

  test('an empty data array: one page with the no-rows text, no error', async () => {
    const d = await env.open(tableReport({ rows: [] }));
    await toPreview(d);
    assert.equal(await d.page.locator('.dpreview .vmsg.error').count(), 0);
    assert.equal(await d.page.locator('.dpreview .vpage').count(), 1);
    const page = await d.page.locator('.dpreview .vpage').first().innerText();
    assert.match(page, /Region/);
    assert.match(page, /No rows here/);
    assert.doesNotMatch(page, /#Error/);
    d.expectClean();
  });

  test('a top-level empty array (path $) works the same', async () => {
    const d = await env.open(tableReport([], '$'));
    await toPreview(d);
    assert.equal(await d.page.locator('.dpreview .vmsg.error').count(), 0);
    assert.match(await d.page.locator('.dpreview .vpage').first().innerText(), /No rows here/);
    d.expectClean();
  });

  test('inline JSON that does not parse: Preview says why, the designer keeps working', async () => {
    const d = await env.open(tableReport('{ "rows": [ broken'));
    await toPreview(d);
    const msg = d.page.locator('.dpreview .vmsg.error');
    await msg.waitFor();
    assert.match(await msg.innerText(), /sales/i);
    await toDesign(d);
    await d.click('A');
    assert.deepEqual(await d.selected(), ['A']);
    // the designer's own sample load may report the same parse error in its panel; nothing reaches the console
    d.expectClean();
  });
});

/* ---------------------------------------------------------------- issues */

const ISSUE_SALES = { name: 'sales', type: 'json', data: { rows: [{ region: 'N', amount: 1 }] } };
const ISSUE_SET = { name: 'Sales', source: 'sales', path: '$.rows', fields: SALES_FIELDS };
/** One report with every kind of issue: four body sections, each kind on its own named item or section. */
function allIssues() {
  return {
    $schema: 'reportwright/report@1',
    name: 'Issues',
    page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [ISSUE_SALES],
    dataSets: [ISSUE_SET],
    sections: {
      pageHeader: { height: 40, items: [tb('Head', 0, 0)] },
      pageFooter: { height: 30, items: [] },
      body: [
        {
          name: 'One',
          height: 800,
          items: [
            tb('OvA', 0, 0, 100, 40),
            tb('OvB', 50, 20, 100, 40),
            tb('Wide', 450, 100, 200, 20),
            { type: 'container', name: 'Box', x: 0, y: 200, w: 200, h: 100, items: [] },
            tb('Loose', 10, 210, 50, 20),
            tb('Bad', 300, 300, 100, 20, { value: '=NoSuchFn(1)' }),
            tb('Fld', 300, 340, 100, 20, { value: '=Fields.zzzqq' }),
            tb('Sug', 300, 380, 100, 20, { value: '=Fields.amont' }),
            tb('Below', 0, 720, 100, 20),
          ],
        },
        { name: 'Two', height: 800, items: [tb('Past', 0, 690, 100, 40), tb('Tall', 200, 0, 100, 750)] },
        { name: 'Three', height: 100, page: { orientation: 'landscape' }, items: [tb('L', 0, 0)] },
        {
          name: 'Four',
          height: 100,
          pageHeader: { height: 300, items: [] },
          pageFooter: { height: 300, items: [] },
          items: [tb('R', 0, 0)],
        },
      ],
    },
  };
}
// kind, the line (as the list shows it), the item a click selects (null: a section-level issue, nothing to select)
const KINDS = [
  ['wide', /^Wide is 650 pt wide where the page has 523 pt/, 'Wide'],
  ['field', /^Fld reads the field "zzzqq", which its data set does not have\.$/, 'Fld'],
  ['field suggest', /^Sug reads the field "amont".*Did you mean "amount"\?/, 'Sug'],
  ['overlap', /^OvB overlaps OvA/, 'OvB'],
  ['loose', /^Loose lies on Box but is not in it/, 'Loose'],
  ['below', /^Below starts at 720 pt, past the 700 pt a page has for One/, 'Below'],
  ['tall', /^Tall is 750 pt tall, taller than the 700 pt a page has for Two/, 'Tall'],
  ['past', /^Past ends at 730 pt, past the 700 pt a page has for Two/, 'Past'],
  ['shared', /^Three is landscape \(770 pt wide\) but uses the shared page header/, null],
  ['room', /^The page header \(300 pt\) and footer \(300 pt\) leave 170 pt of the page for Four/, null],
  ['check', /^Bad: Unknown function "NoSuchFn"/, 'Bad'],
];

async function openIssues(d) {
  await d.page.getByTestId('issues').click();
  const list = d.page.getByTestId('issues-list');
  await list.waitFor();
  return list;
}
const lines = async (d) => (await d.page.getByTestId('issues-list').locator('li').allInnerTexts()).map((s) => s.trim());

describe('issues panel', () => {
  test('every kind of issue is listed, and the count on the button matches', async () => {
    const d = await env.open(allIssues());
    const label = await d.page.getByTestId('issues').innerText();
    await openIssues(d);
    const got = await lines(d);
    assert.match(label, new RegExp(`\\b${got.length}\\b`));
    for (const [kind, re] of KINDS)
      assert.equal(got.filter((l) => re.test(l)).length, 1, `${kind}: ${re} in\n${got.join('\n')}`);
    assert.equal(got.length, KINDS.length, `unexpected extra lines:\n${got.join('\n')}`);
    assert.equal(await d.page.getByTestId('issues').getAttribute('aria-expanded'), 'true');
    d.expectClean();
  });

  for (const [kind, re, name] of KINDS) {
    test(`clicking the ${kind} line ${name ? `selects ${name}` : 'closes the list and keeps the selection'}`, async () => {
      const d = await env.open(allIssues());
      const list = await openIssues(d);
      const before = await d.status();
      await list.getByRole('button').filter({ hasText: re }).click();
      await list.waitFor({ state: 'detached' });
      if (name) {
        await until(async () => (await d.selected()).join() === name, 5000, `${name} selected`);
        assert.match(await d.status(), new RegExp(name));
        // the item carries the same problem on the canvas (its title)
        const it = d.item(name);
        assert.match(await it.getAttribute('class'), /\bissue\b/);
        assert.ok(
          (await it.getAttribute('title')).split('\n').some((l) => re.test(l)),
          await it.getAttribute('title'),
        );
      } else {
        assert.deepEqual(await d.selected(), []);
        assert.equal(await d.status(), before);
      }
      d.expectClean();
    });
  }

  test('Escape closes the list and gives the focus back to the button', async () => {
    const d = await env.open(allIssues());
    const list = await openIssues(d);
    await list.getByRole('button').first().focus();
    await d.press('Escape');
    await list.waitFor({ state: 'detached' });
    assert.equal(await d.page.getByTestId('issues').getAttribute('aria-expanded'), 'false');
    const focused = await d.page.evaluate(() => document.querySelector('#d').shadowRoot.activeElement?.dataset?.testid);
    assert.equal(focused, 'issues');
    // Escape closed only the list: an item selected before stays selected
    d.expectClean();
  });

  test('Escape with the list open does not also clear the selection', async () => {
    const d = await env.open(allIssues());
    await d.click('OvA');
    await openIssues(d);
    await d.press('Escape');
    await d.page.getByTestId('issues-list').waitFor({ state: 'detached' });
    assert.deepEqual(await d.selected(), ['OvA']);
    d.expectClean();
  });

  test('a click outside closes the list; the button toggles it', async () => {
    const d = await env.open(allIssues());
    await openIssues(d);
    await d.focusCanvas();
    await d.page.getByTestId('issues-list').waitFor({ state: 'detached' });
    await openIssues(d);
    await d.page.getByTestId('issues').click();
    await d.page.getByTestId('issues-list').waitFor({ state: 'detached' });
    d.expectClean();
  });

  test('the list follows edits: a fixed issue goes, the last one fixed shows "no issues"', async () => {
    const d = await env.open(report([tb('OvA', 0, 0, 100, 40), tb('OvB', 50, 20, 100, 40)]));
    await openIssues(d);
    assert.equal((await lines(d)).length, 1);
    await d.click('OvB'); // closes the list (a click outside)
    await d.press('Delete');
    await d.page.getByTestId('issues-none').waitFor();
    assert.equal(await d.page.getByTestId('issues').count(), 0);
    await d.undo();
    await d.page.getByTestId('issues').waitFor();
    d.expectClean();
  });

  test('a list open while its last issue is fixed closes', async () => {
    const d = await env.open(report([tb('OvA', 0, 0, 100, 40), tb('OvB', 50, 20, 100, 40)]));
    await d.click('OvB');
    await openIssues(d);
    await d.page.getByTestId('issues').focus();
    await d.press('Delete'); // the focus is on the button, not an input: the selection is deleted
    await d.page.getByTestId('issues-none').waitFor();
    assert.equal(await d.page.getByTestId('issues-list').count(), 0);
    d.expectClean();
  });

  test('a check issue in a table cell selects the table', async () => {
    const d = await env.open(
      report([
        {
          type: 'table',
          name: 'Ledger',
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          columns: [{ width: 100 }, { width: 100 }],
          header: [{ height: 20, cells: [{ value: 'H' }, { value: 'I' }] }],
          detail: [{ height: 20, cells: [{ value: '=NoSuchFn(1)' }, { value: 'x' }] }],
        },
      ]),
    );
    const list = await openIssues(d);
    const got = await lines(d);
    assert.ok(
      got.some((l) => /^Ledger( cell)?: Unknown function "NoSuchFn"/.test(l)),
      got.join('\n'),
    );
    await list
      .getByRole('button')
      .filter({ hasText: /^Ledger( cell)?: Unknown/ })
      .click();
    await until(async () => (await selectedAny(d)).join() === 'Ledger', 5000, 'Ledger selected');
    d.expectClean();
  });

  test('regression: a check issue about an item filter does not select its item', async () => {
    const d = await env.open(
      report([
        {
          type: 'table',
          name: 'Ledger',
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          columns: [{ width: 200 }],
          filters: [{ expr: '', op: '=', value: 1 }],
          header: [{ height: 20, cells: [{ value: 'H' }] }],
          detail: [{ height: 20, cells: [{ value: 'x' }] }],
        },
      ]),
    );
    const list = await openIssues(d);
    const line = (await lines(d)).find((l) => /^Ledger, filter 1 has no expr/.test(l));
    assert.ok(line, (await lines(d)).join('\n'));
    await list
      .getByRole('button')
      .filter({ hasText: /^Ledger, filter 1/ })
      .click();
    await until(async () => (await selectedAny(d)).join() === 'Ledger', 3000, 'Ledger selected');
    d.expectClean();
  });

  test('issues are not shown in Preview; back in Design the list is closed', async () => {
    const d = await env.open(allIssues());
    await openIssues(d);
    await toPreview(d);
    assert.equal(await d.page.getByTestId('issues').count(), 0);
    await toDesign(d);
    assert.equal(await d.page.getByTestId('issues-list').count(), 0);
    await openIssues(d);
    assert.equal((await lines(d)).length, KINDS.length);
    d.expectClean();
  });
});
