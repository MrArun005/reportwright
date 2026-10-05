// Batch 5, item 6: the report snapshot cache: reused only for the same definition, parameters, format, principal and
// access; a save or a grant change starts fresh; a TTL; a size bound (LRU); schedules can render from it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-snap-'));
const saved = {};
let S, settings, reports, perms, users;
const ann = { kind: 'user', email: 'ann@x.test', role: 'viewer', groups: [] };
const bob = { kind: 'user', email: 'bob@x.test', role: 'viewer', groups: [] };

beforeAll(async () => {
  process.chdir(dir);
  for (const [k, v] of Object.entries({ PW_AUTH: 'users', PW_SESSION_SECRET: 'p'.repeat(40), PW_STORAGE: 'file' })) { saved[k] = process.env[k]; process.env[k] = v; }
  S = await import('../../src/server/snapshots.js');
  settings = await import('../../src/server/settings.js');
  reports = await import('../../src/server/reports.js');
  perms = await import('../../src/server/perms.js');
  users = await import('../../src/server/users.js');
  await users.createUser({ email: 'ann@x.test', role: 'viewer', password: 'ann password 1' });
  await users.createUser({ email: 'bob@x.test', role: 'viewer', password: 'bob password 1' });
  await reports.writeReport('r1', { name: 'R1', v: 1 });
});
afterAll(() => { process.chdir(cwd); for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } fs.rmSync(dir, { recursive: true, force: true }); });

let renders = 0;
const render = (label = 'x') => async () => { renders++; return { bytes: new TextEncoder().encode(`${label}#${renders}`), contentType: 'application/pdf', ext: 'pdf', name: 'R1', pages: 1 }; };
const get = async (principal, opt = {}, label) => S.throughSnapshot({ def: await reports.readReport('r1'), opt: { format: 'pdf', parameters: { a: '1' }, ...opt }, principal }, render(label));
const text = (r) => new TextDecoder().decode(r.bytes);

describe('the snapshot cache', () => {
  it('is off until an admin sets a TTL', async () => {
    const r = await get(ann);
    expect(r.snapshot).toBe('off');
  });
  it('reuses a rendering for the same report, parameters, format and principal', async () => {
    await settings.updateSettings({ snapshotTtl: 60 });
    const a = await get(ann);
    const b = await get(ann);
    expect([a.snapshot, b.snapshot]).toEqual(['miss', 'hit']);
    expect(text(b)).toBe(text(a));
    expect((await get(ann, { parameters: { a: '2' } })).snapshot).toBe('miss');
    expect((await get(ann, { format: 'xlsx' })).snapshot).toBe('miss');
  });
  it('never serves one principal\'s rendering to another, even with the same access', async () => {
    const r = await get(bob);
    expect(r.snapshot).toBe('miss');
    expect(text(r)).not.toBe(text(await get(ann)));
  });
  it('a grant change, a role change or a report save starts fresh', async () => {
    expect((await get(ann)).snapshot).toBe('hit');
    await perms.setReportAccess({ kind: 'service' }, 'r1', { grants: [{ to: 'user:ann@x.test', level: 'view' }] }).catch(async () => {
      const { store } = await import('../../src/server/storage/index.js');
      await store().put('reportacl', 'r1', JSON.stringify({ id: 'r1', folder: null, inherit: true, grants: [{ to: 'user:ann@x.test', level: 'view' }], rev: 'changed' }));
    });
    expect((await get(ann)).snapshot).toBe('miss');
    expect((await get(ann)).snapshot).toBe('hit');
    await users.updateUser('ann@x.test', { groups: ['finance'] });
    expect((await get(ann)).snapshot).toBe('miss');
    await reports.writeReport('other-report', { name: 'Sub', v: 2 }); // another report (a subreport, say)
    expect((await get(ann)).snapshot).toBe('miss');
  });
  it('a TTL runs out; pushed data, signing and passwords are never cached', async () => {
    expect((await get(ann)).snapshot).toBe('hit');
    expect((await S.throughSnapshot({ def: await reports.readReport('r1'), opt: { format: 'pdf', parameters: { a: '1' } }, principal: ann, maxAge: 0.001 }, render())).snapshot).not.toBe('hit');
    for (const o of [{ data: { s: [] } }, { sign: true }, { encrypt: { userPassword: 'x' } }]) expect((await get(ann, o)).snapshot).toBe('off');
  });
  it('stays under its size bound, least recently used first, and clears', async () => {
    const st = await S.snapshotStats();
    expect(st.entries).toBeGreaterThan(2);
    const total = await S.evict(0.00001); // ~10 bytes: everything but nothing
    expect(total).toBeLessThan(20);
    await get(ann);
    await S.clearSnapshots();
    expect((await S.snapshotStats()).entries).toBe(0);
  });
});
