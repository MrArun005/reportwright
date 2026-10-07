// @reportwright/vue: the ReportWright viewer and designer as Vue 3 components. <ReportWrightViewer :options="{ server, report }" />
// The viewer renders in a shadow root inside the component's <div>; it loads on mount, so SSR never touches `window`.
import { defineComponent, h, ref, onMounted, onBeforeUnmount, watch } from 'vue';

// A stable key for options: functions left out, object keys sorted. Not cached by identity here: Vue options are
// reactive and change in place, and reading them all inside the watcher is what makes Vue watch them.
const json = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined
  : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
const keyOf = (v) => (typeof v === 'function' ? '' : String(json(v)));
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

function component(name, load, watched) {
  return defineComponent({
    name,
    props: { options: { type: Object, required: true } },
    emits: ['ready', 'error'],
    setup(props, { emit }) {
      const el = ref(null);
      let handle = null, gen = 0;
      const mount = async () => {
        const g = ++gen;
        handle?.unmount(); handle = null;
        try {
          const fn = await load();
          if (g !== gen || !el.value) return;
          handle = fn(el.value, { ...props.options });
          emit('ready', handle);
        } catch (e) { if (g === gen) { showError(el.value, e); emit('error', e); } }
      };
      onMounted(mount);
      watch(() => watched(props.options), mount);
      onBeforeUnmount(() => { gen++; handle?.unmount(); handle = null; });
      return () => h('div', { ref: el });
    },
  });
}

export const ReportWrightViewer = component('ReportWrightViewer', () => import('@reportwright/viewer').then(m => m.mountViewer), viewerKey);
// the designer keeps its edits: it remounts only for another report or definition (by content)
export const ReportWrightDesigner = component('ReportWrightDesigner', () => import('@reportwright/viewer/designer').then(m => m.mountDesigner), designerKey);

/** @deprecated 0.9: renamed ReportWrightViewer / ReportWrightDesigner; the old names go in 1.0. */
export { ReportWrightViewer as PagewrightViewer, ReportWrightDesigner as PagewrightDesigner };
