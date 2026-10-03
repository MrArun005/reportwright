'use client';
// Runs the engine in a Web Worker. Falls back to the main thread if the worker cannot start.
import { render, FontStore } from '@/engine/index.js';
import { exportPdf } from '@/exporters/pdf.js';
import { createSubsetter } from '@/exporters/subset.js';

const subset = createSubsetter(async () => (await fetch('/harfbuzz-subset.wasm')).arrayBuffer());

let worker = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map();
let mainStore = null;

export function fontStore() {
  if (!mainStore) mainStore = new FontStore(async (k) => (await fetch(`/fonts/${k}.ttf`)).arrayBuffer());
  return mainStore;
}

function getWorker() {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker/engine.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.model);
      else w.reject(Object.assign(new Error(e.data.error.message), e.data.error));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      for (const [, w] of waiting) w.retry();
      waiting.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

async function renderMain(def, params) {
  return render(def, { parameters: params, fontStore: fontStore(), baseUrl: window.location.origin });
}

/** @returns {Promise<any>} page model */
export function renderReport(def, params = {}) {
  const w = getWorker();
  if (!w) return renderMain(def, params);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, retry: () => renderMain(def, params).then(resolve, reject) });
    w.postMessage({ id, def, params });
  });
}

export const usingWorker = () => !!worker && !workerBroken;

export async function pdfBlob(model, title) {
  const store = fontStore();
  await store.load();
  const bytes = await exportPdf(model, store, {
    title,
    subset,
    fetchImage: async (src) => { try { const r = await fetch(src); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } },
  });
  return new Blob([bytes], { type: 'application/pdf' });
}
