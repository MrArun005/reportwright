// Shared harness for the designer browser tests (tests/designer/*.test.mjs).
// The embedded designer (public/embed/esm, built by `node scripts/build-embed.mjs`) is served by a small local HTTP
// server and mounted with mountDesigner, so no Next.js server is needed. BROWSER=chromium|firefox|webkit picks the
// engine (default chromium). Every console.error and uncaught page error fails the test that caused it (expectClean).
import { chromium, firefox, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

export const root = path.join(import.meta.dirname, '..', '..');
const ESM = path.join(root, 'public/embed/esm');
const FONTS = [path.join(root, 'packages/fonts/public/fonts'), path.join(root, 'public/fonts')].find((p) =>
  fs.existsSync(p),
);
const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.html': 'text/html',
  '.json': 'application/json',
  '.css': 'text/css',
};
export const BROWSER = process.env.BROWSER || 'chromium';
const ENGINES = { chromium, firefox, webkit };

let AXE = null;
try {
  AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
} catch {
  /* axe-core not installed */
}
export const axeSource = () => AXE;

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>designer test</title>
<body style="margin:0"><div id="d"></div><script type="module" src="/app.js"></script>`;
// window.__RW (set by an init script) holds the definition and options of the case
const APP = `import { mountDesigner } from '/pw/designer.js';
const o = window.__RW || {};
window.__saved = [];
window.__opened = 0;
window.h = mountDesigner('#d', { definition: o.def, fontsUrl: '/pw-fonts/', height: o.height || '100vh', lang: o.lang,
  readOnly: !!o.readOnly, toolbox: o.toolbox, panels: o.panels, warnOnLeave: false,
  onSave: (d) => { window.__saved.push(d); },
  ...(o.openDef ? { onOpen: () => { window.__opened++; return o.openDef; } } : {}) });`;

/** Serve the designer bundle, the fonts and the test page. @returns {Promise<{ url: string, close: () => Promise<void> }>} */
export function startServer() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (u.pathname === '/' || u.pathname === '/index.html') return send(200, 'text/html', PAGE);
    if (u.pathname === '/app.js') return send(200, 'text/javascript', APP);
    const map = [
      ['/pw/', ESM],
      ['/pw-fonts/', FONTS],
    ].find(([p]) => u.pathname.startsWith(p));
    if (!map) return send(404, 'text/plain', 'not found');
    const file = path.normalize(path.join(map[1], decodeURIComponent(u.pathname.slice(map[0].length))));
    if (!file.startsWith(map[1])) return send(403, 'text/plain', 'no');
    fs.readFile(file, (err, buf) =>
      err
        ? send(404, 'text/plain', 'not found')
        : send(200, TYPES[path.extname(file)] || 'application/octet-stream', buf),
    );
  });
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () =>
      ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }),
    ),
  );
}

/** A blank report with optional body items and bands. */
export function report(items = [], more = {}) {
  return {
    $schema: 'reportwright/report@1',
    name: 'Test',
    page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [],
    dataSets: [],
    ...more,
    sections: {
      pageHeader: { height: 40, items: [] },
      body: { height: 400, items },
      pageFooter: { height: 30, items: [] },
      ...(more.sections || {}),
    },
  };
}
export const tb = (name, x, y, w = 100, h = 20, more = {}) => ({
  type: 'textbox',
  name,
  x,
  y,
  w,
  h,
  value: name,
  ...more,
});

/**
 * One browser for a test file. Usage: const env = await setup(); ... await env.close();
 * env.open(def, opts) gives a Designer page object (a fresh context each time).
 */
export async function setup({ viewport = { width: 1600, height: 1000 } } = {}) {
  const server = await startServer();
  const engine = ENGINES[BROWSER];
  if (!engine) throw new Error(`BROWSER=${BROWSER}: expected chromium, firefox or webkit`);
  const browser = await engine.launch();
  const pages = [];
  return {
    browser,
    server,
    async open(def, opts = {}) {
      const ctx = await browser.newContext({
        viewport: opts.viewport || viewport,
        ...(BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
      });
      const page = await ctx.newPage();
      const d = new Designer(page, ctx);
      await page.addInitScript(
        (o) => {
          window.__RW = o;
        },
        {
          def,
          lang: opts.lang,
          readOnly: opts.readOnly,
          toolbox: opts.toolbox,
          panels: opts.panels,
          height: opts.height,
          openDef: opts.openDef,
        },
      );
      await page.goto(`${server.url}/`);
      await page.locator('[data-testid="designer"]').waitFor({ timeout: 30000 });
      await page.locator('[data-testid="paper"]').waitFor({ timeout: 30000 });
      await d.settle();
      pages.push(d);
      return d;
    },
    async close() {
      for (const d of pages) await d.ctx.close().catch(() => {});
      await browser.close();
      await server.close();
    },
  };
}

export class Designer {
  constructor(page, ctx) {
    this.page = page;
    this.ctx = ctx;
    this.errors = [];
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error')
        this.errors.push(`console.error: ${m.text()}${m.location()?.url ? ` (${m.location().url})` : ''}`);
    });
  }
  /** Fail on any console.error or page error seen so far (and forget them). allow: regexes of expected ones. */
  expectClean(allow = []) {
    const bad = this.errors.filter((e) => !allow.some((r) => r.test(e)));
    this.errors = [];
    assert.deepEqual(bad, [], `console errors: ${bad.join('\n')}`);
  }
  /** Wait until the page stops moving: fonts loaded and the paper's box the same for a few frames (the "fit" zoom
   *  measures the canvas after the first paint; a click measured before that lands somewhere else). */
  async settle(timeout = 5000) {
    await this.page.evaluate(async (ms) => {
      const paper = () => document.querySelector('#d')?.shadowRoot?.querySelector('[data-testid="paper"]');
      await document.fonts?.ready;
      const end = performance.now() + ms;
      let last = '',
        same = 0;
      while (performance.now() < end && same < 4) {
        await new Promise((r) => requestAnimationFrame(() => r()));
        const b = paper()?.getBoundingClientRect();
        const k = b ? `${b.x}|${b.y}|${b.width}|${b.height}` : '';
        same = k && k === last ? same + 1 : 0;
        last = k;
      }
    }, timeout);
  }
  /** The definition as it is now. */
  def() {
    return this.page.evaluate(() => window.h.getDefinition());
  }
  dirty() {
    return this.page.evaluate(() => window.h.isDirty());
  }
  item(name) {
    return this.page.locator(`.it[data-item="${name}"]`).first();
  }
  /** Names of the selected items, in DOM order. */
  selected() {
    return this.page.locator('.it.sel').evaluateAll((els) => els.map((e) => e.dataset.item));
  }
  status() {
    return this.page.locator('[data-testid="status-selection"]').innerText();
  }
  band(key = 'body') {
    return this.page.locator(`.band[data-section="${key}"]`).first();
  }
  /** Find an item (nested too) by name in a definition. */
  static find(def, name) {
    let hit = null;
    const go = (list, band, parent) =>
      (list || []).forEach((it) => {
        if (!hit && it.name === name) hit = { ...it, band, parent };
        go(it.items, band, it.name);
      });
    const b = def.sections.body;
    go(def.sections.pageHeader?.items, 'pageHeader');
    (Array.isArray(b) ? b : [b]).forEach((s, i) => go(s.items, i ? `body:${i}` : 'body'));
    go(def.sections.pageFooter?.items, 'pageFooter');
    return hit;
  }
  async get(name) {
    return Designer.find(await this.def(), name);
  }
  /** Click an item (with modifiers: ['Shift'], ['ControlOrMeta']). Clicks its top left corner + 3 px (not a handle). */
  async click(name, modifiers = []) {
    const b = await this.item(name).boundingBox();
    for (const m of modifiers) await this.page.keyboard.down(m);
    await this.page.mouse.click(b.x + Math.min(6, b.width / 2), b.y + Math.min(6, b.height / 2));
    for (const m of modifiers) await this.page.keyboard.up(m);
  }
  /** Drag with the mouse from one page point to another in steps. */
  async drag(x0, y0, x1, y1, { steps = 8, modifiers = [] } = {}) {
    const m = this.page.mouse;
    await m.move(x0, y0);
    for (const k of modifiers) await this.page.keyboard.down(k);
    await m.down();
    for (let i = 1; i <= steps; i++) await m.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await m.up();
    for (const k of modifiers) await this.page.keyboard.up(k);
  }
  /** Drag an item by (dx, dy) CSS px from a point inside it. */
  async dragItem(name, dx, dy, opts) {
    const b = await this.item(name).boundingBox();
    const x = b.x + Math.min(6, b.width / 2),
      y = b.y + Math.min(6, b.height / 2);
    await this.drag(x, y, x + dx, y + dy, opts);
  }
  /** The canvas scale (CSS px per pt): the paper's width over the body width. */
  async scale(bodyWidth = 523.28) {
    const w = (await this.page.locator('[data-testid="paper"]').boundingBox()).width;
    return w / bodyWidth;
  }
  async press(keys) {
    for (const k of [].concat(keys)) await this.page.keyboard.press(k);
  }
  /** Focus the canvas (an empty spot of the scroll area) so keys go to the designer, not an input. */
  async focusCanvas() {
    await this.page
      .locator('.cscroll')
      .first()
      .click({ position: { x: 4, y: 4 } });
  }
  async undo(n = 1) {
    for (let i = 0; i < n; i++) await this.page.keyboard.press('ControlOrMeta+z');
  }
  async redo(n = 1) {
    for (let i = 0; i < n; i++) await this.page.keyboard.press('ControlOrMeta+Shift+z');
  }
  /** Paste text as a real paste event carries it (clipboardData), in every browser. */
  async pasteText(text) {
    await this.page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      const target = document.querySelector('#d').shadowRoot.activeElement || document.body;
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }),
      );
    }, text);
  }
  /** Run axe on the designer's shadow root. @returns the serious and critical violations. */
  async axe(rulesOff = []) {
    if (!AXE) throw new Error('axe-core is not installed');
    await this.page.addScriptTag({ content: AXE });
    return this.page.evaluate(async (off) => {
      const r = await window.axe.run(document, {
        resultTypes: ['violations'],
        rules: Object.fromEntries(off.map((k) => [k, { enabled: false }])),
      });
      return r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
    }, rulesOff);
  }
}

/** Every number in an item's box is finite and not negative; the box stays inside its band width. */
export function assertSaneGeometry(def, bodyWidth = 523.28) {
  const bad = [];
  const go = (list, w, where) =>
    (list || []).forEach((it) => {
      for (const k of ['x', 'y', 'w', 'h'])
        if (typeof it[k] !== 'number' || !Number.isFinite(it[k]) || it[k] < 0)
          bad.push(`${where}/${it.name}.${k}=${it[k]}`);
      if (it.x + it.w > w + 0.5 && it.type !== 'line') bad.push(`${where}/${it.name} right edge ${it.x + it.w} > ${w}`);
      go(it.items, it.w, `${where}/${it.name}`);
    });
  const b = def.sections.body;
  go(def.sections.pageHeader?.items, bodyWidth, 'pageHeader');
  (Array.isArray(b) ? b : [b]).forEach((s, i) => go(s.items, bodyWidth, `body${i}`));
  go(def.sections.pageFooter?.items, bodyWidth, 'pageFooter');
  assert.deepEqual(bad, [], `bad geometry: ${bad.join(', ')}`);
}
