// The designer of the full app (not embedded): /designer/<id> on a running Next.js server (BASE, default
// http://localhost:3000). History (version list, Restore), the ask-ai button without a server key, the Open viewer
// link, the theme toggle, autosave drafts (Restore / Discard), the save conflict bar (mine / theirs), Ctrl+S and the
// leave-page guard. Test reports have ids starting zz-dt-; they are deleted (and checked gone) at the end.
// The whole file is skipped when the server does not answer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { root } from './harness.mjs';
import { t as tr } from '../../src/i18n/index.js';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const BROWSER = process.env.BROWSER || 'chromium';
const ENGINES = { chromium, firefox, webkit };
// writes need a same-origin Origin header (the server refuses keyless cross-site writes)
const H = { origin: BASE, 'content-type': 'application/json' };

let up = null;
try {
  const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(15000) });
  if (r.status >= 500) up = `${BASE} answers ${r.status}`;
} catch (e) {
  up = `${BASE} does not answer (${e.cause?.code || e.message}): start the app (npm run dev) or set BASE`;
}
const SKIP = up ? `skipped: ${up}` : false;

// dev-server noise that is not the designer's (none of these is a console.error today; listed in case a browser
// reports them so): React DevTools advert, HMR / Fast Refresh logs, the dev overlay's websocket
const NOISE = [
  /Download the React DevTools/,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /webpack-hmr|_next\/webpack|turbopack-hmr/i,
];
// a save that meets a newer revision answers 409 on purpose; browsers log the failed request as an error
const HTTP409 = [/status of 409/, /409 \(Conflict\)/, /Failed to load resource/];

const RUN = `${process.pid}-${Date.now().toString(36)}`;
const made = new Set();
const rid = (name) => {
  const id = `zz-dt-app-${name}-${RUN}`;
  made.add(id);
  return id;
};

const tb = (name, x, y) => ({ type: 'textbox', name, x, y, w: 100, h: 20, value: name });
const blank = (name = 'App test') => ({
  $schema: 'reportwright/report@1',
  name,
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [],
  dataSets: [],
  sections: {
    pageHeader: { height: 40, items: [] },
    body: { height: 300, items: [tb('A', 10, 10), tb('B', 10, 60)] },
    pageFooter: { height: 30, items: [] },
  },
});

