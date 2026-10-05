// @ts-check
// Report thumbnails (page 1 as SVG, default parameters), rendered off the request and off the event loop: in the
// render pool (pool.js, background class), one at a time, under the render time limit (the worker is terminated
// then). A request that finds no thumbnail for this exact version gets a placeholder (202) and queues one render;
// saves in quick succession replace the queued render, so only the newest version is drawn.
//
// The cache is per report and per access class (perms.accessClass: viewers with the same role, groups and no grant of
// their own), but only for a definition whose drawing cannot differ per viewer (principalIndependent, checked again at
// render time over every report it loaded); otherwise per viewer. Keyed by a hash of the definition and that stamp, so a revoke is never answered from an older drawing, and a drawing is not kept when the stamp changed while
// it was queued or drawn. It is drawn as a viewer of that class (never as the server). Up to half the render workers
// draw thumbnails at once. The route checks view access on every request before it looks here.
import crypto from 'node:crypto';
import { publicError } from './errors.js';
import { renderTo, renderTimeoutMs } from './renderer.js';
import { submit, poolSize } from './pool.js';
import { pageToSvg, fontFaceCss, fontKeysOf } from '../exporters/svg.js';
import { ALL_FONT_KEYS } from '../engine/text/fonts.js';
import { accessClass, accessStamp, principalId } from './perms.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const g = /** @type {any} */ (globalThis).__pwThumbJobs ||= { cache: new Map(), queue: new Map(), running: new Map(), seq: 0 };
if (!(g.running instanceof Map)) Object.assign(g, { running: new Map(), busy: undefined }); // a store from before (hot reload)
g.dependent ||= new Set(); // definition hashes whose drawing turned out viewer-dependent
const concurrency = () => Math.max(1, Math.floor(poolSize() / 2));

// A report whose drawing could differ per viewer beyond what access decides: anything naming the user (no expression
// reads it today, so this is for whatever comes later), a data source with its own headers or credentials, or a
// source type this list does not know. Conservative by design: a false "dependent" only costs a per-viewer drawing.
const USERISH = /\b(user(id|name|email)?|current_?user|principal|whoami)\b|@user\b|globals!user/i;
const PLAIN_TYPES = new Set(['json', 'sql', 'rest', 'csv', 'xml', 'graphql', 'soap', 'odata']);
/** True when nothing in the definition can make its drawing differ between viewers of the same access. @param {any} def */
export function principalIndependent(def) {
  if (!def || typeof def !== 'object') return false;
  if (USERISH.test(JSON.stringify(def))) return false;
  for (const s of Array.isArray(def.dataSources) ? def.dataSources : []) {
    if (!s || typeof s !== 'object' || !PLAIN_TYPES.has(s.type)) return false;
    if ((s.headers && Object.keys(s.headers).length) || s.credentials || s.auth || s.authorization || s.cookie || s.withCredentials) return false;
  }
  return true;
}

/** Page 1 of a definition as SVG, with the fonts it needs beyond the defaults. Runs in the worker (or here as a fallback).
 *  independent: this definition and every report the render loaded passed principalIndependent. */
export async function drawThumb({ def, principal, base }) {
  let independent = principalIndependent(def);
  try {
    // page 1 only: no full render, no JSON of the whole model (a 100k-row report drew everything to show one page)
    const r = await renderTo(def, { format: 'json', modelOnly: true, firstPages: 1, baseUrl: base, principal, onLoadReport: (_id, sub) => { if (!principalIndependent(sub)) independent = false; } });
    const pg = r.model.pages[0];
    // the home page declares the default fonts; a thumbnail declares the others it uses (fallbacks, uploads)
    const extra = pg ? fontKeysOf({ pages: [pg] }).filter(k => !ALL_FONT_KEYS.includes(k)) : [];
    const svg = pg ? pageToSvg(pg, r.model.width, r.model.height) : '';
    return { svg: extra.length ? svg.replace(/^(<svg[^>]*>)/, `$1<style>${fontFaceCss(extra)}</style>`) : svg, pages: r.model.partial ? 0 : r.model.pages.length, independent }; // cut short: the count is not known (0: not shown)
  } catch (e) {
    const err = /** @type {any} */ (e);
    const status = err.status || (err.missingParameters ? 422 : 500);
    return { error: publicError(err, status).message, status, independent }; // what it loaded before failing was checked
  }
}

/**
 * The thumbnail of this version for this viewer: { svg, pages }, { error, status }, or { pending: true } (one render
 * is queued). The caller has checked that the viewer may view the report.
 * @param {string} id @param {any} def @param {import('./perms.js').Principal} principal @param {string} base
 */
export async function thumbnail(id, def, principal, base) {
  const json = JSON.stringify(def);
  const defHash = sha(json); // the definition with its parameter defaults and data source settings
  // shared by viewers of one access class only when drawings of this definition proved principal-independent (the
  // check runs at render time, over the subreports it loaded too); until then, and when not, one per viewer
  const shared = !g.dependent.has(defHash) && principalIndependent(def);
  const stamp = shared ? await accessClass(principal) : `u:${principalId(principal)}:${await accessStamp(principal)}`;
  const hash = sha(`${json}\0${stamp}`);
  const slot = `${id}|${stamp}`;
  const hit = g.cache.get(slot);
  if (hit?.hash === hash) return hit;
  if (g.running.get(slot)?.hash !== hash) {
    g.queue.delete(slot); // a newer save replaces the render still waiting (and goes to the back)
    g.queue.set(slot, { slot, hash, defHash, stamp, shared, def, principal, base });
    pump();
  }
  return { pending: true };
}

/** Resolves when no thumbnail is queued or rendering (tests). */
export async function thumbsIdle() {
  for (;;) { if (!g.running.size) pump(); if (!g.running.size) return; await Promise.race([...g.running.values()].map(j => j.done)); }
}

function pump() {
  while (g.running.size < concurrency()) {
    // one drawing per slot at a time: a newer save of a slot being drawn waits for it (and replaces older waiting ones)
    const e = [...g.queue.entries()].find(([k]) => !g.running.has(k));
    if (!e) return;
    const [slot, job] = e;
    g.queue.delete(slot);
    g.running.set(slot, job);
    job.done = run(job).then(async (r) => {
      // the drawing is kept only if no permission changed while it was queued or drawn (revs: an undo counts too)
      const now = job.shared ? await accessClass(job.principal).catch(() => null) : `u:${principalId(job.principal)}:${await accessStamp(job.principal).catch(() => null)}`;
      if (now !== job.stamp) return;
      if (r.transient) return;
      // drawn for a class but it loaded something viewer-dependent: kept for nobody; this definition is per viewer now
      // undefined: a time limit or a crash cut it short (the static check stands)
      if (job.shared && r.independent === false) { g.dependent.add(job.defHash); if (g.dependent.size > 10000) g.dependent.clear(); return; }
      if (g.cache.size > 2000) g.cache.delete(g.cache.keys().next().value); // the oldest goes
      g.cache.set(slot, { hash: job.hash, ...r });
    }).finally(() => { g.running.delete(slot); pump(); });
  }
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
