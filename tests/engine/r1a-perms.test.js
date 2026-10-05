// R1-A S-3: the default was "everyone manage" (perms.js DEFAULT_ROOT): any signed-in designer could delete or re-share
// any report. Now: the creator manages; designers view and create; viewers only what a grant gives; admins all.
// An install from before keeps sight of every report (root "everyone: view") and loses no admin or creator rights.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-perms-'));
const keep = { PW_AUTH: process.env.PW_AUTH, PW_STORAGE: process.env.PW_STORAGE, PW_SESSION_SECRET: process.env.PW_SESSION_SECRET };
let n = 0, perms, users, store;
const U = (email, role) => ({ kind: 'user', email, role, groups: [] });
const alice = U('alice@x.test', 'designer'), bob = U('bob@x.test', 'designer'), vic = U('vic@x.test', 'viewer'), admin = U('admin@x.test', 'admin');

beforeEach(async () => {
  process.env.PW_AUTH = 'users';
  process.env.PW_SESSION_SECRET = 'r1a-perms-'.padEnd(48, 'x');
  process.env.PW_STORAGE = `sqlite:${path.join(tmp, `s${++n}.db`)}`;
  perms = await import('../../src/server/perms.js');
  users = await import('../../src/server/users.js');
  ({ store } = await import('../../src/server/storage/index.js'));
  for (const p of [alice, bob, vic, admin]) await users.createUser({ email: p.email, role: p.role, password: 'a long password 1' });
});
afterAll(() => { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });

/** A report made the way the routes make one: canCreateIn, write, recordNewReport. */
async function create(p, id, folder = null) {
  await perms.canCreateIn(p, folder);
  await store().put('reports', id, JSON.stringify({ name: id }));
  await perms.recordNewReport(p, id, folder);
}
const level = async (p, id) => perms.checkReport(p, id).catch(e => e.status);

describe('S-3: secure permission defaults', () => {
  it('a new install: the creator manages, other designers view, viewers see nothing, admins manage', async () => {
    await create(alice, 'alices');
    expect(await level(alice, 'alices')).toBe('manage');
    expect(await level(bob, 'alices')).toBe('view');
    await expect(perms.checkReport(bob, 'alices', 'edit')).rejects.toMatchObject({ status: 403 });
    await expect(perms.checkReport(bob, 'alices', 'manage')).rejects.toMatchObject({ status: 403 });
    expect(await level(vic, 'alices')).toBe(404); // not even its existence
    expect(await level(admin, 'alices')).toBe('manage');
    // designers create at the top (and folders); a viewer cannot
    await create(bob, 'bobs');
    expect(await level(bob, 'bobs')).toBe('manage');
    await expect(perms.canCreateIn(vic, null)).rejects.toMatchObject({ status: 403 });
    const f = await perms.createFolder(bob, { name: 'Bob things' });
    expect(perms.folderLevel(await perms.snapshot(), bob, f.id)).toBe('manage');
    expect(perms.folderLevel(await perms.snapshot(), alice, f.id)).toBe('view');
    // a grant lets a viewer in
    await perms.setReportAccess(alice, 'alices', { grants: [{ to: 'user:vic@x.test', level: 'view' }] });
    expect(await level(vic, 'alices')).toBe('view');
    expect((await perms.snapshot()).root).toEqual([{ to: 'group:designers', level: 'view' }]);
  });

  it('an install from before: everyone keeps view, creators keep manage, nobody else manages', async () => {
    // the old state: reports stored, no root record (it meant everyone manage); alice's report has her creator grant
    await store().put('reports', 'old-alice', JSON.stringify({ name: 'a' }));
    await store().put('reportacl', 'old-alice', JSON.stringify({ id: 'old-alice', folder: null, inherit: true, grants: [{ to: 'user:alice@x.test', level: 'manage' }] }));
    await store().put('reports', 'ancient', JSON.stringify({ name: 'from before permissions' }));
    expect(await level(vic, 'ancient')).toBe('view');
    expect(await level(bob, 'ancient')).toBe('view');
    expect(await level(alice, 'old-alice')).toBe('manage');
    expect(await level(bob, 'old-alice')).toBe('view');
    expect(await level(admin, 'ancient')).toBe('manage');
    const root = JSON.parse(await store().get('folders', 'root'));
    expect(root).toMatchObject({ grants: [{ to: 'group:everyone', level: 'view' }], create: ['group:designers'], migrated: 'legacy' });
    await create(bob, 'new-bob'); // designers still create
    expect(await level(bob, 'new-bob')).toBe('manage');
  });

  it('an explicit root record is kept as it is (no migration), and "create" can lock the top', async () => {
    await perms.updateFolder(admin, 'root', { grants: [{ to: 'group:everyone', level: 'view' }], create: [] });
    await expect(perms.canCreateIn(alice, null)).rejects.toMatchObject({ status: 403 });
    await perms.updateFolder(admin, 'root', { create: ['user:alice@x.test'] });
    await perms.canCreateIn(alice, null);
    await expect(perms.canCreateIn(bob, null)).rejects.toMatchObject({ status: 403 });
    await expect(perms.updateFolder(admin, 'root', { create: ['nonsense'] })).rejects.toMatchObject({ status: 400 });
    expect(() => users.checkGroups(['designers'])).toThrow(/built-in/);
  });
});
