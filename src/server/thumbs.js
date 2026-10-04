// @ts-check
// Report thumbnails (page 1 as SVG, default parameters), rendered off the request and off the event loop: in the
// render pool (pool.js, background class), one at a time, under the render time limit (the worker is terminated
// then). A request that finds no thumbnail for this exact version gets a placeholder (202) and queues one render;
// saves in quick succession replace the queued render, so only the newest version is drawn.
//
// The cache is per report and per viewer (a subreport may show for one user and not another), keyed by a hash of the
// definition and by the permissions now (perms.accessStamp: every folder and report grant
// and the viewer's record, each with a rev that every change renews), so a revoke is never answered from an older
// drawing, and a drawing is not kept when any of that changed while it was queued or drawn. It is drawn as the viewer
// who asked (never as the server). The route checks view access on every request before it looks here.
import crypto from 'node:crypto';
import { renderTo, renderTimeoutMs } from './renderer.js';
import { submit } from './pool.js';
import { pageToSvg, fontFaceCss, fontKeysOf } from '../exporters/svg.js';
import { ALL_FONT_KEYS } from '../engine/text/fonts.js';
import { principalId, accessStamp } from './perms.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const g = /** @type {any} */ (globalThis).__pwThumbJobs ||= { cache: new Map(), queue: new Map(), running: null, busy: null, seq: 0 };

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

/** One render in the render pool (background class, under the render time limit). */
async function run(job) {
  g.seq++;
  try { return await submit({ kind: 'thumb', def: job.def, principal: job.principal, base: job.base }, { background: true, principal: job.principal, key: `thumb:${job.slot}` }); }
  catch (e) {
    const err = /** @type {any} */ (e);
    // a dead worker says nothing about the report: not cached (transient), the next request draws it again
    if (err.status === 504) return { error: `The report took longer than ${Math.round(renderTimeoutMs() / 1000)} s to draw.`, status: 504 };
    return { error: `The thumbnail could not be drawn: ${err.message}`, status: 500, transient: true };
  }
}
