// @ts-check
// A render's output as a stream (docs/research/STREAMING-1M.md §9): the render thread writes chunks to a MessagePort,
// the request thread turns them into the HTTP response body. Back-pressure end to end: the response's ReadableStream
// asks for a chunk (credit) only when it has room (highWaterMark: 4 chunks of ~64 KB), the render awaits credit before
// it writes, and the source iterators await the render. A client that goes away cancels the stream, and the render
// stops at its next write. The same port works within one thread (PW_RENDER_WORKERS=0: the render runs on the request
// thread and yields at every write).

import { randomUUID } from 'node:crypto';

const CHUNK = 64 * 1024;
/** An error as the log may record it: its status and kind only. @param {any} e */
const errorClass = (e) => (e && typeof e === 'object' && 'status' in e && !('message' in e) ? e : { status: Number(e?.status) || null, kind: String(e?.code || e?.name || 'Error').replace(/[^\w.-]/g, '').slice(0, 40) });
export const STREAM_CANCELLED = 'The client stopped reading the output.';

/**
 * The render side: head(meta) once the render knows it streams, write(bytes) (awaits credit), end(), fail(error).
 * @param {import('node:worker_threads').MessagePort} port
 */
export function portSink(port, { stallMs = Number(process.env.PW_STREAM_STALL_MS) || 30000 } = {}) {
  let credit = 0, cancelled = false, wake = null, headSent = false;
  port.on('message', (m) => {
    if (m?.credit) credit += m.credit;
    if (m?.cancel) cancelled = true;
    const w = wake; wake = null; w?.();
  });
  const cancel = () => Object.assign(new Error(STREAM_CANCELLED), { status: 499, cancelled: true });
  return {
    get started() { return headSent; },
    /** @param {{ contentType: string, ext: string }} meta */
    head(meta) { headSent = true; port.postMessage({ head: meta }); },
    /** @param {Uint8Array} u8 */
    async write(u8) {
      // a client that stops reading holds a render thread and its memory: past stallMs without asking for more, the
      // render stops (as if the client had left) and frees them
      while (!credit && !cancelled) {
        let timer;
        const stalled = await new Promise((r) => { wake = () => r(false); timer = setTimeout(() => r(true), stallMs); });
        clearTimeout(timer);
        if (stalled && !credit) { cancelled = true; throw Object.assign(cancel(), { message: `The client read nothing for ${Math.round(stallMs / 1000)} s (PW_STREAM_STALL_MS); the export stopped.`, status: 408 }); }
      }
      if (cancelled) throw cancel();
      credit--;
      const own = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8 : u8.slice();
      port.postMessage({ chunk: own }, [/** @type {ArrayBuffer} */ (own.buffer)]);
    },
    end() { port.postMessage({ end: true }); port.close(); },
    /** @param {string} message */
    /** Only the error's class crosses: its status and kind, never its message (it can hold a URL, a query, data). @param {any} e */
    fail(e) { try { port.postMessage({ error: errorClass(e) }); } catch { /* closed */ } port.close(); },
    close() { port.close(); },
  };
}

/**
 * Text written in ~64 KB UTF-8 chunks to a sink (portSink). put(s) is awaited by the writer: a full buffer waits for
 * credit. The head goes out with the first chunk, so a render that fails before writing anything can still answer
 * with an ordinary error.
 * @param {ReturnType<typeof portSink>} sink @param {{ contentType: string, ext: string }} meta
 */
export function textWriter(sink, meta) {
  let parts = [], size = 0;
  const enc = new TextEncoder();
  const flush = async () => {
    if (!size) return;
    if (!sink.started) sink.head(meta);
    const s = parts.join('');
    parts = []; size = 0;
    await sink.write(enc.encode(s));
  };
  return {
    /** @param {string} s */
    put(s) { parts.push(s); size += s.length; return size >= CHUNK ? flush() : undefined; },
    async end() { if (!sink.started) sink.head(meta); await flush(); },
  };
}

/**
 * Bytes (a zip as it is made) in ~64 KB chunks to a sink; as textWriter, the head goes out with the first chunk.
 * @param {ReturnType<typeof portSink>} sink @param {{ contentType: string, ext: string }} meta
 */
export function byteWriter(sink, meta) {
  let parts = [], size = 0;
  const flush = async () => {
    if (!size) return;
    if (!sink.started) sink.head(meta);
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    parts = []; size = 0;
    await sink.write(all);
  };
  return {
    /** @param {Uint8Array} u8 */
    put(u8) { parts.push(u8); size += u8.length; return size >= CHUNK ? flush() : undefined; },
    async end() { if (!sink.started) sink.head(meta); await flush(); },
  };
}

/**
 * The request side: a ReadableStream of the chunks a render writes to the other end of this port, and a promise of
 * the head (or null when the render answered without streaming: its bytes come back as usual).
 * A failure after the head (the 200 is out) never puts its message in the body (it can name a source, a query): the
 * message goes to the server log under a reference, a CSV gets a last line "#ERROR <reference>", and the stream is
 * errored, so the connection breaks off and the client sees a failed download, not a short file.
 * @param {import('node:worker_threads').MessagePort} port @param {{ csv?: boolean, report?: string|null, format?: string|null }} [o]
 */
export function portSource(port, { csv = false, report = null, format = null } = {}) {
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let ctrl;
  let pulled = null, done = false, onHead, bytes = 0;
  const head = new Promise((r) => { onHead = r; });
  const release = () => { const p = pulled; pulled = null; p?.(); };
  const finish = () => { if (done) return; done = true; release(); try { port.close(); } catch { /* closed */ } };
  // the log line: a reference, the report, the format, how far it got and the error's class; never its message, rows,
  // queries, parameter values, URLs or who asked (the audit log has the caller)
  const broke = (cls) => {
    const ref = randomUUID().slice(0, 8);
    console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'stream failed after its first bytes', ref, report, format, bytes, error: cls }));
    try {
      if (csv) ctrl.enqueue(new TextEncoder().encode(`\r\n#ERROR ${ref}`));
      ctrl.error(Object.assign(new Error(`The export failed after it started (reference ${ref}).`), { ref }));
    } catch { /* closed */ }
  };
  port.on('message', (m) => {
    if (done) return;
    if (m?.head) onHead(m.head);
    else if (m?.chunk) { bytes += m.chunk.byteLength; ctrl.enqueue(new Uint8Array(m.chunk.buffer, m.chunk.byteOffset, m.chunk.byteLength)); release(); }
    else if (m?.end) { ctrl.close(); finish(); }
    else if (m?.error) {
      broke(m.error); finish();
    }
  });
  const stream = new ReadableStream({
    start(c) { ctrl = c; },
    // one credit per pull, and the next pull only once that chunk came: at most highWaterMark chunks wait here
    pull() { if (done) return; port.postMessage({ credit: 1 }); return new Promise((r) => { pulled = r; }); },
    cancel() { if (!done) { try { port.postMessage({ cancel: true }); } catch { /* closed */ } } finish(); },
  }, { highWaterMark: 4 });
  return {
    stream, head,
    /** The render ended without streaming (or failed before its head): stop listening. */
    abandon() { onHead(null); if (!done) { try { ctrl.close(); } catch { /* closed */ } } finish(); },
    /** The render failed after its head (it was stopped: a timeout, a crash). @param {any} e */
    fail(e) { if (done) return; broke(errorClass(e)); finish(); },
  };
}
