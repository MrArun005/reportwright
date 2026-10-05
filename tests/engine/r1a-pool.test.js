// R1-A S-4: the render pool is sized by memory as well as cores, reads the container's cgroup limits, and admission
// holds new renders while the process is near its memory limit (architecture review #7).
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { report } from '../helpers.js';
import { memoryPlan, cgroupMemory, cgroupCpus, poolSize, poolStats, renderInPool, stopPool } from '../../src/server/pool.js';
import { OPEN } from '../../src/server/perms.js';

const ENV = ['PW_RENDER_WORKERS', 'PW_RENDER_WORKER_HEAP_MB', 'PW_MEMORY_LIMIT_MB', 'PW_CGROUP_DIR'];
afterEach(async () => { await stopPool(); for (const k of ENV) delete process.env[k]; });
afterAll(async () => { await stopPool(); });

describe('S-4: memory-aware render pool', () => {
  it('sizes workers and heap by min(cores, memory), not cores alone', () => {
    // the old default on an 8-core, 4 GB container: 7 workers × 2 GB heaps = 14 GB of ceiling
    expect(memoryPlan({ cores: 8, memMB: 4096 })).toMatchObject({ heapMB: 2048, workers: 1 });
    expect(memoryPlan({ cores: 8, memMB: 1024 })).toMatchObject({ heapMB: 512, workers: 1 });
    expect(memoryPlan({ cores: 8, memMB: 32768 })).toMatchObject({ heapMB: 2048, workers: 7 });
    expect(memoryPlan({ cores: 2, memMB: 32768 })).toMatchObject({ workers: 1 });
    // a smaller heap per worker (PW_RENDER_WORKER_HEAP_MB) buys more workers in the same memory
    expect(memoryPlan({ cores: 8, memMB: 8192, heapMB: 512 })).toMatchObject({ heapMB: 512, workers: 7 });
    for (const p of [memoryPlan({ cores: 16, memMB: 6000 }), memoryPlan({ cores: 4, memMB: 3000, heapMB: 700 })]) {
      expect(p.workers * (p.heapMB + 96) + 512).toBeLessThanOrEqual(Math.max(p.memMB * 0.7, 512 + p.heapMB + 96)); // the heaps fit (one worker always)
    }
  });

  it('reads cgroup v2 and v1 limits (a 2-CPU, 1.5 GB container on a big host)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cg-'));
    try {
      process.env.PW_CGROUP_DIR = dir;
      expect(cgroupMemory()).toBe(null);
      fs.writeFileSync(path.join(dir, 'memory.max'), 'max\n');
      expect(cgroupMemory()).toBe(null);
      fs.writeFileSync(path.join(dir, 'memory.max'), `${1536 * 1048576}\n`);
      fs.writeFileSync(path.join(dir, 'cpu.max'), '200000 100000\n');
      expect(cgroupMemory()).toBe(1536 * 1048576);
      expect(cgroupCpus()).toBe(2);
      expect(poolSize()).toBe(1);
      fs.rmSync(path.join(dir, 'memory.max')); fs.rmSync(path.join(dir, 'cpu.max'));
      fs.mkdirSync(path.join(dir, 'memory')); fs.mkdirSync(path.join(dir, 'cpu'));
      fs.writeFileSync(path.join(dir, 'memory/memory.limit_in_bytes'), '9223372036854771712\n'); // v1: no limit
      fs.writeFileSync(path.join(dir, 'cpu/cpu.cfs_quota_us'), '150000\n');
      fs.writeFileSync(path.join(dir, 'cpu/cpu.cfs_period_us'), '100000\n');
      expect(cgroupMemory()).toBe(null);
      expect(cgroupCpus()).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('under simulated low memory, renders run one at a time instead of piling up (and all finish)', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    process.env.PW_MEMORY_LIMIT_MB = '64'; // this process's RSS is always past 85% of it
    const def = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 400, h: 40, columns: [{ width: 400 }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }] }] }],
      { data: { rows: Array.from({ length: 3000 }, (_, i) => ({ id: i })) }, def: { name: 'mem' } });
    let most = 0;
    const t = setInterval(() => { most = Math.max(most, poolStats().workers.busy); }, 2);
    const held0 = poolStats().totals.heldForMemory;
    const out = await Promise.all([1, 2, 3, 4].map(() => renderInPool({ def, opt: { format: 'pdf', principal: OPEN } })));
    clearInterval(t);
    expect(out.every(r => r.pages > 1)).toBe(true);
    expect(most).toBe(1);
    expect(poolStats().totals.heldForMemory).toBeGreaterThan(held0);
    expect(poolStats().memory).toMatchObject({ memMB: 64, heapMB: 256 });
  }, 60000);

  it('a worker that exits on its own is replaced (it was counted as dying forever: few workers then meant none)', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    const def = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Hi' }], { def: { name: 'x' } });
    const one = () => renderInPool({ def, opt: { format: 'pdf', principal: OPEN } });
    for (let i = 0; i < 3; i++) {
      await one();
      await globalThis.__pwRenderPool.slots[0].w.terminate(); // dies outside the pool's own retire
      expect((await one()).pages).toBe(1);
    }
    expect(poolStats().totals.restarts).toBeGreaterThanOrEqual(3);
  }, 60000);
});
