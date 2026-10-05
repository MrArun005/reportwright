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
  for (const k of ['PW_CRED_MAX_DELAY_MS', 'PW_CRED_HOT_DELAY_MS']) delete process.env[k];
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

describe('checkCredential', () => {
  it('never refuses; failures from one network make that network wait, growing to a cap', async () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(limits.sourceDelay)).toEqual([0, 0, 0, 500, 1000, 2000, 4000, 8000, 8000]);
    process.env.PW_CRED_MAX_DELAY_MS = '300';
    try {
      const who = { kind: 'apikey', address: '198.51.100.20' };
      for (let i = 0; i < 4; i++) expect(await limits.checkCredential(who, () => false)).toBe(false);
      let t0 = Date.now();
      expect(await limits.checkCredential(who, () => 'right')).toBe('right'); // waited, then let through
      expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
      t0 = Date.now();
      await limits.checkCredential({ kind: 'apikey', address: '198.51.100.21' }, () => false); // another network: no wait
      expect(Date.now() - t0).toBeLessThan(200);
    } finally { delete process.env.PW_CRED_MAX_DELAY_MS; }
  });

  it('a flood of wrong passwords from rotating sources adds at most about 2 s to the real admin', async () => {
    for (let b = 0; b < 6; b++) await Promise.all(Array.from({ length: 50 }, (_, i) => signIn('admin@x.test', 'wrong', `203.0.${b}.${i}`)));
    const t0 = Date.now();
    const ok = await signIn('admin@x.test', PW, '192.0.2.1');
    const took = Date.now() - t0;
    expect(ok.status).toBe(200);
    expect(took).toBeGreaterThanOrEqual(limits.HOT_DELAY_MS - 50); // the hot-account wait applies
    expect(took).toBeLessThan(limits.HOT_DELAY_MS + 1500); // and that is all (plus the password hash)
  }, 300000);
});
