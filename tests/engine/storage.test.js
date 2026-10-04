// C2: one storage for reports, versions, schedules, job records and users (PW_STORAGE).
// The same behaviour on files (a temp working folder) and on SQLite; Postgres too when PW_TEST_PG is set.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { store } from '../../src/server/storage/index.js';
import { listReports, readReport, writeReport, deleteReport, listVersions, newId } from '../../src/server/reports.js';
import { createSchedule, listSchedules, getSchedule, updateSchedule, deleteSchedule } from '../../src/server/schedules.js';
import { getJob, listJobs } from '../../src/server/jobs.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-store-'));
const home = process.cwd();
afterAll(() => { process.chdir(home); delete process.env.PW_STORAGE; fs.rmSync(tmp, { recursive: true, force: true }); });

const backends = [
  ['file', () => { const d = path.join(tmp, 'files'); fs.mkdirSync(d, { recursive: true }); process.chdir(d); return 'file'; }],
  ['sqlite', () => { process.chdir(home); return `sqlite:${path.join(tmp, 'store.db')}`; }],
];
if (process.env.PW_TEST_PG) backends.push(['postgres', () => { process.chdir(home); return process.env.PW_TEST_PG; }]);
if (process.env.PW_TEST_MYSQL) backends.push(['mysql', () => { process.chdir(home); return process.env.PW_TEST_MYSQL; }]);
if (process.env.PW_TEST_MSSQL) backends.push(['mssql', () => { process.chdir(home); return process.env.PW_TEST_MSSQL; }]);

const STORE_TABLES = ['pw_reports', 'pw_report_versions', 'pw_schedules', 'pw_jobs', 'pw_users', 'pw_fonts', 'pw_leases', 'pw_folders', 'pw_report_acl', 'pw_tokens'];
const def = (name, n = 1) => ({ $schema: 'pagewright/report@1', name, parameters: [{ name: 'p', type: 'number', required: true }], sections: { body: { items: Array.from({ length: n }, () => ({ type: 'text' })) } } });
const schedule = { template: 'loan-statement', cron: '0 7 1 * *', timezone: 'Asia/Kolkata', items: [{ parameters: {} }] };

