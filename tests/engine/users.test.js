// C2: user accounts, roles and sessions (PW_AUTH=users). Users live in SQLite storage in a temp folder.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword, createUser, updateUser, deleteUser, listUsers, getUser } from '../../src/server/users.js';
import { currentUser, signSession, sameOrigin, ROLE_RANK, COOKIE } from '../../src/server/session.js';
import { decide, guard } from '../../src/server/access.js';
import { serverFetch } from '../../src/server/safeFetch.js';
import { store } from '../../src/server/storage/index.js';
import { proxy } from '../../proxy.js';
import { POST as login } from '../../app/api/auth/login/route.js';
import { POST as logout } from '../../app/api/auth/logout/route.js';
import { GET as me } from '../../app/api/auth/me/route.js';
import { GET as usersGet, POST as usersPost } from '../../app/api/users/route.js';
import { PATCH as userPatch, DELETE as userDelete } from '../../app/api/users/[email]/route.js';
import { POST as sqlPost } from '../../app/api/data/sql/route.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-users-'));
const SECRET = 'test-secret-'.padEnd(48, 'x');
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: SECRET, PW_STORAGE: `sqlite:${path.join(tmp, 'users.db')}` };
const saved = {};
let dbn = 0;

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  const db = new DatabaseSync(path.join(tmp, 'data.db'));
  db.exec("create table t (n integer); insert into t values (1), (2);");
  db.close();
  process.env.PW_DB_MAIN = `sqlite:${path.join(tmp, 'data.db')}`;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.PW_DB_MAIN;
  fs.rmSync(tmp, { recursive: true, force: true });
});
// every test starts with an empty user table of its own
beforeEach(() => { process.env.PW_STORAGE = `sqlite:${path.join(tmp, `users-${++dbn}.db`)}`; });

