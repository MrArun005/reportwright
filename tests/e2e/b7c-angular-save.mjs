// N7 guard: <reportwright-designer> (the @reportwright/angular element) fires pw-save with the definition after an edit,
// with Save and with Ctrl+S, and again after the app binds the saved definition back as options. Standalone, no onSave.
// Run after npm run build:packages (it bundles packages/angular/src and packages/viewer/dist).
import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const app = `
import { defineReportWrightElements } from '${path.join(root, 'packages/angular/src/index.js')}';
defineReportWrightElements();
window.saves = [];
const el = document.querySelector('reportwright-designer');
el.addEventListener('pw-save', (e) => { window.saves.push(e.detail); });
el.options = { definition: { $schema: 'reportwright/report@1', name: 'Saveme', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [] } } }, fontsUrl: '/pw-fonts/', height: 500 };
`;
const bundle = (await build({ stdin: { contents: app, resolveDir: root }, bundle: true, format: 'esm', write: false, logLevel: 'silent',
  alias: { '@reportwright/viewer': path.join(root, 'packages/viewer/dist/viewer.js'), '@reportwright/viewer/designer': path.join(root, 'packages/viewer/dist/designer.js') },
  define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.route('http://app.test/**', (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u === '/') return route.fulfill({ body: '<!doctype html><reportwright-designer></reportwright-designer><script type="module" src="/app.js"></script>', contentType: 'text/html' });
  if (u === '/app.js') return route.fulfill({ body: bundle, contentType: 'text/javascript' });
  if (u.startsWith('/pw-fonts/')) return route.fulfill({ body: fs.readFileSync(path.join(root, 'packages/fonts/public/fonts', u.slice(10))), contentType: 'font/ttf' });
  return route.fulfill({ status: 404, body: '' });
});
await p.goto('http://app.test/');
const designer = p.locator('reportwright-designer');
const saveBtn = designer.locator('[data-testid="save"]');
const name = designer.locator('input[aria-label="Report name"]');
await saveBtn.waitFor({ timeout: 30000 });
const edit = async (v) => {
  await name.fill(v);
  await name.press('Tab');
  // an edit enables Save (the designer starts saved)
  await p.waitForFunction(() => document.querySelector('reportwright-designer').shadowRoot.querySelector('[data-testid="save"]')?.disabled === false, null, { timeout: 5000 });
};
const names = () => p.evaluate(() => window.saves.map(d => d.name));

await edit('Renamed');
await name.press('Control+s');
await p.waitForFunction(() => window.saves.length >= 1, null, { timeout: 5000 });
// Angular's usual loop: the app keeps the saved definition and binds it back as options, then edits and saves again
const saved1 = await p.evaluate(() => window.saves[0]);
await p.evaluate((def) => { const el = document.querySelector('reportwright-designer'); el.options = { ...el.options, definition: def }; }, saved1);
await p.waitForTimeout(1500);
await edit('Renamed again');
await saveBtn.click();
await p.waitForFunction(() => window.saves.length >= 2, null, { timeout: 5000 });
const got = await names();
await b.close();
assert.deepEqual(errs, []);
assert.deepEqual(got, ['Renamed', 'Renamed again']);
console.log('pw-save fired with the definition:', got);