describe.each(backends)('storage on %s', (kind, setup) => {
  beforeAll(async () => {
    process.env.PW_STORAGE = setup();
    if (kind === 'postgres') { // start from empty tables
      await store().ids('jobs');
      const pg = new (await import('pg')).default.Client(process.env.PW_TEST_PG);
      await pg.connect();
      for (const t of STORE_TABLES) await pg.query(`DELETE FROM ${t}`);
      await pg.end();
    }
    if (kind === 'mysql') {
      await store().ids('jobs');
      const c = await (await import('mysql2/promise')).default.createConnection(process.env.PW_TEST_MYSQL);
      for (const t of STORE_TABLES) await c.query(`DELETE FROM ${t}`);
      await c.end();
    }
    if (kind === 'mssql') {
      await store().ids('jobs'); // makes the tables
      const sql = (await import('mssql')).default;
      const { mssqlConfig } = await import('../../src/server/sql.js');
      const pool = await new sql.ConnectionPool(mssqlConfig(process.env.PW_TEST_MSSQL)).connect();
      for (const t of STORE_TABLES) await pool.request().batch(`IF OBJECT_ID(N'${t}') IS NOT NULL DELETE FROM ${t}`);
      await pool.close();
    }
  });

  it('saves, lists, reads and deletes reports', async () => {
    expect(await listReports()).toEqual([]);
    expect(await readReport('sales')).toBe(null);
    await writeReport('sales', def('Sales', 2));
    expect(await readReport('sales')).toEqual(def('Sales', 2));
    const [r] = await listReports();
    expect(r).toMatchObject({ id: 'sales', name: 'Sales', items: 2, parameters: [{ name: 'p', type: 'number', required: true }] });
    expect(Date.parse(r.updatedAt)).toBeGreaterThan(Date.now() - 60000);
    expect(await newId('Sales')).toBe('sales-2');
    await deleteReport('sales');
    expect(await readReport('sales')).toBe(null);
    expect(await listReports()).toEqual([]);
  });

  it('keeps a version when the content changes, and only then; a delete takes the history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'));
      await writeReport('hist', def('One'));
      vi.setSystemTime(new Date('2026-10-04T10:00:01.000Z'));
      await writeReport('hist', def('One')); // same content: no version
      expect(await listVersions('hist')).toEqual([]);
      await writeReport('hist', def('Two'));
      vi.setSystemTime(new Date('2026-10-04T10:00:02.500Z'));
      await writeReport('hist', def('Three'));
      const v = await listVersions('hist');
      expect(v.map(x => [x.version, x.savedAt])).toEqual([['20261004T100002500', '2026-10-04T10:00:02.500Z'], ['20261004T100001000', '2026-10-04T10:00:01.000Z']]);
      expect(v[0].bytes).toBe(Buffer.byteLength(JSON.stringify(def('Two'), null, 2)));
      expect(await readReport('hist@20261004T100001000')).toEqual(def('One'));
      expect(await readReport('hist@20261004T100002500')).toEqual(def('Two'));
      expect(await readReport('hist@20261004T100009999')).toBe(null);
      await deleteReport('hist');
      expect(await listVersions('hist')).toEqual([]); // the history goes with the report: a new one with this id starts clean
      // keeps the newest 50
      for (let i = 0; i < 52; i++) { vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 0, 0, i))); await writeReport('many', def(`v${i}`)); }
      const many = await listVersions('many');
      expect(many.length).toBe(50);
      expect(await readReport(`many@${many[49].version}`)).toEqual(def('v1'));
    } finally { vi.useRealTimers(); }
  });

  it('refuses bad ids and versions as strictly as before', async () => {
    for (const id of ['../x', 'A', '-x', 'a/b', '.history', '', 'x'.repeat(65)]) {
      await expect(readReport(id), id).rejects.toMatchObject({ status: 400 });
      await expect(writeReport(id, def('x')), id).rejects.toMatchObject({ status: 400 });
      await expect(deleteReport(id), id).rejects.toMatchObject({ status: 400 });
      await expect(listVersions(id), id).rejects.toMatchObject({ status: 400 });
    }
    for (const v of ['../../x', '2026', '20261004T100001000/../..']) await expect(readReport(`ok@${v}`), v).rejects.toMatchObject({ status: 400 });
  });

  it('stores schedules', async () => {
    expect(await listSchedules()).toEqual([]);
    await writeReport('loan-statement', def('Loan')); // a schedule names a report that exists
    const a = await createSchedule({ ...schedule, name: 'A' });
    await new Promise(r => setTimeout(r, 5)); // listed oldest first (by createdAt)
    const b = await createSchedule({ ...schedule, name: 'B' });
    expect((await listSchedules()).map(s => s.name)).toEqual(['A', 'B']);
    expect((await getSchedule(a.id)).nextRunAt).toMatch(/Z$/);
    const u = await updateSchedule(a.id, { name: 'A2', enabled: false });
    expect(u).toMatchObject({ id: a.id, name: 'A2', createdAt: a.createdAt, nextRunAt: null });
    expect(u.updatedAt).toBeTruthy();
    await expect(updateSchedule(a.id, { cron: 'nope' })).rejects.toMatchObject({ status: 400 });
    expect(await updateSchedule('s_missing', { name: 'x' })).toBe(null);
    expect((await listSchedules()).map(s => s.name)).toEqual(['A2', 'B']);
    expect(await deleteSchedule(b.id)).toBe(true);
    expect(await deleteSchedule(b.id)).toBe(false);
    expect(await getSchedule(b.id)).toBe(null);
    expect(await deleteSchedule(a.id)).toBe(true);
  });

  it('schedule writes are ordered: an update waiting on another server never brings back a deleted schedule', async () => {
    await writeReport('loan-statement', def('Loan'));
    const s = await createSchedule({ ...schedule, name: 'Gone soon' }, { kind: 'service' });
    expect(await store().lease('lock:schedules', 'elsewhere', 30000)).toBe(true);
    let done = false;
    const upd = updateSchedule(s.id, { name: 'Renamed' }, { kind: 'service' }).then((r) => { done = true; return r; });
    await new Promise(r => setTimeout(r, 300));
    expect(done).toBe(false);
    await store().remove('schedules', s.id); // deleted on the other server
    await store().release('lock:schedules', 'elsewhere');
    expect(await upd).toBe(null);
    expect(await store().get('schedules', s.id)).toBe(null);
  });

  it('a new schedule waits for the schedules lock too', async () => {
    await writeReport('loan-statement', def('Loan'));
    expect(await store().lease('lock:schedules', 'elsewhere', 30000)).toBe(true);
    let done = false;
    const mk = createSchedule({ ...schedule, name: 'Later' }, { kind: 'service' }).then((r) => { done = true; return r; });
    await new Promise(r => setTimeout(r, 300));
    expect(done).toBe(false);
    await store().release('lock:schedules', 'elsewhere');
    await deleteSchedule((await mk).id, { kind: 'service' });
  });

  it('stores job records', async () => {
    const s = store();
    await s.put('jobs', 'b_1aaa', JSON.stringify({ id: 'b_1aaa', status: 'completed' }));
    await s.put('jobs', 'b_1bbb', JSON.stringify({ id: 'b_1bbb', status: 'failed' }));
    expect(await getJob('b_1bbb')).toEqual({ id: 'b_1bbb', status: 'failed' });
    expect(await getJob('../etc')).toBe(null);
    expect((await listJobs()).map(j => j.id)).toEqual(['b_1bbb', 'b_1aaa']);
    expect(await s.remove('jobs', 'b_1aaa')).toBe(true);
    expect(await s.remove('jobs', 'b_1bbb')).toBe(true);
    expect(await listJobs()).toEqual([]);
  });

  it('stores uploaded fonts', async () => {
    expect(await store().ids('fonts')).toEqual([]);
    await store().put('fonts', '0123456789abcdef', JSON.stringify({ id: '0123456789abcdef', family: 'Brand', data: 'AAEAAA==' }));
    expect(await store().ids('fonts')).toEqual(['0123456789abcdef']);
    expect(JSON.parse(await store().get('fonts', '0123456789abcdef')).family).toBe('Brand');
    expect(await store().remove('fonts', '0123456789abcdef')).toBe(true);
    expect(await store().ids('fonts')).toEqual([]);
  });

  it('leases: one owner at a time, renewable, free after release or expiry', async () => {
    const s = store();
    expect(await s.lease('t:lease', 'A', 60000)).toBe(true);
    expect(await s.lease('t:lease', 'B', 60000)).toBe(false);
    expect(await s.lease('t:lease', 'A', 60000)).toBe(true);
    await s.release('t:lease', 'B'); // not B's to release
    expect(await s.lease('t:lease', 'B', 60000)).toBe(false);
    await s.release('t:lease', 'A');
    expect(await s.lease('t:lease', 'B', 1)).toBe(true);
    await new Promise(r => setTimeout(r, 10));
    expect(await s.lease('t:lease', 'A', 60000)).toBe(true); // B's ran out
    await s.release('t:lease', 'A');
  });

  it('a lock outlives its lease while the holder works: the lease is renewed, nobody else gets in', async () => {
    const { withLock } = await import('../../src/server/storage/index.js');
    let other = null;
    await withLock('t-renew', async () => {
      await new Promise(r => setTimeout(r, 900)); // three leases long
      other = await store().lease('lock:t-renew', 'someone-else', 300);
      await store().put('reports', 'fenced-ok', JSON.stringify({ name: 'ok' }));
    }, { ttl: 300 });
    expect(other).toBe(false);
    expect(await store().get('reports', 'fenced-ok')).toBeTruthy();
    await store().remove('reports', 'fenced-ok');
  });

  it('a holder whose lease ran out (a stalled process) cannot write: it is refused, nothing lands', async () => {
    const { withLock } = await import('../../src/server/storage/index.js');
    const stalled = withLock('t-expire', async () => {
      const t0 = Date.now(); while (Date.now() - t0 < 500) { /* the event loop stalls: no renewal */ } // eslint-disable-line no-empty
      expect(await store().lease('lock:t-expire', 'someone-else', 5000)).toBe(true); // the lease ran out: another holder
      await store().put('reports', 'fenced-late', JSON.stringify({ name: 'late' }));
    }, { ttl: 300 });
    await expect(stalled).rejects.toMatchObject({ status: 503 });
    expect(await store().get('reports', 'fenced-late')).toBe(null);
    await store().release('lock:t-expire', 'someone-else');
  });

  it('stores users', async () => {
    const s = store();
    await s.put('users', 'a@x.io', JSON.stringify({ email: 'a@x.io', role: 'viewer' }));
    await s.put('users', 'a@x.io', JSON.stringify({ email: 'a@x.io', role: 'admin' }));
    expect(JSON.parse(await s.get('users', 'a@x.io'))).toEqual({ email: 'a@x.io', role: 'admin' });
    expect(await s.ids('users')).toEqual(['a@x.io']);
    expect(await s.remove('users', 'a@x.io')).toBe(true);
    expect(await s.get('users', 'a@x.io')).toBe(null);
  });
});