const withEnv = async (vars, fn) => {
  const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

const ORIGIN = 'http://pw.test';
/** A request as the browser sends it: same-site Origin on unsafe methods unless told otherwise. */
const rq = (p, { method = 'GET', cookie, origin, headers = {}, body, base = ORIGIN } = {}) => new Request(base + p, {
  method,
  headers: { ...(cookie && { cookie }), ...(origin !== null && method !== 'GET' && { origin: origin ?? base }), ...headers, ...(body !== undefined && { 'content-type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const signIn = async (email, password, opts = {}) => login(rq('/api/auth/login', { method: 'POST', body: { email, password }, ...opts }));
const PW = 'correct horse battery';
const as = async (role, email = `${role}@x.io`) => {
  await createUser({ email, role, password: PW });
  const res = await signIn(email, PW);
  expect(res.status).toBe(200);
  return cookieOf(res);
};
const params = (email) => ({ params: Promise.resolve({ email: encodeURIComponent(email) }) });

describe('passwords', () => {
  it('hashes with scrypt, a random salt and the parameters stored alongside', async () => {
    const a = await hashPassword(PW), b = await hashPassword(PW);
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword('correct horse battery!', a)).toBe(false);
    expect(await verifyPassword(PW, 'garbage')).toBe(false);
    expect(await verifyPassword(PW, '')).toBe(false);
  });
  it('needs at least 10 characters', async () => {
    await expect(createUser({ email: 'a@x.io', role: 'viewer', password: 'short' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/10 characters/) });
    await expect(createUser({ email: 'a@x.io', role: 'viewer', password: 'x'.repeat(5000) })).rejects.toMatchObject({ status: 400 });
  });
  it('never returns a hash', async () => {
    const u = await createUser({ email: 'Ann@X.io', role: 'designer', password: PW });
    expect(u).toEqual({ email: 'ann@x.io', role: 'designer', disabled: false, createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect(JSON.stringify(await listUsers())).not.toMatch(/scrypt|passwordHash/);
    const admin = await as('admin');
    const res = await usersGet(rq('/api/users', { cookie: admin }));
    expect(JSON.stringify(await res.json())).not.toMatch(/scrypt|passwordHash/);
  });
  it('checks emails, roles and duplicates', async () => {
    await createUser({ email: 'b@x.io', role: 'viewer', password: PW });
    await expect(createUser({ email: 'B@X.IO ', role: 'viewer', password: PW })).rejects.toMatchObject({ status: 409 });
    await expect(createUser({ email: 'not-an-email', role: 'viewer', password: PW })).rejects.toMatchObject({ status: 400 });
    await expect(createUser({ email: 'a/b@x.io', role: 'viewer', password: PW })).rejects.toMatchObject({ status: 400 });
    await expect(createUser({ email: 'c@x.io', role: 'root', password: PW })).rejects.toMatchObject({ status: 400 });
  });
});

describe('sign-in and the session cookie', () => {
  it('creates the first admin from PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD, then signs in', () => withEnv({ PW_ADMIN_EMAIL: 'Boss@X.io', PW_ADMIN_PASSWORD: PW }, async () => {
    const res = await signIn('BOSS@x.io', PW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'boss@x.io', role: 'admin' });
    const c = res.headers.get('set-cookie');
    expect(c).toMatch(new RegExp(`^${COOKIE}=[\\w-]+\\.[\\w-]+;`));
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) expect(c).toContain(part);
    expect(c).not.toMatch(/Secure/);
    expect((await signIn('boss@x.io', PW, { base: 'https://pw.test' })).headers.get('set-cookie')).toMatch(/; Secure/);
    expect((await signIn('boss@x.io', PW, { headers: { 'x-forwarded-proto': 'https' } })).headers.get('set-cookie')).toMatch(/; Secure/);
    expect((await listUsers()).length).toBe(1); // only once
  }));
  it('refuses a wrong password, an unknown user and a disabled user with the same message', async () => {
    await createUser({ email: 'v@x.io', role: 'viewer', password: PW });
    await createUser({ email: 'off@x.io', role: 'viewer', password: PW });
    await updateUser('off@x.io', { disabled: true });
    const msgs = [];
    for (const [e, p] of [['v@x.io', 'wrong password!'], ['nobody@x.io', PW], ['off@x.io', PW]]) {
      const res = await signIn(e, p);
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBe(null);
      msgs.push((await res.json()).error);
    }
    expect(new Set(msgs).size).toBe(1);
  });
  it('reads the user back from the cookie: me and currentUser', async () => {
    const c = await as('designer');
    expect(await currentUser(rq('/', { cookie: c }))).toEqual({ email: 'designer@x.io', role: 'designer' });
    expect(await (await me(rq('/api/auth/me', { cookie: c }))).json()).toEqual({ email: 'designer@x.io', role: 'designer' });
    expect((await me(rq('/api/auth/me'))).status).toBe(401);
  });
  it('rejects a tampered, foreign, expired or garbage cookie', async () => {
    const c = await as('viewer');
    const [body, sig] = c.slice(COOKIE.length + 1).split('.');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...p, r: 'admin' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      `${forged}.${sig}`,
      `${body}.${sig.slice(0, -2)}AA`,
      `${body}.`, body, '', 'x.y.z', `${body}.${sig}.${sig}`,
      signSession({ ...p, exp: now - 1 }),
      await withEnv({ PW_SESSION_SECRET: 'another-secret-'.padEnd(48, 'y') }, () => signSession(p)),
    ];
    for (const t of bad) expect(await currentUser(rq('/', { cookie: `${COOKIE}=${t}` })), t).toBe(null);
    expect(await currentUser(rq('/', { cookie: `${COOKIE}=${signSession({ ...p, exp: now + 60 })}` }))).toMatchObject({ role: 'viewer' });
  });
  it('a role change counts at once; a deleted, disabled or re-passworded user is out at once', async () => {
    const admin = await as('admin');
    const c = await as('designer', 'd@x.io');
    await updateUser('d@x.io', { role: 'viewer' });
    expect(await currentUser(rq('/', { cookie: c }))).toEqual({ email: 'd@x.io', role: 'viewer' });
    expect((await guard(rq('/designer/sales', { cookie: c }))).status).toBe(403);

    await updateUser('d@x.io', { disabled: true });
    expect(await currentUser(rq('/', { cookie: c }))).toBe(null);
    await updateUser('d@x.io', { disabled: false });
    expect(await currentUser(rq('/', { cookie: c }))).toBe(null); // disabling ended the session for good

    const c2 = cookieOf(await signIn('d@x.io', PW));
    // disabled in storage by another server or by hand (no session bump): still out, once the cache expires
    const rec = await getUser('d@x.io');
    await store().put('users', 'd@x.io', JSON.stringify({ ...rec, disabled: true }));
    vi.useFakeTimers({ toFake: ['Date'] });
    try { vi.setSystemTime(Date.now() + 11000); expect(await currentUser(rq('/', { cookie: c2 }))).toBe(null); } finally { vi.useRealTimers(); }
    await store().put('users', 'd@x.io', JSON.stringify(rec));
    await updateUser('d@x.io', { password: 'a brand new password' });
    expect(await currentUser(rq('/', { cookie: c2 }))).toBe(null);

    const c3 = cookieOf(await signIn('d@x.io', 'a brand new password'));
    expect((await userDelete(rq('/api/users/d@x.io', { method: 'DELETE', cookie: admin }), params('d@x.io'))).status).toBe(200);
    expect(await currentUser(rq('/', { cookie: c3 }))).toBe(null);
  });
  it('sign-out clears the cookie and ends the session on the server too', async () => {
    const c = await as('viewer');
    const res = await logout(rq('/api/auth/logout', { method: 'POST', cookie: c }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${COOKIE}=;.*Max-Age=0`));
    expect(await currentUser(rq('/', { cookie: c }))).toBe(null); // a copied cookie is dead too
  });
});

describe('sign-in rate limit', () => {
  it('allows 10 failures per address and email in 15 minutes, then answers 429 even to the right password', async () => {
    await createUser({ email: 'r@x.io', role: 'viewer', password: PW });
    await createUser({ email: 's@x.io', role: 'viewer', password: PW });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const ip = (a) => ({ headers: { 'x-forwarded-for': `${a}, 10.0.0.7` } }); // the last hop is the one our server saw
      for (let i = 0; i < 10; i++) expect((await signIn('r@x.io', 'wrong password!', ip(`1.1.1.${i}`))).status).toBe(401);
      const blocked = await signIn('R@x.io', PW, ip('9.9.9.9'));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBeTruthy();
      expect((await signIn('s@x.io', PW, ip('1.1.1.1'))).status).toBe(200); // another email is not blocked
      expect((await signIn('r@x.io', PW, { headers: { 'x-forwarded-for': '10.0.0.8' } })).status).toBe(200); // another address is not
      vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000);
      expect((await signIn('r@x.io', PW, ip('1.1.1.1'))).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
  it('caps one email at 50 failures from all addresses, so a made-up X-Forwarded-For buys little', async () => {
    await createUser({ email: 'q@x.io', role: 'viewer', password: PW });
    for (let i = 0; i < 50; i++) expect((await signIn('q@x.io', 'wrong password!', { headers: { 'x-forwarded-for': `5.5.${i}.1` } })).status).toBe(401);
    expect((await signIn('q@x.io', PW, { headers: { 'x-forwarded-for': '6.6.6.6' } })).status).toBe(429);
  });
});

describe('CSRF: unsafe methods must come from this site', () => {
  it('checks Origin, then Referer, against the request host', () => {
    const r = (h) => new Request('http://pw.test/api/reports/x', { method: 'PUT', headers: { host: 'pw.test', ...h } });
    expect(sameOrigin(r({ origin: 'http://pw.test' }))).toBe(true);
    expect(sameOrigin(r({ referer: 'http://pw.test/designer/x' }))).toBe(true);
    expect(sameOrigin(r({ origin: 'http://evil.test' }))).toBe(false);
    expect(sameOrigin(r({ origin: 'http://pw.test.evil.test' }))).toBe(false);
    expect(sameOrigin(r({ origin: 'null' }))).toBe(false);
    expect(sameOrigin(r({ referer: 'http://evil.test/?http://pw.test' }))).toBe(false);
    expect(sameOrigin(r({}))).toBe(false);
  });
  it('the proxy refuses a cross-site or origin-less write, even with a valid session', async () => {
    const c = await as('designer');
    expect((await guard(rq('/api/reports/x', { method: 'PUT', cookie: c, origin: 'http://evil.test' }))).status).toBe(403);
    expect((await guard(rq('/api/reports/x', { method: 'PUT', cookie: c, origin: null }))).status).toBe(403);
    expect((await guard(rq('/api/auth/login', { method: 'POST', origin: 'http://evil.test' }))).status).toBe(403); // login CSRF
    expect(await guard(rq('/api/reports/x', { method: 'PUT', cookie: c }))).toBe(null);
    expect(await guard(rq('/api/reports/x', { cookie: c }))).toBe(null); // GET needs no Origin
    expect(await guard(rq('/api/v1/render', { method: 'POST', origin: null }))).toBe(null); // API keys, not cookies
  });
});

describe('the last admin', () => {
  it('cannot be demoted, disabled or deleted; another admin can', async () => {
    const admin = await as('admin', 'a1@x.io');
    for (const patch of [{ role: 'designer' }, { disabled: true }]) await expect(updateUser('a1@x.io', patch)).rejects.toMatchObject({ status: 409 });
    await expect(deleteUser('a1@x.io')).rejects.toMatchObject({ status: 409 });
    const res = await userPatch(rq('/api/users/a1@x.io', { method: 'PATCH', cookie: admin, body: { role: 'viewer' } }), params('a1@x.io'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/last admin/i);
    await createUser({ email: 'a2@x.io', role: 'admin', password: PW });
    await updateUser('a2@x.io', { disabled: true });
    await expect(deleteUser('a1@x.io')).rejects.toMatchObject({ status: 409 }); // a disabled admin does not count
    await updateUser('a2@x.io', { disabled: false });
    expect((await updateUser('a1@x.io', { role: 'viewer' })).role).toBe('viewer');
    await expect(deleteUser('a2@x.io')).rejects.toMatchObject({ status: 409 });
  });
});

describe('/api/users', () => {
  it('is for admins only, also inside the route', async () => {
    const d = await as('designer');
    for (const res of [
      await usersGet(rq('/api/users', { cookie: d })),
      await usersGet(rq('/api/users')),
      await usersPost(rq('/api/users', { method: 'POST', cookie: d, body: { email: 'z@x.io', role: 'admin', password: PW } })),
      await userPatch(rq('/api/users/designer@x.io', { method: 'PATCH', cookie: d, body: { role: 'admin' } }), params('designer@x.io')),
      await userDelete(rq('/api/users/designer@x.io', { method: 'DELETE', cookie: d }), params('designer@x.io')),
    ]) expect(res.status).toBe(403);
    expect((await getUser('designer@x.io')).role).toBe('designer');
  });
  it('lets an admin add, change, reset, disable and delete users', async () => {
    const a = await as('admin');
    let res = await usersPost(rq('/api/users', { method: 'POST', cookie: a, body: { email: 'New@x.io', role: 'viewer', password: PW } }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: 'new@x.io', role: 'viewer' });
    res = await userPatch(rq('/api/users/new@x.io', { method: 'PATCH', cookie: a, body: { role: 'designer', password: 'reset password 1', disabled: true } }), params('new@x.io'));
    expect(await res.json()).toMatchObject({ email: 'new@x.io', role: 'designer', disabled: true });
    expect((await signIn('new@x.io', 'reset password 1')).status).toBe(401); // disabled
    await updateUser('new@x.io', { disabled: false });
    expect((await signIn('new@x.io', 'reset password 1')).status).toBe(200);
    res = await userPatch(rq('/api/users/nobody@x.io', { method: 'PATCH', cookie: a, body: { role: 'viewer' } }), params('nobody@x.io'));
    expect(res.status).toBe(404);
    res = await userPatch(rq('/api/users/new@x.io', { method: 'PATCH', cookie: a, body: { role: 'owner' } }), params('new@x.io'));
    expect(res.status).toBe(400);
    expect((await userDelete(rq('/api/users/new@x.io', { method: 'DELETE', cookie: a }), params('new@x.io'))).status).toBe(200);
    expect(await getUser('new@x.io')).toBe(null);
  });
  it('keeps an admin signed in after changing their own password', async () => {
    const a = await as('admin');
    const res = await userPatch(rq('/api/users/admin@x.io', { method: 'PATCH', cookie: a, body: { password: 'my new admin password' } }), params('admin@x.io'));
    expect(res.status).toBe(200);
    expect(await currentUser(rq('/', { cookie: a }))).toBe(null);
    expect(await currentUser(rq('/', { cookie: cookieOf(res) }))).toEqual({ email: 'admin@x.io', role: 'admin' });
  });
});

describe('who may do what (decide)', () => {
  const A = 'open', Y = 'allow', N = 'deny', S = 'signin', X = 'bad';
  // [method, path, anonymous, viewer, designer, admin]
  const table = [
    ['GET', '/', S, Y, Y, Y],
    ['GET', '/viewer/sales', S, Y, Y, Y],
    ['GET', '/designer/sales', S, N, Y, Y],
    ['GET', '/admin/users', S, N, N, Y],
    ['GET', '/login', A, A, A, A],
    ['GET', '/api/reports', S, Y, Y, Y],
    ['HEAD', '/api/reports', S, Y, Y, Y],
    ['POST', '/api/reports', S, N, Y, Y],
    ['GET', '/api/reports/sales', S, Y, Y, Y],
    ['PUT', '/api/reports/sales', S, N, Y, Y],
    ['DELETE', '/api/reports/sales', S, N, Y, Y],
    ['GET', '/api/reports/sales/pdf', S, Y, Y, Y],
    ['GET', '/api/reports/sales/versions', S, Y, Y, Y],
    ['POST', '/api/reports/sales/versions', S, N, Y, Y],
    ['GET', '/api/reports/sales/thumb', S, Y, Y, Y],
    ['POST', '/api/reports/import', S, N, Y, Y],
    ['GET', '/api/reports/sales/other', S, N, Y, Y],
    ['POST', '/api/data/sql', S, Y, Y, Y],
    ['GET', '/api/data/sql', S, N, N, Y],
    ['GET', '/api/data/proxy', S, Y, Y, Y],
    ['POST', '/api/data/proxy', S, N, N, Y],
    ['GET', '/api/sample/loans/LN-1', S, Y, Y, Y],
    ['POST', '/api/ai/report', S, N, Y, Y],
    ['GET', '/api/users', S, N, N, Y],
    ['POST', '/api/users', S, N, N, Y],
    ['PATCH', '/api/users/a@x.io', S, N, N, Y],
    ['DELETE', '/api/users/a@x.io', S, N, N, Y],
    ['GET', '/api/auth/me', S, Y, Y, Y],
    ['GET', '/api/fonts', S, Y, Y, Y],
    ['POST', '/api/fonts', S, N, Y, Y],
    ['DELETE', '/api/fonts/0123456789abcdef', S, N, Y, Y],
    ['PUT', '/api/fonts/0123456789abcdef', S, N, Y, Y],
    ['POST', '/api/fonts/a/b', S, N, N, Y],
    ['GET', '/fonts/custom/0123456789abcdef', A, A, A, A],
    ['GET', '/fonts/harfbuzz.wasm', A, A, A, A],
    ['POST', '/api/auth/login', A, A, A, A],
    ['POST', '/api/auth/logout', A, A, A, A],
    ['GET', '/api/something-new', S, N, N, Y],
    ['POST', '/', S, N, N, Y],
    ['GET', '/_next/static/chunks/app.js', A, A, A, A],
    ['GET', '/fonts/Inter-Regular.ttf', A, A, A, A],
    ['GET', '/harfbuzz-subset.wasm', A, A, A, A],
    ['GET', '/icc/sRGB-v2-magic.icc', A, A, A, A],
    ['GET', '/favicon.ico', A, A, A, A],
    ['GET', '/embed/pagewright-viewer.js', A, A, A, A],
    ['POST', '/api/v1/render', A, A, A, A],
    // path tricks
    ['GET', '/api/users/', S, N, N, Y],
    ['GET', '/api/reports/sales/', S, Y, Y, Y],
    ['GET', '/API/USERS', S, N, N, Y],
    ['GET', '/Api/Reports', S, N, N, Y],
    ['GET', '/api/users/../reports', X, X, X, X],
    ['GET', '/api/users/%2e%2e/reports', X, X, X, X],
    ['GET', '/api/users/%2E%2E/reports', X, X, X, X],
    ['GET', '/api/reports/..%2fusers', X, X, X, X],
    ['GET', '/api/reports%2Fx', X, X, X, X],
    ['GET', '/api/reports/x%5c..%5c..%5capi%5cusers', X, X, X, X],
    ['GET', '/_next/../api/users', X, X, X, X],
    ['GET', '/_next/%2e%2e/api/users', X, X, X, X],
    ['GET', '/api/v1/..%2fusers', X, X, X, X],
    ['GET', '//api/users', X, X, X, X],
    ['GET', '/api//users', X, X, X, X],
    ['GET', '/api/reports/x%00', X, X, X, X],
    ['GET', '/api/reports/%E0%A4%A', X, X, X, X],
    ['GET', '/api/report%73', S, Y, Y, Y], // decodes to /api/reports: the same rule as the plain path
    ['POST', '/api/report%73/x', S, N, Y, Y],
    ['GET', '/api/user%73', S, N, N, Y],
  ];
  it.each(table)('%s %s', (method, p, ...want) => {
    expect([null, 'viewer', 'designer', 'admin'].map(r => decide(method, p, r))).toEqual(want);
  });
  it('ranks roles', () => expect(ROLE_RANK.viewer < ROLE_RANK.designer && ROLE_RANK.designer < ROLE_RANK.admin).toBe(true));
  it('opens report definitions and sample data to embeds (GET only) when PW_EMBED_ORIGINS is set', () => withEnv({ PW_EMBED_ORIGINS: 'http://localhost:4000' }, () => {
    expect(decide('GET', '/api/reports/sales', null)).toBe('open');
    expect(decide('GET', '/api/sample/loans', null)).toBe('open');
    expect(decide('GET', '/api/reports', null)).toBe('signin');
    expect(decide('PUT', '/api/reports/sales', null)).toBe('signin');
    expect(decide('GET', '/api/reports/sales/pdf', null)).toBe('signin');
  }));
});

describe('the proxy', () => {
  it('sends pages to /login with a local next, and APIs a 401', async () => {
    let res = await guard(rq('/designer/sales?x=1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Fdesigner%2Fsales%3Fx%3D1`);
    res = await guard(rq('/api/reports'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/sign in/i) });
    expect((await guard(rq('/api/reports%2F..%2Fusers'))).status).toBe(400);
    expect((await guard(rq('/api/users/%2e%2e/reports'))).status).toBe(401); // the URL parser already made it /api/reports
  });
  it('answers 403 to a signed-in user without the role', async () => {
    const v = await as('viewer');
    expect((await guard(rq('/designer/sales', { cookie: v }))).status).toBe(403);
    expect((await guard(rq('/api/reports/sales', { method: 'PUT', cookie: v }))).status).toBe(403);
    expect(await guard(rq('/viewer/sales', { cookie: v }))).toBe(null);
  });
  it('keeps PW_BASIC_AUTH when accounts are off, and ignores it when they are on', async () => {
    await withEnv({ PW_AUTH: undefined, PW_BASIC_AUTH: 'u:p' }, async () => {
      expect((await proxy(rq('/designer/x'))).status).toBe(401);
      expect(await proxy(rq('/designer/x', { headers: { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } }))).toBe(undefined);
    });
    await withEnv({ PW_AUTH: undefined, PW_BASIC_AUTH: undefined }, async () => {
      expect(await proxy(rq('/admin/users'))).toBe(undefined); // exactly as before: no gate at all
    });
    await withEnv({ PW_BASIC_AUTH: 'u:p' }, async () => {
      const res = await proxy(rq('/designer/x', { headers: { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } }));
      expect(res.status).toBe(307); // the shared password does not get you in
    });
  });
  it('refuses to serve when PW_AUTH has a typo, rather than leave the app open', () => withEnv({ PW_AUTH: 'user' }, async () => {
    expect((await proxy(rq('/'))).status).toBe(500);
  }));
  it('refuses to serve without PW_SESSION_SECRET in production', () => withEnv({ NODE_ENV: 'production', PW_SESSION_SECRET: undefined }, async () => {
    const res = await guard(rq('/'));
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/PW_SESSION_SECRET/);
    expect((await signIn('a@x.io', PW)).status).toBe(500);
  }));
  it('refuses a short PW_SESSION_SECRET', () => withEnv({ PW_SESSION_SECRET: 'short' }, async () => {
    expect((await guard(rq('/'))).status).toBe(500);
  }));
});

describe('ad-hoc SQL (/api/data/sql)', () => {
  const adhoc = (cookie) => sqlPost(rq('/api/data/sql', { method: 'POST', cookie, body: { connection: 'main', query: 'select n from t order by n' } }));
  it('runs for designers and admins, even in production; others get 403', () => withEnv({ NODE_ENV: 'production' }, async () => {
    const d = await as('designer');
    const a = await as('admin');
    const v = await as('viewer');
    expect(await (await adhoc(d)).json()).toEqual({ rows: [{ n: 1 }, { n: 2 }] });
    expect((await adhoc(a)).status).toBe(200);
    expect((await adhoc(v)).status).toBe(403);
    expect((await adhoc(undefined)).status).toBe(403);
  }));
});

describe('server calls to itself', () => {
  let server, origin, seen;
  beforeAll(async () => {
    server = http.createServer((req, res) => { seen = req.headers.cookie || null; res.end('{}'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());
  it('carry a short-lived viewer pass for that one GET, only to this server', async () => {
    await serverFetch(origin)(`${origin}/api/sample/loans?id=7`);
    expect(seen).toMatch(new RegExp(`^${COOKIE}=`));
    expect(await currentUser(rq('/api/sample/loans?id=7', { cookie: seen }))).toMatchObject({ role: 'viewer', internal: true });
    // a pass that leaks (a Host header can name another site as "this server") opens nothing else
    expect(await currentUser(rq('/api/sample/loans?id=8', { cookie: seen }))).toBe(null);
    expect(await currentUser(rq('/api/reports', { cookie: seen }))).toBe(null);
    expect(await currentUser(rq('/api/sample/loans?id=7', { method: 'POST', cookie: seen }))).toBe(null);
    await withEnv({ PW_INTERNAL_HOSTS: '127.0.0.1' }, () => serverFetch('http://reports.example.com')(`${origin}/x`));
    expect(seen).toBe(null);
  });
  it('do not send the PW_BASIC_AUTH password when accounts are on', () => withEnv({ PW_BASIC_AUTH: 'u:p' }, async () => {
    let auth;
    const s2 = http.createServer((req, res) => { auth = req.headers.authorization || null; res.end('{}'); });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const o = `http://127.0.0.1:${s2.address().port}`;
    try { await serverFetch(o)(`${o}/x`); } finally { s2.close(); }
    expect(auth).toBe(null);
  }));
});

describe('storage of users', () => {
  it('goes through PW_STORAGE (here SQLite), keyed by lower-case email', async () => {
    await createUser({ email: 'S@X.io', role: 'viewer', password: PW });
    expect(await store().ids('users')).toEqual(['s@x.io']);
    expect(await deleteUser('s@x.io')).toBe(true);
    expect(await deleteUser('s@x.io')).toBe(false);
  });
});
