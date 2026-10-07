// Batch 5, item 1: two-factor sign-in (TOTP) for password accounts. Enrol (QR + recovery codes), the second sign-in
// step, replay and rate limits that hold across servers (storage leases), the per-role requirement and an admin's reset.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';

import path from 'node:path';
globalThis.__pwPeers = true; // the socket address comes in x-pw-peer, as instrumentation.js stamps it (limits.js trackPeers)

const BASE = 'http://pw.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-2fa-'));
const saved = {};
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'z'.repeat(40), PW_BASE_URL: BASE, PW_STORAGE: `sqlite:${path.join(tmp, '2fa.db')}` };
let users, session, totp, limits, settings, R;

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  totp = await import('../../src/server/totp.js');
  limits = await import('../../src/server/limits.js');
  settings = await import('../../src/server/settings.js');
  R = {
    login: (await import('../../app/api/auth/login/route.js')).POST,
    mfa: (await import('../../app/api/auth/mfa/route.js')).POST,
    mfaSetup: (await import('../../app/api/auth/mfa/setup/route.js')).POST,
    account: (await import('../../app/api/account/route.js')).GET,
    twoFa: (await import('../../app/api/account/2fa/route.js')).POST,
    patchUser: (await import('../../app/api/users/[email]/route.js')).PATCH,
    settings: (await import('../../app/api/admin/settings/route.js')),
  };
  await users.createUser({ email: 'admin@x.test', role: 'admin', password: 'admin password 1' });
  await users.createUser({ email: 'dee@x.test', role: 'designer', password: 'designer password 1' });
  await users.createUser({ email: 'vic@x.test', role: 'viewer', password: 'viewer password 1' });
});
afterAll(() => {
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cookieOf = (res, name) => (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`) && c.length > name.length + 1) || null;
const H = (cookie) => ({ origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) });
const post = (fn, url, body, cookie) => fn(new Request(`${BASE}${url}`, { method: 'POST', headers: H(cookie), body: JSON.stringify(body) }));
const who = async (cookie) => (cookie ? (await session.currentUser(new Request(BASE, { headers: { cookie } })))?.email || null : null);
const login = async (email, password) => { const r = await post(R.login, '/api/auth/login', { email, password }); return { r, body: await r.json(), session: cookieOf(r, 'pw_session'), mfa: cookieOf(r, 'pw_mfa') }; };

describe('TOTP primitives', () => {
  it('matches RFC 6238 (SHA-1 test vector) and RFC 4648 base32', () => {
    const secret = totp.base32(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp.unbase32(secret).toString()).toBe('12345678901234567890');
    expect(totp.totp(secret, 59 * 1000)).toBe('287082'); // 94287082, 6 digits
    expect(totp.totp(secret, 1111111109 * 1000)).toBe('081804'); // 07081804
    expect(totp.matchStep(secret, '287082', 59 * 1000)).toBe(1);
    expect(totp.matchStep(secret, '287082', 89 * 1000)).toBe(1); // one step late is fine
    expect(totp.matchStep(secret, '287082', 150 * 1000)).toBe(null);
    expect(totp.matchStep(secret, '28708x', 59 * 1000)).toBe(null);
  });
  it('seals secrets at rest (AES-GCM); another key or a changed byte reads nothing', () => {
    const s = totp.seal('JBSWY3DPEHPK3PXP');
    expect(s).not.toContain('JBSWY3DPEHPK3PXP');
    expect(totp.unseal(s)).toBe('JBSWY3DPEHPK3PXP');
    const b = Buffer.from(s.slice(3), 'base64'); b[b.length - 1] ^= 1;
    expect(totp.unseal(`v1:${b.toString('base64')}`)).toBe(null);
    process.env.PW_DATA_KEY = 'k'.repeat(40);
    try { expect(totp.unseal(s)).toBe(null); } finally { delete process.env.PW_DATA_KEY; }
  });
  it('recovery codes are 80-bit, hashed, and normalised', () => {
    const { codes, hashes } = totp.newRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(totp.hashRecovery(codes[0].toLowerCase().replace(/-/g, ' '))).toBe(hashes[0]);
  });
  it('the attempt limit holds when many tries race (one storage, as across servers)', async () => {
    const tries = await Promise.all(Array.from({ length: 20 }, () => limits.attempt('race-key', 5, 60000)));
    expect(tries.filter(t => t.ok)).toHaveLength(5);
    await tries.find(t => t.ok).release();
    expect((await limits.attempt('race-key', 5, 60000)).ok).toBe(true);
    expect((await limits.attempt('race-key', 5, 60000)).ok).toBe(false);
  });
});

describe('expired leases are swept', () => {
  it('on SQLite and on files', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    for (let i = 0; i < 3; i++) await store().lease(`sweep-${i}`, 'o', 1);
    await store().lease('sweep-live', 'o', 60000);
    await new Promise(r => setTimeout(r, 10));
    expect(await store().sweepLeases(Date.now())).toBeGreaterThanOrEqual(3);
    expect(await store().lease('sweep-live', 'other', 60000)).toBe(false);
    const fs2 = await import('node:fs'), os2 = await import('node:os'), path2 = await import('node:path');
    const d = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'pw-sweep-'));
    const { fileStore } = await import('../../src/server/storage/file.js');
    const f = fileStore(d);
    await f.lease('a', 'o', 1); await f.lease('b', 'o', 60000);
    await new Promise(r => setTimeout(r, 10));
    expect(await f.sweepLeases(Date.now())).toBe(1);
    expect(fs2.readdirSync(path2.join(d, 'data/leases'))).toEqual(['b.json']);
    fs2.rmSync(d, { recursive: true, force: true });
  });
});

describe('enrolling and signing in', () => {
  let secret, codes, cookie;
  it('without two-factor sign-in, the password is enough', async () => {
    const l = await login('dee@x.test', 'designer password 1');
    expect(l.r.status).toBe(200);
    expect(await who(l.session)).toBe('dee@x.test');
    cookie = l.session;
  });
  it('enrols from the account page: a QR code, a confirming code, recovery codes; other sessions end', async () => {
    const other = (await login('dee@x.test', 'designer password 1')).session;
    expect((await post(R.twoFa, '/api/account/2fa', { action: 'setup' }, cookie)).status).toBe(401); // a session alone is not enough
    expect((await post(R.twoFa, '/api/account/2fa', { action: 'setup', password: 'not it at all' }, cookie)).status).toBe(401);
    const setup = await post(R.twoFa, '/api/account/2fa', { action: 'setup', password: 'designer password 1' }, cookie);
    expect(setup.status).toBe(200);
    const s = await setup.json();
    expect(s.qr).toMatch(/^<svg/);
    expect(s.uri).toMatch(/^otpauth:\/\/totp\/ReportWright:dee%40x\.test\?secret=[A-Z2-7]+&issuer=ReportWright/);
    secret = s.secret;
    const stored = await users.getUser('dee@x.test');
    expect(JSON.stringify(stored)).not.toContain(secret); // sealed at rest
    expect((await post(R.twoFa, '/api/account/2fa', { action: 'enable', code: '000000' }, cookie)).status).toBe(400);
    const en = await post(R.twoFa, '/api/account/2fa', { action: 'enable', code: totp.totp(secret) }, cookie);
    expect(en.status).toBe(200);
    codes = (await en.json()).recoveryCodes;
    expect(codes).toHaveLength(10);
    const rec = await users.getUser('dee@x.test');
    expect(rec.recovery).toHaveLength(10);
    expect(JSON.stringify(rec)).not.toContain(codes[0]);
    expect(await who(other)).toBe(null); // the session from before is over
    expect(await who(cookie)).toBe(null);
    const before = session.sessionClaims(new Request(BASE, { headers: { cookie } }));
    cookie = cookieOf(en, 'pw_session');
    expect(await who(cookie)).toBe('dee@x.test');
    expect(session.sessionClaims(new Request(BASE, { headers: { cookie } })).exp).toBe(before.exp); // enrolling does not lengthen the session
    const acc = await (await R.account(new Request(`${BASE}/api/account`, { headers: { cookie } }))).json();
    expect(acc.twoFactor).toMatchObject({ enabled: true, required: false, recoveryLeft: 10 });
  });
  it('the password alone no longer signs in; the pending step is not a session', async () => {
    const l = await login('dee@x.test', 'designer password 1');
    expect(l.body).toEqual({ mfa: 'totp' });
    expect(l.session).toBe(null);
    expect(l.mfa).toBeTruthy();
    expect(await who(`pw_session=${l.mfa.split('=')[1]}`)).toBe(null); // a pw_mfa token never reads as a session
    expect((await post(R.mfa, '/api/auth/mfa', { code: '123456' })).status).toBe(401); // no pw_mfa cookie
  });
  it('the second step takes a current code once (no replay), then a recovery code once', async () => {
    let l = await login('dee@x.test', 'designer password 1');
    const code = totp.totp(secret, Date.now() + 30000); // the next step: the account page used this one
    let r = await post(R.mfa, '/api/auth/mfa', { code }, l.mfa);
    expect(r.status).toBe(200);
    expect(await who(cookieOf(r, 'pw_session'))).toBe('dee@x.test');
    expect(cookieOf(r, 'pw_mfa')).toBe(null); // cleared
    l = await login('dee@x.test', 'designer password 1');
    r = await post(R.mfa, '/api/auth/mfa', { code }, l.mfa);
    expect(r.status).toBe(401); // the same code again
    r = await post(R.mfa, '/api/auth/mfa', { recoveryCode: codes[3].toLowerCase() }, l.mfa);
    expect(r.status).toBe(200);
    expect((await users.getUser('dee@x.test')).recovery).toHaveLength(9);
    l = await login('dee@x.test', 'designer password 1');
    expect((await post(R.mfa, '/api/auth/mfa', { recoveryCode: codes[3] }, l.mfa)).status).toBe(401);
  });
  it('a password change since the password step ends the pending sign-in', async () => {
    const l = await login('dee@x.test', 'designer password 1');
    await users.updateUser('dee@x.test', { password: 'designer password 2' });
    expect((await post(R.mfa, '/api/auth/mfa', { code: totp.totp(secret) }, l.mfa)).status).toBe(401);
    await users.updateUser('dee@x.test', { password: 'designer password 1' });
  });
  it('10 wrong codes in 15 minutes cap the second step for browsers the account does not know (429)', async () => {
    const l = await login('dee@x.test', 'designer password 1');
    // the wrong codes and setup passwords above count too: per account
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await post(R.mfa, '/api/auth/mfa', { code: '000001' }, l.mfa)).status);
    expect(statuses.at(-1)).toBe(429);
    const r = await post(R.mfa, '/api/auth/mfa', { code: totp.totp(secret, Date.now() - 30000) }, l.mfa);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
});

describe('password sign-in limits hold across servers', () => {
  it('10 failures on an account, then 429 for browsers it does not know, on every server', async () => {
    await users.createUser({ email: 'lim@x.test', role: 'viewer', password: 'limit password 1' });
    const tryPw = (pw, ip = '10.9.9.9') => R.login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { ...H(), 'x-pw-peer': ip }, body: JSON.stringify({ email: 'lim@x.test', password: pw }) }));
    for (let i = 0; i < 10; i++) expect((await tryPw('wrong password x', `10.9.${i}.9`)).status).toBe(401);
    expect((await tryPw('limit password 1')).status).toBe(429);
    expect((await tryPw('limit password 1', '10.9.9.10')).status).toBe(429); // the account's cap, not the address's
  });
});

describe('required per role, and an admin reset', () => {
  let admin;
  it('an admin requires two-factor sign-in for viewers; a viewer session without it ends; sign-in enrols', async () => {
    admin = (await login('admin@x.test', 'admin password 1')).session;
    const vic = (await login('vic@x.test', 'viewer password 1')).session;
    expect(await who(vic)).toBe('vic@x.test');
    const r = await R.settings.PATCH(new Request(`${BASE}/api/admin/settings`, { method: 'PATCH', headers: H(admin), body: JSON.stringify({ require2fa: ['viewer'] }) }));
    expect(r.status).toBe(200);
    expect((await r.json()).settings.require2fa).toEqual(['viewer']);
    expect((await R.settings.PATCH(new Request(`${BASE}/api/admin/settings`, { method: 'PATCH', headers: H(admin), body: JSON.stringify({ require2fa: ['root'] }) }))).status).toBe(400);
    await new Promise(r2 => setTimeout(r2, 3100)); // the settings cache (3 s) in this process
    expect(await who(vic)).toBe(null);
    const l = await login('vic@x.test', 'viewer password 1');
    expect(l.body).toEqual({ mfa: 'enrol' });
    expect((await post(R.mfaSetup, '/api/auth/mfa/setup', {}, null)).status).toBe(401);
    const s = await (await post(R.mfaSetup, '/api/auth/mfa/setup', {}, l.mfa)).json();
    expect((await post(R.mfa, '/api/auth/mfa', { code: '999999' }, l.mfa)).status).toBe(401);
    const r2 = await post(R.mfa, '/api/auth/mfa', { code: totp.totp(s.secret) }, l.mfa);
    expect(r2.status).toBe(200);
    expect((await r2.json()).recoveryCodes).toHaveLength(10);
    const c = cookieOf(r2, 'pw_session');
    expect(await who(c)).toBe('vic@x.test');
    // required: the viewer cannot turn it off themselves
    expect((await post(R.twoFa, '/api/account/2fa', { action: 'disable', code: totp.totp(s.secret, Date.now() + 30000) }, c)).status).toBe(409);
  });
  it('an admin resets a lost authenticator: off, sessions over, and a pending code step fails', async () => {
    const before = (await login('dee@x.test', 'designer password 1'));
    const res = await R.patchUser(new Request(`${BASE}/api/users/dee%40x.test`, { method: 'PATCH', headers: H(admin), body: JSON.stringify({ resetTwoFactor: true }) }), { params: Promise.resolve({ email: 'dee%40x.test' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactor).toBe(false);
    const u = await users.getUser('dee@x.test');
    expect(u.totp).toBeUndefined();
    expect(u.recovery).toBeUndefined();
    expect((await post(R.mfa, '/api/auth/mfa', { code: '123456' }, before.mfa)).status).toBe(401); // the version moved on
    const l = await login('dee@x.test', 'designer password 1');
    expect(await who(l.session)).toBe('dee@x.test'); // designers are not required
  });
  it('accounts without a password (single sign-on) are never asked', async () => {
    await users.createUser({ email: 'sso@x.test', role: 'viewer', sso: { via: 'oidc', issuer: 'https://idp', subject: '1' } });
    expect(users.secondFactor(await users.getUser('sso@x.test'), await settings.getSettings({ fresh: true }))).toBe(null);
    await expect(users.startTwoFactor('sso@x.test')).rejects.toThrow(/single sign-on/);
  });
});

describe('a first enrolment at sign-in needs the mailbox too (with mail set up)', () => {
  it('the password step mails a code; the authenticator is bound only with it; the owner is told', async () => {
    const { startSmtp } = await import('../fixtures/mock-smtp.js');
    const smtp = await startSmtp();
    Object.assign(process.env, { PW_SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, PW_MAIL_FROM: 'noreply@x.test' });
    try {
      await users.createUser({ email: 'enr@x.test', role: 'viewer', password: 'enrol password 1' }); // viewers must enrol (above)
      const l = await login('enr@x.test', 'enrol password 1');
      expect(l.body).toEqual({ mfa: 'enrol', emailed: true });
      const mailed = /code to set up two-factor sign-in: (\d{8})/.exec(smtp.messages.at(-1).data)[1];
      expect((await post(R.mfaSetup, '/api/auth/mfa/setup', {}, l.mfa)).status).toBe(401); // the password alone
      expect((await post(R.mfaSetup, '/api/auth/mfa/setup', { emailCode: '00000000' }, l.mfa)).status).toBe(401);
      const again = await login('enr@x.test', 'enrol password 1'); // a second sign-in does not void the code already mailed
      expect(again.body).toEqual({ mfa: 'enrol', emailed: true });
      expect(smtp.messages.filter(m => /enrolment code/.test(m.data))).toHaveLength(1);
      const s = await (await post(R.mfaSetup, '/api/auth/mfa/setup', { emailCode: mailed }, again.mfa)).json();
      const r = await post(R.mfa, '/api/auth/mfa', { code: totp.totp(s.secret) }, again.mfa);
      expect(r.status).toBe(200);
      for (let i = 0; i < 50 && !smtp.messages.some(m => /sign-in changed/.test(m.data)); i++) await new Promise(x => setTimeout(x, 20));
      expect(smtp.messages.at(-1).data).toMatch(/Two-factor sign-in was turned on/);
      expect((await users.getUser('enr@x.test')).enrolCode).toBeUndefined();
    } finally { delete process.env.PW_SMTP_URL; delete process.env.PW_MAIL_FROM; await smtp.close(); }
  });
});
