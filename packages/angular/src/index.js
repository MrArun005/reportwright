// @pagewrightjs/angular: <pagewright-viewer> and <pagewright-designer> custom elements.
// Angular uses them with CUSTOM_ELEMENTS_SCHEMA: no Angular compiler step, so they work with any Angular version.
//   definePagewrightElements();  then  <pagewright-viewer [options]="{ server, report }"></pagewright-viewer>
// The designer fires `pw-save` (detail: the definition) when no onSave is given, and `pw-ready` (detail: the handle).
const ATTRS = ['server', 'report', 'height', 'lang'];

function element(load, isDesigner) {
  return class extends HTMLElement {
    static get observedAttributes() { return ATTRS; }
    #options = {};
    #handle = null;
    #gen = 0;
    #key = '';
    #definition = undefined;
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
      const key = isDesigner ? [o.server, o.report, o.readOnly].join('\u0000') : JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v));
      if (this.#handle && key === this.#key && (!isDesigner || this.#definition === o.definition)) return;
      this.#key = key; this.#definition = o.definition;
      const g = ++this.#gen;
      this.#handle?.unmount(); this.#handle = null;
      load().then(fn => {
        if (g !== this.#gen) return;
        this.#handle = fn(this, o);
        this.dispatchEvent(new CustomEvent('pw-ready', { detail: this.#handle }));
      });
    }
  };
}

/** Register <pagewright-viewer> and <pagewright-designer> (once). */
export function definePagewrightElements() {
  if (typeof customElements === 'undefined') return; // server rendering
  if (!customElements.get('pagewright-viewer')) customElements.define('pagewright-viewer', element(() => import('@pagewrightjs/viewer').then(m => m.mountViewer), false));
  if (!customElements.get('pagewright-designer')) customElements.define('pagewright-designer', element(() => import('@pagewrightjs/viewer/designer').then(m => m.mountDesigner), true));
}
