// @ts-check
// The render pool: every server render and export (API v1, report links, batches, schedules, thumbnails) runs in a
// worker thread (render-worker.mjs), never on the request thread. The request thread parses, authorises, queues and
// sends the bytes back. Settings:
//   PW_RENDER_WORKERS              threads (default: cores - 1, at most 16, fewer only when memory cannot hold their
//                                  idle cost: see memoryPlan); 0 = render on the request thread, as before)
//   PW_RENDER_QUEUE                interactive renders that may wait (default 1000); more: 503 + Retry-After
//   PW_RENDER_QUEUE_PER_PRINCIPAL  of those, per user or key (default 8 per worker, at least 16); more: 429 + Retry-After
//   PW_RENDER_MAX_WAIT_MS          refuse (503) a render whose estimated wait is longer (default 30 s); a render that
//                                  waited longer anyway is dropped with a 503 when its turn comes
//   PW_RENDER_WORKER_MAX_RENDERS   recycle a worker after this many renders (default 500)
//   PW_RENDER_WORKER_RECYCLE_MB    recycle a worker whose heap is above this after a render (default 512)
//   PW_RENDER_WORKER_HEAP_MB       a big worker's hard heap limit: past it the worker dies, its render fails (default
//                                  1024, then twice that after a render ran out of it, up to 2048; at most half the memory)
//   PW_RENDER_SMALL_HEAP_MB        the other workers' heap limit (default 192): streaming renders and renders known to be
//                                  small run there; a render that runs out of it is run again, once, in a big worker
//   PW_MEMORY_LIMIT_MB             the memory this server may use (default: the container's cgroup limit, else the
//                                  machine's RAM). Cores likewise come from the cgroup CPU quota when there is one,
//   PW_CPUS                        or from this (scripts/cluster.mjs gives each process its share of both).
// Cores decide the worker count; memory decides what runs at once. The render budget is 70% of the limit less the
// request thread (512 MB). Only as many workers as that budget holds big heaps for get the big heap (bigWorkers); the
// rest get the small one. Each render is admitted by an estimate of its memory (sizeOf: never from the request; per
// principal and template; the small heap for a render bound to a small worker, else the template's measured peak for
// that principal, else the whole big heap): a render waits while the running renders' estimates leave no room for it (unless
// none is running), so several big renders at once queue instead of the kernel killing the whole server. Backstop:
// while the process's resident memory is above 85% of the limit, no further render starts unless none is running.
// The render time limit (renderer.renderTimeoutMs) covers the whole render (template read, data fetch, layout,
// export): the worker is terminated when it runs out, and replaced. A worker that crashes is replaced too; the
// other workers and their renders go on.
// Two classes: "interactive" (a person or an API caller waits) and "background" (batch items, schedules, thumbnails):
// a free worker always takes interactive work first. Within a class, the principal with the fewest renders running
// goes first, then the one served longest ago (round robin), so one user's flood of renders cannot starve another
// user's single render. A principal with nothing queued or running is never refused for the queue's length or the
// estimated wait (round robin serves it within one turn), up to a hard bound of twice PW_RENDER_QUEUE; the
// per-principal cap stops one user filling the queue. Background work is not capped here: its callers bound it (PW_BATCH_CONCURRENCY,
// one thumbnail at a time).
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, SHARE_ENV, MessageChannel } from 'node:worker_threads';
import { portSource, portSink } from './stream-out.js';
import { spillShared, sweepAtBoot } from '../exporters/spill.js';
import { renderTimeoutMs } from './renderer.js';
import { principalId } from './perms.js';
import { accountsOn, sessionSecret } from './session.js';
import { devMode, num as cnum } from './config.js';

const num = (k, d, min = 0) => cnum(k, d, { min }); // the one parser (config.num)

/** A cgroup file's text (v2 under /sys/fs/cgroup, v1 under its controller folders), or null. PW_CGROUP_DIR: tests.
 *  Read at most every 30 s (it was a synchronous read on every admission: REVIEW-ARCH-2 2.6). */
const cgCache = new Map();
function cgroup(...names) {
  const dir = process.env.PW_CGROUP_DIR || '/sys/fs/cgroup';
  const key = `${dir}|${names.join('|')}`;
  const hit = cgCache.get(key);
  if (hit && Date.now() - hit.at < 30000) return hit.v;
  let v = null;
  for (const n of names) { try { v = fs.readFileSync(path.join(dir, n), 'utf8').trim(); break; } catch { /* not there */ } }
  cgCache.set(key, { at: Date.now(), v });
  return v;
}
/** Tests: forget the cached cgroup files. */
export const resetCgroupCache = () => cgCache.clear();
/** The container's memory limit in bytes, or null (none, or not Linux). */
export function cgroupMemory() {
  const v = cgroup('memory.max', 'memory/memory.limit_in_bytes');
  const n = v && v !== 'max' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n < 2 ** 60 ? n : null; // v1 says "no limit" with a huge number
}
/** The container's CPU quota in cores (rounded up), or null. */
export function cgroupCpus() {
  const v2 = cgroup('cpu.max');
  let quota = NaN, period = NaN;
  if (v2) [quota, period] = v2.split(/\s+/).map(Number);
  else { quota = Number(cgroup('cpu/cpu.cfs_quota_us')); period = Number(cgroup('cpu/cpu.cfs_period_us')); }
  return quota > 0 && period > 0 ? Math.max(1, Math.ceil(quota / period)) : null;
}

