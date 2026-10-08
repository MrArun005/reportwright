// Embeddable viewer: <script src=".../embed/reportwright-viewer.js"></script>
// ReportWright.mountViewer('#el', { server: 'https://reports.example.com', report: 'loan-statement', params: {...} })
//
// The interactive HTML export uses the same entry point with everything bundled in:
//   { definition, reports: {id: def}, fonts: {key: base64}, customFonts: [uploaded font info], uiFontCss, snapshot: {url: json} }
// so the file keeps working (filters, open/close, sort, chart clicks, drill-through) without the ReportWright server.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ReportViewer from '../viewer/ReportViewer.jsx';
import { setAssetBase, registerReports, setBundledFonts, setStandalone, usingWorker } from '../viewer/engineClient.js';
import { uiFontCss } from '../viewer/uiFonts.js';
import { setFetchPolicy } from '../viewer/dataFetch.js';
import { loadLanguage } from '../i18n/index.js';
import { setShadowStyles, declareDocumentStyles } from './styles.js';

/* global __PW_CSS__ */
const CSS = typeof __PW_CSS__ === 'string' ? __PW_CSS__ : '';

/** Data captured at export time: used when the live call fails (offline, CORS, server gone). */
function installSnapshot(snapshot) {
  if (!snapshot || window.__pwSnapshot) return;
  window.__pwSnapshot = true;
  const live = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    try {
      const res = await live(input, init);
      if (res.ok || !(url in snapshot)) return res;
    } catch (e) { if (!(url in snapshot)) throw e; }
    return new Response(JSON.stringify(snapshot[url]), { status: 200, headers: { 'content-type': 'application/json', 'x-pagewright-snapshot': '1' } });
  };
}

/**
 * The definition with `data` in place of its data sources: data maps a data source name to its JSON. A definition with
 * one data source also takes the JSON itself (data with none of the source names).
 * @param {any} def @param {Record<string, unknown>|undefined} data
 */
export function withData(def, data) {
  if (data == null || !def) return def;
  const srcs = def.dataSources || [];
  const keyed = typeof data === 'object' && !Array.isArray(data) && srcs.some(s => Object.hasOwn(data, s.name));
  if (!keyed && srcs.length !== 1) throw new Error(`mountViewer: data must be keyed by data source name (${srcs.map(s => s.name).join(', ') || 'the definition has none'})`);
  const of = (s) => (keyed ? (Object.hasOwn(data, s.name) ? data[s.name] : undefined) : data);
  return { ...def, dataSources: srcs.map(s => (of(s) === undefined ? s : { name: s.name, type: 'json', data: of(s) })) };
}

/**
 * @typedef {{ id: string, label: string, title?: string, after?: string, onClick?: (api: ViewerApi) => void }} ToolbarButton
 * @typedef {{ page: number, pages: number, goTo: (page: number) => void }} ViewerApi
 * @typedef {{ server?: string, report?: string, definition?: object, data?: Record<string, unknown>, fontsUrl?: string, params?: Record<string, string>, lang?: string, height?: string,
 *   onDrill?: (report: string, params: Record<string, unknown>) => void,
 *   reports?: Record<string, object>, fonts?: Record<string, string>, customFonts?: object[], uiFontCss?: string, snapshot?: Record<string, any>, title?: string,
 *   toolbar?: { hide?: string[], add?: ToolbarButton[] }, viewMode?: 'single' | 'continuous' | 'galley', nonce?: string,
 *   onReady?: (error: Error | null) => void, allowHosts?: string[], unsafeFetch?: boolean, fetch?: typeof fetch }} ViewerOptions
 * @typedef {'ready' | 'error' | 'page' | 'parameters'} ViewerEvent
 * @typedef {'pdf' | 'xlsx' | 'docx' | 'pptx' | 'html' | 'csv' | 'json' | 'excel' | 'word' | 'powerpoint'} ViewerFormat
 * @typedef {{ usesWorker: boolean, unmount: () => void, setParameters: (params: Record<string, any>) => Promise<void>, setDefinition: (definition: object) => Promise<void>,
 *   goToPage: (page: number) => Promise<void>, getPageCount: () => number, print: () => Promise<void>, export: (format: ViewerFormat) => Promise<Blob>,
 *   on: (event: ViewerEvent, fn: (detail: any) => void) => () => void }} ViewerHandle
 */
