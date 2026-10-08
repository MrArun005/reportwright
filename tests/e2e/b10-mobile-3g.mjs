// Time to the first page on a phone: Chrome's "Fast 3G" preset (≈1.44 Mbit/s down, 562.5 ms latency) and a 4x slower
// CPU, the embedded viewer showing a 2,000-row table. Served by a real HTTP server with gzip (throttling does not apply
// to Playwright-fulfilled responses). Run node scripts/build-embed.mjs first. BUDGET_MS fails the run when exceeded.
import { chromium } from 'playwright';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, customer: `Customer ${i % 97}`, city: ['Pune', 'Delhi', 'Kochi'][i % 3], amount: (i * 37.31) % 9000 }));
const definition = {
  $schema: 'reportwright/report@1', name: 'Mobile', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'D', source: 's', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 520, h: 40, dataSet: 'D', columns: [{ width: 60 }, { width: 200 }, { width: 120 }, { width: 140 }],
    header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Customer' }, { value: 'City' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.id' }, { value: '=Fields.customer' }, { value: '=Fields.city' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] } },
};
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="r" style="height:100vh"></div>
<script type="module">import { mountViewer } from '/pw/viewer.js'; mountViewer('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/' });</script>`;
let bytes = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body, type = 'text/html';
  if (u.pathname === '/') body = Buffer.from(html);
  else {
    const pre = Object.keys(FILES).find((k) => u.pathname.startsWith(k));
    const f = u.pathname === '/harfbuzz-subset.wasm' ? path.join(root, 'packages/fonts/public/harfbuzz-subset.wasm') : pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    body = fs.readFileSync(f); type = TYPES[path.extname(f)] || 'application/octet-stream';
  }
  const gz = zlib.gzipSync(body); bytes += gz.length;
  res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': 'no-store' }); res.end(gz);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 180000 });
const ms = Date.now() - t0;
await browser.close(); server.close();
console.log(`first page on Fast 3G + 4x CPU: ${(ms / 1000).toFixed(1)} s, ${(bytes / 1024).toFixed(0)} KB transferred (gzip)`);
if (process.env.BUDGET_MS && ms > Number(process.env.BUDGET_MS)) { console.error(`over budget ${process.env.BUDGET_MS} ms`); process.exit(1); }
