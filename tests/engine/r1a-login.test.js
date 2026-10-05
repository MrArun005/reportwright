// R1-A S-2: the unauthenticated admin lockout (external review 2, §2 #3): 50 wrong passwords for admin@…, each with a
// different X-Forwarded-For, then the admin's right password got 429 for 15 minutes, renewable forever.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUser } from '../../src/server/users.js';
import { clientAddress } from '../../src/server/limits.js';
import { POST as login } from '../../app/api/auth/login/route.js';
import { PATCH as userPatch } from '../../app/api/users/[email]/route.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-login-'));
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r1a-secret-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}`, PW_CRED_MAX_DELAY_MS: '20', PW_CRED_HOT_DELAY_MS: '30' }; // short waits: the test is about who waits, not how long
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

describe('S-2: nobody can lock the admin out (limits.checkCredential)', () => {
  it('the review repro: 50 wrong passwords with a rotating X-Forwarded-For: never a lockout, the admin signs in', async () => {
    const codes = [];
    for (let i = 0; i < 50; i++) codes.push((await signIn('admin@x.test', 'wrong password', '198.51.100.66', `203.0.113.${i}`)).status);
    expect(codes.every(c => c === 401)).toBe(true); // waits (made-up headers buy nothing: one source), never 429
    const ok = await signIn('admin@x.test', PW, '192.0.2.10');
    expect(ok.status).toBe(200);
    expect((await ok.json()).email).toBe('admin@x.test');
  });

  it('the same attack from 60 real addresses (a botnet) adds only the small hot-account wait', async () => {
    for (let i = 0; i < 60; i++) expect((await signIn('admin@x.test', 'wrong password', `100.64.${i}.1`)).status).toBe(401);
    const t0 = Date.now();
    expect((await signIn('admin@x.test', PW, '192.0.2.11')).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25); // PW_CRED_HOT_DELAY_MS
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

  it('an admin unlock starts the account\'s counts afresh (no wait for the source that failed)', async () => {
    await createUser({ email: 'u@x.test', role: 'viewer', password: PW });
    process.env.PW_CRED_MAX_DELAY_MS = '400';
    try {
      for (let i = 0; i < 6; i++) await signIn('u@x.test', 'wrong password', '198.51.100.77');
      let t0 = Date.now();
      expect((await signIn('u@x.test', PW, '198.51.100.77')).status).toBe(200); // it waited, then signed in
      expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
      for (let i = 0; i < 6; i++) await signIn('u@x.test', 'wrong password', '198.51.100.77');
      const admin = await signIn('admin@x.test', PW, '192.0.2.12');
      const cookie = (admin.headers.get('set-cookie') || '').split(';')[0];
      const r = await userPatch(new Request(`${BASE}/api/users/u@x.test`, { method: 'PATCH', headers: { origin: BASE, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ unlockSignIn: true }) }), { params: Promise.resolve({ email: 'u@x.test' }) });
      expect(r.status).toBe(200);
      t0 = Date.now();
      expect((await signIn('u@x.test', PW, '198.51.100.77')).status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(350);
    } finally { process.env.PW_CRED_MAX_DELAY_MS = '20'; }
  }, 60000);
});