describe('file storage keeps today\'s files', () => {
  it('writes reports/<id>.pw.json, reports/.history/<id>/, data/schedules.json and data/jobs/<id>/job.json', async () => {
    const d = path.join(tmp, 'layout');
    fs.mkdirSync(d);
    process.chdir(d);
    process.env.PW_STORAGE = 'file';
    try {
      await writeReport('r1', def('R'));
      await writeReport('r1', def('R2'));
      expect(JSON.parse(fs.readFileSync('reports/r1.pw.json', 'utf8'))).toEqual(def('R2'));
      expect(fs.readFileSync('reports/r1.pw.json', 'utf8')).toBe(JSON.stringify(def('R2'), null, 2));
      expect(fs.readdirSync('reports/.history/r1').length).toBe(1);
      await writeReport('loan-statement', def('Loan'));
      const s = await createSchedule(schedule);
      expect(JSON.parse(fs.readFileSync('data/schedules.json', 'utf8'))).toMatchObject([{ id: s.id }]);
      await store().put('jobs', 'b_x1', JSON.stringify({ id: 'b_x1' }));
      expect(JSON.parse(fs.readFileSync('data/jobs/b_x1/job.json', 'utf8'))).toEqual({ id: 'b_x1' });
      await store().put('users', 'u@x.io', JSON.stringify({ email: 'u@x.io' }));
      expect(fs.statSync('data/users.json').mode & 0o077).toBe(0); // password hashes: owner only
    } finally { process.chdir(home); }
  });
});

