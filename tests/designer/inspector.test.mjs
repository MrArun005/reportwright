// Properties panel (Inspector): every item type's fields, each kind of field, invalid input, multi-select, the property
// find box, the expression editor, conditional formatting, and values kept through save and reopen.
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

/** Poll fn until it returns a truthy value (or the time is up); returns the last value. */
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 40));
    v = await fn();
  }
  return v;
}
const insp = (d) => d.page.getByTestId('inspector');
/** The Inspector field (label.field) whose caption is exactly `label`. */
const field = (d, label, nth = 0) =>
  insp(d)
    .locator('label.field', { has: d.page.locator(`span:text-is(${JSON.stringify(label)})`) })
    .nth(nth);
const ctl = (d, label, nth = 0) => field(d, label, nth).locator('input, select, textarea').first();
/** The control of a style property (StyleCats wraps each in data-prop). */
const prop = (d, key) => insp(d).locator(`[data-prop="${key}"]`);
/** Type into an input as a person does: select all, then key by key, 80 ms apart. */
async function typeIn(d, el, text) {
  await el.click();
  await d.page.keyboard.press('ControlOrMeta+a');
  if (text) await d.page.keyboard.type(text, { delay: 80 });
  else await d.page.keyboard.press('Backspace');
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** Click an item and wait until it is the selection (a click while the page still lays out can miss: try again). */
async function select(d, name, mods = []) {
  for (let k = 0; k < 3; k++) {
    await d.click(name, mods);
    if (await until(async () => (await d.selected()).includes(name), 1500)) return;
  }
  assert.fail(`${name} could not be selected`);
}
/** Select an item by its name in the Outline (tables are not .it boxes). */
async function pick(d, name) {
  await d.page.getByTestId('outline').getByRole('button', { name, exact: true }).click();
  await until(
    async () =>
      (await insp(d)
        .getByLabel('Item name')
        .inputValue()
        .catch(() => '')) === name,
  );
}
/** The name of the first item of a type in the body (nested too). */
async function nameOfType(d, type) {
  return until(async () => {
    let n = null;
    const go = (l) =>
      (l || []).forEach((x) => {
        if (!n && x.type === type) n = x.name;
        go(x.items);
      });
    go((await d.def()).sections.body.items);
    return n;
  });
}

/* ------------------------------------------------------------------ every item type, every control */

// all 23 tools of the toolbox (Designer.jsx TOOLS)
const TYPES = [
  'textbox',
  'richtext',
  'table',
  'image',
  'line',
  'shape',
  'list',
  'container',
  'chart',
  'matrix',
  'barcode',
  'sparkline',
  'databar',
  'bullet',
  'iconset',
  'rangebar',
  'subreport',
  'toc',
  'field',
  'map',
  'placeholder',
  'overflow',
  'checkbox',
];
const CONTROLS =
  'input:not([type=file]):not([type=search]):not([readonly]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
// controls that by design do not write the definition on their own: drafts of a name to add, a pick list that is empty
// in a report with no data sets, the sort direction while there is no sort, an option that only shapes the next "Add"
const NO_WRITE = [
  /New property name/,
  /Another parameter by name/,
  /\[no options\]/,
  /^Direction/,
  /Drill-down: the group starts collapsed/,
  /(minimum|maximum|Label angle).*=1$/i,
  /Width \(pt\).*clamped/,
];

/**
 * Walk every enabled control of the Inspector once: a checkbox is clicked, a select takes another option, a number
 * becomes 7, a colour #ff0000, text gets "1" appended (or "=1"). @returns {{ changed: number, kept: string[] }}
 */
async function walkControls(d) {
  const kept = [];
  let changed = 0;
  for (let i = 0; i < 300; i++) {
    const all = insp(d).locator(CONTROLS);
    if (i >= (await all.count())) break;
    const el = all.nth(i);
    if (!(await el.isVisible())) continue;
    const info = await el.evaluate((e) => ({
      tag: e.tagName,
      type: e.type,
      aria: e.getAttribute('aria-label'),
      label: (e.closest('label')?.querySelector('span')?.textContent || e.closest('label')?.textContent || '').trim(),
      value: e.value,
      opts: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value) : null,
    }));
    if (info.aria === 'Item name') continue;
    const tag = `${info.label} | ${info.aria}`;
    const before = JSON.stringify(await d.def());
    let typed = '';
    if (info.type === 'checkbox') await el.click();
    else if (info.tag === 'SELECT') {
      const o = info.opts.filter((v) => v !== info.value && v !== '');
      if (!o.length) {
        kept.push(`${tag} [no options]`);
        continue;
      }
      await el.selectOption(o[o.length - 1]);
    } else if (info.type === 'number') await el.fill((typed = '7'));
    else if (info.type === 'color') await el.fill('#ff0000');
    else await el.fill((typed = info.value ? `${info.value}1` : '=1'));
    const after = JSON.stringify(await d.def());
    if (after !== before) changed++;
    else
      kept.push(
        `${tag}${info.type === 'number' && Number(info.value) >= 7 ? '' : ''}${typed ? ` ${typed}` : ''}${info.type === 'number' ? ' clamped' : ''}`,
      );
  }
  return { changed, kept };
}

