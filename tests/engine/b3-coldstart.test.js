// Batch 3 item 3: a cold start (a new serverless instance) does no storage locking once the permission defaults are
// in place: before, every new instance took the "acl" lock (several round trips to a remote database), and one that
// lost the race waited up to 15 s.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b3-cold-'));
const keep = { PW_AUTH: process.env.PW_AUTH, PW_STORAGE: process.env.PW_STORAGE };
afterAll(() => { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });

describe('cold start', () => {
  it('a new instance finds the permission defaults without taking the acl lock', async () => {
    process.env.PW_AUTH = 'users';
    process.env.PW_STORAGE = `sqlite:${path.join(tmp, 'pw.db')}`;
    delete globalThis.__pwPermsMigrated;
    const perms = await import('../../src/server/perms.js');
    const { store } = await import('../../src/server/storage/index.js');
    const root = await perms.migratePermissions();
    // another instance holds the lock (doing anything); this one starts cold
    expect(await store().lease('lock:acl', 'another-instance', 30000)).toBe(true);
    delete globalThis.__pwPermsMigrated;
    const t = Date.now();
    expect(await perms.migratePermissions()).toEqual(root);
    expect(Date.now() - t).toBeLessThan(1000);
    await store().release('lock:acl', 'another-instance');
  }, 30000);
});

describe('cold start: SQL storage', () => {
  it('a database at the latest schema is opened with one read, no CREATE statements', async () => {
    const { vi } = await import('vitest');
    const file = path.join(tmp, 'schema.db');
    process.env.PW_STORAGE = `sqlite:${file}`;
    vi.resetModules();
    const a = await import('../../src/server/storage/index.js');
    await a.store().put('settings', 'x', '{}');
    // proof that nothing is created on the next open: a table dropped behind its back stays dropped
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file); db.exec('DROP TABLE pw_leases'); db.close();
    globalThis.__pwStoreConns.clear(); // a new instance: no open connection
    vi.resetModules();
    const b = await import('../../src/server/storage/index.js');
    expect(await b.store().get('settings', 'x')).toBe('{}');
    const db2 = new DatabaseSync(file);
    expect(db2.prepare("SELECT name FROM sqlite_master WHERE name = 'pw_leases'").all()).toEqual([]);
    db2.close();
  }, 30000);
});
