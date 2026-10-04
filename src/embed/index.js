// Embeddable viewer: <script src=".../embed/pagewright-viewer.js"></script>
// Pagewright.mountViewer('#el', { server: 'https://reports.example.com', report: 'loan-statement', params: {...} })
//
// The interactive HTML export uses the same entry point with everything bundled in:
//   { definition, reports: {id: def}, fonts: {key: base64}, customFonts: [uploaded font info], uiFontCss, snapshot: {url: json} }
// so the file keeps working (filters, open/close, sort, chart clicks, drill-through) without the Pagewright server.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ReportViewer from '../viewer/ReportViewer.jsx';
import { setAssetBase, registerReports, setBundledFonts } from '../viewer/engineClient.js';
import { uiFontCss } from '../viewer/uiFonts.js';

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
 * @param {string|HTMLElement} target
 * @param {{ server?: string, report?: string, definition?: object, params?: Record<string,string>, lang?: string, height?: string, onDrill?: Function,
 *   reports?: Record<string, object>, fonts?: Record<string, string>, customFonts?: object[], uiFontCss?: string, snapshot?: Record<string, any>, title?: string,
 *   toolbar?: { hide?: string[], add?: { id: string, label: string, title?: string, after?: string, onClick?: (api: object) => void }[] },
 *   viewMode?: 'single' | 'continuous' | 'galley' }} opts
 */
export function mountViewer(target, opts = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error(`mountViewer: no element for ${target}`);
  const server = String(opts.server || '').replace(/\/$/, '');
  setAssetBase(server);
  if (opts.reports) registerReports(opts.reports);
  if (opts.fonts) setBundledFonts(opts.fonts, opts.customFonts);
  if (opts.snapshot) installSnapshot(opts.snapshot);
  // Fonts must be declared on the document; the rest of the styles live in a shadow root.
  // (Report fonts are added as FontFace objects by the viewer; this is the interface font.)
  const fontCss = opts.uiFontCss ?? uiFontCss(server);
  if (!document.getElementById('pw-embed-fonts')) {
    const st = document.createElement('style');
    st.id = 'pw-embed-fonts';
    st.textContent = fontCss;
    document.head.appendChild(st);
  }
  const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="pw-embed" style="height:${opts.height || '720px'}"></div>`;
  const root = createRoot(shadow.querySelector('.pw-embed'));
  const show = (definition) => root.render(createElement(ReportViewer, { definition, reportId: opts.report, params: opts.params, lang: opts.lang, onDrill: opts.onDrill, title: opts.title, toolbar: opts.toolbar, viewMode: opts.viewMode }));
  if (opts.definition) show(opts.definition);
  else fetch(`${server}/api/reports/${encodeURIComponent(opts.report)}`)
    .then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
    .then(show)
    .catch(e => { shadow.querySelector('.pw-embed').innerHTML = `<div class="vmsg error">The report did not load: ${String(e.message).replace(/</g, '&lt;')}</div>`; });
  return { unmount: () => root.unmount() };
}

if (typeof window !== 'undefined') window.Pagewright = { mountViewer };
