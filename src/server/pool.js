// @ts-check
// The render pool: every server render and export (API v1, report links, batches, schedules, thumbnails) runs in a
// worker thread (render-worker.mjs), never on the request thread. The request thread parses, authorises, queues and
// sends the bytes back. Settings:
//   PW_RENDER_WORKERS              threads (default: min(cores - 1, 8, what memory allows: see memoryPlan); 0 = render
//                                  on the request thread, as before)
//   PW_RENDER_QUEUE                interactive renders that may wait (default 1000); more: 503 + Retry-After
//   PW_RENDER_QUEUE_PER_PRINCIPAL  of those, per user or key (default 8 per worker, at least 16); more: 429 + Retry-After
//   PW_RENDER_MAX_WAIT_MS          refuse (503) a render whose estimated wait is longer (default 30 s); a render that
//                                  waited longer anyway is dropped with a 503 when its turn comes
//   PW_RENDER_WORKER_MAX_RENDERS   recycle a worker after this many renders (default 500)
//   PW_RENDER_WORKER_RECYCLE_MB    recycle a worker whose heap is above this after a render (default 512)
//   PW_RENDER_WORKER_HEAP_MB       a worker's hard heap limit: past it the worker dies, its render fails (default 2048,
//                                  less when memory is short: at most half the memory limit)
//   PW_MEMORY_LIMIT_MB             the memory this server may use (default: the container's cgroup limit, else the
//                                  machine's RAM). Cores likewise come from the cgroup CPU quota when there is one,
//   PW_CPUS                        or from this (scripts/cluster.mjs gives each process its share of both).
// Memory: workers are sized so that all their heaps fit in 70% of the limit beside the request thread (512 MB), so
// several big renders at once end in a worker's own out-of-memory error (that render fails) instead of the kernel
// killing the whole server. Admission: while the process's resident memory is above 85% of the limit, no further
// render starts (they wait their turn) unless none is running.
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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, SHARE_ENV } from 'node:worker_threads';
import { renderTimeoutMs } from './renderer.js';
import { principalId } from './perms.js';
import { accountsOn, sessionSecret } from './session.js';
import { devMode } from './config.js';

const num = (k, d, min = 0) => { const n = Number(process.env[k]); return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(n) && n >= min ? n : d; };

/** A cgroup file's text (v2 under /sys/fs/cgroup, v1 under its controller folders), or null. PW_CGROUP_DIR: tests. */
function cgroup(...names) {
  const dir = process.env.PW_CGROUP_DIR || '/sys/fs/cgroup';
  for (const n of names) { try { return fs.readFileSync(path.join(dir, n), 'utf8').trim(); } catch { /* not there */ } }
  return null;
}
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
/**
 * Worker count and heap for a machine: { cores, memMB, heapMB, workers }. Pure (tests pass their own numbers).
 * @param {{ cores: number, memMB: number, heapMB?: number|null, workers?: number|null }} m
 */