const RESERVE_MB = 512, WORKER_EXTRA_MB = 96; // the request thread and its caches; a worker's own code, fonts, buffers
/** Tests: the ordering rule. */
export const _next = () => next();
export const _queue = () => P.queue;
/** Tests: the admission estimate and how it is learnt. */
export const _sizeOf = (msg, who, key) => sizeOf(msg, who, key);
export const _learn = (j, mb) => learn(j, mb);
export const _forget = () => P.mem.clear();

/**
 * Worker count and heaps for a machine: { cores, memMB, heapMB, smallHeapMB, workers, bigWorkers, budgetMB }. Pure
 * (tests pass their own numbers). Workers by cores (cores - 1, at most 16; fewer only when the budget cannot hold their
 * idle cost); bigWorkers: the workers whose big heaps all fit in the budget (at least 1); the others get the small heap.
 * @param {{ cores: number, memMB: number, heapMB?: number|null, smallHeapMB?: number|null, workers?: number|null, grownMB?: number }} m
 */
export function memoryPlan({ cores, memMB, heapMB: heap = null, smallHeapMB = null, workers = null, grownMB = 0 }) {
  // a big worker starts at 1 GB (a 250k-row grouped report peaks at ~770 MB); after one ran out of memory, new big
  // workers get the larger heap that render needed (grownMB, up to 2 GB)
  const h = Math.floor(heap ?? Math.max(256, Math.min(Math.max(1024, grownMB), 2048, memMB / 2)));
  const small = Math.floor(Math.min(smallHeapMB ?? 192, h));
  const budget = Math.max(0, memMB * 0.7 - RESERVE_MB);
  const w = Math.floor(workers ?? Math.max(1, Math.min(16, cores - 1, Math.floor(budget / WORKER_EXTRA_MB))));
  const big = Math.max(1, Math.min(w, Math.floor(budget / (h + WORKER_EXTRA_MB))));
  return { cores, memMB: Math.round(memMB), heapMB: h, smallHeapMB: small, workers: w, bigWorkers: big, budgetMB: Math.round(budget) };
}
// PW_MEMORY_LIMIT_MB narrows the machine's or container's memory, never widens it; the SQLite query processes' own
// budget (sql/sqlite.js, outside these threads) comes off the top, only when a SQL connection uses sqlite:
export const sqliteDataSources = () => Object.entries(process.env).some(([k, v]) => /^PW_DB_\w+$/.test(k) && !/_PROCS$/.test(k) && /^sqlite:/.test(String(v || '')));
const memLimitMB = () => {
  const box = Math.min(os.totalmem(), cgroupMemory() ?? Infinity) / 1048576;
  const sqlite = sqliteDataSources() ? num('PW_SQLITE_PROCESSES', 2, 0) * num('PW_SQLITE_MEMORY_MB', 1024, 64) : 0;
  return Math.max(64, Math.min(num('PW_MEMORY_LIMIT_MB', Infinity, 64), box - Math.min(sqlite, box / 4)));
};
const plan = () => memoryPlan({
  cores: num('PW_CPUS', Math.min(os.availableParallelism?.() || os.cpus().length, cgroupCpus() ?? Infinity), 1),
  memMB: memLimitMB(),
  heapMB: num('PW_RENDER_WORKER_HEAP_MB', null, 64),
  smallHeapMB: num('PW_RENDER_SMALL_HEAP_MB', null, 32),
  workers: num('PW_RENDER_WORKERS', null),
  grownMB: P.grownMB && Date.now() - (P.grownAt || 0) < 30 * 60000 ? P.grownMB : 0, // back to 1 GB after 30 min without an OOM
});
export const poolSize = () => plan().workers;
const queueMax = () => num('PW_RENDER_QUEUE', 1000, 1);
const perPrincipalMax = () => num('PW_RENDER_QUEUE_PER_PRINCIPAL', Math.max(16, 8 * poolSize()), 1);
const maxWaitMs = () => num('PW_RENDER_MAX_WAIT_MS', 30000, 1);
const maxRenders = () => num('PW_RENDER_WORKER_MAX_RENDERS', 500, 1);
const recycleMB = () => num('PW_RENDER_WORKER_RECYCLE_MB', 512, 1);
const heapMB = () => plan().heapMB;
/** Resident memory is too high to start one more render now (85% of the limit). */
const memoryFull = () => process.memoryUsage.rss() / 1048576 > memLimitMB() * 0.85;

