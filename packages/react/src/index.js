// @pagewright/react: the Pagewright viewer and designer as React components.
// The viewer bundles its own React and renders in a shadow root; this only gives it a <div>.
// It loads on mount (dynamic import), so server rendering never touches `window`.
import { createElement, useEffect, useRef } from 'react';

const loadViewer = () => import('@pagewright/viewer').then(m => m.mountViewer);
const loadDesigner = () => import('@pagewright/viewer/designer').then(m => m.mountDesigner);

/** Callbacks always call the latest prop, so a new arrow function each render does not remount. */
function liveCallbacks(latest) {
  const out = { ...latest.current };
  for (const [k, v] of Object.entries(out)) if (typeof v === 'function') out[k] = (...a) => latest.current[k]?.(...a);
  return out;
}

function useMounted(load, latest, deps, style) {
  const ref = useRef(null);
  useEffect(() => {
    let handle = null, live = true;
    load().then(mount => {
      if (!live || !ref.current) return;
      const opts = liveCallbacks(latest);
      // a height given to the component's box: the viewer fills it (its own default is a fixed height)
      if (opts.height == null && style?.height != null) opts.height = '100%';
      handle = mount(ref.current, opts);
      latest.current.onReady?.(handle);
    });
    return () => { live = false; handle?.unmount(); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** <PagewrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} /> */
export function PagewrightViewer({ className, style, ...options }) {
  const latest = useRef(options);
  latest.current = options;
  // a remount when what is shown changes (not when a callback is a new function)
  const key = JSON.stringify(options, (k, v) => (typeof v === 'function' ? undefined : v));
  const ref = useMounted(loadViewer, latest, [key], style);
  return createElement('div', { ref, className, style });
}

/** <PagewrightDesigner server="…" definition={def} onSave={(def) => …} /> — remounts only for a new report or definition object. */
export function PagewrightDesigner({ className, style, ...options }) {
  const latest = useRef(options);
  latest.current = options;
  const ref = useMounted(loadDesigner, latest, [options.server, options.report, options.definition, options.readOnly], style);
  return createElement('div', { ref, className, style });
}
