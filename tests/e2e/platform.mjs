// Phase 7: the designer embedded on another origin (mountDesigner) and a password-protected PDF from the render API.
//   BASE=http://localhost:3230 KEY=test-key node tests/e2e/platform.mjs
//   (the server must be built with PW_EMBED_ORIGINS=http://localhost:4000 and run with PW_API_KEYS=test-key)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const BASE = process.env.BASE || 'http://localhost:3000';
const KEY = process.env.KEY || 'test-key';
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const DEF = { $schema: 'reportwright/report@1', name: 'Embedded', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [],
  sections: { body: { items: [{ id: 'hello', type: 'textbox', name: 'Hello', x: 0, y: 0, w: 200, h: 24, value: 'Hello from the host' }] } } };
const MODES = {
  edit: `{ toolbox: { hide: ['map', 'chart'] }, dataSourceTemplates: [{ label: 'Orders API', source: { name: 'orders', type: 'json', data: { rows: [{ id: 1 }] } } }],
    onSave: (d) => { window.__saved = d; }, onOpen: () => ({ ...${JSON.stringify(DEF)}, name: 'Opened by the host' }) }`,
  ro: `{ readOnly: true }`,
  nodata: `{ panels: { data: false }, onSave: () => {} }`,
};
// the framework wrappers, as an app would load them: React bundled with the app, @reportwright/viewer from the server
const reactApp = (await build({ stdin: { contents: `
  import { createElement } from 'react'; import { createRoot } from 'react-dom/client';
  import { ReportWrightViewer } from './packages/react/dist/index.js';
  createRoot(document.getElementById('react')).render(createElement(ReportWrightViewer, { server: '${BASE}', report: 'loan-statement',
    params: { accountId: 'LN-2025-001982' }, style: { height: '500px' }, onReady: () => { window.__reactReady = true; } }));`, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, format: 'esm', write: false, external: ['@reportwright/viewer', '@reportwright/viewer/designer'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' })).outputFiles[0].text;
const WRAPPERS = `<script type="importmap">{ "imports": { "@reportwright/viewer": "${BASE}/embed/esm/viewer.js", "@reportwright/viewer/designer": "${BASE}/embed/esm/designer.js" } }</script>
<div id="react"></div><div id="svelte" style="height:500px"></div>
<reportwright-designer id="ng" server="${BASE}" height="500px"></reportwright-designer>
<script type="module" src="/react.js"></script>
<script type="module">
  import { reportWrightViewer } from '/pkg/svelte/dist/index.js';
  import { defineReportWrightElements } from '/pkg/angular/dist/index.js';
  reportWrightViewer(document.getElementById('svelte'), { server: '${BASE}', report: 'loan-statement', params: { accountId: 'LN-2025-001982' }, height: '480px', onReady: () => { window.__svelteReady = true; } });
  const ng = document.getElementById('ng');
  ng.addEventListener('pw-ready', (e) => { window.__ngHandle = e.detail; });
  ng.addEventListener('pw-save', (e) => { window.__ngSaved = e.detail; });
  ng.options = { definition: ${JSON.stringify(DEF)} };
  defineReportWrightElements();
</script>`;
const host = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/react.js') { res.setHeader('content-type', 'text/javascript'); return res.end(reactApp); }
  if (url.pathname.startsWith('/pkg/')) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(`packages/${url.pathname.slice(5).replace(/\.\./g, '')}`)); }
  if (url.pathname === '/wrappers') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><meta charset="utf-8">${WRAPPERS}`); }
  const mode = url.searchParams.get('mode') || 'edit';
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:Georgia,serif} .btn{background:red}</style>
<input id="hostInput" placeholder="the host's own input"><div id="d"></div>
<script src="${BASE}/embed/reportwright-viewer.js"></script>
<script>window.__pw = ReportWright.mountDesigner('#d', Object.assign({ server: '${BASE}', definition: ${JSON.stringify(DEF)}, height: '820px' }, ${MODES[mode]}));</script>`);
}).listen(4000);

