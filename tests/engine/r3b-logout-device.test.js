// R3-B item 2 (REVIEW-SECURITY-2 M1, PoC p2): a normal sign-out voided the device cookie, so an attacker sending 10
// wrong passwords from one address every 15 minutes kept the owner out. Now sign-out rotates the device cookie; only
// "sign out everywhere" and a password change forget the devices.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUser, updateUser, getUser, listDevices, removeDevice } from '../../src/server/users.js';
import { POST as login } from '../../app/api/auth/login/route.js';
import { POST as logout } from '../../app/api/auth/logout/route.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-logout-'));
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-secret-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}` };
const saved = {};
const BASE = 'http://pw.test';
const PW = 'the real owner password';
const jar = (res) => Object.fromEntries(res.headers.getSetCookie().map(c => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));
const signIn = (email, password, peer, cookie = '') => login(new Request(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': peer, cookie }, body: JSON.stringify({ email, password }),
}));
const signOut = (cookie, body) => logout(new Request(`${BASE}/api/auth/logout`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', cookie, 'x-pw-peer': '192.0.2.10' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
let nets = 0;
// one attacking address per account (below the 20 per 10 minutes network cap), 10 wrong passwords: the account cap
const attack = async (email, n = 10) => { const ip = `198.51.100.${++nets}`; for (let i = 0; i < n; i++) expect((await signIn(email, 'wrong password', ip)).status).toBe(401); };

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.__pwPeers = true;
  for (const e of ['owner@x.test', 'two@x.test', 'three@x.test', 'four@x.test', 'five@x.test', 'six@x.test']) await createUser({ email: e, role: 'admin', password: PW });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete globalThis.__pwPeers;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('sign-out keeps this browser a known device', () => {
  it('PoC p2: sign in, sign out, 10 wrong passwords from one address; the owner still signs in from that browser', async () => {
    const first = jar(await signIn('owner@x.test', PW, '192.0.2.10'));
    expect(first.pw_device).toBeTruthy();
    const out = await signOut(`pw_session=${first.pw_session}; pw_device=${first.pw_device}`);
    expect(out.status).toBe(200);
    const rotated = jar(out).pw_device;
    expect(rotated, 'sign-out re-signs the device cookie').toBeTruthy();
    expect(rotated).not.toBe(first.pw_device);
    expect(await listDevices('owner@x.test')).toHaveLength(1); // the same registered device, not a new one
    await attack('owner@x.test');
    const ok = await signIn('owner@x.test', PW, '192.0.2.10', `pw_device=${rotated}`);
    expect(ok.status).toBe(200);
    // the old session cookie is still dead (sign-out ends sessions)
    const { currentUser } = await import('../../src/server/session.js');
    expect(await currentUser(new Request(BASE, { headers: { cookie: `pw_session=${first.pw_session}` } })).catch(() => null)).toBeNull();
  });
  it('"sign out everywhere" forgets every device: the browser gets no new device cookie and the old one stops counting', async () => {
    const first = jar(await signIn('two@x.test', PW, '192.0.2.10'));
    const out = await signOut(`pw_session=${first.pw_session}; pw_device=${first.pw_device}`, { everywhere: true });
    expect(out.status).toBe(200);
    expect(jar(out).pw_device || '').toBe('');
    await attack('two@x.test');
    expect((await signIn('two@x.test', PW, '192.0.2.10', `pw_device=${first.pw_device}`)).status).toBe(429);
  });
  it('a password change forgets every device', async () => {
    const first = jar(await signIn('three@x.test', PW, '192.0.2.10'));
    await updateUser('three@x.test', { password: 'a brand new password 2' });
    expect((await getUser('three@x.test')).deviceEpoch).toBeTruthy();
    expect(await listDevices('three@x.test')).toEqual([]);
    await attack('three@x.test');
    const r = await signIn('three@x.test', 'a brand new password 2', '192.0.2.10', `pw_device=${first.pw_device}`);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(429);
  });

  it('a sign-out without a session mints nothing; one with another user\'s device cookie mints nothing', async () => {
    expect(jar(await signOut('')).pw_device || '').toBe('');
    const theirs = jar(await signIn('four@x.test', PW, '192.0.2.20'));
    const mine = jar(await signIn('five@x.test', PW, '192.0.2.21'));
    const out = await signOut(`pw_session=${mine.pw_session}; pw_device=${theirs.pw_device}`);
    expect(out.status).toBe(200);
    expect(jar(out).pw_device || '').toBe('');
    expect((await listDevices('five@x.test')).length).toBe(1); // only the one five signed in from
    // a session but no device cookie: still nothing (a sign-out never makes a device known)
    const again = jar(await signIn('five@x.test', PW, '192.0.2.21'));
    expect(jar(await signOut(`pw_session=${again.pw_session}`)).pw_device || '').toBe('');
  });
  it('a demoted user\'s old device cookie stops granting the bypass; a removed device too', async () => {
    const first = jar(await signIn('six@x.test', PW, '192.0.2.30'));
    await updateUser('six@x.test', { role: 'viewer' });
    await attack('six@x.test');
    expect((await signIn('six@x.test', PW, '192.0.2.30', `pw_device=${first.pw_device}`)).status).toBe(429);
    // a removed device (Account page)
    const { unlockLogin } = await import('../../src/server/limits.js');
    await unlockLogin('four@x.test');
    const four = jar(await signIn('four@x.test', PW, '192.0.2.20'));
    const [d] = await listDevices('four@x.test');
    expect(await removeDevice('four@x.test', d.id)).toBe(true);
    await attack('four@x.test');
    expect((await signIn('four@x.test', PW, '192.0.2.20', `pw_device=${four.pw_device}`)).status).toBe(429);
  });
  it('the Account page lists the known browsers and removes one (GET/DELETE /api/account/devices)', async () => {
    const r = await import('../../app/api/account/devices/route.js');
    await (await import('../../src/server/limits.js')).unlockLogin('owner@x.test');
    const c = jar(await signIn('owner@x.test', PW, '192.0.2.10'));
    const auth = { origin: BASE, cookie: `pw_session=${c.pw_session}`, 'content-type': 'application/json' };
    const { devices } = await (await r.GET(new Request(`${BASE}/api/account/devices`, { headers: auth }))).json();
    expect(devices.length).toBeGreaterThan(0);
    expect(Object.keys(devices[0]).sort()).toEqual(['created', 'id', 'lastUsed', 'ua']);
    expect((await r.DELETE(new Request(`${BASE}/api/account/devices`, { method: 'DELETE', headers: auth, body: JSON.stringify({ id: devices[0].id }) }))).status).toBe(200);
    expect((await listDevices('owner@x.test')).some(d => d.id === devices[0].id)).toBe(false);
    expect([401, 403]).toContain((await r.GET(new Request(`${BASE}/api/account/devices`))).status);
  });
});
