// S-2, second review: limit names are tuple hashes (no collisions), accounts and networks are normalised, every
// credential path uses the limiter, and a flood from elsewhere cannot keep the real admin out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-lim2-'));
const keep = { ...process.env };
const BASE = 'http://pw.test';
const PW = 'the real admin password';
let limits, login, users;
const signIn = (email, password, peer, cookie) => login(new Request(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': peer, ...(cookie && { cookie }) }, body: JSON.stringify({ email, password }),
}));
beforeAll(async () => {
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r1a-lim2-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}` });
  delete process.env.PW_LOGIN_SLOW_MS;
  globalThis.__pwPeers = true;
  limits = await import('../../src/server/limits.js');
  users = await import('../../src/server/users.js');
  ({ POST: login } = await import('../../app/api/auth/login/route.js'));
  await users.createUser({ email: 'admin@x.test', role: 'admin', password: PW });
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); delete globalThis.__pwPeers; fs.rmSync(tmp, { recursive: true, force: true }); });

describe('S-2 structural', () => {
  it('names are tuple hashes: parts that join to the same string are different limits', () => {
    expect(limits.limitHash(['login', 'a|b', '1.2.3.4'])).not.toBe(limits.limitHash(['login', 'a', 'b|1.2.3.4']));
    expect(limits.limitHash(['login', '::1', 'x'])).not.toBe(limits.limitHash(['login', ':', ':1x']));
    expect(limits.normAccount(' Admin@X.test. ')).toBe('admin@x.test');
    expect(limits.normAccount('ａｄｍｉｎ@x.test')).toBe('admin@x.test'); // NFKC (fullwidth)
    expect(limits.netKey('2001:db8:0:1::a')).toBe(limits.netKey('2001:db8:0:1:ffff::b'));
  });

  it('case variants and a rotating IPv6 /64 share one count', async () => {
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await signIn(i % 2 ? 'ADMIN@x.test' : 'admin@X.TEST', 'wrong', `2001:db8:7:7::${(i + 1).toString(16)}`)).status);
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('wrong API keys go through the same limiter; a right key is not slowed by them', async () => {
    process.env.PW_API_KEYS = 'right-key-0123456789';
    try {
      const { apiPrincipal } = await import('../../src/server/auth.js');
      const call = (key) => apiPrincipal(new Request(`${BASE}/api/v1/templates`, { headers: { authorization: `Bearer ${key}`, 'x-pw-peer': '198.51.100.9' } }));
      const st = [];
      for (let i = 0; i < 101; i++) st.push((await call(`guess-${i}`)).res?.status);
      expect(st[99]).toBe(401);
      expect(st[100]).toBe(429);
      expect((await call('right-key-0123456789')).principal).toMatchObject({ kind: 'service' });
    } finally { delete process.env.PW_API_KEYS; }
  });

  it('10,000 wrong passwords from rotating sources cannot keep the real admin (a known device) out', async () => {
    const first = await signIn('admin@x.test', PW, '192.0.2.1');
    expect(first.status).toBe(200);
    const device = first.headers.getSetCookie().find(c => c.startsWith('pw_device=')).split(';')[0];
    let refused = 0;
    for (let b = 0; b < 50; b++) {
      const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => signIn('admin@x.test', 'wrong', `203.0.${b}.${i}`)));
      refused += rs.filter(r => r.status === 429).length;
      if (b % 10 === 9) expect((await signIn('admin@x.test', PW, '192.0.2.1', device)).status).toBe(200); // during the flood
    }
    expect(refused).toBeGreaterThan(9000); // past 50 failures the flood gets one try per turn, not 10,000 guesses
    expect((await signIn('admin@x.test', PW, '192.0.2.77', device)).status).toBe(200);
  }, 600000);
});
