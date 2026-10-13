// Request bodies are capped before they are read whole (src/server/body.js): a declared Content-Length over the cap is
// refused without reading, a chunked body is cancelled as soon as it passes the cap, and no route reads a body any other way.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
globalThis.__pwPeers = true;

const BASE = 'http://pw.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-body-'));
const saved = {};
let R, cookie;
const KB = 1024;

beforeAll(async () => {
  const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'b'.repeat(40), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, 'b.db')}`,
    PW_SMTP_URL: 'smtp://127.0.0.1:9', PW_MAIL_FROM: 'ReportWright <noreply@pw.test>', PW_MAX_BODY_KB: '64',
    PW_SAML_ENTRY_POINT: 'https://idp.example.com/sso', PW_SAML_IDP_CERT: 'x', PW_SAML_IDP_ISSUER: 'https://idp.example.com/saml', PW_AUDIT_ANON_PER_SOURCE: '100000' };
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  const users = await import('../../src/server/users.js');
  await users.createUser({ email: 'ann@x.test', role: 'viewer', password: 'a long password 1' });
  R = { reset: (await import('../../app/api/auth/reset/request/route.js')).POST, devices: (await import('../../app/api/account/devices/route.js')).DELETE,
    acs: (await import('../../app/api/auth/saml/acs/route.js')).POST, login: (await import('../../app/api/auth/login/route.js')).POST };
  const res = await R.login(new Request(`${BASE}/x`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pw-peer': '10.0.0.2' }, body: JSON.stringify({ email: 'ann@x.test', password: 'a long password 1' }) }));
  cookie = (res.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('pw_session='));
});
afterAll(() => {
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A body that is never wholly in memory: 1 kB chunks made on demand, counted as they are pulled. */
function lazy(totalKb) {
  const s = { pulled: 0 };
  s.body = new ReadableStream({ pull(c) { if (s.pulled >= totalKb) return c.close(); s.pulled++; c.enqueue(new Uint8Array(KB).fill(32)); } }, { highWaterMark: 0 });
  return s;
}
const req = (method, body, headers = {}) => new Request(`${BASE}/x`, { method, body, duplex: 'half', headers: { 'x-pw-peer': '10.0.0.3', ...(cookie ? { cookie } : {}), ...headers } });
/** A request that says it is huge but whose body throws if anything reads it. */
const declared = (method, type) => {
  let read = false;
  const body = new ReadableStream({ pull() { read = true; throw new Error('read'); } }, { highWaterMark: 0 });
  return { r: req(method, body, { 'content-type': type, 'content-length': String(100 * 1048576) }), read: () => read };
};

const cases = [
  ['pre-auth JSON (auth/reset/request)', 'POST', () => R.reset, 'application/json', 64, JSON.stringify({ email: 'nobody@x.test' }), 202],
  ['signed-in JSON (account/devices)', 'DELETE', () => R.devices, 'application/json', 64, JSON.stringify({ id: 'none' }), 404],
  ['form (auth/saml/acs)', 'POST', () => R.acs, 'application/x-www-form-urlencoded', 1024, 'SAMLResponse=bm90IHNhbWw%3D', 303],
];
/** 413, or for SAML (which answers with a redirect to the sign-in page) the audit says why. */
const ssoReason = async () => (await (await import('../../src/server/audit.js')).queryAudit({ type: 'auth.sso_failed', limit: 1 }))[0]?.detail?.reason || '';
const isTooBig = async (res) => res.status === 413 || (res.status === 303 && /too large/.test(await ssoReason()));

describe('request body caps', () => {
  for (const [name, method, fn, type, capKb, ok, okStatus] of cases) {
    it(`${name}: a declared oversize body is refused without being read`, async () => {
      const d = declared(method, type);
      expect(await isTooBig(await fn()(d.r))).toBe(true);
      expect(d.read()).toBe(false);
    });
    it(`${name}: a chunked oversize body is refused and reading stops at the cap`, async () => {
      const s = lazy(capKb * 20);
      expect(await isTooBig(await fn()(req(method, s.body, { 'content-type': type })))).toBe(true);
      expect(s.pulled).toBeLessThanOrEqual(capKb + 2);
    });
    it(`${name}: a normal body still works`, async () => {
      const res = await fn()(req(method, ok, { 'content-type': type }));
      expect(res.status).toBe(okStatus);
      if (okStatus === 303) expect(await ssoReason()).not.toMatch(/too large/);
    });
  }

  it('no API route reads a request body except through src/server/body.js', () => {
    const offenders = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.[cm]?[jt]sx?$/.test(e.name)) fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\breq(uest)?\.(json|formData|text|arrayBuffer|blob)\s*\(/.test(l)) offenders.push(`${p}:${i + 1}`); });
    } };
    walk(path.join(process.cwd(), 'app'));
    expect(offenders).toEqual([]);
  });
});
