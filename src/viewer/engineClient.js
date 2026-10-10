'use client';
// Runs the engine in a Web Worker. Falls back to the main thread if the worker cannot start.
import { reportFetch, policyKeysIn, fetchPolicy } from './dataFetch.js';
import { fontFile, setCustomFonts, isStandard, SHAPER, CORE_FONT_KEY, OPTIONAL_KEYS, setOptionalFonts, optionalMissing } from '@/engine/text/fonts.js';
import { createSubsetter } from '@/exporters/subset.js';
import { fontFamilyCss, fontKeysOf } from '@/exporters/svg.js';

// Where fonts, the WASM subsetter and report definitions come from ('' = this site; set for embedding).
let assetBase = '';
export function setAssetBase(url) { assetBase = String(url || '').replace(/\/$/, ''); mainStore = null; }
export const origin = () => assetBase || window.location.origin;
// Standalone (the npm viewer with no `server`): no /api calls; fonts from `fontsUrl`, a copy of @reportwright/fonts/public/fonts.
let fontsUrl = null;
let standalone = false;
/** @param {{ standalone?: boolean, fontsUrl?: string|null }} o */
export function setStandalone({ standalone: on = false, fontsUrl: f = null } = {}) {
  standalone = !!on; fontsUrl = f ? String(f).replace(/\/?$/, '/') : null; mainStore = null; fontList = null; fontBytes.clear(); optP = null;
}
// optional fonts: only those the server has (app/fonts/optional.json)
if (typeof window < 'u') setOptionalFonts([]);
let optP = null;
const optional = () => (optP ||= Promise.resolve(standalone || fetch(`${fontsBase()}optional.json`).then(r => r.json())).then(k => setOptionalFonts(k?.map ? k : null), () => setOptionalFonts(null)));
/** Where the report fonts are: fontsUrl, else <server>/fonts/. */
export const fontsBase = () => fontsUrl || `${assetBase}/fonts/`;
/** A file next to the fonts folder (harfbuzz-subset.wasm, icc/…): ../ of fontsUrl, else the server's root. */
const besideFonts = (file) => (fontsUrl ? new URL(`../${file}`, new URL(fontsUrl, typeof location !== 'undefined' ? location.href : undefined)).href : `${assetBase}/${file}`);
export const subsetter = createSubsetter(async () => (await fetch(besideFonts('harfbuzz-subset.wasm'))).arrayBuffer());

let worker = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map();
let mainStore = null;

// Fonts bundled with the page as base64 (the interactive HTML export), so it works offline; `list` names the
// uploaded ones among them.
let bundledFonts = null;
let bundledList = null;
export function setBundledFonts(map, list) { bundledFonts = map || null; bundledList = list || null; mainStore = null; fontList = null; }
const b64ToBuffer = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
/** Each font file fetched once, shared by the engine (FontStore) and the page (FontFace). */
const fontBytes = new Map();
const fetchFont = (k) => {
  if (!fontBytes.has(k)) {
    const p = (async () => {
      if (OPTIONAL_KEYS.includes(k) && (await optional(), optionalMissing(k))) throw Error(k);
      const r = await fetch(`${fontsBase()}${fontFile(k)}`);
      if (!r.ok) throw new Error(`Font "${k}" did not load (HTTP ${r.status})`);
      return r.arrayBuffer();
    })();
    p.catch(() => fontBytes.delete(k)); // a failed fetch may be tried again
    fontBytes.set(k, p);
  }
  return fontBytes.get(k);
};
const getFont = async (k) => {
  if (bundledFonts?.[k]) return b64ToBuffer(bundledFonts[k]);
  return (await fetchFont(k)).slice(0); // a copy: the engine may transfer or detach its buffer
};

// The engine (layout, expressions, charts, maps, barcodes, fontkit) is not in the viewer's first load: the worker
// renders. Here it loads on first use: a render on the main thread (no worker), an export, the parameter lists.
let engineP = null;
export const loadEngine = () => (engineP ||= import('@/engine/index.js'));
/** The main thread's FontStore (the engine loads with it). */
export async function loadFontStore() {
  const { FontStore } = await loadEngine();
  return (mainStore ||= new FontStore(getFont));
}
/** The choices of the report's parameters (their queries run here): the engine's parameterOptions, loaded when used. */
export async function parameterOptions(def, params, opts) { if (!opts?.fetch) throw new TypeError('parameterOptions: pass the guarded fetch (reportFetch); the engine would use the global fetch'); return (await loadEngine()).parameterOptions(def, params, opts); }

