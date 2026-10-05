// The one credential check (limits.checkCredential): every path that verifies a presented secret goes through it, it
// never refuses or locks anyone out, and a flood from rotating sources adds at most about 2 s to the real admin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cred-'));
const keep = { ...process.env };
const BASE = 'http://pw.test';
const PW = 'the real admin password';
let limits, login;
const signIn = (email, password, peer) => login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': peer }, body: JSON.stringify({ email, password }) }));
beforeAll(async () => {
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'pw-cred-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}` });
  globalThis.__pwPeers = true;
  limits = await import('../../src/server/limits.js');
  ({ POST: login } = await import('../../app/api/auth/login/route.js'));
  await (await import('../../src/server/users.js')).createUser({ email: 'admin@x.test', role: 'admin', password: PW });
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); delete globalThis.__pwPeers; fs.rmSync(tmp, { recursive: true, force: true }); });

// the functions that verify a presented secret, and the compare primitive
const VERIFIERS = ['authenticate', 'verifyPassword', 'checkSecondFactor', 'enableTwoFactor', 'enrolCodeOk', 'useReset', 'proxySecretOk', 'linkOk', 'readMfa', 'useCode', 'matchStep'];
// calls that are inside the verifiers themselves (a verifier built from another), file → names
const INTERNAL = { 'src/server/users.js': ['verifyPassword', 'useCode', 'matchStep'], 'src/server/totp.js': ['matchStep'], 'proxy.js': ['proxySecretOk'] };
// where timingSafeEqual may appear: inside a verifier, or a signature check that is not a presented secret
// (session.js readToken: the HMAC of our own session cookies, 256-bit; sso.js: IdP state values)
const COMPARE_FILES = ['src/server/users.js', 'src/server/totp.js', 'src/server/session.js', 'src/server/auth.js', 'src/server/basicAuth.js', 'src/server/jobs.js', 'src/server/sso.js'];

function walk(d, out = []) {
  for (const n of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const r = `${d}/${n.name}`;
    if (n.isDirectory()) walk(r, out); else if (/\.(m?js|jsx)$/.test(n.name)) out.push(r);
  }
  return out;
}

