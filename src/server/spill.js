// @ts-check
// An external merge sort for streaming renders (docs/research/STREAMING-1M.md §4, §7): records are sorted in runs of
// 20,000 records in memory (run), each run written to a temp file as framed batches (v8.serialize keeps Dates and numbers), then
// the runs are merged k ways with a small heap, reading one batch per run at a time. Memory: one run while writing, one
// batch per run while merging. Disk: the records once. PW_SPILL_MAX_MB (default 2048) caps one render's temp files,
// PW_SPILL_TOTAL_MB (default 8192) all of this process's at once (every render thread: a shared counter, the bytes
// actually written). The files live in a private folder (0700, files 0600) os.tmpdir()/pw-spill-<pid>-<thread>-*,
// removed when the sort ends, fails or is abandoned, when the thread exits, and at the server's start (sweepAtBoot:
// folders of processes that are gone) or by age (a thread terminated at its time limit runs no cleanup).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { threadId } from 'node:worker_threads';
import { num } from './config.js';

/**
 * Bytes on disk per render thread, in KB: one cell per thread in a SharedArrayBuffer the pool hands every worker
 * (spillShared, workerData.spill), so the total across threads is known; the pool zeroes a thread's cell when the
 * thread ends. Without a pool (the request thread, tests, the CLI): a cell of its own.
 */
const CELLS = 64;
export const spillShared = () => /** @type {any} */ (globalThis).__pwSpill ||= { cells: new Int32Array(new SharedArrayBuffer(4 * CELLS)), cell: 0 };
const usedKB = () => { const { cells } = spillShared(); let n = 0; for (let i = 0; i < CELLS; i++) n += Number(Atomics.load(cells, i)); return n; };

const live = new Set();
let hooked = false;
const sweep = () => { for (const d of live) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } live.clear(); };

/**
 * A sorter factory for planStream (engine/stream.js): sorter(cmp) → { push, drain, close }. The engine closes it
 * when the rows end, fail or are abandoned (a client that left): its files go then.
 * @param {{ run?: number, runBytes?: number, frame?: number, maxMB?: number, totalMB?: number, dir?: string, staleMs?: number }} [o]
 */
/** Spill folders left by a render that was stopped hard (a worker terminated at the time limit runs no cleanup):
 *  any older than staleMs is removed when a new sort starts. */
