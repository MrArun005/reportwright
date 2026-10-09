// Batch 4: a body section's own page header and footer, a master's named placeholders, and the five new chart types,
// all set up in the designer, then checked in the viewer and the PDF.
//   BASE=http://localhost:3950 node tests/e2e/layout-charts-b4.mjs
// Screenshots go to /tmp/shots/b4-*.png and the PDF to /tmp/shots/b4-charts.pdf. The reports it makes are deleted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const tb = (name, value, x, y, w = 200) => ({ type: 'textbox', name, x, y, w, h: 16, value });
const rows = Array.from({ length: 40 }, (_, i) => ({
  task: `Task ${(i % 6) + 1}`, team: ['UX', 'Eng', 'QA'][i % 3], amount: ((i * 37) % 90) + 10, change: i % 4 === 1 ? -((i * 7) % 40) : (i * 13) % 50,
  // around the run date (the today line shows when today is inside or near the bars' range)
  start: `2026-${String(8 + (i % 3)).padStart(2, '0')}-${String(1 + (i % 20)).padStart(2, '0')}`, end: `2026-${String(9 + (i % 3)).padStart(2, '0')}-${String(1 + (i % 25)).padStart(2, '0')}`,
}));
const data = { dataSources: [{ name: 'src', type: 'json', data: { rows } }],
  dataSets: [{ name: 'Work', source: 'src', path: '$.rows[*]', fields: [{ name: 'task', type: 'string' }, { name: 'team', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'change', type: 'number' }, { name: 'start', type: 'date' }, { name: 'end', type: 'date' }] }] };
const sections = {
  $schema: 'reportwright/report@1', name: 'e2e b4 sections', page: { size: 'A4', margins: [36, 36, 36, 36] }, ...data,
  sections: {
    pageHeader: { height: 24, items: [tb('SharedHead', 'SHARED HEADER', 0, 0)] },
    body: [{ name: 'Cover', height: 200, items: [tb('Cover', 'Cover page', 0, 0)] }, { name: 'Data', height: 200, items: [tb('Data', 'Data page', 0, 0)] }],
    pageFooter: { height: 24, items: [tb('SharedFoot', 'SHARED FOOTER', 0, 4)] },
  },
};
const master = {
  $schema: 'reportwright/report@1', name: 'e2e b4 master', page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: { pageHeader: { height: 20, items: [tb('MHead', 'MASTER HEADER', 0, 0)] }, body: { height: 260, items: [
    tb('MTop', 'MASTER TOP', 0, 0),
    { type: 'placeholder', name: 'Main', x: 0, y: 30, w: 300, h: 120 },
    { type: 'placeholder', name: 'Side', x: 320, y: 30, w: 200, h: 120 },
  ] }, pageFooter: { height: 0, items: [] } },
};
const charts = {
  $schema: 'reportwright/report@1', name: 'e2e b4 charts', page: { size: 'A4', orientation: 'landscape', margins: [24, 24, 24, 24] }, ...data,
  sections: { body: { height: 520, items: [] } },
};

