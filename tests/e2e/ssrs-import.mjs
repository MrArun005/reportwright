// SSRS import: upload a Microsoft sample .rdl through the home page's Import, then open it in the viewer.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:3000';
const CORPUS = path.join(import.meta.dirname, '..', 'fixtures', 'rdl', 'corpus');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

await p.goto(`${BASE}/`);
const input = p.locator('input[type=file][accept*=".rdl"]');
assert.match(await input.getAttribute('accept'), /\.rdlc/);

// a real report: imported, with its notes listed
const [res] = await Promise.all([
  p.waitForResponse(r => r.url().includes('/api/reports/import') && r.request().method() === 'POST'),
  input.setInputFiles(path.join(CORPUS, 'rs-Transcript.rdl')),
]);
assert.equal(res.status(), 201);
assert.equal(res.request().headers()['content-type'], 'application/xml');
const { id, stats, warnings } = await res.json();
assert.equal(stats.dropped, 0);
assert.ok(warnings.some(w => /Arial/.test(w)));
await p.getByText(/The report was created with \d+ note/).waitFor();

// it opens in the viewer and shows the sample's data
await p.goto(`${BASE}/viewer/${id}`);
await p.waitForSelector('.vpage');
await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'));
const t = (await p.$$eval('.vpage text', ns => ns.map(n => n.textContent))).join(' ');
assert.match(t, /Contoso Professional Certified Transcript/);
assert.match(t, /GERALDO MAGELLA JUNIOR/);
assert.match(t, /Network Infrastructure Configuration/);
await p.screenshot({ path: '/tmp/shots/ssrs-import.png' }).catch(() => {});

// a hostile file is refused with a readable error, nothing is created
await p.goto(`${BASE}/`);
const [bad] = await Promise.all([
  p.waitForResponse(r => r.url().includes('/api/reports/import') && r.request().method() === 'POST'),
  p.locator('input[type=file][accept*=".rdl"]').setInputFiles({ name: 'xxe.rdl', mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><!DOCTYPE Report [<!ENTITY x SYSTEM "file:///etc/passwd">]><Report>&x;</Report>') }),
]);
assert.equal(bad.status(), 400);
await p.locator('.err').filter({ hasText: /DOCTYPE/ }).waitFor();

// clean up
const del = await p.request.delete(`${BASE}/api/reports/${id}`, { headers: { origin: BASE } });
assert.ok(del.ok());
await b.close();
assert.deepEqual(errs, []);
console.log('PASS ssrs import');
