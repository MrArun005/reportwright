// @reportwright/react: the ReportWright viewer and designer as React components.
// The viewer renders in a shadow root with the app's own React (@reportwright/viewer/react-peer); this only gives it a <div>.
// It loads on mount (dynamic import), so server rendering never touches `window`.
import { createElement, forwardRef, useEffect, useRef } from 'react';

const loadViewer = () => import('@reportwright/viewer/react-peer').then(m => m.mountViewer);
const loadDesigner = () => import('@reportwright/viewer/react-peer/designer').then(m => m.mountDesigner);

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

/** Callbacks always call the latest prop, so a new arrow function each render does not remount. */
function liveCallbacks(latest) {
  const out = { ...latest.current };
  for (const [k, v] of Object.entries(out)) if (typeof v === 'function') out[k] = (...a) => latest.current[k]?.(...a);
  return out;
}

/** A ref (object or callback) gets the handle once the viewer is mounted, and null when it goes. */
const setRef = (r, v) => { if (typeof r === 'function') r(v); else if (r) r.current = v; };

function useMounted(load, latest, deps, style, outRef) {
  const ref = useRef(null);
  useEffect(() => {
    let handle = null, live = true;
    load().then(mount => {
      if (!live || !ref.current) return;
      // onReady is this wrapper's (it gets the handle); mountViewer's own onReady is not passed down
      const { onReady: _onReady, ...opts } = liveCallbacks(latest);
      // a height given to the component's box: the viewer fills it (its own default is a fixed height)
      if (opts.height == null && style?.height != null) opts.height = '100%';
      handle = mount(ref.current, opts);
      setRef(outRef, handle);
      latest.current.onReady?.(handle);
    }).catch(e => { if (!live) return; showError(ref.current, e); latest.current.onError?.(e); if (!latest.current.onError) console.error(e); });
    return () => { live = false; handle?.unmount(); setRef(outRef, null); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** <ReportWrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} ref={viewerRef} /> — the ref gets the ViewerHandle */
export const ReportWrightViewer = forwardRef(function ReportWrightViewer({ className, style, ...options }, outRef) {
  const latest = useRef(options);
  latest.current = options;
  // a remount when what is shown changes (not when a callback is a new function)
  const ref = useMounted(loadViewer, latest, [viewerKey(options)], style, outRef);
  return createElement('div', { ref, className, style });
});

/** <ReportWrightDesigner server="…" definition={def} onSave={(def) => …} /> — remounts only for another report or definition (by content). */
export function ReportWrightDesigner({ className, style, ...options }) {
  const latest = useRef(options);
  latest.current = options;
  const ref = useMounted(loadDesigner, latest, [designerKey(options)], style);
  return createElement('div', { ref, className, style });
}

/** @deprecated 0.9: renamed ReportWrightViewer / ReportWrightDesigner; the old names go in 1.0. */
export { ReportWrightViewer as PagewrightViewer, ReportWrightDesigner as PagewrightDesigner };
