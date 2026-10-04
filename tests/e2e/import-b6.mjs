// JasperReports and BIRT import: upload a .jrxml and a .rptdesign from the demo samples through the home page's Import,
// then open each in the viewer.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:3000';
const FIX = path.join(import.meta.dirname, '..', 'fixtures');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const sel = 'input[type=file][accept*=".jrxml"]';
// the file input works once React has hydrated it
const hydrated = () => p.waitForFunction((s) => { const i = document.querySelector(s); return i && Object.keys(i).some(k => k.startsWith('__reactProps')); }, sel);

const ids = [];
for (const [file, expect] of [
  [path.join(FIX, 'jrxml', 'corpus', 'jr6-csvdatasource-CsvDataSourceReport.jrxml'), /Street/],
  [path.join(FIX, 'birt', 'corpus', 'birt-example_simple.rptdesign'), /Congratulations!/],
]) {
  await p.goto(`${BASE}/`);
  await hydrated();
  assert.match(await p.locator(sel).getAttribute('accept'), /\.rptdesign/);
  const [res] = await Promise.all([
    p.waitForResponse(r => r.url().includes('/api/reports/import') && r.request().method() === 'POST'),
    p.locator(sel).setInputFiles(file),
  ]);
  assert.equal(res.status(), 201, await res.text());
  assert.equal(res.request().headers()['content-type'], 'application/xml');
  const { id, stats, warnings } = await res.json();
  assert.ok(stats.items > 5 && stats.dropped <= 1, JSON.stringify(stats));
  assert.ok(warnings.length > 0);
  await p.getByText(/The report was created with \d+ note/).waitFor();
  ids.push(id);
  await p.goto(`${BASE}/viewer/${id}`);
  await p.waitForSelector('.vpage');
  await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'));
  const t = (await p.$$eval('.vpage text', ns => ns.map(n => n.textContent))).join(' ');
  assert.match(t, expect, `${path.basename(file)}: ${t.slice(0, 300)}`);
  await p.screenshot({ path: `/tmp/shots/import-b6-${ids.length}.png` }).catch(() => {});
}

// a hostile Jasper file is refused with a readable error
await p.goto(`${BASE}/`);
await hydrated();
const [bad] = await Promise.all([
  p.waitForResponse(r => r.url().includes('/api/reports/import') && r.request().method() === 'POST'),
  p.locator(sel).setInputFiles({ name: 'xxe.jrxml', mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><!DOCTYPE jasperReport [<!ENTITY x SYSTEM "file:///etc/passwd">]><jasperReport name="x">&x;</jasperReport>') }),
]);
assert.equal(bad.status(), 400);
await p.locator('.err').filter({ hasText: /DOCTYPE/ }).waitFor();

for (const id of ids) {
  const del = await p.request.delete(`${BASE}/api/reports/${id}`, { headers: { origin: BASE } });
  assert.ok(del.ok());
}
await b.close();
assert.deepEqual(errs, []);
console.log('PASS jrxml + birt import');
