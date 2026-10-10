// The render pool (src/server/pool.js): server renders run in worker threads, under a hard deadline, with admission
// control (429/503 + Retry-After), interactive work before background work, and fair turns between principals.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { report } from '../helpers.js';
import { renderInPool, submit, poolStats, stopPool, admit } from '../../src/server/pool.js';
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
    await render(small()); // the workers are up
    let worst = 0, last = performance.now();
    const tick = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last - 5); last = t; }, 5);
    const t0 = performance.now();
    const [a, b] = await Promise.all([render(small()), render(slow(2500))]);
    const took = performance.now() - t0;
    clearInterval(tick);
    expect(Buffer.from(a.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(a).toMatchObject({ contentType: 'application/pdf', ext: 'pdf', pages: 1, name: 'small' });
    expect(b.pages).toBeGreaterThan(1);
    expect(worst).toBeLessThan(Math.max(150, took / 3)); // the slow render ran elsewhere: this thread only waited (a busy machine stretches both)
    expect(poolStats().workers.alive).toBe(2);
  });

  it('reads a saved template in the worker, as the principal, with the same errors', async () => {
    const e = await renderInPool({ ref: 'no-such-report-xyz', opt: { principal: OPEN } }).catch(x => x);
    expect(e.status).toBe(404);
    expect(e.message).toMatch(/not found/);
  });

  it('stops a render at the time limit by terminating its worker, and replaces only that worker', async () => {
    // the limit is calibrated to this machine: well above a small render on a cold worker (a slow 2-vCPU runner takes
    // over 0.8 s for one), far below the minute the slow render takes
    let t0 = Date.now();
    await Promise.all([render(small()), render(small())]);
    process.env.PW_RENDER_TIMEOUT_MS = String(Math.min(5000, Math.max(800, 4 * (Date.now() - t0))));
    await stopPool(); // cold workers again, as the limit was measured on
    t0 = Date.now();
    const [late, fine] = await Promise.all([render(slow(20000)).catch(e => e), render(small())]);
    expect(late.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(15000); // the limit, not the minute the render would take
    expect(fine.pages).toBe(1);
    expect((await render(small())).pages).toBe(1); // a fresh worker takes its place once the old one has exited
    while (poolStats().workers.alive < 2) await new Promise(r => setTimeout(r, 20));
  });

  it('answers 503 with Retry-After when the queue is full, and 429 when one principal fills its share', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    process.env.PW_RENDER_QUEUE = '1';
    process.env.PW_RENDER_QUEUE_PER_PRINCIPAL = '1';
    // the queued renders wait behind a slow render (each check below runs at once after running(), so a short one holds
    // the worker long enough; 6,000 rows took over 30 s on a 2-vCPU runner). On a loaded machine the wait can pass the
    // default 30 s wait budget, and a dropped wait is a 503 this test does not expect. The test checks admission (the queue's places), not the wait budget.
    process.env.PW_RENDER_MAX_WAIT_MS = '300000';
    const r0 = poolStats().totals.rejected;
    const a = render(slow(2500)); // runs
    await running();
    const b = render(small()); // waits: the queue's one place
    const c = await render(small()).catch(e => e); // OPEN again: the queue is full
    expect(c).toMatchObject({ status: 503 });
    expect(() => admit(OPEN)).toThrow(/busy/); // the routes' early check says the same, before reading anything
    expect(c.retryAfter).toBeGreaterThanOrEqual(1);
    // a principal with nothing queued or running is let in up to twice the queue (round robin serves it next)
    const d = render(small(), { principal: { kind: 'service' } });
    const e = await render(small(), { principal: { kind: 'public' } }).catch(x => x);
    expect(e).toMatchObject({ status: 503 });
    await Promise.all([a, b, d]);
    process.env.PW_RENDER_QUEUE = '10';
    const f = render(slow(2500));
    await running();
    const h = render(small());
    const i = await render(small()).catch(x => x); // OPEN's one place is taken
    expect(i).toMatchObject({ status: 429 });
    expect(i.retryAfter).toBeGreaterThanOrEqual(1);
    await Promise.all([f, h]);
    expect(poolStats().totals.rejected - r0).toBe(4);
  }, 60000);

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
    process.env.PW_RENDER_WORKER_HEAP_MB = '128';
    await render(small()); // started within the limit
    const huge = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.s' }] }] }], { data: { rows: Array.from({ length: 150000 }, (_, i) => ({ s: `row ${i} `.repeat(20) })) } });
    const e = await render(huge).catch(x => x);
    expect(e.status).toBe(500);
    delete process.env.PW_RENDER_WORKER_HEAP_MB;
    await stopPool();
    expect((await render(small())).pages).toBe(1);
  });

  it('review: a request structured clone refuses (nested too deep) fails alone and frees its worker at once', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    let deep = 0; for (let i = 0; i < 20000; i++) deep = [deep];
    await render(small()); // the worker is up
    const t0 = Date.now(), timedOut = poolStats().totals.timedOut;
    const e = await renderInPool({ def: small(), opt: { format: 'pdf', principal: OPEN, parameters: { x: deep } } }).catch(x => x);
    expect(e.status).toBe(400);
    expect((await render(small())).pages).toBe(1);
    expect(Date.now() - t0).toBeLessThan(3000); // not the render time limit
    expect(poolStats().totals.timedOut).toBe(timedOut);
  });

  it('review: one principal\'s backlog does not get another principal refused for the estimated wait', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    await render(slow(2500)); // the worker is up, and knows how long this template takes
    process.env.PW_RENDER_MAX_WAIT_MS = '300';
    const hog = [render(slow(2500)), render(slow(2500)), render(slow(2500))].map(p => p.catch(x => x));
    await running();
    const more = await render(slow(2500)).catch(x => x); // the hog's own: refused, its wait is long
    expect(more.status).toBe(503);
    const other = await render(small(), { principal: { kind: 'service' } }); // a newcomer: next in line
    expect(other.pages).toBe(1);
    await Promise.all(hog);
  }, 60000);

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