/** @typedef {{ id: number, fresh?: boolean, msg: any, transfer?: any[], started?: { v: boolean }, cls: 0|1, who: string, est: number, mem: number, big: boolean, retried?: boolean, at: number, key: string, resolve: (v: any) => void, reject: (e: any) => void, signal?: AbortSignal, onAbort?: () => void }} Job */
/** @typedef {{ w: Worker, ready: boolean, job: Job|null, renders: number, timer: any, big: boolean, cell: number }} Slot */

const g = /** @type {any} */ (globalThis);
/** @type {{ startFails: number, dying: Set<Worker>, dyingBig: Set<Worker>, slots: Slot[], queue: Job[], running: Map<string, number>, waiting: Map<string, number>, served: Map<string, number>, est: Map<string, number>, mem: Map<string, number>, seq: number, noWorker: string|null, stats: Record<string, number>, hist?: { counts: number[], sum: number, n: number }, lastFree?: number, grownMB?: number, grownAt?: number, arriving: Map<string, number>, credWho: Map<string, string>, arrivingTotal: number }} */
const P = g.__pwRenderPool ||= { startFails: 0, dying: new Set(), dyingBig: new Set(), slots: [], queue: [], running: new Map(), waiting: new Map(), served: new Map(), est: new Map(), mem: new Map(), seq: 0, noWorker: null, arriving: new Map(), credWho: new Map(), arrivingTotal: 0,
  stats: { done: 0, failed: 0, rejected: 0, timedOut: 0, crashed: 0, recycled: 0, dropped: 0, heldForMemory: 0, restarts: 0, retriedBig: 0 } };
P.arriving ||= new Map(); P.credWho ||= new Map(); P.arrivingTotal ||= 0;
P.stats.heldForMemory ??= 0; P.stats.restarts ??= 0; P.stats.retriedBig ??= 0; P.mem ||= new Map(); P.dyingBig ||= new Set();

/**
 * MB a render is charged at admission, and whether it needs a big heap. Never from the request: the caller chooses
 * neither the number nor the class. A render bound for a small worker (a stream, a thumbnail, or a template this
 * principal rendered small before) is charged the small heap, the most it can hold; any other render its template's
 * measured peak for this principal (learned from the worker, biased up, clamped to [MEM_MIN, heap]), else the whole big
 * heap. Estimates are per principal and template: one user's renders never set another's. The heap limits stay the
 * hard backstop, and the RSS hold (memoryFull) a second one.
 */
const MEM_MIN = 32;
const memKey = (who, key) => `${who}\u0000${key}`;
function sizeOf(msg, who, key) {
  const { smallHeapMB, heapMB: big } = plan();
  const seen = P.mem.get(memKey(who, key));
  if (msg.stream || msg.kind === 'thumb' || (seen != null && seen < smallHeapMB * 0.5)) return { mem: smallHeapMB, big: false };
  return { mem: Math.min(big, Math.max(MEM_MIN, seen ?? big)), big: true };
}
/** Learn a principal's template size from a finished render: the measured peak, clamped, biased up. */
function learn(j, peakMB) {
  if (!(peakMB > 0)) return;
  const k = memKey(j.who, j.key), o = P.mem.get(k), mb = Math.min(plan().heapMB, Math.max(MEM_MIN, Math.ceil(peakMB)));
  P.mem.set(k, Math.round(o == null ? mb : Math.max(mb, 0.8 * o + 0.2 * mb)));
  if (P.mem.size > 5000) P.mem.clear();
}
/** The memory admitted now: always the sum over the renders running at this moment (a slot's job is set once and
 *  cleared once, by finish(), whichever way the render ends: done, failed, crashed, timed out, retired). No counter
 *  is kept, so nothing can drift, leak or go below 0. */
const runningMB = () => P.slots.reduce((s, x) => s + (x.job ? x.job.mem : 0), 0);
/** Tests: what is admitted, and by whom. */
export const _running = () => ({ mb: runningMB(), jobs: P.slots.filter(s => s.job).length, principals: Object.fromEntries(P.running) });
/** Renders one principal may have running at once (PW_RENDER_RUNNING_PER_PRINCIPAL; default half the workers, at least
 *  2): the rest wait their turn, so one caller's stalled streams cannot hold every worker and the memory budget. */
const runningMax = () => num('PW_RENDER_RUNNING_PER_PRINCIPAL', Math.max(2, Math.ceil(poolSize() / 2)), 1);

// render durations (seconds) for /api/v1/metrics: a Prometheus histogram
export const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
P.hist ||= { counts: BUCKETS.map(() => 0), sum: 0, n: 0 };
const observe = (ms) => { const sec = ms / 1000; const h = P.hist; if (!h) return; h.n++; h.sum += sec; BUCKETS.forEach((b, i) => { if (sec <= b) h.counts[i]++; }); };