const b = await chromium.launch();
const errs = [];
const open = async (mode) => {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:4000/?mode=${mode}`);
  await p.waitForSelector('[data-testid="designer"]', { timeout: 60000 });
  return p;
};
const items = (p) => p.evaluate(async () => (await window.__pw).getDefinition().sections.body.items.length);

try {
  step('toolbox options hide tools; the designer fills the host element');
  const p = await open('edit');
  const tools = await p.locator('[data-tool]').evaluateAll(ns => ns.map(n => n.dataset.tool));
  assert.ok(tools.includes('textbox') && !tools.includes('map') && !tools.includes('chart'), `tools: ${tools}`);
  const w = await p.locator('[data-testid="designer"]').evaluate(n => n.getBoundingClientRect().width);
  assert.ok(w >= 1400, `full width: ${w}`);
  // @font-face does not work inside a shadow root: the report fonts are declared on the host page and load from the server
  await p.waitForFunction(() => [...document.fonts].some(f => f.family.replace(/"/g, '').startsWith('pw-') && f.status === 'loaded'), null, { timeout: 20000 });
  await p.screenshot({ path: '/tmp/shots/p7-designer-embed.png' });

  step('a data source template adds a source');
  await p.locator('[data-testid="source-templates"]').selectOption({ label: 'Orders API' });
  assert.ok((await p.evaluate(async () => (await window.__pw).getDefinition().dataSources.map(s => s.name))).includes('orders'));

  step('add a text box; Backspace typed in the inspector edits text and does not delete the item');
  await p.locator('[data-tool="textbox"]').click();
  assert.equal(await items(p), 2);
  const name = p.locator('.dright input').first();
  await name.click();
  await name.press('End');
  await name.press('Backspace');
  assert.equal(await items(p), 2, 'Backspace in an input inside the shadow root is typing');
  step("keys typed in the host page's own input never reach the designer");
  await p.locator('#hostInput').click();
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Delete');
  assert.equal(await items(p), 2);

  step('Save calls onSave with the definition');
  await p.locator('[data-testid="save"]').click();
  await p.waitForFunction(() => window.__saved);
  assert.equal(await p.evaluate(() => window.__saved.sections.body.items.length), 2);
  step('Open… loads what onOpen returns');
  await p.locator('[data-testid="open"]').click();
  await p.waitForFunction(async () => (await window.__pw).getDefinition().name === 'Opened by the host');

  step('read-only: no Save, no toolbox, Delete does nothing');
  const r = await open('ro');
  assert.equal(await r.locator('[data-testid="save"]').count(), 0);
  assert.equal(await r.locator('[data-tool]').count(), 0);
  await r.locator('[data-item="Hello"]').click();
  await r.keyboard.press('Delete');
  await r.keyboard.press('Backspace');
  assert.equal(await items(r), 1);
  await r.screenshot({ path: '/tmp/shots/p7-designer-readonly.png' });

  step('panels: { data: false } hides the data panel');
  const n = await open('nodata');
  assert.equal(await n.getByText('Data sources').count(), 0);
  assert.ok(await n.locator('[data-tool]').count() > 10);

  step('render API: a password-protected PDF');
  const res = await fetch(`${BASE}/api/v1/render`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ template: 'loan-statement', format: 'pdf', parameters: { accountId: 'LN-2025-001982' }, pdf: { userPassword: 'öpen sesame', permissions: { copy: false } } }) });
  assert.equal(res.status, 200, await res.clone().text().catch(() => ''));
  const f = '/tmp/shots/p7-encrypted.pdf';
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  const info = execFileSync('pdfinfo', ['-upw', 'öpen sesame', f]).toString();
  assert.match(info, /Encrypted:\s+yes .*copy:no.*AES-256/);
  assert.throws(() => execFileSync('pdfinfo', [f], { stdio: 'pipe' }));
  const bad = await fetch(`${BASE}/api/v1/render`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ template: 'loan-statement', format: 'pdf', pdfa: true, pdf: { userPassword: 'secret-pw' } }) });
  assert.equal(bad.status, 400);
  assert.ok(!(await bad.text()).includes('secret-pw'), 'no password in the error');

  step('framework wrappers: React component, Svelte action, Angular custom element');
  const wp = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  wp.on('pageerror', e => errs.push(e.message));
  wp.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text()); });
  await wp.goto('http://localhost:4000/wrappers');
  await wp.waitForFunction(() => window.__reactReady && window.__svelteReady && window.__ngHandle, null, { timeout: 60000 })
    .catch(async (e) => { console.log('  state:', await wp.evaluate(() => ({ react: !!window.__reactReady, svelte: !!window.__svelteReady, angular: !!window.__ngHandle }))); throw e; });
  // the React component renders its own <div> (the viewer's host); the Svelte action uses the element it is on
  await wp.waitForFunction(() => [document.getElementById('react').firstElementChild, document.getElementById('svelte')].every(el => el?.shadowRoot?.querySelector('.vpage svg')), null, { timeout: 60000 });
  await wp.evaluate(() => window.__ngHandle.save());
  await wp.waitForFunction(() => window.__ngSaved?.name === 'Embedded');
  const box = await wp.evaluate(() => { const d = document.getElementById('react').firstElementChild; return [d.getBoundingClientRect().height, d.shadowRoot.querySelector('.pw-embed').getBoundingClientRect().height]; });
  assert.deepEqual(box, [500, 500], 'the React viewer fills the height given to it');
  await wp.screenshot({ path: '/tmp/shots/p7-wrappers.png', fullPage: true });

  assert.deepEqual(errs, [], 'no page errors');
  console.log('platform e2e: OK');
} finally {
  await b.close();
  host.close();
}
