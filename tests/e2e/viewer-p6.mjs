// Phase 6 viewer: print, full screen, view modes, frozen headers, search options, parameter editors,
// UI languages (Hindi, Arabic right-to-left), the phone layout with swipe, and the toolbar API in an embed.
//   BASE=http://localhost:3220 node tests/e2e/viewer-p6.mjs     (the server must be built with PW_EMBED_ORIGINS=http://localhost:4000)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const b = await chromium.launch();
const errs = [];
const newPage = async (opts = {}) => {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, ...opts })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return p;
};
const ready = async (p) => {
  await p.waitForSelector('.vpage svg', { timeout: 60000 });
  await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'));
};
const pageNo = (p) => p.getByLabel('Page', { exact: true }).inputValue();

/* ---------------- desktop ---------------- */
const p = await newPage();
await p.goto(`${BASE}/viewer/loan-statement`);
await ready(p);

step('every built-in toolbar item has its id');
const ids = await p.$$eval('[data-toolbar-id]', ns => ns.map(n => n.dataset.toolbarId));
for (const id of ['parameters', 'run', 'firstPage', 'previousPage', 'pageNumber', 'nextPage', 'lastPage', 'zoomOut', 'zoomValue', 'zoomIn', 'fitWidth', 'viewMode', 'fullScreen', 'search', 'print', 'pdf', 'excel', 'word', 'html', 'csv']) {
  assert.ok(ids.includes(id), `toolbar item ${id}`);
}
await p.screenshot({ path: '/tmp/shots/p6-desktop.png' });

step('frozen header: scrolling down page 1 pins the repeated table header');
assert.equal(await p.getByTestId('frozen-header').count(), 0, 'nothing pinned at the top of the report');
await p.locator('.vpages').evaluate(el => el.scrollBy(0, 1500));
await p.getByTestId('frozen-header').waitFor();
const pinned = await p.getByTestId('frozen-header').evaluate(el => [...el.querySelectorAll('text')].map(t => t.textContent));
assert.ok(pinned.includes('Due date') && pinned.includes('Balance'), `pinned header: ${pinned}`);
const [headTop, areaTop] = await p.evaluate(() => [document.querySelector('[data-testid=frozen-header]').getBoundingClientRect().top, document.querySelector('.vpages').getBoundingClientRect().top]);
assert.ok(Math.abs(headTop - areaTop) < 2, 'pinned at the top edge of the pages');
await p.screenshot({ path: '/tmp/shots/p6-frozen.png' });
await p.locator('.vpages').evaluate(el => el.scrollTo(0, 0));
await p.waitForFunction(() => document.querySelector('.pageno').value === '1');
await p.waitForFunction(() => !document.querySelector('[data-testid=frozen-header]'));

step('view modes: single page, galley, continuous');
await p.getByLabel('View mode').selectOption('single');
assert.equal(await p.locator('.vpage').count(), 1);
await p.getByTitle('Next page').click();
assert.equal(await p.locator('.vpage').getAttribute('data-page'), '2');
assert.equal(await pageNo(p), '2');
await p.getByLabel('View mode').selectOption('galley');
await p.waitForFunction(() => document.querySelectorAll('.vpage').length === 1 && document.querySelector('.vpage').offsetHeight > 5000, null, { timeout: 30000 });
const galleyTexts = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(galleyTexts.includes('Page 1 of 1'), 'one long page');
assert.equal(galleyTexts.filter(t => t === 'Due date').length, 1, 'the header once: no page breaks');
await p.getByLabel('View mode').selectOption('continuous');
await p.waitForFunction(() => document.querySelectorAll('.vpage').length === 8, null, { timeout: 30000 });

step('search: match case, whole word, the list of matches');
const count = async () => (await p.locator('.search .stat').innerText()).split('/').pop();
await p.getByLabel('Search').fill('paid');
await p.waitForSelector('.hl');
const any = Number(await count());
await p.getByRole('button', { name: 'Match case' }).click();
assert.equal(await count(), '0', 'no lower-case "paid" in the statement');
await p.getByLabel('Search').fill('Paid');
await p.waitForSelector('.hl');
const exact = Number(await count());
assert.ok(any > exact && exact > 20, `ignore case ${any} > match case ${exact}`);
await p.getByRole('button', { name: 'Match case' }).click();
await p.getByLabel('Search').fill('pai');
await p.waitForSelector('.hl');
await p.getByRole('button', { name: 'Whole word' }).click();
assert.equal(await count(), '0', 'whole word: "pai" is not a word');
await p.getByRole('button', { name: 'Whole word' }).click();
await p.getByLabel('Search').fill('Overdue');
await p.waitForSelector('.hl');
await p.getByRole('button', { name: 'List of matches' }).click();
const list = p.getByRole('navigation', { name: 'Matches' });
await list.waitFor();
const rows = await list.getByRole('button').allTextContents();
assert.ok(rows.length >= 1 && rows.every(r => /^p\. \d+ /.test(r) && /overdue/i.test(r)), `results: ${rows}`);
await p.screenshot({ path: '/tmp/shots/p6-search.png' });
await list.getByRole('button').first().click();
assert.equal(await pageNo(p), rows[0].match(/^p\. (\d+)/)[1], 'a click goes to the page of the match');
await p.getByLabel('Search').fill('');