// The worker file: a sibling of this source in the app (Next bundles it); scripts/build-embed.mjs rewrites the path to
// ./engine.worker.js, which it builds next to the viewer's chunks, so Vite, webpack and Next bundle it from the package.
const makeWorker = () => new Worker(new URL('../worker/engine.worker.js', import.meta.url), { type: 'module' });

/** Fonts uploaded to the server, known to the engine by family. Cached; refresh after an upload. */
let fontList = null;
export function customFonts(refresh = false) {
  if (!fontList || refresh) {
    fontList = (bundledList ? Promise.resolve(bundledList) : standalone ? Promise.resolve([]) : fetch(`${assetBase}/api/fonts`).then(r => (r.ok ? r.json() : [])).catch(() => []))
      .then(async (list) => { setCustomFonts(list); await optional(); return list; });
  }
  return fontList;
}

/**
 * Declare and load the fonts a page model draws with. FontFace on the document (not CSS in the component),
 * so viewers inside a shadow root (the embed) see them too. Resolves to the keys that did not load (each with its error);
 * a font that failed is tried again the next time.
 */
const faces = new Map();
export function loadReportFonts(keys) {
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return Promise.resolve([]);
  return Promise.all(keys.filter(k => k !== SHAPER && !isStandard(k)).map((k) => { // a standard PDF font has no file (the SVG names it)
    if (!faces.has(k)) {
      // the same bytes the engine measures with (one download per font), not a url() the browser fetches again
      const bytes = bundledFonts?.[k] ? Promise.resolve(b64ToBuffer(bundledFonts[k])) : fetchFont(k).then(b => b.slice(0));
      faces.set(k, bytes.then((src) => {
        const face = new FontFace(fontFamilyCss(k), src, { display: 'block' });
        document.fonts.add(face);
        return face.load();
      }).then(() => null, (error) => { faces.delete(k); return { key: k, error }; }));
    }
    return faces.get(k);
  })).then(results => results.filter(Boolean));
}
export const loadModelFonts = (model) => loadReportFonts([...new Set([CORE_FONT_KEY, ...fontKeysOf(model)])]);

let warned = false;
/** Said once: the report now renders on the main thread (a long task at 100k rows). N1. */
function workerFailed(reason) {
  if (warned) return;
  warned = true;
  console.warn(`[reportwright] worker did not load (${reason}); rendering on the main thread`);
}

function getWorker() {
  // main thread: no Worker; fonts bundled in the page or a data snapshot (the offline HTML export); the page's own fetch
  // (a function cannot go to a worker)
  if (workerBroken || typeof Worker === 'undefined' || bundledFonts || fetchPolicy().fetch || (typeof window !== 'undefined' && /** @type {any} */ (window).__pwSnapshot)) return null;
  if (worker) return worker;
  try {
    worker = makeWorker();
    worker.onmessage = (e) => {
      if (e.data.font) { // the worker's font: fetched here once, shared with the page's FontFace
        const { fid } = e.data;
        getFont(e.data.font).then(buf => worker?.postMessage({ fid, buf }, [buf]), err => worker?.postMessage({ fid, error: String(err?.message || err) }));
        return;
      }
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.pagesPart) { const ps = (w.pages ||= []); for (const p of e.data.pagesPart) ps.push(p); return; } // a model's pages come in parts
      if (e.data.inParts) { e.data.model.pages = w.pages || []; w.pages = []; }
      if (e.data.partial) { w.onPartial?.(e.data.model); return; } // the full model follows
      if (e.data.retry) { w.onRetry?.(e.data.retry); return; } // the server was busy: a data source is tried again
      waiting.delete(e.data.id);
      if (e.data.mainThread) { workerFailed(e.data.mainThread); w.retry(); return; } // a library the worker imports did not load
      if (e.data.ok) w.resolve(e.data.model);
      else w.reject(Object.assign(new Error(e.data.error.message), e.data.error));
    };
    worker.onerror = (ev) => {
      workerFailed(ev?.message || 'the worker file did not load: it was not found or could not be built');
      workerBroken = true;
      worker = null;
      for (const [, w] of waiting) w.retry();
      waiting.clear();
    };
  } catch (err) {
    workerFailed(err?.message || String(err));
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
  if (standalone) throw new Error(`Report "${rid}" is not loaded: pass it in reports: { "${rid}": definition }, or set server (a self-hosted ReportWright server)`);
  const r = await fetch(`${assetBase}/api/reports/${encodeURIComponent(rid)}`);
  if (!r.ok) throw new Error(`Report "${rid}" not found`);
  return r.json();
};
export const fetchReport = loadReport;
async function renderMain(def, params, state, reportId, exportData = false, onRetry = undefined, dataOnly = false) {
  const [{ render }, store] = await Promise.all([loadEngine(), loadFontStore(), customFonts()]);
  return render(def, { parameters: params, state, reportId, exportData, dataOnly, fontStore: store, lazyFonts: true, baseUrl: origin(), loadReport, fetch: reportFetch(origin(), undefined, { onRetry }) }); // a report reads data, never calls our API as the viewer
}

