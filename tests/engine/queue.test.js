// Durable job queue and one scheduler across replicas (ROADMAP week 10), on shared SQL storage.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-queue-'));
const cwd = process.cwd();
let store, jobs, schedules;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const def = {
  $schema: 'pagewright/report@1', name: 'Q', page: { size: 'A4', margins: [36, 36, 36, 36] },
  parameters: [{ name: 'n', type: 'string' }], dataSources: [], dataSets: [],
  sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Item {Parameters.n}' }] } },
};

beforeAll(async () => {
  fs.symlinkSync(path.join(cwd, 'public'), path.join(dir, 'public')); // fonts, as in the app folder
  process.chdir(dir); // batch output files go to <cwd>/data
  process.env.PW_STORAGE = `sqlite:${path.join(dir, 'store.db')}`;
  process.env.PW_JOB_LEASE_MS = '300';
  ({ store } = await import('../../src/server/storage/index.js'));
  jobs = await import('../../src/server/jobs.js');
  schedules = await import('../../src/server/schedules.js');
});
afterAll(() => { process.chdir(cwd); delete process.env.PW_STORAGE; delete process.env.PW_JOB_LEASE_MS; fs.rmSync(dir, { recursive: true, force: true }); });

describe('leases', () => {
  it('one owner at a time, renewable, taken over after it expires', async () => {
    const s = store();
    expect(await s.lease('x', 'A', 200)).toBe(true);
    expect(await s.lease('x', 'B', 200)).toBe(false);
    expect(await s.lease('x', 'A', 200)).toBe(true); // renew
    await sleep(250);
    expect(await s.lease('x', 'B', 200)).toBe(true);
    expect(await s.lease('x', 'A', 200)).toBe(false);
    await s.release('x', 'B');
    expect(await s.lease('x', 'A', 200)).toBe(true);
  });
});

describe('a batch survives the replica that ran it', () => {
  it('replica B finishes what replica A started, without redoing A\'s items', async () => {
    const job = await jobs.createBatch({ template: def, items: [1, 2, 3, 4].map(n => ({ parameters: { n: String(n) } })), format: 'json', output: { type: 'zip' } }, null);
    expect(job.status).toBe('queued');
    const a = await jobs.workOnce('A', { stopAfter: 2 }); // A "dies" after two items: no release, no finish
    expect(a).toMatchObject({ id: job.id, stopped: true });
    expect(await jobs.workOnce('B')).toBe(null); // A's lease still holds
    await sleep(350);
    const b = await jobs.workOnce('B');
    expect(b).toMatchObject({ id: job.id, stopped: false });
    const done = await jobs.getJob(job.id);
    expect(done).toMatchObject({ status: 'completed', done: 4, failed: 0 });
    expect(done.results.map(r => r.index).sort()).toEqual([0, 1, 2, 3]);
    expect(done.results.filter(r => r.by === 'A')).toHaveLength(2); // A's two were kept, not rendered again
    const zip = unzipSync(fs.readFileSync((await jobs.jobFile(job.id)).path));
    expect(Object.keys(zip).sort()).toEqual(['1.json', '2.json', '3.json', '4.json']);
    expect(done).not.toHaveProperty('_work'); // the job's inputs are not shown to API callers
  });
});

describe('one scheduler for all replicas', () => {
  it('a due schedule runs once when two replicas tick at the same moment', async () => {
    const s = await schedules.createSchedule({ template: def, cron: '* * * * *', items: [{ parameters: { n: 'x' } }], format: 'json' });
    const later = new Date(Date.now() + 61000);
    await Promise.all([schedules.tickAs('A', later), schedules.tickAs('B', later)]);
    const runs = (await jobs.listJobs()).filter(j => j.schedule?.id === s.id);
    expect(runs).toHaveLength(1);
  });
});