const busy = (msg, status, retryMs) => Object.assign(new Error(msg), { status, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) });
const bump = (m, k, d) => { const n = (m.get(k) || 0) + d; if (n > 0) m.set(k, n); else m.delete(k); };

/** The worker script. Production (next start, standalone): the bundle built with this build (scripts/build-worker.mjs),
 *  so the workers run the same code as the server, and a standalone output (no src/) has one. Development and tests:
 *  the sources, so a stale bundle is never run. Either falls back to the other. */
function workerFile() {
  // Paths the bundler cannot work out (Turbopack follows process.cwd() and import.meta.url joins, then traces and tries
  // to bundle the whole repository): the worker is plain Node, run from the sources or from its own bundle.
  const proc = globalThis['process'], meta = import.meta;
  const sources = [];
  try { sources.push(path.join(path.dirname(fileURLToPath(meta['url'])), 'render-worker.mjs')); } catch { /* not a file URL */ }
  sources.push([proc['cwd'](), 'src', 'server', 'render-worker.mjs'].join(path.sep));
  const bundle = [proc['cwd'](), 'pw-worker', 'render-worker.mjs'].join(path.sep);
  const list = proc['env']['NODE_ENV'] === 'production' ? [bundle, ...sources] : [...sources, bundle];
  return list.find(f => fs.existsSync(f)) || null;
}

/** Start the workers now (instrumentation.js), so the first renders do not wait for them. */
export function warmPool() { sweepAtBoot(); fill(); }

function fill() {
  if (P.noWorker || poolSize() < 1) return;
  // a terminated worker counts until it has exited: one stuck in a native call (a synchronous SQLite query) cannot be
  // terminated, and refilling beside it would pile up threads
  while (P.slots.length + P.dying.size < poolSize()) {
    // big heaps first, up to bigWorkers (a dying big worker still holds its place)
    const bigs = P.slots.filter(x => x.big).length + P.dyingBig.size;
    if (!spawn(bigs < plan().bigWorkers)) return;
  }
}

function spawn(big) {
  const file = workerFile();
  if (!file) { giveUp('src/server/render-worker.mjs is not here'); return false; }
  // eval: the bundler sees a string, not a module to trace; the bootstrap imports the worker from its file
  // a cell of the shared spill counter for this thread (spill.js): cell 0 is the request thread's own
  const used = new Set(P.slots.map(x => x.cell));
  let cell = 1;
  while (used.has(cell) && cell < 63) cell++;
  const w = new Worker('import(require("node:url").pathToFileURL(require("node:worker_threads").workerData.file).href)',
    // devSecret: without PW_SESSION_SECRET (development only) each thread would make its own, and the server's calls to
    // itself from a worker would carry a cookie the request thread cannot check
    { eval: true, env: SHARE_ENV, workerData: { file, spill: { cells: spillShared().cells, cell }, devSecret: accountsOn() && !process.env.PW_SESSION_SECRET && devMode() ? sessionSecret() : undefined },
      resourceLimits: big ? { maxOldGenerationSizeMb: heapMB() } : { maxOldGenerationSizeMb: plan().smallHeapMB, maxYoungGenerationSizeMb: 16 } });
  w.unref();
  /** @type {Slot} */
  const s = { w, ready: false, job: null, renders: 0, timer: null, big, cell };
  // the thread's spill bytes count no more once it has ended (a terminated render cannot give them back itself)
  w.once('exit', () => Atomics.store(spillShared().cells, cell, 0));
  P.slots.push(s);
  w.on('message', (m) => {
    if (m?.ready === true) { s.ready = true; P.startFails = 0; pump(); return; }
    if (m?.ready === false) { giveUp(m.error); return; }
    const job = s.job;
    if (!job || m?.id !== job.id) return;
    const took = finish(s);
    s.renders++;
    observe(took);
    if (!m.err) { P.est.set(job.key, Math.round(0.7 * (P.est.get(job.key) ?? took) + 0.3 * took)); if (P.est.size > 5000) P.est.clear(); } // successes only: a made-up ref teaches nothing
    // the memory it used (the worker's peak heap growth): a template learns its size, biased up (a bigger render
    // counts at once, a smaller one only slowly)
    if (!m.err) learn(job, m.peakMB);
    if (m.err) { P.stats.failed++; job.reject(Object.assign(new Error(m.err.message), m.err)); }
    else { P.stats.done++; job.resolve(m.ok); }
    if (s.renders >= maxRenders() || m.heapMB > recycleMB()) { P.stats.recycled++; retire(s); }
    pump();
  });
  w.on('error', (e) => died(s, e));
  w.on('exit', () => died(s, null, true));
  return true;
}

/** The worker cannot load the server code here: render on the request thread from now on (as before the pool). */
function giveUp(why) {
  if (P.noWorker) return;
  P.noWorker = why;
  console.warn(`[reportwright] renders run on the request thread: ${why}`);
  for (const s of P.slots.splice(0)) { const j = s.job; s.w.removeAllListeners(); s.w.on('error', () => {}); s.w.terminate(); if (j) { finish(s); runInline(j); } }
  for (const j of P.queue.splice(0)) { unwait(j); runInline(j); }
}

