// Streaming phase A (docs/research/STREAMING-1M.md §8): the pool is sized by cores and admits renders by a memory
// estimate; small renders run in small-heap workers, and one that runs out of a small heap runs again in a big one.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { report } from '../helpers.js';
import { poolStats, renderInPool, streamInPool, submit, stopPool, memoryPlan, _sizeOf, _learn, _forget, _running } from '../../src/server/pool.js';
import { OPEN } from '../../src/server/perms.js';

const ENV = ['PW_RENDER_WORKERS', 'PW_RENDER_WORKER_HEAP_MB', 'PW_RENDER_SMALL_HEAP_MB', 'PW_MEMORY_LIMIT_MB', 'PW_RENDER_TIMEOUT_MS', 'PW_STREAM_STALL_MS', 'PW_RENDER_RUNNING_PER_PRINCIPAL'];
afterEach(async () => { await stopPool(); for (const k of ENV) delete process.env[k]; });
afterAll(async () => { await stopPool(); });

const table = (n, name) => report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 400, h: 40, columns: [{ width: 200 }, { width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }] }] }],
  { data: { rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `row ${i} ${'x'.repeat(40)}` })) }, def: { name } });
const busyMax = () => { let most = 0; const t = setInterval(() => { most = Math.max(most, poolStats().workers.busy); }, 2); return () => { clearInterval(t); return most; }; };