async function put(id, def, rev) {
  const r = await fetch(`${BASE}/api/reports/${id}`, {
    method: 'PUT',
    headers: { ...H, ...(rev ? { 'if-match': `"${rev}"` } : {}) },
    body: JSON.stringify(def),
  });
  const body = await r.json();
  assert.ok(r.ok, `PUT ${id}: ${r.status} ${JSON.stringify(body)}`);
  return body.rev;
}
async function get(id) {
  const r = await fetch(`${BASE}/api/reports/${id}`, { cache: 'no-store' });
  if (!r.ok) return { status: r.status };
  return { status: r.status, def: await r.json(), rev: (r.headers.get('etag') || '').replace(/^W\/|"/g, '') };
}
const itemIn = (def, name) => def.sections.body.items.find((i) => i.name === name);

/** Poll fn until it returns a truthy value (or fail after ms). */
async function until(fn, ms = 15000, what = 'condition') {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${last})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let browser;

/** A designer page of report id in a fresh context (its own localStorage), errors collected. */
async function open(id, { ctx = null } = {}) {
  const context = ctx || (await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${BASE}/designer/${id}`);
  await page.getByTestId('paper').waitFor({ timeout: 90000 });
  const d = {
    page,
    ctx: context,
    errors,
    clean(allow = []) {
      const bad = errors.filter((e) => ![...NOISE, ...allow].some((r) => r.test(e)));
      errors.length = 0;
      assert.deepEqual(bad, [], `console errors: ${bad.join('\n')}`);
    },
    item: (name) => page.locator(`.it[data-item="${name}"]`).first(),
    saveState: () => page.getByTestId('save-state').innerText(),
    status: () => page.getByTestId('status-selection').innerText(),
    async click(name) {
      const b = await d.item(name).boundingBox();
      await page.mouse.click(b.x + Math.min(6, b.width / 2), b.y + Math.min(6, b.height / 2));
    },
    /**
     * Select item name (the canvas may still settle right after it opens) and nudge it right with the arrow key (one
     * step: the grid with snap on). @returns its x after the nudge.
     */
    async nudge(name) {
      const x0 = await d.x(name);
      await page.keyboard.press('ArrowRight');
      await until(async () => (await d.saveState()) === 'Unsaved changes', 5000, 'an unsaved change');
      const x1 = await d.x(name);
      assert.ok(x1 > x0, `${name} moved right (${x0} → ${x1})`);
      return x1;
    },
    /** x of item name as the status bar shows it (select it first). */
    async x(name) {
      await until(
        async () => {
          await d.click(name);
          return (await d.status()).startsWith(`${name} ·`);
        },
        10000,
        `${name} selected`,
      );
      return Number((await d.status()).split('·')[2].trim().split(',')[0]);
    },
    async save() {
      await page.keyboard.press('ControlOrMeta+s');
      await until(async () => (await d.saveState()) === 'Saved', 15000, 'Saved');
    },
    close: () => context.close().catch(() => {}),
  };
  return d;
}

describe('designer in the app', { skip: SKIP }, () => {
  before(async () => {
    const engine = ENGINES[BROWSER];
    if (!engine) throw new Error(`BROWSER=${BROWSER}: expected chromium, firefox or webkit`);
    browser = await engine.launch();
  });
  after(async () => {
    await browser?.close();
    for (const id of made) {
      await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
      assert.equal((await get(id)).status, 404, `${id} is gone`);
    }
    const left = [
      ...fs.readdirSync(path.join(root, 'reports')),
      ...(fs.existsSync(path.join(root, 'reports/.history'))
        ? fs.readdirSync(path.join(root, 'reports/.history'))
        : []),
    ].filter((f) => f.includes(RUN));
    assert.deepEqual(left, [], 'no test report files stay in reports/');
  });

  test('History lists the saved versions after two saves; Restore loads that version', async () => {
    const id = rid('hist');
    await put(id, blank());
    const d = await open(id);
    const x1 = await d.nudge('A');
    await d.save();
    const x2 = await d.nudge('A');
    await d.save();
    assert.ok(x2 > x1);
    assert.equal(itemIn((await get(id)).def, 'A').x, x2);
    const versions = await (await fetch(`${BASE}/api/reports/${id}/versions`)).json();
    assert.equal(versions.length, 2, 'two earlier versions');
    await d.page.getByRole('button', { name: 'History' }).click();
    const dlg = d.page.locator('.dialog', { hasText: 'Version history' });
    await dlg.waitFor();
    await until(async () => (await dlg.locator('.ver-row').count()) === 2, 10000, 'two version rows');
    // the oldest version (as created: A at x 10)
    const oldest = versions.reduce((a, v, i) => (new Date(v.savedAt) < new Date(versions[a].savedAt) ? i : a), 0);
    await dlg.locator('.ver-row').nth(oldest).getByRole('button', { name: 'Restore' }).click();
    await dlg.waitFor({ state: 'detached' });
    assert.equal(await d.x('A'), 10, 'the designer shows the restored version');
    assert.equal(itemIn((await get(id)).def, 'A').x, 10, 'the server has it as the current version');
    assert.equal(await d.saveState(), 'Saved');
    d.clean();
    await d.close();
  });

  test('regression: after a version Restore, editing and saving meets a false save conflict', async () => {
    const id = rid('histrev');
    await put(id, blank());
    const d = await open(id);
    await d.nudge('A');
    await d.save();
    await d.page.getByRole('button', { name: 'History' }).click();
    const dlg = d.page.locator('.dialog', { hasText: 'Version history' });
    await until(async () => (await dlg.locator('.ver-row').count()) === 1, 10000, 'one version row');
    await dlg.getByRole('button', { name: 'Restore' }).click();
    await dlg.waitFor({ state: 'detached' });
    // nobody else saved: this save must go through
    const xb = await d.nudge('B');
    await d.page.keyboard.press('ControlOrMeta+s');
    await until(
      async () => (await d.saveState()) === 'Saved' || (await d.page.getByTestId('save-conflict').count()) > 0,
      15000,
      'save done',
    );
    const conflict = await d.page.getByTestId('save-conflict').count();
    await d.close();
    assert.equal(conflict, 0, 'no conflict bar after saving a restored version');
    assert.equal(itemIn((await get(id)).def, 'B').x, xb, 'the edit after the restore is saved');
  });

  test('ask-ai button is disabled with its off hint when the server has no key', async (t) => {
    const id = rid('ai');
    await put(id, blank());
    const d = await open(id);
    const b = d.page.getByTestId('ask-ai');
    await b.waitFor();
    if (await b.isEnabled()) {
      t.skip('the server has a key: the button is on');
      await d.close();
      return;
    }
    assert.equal(await b.isDisabled(), true);
    assert.equal(await b.getAttribute('title'), tr('en', 'r4_aiOff'), 'the hint says why it is off');
    d.clean();
    await d.close();
  });

  test('"Open viewer" links to /viewer/<id> in a new tab', async () => {
    const id = rid('viewer');
    await put(id, blank());
    const d = await open(id);
    const a = d.page.getByRole('link', { name: 'Open viewer' });
    assert.equal(await a.getAttribute('href'), `/viewer/${id}`);
    assert.equal(await a.getAttribute('target'), '_blank');
    d.clean();
    await d.close();
  });

  test('the theme toggle cycles light → dark → system (html data-theme) and keeps the choice', async () => {
    const id = rid('theme');
    await put(id, blank());
    const d = await open(id);
    const theme = () => d.page.evaluate(() => document.documentElement.dataset.theme);
    const pref = () => d.page.evaluate(() => localStorage.getItem('pw-theme'));
    const btn = d.page.getByTestId('theme-toggle');
    await until(
      async () => (await btn.getAttribute('aria-label')) === 'Theme: follows the system',
      10000,
      'system theme',
    );
    assert.equal(await theme(), 'light'); // the browser asks for light
    await btn.click();
    assert.equal(await btn.getAttribute('aria-label'), 'Theme: light');
    assert.equal(await theme(), 'light');
    assert.equal(await pref(), 'light');
    await btn.click();
    assert.equal(await btn.getAttribute('aria-label'), 'Theme: dark');
    assert.equal(await theme(), 'dark');
    assert.equal(await pref(), 'dark');
    // kept for the next page
    await d.page.reload();
    await d.page.getByTestId('paper').waitFor({ timeout: 90000 });
    assert.equal(await theme(), 'dark');
    await until(async () => (await btn.getAttribute('aria-label')) === 'Theme: dark', 10000, 'dark after reload');
    await btn.click();
    assert.equal(await btn.getAttribute('aria-label'), 'Theme: follows the system');
    assert.equal(await theme(), 'light');
    assert.equal(await pref(), null);
    d.clean();
    await d.close();
  });

  describe('autosave draft', () => {
    /** An unsaved nudge of A, kept as a draft when the page goes away (pagehide), then the page again. */
    async function draftAndReload(id) {
      const d = await open(id);
      d.moved = await d.nudge('A');
      await d.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      const key = await until(
        () =>
          d.page.evaluate(
            (id) => Object.keys(localStorage).find((k) => k.startsWith('pw.draft.') && k.endsWith(`.${id}`)),
            id,
          ),
        5000,
        'a draft',
      );
      assert.ok(key);
      d.page.on('dialog', (x) => x.accept()); // the leave-page guard (unsaved changes)
      await d.page.reload();
      await d.page.getByTestId('paper').waitFor({ timeout: 90000 });
      return d;
    }

    test('a draft is offered after a reload; Restore brings the unsaved change back', async () => {
      const id = rid('draft1');
      await put(id, blank());
      const d = await draftAndReload(id);
      await d.page.getByTestId('draft-offer').waitFor();
      assert.equal(await d.x('A'), 10, 'the page opens the saved report');
      assert.equal(await d.saveState(), 'Saved');
      await d.page.getByTestId('draft-restore').click();
      await d.page.getByTestId('draft-offer').waitFor({ state: 'detached' });
      assert.equal(await d.x('A'), d.moved, 'the unsaved change is back');
      assert.equal(await d.saveState(), 'Unsaved changes');
      assert.equal(itemIn((await get(id)).def, 'A').x, 10, 'the server copy is untouched');
      d.clean();
      await d.close();
    });

    test('Discard removes the offer and the draft (not offered again)', async () => {
      const id = rid('draft2');
      await put(id, blank());
      const d = await draftAndReload(id);
      await d.page.getByTestId('draft-offer').waitFor();
      await d.page.getByTestId('draft-discard').click();
      await d.page.getByTestId('draft-offer').waitFor({ state: 'detached' });
      assert.equal(await d.x('A'), 10);
      assert.equal(
        await d.page.evaluate((id) => Object.keys(localStorage).filter((k) => k.endsWith(`.${id}`)).length, id),
        0,
        'the draft is gone',
      );
      await d.page.reload();
      await d.page.getByTestId('paper').waitFor({ timeout: 90000 });
      await d.page.waitForTimeout(300);
      assert.equal(await d.page.getByTestId('draft-offer').count(), 0, 'no offer after another reload');
      d.clean();
      await d.close();
    });

    test('saving clears the draft (no offer on the next open)', async () => {
      const id = rid('draft3');
      await put(id, blank());
      const d = await open(id);
      await d.nudge('A');
      await d.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await until(
        () => d.page.evaluate((id) => Object.keys(localStorage).some((k) => k.endsWith(`.${id}`)), id),
        5000,
        'a draft',
      );
      await d.save();
      assert.equal(
        await d.page.evaluate((id) => Object.keys(localStorage).some((k) => k.endsWith(`.${id}`)), id),
        false,
        'the save removed the draft',
      );
      await d.page.reload();
      await d.page.getByTestId('paper').waitFor({ timeout: 90000 });
      await d.page.waitForTimeout(300);
      assert.equal(await d.page.getByTestId('draft-offer').count(), 0);
      d.clean();
      await d.close();
    });
  });

  describe('save conflict', () => {
    /** Open the designer, then save the report on the server behind its back (a new name), then edit + Save. */
    async function conflictOf(id) {
      await put(id, blank('Mine'));
      const d = await open(id);
      const { def, rev } = await get(id);
      await put(id, { ...def, name: 'Theirs' }, rev);
      d.moved = await d.nudge('A');
      await d.page.getByTestId('save').click();
      await d.page.getByTestId('save-conflict').waitFor();
      assert.equal((await get(id)).def.name, 'Theirs', 'nothing was overwritten');
      return d;
    }

    test('"conflict-mine" overwrites the server copy with the designer\'s', async () => {
      const id = rid('mine');
      const d = await conflictOf(id);
      await d.page.getByTestId('conflict-mine').click();
      await d.page.getByTestId('save-conflict').waitFor({ state: 'detached' });
      await until(async () => (await d.saveState()) === 'Saved', 10000, 'Saved');
      const now = (await get(id)).def;
      assert.equal(now.name, 'Mine');
      assert.equal(itemIn(now, 'A').x, d.moved);
      // and the designer edits from the new revision: a further save goes through
      const x2 = await d.nudge('A');
      await d.save();
      assert.equal(itemIn((await get(id)).def, 'A').x, x2);
      d.clean(HTTP409);
      await d.close();
    });

    test('"conflict-theirs" loads the server copy (my unsaved change is dropped)', async () => {
      const id = rid('theirs');
      const d = await conflictOf(id);
      await d.page.getByTestId('conflict-theirs').click();
      await d.page.getByTestId('save-conflict').waitFor({ state: 'detached' });
      assert.equal(await d.page.getByLabel('Report name').inputValue(), 'Theirs');
      assert.equal(await d.x('A'), 10);
      assert.equal(await d.saveState(), 'Saved');
      // a save after taking theirs edits from their revision
      const xb = await d.nudge('B');
      await d.save();
      const now = (await get(id)).def;
      assert.equal(now.name, 'Theirs');
      assert.equal(itemIn(now, 'B').x, xb);
      d.clean(HTTP409);
      await d.close();
    });
  });

  test('Ctrl+S saves to the server (GET shows the change)', async () => {
    const id = rid('ctrls');
    await put(id, blank());
    const d = await open(id);
    const x = await d.nudge('A');
    assert.equal(itemIn((await get(id)).def, 'A').x, 10);
    await d.save();
    assert.equal(itemIn((await get(id)).def, 'A').x, x);
    assert.equal(await d.page.getByTestId('save').isDisabled(), true, 'Save is off once saved');
    d.clean();
    await d.close();
  });

  test('leaving with unsaved changes asks first (beforeunload); a saved report closes without asking', async () => {
    const id = rid('leave');
    await put(id, blank());
    let d = await open(id);
    await d.nudge('A');
    const asked = new Promise((ok) =>
      d.page.once('dialog', async (x) => {
        ok(x.type());
        await x.accept();
      }),
    );
    await d.page.close({ runBeforeUnload: true });
    assert.equal(await Promise.race([asked, new Promise((r) => setTimeout(() => r('none'), 10000))]), 'beforeunload');
    d.clean();
    await d.close();

    d = await open(id);
    await d.page.waitForTimeout(300);
    let dialogs = 0;
    d.page.on('dialog', async (x) => {
      dialogs++;
      await x.accept();
    });
    const closed = new Promise((r) => d.page.once('close', r));
    await d.page.close({ runBeforeUnload: true });
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
    assert.equal(dialogs, 0, 'no question when everything is saved');
    assert.equal(d.page.isClosed(), true);
    d.clean();
    await d.close();
  });
});
