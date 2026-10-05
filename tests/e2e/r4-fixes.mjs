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
    step('a Word export asked for while the HTML export runs is queued, not dropped');
    const files = [];
    p.on('download', d => files.push(d.suggestedFilename()));
    await p.getByTestId('export-html').click();
    await p.getByTestId('export-docx').click();
    await p.waitForFunction(() => true);
    for (let i = 0; i < 100 && files.length < 2; i++) await p.waitForTimeout(200);
    assert.deepEqual(files.map(f => f.split('.').pop()).sort(), ['docx', 'html']);
  }
  if (want('busy')) {
    step('a busy server: the viewer says it retries (1/3…), and after the last try offers Retry');
    const id = await create({ ...base('r4 busy', [{ type: 'textbox', name: 'N', x: 0, y: 0, w: 300, h: 20, value: '="Accounts: " & CountRows("A")' }]),
      dataSources: [{ name: 'hard', type: 'rest', url: '/api/sample/hard?rows=20' }], dataSets: [{ name: 'A', source: 'hard', path: '$.accounts[*]' }] });
    let fails = 2;
    const busy = (route) => (fails-- > 0 ? route.fulfill({ status: 503, headers: { 'retry-after': '1' }, body: '{"error":"busy"}' }) : route.continue());
    await ctx.route('**/api/sample/hard*', busy);
    await p.goto(`${BASE}/viewer/${id}`);
    await p.getByTestId('viewer-busy').filter({ hasText: /Server busy — retrying \(1\/3\)/ }).waitFor();
    await p.locator('.vpage').first().waitFor();
    fails = 100;
    await p.reload();
    await p.getByTestId('viewer-retry').waitFor({ timeout: 30000 });
    if (process.env.FIX_SHOTS) await p.screenshot({ path: `${process.env.FIX_SHOTS}/fix-busy-retry.png` });
    await ctx.unroute('**/api/sample/hard*', busy);
    await p.getByTestId('viewer-retry').click();
    await p.locator('.vpage').first().waitFor();
    assert.equal(await p.getByTestId('viewer-retry').count(), 0);
  }
  if (want('shell')) {
    step('the designer and the viewer fill the window and never scroll as a whole; the "to check" list stays inside it');
    await p.setViewportSize({ width: 1440, height: 922 });
    for (const url of ['/designer/stress-test', '/viewer/stress-test']) {
      await p.goto(`${BASE}${url}`);
      await p.waitForSelector(url.startsWith('/designer') ? '[data-testid=paper]' : '.vpage');
      await p.waitForTimeout(500);
      const { sh, ih } = await p.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ih: window.innerHeight }));
      assert.ok(sh <= ih, `${url}: the page is ${sh}px tall in a ${ih}px window`);
      if (process.env.FIX_SHOTS) await p.screenshot({ path: `${process.env.FIX_SHOTS}/fix-shell-${url.split('/')[1]}.png` });
    }
    const id = await create(base('r4 issues', [{ type: 'textbox', name: 'Bad', x: 0, y: 0, w: 200, h: 20, value: '=Frobnicate(1)' },
      { type: 'barcode', name: 'QR', x: 220, y: 0, w: 60, h: 60, symbology: 'qr', value: 'x' }]));
    for (const width of [1440, 1000]) {
      await p.setViewportSize({ width, height: 922 });
      await open(id);
      await p.getByTestId('issues').click();
      const list = p.getByTestId('issues-list');
      await list.waitFor();
      const text = await list.textContent();
      assert.match(text, /Unknown function "Frobnicate"/);
      assert.match(text, /"qr" is not a barcode symbology \(did you mean "qrcode"\?\)/);
      const box = await list.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, `the list is at ${box.x}..${box.x + box.width} in a ${width}px window`);
      if (process.env.FIX_SHOTS) await p.screenshot({ path: `${process.env.FIX_SHOTS}/fix-popup-${width}.png` });
    }
    await p.setViewportSize({ width: 1440, height: 900 });
  }
  if (want('ai')) {
    step('Ask AI: enabled when the server has an Anthropic key, else disabled and saying why (E2E_NO_AI=1: a server without one)');
    const id = await create(base('r4 ai', []));
    await open(id);
    const btn = p.getByTestId('ask-ai');
    if (process.env.E2E_NO_AI) {
      assert.equal(await btn.isDisabled(), true);
      assert.match(await btn.getAttribute('title'), /no ANTHROPIC_API_KEY/);
    } else assert.equal(await btn.isDisabled(), false);
  }
  assert.deepEqual(errs.filter(e => !/ResizeObserver/.test(e)), [], 'no page errors');
  console.log('r4-fixes: all passed');
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
  await b.close();
}
