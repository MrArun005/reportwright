// Permissions per report and folder (enterprise item 2), against a production build with accounts on. Start it like
// tests/e2e/users.mjs says, with a user key too: PW_API_KEYS="test-key,viewer@e2e.test|scoped-key". Then:
//   BASE=http://localhost:3602 node tests/e2e/permissions.mjs
// The admin locks the top level to view, makes a Finance folder only the finance group and alice may open, and puts a
// report in it. Then each user sees exactly what they may, in the UI and over every API, and no control they cannot use.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = process.env.PW_ADMIN_EMAIL || 'admin@e2e.test';
const ADMIN_PW = process.env.PW_ADMIN_PASSWORD || 'e2e admin password';
const run = Date.now().toString(36);
const PW = 'e2e user password';
const ALICE = `alice-${run}@e2e.test`, BOB = `bob-${run}@e2e.test`, CAROL = `carol-${run}@e2e.test`, KEYUSER = 'viewer@e2e.test';
const FOLDER = `Finance ${run}`, REPORT = `Salaries ${run}`;
const step = (s) => console.log('·', s);
const H = { origin: BASE };
fs.mkdirSync('/tmp/shots', { recursive: true });

const req = (p, { method = 'GET', cookie, headers = {}, body } = {}) => fetch(BASE + p, {
  method, redirect: 'manual',
  headers: { ...H, ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const signIn = async (email, password) => {
  const r = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, `sign in ${email}`);
  return (r.headers.get('set-cookie') || '').split(';')[0];
};

step('admin adds alice (designer), bob (designer), carol (viewer, group finance) and the key user');
const admin = await signIn(ADMIN, ADMIN_PW);
for (const [email, role, groups] of [[ALICE, 'designer', []], [BOB, 'designer', []], [CAROL, 'viewer', ['finance']], [KEYUSER, 'viewer', []]]) {
  const r = await req('/api/users', { method: 'POST', cookie: admin, body: { email, role, password: PW, groups } });
  assert.ok(r.status === 201 || (email === KEYUSER && r.status === 409), `${email}: ${r.status}`);
}
// the top as the suite leaves it (tidy, below): everyone manages it. A new install gives only designers view there (67f6d448)
assert.equal((await req('/api/folders/root', { method: 'PATCH', cookie: admin, body: { grants: [{ to: 'group:everyone', level: 'manage' }] } })).status, 200);
// a report everyone may view, at the top
const pub = await (await req('/api/reports', { method: 'POST', cookie: admin, body: { name: `Public ${run}` } })).json();

const b = await chromium.launch();
const errs = [];
const pageAs = async (cookie) => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  return p;
};

step('admin, in the UI: the top level becomes view-only, a Finance folder only finance and alice may open');
const pa = await pageAs(admin);
await pa.goto(BASE + '/');
await pa.getByRole('button', { name: 'Top-level access' }).click();
const dlg = pa.getByRole('dialog');
await dlg.getByLabel('Access of Everyone (signed in)').selectOption('view');
await Promise.all([pa.waitForEvent('load'), dlg.getByRole('button', { name: 'Save' }).click()]); // the page reloads
await pa.getByRole('form', { name: 'New folder' }).getByLabel('New folder name').fill(FOLDER);
await pa.getByRole('form', { name: 'New folder' }).getByRole('button', { name: 'New folder' }).click();
await pa.getByRole('link', { name: FOLDER }).click();
await pa.waitForURL(/\?folder=f_/);
const folderId = new URL(pa.url()).searchParams.get('folder');
await pa.getByRole('button', { name: 'Folder access' }).click();
await dlg.getByLabel('Also give the access of the folder above (inherit)').uncheck();
const add = dlg.getByRole('form', { name: 'Add' });
await add.getByLabel('Who').selectOption('group');
await add.getByLabel('Group name').fill('finance');
await add.getByRole('button', { name: 'Add' }).click();
await add.getByLabel('Who').selectOption('user');
await add.getByLabel('Email').fill(ALICE);
await add.getByLabel(/^Access/).selectOption('edit');
await add.getByRole('button', { name: 'Add' }).click();
await dlg.getByRole('row', { name: /Group: finance/ }).waitFor();
await pa.screenshot({ path: '/tmp/shots/perms-share.png' });
await Promise.all([pa.waitForEvent('load'), dlg.getByRole('button', { name: 'Save' }).click()]); // the page reloads
// a new report made here lands in the folder
await pa.getByLabel('New report name').fill(REPORT);
await pa.getByRole('button', { name: 'New report', exact: true }).click();
await pa.waitForURL(/\/designer\//);
const rid = new URL(pa.url()).pathname.split('/').pop();
const acc = await (await req(`/api/reports/${rid}/access`, { cookie: admin })).json();
assert.equal(acc.folder, folderId);
await pa.goto(`${BASE}/?folder=${folderId}`);
await pa.locator(`[data-report="${rid}"]`).waitFor();
await pa.screenshot({ path: '/tmp/shots/perms-admin-folder.png' });

const alice = await signIn(ALICE, PW), bob = await signIn(BOB, PW), carol = await signIn(CAROL, PW);

step('bob sees neither the folder nor the report, anywhere, and gets no create controls at a view-only top');
const pb = await pageAs(bob);
await pb.goto(BASE + '/');
await pb.locator(`[data-report="${pub.id}"]`).waitFor();
assert.equal(await pb.getByRole('link', { name: FOLDER }).count(), 0);
assert.equal(await pb.locator(`[data-report="${rid}"]`).count(), 0);
assert.equal(await pb.getByLabel('New report name').count(), 0, 'no New report form where bob cannot create');
assert.equal(await pb.getByRole('form', { name: 'New folder' }).count(), 0);
assert.equal(await pb.getByRole('button', { name: 'Top-level access' }).count(), 0);
assert.equal(await pb.locator(`[data-report="${pub.id}"]`).getByRole('link', { name: 'Design' }).count(), 0, 'top is view-only for bob');
await pb.screenshot({ path: '/tmp/shots/perms-bob.png' });
await pb.goto(`${BASE}/?folder=${folderId}`); // a hidden folder id shows the top, not the folder
assert.equal(await pb.locator(`[data-report="${rid}"]`).count(), 0);
await pb.goto(`${BASE}/?q=${encodeURIComponent(REPORT)}`);
await pb.getByText('No report matches your search.').waitFor();
for (const p of [`/viewer/${rid}`, `/designer/${rid}`]) assert.equal((await req(p, { cookie: bob })).status, 404, p);
for (const p of [`/api/reports/${rid}`, `/api/reports/${rid}/pdf`, `/api/reports/${rid}/pdf?format=xlsx`, `/api/reports/${rid}/thumb`, `/api/reports/${rid}/versions`, `/api/reports/${rid}/access`, `/api/folders/${folderId}`]) {
  assert.equal((await req(p, { cookie: bob })).status, 404, p);
}
assert.equal((await req(`/api/reports/${rid}`, { method: 'PUT', cookie: bob, body: { name: 'x' } })).status, 404);
assert.equal((await req(`/api/reports/${rid}`, { method: 'DELETE', cookie: bob })).status, 404);
assert.equal((await req('/api/data/sql', { method: 'POST', cookie: bob, body: { report: rid, source: 'x' } })).status, 404);
assert.ok(!(await (await req('/api/reports', { cookie: bob })).json()).some(r => r.id === rid));
assert.ok(!(await (await req('/api/folders', { cookie: bob })).json()).folders.some(f => f.id === folderId));

step('carol (viewer, finance) views it, with no Design, Share or Edit in designer');
const pc = await pageAs(carol);
await pc.goto(`${BASE}/?folder=${folderId}`);
const card = pc.locator(`[data-report="${rid}"]`);
await card.waitFor();
assert.equal(await card.getByRole('link', { name: 'Design' }).count(), 0);
assert.equal(await card.getByRole('button', { name: 'Share' }).count(), 0);
assert.equal(await pc.getByRole('button', { name: 'Folder access' }).count(), 0);
await card.getByRole('link', { name: 'View' }).click();
await pc.waitForURL(`${BASE}/viewer/${rid}`);
await pc.locator('.vpage').first().waitFor({ timeout: 30000 });
assert.equal(await pc.getByRole('link', { name: 'Edit in designer' }).count(), 0);
assert.equal((await req(`/api/reports/${rid}`, { method: 'PUT', cookie: carol, body: { name: 'x' } })).status, 403);
{ // drawn in the background: 202 with a placeholder, then the drawing
  let r = await req(`/api/reports/${rid}/thumb`, { cookie: carol });
  for (let i = 0; r.status === 202 && i < 30; i++) { await new Promise(res => setTimeout(res, 500)); r = await req(`/api/reports/${rid}/thumb`, { cookie: carol }); }
  assert.equal(r.status, 200);
}

step('alice (edit) designs it but cannot share or delete it');
const pal = await pageAs(alice);
await pal.goto(`${BASE}/?folder=${folderId}`);
const acard = pal.locator(`[data-report="${rid}"]`);
await acard.getByRole('link', { name: 'Design' }).waitFor();
assert.equal(await acard.getByRole('button', { name: 'Share' }).count(), 0);
assert.equal((await req(`/designer/${rid}`, { cookie: alice })).status, 200);
assert.equal((await req(`/api/reports/${rid}`, { method: 'DELETE', cookie: alice })).status, 403);
assert.equal((await req(`/designer/${rid}`, { cookie: carol })).status, 403, 'a viewer never opens the designer');

step('a user\'s API key renders what that user may view, nothing more');
const render = (key, template) => req('/api/v1/render', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: { template, format: 'csv' } });
assert.equal((await render('scoped-key', rid)).status, 404);
assert.equal((await render('scoped-key', pub.id)).status, 200);
assert.equal((await render('test-key', rid)).status, 200);
const tpl = await (await req('/api/v1/templates', { headers: { authorization: 'Bearer scoped-key' } })).json();
assert.ok(!tpl.some(r => r.id === rid) && tpl.some(r => r.id === pub.id));

step('admin shares the report with bob directly: now he sees it (and only it)');
assert.equal((await req(`/api/reports/${rid}/access`, { method: 'PUT', cookie: admin, body: { grants: [{ to: `user:${BOB}`, level: 'view' }] } })).status, 200);
assert.equal((await req(`/api/reports/${rid}`, { cookie: bob })).status, 200);
assert.equal((await req(`/api/folders/${folderId}`, { cookie: bob })).status, 404);

step('the admin\'s audit log shows the sharing, the denied key and the renders, and exports them as CSV');
await pa.goto(`${BASE}/admin/audit`);
await pa.getByRole('heading', { name: 'Audit log' }).waitFor();
await pa.locator('tr[data-type="access.folder"]').first().waitFor();
await pa.locator('tr[data-type="access.root"]').first().waitFor();
await pa.getByLabel('Event').selectOption('report.render');
await pa.getByRole('button', { name: 'Apply' }).click();
await pa.locator('tr[data-type="access.folder"]').first().waitFor({ state: 'detached' }); // the filtered list replaced the full one
await pa.locator('tr[data-type="report.render"]').first().waitFor();
assert.equal(await pa.locator('tbody tr:not([data-type="report.render"])').count(), 0);
await pa.screenshot({ path: '/tmp/shots/audit-log.png' });
const csv = await (await req('/api/audit?type=access.&format=csv', { cookie: admin })).text();
assert.match(csv.split('\r\n')[0], /^at,type,status,actor/);
assert.ok(csv.includes('access.folder') && csv.includes(folderId));
assert.equal((await req('/api/audit', { cookie: carol })).status, 403);
assert.equal((await req('/admin/audit', { cookie: alice })).status, 403);

step('tidy: the top level back to everyone manage, the test reports gone');
await req('/api/folders/root', { method: 'PATCH', cookie: admin, body: { grants: [{ to: 'group:everyone', level: 'manage' }] } });
for (const id of [rid, pub.id]) await req(`/api/reports/${id}`, { method: 'DELETE', cookie: admin });
assert.equal((await req(`/api/folders/${folderId}`, { method: 'DELETE', cookie: admin })).status, 200);
await b.close();
assert.deepEqual(errs, []);
console.log('permissions e2e: all passed');
