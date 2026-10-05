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

  it('review: a designer cannot become the owner of a legacy report by saving it first', async () => {
    await store().put('reports', 'legacy', JSON.stringify({ name: 'legacy' }));
    const { PUT } = await import('../../app/api/reports/[id]/route.js');
    const session = await import('../../src/server/session.js');
    const cookie = session.sessionCookie(new Request('http://pw.test'), await users.getUser('bob@x.test')).split(';')[0];
    const put = (id, body) => PUT(new Request(`http://pw.test/api/reports/${id}`, { method: 'PUT', headers: { origin: 'http://pw.test', cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    expect((await put('legacy', { name: 'mine now', owner: 'bob@x.test', createdBy: 'user:bob@x.test' })).status).toBe(403);
    expect(await level(bob, 'legacy')).toBe('view');
    expect(await store().get('reportacl', 'legacy')).toBe(null); // no grant written for anyone
    expect(await level(admin, 'legacy')).toBe('manage');
  });

  it('review: a forged owner or createdBy in a definition is ignored', async () => {
    await perms.canCreateIn(alice, null);
    await store().put('reports', 'forged', JSON.stringify({ name: 'f', owner: 'bob@x.test', createdBy: 'user:bob@x.test', grants: [{ to: 'user:bob@x.test', level: 'manage' }] }));
    await perms.recordNewReport(alice, 'forged', null, { owner: 'bob@x.test', createdBy: 'user:bob@x.test' });
    expect(await level(alice, 'forged')).toBe('manage');
    expect(await level(bob, 'forged')).toBe('view');
    await expect(perms.checkReport(bob, 'forged', 'manage')).rejects.toMatchObject({ status: 403 });
  });

  it('review: the migration keeps explicit grants exactly, never widens one, and runs once (idempotent)', async () => {
    // before: a custom group called "designers" (one member: vic) had edit on a report
    await store().put('reports', 'r1', JSON.stringify({ name: 'r1' }));
    await store().put('reportacl', 'r1', JSON.stringify({ id: 'r1', folder: null, inherit: false, grants: [{ to: 'group:designers', level: 'edit' }, { to: 'user:alice@x.test', level: 'manage' }] }));
    const u = JSON.parse(await store().get('users', 'vic@x.test'));
    await store().put('users', 'vic@x.test', JSON.stringify({ ...u, groups: ['designers'] }));
    delete globalThis.__pwPermsMigrated;
    const first = await perms.migratePermissions();
    expect(await level(bob, 'r1')).toBe(404); // the new built-in group did not take over the old grant (inherit off)
    expect(await level(alice, 'r1')).toBe('manage');
    const vicNow = { ...vic, groups: JSON.parse(await store().get('users', 'vic@x.test')).groups };
    expect(vicNow.groups).toEqual(['designers-custom']);
    expect(await level(vicNow, 'r1')).toBe('view'); // still a member (a viewer: view at most, as before)
    const acl = JSON.parse(await store().get('reportacl', 'r1'));
    expect(acl.grants).toEqual([{ to: 'group:designers-custom', level: 'edit' }, { to: 'user:alice@x.test', level: 'manage' }]);
    const rootText = await store().get('folders', 'root');
    delete globalThis.__pwPermsMigrated;
    expect(await perms.migratePermissions()).toEqual(first);
    expect(await store().get('folders', 'root')).toBe(rootText); // nothing rewritten the second time
    expect(await store().get('reportacl', 'r1')).toBe(JSON.stringify(acl));
  });
});
