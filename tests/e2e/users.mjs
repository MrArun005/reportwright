// Accounts and roles (PW_AUTH=users) against a running production build. Start the server like this:
//   PW_AUTH=users PW_SESSION_SECRET=$(openssl rand -hex 32) PW_ADMIN_EMAIL=admin@e2e.test \
//   PW_ADMIN_PASSWORD='e2e admin password' PW_STORAGE=sqlite:/tmp/pw-e2e-users.db \
//   PW_API_KEYS=test-key PW_INTERNAL_HOSTS=127.0.0.1 npx next start -p 3300
// then: BASE=http://localhost:3300 node tests/e2e/users.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = process.env.PW_ADMIN_EMAIL || 'admin@e2e.test';
const ADMIN_PW = process.env.PW_ADMIN_PASSWORD || 'e2e admin password';
const run = Date.now().toString(36);
const VIEWER = `viewer-${run}@e2e.test`, DESIGNER = `designer-${run}@e2e.test`, PW = 'e2e user password';
const RID = `e2e-users-${run}`;
const step = (s) => console.log('·', s);
const H = { origin: BASE }; // what a browser sends with a write from our own pages

const req = (p, { method = 'GET', cookie, headers = {}, body } = {}) => fetch(BASE + p, {
  method, redirect: 'manual',
  headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const signIn = async (email, password, headers = H) => {
  const r = await req('/api/auth/login', { method: 'POST', headers, body: { email, password } });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], setCookie: r.headers.get('set-cookie') };
};