for (const type of TYPES) {
  test(
    `Inspector of a ${type}: renders cleanly and every control writes the definition`,
    { timeout: 120000 },
    async () => {
      const d = await env.open(report([]));
      await d.page.locator(`.tool[data-tool="${type}"]`).click();
      await until(async () => (await d.selected()).length === 1);
      const head = await insp(d).locator('.insp-head .ty').innerText();
      assert.ok(head.trim().length > 0, 'the Inspector names the item type');
      const { changed, kept } = await walkControls(d);
      assert.ok(changed >= 3, `${type}: only ${changed} controls changed the definition`);
      const unexpected = kept.filter((k) => !NO_WRITE.some((r) => r.test(k)));
      assert.deepEqual(unexpected, [], `${type}: controls that did not change the definition`);
      // the item is still there, its box still numbers, and the Inspector still shows it
      const def = await d.def();
      let it = null;
      const go = (l) =>
        (l || []).forEach((x) => {
          if (!it && x.type === type) it = x;
          go(x.items);
        });
      go(def.sections.body.items);
      assert.ok(it, `${type} item kept`);
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(isNum(it[k]) && it[k] >= 0, `${type}.${k}=${it[k]}`);
      assert.ok(await insp(d).locator('.insp-head').isVisible());
      d.expectClean();
      await d.ctx.close();
    },
  );
}

test(
  'Inspector of a table cell, several cells, a band and the report: every control writes the definition',
  { timeout: 180000 },
  async () => {
    const d = await env.open(report([]));
    await d.page.locator('.tool[data-tool="table"]').click();
    const name = await nameOfType(d, 'table');
    const tbl = d.page.locator(`[data-item="${name}"]`);
    const cell = tbl.locator('[data-cell="detail-0-0"]');
    await cell.click();
    await until(async () => /Cell/i.test(await insp(d).locator('.insp-head').innerText()));
    let r = await walkControls(d);
    assert.ok(r.changed > 20, `cell: ${r.changed}`);
    assert.deepEqual(
      r.kept.filter((k) => !NO_WRITE.some((x) => x.test(k))),
      [],
      'cell controls that did not write',
    );
    // two cells: shared style properties
    await tbl.locator('[data-cell="detail-0-0"]').click();
    await tbl.locator('[data-cell="detail-0-1"]').click({ modifiers: ['Shift'] });
    await until(async () => /2/.test(await insp(d).locator('.insp-head').innerText()));
    r = await walkControls(d);
    assert.ok(r.changed > 10, `cells: ${r.changed}`);
    const t = Designer.find(await d.def(), name);
    assert.equal(
      t.detail[0].cells[0].style?.fontSize,
      t.detail[0].cells[1].style?.fontSize,
      'a shared property is set on both cells',
    );
    // the body band
    await d.band('body').click({ position: { x: 500, y: 380 } });
    await until(async () => /Body/.test(await d.status()));
    r = await walkControls(d);
    assert.ok(r.changed >= 2, `band: ${r.changed}`);
    // the report
    await d.focusCanvas();
    await d.press('Escape');
    await d.press('Escape');
    await until(async () => /Report/.test(await d.status()));
    r = await walkControls(d);
    assert.ok(r.changed > 10, `report: ${r.changed}`);
    d.expectClean();
    await d.ctx.close();
  },
);

