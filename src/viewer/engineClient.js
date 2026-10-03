'use client';
// Runs the engine in a Web Worker. Falls back to the main thread if the worker cannot start.
import { render, FontStore } from '@/engine/index.js';
import { exportPdf } from '@/exporters/pdf.js';
import { createSubsetter } from '@/exporters/subset.js';

// Where fonts, the WASM subsetter and report definitions come from ('' = this site; set for embedding).
let assetBase = '';
export function setAssetBase(url) { assetBase = String(url || '').replace(/\/$/, ''); mainStore = null; }
export const origin = () => assetBase || window.location.origin;
export const subsetter = createSubsetter(async () => (await fetch(`${assetBase}/harfbuzz-subset.wasm`)).arrayBuffer());

let worker = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map();
let mainStore = null;

export function fontStore() {
  if (!mainStore) mainStore = new FontStore(async (k) => (await fetch(`${assetBase}/fonts/${k}.ttf`)).arrayBuffer());
  return mainStore;
}

function getWorker() {
  if (workerBroken || typeof Worker === 'undefined' || assetBase) return null; // embedded: run on the main thread
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

const loadReport = async (rid) => { const r = await fetch(`${assetBase}/api/reports/${rid}`); if (!r.ok) throw new Error(`Report "${rid}" not found`); return r.json(); };
async function renderMain(def, params, state, reportId) {
  return render(def, { parameters: params, state, reportId, fontStore: fontStore(), baseUrl: origin(), loadReport });
}

/**
 * @param {string} [reportId] the saved report: the server runs its SQL sources
 * @returns {Promise<any>} page model
 */
export function renderReport(def, params = {}, state = {}, reportId = undefined) {
  const w = getWorker();
  if (!w) return renderMain(def, params, state, reportId);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, retry: () => renderMain(def, params, state, reportId).then(resolve, reject) });
    w.postMessage({ id, def, params, state, reportId });
  });
}

export const usingWorker = () => !!worker && !workerBroken;

export async function pdfBlob(model, title) {
  const store = fontStore();
  await store.load();
  const bytes = await exportPdf(model, store, {
    title,
    subset: subsetter,
    fetchImage: async (src) => { try { const r = await fetch(src); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } },
  });
  return new Blob([bytes], { type: 'application/pdf' });
}
