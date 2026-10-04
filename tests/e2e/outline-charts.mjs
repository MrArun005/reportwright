// Batch 1: the outline's drag and drop and keyboard moves, and the new chart options (outside pie labels, overlays in
// the legend, gauge shapes and indicators) in the designer, the viewer and the PDF.
//   BASE=http://localhost:3800 node tests/e2e/outline-charts.mjs
// Screenshots go to /tmp/shots/b1-*.png and the PDF to /tmp/shots/b1-charts.pdf. The report it makes is deleted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const rows = [
  { region: 'North America', amount: 420, month: 'Jan' }, { region: 'Europe', amount: 310, month: 'Feb' }, { region: 'Asia Pacific', amount: 280, month: 'Mar' },
  { region: 'Latin America', amount: 60, month: 'Apr' }, { region: 'Middle East', amount: 25, month: 'May' }, { region: 'Africa', amount: 12, month: 'Jun' },
];
const chart = (name, x, y, extra) => ({ type: 'chart', name, x, y, w: 250, h: 170, dataSet: 'Sales', category: '=Fields.region', series: [{ name: 'Amount', value: '=Sum(Fields.amount)' }], legend: 'bottom', ...extra });
const definition = {
  $schema: 'pagewright/report@1', name: 'e2e outline and charts', page: { size: 'A4', orientation: 'landscape', margins: [24, 24, 24, 24] },
  dataSources: [{ name: 'src', type: 'json', data: { rows } }],
  dataSets: [{ name: 'Sales', source: 'src', path: '$.rows[*]', fields: [{ name: 'region', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'month', type: 'string' }] }],
  sections: { body: { height: 420, items: [
    { type: 'textbox', name: 'Alpha', x: 0, y: 0, w: 120, h: 18, value: 'Alpha' },
    { type: 'container', name: 'Box', x: 140, y: 0, w: 200, h: 50, items: [{ type: 'textbox', name: 'Kid', x: 4, y: 4, w: 80, h: 18, value: 'Kid' }] },
    { type: 'list', name: 'Rows', x: 360, y: 0, w: 200, h: 30, dataSet: 'Sales', items: [] },
    chart('Pie', 0, 60, { chartType: 'pie', legend: 'none' }),
    chart('Gauge', 260, 60, { chartType: 'gauge', category: undefined, axes: { y: { min: 0, max: 1200 } }, overlays: [{ type: 'band', from: 0, to: 600, color: '#fecaca' }, { type: 'band', from: 600, to: 1200, color: '#bbf7d0' }] }),
    chart('Trend', 520, 60, { chartType: 'column', category: '=Fields.month', overlays: [{ type: 'trend', label: 'Trend line' }, { type: 'line', value: 200, label: 'Target' }] }),
  ] } },
};
const ids = [];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const read = async (id) => { const r = await (await fetch(`${BASE}/api/reports/${id}`, { headers: H })).json(); return r.definition || r; };
const names = (list) => (list || []).map(i => i.name);
const field = (scope, text) => scope.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).locator('select, input, textarea').first();
try {
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: definition.name, definition }) });
  const { id } = await r.json();
  ids.push(id);
  await p.goto(`${BASE}/designer/${id}`);
  await p.waitForSelector('[data-testid=paper]');
  const outline = p.getByTestId('outline');
  // the outline may be a tab of the side panel
  if (!(await outline.isVisible().catch(() => false))) await p.getByRole('tab', { name: /outline/i }).click();
  await outline.waitFor();
  const row = (n) => outline.locator(`[data-outline="${n}"]`);

  step('outline: drag a row into a container (the middle of its row)');
  const boxBox = await row('Box').boundingBox();
  await row('Alpha').dragTo(row('Box'), { targetPosition: { x: boxBox.width / 2, y: boxBox.height / 2 } });
  await p.locator('[data-item=Box] [data-item=Alpha]').waitFor(); // the canvas draws it inside the container
  assert.equal(await outline.locator('li:has(> [data-outline=Box]) [data-outline=Alpha]').count(), 1, 'Alpha is under Box in the outline');
  await p.screenshot({ path: '/tmp/shots/b1-outline-into.png' });

  step('outline: drag a row before another (the top edge), across levels');
  await row('Kid').dragTo(row('Pie'), { targetPosition: { x: 20, y: 2 } });
  await p.waitForFunction(() => !document.querySelector('[data-item=Box] [data-item=Kid]'));

  step('outline: drag a row onto a band (to its end) and into a list');
  await row('Alpha').dragTo(outline.locator('[data-outline-band=body] > .outline-band'));
  await p.waitForFunction(() => !document.querySelector('[data-item=Box] [data-item=Alpha]'));
  const listBox = await row('Rows').boundingBox();
  await row('Kid').dragTo(row('Rows'), { targetPosition: { x: listBox.width / 2, y: listBox.height / 2 } });
  await p.locator('[data-item=Rows] [data-item=Kid]').waitFor();

  step('outline: a container cannot go into its own child (no drop marker, nothing moves)');
  const order = () => p.evaluate(() => [...document.querySelectorAll('[data-outline-band=body] > .tree > li > [data-outline]')].map(r => r.dataset.outline).join());
  const was = await order();
  await row('Rows').dragTo(row('Kid'), { targetPosition: { x: 20, y: 2 } });
  await p.waitForTimeout(300);
  assert.equal(await p.locator('[data-item=Rows] [data-item=Kid]').count(), 1);
  assert.equal(await order(), was, 'a refused drop on a row does not fall through to the band');

  step('outline: keyboard moves (Alt+arrows) on the focused name');
  const nm = (n) => row(n).locator('.nm');
  await nm('Kid').focus();
  await p.keyboard.press('Alt+ArrowLeft'); // out of the list
  await p.waitForFunction(() => !document.querySelector('[data-item=Rows] [data-item=Kid]'));
  await p.waitForFunction(() => document.activeElement?.closest('[data-outline]')?.dataset.outline === 'Kid'); // focus stays on the moved row
  await p.keyboard.press('Alt+ArrowUp'); // above the list: now right under Box
  await p.waitForFunction(() => [...document.querySelectorAll('[data-outline-band=body] > .tree > li > [data-outline]')].map(r => r.dataset.outline).slice(0, 3).join() === 'Box,Kid,Rows');
  // Alt+Right puts it into the container just above
  await p.keyboard.press('Alt+ArrowRight');
  await p.locator('[data-item=Box] [data-item=Kid]').waitFor();
  assert.match(await outline.locator('[role=status]').textContent(), /Kid .*Box/);
  // the buttons stay as the fallback
  await row('Kid').hover();
  await row('Kid').getByRole('button', { name: /Move out of Box/ }).click();
  await p.waitForFunction(() => !document.querySelector('[data-item=Box] [data-item=Kid]'));
  await p.keyboard.press('Control+s');
  await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  const saved = await read(id);
  assert.ok(names(saved.sections.body.items).includes('Kid') && names(saved.sections.body.items).includes('Alpha'));
  assert.deepEqual(names(saved.sections.body.items.find(i => i.name === 'Box').items), []);

  step('chart options: outside pie labels, gauge shape and pointer, overlay legend toggle');
  const insp = p.getByTestId('inspector');
  await p.locator('[data-item=Pie]').click({ position: { x: 20, y: 10 } });
  await field(insp, 'Label position').selectOption('outside');
  await p.waitForFunction(() => [...document.querySelectorAll('[data-item=Pie] .live svg path')].filter(x => x.getAttribute('fill') === 'none' || !x.getAttribute('fill')).length >= 5);
  await p.waitForFunction(() => [...document.querySelectorAll('[data-item=Pie] .live svg text')].some(t => /^North America: \d+%$/.test(t.textContent)));
  await p.locator('[data-item=Gauge]').click({ position: { x: 20, y: 10 } });
  await field(insp, 'Gauge shape').selectOption('full');
  await field(insp, 'Value shown by').selectOption('pointer');
  await field(insp, 'Needle or pointer colour').waitFor();
  await p.waitForFunction(() => document.querySelectorAll('[data-item=Gauge] .live svg ellipse').length === 0); // no needle hub with a pointer
  await p.locator('[data-item=Trend]').click({ position: { x: 20, y: 10 } });
  await p.waitForFunction(() => [...document.querySelectorAll('[data-item=Trend] .live svg text')].some(t => t.textContent === 'Trend line'));
  // legend keys of line overlays: short dashed lines, 11 pt wide (the trend's and the target's)
  const keys = () => p.evaluate(() => [...document.querySelectorAll('[data-item=Trend] .live svg line[stroke-dasharray]')].filter(l => Math.abs(Math.abs(l.getAttribute('x2') - l.getAttribute('x1')) - 11) < 0.1).length);
  assert.equal(await keys(), 2);
  await insp.getByTestId('overlay-0').getByLabel('Show in the legend').uncheck();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-item=Trend] .live svg line[stroke-dasharray]')].filter(l => Math.abs(Math.abs(l.getAttribute('x2') - l.getAttribute('x1')) - 11) < 0.1).length === 1);
  await insp.getByTestId('overlay-0').getByLabel('Show in the legend').check();
  await p.screenshot({ path: '/tmp/shots/b1-designer-charts.png' });
  await p.keyboard.press('Control+s');
  await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  const d2 = await read(id);
  const by = (n) => d2.sections.body.items.find(i => i.name === n);
  assert.equal(by('Pie').labelPosition, 'outside');
  assert.equal(by('Gauge').gaugeShape, 'full');
  assert.equal(by('Gauge').gaugeIndicator, 'pointer');
  assert.equal(by('Trend').overlays[0].legend, undefined);

  step('viewer draws them');
  await p.goto(`${BASE}/viewer/${id}`);
  await p.waitForSelector('.vpage svg text', { timeout: 30000 });
  const texts = await p.locator('.vpage svg text').allTextContents();
  for (const s of ['North America: 38%', 'Trend line', 'Target', '0']) assert.ok(texts.includes(s), `viewer shows ${s}`);
  await p.locator('.vpage').first().screenshot({ path: '/tmp/shots/b1-viewer-charts.png' });

  step('the PDF');
  const res = await p.request.get(`${BASE}/api/reports/${id}/pdf`);
  assert.equal(res.status(), 200);
  const pdf = await res.body();
  assert.ok(pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 5000, 'a PDF');
  fs.writeFileSync('/tmp/shots/b1-charts.pdf', pdf);

  assert.deepEqual(errs, []);
  console.log('PASS outline and charts');
} finally {
  await b.close();
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
}