/* ------------------------------------------------------------------ each kind of field, by name */

test('each kind of field of a text box writes the expected value', async () => {
  const d = await env.open(report([tb('A', 20, 20, 120, 30)]));
  await select(d, 'A');
  await ctl(d, 'Value').fill('=Globals.PageNumber');
  await ctl(d, 'Rotate (degrees clockwise)').fill('45');
  await prop(d, 'fontFamily').locator('select').selectOption({ index: 1 });
  await prop(d, 'fontSize').locator('input').fill('14');
  await prop(d, 'fontWeight').locator('select').selectOption('bold');
  await prop(d, 'color').locator('input.input').fill('#123456');
  await prop(d, 'backgroundColor').locator('input[type=color]').fill('#00ff00');
  await prop(d, 'border').locator('input').fill('1 solid #ccc');
  await prop(d, 'padding').locator('input').fill('2 4 2 4');
  await prop(d, 'format').locator('input').fill('N2');
  await ctl(d, 'Hidden').fill('=Parameters.hide');
  await ctl(d, 'Action on click').selectOption('url');
  await ctl(d, 'URL').fill('="https://example.com/" & Fields.id');
  const a = await d.get('A');
  assert.equal(a.value, '=Globals.PageNumber');
  assert.equal(a.rotate, 45);
  assert.ok(typeof a.style.fontFamily === 'string' && a.style.fontFamily.length > 0);
  assert.equal(a.style.fontSize, 14);
  assert.equal(a.style.fontWeight, 'bold');
  assert.equal(a.style.color, '#123456');
  assert.equal(a.style.backgroundColor, '#00ff00');
  assert.equal(a.style.border, '1 solid #ccc');
  assert.equal(a.style.padding, '2 4 2 4');
  assert.equal(a.style.format, 'N2');
  assert.equal(a.hidden, '=Parameters.hide');
  assert.deepEqual(a.action, { type: 'url', url: '="https://example.com/" & Fields.id' });
  // a font size as an expression (ExprOr): "=" switches the field, "×" back to a fixed value
  const exprBtn = prop(d, 'fontSize').locator('button[aria-pressed]');
  if (!((await exprBtn.getAttribute('aria-pressed')) === 'true')) await exprBtn.click();
  await prop(d, 'fontSize').locator('input').first().fill('=IIf(Fields.amount < 0, 12, 9)');
  assert.equal((await d.get('A')).style.fontSize, '=IIf(Fields.amount < 0, 12, 9)');
  await exprBtn.click();
  assert.equal((await d.get('A')).style.fontSize, undefined, 'back to a fixed value clears the expression');
  // emptying a text field removes the key, not an empty string
  await prop(d, 'format').locator('input').fill('');
  assert.ok(!('format' in (await d.get('A')).style));
  // undo takes back one edit
  await d.focusCanvas();
  await d.undo();
  assert.equal((await d.get('A')).style.format, 'N2');
  d.expectClean();
});

test('the colour picker and the colour text box show the same value', async () => {
  const d = await env.open(report([tb('A', 20, 20, 120, 30, { style: { color: '#336699' } })]));
  await select(d, 'A');
  assert.equal(await prop(d, 'color').locator('input[type=color]').inputValue(), '#336699');
  await prop(d, 'color').locator('input.input').fill('');
  assert.ok(!('color' in ((await d.get('A')).style || {})), 'an empty colour removes it');
  d.expectClean();
});

/* ------------------------------------------------------------------ invalid input */