describe('PW_STORAGE', () => {
  it('names what it accepts', () => {
    process.env.PW_STORAGE = 'redis://x';
    try { expect(() => store()).toThrow(/PW_STORAGE/); } finally { delete process.env.PW_STORAGE; }
  });
});

describe('file storage leases across processes', () => {
  it('a lease taken by one process holds for another process on the same folder (two servers, one data dir)', async () => {
    const { execFileSync } = await import('node:child_process');
    const fsx = await import('node:fs');
    const osx = await import('node:os');
    const px = await import('node:path');
    const root = fsx.mkdtempSync(px.join(osx.tmpdir(), 'pw-lease-'));
    const { fileStore } = await import('../../src/server/storage/file.js');
    const s = fileStore(root);
    expect(await s.lease('job:b_1', 'A', 5000)).toBe(true);
    const other = (owner) => execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { fileStore } from ${JSON.stringify(px.resolve('src/server/storage/file.js'))}; console.log(await fileStore(${JSON.stringify(root)}).lease('job:b_1', '${owner}', 5000));`]).toString().trim();
    expect(other('B')).toBe('false');
    await s.release('job:b_1', 'A');
    expect(other('B')).toBe('true');
    expect(await s.lease('job:b_1', 'A', 5000)).toBe(false);
    fsx.rmSync(root, { recursive: true, force: true });
  });
});