step('print: a hidden frame gets the PDF');
await p.evaluate(() => { HTMLIFrameElement.prototype.focus = () => {}; }); // the frame calls print(); headless Chromium has no dialog
await p.getByTestId('print').click();
const frame = p.locator('iframe[data-pw-print]');
await frame.waitFor({ state: 'attached', timeout: 30000 });
const head = await frame.evaluate(async (f) => { const r = await fetch(f.src); return [f.src.slice(0, 5), r.headers.get('content-type'), new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5))]; });
assert.deepEqual(head, ['blob:', 'application/pdf', '%PDF-']);

step('full screen');
await p.getByRole('button', { name: 'Full screen' }).click();
await p.waitForFunction(() => document.fullscreenElement?.classList.contains('viewer'));
await p.waitForFunction(() => document.querySelector('[data-toolbar-id=fullScreen] button').getAttribute('aria-pressed') === 'true');
await p.getByRole('button', { name: 'Full screen' }).click();
await p.waitForFunction(() => !document.fullscreenElement);

step('parameter editors: slider and range, in a 3-column panel');
const summary = (re) => p.waitForFunction((src) => [...document.querySelectorAll('.vpage text')].some(n => new RegExp(src).test(n.textContent)), re.source, { timeout: 20000 });
await p.goto(`${BASE}/viewer/parameter-editors`);
await ready(p);
await p.getByRole('button', { name: 'Parameters' }).click();
const cols = await p.locator('form.vparams').evaluate(f => getComputedStyle(f).gridTemplateColumns.split(' ').length);
assert.equal(cols, 3, 'parameterLayout.columns');
await summary(/^60 loans · amount ≥ 0 /);
const slider = p.getByRole('slider', { name: 'Smallest amount' });
await slider.focus();
for (let i = 0; i < 18; i++) await p.keyboard.press('ArrowRight'); // step 50
assert.equal(await slider.inputValue(), '900');
await summary(/^4 loans · amount ≥ 900 /);
await slider.fill('0');
await p.getByLabel('Amount between from').fill('100');
await p.getByLabel('Amount between to').fill('300');
await p.getByRole('radio', { name: 'North' }).check();
await p.getByRole('switch', { name: 'Active loans only' }).check();
await summary(/^2 loans · amount ≥ 0 · region North · active only yes$/);
const amounts = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent).filter(t => /^\d+$/.test(t)).map(Number).filter(n => n >= 100)); // ids are under 100 here
assert.ok(amounts.length && amounts.every(n => n >= 100 && n <= 300), `amounts in range: ${amounts}`);
await p.screenshot({ path: '/tmp/shots/p6-params.png' });

/* ---------------- languages ---------------- */
step('Hindi UI');
const hi = await newPage();
await hi.goto(`${BASE}/viewer/loan-statement?lang=hi`);
await ready(hi);
await hi.getByRole('button', { name: 'पैरामीटर' }).waitFor();
await hi.getByRole('button', { name: 'प्रिंट करें' }).waitFor();
assert.equal(await hi.locator('.viewer').getAttribute('dir'), 'ltr');
await hi.goto(`${BASE}/?lang=hi`);
await hi.getByRole('heading', { name: 'रिपोर्टें' }).waitFor();
await hi.goto(`${BASE}/designer/loan-statement?lang=hi`);
await hi.getByRole('button', { name: 'सहेजें' }).waitFor();
await hi.getByRole('group', { name: 'मोड' }).waitFor();

step('Arabic UI: right-to-left, pages not mirrored');
const ar = await newPage();
await ar.goto(`${BASE}/viewer/loan-statement?lang=ar`);
await ready(ar);
assert.equal(await ar.locator('.viewer').getAttribute('dir'), 'rtl');
assert.equal(await ar.locator('.viewer').getAttribute('lang'), 'ar');
await ar.getByRole('button', { name: 'المعلمات' }).waitFor();
assert.equal(await ar.locator('.vpage').first().evaluate(e => getComputedStyle(e).direction), 'ltr');
// right-to-left: the parameters button sits at the right end of the toolbar
const [btnX, barW] = await ar.evaluate(() => [document.querySelector('[data-toolbar-id=parameters] button').getBoundingClientRect().right, document.querySelector('.vbar').getBoundingClientRect().right]);
assert.ok(barW - btnX < 30, 'first toolbar item on the right');
await ar.screenshot({ path: '/tmp/shots/p6-viewer-ar.png' });
await ar.goto(`${BASE}/?lang=ar`);
assert.equal(await ar.locator('.home-shell').getAttribute('dir'), 'rtl');
await ar.getByRole('heading', { name: 'التقارير' }).waitFor();