/**
 * Mount the ReportWright viewer in an element. With `server` (a self-hosted ReportWright server), fonts and saved reports
 * load from it. Without one (standalone): pass `definition` (and `data`, keyed by data source name), and `fontsUrl`, the
 * URL of a copy of @reportwright/fonts/public/fonts; nothing calls /api, and the interface uses the system font.
 * Data sources on other hosts may reach public http(s) addresses only (literal private, loopback, link-local and CGNAT
 * addresses and "localhost" names are refused; a parameter may not make the host): `allowHosts` names private hosts that
 * may be reached, `unsafeFetch: true` turns the check off. A browser cannot resolve DNS, so a public name that points at
 * a private address is not caught here: for multi-tenant use render on the server, or pass `fetch` (it then makes every
 * data request, after the check) that allows only the hosts you know.
 * @param {string|HTMLElement} target
 * @param {ViewerOptions} opts
 * @returns {ViewerHandle}
 */
export function mountViewer(target, opts = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error(`mountViewer: no element for ${target}`);
  const server = String(opts.server || '').replace(/\/$/, '');
  setAssetBase(server);
  setStandalone({ standalone: !server, fontsUrl: opts.fontsUrl });
  setFetchPolicy({ allowHosts: opts.allowHosts, unsafeFetch: opts.unsafeFetch, fetch: opts.fetch });
  if (opts.reports) registerReports(opts.reports);
  if (opts.fonts) setBundledFonts(opts.fonts, opts.customFonts);
  if (opts.snapshot) installSnapshot(opts.snapshot);
  // Fonts must be declared on the document; the rest of the styles live in a shadow root.
  // (Report fonts are added as FontFace objects by the viewer; this is the interface font.)
  const fontCss = opts.uiFontCss ?? (server ? uiFontCss(server) : ''); // standalone: the system UI font, no 404s
  if (fontCss) declareDocumentStyles('pw-embed-fonts', fontCss, opts.nonce);
  const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="pw-embed"></div>';
  setShadowStyles(shadow, CSS, opts.nonce);
  const box = /** @type {HTMLElement} */ (shadow.querySelector('.pw-embed'));
  box.style.height = opts.height || '720px'; // set through CSSOM: a style attribute in markup is blocked by style-src 'self'
  const root = createRoot(box);
  // the handle's listeners, and the viewer's live API (ReportViewer sets `control.current` on every render)
  /** @type {Record<string, Array<(detail: any) => void>>} */
  const listeners = {};
  const emit = (/** @type {string} */ name, /** @type {any} */ detail) => { for (const fn of listeners[name] || []) { try { fn(detail); } catch (e) { console.error(e); } } };
  /** @type {any} */
  let api = null;
  let wake = () => {};
  const viewerReady = new Promise((resolve) => { wake = () => resolve(undefined); });
  const control = { get current() { return api; }, set current(v) { api = v; if (v) wake(); } };
  const show0 = (definition) => root.render(createElement(ReportViewer, { definition, reportId: opts.report, params: opts.params, lang: opts.lang, onDrill: opts.onDrill, title: opts.title, toolbar: opts.toolbar, viewMode: opts.viewMode, onReady: opts.onReady, control, onEvent: emit }));
  // the language's strings first (English is built in; the others load on demand)
  const show = (definition) => loadLanguage(opts.lang).catch(() => {}).then(() => show0(definition));
  if (opts.definition) show(withData(opts.definition, opts.data));
  else if (!server) throw new Error('mountViewer: pass definition (standalone), or server and report');
  else fetch(`${server}/api/reports/${encodeURIComponent(opts.report)}`)
    .then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
    .then(show)
    .catch(e => { shadow.querySelector('.pw-embed').innerHTML = `<div class="vmsg error">The report did not load: ${String(e.message).replace(/</g, '&lt;')}</div>`; opts.onReady?.(e); emit('error', { message: e.message }); });
  /** @type {ViewerHandle} */
  const handle = {
    get usesWorker() { return usingWorker(); },
    unmount: () => { api = null; root.unmount(); },
    setParameters: (params) => viewerReady.then(() => api?.setParameters(params)),
    setDefinition: (definition) => viewerReady.then(() => api?.setDefinition(definition)),
    goToPage: (page) => viewerReady.then(() => api?.goTo(page)),
    getPageCount: () => api?.pages ?? 0,
    print: () => viewerReady.then(() => api?.print()),
    export: (format) => viewerReady.then(() => {
      const f = { excel: 'xlsx', word: 'docx', powerpoint: 'pptx' }[format] ?? format;
      if (!['pdf', 'xlsx', 'docx', 'pptx', 'html', 'csv', 'json'].includes(f)) throw new Error(`export: unknown format "${format}"`);
      if (!api) throw new Error('export: the viewer is not showing a report');
      return api.exportBlob(f);
    }),
    on: (event, fn) => {
      (listeners[event] ||= []).push(fn);
      return () => { listeners[event] = (listeners[event] || []).filter(x => x !== fn); };
    },
  };
  return handle;
}

if (typeof window !== 'undefined') window.ReportWright = window.Pagewright = { mountViewer }; // Pagewright: the old name, deprecated (0.9)