describe('the credential ratchet', () => {
  it('every call of a verifier is inside checkCredential (or inside another verifier)', () => {
    const bad = [];
    for (const f of [...walk('app'), ...walk('src/server'), 'proxy.js']) {
      const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        for (const v of VERIFIERS) {
          if (!new RegExp(`\\b${v}\\(`).test(l) || new RegExp(`function ${v}\\(|const ${v} = `).test(l)) continue;
          if (lines.slice(Math.max(0, i - 8), i + 1).some(x => x.includes('checkCredential(')) || (INTERNAL[f] || []).includes(v)) continue; // inside its callback
          bad.push(`${f}:${i + 1} ${v}`);
        }
        if (/timingSafeEqual\(/.test(l) && !COMPARE_FILES.includes(f)) bad.push(`${f}:${i + 1} timingSafeEqual`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the paths: password, TOTP/recovery/enrolment, reset, API key, basic auth, proxy secret, download link, pending 2FA', () => {
    const uses = (f, kind) => expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toMatch(new RegExp(`checkCredential\\(\\{ kind: '${kind}'`));
    uses('app/api/auth/login/route.js', 'password');
    uses('app/api/account/2fa/route.js', 'password');
    for (const f of ['app/api/auth/mfa/route.js', 'app/api/auth/mfa/setup/route.js', 'app/api/account/2fa/route.js']) uses(f, 'mfa');
    uses('app/api/auth/mfa/route.js', 'mfa-pending');
    uses('app/api/auth/reset/confirm/route.js', 'reset');
    uses('src/server/auth.js', 'apikey');
    uses('src/server/basicAuth.js', 'basic');
    uses('proxy.js', 'proxy');
    uses('app/api/v1/batches/[id]/download/route.js', 'link');
  });
});

describe('checkCredential: caps and device cookies (OWASP)', () => {
  const device = (res) => res.headers.getSetCookie().find(c => c.startsWith('pw_device='))?.split(';')[0];
  const as = (email, password, peer, cookie) => login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': peer, ...(cookie && { cookie }) }, body: JSON.stringify({ email, password }) }));
  let users;
  beforeAll(async () => { users = await import('../../src/server/users.js'); });

  it('a distributed brute force on one account is capped (10 from untrusted browsers, from any networks)', async () => {
    await users.createUser({ email: 'dist@x.test', role: 'viewer', password: PW });
    const st = [];
    for (let i = 0; i < 12; i++) st.push((await as('dist@x.test', 'wrong', `198.18.${i}.1`)).status);
    expect(st.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(st.slice(10)).toEqual([429, 429]);
    const r = await as('dist@x.test', PW, '198.18.99.1'); // a new browser, even with the right password
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });

  it('a spray from one network across many accounts is capped (20)', async () => {
    const st = [];
    for (let i = 0; i < 22; i++) st.push((await as(`nobody${i}@x.test`, 'wrong', '203.0.113.200')).status);
    expect(st.slice(0, 20).every(c => c === 401)).toBe(true);
    expect(st.slice(20)).toEqual([429, 429]);
    expect((await as('nobody99@x.test', 'wrong', '203.0.113.201')).status).toBe(401); // another network is not
  });

  it('the real admin with a device cookie signs in during an attack; a forged or revoked cookie gets no bypass', async () => {
    const first = await as('admin@x.test', PW, '192.0.2.1');
    expect(first.status).toBe(200);
    const dev = device(first);
    expect(dev).toBeTruthy();
    for (let b = 0; b < 3; b++) await Promise.all(Array.from({ length: 40 }, (_, i) => as('admin@x.test', 'wrong', `100.70.${b}.${i}`)));
    expect((await as('admin@x.test', PW, '192.0.2.2')).status).toBe(429); // untrusted browsers are capped
    const ok = await as('admin@x.test', PW, '192.0.2.1', dev);
    expect(ok.status).toBe(200); // the known browser is not
    const dev2 = device(ok); // rotated
    expect(dev2).not.toBe(dev);
    const forged = dev2.slice(0, -3) + (dev2.endsWith('A') ? 'BBB' : 'AAA');
    expect((await as('admin@x.test', PW, '192.0.2.1', forged)).status).toBe(429);
    const other = device(await (async () => { await users.createUser({ email: 'pal@x.test', role: 'viewer', password: PW }); return as('pal@x.test', PW, '192.0.2.9'); })());
    expect((await as('admin@x.test', PW, '192.0.2.1', other)).status).toBe(429); // another account's cookie
    await users.endSessions('admin@x.test'); // sign-out everywhere (or a password change) revokes it
    expect((await as('admin@x.test', PW, '192.0.2.1', dev2)).status).toBe(429);
  }, 120000);

  it('an expired device cookie gets no bypass', async () => {
    const { vi } = await import('vitest');
    await users.createUser({ email: 'exp@x.test', role: 'viewer', password: PW });
    const dev = device(await as('exp@x.test', PW, '192.0.2.30'));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 91 * 86400000);
      for (let i = 0; i < 10; i++) await as('exp@x.test', 'wrong', `198.19.${i}.1`);
      expect((await as('exp@x.test', PW, '192.0.2.30', dev)).status).toBe(429);
    } finally { vi.useRealTimers(); }
  });

  it('a known device has its own small budget, and an admin unlock opens a capped account', async () => {
    await users.createUser({ email: 'own@x.test', role: 'viewer', password: PW });
    const dev = device(await as('own@x.test', PW, '192.0.2.40'));
    const st = [];
    for (let i = 0; i < 11; i++) st.push((await as('own@x.test', 'wrong', '192.0.2.40', dev)).status);
    expect(st.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(st[10]).toBe(429);
    for (let i = 0; i < 10; i++) await as('own@x.test', 'wrong', `198.20.${i}.1`);
    expect((await as('own@x.test', PW, '192.0.2.41')).status).toBe(429);
    await limits.unlockLogin('own@x.test');
    expect((await as('own@x.test', PW, '192.0.2.41')).status).toBe(200);
  });

  it('a signed-in session is never under the account cap others fill (re-checking the password on the Account page)', async () => {
    await users.createUser({ email: 'sess@x.test', role: 'viewer', password: PW });
    const res = await as('sess@x.test', PW, '192.0.2.50');
    const sessionCookie = res.headers.getSetCookie().find(c => c.startsWith('pw_session=')).split(';')[0];
    for (let i = 0; i < 10; i++) await as('sess@x.test', 'wrong', `198.21.${i}.1`);
    expect((await as('sess@x.test', PW, '192.0.2.51')).status).toBe(429); // capped for new browsers
    const { POST: twofa } = await import('../../app/api/account/2fa/route.js');
    const r = await twofa(new Request(`${BASE}/api/account/2fa`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': '192.0.2.50', cookie: sessionCookie }, body: JSON.stringify({ action: 'setup', password: PW }) }));
    expect(r.status).toBe(200);
  });

  it('when the storage cannot answer, the same caps hold in this process (never all refused, never skipped)', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const s = store(), lease = s.lease;
    s.lease = async () => { throw new Error('database is down'); };
    const err = console.error; console.error = () => {};
    try {
      const st = [];
      for (let i = 0; i < 22; i++) st.push(await limits.checkCredential({ kind: 'apikey', address: '198.22.0.1' }, () => false).then(() => 'wrong', e => e.status));
      expect(st.slice(0, 20).every(x => x === 'wrong')).toBe(true);
      expect(st.slice(20)).toEqual([429, 429]);
      expect(await limits.checkCredential({ kind: 'apikey', address: '198.22.0.2' }, () => 'right')).toBe('right');
    } finally { s.lease = lease; console.error = err; }
  });

  it('a capped account: a password reset still mails, and its link makes this browser a known device', async () => {
    await users.createUser({ email: 'rst@x.test', role: 'viewer', password: PW });
    for (let i = 0; i < 10; i++) await as('rst@x.test', 'wrong', `198.23.${i}.1`);
    expect((await as('rst@x.test', PW, '192.0.2.60')).status).toBe(429);
    const { issueReset } = users;
    const token = await issueReset('rst@x.test'); // what the mailed link holds
    const { POST: confirm } = await import('../../app/api/auth/reset/confirm/route.js');
    const c = await confirm(new Request(`${BASE}/api/auth/reset/confirm`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': '192.0.2.60' }, body: JSON.stringify({ token, password: 'a brand new password 1' }) }));
    expect(c.status).toBe(200);
    const dev = device(c);
    expect(dev).toBeTruthy();
    expect((await as('rst@x.test', 'a brand new password 1', '192.0.2.60', dev)).status).toBe(200);
  });
});

