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

// Fonts bundled with the page as base64 (the interactive HTML export), so it works offline.
let bundledFonts = null;
export function setBundledFonts(map) { bundledFonts = map || null; mainStore = null; }
const b64ToBuffer = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

export function fontStore() {
  if (!mainStore) mainStore = new FontStore(async (k) => (bundledFonts?.[k] ? b64ToBuffer(bundledFonts[k]) : (await fetch(`${assetBase}/fonts/${k}.ttf`)).arrayBuffer()));
  return mainStore;
}

function getWorker() {
  if (workerBroken || typeof Worker === 'undefined' || assetBase || bundledFonts) return null; // embedded: run on the main thread
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker/engine.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.partial) { w.onPartial?.(e.data.model); return; } // the full model follows
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

// Report definitions bundled with the page (the interactive HTML export) win over the server.
const bundled = new Map();
export function registerReports(map) { for (const [k, v] of Object.entries(map || {})) bundled.set(k, v); }
const loadReport = async (rid) => {
  if (bundled.has(rid)) return structuredClone(bundled.get(rid));
  const r = await fetch(`${assetBase}/api/reports/${encodeURIComponent(rid)}`);
  if (!r.ok) throw new Error(`Report "${rid}" not found`);
  return r.json();
};
export const fetchReport = loadReport;
async function renderMain(def, params, state, reportId) {
  return render(def, { parameters: params, state, reportId, fontStore: fontStore(), baseUrl: origin(), loadReport });
}

/**
 * @param {string} [reportId] the saved report: the server runs its SQL sources
 * @param {{ onPartial?: (model: any) => void }} [opt] onPartial: gets the first pages of a long report first
 * @returns {Promise<any>} page model
 */
export function renderReport(def, params = {}, state = {}, reportId = undefined, { onPartial } = {}) {
  const w = getWorker();
  if (!w) return renderMain(def, params, state, reportId);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, onPartial, retry: () => renderMain(def, params, state, reportId).then(resolve, reject) });
    w.postMessage({ id, def, params, state, reportId, firstPages: onPartial ? 2 : 0 });
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
