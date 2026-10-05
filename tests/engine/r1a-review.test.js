// The one reviewer round on R1-A S-1..S-4: the fixes, each with the reviewer's repro.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-rev-'));
const keep = { ...process.env };
let limits, store;
beforeAll(async () => {
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r1a-rev-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}`, PW_LOGIN_SLOW_MS: '5000' });
  globalThis.__pwPeers = true;
  limits = await import('../../src/server/limits.js');
  ({ store } = await import('../../src/server/storage/index.js'));
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); delete globalThis.__pwPeers; fs.rmSync(tmp, { recursive: true, force: true }); });

describe('R1-A review fixes', () => {
  it('#1 an IdP group "designers" signs in, as the renamed custom group', async () => {
    const { mapIdentity } = await import('../../src/server/sso.js');
    const id = mapIdentity('ann@x.test', ['designers', 'everyone', 'finance'], { issuer: 'i', subject: 's' });
    expect(id.groups).toEqual(['designers-custom', 'finance']);
  });

  it('#2 behind a proxy nobody configured, the all-accounts cap per address is off (and it says so)', () => {
    const r = (peer, xff) => new Request('http://pw.test/', { headers: { 'x-pw-peer': peer, ...(xff && { 'x-forwarded-for': xff }) } });
    const err = console.error; console.error = () => {};
    try {
      expect(limits.unknownProxy(r('10.0.0.5', '203.0.113.9'))).toBe(true);
      expect(limits.unknownProxy(r('10.0.0.5'))).toBe(false); // no header: a direct client on the LAN
      expect(limits.unknownProxy(r('198.51.100.4', '203.0.113.9'))).toBe(false); // a public peer is the client
      process.env.PW_TRUSTED_PROXIES = '10.0.0.0/8';
      expect(limits.unknownProxy(r('10.0.0.5', '203.0.113.9'))).toBe(false);
    } finally { console.error = err; delete process.env.PW_TRUSTED_PROXIES; }
  });

  it('#3 IPv6 counts by /64; a hot account takes one try at a time across all sources', async () => {
    expect(limits.netKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(limits.netKey('2001:db8:1:2:ffff:1:2:3')).toBe('2001:db8:1:2::/64');
    expect(limits.netKey('203.0.113.5')).toBe('203.0.113.5');
    const email = 'hot@x.test';
    for (let i = 0; i < 50; i++) await limits.loginAttempt(`203.0.113.${i}`, email); // 50 failures (never released)
    const tries = await Promise.all(Array.from({ length: 20 }, (_, i) => limits.loginAttempt(`198.51.100.${i}`, email)));
    expect(tries.filter(t => t.ok)).toHaveLength(1); // one turn per PW_LOGIN_SLOW_MS, not 20 parallel guesses
    expect(tries.find(t => !t.ok).retryAfter).toBe(5);
  });

  it('#10 an unreadable root record is treated as missing, not as a crash of every check', async () => {
    const perms = await import('../../src/server/perms.js');
    await store().put('folders', 'root', '{not json');
    delete globalThis.__pwPermsMigrated;
    const s = await perms.snapshot();
    expect(s.root).toEqual([...perms.DEFAULT_ROOT]);
  });
});
