// L. Languages, themes and window sizes: every UI language renders without errors and without clipped labels, Arabic
// mirrors the designer but not the page, light and dark pass axe (colour contrast), and the designer fits 1024 to
// 1920 px wide windows. SHOTS=<dir> keeps a screenshot of each case.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, report, tb } from './harness.mjs';

/** The languages of src/i18n (index.js LANGUAGES). */
const LANGUAGES_UNDER_TEST = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'pt-BR', 'zh'];

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

const SHOTS = process.env.SHOTS || '';
async function shot(d, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await d.page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
const def = () => report([tb('A', 20, 20), tb('Wide', 150, 80, 220, 24)]);

/** Select an item with the keyboard (so the Inspector shows its labels). */
async function selectA(d) {
  await d.item('A').focus();
  await d.page.keyboard.press('Enter');
  await d.page.locator('[data-testid="inspector"] input[aria-label]').first().waitFor();
}

/**
 * Labels whose text does not fit their box. Deliberate truncation is fine when it is marked (an ellipsis or a line
 * clamp) and the whole text is still offered (a title on the element or an ancestor, or an aria-label).
 */
function clippedLabels(page) {
  return page.evaluate(() => {
    const sr = document.querySelector('#d').shadowRoot;
    const SEL = [
      '.dbar .tb-btn',
      '.dbar .tb-cap',
      '.dbar .seg button',
      '.dbar .save-btn',
      '.dtop .saved',
      '.rail-tab',
      '.rail-tab span',
      '.dleft h4',
      '.tool-nm',
      '[data-testid="inspector"] .field > span',
      '[data-testid="inspector"] .cat-toggle',
      '.cbar label',
      '.dstatus > span',
      '.dstatus-sel',
    ];
    const out = [];
    for (const s of SEL)
      for (const el of sr.querySelectorAll(s)) {
        if (!el.getClientRects().length) continue; // not shown
        const cs = getComputedStyle(el);
        const wide = el.scrollWidth > el.clientWidth + 1;
        const tall = cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1;
        if (!wide && !tall) continue;
        let marked = false,
          offered = false;
        for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
          const c = getComputedStyle(n);
          if (c.textOverflow === 'ellipsis' || (c.webkitLineClamp && c.webkitLineClamp !== 'none')) marked = true;
          const full = (el.textContent || '').trim();
          if (
            (n.title && n.title.includes(full.slice(0, 12))) ||
            (n.getAttribute('aria-label') || '').includes(full.slice(0, 12))
          )
            offered = true;
        }
        if (marked && offered) continue;
        out.push(
          `${s} "${(el.textContent || '').trim().slice(0, 40)}" ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}${marked ? ' (ellipsis, no full text)' : ''}`,
        );
      }
    return out;
  });
}