export function memoryPlan({ cores, memMB, heapMB: heap = null, workers = null }) {
  const h = Math.floor(heap ?? Math.max(256, Math.min(2048, memMB / 2)));
  const byMem = Math.floor((memMB * 0.7 - RESERVE_MB) / (h + WORKER_EXTRA_MB));
  const w = workers ?? Math.max(1, Math.min(8, cores - 1, byMem));
  return { cores, memMB: Math.round(memMB), heapMB: h, workers: Math.floor(w) };
}
// PW_MEMORY_LIMIT_MB narrows the machine's or container's memory, never widens it; the SQLite query processes' own
// budget (sql/sqlite.js, outside these threads) comes off the top
const memLimitMB = () => {
  const box = Math.min(os.totalmem(), cgroupMemory() ?? Infinity) / 1048576;
  const sqlite = num('PW_SQLITE_PROCESSES', 2, 0) * num('PW_SQLITE_MEMORY_MB', 1024, 64);
  return Math.max(64, Math.min(num('PW_MEMORY_LIMIT_MB', Infinity, 64), box - Math.min(sqlite, box / 4)));
};
const plan = () => memoryPlan({
  cores: num('PW_CPUS', Math.min(os.availableParallelism?.() || os.cpus().length, cgroupCpus() ?? Infinity), 1),
  memMB: memLimitMB(),
  heapMB: num('PW_RENDER_WORKER_HEAP_MB', null, 64),
  workers: num('PW_RENDER_WORKERS', null),
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

/** @typedef {{ id: number, fresh?: boolean, msg: any, transfer?: any[], cls: 0|1, who: string, est: number, at: number, key: string, resolve: (v: any) => void, reject: (e: any) => void, signal?: AbortSignal, onAbort?: () => void }} Job */
/** @typedef {{ w: Worker, ready: boolean, job: Job|null, renders: number, timer: any }} Slot */

const g = /** @type {any} */ (globalThis);
/** @type {{ startFails: number, dying: Set<Worker>, slots: Slot[], queue: Job[], running: Map<string, number>, waiting: Map<string, number>, served: Map<string, number>, est: Map<string, number>, seq: number, noWorker: string|null, stats: Record<string, number> }} */
const P = g.__pwRenderPool ||= { startFails: 0, dying: new Set(), slots: [], queue: [], running: new Map(), waiting: new Map(), served: new Map(), est: new Map(), seq: 0, noWorker: null,
  stats: { done: 0, failed: 0, rejected: 0, timedOut: 0, crashed: 0, recycled: 0, dropped: 0, heldForMemory: 0, restarts: 0 } };
P.stats.heldForMemory ??= 0; P.stats.restarts ??= 0;

// render durations (seconds) for /api/v1/metrics: a Prometheus histogram
export const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
P.hist ||= { counts: BUCKETS.map(() => 0), sum: 0, n: 0 };
const observe = (ms) => { const sec = ms / 1000; P.hist.n++; P.hist.sum += sec; BUCKETS.forEach((b, i) => { if (sec <= b) P.hist.counts[i]++; }); };

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
export function warmPool() { fill(); }

function fill() {
  if (P.noWorker || poolSize() < 1) return;
  // a terminated worker counts until it has exited: one stuck in a native call (a synchronous SQLite query) cannot be
  // terminated, and refilling beside it would pile up threads
  while (P.slots.length + P.dying.size < poolSize()) if (!spawn()) return;
}

function spawn() {
  const file = workerFile();
  if (!file) { giveUp('src/server/render-worker.mjs is not here'); return false; }
  // eval: the bundler sees a string, not a module to trace; the bootstrap imports the worker from its file
  const w = new Worker('import(require("node:url").pathToFileURL(require("node:worker_threads").workerData.file).href)',
    // devSecret: without PW_SESSION_SECRET (development only) each thread would make its own, and the server's calls to
    // itself from a worker would carry a cookie the request thread cannot check
    { eval: true, env: SHARE_ENV, workerData: { file, devSecret: accountsOn() && !process.env.PW_SESSION_SECRET && devMode() ? sessionSecret() : undefined }, resourceLimits: { maxOldGenerationSizeMb: heapMB() } });
  w.unref();
  /** @type {Slot} */
  const s = { w, ready: false, job: null, renders: 0, timer: null };
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
  console.warn(`[pagewright] renders run on the request thread: ${why}`);
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
  s.w.once('exit', () => { P.dying.delete(s.w); P.stats.restarts++; fill(); pump(); });
  s.w.terminate();
}

function died(s, e, exited = false) {
  if (!P.slots.includes(s)) return;
  const j = s.job;
  const why = e ? String(e.message || e) : 'it exited';
  // the detail goes to the log only: it may come from another render's leftovers (an SQL error, a URL)
  if (e) console.warn(`[pagewright] a render worker stopped: ${why}`);
  if (j) { finish(s); P.stats.crashed++; j.reject(Object.assign(new Error(e?.code === 'ERR_WORKER_OUT_OF_MEMORY' || /heap|memory/i.test(why) ? 'The render ran out of memory and was stopped.' : 'The render stopped unexpectedly. Try again.'), { status: 500 })); }
  if (!s.ready && ++P.startFails >= 3) { // it keeps dying while starting: no crash loop, render on this thread
    const i = P.slots.indexOf(s); if (i >= 0) P.slots.splice(i, 1);
    giveUp(why);
    return;
  }
  retire(s, exited);
  pump();
}

/** The next job for a free worker: interactive first; then the principal with the fewest running, then the one served
 *  longest ago (round robin); then the oldest. */
function next() {
  let best = -1;
  const run = (j) => P.running.get(j.who) || 0, last = (j) => P.served.get(j.who) || 0;
  for (let i = 0; i < P.queue.length; i++) {
    const j = P.queue[i], b = P.queue[best];
    if (!b || j.cls < b.cls || (j.cls === b.cls && (run(j) < run(b) || (run(j) === run(b) && last(j) < last(b))))) best = i;
  }
  return best < 0 ? null : P.queue.splice(best, 1)[0];
}

function unwait(j) { bump(P.waiting, j.who, -1); if (j.signal && j.onAbort) j.signal.removeEventListener('abort', j.onAbort); }

function pump() {
  for (const s of P.slots) {
    // memory first: past 85% of the limit a new render waits for a running one to end (never all of them: one runs)
    if (s.ready && !s.job && P.queue.length && P.slots.some(x => x.job) && memoryFull()) {
      P.stats.heldForMemory++;
      // resident memory rarely shrinks by itself: an idle worker that has rendered gives its heap back by exiting
      // (a fresh one takes its place), at most every 10 s, so the hold cannot outlast the memory it is about
      if (s.renders > 0 && Date.now() - (P.lastFree || 0) > 10000) { P.lastFree = Date.now(); P.stats.recycled++; retire(s); }
      return;
    }
    while (s.ready && !s.job && P.queue.length) dispatch(s);
  }
}

/** Give the next job to this free worker. */
function dispatch(s) {
  let j;
  while ((j = next())) {
    unwait(j);
    // waited past the limit (the estimate was wrong): the caller has given up by now, or is about to
    if (j.cls === 0 && !j.fresh && Date.now() - j.at > maxWaitMs()) { P.stats.dropped++; j.reject(busy('The server is busy: this render waited too long for its turn. Try again shortly.', 503, 5000)); continue; }
    break;
  }
  if (!j) return;
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
    const r = await renderTo(def, m.opt);
    j.resolve({ bytes: r.bytes, contentType: r.contentType, ext: r.ext, name: def.name || null, pages: r.model.pages.length, ms: r.model.stats?.ms ?? null, warnings: r.model.warnings?.length ?? 0 });
  } catch (e) { j.reject(e); }
}

/** Why an interactive render for this principal would be refused now (429/503 with retryAfter), or null. */
function refusal(who) {
  if (poolSize() < 1 || P.noWorker) return null;
  const fresh = !P.waiting.get(who) && !P.running.get(who);
  const queued = P.queue.filter(x => !x.cls).length;
  if (queued >= (fresh ? 2 * queueMax() : queueMax())) return busy('The server is busy rendering other reports. Try again shortly.', 503, waitAhead(0) || 1000);
  if ((P.waiting.get(who) || 0) >= perPrincipalMax()) return busy('Too many of your renders are waiting. Wait for them to finish, then try again.', 429, waitAhead(0) || 1000);
  const wait = waitAhead(0);
  if (!fresh && queued && wait > maxWaitMs()) return busy(`The server is busy: this render would wait about ${Math.round(wait / 1000)} s. Try again shortly.`, 503, wait);
  return null;
}

/** For routes, before they read the request or the template: throws the 429/503 a render would get now. A cheap answer
 *  to a caller who is over the limit (submit checks again). @param {any} principal */
export function admit(principal) { const no = refusal(principalId(principal)); if (no) { P.stats.rejected++; throw no; } }

/**
 * Queue one task for the pool. Rejects at once with 429 or 503 (and .retryAfter, seconds) when the server is full.
 * @param {any} msg { kind: 'render', ref|def, how?, opt } or { kind: 'thumb', def, principal, base }
 * @param {{ background?: boolean, principal?: any, key?: string, signal?: AbortSignal }} [o] key: what to estimate
 *   the render time by (the template); signal: the request's, a render still waiting when the caller leaves is dropped
 */
export function submit(msg, { background = false, principal, key = '', signal } = {}) {
  const who = principalId(principal);
  const cls = background ? 1 : 0;
  return new Promise((resolve, reject) => {
    const est = P.est.get(key) ?? 200;
    /** @type {Job} */
    const j = { id: ++P.seq, msg: { ...msg, id: 0 }, cls, who, est, at: Date.now(), key, resolve, reject, signal };
    j.msg.id = j.id;
    if (poolSize() < 1 || P.noWorker) return void runInline(j);
    fill();
    const fresh = !P.waiting.get(who) && !P.running.get(who);
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
export function renderInPool({ ref, def, how = 'template', opt = {} }, { background = false, signal } = {}) {
  const key = typeof ref === 'string' ? ref : def?.name ? `def:${def.name}` : 'inline';
  return submit({ kind: 'render', ref, def, how, opt }, { background, principal: opt.principal, key, signal });
}

/** Queue depth and worker state, for /api/v1/health. */
export function poolStats() {
  const q = (c) => P.queue.filter(j => j.cls === c).length;
  return {
    memory: { ...plan(), rssMB: Math.round(process.memoryUsage.rss() / 1048576) },
    workers: { size: poolSize(), alive: P.slots.length, ready: P.slots.filter(s => s.ready).length, busy: P.slots.filter(s => s.job).length, inline: P.noWorker },
    queue: { interactive: q(0), background: q(1), max: queueMax(), perPrincipalMax: perPrincipalMax(), estimatedWaitMs: Math.round(waitAhead(1)) },
    principals: { running: P.running.size, waiting: P.waiting.size },
    totals: { ...P.stats },
    durations: { buckets: BUCKETS, counts: [...P.hist.counts], sum: P.hist.sum, count: P.hist.n },
  };
}

/** Stop every worker (tests). */
export async function stopPool() {
  for (const s of P.slots.splice(0)) { s.w.removeAllListeners(); s.w.on('error', () => {}); clearTimeout(s.timer); if (s.job) s.job.reject(new Error('The render pool stopped.')); await s.w.terminate(); }
  for (const j of P.queue.splice(0)) { unwait(j); j.reject(new Error('The render pool stopped.')); }
  for (const w of P.dying) { w.removeAllListeners('exit'); await w.terminate(); }
  P.dying.clear(); P.running.clear(); P.noWorker = null; P.startFails = 0;
}
