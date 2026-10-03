// Progressive viewer: a ~450-page report shows page 1 without building every page's SVG.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const N = 20000;
const rows = Array.from({ length: N }, (_, i) => ({ n: i + 1, name: `Customer ${i + 1}`, amt: (i * 37) % 1000 + 0.5 }));
const definition = {
  $schema: 'pagewright/report@1', name: 'e2e progressive', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'R', source: 's', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 54, dataSet: 'R', columns: [{ width: 60 }, { width: 240 }, { width: 100 }],
    header: [{ height: 18, cells: [{ value: '#' }, { value: 'Name' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.name' }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
    footer: [{ height: 18, cells: [{ value: 'Total' }, null, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }] }] }] } },
};
const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'e2e progressive', definition }) });
assert.equal(r.status, 201);
const { id } = await r.json();

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const t0 = Date.now();
await p.goto(`${BASE}/viewer/${id}`);
await p.waitForSelector('.vpage svg', { timeout: 60000 });
const firstMs = Date.now() - t0;
const pages = await p.locator('.vpage').count();
const drawn = await p.locator('.vpage svg').count();
console.log(`${N} rows → ${pages} pages; first page after ${firstMs} ms; ${drawn} pages drawn`);
assert.ok(pages > 400, 'all pages are laid out');
assert.ok(drawn <= 7, 'only the pages near the current one are drawn');

const t1 = Date.now();
await p.getByTitle('Last page').click();
await p.waitForSelector(`[data-page="${pages}"] svg`);
const t = await p.$$eval(`[data-page="${pages}"] text`, ns => ns.map(n => n.textContent));
console.log(`jump to page ${pages} drawn after ${Date.now() - t1} ms`);
assert.ok(t.includes('Total'), 'the last page shows the total');
assert.ok(await p.locator('[data-page="1"] svg').count() === 0, 'page 1 is released after the jump');

await b.close();
await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE' });
assert.deepEqual(errs, []);
console.log('PASS progressive viewer');
