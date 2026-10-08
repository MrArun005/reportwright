// @ts-check
/**
 * Word and Excel written to a sink as they are made, for reports too large to hold as a page model: exportDocxStream
 * and exportXlsxStream mirror exportPdfStream (src/exporters/pdfstream.js): the same sink (a Node Writable, or anything
 * with write(bytes) that may return a promise), timeoutMs or deadline, and signal. A flowing table report streams: Word
 * lays out a window of rows at a time (planPaged) and each page's XML goes into the zip's deflater, Excel writes the
 * sheet row by row (planStream, xlsxstream.js); neither the rows, the pages nor the XML are held whole. Any other
 * report is rendered whole and exported by exportDocx / exportXlsx, written to the sink in one piece (the result's why
 * says why).
 */
import { render } from '../engine/index.js';
import { planPaged } from '../engine/paged.js';
import { planStream } from '../engine/stream.js';
import { raced } from './pdfstream.js';
import { writeDocx, exportDocx } from './docx.js';
import { exportXlsx } from './xlsx.js';
import { writeXlsxStream } from './xlsxstream.js';

/**
 * @typedef {{ write(u8: Uint8Array): any, once?: (ev: string, cb: () => void) => any }} Sink
 * @typedef {{ streamed: boolean, pages?: number, rows?: number, warnings: string[], why?: string }} StreamResult
 */

/**
 * What sink.write returned, waited for: a promise, or false and 'drain' (its 'error' or 'close' end the wait with an
 * error). The same as pdfstream.js's.
 * @param {Sink} sink @param {any} r
 */
function written(sink, r) {
  const s = /** @type {any} */ (sink);
  if (r !== false || !s.once) return Promise.resolve(r);
  return new Promise((ok, fail) => {
    const off = () => { s.off?.('drain', onDrain); s.off?.('error', onError); s.off?.('close', onClose); };
    const onDrain = () => { off(); ok(undefined); };
    const onError = (/** @type {any} */ e) => { off(); fail(e); };
    const onClose = () => { off(); fail(Object.assign(new Error('The sink closed before the file was written'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })); };
    s.once('drain', onDrain); s.once('error', onError); s.once('close', onClose);
  });
}

/** The items of an async iterable, each wait raced with the signal; a read the signal stopped is not waited for. */
async function* watched(/** @type {AsyncIterable<any>} */ items, /** @type {AbortSignal} */ signal) {
  const it = items[Symbol.asyncIterator]();
  let pending = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      pending = true;
      const x = await raced(it.next(), signal);
      pending = false;
      if (x.done) return;
      yield x.value;
    }
  } finally {
    if (pending) it.return?.(undefined)?.catch(() => {}); else await it.return?.(undefined);
  }
}

/**
 * exportPdfStream's frame: one signal for the caller's, the time limit and the sink's error; the rejection is the
 * signal's reason (an AbortError), or for the time limit an error with status 504 and code ETIMEDOUT.
 * @param {string} what @param {any} opts @param {Sink} sink
 * @param {(o: any, put: (u8: Uint8Array) => Promise<any>) => Promise<StreamResult>} body
 */
async function framed(what, opts = {}, sink, body) {
  opts.signal?.throwIfAborted();
  const t0 = Date.now();
  const deadline = opts.deadline ?? (Number(opts.timeoutMs) > 0 ? t0 + Number(opts.timeoutMs) : undefined);
  const ctl = new AbortController();
  const signal = ctl.signal;
  const onAbort = () => ctl.abort(opts.signal.reason);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = deadline ? setTimeout(() => ctl.abort(Object.assign(new Error(`The ${what} export ran longer than ${Math.round((deadline - t0) / 100) / 10} s, its time limit (timeoutMs).`), { name: 'TimeoutError', code: 'ETIMEDOUT', status: 504, timeout: true })), Math.max(0, deadline - t0)) : null;
  const s = /** @type {any} */ (sink);
  const onSinkError = (/** @type {any} */ e) => ctl.abort(e);
  s.on?.('error', onSinkError);
  const put = (/** @type {Uint8Array} */ u8) => { signal.throwIfAborted(); return raced(written(sink, sink.write(u8)), signal); };
  try {
    return await body({ ...opts, deadline, signal }, put);
  } catch (e) {
    const err = signal.aborted ? signal.reason : e;
    if (err?.timeout && !err.code) err.code = 'ETIMEDOUT';
    throw err;
  } finally {
    clearTimeout(/** @type {any} */ (timer));
    opts.signal?.removeEventListener('abort', onAbort);
    s.off?.('error', onSinkError);
  }
}

/** The whole-model path: render with the table data, export, write once; a warning says it was not streamed. */
async function whole(what, def, opts, put, why, exp) {
  const model = await raced(render(def, { ...opts, exportData: true }), opts.signal);
  await put(await raced(exp(model), opts.signal));
  return { streamed: false, pages: model.pages.length, warnings: [`The ${what} file was not streamed (${why}): the report was rendered whole, so its memory grows with its pages.`, ...model.warnings], why };
}

/**
 * Report definition → .docx written to sink as its pages are laid out.
 * @param {any} def @param {any} opts render()'s options and exportDocx's (fontStore, fetchImage, figures, rasterize, lang,
 *   title), plus timeoutMs or deadline, signal, window (rows laid out at once), maxRows, sorter, sqlRows as exportPdfStream
 * @param {Sink} sink not closed
 * @returns {Promise<StreamResult>}
 */
export function exportDocxStream(def, opts, sink) {
  return framed('Word', opts, sink, async (o, put) => {
    const docOpt = { title: o.title || def?.name, lang: o.lang || def?.locale, fontStore: o.fontStore, fetchImage: o.fetchImage, figures: o.figures, rasterize: o.rasterize };
    const plan = /** @type {any} */ (await raced(planPaged(def, { ...o, exportData: true }), o.signal));
    if (plan.why !== undefined) return whole('Word', def, o, put, plan.why, (m) => exportDocx(m, docOpt));
    let pages = 0;
    const counted = async function* () { for await (const pg of watched(plan.pages({}), o.signal)) { pages++; yield pg; } };
    await writeDocx(counted(), { ...plan.info, locale: def.locale, name: def.name }, docOpt, put);
    return { streamed: true, pages, warnings: plan.info.warnings };
  });
}

/**
 * Report definition → .xlsx written to sink as its rows come.
 * @param {any} def @param {any} opts render()'s options and exportXlsx's (currency, title, formulas, fontStore,
 *   fetchImage), plus timeoutMs or deadline, signal, maxRows, sorter, sqlRows as exportPdfStream
 * @param {Sink} sink not closed
 * @returns {Promise<StreamResult>}
 */
export function exportXlsxStream(def, opts, sink) {
  return framed('Excel', opts, sink, async (o, put) => {
    const xOpt = { currency: o.currency || def?.currency, title: o.title || def?.name, formulas: o.formulas, fontStore: o.fontStore, fetchImage: o.fetchImage };
    const plan = /** @type {any} */ (await raced(planStream(def, { ...o, format: 'xlsx' }), o.signal));
    if (plan.why !== undefined) return whole('Excel', def, o, put, plan.why, (m) => exportXlsx(m, xOpt));
    await writeXlsxStream({ ...plan, rows: () => watched(plan.rows(), o.signal) }, put, xOpt);
    return { streamed: true, rows: plan.stats?.rows, warnings: plan.warnings };
  });
}