/**
 * @param {string} [reportId] the saved report: the server runs its SQL sources
 * @param {{ onPartial?: (model: any) => void, exportData?: boolean, dataOnly?: boolean, onRetry?: (r: { attempt: number, max: number, status: number }) => void }} [opt]
 *   onPartial: gets the first pages of a long report first. onRetry: a data source met a busy server and is tried again.
 *   exportData: with the table data Excel, CSV, Word, PowerPoint, HTML and the accessible PDF need (a view goes without)
 *   dataOnly: the table data and no pages (the data CSV)
 * @returns {Promise<any>} page model
 */
export async function renderReport(def, params = {}, state = {}, reportId = undefined, { onPartial, exportData = false, onRetry, dataOnly = false } = {}) {
  const policyKeys = policyKeysIn(def);
  if (policyKeys.length) console.warn(`ReportWright: ${policyKeys.join(', ')} in the report definition ignored: only the page's mountViewer options set allowHosts and unsafeFetch`);
  const w = getWorker();
  if (!w) return renderMain(def, params, state, reportId, exportData, onRetry, dataOnly);
  const fonts = await customFonts(); // the worker has its own copy of the font list
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, onPartial, onRetry, retry: () => renderMain(def, params, state, reportId, exportData, onRetry, dataOnly).then(resolve, reject) });
    const { allowHosts, unsafeFetch } = fetchPolicy();
    const env = { origin: origin(), standalone, reports: bundled.size ? Object.fromEntries(bundled) : null, fetchPolicy: { allowHosts, unsafeFetch } };
    w.postMessage({ id, def, params, state, reportId, fonts, firstPages: onPartial && !dataOnly ? 2 : 0, exportData, dataOnly, env });
  });
}

export const usingWorker = () => !!worker && !workerBroken;

/** The sRGB profile a PDF/A file carries (public/icc). */
async function iccProfile() {
  const r = await fetch(fontsUrl ? besideFonts('icc/sRGB-v2-magic.icc') : `${origin()}/icc/sRGB-v2-magic.icc`);
  if (!r.ok) throw new Error(`the PDF/A colour profile did not load (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * @param {{ tagged?: { lang?: string }, pdfa?: boolean }} [o] tagged: an accessible PDF (PDF/UA); pdfa: PDF/A (2a when tagged)
 */
export async function pdfBlob(model, title, o = {}) {
  const store = await loadFontStore();
  await customFonts();
  await store.load(fontKeysOf(model));
  const { exportPdf } = await import('@/exporters/pdf.js'); // pdf-lib loads on the first PDF export
  const bytes = await exportPdf(model, store, {
    title,
    subset: subsetter,
    tagged: o.tagged,
    drillBase: origin(), // drill-through links open this viewer, as in the HTML export
    pdfa: o.pdfa ? { icc: await iccProfile() } : undefined,
    // a report's image: a GET under the same rules as its data (no cookies to our other routes or to other sites)
    fetchImage: async (src) => { try { const r = await reportFetch(origin())(src); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } },
  });
  return new Blob([bytes], { type: 'application/pdf' });
}
