// @reportwright/svelte: Svelte actions (no compiler step needed). <div use:reportWrightViewer={{ server, report }} />
// The viewer loads when the element mounts, so SSR never touches `window`.

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
  el.textContent = `ReportWright did not load: ${e?.message || e}`;
  el.setAttribute('role', 'alert');
};
function action(load, sameReport) {
  return (node, options) => {
    let handle = null, gen = 0, current = options;
    const mount = (o) => {
      const g = ++gen;
      handle?.unmount(); handle = null;
      load().then(fn => { if (g === gen) { handle = fn(node, { ...o }); o.onReady?.(handle); } })
        .catch(e => { if (g === gen) { showError(node, e); o.onError?.(e); } });
    };
    mount(options);
    return {
      update(o) { if (!sameReport(current, o)) mount(o); current = o; },
      destroy() { gen++; handle?.unmount(); handle = null; },
    };
  };
}
export const reportWrightViewer = action(() => import('@reportwright/viewer').then(m => m.mountViewer), (a, b) => viewerKey(a) === viewerKey(b));
// the designer keeps its edits: it remounts only for another report or definition (by content)
export const reportWrightDesigner = action(() => import('@reportwright/viewer/designer').then(m => m.mountDesigner), (a, b) => designerKey(a) === designerKey(b));

/** @deprecated 0.9: renamed reportWrightViewer / reportWrightDesigner; the old names go in 1.0. */
export { reportWrightViewer as pagewrightViewer, reportWrightDesigner as pagewrightDesigner };
