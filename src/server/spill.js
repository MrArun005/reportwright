// @ts-check
// An external merge sort for streaming renders (docs/research/STREAMING-1M.md §4, §7): records are sorted in runs of
// 20,000 records in memory (run), each run written to a temp file as framed batches (v8.serialize keeps Dates and numbers), then
// the runs are merged k ways with a small heap, reading one batch per run at a time. Memory: one run while writing, one
// batch per run while merging. Disk: the records once. PW_SPILL_MAX_MB (default 2048) caps a render's temp files.
// The files live in os.tmpdir()/pw-spill-*, removed when the sort is closed (and, at the latest, when the thread exits).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { num } from './config.js';

const live = new Set();
let hooked = false;
const sweep = () => { for (const d of live) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } live.clear(); };

/**
 * A sorter factory for planStream (engine/stream.js): sorter(cmp) → { push, drain, close }.
 * @param {{ run?: number, frame?: number, maxMB?: number, dir?: string }} [o]
 */
export function spillSorter({ run = 20000, frame = 1000, maxMB = num('PW_SPILL_MAX_MB', 2048, { min: 1 }), dir: root = os.tmpdir() } = {}) {
  /** @param {(a: any, b: any) => number} cmp */
  return (cmp) => {
    let buf = [], dir = null, written = 0;
    /** @type {string[]} */
    const runs = [];
    const flush = async () => {
      if (!buf.length) return;
      buf.sort(cmp);
      if (!dir) {
        dir = fs.mkdtempSync(path.join(root, 'pw-spill-'));
        live.add(dir);
        if (!hooked) { hooked = true; process.once('exit', sweep); }
      }
      const file = path.join(dir, `run-${runs.length}`);
      const fh = await fs.promises.open(file, 'w');
      try {
        for (let i = 0; i < buf.length; i += frame) {
          const body = v8.serialize(buf.slice(i, i + frame));
          written += body.length + 4;
          if (written > maxMB * 1048576) throw Object.assign(new Error(`The sort needs more than ${maxMB} MB of temporary disk (PW_SPILL_MAX_MB). Filter the data, or sort it at the source.`), { status: 413 });
          const head = Buffer.alloc(4);
          head.writeUInt32LE(body.length);
          await fh.write(head);
          await fh.write(body);
        }
      } finally { await fh.close(); }
      runs.push(file);
      buf = [];
    };
    return {
      /** @param {any} r */
      async push(r) { buf.push(r); if (buf.length >= run) await flush(); },
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
        if (dir) { const d = dir; dir = null; live.delete(d); await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {}); }
      },
      /** Tests: the runs written so far. */
      get runs() { return runs.length; },
    };
  };
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
