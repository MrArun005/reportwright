// @ts-check
// Report thumbnails (page 1 as SVG, default parameters), rendered off the request and off the event loop: in one
// worker thread (thumb-worker.mjs), one at a time, under the render time limit (the engine's budget, and the worker is
// terminated a little after it). A request that finds no thumbnail for this exact version gets a placeholder (202) and
// queues one render; saves in quick succession replace the queued render, so only the newest version is drawn.
//
// The cache is per report and per viewer (a subreport may show for one user and not another), keyed by a hash of the
// definition and by the permissions now (perms.accessStamp: every folder and report grant
// and the viewer's record, each with a rev that every change renews), so a revoke is never answered from an older
// drawing, and a drawing is not kept when any of that changed while it was queued or drawn. It is drawn as the viewer
// who asked (never as the server). The route checks view access on every request before it looks here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, SHARE_ENV } from 'node:worker_threads';
import { renderTo, renderTimeoutMs } from './renderer.js';
import { pageToSvg, fontFaceCss, fontKeysOf } from '../exporters/svg.js';
import { ALL_FONT_KEYS } from '../engine/text/fonts.js';
import { principalId, accessStamp } from './perms.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const g = /** @type {any} */ (globalThis).__pwThumbJobs ||= { cache: new Map(), queue: new Map(), running: null, busy: null, worker: null, noWorker: false, seq: 0 };

/** Page 1 of a definition as SVG, with the fonts it needs beyond the defaults. Runs in the worker (or here as a fallback). */
export async function drawThumb({ def, principal, base }) {
  try {
    const r = await renderTo(def, { format: 'json', baseUrl: base, principal });
    const pg = r.model.pages[0];
    // the home page declares the default fonts; a thumbnail declares the others it uses (fallbacks, uploads)
    const extra = pg ? fontKeysOf({ pages: [pg] }).filter(k => !ALL_FONT_KEYS.includes(k)) : [];
    const svg = pg ? pageToSvg(pg, r.model.width, r.model.height) : '';
    return { svg: extra.length ? svg.replace(/^(<svg[^>]*>)/, `$1<style>${fontFaceCss(extra)}</style>`) : svg, pages: r.model.pages.length };
  } catch (e) {
    const err = /** @type {any} */ (e);
    return { error: String(err.message), status: err.status || (err.missingParameters ? 422 : 500) };
  }
}

/**
 * The thumbnail of this version for this viewer: { svg, pages }, { error, status }, or { pending: true } (one render
 * is queued). The caller has checked that the viewer may view the report.
 * @param {string} id @param {any} def @param {import('./perms.js').Principal} principal @param {string} base
 */
export async function thumbnail(id, def, principal, base) {
  const json = JSON.stringify(def);
  // always: a report can draw others (subreports, a master, part libraries, stylesheets, themes, by expression too)
  const stamp = await accessStamp(principal);
  const hash = sha(`${json}\0${stamp}`);
  const slot = `${id}|${principalId(principal)}`;
  const hit = g.cache.get(slot);
  if (hit?.hash === hash) return hit;
  if (!(g.running?.slot === slot && g.running.hash === hash)) {
    g.queue.delete(slot); // a newer save replaces the render still waiting (and goes to the back)
    g.queue.set(slot, { slot, hash, stamp, def, principal, base });
    pump();
  }
  return { pending: true };
}

/** Resolves when no thumbnail is queued or rendering (tests). */
export async function thumbsIdle() { while (g.busy) await g.busy; }

function pump() {
  if (g.busy || !g.queue.size) return;
  const [slot, job] = g.queue.entries().next().value;
  g.queue.delete(slot);
  g.running = job;
  g.busy = run(job).then(async (r) => {
    // the drawing is kept only if no permission changed while it was queued or drawn (revs: an undo counts too)
    if (job.stamp && (await accessStamp(job.principal).catch(() => null)) !== job.stamp) return;
    if (r.transient) return;
    if (g.cache.size > 2000) g.cache.clear();
    g.cache.set(slot, { hash: job.hash, ...r });
  }).finally(() => { g.running = null; g.busy = null; pump(); });
}

/** The worker script: next to this file in the sources (dev, `next start`, tests), else under the working directory. */
function workerFile() {
  // Paths the bundler cannot work out (Turbopack follows process.cwd() and import.meta.url joins, then traces and tries
  // to bundle the whole repository): the worker is plain Node, run from the sources.
  const proc = globalThis['process'], meta = import.meta;
  const list = [];
  try { list.push(path.join(path.dirname(fileURLToPath(meta['url'])), 'thumb-worker.mjs')); } catch { /* not a file URL */ }
  list.push([proc['cwd'](), 'src', 'server', 'thumb-worker.mjs'].join(path.sep));
  return list.find(f => fs.existsSync(f)) || null;
}

function worker() {
  if (g.worker || g.noWorker) return g.worker;
  const file = workerFile();
  if (!file) { g.noWorker = true; console.warn('[pagewright] thumbnails render on the main thread: src/server/thumb-worker.mjs is not here'); return null; }
  // eval: the bundler sees a string, not a module to trace; the bootstrap imports the worker from the sources
  const w = new Worker('import(require("node:url").pathToFileURL(require("node:worker_threads").workerData.file).href)', { eval: true, env: SHARE_ENV, workerData: { file } });
  w.unref();
  w.on('error', (e) => { console.warn(`[pagewright] thumbnail worker: ${e.message}`); if (g.worker === w) g.worker = null; });
  w.on('exit', () => { if (g.worker === w) g.worker = null; });
  g.worker = w;
  return w;
}

/** One render in the worker, with a hard stop a little after the render time limit. */
function run(job) {
  const w = worker();
  if (!w) return drawThumb(job);
  const n = ++g.seq;
  return new Promise((resolve) => {
    const detach = () => { clearTimeout(kill); w.off('message', onMsg); w.off('error', onErr); w.off('exit', onExit); };
    const done = (r) => { detach(); resolve(r); };
    const onMsg = (m) => {
      if (m?.ready === false) { // the worker cannot load the server code here: draw on this thread from now on
        detach(); g.noWorker = true; g.worker = null; w.terminate();
        console.warn(`[pagewright] thumbnails render on the main thread: ${m.error}`);
        drawThumb(job).then(resolve);
      } else if (m?.n === n) done(m.result);
    };
    // a dead worker says nothing about the report: not cached (transient), the next request draws it again
    const onErr = (e) => done({ error: `The thumbnail could not be drawn: ${e.message}`, status: 500, transient: true });
    const onExit = () => done({ error: 'The thumbnail could not be drawn.', status: 500, transient: true });
    const kill = setTimeout(() => { g.worker = null; w.terminate(); done({ error: `The report took longer than ${Math.round(renderTimeoutMs() / 1000)} s to draw.`, status: 504 }); }, renderTimeoutMs() + 10000);
    w.on('message', onMsg); w.on('error', onErr); w.on('exit', onExit);
    w.postMessage({ n, def: job.def, principal: job.principal, base: job.base });
  });
}
