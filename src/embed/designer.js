// Embeddable designer: <script src=".../embed/pagewright-viewer.js"></script>
// Pagewright.mountDesigner('#el', { server, definition | report, onSave(def), onOpen(), readOnly,
//   toolbox: { hide: ['map', …] }, panels: { data: false, inspector: false }, dataSourceTemplates: [{ label, source }] })
// A second entry of the ESM build: it shares chunks with the viewer; the offline single-file viewer has no designer.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Designer from '../designer/Designer.jsx';
import { useDesigner } from '../designer/store.js';
import { setAssetBase, setStandalone } from '../viewer/engineClient.js';
import { uiFontCss } from '../viewer/uiFonts.js';
import { loadLanguage } from '../i18n/index.js';

/* global __PW_CSS__ */
const CSS = typeof __PW_CSS__ === 'string' ? __PW_CSS__ : '';
const BLANK = { $schema: 'pagewright/report@1', name: 'New report', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [] } } };

/**
 * @typedef {{ label?: string, source: { name: string, type: string, [key: string]: unknown } }} DataSourceTemplate
 * @typedef {{ server?: string, fontsUrl?: string, report?: string, definition?: object, lang?: string, height?: string,
 *   onSave?: (definition: object) => unknown, onOpen?: () => object | null | undefined | Promise<object | null | undefined>, readOnly?: boolean,
 *   toolbox?: { hide?: string[] }, panels?: { data?: boolean, inspector?: boolean }, dataSourceTemplates?: DataSourceTemplate[] }} DesignerOptions
 * @typedef {{ unmount: () => void, getDefinition: () => object, save: () => Promise<void> }} DesignerHandle
 */
/**
 * Mount the Pagewright designer in an element. With onSave the host app saves; without it, the server named
 * (with neither, there is no Save button). Without `server`, fonts load from `fontsUrl` (a copy of @pagewrightjs/fonts/public/fonts).
 * @param {string|HTMLElement} target
 * @param {DesignerOptions} opts
 * @returns {DesignerHandle}
 */
export function mountDesigner(target, opts = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error(`mountDesigner: no element for ${target}`);
  const server = String(opts.server || '').replace(/\/$/, '');
  setAssetBase(server);
  setStandalone({ standalone: !server, fontsUrl: opts.fontsUrl });
  if (server && !document.getElementById('pw-embed-fonts')) { // standalone: the system UI font
    const st = document.createElement('style');
    st.id = 'pw-embed-fonts';
    st.textContent = uiFontCss(server);
    document.head.appendChild(st);
  }
  const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="pw-embed" style="height:${opts.height || '760px'}"></div>`;
  const box = /** @type {HTMLElement} */ (shadow.querySelector('.pw-embed'));
  const root = createRoot(box);
  const embed = { onSave: opts.onSave, onOpen: opts.onOpen, readOnly: !!opts.readOnly, toolbox: opts.toolbox, panels: opts.panels, dataSourceTemplates: opts.dataSourceTemplates, server };
  const show = (definition) => loadLanguage(opts.lang).catch(() => {}).then(() => root.render(createElement(Designer, { id: opts.report, initial: definition, lang: opts.lang, embed })));
  if (opts.definition || !opts.report) show(opts.definition || BLANK);
  else fetch(`${server}/api/reports/${encodeURIComponent(opts.report)}`)
    .then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
    .then(show)
    .catch(e => { box.innerHTML = `<div class="vmsg error">The report did not load: ${String(e.message).replace(/</g, '&lt;')}</div>`; });
  return {
    unmount: () => root.unmount(),
    /** the definition as it is now (a plain copy) */
    getDefinition: () => JSON.parse(JSON.stringify(useDesigner.getState().def)),
    save: () => useDesigner.getState().save(),
  };
}
