// @pagewrightjs/angular: <pagewright-viewer> and <pagewright-designer> custom elements.
// Angular uses them with CUSTOM_ELEMENTS_SCHEMA: no Angular compiler step, so they work with any Angular version.
//   definePagewrightElements();  then  <pagewright-viewer [options]="{ server, report }"></pagewright-viewer>
// The designer fires `pw-save` (detail: the definition) when no onSave is given, and `pw-ready` (detail: the handle).
const ATTRS = ['server', 'report', 'height', 'lang'];

// A stable key for options: functions left out, object keys sorted, each object turned to text once (cached by
// identity), so a big `data` array the app keeps in state costs nothing on a re-render and an inline object with the
// same content gives the same key (no remount).
const texts = new WeakMap();
const json = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined
  : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
const keyOf = (v) => {
  if (!v || typeof v !== 'object') return typeof v === 'function' ? '' : String(json(v));
  let s = texts.get(v);
  if (s === undefined) texts.set(v, s = String(json(v)));
  return s;
};
/** What the viewer shows: every option but callbacks. */
const viewerKey = (o) => Object.keys(o).sort().map(k => (typeof o[k] === 'function' ? '' : `${k}=${keyOf(o[k])}`)).join('\u0000');
/** The designer keeps its edits: it remounts only for another server, report, read-only state or definition content. */
const designerKey = (o) => [o.server, o.report, o.readOnly, keyOf(o.definition)].join('\u0000');
/** The error a viewer that did not load shows in its element. */
const showError = (el, e) => {
  if (!el) return;
  el.textContent = `Pagewright did not load: ${e?.message || e}`;
  el.setAttribute('role', 'alert');
};

function element(load, isDesigner) {
  return class extends HTMLElement {
    static get observedAttributes() { return ATTRS; }
    #options = {};
    #handle = null;
    #gen = 0;
    #key = '';
    constructor() {
      super();
      // a property set before the element was defined (Angular can do this) shadows the setter: take it over
      if (Object.prototype.hasOwnProperty.call(this, 'options')) {
        const v = /** @type {any} */ (this).options;
        delete /** @type {any} */ (this).options;
        this.#options = v && typeof v === 'object' ? v : {};
      }
    }
    get options() { return this.#options; }
    set options(v) { this.#options = v && typeof v === 'object' ? v : {}; this.#mount(); }
    connectedCallback() { this.#mount(); }
    attributeChangedCallback() { this.#mount(); }
    disconnectedCallback() { this.#gen++; this.#handle?.unmount(); this.#handle = null; this.#key = ''; }
    #mount() {
      if (!this.isConnected) return;
      const o = { ...this.#options };
      for (const a of ATTRS) if (this.hasAttribute(a) && o[a] == null) o[a] = this.getAttribute(a);
      if (isDesigner && !o.onSave) o.onSave = (definition) => { this.dispatchEvent(new CustomEvent('pw-save', { detail: definition })); };
      // the designer keeps its edits: it remounts only for another report or a new definition object
      const key = isDesigner ? designerKey(o) : viewerKey(o);
      if (this.#handle && key === this.#key) return;
      this.#key = key;
      const g = ++this.#gen;
      this.#handle?.unmount(); this.#handle = null;
      load().then(fn => {
        if (g !== this.#gen) return;
        this.#handle = fn(this, o);
        this.dispatchEvent(new CustomEvent('pw-ready', { detail: this.#handle }));
      }).catch(e => { if (g === this.#gen) { showError(this, e); this.dispatchEvent(new CustomEvent('pw-error', { detail: e })); } });
    }
  };
}

/** Register <pagewright-viewer> and <pagewright-designer> (once). */
export function definePagewrightElements() {
  if (typeof customElements === 'undefined') return; // server rendering
  if (!customElements.get('pagewright-viewer')) customElements.define('pagewright-viewer', element(() => import('@pagewrightjs/viewer').then(m => m.mountViewer), false));
  if (!customElements.get('pagewright-designer')) customElements.define('pagewright-designer', element(() => import('@pagewrightjs/viewer/designer').then(m => m.mountDesigner), true));
}
