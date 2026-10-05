// R3-B item 11: one JSON line per request (no query strings), and HTTP counts/durations in /api/v1/metrics.
import { describe, it, expect } from 'vitest';
import http from 'node:http';

describe('request log and HTTP metrics', () => {
  it('logs method, path without the query, status and time; counts by route family', async () => {
    const { trackPeers, httpStats, routeFamily } = await import('../../src/server/limits.js');
    expect(routeFamily('/api/reports/x/pdf?sig=1')).toBe('/api/reports');
    expect(routeFamily('/api/v1/batches/b_1/download')).toBe('/api/v1/batches');
    expect(routeFamily('/viewer/abc')).toBe('/viewer');
    trackPeers();
    const lines = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c, ...r) => { if (String(c).includes('"msg":"request"')) { lines.push(JSON.parse(String(c))); return true; } return write(c, ...r); };
    const srv = http.createServer((req, res) => { res.statusCode = req.url.startsWith('/missing') ? 404 : 200; res.end('ok'); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const before = httpStats().n;
    try {
      const port = srv.address().port;
      await fetch(`http://127.0.0.1:${port}/api/v1/batches/b_1/download?exp=1&sig=SECRETSIG`);
      await fetch(`http://127.0.0.1:${port}/missing/x`);
      await new Promise(r => setTimeout(r, 50));
    } finally { process.stdout.write = write; srv.close(); }
    expect(lines.map(l => [l.method, l.path, l.status])).toEqual([['GET', '/api/v1/batches/b_1/download', 200], ['GET', '/missing/x', 404]]);
    expect(JSON.stringify(lines)).not.toMatch(/SECRETSIG/);
    expect(typeof lines[0].ms).toBe('number');
    const s = httpStats();
    expect(s.n - before).toBe(2);
    expect(new Map(s.counts).get('GET|other|4xx')).toBeGreaterThanOrEqual(1);
  });
});

describe('a storage failure is an error, not an empty answer', () => {
  it('listing batches and schedules throws when the storage does', async () => {
    const idx = await import('../../src/server/storage/index.js');
    const s = idx.store();
    const ids = s.ids, list = s.list;
    s.ids = async () => { throw new Error('storage down'); }; s.list = async () => { throw new Error('storage down'); };
    try {
      const jobs = await import('../../src/server/jobs.js'), sched = await import('../../src/server/schedules.js');
      await expect(jobs.listJobs({ kind: 'service' })).rejects.toThrow(/storage down/);
      await expect(sched.readSchedules()).rejects.toThrow(/storage down/);
    } finally { s.ids = ids; s.list = list; }
  });
});

describe('security review of the ops commits', () => {
  it('labels are from a fixed list and escaped; the log has no emails, tokens or addresses', async () => {
    const { routeFamily, loggedPath, promLabel } = await import('../../src/server/limits.js');
    expect(routeFamily('/x"} 1\npwned{a="')).toBe('other');
    expect(routeFamily('/api/evil"/x')).toBe('/api/other');
    expect(routeFamily('/api/v1/zzz')).toBe('/api/v1/other');
    expect(promLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    expect(loggedPath('/api/users/ann%40x.io?x=1')).toBe('/api/users/:email');
    expect(loggedPath(`/r/${'t'.repeat(80)}`)).toBe('/r/:long');
  });
  it('a batch page cursor is never another owner\'s batch id', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    process.env.PW_STORAGE = `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-cur-')), 's.db')}`;
    const { store } = await import('../../src/server/storage/index.js');
    const mk = (id, owner) => store().put('jobs', id, JSON.stringify({ id, owner, status: 'completed', createdAt: new Date().toISOString(), results: [], errors: [], total: 0 }));
    await mk('b_030', 'user:a@x.io');
    for (let i = 1; i <= 25; i++) await mk(`b_${String(i).padStart(3, '0')}`, 'user:b@x.io');
    const jobs = await import('../../src/server/jobs.js');
    // limit 2: the scan reads 20 at most; it stops on b's batches after a's one
    const page = await jobs.listJobPage({ kind: 'user', email: 'a@x.io', role: 'designer', groups: [] }, { limit: 2 });
    expect(page.jobs.map(j => j.id)).toEqual(['b_030']);
    expect(page.next).toBe('b_030'); // not the id of b's batch where the scan stopped
  });
  it('a streamed blob closes its file when the reader cancels', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-fd-'));
    process.env.PW_STORAGE = `sqlite:${path.join(d, 's.db')}`; delete process.env.PW_BLOBS;
    const { blobs } = await import('../../src/server/blobs.js');
    await blobs().put('jobs/b_y/out.zip', Buffer.alloc(5 * 1024 * 1024, 1));
    const fds = () => fs.readdirSync('/dev/fd').length;
    const n0 = fds();
    for (let i = 0; i < 20; i++) { const o = await blobs().open('jobs/b_y/out.zip'); const r = o.stream.getReader(); await r.read(); await r.cancel(); }
    await new Promise(r => setTimeout(r, 100));
    expect(fds() - n0).toBeLessThan(5);
  });
});
