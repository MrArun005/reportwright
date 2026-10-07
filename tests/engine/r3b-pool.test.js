// R3-B item 8 (REVIEW-ARCH-2 2.2, EXTERNAL-REVIEW-3 3.11, the synthetic-user run: 1 worker per process, PDF p95 15.7 s):
// the pool reserved 2 GB for SQLite query processes with no SQLite source, and gave every worker a 2 GB heap, so an
// 8-core / 8 GB box ran one render at a time. Now: 1 GB heaps that grow after a real out-of-memory, the reserve only
// with a sqlite: data source, and memory-safe admission as before.
import { describe, it, expect, afterEach } from 'vitest';
import { memoryPlan, sqliteDataSources } from '../../src/server/pool.js';

const keep = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); });

describe('pool sizing', () => {
  it('8 cores / 8 GB: at least 3–4 workers, and every heap still fits in 70% of memory', () => {
    const table = [[4, 4096], [4, 8192], [8, 8192], [8, 16384], [16, 32768], [8, 4096]].map(([cores, memMB]) => ({ cores, memMB, ...memoryPlan({ cores, memMB }) }));
    console.log('[r3b] pool plan:', table.map(t => `${t.cores}c/${t.memMB}MB → ${t.workers} workers, ${t.bigWorkers} × ${t.heapMB} MB`).join('; '));
    const p = memoryPlan({ cores: 8, memMB: 8192 });
    expect(p.workers).toBe(7);
    expect(p.bigWorkers).toBeGreaterThanOrEqual(3);
    expect(p.heapMB).toBe(1024);
    for (const t of table) expect(t.bigWorkers * (t.heapMB + 96) + 512).toBeLessThanOrEqual(Math.max(t.memMB * 0.7, 512 + t.heapMB + 96));
  });
  it('after a worker ran out of memory, new workers get the bigger heap (fewer of them)', () => {
    const grown = memoryPlan({ cores: 8, memMB: 8192, grownMB: 2048 });
    expect(grown.heapMB).toBe(2048);
    expect(grown.bigWorkers).toBeLessThan(memoryPlan({ cores: 8, memMB: 8192 }).bigWorkers);
    expect(grown.workers).toBe(7); // the cores still all work
    expect(memoryPlan({ cores: 8, memMB: 2048, grownMB: 2048 }).heapMB).toBe(1024); // never past half the memory
  });
  it('the SQLite reserve is taken only when a SQL connection is sqlite:', () => {
    for (const k of Object.keys(process.env)) if (/^PW_DB_/.test(k)) delete process.env[k];
    expect(sqliteDataSources()).toBe(false);
    process.env.PW_DB_MAIN = 'postgres://x/y';
    expect(sqliteDataSources()).toBe(false);
    process.env.PW_DB_LOCAL = 'sqlite:/tmp/x.db';
    expect(sqliteDataSources()).toBe(true);
  });
});

describe('interactive ordering', () => {
  it('a small render goes before a big one queued earlier; a big one that waited 5 s is not starved', async () => {
    const { _next, _queue } = await import('../../src/server/pool.js');
    const q = _queue(); q.length = 0;
    const job = (who, est, ago = 0) => ({ cls: 0, who, est, at: Date.now() - ago });
    q.push(job('a', 20000), job('b', 200));
    expect(_next().who).toBe('b');
    expect(_next().who).toBe('a');
    q.push(job('a', 20000, 6000), job('b', 200));
    expect(_next().who).toBe('a');
    q.length = 0;
  });
});
