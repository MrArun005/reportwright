// R2 A-3: fewer storage reads per request: the permission snapshot is cached until a permission write (here or on
// another server), the report list reads a metadata index, a render route reads its definition once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r2a3-'));
const keep = { ...process.env };
let store, perms, reports, sqlStore, url;
beforeAll(async () => {
  url = `sqlite:${path.join(tmp, 's.db')}`;
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r2-a3-'.padEnd(48, 'x'), PW_STORAGE: url });
  ({ store } = await import('../../src/server/storage/index.js'));
  ({ sqlStore } = await import('../../src/server/storage/sql.js'));
  perms = await import('../../src/server/perms.js');
  reports = await import('../../src/server/reports.js');
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(tmp, { recursive: true, force: true }); });

const counting = (kind) => { const s = store(), list = s.list; const n = { v: 0 }; s.list = async (k, ...a) => { if (k === kind) n.v++; return list.call(s, k, ...a); }; return { n, done: () => { s.list = list; } }; };
const bob = { kind: 'user', email: 'bob@x.test', role: 'designer', groups: [] };

describe('A-3', () => {
  it('the permission snapshot is read once, then again only after a permission write, here or elsewhere', async () => {
    await reports.writeReport('r1', { name: 'R1' });
    await perms.snapshot();
    const c = counting('reportacl');
    try {
      await perms.snapshot(); await perms.snapshot();
      expect(c.n.v).toBe(0); // cached
      await store().put('reportacl', 'r1', JSON.stringify({ id: 'r1', folder: null, inherit: false, grants: [] }));
      expect((await perms.snapshot()).reports.get('r1').inherit).toBe(false);
      expect(c.n.v).toBe(1);
      // another server (its own store, not this thread's): its write renews "aclgen", so this cache sees it
      const other = sqlStore(url);
      await other.put('reportacl', 'r1', JSON.stringify({ id: 'r1', folder: null, inherit: true, grants: [{ to: 'user:bob@x.test', level: 'edit' }] }));
      expect((await perms.snapshot()).reports.get('r1').inherit).toBe(false); // no stamp yet: still cached
      await other.put('settings', 'aclgen', JSON.stringify({ id: 'aclgen', gen: 'other-1' }));
      expect(perms.reportLevel(await perms.snapshot(), bob, 'r1')).toBe('edit');
    } finally { c.done(); }
  });

  it('the report list reads the index, not every definition; it fills in reports the index lacks', async () => {
    await reports.writeReport('r2', { name: 'R2', parameters: [{ name: 'p' }] });
    const c = counting('reports');
    try {
      const list = await reports.listReports();
      expect(list.find(r => r.id === 'r2')).toMatchObject({ name: 'R2', parameters: [{ name: 'p', type: 'string', required: false }] });
      expect(c.n.v).toBe(0);
      await store().put('reports', 'copied-in', JSON.stringify({ name: 'Copied' })); // written outside Pagewright
      expect((await reports.listReports()).find(r => r.id === 'copied-in')?.name).toBe('Copied');
      expect(c.n.v).toBe(1);
      await reports.listReports();
      expect(c.n.v).toBe(1); // indexed now
      await reports.deleteReport('r2');
      expect((await reports.listReports()).some(r => r.id === 'r2')).toBe(false);
    } finally { c.done(); }
  });

  it('readReportFor reads the definition once', async () => {
    const s = store(), get = s.get; let n = 0;
    s.get = async (k, ...a) => { if (k === 'reports') n++; return get.call(s, k, ...a); };
    try { await perms.readReportFor({ kind: 'service' }, 'r1'); } finally { s.get = get; }
    expect(n).toBe(1);
  });
});