function finish(s) {
  clearTimeout(s.timer);
  const j = s.job;
  if (!j) return;
  s.job = null;
  bump(P.running, j.who, -1);
  return Date.now() - j.at;
}

function retire(s, exited = false) {
  const i = P.slots.indexOf(s);
  if (i >= 0) P.slots.splice(i, 1);
  s.w.removeAllListeners();
  s.w.on('error', () => {}); // a late error from a terminated worker is not news
  // a worker that has already exited sends no second 'exit': counting it as dying would keep its place forever
  if (exited) { P.stats.restarts++; fill(); pump(); return; }
  P.dying.add(s.w);
  if (s.big) P.dyingBig.add(s.w);
  s.w.once('exit', () => { P.dying.delete(s.w); P.dyingBig.delete(s.w); P.stats.restarts++; fill(); pump(); });
  s.w.terminate();
}

function died(s, e, exited = false) {
  if (!P.slots.includes(s)) return;
  const j = s.job;
  const why = e ? String(e.message || e) : 'it exited';
  // the detail goes to the log only: it may come from another render's leftovers (an SQL error, a URL)
  if (e) console.warn(`[reportwright] a render worker stopped: ${why}`);
  const oom = e?.code === 'ERR_WORKER_OUT_OF_MEMORY' || /heap|memory/i.test(why);
  // observed need: a render ran out of this heap, so workers started from now on get twice it (up to 2 GB, the memory
  // plan permitting): the pool starts small and many, and grows its heap only when a real report needs it
  if (oom && s.big && !num('PW_RENDER_WORKER_HEAP_MB', null, 64)) { P.grownMB = Math.min(2048, Math.max(P.grownMB || 0, heapMB() * 2)); P.grownAt = Date.now(); }
  // out of a small worker's heap: the estimate was wrong; the render runs again, once, in a big worker (a stream
  // whose answer has started cannot: its caller sees the stream fail; one that has not runs again without streaming)
  if (j && oom && !s.big && !j.retried && !j.started?.v) {
    finish(s); P.stats.retriedBig++;
    if (j.msg.port) { j.msg = { ...j.msg, port: undefined, stream: false }; j.transfer = []; }
    j.retried = true; j.big = true; j.mem = plan().heapMB; P.mem.set(memKey(j.who, j.key), plan().heapMB);
    bump(P.waiting, j.who, 1); P.queue.unshift(j);
  } else if (j) { finish(s); P.stats.crashed++; j.reject(Object.assign(new Error(oom ? 'The render ran out of memory and was stopped.' : 'The render stopped unexpectedly. Try again.'), { status: 500 })); }
  if (!s.ready && ++P.startFails >= 3) { // it keeps dying while starting: no crash loop, render on this thread
    const i = P.slots.indexOf(s); if (i >= 0) P.slots.splice(i, 1);
    giveUp(why);
    return;
  }
  retire(s, exited);
  pump();
}

/** The next job for a free worker: interactive first; then the principal with the fewest running; then a small render
 *  (estimated under SMALL_MS) before a big one, unless the big one has waited AGE_MS already (no starvation); then
 *  the principal served longest ago (round robin); then the oldest. */
const SMALL_MS = 1500, AGE_MS = 5000;
function next(ok = (_j) => true) {
  let best = -1;
  const now = Date.now();
  const run = (j) => P.running.get(j.who) || 0, last = (j) => P.served.get(j.who) || 0;
  const big = (j) => (j.est >= SMALL_MS && now - j.at < AGE_MS ? 1 : 0);
  for (let i = 0; i < P.queue.length; i++) {
    const j = P.queue[i], b = P.queue[best];
    if (!ok(j)) continue;
    if (!b || j.cls < b.cls || (j.cls === b.cls && (run(j) < run(b) || (run(j) === run(b) && (big(j) < big(b) || (big(j) === big(b) && last(j) < last(b))))))) best = i;
  }
  return best < 0 ? null : P.queue.splice(best, 1)[0];
}

function unwait(j) { bump(P.waiting, j.who, -1); if (j.signal && j.onAbort) j.signal.removeEventListener('abort', j.onAbort); }

function pump() {
  // free workers, small heaps first: a small render there leaves the big heaps for renders that need them
  for (const s of [...P.slots].sort((a, b) => Number(a.big) - Number(b.big))) {
    // memory first: past 85% of the limit a new render waits for a running one to end (never all of them: one runs)
    if (s.ready && !s.job && P.queue.length && P.slots.some(x => x.job) && memoryFull()) {
      P.stats.heldForMemory++;
      // resident memory rarely shrinks by itself: an idle worker that has rendered gives its heap back by exiting
      // (a fresh one takes its place), at most every 10 s, so the hold cannot outlast the memory it is about
      if (s.renders > 0 && Date.now() - (P.lastFree || 0) > 10000) { P.lastFree = Date.now(); P.stats.recycled++; retire(s); }
      return;
    }
    if (s.ready && !s.job && P.queue.length) dispatch(s);
  }
}

