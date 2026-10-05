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
    const zip = unzipSync((await jobs.jobFile(job.id)).bytes);
    expect(Object.keys(zip).sort()).toEqual(['1.json', '2.json', '3.json', '4.json']);
    expect(done).not.toHaveProperty('_work'); // the job's inputs are not shown to API callers
  });
});

describe('fencing: a replica that lost its lease writes nothing more', () => {
  it('A is paused past its lease, B takes the job: A stops at its next write, B finishes alone', async () => {
    const job = await jobs.createBatch({ template: def, items: Array.from({ length: 30 }, (_, n) => ({ parameters: { n: String(n) } })), format: 'json', output: { type: 'zip' } }, null);
    const name = `job:${job.id}`;
    const running = jobs.workOnce('A');
    while (!((await jobs.getJob(job.id))?.done >= 1)) await sleep(5);
    // A's lease is taken from it (a GC pause or a partition): B holds it now
    await store().release(name, 'A');
    expect(await store().lease(name, 'B', 60000)).toBe(true);
    const warn = console.warn; console.warn = () => {};
    try { expect(await running).toMatchObject({ id: job.id, stopped: true }); } finally { console.warn = warn; }
    const mid = JSON.parse(await store().get('jobs', job.id));
    expect(mid.status).toBe('running'); // A did not finish it, nor mark it failed
    expect(mid.done).toBeLessThan(30);
    await store().release(name, 'B');
    expect(await jobs.workOnce('B')).toMatchObject({ id: job.id, stopped: false });
    const done = await jobs.getJob(job.id);
    expect(done).toMatchObject({ status: 'completed', done: 30, failed: 0 });
    expect(new Set(done.results.map(r => r.index)).size).toBe(30); // no item twice
  }, 60000);
});

