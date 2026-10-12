// @ts-check
// A paint worker of a streaming PDF (pdfstream.js, opts.parallel): it lays out the windows of rows it is sent
// (engine/paged.js jobs) and paints their pages with the same painter and names as the writer, then sends back each
// page's compressed content stream and what it used (fonts, glyphs, opacities). A job sent while the pages are still
// being counted (defer) is laid out and held, its bands that read Globals laid out again once the count comes
// ({ total }). Jobs run one at a time, in the order they came. Node only.
import { __streamPaint } from './streampaint.js';

const { render, FontStore, createPdfStream, paintPage, paintEnv, latin1, reband, CAPPED } = __streamPaint;

const proc = /** @type {any} */ (globalThis).process;
const { parentPort, workerData } = proc.getBuiltinModule('node:worker_threads');
const zlib = proc.getBuiltinModule('node:zlib');
const bytes = new Map(workerData.fonts);
/** fonts asked of the writer (one a later row needed, not loaded when the worker started): key → its answer */
const asked = new Map();
const fontStore = new FontStore(async (k) => {
  let b = bytes.get(k);
  if (!b) {
    b = await new Promise((ok) => { asked.set(k, ok); parentPort.postMessage({ font: k }); });
    if (!b) throw new Error(`The font "${k}" was not sent to the paint worker`);
    bytes.set(k, b);
  }
  return b;
});

/** @type {{ job: any, m: any }[]} deferred jobs, laid out, waiting for the page count */
const held = [];
const fail = (/** @type {any} */ job, /** @type {any} */ e) => parentPort.postMessage({ id: job.id, error: { message: String(e?.message || e), status: e?.status, timeout: e?.timeout } });

/** a job's kept pages painted and compressed, sent back @param {any} job @param {any} m @param {number} [total] the count, for a held job */
async function finish(job, m, total) {
  if (total !== undefined) {
    const o = { ...job.opts, fontStore };
    // capped bands: as the held serial pass does, the window is laid out again with the count
    if (m.warnings.some((/** @type {string} */ w) => w.startsWith(CAPPED))) m = await render(job.def, { ...o, sources: { __rows: { rows: job.rows } }, pageWindow: { ...job.pageWindow, total } });
    else for (const w of await reband(m.pages.slice(0, job.keep), total, job.rebandDef, job.pageWindow.first, o)) m.warnings.push(w);
  }
  // a writer of its own for the names and glyphs (nothing is written): the pages' links name pages by placeholder
  const rec = createPdfStream({ write() {} }, { fontStore });
  const env = paintEnv(rec, fontStore, { drillBase: job.drillBase, pageRef: (i) => `@@P${i}@@`, embedAll: job.embedAll });
  const pages = [], transfer = [];
  for (let k = 0; k < Math.min(job.keep, m.pages.length); k++) {
    const pg = m.pages[k];
    const { content, annots } = paintPage(pg, pg.height ?? job.height, env);
    const z = new Uint8Array(zlib.deflateSync(latin1(content), { level: 9 })); // as pdfpaint.js's deflate
    transfer.push(z.buffer);
    pages.push({ deflated: z, annots, width: pg.width, height: pg.height, firstRow: pg.firstRow, rowHead: pg.rowHead, headLevel: pg.headLevel });
  }
  parentPort.postMessage({ id: job.id, count: m.pages.length, nextFirst: m.pages[job.keep]?.firstRow, pages, used: rec.used(),
    shaped: [...env.shaped].map(([k, g]) => [k, [...g]]), embedded: [...env.embedded || []], bookmarks: m.bookmarks, headings: m.headings, warnings: m.warnings }, transfer);
}

/** @param {any} job */
async function handle(job) {
  if (job.total !== undefined) { // the page count: the held jobs, in order
    for (const h of held.splice(0)) await finish(h.job, h.m, job.total).catch((e) => fail(h.job, e));
    return;
  }
  try {
    const m = await render(job.def, { ...job.opts, fontStore, sources: { __rows: { rows: job.rows } }, pageWindow: job.defer ? { ...job.pageWindow, hold: true } : job.pageWindow });
    if (job.defer) held.push({ job, m }); else await finish(job, m);
  } catch (e) { fail(job, e); }
}

let chain = Promise.resolve();
parentPort.on('message', (/** @type {any} */ msg) => {
  if (msg.font !== undefined) { asked.get(msg.font)?.(msg.bytes); asked.delete(msg.font); return; } // not queued: a job waits for it
  chain = chain.then(() => handle(msg));
});
