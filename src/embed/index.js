// Embeddable viewer: <script src=".../embed/pagewright-viewer.js"></script>
// Pagewright.mountViewer('#el', { server: 'https://reports.example.com', report: 'loan-statement', params: {...} })
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ReportViewer, { setFontBase } from '../viewer/ReportViewer.jsx';
import { setAssetBase } from '../viewer/engineClient.js';

/* global __PW_CSS__ */
const CSS = typeof __PW_CSS__ === 'string' ? __PW_CSS__ : '';

/**
 * @param {string|HTMLElement} target
 * @param {{ server?: string, report?: string, definition?: object, params?: Record<string,string>, lang?: string, height?: string, onDrill?: Function }} opts
 */
export function mountViewer(target, opts = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error(`mountViewer: no element for ${target}`);
  const server = String(opts.server || '').replace(/\/$/, '');
  setAssetBase(server);
  // Fonts must be declared on the document; the rest of the styles live in a shadow root.
  const fontCss = setFontBase(server);
  if (!document.getElementById('pw-embed-fonts')) {
    const st = document.createElement('style');
    st.id = 'pw-embed-fonts';
    st.textContent = fontCss;
    document.head.appendChild(st);
  }
  const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="pw-embed" style="height:${opts.height || '720px'}"></div>`;
  const root = createRoot(shadow.querySelector('.pw-embed'));
  const show = (definition) => root.render(createElement(ReportViewer, { definition, reportId: opts.report, params: opts.params, lang: opts.lang, onDrill: opts.onDrill, title: opts.title }));
  if (opts.definition) show(opts.definition);
  else fetch(`${server}/api/reports/${encodeURIComponent(opts.report)}`)
    .then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
    .then(show)
    .catch(e => { shadow.querySelector('.pw-embed').innerHTML = `<div class="vmsg error">The report did not load: ${String(e.message).replace(/</g, '&lt;')}</div>`; });
  return { unmount: () => root.unmount() };
}

if (typeof window !== 'undefined') window.Pagewright = { mountViewer };
