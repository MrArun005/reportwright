// @ts-check
// A paint worker of a streaming PDF (pdfstream.js, opts.parallel): it lays out the windows of rows it is sent
// (engine/paged.js jobs, with the pages already counted) and paints their pages with the same painter and names as the
// writer, then sends back each page's compressed content stream and what it used (fonts, glyphs, opacities). Node only.
import { render, FontStore } from '../engine/index.js';
import { createPdfStream, paintPage, paintEnv } from './pdfstream.js';
import { latin1 } from './pdfpaint.js';

const proc = /** @type {any} */ (globalThis).process;
const { parentPort, workerData } = proc.getBuiltinModule('node:worker_threads');
const zlib = proc.getBuiltinModule('node:zlib');
const bytes = new Map(workerData.fonts);
const fontStore = new FontStore(async (k) => {
  const b = bytes.get(k);
  if (!b) throw new Error(`The font "${k}" was not sent to the paint worker`);
  return b;
});

parentPort.on('message', async (/** @type {any} */ job) => {
  try {
    const t0 = Date.now();
    const m = await render(job.def, { ...job.opts, fontStore, sources: { __rows: { rows: job.rows } }, pageWindow: job.pageWindow });
    // a writer of its own for the names and glyphs (nothing is written): the pages' links name pages by placeholder
    const rec = createPdfStream({ write() {} }, { fontStore });
    const env = paintEnv(rec, fontStore, { drillBase: job.drillBase, pageRef: (i) => `@@P${i}@@` });
    const pages = [], transfer = [];
    for (let k = 0; k < Math.min(job.keep, m.pages.length); k++) {
      const pg = m.pages[k];
      const { content, annots } = paintPage(pg, pg.height ?? job.height, env);
      const z = new Uint8Array(zlib.deflateSync(latin1(content), { level: 9 })); // as pdfpaint.js's deflate
      transfer.push(z.buffer);
      pages.push({ deflated: z, annots, width: pg.width, height: pg.height, firstRow: pg.firstRow, rowHead: pg.rowHead, headLevel: pg.headLevel });
    }
    parentPort.postMessage({ id: job.id, count: m.pages.length, nextFirst: m.pages[job.keep]?.firstRow, pages, used: rec.used(),
      shaped: [...env.shaped].map(([k, g]) => [k, [...g]]), bookmarks: m.bookmarks, headings: m.headings, warnings: m.warnings, ms: Date.now() - t0 }, transfer);
  } catch (e) {
    parentPort.postMessage({ id: job.id, error: { message: String(/** @type {any} */ (e)?.message || e), status: /** @type {any} */ (e)?.status, timeout: /** @type {any} */ (e)?.timeout } });
  }
});