describe('job records: small, indexed, kept for a while', () => {
  it('the queue reads open jobs only; the record stays small; finished jobs go after the retention', async () => {
    const { blobs } = await import('../../src/server/blobs.js');
    const job = await jobs.createBatch({ template: def, items: Array.from({ length: 40 }, (_, n) => ({ parameters: { n: String(n) } })), format: 'pdf', output: { type: 'merged' } }, null);
    expect(JSON.parse(await store().get('settings', 'jobs-open')).ids).toContain(job.id);
    const raw = await store().get('jobs', job.id);
    expect(raw.length).toBeLessThan(2000); // the inputs are not on it
    const puts = [];
    const s = store(), put = s.put;
    s.put = async (k, id, text) => { if (k === 'jobs') puts.push(text.length); return put.call(s, k, id, text); };
    try { await jobs.workOnce('A'); } finally { s.put = put; }
    const done = await jobs.getJob(job.id);
    expect(done).toMatchObject({ status: 'completed', done: 40 });
    expect(done.results).toHaveLength(40);
    expect(Math.max(...puts.slice(0, -1))).toBeLessThan(3000); // while it ran: counters only
    expect(JSON.parse(await store().get('settings', 'jobs-open')).ids).not.toContain(job.id);
    expect((await jobs.jobFile(job.id)).bytes.subarray(0, 5).toString()).toBe('%PDF-'); // merged in the pool
    expect(await blobs().list(`jobs/${job.id}/results/`)).toEqual([]);
    expect(await jobs.sweepJobs()).toBe(0); // younger than 30 days
    expect(await jobs.sweepJobs(Date.now() + 31 * 86400000)).toBeGreaterThanOrEqual(1);
    expect(await store().get('jobs', job.id)).toBe(null);
    expect(await blobs().list(`jobs/${job.id}/`)).toEqual([]);
  }, 60000);

  it('an install from before: the index is built once from the records; old inline inputs still run', async () => {
    const id = 'b_legacy0001';
    await store().put('jobs', id, JSON.stringify({ id, status: 'queued', createdAt: new Date().toISOString(), template: 'Q', templateRef: null, format: 'json', output: { type: 'zip' }, total: 1, done: 0, failed: 0, results: [], errors: [], failedItems: [], base: 'http://127.0.0.1:3000', self: 'http://127.0.0.1:3000', owner: null, _work: { items: [{ parameters: { n: 'old' } }], def } }));
    await store().remove('settings', 'jobs-open');
    expect(await jobs.workOnce('A')).toMatchObject({ id, stopped: false });
    expect(await jobs.getJob(id)).toMatchObject({ status: 'completed', done: 1 });
  }, 60000);
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

describe('review: a slow delivery target cannot hold the scheduler or the queue', () => {
  it('safeFetch has one deadline for headers and body, across a drip-feed', async () => {
    const http = await import('node:http');
    const net = await import('node:net');
    const { safeFetch } = await import('../../src/server/safeFetch.js');
    const body = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('['); const t = setInterval(() => res.write(' '), 100); res.on('close', () => clearInterval(t)); });
    const head = net.createServer((sock) => { let i = 0; const msg = 'HTTP/1.1 200 OK\r\n' + 'X-Slow: a\r\n'.repeat(500); const t = setInterval(() => { if (i < msg.length) sock.write(msg[i++]); }, 50); sock.on('close', () => clearInterval(t)); sock.on('error', () => {}); });
    await new Promise(r => body.listen(0, '127.0.0.1', r));
    await new Promise(r => head.listen(0, '127.0.0.1', r));
    process.env.PW_FETCH_DEADLINE_MS = '800';
    try {
      for (const srv of [body, head]) {
        const url = `http://127.0.0.1:${srv.address().port}/x`;
        const t0 = Date.now();
        await expect(safeFetch(url, {}, { allow: [new URL(url).origin] }).then(r => r.text())).rejects.toThrow(/did not finish|longer than/);
        expect(Date.now() - t0).toBeLessThan(3000);
      }
    } finally { delete process.env.PW_FETCH_DEADLINE_MS; body.close(); head.close(); body.closeAllConnections?.(); }
  });

  it('a tick claims a due schedule before its slow work: overlapping ticks run it once', async () => {
    const http = await import('node:http');
    const srv = http.createServer((req, res) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"n":"a"}]'); }, 600));
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.PW_INTERNAL_HOSTS = '127.0.0.1';
    try {
      const s = await schedules.createSchedule({ template: def, cron: '* * * * *', itemsFrom: { url: `http://127.0.0.1:${srv.address().port}/list`, map: { n: 'n' } }, format: 'json' });
      const later = new Date(Date.now() + 61000);
      const first = schedules.tickAs('A', later);
      await sleep(100);
      await schedules.tickAs('A', later); // the same server's next tick, while the first waits on the slow list
      await first;
      expect((await jobs.listJobs()).filter(j => j.schedule?.id === s.id)).toHaveLength(1);
    } finally { delete process.env.PW_INTERNAL_HOSTS; srv.close(); }
  });

  it('an empty answer (204, HEAD) leaves no deadline timer behind to throw later', async () => {
    const http = await import('node:http');
    const { safeFetch } = await import('../../src/server/safeFetch.js');
    const srv = http.createServer((req, res) => { res.writeHead(204); res.end(); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const errors = [];
    const onErr = (e) => errors.push(e);
    process.on('uncaughtException', onErr);
    process.env.PW_FETCH_DEADLINE_MS = '200';
    try {
      const url = `http://127.0.0.1:${srv.address().port}/hook`;
      expect((await safeFetch(url, { method: 'POST', body: 'x' }, { allow: ['127.0.0.1'] })).status).toBe(204);
      expect((await safeFetch(url, { method: 'HEAD' }, { allow: ['127.0.0.1'] })).status).toBe(204);
      await sleep(500);
      expect(errors).toEqual([]);
    } finally { process.off('uncaughtException', onErr); delete process.env.PW_FETCH_DEADLINE_MS; srv.close(); }
  });

  it('a tick runs each schedule as it is when claimed, not as it was when the tick began', async () => {
    const http = await import('node:http');
    const srv = http.createServer((req, res) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"n":"a"}]'); }, 800));
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.PW_INTERNAL_HOSTS = '127.0.0.1';
    try {
      const slow = await schedules.createSchedule({ template: def, cron: '* * * * *', itemsFrom: { url: `http://127.0.0.1:${srv.address().port}/list`, map: { n: 'n' } }, format: 'json' });
      await sleep(5);
      const b = await schedules.createSchedule({ template: def, cron: '* * * * *', items: [{ name: 'OLD', parameters: { n: 'old' } }], format: 'json' });
      const tick = schedules.tickAs('A', new Date(Date.now() + 3600000));
      await sleep(200);
      await schedules.updateSchedule(b.id, { items: [{ name: 'NEW', parameters: { n: 'new' } }] });
      await tick;
      const job = (await jobs.listJobs()).find(j => j.schedule?.id === b.id);
      const { blobs } = await import('../../src/server/blobs.js');
      expect(JSON.parse(String(await blobs().get(`jobs/${job.id}/work.json`))).items.map(i => i.name)).toEqual(['NEW']); // the inputs: one blob, written once
      for (const x of [slow.id, b.id]) await schedules.deleteSchedule(x);
    } finally { delete process.env.PW_INTERNAL_HOSTS; srv.close(); }
  });
});