test('number fields: letters, an empty field, a negative or tiny size never store NaN or a size below 1', async () => {
  const d = await env.open(report([tb('A', 50, 50, 100, 40)]));
  await select(d, 'A');
  const w = ctl(d, 'Width (pt)');
  await typeIn(d, w, 'abc');
  assert.equal((await d.get('A')).w, 100, 'letters are not stored');
  await d.page.keyboard.press('Tab');
  assert.equal(await w.inputValue(), '100', 'the field shows the stored value again after leaving it');
  await typeIn(d, w, '');
  await d.page.keyboard.press('Tab');
  assert.equal((await d.get('A')).w, 100, 'an empty field is not stored');
  await w.fill('-50');
  let a = await d.get('A');
  assert.ok(a.w >= 1, `negative width stored as ${a.w}`);
  await ctl(d, 'Height (pt)').fill('0');
  a = await d.get('A');
  assert.ok(a.h >= 1, `zero height stored as ${a.h}`);
  await ctl(d, 'X (pt)').fill('-30');
  await ctl(d, 'Y (pt)').fill('-30');
  a = await d.get('A');
  assert.deepEqual([a.x, a.y], [0, 0], 'a negative place is 0');
  await typeIn(d, w, '1e400'); // out of range for a number: not stored as Infinity
  a = await d.get('A');
  assert.ok(isNum(a.w), `width ${a.w}`);
  await ctl(d, 'Rotate (degrees clockwise)').fill('-90');
  assert.equal((await d.get('A')).rotate, -90);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(isNum(a[k]) && a[k] >= 0);
  d.expectClean();
});

test('a huge X: stored as a number and the Issues list says the item is wider than the page', async () => {
  const d = await env.open(report([tb('A', 50, 50, 100, 40)]));
  await select(d, 'A');
  await ctl(d, 'X (pt)').fill('99999');
  const a = await d.get('A');
  assert.ok(isNum(a.x));
  await d.page.getByTestId('issues').click();
  const lines = await d.page.getByTestId('issues-list').locator('li').allInnerTexts();
  assert.ok(
    lines.some((l) => /A is \d+ pt wide/.test(l)),
    lines.join('\n'),
  );
  d.expectClean();
});

test('regression: typing a band height digit by digit stores a different number (the clamped value is written back mid-typing)', async () => {
  // the body's least height is 90 (A ends there): typing "450" goes 4 → 90, "90"+"5" → 905, "905"+"0" → 9050
  const d = await env.open(report([tb('A', 50, 50, 100, 40)]));
  await d.band('body').click({ position: { x: 400, y: 300 } });
  await until(async () => /Body/.test(await d.status()));
  await typeIn(d, ctl(d, 'Height (pt)'), '450');
  assert.equal((await d.def()).sections.body.height, 450);
  d.expectClean();
});

test('regression: typing a column width of 40 in the table Inspector stores 120', async () => {
  // tableSetColumnWidth clamps to 12: "4" → 12, then "12"+"0" → 120
  const d = await env.open(report([]));
  await d.page.locator('.tool[data-tool="table"]').click();
  const name = await nameOfType(d, 'table');
  await typeIn(d, ctl(d, '#1'), '40');
  assert.equal(Designer.find(await d.def(), name).columns[0].width, 40);
  d.expectClean();
});

test(
  'regression: a large Y typed in the Inspector freezes the designer (a ruler tick per step of the grown band)',
  { timeout: 120000 },
  async () => {
    const d = await env.open(report([tb('A', 50, 50, 100, 40)]));
    await select(d, 'A');
    await ctl(d, 'Y (pt)').fill('100000'); // 100 000 pt: about 140 pages of body
    const t0 = Date.now();
    await ctl(d, 'Y (pt)').evaluate((e) => e.focus());
    // one more digit: 1 000 000 pt. The page must answer again within 5 s.
    const typed = d.page.keyboard.press('0');
    const answer = await Promise.race([
      typed.then(() => d.page.evaluate(() => 'ok')),
      new Promise((r) => setTimeout(() => r('frozen'), 5000)),
    ]);
    const ms = Date.now() - t0;
    await typed.catch(() => {});
    const y = (await d.get('A')).y;
    assert.ok(isNum(y));
    d.expectClean();
    await d.ctx.close();
    assert.equal(answer, 'ok', `the designer did not answer for ${ms} ms after Y = ${y}`);
  },
);

