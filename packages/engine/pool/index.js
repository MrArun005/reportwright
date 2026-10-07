// @reportwright/engine/pool (Node only): render many reports in parallel on worker threads.
//   const pool = createPool({ workers: 4 });
//   const pdf = await pool.render(definition, { format: 'pdf', parameters: { id: 42 } });
//   await pool.close();
import { Worker } from 'node:worker_threads';
import os from 'node:os';

/**
 * @typedef {{ format?: 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'csv' | 'html', parameters?: Record<string, unknown>,
 *   timeZone?: string, timeoutMs?: number, options?: Record<string, unknown> }} PoolRenderOptions
 *   options: passed to the exporter (exportPdf's title, pdfa, …)
 * @typedef {{ render: (definition: object, opts?: PoolRenderOptions) => Promise<Uint8Array>, close: () => Promise<void>, readonly size: number, readonly pending: number }} Pool
 */

/**
 * A pool of worker threads, each with the engine and its fonts loaded once.
 * @param {{ workers?: number, fontsDir?: string, maxQueue?: number }} [opt]
 *   workers: default the CPU count less one. fontsDir: a folder of the fonts (default @reportwright/fonts).
 *   maxQueue: renders waiting beyond it are refused (default 10,000).
 * @returns {Pool}
 */
export function createPool({ workers = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1), fontsDir, maxQueue = 10000 } = {}) {
  if (!Number.isInteger(workers) || workers < 1) throw new TypeError('createPool({ workers }): workers must be a whole number of at least 1');
  /** @type {{ def: object, opts: PoolRenderOptions, resolve: (b: Uint8Array) => void, reject: (e: Error) => void }[]} */
  const queue = [];
  /** @type {Set<Worker>} */
  const idle = new Set();
  /** @type {Map<Worker, (typeof queue)[number]>} */
  const busy = new Map();
  let closed = false;
  const spawn = () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { fontsDir } });
    w.on('message', (msg) => {
      const job = busy.get(w);
      busy.delete(w);
      if (job) msg.error ? job.reject(Object.assign(new Error(msg.error.message), msg.error)) : job.resolve(new Uint8Array(msg.bytes));
      idle.add(w);
      next();
    });
    w.on('error', (e) => { const job = busy.get(w); busy.delete(w); job?.reject(e); });
    w.on('exit', () => {
      idle.delete(w);
      const job = busy.get(w);
      if (job) { busy.delete(w); job.reject(new Error('the render worker stopped')); }
      if (!closed) { idle.add(spawn()); next(); } // a crashed worker is replaced
    });
    return w;
  };
  const next = () => {
    while (queue.length && idle.size) {
      const w = /** @type {Worker} */ (idle.values().next().value);
      idle.delete(w);
      const job = /** @type {(typeof queue)[number]} */ (queue.shift());
      busy.set(w, job);
      w.postMessage({ def: job.def, opts: job.opts });
    }
  };
  for (let i = 0; i < workers; i++) idle.add(spawn());
  return {
    get size() { return workers; },
    get pending() { return queue.length + busy.size; },
    render(def, opts = {}) {
      if (closed) return Promise.reject(new Error('the pool is closed'));
      if (!def || typeof def !== 'object') return Promise.reject(new TypeError('pool.render(definition, opts): definition must be a report object'));
      if (queue.length >= maxQueue) return Promise.reject(new Error(`the pool queue is full (${maxQueue} renders waiting)`));
      return new Promise((resolve, reject) => { queue.push({ def, opts, resolve, reject }); next(); });
    },
    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new Error('the pool is closed'));
      await Promise.all([...idle, ...busy.keys()].map(w => w.terminate()));
    },
  };
}