step('anonymous: pages go to /login, APIs answer 401, open paths stay open');
let r = await req('/designer/loan-statement?x=1');
assert.equal(r.status, 307);
assert.equal(new URL(r.headers.get('location'), BASE).href, `${BASE}/login?next=%2Fdesigner%2Floan-statement%3Fx%3D1`);
assert.equal((await req('/api/reports')).status, 401);
assert.equal((await req('/api/users')).status, 401);
assert.equal((await req('/login')).status, 200);
assert.equal((await req('/api/v1/templates', { headers: { authorization: 'Bearer test-key' } })).status, 200);
assert.equal((await req('/fonts/Inter-Regular.ttf')).status === 401, false);
// an old Next middleware bypass header must not skip the proxy
for (const h of ['proxy:proxy:proxy:proxy:proxy', 'middleware:middleware:middleware:middleware:middleware', 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware']) {
  assert.equal((await req('/api/users', { headers: { 'x-middleware-subrequest': h } })).status, 401, h);
}

step('admin signs in through the form and adds a viewer and a designer');
const b = await chromium.launch();
const errs = [];
const page = async () => { const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
const pa = await page();
await pa.goto(`${BASE}/admin/users`);
await pa.waitForURL(/\/login\?next=%2Fadmin%2Fusers$/);
await pa.getByLabel('Email').fill(ADMIN);
await pa.getByLabel('Password').fill('a wrong password');
await pa.getByRole('button', { name: 'Sign in' }).click();
await pa.getByRole('alert').filter({ hasText: 'The email or password is wrong.' }).waitFor();
await pa.getByLabel('Password').fill(ADMIN_PW);
await pa.getByRole('button', { name: 'Sign in' }).click();
await pa.waitForURL(`${BASE}/admin/users`);
await pa.getByRole('heading', { name: 'Users' }).waitFor();
for (const [email, role] of [[VIEWER, 'viewer'], [DESIGNER, 'designer']]) {
  const form = pa.getByRole('form', { name: 'Add a user' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Role').selectOption(role);
  await form.getByLabel(/^Password/).fill(PW);
  await form.getByRole('button', { name: 'Add user' }).click();
  await pa.getByText(`Added ${email} as ${role}.`).waitFor();
}
await pa.getByRole('cell', { name: VIEWER, exact: true }).waitFor();
await pa.screenshot({ path: '/tmp/shots/users-admin.png' });
// a short password is refused with a readable message
const form = pa.getByRole('form', { name: 'Add a user' });
await form.getByLabel('Email').fill(`short-${run}@e2e.test`);
await form.getByLabel(/^Password/).evaluate((el) => { el.removeAttribute('minlength'); });
await form.getByLabel(/^Password/).fill('short');
await form.getByRole('button', { name: 'Add user' }).click();
await pa.getByRole('alert').filter({ hasText: 'at least 10 characters' }).waitFor();

step('the API never shows a password hash');
const admin = await signIn(ADMIN, ADMIN_PW);
assert.equal(admin.status, 200);
assert.match(admin.setCookie, /HttpOnly/);
assert.match(admin.setCookie, /SameSite=Lax/);
const list = await (await req('/api/users', { cookie: admin.cookie })).text();
assert.ok(list.includes(VIEWER) && !/scrypt|passwordHash/.test(list));

step('designer saves a report; CSRF and role checks hold');
const designer = await signIn(DESIGNER, PW);
const viewer = await signIn(VIEWER, PW);
assert.equal(designer.status, 200);
assert.equal(viewer.status, 200);
const def = JSON.parse(fs.readFileSync(new URL('../../reports/loan-statement.pw.json', import.meta.url), 'utf8'));
assert.equal((await req(`/api/reports/${RID}`, { method: 'PUT', cookie: designer.cookie, body: def })).status, 403, 'no Origin');
assert.equal((await req(`/api/reports/${RID}`, { method: 'PUT', cookie: designer.cookie, headers: { origin: 'http://evil.test' }, body: def })).status, 403, 'cross-site');
r = await req(`/api/reports/${RID}`, { method: 'PUT', cookie: designer.cookie, headers: H, body: def });
assert.equal(r.status, 200);
assert.deepEqual(await (await req(`/api/reports/${RID}`, { cookie: designer.cookie })).json(), def);
assert.equal((await req(`/designer/${RID}`, { cookie: designer.cookie })).status, 200);
r = await req('/api/data/sql', { method: 'POST', cookie: designer.cookie, headers: H, body: { connection: 'nope', query: 'select 1' } });
assert.equal(r.status, 400); // allowed through to the driver: the connection is not set up
assert.match((await r.json()).error, /not set up/);

step('viewer: reads and renders, but cannot save, design, run ad-hoc SQL or manage users');
assert.equal((await req('/api/reports', { cookie: viewer.cookie })).status, 200);
assert.equal((await req(`/api/reports/${RID}`, { method: 'PUT', cookie: viewer.cookie, headers: H, body: def })).status, 403);
assert.equal((await req(`/api/reports/${RID}`, { method: 'DELETE', cookie: viewer.cookie, headers: H })).status, 403);
assert.equal((await req('/api/reports', { method: 'POST', cookie: viewer.cookie, headers: H, body: { name: 'x' } })).status, 403);
assert.equal((await req(`/designer/${RID}`, { cookie: viewer.cookie })).status, 403);
assert.equal((await req('/admin/users', { cookie: viewer.cookie })).status, 403);
assert.equal((await req('/api/users', { cookie: viewer.cookie })).status, 403);
assert.equal((await req('/api/data/sql', { method: 'POST', cookie: viewer.cookie, headers: H, body: { connection: 'nope', query: 'select 1' } })).status, 403);
// the home page hides what a viewer cannot use, and shows it to a designer
const home = async (c) => (await req('/', { cookie: c })).text();
const vh = await home(viewer.cookie), dh = await home(designer.cookie);
assert.ok(!vh.includes('New report') && !vh.includes('/designer/'), 'viewer home: no create or design');
assert.ok(vh.includes('Sign out') && vh.includes(`/viewer/${RID}`), 'viewer home: sign-out and view links');
assert.ok(dh.includes('New report') && dh.includes(`/designer/${RID}`), 'designer home: create and design');
// path tricks
assert.equal((await req('/api/reports%2F..%2Fusers', { cookie: viewer.cookie })).status, 400);
assert.equal((await req('/API/USERS', { cookie: designer.cookie })).status, 403);
r = await req('/api/users/', { cookie: designer.cookie }); // Next first drops the slash (308), then the proxy says no
assert.equal(r.status === 308 ? (await req(new URL(r.headers.get('location'), BASE).pathname, { cookie: designer.cookie })).status : r.status, 403);
// a server render calls /api/sample on this server with a one-GET pass
r = await req(`/api/reports/${RID}/pdf?accountId=LN-2025-001982`, { cookie: viewer.cookie });
assert.equal(r.status, 200, await r.clone().text());
assert.equal(r.headers.get('x-pagewright-pages'), '2');

const pv = await page();
await pv.context().addCookies([{ name: 'pw_session', value: viewer.cookie.split('=')[1], url: BASE }]);
await pv.goto(`${BASE}/viewer/${RID}?accountId=LN-2025-001982`);
await pv.waitForFunction(() => document.querySelectorAll('.vpage').length === 2);
assert.ok((await pv.$$eval('.vpage text', ns => ns.map(n => n.textContent))).includes('Arjun Mehta'));
const denied = await pv.goto(`${BASE}/designer/${RID}`);
assert.equal(denied.status(), 403);
await pv.getByRole('heading', { name: 'No access' }).waitFor();

step('a role change counts at once');
await pa.getByLabel(`Role of ${DESIGNER}`).selectOption('viewer');
await pa.getByText(`${DESIGNER} is now viewer.`).waitFor();
assert.equal((await req(`/api/reports/${RID}`, { method: 'PUT', cookie: designer.cookie, headers: H, body: def })).status, 403);
assert.deepEqual(await (await req('/api/auth/me', { cookie: designer.cookie })).json(), { email: DESIGNER, role: 'viewer' });

step('reset a password, disable, delete');
await pa.getByRole('row', { name: new RegExp(DESIGNER) }).getByRole('button', { name: 'Reset password' }).click();
await pa.getByLabel(`New password for ${DESIGNER}`).fill('another e2e password');
await pa.getByRole('button', { name: 'Save password' }).click();
await pa.getByText(`New password set for ${DESIGNER}.`).waitFor();
assert.equal((await req('/api/auth/me', { cookie: designer.cookie })).status, 401); // old session ended
assert.equal((await signIn(DESIGNER, 'another e2e password')).status, 200);
await pa.getByRole('row', { name: new RegExp(DESIGNER) }).getByRole('button', { name: 'Disable' }).click();
await pa.getByText(`${DESIGNER} is disabled.`).waitFor();
assert.equal((await signIn(DESIGNER, 'another e2e password')).status, 401);
pa.once('dialog', d => d.accept());
await pa.getByRole('button', { name: `Delete ${DESIGNER}` }).click();
await pa.getByText(`Deleted ${DESIGNER}.`).waitFor();
assert.equal((await req('/api/users', { cookie: admin.cookie })).ok, true);
assert.ok(!(await (await req('/api/users', { cookie: admin.cookie })).text()).includes(DESIGNER));

step('the last admin cannot be demoted');
r = await req(`/api/users/${encodeURIComponent(ADMIN)}`, { method: 'PATCH', cookie: admin.cookie, headers: H, body: { role: 'viewer' } });
const others = JSON.parse(await (await req('/api/users', { cookie: admin.cookie })).text()).filter(u => u.role === 'admin' && !u.disabled && u.email !== ADMIN);
if (!others.length) { assert.equal(r.status, 409); assert.match((await r.json()).error, /last admin/); }

step('sign-out: the cookie is cleared and the session is dead on the server');
await pv.goto(`${BASE}/login`);
await pv.getByText(`You are signed in as ${VIEWER}`).waitFor();
await pv.getByRole('button', { name: 'Sign out' }).click();
await pv.getByLabel('Email').waitFor();
await pv.goto(`${BASE}/`);
await pv.waitForURL(/\/login\?next=%2F$/);
assert.equal((await req('/api/auth/me', { cookie: viewer.cookie })).status, 401);

step('no open redirect after sign-in');
for (const next of ['https://evil.test/', '//evil.test/', '/\\evil.test/', '/%09/evil.test']) {
  const p = await page();
  await p.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await p.getByLabel('Email').fill(VIEWER);
  await p.getByLabel('Password').fill(PW);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith('/login'));
  assert.equal(new URL(p.url()).origin, BASE, next);
  await p.context().close();
}

step('sign-in rate limit: 10 failures per address, 50 per email from anywhere, then 429');
const victim = `victim-${run}@e2e.test`;
for (let i = 0; i < 10; i++) assert.equal((await signIn(victim, `wrong password ${i}`)).status, 401);
r = await req('/api/auth/login', { method: 'POST', headers: H, body: { email: victim, password: 'x'.repeat(12) } });
assert.equal(r.status, 429);
assert.ok(Number(r.headers.get('retry-after')) > 0);
// Next passes a client's X-Forwarded-For on, so a made-up address gets a fresh 10, but only up to 50 per email
for (let i = 0; i < 40; i++) assert.equal((await signIn(victim, 'wrong password', { ...H, 'x-forwarded-for': `203.0.113.${i}` })).status, 401);
assert.equal((await signIn(victim, 'wrong password', { ...H, 'x-forwarded-for': '198.51.100.1' })).status, 429);

step('clean up');
await req(`/api/users/${encodeURIComponent(VIEWER)}`, { method: 'DELETE', cookie: admin.cookie, headers: H });
await req(`/api/reports/${RID}`, { method: 'DELETE', cookie: admin.cookie, headers: H });
await b.close();
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
assert.equal(errs.length, 0);
console.log('PASS users');