test('regression: a negative font size or line height is stored without a message (the render then draws mirrored text above its box)', async () => {
  // render() of fontSize -4: a text run of size -4 and width -9.6 whose baseline is above the box; lineHeight -2: baseline above the clip
  const d = await env.open(report([tb('A', 50, 50, 100, 40)]));
  await select(d, 'A');
  await prop(d, 'fontSize').locator('input').fill('-4');
  await prop(d, 'lineHeight').locator('input').fill('-2');
  const st = (await d.get('A')).style || {};
  const flagged = (await insp(d).locator('.err').count()) + (await d.page.getByTestId('issues').count());
  const bad = ['fontSize', 'lineHeight'].filter((k) => typeof st[k] === 'number' && st[k] < 0);
  assert.ok(!bad.length || flagged > 0, `stored without a message: ${bad.map((k) => `${k}=${st[k]}`).join(', ')}`);
  d.expectClean();
});

test('bad colour and format strings are stored as typed and break neither the canvas nor the save check', async () => {
  // the Inspector shows no message for them (render() warns about an unknown colour name; "#12" and "zzz" pass)
  const d = await env.open(report([tb('A', 50, 50, 100, 40, { value: '=1234.5' })]));
  await select(d, 'A');
  await prop(d, 'color').locator('input.input').fill('notacolor');
  await prop(d, 'backgroundColor').locator('input.input').fill('#12');
  await prop(d, 'format').locator('input').fill('{0:');
  await prop(d, 'padding').locator('input').fill('abc');
  await prop(d, 'border').locator('input').fill('zzz');
  const a = await d.get('A');
  assert.deepEqual(
    [a.style.color, a.style.backgroundColor, a.style.format, a.style.padding, a.style.border],
    ['notacolor', '#12', '{0:', 'abc', 'zzz'],
  );
  // the colour picker falls back to black for a value it cannot show
  assert.equal(await prop(d, 'color').locator('input[type=color]').inputValue(), '#000000');
  assert.ok(await d.item('A').isVisible());
  assert.equal(await d.page.getByTestId('issues').count(), 0, 'no save error for style text');
  await d.page.evaluate(() => window.h.save());
  assert.equal(await d.page.evaluate(() => window.__saved.length), 1);
  d.expectClean();
});

test('an expression with a syntax error: the field says so, the Issues list names the item, a click there selects it', async () => {
  const d = await env.open(report([tb('A', 50, 50, 100, 40), tb('B', 50, 150, 100, 40)]));
  await select(d, 'A');
  await ctl(d, 'Value').fill('=Sum(Fields.amount');
  const f = field(d, 'Value');
  await f.locator('.err').waitFor();
  assert.equal(await f.locator('input').getAttribute('aria-invalid'), 'true');
  await ctl(d, 'Hidden').fill('=1 +* 2');
  await field(d, 'Hidden').locator('.err').waitFor();
  await select(d, 'B');
  await d.page.getByTestId('issues').click();
  const items = d.page.getByTestId('issues-list').locator('li');
  const lines = await items.allInnerTexts();
  const i = lines.findIndex((l) => /^A\b/.test(l));
  assert.ok(i >= 0, lines.join('\n'));
  await items.nth(i).locator('button').click();
  assert.deepEqual(await d.selected(), ['A']);
  // fixing it clears the message
  await ctl(d, 'Value').fill('=Sum(Fields.amount)');
  await ctl(d, 'Hidden').fill('');
  assert.equal(await field(d, 'Value').locator('.err').count(), 0);
  await until(async () => (await d.page.getByTestId('issues-none').count()) === 1);
  d.expectClean();
});

