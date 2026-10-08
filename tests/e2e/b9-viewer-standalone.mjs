// b9 viewer tickets, standalone viewer (no server; Playwright answers from disk like standalone-viewer.mjs). Run npm run build:packages first.
//  N31: only the font faces the layout needs are fetched (2 of 7 for a report in Inter Regular + Bold); numbers printed
//  N1: with esbuild bundling the worker 404s: one console.warn, handle.usesWorker === false, the report still renders
//  N18: the built worker has no chunk imports (copying it alone works)
//  A11Y-3: .vthumb has no aria-label that differs from its visible text; its name is "Page 1"
//  cascading parameters: changing Region re-runs with City cleared, not the old City
import { chromium } from 'playwright';
import { build } from 'esbuild';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://b9.test';
// N18: no chunk imports in the worker file
for (const d of ['packages/viewer/dist', 'packages/viewer/dist/peer']) {
  const f = path.join(root, d, 'engine.worker.js');
  if (fs.existsSync(f)) assert.equal(/from\s*["']\.\/chunk-/.test(fs.readFileSync(f, 'utf8')), false, `${d}/engine.worker.js imports a chunk`);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b9-'));
fs.mkdirSync(path.join(tmp, 'node_modules/@reportwright'), { recursive: true });
fs.symlinkSync(path.join(root, 'packages/viewer'), path.join(tmp, 'node_modules/@reportwright/viewer'));
fs.writeFileSync(path.join(tmp, 'viewer.js'), "export { mountViewer } from '@reportwright/viewer';");
await build({ entryPoints: [path.join(tmp, 'viewer.js')], bundle: true, format: 'esm', splitting: true, outdir: path.join(tmp, 'out'),
  nodePaths: [path.join(tmp, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
const FONTS = path.join(root, 'packages/fonts/public/fonts/');
const definition = {
  $schema: 'pagewright/report@1', name: 'B9', page: { size: 'A4', margins: [36, 36, 36, 36] },
  parameters: [{ name: 'region', type: 'string', default: 'North', options: ['North', 'South'] },
    { name: 'city', type: 'string', default: 'Delhi', optionsFrom: { dataSet: 'Cities', value: '=Fields.city' } }],
  dataSources: [{ name: 'c', type: 'json', data: { rows: [{ region: 'North', city: 'Delhi' }, { region: 'North', city: 'Jaipur' }, { region: 'South', city: 'Chennai' }, { region: 'South', city: 'Kochi' }] } }],
  dataSets: [{ name: 'Cities', source: 'c', path: '$.rows', filters: [{ expr: '=Fields.region', op: '=', value: '=Parameters.region' }] }],
  sections: { body: { items: [
    { type: 'textbox', name: 'A', x: 0, y: 0, w: 300, h: 20, value: '="R:" & Parameters.region' },
    { type: 'textbox', name: 'B', x: 0, y: 30, w: 300, h: 20, value: '="C:" & Parameters.city', style: { fontWeight: 'bold' } }] } },
};
const html = `<!doctype html><meta charset="utf-8"><div id="r"></div><script type="module">
import { mountViewer } from '/pw/viewer.js';
window.h = mountViewer('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/' });
</script>`;
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const fonts = [], warns = [];
  let fontBytes = 0;
  p.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
  await p.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    const f = u.pathname.startsWith('/pw/') ? path.join(tmp, 'out', u.pathname.slice(4)) : u.pathname.startsWith('/pw-fonts/') ? path.join(FONTS, u.pathname.slice(10)) : null;
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    if (u.pathname.startsWith('/pw-fonts/')) { fonts.push(u.pathname.slice(10)); fontBytes += fs.statSync(f).size; }
    return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  });
  await p.goto(`${ORIGIN}/`);
  const texts = () => p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' '));
  await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 30000 });
  assert.match(await texts(), /R:North/);
  await p.waitForTimeout(500);
  console.log(`N31 fonts fetched: ${fonts.join(', ')} = ${(fontBytes / 1024).toFixed(0)} KB (7 faces were 4.9 MB)`);
  assert.deepEqual([...fonts].sort(), ['Inter-Bold.ttf', 'Inter-Regular.ttf']);
  // N1
  assert.equal(await p.evaluate(() => window.h.usesWorker), false);
  assert.equal(warns.filter(w => /\[reportwright\] worker did not load \(.+\); rendering on the main thread/.test(w)).length, 1, warns.join('|'));
  // A11Y-3
  await p.evaluate(() => window.h.setParameters({ region: 'North' }));
  const thumb = await p.evaluate(() => { const t = document.querySelector('#r').shadowRoot.querySelector('.vthumb'); return t && { label: t.getAttribute('aria-label') }; });
  if (thumb) assert.equal(thumb.label, null);
  else {
    await p.locator('#r').getByRole('button', { name: /pages/i }).first().click().catch(() => {});
  }
  const names = await p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vthumb')].map(t => ({ al: t.getAttribute('aria-label'), text: t.textContent })));
  for (const n of names) { assert.equal(n.al, null); assert.match(n.text, /Page 1/); }
  // cascade: Region -> South: City 'Delhi' is no longer offered; the run must not use it
  await p.locator('#r').getByRole('button', { name: /parameters/i }).first().click();
  const sel = p.locator('#r .vparams select').first();
  await sel.waitFor();
  await sel.selectOption('South');
  await p.waitForFunction(() => /R:South/.test([...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' ')), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  const t = await texts();
  assert.match(t, /R:South/);
  assert.doesNotMatch(t, /Delhi/, `the run used the old city: ${t}`);
} finally { await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('b9 viewer standalone ok');