function sweepStale(root, staleMs) {
  try {
    for (const n of fs.readdirSync(root)) {
      if (!n.startsWith('pw-spill-')) continue;
      const d = path.join(root, n);
      if (live.has(d)) continue;
      try { if (Date.now() - fs.statSync(d).mtimeMs > staleMs) fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
    }
  } catch { /* no folder */ }
}

/** At the server's start: remove the spill folders of processes that are gone (pw-spill-<pid>-…) and old-style ones. */
export function sweepAtBoot(root = os.tmpdir()) {
  try {
    for (const n of fs.readdirSync(root)) {
      const m = /^pw-spill-(\d+)-/.exec(n);
      if (!n.startsWith('pw-spill-') || (m && Number(m[1]) === process.pid)) continue;
      let alive = false;
      if (m) { try { process.kill(Number(m[1]), 0); alive = true; } catch { /* gone */ } }
      if (!alive) fs.rmSync(path.join(root, n), { recursive: true, force: true });
    }
  } catch { /* no folder */ }
}

export function spillSorter({ run = 20000, runBytes = 24 * 1048576, frame = 1000, maxMB = num('PW_SPILL_MAX_MB', 2048, { min: 1 }), totalMB = num('PW_SPILL_TOTAL_MB', 8192, { min: 1 }), dir: root = os.tmpdir(), staleMs = 2 * num('PW_RENDER_TIMEOUT_MS', 60000, { min: 1 }) + 60000 } = {}) {
  sweepStale(root, staleMs);
  /** @param {(a: any, b: any) => number} cmp */
  return (cmp) => {
    let buf = [], dir = null, written = 0, held = 0, takenKB = 0; // held: the run in memory, about (a run ends at run records or runBytes)
    /** @type {string[]} */
    const runs = [];
    const flush = async () => {
      if (!buf.length) return;
      buf.sort(cmp);
      if (!dir) {
        dir = fs.mkdtempSync(path.join(root, `pw-spill-${process.pid}-${threadId}-`)); // mode 0700
        live.add(dir);
        if (!hooked) { hooked = true; process.once('exit', sweep); }
      }
      const file = path.join(dir, `run-${runs.length}`);
      const fh = await fs.promises.open(file, 'wx', 0o600);
      try {
        for (let i = 0; i < buf.length; i += frame) {
          const body = v8.serialize(buf.slice(i, i + frame));
          written += body.length + 4;
          if (written > maxMB * 1048576) throw Object.assign(new Error(`The sort needs more than ${maxMB} MB of temporary disk (PW_SPILL_MAX_MB). Filter the data, or sort it at the source.`), { status: 413 });
          // the process-wide budget, in whole KB: reserved (an atomic add) before the bytes are written, then checked;
          // over it, the reservation is taken back and the sort refused. Two threads racing past the limit both see
          // it and both fail (closed, never open). Given back at close.
          const kb = Math.ceil(written / 1024) - takenKB;
          if (kb > 0) {
            const { cells, cell } = spillShared();
            Atomics.add(cells, cell, kb); takenKB += kb;
            if (usedKB() > totalMB * 1024) throw Object.assign(new Error(`The server's temporary disk for sorting is in use (PW_SPILL_TOTAL_MB, ${totalMB} MB). Try again shortly, or filter the data.`), { status: 503 });
          }
          const head = Buffer.alloc(4);
          head.writeUInt32LE(body.length);
          await fh.write(head);
          await fh.write(body);
        }
      } finally { await fh.close(); }
      runs.push(file);
      buf = []; held = 0;
    };
    return {
      /** @param {any} r */
      async push(r) { buf.push(r); held += approx(r); if (buf.length >= run || held >= runBytes) await flush(); },
      async *drain() {
        if (!runs.length) { const all = buf; buf = []; all.sort(cmp); for (let i = 0; i < all.length; i++) { yield all[i]; all[i] = null; } return; }
        await flush();
        const readers = await Promise.all(runs.map(openRun));
        try {
          // a binary min-heap of [record, reader]
          /** @type {[any, any][]} */
          const heap = [];
          const less = (i, j) => cmp(heap[i][0], heap[j][0]) < 0;
          const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
          const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; } };
          const down = (i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(l, m)) m = l; if (r < heap.length && less(r, m)) m = r; if (m === i) return; swap(i, m); i = m; } };
          for (const rd of readers) { const x = await rd.next(); if (x !== undefined) { heap.push([x, rd]); up(heap.length - 1); } }
          while (heap.length) {
            const [x, rd] = heap[0];
            yield x;
            const n = await rd.next();
            if (n === undefined) { const last = /** @type {[any, any]} */ (heap.pop()); if (heap.length) { heap[0] = last; down(0); } }
            else { heap[0] = [n, rd]; down(0); }
          }
        } finally { await Promise.all(readers.map(r => r.close())); }
      },
      async close() {
        buf = [];
        if (takenKB) { const { cells, cell } = spillShared(); Atomics.sub(cells, cell, takenKB); takenKB = 0; }
        if (dir) { const d = dir; dir = null; live.delete(d); await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {}); }
      },
      /** Tests: the runs written so far. */
      get runs() { return runs.length; },
    };
  };
}

/** A record's size in memory, about: strings at 2 bytes a character, everything else 8, two levels deep (a record holds
 *  its keys and its row). It counts what is there, never a declared length. */
function approx(x, d = 0) {
  if (typeof x === 'string') return 2 * x.length + 16;
  if (!x || typeof x !== 'object' || d > 2) return 8;
  let n = 32;
  for (const k in x) n += approx(x[k], d + 1) + 8;
  return n;
}

/** A run file read a batch at a time: next() → the next record, or undefined at its end. @param {string} file */
async function openRun(file) {
  const fh = await fs.promises.open(file, 'r');
  let pos = 0, batch = [], i = 0;
  const head = Buffer.alloc(4);
  return {
    async next() {
      if (i < batch.length) { const x = batch[i]; batch[i++] = null; return x; }
      const h = await fh.read(head, 0, 4, pos);
      if (h.bytesRead < 4) return undefined;
      const len = head.readUInt32LE(0);
      const body = Buffer.alloc(len);
      await fh.read(body, 0, len, pos + 4);
      pos += 4 + len;
      batch = v8.deserialize(body); i = 0;
      return this.next();
    },
    close: () => fh.close(),
  };
}
