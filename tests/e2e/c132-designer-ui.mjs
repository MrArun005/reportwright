// 0.13.2 UI review of 0.13.1, in the EMBEDDED designer and viewer (shadow roots): P1 #1 an unchecked check box has no
// tick on the canvas; P1 #2 selecting an item does not move the canvas (the toolbar has one fixed height, its hint is in
// the status bar); P1 #3 Arrow / Shift+Arrow nudge by exact steps; P1 #4 the viewer's showWarnings option and its count;
// P1 #5 the Data panel lists fields detected from inline JSON; P2 the Export options icon, no cut-off text in the
// Regional select and the Outline, the Parameters help that matches the viewer, ⓘ tooltips that open and close by
// keyboard; axe (critical and serious) with a tooltip and the parameter dialog open.
// Run node scripts/build-embed.mjs first (it serves public/embed/esm). No server needed.
// SHOTS=<dir> also writes screenshots there.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://c132.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const SHOTS = process.env.SHOTS;
let AXE = null;
try { AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* not installed: the axe step is skipped */ }

const rows = Array.from({ length: 300 }, (_, i) => ({ id: i, region: i % 2 ? 'N' : 'S', amount: i * 1.5 }));
const LONG = 'AVeryLongTextboxNameThatKeepsGoingAndGoingForeverAndEver';
const definition = {
  $schema: 'pagewright/report@1', name: 'C132', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: rows }],
  // D declares no fields: the Data panel detects them. D2 declares one the rows lack: the Preview has 1 warning
  dataSets: [{ name: 'D', source: 'src' }, { name: 'D2', source: 'src', fields: [{ name: 'id', type: 'number' }, { name: 'ghost', type: 'string' }] }],
  sections: { body: { height: 300, items: [
    { type: 'textbox', name: 'T1', x: 0, y: 10, w: 120, h: 20, value: 'Hello' },
    { type: 'checkbox', name: 'CbOff', x: 10, y: 50, w: 120, h: 14, value: false, text: 'Off' },
    { type: 'checkbox', name: 'CbOn', x: 10, y: 70, w: 120, h: 14, value: true, text: 'On' },
    { type: 'checkbox', name: 'CbExpr', x: 10, y: 90, w: 120, h: 14, value: '=False', text: 'Expr off' },
    { type: 'textbox', name: LONG, x: 10, y: 120, w: 120, h: 20, value: 'x' },
    { type: 'table', name: 'Tb', x: 0, y: 160, w: 200, h: 18, dataSet: 'D2', columns: [{ width: 200 }], detail: [{ height: 18, cells: [{ value: '=Fields.id' }] }] },
  ] } },
};
// the viewer: one data set that declares a field the rows lack (1 warning), a second one too (2 warnings)
const viewerDef = (n) => ({
  $schema: 'pagewright/report@1', name: 'W', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: rows.slice(0, 3) }],
  dataSets: Array.from({ length: n }, (_, i) => ({ name: `S${i}`, source: 'src', fields: [{ name: 'id', type: 'number' }, { name: `ghost${i}`, type: 'string' }] })),
  sections: { body: { height: 40, items: Array.from({ length: n }, (_, i) => ({ type: 'table', name: `Tb${i}`, x: 0, y: i * 20, w: 200, h: 18, dataSet: `S${i}`, columns: [{ width: 200 }],
    detail: [{ height: 18, cells: [{ value: '=Fields.id' }] }] })) } },
});
const designerApp = `import { mountDesigner } from '/pw/designer.js';
window.h = mountDesigner('#d', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px', onSave: () => {} });`;
const viewerApp = (opts) => `import { mountViewer } from '/pw/viewer.js';
mountViewer('#d', { fontsUrl: '/pw-fonts/', height: '500px', ...${JSON.stringify(opts)} });`;
const page0 = '<!doctype html><html lang="en"><meta charset="utf-8"><title>c132</title><body style="margin:0"><div id="d"></div><script type="module" src="/app.js"></script>';