const ids = [];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const create = async (def) => { const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: def.name, definition: def }) }); const { id } = await r.json(); ids.push(id); return id; };
const read = async (id) => { const r = await (await fetch(`${BASE}/api/reports/${id}`, { headers: H })).json(); return r.definition || r; };
const field = (scope, text) => scope.locator('label.field').filter({ has: p.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).locator('select, input, textarea').first();
const save = async () => { await p.keyboard.press('Control+s'); await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor(); };
const viewerTexts = async (id) => {
  await p.goto(`${BASE}/viewer/${id}`);
  await p.waitForSelector('.vpage svg text', { timeout: 30000 });
  return p.locator('.vpage').evaluateAll(ps => ps.map(pg => [...pg.querySelectorAll('svg text')].map(t => t.textContent)));
};
try {
  step('a body section gets its own page header and no footer, from its Inspector');
  const sid = await create(sections);
  await p.goto(`${BASE}/designer/${sid}`);
  await p.waitForSelector('[data-testid=paper]');
  await p.locator('.band-label', { hasText: /^Data/ }).click();
  const insp = p.getByTestId('inspector');
  await insp.getByTestId('sec-header-mode').selectOption('own');
  await insp.getByTestId('sec-footer-mode').selectOption('none');
  await p.locator('[data-section="body:1:pageHeader"] [data-item]').first().waitFor(); // the band, a copy of the shared header
  await p.screenshot({ path: '/tmp/shots/b4-section-bands.png' });
  // the copy is the section's own: change its text in the Inspector
  await p.locator('[data-section="body:1:pageHeader"] [data-item]').first().click({ position: { x: 10, y: 6 } });
  await field(insp, 'Value').fill('DATA HEADER');
  await save();
  const sd = await read(sid);
  assert.equal(sd.sections.body[1].pageHeader.items[0].value, 'DATA HEADER');
  assert.deepEqual(sd.sections.body[1].pageFooter, { hidden: true });
  assert.notEqual(sd.sections.body[1].pageHeader.items[0].id, sd.sections.pageHeader.items[0].id);
  const vt = await viewerTexts(sid);
  assert.ok(vt[0].includes('SHARED HEADER') && vt[0].includes('SHARED FOOTER'), 'the cover keeps the shared bands');
  assert.ok(vt[1].includes('DATA HEADER') && !vt[1].includes('SHARED HEADER') && !vt[1].includes('SHARED FOOTER'), 'the data section has its own header and no footer');
  await p.locator('.vpage').nth(1).screenshot({ path: '/tmp/shots/b4-section-viewer.png' });

  step('a content report fills two placeholders of its master');
  const mid = await create(master);
  const cid = await create({ $schema: 'reportwright/report@1', name: 'e2e b4 content', master: mid, page: { size: 'A4' }, sections: { pageHeader: { height: 0, items: [] }, body: { height: 120, items: [tb('Main1', 'MAIN CONTENT', 0, 0)] }, pageFooter: { height: 0, items: [] } } });
  await p.goto(`${BASE}/designer/${cid}`);
  await p.waitForSelector('[data-testid=paper]');
  await p.getByTestId('fill-placeholder-Side').click();
  await p.locator('[data-section="content:0"]').waitFor();
  await p.dragAndDrop('[data-tool=textbox]', '[data-section="content:0"]', { targetPosition: { x: 20, y: 20 } });
  await p.locator('[data-section="content:0"] [data-item]').first().waitFor();
  await field(insp, 'Value').fill('SIDE CONTENT');
  await p.screenshot({ path: '/tmp/shots/b4-placeholders.png' });
  await save();
  const cd = await read(cid);
  assert.equal(cd.sections.content[0].placeholder, 'Side');
  assert.equal(cd.sections.content[0].items[0].value, 'SIDE CONTENT');
  const ct = (await viewerTexts(cid))[0];
  for (const s of ['MASTER HEADER', 'MASTER TOP', 'MAIN CONTENT', 'SIDE CONTENT']) assert.ok(ct.includes(s), `viewer shows ${s}`);
  await p.locator('.vpage').first().screenshot({ path: '/tmp/shots/b4-placeholders-viewer.png' });

  step('the five new chart types from the chart gallery and the Inspector');
  const kid = await create(charts);
  await p.goto(`${BASE}/designer/${kid}`);
  await p.waitForSelector('[data-testid=paper]');
  const spots = { gantt: 0, treemap: 300, histogram: 600, boxplot: 900, waterfall: 1200 }; // pt: each chart below the one before (a chart is 290 pt tall)
  for (const [type, y] of Object.entries(spots)) {
    await p.dragAndDrop('[data-tool=chart]', '[data-section=body]', { targetPosition: { x: 10, y: 10 } });
    const wiz = p.locator('.cw');
    await wiz.waitFor();
    await wiz.locator(`[data-chart-type=${type}]`).click();
    if (type === 'gantt') {
      await field(wiz, 'Task \\(one lane each\\)').selectOption('task');
      await wiz.getByTestId('cw-gantt-start').selectOption('start');
      await wiz.getByTestId('cw-gantt-end').selectOption('end');
    } else if (type === 'histogram' || type === 'boxplot') {
      await field(wiz, 'Value of each row').selectOption('amount');
      if (type === 'boxplot') await field(wiz, 'Category \\(x axis or slices\\)').selectOption('team');
    } else {
      await field(wiz, 'Category \\(x axis or slices\\)').selectOption(type === 'waterfall' ? 'task' : 'team');
      await field(wiz, 'Value').selectOption('Sum');
      await field(wiz, 'of field').selectOption(type === 'waterfall' ? 'change' : 'amount');
    }
    await wiz.getByTestId('chart-wizard-apply').click();
    await wiz.waitFor({ state: 'detached' });
    await field(insp, 'Y \\(pt\\)').fill(String(y)); // the new chart is selected: move it down
    await p.keyboard.press('Tab');
  }
  // the Inspector: the histogram's bin count, the Gantt's today line, a waterfall subtotal
  await p.waitForFunction(() => document.querySelectorAll('[data-item] .live svg').length >= 5, null, { timeout: 30000 });
  await save();
  const kd = await read(kid);
  const byType = Object.fromEntries(kd.sections.body.items.map(i => [i.chartType, i]));
  assert.deepEqual(Object.keys(byType).sort(), ['boxplot', 'gantt', 'histogram', 'treemap', 'waterfall']);
  assert.equal(byType.gantt.ganttStart, '=Fields.start');
  assert.equal(byType.histogram.series[0].value, '=Fields.amount');
  await p.locator(`[data-item="${byType.histogram.name}"]`).click({ position: { x: 20, y: 10 } });
  await field(insp, 'Number of bins \\(empty: automatic\\)').fill('6');
  await p.waitForFunction((n) => document.querySelectorAll(`[data-item="${n}"] .live svg rect`).length >= 6, byType.histogram.name);
  await p.locator(`[data-item="${byType.gantt.name}"]`).click({ position: { x: 20, y: 10 } });
  assert.equal(await insp.getByLabel('Today line').isChecked(), true);
  await p.locator(`[data-item="${byType.waterfall.name}"]`).click({ position: { x: 20, y: 10 } });
  await field(insp, 'Total bar label').fill('Net');
  await p.waitForFunction((n) => [...document.querySelectorAll(`[data-item="${n}"] .live svg text`)].some(t => t.textContent === 'Net'), byType.waterfall.name);
  await p.screenshot({ path: '/tmp/shots/b4-designer-charts.png' });
  await save();
  const kd2 = await read(kid);
  assert.equal(kd2.sections.body.items.find(i => i.chartType === 'histogram').binCount, 6);

  step('viewer and PDF draw them');
  const kt = (await viewerTexts(kid)).flat();
  for (const s of ['Task 1', 'UX', 'Net', 'Today']) assert.ok(kt.includes(s), `viewer shows ${s}`);
  const pages = await p.locator('.vpage').count();
  for (let i = 0; i < pages; i++) await p.locator('.vpage').nth(i).screenshot({ path: `/tmp/shots/b4-viewer-charts-${i + 1}.png` });
  const res = await p.request.get(`${BASE}/api/reports/${kid}/pdf`);
  assert.equal(res.status(), 200);
  const pdf = await res.body();
  assert.ok(pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 5000, 'a PDF');
  fs.writeFileSync('/tmp/shots/b4-charts.pdf', pdf);

  assert.deepEqual(errs, []);
  console.log('PASS layout and charts (batch 4)');
} finally {
  await b.close();
  for (const id of ids.reverse()) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
}
