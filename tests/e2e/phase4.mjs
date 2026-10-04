// Phase 4: smart guides, shortcuts, themes, history, columns, TOC; embedding on another origin.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

// a scratch copy of the loan statement
const def = await (await fetch(`${BASE}/api/reports/loan-statement`)).json();
await fetch(`${BASE}/api/reports/e2e-phase4`, { method: 'DELETE' });
const created = await (await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'e2e phase4', definition: def }) })).json();
const id = created.id;

step('smart guide while dragging');
await p.goto(`${BASE}/designer/${id}`);
await p.waitForSelector('[data-testid=paper]');
const city = await p.locator('[data-item=City]').boundingBox();
const prod = await p.locator('[data-item=LblProduct]').boundingBox();
await p.mouse.move(city.x + 20, city.y + 5);
await p.mouse.down();
await p.mouse.move(city.x + 30, city.y + 30, { steps: 4 });
await p.mouse.move(city.x + 21, prod.y + 6, { steps: 4 });
assert.ok(await p.locator('.guide').count() >= 1, 'a guide line shows');
await p.mouse.up();

step('keyboard shortcuts dialog');
await p.keyboard.press('Escape');
await p.keyboard.press('Shift+Slash');
await p.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
await p.keyboard.press('Escape');

step('theme, save, history and restore');
await p.locator('.band-label').first().click();
await p.locator('.paper').click({ position: { x: 5, y: 2 } }).catch(() => {});
await p.keyboard.press('Escape');
const insp = p.locator('[data-testid=inspector]');
await insp.getByLabel('Apply a theme (replaces the default text and named styles)').selectOption('Teal');
await insp.locator('.style-card b', { hasText: 'TableHeader' }).waitFor(); // the style's card (its name is also an option of the other cards' "Based on")
await p.keyboard.press('Control+s');
await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
let saved = await (await fetch(`${BASE}/api/reports/${id}`)).json();
assert.ok(saved.styles.named.Title);
await p.getByRole('button', { name: 'History' }).click();
await p.getByRole('button', { name: 'Restore' }).first().click();
await p.getByRole('dialog').waitFor({ state: 'detached' });
saved = await (await fetch(`${BASE}/api/reports/${id}`)).json();
assert.ok(!saved.styles.named, 'restored the version before the theme');

step('two body columns show a column guide');
await p.locator('.band-label', { hasText: 'Body' }).click();
await insp.locator('.field', { hasText: 'Columns' }).locator('input').fill('2');
await p.waitForSelector('.col-guide');
await p.keyboard.press('Control+z');

step('table of contents in the sales report');
await p.goto(`${BASE}/designer/sales-by-region`);
await p.waitForSelector('[data-testid=paper]');
await p.dragAndDrop('[data-tool=toc]', '[data-section=body]', { targetPosition: { x: 300, y: 2 } });
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage');
const t = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(t.includes('Contents') && t.includes('North'), 'contents listed');

step('embed on another origin');
const host = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync('tests/e2e/embed-host.html', 'utf8').replaceAll('http://localhost:3000', BASE)); }).listen(4000);
const e = await ctx.newPage();
const embedErrs = []; e.on('pageerror', x => embedErrs.push(x.message)); e.on('console', m => { if (m.type() === 'error') embedErrs.push(m.text()); });
await e.goto('http://localhost:4000/');
await e.waitForSelector('#report .vpage', { timeout: 30000 });
await e.locator('#report .vpage text', { hasText: 'Arjun Mehta' }).first().waitFor({ timeout: 30000 });
const et = await e.locator('#report .vpage text').allTextContents();
assert.ok(et.includes('Arjun Mehta'), 'embedded report rendered with parameters');
const btnBg = await e.locator('#report .btn').first().evaluate(el => getComputedStyle(el).backgroundColor);
assert.notEqual(btnBg, 'rgb(255, 0, 0)', 'host styles do not leak in');
await e.screenshot({ path: '/tmp/shots/embed.png' });
host.close();

await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE' });
await b.close();
console.log('errors:', errs.length ? errs : 'none', '| embed errors:', embedErrs.length ? embedErrs : 'none');
assert.deepEqual(errs, []);
assert.deepEqual(embedErrs, []);
console.log('PASS phase 4');