const browser = await chromium.launch();
const step = (s) => console.log(`- ${s}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); // 1280: the width where the toolbar used to wrap
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let app = designerApp;
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: page0, contentType: 'text/html' });
    if (u.pathname === '/app.js') return route.fulfill({ body: app, contentType: 'text/javascript' });
    const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
    const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.locator('#d input[aria-label="Report name"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  const def = () => page.evaluate(() => window.h.getDefinition());
  const item = (d, n) => d.sections.body.items.find(i => i.name === n);
  const active = () => page.evaluate(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a ? { cls: a.className, label: a.getAttribute('aria-label'), text: a.textContent, describedby: a.getAttribute('aria-describedby') } : null; });
  const shot = (loc, name) => (SHOTS ? loc.screenshot({ path: path.join(SHOTS, name) }) : null);

  step('P1 #1: an unchecked check box is drawn without a tick; a checked one with it');
  const box = (n) => page.locator(`#d [data-item="${n}"] [data-checked]`);
  assert.deepEqual([await box('CbOff').getAttribute('data-checked'), await box('CbOff').textContent()], ['false', '']);
  assert.deepEqual([await box('CbOn').getAttribute('data-checked'), await box('CbOn').textContent()], ['true', '✓']);
  assert.deepEqual([await box('CbExpr').getAttribute('data-checked'), await box('CbExpr').textContent()], ['false', ''], '=False is unchecked too');
  // the pixels: inside the box's border, no dark ink (the tick is #1f2328)
  const ink = async (n) => {
    const png = await box(n).screenshot();
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(3, 3, img.width - 6, img.height - 6).data; // 3 px in: the border left out
      let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) dark++;
      return dark;
    }, png.toString('base64'));
  };
  assert.equal(await ink('CbOff'), 0, 'no tick pixels in the unchecked box');
  assert.ok(await ink('CbOn') > 3, 'tick pixels in the checked box');
  await shot(page.locator('#d [data-item="CbOff"]'), 'p1-1-checkbox-after.png');

  step('P1 #2: selecting an item leaves the canvas where it was; the toolbar keeps its height; the hint is in the status bar');
  const layout = () => page.evaluate(() => {
    const r = document.querySelector('#d').shadowRoot, top = r.querySelector('.designer').getBoundingClientRect().top;
    return { paper: r.querySelector('[data-testid=paper]').getBoundingClientRect().top - top, cbar: r.querySelector('.cbar').getBoundingClientRect().height };
  });
  const before = await layout();
  await page.locator('#d [data-item="T1"]').click({ position: { x: 5, y: 5 } });
  await page.locator('#d [data-testid=align-bar]').waitFor();
  const after = await layout();
  assert.deepEqual(after, before, 'paper y and toolbar height unchanged by the selection');
  assert.equal(before.cbar, 40);
  assert.equal(await page.locator('#d .cbar').getByText(/Shift\+click/).count(), 0, 'the hint is not in the toolbar');
  assert.match(await page.locator('#d .dstatus .dstatus-hint').textContent(), /Shift\+click/);
  await shot(page.locator('#d .dcenter'), 'p1-2-selected-after.png');

  step('P1 #3: Arrow 1 grid step, Shift+Arrow 10 with Snap to grid; 1 pt and 10 pt without');
  const pos = async () => { const t = item(await def(), 'T1'); return [t.x, t.y]; };
  const [x0, y0] = await pos();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await pos(), [x0 + 4, y0], 'Arrow: one 4 pt grid step');
  await page.keyboard.press('Shift+ArrowRight');
  assert.deepEqual(await pos(), [x0 + 44, y0], 'Shift+Arrow: ten grid steps');
  await page.locator('#d .cbar input[type=checkbox]').first().uncheck(); // Snap to grid off
  await page.locator('#d [data-item="T1"]').click({ position: { x: 5, y: 5 } }); // the keyboard back on the canvas
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await pos(), [x0 + 44, y0 + 1], 'Arrow: 1 pt');
  await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(await pos(), [x0 + 44, y0 + 11], 'Shift+Arrow: 10 pt');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await pos(), [x0 + 34, y0 + 10]);
  for (const v of await pos()) assert.equal(Math.round(v * 100) / 100, v, 'stored to 2 decimals');

  step('P1 #5: the Data panel lists the fields detected from the inline JSON, marked as detected');
  await page.locator('#d [data-testid=rail-data]').click();
  const fields = page.locator('#d [data-testid=fields-D] [data-field]');
  await fields.first().waitFor();
  assert.deepEqual(await fields.evaluateAll(l => l.map(e => [e.dataset.field, e.hasAttribute('data-detected'), e.querySelector('.ty').textContent])),
    [['id', true, 'number · detected'], ['region', true, 'string · detected'], ['amount', true, 'number · detected']]);
  assert.match(await page.locator('#d [data-testid=detected-D]').textContent(), /detected from the data, not declared/);
  assert.equal(await page.locator('#d [data-testid=fields-D]').getByText('No fields').count(), 0);

  step('P2: no cut-off text in the Outline (long names wrap, full name in a title)');
  await page.locator('#d [data-testid=rail-outline]').click();
  await page.waitForTimeout(400);
  const outline = await page.locator('#d [data-outline]').evaluateAll(l => l.map(r => {
    const nm = r.querySelector('[data-opt]');
    return { name: r.dataset.outline, row: [r.scrollWidth, r.clientWidth], nm: [nm.scrollWidth, nm.clientWidth], title: nm.title, lines: Math.round(nm.getBoundingClientRect().height / parseFloat(getComputedStyle(nm).lineHeight || '16')) };
  }));
  for (const o of outline) {
    assert.ok(o.row[0] <= o.row[1], `${o.name}: the row does not overflow (${o.row})`);
    assert.ok(o.nm[0] <= o.nm[1], `${o.name}: the name is not cut (${o.nm})`);
    assert.equal(o.title, o.name);
  }
  for (const n of ['CbOff', 'CbOn', 'T1']) assert.equal(outline.find(o => o.name === n).lines, 1, `${n} on one line`);
  await shot(page.locator('#d [data-rail=outline]'), 'p2-outline-after.png');

  step('P2: ⓘ tooltips open and close by keyboard (Esc closes the tip only: the selection stays)');
  await page.locator('#d [data-outline="CbOn"] [data-opt]').click();
  const tipBtn = page.locator('#d [data-testid=outline] h4 .infotip-btn');
  const tipText = async () => page.locator(`#d [id="${await tipBtn.getAttribute('aria-describedby')}"]`);
  await page.locator('#d [data-testid=rail-outline]').focus();
  let n = 0;
  const want = await tipBtn.getAttribute('aria-describedby');
  for (; n < 200 && (await active())?.describedby !== want; n++) await page.keyboard.press('Tab');
  assert.equal((await active())?.label, 'More information', `the Outline's ⓘ button is reached by Tab (${n} presses)`);
  console.log(`  the Outline's ⓘ reached after ${n} Tab presses from the rail tab`);
  const tip = await tipText();
  assert.equal(await tip.getAttribute('role'), 'tooltip');
  assert.equal(await tip.isVisible(), true, 'focus opens it');
  assert.match(await tip.textContent(), /Click a name to select it.*Alt\+/);
  await page.keyboard.press('Escape');
  assert.equal(await tip.isVisible(), false, 'Esc closes it');
  assert.equal(await page.locator('#d [data-outline="CbOn"] [data-opt]').getAttribute('aria-pressed'), 'true', 'Esc did not reach the designer');
  await page.keyboard.press('Enter');
  assert.equal(await tip.isVisible(), true, 'Enter opens it again');
  await page.keyboard.press('Enter');
  assert.equal(await tip.isVisible(), false, 'and closes it');
  await page.keyboard.press('Escape'); // closed: Esc is the designer's again (back to the report)
  assert.equal(await page.locator('#d [data-outline="CbOn"] [data-opt]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#d [data-outline="CbOn"] [data-opt]').getAttribute('aria-describedby'), 'outline-nav outline-keys', 'the rows keep their keyboard help');
  assert.match(await page.locator('#d [id="outline-keys"]').textContent(), /Alt\+/);

  step('P2: the Regional "Division by zero" choice is not cut off');
  await page.keyboard.press('Escape');
  const nonFinite = page.locator('#d [data-testid=inspector] select').filter({ has: page.locator('option', { hasText: 'Infinity' }) });
  const fit = await nonFinite.evaluate(e => {
    const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(e);
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return { text: c.measureText(e.selectedOptions[0].text).width, room: e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20, sw: e.scrollWidth, cw: e.clientWidth }; // 20: the arrow
  });
  assert.ok(fit.text <= fit.room, `"Infinity (as SSRS)" fits: ${JSON.stringify(fit)}`);
  assert.ok(fit.sw <= fit.cw);
  await nonFinite.evaluate(e => e.closest('.cat').scrollIntoView());
  await shot(nonFinite.locator('xpath=ancestor::div[contains(@class,"cat")]'), 'p2-regional-after.png');

  step('P2: the Parameters help says what the viewer does; long help behind ⓘ; Esc closes the tip, then the dialog');
  await page.locator('#d [data-testid=rail-data]').click();
  await page.locator('#d .pane', { hasText: 'Parameters' }).first().getByRole('button', { name: '+ Add' }).click();
  const dlg = page.locator('#d [role=dialog]');
  await dlg.waitFor();
  assert.equal(await dlg.getByText('Apply parameters as the reader changes them (off: only when the reader clicks View report)').count(), 1);
  assert.equal(await dlg.getByText('off: a View report button').count(), 0, 'the old text (the button is always there) is gone');
  const longHints = await dlg.locator('.hint').evaluateAll(l => l.map(e => e.textContent.length).filter(x => x > 90));
  assert.deepEqual(longHints, [], 'no help paragraph over 90 characters left in the dialog');
  const tips = dlg.locator('.infotip-btn');
  assert.ok(await tips.count() >= 2, 'the cascade and panel-column help are ⓘ tips');
  const colTip = dlg.locator('.field-tip', { hasText: 'Parameter panel columns' }).locator('.infotip-btn');
  await colTip.focus();
  const colText = page.locator(`#d [id="${await colTip.getAttribute('aria-describedby')}"]`);
  assert.equal(await colText.isVisible(), true);
  assert.match(await colText.textContent(), /On a wide screen, more than one column puts the panel above the pages/);
  if (AXE) {
    await page.addScriptTag({ content: AXE });
    // (the Save button's ⌘S badge at 70% opacity fails color-contrast whenever the report is unsaved: older than 0.13.1, not this review's)
    const v = await page.evaluate(() => window.axe.run({ exclude: [[['#d', '.save-btn .kbd']]] }, { resultTypes: ['violations'] }));
    const bad = v.violations.filter(x => x.impact === 'critical' || x.impact === 'serious').map(x => `${x.id}: ${x.nodes.map(nd => nd.target.join(' > ')).slice(0, 3).join('; ')}`);
    assert.deepEqual(bad, [], 'axe: no critical or serious violation with the dialog and a tip open');
  } else console.log('  (axe-core not installed: axe step skipped)');
  await page.keyboard.press('Escape');
  assert.equal(await colText.isVisible(), false, 'Esc closes the tip');
  assert.equal(await dlg.isVisible(), true, '… and not the dialog');
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });

  step('P1 #4: the designer\'s Preview shows the warnings, counted in words');
  await page.locator('#d [data-testid=tab-preview]').click();
  const warnSummary = page.locator('#d [data-testid=viewer-warnings] > summary');
  await warnSummary.waitFor({ timeout: 30000 });
  assert.equal(await warnSummary.textContent(), '1 warning');

  step('P1 #4: the viewer hides warnings by default; showWarnings shows "1 warning" / "2 warnings"');
  for (const [opts, want] of [[{ definition: viewerDef(1) }, null], [{ definition: viewerDef(1), showWarnings: true }, '1 warning'], [{ definition: viewerDef(2), showWarnings: true }, '2 warnings']]) {
    app = viewerApp(opts);
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.querySelector('#d')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const s = page.locator('#d [data-testid=viewer-warnings] > summary');
    if (want == null) assert.equal(await s.count(), 0, 'no warnings shown without showWarnings');
    else assert.equal(await s.textContent(), want);
  }

  step('P2: the Export options button: a sliders icon, its name kept');
  const xo = page.locator('#d [data-testid=export-options]');
  assert.equal(await xo.getAttribute('aria-label'), 'Export options');
  assert.match(await xo.locator('path').getAttribute('d'), /^M2 4h6M11 4h3/, 'the sliders icon');
  await shot(xo, 'p2-export-options-after.png');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS c132 designer and viewer UI');
} finally {
  await browser.close();
}
