// b9 designer tickets in the EMBEDDED designer (a shadow root): the table cell menu acts (bug 1), Esc and Ctrl+S after
// clicks that leave the focus nowhere (bug 2), a number field dropped on a group header sums (bug 4), the matrix drill
// toggle starts closed (bug 7), the unsaved-changes guard (N34), keyboard selection through the outline and on the canvas
// (N35), paste from the paste event (N36), width min (N33), the fx label and row-tag contrast (A11Y-3).
// Run npm run build:packages first (it serves public/embed/esm). No server needed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://b9-designer.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const rows = [{ region: 'N', city: 'A', loans: 3 }, { region: 'N', city: 'B', loans: 4 }, { region: 'S', city: 'C', loans: 5 }];
const definition = {
  $schema: 'pagewright/report@1', name: 'B9', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: rows }],
  dataSets: [{ name: 'D', source: 'src', fields: [{ name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'loans', type: 'number' }] }],
  sections: { body: { height: 400, items: [
    { type: 'textbox', name: 'T1', x: 10, y: 10, w: 120, h: 20, value: 'Hello' },
    { type: 'table', name: 'Tab', x: 0, y: 60, w: 300, h: 72, dataSet: 'D', columns: [{ width: 150 }, { width: 150 }],
      groups: [{ name: 'Region', expr: '=Fields.region', header: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '' }] }], footer: [{ height: 18, cells: [{ value: '' }, { value: '' }] }] }],
      header: [{ height: 18, cells: [{ value: 'City' }, { value: 'Loans' }] }], detail: [{ height: 18, cells: [{ value: '=Fields.city' }, { value: '=Fields.loans' }] }] },
    { type: 'matrix', name: 'M', x: 0, y: 200, w: 300, h: 60, dataSet: 'D', rowGroups: [{ name: 'Region', expr: '=Fields.region' }, { name: 'City', expr: '=Fields.city' }], columnGroups: [], values: [{ value: '=Sum(Fields.loans)', format: 'N0' }] },
  ] } },
};
const app = `import { mountDesigner } from '/pw/designer.js';
window.saves = []; window.dirty = [];
window.h = mountDesigner('#d', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px',
  onSave: (d) => { window.saves.push(d); }, onDirtyChange: (v) => window.dirty.push(v) });`;

