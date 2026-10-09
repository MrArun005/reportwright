// Embeddable designer: <script src=".../embed/reportwright-viewer.js"></script>
// ReportWright.mountDesigner('#el', { server, definition | report, onSave(def), onOpen(), readOnly,
//   toolbox: { hide: ['map', …] }, panels: { data: false, inspector: false }, dataSourceTemplates: [{ label, source }],
//   warnOnLeave = true, onDirtyChange(dirty) }) → { unmount, getDefinition, save, isDirty }
// A second entry of the ESM build: it shares chunks with the viewer; the offline single-file viewer has no designer.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Designer from '../designer/Designer.jsx';
import { newDesignerStore } from '../designer/store.js';
import { setAssetBase, setStandalone } from '../viewer/engineClient.js';
import { setFetchPolicy } from '../viewer/dataFetch.js';
import { uiFontCss } from '../viewer/uiFonts.js';
import { loadLanguage } from '../i18n/index.js';
import { setShadowStyles, declareDocumentStyles } from './styles.js';

/* global __PW_CSS__ */
const CSS = typeof __PW_CSS__ === 'string' ? __PW_CSS__ : '';
const BLANK = { $schema: 'reportwright/report@1', name: 'Untitled report', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [] } } };

/**
 * @typedef {{ label?: string, source: { name: string, type: string, [key: string]: unknown } }} DataSourceTemplate
 * @typedef {{ server?: string, fontsUrl?: string, report?: string, definition?: object, lang?: string, height?: string,
 *   onSave?: (definition: import('@reportwright/engine/report').Report) => unknown, onOpen?: () => object | null | undefined | Promise<object | null | undefined>, readOnly?: boolean,
 *   toolbox?: { hide?: string[] }, panels?: { data?: boolean, inspector?: boolean }, dataSourceTemplates?: DataSourceTemplate[], nonce?: string,
 *   allowHosts?: string[], unsafeFetch?: boolean, fetch?: typeof fetch, warnOnLeave?: boolean, onDirtyChange?: (dirty: boolean) => void }} DesignerOptions
 *   (allowHosts, unsafeFetch, fetch: as mountViewer's). warnOnLeave (default true): the browser asks before the page is
 *   left or reloaded with unsaved changes; false leaves that to the host (isDirty, onDirtyChange). onDirtyChange: called
 *   when the report gets unsaved changes (true) and when they are saved (false).
 * @typedef {{ unmount: () => void, getDefinition: () => object, save: () => Promise<void>, isDirty: () => boolean }} DesignerHandle
 */
/**
 * Mount the ReportWright designer in an element. With onSave the host app saves; without it, the server named
 * (with neither, there is no Save button). Without `server`, fonts load from `fontsUrl` (a copy of @reportwright/fonts/public/fonts).
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
  setFetchPolicy({ allowHosts: opts.allowHosts, unsafeFetch: opts.unsafeFetch, fetch: opts.fetch });
  if (server) declareDocumentStyles('pw-embed-fonts', uiFontCss(server), opts.nonce); // standalone: the system UI font
  const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="pw-embed"></div>';
  setShadowStyles(shadow, CSS, opts.nonce);
  const box = /** @type {HTMLElement} */ (shadow.querySelector('.pw-embed'));
  box.style.height = opts.height || '760px'; // CSSOM, not a style attribute: style-src 'self' blocks the latter
  const root = createRoot(box);
  const store = newDesignerStore(); // this designer's own state: other designers on the page have theirs (N17)
  const embed = { onSave: opts.onSave, onOpen: opts.onOpen, readOnly: !!opts.readOnly, toolbox: opts.toolbox, panels: opts.panels, dataSourceTemplates: opts.dataSourceTemplates, server };
  const show = (definition) => loadLanguage(opts.lang).catch(() => {}).then(() => root.render(createElement(Designer, { id: opts.report, initial: definition, lang: opts.lang, embed, store })));
  if (opts.definition || !opts.report) show(opts.definition || BLANK);
  else fetch(`${server}/api/reports/${encodeURIComponent(opts.report)}`)
    .then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))))
    .then(show)
    .catch(e => { box.innerHTML = `<div class="vmsg error">The report did not load: ${String(e.message).replace(/</g, '&lt;')}</div>`; });
  // unsaved changes (N34): the host is told, and (unless warnOnLeave: false) the browser asks before leaving. The
  // beforeunload listener is there only while there are unsaved changes: a save or unmount() removes it.
  const onLeave = (e) => { e.preventDefault(); e.returnValue = ''; };
  let dirty = false;
  const unsub = store.subscribe((s) => {
    if (!s.saved === dirty) return;
    dirty = !s.saved;
    if (opts.warnOnLeave !== false) { if (dirty) window.addEventListener('beforeunload', onLeave); else window.removeEventListener('beforeunload', onLeave); }
    try { opts.onDirtyChange?.(dirty); } catch (e) { console.error(e); } // eslint-disable-line no-console
  });
  return {
    unmount: () => { unsub(); window.removeEventListener('beforeunload', onLeave); root.unmount(); },
    /** whether there are changes not saved yet */
    isDirty: () => !store.getState().saved,
    /** the definition as it is now (a plain copy) */
    getDefinition: () => JSON.parse(JSON.stringify(store.getState().def)),
    save: () => store.getState().save(),
  };
}
