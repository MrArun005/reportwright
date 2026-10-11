// R2 A-5: a storage schema version with migrations (and indexes), a definition upgrade chain, a file → SQL copy tool,
// and cluster mode refused on file storage.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(import.meta.dirname, '../..');

it('a new SQL storage records its schema version and has the audit indexes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r2a5-'));
  const { sqlStore, MIGRATIONS } = await import('../../src/server/storage/sql.js');
  const s = sqlStore(`sqlite:${path.join(dir, 'a.db')}`);
  await s.put('settings', 'x', '{}');
  const db = new DatabaseSync(path.join(dir, 'a.db'));
  expect(db.prepare("SELECT v FROM pw_meta WHERE k = 'schema'").get().v).toBe(String(MIGRATIONS.at(-1).v));
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'pw_audit_%'").all().map(r => r.name).sort()).toEqual(['pw_audit_actor', 'pw_audit_at', 'pw_audit_report', 'pw_audit_type']);
  expect(await s.idsFrom('settings', 'x')).toEqual(['x']);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

it('definitions go through the upgrade chain; a newer one is refused', async () => {
  const { upgrade } = await import('../../src/engine/schema/upgrade.js');
  const d = { $schema: 'reportwright/report@1', name: 'A' };
  expect(upgrade(d)).toBe(d);
  expect(() => upgrade({ $schema: 'reportwright/report@9' })).toThrow(/newer ReportWright/);
});

it('the old $schema (pagewright/report@1, deprecated) is the same format: read and validated as reportwright/report@1', async () => {
  const { upgrade } = await import('../../src/engine/schema/upgrade.js');
  const { validate } = await import('../../src/engine/schema/validate.js');
  const def = { $schema: 'pagewright/report@1', name: 'A', sections: { body: { items: [] } } };
  expect(upgrade(def).$schema).toBe('reportwright/report@1');
  expect(validate(def).warnings.join(' ')).not.toMatch(/Unknown schema/);
  expect(() => upgrade({ $schema: 'reportwright/report@9' })).toThrow(/newer ReportWright/);
});

it('pw migrate-storage copies a file install into SQLite: reports, versions, users, blobs, the audit log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r2a5m-'));
  const env = { ...process.env, PW_STORAGE: 'file', PW_AUTH: '' };
  const seed = `
    const { writeReport } = await import(${JSON.stringify(path.join(ROOT, 'src/server/reports.js'))});
    const { store } = await import(${JSON.stringify(path.join(ROOT, 'src/server/storage/index.js'))});
    const { blobs } = await import(${JSON.stringify(path.join(ROOT, 'src/server/blobs.js'))});
    await writeReport('one', { name: 'One v1' }); await writeReport('one', { name: 'One v2' });
    await store().put('users', 'a@x.test', JSON.stringify({ email: 'a@x.test', role: 'admin' }));
    await blobs().put('jobs/b_x/output.zip', Buffer.from('zipbytes'));
    await store().appendAudit({ id: '0001-a', at: new Date().toISOString(), type: 'test.one', actor: 'cli' });`;
  execFileSync(process.execPath, ['--input-type=module', '-e', seed], { cwd: dir, env });
  const db = path.join(dir, 'pw.db');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/pw.mjs'), 'migrate-storage', '--to', `sqlite:${db}`], { cwd: dir, env, encoding: 'utf8' });
  expect(out).toMatch(/copied \d+ records, 1 versions and 1 audit events/);
  const check = `
    const { store } = await import(${JSON.stringify(path.join(ROOT, 'src/server/storage/index.js'))});
    const { blobs } = await import(${JSON.stringify(path.join(ROOT, 'src/server/blobs.js'))});
    const r = JSON.parse(await store().get('reports', 'one'));
    console.log(JSON.stringify({ name: r.name, versions: (await store().versions('one')).length, user: !!(await store().get('users', 'a@x.test')), blob: String(await blobs().get('jobs/b_x/output.zip')), audit: (await store().queryAudit({ limit: 5 })).length }));`;
  const got = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', check], { cwd: dir, env: { ...env, PW_STORAGE: `sqlite:${db}` }, encoding: 'utf8' }).trim().split('\n').at(-1));
  expect(got).toEqual({ name: 'One v2', versions: 1, user: true, blob: 'zipbytes', audit: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
}, 120000);

it('cluster mode refuses file storage with a clear error', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/cluster.mjs')], { env: { ...process.env, PW_STORAGE: 'file', PW_CLUSTER_PROCESSES: '2' }, encoding: 'utf8', timeout: 30000 });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/need a database for storage/);
});