const withData = (items) =>
  report(items, {
    dataSources: [
      {
        name: 'src',
        type: 'json',
        data: [
          { id: 1, region: 'North', amount: 10 },
          { id: 2, region: 'South', amount: -4 },
        ],
      },
    ],
    dataSets: [
      {
        name: 'Sales',
        source: 'src',
        path: '$',
        fields: [
          { name: 'id', type: 'number' },
          { name: 'region', type: 'string' },
          { name: 'amount', type: 'number' },
        ],
      },
    ],
  });

test('an unknown field in an expression: a warning under the field with a suggestion', async () => {
  const d = await env.open(withData([tb('A', 50, 50, 100, 40, { value: '=Fields.amont' })]));
  await select(d, 'A');
  const w = field(d, 'Value').locator('[data-testid="field-warning"]');
  await w.waitFor();
  assert.match(await w.innerText(), /amont.*amount/);
  await ctl(d, 'Value').fill('=Fields.amount');
  assert.equal(await field(d, 'Value').locator('[data-testid="field-warning"]').count(), 0);
  d.expectClean();
});

test('expression editor: insert a field, see a syntax error and an unknown field, Apply writes, Cancel and Escape keep', async () => {
  const d = await env.open(withData([tb('A', 50, 50, 100, 40, { value: '' })]));
  await select(d, 'A');
  await field(d, 'Value').locator('button.fx').click();
  const dlg = d.page.getByRole('dialog');
  await dlg.waitFor();
  const code = dlg.getByTestId('expr-code').locator('.cm-content');
  await dlg.locator('.xlist button', { hasText: /^amount$/ }).click();
  await until(async () => (await code.innerText()).includes('=Fields.amount'));
  await code.click();
  await d.page.keyboard.press('End');
  await d.page.keyboard.type(' +');
  await dlg.locator('.err').waitFor();
  assert.equal(await dlg.getByRole('button', { name: 'Apply' }).isDisabled(), true, 'Apply is off for a syntax error');
  await d.page.keyboard.type(' Fields.amont');
  await dlg.getByTestId('expr-issues').waitFor();
  assert.ok(
    await until(async () => /"amont"/.test(await dlg.getByTestId('expr-issues').innerText())),
    await dlg.getByTestId('expr-issues').innerText(),
  );
  assert.equal(
    await dlg.getByRole('button', { name: 'Apply' }).isDisabled(),
    false,
    'an unknown field warns, it does not block',
  );
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await dlg.waitFor({ state: 'detached' });
  assert.equal((await d.get('A')).value, '=Fields.amount + Fields.amont');
  // Cancel keeps the value
  await field(d, 'Value').locator('button.fx').click();
  await d.page.getByRole('dialog').waitFor();
  await d.page.keyboard.type('xyz');
  await d.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await d.get('A')).value, '=Fields.amount + Fields.amont');
  // Escape keeps it too
  await field(d, 'Value').locator('button.fx').click();
  await d.page.getByRole('dialog').waitFor();
  await d.page.keyboard.type('xyz');
  await d.page.keyboard.press('Escape'); // closes the suggestions, if any
  if (await d.page.getByRole('dialog').count()) await d.page.keyboard.press('Escape');
  await until(async () => (await d.page.getByRole('dialog').count()) === 0);
  assert.equal((await d.get('A')).value, '=Fields.amount + Fields.amont');
  d.expectClean();
});