/* ---------------- phone ---------------- */
step('phone 390×844: compact toolbar, More menu, swipe, bottom sheet');
const m = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await m.goto(`${BASE}/viewer/loan-statement`);
await ready(m);
const barIds = await m.$$eval('.vbar [data-toolbar-id]', ns => ns.filter(n => !n.closest('.vmenu')).map(n => n.dataset.toolbarId));
assert.deepEqual(barIds, ['parameters', 'previousPage', 'pageNumber', 'nextPage', 'search']);
const noOverflow = await m.evaluate(() => document.querySelector('.vbar').scrollWidth <= document.querySelector('.vbar').clientWidth + 1 && document.documentElement.scrollWidth <= 390);
assert.ok(noOverflow, 'the toolbar fits the phone');
await m.screenshot({ path: '/tmp/shots/p6-mobile.png' });
const swipe = (dx) => m.locator('.vpages').evaluate((el, d) => {
  const at = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [at(300)], changedTouches: [at(300)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [at(300 + d)] }));
}, dx);
await swipe(-160);
await m.waitForFunction(() => document.querySelector('.pageno').value === '2');
await swipe(160);
await m.waitForFunction(() => document.querySelector('.pageno').value === '1');
await m.getByRole('button', { name: 'More' }).click();
const menuIds = await m.$$eval('.vmenu [data-toolbar-id]', ns => ns.map(n => n.dataset.toolbarId));
assert.ok(['print', 'pdf', 'viewMode', 'zoomIn', 'run'].every(id => menuIds.includes(id)), `menu: ${menuIds}`);
await m.screenshot({ path: '/tmp/shots/p6-mobile-menu.png' });
await m.keyboard.press('Escape');
assert.equal(await m.locator('.vmenu').count(), 0);
await m.getByRole('button', { name: 'Parameters' }).click();
const sheet = m.getByRole('dialog', { name: 'Parameters' });
await sheet.waitFor();
const box = await sheet.boundingBox();
assert.ok(Math.abs(box.y + box.height - 844) < 2 && box.width > 380, 'a sheet at the bottom, full width');
await m.screenshot({ path: '/tmp/shots/p6-mobile-sheet.png' });
await sheet.getByRole('button', { name: 'Close' }).click();
assert.equal(await sheet.count(), 0);

/* ---------------- toolbar API in an embed ---------------- */
step('toolbar API through mountViewer on another origin');
const host = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta charset="utf-8"><div id="r"></div>
<script src="${BASE}/embed/pagewright-viewer.js"></script>
<script>Pagewright.mountViewer('#r', { server: '${BASE}', report: 'loan-statement', params: { accountId: 'LN-2025-001982' }, viewMode: 'single',
  toolbar: { hide: ['excel', 'word', 'csv'], add: [{ id: 'hello', label: 'Say hello', title: 'A custom button', after: 'print', onClick: (api) => { window.__hello = { page: api.page, pages: api.pages }; api.goTo(2); } }] } });</script>`);
}).listen(4000);
const e = await newPage();
await e.goto('http://localhost:4000/');
await e.waitForSelector('.vpage svg', { timeout: 60000 });
const eIds = await e.$$eval('pierce/[data-toolbar-id]', ns => ns.map(n => n.dataset.toolbarId)).catch(() => null)
  ?? await e.locator('[data-toolbar-id]').evaluateAll(ns => ns.map(n => n.dataset.toolbarId));
assert.ok(!eIds.includes('excel') && !eIds.includes('word') && !eIds.includes('csv'), `hidden: ${eIds}`);
assert.equal(eIds[eIds.indexOf('print') + 1], 'hello', 'added after print');
assert.equal(await e.locator('.vpage').count(), 1, 'viewMode option: single page');
await e.getByRole('button', { name: 'Say hello' }).click();
assert.deepEqual(await e.evaluate(() => window.__hello), { page: 1, pages: 2 });
await e.waitForFunction(() => document.querySelector('#r').shadowRoot.querySelector('.vpage').dataset.page === '2');
host.close();

await b.close();
assert.deepEqual(errs, []);
console.log('PASS viewer p6');
