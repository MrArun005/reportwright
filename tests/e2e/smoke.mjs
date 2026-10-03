// Viewer smoke test: parameters, paging, errors.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

await p.goto(`${BASE}/viewer/loan-statement`);
await p.waitForSelector('.vpage');
assert.equal(await p.locator('.vpage').count(), 8);
await p.screenshot({ path: '/tmp/shots/viewer.png' });

// another account through the parameter panel
await p.getByRole('button', { name: 'Parameters' }).click();
await p.getByLabel('Loan account *').fill('LN-2025-001982');
await p.getByRole('button', { name: 'View report' }).click();
await p.waitForFunction(() => document.querySelectorAll('.vpage').length === 2);
const t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('Arjun Mehta'));
assert.ok(t.includes('Page 2 of 2'));

// a bad value shows a readable error, not a crash
await p.getByLabel('Loan account *').fill('NOPE');
await p.getByRole('button', { name: 'View report' }).click();
await p.locator('.vmsg.error').waitFor();
const msg = await p.locator('.vmsg.error').innerText();
assert.match(msg, /HTTP 404/);
await p.screenshot({ path: '/tmp/shots/viewer-error.png' });

// paging buttons
await p.getByLabel('Loan account *').fill('LN-2026-004417');
await p.getByRole('button', { name: 'View report' }).click();
await p.waitForFunction(() => document.querySelectorAll('.vpage').length === 8);
await p.getByTitle('Last page').click();
await p.waitForTimeout(300);
assert.equal(await p.getByLabel('Page').inputValue(), '8');

await b.close();
assert.deepEqual(errs, []);
console.log('PASS viewer smoke');
