// The Share dialog opens with its grants (not stuck on "Loading…") for the admin, on every report incl. the torture test.
// Needs a production server with accounts (see users.mjs): BASE=http://localhost:3300 node tests/e2e/b1-share.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3300';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(`${BASE}/login`);
await p.getByLabel('Email').fill(process.env.PW_ADMIN_EMAIL || 'admin@e2e.test');
await p.getByLabel('Password').fill(process.env.PW_ADMIN_PASSWORD || 'e2e admin password');
await p.getByRole('button', { name: 'Sign in' }).click();
await p.waitForURL(`${BASE}/`);
// the torture test as shipped (a fresh store has no reports)
const cookie = (await p.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
const def = JSON.parse(fs.readFileSync(new URL('../../reports/torture-test.pw.json', import.meta.url), 'utf8'));
const put = await fetch(`${BASE}/api/reports/torture-test`, { method: 'PUT', headers: { cookie, origin: BASE, 'content-type': 'application/json', 'if-match': '*' }, body: JSON.stringify(def) });
assert.ok(put.ok, `save: ${put.status}`);
await p.goto(`${BASE}/?view=reports`);
for (const name of ['ReportWright Torture Test']) {
  const card = p.locator('article').filter({ hasText: name }).filter({ has: p.getByRole('button', { name: 'Share' }) }).first();
  await card.getByRole('button', { name: 'Share' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByRole('table').waitFor({ timeout: 10000 }).catch(() => {});
  const text = await dlg.innerText();
  console.log('·', name, JSON.stringify(text.slice(0, 200)));
  assert.ok(!/Loading/.test(text), `${name}: the dialog is stuck on Loading…`);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
}
// a busy server that holds the read (Vercel: an inline render on the same instance): an error and Retry, not "Loading…" for good
let held = 0;
await p.route('**/api/reports/torture-test/access', async (route) => { if (held++ === 0) { await new Promise(r => setTimeout(r, 17000)); return route.abort().catch(() => {}); } return route.fallback(); });
const card = p.locator('article').filter({ hasText: 'ReportWright Torture Test' }).first();
await card.getByRole('button', { name: 'Share' }).click();
const dlg = p.getByRole('dialog');
await dlg.getByRole('alert').filter({ hasText: 'did not answer in time' }).waitFor({ timeout: 20000 });
await dlg.getByRole('button', { name: 'Retry' }).click();
await dlg.getByRole('table').waitFor({ timeout: 10000 });
assert.ok(!/Loading/.test(await dlg.innerText()));
assert.deepEqual(errs, []);
await b.close();
console.log('share dialog OK');
