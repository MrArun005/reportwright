// Shared by the recipe scripts: opens the real designer (the site's embed, mounted with mountDesigner as the
// playground does) on a blank report, in a headless browser, and gives the script the page to click through.
// Serve dist-site first: node scripts/build-site.mjs --no-embed, then any static server with dist-site at
// $SITE (default http://127.0.0.1:8771/reportwright-demo/), then run one recipe: node scripts/site-recipes/<recipe>.mjs
// (a plain `python3 -m http.server` can reset connections while the embed loads its chunks; a deeper listen queue fixes it).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const SITE = (process.env.SITE || 'http://127.0.0.1:8771/reportwright-demo/').replace(/\/?$/, '/');
export const OUT = path.join(import.meta.dirname, '../../site/learn');
const SHOTS = process.env.RECIPE_SHOTS !== '0';

// The page the designer is mounted on. It is served by the test browser itself (page.route), not shipped.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>recipe</title>
<style>html,body{margin:0;height:100%;background:#fff}#d{height:100vh}</style><div id="d"></div>
<script type="module">
const SERVER = new URL('.', location.href).href.replace(/\\/$/, '');
const { mountDesigner } = await import(SERVER + '/embed/esm/designer.js');
window.__saved = null;
window.__designer = mountDesigner(document.getElementById('d'), { server: SERVER, height: '100%',
  onSave: (def) => { window.__saved = def; }, panels: { data: true, inspector: true } });
</script>`;

export async function open({ width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  await page.route(SITE + '__recipe.html', r => r.fulfill({ contentType: 'text/html', body: HARNESS }));
  await page.goto(SITE + '__recipe.html');
  await page.waitForSelector('[data-testid=paper]', { timeout: 20000 }).catch((e) => { throw new Error(`the designer did not open: ${errors.join(' / ') || e.message}`); });
  return { browser, page, errors };
}

/** Names the report, presses the designer's own Save button and writes what onSave received to site/learn/<name>.pw.json. */
export async function save(page, name, title) {
  await page.getByLabel('Report name').fill(title);
  await page.keyboard.press('Tab');
  await page.evaluate(() => { window.__saved = null; });
  await page.getByTestId('save').click();
  await page.waitForFunction(() => window.__saved);
  const def = await page.evaluate(() => window.__saved);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.pw.json`), JSON.stringify(def, null, 2) + '\n');
  return def;
}

/** A screenshot of the page (or of one locator), written as site/learn/<name>.webp (converted by the browser's canvas). */
export async function shot(page, target, name, opts = {}) {
  if (!SHOTS) return;
  const png = await target.screenshot(opts);
  const b64 = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.86).split(',')[1];
  }, png.toString('base64'));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(b64, 'base64'));
}

/**
 * The recipe's numbered steps. Each call is one step as the page shows it (simple markdown: `code`, **bold**);
 * finish() writes them to site/learn/<name>.steps.json, so the page lists exactly what the script did.
 */
const steps = [];
export const step = (s) => { steps.push(s); console.log(`${steps.length}.`, s.replace(/[`*]/g, '')); };
export function finish(name, errors) {
  fs.writeFileSync(path.join(OUT, `${name}.steps.json`), JSON.stringify(steps, null, 2) + '\n');
  if (errors.length) { console.error('console errors:', errors); process.exitCode = 1; } else console.log('OK', name);
}

/** The control of a labelled field (a select's accessible name includes its options, so match the label text). */
export const field = (page, scope, text) => scope.locator('label.field').filter({ has: page.locator(':scope > span', { hasText: new RegExp(`^${text}$`) }) }).locator('select, input, textarea').first();

/** Data panel: + Add under Data sources, a REST source. */
export async function addRestSource(page, name, url) {
  await page.getByRole('button', { name: '+ Add' }).nth(1).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('URL').fill(url);
  await dlg.getByRole('button', { name: 'Save' }).click();
}

/** Data panel: + Add under Data sets, rows at `rowsPath`, fields detected from the response. */
export async function addDataSet(page, name, rowsPath, { source, filter, before } = {}) {
  await page.getByRole('button', { name: '+ Add' }).nth(2).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  if (source) await field(page, dlg, 'Source').selectOption(source);
  await dlg.getByLabel('Path to the rows').fill(rowsPath);
  await dlg.getByRole('button', { name: 'Detect fields' }).click();
  await dlg.getByText(/^Found \d+ rows\.$/).waitFor();
  if (before) await before(dlg);
  await dlg.getByRole('button', { name: 'Save' }).click();
  await dlg.waitFor({ state: 'detached' });
}

/** In Preview: the finished report's page `n` as site/learn/<name>-result.webp; `crop` keeps the top part (0–1) of a page that is mostly empty. */
export async function result(page, name, n = 1, crop = 1) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 1100, height: 1500 }); // a page tall enough to read at "Whole page"
  await page.getByLabel('View mode').selectOption('single');
  await page.getByRole('button', { name: 'Whole page' }).click();
  await page.getByLabel('Page', { exact: true }).fill(String(n));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const box = await page.locator('.vpage').first().boundingBox();
  await shot(page, page, `${name}-result`, { clip: { ...box, height: Math.round(box.height * crop) } });
  await page.setViewportSize(vp);
}

/** Selects a band by its label (Page header, Body, Page footer) and sets its height in the Inspector. */
export async function bandHeight(page, label, pt) {
  await page.locator('.band-label', { hasText: label }).click();
  await field(page, page.getByTestId('inspector'), 'Height \\(pt\\)').fill(String(pt));
  await page.keyboard.press('Tab');
}
