// R3-B item 3 (REVIEW-SECURITY-2 M2): the sample reports shipped in reports/ (and the Docker image) must not make a
// first boot look like an upgrade. Proof from the review: a fresh folder with only the shipped reports/ got the
// legacy root "everyone: view", so a viewer could open a designer's new private draft.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-fresh-'));
const keep = { PW_AUTH: process.env.PW_AUTH, PW_STORAGE: process.env.PW_STORAGE, PW_SESSION_SECRET: process.env.PW_SESSION_SECRET };
const cwd = process.cwd();
afterAll(() => { process.chdir(cwd); for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });
const U = (email, role) => ({ kind: 'user', email, role, groups: [] });

describe('a fresh install with the shipped sample reports', () => {
  it('gets the secure default root, and a viewer cannot open a designer\'s new report (PoC p4)', async () => {
    const dir = path.join(tmp, 'fresh');
    fs.mkdirSync(dir);
    fs.cpSync(path.join(cwd, 'reports'), path.join(dir, 'reports'), { recursive: true, filter: (f) => !f.includes('.history') });
    process.chdir(dir);
    process.env.PW_AUTH = 'users';
    process.env.PW_STORAGE = 'file';
    process.env.PW_SESSION_SECRET = 'r3b-fresh-'.padEnd(48, 'x');
    delete globalThis.__pwPermsMigrated;
    const perms = await import('../../src/server/perms.js');
    const { store } = await import('../../src/server/storage/index.js');
    expect((await store().ids('reports')).length).toBeGreaterThan(5);
    const root = await perms.migratePermissions();
    expect(root.grants).toEqual([{ to: 'group:designers', level: 'view' }]);
    expect(JSON.parse(await store().get('folders', 'root')).migrated).toBe('default');
    const alice = U('alice@x.test', 'designer'), vic = U('vic@x.test', 'viewer');
    const users = await import('../../src/server/users.js');
    for (const p of [alice, vic]) await users.createUser({ email: p.email, role: p.role, password: 'a long password 1' });
    await perms.canCreateIn(alice, null);
    await store().put('reports', 'private-draft', JSON.stringify({ name: 'Designer private draft' }));
    await perms.recordNewReport(alice, 'private-draft', null);
    await expect(perms.checkReport(vic, 'private-draft')).rejects.toMatchObject({ status: 404 });
    expect(await perms.checkReport(alice, 'private-draft')).toBe('manage');
  });
});