for (const lang of LANGUAGES_UNDER_TEST) {
  test(`language ${lang}: renders without errors, no clipped toolbar, rail, Inspector or status labels`, async () => {
    const d = await env.open(def(), { lang });
    const dir = await d.page.locator('[data-testid="designer"]').getAttribute('dir');
    assert.equal(dir, lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal(await d.page.locator('[data-testid="designer"]').getAttribute('lang'), lang);
    // the UI is in this language: the Inspector rail tab label differs from English unless the language is English
    await selectA(d);
    await shot(d, `lang-${lang}`);
    const bad = await clippedLabels(d.page);
    assert.deepEqual(bad, [], `${lang}: clipped labels`);
    const hscroll = await d.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert.equal(hscroll, false, `${lang}: horizontal page scroll`);
    d.expectClean();
  });
}

test('the languages under test are all the designer languages', async () => {
  const { LANGUAGES } = await import('../../src/i18n/index.js').catch(() => ({ LANGUAGES: null }));
  if (LANGUAGES) assert.deepEqual([...LANGUAGES].sort(), [...LANGUAGES_UNDER_TEST].sort());
  // the labels change with the language (no English left on the rail)
  const en = await env.open(def(), { lang: 'en' });
  const enTabs = await en.page.locator('.rail-tab span').allInnerTexts();
  en.expectClean();
  for (const lang of LANGUAGES_UNDER_TEST.filter((l) => l !== 'en')) {
    const d = await env.open(def(), { lang });
    const tabs = await d.page.locator('.rail-tab span').allInnerTexts();
    assert.notDeepEqual(tabs, enTabs, `${lang}: rail tabs are still English`);
    d.expectClean();
    await d.ctx.close();
  }
});

test('Arabic: the designer is right-to-left and mirrored, the report page is not', async () => {
  const geo = async (lang) => {
    const d = await env.open(def(), { lang });
    // the page is drawn at "fit" zoom: wait until its width stops changing
    let w0 = -1;
    for (let i = 0; i < 40; i++) {
      const w = (await d.page.locator('[data-testid="paper"]').boundingBox()).width;
      if (Math.abs(w - w0) < 0.5) break;
      w0 = w;
      await d.page.waitForTimeout(100);
    }
    await shot(d, `rtl-${lang}`);
    const g = await d.page.evaluate(() => {
      const sr = document.querySelector('#d').shadowRoot;
      const r = (s) => sr.querySelector(s).getBoundingClientRect();
      const paper = r('[data-testid="paper"]');
      // item boxes in thousandths of the paper width (the zoom may differ by a pixel or two between runs)
      const k = (v) => Math.round((v / paper.width) * 1000);
      // relative to the box the item is placed in (its band's drawing area), so band labels in px do not count
      const it = (n) => {
        const el = sr.querySelector(`.it[data-item="${n}"]`);
        const b = el.getBoundingClientRect(),
          o = el.offsetParent.getBoundingClientRect();
        return { x: k(b.left - o.left), y: k(b.top - o.top), w: k(b.width) };
      };
      return {
        left: r('.dleft').left,
        right: r('.dright').left,
        rail: r('.rail').left,
        railBody: r('.rail-body').left,
        brand: r('.brand').left,
        save: r('.save-btn').left,
        A: it('A'),
        Wide: it('Wide'),
      };
    });
    d.expectClean();
    await d.ctx.close();
    return g;
  };
  const en = await geo('en');
  const ar = await geo('ar');
  // English: panels left to right; Arabic: the side panel on the right, the Inspector on the left, the toolbar mirrored
  assert.ok(en.left < en.right, `en: left rail ${en.left} before the Inspector ${en.right}`);
  assert.ok(ar.left > ar.right, `ar: the side panel (${ar.left}) is right of the Inspector (${ar.right})`);
  assert.ok(
    ar.rail > ar.railBody,
    `ar: the rail tabs (${ar.rail}) sit on the outer (right) side of the panel body (${ar.railBody})`,
  );
  assert.ok(ar.brand > ar.save, `ar: the brand (${ar.brand}) is right of Save (${ar.save})`);
  // the page: the same item positions as in English (a report is laid out in points, not mirrored)
  const near = (a, b, what) => {
    for (const k of ['x', 'y', 'w'])
      assert.ok(Math.abs(a[k] - b[k]) <= 2, `${what}.${k}: ar ${a[k]} vs en ${b[k]} (‰ of the paper width)`);
  };
  near(ar.A, en.A, 'item A');
  near(ar.Wide, en.Wide, 'item Wide');
  assert.ok(ar.Wide.x > ar.A.x, 'ar: Wide (x 150 pt) stays right of A (x 20 pt) on the page');
});

/* ---------------------------------------------------------------- themes */
/** The embed follows data-theme on its host element (the host page decides); the system scheme is emulated as well. */
async function themed(scheme) {
  const d = await env.open(def());
  await d.page.emulateMedia({ colorScheme: scheme });
  await d.page.evaluate((s) => {
    document.querySelector('#d').dataset.theme = s;
  }, scheme);
  return d;
}
const bg = (d) =>
  d.page.evaluate(
    () => getComputedStyle(document.querySelector('#d').shadowRoot.querySelector('.dtop')).backgroundColor,
  );
const lum = (rgb) => {
  const [r, g, b] = rgb
    .match(/\d+(\.\d+)?/g)
    .slice(0, 3)
    .map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const scheme of ['light', 'dark']) {
  test(`theme ${scheme}: axe (colour contrast included) finds no serious or critical violations`, async () => {
    const d = await themed(scheme);
    const b = await bg(d);
    assert.ok(scheme === 'dark' ? lum(b) < 80 : lum(b) > 180, `${scheme}: the top bar background is ${b}`);
    await shot(d, `theme-${scheme}`);
    const v0 = await d.axe();
    assert.deepEqual(v0, [], `${scheme}, nothing selected: ${JSON.stringify(v0, null, 1)}`);
    await selectA(d);
    const v1 = await d.axe();
    assert.deepEqual(v1, [], `${scheme}, an item selected: ${JSON.stringify(v1, null, 1)}`);
    await d.page.locator('[data-testid="tab-preview"]').click();
    await d.page.locator('.dpreview .vpage').first().waitFor({ timeout: 30000 });
    const v2 = await d.axe();
    assert.deepEqual(v2, [], `${scheme}, preview: ${JSON.stringify(v2, null, 1)}`);
    d.expectClean();
  });
}

/* ---------------------------------------------------------------- window sizes */
const SIZES = [
  [1280, 720],
  [1920, 1080],
  [1024, 768],
  [800, 600],
];
for (const [width, height] of SIZES) {
  test(`window ${width}×${height}: no horizontal page scroll, the toolbar is reachable, the narrow note only on a narrow window`, async () => {
    for (const lang of ['en', 'de', 'ar']) {
      const d = await env.open(def(), { lang, viewport: { width, height } });
      await shot(d, `size-${width}x${height}-${lang}`);
      const g = await d.page.evaluate(() => {
        const sr = document.querySelector('#d').shadowRoot;
        const vw = document.documentElement.clientWidth,
          vh = document.documentElement.clientHeight;
        const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const controls = [
          ...sr.querySelectorAll(
            'header.dtop button, header.dtop input, header.dtop a, .cbar input, .cbar select, .cbar button, .dstatus button, .dstatus select',
          ),
        ].filter(shown);
        const off = [];
        for (const el of controls) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const r = el.getBoundingClientRect();
          if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5)
            off.push(
              `${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName} at ${Math.round(r.left)}..${Math.round(r.right)}`,
            );
        }
        const bar = sr.querySelector('header.dtop');
        return {
          hscroll: document.documentElement.scrollWidth > vw || document.scrollingElement.scrollLeft > 0,
          barOverflow: bar.scrollWidth > bar.clientWidth + 1 && getComputedStyle(bar).overflowX === 'visible',
          off,
          n: controls.length,
          narrow: shown(sr.querySelector('.narrow-note')),
          panels: shown(sr.querySelector('.dleft')) && shown(sr.querySelector('.dright')),
        };
      });
      assert.equal(g.hscroll, false, `${lang} ${width}: horizontal page scroll`);
      assert.equal(g.barOverflow, false, `${lang} ${width}: the top bar overflows its width`);
      assert.deepEqual(g.off, [], `${lang} ${width}: controls outside the window`);
      assert.ok(g.n >= 4, `${lang} ${width}: controls found (${g.n})`);
      const narrow = width <= 900;
      assert.equal(
        g.narrow,
        narrow,
        `${lang} ${width}: the "needs a wider screen" note ${narrow ? 'shown' : 'hidden'}`,
      );
      assert.equal(g.panels, !narrow, `${lang} ${width}: side panels ${narrow ? 'hidden' : 'shown'}`);
      d.expectClean();
      await d.ctx.close();
    }
  });
}

test('regression: at "Fit" zoom the page fits the canvas width (no horizontal scroll bar under it)', async () => {
  const fails = [];
  for (const [width, height] of SIZES.filter(([w]) => w > 900)) {
    const d = await env.open(def(), { viewport: { width, height } });
    assert.equal(await d.page.locator('[data-testid="zoom"]').inputValue(), 'fit');
    // the fit width follows a ResizeObserver: wait until the paper width settles
    let w0 = -1;
    for (let i = 0; i < 40; i++) {
      const w = (await d.page.locator('[data-testid="paper"]').boundingBox()).width;
      if (Math.abs(w - w0) < 0.5) break;
      w0 = w;
      await d.page.waitForTimeout(100);
    }
    const g = await d.page
      .locator('.cscroll')
      .first()
      .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    if (g.scroll > g.client) fails.push(`${width}×${height}: canvas content ${g.scroll} px in ${g.client} px`);
    d.expectClean();
    await d.ctx.close();
  }
  assert.deepEqual(fails, [], 'Fit leaves a horizontal scroll');
});