/** Give the next job to this free worker: one its heap suits, whose memory estimate fits beside the running renders
 *  (the first one always fits). */
function dispatch(s) {
  const room = plan().budgetMB - runningMB(), any = P.slots.some(x => x.job), now = Date.now();
  // a render that has waited AGE_MS for room goes next: smaller ones may not keep taking the room it waits for
  const stuck = any ? P.queue.find(x => now - x.at > AGE_MS && x.mem > room && (P.running.get(x.who) || 0) < runningMax()) : null;
  let j;
  while ((j = next((x) => (s.big || !x.big) && (P.running.get(x.who) || 0) < runningMax() && (stuck ? x === stuck : !any || x.mem <= room)))) {
    unwait(j);
    // waited past the limit (the estimate was wrong): the caller has given up by now, or is about to
    if (j.cls === 0 && !j.fresh && Date.now() - j.at > maxWaitMs()) { P.stats.dropped++; j.reject(busy('The server is busy: this render waited too long for its turn. Try again shortly.', 503, 5000)); continue; }
    break;
  }
  if (!j) { if (any && P.queue.some(x => (s.big || !x.big) && x.mem > room)) P.stats.heldForMemory++; return; } // waits for room
  s.job = j;
  bump(P.running, j.who, 1);
  if (P.served.size > 10000) P.served.clear();
  P.served.set(j.who, ++P.seq); // when this principal was last served
  j.at = Date.now();
  const limit = j.msg.timeoutMs || renderTimeoutMs();
  // the time limit covers everything the worker does for this render; past it the worker is stopped and replaced
  s.timer = setTimeout(() => {
    if (s.job !== j) return;
    finish(s); P.stats.timedOut++;
    j.reject(Object.assign(new Error(`The report ran longer than ${Math.round(limit / 100) / 10} s, the server's limit (PW_RENDER_TIMEOUT_MS), and was stopped.`), { status: 504 }));
    retire(s); pump();
  }, limit);
  try { s.w.postMessage(j.msg, j.transfer || []); }
  catch (e) { // a value structured clone refuses (nested too deep): this render's fault, not the worker's
    finish(s);
    j.reject(Object.assign(new Error(`The request could not be passed to a render worker: ${/** @type {Error} */ (e).message}`), { status: 400 }));
  }
}

/** Waiting work ahead of a new job of class cls, in ms of one worker (an estimate from recent render times). */
function waitAhead(cls) {
  let ms = 0;
  for (const j of P.queue) if (j.cls <= cls) ms += j.est;
  for (const s of P.slots) if (s.job) ms += Math.max(0, s.job.est - (Date.now() - s.job.at));
  ms += P.arrivingTotal * (P.hist?.n ? (P.hist.sum / P.hist.n) * 1000 : 200); // ponytail: arrivals at the mean render time (their template is not known yet)
  return ms / Math.max(1, P.slots.length);
}

/** Render on the request thread: PW_RENDER_WORKERS=0, or the worker cannot run here. */
async function runInline(j) {
  try {
    const m = j.msg;
    const { renderTo, loadTemplate } = await import('./renderer.js');
    if (m.kind === 'thumb') { const { drawThumb } = await import('./thumbs.js'); return j.resolve(await drawThumb(m)); }
    if (m.kind === 'pack') { const { packOutput } = await import('./jobs.js'); return j.resolve(await packOutput(m.spec)); }
    const def = m.def ?? (m.how === 'runnable' ? await (await import('./perms.js')).readRunnable(m.opt.principal, m.ref) : await loadTemplate(m.ref, m.opt.principal));
    const t0 = Date.now();
    let r;
    // a stream on this thread: the same port protocol as a worker's (stream-out.js), so the render yields at each write
    const sink = m.port ? portSink(m.port) : null;
    try { r = await renderTo(def, sink ? { ...m.opt, out: sink } : m.opt); } catch (e) { P.stats.failed = (P.stats.failed || 0) + 1; if (sink?.started) sink.fail(e); else sink?.close(); throw e; }
    observe(Date.now() - t0); P.stats.done = (P.stats.done || 0) + 1; // the dashboard's average counts inline renders too
    if (/** @type {any} */ (r).streamed) { sink?.end(); return j.resolve({ streamed: true, contentType: r.contentType, ext: r.ext, name: def.name || null, pages: 0, ms: r.model.stats?.ms ?? null, warnings: r.model.warnings?.length ?? 0 }); }
    sink?.close();
    j.resolve({ bytes: r.bytes, contentType: r.contentType, ext: r.ext, name: def.name || null, pages: r.model.pages.length, ms: r.model.stats?.ms ?? null, warnings: r.model.warnings?.length ?? 0 });
  } catch (e) { j.reject(e); }
}