const browser = await chromium.launch();
const step = (s) => console.log(`- ${s}`);
try {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: '<!doctype html><html lang="en"><meta charset="utf-8"><title>b9</title><input id="host" aria-label="host field"><div id="d"></div><script type="module" src="/app.js"></script>', contentType: 'text/html' });
    if (u.pathname === '/app.js') return route.fulfill({ body: app, contentType: 'text/javascript' });
    const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
    const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/`);
  const reportName = page.locator('#d input[aria-label="Report name"]');
  await reportName.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  const def = () => page.evaluate(() => window.h.getDefinition());
  const item = (d, n) => d.sections.body.items.find(i => i.name === n);
  const leaveBlocked = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

  step('N34: clean at first; no leave guard');
  assert.equal(await page.evaluate(() => window.h.isDirty()), false);
  assert.equal(await leaveBlocked(), false, 'no guard while clean');

  step('A11Y-3: the fx button names itself with its text; the row tags have 4.5:1 ink');
  const fx = await page.locator('#d button.fx').first().getAttribute('aria-label').catch(() => null);
  if (fx) assert.match(fx, /^fx: /);
  assert.equal(await page.locator('#d .tbl .row-tag').first().evaluate(e => getComputedStyle(e).color), 'rgb(90, 102, 114)');

  step('bug 1: the table cell menu acts (a shadow root: e.target was the host)');
  const detailRows = async () => item(await def(), 'Tab').detail.length;
  const before = await detailRows();
  await page.locator('#d [data-cell="detail-0-0"]').click({ button: 'right' });
  await page.locator('#d [data-testid=cell-menu]').getByRole('menuitem', { name: 'Row below' }).click();
  assert.equal(await detailRows(), before + 1, 'Row below added a detail row');

  step('N34: an edit makes it dirty: onDirtyChange(true), the leave guard is on');
  assert.equal(await page.evaluate(() => window.h.isDirty()), true);
  assert.deepEqual(await page.evaluate(() => window.dirty), [true]);
  assert.equal(await leaveBlocked(), true, 'guard while dirty');

  step('bug 3: the band grew with the table');
  { const d = await def(); const t = item(d, 'Tab'); assert.ok(d.sections.body.height >= t.y + t.h); }

  step('bug 2: a band label click leaves the focus on <body>; Esc brings back the report, Ctrl+S saves');
  const selected = () => page.locator('#d [data-opt][aria-pressed=true]').evaluateAll(l => l.map(o => o.textContent));
  await page.locator('#d .band-label').nth(1).click();
  assert.deepEqual(await selected(), ['Body'], 'the band is selected');
  await page.evaluate(() => document.activeElement?.blur?.()); // as after a re-render that removed the focused element
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), [], 'Esc: the report again');
  await page.locator('#d [data-item="M"]').click({ position: { x: 5, y: 5 } }); // the matrix
  assert.deepEqual(await selected(), ['M']);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), [], 'Esc after the matrix: the report again');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.saves.length === 1, null, { timeout: 5000 });

  step('N34: saved: onDirtyChange(false), the guard is gone');
  assert.equal(await page.evaluate(() => window.h.isDirty()), false);
  assert.deepEqual(await page.evaluate(() => window.dirty), [true, false]);
  assert.equal(await leaveBlocked(), false);

  step('bug 2: keys typed in the host page are still not the designer\'s');
  await page.locator('#host').click();
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.saves.length), 1, 'Ctrl+S in the host page did not save');

  step('N35: the outline is reachable by Tab, a listbox with one Tab stop');
  await page.locator('#d [data-testid=rail-outline]').focus();
  let n = 0, onOption = false;
  for (; n < 160 && !onOption; n++) {
    await page.keyboard.press('Tab');
    onOption = await page.evaluate(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.hasAttribute('data-opt'); });
  }
  assert.ok(onOption, `an outline row is reached by Tab (${n} presses from the Outline tab)`);
  console.log(`  outline reached after ${n} Tab presses from the rail tab`);
  const opts = await page.locator('#d [data-opt]').evaluateAll(l => l.map(o => o.tabIndex));
  assert.equal(opts.filter(t => t === 0).length, 1, 'one Tab stop in the listbox');
  // the Outline tab itself moves the focus to the listbox
  await page.locator('#d [data-testid=rail-outline]').click();
  assert.equal(await page.evaluate(() => document.querySelector('#d').shadowRoot.activeElement?.hasAttribute('data-opt')), true);
  // arrows to T1's row, Enter selects it, Delete removes it
  for (let k = 0; k < 20; k++) {
    const name = await page.evaluate(() => document.querySelector('#d').shadowRoot.activeElement?.textContent);
    if (name === 'T1') break;
    await page.keyboard.press('ArrowDown');
  }
  assert.equal(await page.evaluate(() => document.querySelector('#d').shadowRoot.activeElement?.textContent), 'T1');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#d [data-outline="T1"] [data-opt]').getAttribute('aria-pressed'), 'true');
  const x0 = item(await def(), 'T1').x;
  await page.keyboard.press('ArrowRight'); // not a listbox key: moves the selection on the page
  assert.equal(item(await def(), 'T1').x, x0 + 4, 'ArrowRight nudged T1 one grid step (Snap to grid is on)');
  await page.keyboard.press('Delete');
  assert.equal(item(await def(), 'T1'), undefined, 'Delete removed T1');
  await page.keyboard.press('Control+z');
  assert.ok(item(await def(), 'T1'), 'undo brings it back');

  step('N35: canvas items are Tab stops with a name; Enter selects');
  const t1 = page.locator('#d [data-item="T1"]');
  assert.equal(await t1.getAttribute('tabindex'), '0');
  assert.match(await t1.getAttribute('aria-label'), /T1, x 1[04], y 10/);
  await page.keyboard.press('Escape');
  await t1.focus();
  await page.keyboard.press('Enter');
  await page.locator('#d [data-outline="T1"] [data-opt][aria-pressed=true]').waitFor({ timeout: 3000 });

  step('N33: width and height inputs have a minimum of 1');
  const minW = await page.locator('#d [data-testid=inspector] input[type=number][min]').evaluateAll(l => l.map(i => i.min));
  assert.ok(minW.includes('1'), `min=1 on the size inputs (${minW})`);

  step('N36: paste with nothing copied says so; a paste event with items pastes them (no permission)');
  const count = async () => (await def()).sections.body.items.length;
  const c0 = await count();
  const paste = (text) => t1.evaluate((el, text) => { const dt = new DataTransfer(); dt.setData('text/plain', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, composed: true, cancelable: true })); }, text);
  await paste('just text');
  await page.locator('#d .err', { hasText: 'Nothing to paste' }).waitFor({ timeout: 3000 });
  await paste(JSON.stringify({ kind: 'pagewright/items@1', items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 50, h: 12, value: 'p' }] }));
  assert.equal(await count(), c0 + 1, 'the paste event\'s items are pasted');

  step('N37: Ctrl+D offsets the copy by 12');
  await t1.click();
  await page.keyboard.press('Control+d');
  { const d = await def(); const a = item(d, 'T1'); const cp = d.sections.body.items[d.sections.body.items.length - 1]; assert.deepEqual([cp.x - a.x, cp.y - a.y], [12, 12]); }

  step('bug 4: a number field dropped on a group header cell sums');
  await page.locator('#d [data-cell="g0h-0-1"]').evaluate((el) => {
    const dt = new DataTransfer(); dt.setData('application/x-pw-field', JSON.stringify({ dataSet: 'D', field: 'loans', type: 'number' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
  });
  assert.equal(item(await def(), 'Tab').groups[0].header[0].cells[1].value, '=Sum(Fields.loans)');

  step('bug 7: the matrix drill-down toggle starts closed, as the table\'s');
  await page.locator('#d [data-outline="M"] [data-opt]').click();
  await page.locator('#d [data-testid=inspector]').getByLabel('Drill-down: show a toggle').first().check();
  assert.equal(item(await def(), 'M').rowGroups[0].initiallyCollapsed, true);

  step('N34: unmount removes the guard');
  assert.equal(await leaveBlocked(), true);
  await page.evaluate(() => window.h.unmount());
  assert.equal(await leaveBlocked(), false);

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS b9 designer (embedded)');
} finally {
  await browser.close();
}
