// Batch 5, item 2: password reset by email. One-time, short-lived tokens (hashed at rest), the same answer whether or
// not the account exists, limits across servers, every session ends; header injection is refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startSmtp } from '../fixtures/mock-smtp.js';
globalThis.__pwPeers = true; // the socket address comes in x-pw-peer, as instrumentation.js stamps it (limits.js trackPeers)

const BASE = 'http://pw.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reset-'));
const saved = {};
let smtp, users, session, mail, R;
const g = globalThis;

beforeAll(async () => {
  smtp = await startSmtp();
  const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r'.repeat(40), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, 'r.db')}`, PW_SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, PW_MAIL_FROM: 'Pagewright <noreply@pw.test>' };
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  mail = await import('../../src/server/mail.js');
  R = { request: (await import('../../app/api/auth/reset/request/route.js')).POST, confirm: (await import('../../app/api/auth/reset/confirm/route.js')).POST, login: (await import('../../app/api/auth/login/route.js')).POST };
  await users.createUser({ email: 'pat@x.test', role: 'viewer', password: 'old password 12' });
  await users.createUser({ email: 'sso@x.test', role: 'viewer', sso: { via: 'oidc', issuer: 'i', subject: 's' } });
});
afterAll(async () => {
  await smtp.close();
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const post = (fn, body, ip = '10.0.0.1') => fn(new Request(`${BASE}/x`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pw-peer': ip }, body: JSON.stringify(body) }));
const settle = () => Promise.all([...(g.__pwResets || [])]);
const qp = (s) => s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const tokenOf = (msg) => decodeURIComponent(/token=([^\s]+)/.exec(qp(msg.data))[1]);
const who = async (cookie) => (await session.currentUser(new Request(BASE, { headers: { cookie } })))?.email || null;
const cookieOf = (res) => (res.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('pw_session=')) || null;

describe('password reset by email', () => {
  it('answers the same for an account, no account and an SSO-only account; mails only the first', async () => {
    const answers = [];
    for (const email of ['pat@x.test', 'nobody@x.test', 'sso@x.test']) {
      const r = await post(R.request, { email });
      answers.push([r.status, await r.text()]);
    }
    await settle();
    expect(new Set(answers.map(a => JSON.stringify(a))).size).toBe(1);
    expect(answers[0][0]).toBe(202);
    expect(smtp.messages.map(m => m.to)).toEqual([['pat@x.test']]);
    expect(smtp.messages[0].data).toMatch(/^Subject: Reset your Pagewright password/m);
    const rec = await users.getUser('pat@x.test');
    expect(rec.reset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain(tokenOf(smtp.messages[0]).split('.')[1]); // only the hash is stored
  });
  it('the link sets a new password once; every session ends; the old password stops', async () => {
    const before = cookieOf(await post(R.login, { email: 'pat@x.test', password: 'old password 12' }));
    expect(await who(before)).toBe('pat@x.test');
    const token = tokenOf(smtp.messages[0]);
    expect((await post(R.confirm, { token, password: 'short' })).status).toBe(400); // the token is not spent by that
    expect((await post(R.confirm, { token: `${token}x`, password: 'new password 12' })).status).toBe(400);
    expect((await post(R.confirm, { token, password: 'new password 12' })).status).toBe(200);
    expect(await who(before)).toBe(null);
    expect((await post(R.confirm, { token, password: 'again password 12' })).status).toBe(400); // single use
    expect((await post(R.login, { email: 'pat@x.test', password: 'old password 12' })).status).toBe(401);
    expect(cookieOf(await post(R.login, { email: 'pat@x.test', password: 'new password 12' }))).toBeTruthy();
  });
  it('a token runs out after 30 minutes, and a newer token replaces an older one', async () => {
    await post(R.request, { email: 'pat@x.test' }, '10.0.0.2'); await settle();
    const first = tokenOf(smtp.messages.at(-1));
    await post(R.request, { email: 'pat@x.test' }, '10.0.0.2'); await settle();
    const second = tokenOf(smtp.messages.at(-1));
    expect((await post(R.confirm, { token: first, password: 'new password 13' })).status).toBe(400);
    const u = await users.getUser('pat@x.test');
    await users.updateUser('pat@x.test', {}); // (no-op write)
    const { store } = await import('../../src/server/storage/index.js');
    await store().put('users', u.email, JSON.stringify({ ...(await users.getUser('pat@x.test')), reset: { ...u.reset, expires: Date.now() - 1 } }));
    expect((await post(R.confirm, { token: second, password: 'new password 13' })).status).toBe(400);
  });
  it('3 requests an hour per email from one network (any email, also one with no account); others still may ask', async () => {
    for (let i = 0; i < 3; i++) expect((await post(R.request, { email: 'ghost@x.test' }, '10.0.0.5')).status).toBe(202);
    expect((await post(R.request, { email: 'ghost@x.test' }, '10.0.0.5')).status).toBe(429);
    // the owner's own network is not used up by someone else's requests (the escape hatch of a capped account)
    expect((await post(R.request, { email: 'ghost@x.test' }, '10.0.0.6')).status).toBe(202);
    await settle();
  });
  it('without mail set up, the form is off and admins reset passwords', async () => {
    const url = process.env.PW_SMTP_URL; delete process.env.PW_SMTP_URL;
    try { expect((await post(R.request, { email: 'pat@x.test' }, '10.0.0.7')).status).toBe(404); } finally { process.env.PW_SMTP_URL = url; }
  });
});

describe('mail headers', () => {
  it('refuses addresses and subjects that would add headers', async () => {
    for (const bad of ['a@x.test\r\nBcc: e@evil.test', 'a@x.test, b@y.test', '"a"@x.test', '<a@x.test>', 'a b@x.test']) expect(() => mail.checkAddress(bad)).toThrow(/not an email/);
    expect(mail.oneLine('Hi\r\nBcc: e@evil.test')).toBe('Hi Bcc: e@evil.test');
    await mail.sendMail({ to: ['pat@x.test'], subject: 'Report\r\nBcc: evil@evil.test', text: 'x' });
    const m = smtp.messages.at(-1);
    expect(m.to).toEqual(['pat@x.test']);
    expect(m.data).not.toMatch(/^Bcc:/mi);
    expect(m.data).toMatch(/^Subject: Report Bcc: evil@evil\.test$/m);
  });
  it('scheduled mail: an allow-list of domains (fail closed when unset) and a recipient cap', () => {
    delete process.env.PW_MAIL_ALLOWED_DOMAINS;
    expect(() => mail.checkRecipients(['a@x.test'])).toThrow(/PW_MAIL_ALLOWED_DOMAINS/);
    process.env.PW_MAIL_ALLOWED_DOMAINS = 'x.test';
    try {
      expect(mail.checkRecipients('A@x.test; b@x.test')).toEqual(['a@x.test', 'b@x.test']);
      expect(() => mail.checkRecipients(['a@sub.x.test'])).toThrow(/allowed domain/);
      expect(() => mail.checkRecipients(['a@evil.test'])).toThrow(/allowed domain/);
      expect(() => mail.checkRecipients(Array.from({ length: 21 }, (_, i) => `u${i}@x.test`))).toThrow(/At most 20/);
    } finally { delete process.env.PW_MAIL_ALLOWED_DOMAINS; }
  });
});
