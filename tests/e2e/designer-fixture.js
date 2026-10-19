// The page the designer specs drive: the embedded designer (public/embed/esm/designer.js, the same Designer the app's
// /designer page shows) mounted on https://designer.test (served by page.route, so the clipboard API is available: it
// needs a secure origin), with its handle as window.h. And the embedded viewer, for what the designer's report prints.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
export const ORIGIN = 'https://designer.test';
const FILES = {
  '/pw/': path.join(root, 'public/embed/esm/'),
  '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/'),
};
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };

/** A report with an item in every band, a data set and room in the body. */
export const bands = () => ({
  $schema: 'reportwright/report@1',
  name: 'Bands',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [
    {
      name: 'src',
      type: 'json',
      data: [
        { region: 'N', amount: 3 },
        { region: 'S', amount: 5 },
      ],
    },
  ],
  dataSets: [
    {
      name: 'D',
      source: 'src',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
  ],
  sections: {
    pageHeader: {
      height: 60,
      items: [{ type: 'textbox', name: 'Head', x: 0, y: 4, w: 160, h: 20, value: 'Header text' }],
    },
    body: {
      height: 420,
      items: [
        { type: 'textbox', name: 'T1', x: 10, y: 10, w: 120, h: 20, value: 'Hello' },
        {
          type: 'table',
          name: 'Tab',
          x: 0,
          y: 60,
          w: 300,
          h: 36,
          dataSet: 'D',
          columns: [{ width: 150 }, { width: 150 }],
          header: [{ height: 18, cells: [{ value: 'Region' }, { value: 'Amount' }] }],
          detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }] }],
        },
        {
          type: 'container',
          name: 'Box',
          x: 0,
          y: 200,
          w: 320,
          h: 80,
          items: [
            {
              type: 'table',
              name: 'Inner',
              x: 0,
              y: 0,
              w: 300,
              h: 36,
              dataSet: 'D',
              columns: [{ width: 150 }, { width: 150 }],
              detail: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }] }],
            },
          ],
        },
      ],
    },
    pageFooter: {
      height: 40,
      items: [{ type: 'textbox', name: 'Foot', x: 0, y: 4, w: 160, h: 20, value: 'Footer text' }],
    },
  },
});

/** Serve the host page and the embed files on ORIGIN for one page. */
export async function serve(page, { definition = bands(), viewer = false } = {}) {
  const app = viewer
    ? `import { mountViewer } from '/pw/viewer.js';
window.v = mountViewer('#d', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px', onReady: (e) => { window.ready = e ? String(e) : true; } });
window.pages = []; window.v.on('page', (d) => window.pages.push(d?.page ?? d));`
    : `import { mountDesigner } from '/pw/designer.js';
window.saves = [];
window.h = mountDesigner('#d', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '960px', onSave: (d) => { window.saves.push(d); } });`;
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/')
      return route.fulfill({
        body: '<!doctype html><html lang="en"><meta charset="utf-8"><title>designer e2e</title><main><div id="d"></div></main><script type="module" src="/app.js"></script>',
        contentType: 'text/html',
      });
    if (u.pathname === '/app.js') return route.fulfill({ body: app, contentType: 'text/javascript' });
    const pre = Object.keys(FILES).find((k) => u.pathname.startsWith(k));
    const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
    if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      body: fs.readFileSync(f),
      contentType: TYPES[path.extname(f)] || 'application/octet-stream',
    });
  });
  await page.goto(`${ORIGIN}/`);
}

