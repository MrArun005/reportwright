// @pagewrightjs/svelte: Svelte actions (no compiler step needed). <div use:pagewrightViewer={{ server, report }} />
// The viewer loads when the element mounts, so SSR never touches `window`.
function action(load, sameReport) {
  return (node, options) => {
    let handle = null, gen = 0, current = options;
    const mount = (o) => {
      const g = ++gen;
      handle?.unmount(); handle = null;
      load().then(fn => { if (g === gen) { handle = fn(node, { ...o }); o.onReady?.(handle); } });
    };
    mount(options);
    return {
      update(o) { if (!sameReport(current, o)) mount(o); current = o; },
      destroy() { gen++; handle?.unmount(); handle = null; },
    };
  };
}
const shown = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v));
export const pagewrightViewer = action(() => import('@pagewrightjs/viewer').then(m => m.mountViewer), (a, b) => shown(a) === shown(b));
// the designer keeps its edits: it remounts only for another report or a new definition object
export const pagewrightDesigner = action(() => import('@pagewrightjs/viewer/designer').then(m => m.mountDesigner),
  (a, b) => a.server === b.server && a.report === b.report && a.definition === b.definition && a.readOnly === b.readOnly);
