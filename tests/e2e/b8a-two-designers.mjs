// N17: two designers on one page each keep their own report. Edits in one never show in the other, Save in each
// calls its own onSave with its own report, undo stays in its own designer; also with the second one mounted later.
// Run npm run build:packages first (it serves public/embed/esm and bundles packages/angular, packages/viewer/dist).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://two-designers.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const def = (name) => ({ $schema: 'pagewright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [] } } });
const app = (delay) => `import { mountDesigner } from '/pw/designer.js';
window.saves = { a: [], b: [] };
const opts = (k, name) => ({ definition: ${JSON.stringify(def('X'))}, fontsUrl: '/pw-fonts/', height: '600px', onSave: (d) => { window.saves[k].push({ name: d.name, items: d.sections.body.items.length }); } });
const a = { ...opts('a'), definition: { ...${JSON.stringify(def('Alpha'))} } };
const b = { ...opts('b'), definition: { ...${JSON.stringify(def('Beta'))} } };
window.ha = mountDesigner('#a', a);
${delay ? `setTimeout(() => { window.hb = mountDesigner('#b', b); }, ${delay});` : "window.hb = mountDesigner('#b', b);"}
`;

const browser = await chromium.launch();
async function run(delay) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: '<!doctype html><meta charset="utf-8"><div id="a"></div><div id="b"></div><script type="module" src="/app.js"></script>', contentType: 'text/html' });
    if (u.pathname === '/app.js') return route.fulfill({ body: app(delay), contentType: 'text/javascript' });
    const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
    const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/`);
  const nameA = page.locator('#a input[aria-label="Report name"]'), nameB = page.locator('#b input[aria-label="Report name"]');
  await nameA.waitFor({ timeout: 60000 });
  await nameB.waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  const names = async () => [await nameA.inputValue(), await nameB.inputValue()];
  assert.deepEqual(await names(), ['Alpha', 'Beta'], `${delay}: each shows its own report`);

  await nameA.fill('Alpha 2'); await nameA.press('Tab');
  assert.deepEqual(await names(), ['Alpha 2', 'Beta'], `${delay}: an edit in A stays in A`);
  await page.locator('#a [data-tool="textbox"]').click(); // an item in A only
  await nameB.fill('Beta 2'); await nameB.press('Tab');
  assert.deepEqual(await names(), ['Alpha 2', 'Beta 2'], `${delay}: an edit in B stays in B`);
  const items = () => page.evaluate(() => [window.ha.getDefinition(), window.hb.getDefinition()].map(d => `${d.name}:${d.sections.body.items.length}`));
  assert.deepEqual(await items(), ['Alpha 2:1', 'Beta 2:0'], `${delay}: getDefinition per handle`);

  await page.locator('#a [data-testid="save"]').click();
  await page.waitForFunction(() => window.saves.a.length === 1, null, { timeout: 5000 });
  await page.locator('#b [data-testid="save"]').click();
  await page.waitForFunction(() => window.saves.b.length === 1, null, { timeout: 5000 });
  await nameB.press('Control+s'); // Ctrl+S in B saves B
  await page.waitForTimeout(300);
  const saves = await page.evaluate(() => window.saves);
  assert.deepEqual(saves.a, [{ name: 'Alpha 2', items: 1 }], `${delay}: A's onSave gets A's report`);
  assert.equal(saves.b[0].name, 'Beta 2', `${delay}: B's onSave gets B's report`);
  assert.equal(saves.b[0].items, 0);

  // undo in A (focus in A) undoes A's last edit, B untouched
  await page.locator('#a [data-tool="line"]').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.deepEqual(await items(), ['Alpha 2:0', 'Beta 2:0'], `${delay}: undo in A undoes A only`);
  assert.deepEqual(await names(), ['Alpha 2', 'Beta 2']);
  await page.locator('#b button[aria-label^="Undo"]').click(); // B's Undo button: B's rename goes, A untouched
  assert.deepEqual(await names(), ['Alpha 2', 'Beta']);
  assert.deepEqual(errors, []);
  await page.context().close();
}
await run(0);
await run(1500);
console.log('b8a-two-designers: two designers, mounted together and one later: ok');

// N7: the Angular element's pw-save with another designer on the page (the tester's was Vue's; every wrapper calls
// mountDesigner). Needs npm run build:packages (packages/angular/src, packages/viewer/dist).
{
  const { build } = await import('esbuild');
  const ng = `
import { defineReportWrightElements } from '${path.join(root, 'packages/angular/src/index.js')}';
import { mountDesigner } from '@reportwright/viewer/designer';
defineReportWrightElements();
window.saves = { ng: [], other: [] };
mountDesigner('#other', { definition: ${JSON.stringify(def('Other'))}, fontsUrl: '/pw-fonts/', height: '500px', onSave: (d) => { window.saves.other.push(d.name); } });
const el = document.querySelector('reportwright-designer');
el.addEventListener('pw-save', (e) => { window.saves.ng.push(e.detail.name); });
el.options = { definition: ${JSON.stringify(def('Angular'))}, fontsUrl: '/pw-fonts/', height: 500 };
`;
  const js = (await build({ stdin: { contents: ng, resolveDir: root }, bundle: true, format: 'esm', write: false, logLevel: 'silent',
    alias: { '@reportwright/viewer': path.join(root, 'packages/viewer/dist/viewer.js'), '@reportwright/viewer/designer': path.join(root, 'packages/viewer/dist/designer.js') },
    define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1200 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: '<!doctype html><meta charset="utf-8"><div id="other"></div><reportwright-designer></reportwright-designer><script type="module" src="/app.js"></script>', contentType: 'text/html' });
    if (u.pathname === '/app.js') return route.fulfill({ body: js, contentType: 'text/javascript' });
    const f = u.pathname.startsWith('/pw-fonts/') && path.join(FILES['/pw-fonts/'], u.pathname.slice(10));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: 'font/ttf' });
  });
  await page.goto(`${ORIGIN}/`);
  const ngName = page.locator('reportwright-designer input[aria-label="Report name"]'), otherName = page.locator('#other input[aria-label="Report name"]');
  await ngName.waitFor({ timeout: 60000 }); await otherName.waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  assert.deepEqual([await ngName.inputValue(), await otherName.inputValue()], ['Angular', 'Other']);
  await ngName.fill('Angular 2'); await ngName.press('Tab');
  await page.locator('reportwright-designer [data-testid="save"]').click();
  await page.waitForFunction(() => window.saves.ng.length === 1, null, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.saves), { ng: ['Angular 2'], other: [] }, 'pw-save fires for the Angular designer only');
  assert.equal(await otherName.inputValue(), 'Other');
  assert.deepEqual(errors, []);
  await page.context().close();
  console.log('b8a-two-designers: Angular element next to another designer: ok');
}
await browser.close();
