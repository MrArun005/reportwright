// R4: the owner's bug list (docs/COORDINATION.md "R4"). One section per fix; ONLY=nosource,shell runs some of them.
//   BASE=http://localhost:3456 node tests/e2e/r4-fixes.mjs
// Screenshots go to $SHOTS (default /tmp/shots) as r4-*.png. The reports it makes are deleted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const SHOTS = process.env.SHOTS || '/tmp/shots';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/r4-${n}.png` });

const rows = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, region: ['North', 'South', 'East', 'West'][i % 4], city: `City ${String(i).padStart(2, '0')}`, amount: 1000 + i * 37.5, qty: i % 7 }));
const SALES = { name: 'Sales', source: 'src', path: '$.rows[*]', fields: [
  { name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'qty', type: 'number' }] };
const base = (name, items = [], extra = {}) => ({
  $schema: 'pagewright/report@1', name, page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [SALES],
  sections: { body: { height: 400, items } },
  ...extra,
});
const ids = [];
const create = async (definition) => {
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: definition.name, definition }) });
  const out = await r.json();
  assert.ok(out.id, `create: ${JSON.stringify(out)}`);
  ids.push(out.id);
  return out.id;
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
if (process.env.SLOW) p.setDefaultTimeout(180000); // a dev server compiles each page on first use
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const open = async (id) => { await p.goto(`${BASE}/designer/${id}`); await p.waitForSelector('[data-testid=paper]'); };

try {
  if (want('nosource')) {
    step('no data source: "Load sample data" is disabled and says why; the wizards say it too');
    const id = await create({ ...base('r4 no source', [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 20, value: 'Hello' }]), dataSources: [], dataSets: [] });
    await open(id);
    const btn = p.getByTestId('load-sample');
    assert.equal(await btn.isDisabled(), true, 'Load sample data is disabled without a data source');
    assert.match(await btn.getAttribute('title'), /no data source/);
    await p.getByTestId('no-source').first().waitFor();
    assert.match(await p.getByTestId('no-source').first().textContent(), /This report has no data source/);
    await shot(p, 'no-source');
    if (process.env.FIX_SHOTS) await p.screenshot({ path: `${process.env.FIX_SHOTS}/fix-no-data-source.png` });
  }
  if (want('html')) {
    step('HTML export of a one-page report: the pages and tables, not the viewer and the data (was 9.7 MB)');
    const id = await create(base('r4 html size', [
      { type: 'table', name: 'T', x: 0, y: 0, w: 500, h: 28, dataSet: 'Sales', columns: [{ width: 100 }, { width: 200 }, { width: 200 }],
        header: [{ height: 14, cells: [{ value: 'Region' }, { value: 'City' }, { value: 'Amount' }] }],
        detail: [{ height: 14, cells: [{ value: '=Fields.region' }, { value: '=Fields.city' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }]));
    await p.goto(`${BASE}/viewer/${id}`);
    await p.waitForSelector('.vpage');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('export-html').click()]);
    const size = fs.statSync(await dl.path()).size;
    console.log(`  HTML export: ${(size / 1024).toFixed(0)} KB`);
    assert.ok(size < 300 * 1024, `one page of HTML is ${size} bytes`);
  }
  assert.deepEqual(errs.filter(e => !/ResizeObserver/.test(e)), [], 'no page errors');
  console.log('r4-fixes: all passed');
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
  await b.close();
}