test('conditional formatting: a rule needs a value, Apply writes the rule and its style expression, the button counts rules', async () => {
  const d = await env.open(withData([tb('A', 50, 50, 100, 40, { value: '=Fields.amount', dataSet: 'Sales' })]));
  await select(d, 'A');
  await insp(d).getByTestId('cf-open').click();
  const dlg = d.page.getByRole('dialog');
  await dlg.waitFor();
  const apply = dlg.getByTestId('cf-apply');
  assert.equal(await apply.isDisabled(), true, 'no value yet');
  await dlg.getByTestId('cf-rule-0').getByLabel('Value').fill('0');
  assert.equal(await apply.isDisabled(), false);
  await apply.click();
  await dlg.waitFor({ state: 'detached' });
  const a = await d.get('A');
  assert.equal(a.cf.rules.length, 1);
  assert.match(String(a.style?.color), /^=/, 'the colour is an expression');
  assert.match(await insp(d).getByTestId('cf-open').innerText(), /1/);
  // removing the only rule takes the expression away again
  await insp(d).getByTestId('cf-open').click();
  await d.page
    .getByRole('dialog')
    .getByTestId('cf-rule-0')
    .getByRole('button', { name: /Remove/i })
    .click();
  await d.page.getByRole('dialog').getByTestId('cf-apply').click();
  const b = await d.get('A');
  assert.ok(!b.cf, 'no rules left');
  assert.ok(!String(b.style?.color || '').startsWith('='), `colour ${b.style?.color}`);
  d.expectClean();
});

/* ------------------------------------------------------------------ several items */

test('several items selected: the Inspector offers align, size and distribute for all of them, no common property fields', async () => {
  const d = await env.open(report([tb('A', 10, 10, 80, 20), tb('B', 150, 60, 120, 30), tb('C', 300, 120, 60, 20)]));
  await select(d, 'A');
  await select(d, 'B', ['Shift']);
  await select(d, 'C', ['Shift']);
  assert.deepEqual((await d.selected()).sort(), ['A', 'B', 'C']);
  assert.match(await insp(d).locator('.insp-head').innerText(), /3 items/);
  // not in the product: editing one style property for all selected items (only alignment tools are offered)
  assert.equal(await prop(d, 'fontSize').count(), 0);
  await insp(d).getByRole('button', { name: 'Left', exact: true }).click();
  let def = await d.def();
  assert.deepEqual(
    ['A', 'B', 'C'].map((n) => Designer.find(def, n).x),
    [10, 10, 10],
  );
  await insp(d).getByRole('button', { name: 'Same width' }).click();
  def = await d.def();
  assert.deepEqual(
    ['A', 'B', 'C'].map((n) => Designer.find(def, n).w),
    [120, 120, 120],
  );
  await insp(d).getByRole('button', { name: 'Vertically' }).click();
  def = await d.def();
  const ys = ['A', 'B', 'C'].map((n) => Designer.find(def, n)).sort((p, q) => p.y - q.y);
  assert.equal(Math.round(ys[1].y - (ys[0].y + ys[0].h)), Math.round(ys[2].y - (ys[1].y + ys[1].h)), 'equal gaps');
  assertSaneGeometry(def);
  d.expectClean();
});

/* ------------------------------------------------------------------ the find box */

test('find a property: only the matching fields, a message for no match, everything back when cleared', async () => {
  const d = await env.open(report([tb('A', 10, 10, 80, 20)]));
  await select(d, 'A');
  const find = insp(d).getByTestId('find-property');
  const all = await insp(d).locator('label.field, label.check').count();
  await find.fill('rotate');
  const shown = await insp(d).locator('label.field > span').allInnerTexts();
  assert.deepEqual(shown, ['Rotate (degrees clockwise)']);
  await ctl(d, 'Rotate (degrees clockwise)').fill('90');
  assert.equal((await d.get('A')).rotate, 90, 'a found field edits as usual');
  await find.fill('BACKGROUND'); // case does not matter; style keys match too
  const bg = await insp(d)
    .locator('[data-prop]')
    .evaluateAll((es) => es.map((e) => e.dataset.prop));
  assert.deepEqual(bg.sort(), ['backgroundColor', 'backgroundFit', 'backgroundImage']);
  await find.fill('zzzz');
  await insp(d).getByText('No property matches.').waitFor();
  await find.fill('');
  assert.equal(await insp(d).locator('label.field, label.check').count(), all);
  // a new selection starts with an empty find box
  await find.fill('rotate');
  await d.focusCanvas();
  await select(d, 'A');
  assert.equal(await insp(d).getByTestId('find-property').inputValue(), '');
  d.expectClean();
});

