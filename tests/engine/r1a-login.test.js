// R1-A S-2: the unauthenticated admin lockout (external review 2, §2 #3): 50 wrong passwords for admin@…, each with a
// different X-Forwarded-For, then the admin's right password got 429 for 15 minutes, renewable forever.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUser } from '../../src/server/users.js';
import { clientAddress, unlockLogin } from '../../src/server/limits.js';
import { POST as login } from '../../app/api/auth/login/route.js';
import { PATCH as userPatch } from '../../app/api/users/[email]/route.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-login-'));
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r1a-secret-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}` };
const saved = {};
const BASE = 'http://pw.test';
const PW = 'the real admin password';
// x-pw-peer: the socket's address, as instrumentation.js stamps it on every request (limits.js trackPeers)
const signIn = (email, password, peer, xff) => login(new Request(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': peer, ...(xff && { 'x-forwarded-for': xff }) }, body: JSON.stringify({ email, password }),
}));

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.__pwPeers = true;
  await createUser({ email: 'admin@x.test', role: 'admin', password: PW });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete globalThis.__pwPeers;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('S-2: the admin is not locked out of a browser they used (limits.checkCredential)', () => {
  it('the review repro: 50 wrong passwords with a rotating X-Forwarded-For; the admin\'s own browser still signs in', async () => {
    const mine = (await signIn('admin@x.test', PW, '192.0.2.10')).headers.getSetCookie().find(c => c.startsWith('pw_device=')).split(';')[0];
    const codes = [];
    for (let i = 0; i < 50; i++) codes.push((await signIn('admin@x.test', 'wrong password', '198.51.100.66', `203.0.113.${i}`)).status);
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes.slice(10).every(c => c === 429)).toBe(true); // capped (made-up headers buy nothing)
    const ok = await login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': '192.0.2.10', cookie: mine }, body: JSON.stringify({ email: 'admin@x.test', password: PW }) }));
    expect(ok.status).toBe(200); // a browser that signed in before is not under the account's cap
    expect((await ok.json()).email).toBe('admin@x.test');
  });

  it('X-Forwarded-For is believed only from PW_TRUSTED_PROXIES, walked past the trusted hops', () => {
    const rq = (peer, xff) => new Request(BASE, { headers: { 'x-pw-peer': peer, ...(xff && { 'x-forwarded-for': xff }) } });
    expect(clientAddress(rq('203.0.113.5', '1.2.3.4'))).toBe('203.0.113.5');
    process.env.PW_TRUSTED_PROXIES = '10.0.0.0/8, 127.0.0.1';
    try {
      expect(clientAddress(rq('127.0.0.1', '1.2.3.4, 10.1.1.1'))).toBe('1.2.3.4');
      expect(clientAddress(rq('::ffff:127.0.0.1', '1.2.3.4'))).toBe('1.2.3.4');
      expect(clientAddress(rq('10.2.2.2', 'evil, 5.6.7.8, 10.3.3.3'))).toBe('5.6.7.8');
      expect(clientAddress(rq('203.0.113.5', '1.2.3.4'))).toBe('203.0.113.5'); // not a trusted peer
    } finally { delete process.env.PW_TRUSTED_PROXIES; }
    // a process that does not stamp peers believes nothing the client sent
    delete globalThis.__pwPeers;
    try { expect(clientAddress(rq('1.1.1.1', '2.2.2.2'))).toBe('-'); } finally { globalThis.__pwPeers = true; }
  });

  it('an admin unlock starts the account\'s counts afresh', async () => {
    await createUser({ email: 'u@x.test', role: 'viewer', password: PW });
    for (let i = 0; i < 10; i++) await signIn('u@x.test', 'wrong password', `198.51.100.${100 + i}`);
    expect((await signIn('u@x.test', PW, '198.51.100.77')).status).toBe(429);
    await unlockLogin('u@x.test');
    expect((await signIn('u@x.test', PW, '198.51.100.77')).status).toBe(200);
  });
});
