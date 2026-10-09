// B5 item 15: @reportwright/react in a real React app (no server): the dynamic import's failure shows in the element,
// re-renders with an inline definition object do not remount the designer, and the viewer shows a standalone report.
// Run after npm run build:packages. Playwright answers every request from memory and disk (no HTTP server).
import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const nm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-react-')), 'node_modules');
fs.mkdirSync(path.join(nm, '@reportwright'), { recursive: true });
fs.symlinkSync(path.join(root, 'packages/viewer'), path.join(nm, '@reportwright/viewer'));
const stub = path.join(path.dirname(nm), 'broken.js');
fs.writeFileSync(stub, "throw new Error('the viewer chunk failed to load');");
const app = `
import { createElement as h, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/react';
window.mounts = 0;
function App() {
  const [n, setN] = useState(0);
  useEffect(() => { if (n < 3) setTimeout(() => setN(n + 1), 300); }, [n]);
  return h('div', null,
    h('p', { id: 'n' }, String(n)),
    h(ReportWrightDesigner, { definition: { $schema: 'reportwright/report@1', name: 'Inline', sections: { body: { items: [] } } }, fontsUrl: '/pw-fonts/', onReady: () => { window.mounts++; }, style: { height: 400 } }),
    h('div', { id: 'v' }, h(ReportWrightViewer, { definition: DEF, data: { s: { rows: [{ a: 'Hello from React' }] } }, fontsUrl: '/pw-fonts/', params: { x: '1' }, style: { height: 300 } })));
}
const DEF = { $schema: 'reportwright/report@1', name: 'R', dataSources: [{ name: 's', type: 'json', data: {} }], dataSets: [{ name: 'D', source: 's', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', x: 0, y: 0, w: 200, h: 20, dataSet: 'D', columns: [{ width: 200 }], detail: [{ cells: [{ value: '=Fields.a' }] }] }] } } };
createRoot(document.getElementById('root')).render(h(App));
`;
const bundle = async (alias) => (await build({ stdin: { contents: app, resolveDir: root }, bundle: true, format: 'esm', splitting: true, outdir: '/out', write: false, logLevel: 'silent',
  alias: { '@reportwright/react': path.join(root, 'packages/react/dist/index.js'), ...alias }, nodePaths: [nm, path.join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles;
const good = await bundle({});
const bad = await bundle({ '@reportwright/viewer/react-peer': stub, '@reportwright/viewer/react-peer/designer': stub });

const b = await chromium.launch();
const run = async (files) => {
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('http://app.test/**', (route) => {
    const u = new URL(route.request().url()).pathname;
    if (u === '/') return route.fulfill({ body: '<!doctype html><div id="root"></div><script type="module" src="/out/stdin.js"></script>', contentType: 'text/html' });
    const f = files.find(x => x.path === u);
    if (f) return route.fulfill({ body: Buffer.from(f.contents), contentType: 'text/javascript' });
    if (u.startsWith('/pw-fonts/')) return route.fulfill({ body: fs.readFileSync(path.join(root, 'packages/fonts/public/fonts', u.slice(10))), contentType: 'font/ttf' });
    return route.fulfill({ status: 404, body: '' });
  });
  await p.goto('http://app.test/');
  return { p, errs };
};
{
  const { p, errs } = await run(good);
  await p.waitForFunction(() => document.getElementById('n')?.textContent === '3' && window.mounts > 0, null, { timeout: 30000 });
  await p.waitForFunction(() => [...document.querySelectorAll('#v *')].some(e => e.shadowRoot?.querySelector('.vpage text')), null, { timeout: 30000 });
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => window.mounts), 1, 'the designer remounted on a re-render with an inline definition');
  const t = await p.evaluate(() => [...document.querySelectorAll('#v *')].map(e => e.shadowRoot?.textContent || '').join(' '));
  assert.match(t, /Hello from React/);
  assert.deepEqual(errs, []);
}
{
  const { p } = await run(bad);
  await p.waitForSelector('[role="alert"]', { timeout: 30000 });
  assert.match(await p.locator('[role="alert"]').first().innerText(), /ReportWright did not load: the viewer chunk failed to load/);
}
await b.close();
fs.rmSync(path.dirname(nm), { recursive: true, force: true });
console.log('react wrapper: OK');
