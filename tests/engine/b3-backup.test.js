// Batch 3 item 7a: the restore drill on SQLite: backup -> wipe -> restore -> verify (scripts/backup.mjs, docs/OPS.md).
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b3-backup-'));
const keep = process.env.PW_STORAGE;
afterAll(() => { if (keep === undefined) delete process.env.PW_STORAGE; else process.env.PW_STORAGE = keep; fs.rmSync(tmp, { recursive: true, force: true }); });
const script = path.join(import.meta.dirname, '../../scripts/backup.mjs');
const run = (env, ...args) => { try { return { code: 0, out: execFileSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: String(e.stderr) + String(e.stdout) + e.message }; } };

describe('backup and restore', () => {
  it('backup, wipe, restore, verify: reports, versions, users, settings and the audit log come back', async () => {
    const live = path.join(tmp, 'live.db'), bak = path.join(tmp, 'backup.db');
    const env = { PW_STORAGE: `sqlite:${live}` };
    process.env.PW_STORAGE = env.PW_STORAGE;
    const { store } = await import('../../src/server/storage/index.js');
    await store().put('reports', 'invoice', '{"name":"Invoice v2"}');
    await store().addVersion('invoice', '20260101T000000000', '{"name":"Invoice v1"}', 10);
    await store().put('users', 'amy@x.io', '{"email":"amy@x.io","role":"designer"}');
    await store().put('settings', 'server', '{"x":1}');
    await store().appendAudit({ id: '0001', at: '2026-10-06T00:00:00.000Z', type: 'report.save', actor: 'user:amy@x.io', report: 'invoice' });
    const before = async () => ({ reports: await store().list('reports'), users: await store().list('users'), versions: await store().versions('invoice'), audit: (await store().queryAudit({ limit: 10 })).map(e => e.id ?? e) });
    const was = await before();

    const b = run(env, 'backup', bak);
    expect(b.code, b.out).toBe(0);
    expect(run(env, 'backup', bak).code).toBe(2); // never overwrites a backup
    // wipe
    globalThis.__pwStoreConns.clear();
    for (const f of fs.readdirSync(tmp)) if (f.startsWith('live.db')) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
    expect(await store().ids('reports')).toEqual([]);
    globalThis.__pwStoreConns.clear();

    const r = run(env, 'restore', bak);
    expect(r.code, r.out).toBe(0);
    expect(run(env, 'restore', bak).code).toBe(2); // not into a storage that holds data, without --force
    expect(run(env, 'restore', bak, '--force').code).toBe(0);
    globalThis.__pwStoreConns.clear();
    const now = await before();
    expect(now.reports.map(x => [x.id, x.text])).toEqual(was.reports.map(x => [x.id, x.text]));
    expect(now.users.map(x => [x.id, x.text])).toEqual(was.users.map(x => [x.id, x.text]));
    expect(now.versions.map(v => v.version)).toEqual(was.versions.map(v => v.version));
    expect(await store().getVersion('invoice', '20260101T000000000')).toBe('{"name":"Invoice v1"}');
    expect(now.audit).toEqual(was.audit);
    expect(await store().get('settings', 'server')).toBe('{"x":1}');
  }, 60000);

  it('never prints the storage password, in normal output or in an error', () => {
    const pw = 'S3cr3t-pass_word';
    // nothing listens on port 9: the connection error must not carry the password either
    const r = run({ PW_STORAGE: `postgres://pwuser:${pw}@127.0.0.1:9/pw?connect_timeout=2` }, 'backup', path.join(tmp, 'never.db'));
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain(pw);
    expect(r.out).not.toContain(encodeURIComponent(pw));
    const ok = run({ PW_STORAGE: `sqlite:${path.join(tmp, 'live.db')}` }, 'backup', path.join(tmp, 'b2.db'));
    expect(ok.code).toBe(0);
  }, 60000);
});
