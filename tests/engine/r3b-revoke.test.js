// R3-B: session revocation races. A sign-out everywhere (or a password change, disabling) that lands while a write is
// in flight refuses that write; a revoke on another server (a separate process here) refuses writes on this one at
// once and reads within about a second.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-revoke-'));
const DB = path.join(tmp, 's.db');
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-revoke-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${DB}` };
const saved = {};
const BASE = 'http://pw.test';
let users, session, perms, route, store;
beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  perms = await import('../../src/server/perms.js');
  route = await import('../../app/api/reports/[id]/route.js');
  ({ store } = await import('../../src/server/storage/index.js'));
  for (const e of ['alice@x.test', 'bob@x.test']) await users.createUser({ email: e, role: 'designer', password: 'a long password 1' });
});
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });

const cookieOf = async (email) => session.sessionCookie(new Request(BASE), await users.getUser(email)).split(';')[0];
const put = (id, cookie, body) => route.PUT(new Request(`${BASE}/api/reports/${id}`, { method: 'PUT', headers: { origin: BASE, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const get = (id, cookie) => route.GET(new Request(`${BASE}/api/reports/${id}`, { headers: { cookie } }), { params: Promise.resolve({ id }) });
const nameOf = async (id) => JSON.parse(await store().get('reports', id)).name;

describe('revocation', () => {
  it('a sign-out everywhere during an in-flight save refuses the save', async () => {
    const c = await cookieOf('alice@x.test');
    expect((await put('inflight', c, { name: 'v1' })).status).toBe(200);
    let release;
    const held = perms.withReport('inflight', () => new Promise(r => { release = r; })); // the save waits for this lock
    await new Promise(r => setTimeout(r, 50));
    const pending = put('inflight', c, { name: 'v2 after the revoke' });
    await new Promise(r => setTimeout(r, 100)); // the save resolved its principal and waits
    await users.endSessions('alice@x.test', { everywhere: true });
    release(); await held;
    const r = await pending;
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await nameOf('inflight')).toBe('v1');
  });
  it('a revoke on another server: a write here within 1 s is refused, and a read within about a second', async () => {
    const c = await cookieOf('bob@x.test');
    expect((await put('replica', c, { name: 'v1' })).status).toBe(200);
    expect((await get('replica', c)).status).toBe(200); // the user is in this server's cache now
    const code = `const u = await import(${JSON.stringify(pathToFileURL(path.resolve('src/server/users.js')).href)}); await u.endSessions('bob@x.test', { everywhere: true }); process.stdout.write('done');`;
    const out = await new Promise((resolve) => {
      const cp = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = '', e = ''; cp.stdout.on('data', d => (o += d)); cp.stderr.on('data', d => (e += d)); cp.on('exit', () => resolve(o || e));
    });
    expect(out).toBe('done');
    const t0 = Date.now();
    expect((await put('replica', c, { name: 'v2' })).status).toBeGreaterThanOrEqual(400); // at once: writes read storage
    expect(await nameOf('replica')).toBe('v1');
    let readOk = true;
    while (Date.now() - t0 < 1500 && readOk) { readOk = (await get('replica', c)).status === 200; if (readOk) await new Promise(r => setTimeout(r, 100)); }
    expect(readOk, 'reads stop within ~1 s (the usergen stamp)').toBe(false);
  });
  it('a sign-out and a new sign-in on another server: the new session works here at once (no stale-cache 401)', async () => {
    await users.createUser({ email: 'carol@x.test', role: 'designer', password: 'a long password 1' });
    const old = await cookieOf('carol@x.test');
    expect((await get('replica', old)).status).toBe(200); // carol is in this server's cache now
    // another server: sign-out (version + 1), then a sign-in issues a cookie with the new version
    const u = JSON.parse(await store().get('users', 'carol@x.test'));
    await store().put('users', 'carol@x.test', JSON.stringify({ ...u, sessionVersion: u.sessionVersion + 1 }));
    const fresh = session.sessionCookie(new Request(BASE), { ...u, sessionVersion: u.sessionVersion + 1 }).split(';')[0];
    expect((await get('replica', fresh)).status).toBe(200); // not 401
    const me = await session.currentUser(new Request(BASE, { headers: { cookie: fresh } }));
    expect(me?.email).toBe('carol@x.test');
  });
});
