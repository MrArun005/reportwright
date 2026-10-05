// Cross-browser smoke (Firefox, WebKit/Safari; Chromium too): the viewer opens and renders, the PDF export downloads a
// PDF, the designer loads. BROWSERS=firefox,webkit (default) BASE=http://localhost:3000 node tests/e2e/browsers.mjs
import * as pw from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
for (const name of (process.env.BROWSERS || 'firefox,webkit').split(',')) {
  const b = await pw[name].launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  try {
    await p.goto(`${BASE}/viewer/charts-showcase`);
    await p.waitForSelector('.vpage svg', { timeout: 60000 });
    await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'), null, { timeout: 60000 });
    assert.ok(await p.locator('.vpage').count() >= 1, 'pages');
    if (!(await p.getByTestId('export-pdf').isVisible())) await p.getByTestId('export-menu').click();
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.getByTestId('export-pdf').click()]);
    const pdf = fs.readFileSync(await d.path());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'a PDF');
    await p.goto(`${BASE}/designer/charts-showcase`);
    await p.waitForSelector('[data-testid=paper]', { timeout: 60000 });
    assert.deepEqual(errs, [], 'page errors');
    console.log(`ok ${name}: viewer, PDF export (${pdf.length} bytes), designer`);
  } finally { await b.close(); }
}
