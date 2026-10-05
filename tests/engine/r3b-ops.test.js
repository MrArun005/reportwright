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
    expect(new Map(s.counts).get('GET|/missing|4xx')).toBeGreaterThanOrEqual(1);
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
