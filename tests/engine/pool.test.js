// The render pool (src/server/pool.js): server renders run in worker threads, under a hard deadline, with admission
// control (429/503 + Retry-After), interactive work before background work, and fair turns between principals.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { report } from '../helpers.js';
import { renderInPool, submit, poolStats, stopPool } from '../../src/server/pool.js';
import { OPEN } from '../../src/server/perms.js';

const ENV = ['PW_RENDER_WORKERS', 'PW_RENDER_QUEUE', 'PW_RENDER_QUEUE_PER_PRINCIPAL', 'PW_RENDER_MAX_WAIT_MS', 'PW_RENDER_WORKER_MAX_RENDERS', 'PW_RENDER_TIMEOUT_MS', 'PW_RENDER_WORKER_HEAP_MB'];
const small = (name = 'small') => report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Hello' }], { def: { name } });
// every row sums the whole data set again (Globals keeps the aggregate cache out): seconds of CPU, on purpose
const slow = (n = 6000) => report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 250 }, { width: 250 }],
  detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.a / Sum(Fields.a + Globals.PageNumber * 0, "Rows")' }] }] }],
{ data: { rows: Array.from({ length: n }, (_, i) => ({ id: i, a: i % 97 })) }, def: { name: 'slow' } });
const running = async () => { while (!poolStats().workers.busy) await new Promise(r => setTimeout(r, 20)); };
const render = (def, o = {}) => renderInPool({ def, opt: { format: 'pdf', principal: o.principal || OPEN } }, o);

beforeEach(async () => { await stopPool(); for (const k of ENV) delete process.env[k]; process.env.PW_RENDER_WORKERS = '2'; });
afterAll(async () => { await stopPool(); for (const k of ENV) delete process.env[k]; });

describe('render pool', () => {
  it('renders in a worker thread and hands back the PDF bytes, while the event loop stays free', async () => {
    let worst = 0, last = performance.now();
    const tick = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last - 5); last = t; }, 5);
    const [a, b] = await Promise.all([render(small()), render(slow(2500))]);
    clearInterval(tick);
    expect(Buffer.from(a.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(a).toMatchObject({ contentType: 'application/pdf', ext: 'pdf', pages: 1, name: 'small' });
    expect(b.pages).toBeGreaterThan(1);
    expect(worst).toBeLessThan(150); // the slow render ran elsewhere: this thread only waited
    expect(poolStats().workers.alive).toBe(2);
  });

  it('reads a saved template in the worker, as the principal, with the same errors', async () => {
    const e = await renderInPool({ ref: 'no-such-report-xyz', opt: { principal: OPEN } }).catch(x => x);
    expect(e.status).toBe(404);
    expect(e.message).toMatch(/not found/);
  });

  it('stops a render at the time limit by terminating its worker, and replaces only that worker', async () => {
    process.env.PW_RENDER_TIMEOUT_MS = '800';
    const t0 = Date.now();
    const [late, fine] = await Promise.all([render(slow(20000)).catch(e => e), render(small())]);
    expect(late.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(fine.pages).toBe(1);
    expect((await render(small())).pages).toBe(1); // a fresh worker took its place
    expect(poolStats().workers.alive).toBe(2);
  });

  it('answers 503 with Retry-After when the queue is full, and 429 when one principal fills its share', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    process.env.PW_RENDER_QUEUE = '2';
    process.env.PW_RENDER_QUEUE_PER_PRINCIPAL = '1';
    const a = render(slow(3000)); // runs
    await running(); // the worker starts and takes it
    const b = render(small()); // waits: OPEN's one place in the queue
    const c = await render(small()).catch(e => e);
    expect(c).toMatchObject({ status: 429 });
    expect(c.retryAfter).toBeGreaterThanOrEqual(1);
    const d = render(small(), { principal: { kind: 'service' } }); // another principal: the queue's second place
    const e = await render(small(), { principal: { kind: 'public' } }).catch(x => x);
    expect(e).toMatchObject({ status: 503 });
    expect(e.retryAfter).toBeGreaterThanOrEqual(1);
    await Promise.all([a, b, d]);
    expect(poolStats().totals.rejected).toBe(2);
  });

  it('runs interactive work before background work, and gives each principal a fair turn', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    const order = [];
    const tag = (name, p) => p.then(() => order.push(name));
    const first = tag('first', render(slow(1500)));
    await running();
    const jobs = [
      tag('bg', render(small(), { background: true })),
      tag('hog1', render(small(), { principal: OPEN })),
      tag('hog2', render(small(), { principal: OPEN })),
      tag('other', render(small(), { principal: { kind: 'service' } })),
    ];
    await Promise.all([first, ...jobs]);
    // one at a time: "first" was OPEN's, so the other principal goes next, then OPEN's two, the background last
    expect(order).toEqual(['first', 'other', 'hog1', 'hog2', 'bg']);
  });

  it('recycles a worker after its render budget, and drops a waiting render when its caller leaves', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    process.env.PW_RENDER_WORKER_MAX_RENDERS = '2';
    for (let i = 0; i < 3; i++) expect((await render(small())).pages).toBe(1);
    expect(poolStats().totals.recycled).toBeGreaterThanOrEqual(1);
    const busy = render(slow(1500));
    await running();
    const ac = new AbortController();
    const gone = render(small(), { signal: ac.signal }).catch(e => e);
    ac.abort();
    expect((await gone).status).toBe(499);
    await busy;
    expect(poolStats().queue.interactive).toBe(0);
  });

  it('a worker that runs out of memory fails its render only', async () => {
    process.env.PW_RENDER_WORKER_HEAP_MB = '64';
    const huge = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.s' }] }] }], { data: { rows: Array.from({ length: 60000 }, (_, i) => ({ s: `row ${i} `.repeat(20) })) } });
    const e = await render(huge).catch(x => x);
    expect(e.status).toBe(500);
    delete process.env.PW_RENDER_WORKER_HEAP_MB;
    await stopPool();
    expect((await render(small())).pages).toBe(1);
  });

  it('PW_RENDER_WORKERS=0 renders on the request thread, as before', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    expect((await render(small())).pages).toBe(1);
    expect(poolStats().workers.alive).toBe(0);
  });

  it('thumbnails go through the pool too', async () => {
    const t = await submit({ kind: 'thumb', def: small(), principal: OPEN, base: 'http://127.0.0.1:1' }, { background: true, principal: OPEN });
    expect(t.svg).toMatch(/^<svg/);
    expect(t.pages).toBe(1);
  });
});