describe('streaming phase A: cores-sized pool, memory-estimate admission', () => {
  it('the plan keeps a small heap for the workers past the big ones', () => {
    const p = memoryPlan({ cores: 8, memMB: 4096, smallHeapMB: 160 });
    expect(p).toMatchObject({ workers: 7, bigWorkers: 2, smallHeapMB: 160, budgetMB: Math.round(4096 * 0.7 - 512) });
  });

  it('renders whose estimates fit the budget run at once; ones that do not, one after another', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    const def = table(20000, 'fits');
    // both workers up first, so the two renders can overlap
    await renderInPool({ def: table(5, 'warm'), opt: { format: 'pdf', principal: OPEN } });
    while (poolStats().workers.ready < 2) await new Promise(r => setTimeout(r, 20));
    // 400 MB of budget: two small-worker renders (charged the 192 MB small heap each) fit together
    process.env.PW_MEMORY_LIMIT_MB = String(Math.ceil((512 + 400) / 0.7));
    let stop = busyMax();
    let out = await Promise.all([1, 2, 3, 4].map(() => submit({ kind: 'render', def, opt: { format: 'csv', principal: OPEN }, how: 'template', stream: true }, { principal: OPEN, key: 'k-fit' })));
    expect(out.every(r => r.bytes.length > 0)).toBe(true);
    const together = stop();
    await stopPool();
    // 300 MB: only one at a time
    process.env.PW_MEMORY_LIMIT_MB = String(Math.ceil((512 + 300) / 0.7));
    stop = busyMax();
    const held0 = poolStats().totals.heldForMemory;
    out = await Promise.all([1, 2, 3, 4].map(() => submit({ kind: 'render', def, opt: { format: 'csv', principal: OPEN }, how: 'template', stream: true }, { principal: OPEN, key: 'k-one' })));
    expect(out.every(r => r.bytes.length > 0)).toBe(true);
    expect(stop()).toBe(1);
    expect(poolStats().totals.heldForMemory).toBeGreaterThan(held0); // held for room, not for want of a worker
    expect(together).toBe(2);
  }, 120000);

  it('a render that runs out of a small heap runs again, once, in a big worker', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    process.env.PW_MEMORY_LIMIT_MB = '3000'; // room for one 1 GB heap: one big worker, one small
    process.env.PW_RENDER_SMALL_HEAP_MB = '48';
    // both workers up first: a free big worker would take the render before the small one is ready
    await renderInPool({ def: table(5, 'warm'), opt: { format: 'pdf', principal: OPEN } });
    while (poolStats().workers.ready < 2) await new Promise(r => setTimeout(r, 20));
    const before = poolStats().totals.retriedBig;
    // marked as a stream (so a small worker takes it), but the PDF of 60k rows needs far more than 48 MB
    const r = await submit({ kind: 'render', def: table(60000, 'too-big'), opt: { format: 'pdf', principal: OPEN }, how: 'template', stream: true }, { principal: OPEN, key: 'k-big' });
    expect(r.pages).toBeGreaterThan(100);
    expect(poolStats().totals.retriedBig).toBe(before + 1);
  }, 180000);

  it('a template learns its memory: a small one goes to a small worker next time', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    process.env.PW_MEMORY_LIMIT_MB = '8192';
    const def = table(20, 'tiny');
    await renderInPool({ def, opt: { format: 'pdf', principal: OPEN } });
    const s = poolStats();
    expect(s.memory.workers).toBe(2);
    expect(s.memory.bigWorkers).toBeGreaterThanOrEqual(1);
    const r = await renderInPool({ def, opt: { format: 'pdf', principal: OPEN } });
    expect(r.pages).toBe(1);
  }, 60000);

  it('estimates never come from the request, are per principal, clamped, and conservative when unknown', () => {
    process.env.PW_MEMORY_LIMIT_MB = '8192';
    _forget();
    const { heapMB, smallHeapMB } = poolStats().memory;
    // unknown: the whole big heap; numbers in the message (a caller's) are ignored
    expect(_sizeOf({ kind: 'render', mem: 1, est: 1, opt: { mem: 1, peakMB: 1 } }, 'alice', 'r1')).toEqual({ mem: heapMB, big: true });
    // a stream or a thumbnail is charged the small heap, the most a small worker holds (never less)
    expect(_sizeOf({ kind: 'render', stream: true }, 'alice', 'r1')).toEqual({ mem: smallHeapMB, big: false });
    expect(_sizeOf({ kind: 'thumb' }, 'alice', 'r1')).toEqual({ mem: smallHeapMB, big: false });
    // alice's tiny render of r1 sends her next r1 to a small worker; bob's r1 is still unknown to the pool
    _learn({ who: 'alice', key: 'r1' }, 5);
    expect(_sizeOf({ kind: 'render' }, 'alice', 'r1')).toEqual({ mem: smallHeapMB, big: false });
    expect(_sizeOf({ kind: 'render' }, 'bob', 'r1')).toEqual({ mem: heapMB, big: true });
    // and bob cannot lower or raise alice's: his huge render is his own, and clamped to the heap
    _learn({ who: 'bob', key: 'r1' }, 1e9);
    expect(_sizeOf({ kind: 'render' }, 'bob', 'r1')).toEqual({ mem: heapMB, big: true });
    expect(_sizeOf({ kind: 'render' }, 'alice', 'r1')).toEqual({ mem: smallHeapMB, big: false });
    // a medium template: its measured peak, at least 32 MB; a later bigger render raises it at once
    _learn({ who: 'carol', key: 'r2' }, 150);
    expect(_sizeOf({ kind: 'render' }, 'carol', 'r2')).toEqual({ mem: 150, big: true });
    _learn({ who: 'carol', key: 'r2' }, 400);
    expect(_sizeOf({ kind: 'render' }, 'carol', 'r2').mem).toBe(400);
    _learn({ who: 'carol', key: 'r2' }, 100); // smaller: only slowly
    expect(_sizeOf({ kind: 'render' }, 'carol', 'r2').mem).toBe(340);
    _forget();
  });

  // the admitted memory is the sum over running renders (no counter): whatever way a render ends, it is 0 after
  const settled = async () => { for (let i = 0; i < 100 && _running().jobs; i++) await new Promise(r => setTimeout(r, 20)); return _running(); };
  it('admission state after a crash, a timeout, a cancelled and a stalled stream: back to nothing, never below', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    process.env.PW_MEMORY_LIMIT_MB = '8192';
    // crash: out of a 64 MB heap (big workers too)
    process.env.PW_RENDER_WORKER_HEAP_MB = '64'; process.env.PW_RENDER_SMALL_HEAP_MB = '48';
    await expect(renderInPool({ def: table(150000, 'crash'), opt: { format: 'pdf', principal: OPEN } })).rejects.toThrow(/memory|stopped/);
    expect(await settled()).toMatchObject({ mb: 0, jobs: 0, principals: {} });
    await stopPool(); delete process.env.PW_RENDER_WORKER_HEAP_MB; delete process.env.PW_RENDER_SMALL_HEAP_MB;
    // timeout
    process.env.PW_RENDER_TIMEOUT_MS = '300';
    await expect(renderInPool({ def: table(150000, 'slow'), opt: { format: 'pdf', principal: OPEN } })).rejects.toMatchObject({ status: 504 });
    expect(await settled()).toMatchObject({ mb: 0, jobs: 0 });
    delete process.env.PW_RENDER_TIMEOUT_MS;
    // a stream cancelled by its client after the first chunk
    const big = table(200000, 'stream');
    let r = await streamInPool({ def: big, opt: { format: 'csv', principal: OPEN } });
    expect(r.stream).toBeDefined();
    const rd = r.stream.getReader(); await rd.read(); await rd.cancel();
    await r.done;
    expect(await settled()).toMatchObject({ mb: 0, jobs: 0 });
    // a stream whose client never reads: stopped at PW_STREAM_STALL_MS, its worker and memory freed
    await stopPool();
    process.env.PW_STREAM_STALL_MS = '300';
    r = await streamInPool({ def: big, opt: { format: 'csv', principal: OPEN } });
    const t0 = Date.now();
    await r.done;
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(await settled()).toMatchObject({ mb: 0, jobs: 0 });
    // and the pool still renders
    expect((await renderInPool({ def: table(10, 'after'), opt: { format: 'pdf', principal: OPEN } })).pages).toBe(1);
  }, 180000);

  it('one caller may hold at most PW_RENDER_RUNNING_PER_PRINCIPAL renders; others still get the rest', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    process.env.PW_MEMORY_LIMIT_MB = '8192';
    process.env.PW_RENDER_RUNNING_PER_PRINCIPAL = '1';
    const def = table(20000, 'cap');
    await renderInPool({ def: table(5, 'warm'), opt: { format: 'pdf', principal: OPEN } });
    while (poolStats().workers.ready < 2) await new Promise(r => setTimeout(r, 20));
    let stop = busyMax();
    await Promise.all([1, 2, 3].map(() => submit({ kind: 'render', def, opt: { format: 'csv', principal: OPEN }, stream: true }, { principal: OPEN, key: 'cap' })));
    expect(stop()).toBe(1);
    const other = { kind: 'user', email: 'b@x.test', role: 'viewer' };
    stop = busyMax();
    await Promise.all([submit({ kind: 'render', def, opt: { format: 'csv', principal: OPEN }, stream: true }, { principal: OPEN, key: 'cap' }), submit({ kind: 'render', def, opt: { format: 'csv', principal: OPEN }, stream: true }, { principal: other, key: 'cap' })]);
    expect(stop()).toBe(2);
  }, 120000);
});