test('find a property on a table: "drill" shows the groups editor, "sort" the sort and filters', async () => {
  const def = withData([
    {
      type: 'table',
      name: 'T',
      x: 0,
      y: 0,
      w: 200,
      h: 54,
      dataSet: 'Sales',
      columns: [{ width: 100 }, { width: 100 }],
      header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount' }] }],
      detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }] }],
      footer: [],
    },
  ]);
  const e = await env.open(def);
  await pick(e, 'T');
  await insp(e).getByTestId('find-property').fill('drill');
  await insp(e).getByTestId('group-add').waitFor();
  await insp(e).getByTestId('find-property').fill('sort');
  await insp(e).getByTestId('sort-filter').waitFor();
  await insp(e).getByTestId('sort-filter').getByLabel('Sort by').selectOption('amount');
  assert.deepEqual(Designer.find(await e.def(), 'T').sort, [{ by: '=Fields.amount', dir: 'asc' }]);
  e.expectClean();
});

/* ------------------------------------------------------------------ the name */

test('renaming an item: bad characters and a taken name show a message and are not stored', async () => {
  const d = await env.open(report([tb('A', 10, 10, 80, 20), tb('B', 10, 60, 80, 20)]));
  await select(d, 'A');
  const name = insp(d).getByLabel('Item name');
  await name.fill('1 bad');
  await insp(d).locator('.insp-head .err').waitFor();
  await name.fill('B');
  assert.match(await insp(d).locator('.insp-head .err').innerText(), /in use/);
  let def = await d.def();
  assert.ok(Designer.find(def, 'A') && Designer.find(def, 'B'), 'still A and B');
  await name.fill('Total_1');
  assert.equal(await insp(d).locator('.insp-head .err').count(), 0);
  def = await d.def();
  assert.ok(Designer.find(def, 'Total_1'));
  d.expectClean();
});

/* ------------------------------------------------------------------ save and reopen */

test('values set in the Inspector are the same after save and reopening the saved report', async () => {
  const d = await env.open(
    withData([tb('A', 20, 20, 120, 30), { type: 'line', name: 'L', x: 0, y: 80, w: 200, h: 0 }]),
  );
  await select(d, 'A');
  await ctl(d, 'X (pt)').fill('33.5');
  await ctl(d, 'Value').fill('=Sum(Fields.amount, "Sales")');
  await ctl(d, 'Data set').selectOption('Sales');
  await prop(d, 'fontSize').locator('input').fill('11');
  await prop(d, 'color').locator('input.input').fill('#aa0000');
  await prop(d, 'format').locator('input').fill('C2');
  await ctl(d, 'Hidden').fill('=Fields.amount < 0');
  await ctl(d, 'Action on click').selectOption('bookmark');
  await field(d, 'Jump to bookmark').locator('input').fill('="top"');
  await ctl(d, 'Bookmark (document map)').fill('=Fields.region');
  await d.page.evaluate(() => window.h.save());
  const saved = await d.page.evaluate(() => window.__saved[0]);
  assert.ok(saved, 'onSave got the definition');
  const was = await d.def();
  assert.deepEqual(saved, was);
  const e = await env.open(saved);
  assert.deepEqual(await e.def(), saved, 'reopened as saved');
  await select(e, 'A');
  assert.equal(await ctl(e, 'X (pt)').inputValue(), '33.5');
  assert.equal(await ctl(e, 'Value').inputValue(), '=Sum(Fields.amount, "Sales")');
  assert.equal(await ctl(e, 'Data set').inputValue(), 'Sales');
  assert.equal(await prop(e, 'fontSize').locator('input').inputValue(), '11');
  assert.equal(await prop(e, 'color').locator('input.input').inputValue(), '#aa0000');
  assert.equal(await prop(e, 'format').locator('input').inputValue(), 'C2');
  assert.equal(await ctl(e, 'Action on click').inputValue(), 'bookmark');
  assert.equal(await e.dirty(), false);
  d.expectClean();
  e.expectClean();
});