/** Why an interactive render for this principal would be refused now (429/503 with retryAfter), or null. Counts the
 *  requests that have arrived but not reached the queue yet (P.arriving: reading the body, auth, the template), so a
 *  flood is refused from arrival, not only once it reaches the pool. */
function refusal(who) {
  if (poolSize() < 1 || P.noWorker) return null;
  const mine = (P.waiting.get(who) || 0) + (P.arriving.get(who) || 0);
  const fresh = !mine && !P.running.get(who);
  const queued = P.queue.filter(x => !x.cls).length + P.arrivingTotal;
  const wait = waitAhead(0);
  if (queued >= (fresh ? 2 * queueMax() : queueMax())) return busy('The server is busy rendering other reports. Try again shortly.', 503, wait || 1000);
  if (mine >= perPrincipalMax()) return busy('Too many of your renders are waiting. Wait for them to finish, then try again.', 429, wait || 1000);
  if (!fresh && queued && wait > maxWaitMs()) return busy(`The server is busy: this render would wait about ${Math.round(wait / 1000)} s. Try again shortly.`, 503, wait);
  return null;
}

/** For routes, before they read the request or the template: throws the 429/503 a render would get now. A cheap answer
 *  to a caller who is over the limit (submit checks again). @param {any} principal */
export function admit(principal) { const no = refusal(principalId(principal)); if (no) { P.stats.rejected++; throw no; } }

const credOf = (req) => { const h = req.headers; const c = h.get('authorization') || h.get('x-api-key') || h.get('cookie') || ''; return crypto.createHash('sha256').update(c).digest('base64url').slice(0, 22); };

/**
 * The first line of a render route, before auth or the body: admission from arrival. Counts this request as arriving
 * for its caller (known by the credential it presents, mapped to its principal once it has signed in) and refuses it
 * at once (429/503, retryAfter) when the caller or the server is over the limit. bind(principal) after auth checks again
 * as that principal; submit({ ticket }) moves the count to the queue; release() (in finally) ends it. Unknown
 * credentials only fill their own bucket.
 * @param {Request} req
 */
export function arrive(req) {
  const cred = credOf(req);
  let who = P.credWho.get(cred) ?? `cred:${cred}`;
  const no = refusal(who);
  if (no) { P.stats.rejected++; throw no; }
  let live = true;
  bump(P.arriving, who, 1); P.arrivingTotal++;
  const t = {
    release() { if (!live) return; live = false; bump(P.arriving, who, -1); P.arrivingTotal--; },
    /** @param {any} principal */
    bind(principal) {
      const id = principalId(principal);
      if (P.credWho.size > 10000) P.credWho.clear();
      P.credWho.set(cred, id);
      if (live && id !== who) { bump(P.arriving, who, -1); bump(P.arriving, id, 1); }
      who = id;
      if (!live) return;
      bump(P.arriving, who, -1); // checked as if not yet here (this request is the one asking)
      const no = refusal(who);
      bump(P.arriving, who, 1);
      if (no) { P.stats.rejected++; t.release(); throw no; }
    },
  };
  return t;
}

/**
 * Queue one task for the pool. Rejects at once with 429 or 503 (and .retryAfter, seconds) when the server is full.
 * @param {any} msg { kind: 'render', ref|def, how?, opt } or { kind: 'thumb', def, principal, base }
 * @param {{ background?: boolean, principal?: any, key?: string, signal?: AbortSignal, transfer?: any[], started?: { v: boolean }, ticket?: { release: () => void } }} [o] key: what to
 *   estimate the render time by (the template); signal: the request's, a render still waiting when the caller leaves is
 *   dropped; transfer: what the message moves to the worker (a stream's port)
 */
export function submit(msg, { background = false, principal, key = '', signal, transfer, started, ticket } = {}) {
  ticket?.release(); // from here it is counted in the queue, not as arriving
  const who = principalId(principal);
  const cls = background ? 1 : 0;
  return new Promise((resolve, reject) => {
    const est = P.est.get(key) ?? 200;
    /** @type {Job} */
    const j = { id: ++P.seq, msg: { ...msg, id: 0 }, transfer, started, cls, who, est, ...sizeOf(msg, who, key), at: Date.now(), key, resolve, reject, signal };
    j.msg.id = j.id;
    if (poolSize() < 1 || P.noWorker) return void runInline(j);
    fill();
    const fresh = !P.waiting.get(who) && !P.running.get(who) && !P.arriving.get(who);
    if (!cls) { const no = refusal(who); if (no) { P.stats.rejected++; return reject(no); } }
    j.fresh = fresh; // its wait is one turn of round robin, however long the renders ahead of it are
    if (signal) {
      if (signal.aborted) return reject(Object.assign(new Error('The request was cancelled.'), { status: 499 }));
      j.onAbort = () => { const i = P.queue.indexOf(j); if (i >= 0) { P.queue.splice(i, 1); unwait(j); reject(Object.assign(new Error('The request was cancelled.'), { status: 499 })); } };
      signal.addEventListener('abort', j.onAbort, { once: true });
    }
    bump(P.waiting, who, 1);
    P.queue.push(j);
    pump();
  });
}

