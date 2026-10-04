// Phase B/C in the browser: dashboard template, map and form-field items, AI box, pageless + PDF/A on the server.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
const created = [];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

step('new dashboard from the home page');
await p.goto(BASE);
await p.getByLabel('New report name').fill('e2e dashboard');
await p.getByRole('button', { name: 'New dashboard' }).click();
await p.waitForURL(/\/designer\//);
const id = p.url().split('/designer/')[1];
created.push(id);
await p.waitForSelector('[data-testid=paper]');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
let t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('Total sales') && t.includes('Sales by month'), 'dashboard tiles and chart');

step('map and form field from the toolbox');
await p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Design' }).click();
await p.waitForSelector('[data-section=body]');
await p.dragAndDrop('[data-tool=map]', '[data-section=body]', { targetPosition: { x: 40, y: 500 } });
await p.dragAndDrop('[data-tool=field]', '[data-section=body]', { targetPosition: { x: 420, y: 500 } });
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('No shapes or points to draw'), 'map placeholder drawn');

step('server renders the pageless dashboard and PDF/A');
let r = await fetch(`${BASE}/api/reports/${id}/pdf`);
assert.equal(r.status, 200);
const doc = await PDFDocument.load(await r.arrayBuffer());
const { width } = doc.getPage(0).getSize();
assert.equal(doc.getPageCount(), 1);
assert.equal(width, 960);
r = await fetch(`${BASE}/api/reports/${id}/pdf?pdfa=1`);
assert.equal(r.status, 200);
assert.match(Buffer.from(await r.arrayBuffer()).toString('latin1'), /pdfaid:part>2</);

// the server of scripts/restart.sh has AI on (against ai.mjs's mock); this step needs it off (no ANTHROPIC_API_KEY)
const aiOff = (await fetch(`${BASE}/api/ai/report`, { method: 'POST', headers: { origin: BASE }, body: 'x' })).status === 501; // AI on: 400 (bad JSON) at once
if (aiOff) {
  step('AI box explains when AI drafting is off');
  await p.goto(BASE);
  await p.getByRole('button', { name: 'Describe a report (AI)' }).click();
  await p.getByLabel('What should the report show?').fill('Sales by region');
  await p.getByRole('button', { name: 'Draft the report' }).click();
  await p.getByText(/AI drafting is off/).waitFor();
} else step('(skipped: AI drafting is on here; ai.mjs covers it)');

await b.close();
for (const rid of created) await fetch(`${BASE}/api/reports/${rid}`, { method: 'DELETE', headers: { origin: BASE } });
assert.deepEqual(errs, []);
console.log('PASS phase B/C');
