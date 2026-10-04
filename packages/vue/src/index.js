// @pagewright/vue: the Pagewright viewer and designer as Vue 3 components. <PagewrightViewer :options="{ server, report }" />
// The viewer renders in a shadow root inside the component's <div>; it loads on mount, so SSR never touches `window`.
import { defineComponent, h, ref, onMounted, onBeforeUnmount, watch } from 'vue';

function component(name, load, watched) {
  return defineComponent({
    name,
    props: { options: { type: Object, required: true } },
    emits: ['ready'],
    setup(props, { emit }) {
      const el = ref(null);
      let handle = null, gen = 0;
      const mount = async () => {
        const g = ++gen;
        handle?.unmount(); handle = null;
        const fn = await load();
        if (g !== gen || !el.value) return;
        handle = fn(el.value, { ...props.options });
        emit('ready', handle);
      };
      onMounted(mount);
      watch(watched(props), mount, { deep: watched === all });
      onBeforeUnmount(() => { gen++; handle?.unmount(); handle = null; });
      return () => h('div', { ref: el });
    },
  });
}
const all = (props) => () => props.options;

export const PagewrightViewer = component('PagewrightViewer', () => import('@pagewright/viewer').then(m => m.mountViewer), all);
// the designer keeps its edits: it remounts only for another report or a new definition object
export const PagewrightDesigner = component('PagewrightDesigner', () => import('@pagewright/viewer/designer').then(m => m.mountDesigner),
  (props) => () => [props.options.server, props.options.report, props.options.definition, props.options.readOnly]);
