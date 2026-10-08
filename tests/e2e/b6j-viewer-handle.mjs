// b6j: the ViewerHandle returned by mountViewer drives a mounted viewer (setParameters, setDefinition, goToPage,
// getPageCount, print, export, on). Standalone (definition + data), bundled from src/embed/index.js, no server.
// Checks: setParameters re-renders with the new value and does NOT remount the host element; events fire; export
// returns a PDF Blob; a failed server load fires 'error'.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const ORIGIN = 'http://static.test';
const bundle = await build({
  entryPoints: [path.join(root, 'src/embed/index.js')], bundle: true, format: 'iife', write: false, target: ['es2020'],
  alias: { '@': path.join(root, 'src'), 'next/link': path.join(root, 'src/embed/link.js') },
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"', __PW_CSS__: '""' },
  plugins: [{ name: 'i18n-embed', setup: (b) => b.onResolve({ filter: /(^|\/)i18n\/index\.js$/ }, () => ({ path: path.join(root, 'src/i18n/embed.js') })) }],
  logOverride: { 'empty-import-meta': 'silent', 'unsupported-dynamic-import': 'silent' },
}).then(r => r.outputFiles[0].text);

const rows = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, who: i % 2 ? 'Ben Ode' : 'Asha Rao' }));
const definition = (_title, n = 120) => ({
  $schema: 'pagewright/report@1', name: _title, page: { size: 'A4', margins: [36, 36, 36, 36] },
  parameters: [{ name: 'who', type: 'string', default: 'Asha Rao' }],
  dataSources: [{ name: 'src', type: 'json', data: { rows: rows(n) } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { body: { items: [
    { type: 'textbox', name: 'Title', x: 0, y: 0, w: 400, h: 20, value: '=Parameters.who' },
    { type: 'table', name: 'T', x: 0, y: 40, w: 400, h: 40, dataSet: 'Rows', repeatHeader: true, columns: [{ width: 200 }, { width: 200 }],
      header: [{ height: 16, cells: [{ value: 'No' }, { value: 'Who' }] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.who' }] }] },
  ] } },
});
const html = `<!doctype html><meta charset="utf-8"><div id="r" style="width:700px;height:600px"></div><script>${bundle}</script>
<script>
  window.ev = [];
  window.v = ReportWright.mountViewer('#r', { definition: ${JSON.stringify(definition('Alpha'))}, fontsUrl: '/pw-fonts/' });
  v.on('ready', (d) => ev.push(['ready', d.pages]));
  v.on('parameters', (d) => ev.push(['parameters', d.who]));
  v.on('page', (d) => ev.push(['page', d]));
  window.defA = ${JSON.stringify(definition('Beta', 3))};
</script>`;

const FILES = { '/pw-fonts/': path.join(root, 'public/fonts/'), '/pw-public/': path.join(root, 'public/') };
const TYPES = { '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.icc': 'application/octet-stream' };
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
});
await p.goto(`${ORIGIN}/`);
const text = () => p.evaluate(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' '));
const waitFor = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 }).catch(async (e) => { throw new Error(`${e.message} ev=${JSON.stringify(await p.evaluate(() => window.ev || null))}`); });

// the first run
await waitFor(() => window.ev.some(e => e[0] === 'ready'));
assert.match(await text(), /^Asha Rao /);
assert.equal(await p.evaluate(() => v.getPageCount()) > 1, true, 'the table makes more than one page');
const before = await p.evaluate(() => { const r = document.querySelector('#r'); window.__host = r; return { host: r.shadowRoot.querySelector('.pw-embed') !== null } });
assert.equal(before.host, true);

// setParameters: the new value shows, the same host element and shadow root stay (no remount)
await p.evaluate(() => { window.__root0 = document.querySelector('#r').shadowRoot.querySelector('.pw-embed'); window.__host0 = document.querySelector('#r'); });
await p.evaluate(() => v.setParameters({ who: 'Ben Ode' }));
await waitFor(() => window.ev.some(e => e[0] === 'parameters' && e[1] === 'Ben Ode'));
await waitFor(() => [...document.querySelector('#r').shadowRoot.querySelectorAll('.vpage text')].map(n => n.textContent).join(' ').startsWith('Ben Ode '));
assert.match(await text(), /^Ben Ode /);
assert.equal(await p.evaluate(() => document.querySelector('#r') === window.__host0 && document.querySelector('#r').shadowRoot.querySelector('.pw-embed') === window.__root0), true, 'not remounted');

// goToPage fires 'page'
await p.evaluate(() => v.goToPage(2));
await waitFor(() => window.ev.some(e => e[0] === 'page' && e[1] === 2));

// setDefinition shows another report in the same element
await p.evaluate(() => v.setDefinition(window.defA));
await waitFor(() => window.ev.filter(e => e[0] === 'ready').length >= 2);
assert.match(await text(), /^Asha Rao /);
assert.equal(await p.evaluate(() => v.getPageCount()), 1);

// export returns a PDF Blob; the aliases work
const pdf = await p.evaluate(async () => { const b = await v.export('pdf'); return { type: b.type, head: new TextDecoder().decode(new Uint8Array(await b.slice(0, 5).arrayBuffer())) }; });
assert.equal(pdf.head, '%PDF-');
const xl = await p.evaluate(async () => (await v.export('excel')).size > 0);
assert.equal(xl, true);
await p.evaluate(() => v.print()); // resolves without throwing

// unsubscribe works
const n = await p.evaluate(() => { let c = 0; const off = v.on('parameters', () => c++); off(); v.setParameters({ who: 'Asha Rao' }); return c; });
await p.waitForTimeout(300);
assert.equal(n, 0);

// a server that cannot be reached: 'error' (its own page: the server mode is module-global state)
const p2 = await (await b.newContext()).newPage();
await p2.setContent(`<!doctype html><div id="e"></div><script>${bundle}</script><script>window.ev=[];const ve=ReportWright.mountViewer('#e',{server:'http://127.0.0.1:9',report:'nope'});ve.on('error',d=>ev.push(['error',d.message]));</script>`);
await p2.waitForFunction(() => window.ev.length > 0, null, { timeout: 30000 });
assert.equal(await p2.evaluate(() => ev[0][0]), 'error');

assert.deepEqual(errs, [], `page errors: ${errs}`);
await b.close();
console.log('b6j-viewer-handle: ok');