/**
 * Render a template in the pool. ref: a saved template ("id", "id@version") or an inline definition, read and checked
 * in the worker as opt.principal (how: 'template' = renderer.loadTemplate, 'runnable' = perms.readRunnable);
 * def: a definition the caller has already read and checked (batches).
 * @returns {Promise<{ bytes: Uint8Array, contentType: string, ext: string, name: string|null, pages: number, ms: number|null, warnings: number }>}
 */
/** @param {{ ref?: any, def?: any, how?: string, opt?: any }} r @param {{ background?: boolean, signal?: AbortSignal, ticket?: { release: () => void } }} [o] */
export function renderInPool({ ref, def, how = 'template', opt = {} }, { background = false, signal, ticket } = {}) {
  const key = typeof ref === 'string' ? ref : def?.name ? `def:${def.name}` : 'inline';
  return submit({ kind: 'render', ref, def, how, opt }, { background, principal: opt.principal, key, signal, ticket });
}

/**
 * renderInPool for a format that can stream (the data CSV): the result is the usual one (bytes), or, when the report
 * streams, { stream: ReadableStream, contentType, ext, name, pages: 0, done } where done settles when the render ends.
 * The response starts with the first rows; memory stays flat however many rows (docs/research/STREAMING-1M.md).
 * @param {{ ref?: any, def?: any, how?: string, opt?: any }} r @param {{ background?: boolean, signal?: AbortSignal, ticket?: { release: () => void } }} [o]
 * @returns {Promise<any>}
 */
export function streamInPool({ ref, def, how = 'template', opt = {} }, { background = false, signal, ticket } = {}) {
  const key = typeof ref === 'string' ? ref : def?.name ? `def:${def.name}` : 'inline';
  const { port1, port2 } = new MessageChannel();
  const src = portSource(port1, { csv: opt.format === 'csv', format: opt.format || null, report: typeof ref === 'string' ? ref : 'inline' });
  const started = { v: false }; // once the head is out, a failed render cannot run again
  const done = submit({ kind: 'render', ref, def, how, opt, stream: true, port: port2 }, { background, principal: opt.principal, key, signal, transfer: [port2], started, ticket });
  let streaming = false;
  // the head (port) and the end (the worker's reply) come on different channels, in either order
  return new Promise((resolve, reject) => {
    src.head.then((h) => { if (h) { streaming = true; started.v = true; resolve({ ...h, stream: src.stream, name: def?.name || null, pages: 0, ms: null, warnings: 0, streamed: true, done: done.catch(() => null) }); } });
    done.then((r) => { if (r?.streamed) return; if (streaming) src.fail(new Error('The render stopped and ran again without streaming.')); else { src.abandon(); resolve(r); } }, (e) => { if (streaming) src.fail(e); else { src.abandon(); reject(e); } });
  });
}

/** Queue depth and worker state, for /api/v1/health. */
export function poolStats() {
  const q = (c) => P.queue.filter(j => j.cls === c).length;
  return {
    memory: { ...plan(), rssMB: Math.round(process.memoryUsage.rss() / 1048576) },
    workers: { size: poolSize(), alive: P.slots.length, ready: P.slots.filter(s => s.ready).length, busy: P.slots.filter(s => s.job).length, inline: P.noWorker },
    queue: { interactive: q(0), background: q(1), max: queueMax(), perPrincipalMax: perPrincipalMax(), estimatedWaitMs: Math.round(waitAhead(1)) },
    principals: { running: P.running.size, waiting: P.waiting.size, arriving: P.arriving.size },
    arriving: P.arrivingTotal,
    totals: { ...P.stats },
    durations: { buckets: BUCKETS, counts: [...(P.hist?.counts || [])], sum: P.hist?.sum || 0, count: P.hist?.n || 0 },
  };
}

/** Stop every worker (tests). */
export async function stopPool() {
  // the dying first, before any await: a dying worker's exit refills the pool, which would outlive this stop
  const dying = [...P.dying];
  for (const w of dying) w.removeAllListeners('exit');
  for (const s of P.slots.splice(0)) { s.w.removeAllListeners(); s.w.on('error', () => {}); clearTimeout(s.timer); if (s.job) s.job.reject(new Error('The render pool stopped.')); await s.w.terminate(); }
  for (const j of P.queue.splice(0)) { unwait(j); j.reject(new Error('The render pool stopped.')); }
  for (const w of dying) await w.terminate();
  P.dying.clear(); P.dyingBig.clear(); P.running.clear(); P.noWorker = null; P.startFails = 0;
}
