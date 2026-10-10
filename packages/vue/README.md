# @reportwright/vue

The ReportWright report viewer and drag-and-drop designer as Vue 3 components.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fvue)](https://www.npmjs.com/package/@reportwright/vue) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/vue)](https://socket.dev/npm/package/@reportwright/vue)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) ([Embed it](https://mrarun005.github.io/reportwright-demo/#embed) shows the wrapper code; the [designer playground](https://mrarun005.github.io/reportwright-demo/play.html) is the designer this package mounts).

Vue is a peer dependency; the viewer loads on mount (SSR-safe).


<img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/ui-viewer.jpg" alt="The viewer" width="60%">

## Install

```bash
npm i @reportwright/vue @reportwright/viewer @reportwright/fonts
cp -r node_modules/@reportwright/fonts/public public/pw     # serve the fonts as static files
```

Vite 7: set `worker: { format: 'es' }` in `vite.config.js` (see [`@reportwright/viewer`'s bundler setup](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#bundler-setup-read-this-first)).

## Quick start (30 seconds)

```vue
<script setup>
import { ReportWrightViewer } from '@reportwright/vue';
import definition from './orders.pw.json';   // the report from @reportwright/engine's README examples
const orders = { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] };
</script>
<template>
  <ReportWrightViewer :options="{ definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '720px' }" />
</template>
```

Verified against this version with Vite 7 and Vue 3.5 in Chromium.

## Examples

**Get the handle, re-run with parameters, export:**

```vue
<script setup>
import { ReportWrightViewer } from '@reportwright/vue';
let viewer;
const onReady = (h) => { viewer = h; h.on('ready', ({ pages }) => console.log(pages, 'pages')); };
const excel = async () => open(URL.createObjectURL(await viewer.export('xlsx')));
</script>
<template>
  <button @click="viewer.setParameters({ minAmount: 100 })">Over 100</button>
  <button @click="excel">Excel</button>
  <ReportWrightViewer :options="{ definition, data: { orders }, fontsUrl: '/pw/fonts/' }" @ready="onReady" />
</template>
```

**Edit a report and save it to your own API:**

```vue
<ReportWrightDesigner :options="{ definition, fontsUrl: '/pw/fonts/', onSave: (def) => api.put('/reports/orders', def) }" />
```

**With a self-hosted ReportWright server:**

```vue
<ReportWrightViewer :options="{ server: 'https://reports.example.com', report: 'invoice', params: { id: '42' } }" />
<ReportWrightDesigner :options="{ server, definition, onSave: save }" @ready="(h) => (designer = h)" />
```

A runnable app is in the repository's [`examples/vue`](https://github.com/MrArun005/reportwright/tree/main/examples/vue).

## Props and events

| | Component | Meaning |
|---|---|---|
| `options` prop | both | the options of `mountViewer` / `mountDesigner` (full table in [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#options-reference)) |
| `@ready` | both | the `ViewerHandle` / `DesignerHandle` |
| `@error` | both | the viewer's code did not load (the element shows the message) |

## Support

Vue 3.3 or later (peer). Browsers and limits are the viewer's: see [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#browser-support-and-limits).

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).

## Related packages

[`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) (what this wraps), [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine), [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts), and the [`react`](https://github.com/MrArun005/reportwright/tree/main/packages/react), [`svelte`](https://github.com/MrArun005/reportwright/tree/main/packages/svelte) and [`angular`](https://github.com/MrArun005/reportwright/tree/main/packages/angular) wrappers.

MIT.