/** The designer on a page, with what the specs ask of it. */
export class Designer {
  constructor(page) {
    this.page = page;
    this.errors = [];
    page.on('pageerror', (e) => this.errors.push(e.message));
    this.root = page.locator('#d');
  }
  async open(definition) {
    await serve(this.page, { definition });
    await this.root.locator('[data-testid=paper]').waitFor({ timeout: 60000 });
    await this.page.waitForTimeout(300);
  }
  def() {
    return this.page.evaluate(() => window.h.getDefinition());
  }
  /** Where an item is: its band and its container (null at the top of a band), or null when there is none. */
  async where(name) {
    return this.page.evaluate((name) => {
      const d = window.h.getDefinition();
      const bands = [
        ['pageHeader', d.sections.pageHeader],
        ['body', d.sections.body],
        ['pageFooter', d.sections.pageFooter],
      ];
      for (const [band, b] of bands) {
        const go = (items, parent) => {
          for (const it of items || []) {
            if (it.name === name) return { band, parent, item: it };
            const r = go(it.items, it.name);
            if (r) return r;
          }
          return null;
        };
        const r = go(b?.items, null);
        if (r) return r;
      }
      return null;
    }, name);
  }
  names(band) {
    return this.page.evaluate((band) => window.h.getDefinition().sections[band].items.map((i) => i.name), band);
  }
  item(name) {
    return this.root.locator(`[data-item="${name}"]`).first();
  }
  band(section) {
    return this.root.locator(`.band[data-section="${section}"]`).first();
  }
  async select(name, position = { x: 4, y: 4 }) {
    await this.item(name).click({ position });
    await expect(this.root.locator('[data-testid=status-selection]')).toContainText(name);
  }
  /** Select by the outline (a click on a table selects one of its cells). */
  async pick(name) {
    await this.root.locator('[data-testid=rail-outline]').click();
    await this.root.locator(`[data-outline="${name}"] [data-opt]`).first().click();
    await expect(this.root.locator('[data-testid=status-selection]')).toContainText(name);
  }
  async selectBand(section) {
    // the label sits just before its band
    await this.band(section).locator('xpath=preceding-sibling::div[contains(@class, "band-label")][1]').click();
    await expect(this.root.locator('[data-testid=status-selection]')).not.toContainText(/item|cell/i);
  }
  /** Click a toolbox entry (the left rail's Insert list). */
  async insert(type) {
    await this.root
      .locator(`[data-testid=rail-tools]`)
      .click()
      .catch(() => {});
    await this.root.locator(`.tool[data-tool="${type}"]`).click();
  }
  /** Drag an item by the mouse to a point in a band (fractions of the band's box). */
  async drag(name, section, fx = 0.5, fy = 0.5) {
    const from = await this.item(name).boundingBox();
    const to = await this.band(section).boundingBox();
    const m = this.page.mouse;
    await m.move(from.x + 6, from.y + 6);
    await m.down();
    const tx = to.x + to.width * fx,
      ty = to.y + to.height * fy;
    for (let i = 1; i <= 8; i++)
      await m.move(from.x + 6 + ((tx - from.x - 6) * i) / 8, from.y + 6 + ((ty - from.y - 6) * i) / 8);
    await m.up();
    await this.page.waitForTimeout(150);
  }
  /** Keyboard shortcuts with the platform's modifier. */
  async key(k) {
    const webkit = k === 'v' && this.page.context().browser()?.browserType().name() === 'webkit';
    if (webkit)
      await this.page.evaluate(() => {
        window.__pasted = false;
        window.addEventListener('paste', () => (window.__pasted = true), { capture: true, once: true });
      });
    await this.page.keyboard.press(`ControlOrMeta+${k}`);
    await this.page.waitForTimeout(80);
    // Headless WebKit on Linux has no key binding for Ctrl+V outside a text field: no paste event at all (macOS WebKit
    // and Safari send one). Then send the one WebKit sends: to the document's focused element (the embed's shadow host),
    // with no clipboard text, so the designer's own paste handler runs and pastes this tab's copy. A paste event that
    // came and was ignored is not replaced: the spec fails as it should.
    if (webkit && !(await this.page.evaluate(() => window.__pasted))) {
      await this.page.evaluate(() =>
        (document.activeElement || document.body).dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true }),
        ),
      );
      await this.page.waitForTimeout(80);
    }
  }
  async issues() {
    const btn = this.root.locator('[data-testid=issues]');
    if (!(await btn.count())) return [];
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    return this.root.locator('[data-testid=issues-list] li').allInnerTexts();
  }
}

export const test = base.extend({
  designer: async ({ page }, use) => {
    const d = new Designer(page);
    await use(d);
    expect(d.errors, 'no page errors').toEqual([]);
  },
});
export { expect };
